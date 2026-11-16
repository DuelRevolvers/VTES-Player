import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function setup(actorBlood = 5, reactorCapacity = 4) {
  const state = threeSeatGame();
  const actor = state.seats[0]!.minions[0]!;
  const reactor = state.seats[1]!.minions.find(m => m.id === "W")!;
  actor.capacity = 10; actor.blood = actorBlood;
  reactor.capacity = reactorCapacity; reactor.blood = 4;
  const crypt = testRegistry["Mithras (G3)"]!.cryptEntry!();
  actor.attached.push({ card: { id: "mithras", name: "Mithras (G3)" }, locked: false, usedThisPhase: false, statics: crypt.statics, tags: crypt.tags });
  state.seats[1]!.hand.push({ id: "d1", name: "Deflection" }, { id: "d2", name: "Deflection" });
  return { state, actor, reactor, engine: new VtesEngine(state, testRegistry) };
}
function playDeflection(engine: VtesEngine, card: string) {
  runTrace(engine, [["Alice", "pass"], ["Bob", `play:Deflection:superior:W:Carol:${card}`]]);
  expect(engine.decision()!.window).toBe("card.asPlayed");
  expect(engine.decision()!.seat).toBe("Alice");
}
const cancel = "ability:Mithras (G3):mithras:cancelReaction";
function atReaction(engine: VtesEngine) {
  runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
  playDeflection(engine, "d1");
}
function finishPending(engine: VtesEngine) {
  for (let i = 0; i < 10 && engine.decision()?.window === "card.asPlayed"; i++) engine.choose("pass");
}

describe("Mithras (G3) reaction cancellation", () => {
  it("burns 2 blood, cancels a younger vampire's reaction and refunds its cost, including after restore", () => {
    const { state, engine } = setup();
    atReaction(engine);
    expect(engine.decision()!.options.some(o => o.id === cancel)).toBe(true);
    const restored = JSON.parse(JSON.stringify(state)) as GameState;
    const resumed = new VtesEngine(restored, testRegistry);
    resumed.choose(cancel);
    finishPending(resumed);
    expect(restored.seats[0]!.minions[0]!.blood).toBe(3);
    expect(restored.seats[1]!.minions.find(m => m.id === "W")!.blood).toBe(4);
    expect(restored.eventLog.some(e => e.type === "CardCanceled" && e.cardId === "d1")).toBe(true);
    const af = restored.frames.find(f => f.kind === "action");
    expect(af?.kind === "action" && af.target).toBe("Bob");
  });
  it("does not cancel an action modifier, even during his own action", () => {
    const { state, engine } = setup();
    state.seats[0]!.hand.push({ id: "c", name: "Conditioning" });
    runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "play:Conditioning"]]);
    expect(engine.decision()!.window).toBe("card.asPlayed");
    expect(engine.decision()!.options.some(o => o.id === cancel)).toBe(false);
  });
  it("does not cancel reactions during another minion's action", () => {
    const { state, engine } = setup();
    const other = makeMinion("other", "Alice");
    state.seats[0]!.minions.push(other);
    runTrace(engine, [["Alice", `bleed:${other.id}`], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    playDeflection(engine, "d1");
    expect(engine.decision()!.options.some(o => o.id === cancel)).toBe(false);
  });
  it.each([10, 11])("does not cancel a vampire with capacity %i", capacity => {
    const { engine } = setup(5, capacity);
    atReaction(engine);
    expect(engine.decision()!.options.some(o => o.id === cancel)).toBe(false);
  });
  it("requires 2 blood and uses current capacity", () => {
    const low = setup(1);
    atReaction(low.engine);
    expect(low.engine.decision()!.options.some(o => o.id === cancel)).toBe(false);
    const boosted = setup(5, 9);
    boosted.reactor.attached.push({ card: { id: "boost", name: "test" }, locked: false, usedThisPhase: false, statics: { capacityBonus: 1 }, tags: [] });
    atReaction(boosted.engine);
    expect(boosted.engine.decision()!.options.some(o => o.id === cancel)).toBe(false);
  });
  it("is limited to one use per action", () => {
    const { state, engine } = setup();
    atReaction(engine);
    engine.choose(cancel);
    finishPending(engine);
    const af = state.frames.find(f => f.kind === "action");
    expect(af?.kind === "action" && af.usedInPlayAbilities).toContain("mithras");
    // Reset the card name's once-per-action reaction restriction to isolate
    // Mithras's own latch, then re-enter the same reaction window.
    if (af?.kind === "action") af.played = [];
    for (let i = 0; i < 12; i++) {
      const dp = engine.decision()!;
      const other = dp.options.find(o => o.id.startsWith("play:Deflection:superior:W:Carol:d2"));
      if (other) { engine.choose(other.id); break; }
      engine.choose("pass");
    }
    expect(engine.decision()!.window).toBe("card.asPlayed");
    expect(engine.decision()!.options.some(o => o.id === cancel)).toBe(false);
  });
});
