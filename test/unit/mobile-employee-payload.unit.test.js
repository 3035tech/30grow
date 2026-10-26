import assert from 'node:assert/strict';
import test from 'node:test';
import { getEmployeeProfile } from '../../lib/employee/employee-profile.js';
import {
  mobileCommunityBody,
  mobileLmsBody,
  mobileOneOnOneBody,
  mobileReviewDetail,
  mobileReviewList,
  mobileSurveyInbox,
} from '../../lib/mobile-employee-payload.js';

test('mobile payloads coerce bigint ids, dates and 1:1 HTML', () => {
  const createdAt = new Date('2026-09-28T12:00:00.000Z');
  const community = mobileCommunityBody({
    posts: [{ id: '12', title: 'Mural', bodyHtml: '<p>Aviso</p>', authorName: 'RH', createdAt }],
    postTotal: '2',
    kudos: [{ id: '9', message: 'Valeu', fromCandidateId: '3', toCandidateId: '4', fromName: 'Elena', toName: 'Marina', createdAt }],
    kudosTotal: 1,
    colleagues: [{ id: '3', fullName: 'Elena Ferreira' }],
  });
  assert.equal(community.posts[0].id, 12);
  assert.equal(community.posts[0].createdAt, '2026-09-28T12:00:00.000Z');
  assert.equal(community.kudos[0].fromCandidateId, 3);
  assert.equal(community.colleagues[0].id, 3);

  const oneOnOne = mobileOneOnOneBody({
    agreements: [{ id: '8', meetingDate: '2026-09-15', nextSteps: '<p>Fechar o item do PDI.</p>' }],
    prompts: ['O que te deixa mais engajado?'],
    preparation: { preparedAt: createdAt, noteToManager: 'Quero alinhar a prioridade.' },
  });
  assert.equal(oneOnOne.agreements[0].id, 8);
  assert.equal(oneOnOne.agreements[0].meetingDate, '2026-09-15');
  assert.equal(oneOnOne.agreements[0].nextSteps, 'Fechar o item do PDI.');
  assert.equal(oneOnOne.preparation.preparedAt, '2026-09-28T12:00:00.000Z');

  const reviews = mobileReviewList([{ id: '74', cycleTitle: 'Avaliação de competências', model: '180', sentAt: createdAt }]);
  assert.equal(reviews[0].id, 74);
  assert.equal(reviews[0].sentAt, '2026-09-28T12:00:00.000Z');
  const detail = mobileReviewDetail({
    id: '74', cycleTitle: 'Avaliação de competências', model: '180', sentAt: createdAt,
    items: [{ id: '1', label: 'Comunicação' }],
    raters: [{ id: '2', role: 'manager', overallNotes: 'Clareza.' }],
    scores: [{ raterId: '2', itemId: '1', score: 4, notes: 'Cedo.' }],
  });
  assert.equal(detail.items[0].id, 1);
  assert.equal(detail.scores[0].raterId, 2);

  const lms = mobileLmsBody([{
    enrollmentId: '5', courseId: '6', title: 'Cultura', description: 'Como trabalhamos', dueDate: '2026-09-28',
    mandatory: true, overdue: true, progressPct: 50, isComplete: false, certificateAvailable: false,
    lessons: [{ id: '7', title: 'Prioridade', description: null, contentUrl: 'https://example.com/a', contentKind: 'pdf', embedUrl: null, videoId: null, completed: false, quizRequired: true, quizPassed: false, watchPositionSec: 0, watchDurationSec: 0 }],
  }]);
  assert.equal(lms.courses[0].enrollmentId, 5);
  assert.equal(lms.courses[0].lessons[0].id, 7);

  const surveys = mobileSurveyInbox({
    openClimate: [{ kind: 'climate', title: 'Clima', token: 'abc', description: '', questions: [{ id: '11', prompt: 'Como está?', scaleMin: 1, scaleMax: 5, questionKind: 'likert' }] }],
    openPulse: [{ kind: 'pulse', title: 'Pulso', token: 'def', questions: [{ id: '12', prompt: 'Energia?', scaleMin: 1, scaleMax: 5 }] }],
    history: [{ kind: 'climate', title: 'Anterior', submittedAt: createdAt }],
  });
  assert.equal(surveys.openClimate[0].questions[0].id, 11);
  assert.equal(surveys.openPulse[0].questions[0].id, 12);
  assert.equal(surveys.history[0].submittedAt, '2026-09-28T12:00:00.000Z');
});

test('employee profile returns a numeric id and an ISO birth date', async () => {
  const db = { query: async () => ({ rowCount: 1, rows: [{
    candidateId: '15', fullName: 'Marina Costa', email: 'marina.costa@app-colaborador.demo',
    phone: '+55 11 98700-1001', linkedinUrl: 'https://linkedin.com/in/marina-costa',
    city: 'São Paulo', state: 'SP', birthDate: new Date('1992-04-21T00:00:00.000Z'),
    preferredLocale: 'pt-BR', hasPassword: true, companyName: 'App Colaborador', companyLogoUrl: null,
  }] }) };
  const profile = await getEmployeeProfile(db, { companyId: 1, candidateId: 15 });
  assert.equal(profile.ok, true);
  assert.equal(profile.person.candidateId, 15);
  assert.equal(profile.person.birthDate, '1992-04-21');
  assert.equal(profile.person.city, 'São Paulo');
});
