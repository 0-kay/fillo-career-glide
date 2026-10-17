import { Badge } from '@/components/ui/badge';
import { delta, pct } from './format';

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stat({
  label, value, current, previous, hint, unavailable,
}: {
  label: string;
  value: string;
  current?: number | null;
  previous?: number | null;
  hint?: string;
  unavailable?: boolean;
}) {
  const d = unavailable ? null : delta(current, previous);
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${unavailable ? 'text-slate-300' : ''}`}>{unavailable ? 'n/a' : value}</div>
      <div className="mt-1 min-h-[1rem] text-xs text-slate-500">
        {unavailable ? (
          hint
        ) : d === null ? (
          hint
        ) : (
          <span className={d > 0 ? 'text-emerald-600' : d < 0 ? 'text-red-600' : ''}>
            {d > 0 ? '▲' : d < 0 ? '▼' : '–'} {pct(Math.abs(d))} vs previous period
          </span>
        )}
      </div>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
  SUSPENDED: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  REVOKED: 'bg-red-100 text-red-800 hover:bg-red-100',
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge className={STATUS_STYLE[status] ?? ''} variant="secondary">{status}</Badge>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {error instanceof Error ? error.message : 'Something went wrong.'}
    </p>
  );
}
