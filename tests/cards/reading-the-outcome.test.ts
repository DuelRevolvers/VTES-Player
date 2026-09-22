/**
 * Reading the outcome (docs/reading-the-outcome-design.md).
 *
 * Innocent Bystander (100987), Burnt Offerings (100272), Zephyr (102205).
 *
 * Three cards played AFTER an action resolves, each gating on how it went. The
 * after-resolution window already existed, so what these test is the CONDITION
 * — a bleed that succeeded, read from both sides of the table, and an action
 * that failed.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Alice's V1 bleeds Bob. `aliceCards` / `bobCards` go into hand as `ro*`. */
function setup(
  aliceCards: string[],
  bobCards: string[] = [],
  bobDisciplines: Record<string, "basic" | "superior"> = {},
): { state: GameState; engine: VtesEngine; v1: MinionState; m: MinionState } {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, { blood: 5, capacity: 5, disciplines: { cel: "superior" as const } });
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  Object.assign(m, { blood: m.capacity, disciplines: bobDisciplines });
  // `threeSeatGame` leaves every crypt EMPTY, and Innocent Bystander removes
  // the top card of one — so the fixture has to BUILD the crypt it needs rather
  // than assume it. An empty crypt is also the card's own negative case, which
  // is why that test empties it again explicitly.
  // The crypt holds whole MINIONS, not card stubs — `makeMinion`, not a
  // `{id, name}` literal. (vitest passes the literal happily; only
  // `npm run typecheck` sees it.)
  state.seats[1]!.crypt = [
    makeMinion("bcrypt1", "Bob", { capacity: 3 }),
    makeMinion("bcrypt2", "Bob", { capacity: 4 }),
  ];
  state.seats[0]!.crypt = [makeMinion("acrypt1", "Alice", { capacity: 3 })];
  aliceCards.forEach((n, i) => state.seats[0]!.hand.push({ id: `roa${i}`, name: n }));
  bobCards.forEach((n, i) => state.seats[1]!.hand.push({ id: `rob${i}`, name: n }));
  return { state, engine: new VtesEngine(state, testRegistry), v1, m };
}

/**
 * Advance until `prefix` is on the table, and return its id.
 *
 * It must be able to walk through a COMBAT, because a blocked action only fails
 * once the combat is over — Zephyr's own ruling says it is played "after
 * resolution, after all combats (if any) are handled". A walker that only knows
 * `pass` stops dead at the choose-strike step and reports "not offered".
 */
function offeredTo(engine: VtesEngine, prefix: string, limit = 40): string | null {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return null;
    const hit = dp.options.find((o) => o.id.startsWith(prefix));
    if (hit) return hit.id;
    const pick =
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "strike:hand") ??
      dp.options.find((o) => o.id.startsWith("strike:"));
    if (!pick) return null;
    engine.choose(pick.id);
  }
  return null;
}

const everOffered = (engine: VtesEngine, prefix: string, limit = 40): boolean =>
  offeredTo(engine, prefix, limit) !== null;

/** Let a played card resolve through its as-played window. */
function settle(engine: VtesEngine, steps = 6): void {
  for (let i = 0; i < steps; i++) {
    const dp = engine.decision();
    if (!dp || dp.window !== "card.asPlayed") return;
    const pick = dp.options.find((o) => o.id === "pass");
    if (!pick) return;
    engine.choose(pick.id);
  }
}

/**
 * Play out the REST OF ALICE'S TURN and stop the moment it is over.
 *
 * Bounded deliberately. A walker that just ran for 60 steps sailed on into
 * Alice's NEXT turn, whose unlock phase unlocks V1 for free — so "V1 is
 * unlocked" held whether or not the card had done anything, and a mutation that
 * deleted the end-of-turn debt entirely still passed. Stopping at the turn
 * boundary is what makes the assertion about the card.
 */
function endAlicesTurn(engine: VtesEngine, state: GameState, limit = 60): void {
  const turnSeat = (): string | null => {
    const tf = [...state.frames].reverse().find((f) => f.kind === "turn");
    return tf?.kind === "turn" ? tf.seat : null;
  };
  for (let i = 0; i < limit; i++) {
    if (turnSeat() !== "Alice") return;
    const dp = engine.decision();
    if (!dp) return;
    const pick =
      dp.options.find((o) => o.id === "end") ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "strike:hand");
    if (!pick) return;
    engine.choose(pick.id);
  }
}

// ---------------------------------------------------------------------------

describe("Innocent Bystander (100987) — the victim's crypt", () => {
  it("removes the top card of the BLED Methuselah's crypt from the game", () => {
    const a = setup(["Innocent Bystander"]);
    const bobCryptBefore = a.state.seats[1]!.crypt.length;
    const aliceCryptBefore = a.state.seats[0]!.crypt.length;
    const topId = a.state.seats[1]!.crypt[0]!.id;
    runTrace(a.engine, [["Alice", "bleed:V1"]]);
    const id = offeredTo(a.engine, "play:Innocent Bystander");
    expect(id, "never offered after a successful bleed").not.toBeNull();
    a.engine.choose(id!);
    settle(a.engine);
    // BOB's crypt, not Alice's — the card names the Methuselah that was bled.
    expect(a.state.seats[1]!.crypt.length).toBe(bobCryptBefore - 1);
    expect(a.state.seats[0]!.crypt.length).toBe(aliceCryptBefore);
    // Removed from the game: it is in no zone at all (p. 16).
    expect(a.state.seats[1]!.crypt.some((c) => c.id === topId)).toBe(false);
    expect(a.state.seats[1]!.ashHeap?.some((c) => c.id === topId) ?? false).toBe(false);
  });

  it("NEGATIVE SPACE: not offered when the target crypt is EMPTY", () => {
    // "Cannot be played when the target crypt is empty" [RTR 20000501].
    const a = setup(["Innocent Bystander"]);
    a.state.seats[1]!.crypt = [];
    runTrace(a.engine, [["Alice", "bleed:V1"]]);
    expect(everOffered(a.engine, "play:Innocent Bystander")).toBe(false);
  });

  it("NEGATIVE SPACE: not offered when the bleed was blocked", () => {
    // "Only usable when this acting vampire SUCCESSFULLY bleeds."
    const a = setup(["Innocent Bystander"]);
    runTrace(a.engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
    ]);
    expect(everOffered(a.engine, "play:Innocent Bystander")).toBe(false);
  });
});

