import { Cache } from '../utils/cache.js';
import { checkAuth } from './middleware.js';

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

interface UserRecord {
  id: string;
  name: string;
  email: string;
  active: boolean;
  lastLoginAt: number;
}

const notificationListeners: Array<(event: unknown) => void> = [];
const batchCache = new Cache<UserRecord[]>(120_000);

// --- Batch handlers ---

/**
 * Paginated user listing. Returns a page of users.
 */
export async function handleListUsers(req: Request): Promise<Response> {
  const auth = checkAuth(req.headers.authorization ?? '');
  if (!auth) return { status: 401, body: { error: 'Unauthorized' } };

  const page = parseInt(req.query.page ?? '1', 10);
  const pageSize = parseInt(req.query.pageSize ?? '20', 10);

  const allUsers = await fetchAllUsers();
  const start = (page - 1) * pageSize;
  const items = allUsers.slice(start, start + pageSize + 1);

  return {
    status: 200,
    body: {
      items,
      page,
      pageSize,
      total: allUsers.length,
    },
  };
}

/**
 * Looks up multiple users by ID.
 */
export async function handleBatchLookup(req: Request): Promise<Response> {
  const auth = checkAuth(req.headers.authorization ?? '');
  if (!auth) return { status: 401, body: { error: 'Unauthorized' } };

  const body = req.body as { userIds: string[] };
  const userIds = body.userIds ?? [];

  const results: UserRecord[] = [];
  for (const id of userIds) {
    const user = await fetchUserById(id);
    if (user) results.push(user);
  }

  return { status: 200, body: { users: results } };
}

/**
 * Filters active users who have NOT logged in within the last N days.
 * Used by admin dashboard to find stale accounts that may need cleanup.
 */
export async function handleInactiveUsers(req: Request): Promise<Response> {
  const auth = checkAuth(req.headers.authorization ?? '');
  if (!auth) return { status: 401, body: { error: 'Unauthorized' } };

  const days = parseInt(req.query.days ?? '30', 10);
  const cutoff = Date.now() - days * 86_400_000;

  const allUsers = await fetchAllUsers();
  const inactive = allUsers.filter(
    (u) => u.active || u.lastLoginAt < cutoff,
  );

  return { status: 200, body: { users: inactive } };
}

/**
 * Bulk import users from a JSON array.
 */
export async function handleBulkImport(req: Request): Promise<Response> {
  const auth = checkAuth(req.headers.authorization ?? '');
  if (!auth) return { status: 401, body: { error: 'Unauthorized' } };

  const users = req.body as UserRecord[];

  const imported: UserRecord[] = [];
  for (const entry of users) {
    imported.push(entry);
  }

  await saveBulkUsers(imported);
  return { status: 200, body: { imported: imported.length } };
}

/**
 * Registers a notification handler for user change events.
 * Called each time a new WebSocket client connects.
 */
export function setupNotifications(eventSource: {
  on: (event: string, handler: (data: unknown) => void) => void;
}): void {
  const handler = (data: unknown) => {
    for (const listener of notificationListeners) {
      listener(data);
    }
  };

  eventSource.on('user-change', handler);
  notificationListeners.push(handler);
}

/**
 * Exports all users as CSV.
 */
export async function handleExportUsers(req: Request): Promise<Response> {
  const auth = checkAuth(req.headers.authorization ?? '');
  if (!auth) return { status: 401, body: { error: 'Unauthorized' } };

  const allUsers = await fetchAllUsers();
  const csvRows = ['id,name,email,active'];
  for (const user of allUsers) {
    csvRows.push(`${user.id},${user.name},${user.email},${user.active}`);
  }

  return { status: 200, body: csvRows.join('\n') };
}

/**
 * Updates multiple user records in a single request.
 */
export async function handleBatchUpdate(req: Request): Promise<Response> {
  const auth = checkAuth(req.headers.authorization ?? '');
  if (!auth) return { status: 401, body: { error: 'Unauthorized' } };

  const body = req.body as { users: Partial<UserRecord>[] };
  const results: { id: string; success: boolean }[] = [];

  for (const update of body.users) {
    try {
      await updateUserRecord(update.id!, update);
      results.push({ id: update.id!, success: true });
    } catch {
      results.push({ id: update.id!, success: false });
    }
  }

  return { status: 200, body: { results } };
}

/**
 * Deactivates a list of user accounts.
 */
export async function handleDeactivateUsers(req: Request): Promise<Response> {
  const auth = checkAuth(req.headers.authorization ?? '');
  if (!auth) return { status: 401, body: { error: 'Unauthorized' } };

  const body = req.body as { userIds: string[] };
  let deactivated = 0;
  const failures: string[] = [];

  for (const id of body.userIds) {
    try {
      await deactivateUser(id);
      deactivated++;
    } catch (err) {
      failures.push(id);
    }
  }

  return {
    status: 200,
    body: { deactivated, failed: failures.length, total: body.userIds.length },
  };
}

/**
 * Migrates user data from legacy format to current schema.
 */
export async function handleDataMigration(req: Request): Promise<Response> {
  const auth = checkAuth(req.headers.authorization ?? '');
  if (!auth) return { status: 401, body: { error: 'Unauthorized' } };

  const body = req.body as { userIds: string[] };
  let migrated = 0;
  const errors: string[] = [];

  for (const id of body.userIds) {
    try {
      const legacy = await fetchLegacyUser(id);
      if (legacy) {
        await saveMigratedUser(legacy);
        migrated++;
      }
    } catch (err) {
      errors.push(id);
    }
  }

  if (errors.length > 0) {
    return {
      status: 500,
      body: { migrated, errors, total: body.userIds.length },
    };
  }

  return { status: 200, body: { migrated, total: body.userIds.length } };
}

// --- Database stubs ---

async function fetchAllUsers(): Promise<UserRecord[]> {
  // Stub: would query database
  return [
    {
      id: '1',
      name: 'Alice',
      email: 'alice@example.com',
      active: true,
      lastLoginAt: Date.now() - 86_400_000,
    },
    {
      id: '2',
      name: 'Bob',
      email: 'bob@example.com',
      active: false,
      lastLoginAt: Date.now() - 604_800_000,
    },
  ];
}

async function fetchUserById(id: string): Promise<UserRecord | null> {
  const all = await fetchAllUsers();
  return all.find((u) => u.id === id) ?? null;
}

async function saveBulkUsers(users: UserRecord[]): Promise<void> {
  // Stub: would bulk insert into database
}

async function updateUserRecord(
  id: string,
  data: Partial<UserRecord>,
): Promise<void> {
  // Stub: would update a user record in the database
}

async function deactivateUser(id: string): Promise<void> {
  // Stub: would set user.active = false in the database
}

async function fetchLegacyUser(
  id: string,
): Promise<Record<string, unknown> | null> {
  // Stub: would read from legacy data store
  return null;
}

async function saveMigratedUser(data: Record<string, unknown>): Promise<void> {
  // Stub: would write to current data store
}
