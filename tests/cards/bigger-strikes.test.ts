/**
 * Bigger strikes (docs/bigger-strikes-design.md).
 *
 * Undead Strength (102061), Pushing the Limit (101524), Brute Force (100264),
 * Cauldron of Blood (100309).
 *
 * Four cards that say "swing harder". Three of them offer the bonus on a hand
 * strike OR a melee weapon strike; Cauldron of Blood offers it on the hand
 * only, which is what isolates the weapon clause. Brute Force's weapon variant
 * is worth MORE than its hand variant, and that asymmetry is the wave's point.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/**
 * Alice's V1 (strength 1) bleeds, Bob's M blocks. `club` gives V1 a melee
 * weapon that deals 2 as its own strike. Instance id `bs1`, never `c1` —
 * `threeSeatGame` uses that for Conditioning.
 */
function inCombat(
  card: string,
  disciplines: Record<string, "basic" | "superior">,
  club = true,
): { state: GameState; engine: VtesEngine; v1: MinionState; m: MinionState } {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, { blood: 4, capacity: 4, disciplines, strength: 1 });
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  m.blood = m.capacity;
  if (club) {
    // A REAL melee weapon: Meat Cleaver is `damage: null, handBonus: 1`, so
    // its own strike is strength+1. An invented weapon has no profile in the
    // registry, so its strike is worth nothing and every "the weapon variant
    // is bigger" assertion passes for the wrong reason (§3).
    v1.attached.push({
      card: { id: "club1", name: "Meat Cleaver" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["equipment", "weapon", "melee"],
    });
  }
  state.seats[0]!.hand.push({ id: "bs1", name: card });
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

/** Walk to the strike step and return the options. */
function atStrike(engine: VtesEngine, limit = 12): string[] {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return [];
    if (dp.window === "combat.chooseStrike") return dp.options.map((o) => o.id);
    const pick = dp.options.find((o) => o.id === "pass");
    if (!pick) return [];
    engine.choose(pick.id);
  }
  return [];
}

/** Let the play resolve — its effects run after the as-played window. */
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

/**
 * Play `mode` of `card`, taking the WEAPON variant if `weapon` is set, and
 * report the damage M lost. Nothing here is aggravated, so the damage is
 * mended out of blood.
 */
function damage(
  card: string,
  mode: string,
  d: Record<string, "basic" | "superior">,
  weapon: boolean,
): number {
  const a = inCombat(card, d);
  const before = a.m.blood;
  const ids = atStrike(a.engine).filter((x) => x.startsWith(`play:${card}:${mode}`));
  const id = weapon ? ids.find((x) => x.includes("club1")) : ids.find((x) => !x.includes("club1"));
  if (!id) throw new Error(`${card}:${mode} ${weapon ? "weapon" : "hand"} not offered`);
  a.engine.choose(id);
  settle(a.engine);
  playOut(a.engine, a.state);
  return before - a.m.blood;
}

// ---------------------------------------------------------------------------

describe("the symmetric pair", () => {
  // Same card, one point apart. Either spec alone would look right; the pair
  // is what makes a wrong `bonus` visible.
  for (const [card, d, basic, sup] of [
    ["Undead Strength", { pot: "superior" as const }, 2, 3],
    ["Pushing the Limit", { pot: "superior" as const }, 3, 4],
  ] as const) {
    it(`${card}: strength 1 plus the bonus, on the hand`, () => {
      expect(damage(card, "basic", d, false)).toBe(basic);
      expect(damage(card, "superior", d, false)).toBe(sup);
    });

    it(`${card}: the melee variant carries the SAME bonus`, () => {
      // The weapon deals 2 of its own, so the totals are one higher than the
      // hand's (strength 1). Equal bonuses is the thing being pinned — Brute
      // Force below is the card where they differ.
      expect(damage(card, "basic", d, true)).toBe(basic + 1);
      expect(damage(card, "superior", d, true)).toBe(sup + 1);
    });
  }
});

