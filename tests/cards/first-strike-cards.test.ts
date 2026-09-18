/**
 * The first-strike cards (docs/first-strike-cards-design.md).
 *
 * Quick Jab (101529), Forearm Block (100763), Haymaker (100900) — the
 * three wave 28 deferred because the engine could not sequence one strike
 * ahead of another. The kernel landed in v0.10.14
 * (docs/first-strike-design.md); this is what it was for.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function combat(state: GameState): CombatFrame | undefined {
  const f = state.frames.find((x) => x.kind === "combat");
  return f?.kind === "combat" ? f : undefined;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function damageEvents(state: GameState): string[] {
  return state.eventLog
    .filter((e) => e.type === "DamageInflicted")
    .map((e) => `${e.minion}/${e.amount}`);
}

/** Alice's V1 bleeds, Bob's M blocks; combat live, close range. */
function inCombat(card: string, v1: Partial<MinionState> = {}, m: Partial<MinionState> = {}) {
  const state = threeSeatGame();
  Object.assign(find(state, "V1")!, { blood: 5, strength: 2, ...v1 });
  Object.assign(find(state, "M")!, { blood: 5, strength: 2, ...m });
  state.seats[0]!.hand.push({ id: "wave", name: card });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  combat(state)!.range = "close";
  return { state, engine };
}

/** Walk, taking `prefix` when it appears, else hand strike, else pass. */
function walk(engine: VtesEngine, state: GameState, prefix: string, limit = 24): void {
  for (let i = 0; i < limit && combat(state); i++) {
    const dp = engine.decision();
    if (!dp) return;
    const want =
      dp.options.find((o) => o.id.startsWith(prefix)) ??
      dp.options.find((o) => o.id === "strike:hand") ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options[0]!;
    runTrace(engine, [[dp.seat, want.id]]);
  }
}

// ---------------------------------------------------------------------------

describe("Quick Jab (101529)", () => {
  it("strikes first and caps its own damage at 1", () => {
    // M has 1 blood; strength 2 would torpor it, but the cap means 1
    // damage — so M survives and DOES strike back. That is the pair of
    // clauses in one assertion.
    const { state, engine } = inCombat("Quick Jab", {}, { blood: 2 });
    walk(engine, state, "play:Quick Jab");
    expect(damageEvents(state).sort()).toEqual(["M/1", "V1/2"]);
    expect(find(state, "M")!.inTorpor).toBe(false);
  });

  it("…and when the cap still kills, the victim never strikes", () => {
    // BLOOD 0, not 1: a vampire burns blood for damage and goes to
    // torpor only when the damage EXCEEDS what it has, so 1 damage on 1
    // blood leaves it ready at 0. The first draft had it at 1 and was
    // asserting a torpor the rules do not give.
    const { state, engine } = inCombat("Quick Jab", {}, { blood: 0 });
    walk(engine, state, "play:Quick Jab");
    // With nothing to burn, the capped point is still torpor — and first
    // strike means V1 takes nothing.
    expect(damageEvents(state)).toEqual(["M/1"]);
    expect(find(state, "V1")!.blood).toBe(5);
  });
});

describe("Forearm Block (100763)", () => {
  it("prevents 2 of the currently-resolving hand strike", () => {
    // M strikes for 2 and all of it is stopped; V1's own strike is the
    // Forearm Block, which deals nothing.
    const { state, engine } = inCombat("Forearm Block");
    walk(engine, state, "play:Forearm Block");
    expect(damageEvents(state)).toEqual(["V1/2"]);
    expect(state.eventLog.some((e) => e.type === "DamagePrevented")).toBe(true);
    expect(find(state, "V1")!.blood).toBe(5);
  });

  it("arms first strike for the NEXT round, across the boundary", () => {
    const { state, engine } = inCombat("Forearm Block");
    // Walk only until the card has armed it: a longer walk crosses the
    // round boundary, where the flag is consumed into `firstStrikeRound`
    // and cleared — reading it there would test the boundary, not the
    // card.
    let armed = false;
    for (let i = 0; i < 24 && combat(state) && !armed; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const want =
        dp.options.find((o) => o.id.startsWith("play:Forearm Block")) ??
        dp.options.find((o) => o.id === "strike:hand") ??
        dp.options.find((o) => o.id === "pass") ??
        dp.options[0]!;
      runTrace(engine, [[dp.seat, want.id]]);
      armed = combat(state)?.firstStrikeNextRound?.acting === true;
    }
    expect(armed).toBe(true);
  });
});

describe("Haymaker (100900)", () => {
  it("forces the hand strike and hands FIRST STRIKE to the opponent", () => {
    const { state, engine } = inCombat("Haymaker");
    // Play it in the before-strikes window.
    for (let i = 0; i < 10; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const hm = dp.options.find((o) => o.id.startsWith("play:Haymaker"));
      if (hm) {
        runTrace(engine, [[dp.seat, hm.id]]);
        break;
      }
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    // Let the card resolve, then read the frame it armed.
    for (let i = 0; i < 6 && combat(state)?.step !== "chooseStrike"; i++) {
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    const cf = combat(state)!;
    expect(cf.forcedHandStrike?.acting).toBe(1);
    // "…and the OPPOSING minion's initial strike this round gets first
    // strike" — the half that makes the card a real trade-off.
    expect(cf.firstStrikeRound?.opposing).toBe(true);
    // The forced strike is the only one offered to the acting side.
    const dp = engine.decision()!;
    if (dp.seat === "Alice" && dp.window === "combat.chooseStrike") {
      expect(optionIds(engine).filter((i) => i.startsWith("strike:"))).toEqual(["strike:hand"]);
    }
  });

  it("NEGATIVE SPACE: not offered at long range", () => {
    const { state, engine } = inCombat("Haymaker");
    combat(state)!.range = "long";
    for (let i = 0; i < 8 && combat(state); i++) {
      expect(optionIds(engine).some((o) => o.startsWith("play:Haymaker"))).toBe(false);
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
  });
});
