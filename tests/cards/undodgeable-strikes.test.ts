/**
 * Undodgeable strikes (docs/undodgeable-strikes-design.md).
 *
 * Scorpion Sting (101693), Earthshock (100604), Projectile (101493).
 *
 * Three cards whose point is that a DODGE does not answer them. So the dodge
 * is the control: every card here is asserted twice, once against a dodging
 * opponent and once against a striking one, and Scorpion Sting's two modes
 * differ only in whether the dodge works.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/**
 * Alice's V1 bleeds, Bob's M blocks. Instance id `ud1`, never `c1` —
 * `threeSeatGame` uses that for Conditioning
 * (docs/positional-combat-design.md §5).
 */
function inCombat(
  card: string,
  disciplines: Record<string, "basic" | "superior">,
  opts: { foeGear?: { name: string; tags: readonly string[] }; ownGear?: { name: string; tags: readonly string[] } } = {},
): { state: GameState; engine: VtesEngine; v1: MinionState; m: MinionState } {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, { blood: 4, capacity: 4, disciplines, strength: 1 });
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  m.blood = m.capacity;
  const attach = (to: MinionState, g: { name: string; tags: readonly string[] }, id: string): void => {
    to.attached.push({
      card: { id, name: g.name },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: [...g.tags],
    });
  };
  if (opts.foeGear) attach(m, opts.foeGear, "foegear");
  if (opts.ownGear) attach(v1, opts.ownGear, "owngear");
  state.seats[0]!.hand.push({ id: "ud1", name: card });
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

/** Walk to the strike step and return the options there. */
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

/** Let a card play resolve: its effects run after the as-played window. */
function settle(engine: VtesEngine, steps = 4): void {
  for (let i = 0; i < steps; i++) {
    const dp = engine.decision();
    if (!dp || dp.window !== "card.asPlayed") return;
    const pick = dp.options.find((o) => o.id === "pass");
    if (!pick) return;
    engine.choose(pick.id);
  }
}

/**
 * Finish the combat. `bobDodges` makes Bob answer with a dodge where he can,
 * which is the whole control of this file.
 */
function playOut(
  engine: VtesEngine,
  state: GameState,
  bobDodges: boolean,
  limit = 28,
): { dodged: boolean } {
  let dodged = false;
  for (let i = 0; i < limit; i++) {
    if (!state.frames.some((f) => f.kind === "combat")) break;
    const dp = engine.decision();
    if (!dp) break;
    const dodge =
      bobDodges && dp.seat === "Bob"
        ? dp.options.find((o) => o.id === "strike:dodge")
        : undefined;
    const pick =
      dodge ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "strike:hand") ??
      dp.options.find((o) => o.id.startsWith("strike:"));
    if (!pick) break;
    if (dodge) dodged = true;
    engine.choose(pick.id);
  }
  return { dodged };
}

/**
 * Give Bob's M a dodge. A dodge is NOT a free option in VTES — it comes from
 * a card or a granted strike — so a "Bob dodges" walker without this quietly
 * hand-strikes instead, and every undodgeable assertion passes for the wrong
 * reason. The first version of this file did exactly that.
 */
function grantBobADodge(state: GameState): void {
  const cf = state.frames.find((f) => f.kind === "combat");
  if (cf?.kind !== "combat") throw new Error("no combat frame");
  cf.grantedStrikes ??= { acting: [], opposing: [] };
  cf.grantedStrikes.opposing.push({ kind: "dodge" });
}

/** Play `mode` of the held card, then run the combat out. M's lost blood is
 *  the answer: aggravated is not in play here, so damage is mended. */
function damageDealt(
  card: string,
  mode: string,
  d: Record<string, "basic" | "superior">,
  bobDodges: boolean,
  opts: Parameters<typeof inCombat>[2] = {},
): number {
  const a = inCombat(card, d, opts);
  if (bobDodges) grantBobADodge(a.state);
  const before = a.m.blood;
  const ids = atStrike(a.engine);
  const id = ids.find((x) => x.startsWith(`play:${card}:${mode}`));
  if (!id) throw new Error(`${card}:${mode} not offered`);
  a.engine.choose(id);
  settle(a.engine);
  const { dodged } = playOut(a.engine, a.state, bobDodges);
  // The control has to be shown to have happened. Without this the
  // "undodgeable" assertions all pass on a board where nobody dodged.
  if (bobDodges && !dodged) throw new Error(`${card}:${mode}: Bob never dodged`);
  return before - a.m.blood;
}

// ---------------------------------------------------------------------------

