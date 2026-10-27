import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KUDO_REACTION_EMOJIS, KUDO_QUICK_REACTION_EMOJIS, supportsExpandedKudoReactions } from '../../lib/kudo-reaction-options.js';
import { mobileCommunityBody } from '../../lib/mobile/mobile-employee-payload.js';

test('only an explicit capability opts an installed mobile client into the expanded domain', () => {
  assert.equal(supportsExpandedKudoReactions(new Request('https://example.test')), false);
  assert.equal(supportsExpandedKudoReactions(new Request('https://example.test', { headers: { 'X-Kudo-Reaction-Catalog': '2' } })), true);
  assert.equal(new Set(KUDO_REACTION_EMOJIS).size, KUDO_REACTION_EMOJIS.length);
  assert.deepEqual(KUDO_REACTION_EMOJIS.slice(0,KUDO_QUICK_REACTION_EMOJIS.length), KUDO_QUICK_REACTION_EMOJIS);
});
test('legacy feed schemas never receive unsupported emojis; opt-in clients retain all choices', () => {
  const input={posts:[],postTotal:0,kudos:[{id:1,fromCandidateId:2,toCandidateId:3,reactions:[{emoji:'👍',count:1,mine:false},{emoji:'🚀',count:2,mine:true}]}],kudosTotal:1,colleagues:[]};
  const legacy=mobileCommunityBody(input);
  assert.equal(legacy.reactionCatalogVersion,1);
  assert.deepEqual(legacy.kudos[0].reactions.map(row=>row.emoji),['👍']);
  const expanded=mobileCommunityBody({...input,expandedReactions:true});
  assert.equal(expanded.reactionCatalogVersion,2);
  assert.deepEqual(expanded.kudos[0].reactions.map(row=>row.emoji),['👍','🚀']);
});
