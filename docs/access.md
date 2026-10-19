# Control agent access

Open **Settings → Goblin Secret Store → Agent sharing**, choose the credential, set **Access scope**, and select **Save access**. For restored assignments the button is **Regrant access**.


Each record has an ACL with one of three modes:

- **Nobody** — no agent can access the record.
- **Selected agents** — only the named agents can access it.
- **All agents** — every current and future agent can access it. Selecting this mode and saving is the explicit grant; there is no second confirmation dialog.

Agent identity comes only from Burrow's verified caller context, never from tool arguments. The tools are registered as `mod-authorized`, so their record ACL—not a stored per-agent MCP grant—is authoritative. To revoke access, change the record ACL or disable the provider.

References are bound to the exact agent, session, conversation, record version, and field. Editing a record, restoring a backup, revoking its ACL, disabling the provider, expiry, or restart invalidates relevant references. A grant cannot restrict where an authorized consumer sends the value, and revocation cannot retract plaintext already delivered.

Public fields, credential names, and ACL metadata are intentionally unencrypted. Never place secrets in them.


!!! warning "All agents includes future agents"
    Saving this scope is the grant. There is no second confirmation dialog. Prefer Selected agents and review permissions whenever agents or their tasks change.

## Stop access

Set the record to **Nobody** and save, remove a selected agent and save, or disable the provider. Logging out of Settings does not stop granted agents. If a secret may already have escaped, revoke or rotate it with the service that issued it; a vault ACL cannot undo that disclosure.
