/**
 * Stripping the gear (docs/equipment-stripping-design.md).
 *
 * Fractured Armament (100784), Shattering Blow (101760),
 * Canine Horde (100290), Fast Hands (100704).
 *
 * Four strikes that take an opponent's equipment away. The tests are about
 * the contrasts: destroy versus STEAL (where the card survives and changes
 * bearer), with and without damage on top, and the negative space — a card
 * that can only take gear is not offered when there is none to take.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/**
 * Alice's V1 bleeds, Bob's M blocks, and M is carrying `gear`. The card
 * instance ids are `eq*` / `gear1`, never `c1` — `threeSeatGame` already uses
 * that for Conditioning (docs/positional-combat-design.md §5).
 */
function inCombat(
  card: string,
  disciplines: Record<string, "basic" | "superior">,
  // `readonly` because the table below builds these with `as const`, and
  // vitest does not typecheck — only `npm run typecheck` sees this.
  gear: { name: string; tags: readonly string[] } | null = {
    name: "Leather Jacket",
    tags: ["equipment"],
  },
): { state: GameState; engine: VtesEngine; v1: MinionState; m: MinionState } {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, { blood: 4, capacity: 4, disciplines });
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  m.blood = m.capacity;
  if (gear) {
    m.attached.push({
      card: { id: "gear1", name: gear.name },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: [...gear.tags],
    });
  }
  state.seats[0]!.hand.push({ id: "eq1", name: card });
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

/** Walk to the strike step and return Alice's options. */
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

/**
 * Let a card play RESOLVE. `chooseCardStrike` runs in `resolve`, which is
 * AFTER the as-played window has gone round the table — so reading
 * `cf.strikes` straight after `choose` reads it before the strike exists.
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

/** Finish the combat, passing and hand-striking. */
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

const inPlay = (state: GameState, cardId: string): boolean =>
  state.seats.some((s) =>
    s.minions.some((m) => m.attached.some((p) => p.card.id === cardId)),
  );

