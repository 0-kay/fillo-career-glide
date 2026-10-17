import { supabase } from '@/integrations/supabase/client';

export class AdminApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const client = supabase as unknown as { supabaseUrl: string; supabaseKey: string };

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AdminApiError(401, 'unauthorized', 'You are signed out.');
  return { Authorization: `Bearer ${token}`, apikey: client.supabaseKey };
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = { ...(await authHeaders()), ...(init.body ? { 'Content-Type': 'application/json' } : {}) };
  let res: Response;
  try {
    res = await fetch(`${client.supabaseUrl}/functions/v1/admin-api${path}`, { ...init, headers });
  } catch {
    throw new AdminApiError(0, 'network', 'Could not reach the admin API.');
  }
  return res;
}

async function parse<T>(res: Response): Promise<T> {
  let body: { success?: boolean; data?: T; error?: string; code?: string } | null = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok || !body?.success) {
    throw new AdminApiError(res.status, body?.code ?? 'error', body?.error ?? `Request failed (${res.status})`);
  }
  return body.data as T;
}

export async function adminGet<T>(path: string, params?: Record<string, string | number | undefined | null>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const q = qs.toString();
  return parse<T>(await request(q ? `${path}?${q}` : path));
}

export async function adminPost<T>(path: string, body: unknown): Promise<T> {
  return parse<T>(await request(path, { method: 'POST', body: JSON.stringify(body) }));
}

/** Downloads a CSV export through the authenticated API (a plain link would carry no token). */
export async function adminDownload(path: string, params: Record<string, string | number | undefined | null>, filename: string) {
  const qs = new URLSearchParams({ format: 'csv' });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const res = await request(`${path}?${qs}`);
  if (!res.ok) await parse(res);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type Role = 'owner' | 'admin' | 'viewer';
export interface Me {
  id: string;
  email: string;
  role: Role;
  mfa: { verified: boolean; enrolled: boolean; recent: boolean };
}

export const canWrite = (role?: Role) => role === 'owner' || role === 'admin';
export const isOwner = (role?: Role) => role === 'owner';
