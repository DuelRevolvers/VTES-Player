/**
 * The armour cards (docs/armour-design.md).
 *
 * Skin of Rock (101791), Resilience (101608), Skin of Steel (101792),
 * Unflinching Persistence (102071), Skin of Night (101790).
 *
 * Five [for] cards about TAKING damage. The wave's one new primitive is
 * Skin of Night's aggravated-to-normal conversion, and the assertion that
 * pays for the whole wave is the interaction a ruling names: Resilience's
 * non-aggravated prevention still cannot touch damage a vampire is treating
 * as normal [LSJ 20040812-2].
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/**
 * Alice's V1 bleeds, Bob's M blocks, and M strikes with `damage` points —
 * so the pending damage lands on V1, who is holding `card`.
 *
 * The card instance is `arm1`, NOT `c1`: `threeSeatGame` already deals
 * Alice a Conditioning with that id, and a play resolves by the FIRST
 * instance of the id (wave 71, `docs/positional-combat-design.md` §5).
 */
function armoured(
  card: string,
  opts: { damage: number; aggravated?: boolean; blood?: number } = { damage: 2 },
): { state: GameState; engine: VtesEngine; v1: MinionState; m: MinionState } {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, {
    blood: opts.blood ?? 4,
    capacity: 4,
    disciplines: { for: "superior" as const },
  });
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  m.blood = 4;
  state.seats[0]!.hand.push({ id: "arm1", name: card });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"],
    ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  // The strike's size and its aggravated-ness are ROUND facts on the
  // combat frame, not traits of the striker: `handStrikesAggravated` is a
  // per-side frame flag (Claws of the Dead sets it), and strength rides the
  // round the same way. Setting them here is the only way to deal a known
  // amount of known damage without a second card in the fixture.
  const cf = state.frames.find((f) => f.kind === "combat");
  if (cf?.kind !== "combat") throw new Error("no combat frame");
  cf.strengthBonusRound.opposing += opts.damage - 1;
  if (opts.aggravated) cf.handStrikesAggravated.opposing = true;
  return { state, engine, v1, m };
}

/** Walk to the damage-resolution window: through Before Range, range,
 *  Before Strikes, then both strikes. */
function toDamage(engine: VtesEngine): void {
  for (let i = 0; i < 14; i++) {
    const dp = engine.decision();
    if (!dp) return;
    if (dp.window === "combat.damageResolution") return;
    const pick =
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "strike:hand") ??
      dp.options.find((o) => o.id.startsWith("strike:"));
    if (!pick) return;
    engine.choose(pick.id);
  }
}

/** The option ids on the table at damage resolution, for Alice. */
function atDamage(engine: VtesEngine): string[] {
  toDamage(engine);
  const dp = engine.decision();
  if (!dp || dp.window !== "combat.damageResolution") return [];
  return dp.options.map((o) => o.id);
}

// ---------------------------------------------------------------------------

describe("prevention, at two amounts", () => {
  it("Skin of Rock prevents 1 at basic and 2 at superior", () => {
    const { engine, v1 } = armoured("Skin of Rock", { damage: 2 });
    const before = v1.blood;
    const ids = atDamage(engine);
    const sup = ids.find((id) => id.startsWith("play:Skin of Rock:superior"));
    expect(ids.some((id) => id.startsWith("play:Skin of Rock:basic"))).toBe(true);
    expect(sup).toBeDefined();
    engine.choose(sup!);
    // 2 damage, 2 prevented: no blood burned to mend it.
    for (let i = 0; i < 8 && engine.decision(); i++) {
      const dp = engine.decision()!;
      const pick = dp.options.find((o) => o.id === "pass");
      if (!pick) break;
      engine.choose(pick.id);
    }
    expect(v1.blood).toBe(before);
    expect(v1.inTorpor).toBeFalsy();
  });
});

describe("Resilience (101608) — the superior is the WEAKER mode", () => {
  it("offers both modes against normal damage", () => {
    const ids = atDamage(armoured("Resilience", { damage: 3 }).engine);
    expect(ids.some((id) => id.startsWith("play:Resilience:basic"))).toBe(true);
    expect(ids.some((id) => id.startsWith("play:Resilience:superior"))).toBe(true);
  });

  it("withholds ONLY the superior against aggravated damage", () => {
    // "Prevent 3 NON-aggravated damage" cannot touch this, so it is not
    // offered — but the basic's plain "prevent 1" still is. A gate that
    // took the whole card off the table would look identical in a test
    // that only asserted the superior was gone.
    const ids = atDamage(armoured("Resilience", { damage: 3, aggravated: true }).engine);
    expect(ids.some((id) => id.startsWith("play:Resilience:superior"))).toBe(false);
    expect(ids.some((id) => id.startsWith("play:Resilience:basic"))).toBe(true);
  });
});

