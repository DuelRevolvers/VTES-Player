/**
 * Dodges (docs/dodges-design.md).
 *
 * Vampiric Speed (102089), Staredown (101859), Preternatural Evasion (101482),
 * Sideslip (101779), Acrobatics (100020), Behind You! (100149).
 *
 * Six cards built on "Strike: dodge". The primitive exists, so what these test
 * is what each card buys ALONGSIDE the dodge and WHERE that second thing
 * lives — two of them put their two modes in two different windows.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Alice's V1 bleeds, Bob's M blocks. Instance ids `dg*`, never `c1`. */
function inCombat(
  cards: string[],
  disciplines: Record<string, "basic" | "superior">,
  blood = 4,
): { state: GameState; engine: VtesEngine; v1: MinionState; m: MinionState } {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, { blood, capacity: 4, disciplines, strength: 1 });
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  m.blood = m.capacity;
  cards.forEach((n, i) => state.seats[0]!.hand.push({ id: `dg${i}`, name: n }));
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

function combat(state: GameState): {
  round: number;
  presses: { acting: number; opposing: number };
  pressesCombat: { acting: number; opposing: number };
  maneuverCredits: { acting: number; opposing: number };
  additionalStrikes: { acting: number; opposing: number };
  range: "close" | "long";
  playedThisRound: string[];
} {
  const cf = state.frames.find((f) => f.kind === "combat");
  if (cf?.kind !== "combat") throw new Error("no combat frame");
  return cf;
}

/** Walk to a window and return its options. */
function walkTo(engine: VtesEngine, window: string, limit = 14): string[] {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return [];
    if (dp.window === window) return dp.options.map((o) => o.id);
    const pick =
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "strike:hand") ??
      dp.options.find((o) => o.id.startsWith("strike:"));
    if (!pick) return [];
    engine.choose(pick.id);
  }
  return [];
}

/** Let the play resolve — effects run after the as-played window. */
function settle(engine: VtesEngine, steps = 4): void {
  for (let i = 0; i < steps; i++) {
    const dp = engine.decision();
    if (!dp || dp.window !== "card.asPlayed") return;
    const pick = dp.options.find((o) => o.id === "pass");
    if (!pick) return;
    engine.choose(pick.id);
  }
}

function playOut(engine: VtesEngine, state: GameState, limit = 24): void {
  for (let i = 0; i < limit; i++) {
    if (!state.frames.some((f) => f.kind === "combat")) return;
    const dp = engine.decision();
    if (!dp) return;
    const pick =
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "strike:hand") ??
      dp.options.find((o) => o.id.startsWith("strike:"));
    if (!pick) return;
    engine.choose(pick.id);
  }
}

// ---------------------------------------------------------------------------

describe("the dodge itself", () => {
  // Every card here whose basic is a plain dodge should stop M's hand strike
  // dead. One positive shared by four cards, so a dodge that stopped working
  // could not hide behind any of them.
  for (const card of [
    "Vampiric Speed",
    "Staredown",
    "Preternatural Evasion",
    "Sideslip",
  ] as const) {
    it(`${card}'s basic dodges M's hand strike`, () => {
      const a = inCombat([card], { cel: "superior", pre: "superior" });
      const before = a.v1.blood;
      const ids = walkTo(a.engine, "combat.chooseStrike");
      const id = ids.find((x) => x.startsWith(`play:${card}:basic`));
      expect(id, `${card} basic not offered`).toBeDefined();
      a.engine.choose(id!);
      settle(a.engine);
      playOut(a.engine, a.state);
      // Dodged: no damage, so no blood mended and no torpor.
      expect(a.v1.blood).toBe(before);
      expect(a.v1.inTorpor).toBeFalsy();
    });
  }
});

