import { createMergeableStore } from "tinybase";
import { createDurableObjectSqlStoragePersister } from "tinybase/persisters/persister-durable-object-sql-storage";
import { WsServerDurableObject } from "tinybase/synchronizers/synchronizer-ws-server-durable-object";
import { MAX_CLOCK_SKEW_SECONDS } from "../../src/shared/sync";

/**
 * Midad's sync server: one Durable Object per user holds that user's MergeableStore in its SQLite
 * storage and relays changes between their devices. The Worker checks the bearer token before the
 * WebSocket upgrade and routes to the user's Durable Object by a path it chooses itself.
 */

interface Env {
  MIDAD_SYNC: DurableObjectNamespace<MidadSync>;
  /** JSON object from the SHA-256 hex of each device token to its user id. A secret (`wrangler secret put SYNC_TOKENS`), never a [vars] entry. */
  SYNC_TOKENS: string;
}

const USER_HEADER = "x-midad-user";

export class MidadSync extends WsServerDurableObject<Env> {
  createPersister() {
    // The same unlimited skew as the clients: with TinyBase's default, a device more than five
    // minutes fast would have its edits silently dropped here.
    return createDurableObjectSqlStoragePersister(createMergeableStore(undefined, undefined, MAX_CLOCK_SKEW_SECONDS), this.ctx.storage.sql, { mode: "fragmented" });
  }

  authorize(pathId: string, request: Request) {
    return pathId !== "" && request.headers.get(USER_HEADER) === pathId ? {} : undefined;
  }
}

const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");

const userFor = async ({ request, env }: { request: Request; env: Env }): Promise<string | null> => {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return null;
  const users = JSON.parse(env.SYNC_TOKENS || "{}") as Record<string, string>;
  return users[await sha256(token)] ?? null;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const userId = await userFor({ request, env });
    if (!userId) return new Response("Unauthorized", { status: 401 });
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket upgrade", { status: 426 });
    const url = new URL(request.url);
    url.pathname = `/${encodeURIComponent(userId)}`;
    const forwarded = new Request(url, request);
    forwarded.headers.set(USER_HEADER, userId);
    forwarded.headers.delete("authorization");
    return env.MIDAD_SYNC.get(env.MIDAD_SYNC.idFromName(userId)).fetch(forwarded);
  },
};
