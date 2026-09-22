/**
 * Bleed payoffs (docs/bleed-payoffs-design.md).
 *
 * Legal Manipulations (101089), Media Influence (101193),
 * Flurry of Action (100752).
 *
 * Three directed BLEED actions whose superior changes what the bleed buys —
 * pool, cards, or an unlock. Two have the identical basic, which is the control
 * that makes a wrong bonus visible.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/**
 * Alice holds `card` and has a SECOND unlocked vampire V2, which Media
 * Influence's superior needs something to pay. Bob is Alice's prey.
 */
function setup(
  card: string,
  disciplines: Record<string, "basic" | "superior">,
): { state: GameState; engine: VtesEngine; v1: MinionState; v2: MinionState } {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, { blood: 4, capacity: 4, disciplines });
  const v2 = makeMinion("V2", "Alice", { blood: 2, capacity: 5, disciplines });
  state.seats[0]!.minions.push(v2);
  // A library to draw from: `threeSeatGame` leaves it empty, and a draw rider
  // against an empty library is indistinguishable from no rider at all.
  state.seats[0]!.library = Array.from({ length: 10 }, (_, i) => ({
    id: `lib${i}`,
    name: "Conditioning",
  }));
  state.seats[0]!.hand.push({ id: "bp1", name: card });
  return { state, engine: new VtesEngine(state, testRegistry), v1, v2 };
}

/**
 * Announce the card's action and run it to resolution unopposed.
 *
 * `take` is an option prefix to ACCEPT rather than pass. Flurry of Action's
 * unlock is raised as an OPTIONAL choice frame, so a walker that only ever
 * passes declines it — and "the actor is still locked" then says nothing about
 * the card.
 */
function playUnblocked(
  engine: VtesEngine,
  state: GameState,
  id: string,
  take?: string,
): void {
  runTrace(engine, [["Alice", id]]);
  for (let i = 0; i < 30; i++) {
    const dp = engine.decision();
    if (!dp) return;
    if (dp.window === "turn.minion") return;
    const wanted = take ? dp.options.find((o) => o.id.startsWith(take)) : undefined;
    const pick =
      wanted ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "strike:hand");
    if (!pick) return;
    engine.choose(pick.id);
  }
  void state;
}

/** The option id for a mode, found on the table rather than guessed. */
function offered(engine: VtesEngine, prefix: string, limit = 8): string | null {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return null;
    const hit = dp.options.find((o) => o.id.startsWith(prefix));
    if (hit) return hit.id;
    const pick = dp.options.find((o) => o.id === "pass");
    if (!pick) return null;
    engine.choose(pick.id);
  }
  return null;
}

// ---------------------------------------------------------------------------

describe("the identical basics", () => {
  // Legal Manipulations and Media Influence print the same basic: a directed
  // bleed at +2, [pre], 1 blood. Either card alone would look right with the
  // wrong bonus; the pair is what pins it.
  for (const card of ["Legal Manipulations", "Media Influence"] as const) {
    it(`${card}'s basic bleeds for 1 + 2`, () => {
      const a = setup(card, { pre: "superior" });
      const bobBefore = a.state.seats[1]!.pool;
      const id = offered(a.engine, `play:${card}:basic`);
      expect(id, "basic not offered").not.toBeNull();
      playUnblocked(a.engine, a.state, id!);
      // A bleed of 1 plus the card's +2.
      expect(bobBefore - a.state.seats[1]!.pool).toBe(3);
    });
  }
});

describe("Legal Manipulations (101089) — the payoff is POOL", () => {
  it("superior bleeds and gains 1 pool on success", () => {
    const a = setup("Legal Manipulations", { pre: "superior" });
    const aliceBefore = a.state.seats[0]!.pool;
    const bobBefore = a.state.seats[1]!.pool;
    const id = offered(a.engine, "play:Legal Manipulations:superior");
    playUnblocked(a.engine, a.state, id!);
    expect(bobBefore - a.state.seats[1]!.pool).toBe(3);
    // 1 pool gained. The card costs BLOOD, not pool, so this is clean.
    expect(a.state.seats[0]!.pool - aliceBefore).toBe(1);
  });

  it("NEGATIVE SPACE: no pool when the bleed is blocked", () => {
    const a = setup("Legal Manipulations", { pre: "superior" });
    const aliceBefore = a.state.seats[0]!.pool;
    const id = offered(a.engine, "play:Legal Manipulations:superior");
    runTrace(a.engine, [
      ["Alice", id!],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
    ]);
    for (let i = 0; i < 30; i++) {
      const dp = a.engine.decision();
      if (!dp || dp.window === "turn.minion") break;
      const pick =
        dp.options.find((o) => o.id === "pass") ??
        dp.options.find((o) => o.id === "strike:hand");
      if (!pick) break;
      a.engine.choose(pick.id);
    }
    expect(a.state.seats[0]!.pool).toBe(aliceBefore);
  });
});