describe("Vampiric Speed (102089) — a dodge with a press", () => {
  it("superior grants a PER-ROUND press; basic grants none", () => {
    for (const [mode, expected] of [
      ["basic", 0],
      ["superior", 1],
    ] as const) {
      const a = inCombat(["Vampiric Speed"], { cel: "superior" });
      const ids = walkTo(a.engine, "combat.chooseStrike");
      a.engine.choose(ids.find((x) => x.startsWith(`play:Vampiric Speed:${mode}`))!);
      settle(a.engine);
      const cf = combat(a.state);
      expect(cf.presses.acting, `${mode} press`).toBe(expected);
      // Never the combat-long pool — "with an optional press" is this round
      // only [TOM 19960521], the wave 73 fix.
      expect(cf.pressesCombat.acting, `${mode} combat press`).toBe(0);
    }
  });
});

describe("Staredown and Preternatural Evasion — the same superior, one priced", () => {
  it("Staredown's superior ends the combat for free", () => {
    const a = inCombat(["Staredown"], { pre: "superior" });
    const before = a.v1.blood;
    const ids = walkTo(a.engine, "combat.chooseStrike");
    a.engine.choose(ids.find((x) => x.startsWith("play:Staredown:superior"))!);
    settle(a.engine);
    playOut(a.engine, a.state);
    expect(a.state.frames.some((f) => f.kind === "combat")).toBe(false);
    expect(a.v1.blood).toBe(before);
  });

  it("Preternatural Evasion's superior ends it and burns 1 blood", () => {
    const a = inCombat(["Preternatural Evasion"], { cel: "superior" });
    const before = a.v1.blood;
    const ids = walkTo(a.engine, "combat.chooseStrike");
    a.engine.choose(ids.find((x) => x.startsWith("play:Preternatural Evasion:superior"))!);
    settle(a.engine);
    playOut(a.engine, a.state);
    expect(a.state.frames.some((f) => f.kind === "combat")).toBe(false);
    // The price is the only thing separating this card from Staredown.
    expect(a.v1.blood).toBe(before - 1);
  });

  it("NEGATIVE SPACE: its superior is not offered to a vampire with no blood", () => {
    // 0 blood would enable a mandatory hunt and break the fixture, so the
    // vampire has 1 blood and the card wants 1 — affordable — versus a board
    // where it has none to spare. Instead: drain it to 0 inside the combat,
    // which the blocker's own strike does not do, so set it directly.
    const a = inCombat(["Preternatural Evasion"], { cel: "superior" });
    a.v1.blood = 0;
    const ids = walkTo(a.engine, "combat.chooseStrike");
    // The window is open and Alice is being asked, so the negative is real.
    expect(ids).toContain("strike:hand");
    expect(ids.some((x) => x.startsWith("play:Preternatural Evasion:superior"))).toBe(false);
    // …while the free basic mode is still there: the gate narrowed the MODE.
    expect(ids.some((x) => x.startsWith("play:Preternatural Evasion:basic"))).toBe(true);
  });
});

describe("Sideslip (101779) — two modes, two windows, one per round", () => {
  it("its superior is PREVENTION, so it is not offered at the strike step", () => {
    const a = inCombat(["Sideslip"], { cel: "superior" });
    const atStrike = walkTo(a.engine, "combat.chooseStrike");
    expect(atStrike.some((x) => x.startsWith("play:Sideslip:basic"))).toBe(true);
    expect(atStrike.some((x) => x.startsWith("play:Sideslip:superior"))).toBe(false);

    // And it IS there at damage resolution.
    const b = inCombat(["Sideslip"], { cel: "superior" });
    const atDamage = walkTo(b.engine, "combat.damageResolution");
    expect(atDamage.some((x) => x.startsWith("play:Sideslip:superior"))).toBe(true);
  });

  it("only one at superior each ROUND", () => {
    const a = inCombat(["Sideslip", "Sideslip"], { cel: "superior" });
    // M must hit for MORE than the 1 point Sideslip prevents. Preventing the
    // whole hit empties `pendingDamage`, the damage window closes, and "the
    // second copy is not offered" then holds against no window at all — the
    // negative would pass for the wrong reason.
    const cf0 = a.state.frames.find((f) => f.kind === "combat");
    if (cf0?.kind !== "combat") throw new Error("no combat frame");
    cf0.strengthBonusRound.opposing += 2; // a 3-point hit
    const ids = walkTo(a.engine, "combat.damageResolution");
    const first = ids.find((x) => x.startsWith("play:Sideslip:superior"))!;
    a.engine.choose(first);
    settle(a.engine);
    // The limit is recorded per NAME AND MODE, so the second copy is barred.
    expect(combat(a.state).playedThisRound).toContain("Sideslip:superior");
    const after = walkTo(a.engine, "combat.damageResolution", 4);
    // The window is STILL OPEN with damage left to answer, which is what
    // makes the next line a real negative.
    expect(after).toContain("pass");
    expect(after.some((x) => x.startsWith("play:Sideslip:superior"))).toBe(false);
  });
});

