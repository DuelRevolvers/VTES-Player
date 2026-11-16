import { describe, expect, it } from 'vitest';
import { VtesEngine, currentStealth } from '../../src/engine/index.ts';
import { makeMinion, runTrace, testRegistry, threeSeatGame } from '../engine/fixtures.ts';
function setup() {
 const state=threeSeatGame(); const m=state.seats[0]!.minions[0]!; m.blood=5;
 const entry=testRegistry['Nergal (G5 ADV)']!.cryptEntry!();
 m.attached.push({card:{id:'nergal',name:'Nergal (G5 ADV)'},locked:false,usedThisPhase:false,statics:entry.statics,tags:entry.tags});
 state.seats[1]!.minions.find(x=>x.id==='W')!.blood=1;
 return {state,m,engine:new VtesEngine(state,testRegistry)};
}
function walk(e:VtesEngine,pred:()=>boolean,max=80){ for(let i=0;i<max&&!pred();i++){ const dp=e.decision();if(!dp)break; const pick=dp.options.find(o=>o.id==='pass');if(!pick)throw Error(dp.window);e.choose(pick.id); } expect(pred()).toBe(true); }
const stealth='ability:Nergal (G5 ADV):nergal:stealth';
describe('Nergal advanced',()=>{
 it('taxes reaction cards only during his action, including after save/load',()=>{
  const {state,engine}=setup(); engine.choose('bleed:V1');
  walk(engine,()=>engine.decision()?.window==='action.effects' && engine.decision()?.seat==='Bob' && state.frames.some(f=>f.kind==='action' && f.step==='C'));
  expect(engine.decision()!.options.some(o=>o.id.startsWith('play:Deflection'))).toBe(false);
  state.seats[1]!.minions.find(x=>x.id==='W')!.blood=2;
  const saved=JSON.parse(JSON.stringify(state)); const resumed=new VtesEngine(saved,testRegistry);
  const option=resumed.decision()!.options.find(o=>o.kind==='playCard' && o.name==='Deflection');
  expect(option).toBeDefined(); expect(option?.kind==='playCard' && option.cost?.blood).toBe(2);
 });
 it('can burn blood for stealth only when needed, once for the action',()=>{
  const {state,m,engine}=setup();engine.choose('bleed:V1');
  expect(engine.decision()!.options.some(o=>o.id===stealth)).toBe(false);
  runTrace(engine, [['Alice','pass'],['Bob','pass'],['Carol','pass'],['Alice','pass'],['Bob','block:M']]);
  expect(engine.decision()!.options.some(o=>o.id===stealth)).toBe(true);
  const af=state.frames.find(f=>f.kind==='action'); if(!af||af.kind!=='action')throw Error('action');
  engine.choose(stealth);expect(m.blood).toBe(4);expect(currentStealth(state,af.actionId)).toBe(1);
  expect(engine.decision()!.options.some(o=>o.id===stealth)).toBe(false);
 });
 it('does not tax reactions when another vampire is acting',()=>{
  const {state,engine}=setup();
  state.seats[0]!.minions.push(makeMinion('other','Alice',{blood:3}));
  engine.choose('bleed:other');
  walk(engine,()=>engine.decision()?.window==='action.effects' && engine.decision()?.seat==='Bob' && state.frames.some(f=>f.kind==='action' && f.step==='C'));
  const option=engine.decision()!.options.find(o=>o.kind==='playCard' && o.name==='Deflection');
  expect(option).toBeDefined();expect(option?.kind==='playCard' && option.cost?.blood).toBe(1);
 });
});