describe("Flurry of Action (100752) — the payoff is CARDS, then an unlock", () => {
  it("basic bleeds for 1 and draws two, then discards back to hand size", () => {
    const a = setup("Flurry of Action", { cel: "superior" });
    const bobBefore = a.state.seats[1]!.pool;
    const handBefore = a.state.seats[0]!.hand.length;
    const libBefore = a.state.seats[0]!.library.length;
    const id = offered(a.engine, "play:Flurry of Action:basic");
    playUnblocked(a.engine, a.state, id!);
    // A plain bleed: no bonus.
    expect(bobBefore - a.state.seats[1]!.pool).toBe(1);
    // THREE cards leave the library: one is the played card's own replacement
    // (p. 7), two are the rider. The control below is what separates them —
    // counting 3 here alone would also hold for a card with no rider at all
    // that happened to draw twice for some other reason.
    expect(libBefore - a.state.seats[0]!.library.length).toBe(3);
    // The hand is UNDER its size here, so "(discard afterward)" takes nothing:
    // this is a discard-DOWN, not a draw-up-to-size (§3).
    expect(a.state.seats[0]!.hand.length).toBe(handBefore - 1 + 3);
  });

  it("CONTROL: a bleed action with NO draw rider takes only its replacement", () => {
    // One card out of the library, not three — so the two above are the rider.
    const a = setup("Legal Manipulations", { pre: "superior" });
    const libBefore = a.state.seats[0]!.library.length;
    const id = offered(a.engine, "play:Legal Manipulations:basic");
    playUnblocked(a.engine, a.state, id!);
    expect(libBefore - a.state.seats[0]!.library.length).toBe(1);
  });

  it("superior unlocks the actor on success", () => {
    const a = setup("Flurry of Action", { cel: "superior" });
    const id = offered(a.engine, "play:Flurry of Action:superior");
    playUnblocked(a.engine, a.state, id!);
    // Announcing locked V1 (p. 19); the card hands it back.
    expect(a.v1.locked).toBe(false);
  });

  it("CONTROL: its BASIC leaves the actor locked", () => {
    // Otherwise "unlocked" above would hold for a card that never locked it.
    const a = setup("Flurry of Action", { cel: "superior" });
    const id = offered(a.engine, "play:Flurry of Action:basic");
    playUnblocked(a.engine, a.state, id!);
    expect(a.v1.locked).toBe(true);
  });
});

describe("Media Influence (101193) — the superior does not bleed at all", () => {
  it("gives each UNLOCKED vampire a blood and takes no pool", () => {
    const a = setup("Media Influence", { pre: "superior" });
    const bobBefore = a.state.seats[1]!.pool;
    const v2Before = a.v2.blood;
    const id = offered(a.engine, "play:Media Influence:superior");
    playUnblocked(a.engine, a.state, id!);
    // Not a bleed: Bob loses nothing.
    expect(a.state.seats[1]!.pool).toBe(bobBefore);
    // V2 is unlocked and gains; V1 announced the action and so is locked.
    expect(a.v2.blood).toBe(v2Before + 1);
  });

  it("does NOT pay a locked vampire", () => {
    // The actor is locked by its own announcement, which is the case the card's
    // wording turns on — and a lock is the only thing separating the two
    // vampires in this fixture.
    const a = setup("Media Influence", { pre: "superior" });
    const v1Before = a.v1.blood;
    const id = offered(a.engine, "play:Media Influence:superior");
    playUnblocked(a.engine, a.state, id!);
    // V1 paid 1 blood for the card and gained nothing back.
    expect(a.v1.blood).toBe(v1Before - 1);
  });
});
