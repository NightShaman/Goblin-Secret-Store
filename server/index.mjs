import { Store, templates, fail } from "./store.mjs";
export function activate(context) {
  let limits = {};
  if (process.env.GSS_LIMITS_JSON) {
    try {
      limits = JSON.parse(process.env.GSS_LIMITS_JSON);
      for (const [k, v] of Object.entries(limits))
        if (
          ![
            "records",
            "fields",
            "valueBytes",
            "bodyBytes",
            "audit",
            "refs",
            "sessionMs",
            "refMs",
          ].includes(k) ||
          !Number.isSafeInteger(v) ||
          v < 1
        )
          throw Error();
    } catch {
      fail("invalid_limits", 500);
    }
  }
  const store = new Store({ limits });
  const route = (method, path, handler, publicRoute = false) =>
    context.api[method](path, async (req) => {
      try {
        if (
          Buffer.byteLength(JSON.stringify(req.body ?? {})) >
          store.limits.bodyBytes
        )
          fail("body_limit", 413);
        if (publicRoute) store.observe(req.auth);
        else store.require(req);
        return {
          status: 200,
          headers: { "cache-control": "no-store" },
          body: await handler(req),
        };
      } catch (e) {
        return {
          status: e.statusCode || 500,
          headers: { "cache-control": "no-store" },
          body: { error: e.statusCode ? e.message : "internal_error" },
        };
      }
    });
  route(
    "get",
    "/status",
    (r) => ({
      authMode: store.mode,
      initialized: !!store.config("password"),
      authenticated: store.authenticated(r),
    }),
    true,
  );
  route("post", "/bootstrap", (r) => store.login(r, true), true);
  route("post", "/login", (r) => store.login(r), true);
  route("post", "/logout", (r) => {
    store.sessions.delete(
      r.headers?.["x-gss-session"] || r.headers?.["X-GSS-Session"],
    );
    return { ok: true };
  });
  route("get", "/templates", () => ({ templates }));
  route("get", "/agents", () => context.agents.list());
  route("get", "/records", () => ({
    records: store.all().map((r) => store.view(r)),
  }));
  route("post", "/records", (r) => ({ record: store.put(r.body) }));
  route("get", "/records/:id", (r) => ({
    record: store.view(store.raw(r.params.id)),
  }));
  route("put", "/records/:id", (r) => ({
    record: store.put(r.body, r.params.id),
  }));
  route("put", "/records/:id/acl", (r) => ({
    record: store.setAcl(r.params.id, r.body),
  }));
  route("delete", "/records/:id", (r) =>
    store.remove(r.params.id, r.body?.version),
  );
  route("get", "/audit", (r) => store.auditPage(r.query));
  route("post", "/backup", (r) => store.backup(r.body?.passphrase));
  route("post", "/restore", (r) =>
    store.restore(r.body?.passphrase, r.body?.backup),
  );
  for (const action of ["list", "read", "use"])
    context.tools.register({
      name: `gss_${action}`,
      availability: "mod-authorized",
      description: `${action} authorized Goblin Secret Store records; protected values are managed runtime references, never plaintext.`,
      inputSchema: {
        type: "object",
        properties:
          action === "list"
            ? {}
            : {
                id: { type: "string" },
                ...(action === "use" ? { field: { type: "string" } } : {}),
              },
        required:
          action === "list" ? [] : action === "use" ? ["id", "field"] : ["id"],
        additionalProperties: false,
      },
      handler: (args, caller) => store.agent(action, args, caller),
      ...(action === "use"
        ? {
            resolveProtectedReference: (ref, caller) =>
              store.resolve(ref, caller),
          }
        : {}),
    });
  return () => store.close();
}