describe("Brute Force (100264) — the weapon variant is worth MORE", () => {
  it("is +1 by hand and +2 by weapon at basic, +2 and +3 at superior", () => {
    // Hand: strength 1 + 1 = 2, and 1 + 2 = 3.
    expect(damage("Brute Force", "basic", { pot: "superior" }, false)).toBe(2);
    expect(damage("Brute Force", "superior", { pot: "superior" }, false)).toBe(3);
    // Weapon: the club's own 2 + 2 = 4, and 2 + 3 = 5. Before `weaponBonus`
    // the two variants shared one number, so these were 3 and 4.
    expect(damage("Brute Force", "basic", { pot: "superior" }, true)).toBe(4);
    expect(damage("Brute Force", "superior", { pot: "superior" }, true)).toBe(5);
  });

  it("does not replace itself until after combat", () => {
    // "Do not replace until after combat." The hand is empty while the combat
    // is still running; the deferral is the card's whole first line.
    const a = inCombat("Brute Force", { pot: "superior" });
    a.state.seats[0]!.library.push({ id: "lib1", name: "Conditioning" });
    const ids = atStrike(a.engine);
    a.engine.choose(ids.find((x) => x.startsWith("play:Brute Force:basic"))!);
    settle(a.engine);
    expect(a.state.seats[0]!.hand.some((c) => c.id === "lib1")).toBe(false);
    playOut(a.engine, a.state);
    expect(a.state.frames.some((f) => f.kind === "combat")).toBe(false);
    expect(a.state.seats[0]!.hand.some((c) => c.id === "lib1")).toBe(true);
  });
});

describe("Cauldron of Blood (100309) — the hand-only control", () => {
  it("offers NO weapon variant, even with a melee weapon in hand", () => {
    // Round 2, because the card is not usable in the first (wave 73's gate).
    const a = inCombat("Cauldron of Blood", { tha: "superior" });
    const cf = a.state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat frame");
    cf.round = 2;
    const ids = atStrike(a.engine).filter((x) => x.startsWith("play:Cauldron of Blood:basic"));
    // Exactly one option for the mode, and it is not the weapon: a
    // `orMeleeWeapon` that leaked onto the family would give two.
    expect(ids.length).toBe(1);
    expect(ids[0]!.includes("club1")).toBe(false);
  });

  it("NEGATIVE SPACE: not offered in the first round at all", () => {
    const a = inCombat("Cauldron of Blood", { tha: "superior" });
    const cf = a.state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat frame");
    expect(cf.round).toBe(1);
    const ids = atStrike(a.engine);
    expect(ids).toContain("strike:hand");
    expect(ids.some((x) => x.startsWith("play:Cauldron of Blood"))).toBe(false);
  });

  it("deals strength + 2, and + 4 at superior, from round 2", () => {
    for (const [mode, expected] of [
      ["basic", 3],
      ["superior", 5],
    ] as const) {
      const a = inCombat("Cauldron of Blood", { tha: "superior" });
      const cf = a.state.frames.find((f) => f.kind === "combat");
      if (cf?.kind !== "combat") throw new Error("no combat frame");
      cf.round = 2;
      const before = a.m.blood;
      const ids = atStrike(a.engine);
      a.engine.choose(ids.find((x) => x.startsWith(`play:Cauldron of Blood:${mode}`))!);
      settle(a.engine);
      playOut(a.engine, a.state);
      // Strength 1 plus 2 or 4. M has 5 blood, so the superior's 5 mends it
      // exactly to 0 rather than overflowing into torpor.
      expect(before - a.m.blood, `${mode}`).toBe(expected);
    }
  });
});

describe("Immortal Grapple does not take the melee option away", () => {
  it("offers both variants while only hand strikes are allowed", () => {
    // "The 'make a melee strike' option can be used with Bundi while Immortal
    // Grapple is in effect" [LSJ 20090114]. The engine's gate is per MODE — a
    // mode that sets a hand strike survives — so the weapon variant of that
    // same mode survives with it. Asserted because the ruling is the only
    // thing that says so, and the gate reads as if it would forbid it.
    const a = inCombat("Undead Strength", { pot: "superior" });
    const cf = a.state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat frame");
    cf.handStrikesOnly = true;
    const ids = atStrike(a.engine).filter((x) => x.startsWith("play:Undead Strength:basic"));
    expect(ids.length).toBe(2);
    expect(ids.some((x) => x.includes("club1"))).toBe(true);
  });
});
