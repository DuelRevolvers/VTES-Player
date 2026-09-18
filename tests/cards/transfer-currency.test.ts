/**
 * Transfers as a currency (docs/transfer-currency-design.md).
 *
 * Ennoia's Theater (100646), King's Rising (101059),
 * Whispers of the Nictuku (102176), Inconnu Tutelage (100970).
 *
 * Four different relationships to one counter: gained, banned, spent to
 * burn a card, spent to find one. The interesting assertions are the ones
 * about WHOSE currency it is — two of these cards are used by Methuselahs
 * who did not play them — and about what the ban does NOT bar.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, handSizeOf } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** A card in play carrying the statics ITS SPEC COMPILED — building the
 *  entry by hand with an empty `statics` is how a printed clause quietly
 *  does not exist in a test. */
function inPlay(id: string, name: string, controller: string): PermanentInPlay {
  const h = testRegistry[name];
  if (!h) throw new Error(`no handler for ${name}`);
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: { ...(h.permanentStatics ?? {}) },
    tags: [...(h.permanentTags ?? [])],
    controller,
  };
}

/** Walk to the start of the NEXT Methuselah's turn, preferring `pass` — the
 *  unlock phase is where three of these four cards act, and it belongs to
 *  the seat whose turn is beginning. The fixture's order is Alice, Bob,
 *  Carol, so "whose unlock phase" is chosen by where the walk starts. */
function walkToNextTurn(engine: VtesEngine, state: GameState, limit = 120): void {
  const tf0 = state.frames[0]!;
  const from = tf0.kind === "turn" ? tf0.seat : "";
  for (let i = 0; i < limit; i++) {
    const tf = state.frames[0]!;
    if (tf.kind === "turn" && tf.seat !== from) return;
    const dp = engine.decision();
    if (!dp) return;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options.find((o) => o.id === "end");
    if (!pick) return;
    engine.choose(pick.id);
  }
  throw new Error("never reached the next turn");
}

/** `seat`'s influence phase, with `transfers` left. */
function influencePhase(state: GameState, seat: string, transfers: number): GameState {
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn frame");
  tf.seat = seat;
  tf.phase = "influence";
  tf.transfersLeft = transfers;
  return state;
}

// ---------------------------------------------------------------------------

describe("Ennoia's Theater (100646)", () => {
  function game(transfers = 1): GameState {
    const state = threeSeatGame();
    find(state, "V1").clan = "Gangrel";
    seatOf(state, "Alice").permanents.push(inPlay("et", "Ennoia's Theater", "Alice"));
    return influencePhase(state, "Alice", transfers);
  }

  it("locks for +1 transfer — the currency going UP", () => {
    const state = game(1);
    const engine = new VtesEngine(state, testRegistry);
    expect(optionIds(engine)).toContain("ability:Ennoia's Theater:et:gaintransfers");
    runTrace(engine, [["Alice", "ability:Ennoia's Theater:et:gaintransfers"]]);
    const tf = state.frames[0]!;
    expect(tf.kind === "turn" && tf.transfersLeft).toBe(2);
    expect(seatOf(state, "Alice").permanents[0]!.locked).toBe(true);
  });

  it("has ONE lock: taking the transfer takes the hand size with it", () => {
    const state = game(1);
    const engine = new VtesEngine(state, testRegistry);
    // Both clauses are offered while it is unlocked — the hand-size one
    // prints no timing restriction at all.
    expect(optionIds(engine)).toContain("ability:Ennoia's Theater:et:handsize");
    runTrace(engine, [["Alice", "ability:Ennoia's Theater:et:gaintransfers"]]);
    expect(optionIds(engine).some((i) => i.includes("Ennoia's Theater"))).toBe(false);
  });

  it("+1 hand size is a grant on the TURN frame, worth 8 cards", () => {
    const state = game(1);
    const engine = new VtesEngine(state, testRegistry);
    expect(handSizeOf(state, "Alice")).toBe(7);
    runTrace(engine, [["Alice", "ability:Ennoia's Theater:et:handsize"]]);
    const tf = state.frames[0]!;
    expect(tf.kind === "turn" && (tf.handSizeBonus ?? []).length).toBe(1);
    // A TURN-scoped grant, which is what puts its expiry after the discard
    // phase rather than before it (p. 50).
    expect(handSizeOf(state, "Alice")).toBe(8);
  });

  it("requires a ready Gangrel to be played at all", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    seatOf(state, "Alice").hand.push({ id: "et", name: "Ennoia's Theater" });
    // V1 is clanless in the fixture.
    expect(optionIds(new VtesEngine(state, testRegistry))).not.toContain(
      "play:Ennoia's Theater:-:-:et",
    );
    find(state, "V1").clan = "Gangrel";
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((i) =>
        i.startsWith("play:Ennoia's Theater"),
      ),
    ).toBe(true);
  });
});

