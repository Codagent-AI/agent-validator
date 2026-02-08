export interface User {
	id: string;
	email: string;
	role: "admin" | "user" | "viewer";
}

export interface Session {
	id: string;
	userId: string;
	token: string;
	expiresAt: number;
	createdAt: number;
	revoked: boolean;
}

export interface AuthContext {
	user: User;
	session: Session;
	permissions: string[];
}
