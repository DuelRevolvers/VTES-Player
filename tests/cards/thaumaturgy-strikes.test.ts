/**
 * Thaumaturgy ranged strikes (docs/thaumaturgy-strikes-design.md).
 *
 * Drain Essence (100582), Eldritch Glimmer (100624), Machine Blitz (101137).
 *
 * Three [tha] ranged strikes whose AMOUNT is not a printed constant. All three
 * are fought at LONG range, because that is where a ranged strike is worth
 * having and where a hand strike answers with nothing — so the damage on the
 * table is the card's alone.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/**
 * Alice's V1 bleeds, Bob's M blocks. `foeWeapon` is a REAL registry card by
 * name, never invented — an invented weapon has no profile, so a test that
 * reads a weapon's damage would read 0 and pass for the wrong reason
 * (docs/bigger-strikes-design.md §5).
 */
function inCombat(
  card: string,
  opts: { blood?: number; foeWeapon?: string; round?: number } = {},
): { state: GameState; engine: VtesEngine; v1: MinionState; m: MinionState } {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, {
    blood: opts.blood ?? 4,
    capacity: 4,
    disciplines: { tha: "superior" as const },
    strength: 1,
  });
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  Object.assign(m, { blood: m.capacity, strength: 1 });
  if (opts.foeWeapon) {
    m.attached.push({
      card: { id: "fw1", name: opts.foeWeapon },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["equipment", "weapon"],
    });
  }
  state.seats[0]!.hand.push({ id: "th1", name: card });
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
  // Long range, and past the first round for the two cards that need it.
  cf.range = "long";
  cf.round = opts.round ?? 2;
  return { state, engine, v1, m };
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

describe("Drain Essence (100582) — steal, do not damage", () => {
  it("moves 2 blood at basic and 4 at superior", () => {
    for (const [mode, amount] of [
      ["basic", 2],
      ["superior", 4],
    ] as const) {
      const a = inCombat("Drain Essence");
      const mBefore = a.m.blood;
      const vBefore = a.v1.blood;
      const ids = walkTo(a.engine, "combat.chooseStrike");
      const id = ids.find((x) => x.startsWith(`play:Drain Essence:${mode}`));
      expect(id, `${mode} not offered`).toBeDefined();
      a.engine.choose(id!);
      settle(a.engine);
      playOut(a.engine, a.state);
      // Stolen, not dealt: M loses it and V1 GAINS it, capped by capacity 4
      // and less the card's 1 blood cost.
      expect(mBefore - a.m.blood, `${mode} taken`).toBe(amount);
      expect(a.v1.blood, `${mode} gained`).toBeGreaterThan(vBefore - 1);
    }
  });

  it("takes only what is there, with no gate on the victim's blood", () => {
    // "Can target a minion with less blood or life than the amount stolen"
    // [RTR 20010711] — so the superior is offered against a 1-blood victim
    // and simply takes the 1.
    const a = inCombat("Drain Essence");
    a.m.blood = 1;
    const ids = walkTo(a.engine, "combat.chooseStrike");
    const id = ids.find((x) => x.startsWith("play:Drain Essence:superior"));
    expect(id, "gated on the victim's blood").toBeDefined();
    a.engine.choose(id!);
    settle(a.engine);
    playOut(a.engine, a.state);
    expect(a.m.blood).toBe(0);
  });

  it("NEGATIVE SPACE: not usable in the first round", () => {
    const a = inCombat("Drain Essence", { round: 1 });
    const ids = walkTo(a.engine, "combat.chooseStrike");
    expect(ids).toContain("strike:hand");
    expect(ids.some((x) => x.startsWith("play:Drain Essence"))).toBe(false);
  });
});

