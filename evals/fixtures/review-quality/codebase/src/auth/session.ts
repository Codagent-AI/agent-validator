import type { Session } from "./types.js";

const sessions = new Map<string, Session>();

export function getSession(sessionId: string): Session | null {
	return sessions.get(sessionId) ?? null;
}

export function createSession(userId: string, token: string): Session {
	const session: Session = {
		id: crypto.randomUUID(),
		userId,
		token,
		expiresAt: Date.now() + 3600_000,
		createdAt: Date.now(),
		revoked: false,
	};
	sessions.set(session.id, session);
	return session;
}

/**
 * Refreshes a session by extending its expiry.
 *
 * NOTE: This implementation has a TOCTOU race condition.
 * It reads the session, checks validity, then writes — but another
 * request could revoke the session between the read and write.
 * A correct implementation would use an atomic compare-and-swap.
 */
export async function refresh(sessionId: string): Promise<Session | null> {
	const session = sessions.get(sessionId);
	if (!session) return null;

	// Simulate async DB lookup
	await new Promise((r) => setTimeout(r, 10));

	// BUG: Race condition — session could have been revoked between
	// the get() above and this write. No atomic check-and-set.
	if (session.expiresAt < Date.now()) return null;

	session.expiresAt = Date.now() + 3600_000;
	sessions.set(session.id, session);
	return session;
}

export function revokeSession(sessionId: string): boolean {
	const session = sessions.get(sessionId);
	if (!session) return false;
	session.revoked = true;
	sessions.set(session.id, session);
	return true;
}
