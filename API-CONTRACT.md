# Goblin Secret Store v1 API (UI contract)

Base `/api/mods/goblin-secret-store`. JSON requests/responses. Never log bodies or retain passwords, protected field inputs, session tokens or backup passphrases in persistent browser storage. Use `X-GSS-Session` for local sessions (core forwards this header). Core authenticated operators need no local session. Errors: `{error: "opaque_code"}` with 400/401/403/409/413/429.

## Authentication

- GET `/status` → `{authMode:"core"|"local", initialized:boolean, authenticated:boolean}`; no secret metadata.
- POST `/bootstrap` `{password}` → `{session,expiresAt}`. Only auth-off, first visitor atomically claims local password on a trusted network. Minimum 12 characters. UI must explain trusted-network first-visitor claim.
- POST `/login` `{password}` → `{session,expiresAt}`; local mode only.
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

`Record={id,name,template,version,fields,acl}`. `fields=[{name,type,protected,value?}]`; types `text`, `url`, `username`, `credential`, `secret`, `token`, `password`, `private-key`. Protected field values NEVER returned, only `hasValue:true`. During update omit `value` for an unchanged protected field of the same name/type; public fields carry string values. All fields are strings. New records default denied. ACL is `{mode:"none"|"agents"|"all",agents:string[],active:boolean}`. UI must require explicit confirmation for `all`. One/several agents both use `agents` mode. Restored ACLs are `active:false` and must be explicitly reassigned via ACL endpoint; even matching agent IDs are inactive. Each mutation increments version, revoking issued references.

## Audit and portability

- GET `/audit` → `{events:[{id,at,action,outcome,agentId,recordId}]}` newest first; no values/names/passwords.
- POST `/backup` `{passphrase}` → `{backup:string}` encrypted portable JSON string. Download without logging; minimum 12 chars.
- POST `/restore` `{passphrase,backup}` → `{ok:true,restored:number}`. Destructively replaces records after complete validation, clears references, restores all ACLs inactive. Requires explicit UI confirmation. Current installation management password stays unchanged. Backup includes all required encryption material and works on clean installations after management bootstrap.

## Agent tools

`gss_list`, `gss_read {id}`, `gss_use {id,field}`. Only authorized metadata/public fields; protected use returns `$burrowManaged`, never plaintext. Agent identity comes solely from runtime caller context, never arguments. Core tool grants are required in addition to record ACL.