describe("Eldritch Glimmer (100624) — buy damage with blood", () => {
  it("offers one option per affordable X, and X lands as damage", () => {
    const a = inCombat("Eldritch Glimmer", { blood: 3 });
    const ids = walkTo(a.engine, "combat.chooseStrike").filter((x) =>
      x.startsWith("play:Eldritch Glimmer:basic"),
    );
    // 3 blood less the card's 1 leaves X in 0..2 — three options.
    expect(ids.length).toBe(3);

    const mBefore = a.m.blood;
    const biggest = ids.find((x) => x.endsWith(":2:th1")) ?? ids[ids.length - 1]!;
    a.engine.choose(biggest);
    settle(a.engine);
    playOut(a.engine, a.state);
    // 2R base plus X=2 burned.
    expect(mBefore - a.m.blood).toBe(4);
    // 1 for the card, 2 for X.
    expect(a.v1.blood).toBe(0);
  });

  it("X=0 is a legal choice and costs nothing extra", () => {
    const a = inCombat("Eldritch Glimmer", { blood: 3 });
    const mBefore = a.m.blood;
    const ids = walkTo(a.engine, "combat.chooseStrike");
    const zero = ids.find((x) => x.startsWith("play:Eldritch Glimmer:basic") && x.includes(":0:"));
    expect(zero, "X=0 not offered").toBeDefined();
    a.engine.choose(zero!);
    settle(a.engine);
    playOut(a.engine, a.state);
    expect(mBefore - a.m.blood).toBe(2);
    expect(a.v1.blood).toBe(2); // 3 less the card's 1, nothing burned for X
  });

  it("superior is 4R plus X", () => {
    const a = inCombat("Eldritch Glimmer", { blood: 3 });
    const mBefore = a.m.blood;
    const ids = walkTo(a.engine, "combat.chooseStrike");
    const zero = ids.find(
      (x) => x.startsWith("play:Eldritch Glimmer:superior") && x.includes(":0:"),
    )!;
    a.engine.choose(zero);
    settle(a.engine);
    playOut(a.engine, a.state);
    expect(mBefore - a.m.blood).toBe(4);
  });
});

describe("Machine Blitz (101137) — X is the opponent's own weapon", () => {
  it("reads the chosen weapon's damage, and +1 at superior", () => {
    // Ivory Bow is a real ranged weapon; its profile damage is what the
    // ruling calls the weapon's "current damage" [RTR 19980623].
    for (const [mode, plus] of [
      ["basic", 0],
      ["superior", 1],
    ] as const) {
      const a = inCombat("Machine Blitz", { foeWeapon: "Ivory Bow" });
      const profile = testRegistry["Ivory Bow"]?.weaponProfile?.damage;
      expect(profile, "Ivory Bow has no weapon profile").toBeGreaterThan(0);
      const mBefore = a.m.blood;
      const ids = walkTo(a.engine, "combat.chooseStrike");
      const id = ids.find((x) => x.startsWith(`play:Machine Blitz:${mode}`));
      expect(id, `${mode} not offered`).toBeDefined();
      // The chosen weapon rides in the option id.
      expect(id!).toContain("fw1");
      a.engine.choose(id!);
      settle(a.engine);
      playOut(a.engine, a.state);
      expect(mBefore - a.m.blood, `${mode} damage`).toBe(profile! + plus);
    }
  });

  it("NEGATIVE SPACE: not offered when the opponent carries no weapon", () => {
    const a = inCombat("Machine Blitz");
    const ids = walkTo(a.engine, "combat.chooseStrike");
    expect(ids).toContain("strike:hand");
    expect(ids.some((x) => x.startsWith("play:Machine Blitz"))).toBe(false);
  });

  it("does NOT use the weapon: it is still there afterwards", () => {
    // "Does not count as using the weapon: no restriction nor side-effect
    // applies" [LSJ 20010806-1]. A burn-after-use weapon would be gone if this
    // went through the weapon-strike path.
    const a = inCombat("Machine Blitz", { foeWeapon: "Ivory Bow" });
    const ids = walkTo(a.engine, "combat.chooseStrike");
    a.engine.choose(ids.find((x) => x.startsWith("play:Machine Blitz:basic"))!);
    settle(a.engine);
    playOut(a.engine, a.state);
    expect(a.m.attached.some((p) => p.card.id === "fw1")).toBe(true);
  });
});
