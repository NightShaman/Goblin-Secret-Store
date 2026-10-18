import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
// Actual sibling core, not a mock host. Override to a separate checkout if needed.
const core = path.resolve(process.env.BURROW_CORE_ROOT || fileURLToPath(new URL("../../Burrow-Backend/", import.meta.url)));
const requireCore = createRequire(path.join(core, "package.json"));
const { Pool } = requireCore("pg");
const { createPostgresApplication } = await import(pathToFileURL(`${core}/src/postgres-composition.mjs`));
const { createManagedPostgresLifecycle } = await import(pathToFileURL(`${core}/src/postgres-lifecycle.mjs`));
const { loadMods, cleanupMods, createModRoute, modCatalog } = await import(
  `${core}/src/mod-runtime.mjs`
);
const { loadRuntimeMcpCapabilities } = await import(
  `${core}/src/runtime-capability-context.mjs`
);
const { grantedMcpTool, mcpCapabilitiesReceipt, mcpProvidersReceipt } = await import(`${core}/src/mcp-menu.mjs`);
const { executeReviewedProposalActions } = await import(`${core}/src/proposal-executor.mjs`);
const { protectToolOutput, resolveManagedProtectedBindings } = await import(
  `${core}/src/protected-values.mjs`
);
test("actual core child IPC routes/auth header/grants/managed consume/revocation/restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gss-core-"));
  const dir = path.join(root, "mods", "goblin-secret-store");
  await mkdir(dir, { recursive: true });
  await cp(new URL("./", import.meta.url), path.join(dir, "server"), {
    recursive: true,
  });
  await cp(new URL('../ui/', import.meta.url), path.join(dir, 'ui'), { recursive: true });
  await cp(new URL('../burrow.mod.json', import.meta.url), path.join(dir, 'burrow.mod.json'));
  const oldData = process.env.GSS_DATA_DIR,
    oldKey = process.env.BURROW_SETTINGS_KEY;
  process.env.GSS_DATA_DIR = path.join(root, "durable");
  const key = Buffer.alloc(32, 42);
  process.env.BURROW_SETTINGS_KEY = key.toString("base64");
  // Always own the cluster: never consume an inherited database URL or socket.
  // Requires PostgreSQL 17 + pgvector, running as a non-root user.
  const bin = process.env.BURROW_POSTGRES_BIN_DIR || "/usr/lib/postgresql/17/bin";
  const socketDir = path.join(root, "socket");
  const postgres = createManagedPostgresLifecycle({
    dataDir: path.join(root, "postgres"), socketDir,
    initdb: path.join(bin, "initdb"), pgCtl: path.join(bin, "pg_ctl"),
    postgres: path.join(bin, "postgres"), initdbArgs: ["--auth=trust"],
  });
  let pool, app;
  let modDependencies;
  let mods = [];
  let grants;
  try {
    await postgres.start();
    pool = new Pool({ host: socketDir, port: 5432, database: "postgres", user: os.userInfo().username });
    app = await createPostgresApplication({ pool, encryptionKey: key, runtimeRoot: root, bootstrapSampleIdentities: false });
    const { stores, modStoreFactory, enabledModIds, modCatalogWriter } = app;
    modDependencies = { stores, modStoreFactory, enabledModIds, modCatalogWriter };
    await pool.query("INSERT INTO mod_lifecycle(mod_id,enabled,created_at,updated_at) VALUES($1,TRUE,$2,$2)", ["goblin-secret-store", new Date().toISOString()]);
    mods = await loadMods({ runtimeRoot: root, ...modDependencies });
    assert.equal(mods[0]?.status, "loaded", mods[0]?.error);
    const http = async (
      method,
      p,
      body = {},
      auth = { enabled: false, authenticated: false },
      headers = {},
    ) => {
      let response;
      const route = createModRoute({
        mods,
        readJsonBody: async () => body,
        sendJson: (_r, status, b) => {
          response = { status, body: b };
        },
      });
      const res = {
        writeHead(status) {
          this.status = status;
        },
        end(payload) {
          response = { status: this.status, body: JSON.parse(String(payload)) };
        },
      };
      await route({
        req: { method, headers, burrowVerifiedAuth: auth },
        res,
        url: new URL(`http://fixture/api/mods/goblin-secret-store${p}`),
      });
      return response;
    };
    let asset;
    await createModRoute({ mods })({ req: { method: 'GET' }, res: { writeHead(status) { assert.equal(status, 200); }, end(body) { asset = String(body); } }, url: new URL('http://fixture/api/mods/goblin-secret-store/ui/archive.js') });
    assert.match(asset, /export function mountArchive/);
    assert.equal(modCatalog(mods)[0].ui.archiveUrl, '/api/mods/goblin-secret-store/ui/archive.js');
    assert.equal(modCatalog(mods)[0].ui.controlUrl, undefined);
    assert.equal((await http('GET', '/audit')).status, 401);
    assert.equal((await http("GET", "/records")).status, 401);
    const races = await Promise.all([
      http("POST", "/bootstrap", { password: "fixture-password-long" }),
      http("POST", "/bootstrap", { password: "fixture-password-long" }),
    ]);
    assert.deepEqual(races.map((x) => x.status).sort(), [200, 409]);
    const boot = races.find((x) => x.status === 200);
    const headers = { "x-gss-session": boot.body.session };
    assert.equal(
      (await http("GET", "/records", {}, undefined, headers)).status,
      200,
    );
    const created = await http(
      "POST",
      "/records",
      {
        name: "fixture",
        template: "token",
        fields: [
          {
            name: "token",
            type: "token",
            protected: true,
            value: "integration-fixture-value",
          },
        ],
        acl: { mode: "agents", agents: ["one"], active: true },
      },
      undefined,
      headers,
    );
    assert.equal(created.status, 200);
    const audit = await http('GET', '/audit?limit=1', {}, undefined, headers);
    assert.equal(audit.status, 200); assert.equal(audit.body.events.length, 1);
    assert.ok(audit.body.nextCursor);
    const earlier = await http('GET', `/audit?before=${audit.body.nextCursor}&limit=1`, {}, undefined, headers);
    assert.equal(earlier.status, 200); assert.ok(earlier.body.events[0].id < audit.body.events[0].id);
    assert.equal((await http('GET', '/audit?date=invalid', {}, undefined, headers)).status, 400);
    assert.equal((await http('GET', '/audit?date=1900-01-01', {}, undefined, headers)).body.events.length, 0);

    const record = created.body.record;
    grants = app.stores.mcp;
    for (const id of ["one", "two"])
      await app.stores.agents.create({ id, name: id });
    const provider = "mod.goblin-secret-store";
    const caps = await loadRuntimeMcpCapabilities({ stores: app.stores, agentId: "one" });
    const other = await loadRuntimeMcpCapabilities({ stores: app.stores, agentId: "two" });
    assert.equal((await grants.agentTools("one")).length, 0);
    assert.equal((await grants.agentTools("two")).length, 0);
    assert.equal(mcpProvidersReceipt({ connections: caps.mcpConnections, grants: caps.mcpTools }).providers.find(p => p.id === provider).grantedToolCount, 3);
    assert.deepEqual(mcpCapabilitiesReceipt({ connections: caps.mcpConnections, grants: caps.mcpTools, provider }).tools.map(t => t.granted), [true, true, true]);
    const connection = grantedMcpTool({ connections: caps.mcpConnections, grants: caps.mcpTools, provider, toolName: "gss_use" }).connection;
    assert.ok(connection);
    const execute = (agentId, capabilities, tool, args = {}, context = {}) => executeReviewedProposalActions({
      agentId, sessionId: 's', conversationId: 'c', executionContext: { stores: app.stores, ...capabilities, agentId, conversationId: 'c', protectedValues: new Map(), ...context },
      actions: [{ index: 0, tool: 'mcp_call', mcpProvider: provider, mcpToolName: tool, mcpArguments: args }],
      reviews: [{ index: 0, status: 'allowed' }],
    });
    const ownList = await execute('one', caps, 'gss_list');
    assert.deepEqual(ownList.nativeToolResults[0].output.records.map(r => r.id), [record.id]);
    const hidden = await execute('two', other, 'gss_list');
    assert.deepEqual(hidden.nativeToolResults[0].output.records, []);
    for (const tool of ['gss_read', 'gss_use']) {
      const args = tool === 'gss_use' ? { id: record.id, field: 'token' } : { id: record.id };
      const denial = await execute('two', other, tool, args);
      assert.equal(denial.nativeToolResults[0].ok, false);
      assert.equal(JSON.stringify(denial).includes('integration-fixture-value'), false);
    }
    const use = await execute('one', caps, 'gss_use', { id: record.id, field: 'token' });
    assert.equal(use.nativeToolResults[0].ok, true);
    assert.equal(use.nativeToolResults[0].protection.status, 'protected');
    assert.equal((await grants.agentTools('one')).length, 0);
    const caller = { agentId: "one", sessionId: "s", conversationId: "c" };
    await assert.rejects(
      connection.invoke(
        "gss_use",
        { id: record.id, field: "token", agentId: "two" },
        { context: caller },
      ),
      (error) => error.code === "mod_route_failed" && error.statusCode === 400,
    );
    const raw = await connection.invoke(
      "gss_use",
      { id: record.id, field: "token" },
      { context: caller },
    );
    const registry = new Map();
    const protectedResult = protectToolOutput(raw, {
      registry,
      managedIssuer: (d) => ({
        managed: true,
        caller,
        reference: d.reference,
        version: d.version,
        resolve: (ref, c) =>
          connection.resolveProtectedReference("gss_use", ref, c),
      }),
    });
    assert.equal(
      JSON.stringify(protectedResult).includes("integration-fixture-value"),
      false,
    );
    const bindings = { FIXTURE: protectedResult.protectedValues[0].ref };
    const authorize = async () => {
      const c = await loadRuntimeMcpCapabilities({ stores: app.stores, agentId: "one" });
      return !grantedMcpTool({
        connections: c.mcpConnections,
        grants: c.mcpTools,
        provider,
        toolName: "gss_use",
      }).error;
    };
    let consumed = await resolveManagedProtectedBindings(bindings, registry, {
      caller,
      authorize,
    });
    assert.equal(consumed.env.FIXTURE, "integration-fixture-value");
    consumed = await resolveManagedProtectedBindings(bindings, registry, {
      caller,
      authorize,
    });
    assert.equal(consumed.env.FIXTURE, "integration-fixture-value");
    await pool.query("UPDATE mcp_connections SET enabled=FALSE WHERE id=$1", [provider]);
    consumed = await resolveManagedProtectedBindings(bindings, registry, { caller, authorize });
    assert.equal(consumed.errors.length, 1);
    const disabled = await execute("one", caps, "gss_read", { id: record.id });
    assert.equal(disabled.nativeToolResults[0].ok, false);
    await pool.query("UPDATE mcp_connections SET enabled=TRUE WHERE id=$1", [provider]);
    assert.equal(
      (
        await http(
          "PUT",
          `/records/${record.id}/acl`,
          {
            version: record.version,
            acl: { mode: "none", agents: [], active: true },
          },
          undefined,
          headers,
        )
      ).status,
      200,
    );
    consumed = await resolveManagedProtectedBindings(bindings, registry, {
      caller,
      authorize,
    });
    assert.equal(consumed.errors.length, 1);
    assert.equal(
      (
        await http(
          "GET",
          "/records",
          {},
          { enabled: true, authenticated: false },
          headers,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await http(
          "GET",
          "/records",
          {},
          { enabled: true, authenticated: true },
        )
      ).status,
      200,
    );
    assert.equal(
      (await http("GET", "/records", {}, undefined, headers)).status,
      401,
    );
    await cleanupMods(mods);
    mods = await loadMods({ runtimeRoot: root, ...modDependencies });
    assert.equal(mods[0]?.status, "loaded", mods[0]?.error);
    assert.equal(
      (
        await http(
          "GET",
          "/records",
          {},
          { enabled: true, authenticated: true },
        )
      ).body.records.length,
      1,
    );
  } finally {
    // Attempt every closer even when one fails; never leave the private server
    // running just because application cleanup rejected.
    const errors = [];
    for (const close of [() => cleanupMods(mods), () => app?.close(), () => pool?.end(), () => postgres.stop()]) {
      try { await close(); } catch (error) { errors.push(error); }
    }
    if (oldData === undefined) delete process.env.GSS_DATA_DIR;
    else process.env.GSS_DATA_DIR = oldData;
    if (oldKey === undefined) delete process.env.BURROW_SETTINGS_KEY;
    else process.env.BURROW_SETTINGS_KEY = oldKey;
    // Retain the owned directory if shutdown failed, for diagnosis/recovery.
    if (!errors.length) await rm(root, { recursive: true, force: true });
    else throw new AggregateError(errors, `integration fixture cleanup failed; retained ${root}`);
  }
});
