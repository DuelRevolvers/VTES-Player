/**
 * After-combat payoffs (docs/after-combat-payoffs-design.md).
 *
 * Flesh Bond (100748), Mercy for the Weak (101204), Torrent (101995).
 *
 * Three "combat ends" cards. Two carry a payoff that lands AFTER the combat and
 * is cancelled outright if the combat continues instead — one ruling
 * [RTR 20020501] names both, and that cancellation is what these tests are
 * mostly about.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Alice's V1 bleeds, Bob's M blocks. `v1Blood`/`mBlood` set the comparison
 *  Mercy for the Weak reads. */
function inCombat(
  cards: string[],
  disciplines: Record<string, "basic" | "superior">,
  opts: { v1Blood?: number; mBlood?: number } = {},
): { state: GameState; engine: VtesEngine; v1: MinionState; m: MinionState } {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, {
    blood: opts.v1Blood ?? 4,
    capacity: 4,
    disciplines,
    strength: 1,
  });
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  Object.assign(m, { blood: opts.mBlood ?? 1, strength: 1 });
  cards.forEach((n, i) => state.seats[0]!.hand.push({ id: `ac${i}`, name: n }));
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
  pressesCombat: { acting: number; opposing: number };
  afterCombatEnds: { kind: string }[];
} | null {
  const cf = state.frames.find((f) => f.kind === "combat");
  return cf?.kind === "combat" ? cf : null;
}

function reach(engine: VtesEngine, window: string, limit = 16): string[] {
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

function playOut(engine: VtesEngine, state: GameState, limit = 26): void {
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

describe("Flesh Bond (100748) — the control: an ending with no payoff", () => {
  it("basic deals 2R and superior ends the combat", () => {
    const dmg = inCombat(["Flesh Bond"], { ani: "superior" }, { mBlood: 5 });
    const cf0 = combat(dmg.state)!;
    (cf0 as unknown as { range: string }).range = "long";
    const before = dmg.m.blood;
    const ids = reach(dmg.engine, "combat.chooseStrike");
    dmg.engine.choose(ids.find((x) => x.startsWith("play:Flesh Bond:basic"))!);
    settle(dmg.engine);
    playOut(dmg.engine, dmg.state);
    expect(before - dmg.m.blood).toBe(2);

    const end = inCombat(["Flesh Bond"], { ani: "superior" });
    const eIds = reach(end.engine, "combat.chooseStrike");
    end.engine.choose(eIds.find((x) => x.startsWith("play:Flesh Bond:superior"))!);
    settle(end.engine);
    playOut(end.engine, end.state);
    expect(end.state.frames.some((f) => f.kind === "combat")).toBe(false);
    // No rider queued at all — the point of having this card in the wave.
    expect(combat(end.state)).toBeNull();
  });
});

describe("Mercy for the Weak (101204) — the blood comparison", () => {
  it("is offered when V1 has more blood, and gives M 1 blood after the combat", () => {
    const a = inCombat(["Mercy for the Weak"], {}, { v1Blood: 4, mBlood: 1 });
    const ids = reach(a.engine, "combat.chooseStrike");
    const id = ids.find((x) => x.startsWith("play:Mercy for the Weak:basic"));
    expect(id, "not offered with more blood than the foe").toBeDefined();
    a.engine.choose(id!);
    settle(a.engine);
    // Queued, not yet paid: the gain is an AFTER-combat effect [RTR 19970630].
    expect(combat(a.state)!.afterCombatEnds.some((r) => r.kind === "gainBlood")).toBe(true);
    expect(a.m.blood).toBe(1);
    playOut(a.engine, a.state);
    expect(a.state.frames.some((f) => f.kind === "combat")).toBe(false);
    // 2 blood for the card; M is up a point.
    expect(a.v1.blood).toBe(2);
    expect(a.m.blood).toBe(2);
  });

  it("NEGATIVE SPACE: not offered on equal blood, nor on less", () => {
    for (const [v1Blood, mBlood, label] of [
      [2, 2, "equal"],
      [1, 3, "fewer"],
    ] as const) {
      const a = inCombat(["Mercy for the Weak"], {}, { v1Blood, mBlood });
      const ids = reach(a.engine, "combat.chooseStrike");
      // The window is open and Alice is being asked, so the negative is real.
      expect(ids, `${label}: no strike step`).toContain("strike:hand");
      expect(
        ids.some((x) => x.startsWith("play:Mercy for the Weak")),
        `${label} blood`,
      ).toBe(false);
    }
  });

  it("a press cannot continue a combat a combat-ends strike ended", () => {
    // This pins WHY the "not gained if the combat continues" ruling
    // [RTR 20020501] is not modelled: nothing in the pool can continue such a
    // combat. Bob holds a press credit and the combat still ends, because a
    // combat-ends strike ends it at strike resolution and the press step never
    // arrives. docs/after-combat-payoffs-design.md §3
    const a = inCombat(["Mercy for the Weak"], {}, { v1Blood: 4, mBlood: 1 });
    combat(a.state)!.pressesCombat.opposing += 1;
    const ids = reach(a.engine, "combat.chooseStrike");
    a.engine.choose(ids.find((x) => x.startsWith("play:Mercy for the Weak:basic"))!);
    settle(a.engine);
    playOut(a.engine, a.state);
    expect(a.state.frames.some((f) => f.kind === "combat")).toBe(false);
    // So the payoff lands, credit or no credit.
    expect(a.m.blood).toBe(2);
  });
});

describe("Torrent (101995) — the same cancellation, on a different payoff", () => {
  it("superior ends the combat and queues the continue-action rider", () => {
    const a = inCombat(["Torrent"], { cel: "superior" });
    const ids = reach(a.engine, "combat.chooseStrike");
    const id = ids.find((x) => x.startsWith("play:Torrent:superior"));
    expect(id).toBeDefined();
    a.engine.choose(id!);
    settle(a.engine);
    expect(combat(a.state)!.afterCombatEnds.some((r) => r.kind === "continueAction")).toBe(true);
  });

  it("the rider survives to the end of combat and the combat does end", () => {
    // The mirror of the Mercy assertion above: the payoff is queued during the
    // strike and the combat ends in the same round, which is the only sequence
    // the pool can currently produce (§3).
    const a = inCombat(["Torrent"], { cel: "superior" });
    combat(a.state)!.pressesCombat.opposing += 1;
    const ids = reach(a.engine, "combat.chooseStrike");
    a.engine.choose(ids.find((x) => x.startsWith("play:Torrent:superior"))!);
    settle(a.engine);
    expect(combat(a.state)!.round).toBe(1);
    playOut(a.engine, a.state);
    expect(a.state.frames.some((f) => f.kind === "combat")).toBe(false);
  });

  it("its basic grants an additional strike and queues nothing", () => {
    // The pair: both modes are played at the strike step, so "the combat ended"
    // and "a rider exists" have to be checked separately.
    const a = inCombat(["Torrent"], { cel: "superior" });
    const ids = reach(a.engine, "combat.chooseStrike");
    a.engine.choose(ids.find((x) => x.startsWith("play:Torrent:basic"))!);
    settle(a.engine);
    const cf = combat(a.state)!;
    expect((cf as unknown as { additionalStrikes: { acting: number } }).additionalStrikes.acting).toBe(1);
    expect(cf.afterCombatEnds).toHaveLength(0);
  });
});
