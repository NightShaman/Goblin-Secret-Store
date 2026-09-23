# Goblin Secret Store

Burrow mod providing an operator-managed encrypted credential vault and explicit per-record agent access. No OAuth, sync, or automatic rotation. See [API-CONTRACT.md](API-CONTRACT.md) for UI integration.

## Storage and installation lifecycle

Requires Node **22.13+** (`node:sqlite`; tested on 22.23.2 and 24.20.0). No npm runtime dependencies.

The vault lives at **`$BURROW_RUNTIME_ROOT/mods/mod-data/goblin-secret-store`** when the runtime root is configured (stock container: `/data/mods/mod-data/goblin-secret-store`, on its existing persistent `/data` volume). Otherwise it falls back to `$HOME/.local/share/goblin-secret-store`, not the mod source tree. Set absolute `GSS_DATA_DIR` in the Burrow service environment to relocate it. The directory is mode 0700; `vault.sqlite` and the independent random 32-byte `master.key` are mode 0600. SQLite DELETE journal mode avoids a persistent WAL; protected values are encrypted before reaching SQLite. No core settings/secrets API or core key is used by the vault. Core still owns agent-tool catalog/grants, as required by its bridge.

Integration prerequisite: core mod discovery must reserve/skip `mods/mod-data` rather than cataloging it as a failed mod without a manifest. The current core discovery does not yet do this.

Core `src/mod-distribution.mjs` `swapMod` renames/replaces the complete source directory and deletes its backup after successful activation. Uninstall removes that source directory. Neither touches this separate vault directory: upgrade/re-enable/restart retain records; uninstall intentionally retains the vault. To erase permanently, stop the mod and explicitly delete the vault directory. Do not put `GSS_DATA_DIR` under any source installation directory. Containers **must mount the vault directory on a persistent volume** (or mount the containing home); source-upgrade independence does not imply container filesystem durability. Do not run multiple Burrow instances against the same vault. The OS service account and machine administrator can read the key and DB; this is not protection against host compromise.

Missing key with an existing database fails closed. Preserve both files for filesystem recovery. Prefer portable backups: passphrase-encrypted export includes source key and encrypted records, validates and decrypts everything before one SQLite replacement transaction, then re-encrypts under the destination key. Restore does not replace local management credentials. All restored ACLs are inactive—even matching IDs—and require the ACL reassignment operation. Export excludes local password hashes, sessions, audit, and live references.

## Authentication and access

Core routes provide trusted `{enabled,authenticated}` from verified operator auth. Only `authenticated:true` is accepted in core mode; API bearer tokens are not operators. When core authentication is disabled, the first browser visitor may set a >=12-character mod password. **This approved bootstrap assumes a trusted network: isolate the service until the intended operator claims it.** No CLI setup is necessary. Passwords use random salt and scrypt (N=32768,r=8,p=1, 32 bytes); bootstrap uses an immediate SQLite transaction and sessions use 256-bit random tokens. Sessions are memory-only, expire after one hour, and are invalidated on observed auth-mode transitions or host restart. An auth on/off round-trip with no intervening mod request cannot be observed by this core contract; restart the mod when changing auth configuration to guarantee invalidation in that case.

Use HTTPS. Local session tokens belong in memory, never localStorage or logs. All management routes including audit/export/restore are gated. No endpoint reveals protected field plaintext to the browser, including after creation. To change a protected value, replace it; omit the value to preserve it on edit. Public fields and names are intentionally unencrypted metadata: never put secrets there. Agent responses exclude ACL lists.

Each protected field uses AES-256-GCM, random 96-bit nonce, and AAD binding record ID/version/field name/type/protection. Agent identity comes only from core caller context. Default record ACL is deny; explicit one/several/all grants are independent of core MCP grants. Agent tools issue opaque references, not decrypted values. Consumption rechecks exact agent/session/conversation, version, expiry, and live ACL. Core also checks live tool grants and provider availability. Mutations revoke references by version; restart discards them. Auditing records redacted issuance/use/denial identifiers and management mutations, never field names/values or passwords.

## Limits and tests

Defaults: 1000 records, 64 fields/record, 64 KiB/field, 16 MiB request/export input, 10000 retained audit events, 10000 live references (60s), 256 live sessions (1h), 10 password attempts/minute globally, audit reads newest 1000. `GSS_LIMITS_JSON` can override positive integer `records`, `fields`, `valueBytes`, `bodyBytes`, `audit`, `refs`, `sessionMs`, `refMs`. Defaults constrain child memory, synchronous SQLite/scrypt work, IPC payloads and audit growth. Core HTTP/IPC limits may be smaller and remain authoritative. Large vault exports can exceed core IPC limits; keep practical v1 vaults small. Password attempt limits are deliberately global to avoid trusting spoofable client-IP headers; hostile visitors can temporarily deny login. Backup/restore scrypt is authenticated and synchronous, so large exports temporarily block this mod host. No background expiry worker or password recovery/change API in v1. Lost local password recovery requires an authenticated core operator or offline administrator recovery; backups never export it.

```sh
npm run build
npm test
npx --yes --package=node@22 node --test server/*.test.mjs ui/*.test.mjs
```

Integration tests import the actual sibling `../Burrow-Backend` (override `BURROW_CORE_ROOT`), copy only test mod code to a temporary runtime, load real child IPC, route requests with verified auth, exercise forwarded session headers, core grants, managed consumption/revocation, and reload persistence. They create only temporary databases and synthetic fixtures, never live credentials. Unit tests cover encryption/tamper binding, stale versions, auth transitions, atomic bootstrap, ACL denial, expiry, portable clean-install restore and transactional rejection. No core source changes are required.
