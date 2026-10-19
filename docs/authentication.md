# Operator authentication

### Three separate secrets

- **Local management password:** authenticates operators when Burrow authentication is disabled. It does not derive or unlock the encryption key. There is currently no password-change or reset UI/API.
- **Installation master key:** the random `master.key` file loaded when the mod starts. Keep it with the matching database for filesystem recovery.
- **Backup passphrase:** encrypts a portable backup independently of the local management password. Keep it separately from the archive; it cannot be recovered from the archive.

**Unlock vault** opens management access. Logging out or letting that session expire does not revoke agent access: granted agents remain governed by their record ACLs while the provider is available. To stop their access, change the ACL or disable the provider.

### Management sessions

When Burrow authentication is enabled, Core supplies verified operator authentication and only `authenticated: true` is accepted. API bearer tokens are not treated as operators.

When Burrow authentication is disabled, the first browser visitor can create a local vault password. This bootstrap is safe only on a trusted network: isolate the service until the intended operator claims it. Local passwords use a random salt and scrypt (`N=32768`, `r=8`, `p=1`, 32-byte output). Sessions use 256-bit random tokens, stay in browser memory, and expire after one hour by default.

Logout, expiry, observed auth-mode changes, and host restart invalidate local sessions. Settings and Archive share the same memory-only session for a runtime/mod identity. Authentication loss also invalidates in-flight management loads and clears cached management metadata from mounted surfaces.

An authentication off/on round trip with no intervening mod request cannot be observed through the current Core contract. Restart the mod whenever changing Burrow authentication configuration to guarantee invalidation.

Use HTTPS. Never persist or log local session tokens, passwords, protected field drafts, or backup passphrases.