describe("King's Rising (101059)", () => {
  function game(pool: number): GameState {
    const state = threeSeatGame();
    seatOf(state, "Alice").pool = pool;
    seatOf(state, "Alice").hand.push({ id: "kr", name: "King's Rising" });
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    return state;
  }

  function play(state: GameState): VtesEngine {
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:King's Rising"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    return engine;
  }

  it("gains 3 pool at 5 or fewer, 1 pool above it", () => {
    const low = game(5);
    play(low);
    expect(seatOf(low, "Alice").pool).toBe(8);

    const high = game(6);
    play(high);
    expect(seatOf(high, "Alice").pool).toBe(7);
  });

  it("bars the counter transfers and NOT the crypt draw", () => {
    const state = game(6);
    play(state);
    seatOf(state, "Alice").uncontrolled.push({
      card: makeMinion("U1", "Alice", { capacity: 4 }),
      counters: 1,
    });
    seatOf(state, "Alice").crypt = [makeMinion("C1", "Alice", { capacity: 5 })];
    influencePhase(state, "Alice", 4);
    const ids = optionIds(new VtesEngine(state, testRegistry));
    expect(ids.some((i) => i.startsWith("inf:add"))).toBe(false);
    expect(ids.some((i) => i.startsWith("inf:take"))).toBe(false);
    // "…to move counters to or from your uncontrolled minions" — the crypt
    // draw moves no counter onto a minion, and it stays legal.
    expect(ids).toContain("inf:crypt");
  });

  it("does not bar influencing a FULL vampire out, which costs no transfer", () => {
    const state = game(6);
    play(state);
    seatOf(state, "Alice").uncontrolled.push({
      card: makeMinion("U1", "Alice", { capacity: 2 }),
      counters: 2,
    });
    influencePhase(state, "Alice", 0);
    expect(optionIds(new VtesEngine(state, testRegistry))).toContain("inf:out:U1");
  });

  it("survives another Methuselah's unlock phase — it says YOUR unlock phase", () => {
    const state = game(6);
    play(state);
    state.edge = "Alice";
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "discard";
    // The next turn is BOB's, so the next unlock phase is his.
    walkToNextTurn(new VtesEngine(state, testRegistry), state);
    expect(seatOf(state, "Alice").permanents.some((p) => p.card.id === "kr")).toBe(true);
  });

  it("burns itself when its controller has the Edge at their OWN unlock phase", () => {
    const state = game(6);
    play(state);
    state.edge = "Alice";
    const tf = state.frames[0]!;
    // Carol's discard phase: the next turn — and the next unlock phase —
    // is Alice's.
    if (tf.kind === "turn") {
      tf.seat = "Carol";
      tf.phase = "discard";
    }
    walkToNextTurn(new VtesEngine(state, testRegistry), state);
    expect(seatOf(state, "Alice").permanents.some((p) => p.card.id === "kr")).toBe(false);
    expect(
      state.eventLog.some((e) => e.type === "PermanentBurned" && e.name === "King's Rising"),
    ).toBe(true);
  });

  it("stays while its controller does NOT have the Edge", () => {
    const state = game(6);
    play(state);
    state.edge = "Bob";
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Carol";
      tf.phase = "discard";
    }
    walkToNextTurn(new VtesEngine(state, testRegistry), state);
    expect(seatOf(state, "Alice").permanents.some((p) => p.card.id === "kr")).toBe(true);
  });
});