describe("Burnt Offerings (100272) — the same bleed, from the other side", () => {
  it("its superior burns a pool from the predator who bled you", () => {
    // Alice is Bob's predator in seat order, so Bob answers her successful
    // bleed. The pool burnt is the ACTING seat's.
    const a = setup([], ["Burnt Offerings"], { aus: "superior" });
    const aliceBefore = a.state.seats[0]!.pool;
    runTrace(a.engine, [["Alice", "bleed:V1"]]);
    const id = offeredTo(a.engine, "play:Burnt Offerings:superior");
    expect(id, "superior never offered to the bled seat").not.toBeNull();
    a.engine.choose(id!);
    settle(a.engine);
    // 1 blood is Bob's cost for the card; the pool comes off ALICE.
    expect(aliceBefore - a.state.seats[0]!.pool).toBe(1);
  });

  it("NEGATIVE SPACE: its superior is not offered when the bleed was blocked", () => {
    const a = setup([], ["Burnt Offerings"], { aus: "superior" });
    runTrace(a.engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
    ]);
    expect(everOffered(a.engine, "play:Burnt Offerings:superior")).toBe(false);
  });

  it("does NOT require three Methuselahs, unlike My Enemy's Enemy", () => {
    // The clause that used to be welded into `predatorBleedingYou`. With one
    // seat ousted there are two Methuselahs left, and Burnt Offerings — which
    // does not print the clause — must still work.
    const a = setup([], ["Burnt Offerings"], { aus: "superior" });
    a.state.seats[2]!.ousted = true;
    const aliceBefore = a.state.seats[0]!.pool;
    runTrace(a.engine, [["Alice", "bleed:V1"]]);
    const id = offeredTo(a.engine, "play:Burnt Offerings:superior");
    expect(id, "the seat-count clause is still welded on").not.toBeNull();
    a.engine.choose(id!);
    settle(a.engine);
    expect(aliceBefore - a.state.seats[0]!.pool).toBe(1);
  });
});

describe("Zephyr (102205) — after an action that FAILED", () => {
  /** Alice bleeds, Bob blocks; the action fails. Stop where Alice may answer. */
  function blockedBleed(cards: string[]): ReturnType<typeof setup> {
    const a = setup(cards);
    runTrace(a.engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
    ]);
    return a;
  }

  it("its superior unlocks the actor immediately", () => {
    const a = blockedBleed(["Zephyr"]);
    const id = offeredTo(a.engine, "play:Zephyr:superior");
    expect(id, "superior never offered after a failed action").not.toBeNull();
    expect(a.v1.locked).toBe(true);
    a.engine.choose(id!);
    settle(a.engine);
    expect(a.v1.locked).toBe(false);
  });

  it("its basic leaves the actor locked NOW and unlocks at the turn's end", () => {
    const a = blockedBleed(["Zephyr"]);
    const id = offeredTo(a.engine, "play:Zephyr:basic");
    expect(id, "basic never offered").not.toBeNull();
    a.engine.choose(id!);
    settle(a.engine);
    // The whole difference between the two modes: still locked right now, and
    // the unlock is OWED on the turn frame rather than done.
    expect(a.v1.locked).toBe(true);
    const tf = [...a.state.frames].reverse().find((f) => f.kind === "turn");
    expect(tf?.kind === "turn" ? tf.unlockAfterTurn : undefined).toContain("V1");
    endAlicesTurn(a.engine, a.state);
    expect(a.v1.locked).toBe(false);
  });

  it("CONTROL: without the card the actor is still locked when the turn ends", () => {
    // Otherwise "V1 is unlocked" above would hold for a card that did nothing:
    // a locked vampire unlocks for free in its controller's NEXT unlock phase,
    // so the assertion only means something at the turn boundary.
    const a = blockedBleed([]);
    const walked = offeredTo(a.engine, "play:nothing-at-all", 40);
    expect(walked).toBeNull(); // just walks the action out
    endAlicesTurn(a.engine, a.state);
    expect(a.v1.locked).toBe(true);
  });

  it("NEGATIVE SPACE: not offered after a bleed that SUCCEEDED", () => {
    // "Only usable after resolution of an UNSUCCESSFUL action" — and an
    // unblocked bleed resolves, which is also why a FIZZLE is excluded
    // [ANK 20220218]: the engine records it as successful.
    const a = setup(["Zephyr"]);
    runTrace(a.engine, [["Alice", "bleed:V1"]]);
    expect(everOffered(a.engine, "play:Zephyr")).toBe(false);
  });
});
