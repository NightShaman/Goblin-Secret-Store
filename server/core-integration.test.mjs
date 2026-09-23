import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
// Actual sibling core, not a mock host. Override to a separate checkout if needed.
const core = process.env.BURROW_CORE_ROOT || path.resolve("../Burrow-Backend");
const { loadMods, cleanupMods, createModRoute } = await import(
  `${core}/src/mod-runtime.mjs`
);
const { McpSettingsStore } = await import(`${core}/src/mcp-settings-store.mjs`);
const { loadRuntimeMcpCapabilities } = await import(
  `${core}/src/runtime-capability-context.mjs`
);
const { grantedMcpTool } = await import(`${core}/src/mcp-menu.mjs`);
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
  await writeFile(
    path.join(dir, "burrow.mod.json"),
    JSON.stringify({
      id: "goblin-secret-store",
      name: "GSS",
      server: "server/index.mjs",
    }),
  );
  const oldData = process.env.GSS_DATA_DIR,
    oldKey = process.env.BURROW_SETTINGS_KEY;
  process.env.GSS_DATA_DIR = path.join(root, "durable");
  const key = Buffer.alloc(32, 42);
  process.env.BURROW_SETTINGS_KEY = key.toString("base64");
  const databasePath = path.join(root, "core.sqlite");
  let mods = [];
  let grants;
  try {
    mods = await loadMods({ runtimeRoot: root, databasePath });
    assert.equal(mods[0].status, "loaded");
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
    const record = created.body.record;
    grants = new McpSettingsStore({ databasePath, key });
    for (const id of ["one", "two"])
      grants.db
        .prepare(
          "INSERT INTO agents(id,name,enabled,available_capabilities,context_config_json,created_at,updated_at) VALUES(?,?,1,'[]','{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        )
        .run(id, id);
    const provider = "mod.goblin-secret-store";
    let caps = loadRuntimeMcpCapabilities({ databasePath, agentId: "one" });
    assert.equal(
      grantedMcpTool({
        connections: caps.mcpConnections,
        grants: caps.mcpTools,
        provider,
        toolName: "gss_use",
      }).error,
      "mcp_tool_not_granted",
    );
    grants.setAgentTools("one", [
      { connectionId: provider, toolName: "gss_use" },
    ]);
    caps = loadRuntimeMcpCapabilities({ databasePath, agentId: "one" });
    const connection = grantedMcpTool({
      connections: caps.mcpConnections,
      grants: caps.mcpTools,
      provider,
      toolName: "gss_use",
    }).connection;
    const caller = { agentId: "one", sessionId: "s", conversationId: "c" };
    const raw = await connection.invoke(
      "gss_use",
      { id: record.id, field: "token", agentId: "two" },
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
    const authorize = () => {
      const c = loadRuntimeMcpCapabilities({ databasePath, agentId: "one" });
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
    grants.setAgentTools("one", []);
    consumed = await resolveManagedProtectedBindings(bindings, registry, {
      caller,
      authorize,
    });
    assert.equal(consumed.errors.length, 1);
    grants.setAgentTools("one", [
      { connectionId: provider, toolName: "gss_use" },
    ]);
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
    mods = await loadMods({ runtimeRoot: root, databasePath });
    assert.equal(mods[0].status, "loaded");
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
    grants?.close();
    await cleanupMods(mods);
    if (oldData === undefined) delete process.env.GSS_DATA_DIR;
    else process.env.GSS_DATA_DIR = oldData;
    if (oldKey === undefined) delete process.env.BURROW_SETTINGS_KEY;
    else process.env.BURROW_SETTINGS_KEY = oldKey;
    await rm(root, { recursive: true, force: true });
  }
});
