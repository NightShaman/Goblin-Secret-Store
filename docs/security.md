# Security and trust

!!! danger "A credential grant is real access"
    GSS is not a security boundary against your host, administrators, or authorized consumers. Anyone with both the database and master key can decrypt protected values. A permitted process or destination receives plaintext and can leak it. Use narrowly scoped, revocable service credentials and grant only trusted agents.


- Protected fields use AES-256-GCM with a random nonce and authenticated record/field binding.
- The vault database and its independent random 32-byte master key live outside the mod source directory.
- Protected values are never returned to the management UI after creation.
- Agents receive short-lived, caller-bound managed references rather than plaintext tool responses.
- Access is denied by default and granted per record to named agents or explicitly to all agents.
- Every protected-value use is rechecked against the current record version, caller, ACL, expiry, and provider availability.
- Management routes require an authenticated Burrow operator or, when Burrow authentication is disabled, a local vault session.
- Sensitive responses use `Cache-Control: no-store`; browser sessions remain memory-only.

Goblin Secret Store reduces accidental disclosure and limits agent access. It does **not** protect against a compromised host, Burrow service account, machine administrator, authorized consumer, or plaintext already delivered to its destination. Read [Threat model](#threat-model) before deployment.


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
