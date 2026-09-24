import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import './fyllo.css';

interface Suggestion {
  id: string;
  ai_suggestion: string | null;
  field_category: string | null;
  page_url: string | null;
  created_at: string;
  field_data: any;
  suggested_action: { targetPath?: string; missingDataType?: string; exampleValue?: any } | null;
}

const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'Last week';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const host = (u: string | null) => { try { return u ? new URL(u).hostname : 'a job site'; } catch { return 'a job site'; } };
const label = (s: Suggestion) => {
  const first = Array.isArray(s.field_data) ? s.field_data[0] : null;
  const name = first && (first.label || first.name || first.fieldName || first.field);
  return String(name || s.ai_suggestion || 'Unfilled field');
};

/** "Fields Fyllo couldn't fill" card, backed by the missed_fields table and the resolve-missed-field function. */
export default function MissedFields() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await (supabase as any)
      .from('missed_fields').select('*').eq('user_id', user.id).eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(20);
    if (!error && data) setItems(data);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (s: Suggestion, status: 'resolved' | 'dismissed', note?: string) => {
    setBusy(s.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const body: Record<string, unknown> = { suggestionId: s.id, status, note };
      if (status === 'resolved') body.updatedData = { updated_at: new Date().toISOString() };
      const res = await fetch('https://yuojrygcrcpajiglbekd.supabase.co/functions/v1/resolve-missed-field', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to resolve suggestion');
      if (status === 'resolved') {
        setSaved((m) => ({ ...m, [s.id]: true }));
        setTimeout(() => setItems((l) => l.filter((x) => x.id !== s.id)), 1400);
      } else {
        setItems((l) => l.filter((x) => x.id !== s.id));
      }
    } catch (e) {
      console.error('Error resolving suggestion:', e);
      toast({ title: 'Error', description: 'Failed to update suggestion', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const count = items.length;
  return (
    <section aria-labelledby="attn-h" className="fy-card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '20px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <h2 id="attn-h" style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Fields Fyllo couldn't fill</h2>
        <span style={{ fontSize: 13, color: '#6C6577' }}>{count === 0 ? 'None' : `${count} to review`}</span>
      </div>
      {items.map((m) => {
        const done = saved[m.id];
        const ex = m.suggested_action?.exampleValue;
        return (
          <div key={m.id} style={{ padding: '16px 22px', borderTop: '1px solid rgba(23,19,33,.06)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>“{label(m)}”</span>
                <span style={{ fontSize: 12, color: '#6C6577' }}>{host(m.page_url)} · {ago(m.created_at)}</span>
              </div>
              {done && <span style={{ flex: 'none', fontSize: 12, fontWeight: 500, color: '#4B0082', background: '#F5F1FB', padding: '4px 10px', borderRadius: 999 }}>Saved</span>}
            </div>
            {!done && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  value={values[m.id] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [m.id]: e.target.value }))}
                  placeholder={ex != null ? `e.g. ${typeof ex === 'string' ? ex : JSON.stringify(ex)}` : 'Your answer'}
                  aria-label={label(m)}
                  style={{ flex: '1 1 180px', height: 40, borderRadius: 10, border: '1px solid rgba(23,19,33,.14)', padding: '0 12px', fontSize: 14, color: '#171321', outline: 'none' }}
                />
                <button type="button" className="fy-btn fy-primary" disabled={busy === m.id || !(values[m.id] ?? '').trim()}
                  onClick={() => resolve(m, 'resolved', `Added via dashboard: ${values[m.id]}`)}
                  style={{ height: 40, padding: '0 16px', borderRadius: 10, fontSize: 14 }}>Add to profile</button>
                <button type="button" className="fy-btn fy-ghost" disabled={busy === m.id} onClick={() => resolve(m, 'dismissed')}
                  style={{ height: 40, padding: '0 12px', borderRadius: 10, fontSize: 14, color: '#6C6577', fontWeight: 400 }}>Dismiss</button>
              </div>
            )}
          </div>
        );
      })}
      {count === 0 && (
        <p style={{ margin: 0, padding: '18px 22px 22px', borderTop: '1px solid rgba(23,19,33,.06)', fontSize: 14, color: '#6C6577' }}>All caught up. When a form asks for something your profile doesn't have, it'll show up here.</p>
      )}
    </section>
  );
}
