// "Ask Claude" for the Crabbe Construction & Design site: a small Cloudflare Worker that sits
// between the chat page and the Claude API.
//
// It holds the Anthropic API key, and fixes the model, effort, instructions and tools. It never
// touches the site's repo: reading files and publishing happen in the browser, with the signed-in
// person's own GitHub access. It answers only people who can write to the repo (src/access.js).

import Anthropic from "@anthropic-ai/sdk";
import { canPush } from "./access.js";
import { SYSTEM, TOOLS, VERSION } from "./prompt.js";

const MAX_BODY = 12_000_000;  // characters of JSON; room for a conversation with a few rounds of small photo copies
const MAX_TOKENS = 64_000;    // room for Fable's thinking plus a rewritten file; streamed, so no HTTP timeout
const PING_MS = 15_000;       // keeps the connection to the browser alive while Claude thinks

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return undefined;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const json = (body, status, headers = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

const bearer = (request) => (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");

// Turn an SDK error into something the chat page can explain in plain words.
function describe(err) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { error: "key" };
  }
  if (err instanceof Anthropic.RateLimitError) return { error: "busy" };
  if (err instanceof Anthropic.BadRequestError) return { error: "rejected", detail: err.message };
  if (err instanceof Anthropic.APIError) {
    return { error: (err.status ?? 500) >= 500 ? "busy" : "rejected", detail: err.message };
  }
  return { error: "failed", detail: String(err?.message ?? err) };
}

async function chat(request, env, ctx, headers) {
  if (!headers) return json({ error: "origin" }, 403);
  const token = bearer(request);
  if (!token) return json({ error: "signin" }, 401, headers);
  if (!(await canPush(token, env.REPO))) return json({ error: "access" }, 403, headers);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "off" }, 503, headers);

  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: "long" }, 413, headers);
    body = JSON.parse(text);
  } catch {
    return json({ error: "request" }, 400, headers);
  }
  if (body?.version !== VERSION) return json({ error: "updated", version: VERSION }, 409, headers);
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ error: "request" }, 400, headers);
  }

  // The reply is a stream of JSON lines: {type: "ping"} while waiting, {type: "text"} as Claude
  // writes, then one {type: "message"} (or {type: "error"}) at the end.
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let stream;
  const send = async (line) => {
    try {
      await writer.write(encoder.encode(JSON.stringify(line) + "\n"));
    } catch {
      stream?.abort();          // the browser went away: stop paying for the reply
    }
  };

  const work = (async () => {
    const ping = setInterval(() => send({ type: "ping" }), PING_MS);
    try {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      stream = client.beta.messages.stream({
        model: env.MODEL,
        max_tokens: MAX_TOKENS,
        output_config: { effort: env.EFFORT },
        // If a safety filter declines a request, let the API retry it on a fallback model
        // inside the same call instead of failing.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        cache_control: { type: "ephemeral" },
        system: SYSTEM,
        // No eager_input_streaming: nothing here shows tool input as it is written, and buffered
        // inputs arrive already validated and cost this Worker far less CPU to parse.
        tools: TOOLS,
        // Sent back exactly as the page received them (thinking blocks included) and only ever
        // appended to: Fable rejects a conversation whose earlier turns were edited.
        messages: body.messages,
      });
      stream.on("text", (delta) => send({ type: "text", delta }));
      const message = await stream.finalMessage();
      console.log(JSON.stringify({ model: message.model, stop: message.stop_reason, usage: message.usage }));
      await send({
        type: "message",
        version: VERSION,
        message: {
          content: message.content,
          stop_reason: message.stop_reason,
          stop_details: message.stop_details ?? null,
          model: message.model,
          usage: message.usage,
        },
      });
    } catch (err) {
      console.log(JSON.stringify({ failed: String(err?.message ?? err) }));
      await send({ type: "error", ...describe(err) });
    } finally {
      clearInterval(ping);
      await writer.close().catch(() => {});
    }
  })();
  ctx.waitUntil(work);

  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", ...headers },
  });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const headers = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers ?? {} });

    // Is the assistant switched on? Says nothing about who is asking.
    if (request.method === "GET" && pathname === "/status") {
      return json({ ready: Boolean(env.ANTHROPIC_API_KEY), version: VERSION }, 200, headers);
    }

    // May this signed-in person use it? Costs nothing: Claude is not called.
    if (request.method === "GET" && pathname === "/access") {
      if (!headers) return json({ error: "origin" }, 403);
      const allowed = await canPush(bearer(request), env.REPO);
      return json({ allowed, ready: Boolean(env.ANTHROPIC_API_KEY), version: VERSION }, 200, headers);
    }

    if (request.method === "POST" && pathname === "/chat") return chat(request, env, ctx, headers);

    return new Response("", { status: 404 });
  },
};