describe("Whispers of the Nictuku (102176)", () => {
  /** The card is ALICE's; the tax is on every Nosferatu at the table, so
   *  the vampires it bites here are BOB's, and his unlock phase is the one
   *  after Alice's turn. */
  function game(): GameState {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("wn", "Whispers of the Nictuku", "Alice"));
    Object.assign(find(state, "W"), { clan: "Nosferatu", blood: 2, locked: true });
    Object.assign(find(state, "M"), { clan: "Brujah", blood: 1, locked: true });
    seatOf(state, "Bob").minions.push(
      makeMinion("P", "Bob", { clan: "Nosferatu", blood: 0, locked: true }),
    );
    return state;
  }

  it("a Nosferatu burns 1 blood to unlock; one with no blood stays locked", () => {
    const state = game();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "discard";
    walkToNextTurn(new VtesEngine(state, testRegistry), state);

    // W paid and unlocked; P could not pay and is still locked with the
    // blood it never had to spend; M is not a Nosferatu and unlocked free.
    expect(find(state, "W").blood).toBe(1);
    expect(find(state, "W").locked).toBe(false);
    expect(find(state, "P").locked).toBe(true);
    expect(find(state, "P").blood).toBe(0);
    expect(find(state, "M").locked).toBe(false);
    expect(find(state, "M").blood).toBe(1);
  });

  it("ANY Methuselah burns it for 1 pool and 4 transfers, in their OWN phase", () => {
    const state = game();
    influencePhase(state, "Bob", 4);
    const pool = seatOf(state, "Bob").pool;
    const engine = new VtesEngine(state, testRegistry);
    const id = "ability:Whispers of the Nictuku:wn:burnfor:Bob";
    expect(optionIds(engine)).toContain(id);
    runTrace(engine, [["Bob", id]]);
    // BOB paid, and ALICE's card left play.
    expect(seatOf(state, "Bob").pool).toBe(pool - 1);
    expect(seatOf(state, "Alice").permanents).toEqual([]);
    const tf = state.frames[0]!;
    expect(tf.kind === "turn" && tf.transfersLeft).toBe(0);
  });

  it("is not offered with only three transfers", () => {
    const state = game();
    influencePhase(state, "Bob", 3);
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((i) => i.includes("burnfor")),
    ).toBe(false);
  });
});

describe("Inconnu Tutelage (100970)", () => {
  function game(transfers: number, seat = "Alice"): GameState {
    const state = threeSeatGame();
    // Played by CAROL, used here by Alice.
    seatOf(state, "Carol").permanents.push(inPlay("it", "Inconnu Tutelage", "Carol"));
    seatOf(state, "Alice").uncontrolled.push({
      card: makeMinion("U1", "Alice", { capacity: 4 }),
      counters: 1,
    });
    seatOf(state, "Alice").library.push(
      { id: "l1", name: "Conditioning" },
      { id: "l2", name: "Govern the Unaligned" },
    );
    return influencePhase(state, seat, transfers);
  }

  it("spends four transfers and the uncontrolled vampire to find any card", () => {
    const state = game(4);
    const engine = new VtesEngine(state, testRegistry);
    const id = "ability:Inconnu Tutelage:it:tutor:Alice:U1";
    expect(optionIds(engine)).toContain(id);
    runTrace(engine, [["Alice", id]]);

    // Any card in the library, not a filtered subset.
    const ids = optionIds(engine);
    expect(ids).toContain("choice:Inconnu Tutelage:it:searchAnyToHand:l1");
    expect(ids).toContain("choice:Inconnu Tutelage:it:searchAnyToHand:l2");
    expect(ids).toContain("choice:Inconnu Tutelage:it:searchAnyToHand:none");

    runTrace(engine, [["Alice", "choice:Inconnu Tutelage:it:searchAnyToHand:l2"]]);
    const alice = seatOf(state, "Alice");
    expect(alice.hand.some((c) => c.id === "l2")).toBe(true);
    // REMOVED from the game (p. 16), not burned, and out of a region that
    // is not play.
    expect(alice.uncontrolled).toEqual([]);
    const tf = state.frames[0]!;
    expect(tf.kind === "turn" && tf.transfersLeft).toBe(0);
    expect(state.eventLog.some((e) => e.type === "LibraryShuffled")).toBe(true);
  });

  it("offers nothing to a Methuselah with no uncontrolled vampire", () => {
    const state = game(4);
    seatOf(state, "Alice").uncontrolled = [];
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((i) => i.includes(":tutor:")),
    ).toBe(false);
  });

  it("is the CONTROLLER's card and still nobody else's turn to use it", () => {
    // Carol's own influence phase: her card, her currency — she has no
    // uncontrolled vampire, so the option is hers to lack, not Alice's.
    const state = game(4, "Carol");
    const ids = optionIds(new VtesEngine(state, testRegistry));
    expect(ids.some((i) => i.includes(":tutor:Alice:"))).toBe(false);
    expect(ids.some((i) => i.includes(":tutor:Carol:"))).toBe(false);
  });
});