describe("Skin of Steel (101792) — all of it, then all of it again", () => {
  it("costs blood and prevents the whole strike at basic", () => {
    const { engine, v1 } = armoured("Skin of Steel", { damage: 3 });
    const before = v1.blood;
    const ids = atDamage(engine);
    const basic = ids.find((id) => id.startsWith("play:Skin of Steel:basic"));
    expect(basic).toBeDefined();
    engine.choose(basic!);
    // The 1 blood is the card's cost; the 3 damage is gone, so nothing is
    // mended on top of it.
    expect(v1.blood).toBe(before - 1);
    expect(v1.inTorpor).toBeFalsy();
  });

  it("is not offered before there is damage to prevent", () => {
    // "Cannot be used if there is no damage to prevent" [LSJ 20001114] —
    // which is the damage-resolution window's own rule, so the card must
    // not appear at the range step three windows earlier. (A 0-blood
    // fixture would have been the obvious affordability test, and it does
    // not work: 0 blood enables a MANDATORY hunt and the bleed that starts
    // this fixture is no longer legal.)
    const { engine } = armoured("Skin of Steel", { damage: 2 });
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.range");
    expect(dp.options.some((o) => o.id.startsWith("play:Skin of Steel"))).toBe(false);
  });
});

describe("Unflinching Persistence (102071) — two modes, two windows", () => {
  it("plays its basic at damage resolution and its superior at the range step", () => {
    const ids = atDamage(armoured("Unflinching Persistence", { damage: 2 }).engine);
    expect(ids.some((id) => id.startsWith("play:Unflinching Persistence:basic"))).toBe(true);
    // The superior is a MANEUVER: it belongs to the range step, which is
    // three windows earlier, so it must NOT be here.
    expect(ids.some((id) => id.startsWith("play:Unflinching Persistence:superior"))).toBe(false);

    // And it IS there, at the range step.
    const { engine } = armoured("Unflinching Persistence", { damage: 2 });
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.range");
    expect(
      dp.options.some((o) => o.id.startsWith("play:Unflinching Persistence:superior")),
    ).toBe(true);
  });
});

describe("the credit Unflinching Persistence grants (docs/armour-design.md §4)", () => {
  /** Walk to the range step, play the superior, then on to damage. */
  function withCredit(noPreventBy?: string[]): {
    state: GameState;
    engine: VtesEngine;
    v1: MinionState;
  } {
    const a = armoured("Unflinching Persistence", { damage: 2 });
    // The superior MANEUVERS, so playing it opens the range — and a hand
    // strike at long range inflicts nothing (p. 29), which means no damage
    // window opens and the credit it just granted has nothing to spend on.
    // Bob closes the range back with a maneuver credit; that is ordinary
    // play (the alternation, p. 29), and without it every assertion below
    // would pass against an EMPTY option list.
    const cf0 = a.state.frames.find((f) => f.kind === "combat");
    if (cf0?.kind !== "combat") throw new Error("no combat frame");
    cf0.maneuverCredits.opposing += 1;
    runTrace(a.engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "play:Unflinching Persistence:superior"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Bob", "maneuver:credit"],
    ]);
    if (noPreventBy) {
      // "This damage cannot be prevented by cards requiring Fortitude"
      // (Blood Fury, Soul Burn) — stamped on the strike's damage.
      const cf = a.state.frames.find((f) => f.kind === "combat");
      if (cf?.kind !== "combat") throw new Error("no combat frame");
      cf.strikes.opposing = { ...(cf.strikes.opposing ?? {}), noPreventBy } as never;
    }
    return a;
  }

  it("lands in the ROUND pool, not the combat-long one", () => {
    const { state } = withCredit();
    const cf = state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat frame");
    // "…LATER THIS ROUND". The credit used to go into `preventCredits`,
    // which survives the whole combat — so it outlived its own sentence.
    expect(cf.preventCreditsRound?.acting.length).toBe(1);
    expect(cf.preventCredits.acting).toBe(0);
    // And it remembers what the granting mode required, which is what makes
    // it filterable at all.
    expect(cf.preventCreditsRound?.acting[0]).toEqual(["for"]);
  });

  it("is offered as a credit at damage resolution, and spends down", () => {
    const { engine, state } = withCredit();
    const ids = atDamage(engine);
    expect(ids).toContain("prevent:credit");
    engine.choose("prevent:credit");
    const cf = state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat frame");
    expect(cf.preventCreditsRound?.acting.length).toBe(0);
  });

  it("is NOT offered against damage no [for] card may prevent", () => {
    // The closed deviation: a credit granted by a [for] mode is filtered by
    // the same `noPreventBy` that hides a [for] prevention CARD. While the
    // pool was a bare count this was structurally impossible.
    const ids = atDamage(withCredit(["for"]).engine);
    // The window IS open and IS being offered to Alice — otherwise the
    // negative below would hold against an empty list.
    expect(ids).toContain("pass");
    expect(ids).not.toContain("prevent:credit");
  });
});

