/**
 * Thrown objects (docs/thrown-objects-design.md).
 *
 * Sacrament of Carnage (101669), Thrown Gate (101982),
 * Mercury's Arrow (101202), Thrown Sewer Lid (101983),
 * Well-Aimed Car (102171).
 *
 * Five ranged strikes with riders. What the tests are for is the GATES: two
 * of these are long-range only and one is also not-first-round, and a gate
 * that silently does nothing looks exactly like a gate that works until you
 * put the card in the round or the range it forbids.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/**
 * Alice's V1 bleeds, Bob's M blocks, and V1 holds `card`. The instance id is
 * `thr1`, not `c1` — `threeSeatGame` already deals Alice a Conditioning with
 * that id and a play resolves by the FIRST instance of the id
 * (docs/positional-combat-design.md §5).
 */
function armed(
  card: string,
  disciplines: Record<string, "basic" | "superior">,
): { state: GameState; engine: VtesEngine; v1: MinionState; m: MinionState } {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, { blood: 4, capacity: 4, disciplines });
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  // Full, not a number picked out of the air: blood above capacity is
  // clamped, so a hardcoded 6 on a capacity-5 vampire quietly becomes 5 and
  // every damage assertion is off by one.
  m.blood = m.capacity;
  state.seats[0]!.hand.push({ id: "thr1", name: card });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"],
    ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  return { state, engine, v1, m };
}

/** The combat frame, which every test here reaches into to set the range. */
function combat(state: GameState): {
  range: "close" | "long";
  round: number;
  presses: { acting: number; opposing: number };
  pressesCombat: { acting: number; opposing: number };
  maneuverCredits: { acting: number; opposing: number };
} {
  const cf = state.frames.find((f) => f.kind === "combat");
  if (cf?.kind !== "combat") throw new Error("no combat frame");
  return cf;
}

/**
 * Let a card play RESOLVE. Choosing a strike-card option only pushes the
 * cardPlay frame; its riders are granted in `resolve`, which is after the
 * as-played window has gone round the table. Reading a credit straight after
 * `choose` reads it before the card has done anything.
 */
function settle(engine: VtesEngine, steps = 4): void {
  for (let i = 0; i < steps; i++) {
    const dp = engine.decision();
    if (!dp || dp.window !== "card.asPlayed") return;
    const pick = dp.options.find((o) => o.id === "pass");
    if (!pick) return;
    engine.choose(pick.id);
  }
}

/** Walk to the strike step and return Alice's options there. */
function atStrike(engine: VtesEngine): string[] {
  for (let i = 0; i < 12; i++) {
    const dp = engine.decision();
    if (!dp) return [];
    if (dp.window === "combat.chooseStrike") return dp.options.map((o) => o.id);
    const pick = dp.options.find((o) => o.id === "pass");
    if (!pick) return [];
    engine.choose(pick.id);
  }
  return [];
}

/** Set the range before the strike step is reached. A maneuver credit spent
 *  by Alice is the in-game way there; this is the fixture way, and the two
 *  agree because `cf.range` is what the gate reads. */
function atLongRange(state: GameState): void {
  combat(state).range = "long";
}

// ---------------------------------------------------------------------------

describe("the ungated control: Sacrament of Carnage (101669)", () => {
  it("is offered at either range, at both levels", () => {
    for (const range of ["close", "long"] as const) {
      const a = armed("Sacrament of Carnage", { pot: "superior" });
      combat(a.state).range = range;
      const ids = atStrike(a.engine);
      expect(
        ids.some((id) => id.startsWith("play:Sacrament of Carnage:basic")),
        `basic at ${range}`,
      ).toBe(true);
      expect(
        ids.some((id) => id.startsWith("play:Sacrament of Carnage:superior")),
        `superior at ${range}`,
      ).toBe(true);
    }
  });

  it("a ranged strike reaches at LONG range, where a hand strike does not", () => {
    const a = armed("Sacrament of Carnage", { pot: "superior" });
    atLongRange(a.state);
    const mBefore = a.m.blood;
    const ids = atStrike(a.engine);
    const sup = ids.find((id) => id.startsWith("play:Sacrament of Carnage:superior"))!;
    a.engine.choose(sup);
    // Bob answers with a bare hand strike, which inflicts nothing at long
    // range (p. 29) — so only Alice's 3 lands.
    for (let i = 0; i < 12; i++) {
      const dp = a.engine.decision();
      if (!dp) break;
      const pick =
        dp.options.find((o) => o.id === "strike:hand") ??
        dp.options.find((o) => o.id === "pass");
      if (!pick) break;
      a.engine.choose(pick.id);
    }
    // The 3R landed; Bob's hand strike reached nothing.
    expect(a.m.blood).toBe(mBefore - 3);
    expect(a.v1.blood).toBe(3); // 1 for the card's cost, nothing else
  });
});

