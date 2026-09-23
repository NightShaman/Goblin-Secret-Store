import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, decrypt } from "./store.mjs";
const input = {
  name: "fixture",
  template: "token",
  fields: [
    {
      name: "token",
      type: "token",
      protected: true,
      value: "test-only-sensitive-fixture",
    },
  ],
  acl: { mode: "agents", agents: ["one"], active: true },
};
const caller = { agentId: "one", sessionId: "s", conversationId: "c" };
function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "gss-"));
  let s = new Store({ directory });
  t.after(() => {
    s.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    get s() {
      return s;
    },
    restart() {
      s.close();
      s = new Store({ directory });
      return s;
    },
  };
}
test("crypto binding, persistence, modes, CRUD versions and managed revocation", (t) => {
  const f = fixture(t);
  let s = f.s;
  const r = s.put(input);
  assert.equal(JSON.stringify(r).includes(input.fields[0].value), false);
  assert.equal(
    readFileSync(path.join(f.directory, "vault.sqlite")).includes(
      Buffer.from(input.fields[0].value),
    ),
    false,
  );
  assert.equal(
    statSync(path.join(f.directory, "master.key")).mode & 0o777,
    0o600,
  );
  const raw = s.raw(r.id),
    enc = raw.fields[0].encrypted;
  assert.throws(() => decrypt(s.key, enc, "wrong-binding"));
  enc.tag = "AAAA";
  assert.throws(() => decrypt(s.key, enc, "wrong-binding"));
  s = f.restart();
  assert.equal(s.all().length, 1);
  assert.deepEqual(s.agent("list", {}, { agentId: "two" }), { records: [] });
  assert.throws(
    () => s.agent("read", { id: r.id, agentId: "one" }, { agentId: "two" }),
    /denied/,
  );
  const ref = s.agent(
    "use",
    { id: r.id, field: "token" },
    caller,
  ).$burrowManaged;
  assert.equal(
    s.resolve(ref.reference, { ...caller, version: ref.version }),
    input.fields[0].value,
  );
  assert.throws(
    () =>
      s.resolve(ref.reference, {
        ...caller,
        sessionId: "other",
        version: ref.version,
      }),
    /denied/,
  );
  assert.throws(
    () => s.put({ ...input, version: 0 }, r.id),
    /version_conflict/,
  );
  s.setAcl(r.id, {
    version: r.version,
    acl: { mode: "none", agents: [], active: true },
  });
  assert.throws(
    () => s.resolve(ref.reference, { ...caller, version: ref.version }),
    /denied/,
  );
  const audit = JSON.stringify(s.db.prepare("SELECT * FROM audit").all());
  assert.equal(audit.includes(input.fields[0].value), false);
});
test("atomic bootstrap, local session expiry and core transition", (t) => {
  const { s } = fixture(t);
  const req = {
    auth: { enabled: false, authenticated: false },
    body: { password: "test-password-long" },
    headers: {},
  };
  assert.throws(() => s.require(req), /unauthorized/);
  const a = s.login(req, true);
  assert.throws(() => s.login(req, true), /already_initialized/);
  req.headers["x-gss-session"] = a.session;
  assert.equal(s.authenticated(req), true);
  assert.throws(
    () => s.login({ ...req, body: { password: "wrong-password-long" } }),
    /unauthorized/,
  );
  assert.equal(
    s.authenticated({ auth: { enabled: true, authenticated: false } }),
    false,
  );
  assert.equal(
    s.authenticated({ auth: { enabled: true, authenticated: true } }),
    true,
  );
  assert.equal(s.authenticated(req), false);
  const b = s.login(req);
  s.sessions.set(b.session, Date.now() - 1);
  req.headers["x-gss-session"] = b.session;
  assert.equal(s.authenticated(req), false);
  assert.throws(() => s.observe(), /denied/);
});
test("independent portable restore, inactive matching ACLs, validation before replacement", (t) => {
  const a = fixture(t),
    b = fixture(t);
  const r = a.s.put(input);
  const { backup } = a.s.backup("test-passphrase-long");
  assert.equal(backup.includes(input.fields[0].value), false);
  assert.throws(
    () => b.s.restore("wrong-passphrase-long", backup),
    /invalid_backup/,
  );
  assert.equal(b.s.all().length, 0);
  assert.equal(b.s.restore("test-passphrase-long", backup).restored, 1);
  assert.equal(b.s.raw(r.id).acl.active, false);
  assert.deepEqual(b.s.agent("list", {}, caller), { records: [] });
  const restored = b.s.raw(r.id);
  b.s.setAcl(r.id, { version: restored.version, acl: input.acl });
  const ref = b.s.agent(
    "use",
    { id: r.id, field: "token" },
    caller,
  ).$burrowManaged;
  assert.equal(
    b.s.resolve(ref.reference, { ...caller, version: ref.version }),
    input.fields[0].value,
  );
  assert.throws(
    () => b.s.restore("test-passphrase-long", backup.slice(0, -4)),
    /invalid_backup/,
  );
  assert.equal(b.s.all().length, 1);
});
test("expiry limits and all-agent ACL explicit", (t) => {
  const { s } = fixture(t);
  const r = s.put({ ...input, acl: undefined });
  assert.equal(s.agent("list", {}, caller).records.length, 0);
  const updated = s.setAcl(r.id, {
    version: r.version,
    acl: { mode: "all", agents: [], active: true },
  });
  assert.equal(s.agent("list", {}, caller).records.length, 1);
  const ref = s.agent(
    "use",
    { id: r.id, field: "token" },
    caller,
  ).$burrowManaged;
  s.refs.get(ref.reference).expires = 0;
  assert.throws(
    () => s.resolve(ref.reference, { ...caller, version: ref.version }),
    /denied/,
  );
  s.remove(r.id, updated.version);
  assert.equal(s.all().length, 0);
});

test('audit pagination reaches beyond old 1000 cap with stable date-filtered cursors', t => {
  const { s } = fixture(t);
  const insert = s.db.prepare('INSERT INTO audit(at,action,outcome) VALUES(?,?,?)');
  for (let i = 0; i < 1205; i++) insert.run('2026-09-23T12:00:00.000Z', 'use', 'ok');
  insert.run('2026-09-22T12:00:00.000Z', 'login', 'ok');
  let before, ids = [];
  do {
    const page = s.auditPage({ before, date: '2026-09-23', limit: 100 });
    ids.push(...page.events.map(e => e.id)); before = page.nextCursor;
    if (ids.length === 100) insert.run('2026-09-23T13:00:00.000Z', 'use', 'ok');
  } while (before);
  assert.equal(ids.length, 1205); assert.equal(new Set(ids).size, 1205);
  assert.equal(s.auditPage({ date: '2026-09-21' }).events.length, 0);
  for (const query of [{ limit: 501 }, { before: 'bad' }, { date: '2026-02-30' }]) assert.throws(() => s.auditPage(query), /audit_query_invalid/);
});
