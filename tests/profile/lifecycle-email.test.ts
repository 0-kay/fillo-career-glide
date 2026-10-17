import { describe, it, expect } from 'vitest';
import {
  proActivatedEmail, proEndedEmail, resumeReadyEmail, resumeFailedEmail,
} from '../../supabase/functions/_shared/email-lifecycle-templates';

const site = 'https://www.fylloai.com';

describe('lifecycle emails', () => {
  it('Pro activated differs by source and links to the dashboard', () => {
    const pay = proActivatedEmail({ first: 'Ada', site, source: 'payment' });
    const adm = proActivatedEmail({ first: 'Ada', site, source: 'admin' });
    expect(pay.subject).toBe("You're on Fyllo Pro");
    expect(pay.html).toContain('Thanks for subscribing');
    expect(pay.html).toContain('Plans &amp; billing');
    expect(adm.html).toContain('has been upgraded to Pro');
    expect(adm.html).not.toContain('Plans &amp; billing');
    expect(pay.html).toContain(`${site}/dashboard`);
  });

  it('escapes anything user-supplied', () => {
    const m = resumeReadyEmail({ first: '<b>x</b>', site, profileName: '"><script>alert(1)</script>', completeness: 90, jobs: 1, degrees: 0, skills: 0, ready: true });
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<b>x</b>');
  });

  it('résumé ready: pluralises facts and changes copy when below the threshold', () => {
    const ready = resumeReadyEmail({ site, profileName: 'PM', completeness: 85, jobs: 4, degrees: 1, skills: 42, ready: true });
    expect(ready.html).toContain('4 jobs, 1 degree, 42 skills');
    expect(ready.html).toContain('Your résumé is ready.');
    const low = resumeReadyEmail({ site, profileName: 'PM', completeness: 60, jobs: 0, degrees: 0, skills: 0, ready: false });
    expect(low.html).toContain('needs to reach 75%');
    expect(low.html).toContain('Finish your profile');
  });

  it('résumé failed: explains scanned files differently from generic errors', () => {
    expect(resumeFailedEmail({ site, reason: 'No readable text found in the résumé (is it a scanned image?)' }).html).toContain('scan or an image');
    expect(resumeFailedEmail({ site, reason: 'OpenAI error: 500' }).html).toContain('Something went wrong');
  });

  it('Pro ended points to pricing', () => {
    expect(proEndedEmail({ site }).html).toContain(`${site}/pricing`);
  });
});
