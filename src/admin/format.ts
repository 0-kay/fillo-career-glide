export const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toLocaleString());
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${(n * 100).toFixed(1)}%`);
export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
export const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';

export function delta(current: number | null | undefined, previous: number | null | undefined) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

export const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
