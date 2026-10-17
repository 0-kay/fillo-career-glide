import { describe, it, expect } from 'vitest';
import { computeCompleteness, screeningProgress, READY_THRESHOLD } from '../../src/utils/profileCompleteness';

const base = {
  personalDetails: { fullName: 'A B', email: 'a@b.co', phone: '555', address: { city: 'Austin' } },
  workExperience: [{ jobTitle: 'Engineer', company: 'Acme' }],
  educationHistory: [{ degree: 'BS', school: 'UT' }],
  technicalSkills: { all: ['sql'] },
};
const qa = (n: number, answered: number) =>
  Array.from({ length: n }, (_, i) => ({ id: String(i), enabled: true, answer: i < answered ? 'Yes' : '' }));

describe('computeCompleteness', () => {
  it('a typical résumé with no screening answers is ready (80)', () => {
    expect(computeCompleteness(base)).toBe(80);
    expect(computeCompleteness(base)).toBeGreaterThanOrEqual(READY_THRESHOLD);
  });
  it('screening answers add up to 15 points pro rata', () => {
    expect(computeCompleteness({ ...base, screeningAnswers: qa(4, 0) })).toBe(80);
    expect(computeCompleteness({ ...base, screeningAnswers: qa(4, 2) })).toBe(88);
    expect(computeCompleteness({ ...base, screeningAnswers: qa(4, 4) })).toBe(95);
  });
  it('disabled questions are ignored', () => {
    const answers = [...qa(2, 2), { id: 'x', enabled: false, answer: '' }];
    expect(screeningProgress(answers)).toEqual({ answered: 2, total: 2, pct: 100 });
  });
  it('a student with no jobs needs summary or screening answers to be ready', () => {
    const student = { ...base, workExperience: [] };
    expect(computeCompleteness(student)).toBe(65);
    expect(computeCompleteness({ ...student, screeningAnswers: qa(4, 4) })).toBe(80);
  });
  it('empty profile is 0', () => expect(computeCompleteness({})).toBe(0));
  it('ignores blank placeholder entries', () => {
    expect(computeCompleteness({ ...base, workExperience: [{ jobTitle: '', company: '' }] })).toBe(65);
  });
});
