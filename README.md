<p align="center">
  <img src="docs/assets/hero.png" width="720" alt="Goblin Secret Store encrypted credential vault for Burrow" />
</p>

# Goblin Secret Store

Goblin Secret Store is a Burrow mod for keeping credentials encrypted at rest and granting agents explicit, record-level access without exposing protected values in the browser. Operators manage credentials, access lists, encrypted backups, and audit history from Burrow.

It is deliberately narrow: no cloud sync, OAuth brokerage, automatic rotation, or general-purpose password-manager features.

## Security at a glance

- Protected fields use AES-256-GCM with a random nonce and authenticated record/field binding.
- The vault database and its independent random 32-byte master key live outside the mod source directory.
- Protected values are never returned to the management UI after creation.
- Agents receive short-lived, caller-bound managed references rather than plaintext tool responses.
- Access is denied by default and granted per record to named agents or explicitly to all agents.
- Every protected-value use is rechecked against the current record version, caller, ACL, expiry, and provider availability.
- Management routes require an authenticated Burrow operator or, when Burrow authentication is disabled, a local vault session.
- Sensitive responses use `Cache-Control: no-store`; browser sessions remain memory-only.

Goblin Secret Store reduces accidental disclosure and limits agent access. It does **not** protect against a compromised host, Burrow service account, machine administrator, authorized consumer, or plaintext already delivered to its destination. Read [Threat model](#threat-model) before deployment.

## Install

### Requirements

- Burrow with Git mod-source support and generic `ui.archive` contributions
- Node.js **22.13 or newer** (`node:sqlite`); tested with Node 22.23.2 and 24.20.0
- Durable storage for the Burrow runtime or a dedicated `GSS_DATA_DIR`
- HTTPS and a trusted network boundary

Goblin Secret Store has no npm runtime dependencies.

### Add the mod to Burrow

1. Open **Settings → Mods → Mod sources**.
2. Add `https://github.com/GoblinKing-Burrow/Goblin-Secret-Store.git` as the Git repository URL.
3. Recheck the source and select **Goblin Secret Store** from the mod catalog.
4. Install a published version, then explicitly enable the mod. Installation alone does not enable it.
5. Open **Settings → Goblin Secret Store**.

Use a version tag for stable installations. Following `main` is appropriate only when you intentionally want unreleased changes.

## Quick start

1. Confirm the vault storage path is on durable storage. See [Storage and lifecycle](#storage-and-lifecycle).
2. Open **Settings → Goblin Secret Store**.
3. If Burrow authentication is enabled, your authenticated operator session is used automatically. If it is disabled, the first visitor must create a local password of at least 12 characters on a trusted, isolated network.
4. Create a credential from a template or define custom fields. Mark sensitive fields as protected.
5. Choose the record access policy: nobody, selected agents, or all agents. New records default to deny.
6. Save the record, then have an authorized agent use `gss_list`, `gss_read`, or `gss_use`.
7. Create an encrypted portable backup and complete a restore drill before relying on the vault.

Credential management and backup/restore live in Settings. Audit history lives in **Archive → MODS → Goblin Secret Store**.

## Access model

Each record has an ACL with one of three modes:

- **Nobody** — no agent can access the record.
- **Selected agents** — only the named agents can access it.
- **All agents** — every current and future agent can access it. Selecting this mode and saving is the explicit grant; there is no second confirmation dialog.

Agent identity comes only from Burrow's verified caller context, never from tool arguments. The tools are registered as `mod-authorized`, so their record ACL—not a stored per-agent MCP grant—is authoritative. To revoke access, change the record ACL or disable the provider.

The agent tools are:

- `gss_list` — list metadata and public fields for authorized records.
- `gss_read {id}` — read one authorized record without protected plaintext.
- `gss_use {id, field}` — issue a short-lived managed reference for an authorized protected field.

References are bound to the exact agent, session, conversation, record version, and field. Editing a record, restoring a backup, revoking its ACL, disabling the provider, expiry, or restart invalidates relevant references. A grant cannot restrict where an authorized consumer sends the value, and revocation cannot retract plaintext already delivered.

Public fields, credential names, and ACL metadata are intentionally unencrypted. Never place secrets in them.

## Backups and recovery

Settings can export a passphrase-encrypted portable backup containing all records and the source encryption material needed for a clean-install restore. The passphrase must be 12–1024 UTF-16 code units.

A restore:

- validates and decrypts the complete archive before changing the vault;
- replaces records in one SQLite transaction;
- re-encrypts protected values under the destination installation key;
- preserves the destination's local management password;
- excludes sessions, audit history, and live managed references; and
- restores every ACL as inactive, including ACLs whose agent IDs still exist.

After restoring, explicitly review and reassign every ACL. Keep the archive unchanged between export and restore, preserve its passphrase separately, and test recovery regularly.

For filesystem-level recovery, preserve **both** `vault.sqlite` and `master.key`. An existing database with a missing or invalid key fails closed.

## Storage and lifecycle

The default vault location is:

- `$BURROW_RUNTIME_ROOT/mods/mod-data/goblin-secret-store` when `BURROW_RUNTIME_ROOT` is configured;
- `/data/mods/mod-data/goblin-secret-store` in the stock container; or
- `$HOME/.local/share/goblin-secret-store` as the fallback.

Set `GSS_DATA_DIR` to an absolute path in the Burrow service environment to relocate it. Do not place it inside the mod source installation directory.

The vault directory is mode `0700`; `vault.sqlite` and `master.key` are mode `0600`. SQLite uses DELETE journal mode so there is no persistent WAL. Protected values are encrypted before being written to SQLite.

The data directory is separate from the installed mod source. Upgrade, re-enable, and restart retain it; uninstall intentionally leaves it behind. To erase the vault permanently, stop the mod and explicitly delete its data directory. Container deployments must place that directory—or its containing runtime root—on a persistent volume.

Do not run multiple Burrow instances against the same vault.

## Authentication

When Burrow authentication is enabled, Core supplies verified operator authentication and only `authenticated: true` is accepted. API bearer tokens are not treated as operators.

When Burrow authentication is disabled, the first browser visitor can create a local vault password. This bootstrap is safe only on a trusted network: isolate the service until the intended operator claims it. Local passwords use a random salt and scrypt (`N=32768`, `r=8`, `p=1`, 32-byte output). Sessions use 256-bit random tokens, stay in browser memory, and expire after one hour by default.

Logout, expiry, observed auth-mode changes, and host restart invalidate local sessions. Settings and Archive share the same memory-only session for a runtime/mod identity. Authentication loss also invalidates in-flight management loads and clears cached management metadata from mounted surfaces.

An authentication off/on round trip with no intervening mod request cannot be observed through the current Core contract. Restart the mod whenever changing Burrow authentication configuration to guarantee invalidation.

Use HTTPS. Never persist or log local session tokens, passwords, protected field drafts, or backup passphrases.

## Configuration

### `GSS_DATA_DIR`

Absolute vault data directory. Relative paths are rejected.

### `GSS_LIMITS_JSON`

A JSON object containing positive integers for any of:

| Key | Default | Purpose |
| --- | ---: | --- |
| `records` | 1,000 | Maximum stored records |
| `fields` | 64 | Maximum fields per record |
| `valueBytes` | 65,536 | Maximum UTF-8 bytes per field value |
| `bodyBytes` | 16 MiB | Maximum JSON request body and restore envelope |
| `audit` | 10,000 | Retained audit events |
| `refs` | 10,000 | Concurrent live managed references |
| `sessionMs` | 3,600,000 | Local session lifetime |
| `refMs` | 60,000 | Managed-reference lifetime |

Example service environment:

```dotenv
GSS_DATA_DIR=/srv/burrow/gss
GSS_LIMITS_JSON={"records":2000,"bodyBytes":33554432}
```

Set these variables on the Burrow service that hosts the mod. Invalid keys, non-integers, and values below 1 fail startup.

The host or reverse proxy may impose a smaller body limit. Configure it to accept at least `bodyBytes`, and do not raise the mod limit beyond the host's memory and IPC budget. Backup export checks the complete UTF-8 restore envelope—including JSON escaping and passphrase overhead—and fails instead of creating an archive that cannot be restored under the configured limit.

## Development

```sh
git clone https://github.com/GoblinKing-Burrow/Goblin-Secret-Store.git
cd Goblin-Secret-Store
npm run build
npm test
```

To verify the minimum supported Node line explicitly:

```sh
npx --yes --package=node@22 node --test server/*.test.mjs ui/*.test.mjs
```

The full integration suite imports a sibling Burrow Backend checkout by default. Override it with `BURROW_CORE_ROOT`. It requires the sibling Core dependencies plus PostgreSQL 17 with pgvector, runs only disposable fixtures over a private Unix socket, and fails rather than skips when prerequisites are missing. Override PostgreSQL binaries with `BURROW_POSTGRES_BIN_DIR` when they are not under `/usr/lib/postgresql/17/bin`.

See [API-CONTRACT.md](API-CONTRACT.md) for the browser/API contract and tool semantics.

## Threat model

Goblin Secret Store is designed to defend against:

- accidental disclosure of protected fields through the management UI or ordinary agent metadata reads;
- unauthorized agent access when record ACLs do not grant it;
- database-only theft when the independent master key is not also obtained;
- ciphertext or metadata tampering covered by AES-GCM authentication and field binding;
- stale managed references after mutation, restore, ACL change, provider loss, expiry, or restart; and
- accidental persistence of local browser sessions.

It does not defend against:

- compromise of the Burrow host, service account, process memory, master key, or machine administrator;
- a malicious or compromised operator;
- an authorized agent or destination mishandling plaintext after use;
- secrets placed in public fields, record names, logs, prompts, commands, or external systems;
- denial of service, including exhaustion of configured limits or the intentionally global login-attempt limit;
- loss of both the vault key and all usable encrypted backups; or
- concurrent access by multiple Burrow instances to the same vault directory.

Auditing records redacted issuance, use, denial, and management events. It never records protected values, passwords, or field names, but it does retain public credential names for authorized events. Treat the host, operators, authorized agents, and configured destinations as part of your trusted computing base.
