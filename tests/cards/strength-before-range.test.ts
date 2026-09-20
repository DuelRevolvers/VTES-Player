/**
 * Strength, before range (docs/strength-before-range-design.md).
 *
 * Fists of Death (100738), Song of Serenity (101827),
 * Shadow of the Wolf (101741).
 *
 * Three cards played in the same window that all move STRENGTH. Strength is
 * only observable through a HAND STRIKE's damage, so every assertion here is
 * damage dealt — and the round-versus-combat scopes are told apart by pressing
 * into a second round and striking again.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Alice's V1 (strength 1) bleeds, Bob's M (strength 1) blocks. */
function inCombat(
  card: string,
  disciplines: Record<string, "basic" | "superior">,
): { state: GameState; engine: VtesEngine; v1: MinionState; m: MinionState } {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, { blood: 4, capacity: 4, disciplines, strength: 1 });
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  Object.assign(m, { blood: m.capacity, strength: 1 });
  state.seats[0]!.hand.push({ id: "st1", name: card });
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
  strengthBonus: { acting: number; opposing: number };
  strengthBonusRound: { acting: number; opposing: number };
  additionalStrikes: { acting: number; opposing: number };
  presses: { acting: number; opposing: number };
  pressesCombat: { acting: number; opposing: number };
  playedThisCombat: string[];
} {
  const cf = state.frames.find((f) => f.kind === "combat");
  if (cf?.kind !== "combat") throw new Error("no combat frame");
  return cf;
}

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

/** Play the mode at beforeRange, then fight one round of hand strikes. */
function fightOneRound(
  card: string,
  mode: string,
  d: Record<string, "basic" | "superior">,
): { toM: number; toV1: number; state: GameState; engine: VtesEngine } {
  const a = inCombat(card, d);
  const mBefore = a.m.blood;
  const vBefore = a.v1.blood;
  const ids = walkTo(a.engine, "combat.beforeRange");
  const id = ids.find((x) => x.startsWith(`play:${card}:${mode}`));
  if (!id) throw new Error(`${card}:${mode} not offered before range`);
  a.engine.choose(id);
  settle(a.engine);
  for (let i = 0; i < 24; i++) {
    if (!a.state.frames.some((f) => f.kind === "combat")) break;
    const dp = a.engine.decision();
    if (!dp) break;
    if (dp.window === "combat.endOfRound") break;
    const pick =
      dp.options.find((o) => o.id === "strike:hand") ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id.startsWith("strike:"));
    if (!pick) break;
    a.engine.choose(pick.id);
  }
  // Blood cost is paid before the strikes, so subtract it from V1's side.
  return {
    toM: mBefore - a.m.blood,
    toV1: vBefore - a.v1.blood,
    state: a.state,
    engine: a.engine,
  };
}

// ---------------------------------------------------------------------------

describe("Fists of Death (100738) — own strength, for the COMBAT", () => {
  it("adds 1 then 2 to the hand strike, and records the combat-long field", () => {
    for (const [mode, dmg] of [
      ["basic", 2],
      ["superior", 3],
    ] as const) {
      const r = fightOneRound("Fists of Death", mode, { pot: "superior" });
      // Strength 1 plus the bonus.
      expect(r.toM, `${mode} damage`).toBe(dmg);
      // The COMBAT field, not the round one — the pair is what tells the two
      // scopes apart in the spec.
      const cf = combat(r.state);
      expect(cf.strengthBonus.acting, `${mode} combat field`).toBe(dmg - 1);
      expect(cf.strengthBonusRound.acting, `${mode} round field`).toBe(0);
    }
  });
});

describe("Song of Serenity (101827) — the OPPONENT's strength", () => {
  it("takes a point off M's hand strike", () => {
    // M's strike is strength 1, so -1 leaves nothing: V1 pays only the card's
    // 0 blood and mends nothing. The control is below.
    const r = fightOneRound("Song of Serenity", "basic", { ani: "superior" });
    expect(r.toV1).toBe(0);
    expect(combat(r.state).strengthBonusRound.opposing).toBe(-1);
  });

  it("CONTROL: without it, M's hand strike costs V1 a point", () => {
    // Otherwise "V1 lost no blood" would also hold for a card that does
    // nothing, or for a fixture where M never strikes.
    const a = inCombat("Song of Serenity", { ani: "superior" });
    const before = a.v1.blood;
    for (let i = 0; i < 24; i++) {
      if (!a.state.frames.some((f) => f.kind === "combat")) break;
      const dp = a.engine.decision();
      if (!dp) break;
      if (dp.window === "combat.endOfRound") break;
      const pick =
        dp.options.find((o) => o.id === "strike:hand") ??
        dp.options.find((o) => o.id === "pass");
      if (!pick) break;
      a.engine.choose(pick.id);
    }
    expect(before - a.v1.blood).toBe(1);
  });

  it("basic is the ROUND and superior is the COMBAT", () => {
    for (const [mode, field] of [
      ["basic", "round"],
      ["superior", "combat"],
    ] as const) {
      const a = inCombat("Song of Serenity", { ani: "superior" });
      const ids = walkTo(a.engine, "combat.beforeRange");
      a.engine.choose(ids.find((x) => x.startsWith(`play:Song of Serenity:${mode}`))!);
      settle(a.engine);
      const cf = combat(a.state);
      expect(cf.strengthBonusRound.opposing, `${mode} round`).toBe(field === "round" ? -1 : 0);
      expect(cf.strengthBonus.opposing, `${mode} combat`).toBe(field === "combat" ? -1 : 0);
    }
  });

  it("only one each COMBAT, across both modes", () => {
    const a = inCombat("Song of Serenity", { ani: "superior" });
    a.state.seats[0]!.hand.push({ id: "st2", name: "Song of Serenity" });
    const ids = walkTo(a.engine, "combat.beforeRange");
    a.engine.choose(ids.find((x) => x.startsWith("play:Song of Serenity:basic"))!);
    settle(a.engine);
    const after = walkTo(a.engine, "combat.beforeRange", 4);
    // The window is still open and Alice is still being asked.
    expect(after).toContain("pass");
    // The limit is by CARD NAME, so the SUPERIOR is barred too — a per-mode
    // limit would have left it available.
    expect(after.some((x) => x.startsWith("play:Song of Serenity"))).toBe(false);
  });
});

