# Let an agent use a credential



The enabled mod exposes provider `mod.goblin-secret-store` through Burrow's MCP tool discovery. An authorized agent uses:

1. `gss_list` to find the record ID and field names.
2. `gss_read {id}` when it needs the record's metadata and public fields.
3. `gss_use {id, field}` to request a protected field. Burrow returns an opaque `protected://` handle to the agent.
4. A compatible execution tool's `protectedBindings` to consume that handle. Current Core supports `shell_exec.protectedBindings`, mapping an environment-variable name to the returned handle.

For example, an agent can request the `token` field, bind its returned handle as `SERVICE_TOKEN`, and run an authorized program that reads that environment variable. It must use the returned handle unchanged, never put the secret in command text, and request a fresh handle if it expires. The default lifetime is 60 seconds.

GSS supplies protected values to compatible consumers; it does not automatically fill browser login forms. The receiving process or destination can access plaintext, so grant access only to agents and tasks you trust.


## Example task

Tell the agent which service and action you authorize, then ask it to find the credential with `gss_list`, request its protected field with `gss_use`, and pass the returned handle through `shell_exec.protectedBindings`. The program should read the corresponding environment variable. Do not ask the agent to print, echo, paste, or inspect that variable.

A handle is not a permanent credential. Keep it in the same agent, session, and conversation; request another when it expires. A compatible consumer must be available in your Burrow installation.

See [access control](access.md) before granting records and [security and trust](security.md) before using real credentials.
