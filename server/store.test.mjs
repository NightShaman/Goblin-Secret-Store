import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, decrypt, encrypt } from "./store.mjs";
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
  const beforeLogin = Date.now();
  const a = s.login(req, true);
  assert.equal(a.expiresInMs, s.limits.sessionMs);
  assert.ok(a.expiresAt >= beforeLogin + a.expiresInMs);
  assert.ok(a.expiresAt <= Date.now() + a.expiresInMs);
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

test("audit snapshots public credential names at event time and retains them after rename and deletion", (t) => {
  const { s } = fixture(t);
  const created = s.put({ ...input, name: "Original credential" });
  const ref = s.agent("use", { id: created.id, field: "token" }, caller).$burrowManaged;
  s.resolve(ref.reference, { ...caller, version: ref.version });
  const updated = s.put({ ...input, name: "Renamed credential", version: created.version }, created.id);
  s.remove(created.id, updated.version);
  const events = s.auditPage().events.filter(e => e.recordId === created.id);
  assert.deepEqual(events.map(e => [e.action, e.recordName]), [
    ["delete", "Renamed credential"], ["update", "Renamed credential"],
    ["use", "Original credential"], ["issue", "Original credential"],
    ["create", "Original credential"],
  ]);
  assert.equal(JSON.stringify(events).includes(input.fields[0].value), false);
  s.audit("read", "denied", "two");
  assert.equal(s.auditPage().events[0].recordName, null);
});

test("existing vault audit schema upgrades additively without inventing names for historical rows", (t) => {
  const f = fixture(t);
  const r = f.s.put(input);
  f.s.db.exec("ALTER TABLE audit DROP COLUMN recordName");
  f.restart();
  assert.equal(f.s.auditPage().events[0].recordName, null);
  const updated = f.s.put({ ...input, name: "New name", version: r.version }, r.id);
  assert.equal(f.s.auditPage().events[0].recordName, updated.name);
  f.restart();
  assert.deepEqual(f.s.auditPage().events.slice(0, 2).map(e => e.recordName), ["New name", null]);
});

test("restore identities reject every stale mutation across repeated and delete/restore cycles", t => {
  const f = fixture(t);
  let s = f.s;
  const original = s.put(input);
  const passphrase = "restore-regression-passphrase";
  const { backup } = s.backup(passphrase);
  const edited = s.put({ ...input, version: original.version, fields: [{ ...input.fields[0], value: "newer-fixture" }] }, original.id);
  const stale = new Set([original.version, edited.version]);
  const ref = s.agent("use", { id: original.id, field: "token" }, caller).$burrowManaged;
  for (let cycle = 0; cycle < 3; cycle++) {
    s.restore(passphrase, backup);
    assert.throws(() => s.resolve(ref.reference, { ...caller, version: ref.version }), /denied/);
    s = f.restart(); // The identity must survive restart, not just an in-memory epoch.
    let current = s.view(s.raw(original.id));
    assert.equal(current.acl.active, false);
    assert.equal(typeof current.version, "string");
    assert.equal(stale.has(current.version), false);
    for (const version of stale) {
      for (const mutate of [
        () => s.put({ ...input, version }, original.id),
        () => s.remove(original.id, version),
        () => s.setAcl(original.id, { version, acl: input.acl }),
      ]) assert.throws(mutate, e => e.message === "version_conflict" && e.statusCode === 409);
      assert.equal(s.raw(original.id).acl.active, false);
      assert.deepEqual(s.agent("list", {}, caller), { records: [] });
    }
    stale.add(current.version);
    // Valid ordinary edit must not reactivate restored grants.
    current = s.put({ ...input, version: current.version }, original.id);
    assert.equal(current.acl.active, false);
    stale.add(current.version);
    current = s.setAcl(original.id, { version: current.version, acl: input.acl });
    const use = s.agent("use", { id: original.id, field: "token" }, caller).$burrowManaged;
    assert.equal(s.resolve(use.reference, { ...caller, version: use.version }), input.fields[0].value);
    stale.add(current.version);
    s.remove(original.id, current.version);
  }
});

test("legacy numeric revision ciphertext remains readable and migrates on edit/restore", t => {
  const { s } = fixture(t);
  const r = s.raw(s.put(input).id);
  r.version = 2;
  const field = r.fields[0];
  field.encrypted = encrypt(s.key, input.fields[0].value,
    JSON.stringify(["gss-v1", r.id, r.version, field.name, field.type, field.protected]));
  s.db.prepare("UPDATE records SET data=? WHERE id=?").run(JSON.stringify(r), r.id);
  const passphrase = "legacy-regression-passphrase";
  const { backup } = s.backup(passphrase);
  const updated = s.put({ ...s.view(r), version: 2 }, r.id);
  assert.equal(typeof updated.version, "string");
  s.restore(passphrase, backup);
  assert.throws(() => s.setAcl(r.id, { version: 2, acl: input.acl }), /version_conflict/);
  const restored = s.setAcl(r.id, { version: s.raw(r.id).version, acl: input.acl });
  const ref = s.agent("use", { id: restored.id, field: "token" }, caller).$burrowManaged;
  assert.equal(s.resolve(ref.reference, { ...caller, version: ref.version }), input.fields[0].value);
});
