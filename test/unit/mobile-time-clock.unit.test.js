import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routeUrl = new URL('../../app/api/mobile/v1/employee/time-clock/route.js', import.meta.url);

test('mobile time punches preserve optional coordinates and identify the app collector', async () => {
  const source = await readFile(routeUrl, 'utf8');
  assert.match(source, /const coords = parsePunchCoordinates\(body\.latitude, body\.longitude\)/);
  assert.doesNotMatch(source, /\|\| !coords/);
  assert.match(source, /collector: '01'/);
  assert.match(source, /createTimePunch[\s\S]*latitude: coords\?\.latitude \?\? null, longitude: coords\?\.longitude \?\? null/);
});
