/**
 * Aggravated damage (docs/aggravated-damage-design.md).
 *
 * Burning Wrath (100271), Song in the Dark (101825), Bone Spur (100237),
 * Burst of Sunlight (100273), Adaptability (100021).
 *
 * Five cards about the aggravated FLAG in both directions. Aggravated damage
 * cannot be MENDED (p. 34), so the observable difference between "2 damage"
 * and "2 aggravated damage" to a ready vampire is: blood burned and still
 * ready, versus no blood burned and in torpor. Every assertion here is that
 * pair, because it is the only thing on the table that distinguishes them.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/**
 * Alice's V1 bleeds, Bob's M blocks. `cards` go into Alice's hand with
 * distinctive instance ids — never `c1`, which `threeSeatGame` already uses
 * for Conditioning (docs/positional-combat-design.md §5).
 */
function inCombat(
  cards: string[],
  disciplines: Record<string, "basic" | "superior">,
): { state: GameState; engine: VtesEngine; v1: MinionState; m: MinionState } {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, { blood: 4, capacity: 4, disciplines });
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  m.blood = m.capacity; // full, not a guess: blood above capacity is clamped
  cards.forEach((name, i) => state.seats[0]!.hand.push({ id: `ag${i}`, name }));
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
  range: "close" | "long";
  handStrikesAggravated: { acting: boolean; opposing: boolean };
  handStrikesAggravatedCombat?: { acting: boolean; opposing: boolean };
  strengthBonusRound: { acting: number; opposing: number };
  pressesCombat: { acting: number; opposing: number };
} {
  const cf = state.frames.find((f) => f.kind === "combat");
  if (cf?.kind !== "combat") throw new Error("no combat frame");
  return cf;
}

