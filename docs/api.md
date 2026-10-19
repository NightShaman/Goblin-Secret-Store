# Goblin Secret Store v1 API (UI contract)

Base `/api/mods/goblin-secret-store`. JSON requests/responses. Never log bodies or retain passwords, protected field inputs, session tokens or backup passphrases in persistent browser storage. Use `X-GSS-Session` for local sessions (core forwards this header). Core authenticated operators need no local session. Errors: `{error: "opaque_code"}` with 400/401/403/409/413/429.

## Authentication

- GET `/status` → `{authMode:"core"|"local", initialized:boolean, authenticated:boolean}`; no secret metadata.
- POST `/bootstrap` `{password}` → `{session,expiresAt,expiresInMs}`. Only auth-off, first visitor atomically claims local password on a trusted network. Minimum 12 characters. UI must explain trusted-network first-visitor claim. Clients must derive their local expiry from `expiresInMs`; `expiresAt` is informational server time.
- POST `/login` `{password}` → `{session,expiresAt,expiresInMs}`; local mode only. Clients must not require synchronized server and browser clocks.
- POST `/logout` → `{ok:true}`.
  All following endpoints require management authentication. Session expires in one hour; mode changes clear local sessions. Keep token in memory.

## Records

- GET `/templates` → `{templates:[{id,fields:[{name,type,protected}]}]}`. IDs `token`, `id-secret`, `user-pass`, `ssh-key`, `custom`.
- GET `/agents` → core agent capability response (for explicit ACL assignment).
- GET `/records` → `{records:[Record]}`
- POST `/records` `{name,template,fields,acl?}` → `{record:Record}`
- GET `/records/:id` → `{record:Record}`
- PUT `/records/:id` `{version,name,template,fields,acl}` → `{record:Record}` (full replacement with optimistic version check)
- DELETE `/records/:id` `{version}` → `{ok:true}`
- PUT `/records/:id/acl` `{version,acl}` → `{record:Record}`

`Record={id,name,template,version,fields,acl}`. `fields=[{name,type,protected,value?}]`; types `text`, `url`, `username`, `credential`, `secret`, `token`, `password`, `private-key`. Protected field values NEVER returned, only `hasValue:true`. During update omit `value` for an unchanged protected field of the same name/type; public fields carry string values. All fields are strings. New records default denied. ACL is `{mode:"none"|"agents"|"all",agents:string[],active:boolean}`. Choosing `all` and Save is the explicit grant, with no second confirmation; it includes future agents. One/several agents both use `agents` mode. Restored ACLs are `active:false` and must be explicitly reassigned via ACL endpoint; even matching agent IDs are inactive. `version` is an opaque concurrency identity: return it unchanged on every edit/delete/ACL request, never parse or increment it. New writes use fresh UUID strings; existing legacy records may expose numeric versions until mutated. Every mutation and restore replaces the identity, revoking issued references. A stale identity returns 409 `version_conflict`, including across repeated restores and deleted/reintroduced IDs. Protected-field AAD binds that exact identity.

## Audit and portability

- GET `/audit?date=YYYY-MM-DD&before=ID&limit=100` → `{events:[{id,at,action,outcome,agentId,recordId,recordName}],nextCursor:string|null}` newest first. `recordName` is the public credential name snapshotted at event time; it is null on older events and events without a known authorized record. Never resolve a historical ID to the current name. All parameters optional; UTC date filter, exclusive ID cursor, page size 1–500. Follow `nextCursor` until null; no 1000-event truncation. No protected values, field names, or passwords. Mod retention remains 10,000 events. Management authentication is mandatory.
- POST `/backup` `{passphrase}` → `{backup:string}` encrypted portable JSON string. Download without logging; 12–1024 UTF-16 code units. The UTF-8 JSON restore envelope `{passphrase,backup}` must fit `bodyBytes` (default 16 MiB); export rejects with 413 `backup_limit` if it would not. This includes string escaping and the supplied passphrase overhead.
- POST `/restore` `{passphrase,backup}` → `{ok:true,restored:number}`. Destructively replaces records after complete validation, clears references, restores all ACLs inactive. Requires explicit UI confirmation. Current installation management password stays unchanged. Backup includes all required encryption material and works on clean installations after management bootstrap. Send the unchanged archive and passphrase without additional properties under the same limits; host/proxy request limits must also allow this body size. Older numeric-revision backups remain accepted.

## Agent tools

`gss_list`, `gss_read {id}`, `gss_use {id,field}`. Only authorized metadata/public fields; protected use returns `$burrowManaged`, never plaintext. Agent identity comes solely from runtime caller context, never arguments. These tools are `mod-authorized`: a live enabled provider is available without stored per-agent Core tool grants. The record ACL authorizes both issuance and consumption; removing a Core per-agent tool grant does not revoke access. Revoke the record ACL or disable the provider. Consumption rechecks caller tuple, exact record version, expiry, current ACL and live provider availability. Grants do not restrict destination/command/task and revocation cannot retract plaintext already delivered.
