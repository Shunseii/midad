# midad-sync

Midad's sync server: a Cloudflare Worker and one TinyBase Durable Object per user. The Worker checks the device's bearer token before the WebSocket upgrade and routes the connection to that user's Durable Object, which keeps the user's store in its SQLite storage and relays changes between their devices.

## Production

| What | Where |
|---|---|
| Worker | `midad-sync` on the owner's personal Cloudflare account, at `https://midad-sync.khan-sufyan-cs.workers.dev` |
| Device token | 1Password, personal account (`my.1password.com`), vault **Midad Reader**, item **Midad sync**: `credential` is the token, `hostname` is the server address |
| `SYNC_TOKENS` | Worker secret on `midad-sync` (Cloudflare dashboard → Workers → midad-sync → Settings → Variables and Secrets). It maps the SHA-256 of that token to the user id `sufyan` |

The user id names the Durable Object that holds that user's data (`idFromName`). Never change it: a new id is a new, empty store.

To connect a device, open Settings → Devices and paste the address and token from the 1Password item.

To replace the token, generate a new one, update the 1Password item, and run `wrangler secret put SYNC_TOKENS` with the new hash mapped to `sufyan`. Devices using the old token show "Sign-in refused" until they get the new one. Secrets can't be read back from Cloudflare, so 1Password is the only copy of the token.

Deploy changes with `pnpm wrangler deploy` from this folder.

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

Point the app at it from Settings → Devices, or with `MIDAD_SYNC_URL=ws://localhost:8787/sync` and `MIDAD_SYNC_TOKEN=<token>` in the app's environment (these override Settings).

## Checks

From the repository root, `pnpm build && pnpm build:cli && pnpm test:sync` starts this server under `wrangler dev` and runs two app profiles against it.