describe("Scorpion Sting (101693) — the two modes differ ONLY in the dodge", () => {
  it("a dodge stops the basic and does NOT stop the superior", () => {
    // The positive control first: with nobody dodging, both modes land the
    // same 2 damage (strength 1 plus the card's +1). Without this the test
    // below could pass because the card does nothing at all.
    expect(damageDealt("Scorpion Sting", "basic", { ani: "superior" }, false)).toBe(2);
    expect(damageDealt("Scorpion Sting", "superior", { ani: "superior" }, false)).toBe(2);

    // And now the point of the card.
    expect(damageDealt("Scorpion Sting", "basic", { ani: "superior" }, true)).toBe(0);
    expect(damageDealt("Scorpion Sting", "superior", { ani: "superior" }, true)).toBe(2);
  });
});

describe("Earthshock (100604) — strength damage that REACHES", () => {
  it("is strength at basic and strength+1 at superior, undodgeable both ways", () => {
    // V1's strength is 1, so 1 and 2.
    expect(damageDealt("Earthshock", "basic", { pot: "superior" }, true)).toBe(1);
    expect(damageDealt("Earthshock", "superior", { pot: "superior" }, true)).toBe(2);
  });

  it("lands at LONG range, where a strength strike normally does not", () => {
    // A strength-based strike was hard-gated to close range, because every
    // card that had printed one was a hand strike. Earthshock says "strength
    // RANGED damage" (§2).
    const a = inCombat("Earthshock", { pot: "superior" });
    const cf = a.state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat frame");
    cf.range = "long";
    const before = a.m.blood;
    const ids = atStrike(a.engine);
    a.engine.choose(ids.find((x) => x.startsWith("play:Earthshock:superior"))!);
    settle(a.engine);
    playOut(a.engine, a.state, false);
    expect(before - a.m.blood).toBe(2);
  });

  it("NEGATIVE SPACE: not offered against a minion with FLIGHT", () => {
    const withFlight = inCombat("Earthshock", { pot: "superior" }, {
      foeGear: { name: "Raven Spy", tags: ["retainer", "flight"] },
    });
    const ids = atStrike(withFlight.engine);
    // The window is open and Alice is being asked, so the negative is real.
    expect(ids).toContain("strike:hand");
    expect(ids.some((x) => x.startsWith("play:Earthshock"))).toBe(false);

    // Same board without the flight: offered. Otherwise the assertion above
    // would pass for a card that is never offered at all.
    const plain = inCombat("Earthshock", { pot: "superior" }, {
      foeGear: { name: "Leather Jacket", tags: ["equipment"] },
    });
    expect(atStrike(plain.engine).some((x) => x.startsWith("play:Earthshock"))).toBe(true);
  });
});

describe("Projectile (101493) — 1R, or a ranged weapon instead", () => {
  it("deals its 1R through a dodge", () => {
    expect(damageDealt("Projectile", "basic", { cel: "superior" }, true)).toBe(1);
  });

  it("offers a RANGED weapon of the striker's as an alternative, and not a melee one", () => {
    const ranged = inCombat("Projectile", { cel: "superior" }, {
      ownGear: { name: "Ivory Bow", tags: ["equipment", "weapon"] },
    });
    const withGun = atStrike(ranged.engine).filter((x) => x.startsWith("play:Projectile:basic"));
    // Two options for one mode: the card's own 1R, and the weapon variant
    // carrying the chosen weapon in the option id.
    expect(withGun.length).toBe(2);
    expect(withGun.some((x) => x.includes("owngear"))).toBe(true);

    // A MELEE weapon is not a ranged weapon strike, so it adds no option.
    const melee = inCombat("Projectile", { cel: "superior" }, {
      ownGear: { name: "Sawn-Off Shotgun", tags: ["equipment", "weapon", "melee"] },
    });
    const withClub = atStrike(melee.engine).filter((x) => x.startsWith("play:Projectile:basic"));
    expect(withClub.length).toBe(1);
  });

  it("superior carries an additional strike that the basic does not", () => {
    for (const [mode, expected] of [
      ["basic", 0],
      ["superior", 1],
    ] as const) {
      const a = inCombat("Projectile", { cel: "superior" });
      const ids = atStrike(a.engine);
      a.engine.choose(ids.find((x) => x.startsWith(`play:Projectile:${mode}`))!);
      settle(a.engine);
      const cf = a.state.frames.find((f) => f.kind === "combat");
      if (cf?.kind !== "combat") throw new Error("no combat frame");
      expect(cf.additionalStrikes.acting, `${mode} additional strikes`).toBe(expected);
    }
  });
});