describe("Skin of Night (101790) — aggravated becomes normal", () => {
  it("is offered against AGGRAVATED damage and not against normal", () => {
    // The basic mode's only effect is the conversion, so against damage
    // that is already normal there is nothing for it to do.
    const agg = atDamage(armoured("Skin of Night", { damage: 2, aggravated: true }).engine);
    expect(agg.some((id) => id.startsWith("play:Skin of Night:basic"))).toBe(true);

    const normal = atDamage(armoured("Skin of Night", { damage: 2 }).engine);
    expect(normal.some((id) => id.startsWith("play:Skin of Night:basic"))).toBe(false);
    // The superior also prevents 1, so it is useful either way.
    expect(normal.some((id) => id.startsWith("play:Skin of Night:superior"))).toBe(true);
  });

  it("turns a torpor-sending aggravated hit into mendable damage", () => {
    // 2 aggravated damage on a ready vampire is torpor outright (p. 34) —
    // no blood is burned, because aggravated cannot be mended.
    const bare = armoured("Skin of Night", { damage: 2, aggravated: true });
    toDamage(bare.engine);
    for (let i = 0; i < 10; i++) {
      const dp = bare.engine.decision();
      if (!dp) break;
      const pick = dp.options.find((o) => o.id === "pass");
      if (!pick) break;
      bare.engine.choose(pick.id);
      if (bare.v1.inTorpor) break;
    }
    expect(bare.v1.inTorpor).toBe(true);
    expect(bare.v1.blood).toBe(4);

    // With Skin of Night the same hit is mended with 2 blood instead.
    const armed = armoured("Skin of Night", { damage: 2, aggravated: true });
    const ids = atDamage(armed.engine);
    const basic = ids.find((id) => id.startsWith("play:Skin of Night:basic"))!;
    armed.engine.choose(basic);
    for (let i = 0; i < 10; i++) {
      const dp = armed.engine.decision();
      if (!dp) break;
      const pick = dp.options.find((o) => o.id === "pass");
      if (!pick) break;
      armed.engine.choose(pick.id);
    }
    expect(armed.v1.inTorpor).toBeFalsy();
    expect(armed.v1.blood).toBe(2);
  });

  it("does NOT let Resilience's non-aggravated prevention touch the damage", () => {
    // The ruling this wave exists to honour: "[FOR] Cannot be used to
    // prevent aggravated damage, EVEN IF the minion treats them as normal
    // damage (eg. Skin of Night)" [LSJ 20040812-2]. The conversion is
    // recorded on the minion, so the damage ITEM stays aggravated and the
    // gate that hides Resilience's superior still sees it.
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    Object.assign(v1, { blood: 4, capacity: 4, disciplines: { for: "superior" as const } });
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.blood = 4;
    state.seats[0]!.hand.push({ id: "arm1", name: "Skin of Night" });
    state.seats[0]!.hand.push({ id: "arm2", name: "Resilience" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const cf = state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat frame");
    cf.strengthBonusRound.opposing += 2;
    cf.handStrikesAggravated.opposing = true;
    const ids = atDamage(engine);
    // Before the conversion: Resilience's superior is already gated out.
    expect(ids.some((id) => id.startsWith("play:Resilience:superior"))).toBe(false);
    engine.choose(ids.find((id) => id.startsWith("play:Skin of Night:basic"))!);
    // After it: STILL gated out, which is the whole ruling.
    const after = atDamage(engine);
    expect(after.some((id) => id.startsWith("play:Resilience:superior"))).toBe(false);
    expect(after.some((id) => id.startsWith("play:Resilience:basic"))).toBe(true);
  });
});
