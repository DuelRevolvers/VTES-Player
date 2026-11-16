import { describe, expect, it } from "vitest";
import { VtesEngine, currentBleed, prospectiveBleed } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function setup(self = false) {
  const state = threeSeatGame();
  const andre = self ? state.seats[0]!.minions[0]! : makeMinion("andre", "Alice", { blood: 5 });
  if (!self) state.seats[0]!.minions.push(andre);
  const crypt = testRegistry["Andre LeRoux (G5)"]!.cryptEntry!();
  andre.attached.push({card:{id:'andre-card',name:'Andre LeRoux (G5)'}, locked:false, usedThisPhase:false, statics:crypt.statics,tags:crypt.tags});
  const engine = new VtesEngine(state,testRegistry);
  return { state, andre, engine };
}
const ability='ability:Andre LeRoux (G5):andre-card:reduce';
function walk(engine:VtesEngine,pred:()=>boolean,max=80) {
  for(let i=0; i<max && !pred(); i++) {
    const dp=engine.decision(); if(!dp) break;
    const opt=dp.options.find(o=>o.id==='pass'); if(!opt) throw Error(`${dp.window}: ${dp.options.map(o=>o.id)}`);
    engine.choose(opt.id);
  }
  expect(pred()).toBe(true);
}
describe('Andre LeRoux',()=>{
  it('has no permanent bleed bonus and can reduce another vampire bleed to zero once',()=>{
    const {state,andre,engine}=setup();
    expect(prospectiveBleed(state,andre,'Bob')).toBe(1);
    engine.choose('bleed:V1');
    walk(engine,()=>engine.decision()?.options.some(o=>o.id===ability)===true);
    const copy=JSON.parse(JSON.stringify(state)); const resumed=new VtesEngine(copy,testRegistry);
    resumed.choose(ability);
    const af=copy.frames.find((f:{kind:string})=>f.kind==='action');
    expect(currentBleed(copy,af)).toBe(0);
    expect(prospectiveBleed(copy,copy.seats[0].minions.find((m:{id:string})=>m.id==='andre'),'Bob')).toBe(3);
    expect(resumed.decision()?.options.some(o=>o.id===ability)).toBe(false);
    walk(resumed,()=>copy.eventLog.some((e:{type:string})=>e.type==='ActionResolved'));
    expect(copy.seats[1].pool).toBe(10);
    expect(copy.edge).toBe(null);
  });
  it('can use its own successful bleed: minus one and plus two on the same action',()=>{
    const {state,engine}=setup(true);
    engine.choose('bleed:V1');
    walk(engine,()=>engine.decision()?.options.some(o=>o.id===ability)===true);
    engine.choose(ability);
    const af=state.frames.find(f=>f.kind==='action'); if(!af || af.kind!=='action') throw Error('action');
    expect(currentBleed(state,af)).toBe(2);
    walk(engine,()=>state.eventLog.some(e=>e.type==='ActionResolved'));
    expect(state.seats[1]!.pool).toBe(8);
  });
  it('accumulates across different bleeds and expires with the turn',()=>{
    const {state,andre,engine}=setup();
    state.seats[0]!.minions.push(makeMinion('second','Alice',{blood:5}));
    for (const id of ['V1','second']) {
      engine.choose(`bleed:${id}`);
      walk(engine,()=>engine.decision()?.options.some(o=>o.id===ability)===true);
      engine.choose(ability);
      walk(engine,()=>!state.frames.some(f=>f.kind==='action'));
    }
    expect(prospectiveBleed(state,andre,'Bob')).toBe(5);
    engine.choose('end');
    walk(engine,()=>state.frames.some(f=>f.kind==='turn' && f.phase==='discard'));
    engine.choose('pass');
    expect(prospectiveBleed(state,andre,'Bob')).toBe(1);
  });
  it('does not trigger for an ally',()=>{
    const {state,engine}=setup();
    state.seats[0]!.minions.push(makeAlly('ally','Alice',3));
    engine.choose('bleed:ally');
    const af=state.frames.find(f=>f.kind==='action'); if(!af || af.kind!=='action') throw Error('action');
    walk(engine,()=>af.step==='C');
    expect(engine.decision()?.options.some(o=>o.id===ability)).toBe(false);
  });
  it('does not activate before the would-succeed window or when bleed is zero',()=>{
    const {state,engine}=setup();
    engine.choose('bleed:V1');
    expect(engine.decision()?.options.some(o=>o.id===ability)).toBe(false);
    const af=state.frames.find(f=>f.kind==='action'); if(!af || af.kind!=='action') throw Error('action');
    engine.emit({type:'BleedAmountModified',actionId:af.actionId,delta:-1,source:'test',limited:false});
    walk(engine,()=>af.step==='C');
    expect(engine.decision()?.options.some(o=>o.id===ability)).toBe(false);
  });
  it('can use the ability from torpor but Spying Mission cannot follow a reduction to zero',()=>{
    const {state,andre,engine}=setup();
    andre.inTorpor=true;
    Object.assign(state.seats[0]!.minions[0]!, { disciplines:{obf:'superior'}, bleed: 1 });
    state.seats[0]!.hand.push({id:'spy',name:'Spying Mission'});
    engine.choose('bleed:V1');
    walk(engine,()=>engine.decision()?.options.some(o=>o.id===ability)===true);
    engine.choose(ability);
    expect(engine.decision()!.options.some(o=>o.id.startsWith('play:Spying Mission:superior'))).toBe(false);
    expect(engine.decision()!.options.some(o=>o.id.startsWith('play:Conditioning'))).toBe(false);
  });

  it('permits Spying Mission after Andre when the bleed remains positive',()=>{
    const {state,engine}=setup();
    Object.assign(state.seats[0]!.minions[0]!, { disciplines:{obf:'superior'} });
    state.seats[0]!.hand.push({id:'spy',name:'Spying Mission'});
    engine.choose('bleed:V1');
    const af=state.frames.find(f=>f.kind==='action'); if(!af || af.kind!=='action') throw Error('action');
    engine.emit({type:'BleedAmountModified',actionId:af.actionId,delta:1,source:'test',limited:false});
    walk(engine,()=>engine.decision()?.options.some(o=>o.id===ability)===true);
    engine.choose(ability);
    expect(currentBleed(state,af)).toBe(1);
    expect(engine.decision()!.options.some(o=>o.id.startsWith('play:Spying Mission:superior'))).toBe(true);
  });

});
