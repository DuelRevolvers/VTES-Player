import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const ability = "ability:Shalmath (G6):shal:unlock";
function setup(seat = 0) {
  const state = threeSeatGame();
  const m = state.seats[seat]!.minions[0]!;
  const self = testRegistry["Shalmath (G6)"]!.cryptEntry!();
  m.attached.push({ card: { id: "shal", name: "Shalmath (G6)" }, locked: false, usedThisPhase: false, statics: self.statics, tags: self.tags });
  return { state, m, entry: m.attached[m.attached.length - 1]!, engine: new VtesEngine(state, testRegistry) };
}
const has = (engine: VtesEngine) => engine.decision()!.options.some(o => o.id === ability);

describe("Shalmath (G6)", () => {
  it("unlocks in his own action, at most once per turn, and retains the use after restore", () => {
    const { state, m, engine } = setup();
    expect(has(engine)).toBe(false);
    engine.choose("bleed:V1");
    expect(m.locked).toBe(true);
    expect(has(engine)).toBe(true);
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    const resumed = new VtesEngine(saved, testRegistry);
    resumed.choose(ability);
    expect(saved.seats[0]!.minions[0]!.locked).toBe(false);
    saved.seats[0]!.minions[0]!.locked = true;
    expect(has(resumed)).toBe(false);
    resumed.emit({ type: "TurnBegan", seat: "Bob", turnNumber: 2 });
    expect(has(resumed)).toBe(true);
  });
  it("can unlock during another player's action, but not in the as-played window", () => {
    const { state, m, engine } = setup(1);
    m.locked = true;
    state.seats[0]!.hand.push({ id: "cond", name: "Conditioning" });
    runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "play:Conditioning"], ["Alice", "pass"]]);
    expect(engine.decision()!.window).toBe("card.asPlayed");
    expect(engine.decision()!.seat).toBe("Bob");
    expect(has(engine)).toBe(false);
    runTrace(engine, [["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"]]);
    expect(engine.decision()!.seat).toBe("Bob");
    expect(has(engine)).toBe(true);
    engine.choose(ability);
    expect(m.locked).toBe(false);
  });
  it("respects The Sleeping Mind's no-unlock bar until resolution", () => {
    const { state, m, engine } = setup();
    engine.choose("bleed:V1");
    const af = state.frames.find(f => f.kind === "action")!;
    if (af.kind !== "action") throw new Error("no action");
    af.noUnlock = true;
    expect(m.locked).toBe(true);
    expect(has(engine)).toBe(false);
  });
  it("works in torpor when an impulse is available and does not let him act", () => {
    const { m, engine } = setup();
    m.inTorpor = true; m.locked = true;
    expect(has(engine)).toBe(true);
    engine.choose(ability);
    expect(m.locked).toBe(false);
    expect(m.inTorpor).toBe(true);
    expect(engine.decision()!.options.some(o => o.id === "bleed:V1")).toBe(false);
  });
  it("can unlock during another Methuselah's unlock phase", () => {
    const { state, m, engine } = setup(1);
    m.locked = true;
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn");
    tf.phase = "unlock"; tf.unlockDone = false; tf.unlockAbilitiesDone = false;
    tf.unlockOthersDone = []; tf.edgeDone = false;
    for (let i = 0; i < 5 && engine.decision()!.seat !== "Bob"; i++) engine.choose("pass");
    expect(engine.decision()!.seat).toBe("Bob");
    expect(has(engine)).toBe(true);
    engine.choose(ability);
    expect(m.locked).toBe(false);
  });
});
