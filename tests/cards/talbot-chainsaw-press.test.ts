import { describe, expect, it } from "vitest";
import type { CombatFrame } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

// Talbot's Chainsaw (101931): "The bearer gets 1 press (mandatory), only usable
// to continue combat during the first round." Round 1 must not end the combat
// without it; after the first round the credit is gone.

function combatFrame(state: ReturnType<typeof threeSeatGame>): CombatFrame {
  const cf = state.frames.find((f) => f.kind === "combat");
  if (cf?.kind !== "combat") throw new Error("no combat");
  return cf;
}

function setup() {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  v1.blood = 5;
  const handler = testRegistry["Talbot's Chainsaw"]!;
  v1.attached.push({
    card: { id: "tc", name: "Talbot's Chainsaw" },
    locked: false,
    usedThisPhase: false,
    statics: handler.permanentStatics ?? {},
    tags: ["weapon", "melee", "Talbot's Chainsaw"],
  } as unknown as (typeof v1.attached)[number]);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"],
    ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  // Strikes are chosen (hand strike), then pass through to the press step.
  for (let i = 0; i < 40 && engine.decision()!.window !== "combat.press"; i++) {
    const dp = engine.decision()!;
    engine.choose(dp.options.find((o) => o.id === "strike:hand")?.id ?? dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id);
  }
  return { state, engine };
}

describe("Talbot's Chainsaw (101931): the first-round mandatory press", () => {
  it("in round 1 the bearer must press to continue — passing is not offered", () => {
    const { state, engine } = setup();
    expect(engine.decision()!.window).toBe("combat.press");
    expect(engine.decision()!.seat).toBe("Alice");
    expect(combatFrame(state).round).toBe(1);
    expect(engine.decision()!.options.map((o) => o.id)).toEqual(["press:continue"]);
  });

  it("the credit does not carry into round 2", () => {
    const { state, engine } = setup();
    engine.choose("press:continue");
    // Let the rest of round 1 pass and reach the next round.
    for (let i = 0; i < 40 && combatFrame(state).round === 1; i++) {
      const dp = engine.decision()!;
      engine.choose(dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id);
    }
    expect(combatFrame(state).round).toBe(2);
    expect(combatFrame(state).mandatoryFirstRoundPresses).toEqual({ acting: 0, opposing: 0 });
    // Round 2: at the press step the bearer may pass; no forced continue.
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision()!;
      if (dp.window === "combat.press" && dp.seat === "Alice") {
        expect(dp.options.map((o) => o.id)).not.toContain("press:continue");
        expect(dp.options.map((o) => o.id)).toContain("pass");
        return;
      }
      engine.choose(dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id);
    }
    throw new Error("round 2 press step not reached");
  });
});
