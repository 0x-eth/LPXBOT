# E-API

The authenticated settings surface exposes exactly:

- `GET /api/settings/okx-key`
- `POST /api/settings/okx-key`
- `PUT /api/settings/okx-key`
- `DELETE /api/settings/okx-key`
- `POST /api/settings/okx-key/test`

GET requires the current session. Every mutation additionally requires `x-lpbot-reauthentication`, the dedicated `application/vnd.lpbot.okx-key-secret+json` media type, and an 8 KiB maximum body. Fastify parses this media type directly to a `Buffer`; the ordinary JSON parser and request logger never inspect it. API and connector buffers are zeroed in `finally`, and all responses use `Cache-Control: no-store`.

Save accepts only the exact complete `apiKey`, `secretKey`, and `passphrase` tuple. Replace, delete, and test require `expectedVersion`; a stale version returns 409. The only credential projection is `{ configured, version, status }`. Provider headers, body, signature input, error body, credential fragments, hashes, fingerprints, and masked values are absent from success and error responses.

The API, remote-client, and isolated HTTP boundary tests use synthetic credentials and local connector fixtures. Real OKX requests: 0.
