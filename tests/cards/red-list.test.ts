import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

// Red List (101574), Ⓓ: "Requires a ready, titled, non-Red List vampire.
// Choose a ready ally or a ready younger vampire. The chosen minion becomes
// Red List. That minion may not attempt to block this action."

function setup(opts: { titled?: boolean; actorRedList?: boolean } = {}) {
  const state = threeSeatGame();
  const actor = state.seats[0]!.minions[0]!;
  actor.blood = 5;
  actor.capacity = 5;
  if (opts.titled !== false) actor.title = "prince";
  if (opts.actorRedList) actor.redList = true;
  state.seats[0]!.hand.push({ id: "rl", name: "Red List" });
  state.seats[1]!.minions = [
    makeMinion("Y", "Bob", { capacity: 2, blood: 2 }),   // ready, younger
    makeMinion("O", "Bob", { capacity: 8, blood: 2 }),   // ready, older
    makeAlly("A", "Bob", 2),                              // ready ally
    makeMinion("T", "Bob", { inTorpor: true, capacity: 2 }), // torpor, younger
  ];
  return { state, actor, engine: new VtesEngine(state, testRegistry) };
}

/** Pass through the card play, the action and its block window. */
function finish(engine: VtesEngine) {
  for (let i = 0; i < 40; i++) {
    const dp = engine.decision();
    if (!dp) break;
    engine.choose(dp.options.find(o => o.id === "pass")?.id ?? dp.options[0]!.id);
  }
}

describe("Red List: who may play it", () => {
  it("is offered to a ready titled vampire", () => {
    const { engine } = setup();
    expect(engine.decision()!.options.some(o => o.id.startsWith("play:Red List:basic:V1:"))).toBe(true);
  });

  it("is not offered to an untitled vampire", () => {
    const { engine } = setup({ titled: false });
    expect(engine.decision()!.options.some(o => o.id.startsWith("play:Red List"))).toBe(false);
  });

  it("is not offered when the acting vampire is already Red List", () => {
    const { engine } = setup({ actorRedList: true });
    expect(engine.decision()!.options.some(o => o.id.startsWith("play:Red List"))).toBe(false);
  });
});

describe("Red List: whom it may choose", () => {
  it("offers a ready ally and a ready YOUNGER vampire, from any Methuselah", () => {
    const { engine } = setup();
    const ids = engine.decision()!.options.map(o => o.id);
    expect(ids).toContain("play:Red List:basic:V1:Y:rl");
    expect(ids).toContain("play:Red List:basic:V1:A:rl");
  });

  it("does not offer an older vampire, a torpid minion, or the actor itself", () => {
    const { engine } = setup();
    const ids = engine.decision()!.options.map(o => o.id);
    expect(ids.some(id => id.includes(":O:rl"))).toBe(false);
    expect(ids.some(id => id.includes(":T:rl"))).toBe(false);
    expect(ids.some(id => id.includes(":V1:rl"))).toBe(false);
  });
});

describe("Red List: what it does", () => {
  it("marks the chosen minion Red List on success", () => {
    const { state, engine } = setup();
    engine.choose("play:Red List:basic:V1:Y:rl");
    finish(engine);
    expect(state.seats[1]!.minions.find(m => m.id === "Y")!.redList).toBe(true);
    expect(state.seats[1]!.minions.find(m => m.id === "O")!.redList).toBeFalsy();
  });

  it("the chosen minion may not attempt to block this action", () => {
    const { state, engine } = setup();
    engine.choose("play:Red List:basic:V1:Y:rl");
    // Step to the block window, which opens only once the action is announced.
    let sawBlockWindow = false;
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const blockIds = dp.options.map(o => o.id).filter(id => id.startsWith("block:"));
      if (blockIds.length > 0) {
        sawBlockWindow = true;
        // Y is offered no block at all; the ready ally A still may.
        expect(blockIds.some(id => id === "block:Y")).toBe(false);
        break;
      }
      engine.choose(dp.options.find(o => o.id === "pass")?.id ?? dp.options[0]!.id);
    }
    expect(sawBlockWindow).toBe(true);
    const af = state.frames.find(f => f.kind === "action");
    if (!af || af.kind !== "action") throw new Error("no action frame");
    expect(af.blockRestrictions.cannotBlock).toContain("Y");
  });
});
