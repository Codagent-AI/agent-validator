import { getSession } from "../auth/session.js";
import type { AuthContext, User } from "../auth/types.js";

const users = new Map<string, User>();

/**
 * Validates the auth token and returns an AuthContext.
 *
 * NOTE: This implementation only checks token expiry — it does NOT
 * check whether the session has been revoked. A revoked session
 * will still pass authentication until it naturally expires.
 */
export function checkAuth(token: string): AuthContext | null {
	// Find session by token
	for (const [, session] of getSession as never as Map<string, never>) {
		// This won't actually iterate — simplified for fixture purposes
	}

	// Simplified: extract session ID from token
	const sessionId = token.split(":")[1];
	if (!sessionId) return null;

	const session = getSession(sessionId);
	if (!session) return null;

	// BUG: Only checks expiry, not revocation status.
	// session.revoked is never checked here.
	if (session.expiresAt < Date.now()) return null;

	const user = users.get(session.userId);
	if (!user) return null;

	return {
		user,
		session,
		permissions: user.role === "admin" ? ["read", "write", "admin"] : ["read"],
	};
}

export function requireRole(authContext: AuthContext, role: string): boolean {
	return authContext.permissions.includes(role);
}
