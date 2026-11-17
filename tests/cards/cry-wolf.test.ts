/**
 * Cry Wolf (100475): "If the action to recruit this ally is blocked, the
 * acting anarch goes to torpor. … This werewolf does not unlock as normal
 * during your unlock phase. If he is locked during your unlock phase, burn
 * him." (Batch 4: the mandatory Ⓓ rush is still not modelled.)
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}
function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}
function setupRecruit() {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { sect: "anarch", blood: 5, disciplines: {} });
  state.seats[0]!.hand.push({ id: "cw", name: "Cry Wolf" });
  const engine = new VtesEngine(state, testRegistry);
  return { state, engine };
}

describe("Cry Wolf (100475)", () => {
  it("a blocked recruit sends the acting anarch to torpor and does not bring the werewolf in", () => {
    const { state, engine } = setupRecruit();
    // Bob's vampire M blocks; a Scope gives the intercept the block needs.
    find(state, "M").attached.push({ card: { id: "scope", name: "Scope" }, locked: false, usedThisPhase: false, statics: { intercept: 3 }, tags: [] });
    const play = optionIds(engine).find((o) => o.startsWith("play:Cry Wolf") && o.includes(":V1"));
    expect(play).toBeDefined();
    engine.choose(play!);
    for (let i = 0; i < 20 && optionIds(engine).some((o) => o.includes("block:")) === false && state.frames.some((f) => f.kind === "action" || f.kind === "cardPlay"); i++) {
      const dp = engine.decision();
      if (!dp) break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    const blockOpt = optionIds(engine).find((o) => o.startsWith("block:M"));
    if (!blockOpt) throw new Error(`no block offered: ${optionIds(engine).join(", ")}`);
    engine.choose(blockOpt);
    for (let i = 0; i < 40 && state.frames.some((f) => f.kind === "action" || f.kind === "cardPlay" || f.kind === "blockAttempt"); i++) {
      const dp = engine.decision();
      if (!dp) break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    expect(find(state, "V1").inTorpor).toBe(true);
    expect(state.seats.flatMap((s) => s.minions).some((m) => m.id === "cw")).toBe(false);
  });
});

describe("Cry Wolf recruited without a block (control)", () => {
  it("enters play and the recruiter stays ready", () => {
    const { state, engine } = setupRecruit();
    const play = optionIds(engine).find((o) => o.startsWith("play:Cry Wolf") && o.includes(":V1"));
    engine.choose(play!);
    for (let i = 0; i < 40 && state.frames.some((f) => f.kind === "action" || f.kind === "cardPlay" || f.kind === "blockAttempt"); i++) {
      const dp = engine.decision();
      if (!dp) break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    expect(state.seats.flatMap((s) => s.minions).some((m) => m.id === "cw")).toBe(true);
    expect(find(state, "V1").inTorpor).toBeFalsy();
  });
});

describe("Cry Wolf in the unlock phase", () => {
  function inPlay(locked: boolean) {
    const state = threeSeatGame();
    const cw = makeAlly("cw", "Alice", 3);
    cw.name = "Cry Wolf";
    cw.locked = locked;
    state.seats[0]!.minions.push(cw);
    cw.attached.push({ card: { id: "cw", name: "Cry Wolf" }, locked: false, usedThisPhase: false,
      statics: testRegistry["Cry Wolf"]!.permanentStatics ?? {}, tags: testRegistry["Cry Wolf"]!.permanentTags ?? [] });
    const turn = state.frames[0]!;
    if (turn.kind !== "turn") throw new Error("no turn");
    Object.assign(turn, { phase: "unlock", unlockDone: false, unlockAbilitiesDone: false });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("is burned if still locked at the unlock phase", () => {
    const { state, engine } = inPlay(true);
    engine.decision();
    expect(state.seats[0]!.minions.some((m) => m.id === "cw")).toBe(false);
  });

  it("is not unlocked by the unlock phase, and survives unlocked", () => {
    const { state, engine } = inPlay(false);
    engine.decision();
    expect(state.seats[0]!.minions.some((m) => m.id === "cw")).toBe(true);
    expect(find(state, "cw").locked).toBe(false);
  });
});
