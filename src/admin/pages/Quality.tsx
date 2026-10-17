import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminGet } from '../adminApi';
import { num, pct } from '../format';
import { ErrorNote, PageHeader, Panel } from '../ui';

interface Quality {
  by_platform: Array<{ platform: string; mappings: number; success: number; override: number; missing: number; override_rate: number | null; miss_rate: number | null }>;
  top_unmatched: Array<{ label: string; field_name: string; canonical_key: string; platform: string; missing: number; override: number; success: number }>;
  top_overridden: Array<{ label: string; field_name: string; canonical_key: string; platform: string; missing: number; override: number; success: number }>;
  profile_completeness: Record<string, number>;
}

const BUCKETS = ['0-24', '25-49', '50-74', '75-99', '100'];

export default function QualityPage() {
  const [ats, setAts] = useState('all');
  const q = useQuery({
    queryKey: ['admin', 'quality', ats],
    queryFn: () => adminGet<Quality>('/metrics/quality', { ats: ats === 'all' ? undefined : ats }),
  });
  const platforms = ['greenhouse', 'lever', 'ashby', 'workday', 'icims', 'workable'];
  const completenessTotal = BUCKETS.reduce((s, b) => s + (q.data?.profile_completeness[b] ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Quality & matching">
        <Select value={ats} onValueChange={setAts}>
          <SelectTrigger className="w-40" aria-label="ATS"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ATS</SelectItem>
            {platforms.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
      </PageHeader>
      <ErrorNote error={q.error} />
      <p className="text-sm text-slate-500">
        Counters come from the shared form mappings and are cumulative. Failure reasons and per-extension-version
        rates need the usage-tracking events and will appear once those ship.
      </p>

      {q.data && (
        <>
          <Panel title="Fill outcomes by ATS">
            <Table
              head={['ATS', 'Mappings', 'Filled', 'Overridden', 'Missed', 'Override rate', 'Miss rate']}
              rows={q.data.by_platform.map((r) => [r.platform, num(r.mappings), num(r.success), num(r.override), num(r.missing), pct(r.override_rate), pct(r.miss_rate)])}
            />
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Most unmatched fields">
              <Table
                head={['Label', 'Canonical key', 'ATS', 'Missed']}
                rows={q.data.top_unmatched.map((r) => [r.label || r.field_name || '(unlabelled)', r.canonical_key, r.platform, num(r.missing)])}
              />
            </Panel>
            <Panel title="Most overridden fields">
              <Table
                head={['Label', 'Canonical key', 'ATS', 'Overridden']}
                rows={q.data.top_overridden.map((r) => [r.label || r.field_name || '(unlabelled)', r.canonical_key, r.platform, num(r.override)])}
              />
            </Panel>
          </div>
          <Panel title="Profile completeness">
            <p className="mb-3 text-xs text-slate-500">
              Separates "empty profile" misses from real matching bugs: a miss on a 100% profile is a matching problem.
            </p>
            <div className="grid grid-cols-5 gap-3">
              {BUCKETS.map((b) => {
                const n = q.data.profile_completeness[b] ?? 0;
                return (
                  <div key={b} className="rounded-lg border p-3 text-center">
                    <div className="text-xs text-slate-500">{b}%</div>
                    <div className="text-xl font-semibold">{num(n)}</div>
                    <div className="text-xs text-slate-400">{pct(completenessTotal ? n / completenessTotal : null)}</div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">Nothing recorded yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>{head.map((h, i) => <th key={h} className={`py-1 pr-3 ${i > 1 && h !== 'ATS' && h !== 'Canonical key' ? 'text-right' : ''}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              {r.map((c, j) => <td key={j} className={`py-1.5 pr-3 ${j > 1 && head[j] !== 'ATS' && head[j] !== 'Canonical key' ? 'text-right' : ''}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
