# midad-sync

Midad's sync server: a Cloudflare Worker and one TinyBase Durable Object per user. The Worker checks the device's bearer token before the WebSocket upgrade and routes the connection to that user's Durable Object, which keeps the user's store in its SQLite storage and relays changes between their devices.

It has only been run locally so far.

## Tokens

`SYNC_TOKENS` is a JSON object from the SHA-256 (hex) of each device token to its user id. This example maps the token `test` to the user `me`:

```json
{ "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08": "me" }
```

Only hashes are configured, so the configuration holds no usable token. Hash a new token with:

```sh
printf %s "$TOKEN" | sha256sum
```

`SYNC_TOKENS` is a secret: keep it out of `wrangler.toml` (no `[vars]`).

- **Deployed:** set it with `wrangler secret put SYNC_TOKENS` and paste the JSON when asked.
- **Local:** put `SYNC_TOKENS='{"<hash>":"me"}'` in `.dev.vars` (ignored by git), or pass `--var 'SYNC_TOKENS:{"<hash>":"me"}'` to `wrangler dev`, as `pnpm test:sync` does.

## Running it locally

```sh
pnpm install
pnpm dev            # wrangler dev, on http://localhost:8787
```

Point the app at it with `MIDAD_SYNC_URL=ws://localhost:8787/sync` and `MIDAD_SYNC_TOKEN=<token>` in the app's environment. There is no settings UI for sync yet.

## Checks

From the repository root, `pnpm build && pnpm build:cli && pnpm test:sync` starts this server under `wrangler dev` and runs two app profiles against it.
