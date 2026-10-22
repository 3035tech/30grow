import test from 'node:test';
import assert from 'node:assert/strict';
import { oldestOverdueDays, organizeOverviewAttention } from '../../lib/overview-attention.js';

test('calendar deadlines distinguish yesterday from today and unknown age', () => {
  const now = new Date('2026-10-22T00:02:00Z');
  assert.equal(oldestOverdueDays([{dueDate:'2026-10-21'}], now), 1);
  assert.equal(oldestOverdueDays([{dueDate:'2026-10-22'}, {dueDate:null}], now), null);
  assert.equal(oldestOverdueDays([{dueDate:'invalid'}, {dueDate:'2026-10-19'}], now), 3);
});
test('repeated reminders collapse within their tenant and vacancy without exposing internal keys', () => {
  const items = [
    {id:'old',dedupeKey:'invite:A:1:person@example.test',days:12,priority:'high'},
    {id:'latest',dedupeKey:'invite:A:1:person@example.test',days:5,priority:'high'},
    {id:'other-tenant',dedupeKey:'invite:B:1:person@example.test',days:9,priority:'high'},
    {id:'other-vacancy',dedupeKey:'invite:A:2:person@example.test',days:7,priority:'high'},
    {id:'aggregate',days:null,priority:'medium'},
  ];
  const result = organizeOverviewAttention(items);
  assert.deepEqual(result.current.map(x=>x.id), ['other-tenant','other-vacancy','latest','aggregate']);
  assert.equal(result.current.at(-1).days, null);
  assert.ok(!JSON.stringify(result).includes('person@example.test'));
});
test('older alerts remain reviewable and do not displace current tasks', () => {
  const result = organizeOverviewAttention([
    {id:'old',days:91,priority:'high'}, {id:'recent',days:2,priority:'medium'},
    {id:'boundary',days:90,priority:'low'},
    {id:'active-deadline',days:120,priority:'high',overdue:true},
  ]);
  assert.deepEqual(result.current.map(x=>x.id), ['active-deadline','recent','boundary']);
  assert.deepEqual(result.older.map(x=>x.id), ['old']);
});