describe("Shadow of the Wolf (101741) — a strike and a strength, as credits", () => {
  it("grants the additional strike and the round strength before range", () => {
    const a = inCombat("Shadow of the Wolf", { pro: "superior" });
    const ids = walkTo(a.engine, "combat.beforeRange");
    const id = ids.find((x) => x.startsWith("play:Shadow of the Wolf:basic"));
    // It must be offered HERE — the standalone additional-strike primitive
    // would have put this mode in the choose-strike window instead (§3).
    expect(id, "not offered before range").toBeDefined();
    a.engine.choose(id!);
    settle(a.engine);
    const cf = combat(a.state);
    expect(cf.additionalStrikes.acting).toBe(1);
    expect(cf.strengthBonusRound.acting).toBe(1);
    expect(cf.strengthBonus.acting).toBe(0); // the ROUND, not the combat
  });

  it("superior adds a per-round press; basic adds none", () => {
    for (const [mode, press] of [
      ["basic", 0],
      ["superior", 1],
    ] as const) {
      const a = inCombat("Shadow of the Wolf", { pro: "superior" });
      const ids = walkTo(a.engine, "combat.beforeRange");
      a.engine.choose(ids.find((x) => x.startsWith(`play:Shadow of the Wolf:${mode}`))!);
      settle(a.engine);
      const cf = combat(a.state);
      expect(cf.presses.acting, `${mode} press`).toBe(press);
      expect(cf.pressesCombat.acting, `${mode} combat press`).toBe(0);
      // Both modes grant the strike and the strength.
      expect(cf.additionalStrikes.acting, `${mode} strike`).toBe(1);
      expect(cf.strengthBonusRound.acting, `${mode} strength`).toBe(1);
    }
  });
});

describe("the scopes tell themselves apart in round 2", () => {
  /** Play the mode, then press into round 2 and report the fields there. */
  function intoRoundTwo(
    card: string,
    mode: string,
    d: Record<string, "basic" | "superior">,
  ): { round: number; actingCombat: number; actingRound: number; oppCombat: number; oppRound: number } {
    const a = inCombat(card, d);
    combat(a.state).pressesCombat.acting += 1;
    const ids = walkTo(a.engine, "combat.beforeRange");
    a.engine.choose(ids.find((x) => x.startsWith(`play:${card}:${mode}`))!);
    settle(a.engine);
    for (let i = 0; i < 30; i++) {
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
    return {
      round: cf.round,
      actingCombat: cf.strengthBonus.acting,
      actingRound: cf.strengthBonusRound.acting,
      oppCombat: cf.strengthBonus.opposing,
      oppRound: cf.strengthBonusRound.opposing,
    };
  }

  it("Fists of Death survives the round boundary", () => {
    const r = intoRoundTwo("Fists of Death", "basic", { pot: "superior" });
    expect(r.round).toBe(2);
    expect(r.actingCombat).toBe(1);
  });

  it("Shadow of the Wolf's strength does NOT", () => {
    const r = intoRoundTwo("Shadow of the Wolf", "basic", { pro: "superior" });
    expect(r.round).toBe(2);
    expect(r.actingRound).toBe(0);
    expect(r.actingCombat).toBe(0);
  });

  it("Song of Serenity: the basic lapses and the superior persists", () => {
    const basic = intoRoundTwo("Song of Serenity", "basic", { ani: "superior" });
    expect(basic.round).toBe(2);
    expect(basic.oppRound).toBe(0);
    expect(basic.oppCombat).toBe(0);

    const sup = intoRoundTwo("Song of Serenity", "superior", { ani: "superior" });
    expect(sup.round).toBe(2);
    expect(sup.oppCombat).toBe(-1);
  });
});