describe("the maneuver rider", () => {
  it("Thrown Gate carries it at BOTH levels and Mercury's Arrow only at the inferior", () => {
    // A rider quietly copied onto the superior is invisible in a test that
    // only plays one mode, so the two cards are asserted against each other.
    for (const [card, d, supHasRider] of [
      ["Thrown Gate", { pot: "superior" as const }, true],
      ["Mercury's Arrow", { cel: "superior" as const }, false],
    ] as const) {
      for (const [mode, expected] of [
        ["basic", true],
        ["superior", supHasRider],
      ] as const) {
        const a = armed(card, d);
        const ids = atStrike(a.engine);
        const id = ids.find((x) => x.startsWith(`play:${card}:${mode}`));
        expect(id, `${card} ${mode} not offered`).toBeDefined();
        a.engine.choose(id!);
        settle(a.engine);
        expect(
          combat(a.state).maneuverCredits.acting,
          `${card} ${mode} maneuver credit`,
        ).toBe(expected ? 1 : 0);
      }
    }
  });
});

describe("the press rider is for THIS round [TOM 19960521]", () => {
  it("Thrown Sewer Lid's superior grants a per-round press, not a combat-long one", () => {
    const a = armed("Thrown Sewer Lid", { pot: "superior" });
    atLongRange(a.state);
    const ids = atStrike(a.engine);
    a.engine.choose(ids.find((id) => id.startsWith("play:Thrown Sewer Lid:superior"))!);
    settle(a.engine);
    const cf = combat(a.state);
    // "The optional press can ONLY be used during the current round." All
    // four rider sites used to grant `pressesCombat`, which survives the
    // whole combat — so the credit outlived its own sentence.
    expect(cf.presses.acting).toBe(1);
    expect(cf.pressesCombat.acting).toBe(0);
  });
});

describe("the range gate", () => {
  it("Thrown Sewer Lid is offered at long range and NOT at close", () => {
    const long = armed("Thrown Sewer Lid", { pot: "superior" });
    atLongRange(long.state);
    const atLong = atStrike(long.engine);
    expect(atLong.some((id) => id.startsWith("play:Thrown Sewer Lid"))).toBe(true);

    const close = armed("Thrown Sewer Lid", { pot: "superior" });
    const atClose = atStrike(close.engine);
    // The window is open and Alice is being asked — otherwise the negative
    // holds against an empty list.
    expect(atClose).toContain("strike:hand");
    expect(atClose.some((id) => id.startsWith("play:Thrown Sewer Lid"))).toBe(false);
  });
});

describe("the round gate", () => {
  it("Well-Aimed Car is NOT offered in round 1, even at long range", () => {
    const a = armed("Well-Aimed Car", { pot: "superior" });
    atLongRange(a.state);
    const ids = atStrike(a.engine);
    expect(combat(a.state).round).toBe(1);
    expect(ids).toContain("strike:hand");
    expect(ids.some((id) => id.startsWith("play:Well-Aimed Car"))).toBe(false);
  });

  it("…and IS offered in round 2", () => {
    const a = armed("Well-Aimed Car", { pot: "superior" });
    // Both combatants press to continue, which is what makes a round 2.
    const cf = combat(a.state);
    cf.pressesCombat.acting += 1;
    atStrike(a.engine);
    for (let i = 0; i < 20; i++) {
      const dp = a.engine.decision();
      if (!dp) break;
      if (combat(a.state).round > 1 && dp.window === "combat.chooseStrike") break;
      const pick =
        dp.options.find((o) => o.id === "press:continue") ??
        dp.options.find((o) => o.id === "pass") ??
        dp.options.find((o) => o.id === "strike:hand");
      if (!pick) break;
      a.engine.choose(pick.id);
    }
    expect(combat(a.state).round).toBe(2);
    // Round 2 resets the range to close (p. 29), so open it again.
    atLongRange(a.state);
    const ids = atStrike(a.engine);
    expect(ids.some((id) => id.startsWith("play:Well-Aimed Car"))).toBe(true);
  });
});
