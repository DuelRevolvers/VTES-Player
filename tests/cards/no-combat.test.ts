/**
 * Blocked, but no combat (docs/no-combat-design.md).
 *
 * Clan Loyalty (100354), Blood Brother Ambush (100195), Ghoul Escort
 * (100817) — three cards that replace the SECOND consequence of a
 * successful block (p. 27). The first consequence still happened: the
 * blocker locked, and for two of the three the action is still blocked.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function combat(state: GameState): CombatFrame | undefined {
  const f = state.frames.find((x) => x.kind === "combat");
  return f?.kind === "combat" ? f : undefined;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  const h = testRegistry[name];
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h?.permanentStatics ?? {},
    tags: h?.permanentTags ?? [],
    ...over,
  };
}

/**
 * Alice's V1 bleeds and Bob's W blocks — the combat is live in its FIRST
 * window, which is where all three cards are played. `sameClan` gives
 * both vampires a clan, which Clan Loyalty needs.
 */
function blocked(card: string | null, sameClan = false, retainer?: PermanentInPlay) {
  const state = threeSeatGame();
  Object.assign(find(state, "V1")!, { blood: 5 });
  Object.assign(find(state, "W")!, { blood: 5 });
  if (sameClan) {
    find(state, "V1")!.clan = "Brujah";
    find(state, "W")!.clan = "Brujah";
  }
  if (card) state.seats[0]!.hand.push({ id: "wave", name: card });
  if (retainer) find(state, "V1")!.attached.push(retainer);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:W"],
  ]);
  return { state, engine };
}

/** Pass until the named option is on the table. */
function walkTo(engine: VtesEngine, prefix: string, limit = 8): boolean {
  for (let i = 0; i < limit; i++) {
    if (optionIds(engine).some((x) => x.startsWith(prefix))) return true;
    const dp = engine.decision();
    if (!dp) return false;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
  return optionIds(engine).some((x) => x.startsWith(prefix));
}

/** Let the played card resolve out of its as-played window. */
function settle(engine: VtesEngine, passes = 6): void {
  for (let i = 0; i < passes; i++) {
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

// ---------------------------------------------------------------------------

describe("Clan Loyalty (100354)", () => {
  it("cancels the block and the combat, and unlocks the blocker", () => {
    const { state, engine } = blocked("Clan Loyalty", true);
    expect(walkTo(engine, "play:Clan Loyalty")).toBe(true);
    runTrace(engine, [["Alice", optionIds(engine).find((i) => i.startsWith("play:Clan Loyalty"))!]]);
    settle(engine);
    // No combat, and the action is live again.
    expect(combat(state)).toBeUndefined();
    expect(state.frames.some((f) => f.kind === "action")).toBe(true);
    // "The blocking minion is not locked" [ANK 20180321].
    expect(find(state, "W")!.locked).toBe(false);
    // "…and no vampires of that clan may block the acting vampire for
    // the remainder of the turn."
    const tf = state.frames.find((f) => f.kind === "turn");
    expect(tf?.kind === "turn" && tf.clanBlockBars?.[0]).toMatchObject({
      acting: "V1",
      clan: "Brujah",
    });
  });

  it("NEGATIVE SPACE: not offered when the blocker is a DIFFERENT clan", () => {
    const { engine } = blocked("Clan Loyalty", false);
    expect(walkTo(engine, "play:Clan Loyalty")).toBe(false);
  });
});

describe("Ghoul Escort (100817)", () => {
  it("burns itself to unlock the acting vampire instead of fighting", () => {
    const { state, engine } = blocked(null, false, entry("ge", "Ghoul Escort", { life: 4 }));
    const id = "ability:Ghoul Escort:ge:escort";
    expect(walkTo(engine, id)).toBe(true);
    runTrace(engine, [["Alice", id]]);
    expect(combat(state)).toBeUndefined();
    expect(find(state, "V1")!.locked).toBe(false);
    // "(This does not unlock the blocker.)"
    expect(find(state, "W")!.locked).toBe(true);
    // The retainer paid for it.
    expect(find(state, "V1")!.attached.some((p) => p.card.id === "ge")).toBe(false);
  });
});

describe("Blood Brother Ambush (100195)", () => {
  it("replaces the combat with one against the ally it becomes", () => {
    const { state, engine } = blocked("Blood Brother Ambush");
    expect(walkTo(engine, "play:Blood Brother Ambush")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((i) => i.startsWith("play:Blood Brother Ambush"))!],
    ]);
    settle(engine);
    // The card is now a minion of Alice's, with its printed stats…
    const ally = find(state, "wave");
    expect(ally?.kind).toBe("ally");
    expect(ally?.blood).toBe(3);
    // …and it is the one in combat with the blocker, not V1.
    const cf = combat(state);
    expect(cf && [cf.acting, cf.opposing]).toContain("wave");
    expect(cf && [cf.acting, cf.opposing]).toContain("W");
  });
});
