import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeAppUrl } from '../../lib/app-url.js';
import { buildCandidateChallengeInviteMail } from '../../lib/candidate-challenge-invite-mail.js';

test('runtime app URL switches environments without reloading modules', () => {
  const original = { APP_URL: process.env.APP_URL, NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL, NODE_ENV: process.env.NODE_ENV };
  try {
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.30grow.com';
    for (const base of ['https://team.3035service.com', 'https://app.30grow.com']) {
      process.env.APP_URL = ` ${base}/// `;
      assert.equal(runtimeAppUrl(), base);
      const challengeUrl = `${runtimeAppUrl()}/v/vacancy-token?invite=candidate-token`;
      const mail = buildCandidateChallengeInviteMail({ candidateFullName: 'Teste', vacancyTitle: 'Vaga', challengeUrl });
      assert.ok(mail.text.includes(challengeUrl));
      assert.ok(mail.html.includes(challengeUrl));
    }
    delete process.env.APP_URL;
    assert.equal(runtimeAppUrl(), 'https://app.30grow.com', 'legacy configuration remains compatible');
    delete process.env.NEXT_PUBLIC_APP_URL;
    assert.equal(runtimeAppUrl(), '', 'missing configuration does not assume a production domain');
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