/** Walk until this window is reached, preferring pass then a hand strike. */
function walkTo(engine: VtesEngine, window: string, limit = 16): string[] {
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

/**
 * Let a card play RESOLVE — the as-played window goes round the table before
 * `resolve` runs, so a cost read straight after `choose` reads it too early.
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

/** Run the combat out, passing and hand-striking. */
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

describe("Song in the Dark (101825) — the flag, and nothing else", () => {
  /** Play one mode, run the combat out, and report what happened to M. */
  function hit(mode: "basic" | "superior"): { blood: number; torpor: boolean } {
    const a = inCombat(["Song in the Dark"], { ani: "superior" });
    const ids = walkTo(a.engine, "combat.chooseStrike");
    const id = ids.find((x) => x.startsWith(`play:Song in the Dark:${mode}`));
    expect(id, `${mode} not offered`).toBeDefined();
    a.engine.choose(id!);
    playOut(a.engine, a.state);
    return { blood: a.m.blood, torpor: a.m.inTorpor === true };
  }

  it("2 normal damage is MENDED with blood; 2 aggravated is not", () => {
    const normal = hit("basic");
    const agg = hit("superior");
    // Normal: 2 blood burned to mend it, still ready (p. 34).
    expect(normal.blood).toBe(3); // capacity 5, less 2 mended
    expect(normal.torpor).toBe(false);
    // Aggravated: no blood spent, straight to torpor. The two facts move in
    // OPPOSITE directions, which is what makes this a real assertion rather
    // than "something changed".
    expect(agg.blood).toBe(5);
    expect(agg.torpor).toBe(true);
  });
});

describe("Burning Wrath (100271) — an aggravated HAND strike", () => {
  it("is +1 at basic and +2 at superior, and sends M to torpor either way", () => {
    for (const mode of ["basic", "superior"] as const) {
      const a = inCombat(["Burning Wrath"], { pot: "superior" });
      const before = a.v1.blood;
      const ids = walkTo(a.engine, "combat.chooseStrike");
      const id = ids.find((x) => x.startsWith(`play:Burning Wrath:${mode}`));
      expect(id, `${mode} not offered`).toBeDefined();
      a.engine.choose(id!);
      // The COST, read once the card has resolved and before any strike has —
      // M strikes back for 1 and V1 mends it, so a cost read after the combat
      // would be the cost plus a mend.
      settle(a.engine);
      expect(a.v1.blood, `${mode} cost`).toBe(before - 3);
      playOut(a.engine, a.state);
      // The hit is aggravated: torpor, with M's blood untouched because
      // aggravated damage cannot be mended (p. 34).
      expect(a.m.inTorpor, `${mode} torpor`).toBe(true);
      expect(a.m.blood, `${mode} unmended`).toBe(a.m.capacity);
    }
  });
});

describe("Bone Spur (100237) — a round versus a COMBAT", () => {
  it("basic sets the round flag and superior sets the combat-long one", () => {
    const basic = inCombat(["Bone Spur"], { pro: "superior" });
    const bIds = walkTo(basic.engine, "combat.beforeStrikes");
    basic.engine.choose(bIds.find((x) => x.startsWith("play:Bone Spur:basic"))!);
    settle(basic.engine);
    expect(combat(basic.state).handStrikesAggravated.acting).toBe(true);
    expect(combat(basic.state).handStrikesAggravatedCombat?.acting ?? false).toBe(false);

    const sup = inCombat(["Bone Spur"], { pro: "superior" });
    const sIds = walkTo(sup.engine, "combat.beforeStrikes");
    sup.engine.choose(sIds.find((x) => x.startsWith("play:Bone Spur:superior"))!);
    settle(sup.engine);
    // The combat-long field, and NOT the round one — two fields, because the
    // round boundary clears one and not the other.
    expect(combat(sup.state).handStrikesAggravatedCombat?.acting).toBe(true);
    expect(combat(sup.state).handStrikesAggravated.acting).toBe(false);
  });

  it("the round flag makes V1's own hand strike aggravated", () => {
    const a = inCombat(["Bone Spur"], { pro: "superior" });
    const ids = walkTo(a.engine, "combat.beforeStrikes");
    a.engine.choose(ids.find((x) => x.startsWith("play:Bone Spur:basic"))!);
    playOut(a.engine, a.state);
    // A bare hand strike is 1 damage, now aggravated: M goes to torpor with
    // its blood untouched rather than mending a point.
    expect(a.m.inTorpor).toBe(true);
    expect(a.m.blood).toBe(a.m.capacity);
  });

  it("the COMBAT flag survives a round boundary where the round flag does not", () => {
    for (const [mode, stillSet] of [
      ["basic", false],
      ["superior", true],
    ] as const) {
      const a = inCombat(["Bone Spur"], { pro: "superior" });
      // A press credit is what makes a round 2 possible at all — and the
      // combat is fought at LONG range, where a bare hand strike inflicts
      // nothing (p. 29). Without that, V1's now-aggravated hand strike sends
      // M to torpor, the combat ends, and there IS no round 2 to look at.
      const cf1 = combat(a.state);
      cf1.pressesCombat.acting += 1;
      cf1.range = "long";
      const ids = walkTo(a.engine, "combat.beforeStrikes");
      a.engine.choose(ids.find((x) => x.startsWith(`play:Bone Spur:${mode}`))!);
      settle(a.engine);
      for (let i = 0; i < 24; i++) {
        const live = a.state.frames.find((f) => f.kind === "combat");
        if (live?.kind !== "combat" || live.round > 1) break;
        const dp = a.engine.decision();
        if (!dp) break;
        const pick =
          dp.options.find((o) => o.id === "press:continue") ??
          dp.options.find((o) => o.id === "pass") ??
          dp.options.find((o) => o.id === "strike:hand");
        if (!pick) break;
        a.engine.choose(pick.id);
      }
      const cf = combat(a.state);
      expect(cf.round, `${mode} reached round 2`).toBe(2);
      const flagLive =
        cf.handStrikesAggravated.acting || (cf.handStrikesAggravatedCombat?.acting ?? false);
      expect(flagLive, `${mode} still aggravated in round 2`).toBe(stillSet);
    }
  });
});

describe("Burst of Sunlight (100273) — the strike hurts its own striker", () => {
  it("deals 2R aggravated and takes 2 aggravated back at superior", () => {
    const a = inCombat(["Burst of Sunlight"], { tha: "superior" });
    const ids = walkTo(a.engine, "combat.chooseStrike");
    const id = ids.find((x) => x.startsWith("play:Burst of Sunlight:superior"));
    expect(id).toBeDefined();
    a.engine.choose(id!);
    playOut(a.engine, a.state);
    // Both sides took aggravated damage, so BOTH are in torpor. The recoil
    // rider used to be reachable only from a weapon, so V1's torpor is the
    // whole of §4: without it only M would be down.
    expect(a.m.inTorpor).toBe(true);
    expect(a.v1.inTorpor).toBe(true);
    // M's own hand strike lands 1 NORMAL damage on V1, which is mended — so
    // V1's blood is not a clean read of the recoil, and the recoil's mark is
    // the torpor above. M's is: aggravated leaves the blood alone.
    expect(a.m.blood).toBe(a.m.capacity);
  });
});

describe("Adaptability (100021) — taking the flag back off", () => {
  /** M's hand strike, made aggravated, with Alice holding Adaptability. */
  function underAggravatedHit(): ReturnType<typeof inCombat> {
    const a = inCombat(["Adaptability"], { pro: "superior" });
    const cf = combat(a.state);
    cf.handStrikesAggravated.opposing = true;
    cf.strengthBonusRound.opposing += 1; // a 2-point hit, so a point can show
    return a;
  }

  it("basic MENDS what would have been torpor", () => {
    const a = underAggravatedHit();
    const ids = walkTo(a.engine, "combat.damageResolution");
    const id = ids.find((x) => x.startsWith("play:Adaptability:basic"));
    expect(id, "basic not offered against an aggravated hit").toBeDefined();
    a.engine.choose(id!);
    playOut(a.engine, a.state);
    // Treated as normal: 2 blood burned to mend it (plus 1 for the card),
    // and V1 is still ready. Without the card this is torpor at 4 blood.
    expect(a.v1.inTorpor).toBeFalsy();
    expect(a.v1.blood).toBe(1); // 4 − 1 cost − 2 mended
  });

  it("superior PREVENTS it, so nothing is mended either", () => {
    const a = underAggravatedHit();
    const ids = walkTo(a.engine, "combat.damageResolution");
    const id = ids.find((x) => x.startsWith("play:Adaptability:superior"));
    expect(id).toBeDefined();
    a.engine.choose(id!);
    playOut(a.engine, a.state);
    expect(a.v1.inTorpor).toBeFalsy();
    expect(a.v1.blood).toBe(3); // 4 − 1 cost, and no mending at all
  });

  it("NEGATIVE SPACE: neither mode is offered against NORMAL damage", () => {
    const a = inCombat(["Adaptability"], { pro: "superior" });
    combat(a.state).strengthBonusRound.opposing += 1; // 2 normal damage
    const ids = walkTo(a.engine, "combat.damageResolution");
    // The window is open and Alice is being asked, so the negative is real.
    expect(ids).toContain("pass");
    expect(ids.some((x) => x.startsWith("play:Adaptability"))).toBe(false);
  });

  it("does NOT clear the aggravated flag, so non-aggravated prevention still cannot touch it", () => {
    // The ruling carried over from wave 72: "[FOR] Cannot be used to prevent
    // aggravated damage, EVEN IF the minion treats them as normal damage"
    // [LSJ 20040812-2]. Adaptability's basic is exactly such a treatment, so
    // Resilience's superior must stay gated out after it resolves.
    const a = inCombat(["Adaptability", "Resilience"], { pro: "superior", for: "superior" });
    const cf = combat(a.state);
    cf.handStrikesAggravated.opposing = true;
    cf.strengthBonusRound.opposing += 1;
    const ids = walkTo(a.engine, "combat.damageResolution");
    expect(ids.some((x) => x.startsWith("play:Resilience:superior"))).toBe(false);
    a.engine.choose(ids.find((x) => x.startsWith("play:Adaptability:basic"))!);
    const after = walkTo(a.engine, "combat.damageResolution");
    expect(after.some((x) => x.startsWith("play:Resilience:superior"))).toBe(false);
    // …while the plain "prevent 1" half is still there, so the gate narrowed
    // the MODE and not the card.
    expect(after.some((x) => x.startsWith("play:Resilience:basic"))).toBe(true);
  });
});
