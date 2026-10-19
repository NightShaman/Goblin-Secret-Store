# Troubleshooting

- **An agent sees no records:** confirm the record is granted to that agent under **Agent sharing**. Restored assignments require **Regrant access**.
- **The tools are unavailable:** check that the mod and its provider are enabled in the Burrow server runtime. Creating a separate HTTP MCP connection is not required.
- **A protected handle is rejected:** obtain a fresh one in the same agent/session/conversation. Check the record's current ACL and provider availability; edits and restores invalidate older handles.
- **`version_conflict`:** reload the current record before editing again; another change or restore made the displayed version stale.
- **`storage_key_missing` or `storage_key_invalid`:** preserve the existing files and follow [Backups and recovery](backup.md).
- **`backup_limit` or `body_limit`:** check the configured limits and any smaller host/proxy limit. Do not modify or truncate a backup archive.


## Cannot claim or unlock the vault

With Burrow authentication enabled, sign in as an operator; an API bearer token is not an operator session. With authentication disabled, use the local management password. There is no password-change or reset UI/API. The local password cannot recover a lost master key.

The login-attempt limit is global: at most ten attempts per rolling minute. If `rate_limited` appears, stop retrying and wait before trying again. `session_limit` means the live local-session cap was reached; allow sessions to expire or plan a mod restart, which also invalidates live handles.

## Restore reports invalid_backup

Check that the file is an unchanged GSS export and the passphrase is correct. A malformed archive, unsupported content, or records exceeding the destination’s limits also fail validation. Preserve the original backup and do not hand-edit it. The restore validates all records before replacing the vault.

## Vault unavailable or stale form

Use **Retry** after resolving the underlying service/authentication problem. Reload a stale record after `version_conflict`; do not blindly repeat the old edit. Check service logs for startup failures without pasting secrets, passwords, tokens, or backup bodies into an issue.

## Audit history

Open **Archive → MODS → Goblin Secret Store**. Audit events contain redacted actions and outcomes, agent IDs, record IDs, and public credential names for authorized events. The date filter uses UTC; pagination reaches older retained events. Default retention is 10,000 events. Portable backups do not carry audit history.

For help, use the [public issue tracker](https://github.com/GoblinKing-Burrow/Goblin-Secret-Store/issues) with versions, error codes, and redacted reproduction steps.
