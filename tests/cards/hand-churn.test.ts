/**
 * Churning the hand (docs/hand-churn-design.md).
 *
 * Deal with the Devil (100506), Lupine Assault (101133),
 * Specialization (101842), Servitor of Irad (101729).
 *
 * Four cards whose whole effect is on HANDS rather than on the board. The
 * thing worth pinning is the ORDER: a card that throws its own hand away
 * must not draw its replacement into that hand first, and a card that
 * refills must refill to the hand size in force, not to seven.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

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

/** `n` distinct library cards, named so a test can tell them apart. */
function library(prefix: string, n: number): Array<{ id: string; name: string }> {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    name: i % 2 === 0 ? "Conditioning" : "Deflection",
  }));
}

function masterPhase(state: GameState, seat = "Alice"): GameState {
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.seat = seat;
    tf.phase = "master";
    tf.masterActionsLeft = 1;
  }
  return state;
}

/** Walk to the start of the next Methuselah's turn — the unlock phase opens
 *  as a turn begins and cannot be set by hand. */
function walkToNextTurn(engine: VtesEngine, state: GameState, limit = 160): void {
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

const asPlayed: Array<[string, string]> = [
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
];

// ---------------------------------------------------------------------------

describe("Deal with the Devil (100506)", () => {
  it("throws the whole hand away and draws a fresh one", () => {
    const state = masterPhase(threeSeatGame());
    const alice = seatOf(state, "Alice");
    alice.hand.push(
      { id: "dd", name: "Deal with the Devil" },
      { id: "h1", name: "Conditioning" },
      { id: "h2", name: "Deflection" },
    );
    alice.library.push(...library("l", 20));
    const before = new Set(alice.hand.map((c) => c.id));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "play:Deal with the Devil"], ...asPlayed]);

    // A new hand, up to hand size, and not one card of the old one.
    expect(alice.hand.length).toBe(7);
    expect(alice.hand.every((c) => !before.has(c.id))).toBe(true);
    // The old hand is in the ash heap — discarded, not removed.
    expect(alice.ashHeap?.some((c) => c.id === "h1")).toBe(true);
    expect(alice.ashHeap?.some((c) => c.id === "h2")).toBe(true);
  });

  it("does not draw its own replacement into the hand it discards", () => {
    const state = masterPhase(threeSeatGame());
    const alice = seatOf(state, "Alice");
    alice.hand.push({ id: "dd", name: "Deal with the Devil" });
    // One card in the library, so the replacement is identifiable.
    alice.library.push({ id: "first", name: "Govern the Unaligned" });
    alice.library.push(...library("l", 20));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "play:Deal with the Devil"], ...asPlayed]);
    // "Do not replace this card until AFTER you discard your hand": the top
    // card must be in the NEW hand, not in the ash heap.
    expect(alice.hand.some((c) => c.id === "first")).toBe(true);
    expect(alice.ashHeap?.some((c) => c.id === "first")).not.toBe(true);
  });
});

describe("Lupine Assault (101133)", () => {
  function game(): { state: GameState; engine: VtesEngine } {
    const state = masterPhase(threeSeatGame());
    for (const seat of state.seats) {
      seat.hand.push(...library(`${seat.id}h`, 6));
      seat.library.push(...library(`${seat.id}l`, 20));
    }
    seatOf(state, "Alice").hand.push({ id: "la", name: "Lupine Assault" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("asks EVERY Methuselah for five discards, then refills each hand", () => {
    const { state, engine } = game();
    runTrace(engine, [["Alice", "play:Lupine Assault"], ...asPlayed]);

    // Each seat answers its own frame, five times. A walker that just takes
    // the first option is exactly the player choosing.
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const pick = dp.options.find((o) => o.id.includes(":tableDiscard:"));
      if (!pick) break;
      seen.add(dp.seat);
      engine.choose(pick.id);
    }
    // All three seats were asked, not just the card's player.
    expect([...seen].sort()).toEqual(["Alice", "Bob", "Carol"]);
    for (const seat of state.seats) {
      expect(seat.hand.length).toBe(7);
      expect((seat.ashHeap ?? []).length).toBeGreaterThanOrEqual(5);
    }
  });

  it("can only be played once in a game", () => {
    const { state, engine } = game();
    runTrace(engine, [["Alice", "play:Lupine Assault"], ...asPlayed]);
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const pick = dp.options.find((o) => o.id.includes(":tableDiscard:"));
      if (!pick) break;
      engine.choose(pick.id);
    }
    // A second copy, same phase: the game-long bar is on the NAME.
    seatOf(state, "Alice").hand.push({ id: "la2", name: "Lupine Assault" });
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.masterActionsLeft = 1;
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((i) =>
        i.startsWith("play:Lupine Assault"),
      ),
    ).toBe(false);
  });
});

