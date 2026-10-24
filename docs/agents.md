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

## Operator credential references in Core settings

Current GSS also registers a `gss` credential-reference provider when the host exposes `context.secretReferences`. This is separate from the agent workflow above: a Core operator can choose an existing protected field in a compatible settings picker instead of pasting its value. Current Core uses this for HTTPS Git mod-source credentials; it is not a promise that every password field or browser login supports GSS.

The picker receives a reference and descriptive metadata, not the protected value. References have the form `{{gss:record-id/encoded-field-name}}`; use the picker rather than constructing one or copying a secret into the reference. Core resolves the selected field through the loaded provider when it needs the credential. Keep GSS installed/enabled and the referenced record/field available. A missing provider or removed/renamed field can make later source fetches fail.

A saved operator reference is not the short-lived `protected://` handle returned by `gss_use`; do not interchange them or assume the agent handle's lifetime/caller binding applies to an operator settings reference. This integration requires both the updated GSS and compatible Core. See [mod-source setup](https://burrow-docs.blissful-psychosis.com/burrow/guide/tools-and-mods/) for the consuming UI.
