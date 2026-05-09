import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { timingSafeEqual } from "node:crypto";
//#region src/auth.ts
const AUTH_SCHEME = "Bearer ";
function isLoopbackHost(host) {
	if (!host) return false;
	const normalized = host.split(":")[0].toLowerCase();
	return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "[::1]" || normalized === "::1";
}
function isAllowedOrigin(origin, allowedOrigins) {
	if (origin === null) return true;
	if (allowedOrigins.has(origin)) return true;
	try {
		const parsed = new URL(origin);
		const withoutPort = `${parsed.protocol}//${parsed.hostname}`;
		return isLoopbackHost(parsed.hostname) && allowedOrigins.has(withoutPort);
	} catch {
		return false;
	}
}
function isAuthorized(authorization, token) {
	if (!authorization?.startsWith(AUTH_SCHEME)) return false;
	const candidate = authorization.slice(7);
	const candidateBuffer = Buffer.from(candidate);
	const tokenBuffer = Buffer.from(token);
	return candidateBuffer.length === tokenBuffer.length && timingSafeEqual(candidateBuffer, tokenBuffer);
}
//#endregion
//#region src/a2aHandlers.ts
async function healthHandler() {
	return {
		status: 200,
		body: { ok: true }
	};
}
async function listA2AAgentsHandler(_request, ctx) {
	return {
		status: 200,
		body: { agents: await ctx.listA2AAgents() }
	};
}
async function getA2AAgentCardHandler(request, ctx) {
	const recipient = extractA2AAgentRecipient(request.path);
	if (!recipient) return {
		status: 400,
		body: { error: "recipient is required" }
	};
	const card = await ctx.getA2AAgentCard(recipient);
	if (!card) return {
		status: 404,
		body: { error: `A2A agent not found: ${recipient}` }
	};
	return {
		status: 200,
		body: card
	};
}
async function registerA2AAgentCardHandler(request, ctx) {
	const body = typeof request.body === "object" && request.body !== null ? request.body : {};
	const card = isAgentCard(body.card) ? body.card : isAgentCard(body) ? body : null;
	if (!card) return {
		status: 400,
		body: { error: "valid agent card is required" }
	};
	const inboundAuth = isRemoteA2AAgentAuth(body.inboundAuth) ? body.inboundAuth : void 0;
	try {
		await ctx.registerA2AAgentCard(card, inboundAuth);
	} catch (error) {
		return {
			status: 400,
			body: { error: error instanceof Error ? error.message : String(error) }
		};
	}
	return {
		status: 200,
		body: {
			ok: true,
			agent: card
		}
	};
}
async function unregisterA2AAgentCardHandler(request, ctx) {
	const recipient = extractLastPathSegment(request.path);
	if (!recipient) return {
		status: 400,
		body: { error: "recipient is required" }
	};
	await ctx.unregisterA2AAgentCard(recipient);
	return {
		status: 200,
		body: { ok: true }
	};
}
async function sendA2AMessageHandler(request, ctx, options = {}) {
	if (!isSendMessageRequest(request.body)) return {
		status: 400,
		body: { error: "valid A2A SendMessageRequest is required" }
	};
	try {
		return {
			status: 200,
			headers: { "content-type": "application/a2a+json; charset=utf-8" },
			body: await ctx.sendA2AMessage(request.body, { allowRemoteRecipients: false })
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.startsWith("Unknown local recipient:")) return {
			status: 404,
			body: { error: message }
		};
		options.logger?.warn("A2A message delivery failed:", error);
		return {
			status: 502,
			body: { error: options.exposeInternalErrors ? message : "A2A message delivery failed" }
		};
	}
}
function extractLastPathSegment(path) {
	const segment = path.split("/").filter(Boolean).pop();
	return segment ? decodeURIComponent(segment) : "";
}
function extractA2AAgentRecipient(path) {
	const parts = path.split("/").filter(Boolean);
	const segment = parts.at(-1) === "card" ? parts.at(-2) : parts.at(-1);
	return segment ? decodeURIComponent(segment) : "";
}
function isAgentCard(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const card = value;
	return typeof card.name === "string" && typeof card.description === "string" && typeof card.version === "string" && Array.isArray(card.supportedInterfaces) && Array.isArray(card.defaultInputModes) && Array.isArray(card.defaultOutputModes) && Array.isArray(card.skills) && typeof card.capabilities === "object" && card.capabilities !== null;
}
function isRemoteA2AAgentAuth(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const auth = value;
	return auth.scheme === "bearer" && typeof auth.token === "string" && auth.token.trim().length > 0;
}
function isSendMessageRequest(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const request = value;
	return typeof request.recipient === "string" && isMessage(request.message);
}
function isMessage(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const message = value;
	return typeof message.messageId === "string" && (message.role === "user" || message.role === "agent") && Array.isArray(message.parts);
}
//#endregion
//#region src/honoAdapter.ts
const DEFAULT_A2A_MAX_BODY_BYTES = 1e6;
function toRequest(c) {
	const url = new URL(c.req.url);
	return {
		method: c.req.method,
		path: url.pathname,
		query: url.searchParams,
		headers: c.req.raw.headers
	};
}
async function toRequestWithBody(c) {
	const request = toRequest(c);
	if (c.req.header("content-type")?.includes("application/json")) return {
		...request,
		body: await c.req.json()
	};
	return {
		...request,
		body: await c.req.arrayBuffer()
	};
}
function send(c, response) {
	for (const [name, value] of Object.entries(response.headers ?? {})) c.header(name, value);
	return c.json(response.body ?? null, response.status);
}
function requireAuth(c, ctx) {
	if (!isAllowedOrigin(c.req.header("origin") ?? null, ctx.allowedOrigins)) return c.json({ error: "Forbidden origin" }, 403);
	if (!isAuthorized(c.req.header("authorization") ?? null, ctx.token)) return c.json({ error: "Unauthorized" }, 401);
	return null;
}
function registerA2ARoutes(app, ctx, options = {}) {
	const maxBodyBytes = options.maxBodyBytes ?? 1e6;
	const requireA2AAuth = (c) => requireAuth(c, ctx);
	const limitedJsonBody = bodyLimit({
		maxSize: maxBodyBytes,
		onError: (c) => c.json({ error: "request body too large" }, 413)
	});
	app.get("/api/health", async (c) => send(c, await healthHandler()));
	app.get("/api/a2a/agents", async (c) => {
		const authFailure = requireA2AAuth(c);
		if (authFailure) return authFailure;
		return send(c, await listA2AAgentsHandler(toRequest(c), ctx));
	});
	app.get("/api/a2a/agents/:recipient/card", async (c) => {
		const authFailure = requireA2AAuth(c);
		if (authFailure) return authFailure;
		return send(c, await getA2AAgentCardHandler(toRequest(c), ctx));
	});
	app.post("/api/a2a/agents", limitedJsonBody, async (c) => {
		const authFailure = requireA2AAuth(c);
		if (authFailure) return authFailure;
		return send(c, await registerA2AAgentCardHandler(await toRequestWithBody(c), ctx));
	});
	app.delete("/api/a2a/agents/:recipient", async (c) => {
		const authFailure = requireA2AAuth(c);
		if (authFailure) return authFailure;
		return send(c, await unregisterA2AAgentCardHandler(toRequest(c), ctx));
	});
	app.post("/api/a2a/message:send", limitedJsonBody, async (c) => {
		const authFailure = requireA2AAuth(c);
		if (authFailure) return authFailure;
		return send(c, await sendA2AMessageHandler(await toRequestWithBody(c), ctx, options));
	});
	app.post("/message:send", limitedJsonBody, async (c) => {
		const authFailure = requireA2AAuth(c);
		if (authFailure) return authFailure;
		return send(c, await sendA2AMessageHandler(await toRequestWithBody(c), ctx, options));
	});
}
function createA2AHonoApp(ctx, options = {}) {
	const app = new Hono();
	registerA2ARoutes(app, ctx, options);
	app.notFound((c) => c.json({ error: "not found" }, 404));
	return app;
}
function createA2AHttpServer(ctx, options = {}) {
	const app = createA2AHonoApp(ctx, options);
	return { server: createServer(getRequestListener((request) => app.fetch(request))) };
}
//#endregion
export { DEFAULT_A2A_MAX_BODY_BYTES, createA2AHonoApp, createA2AHttpServer, getA2AAgentCardHandler, healthHandler, isAllowedOrigin, isAuthorized, isLoopbackHost, listA2AAgentsHandler, registerA2AAgentCardHandler, registerA2ARoutes, requireAuth, send, sendA2AMessageHandler, unregisterA2AAgentCardHandler };

//# sourceMappingURL=index.mjs.map