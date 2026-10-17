import { describe, it, expect } from 'vitest';
import { processResume, type PipelineDeps, type ProfileRecord } from '../../supabase/functions/_shared/resume/pipeline';
import { mapParsedResume } from '../../supabase/functions/_shared/resume/map';

const parsed = {
  personalInfo: { fullName: 'Jane Q Doe', email: 'jane@x.co', phone: '+1 212 555 1234', address: { city: 'Austin', state: 'TX' } },
  summary: 'Engineer',
  skills: { technical: ['Python', 'PostgreSQL'], soft: [], tools: ['Git'] },
  experience: [{ jobTitle: 'Engineer', company: 'Acme' }],
  education: [{ degree: 'BS', school: 'UT', fieldOfStudy: 'CS', endDate: '05/2019' }],
};

function harness(opts: { meta?: Record<string, any>; prefs?: Record<string, any>; parse?: PipelineDeps['parseWithModel']; text?: string } = {}) {
  const row: ProfileRecord = {
    id: 'p1', user_id: 'u1',
    job_preferences: opts.prefs ?? {},
    resume_metadata: { parsing_status: 'Processing', file_path: 'u1/p1/r.pdf', fileName: 'r.pdf', profile_name: 'PM', ...(opts.meta ?? {}) },
  };
  const saves: any[] = [];
  const deps: PipelineDeps = {
    loadProfile: async () => ({ ...row }),
    downloadResume: async () => new Uint8Array([1]),
    extractText: async () => opts.text ?? 'x'.repeat(200),
    parseWithModel: opts.parse ?? (async () => parsed),
    saveProfile: async (_id, patch) => { saves.push(patch); Object.assign(row, patch); },
    retryDelayMs: 0,
  };
  return { deps, saves, row };
}

describe('processResume', () => {
  it('parses, scores and marks Completed, keeping the user-chosen profile name', async () => {
    const h = harness();
    expect(await processResume(h.deps, 'p1')).toBe('Completed');
    const final = h.saves.at(-1);
    expect(final.resume_metadata.parsing_status).toBe('Completed');
    expect(final.resume_metadata.profile_name).toBe('PM');
    expect(final.completeness).toBe(85);
    expect(final.first_name).toBe('Jane');
    expect(final.education_history[0].fieldOfStudy).toBe('CS');
  });

  it('keeps screening answers saved while parsing was running', async () => {
    const h = harness({ prefs: { screening_answers: [{ id: 'a' }] } });
    await processResume(h.deps, 'p1');
    expect(h.saves.at(-1).job_preferences.screening_answers).toEqual([{ id: 'a' }]);
  });

  it('retries once, then succeeds', async () => {
    let n = 0;
    const h = harness({ parse: async () => { if (n++ === 0) throw new Error('boom'); return parsed; } });
    expect(await processResume(h.deps, 'p1')).toBe('Completed');
    expect(n).toBe(2);
  });

  it('marks Failed (never stuck Processing) when the model keeps failing', async () => {
    const h = harness({ parse: async () => { throw new Error('timeout'); } });
    expect(await processResume(h.deps, 'p1')).toBe('Failed');
    const meta = h.saves.at(-1).resume_metadata;
    expect(meta.parsing_status).toBe('Failed');
    expect(meta.error).toBe('timeout');
    expect(meta.profile_name).toBe('PM');
  });

  it('fails clearly on unreadable (scanned) files', async () => {
    const h = harness({ text: '  ' });
    expect(await processResume(h.deps, 'p1')).toBe('Failed');
    expect(h.saves.at(-1).resume_metadata.error).toMatch(/readable text/);
  });

  it('fails when no file was uploaded', async () => {
    const h = harness({ meta: { file_path: undefined } });
    expect(await processResume(h.deps, 'p1')).toBe('Failed');
  });

  it('is a no-op for an already Completed profile', async () => {
    const h = harness({ meta: { parsing_status: 'Completed' } });
    expect(await processResume(h.deps, 'p1')).toBe('Completed');
    expect(h.saves).toHaveLength(0);
  });
});

describe('mapParsedResume', () => {
  it('normalises phone and derives name parts', () => {
    const { row } = mapParsedResume(parsed);
    expect(row.personal_details.phone).toBe('+12125551234');
    expect(row.middle_name).toBe('Q');
    expect(row.last_name).toBe('Doe');
  });
  it('tolerates an empty/garbage model response', () => {
    const { row, completeness } = mapParsedResume({});
    expect(row.work_experience).toEqual([]);
    expect(completeness).toBe(0);
  });
});
