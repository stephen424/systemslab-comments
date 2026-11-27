import { query } from '../config/database';

/**
 * A Systemslab.ai account, read from Quickbuild's public.users table, the same way every app checks
 * sign-in today. This service never writes it, and reads nothing else outside its own schema.
 */
export interface SystemslabUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

export const findUserById = async (id: string): Promise<SystemslabUser | null> => {
  const result = await query<SystemslabUser>(
    'SELECT id, email, full_name, role, is_active FROM public.users WHERE id = $1',
    [id]
  );
  return result.rows[0] ?? null;
};

/** Viewers can read comments but not write them. */
export const canComment = (user: SystemslabUser): boolean => user.role !== 'viewer';

/** Systemslab.ai admins, and anyone listed for the app in comments.app_admins, may close threads. */
export const isAppAdmin = async (user: SystemslabUser, app: string): Promise<boolean> => {
  if (user.role === 'admin') return true;
  const result = await query('SELECT 1 FROM comments.app_admins WHERE app = $1 AND user_id = $2', [app, user.id]);
  return (result.rowCount ?? 0) > 0;
};