const heldBy = (state: GameState, cardId: string): string | null => {
  for (const s of state.seats) {
    for (const m of s.minions) {
      if (m.attached.some((p) => p.card.id === cardId)) return m.id;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------

describe("destroying equipment", () => {
  for (const card of ["Fractured Armament", "Shattering Blow"] as const) {
    it(`${card} offers one option per equipment and destroys the chosen one`, () => {
      const a = inCombat(card, { pot: "superior" });
      const ids = atStrike(a.engine);
      const id = ids.find((x) => x.startsWith(`play:${card}:basic`));
      expect(id, "not offered against a carried equipment").toBeDefined();
      // The chosen card rides in the option id — that is the whole of how
      // "destroy equipment" picks its target.
      expect(id).toContain("gear1");
      a.engine.choose(id!);
      playOut(a.engine, a.state);
      expect(inPlay(a.state, "gear1")).toBe(false);
    });

    it(`${card} is NOT offered when the opposing minion carries nothing`, () => {
      const a = inCombat(card, { pot: "superior" }, null);
      const ids = atStrike(a.engine);
      // The window is open and Alice is being asked, so the negative is real.
      expect(ids).toContain("strike:hand");
      expect(ids.some((x) => x.startsWith(`play:${card}`))).toBe(false);
    });
  }

  it("Fractured Armament's superior destroys AND deals its 1 damage", () => {
    const a = inCombat("Fractured Armament", { pot: "superior" });
    const before = a.m.blood;
    const ids = atStrike(a.engine);
    a.engine.choose(ids.find((x) => x.startsWith("play:Fractured Armament:superior"))!);
    playOut(a.engine, a.state);
    expect(inPlay(a.state, "gear1")).toBe(false);
    // The damage used to be unreachable: the resolution returned as soon as
    // it had burned the card (§2).
    expect(a.m.blood).toBe(before - 1);
  });

  it("Shattering Blow's superior destroys and deals NO damage", () => {
    // The pair with the assertion above: same discipline, same basic, and the
    // superiors buy different things. Without this, a spec that copied
    // Fractured Armament's `damage: 1` onto Shattering Blow would pass.
    const a = inCombat("Shattering Blow", { pot: "superior" });
    const before = a.m.blood;
    const ids = atStrike(a.engine);
    a.engine.choose(ids.find((x) => x.startsWith("play:Shattering Blow:superior"))!);
    playOut(a.engine, a.state);
    expect(inPlay(a.state, "gear1")).toBe(false);
    expect(a.m.blood).toBe(before);
  });
});

describe("Canine Horde (100290) — two different KINDS of strike", () => {
  it("basic deals 1R damage and takes nothing", () => {
    const a = inCombat("Canine Horde", { ani: "superior" });
    const before = a.m.blood;
    const ids = atStrike(a.engine);
    a.engine.choose(ids.find((x) => x.startsWith("play:Canine Horde:basic"))!);
    playOut(a.engine, a.state);
    expect(a.m.blood).toBe(before - 1);
    expect(inPlay(a.state, "gear1")).toBe(true);
  });

  it("superior takes the equipment and deals nothing", () => {
    const a = inCombat("Canine Horde", { ani: "superior" });
    const before = a.m.blood;
    const ids = atStrike(a.engine);
    a.engine.choose(ids.find((x) => x.startsWith("play:Canine Horde:superior"))!);
    playOut(a.engine, a.state);
    expect(inPlay(a.state, "gear1")).toBe(false);
    expect(a.m.blood).toBe(before);
  });

  it("its BASIC is still offered with nothing to destroy", () => {
    // Only the superior takes gear, so the range gate on the card as a whole
    // must not follow: a gate that hid the whole card would look identical in
    // a test that only checked the superior was gone.
    const a = inCombat("Canine Horde", { ani: "superior" }, null);
    const ids = atStrike(a.engine);
    expect(ids.some((x) => x.startsWith("play:Canine Horde:basic"))).toBe(true);
    expect(ids.some((x) => x.startsWith("play:Canine Horde:superior"))).toBe(false);
  });
});

describe("the first-strike flag reaches the strike", () => {
  /** The strike Alice has chosen, straight off the combat frame. */
  function actingStrike(state: GameState): { firstStrike?: boolean } | null {
    const cf = state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat frame");
    return cf.strikes.acting;
  }

  // Three of these superiors print "with first strike" and their basics do
  // not. Nothing else in this file reads the flag, so without this pair a
  // spec that dropped `firstStrike` would pass every other assertion here.
  for (const [card, d, gear] of [
    ["Shattering Blow", { pot: "superior" as const }, null],
    ["Canine Horde", { ani: "superior" as const }, null],
    [
      "Fast Hands",
      { cel: "superior" as const },
      { name: "Bowl of Convergence", tags: ["equipment", "weapon", "melee"] },
    ],
  ] as const) {
    it(`${card}: superior strikes first, basic does not`, () => {
      const sup = inCombat(card, d, gear ?? undefined);
      const sIds = atStrike(sup.engine);
      sup.engine.choose(sIds.find((x) => x.startsWith(`play:${card}:superior`))!);
      settle(sup.engine);
      expect(actingStrike(sup.state)?.firstStrike, `${card} superior`).toBe(true);

      const bas = inCombat(card, d, gear ?? undefined);
      const bIds = atStrike(bas.engine);
      bas.engine.choose(bIds.find((x) => x.startsWith(`play:${card}:basic`))!);
      settle(bas.engine);
      expect(actingStrike(bas.state)?.firstStrike ?? false, `${card} basic`).toBe(false);
    });
  }
});

describe("Fast Hands (100704) — STEALING, not destroying", () => {
  const weapon = { name: "Bowl of Convergence", tags: ["equipment", "weapon", "melee"] };

  it("moves the weapon to the striker instead of burning it", () => {
    const a = inCombat("Fast Hands", { cel: "superior" }, weapon);
    const ids = atStrike(a.engine);
    const id = ids.find((x) => x.startsWith("play:Fast Hands:basic"));
    expect(id).toBeDefined();
    a.engine.choose(id!);
    playOut(a.engine, a.state);
    // Still in play — and on V1 now. This is the assertion that separates
    // stealing from destroying; `inPlay` alone would pass for neither.
    expect(inPlay(a.state, "gear1")).toBe(true);
    expect(heldBy(a.state, "gear1")).toBe("V1");
  });

  it("takes a WEAPON only, not any equipment", () => {
    // The destroy cards take any equipment; "steal weapon" does not. A plain
    // piece of equipment leaves Fast Hands with nothing to take.
    const a = inCombat("Fast Hands", { cel: "superior" }, {
      name: "Leather Jacket",
      tags: ["equipment"],
    });
    const ids = atStrike(a.engine);
    expect(ids).toContain("strike:hand");
    expect(ids.some((x) => x.startsWith("play:Fast Hands"))).toBe(false);
  });

  it("is not offered with nothing carried at all", () => {
    const ids = atStrike(inCombat("Fast Hands", { cel: "superior" }, null).engine);
    expect(ids).toContain("strike:hand");
    expect(ids.some((x) => x.startsWith("play:Fast Hands"))).toBe(false);
  });
});
