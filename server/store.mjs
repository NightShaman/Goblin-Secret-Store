import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  existsSync,
  lstatSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
export const fail = (code = "denied", statusCode = 403) => {
  throw Object.assign(new Error(code), { statusCode });
};
const str = (v, n = 256) =>
  typeof v === "string" && v.length > 0 && v.length <= n;
const types = [
  "text",
  "url",
  "username",
  "credential",
  "secret",
  "token",
  "password",
  "private-key",
];
export const templates = [
  ["token", [["token", "token", true]]],
  [
    "id-secret",
    [
      ["id", "text", false],
      ["secret", "secret", true],
    ],
  ],
  [
    "user-pass",
    [
      ["username", "username", false],
      ["password", "password", true],
    ],
  ],
  [
    "ssh-key",
    [
      ["username", "username", false],
      ["privateKey", "private-key", true],
    ],
  ],
  ["custom", []],
].map(([id, fields]) => ({
  id,
  fields: fields.map(([name, type, protectedValue]) => ({
    name,
    type,
    protected: protectedValue,
  })),
}));
export function encrypt(key, value, binding) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(binding));
  return {
    iv: iv.toString("base64"),
    data: Buffer.concat([c.update(value, "utf8"), c.final()]).toString(
      "base64",
    ),
    tag: c.getAuthTag().toString("base64"),
  };
}
export function decrypt(key, v, binding) {
  const c = createDecipheriv("aes-256-gcm", key, Buffer.from(v.iv, "base64"));
  c.setAAD(Buffer.from(binding));
  c.setAuthTag(Buffer.from(v.tag, "base64"));
  return Buffer.concat([
    c.update(Buffer.from(v.data, "base64")),
    c.final(),
  ]).toString("utf8");
}
const derive = (p, s) =>
  scryptSync(p, s, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const password = (p) => {
  if (!str(p, 1024) || p.length < 12) fail("password_policy", 400);
};
const bind = (r, f) =>
  JSON.stringify(["gss-v1", r.id, r.version, f.name, f.type, f.protected]);
export function defaultDataDirectory(env = process.env, home = os.homedir()) {
  if (env.GSS_DATA_DIR) return env.GSS_DATA_DIR;
  if (env.BURROW_RUNTIME_ROOT) {
    if (!path.isAbsolute(env.BURROW_RUNTIME_ROOT)) fail("storage_absolute_required", 500);
    return path.join(env.BURROW_RUNTIME_ROOT, "mods", "mod-data", "goblin-secret-store");
  }
  return path.join(home, ".local", "share", "goblin-secret-store");
}
export class Store {
  constructor({
    directory = defaultDataDirectory(),
    limits = {},
  } = {}) {
    this.limits = {
      records: 1000,
      fields: 64,
      valueBytes: 65536,
      bodyBytes: 16 * 1024 * 1024,
      audit: 10000,
      refs: 10000,
      sessionMs: 3600000,
      refMs: 60000,
      ...limits,
    };
    if (!path.isAbsolute(directory)) fail("storage_absolute_required", 500);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (lstatSync(directory).isSymbolicLink()) fail("storage_symlink", 500);
    chmodSync(directory, 0o700);
    const kp = path.join(directory, "master.key"),
      dp = path.join(directory, "vault.sqlite");
    for (const p of [kp, dp])
      if (existsSync(p) && lstatSync(p).isSymbolicLink())
        fail("storage_symlink", 500);
    if (!existsSync(kp)) {
      if (existsSync(dp)) fail("storage_key_missing", 500);
      try {
        writeFileSync(kp, randomBytes(32), { mode: 0o600, flag: "wx" });
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
    }
    this.key = readFileSync(kp);
    if (this.key.length !== 32) fail("storage_key_invalid", 500);
    chmodSync(kp, 0o600);
    this.db = new DatabaseSync(dp);
    chmodSync(dp, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS config(k TEXT PRIMARY KEY,v TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at TEXT,action TEXT,outcome TEXT,agentId TEXT,recordId TEXT,recordName TEXT);",
    );
    // Older vaults have audit rows without labels. Do not infer their historical names
    // from the current record: it may have been renamed or deleted.
    if (!this.db.prepare("PRAGMA table_info(audit)").all().some((column) => column.name === "recordName"))
      this.db.exec("ALTER TABLE audit ADD COLUMN recordName TEXT");
    this.sessions = new Map();
    this.refs = new Map();
    this.mode = null;
    this.attempts = [];
  }
  close() {
    this.db.close();
    this.key.fill(0);
    this.sessions.clear();
    this.refs.clear();
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  config(k) {
    return this.db.prepare("SELECT v FROM config WHERE k=?").get(k)?.v;
  }
  auditPage({ before, date = "", limit = 100 } = {}) {
    const size = Number(limit), cursor = before === undefined ? Number.MAX_SAFE_INTEGER : Number(before);
    if (!Number.isSafeInteger(size) || size < 1 || size > 500 || !Number.isSafeInteger(cursor) || cursor < 1 ||
        (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date))) fail("audit_query_invalid", 400);
    const rows = this.db.prepare("SELECT * FROM audit WHERE id < ? AND (? = '' OR substr(at,1,10) = ?) ORDER BY id DESC LIMIT ?").all(cursor, date, date, size + 1);
    const events = rows.slice(0, size);
    return { events, nextCursor: rows.length > size ? String(events.at(-1).id) : null };
  }
  audit(action, outcome = "ok", agentId = null, recordId = null, recordName = null) {
    this.db
      .prepare(
        "INSERT INTO audit(at,action,outcome,agentId,recordId,recordName) VALUES(?,?,?,?,?,?)",
      )
      .run(
        new Date().toISOString(),
        action,
        outcome,
        typeof agentId === "string" ? agentId.slice(0, 256) : null,
        typeof recordId === "string" && /^[a-f0-9-]{36}$/.test(recordId)
          ? recordId
          : null,
        str(recordName) ? recordName : null,
      );
    this.db
      .prepare("DELETE FROM audit WHERE id <= (SELECT MAX(id) FROM audit)-?")
      .run(this.limits.audit);
  }
  observe(auth) {
    if (
      !auth ||
      typeof auth.enabled !== "boolean" ||
      typeof auth.authenticated !== "boolean"
    )
      fail();
    const mode = auth.enabled ? "core" : "local";
    if (this.mode !== mode) {
      this.sessions.clear();
      this.mode = mode;
    }
    return mode;
  }
  authenticated(req) {
    const mode = this.observe(req.auth);
    if (mode === "core") return req.auth.authenticated;
    const token =
      req.headers?.["x-gss-session"] || req.headers?.["X-GSS-Session"];
    const expiry = this.sessions.get(token);
    return !!expiry && expiry > Date.now();
  }
  require(req) {
    if (!this.authenticated(req)) {
      this.audit("management", "denied");
      fail("unauthorized", 401);
    }
  }
  session() {
    for (const [k, v] of this.sessions)
      if (v <= Date.now()) this.sessions.delete(k);
    if (this.sessions.size >= 256) fail("session_limit", 429);
    const session = randomBytes(32).toString("base64url"),
      expiresInMs = this.limits.sessionMs,
      expiresAt = Date.now() + expiresInMs;
    this.sessions.set(session, expiresAt);
    return { session, expiresAt, expiresInMs };
  }
  login(req, bootstrap = false) {
    if (this.observe(req.auth) !== "local") fail();
    const now = Date.now();
    this.attempts = this.attempts.filter((t) => t > now - 60000);
    if (this.attempts.length >= 10) fail("rate_limited", 429);
    this.attempts.push(now);
    const p = req.body?.password;
    password(p);
    if (bootstrap) {
      this.transaction(() => {
        if (this.config("password")) fail("already_initialized", 409);
        const salt = randomBytes(32).toString("base64");
        this.db
          .prepare("INSERT INTO config VALUES(?,?)")
          .run(
            "password",
            JSON.stringify({ salt, hash: derive(p, salt).toString("base64") }),
          );
      });
      this.audit("bootstrap");
    } else {
      const c = this.config("password");
      if (!c) fail("unauthorized", 401);
      const { salt, hash } = JSON.parse(c);
      if (!timingSafeEqual(derive(p, salt), Buffer.from(hash, "base64"))) {
        this.audit("login", "denied");
        fail("unauthorized", 401);
      }
      this.audit("login");
    }
    return this.session();
  }
  raw(id) {
    const r =
      typeof id === "string"
        ? this.db.prepare("SELECT data FROM records WHERE id=?").get(id)
        : null;
    if (!r) fail("not_found", 404);
    return JSON.parse(r.data);
  }
  all() {
    return this.db
      .prepare("SELECT data FROM records ORDER BY id")
      .all()
      .map((r) => JSON.parse(r.data));
  }
  agentView(r) {
    const { acl, ...record } = this.view(r);
    return record;
  }
  view(r) {
    return {
      ...r,
      fields: r.fields.map((f) =>
        f.protected
          ? { name: f.name, type: f.type, protected: true, hasValue: true }
          : { ...f },
      ),
    };
  }
  acl(a) {
    if (
      !a ||
      !["none", "agents", "all"].includes(a.mode) ||
      !Array.isArray(a.agents) ||
      a.agents.length > 1000 ||
      !a.agents.every((x) => str(x)) ||
      typeof a.active !== "boolean"
    )
      fail("invalid_acl", 400);
    return { mode: a.mode, agents: [...new Set(a.agents)], active: a.active };
  }
  allowed(r, c) {
    return (
      str(c?.agentId) &&
      r.acl.active &&
      (r.acl.mode === "all" ||
        (r.acl.mode === "agents" && r.acl.agents.includes(c.agentId)))
    );
  }
  validated(input, old = null) {
    if (
      !input ||
      !str(input.name) ||
      !templates.some((t) => t.id === input.template) ||
      !Array.isArray(input.fields) ||
      input.fields.length > this.limits.fields
    )
      fail("invalid_record", 400);
    const r = {
      id: old?.id || randomUUID(),
      // Opaque mutation identity, persisted with the record and authenticated in AAD.
      // Never derive it from imported/current revisions: deleted IDs may return.
      version: randomUUID(),
      name: input.name,
      template: input.template,
      acl: this.acl(input.acl || { mode: "none", agents: [], active: true }),
      fields: [],
    };
    const names = new Set();
    for (const f of input.fields) {
      if (
        !f ||
        !str(f.name, 128) ||
        names.has(f.name) ||
        !types.includes(f.type) ||
        typeof f.protected !== "boolean"
      )
        fail("invalid_field", 400);
      names.add(f.name);
      let value = f.value;
      const prior = old?.fields.find(
        (x) =>
          x.name === f.name && x.type === f.type && x.protected === f.protected,
      );
      if (value === undefined && f.protected && prior)
        value = decrypt(this.key, prior.encrypted, bind(old, prior));
      if (
        typeof value !== "string" ||
        Buffer.byteLength(value) > this.limits.valueBytes
      )
        fail("invalid_value", 400);
      const field = { name: f.name, type: f.type, protected: f.protected };
      if (f.protected)
        field.encrypted = encrypt(this.key, value, bind(r, field));
      else field.value = value;
      r.fields.push(field);
    }
    return r;
  }
  put(input, id, reassign = false) {
    return this.transaction(() => {
      const old = id ? this.raw(id) : null;
      if (old && input.version !== old.version) fail("version_conflict", 409);
      if (!old && this.all().length >= this.limits.records)
        fail("record_limit", 413);
      const r = this.validated(input, old);
      if (old?.acl.active === false && !reassign) r.acl.active = false;
      this.db
        .prepare("INSERT OR REPLACE INTO records VALUES(?,?)")
        .run(r.id, JSON.stringify(r));
      this.audit(old ? "update" : "create", "ok", null, r.id, r.name);
      return this.view(r);
    });
  }
  remove(id, version) {
    return this.transaction(() => {
      const record = this.raw(id);
      if (record.version !== version) fail("version_conflict", 409);
      this.db.prepare("DELETE FROM records WHERE id=?").run(id);
      this.audit("delete", "ok", null, id, record.name);
      return { ok: true };
    });
  }
  setAcl(id, input) {
    const old = this.raw(id);
    return this.put(
      { ...this.view(old), version: input.version, acl: this.acl(input.acl) },
      id,
      true,
    );
  }
  agent(action, args, c) {
    try {
      if (!str(c?.agentId)) fail();
      if (action === "list")
        return {
          records: this.all()
            .filter((r) => this.allowed(r, c))
            .map((r) => this.agentView(r)),
        };
      let r;
      try {
        r = this.raw(args?.id);
      } catch {
        fail();
      }
      if (!this.allowed(r, c)) fail();
      if (action === "read") return { record: this.agentView(r) };
      const f = r.fields.find((f) => f.name === args?.field && f.protected);
      if (!f) fail();
      for (const [k, v] of this.refs)
        if (v.expires <= Date.now()) this.refs.delete(k);
      if (this.refs.size >= this.limits.refs) fail("reference_limit", 429);
      const reference = randomBytes(32).toString("base64url");
      this.refs.set(reference, {
        id: r.id,
        field: f.name,
        version: String(r.version),
        caller: {
          agentId: c.agentId,
          sessionId: c.sessionId,
          conversationId: c.conversationId,
        },
        expires: Date.now() + this.limits.refMs,
      });
      this.audit("issue", "ok", c.agentId, r.id, r.name);
      return {
        $burrowManaged: {
          type: [
            "credential",
            "secret",
            "token",
            "password",
            "private-key",
          ].includes(f.type)
            ? f.type
            : "secret",
          reference,
          version: String(r.version),
          lifetimeMs: this.limits.refMs,
        },
      };
    } catch {
      this.audit(action, "denied", c?.agentId);
      fail();
    }
  }
  resolve(ref, c) {
    try {
      const t = this.refs.get(ref);
      if (
        !t ||
        t.expires <= Date.now() ||
        !["agentId", "sessionId", "conversationId"].every(
          (k) => t.caller[k] === c?.[k],
        ) ||
        c.version !== t.version
      )
        fail();
      const r = this.raw(t.id);
      if (String(r.version) !== t.version || !this.allowed(r, c)) fail();
      const f = r.fields.find((f) => f.name === t.field && f.protected);
      if (!f) fail();
      const value = decrypt(this.key, f.encrypted, bind(r, f));
      this.audit("use", "ok", c.agentId, r.id, r.name);
      return value;
    } catch {
      this.audit("use", "denied", c?.agentId);
      fail();
    }
  }
  backup(passphrase) {
    password(passphrase);
    const salt = randomBytes(32).toString("base64"),
      key = derive(passphrase, salt);
    try {
      const payload = JSON.stringify({
        format: 1,
        key: this.key.toString("base64"),
        records: this.all(),
      });
      const backup = JSON.stringify({
        format: 1,
        salt,
        ...encrypt(key, payload, "gss-backup-v1"),
      });
      // Match the unchanged restore route JSON framing, including escaping and
      // the exact supported passphrase (up to 1024 UTF-16 code units).
      if (Buffer.byteLength(JSON.stringify({ passphrase, backup })) > this.limits.bodyBytes)
        fail("backup_limit", 413);
      this.audit("backup");
      return { backup };
    } finally {
      key.fill(0);
    }
  }
  restore(passphrase, backup) {
    password(passphrase);
    if (!str(backup, this.limits.bodyBytes)) fail("invalid_backup", 400);
    let records;
    try {
      const outer = JSON.parse(backup);
      if (outer.format !== 1 || !str(outer.salt, 128)) throw Error();
      const key = derive(passphrase, outer.salt);
      let data;
      try {
        data = JSON.parse(decrypt(key, outer, "gss-backup-v1"));
      } finally {
        key.fill(0);
      }
      const source = Buffer.from(data.key, "base64");
      if (
        data.format !== 1 ||
        source.length !== 32 ||
        !Array.isArray(data.records) ||
        data.records.length > this.limits.records
      )
        throw Error();
      const seen = new Set();
      records = data.records.map((r) => {
        if (
          !/^[a-f0-9-]{36}$/.test(r.id) ||
          seen.has(r.id) ||
          !((Number.isSafeInteger(r.version) && r.version >= 1) ||
            (typeof r.version === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(r.version)))
        )
          throw Error();
        seen.add(r.id);
        const fields = r.fields.map((f) => ({
          ...f,
          value: f.protected
            ? decrypt(source, f.encrypted, bind(r, f))
            : f.value,
        }));
        const n = this.validated({
          ...r,
          fields,
          acl: { ...r.acl, active: false },
        });
        n.id = r.id;
        // Keep the freshly generated identity, never an imported revision.
        n.fields = n.fields.map((f, i) =>
          f.protected
            ? {
                ...f,
                encrypted: encrypt(this.key, fields[i].value, bind(n, f)),
              }
            : f,
        );
        return n;
      });
      source.fill(0);
    } catch {
      this.audit("restore", "denied");
      fail("invalid_backup", 400);
    }
    this.transaction(() => {
      this.db.exec("DELETE FROM records");
      for (const r of records)
        this.db
          .prepare("INSERT INTO records VALUES(?,?)")
          .run(r.id, JSON.stringify(r));
      this.audit("restore");
    });
    this.refs.clear();
    return { ok: true, restored: records.length };
  }
}
