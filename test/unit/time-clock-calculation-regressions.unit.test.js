import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeTimeDay,pairWorkedMinutes} from '../../lib/people/time-day-summary.js';
import {TIME_DAY_OCCURRENCE} from '../../lib/domain-status.js';
const schedule={workdayStart:'09:00',workdayEnd:'18:00',breakStart:'12:00',breakEnd:'13:00',breakMinutes:60,lateGraceMinutes:10,timezone:'UTC'};
const punch=(time,punchKind)=>({punchedAt:`2026-10-05T${time}Z`,punchKind});
const morning=[punch('09:00:00','in'),punch('12:00:00','out')];
test('partial excuses exclude lunch, time already worked and time outside the workday',()=>{
 const result=(a,b)=>summarizeTimeDay({punches:morning,schedule,justification:{reason:'other',excusedStart:a,excusedEnd:b}});
 assert.equal(result('09:00','12:00').missingMinutes,300);
 assert.equal(result('12:00','13:00').missingMinutes,300);
 assert.equal(result('06:00','08:00').missingMinutes,300);
 assert.equal(result('11:00','15:00').missingMinutes,180);
 assert.equal(result('13:00','18:00').missingMinutes,0);
});
test('ambiguous and malformed partial excuses require review without waiving missing time',()=>{
 for(const sched of [{...schedule,breakStart:null,breakEnd:null},schedule]){
  const result=summarizeTimeDay({punches:morning,schedule:sched,justification:{reason:'other',excusedStart:'13:00',excusedEnd:sched===schedule?'bad':'15:00'}});
  assert.equal(result.requiresScheduleReview,true);assert.equal(result.missingMinutes,300);assert.equal(result.occurrence,TIME_DAY_OCCURRENCE.REVIEW);
 }
});
test('a full-day excuse cannot hide incomplete punches or flagged reviews',()=>{
 assert.equal(summarizeTimeDay({schedule,punches:morning.slice(0,1),justification:{reason:'other'}}).occurrence,TIME_DAY_OCCURRENCE.INCOMPLETE);
 assert.equal(summarizeTimeDay({schedule,punches:morning.map(p=>({...p,reviewStatus:'flagged'})),justification:{reason:'other'}}).occurrence,TIME_DAY_OCCURRENCE.REVIEW);
});
test('subminute intervals are summed before rounding the daily worked time',()=>{
 assert.equal(pairWorkedMinutes([punch('09:00:00','in'),punch('09:00:29','out'),punch('09:01:00','in'),punch('09:01:29','out')]),1);
});
test('holidays, absence, grace and overnight schedules remain explicit',()=>{
 assert.equal(summarizeTimeDay({schedule,punches:[],holiday:{name:'Feriado'}}).missingMinutes,0);
 assert.equal(summarizeTimeDay({schedule,punches:[]}).missingMinutes,480);
 const normal=[...morning,punch('13:00:00','in'),punch('17:55:00','out')];assert.equal(summarizeTimeDay({schedule,punches:normal}).missingMinutes,0);
 assert.equal(summarizeTimeDay({schedule:{...schedule,workdayStart:'22:00',workdayEnd:'06:00'}}).expectedMinutes,420);
});