describe("Acrobatics (100020) — the mirror: the BASIC has no dodge", () => {
  it("basic grants an additional strike and is not a dodge", () => {
    const a = inCombat(["Acrobatics"], { cel: "superior" });
    const before = a.v1.blood;
    const ids = walkTo(a.engine, "combat.chooseStrike");
    a.engine.choose(ids.find((x) => x.startsWith("play:Acrobatics:basic"))!);
    settle(a.engine);
    expect(combat(a.state).additionalStrikes.acting).toBe(1);
    // 1 blood for the card, and M's hand strike still lands (1 mended), so
    // the basic is provably NOT dodging.
    playOut(a.engine, a.state);
    expect(a.v1.blood).toBe(before - 2);
  });

  it("superior dodges AND grants the additional strike", () => {
    const a = inCombat(["Acrobatics"], { cel: "superior" });
    const before = a.v1.blood;
    const ids = walkTo(a.engine, "combat.chooseStrike");
    a.engine.choose(ids.find((x) => x.startsWith("play:Acrobatics:superior"))!);
    settle(a.engine);
    expect(combat(a.state).additionalStrikes.acting).toBe(1);
    playOut(a.engine, a.state);
    // Only the card's 1 blood: the hand strike was dodged.
    expect(a.v1.blood).toBe(before - 1);
  });
});

describe("Behind You! (100149) — the first-round gate in TWO windows", () => {
  it("both modes are offered in round 1, each in its own window", () => {
    const a = inCombat(["Behind You!"], { obf: "superior" });
    const atRange = walkTo(a.engine, "combat.range");
    expect(atRange.some((x) => x.startsWith("play:Behind You!:basic"))).toBe(true);
    expect(atRange.some((x) => x.startsWith("play:Behind You!:superior"))).toBe(false);

    const b = inCombat(["Behind You!"], { obf: "superior" });
    const atStrike = walkTo(b.engine, "combat.chooseStrike");
    expect(atStrike.some((x) => x.startsWith("play:Behind You!:superior"))).toBe(true);
  });

  it("NEITHER mode is offered in round 2 — the gate reaches both windows", () => {
    // This is the card that checks wave 73's hoist. The maneuver mode lives in
    // `combat.range`, and before the hoist `onlyFirstRound` was only ever read
    // inside `combat.beforeRange` — so the basic would have stayed playable in
    // round 2 with nothing to show it.
    for (const [window, mode] of [
      ["combat.range", "basic"],
      ["combat.chooseStrike", "superior"],
    ] as const) {
      const a = inCombat(["Behind You!"], { obf: "superior" });
      const cf = combat(a.state);
      cf.round = 2;
      const ids = walkTo(a.engine, window);
      expect(ids.length, `${window} has options`).toBeGreaterThan(0);
      expect(
        ids.some((x) => x.startsWith(`play:Behind You!:${mode}`)),
        `${mode} still offered in round 2`,
      ).toBe(false);
    }
  });
});
