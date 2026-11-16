import { describe, expect, it } from 'vitest';
import { VtesEngine, type GameState } from '../../src/engine/index.ts';
import { makeMinion, runTrace, testRegistry, threeSeatGame } from '../engine/fixtures.ts';

function setup() {
 const state=threeSeatGame();
 const actor=state.seats[0]!.minions[0]!;
 Object.assign(actor,{strength:0,blood:5,disciplines:{pre:'superior'}});
 const blocker=state.seats[1]!.minions.find(m=>m.id==='M')!;
 Object.assign(blocker,{strength:0,blood:5,disciplines:{ani:'superior',cel:'superior'}});
 state.seats[0]!.hand.push({id:'majesty',name:'Majesty'});
 state.seats[1]!.hand.push({id:'cats',name:"Cats' Guidance"},{id:'psyche',name:'Psyche!'});
 const engine=new VtesEngine(state,testRegistry);
 runTrace(engine,[["Alice","bleed:V1"],["Alice","pass"],["Bob","pass"],["Carol","pass"],
 ["Alice","pass"],["Bob","block:M"],["Alice","pass"],["Bob","pass"],["Carol","pass"]]);
 return {state,engine,actor,blocker};
}
function advance(e:VtesEngine, pred:()=>boolean, max=200) {
 for(let i=0;i<max&&!pred();i++){
  const d=e.decision(); if(!d) throw Error('missing decision');
  const p=d.options.find(o=>o.id==='pass') ?? d.options.find(o=>o.id==='strike:hand');
  if(!p)throw Error(`${d.window} ${d.seat} ${d.options.map(o=>o.id)}`);
  e.choose(p.id);
 }
 expect(pred()).toBe(true);
}
describe('Psyche! and post-block reactions',()=>{
 it('follows a combat-ending strike and keeps the action alive until the second combat and Cats Guidance',()=>{
  const {state,engine}=setup();
  advance(engine,()=>engine.decision()?.options.some(o=>o.id.startsWith('play:Majesty:basic'))===true);
  engine.choose(engine.decision()!.options.find(o=>o.id.startsWith('play:Majesty:basic'))!.id);
  advance(engine,()=>engine.decision()?.options.some(o=>o.id.startsWith('play:Psyche!:superior'))===true);
  engine.choose(engine.decision()!.options.find(o=>o.id.startsWith('play:Psyche!:superior'))!.id);
  advance(engine,()=>state.eventLog.filter(e=>e.type==='CombatBegan').length===2);
  expect(state.eventLog.filter(e=>e.type==='CombatEnded')).toHaveLength(1);
  expect(state.eventLog.some(e=>e.type==='ActionResolved')).toBe(false);
  expect(engine.decision()!.options.some(o=>o.id.startsWith("play:Cats' Guidance:basic"))).toBe(false);
  const resumed=new VtesEngine(JSON.parse(JSON.stringify(state)) as GameState,testRegistry);
  advance(resumed,()=>resumed.decision()?.window==='action.afterResolution' && resumed.decision()?.seat==='Bob');
  expect(resumed.state.eventLog.filter(e=>e.type==='CombatEnded')).toHaveLength(2);
  const cats=resumed.decision()!.options.find(o=>o.id.startsWith("play:Cats' Guidance:basic:M"));
  expect(cats).toBeDefined(); resumed.choose(cats!.id);
  advance(resumed,()=>!resumed.state.seats[1]!.minions.find(m=>m.id==='M')!.locked);
 });
 it('loses Catatonic Fear’s post-combat damage when Psyche schedules a new combat',()=>{
  const {state,engine,blocker}=setup();
  state.seats[0]!.hand=state.seats[0]!.hand.filter(c=>c.name!=='Majesty');
  state.seats[0]!.hand.push({id:'fear',name:'Catatonic Fear'});
  advance(engine,()=>engine.decision()?.options.some(o=>o.id.startsWith('play:Catatonic Fear:superior'))===true);
  engine.choose(engine.decision()!.options.find(o=>o.id.startsWith('play:Catatonic Fear:superior'))!.id);
  advance(engine,()=>engine.decision()?.options.some(o=>o.id.startsWith('play:Psyche!:superior'))===true);
  engine.choose(engine.decision()!.options.find(o=>o.id.startsWith('play:Psyche!:superior'))!.id);
  advance(engine,()=>state.eventLog.filter(e=>e.type==='CombatBegan').length===2);
  expect(blocker.blood).toBe(5);
 });
 it('loses Form of Mist continuation, and cannot queue a second combat or continue the first',()=>{
  const {state,engine,actor}=setup();
  actor.disciplines.pro='superior'; actor.disciplines.cel='superior'; actor.disciplines.aus='superior';
  state.seats[0]!.hand=state.seats[0]!.hand.filter(c=>c.name!=='Majesty');
  state.seats[0]!.hand.push({id:'mist',name:'Form of Mist'},{id:'psyche2',name:'Psyche!'},{id:'tracking',name:'Telepathic Tracking'});
  advance(engine,()=>engine.decision()?.options.some(o=>o.id.startsWith('play:Form of Mist:superior'))===true);
  engine.choose(engine.decision()!.options.find(o=>o.id.startsWith('play:Form of Mist:superior'))!.id);
  advance(engine,()=>engine.decision()?.seat==='Bob' && engine.decision()?.options.some(o=>o.id.startsWith('play:Psyche!:superior'))===true);
  engine.choose(engine.decision()!.options.find(o=>o.id.startsWith('play:Psyche!:superior'))!.id);
  advance(engine,()=>engine.decision()?.seat==='Alice' && state.frames.some(f=>f.kind==='combat' && !!f.queuedFollowupCombat));
  const opts=engine.decision()!.options;
  expect(opts.some(o=>o.id.startsWith('play:Psyche!:superior'))).toBe(false);
  expect(opts.some(o=>o.id.startsWith('play:Telepathic Tracking:superior'))).toBe(false);
  advance(engine,()=>state.eventLog.filter(e=>e.type==='CombatBegan').length===2);
  expect(actor.blood).toBe(5);
  const af=state.frames.find(f=>f.kind==='action');
  expect(af?.kind==='action' && af.step).toBe('blocked');
 });

 it('starts the queued combat without an action frame after a rush',()=>{
  const state=threeSeatGame();
  const actor=state.seats[0]!.minions[0]!;
  Object.assign(actor,{strength:0,blood:5,disciplines:{cel:'superior'}});
  const foe=state.seats[1]!.minions.find(m=>m.id==='M')!;
  Object.assign(foe,{strength:0,blood:5,locked:true});
  state.seats[0]!.hand.push({id:'ambush',name:'Ambush'},{id:'psyche',name:'Psyche!'});
  const engine=new VtesEngine(state,testRegistry);
  const rush=engine.decision()!.options.find(o=>o.kind==='playCard' && o.name==='Ambush' && o.params.target==='M');
  expect(rush).toBeDefined();engine.choose(rush!.id);
  advance(engine,()=>engine.decision()?.options.some(o=>o.id.startsWith('play:Psyche!:superior'))===true);
  expect(state.frames.some(f=>f.kind==='action')).toBe(false);
  engine.choose(engine.decision()!.options.find(o=>o.id.startsWith('play:Psyche!:superior'))!.id);
  advance(engine,()=>state.frames.some(f=>f.kind==='combat' && !!f.queuedFollowupCombat));
  const copy=JSON.parse(JSON.stringify(state)) as GameState;
  const resumed=new VtesEngine(copy,testRegistry);
  advance(resumed,()=>copy.eventLog.filter(e=>e.type==='CombatBegan').length===2);
  expect(copy.frames.some(f=>f.kind==='combat')).toBe(true);
 });

 it('waits for a real Hedonism combat after a different vampire blocks',()=>{
  const state=threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, {strength:0,blood:5});
  state.seats[0]!.minions.push(makeMinion('helper','Alice',{blood:5,strength:0,disciplines:{for:'basic'}}));
  const m=state.seats[1]!.minions.find(v=>v.id==='M')!;
  const w=state.seats[1]!.minions.find(v=>v.id==='W')!;
  Object.assign(m,{strength:0,blood:5});
  Object.assign(w,{strength:0,blood:5,disciplines:{ani:'basic'}});
  state.seats[0]!.hand.push({id:'hed',name:'Hedonism'});
  state.seats[1]!.hand.push({id:'cats',name:"Cats' Guidance"});
  const engine=new VtesEngine(state,testRegistry);
  runTrace(engine,[["Alice","bleed:V1"],["Alice","pass"],["Bob","pass"],["Carol","pass"],
    ["Alice","pass"],["Bob","block:M"]]);
  const hed=engine.decision()!.options.find(o=>o.kind==='playCard' && o.name==='Hedonism' && o.minion==='helper');
  expect(hed).toBeDefined();engine.choose(hed!.id);
  advance(engine,()=>engine.decision()?.seat==='Bob' && engine.decision()?.options.some(o=>o.id==='block:W')===true);
  engine.choose('block:W');
  advance(engine,()=>state.eventLog.filter(e=>e.type==='CombatBegan').length===2);
  const combats=state.eventLog.filter(e=>e.type==='CombatBegan');
  expect(combats[0]).toMatchObject({acting:'V1',opposing:'W'});
  expect(combats[1]).toMatchObject({acting:'helper',opposing:'M'});
  expect(state.eventLog.some(e=>e.type==='ActionResolved')).toBe(false);
  advance(engine,()=>engine.decision()?.window==='action.afterResolution' && engine.decision()?.seat==='Bob');
  expect(engine.decision()!.options.some(o=>o.id.startsWith("play:Cats' Guidance:basic:W"))).toBe(true);
 });

 for (const card of ['Telepathic Tracking', 'Hunting the Quarry'] as const) {
  it(`allows ${card} to continue a combat while Hedonism's combat is queued`,()=>{
   const state=threeSeatGame();
   const actor=state.seats[0]!.minions[0]!;
   Object.assign(actor,{strength:0,blood:7,capacity:10,disciplines:{pre:'basic',aus:'superior',cel:'superior'}});
   state.seats[0]!.minions.push(makeMinion('helper','Alice',{blood:5,strength:0,disciplines:{for:'basic'}}));
   Object.assign(state.seats[1]!.minions.find(v=>v.id==='M')!,{strength:0,blood:5});
   Object.assign(state.seats[1]!.minions.find(v=>v.id==='W')!,{strength:0,blood:5});
   state.seats[0]!.hand.push({id:'hed',name:'Hedonism'},{id:'majesty',name:'Majesty'},
     {id:'continue',name:card},{id:'psyche3',name:'Psyche!'});
   const engine=new VtesEngine(state,testRegistry);
   runTrace(engine,[["Alice","bleed:V1"],["Alice","pass"],["Bob","pass"],["Carol","pass"],
     ["Alice","pass"],["Bob","block:M"]]);
   engine.choose(engine.decision()!.options.find(o=>o.kind==='playCard' && o.name==='Hedonism' && o.minion==='helper')!.id);
   advance(engine,()=>engine.decision()?.seat==='Bob' && engine.decision()?.options.some(o=>o.id==='block:W')===true);
   engine.choose('block:W');
   advance(engine,()=>engine.decision()?.options.some(o=>o.id.startsWith('play:Majesty:basic'))===true);
   engine.choose(engine.decision()!.options.find(o=>o.id.startsWith('play:Majesty:basic'))!.id);
   advance(engine,()=>engine.decision()?.options.some(o=>o.id.startsWith(`play:${card}:superior`))===true);
   expect(engine.decision()!.options.some(o=>o.id.startsWith('play:Psyche!:superior'))).toBe(false);
   engine.choose(engine.decision()!.options.find(o=>o.id.startsWith(`play:${card}:superior`))!.id);
   advance(engine,()=>state.frames.some(f=>f.kind==='combat' && f.round===2));
   expect(state.eventLog.filter(e=>e.type==='CombatBegan')).toHaveLength(1);
   advance(engine,()=>state.eventLog.filter(e=>e.type==='CombatBegan').length===2);
   expect(state.eventLog.filter(e=>e.type==='CombatBegan')[1]).toMatchObject({acting:'helper',opposing:'M'});
  });
 }

 it('loses Catatonic Fear damage when Tracking continues its combat',()=>{
  const {state,engine,actor,blocker}=setup();
  actor.disciplines.aus='superior';
  state.seats[0]!.hand=state.seats[0]!.hand.filter(c=>c.name!=='Majesty');
  state.seats[0]!.hand.push({id:'fear',name:'Catatonic Fear'},{id:'tracking',name:'Telepathic Tracking'});
  advance(engine,()=>engine.decision()?.options.some(o=>o.id.startsWith('play:Catatonic Fear:superior'))===true);
  engine.choose(engine.decision()!.options.find(o=>o.id.startsWith('play:Catatonic Fear:superior'))!.id);
  advance(engine,()=>engine.decision()?.options.some(o=>o.id.startsWith('play:Telepathic Tracking:superior'))===true);
  engine.choose(engine.decision()!.options.find(o=>o.id.startsWith('play:Telepathic Tracking:superior'))!.id);
  advance(engine,()=>state.frames.some(f=>f.kind==='combat' && f.round===2));
  advance(engine,()=>!state.frames.some(f=>f.kind==='combat'));
  expect(blocker.blood).toBe(5);
 });

 it('cannot continue the action with Form of Mist while Hedonism combat remains queued',()=>{
  const state=threeSeatGame();
  const actor=state.seats[0]!.minions[0]!;
  Object.assign(actor,{strength:0,blood:7,capacity:10,disciplines:{pro:'superior'}});
  state.seats[0]!.minions.push(makeMinion('helper','Alice',{blood:5,strength:0,disciplines:{for:'basic'}}));
  Object.assign(state.seats[1]!.minions.find(v=>v.id==='M')!,{strength:0,blood:5});
  Object.assign(state.seats[1]!.minions.find(v=>v.id==='W')!,{strength:0,blood:5});
  state.seats[0]!.hand.push({id:'hed',name:'Hedonism'},{id:'mist',name:'Form of Mist'});
  const engine=new VtesEngine(state,testRegistry);
  runTrace(engine,[["Alice","bleed:V1"],["Alice","pass"],["Bob","pass"],["Carol","pass"],
    ["Alice","pass"],["Bob","block:M"]]);
  engine.choose(engine.decision()!.options.find(o=>o.kind==='playCard' && o.name==='Hedonism' && o.minion==='helper')!.id);
  advance(engine,()=>engine.decision()?.seat==='Bob' && engine.decision()?.options.some(o=>o.id==='block:W')===true);
  engine.choose('block:W');
  advance(engine,()=>engine.decision()?.options.some(o=>o.id.startsWith('play:Form of Mist:superior'))===true);
  engine.choose(engine.decision()!.options.find(o=>o.id.startsWith('play:Form of Mist:superior'))!.id);
  advance(engine,()=>state.eventLog.filter(e=>e.type==='CombatBegan').length===2);
  expect(actor.blood).toBe(7);
  expect(state.eventLog.some(e=>e.type==='ActionContinued')).toBe(false);
  const af=state.frames.find(f=>f.kind==='action');
  expect(af?.kind==='action' && af.step).toBe('blocked');
 });

 it('resolves a successful bleed before queued Hedonism combat, but keeps the action until combat ends',()=>{
  const state=threeSeatGame();
  const actor=state.seats[0]!.minions[0]!;
  Object.assign(actor,{strength:0,blood:5,disciplines:{for:'basic'}});
  state.seats[0]!.minions.push(makeMinion('helper','Alice',{blood:5,strength:0,disciplines:{for:'basic'}}));
  Object.assign(state.seats[1]!.minions.find(v=>v.id==='M')!,{strength:0,blood:5});
  state.seats[0]!.hand.push({id:'hed',name:'Hedonism'},{id:'freak',name:'Freak Drive'});
  const engine=new VtesEngine(state,testRegistry);
  runTrace(engine,[["Alice","bleed:V1"],["Alice","pass"],["Bob","pass"],["Carol","pass"],
    ["Alice","pass"],["Bob","block:M"]]);
  const hed=engine.decision()!.options.find(o=>o.kind==='playCard' && o.name==='Hedonism' && o.minion==='helper');
  expect(hed).toBeDefined();engine.choose(hed!.id);
  advance(engine,()=>state.eventLog.some(e=>e.type==='CombatBegan'));
  expect(state.seats[1]!.pool).toBe(9);
  expect(state.frames.some(f=>f.kind==='action')).toBe(true);
  expect(state.eventLog.some(e=>e.type==='ActionResolved')).toBe(false);
  const resumed=new VtesEngine(JSON.parse(JSON.stringify(state)) as GameState,testRegistry);
  advance(resumed,()=>resumed.decision()?.options.some(o=>o.id.startsWith('play:Freak Drive:basic'))===true);
  const events=resumed.state.eventLog;
  expect(events.findIndex(e=>e.type==='CombatEnded')).toBeLessThan(events.findIndex(e=>e.type==='ActionResolved'));
  expect(resumed.state.seats[1]!.pool).toBe(9);
 });

 it('allows Form of Mist to continue the action from the final Psyche combat',()=>{
  const {state,engine,actor}=setup();
  actor.disciplines.pro='superior';
  state.seats[0]!.hand.push({id:'mist',name:'Form of Mist'});
  advance(engine,()=>engine.decision()?.options.some(o=>o.id.startsWith('play:Majesty:basic'))===true);
  engine.choose(engine.decision()!.options.find(o=>o.id.startsWith('play:Majesty:basic'))!.id);
  advance(engine,()=>engine.decision()?.options.some(o=>o.id.startsWith('play:Psyche!:superior'))===true);
  engine.choose(engine.decision()!.options.find(o=>o.id.startsWith('play:Psyche!:superior'))!.id);
  advance(engine,()=>state.eventLog.filter(e=>e.type==='CombatBegan').length===2);
  advance(engine,()=>engine.decision()?.options.some(o=>o.id.startsWith('play:Form of Mist:superior'))===true);
  const before = actor.blood;
  engine.choose(engine.decision()!.options.find(o=>o.id.startsWith('play:Form of Mist:superior'))!.id);
  advance(engine,()=>{
    const af=state.frames.find(f=>f.kind==='action');
    return af?.kind==='action' && af.step==='A' && af.blockedBy===null;
  });
  expect(actor.blood).toBe(before-1);
 });

});