describe("Specialization (101842)", () => {
  function game(hand: Array<{ id: string; name: string }>): GameState {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("sp", "Specialization", "Alice"));
    seatOf(state, "Alice").hand = hand;
    seatOf(state, "Alice").library.push(...library("l", 20));
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Carol";
      tf.phase = "discard"; // the next turn — and unlock phase — is Alice's
    }
    return state;
  }

  it("offers one option per DUPLICATE name, and none for a singleton", () => {
    const state = game([
      { id: "a1", name: "Conditioning" },
      { id: "a2", name: "Conditioning" },
      { id: "b1", name: "Deflection" },
    ]);
    const engine = new VtesEngine(state, testRegistry);
    walkToNextTurn(engine, state);
    const ids = optionIds(engine).filter((i) => i.includes("pairpool"));
    // Two Conditionings are a pair; the lone Deflection is not.
    expect(ids).toEqual(["ability:Specialization:sp:pairpool:Conditioning"]);
  });

  it("discards the two copies for 1 pool, replacing both, and locks", () => {
    const state = game([
      { id: "a1", name: "Conditioning" },
      { id: "a2", name: "Conditioning" },
      { id: "b1", name: "Deflection" },
    ]);
    const pool = seatOf(state, "Alice").pool;
    const engine = new VtesEngine(state, testRegistry);
    walkToNextTurn(engine, state);
    runTrace(engine, [["Alice", "ability:Specialization:sp:pairpool:Conditioning"]]);

    const alice = seatOf(state, "Alice");
    expect(alice.pool).toBe(pool + 1);
    expect(alice.hand.some((c) => c.id === "a1" || c.id === "a2")).toBe(false);
    // "(draw afterward)" is the ordinary replacement: two out, two in.
    expect(alice.hand.length).toBe(3);
    expect(alice.permanents[0]!.locked).toBe(true);
    // One lock, one use per unlock phase.
    expect(optionIds(engine).some((i) => i.includes("pairpool"))).toBe(false);
  });
});

describe("Servitor of Irad (101729)", () => {
  it("draws two when ANY Methuselah plays a Gehenna card", () => {
    const state = masterPhase(threeSeatGame(), "Bob");
    const alice = seatOf(state, "Alice");
    find(state, "V1")!.blood = 2;
    find(state, "V1")!.attached.push(inPlay("si", "Servitor of Irad", "Alice"));
    alice.library.push(...library("l", 20));
    // BOB plays the Gehenna event; the draw is ALICE's.
    seatOf(state, "Bob").hand.push({ id: "ge", name: "Blood Trade" });
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "discard";
    const engine = new VtesEngine(state, testRegistry);
    const before = alice.hand.length;

    const play = optionIds(engine).find((i) => i.startsWith("play:Blood Trade"));
    expect(play).toBeDefined();
    engine.choose(play!);
    // Walk the as-played window and any discard-down question the draw causes.
    for (let i = 0; i < 20; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const pick =
        dp.options.find((o) => o.id === "pass") ??
        dp.options.find((o) => o.id.startsWith("choice:")) ??
        dp.options.find((o) => o.id === "end");
      if (!pick) break;
      engine.choose(pick.id);
    }
    // Two extra cards, then p. 7's discard-down: a hand that was at or below
    // size ends at size, and the draw is visible in the log either way.
    expect(
      state.eventLog.filter((e) => e.type === "CardDrawn" && e.seat === "Alice").length,
    ).toBeGreaterThanOrEqual(2);
    expect(alice.hand.length).toBeLessThanOrEqual(7);
    void before;
  });

  it("draws nothing while the bearer is not ready", () => {
    const state = masterPhase(threeSeatGame(), "Bob");
    const alice = seatOf(state, "Alice");
    Object.assign(find(state, "V1")!, { inTorpor: true });
    find(state, "V1")!.attached.push(inPlay("si", "Servitor of Irad", "Alice"));
    alice.library.push(...library("l", 20));
    seatOf(state, "Bob").hand.push({ id: "ge", name: "Blood Trade" });
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "discard";
    const engine = new VtesEngine(state, testRegistry);

    const play = optionIds(engine).find((i) => i.startsWith("play:Blood Trade"));
    engine.choose(play!);
    for (let i = 0; i < 12; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const pick = dp.options.find((o) => o.id === "pass");
      if (!pick) break;
      engine.choose(pick.id);
    }
    expect(
      state.eventLog.some((e) => e.type === "CardDrawn" && e.seat === "Alice"),
    ).toBe(false);
  });
});
