import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "./store.mjs";
import { activate } from "./index.mjs";

const bytes = body => Buffer.byteLength(JSON.stringify(body));
// Exercise the actual registered route wrapper, not just Store.restore().
for (const passphrase of ["boundary-passphrase", '"\\\n\t😀'.repeat(200).slice(0, 1024)]) {
  test(`export budgets unchanged restore JSON framing (${passphrase.length} passphrase units)`, async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "gss-boundary-"));
    const saved = [process.env.GSS_DATA_DIR, process.env.GSS_LIMITS_JSON];
    let close;
    try {
      const seed = new Store({ directory });
      seed.put({ name: "boundary fixture", template: "token", fields: [{ name: "token", type: "token", protected: true, value: "synthetic-boundary-value" }] });
      const baseline = seed.backup(passphrase);
      seed.close();
      const limit = bytes({ passphrase, backup: baseline.backup });
      const handlers = new Map();
      process.env.GSS_DATA_DIR = directory;
      process.env.GSS_LIMITS_JSON = JSON.stringify({ bodyBytes: limit });
      close = activate({ api: Object.fromEntries(["get", "post", "put", "delete"].map(method => [method, (p, handler) => handlers.set(`${method} ${p}`, handler)])), tools: { register() {} } });
      const call = (p, body) => handlers.get(`post ${p}`)({ body, auth: { enabled: true, authenticated: true } });
      const exported = await call("/backup", { passphrase });
      assert.equal(exported.status, 200);
      const body = { passphrase, backup: exported.body.backup };
      assert.equal(bytes(body), limit);
      const restored = await call("/restore", body);
      assert.equal(restored.status, 200);
      assert.equal(restored.body.restored, 1);
      // Same envelope one byte beyond the cap still fails closed at the route.
      assert.equal((await call("/restore", { ...body, extra: "x" })).status, 413);
      // Archive alone fitting is insufficient: export must now refuse that budget.
      close(); close = undefined;
      process.env.GSS_LIMITS_JSON = JSON.stringify({ bodyBytes: limit - 1 });
      close = activate({ api: Object.fromEntries(["get", "post", "put", "delete"].map(method => [method, (p, handler) => handlers.set(`${method} ${p}`, handler)])), tools: { register() {} } });
      assert.deepEqual((await call("/backup", { passphrase })).body, { error: "backup_limit" });
    } finally {
      close?.();
      for (const [i, name] of ["GSS_DATA_DIR", "GSS_LIMITS_JSON"].entries()) {
        if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i];
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
