-- Global, durable cache of form-field -> profile-path mappings.
--
-- Rows describe a *form field* (signature) and where in a profile its value lives
-- (profile_path). They never contain user values, so they are safe to share across users.
-- Entries are retired by evidence (override/missing counters), not by age.
--
-- Written and read only by edge functions using the service role: RLS is enabled with no
-- policies, so the anon/authenticated roles cannot touch the table.

CREATE TABLE IF NOT EXISTS public.form_mappings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope            TEXT NOT NULL CHECK (scope IN ('platform', 'company')),
  -- platform: wildcard host ('*.greenhouse.io'); company: host[/tenant] ('boards.greenhouse.io/acme')
  domain_pattern   TEXT NOT NULL,
  platform         TEXT,
  kind             TEXT NOT NULL DEFAULT 'field' CHECK (kind IN ('field')),
  signature        TEXT NOT NULL,
  field_name       TEXT NOT NULL DEFAULT '',
  field_label      TEXT NOT NULL DEFAULT '',
  field_type       TEXT NOT NULL DEFAULT 'text',
  profile_path     TEXT NOT NULL,
  selector         TEXT,
  meta             JSONB NOT NULL DEFAULT '{}'::jsonb,
  source           TEXT NOT NULL CHECK (source IN ('seed', 'llm')),
  confidence       INTEGER NOT NULL DEFAULT 100 CHECK (confidence BETWEEN 0 AND 100),
  success_count    INTEGER NOT NULL DEFAULT 0,
  override_count   INTEGER NOT NULL DEFAULT 0,
  missing_count    INTEGER NOT NULL DEFAULT 0,
  last_verified_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, domain_pattern, kind, signature)
);

CREATE INDEX IF NOT EXISTS idx_form_mappings_domain ON public.form_mappings (domain_pattern);

ALTER TABLE public.form_mappings ENABLE ROW LEVEL SECURITY;

-- Applies a batch of fill outcomes: [{"id": "<uuid>", "outcome": "success|override|missing"}].
CREATE OR REPLACE FUNCTION public.record_form_mapping_outcomes(p_items JSONB)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH agg AS (
    SELECT (item->>'id')::uuid AS id,
           count(*) FILTER (WHERE item->>'outcome' = 'success')  AS ok,
           count(*) FILTER (WHERE item->>'outcome' = 'override') AS ov,
           count(*) FILTER (WHERE item->>'outcome' = 'missing')  AS mi
    FROM jsonb_array_elements(p_items) AS item
    WHERE item->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    GROUP BY 1
  )
  UPDATE public.form_mappings m
  SET success_count    = m.success_count  + agg.ok,
      override_count   = m.override_count + agg.ov,
      missing_count    = m.missing_count  + agg.mi,
      last_verified_at = CASE WHEN agg.ok > 0 THEN now() ELSE m.last_verified_at END,
      updated_at       = now()
  FROM agg
  WHERE m.id = agg.id;
$$;

REVOKE ALL ON FUNCTION public.record_form_mapping_outcomes(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_form_mapping_outcomes(JSONB) TO service_role;
