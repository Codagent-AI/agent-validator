import { refresh } from "../auth/session.js";
import { Cache } from "../utils/cache.js";
import { sanitize } from "../utils/sanitize.js";
import { checkAuth } from "./middleware.js";

interface Request {
	method: string;
	path: string;
	headers: Record<string, string>;
	body: unknown;
	query: Record<string, string>;
}

interface Response {
	status: number;
	body: unknown;
}

const userCache = new Cache<Record<string, unknown>>(300_000);

// --- Route handlers ---

export async function handleGetUser(req: Request): Promise<Response> {
	const auth = checkAuth(req.headers.authorization ?? "");
	if (!auth) return { status: 401, body: { error: "Unauthorized" } };

	const userId = req.query.id;
	const cached = await userCache.get(`user:${userId}`);
	if (cached) return { status: 200, body: cached };

	// Safe: parameterized-style lookup
	const user = await lookupUser(userId);
	if (!user) return { status: 404, body: { error: "Not found" } };

	await userCache.set(`user:${userId}`, user);
	return { status: 200, body: user };
}

export async function handleSearch(req: Request): Promise<Response> {
	const auth = checkAuth(req.headers.authorization ?? "");
	if (!auth) return { status: 401, body: { error: "Unauthorized" } };

	const query = req.query.q;
	const sanitized = sanitize(query);

	const results = await searchUsers(sanitized);
	return { status: 200, body: { results } };
}

export async function handleUpdateProfile(req: Request): Promise<Response> {
	const auth = checkAuth(req.headers.authorization ?? "");
	if (!auth) return { status: 401, body: { error: "Unauthorized" } };

	const body = req.body as { name?: string; email?: string; age?: number };
	const name = sanitize(body.name ?? "");
	const email = sanitize(body.email ?? "");

	const updated = await updateUser(auth.user.id, { name, email });
	return { status: 200, body: updated };
}

export async function handleRefreshSession(req: Request): Promise<Response> {
	const auth = checkAuth(req.headers.authorization ?? "");
	if (!auth) return { status: 401, body: { error: "Unauthorized" } };

	const refreshed = await refresh(auth.session.id);
	if (!refreshed) return { status: 401, body: { error: "Session expired" } };

	return { status: 200, body: { expiresAt: refreshed.expiresAt } };
}

export async function handleHealthCheck(): Promise<Response> {
	return { status: 200, body: { status: "ok", timestamp: Date.now() } };
}

// --- Database stubs ---

async function lookupUser(
	id: string,
): Promise<Record<string, unknown> | null> {
	// Stub: would query database
	return { id, name: "Test User", email: "test@example.com" };
}

async function searchUsers(
	query: string,
): Promise<Record<string, unknown>[]> {
	// Stub: would query database
	return [{ id: "1", name: query }];
}

async function updateUser(
	id: string,
	data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	// Stub: would update database
	return { id, ...data };
}

// --- Config ---

export const config = {
	port: 3000,
	host: "localhost",
	maxRequestSize: "10mb",
};
