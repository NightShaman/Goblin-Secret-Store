# Configuration

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
