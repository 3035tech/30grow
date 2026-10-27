import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyResultProgress, okrRollup } from '../../lib/development/okr-metrics.js';

test('numeric OKRs: increase, decrease, bounds and invalid baseline', () => {
  assert.equal(keyResultProgress(10,30,20),50);
  assert.equal(keyResultProgress(10,5,7.5),50);
  assert.equal(keyResultProgress(10,5,1),100);
  assert.equal(keyResultProgress(10,5,12),0);
  assert.equal(keyResultProgress(-10,10,0),50);
  assert.equal(keyResultProgress(0,3,1),33.33);
  assert.equal(keyResultProgress(0,0,5),null);
  assert.equal(keyResultProgress(null,10,5),null);
  assert.equal(keyResultProgress(0,10,Infinity),null);
});
test('hierarchy rollups exclude empty nodes and zero-weight KRs', () => {
  assert.equal(okrRollup([]),null);
  assert.equal(okrRollup([{progressPct:null},{progressPct:50}]),50);
  assert.equal(okrRollup([{progressPct:100,weight:0}],true),null);
  assert.equal(okrRollup([{progressPct:100,weight:1},{progressPct:0,weight:3}],true),25);
  assert.equal(okrRollup([{progressPct:100,weight:0},{progressPct:50,weight:2}],true),50);
});
