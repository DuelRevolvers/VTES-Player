/**
 * Borrowed minions (docs/borrowed-minions-design.md).
 *
 * The Art of Love (100096), Malkavian Dementia (101150),
 * From a Sinking Ship (100793).
 *
 * Three masters that take a minion off another Methuselah. One mechanism; the
 * family differs along two axes, and both are asserted by comparing the cards
 * against each other rather than one at a time:
 *
 *   HOW LONG   end of your turn → your next unlock phase → never given back
 *   WHO        an ally          → a ready Malkavian      → anyone a poor
 *                                                          Methuselah controls
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/**
 * The target a master option names. The id is
 * `play:<Name>:<mode|->:<params…>:<cardInstanceId>`, so the target is the
 * second-to-last segment — NOT the last, which is the card instance. The first
 * draft of this file matched the end of the string and reported every one of
 * these cards as offering nothing.
 */
function targetOf(id: string): string {
  const parts = id.split(":");
  return parts[parts.length - 2] ?? "";
}

/** Who controls a minion right now, by reading whose array holds it (p. 16). */
function controllerOf(state: GameState, id: string): string | undefined {
  return state.seats.find((s) => s.minions.some((m) => m.id === id))?.id;
}

/**
 * Alice is in her MASTER phase with one action. Bob controls a ready Malkavian
 * (MK, capacity 4), a ready non-Malkavian (W), a locked Malkavian (LK) and an
 * ally (AL). Alice controls an ally of her own (MINE), which no card here may
 * take — "controlled by ANOTHER Methuselah" is in all three.
 *
 * Carol is the poor seat, on 3 pool, and controls a big vampire (BIG, capacity
 * 8) and a small one (N, capacity 4): From a Sinking Ship may have the small one
 * and not the big one.
 */
function game(card: string): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const bob = seatOf(state, "Bob");
  Object.assign(find(state, "W")!, { clan: "Brujah", capacity: 5, blood: 2 });
  bob.minions = bob.minions.filter((m) => m.id === "W");
  bob.minions.push(makeMinion("MK", "Bob", { clan: "Malkavian", capacity: 4, blood: 2 }));
  bob.minions.push(
    makeMinion("LK", "Bob", { clan: "Malkavian", capacity: 3, blood: 1, locked: true }),
  );
  bob.minions.push(makeAlly("AL", "Bob", 2));
  seatOf(state, "Alice").minions.push(makeAlly("MINE", "Alice", 2));

  const carol = seatOf(state, "Carol");
  carol.pool = 3;
  Object.assign(find(state, "N")!, { capacity: 4, blood: 2 });
  carol.minions.push(makeMinion("BIG", "Carol", { capacity: 8, blood: 4 }));

  seatOf(state, "Alice").hand.push({ id: "bm", name: card });
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = "master";
    tf.masterActionsLeft = 1;
  }
  return { state, engine: new VtesEngine(state, testRegistry) };
}

/** Play the master card on `target`, then settle its as-played window. */
function playOn(engine: VtesEngine, card: string, target: string): void {
  const id = optionIds(engine).find(
    (o) => o.startsWith(`play:${card}`) && targetOf(o) === target,
  );
  if (!id) throw new Error(`${card} not offered on ${target}: ${optionIds(engine).join(", ")}`);
  engine.choose(id);
  for (let i = 0; i < 8; i++) {
    const dp = engine.decision();
    const pass = dp?.options.find((o) => o.id === "pass");
    if (!pass) return;
    engine.choose(pass.id);
  }
}

/** Walk until the turn frame belongs to `seat` and its unlock sweep is done. */
function walkToTurnOf(engine: VtesEngine, state: GameState, seat: string, limit = 400): void {
  for (let i = 0; i < limit; i++) {
    const tf = state.frames[0];
    if (tf?.kind === "turn" && tf.seat === seat && tf.unlockDone === true && tf.phase !== "unlock") {
      return;
    }
    const dp = engine.decision();
    if (!dp) return;
    const pick =
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "end") ??
      dp.options[0];
    if (!pick) return;
    engine.choose(pick.id);
  }
  throw new Error(`never reached ${seat}'s turn`);
}

// ---------------------------------------------------------------------------

describe("who may be taken — the same rule in all three cards", () => {
  it("never your OWN minion", () => {
    for (const card of ["The Art of Love", "Malkavian Dementia", "From a Sinking Ship"] as const) {
      const a = game(card);
      const ids = optionIds(a.engine).filter((o) => o.startsWith(`play:${card}`));
      expect(ids.some((o) => targetOf(o) === "MINE"), `${card} offered Alice's own ally`).toBe(false);
    }
  });
});

describe("The Art of Love (100096) — an ally, until the end of your turn", () => {
  it("offers only ALLIES of other Methuselahs", () => {
    const a = game("The Art of Love");
    const ids = optionIds(a.engine).filter((o) => o.startsWith("play:The Art of Love"));
    expect(ids.some((o) => targetOf(o) === "AL")).toBe(true);
    // Vampires are not allies, however ready they are.
    for (const who of ["W", "MK", "N", "BIG"]) {
      expect(ids.some((o) => targetOf(o) === who), `offered ${who}`).toBe(false);
    }
  });

  it("takes the ally, and gives it back at the end of the turn", () => {
    const a = game("The Art of Love");
    playOn(a.engine, "The Art of Love", "AL");
    expect(controllerOf(a.state, "AL")).toBe("Alice");
    expect(find(a.state, "AL")!.controller).toBe("Alice");

    walkToTurnOf(a.engine, a.state, "Bob");
    // Bob's turn: the loan is over and everything on the ally went home (p. 16).
    expect(controllerOf(a.state, "AL")).toBe("Bob");
    expect(find(a.state, "AL")!.controlRevertsTo).toBeUndefined();
  });
});

describe("Malkavian Dementia (101150) — a ready Malkavian, a whole turn longer", () => {
  it("offers only MALKAVIANS, and a LOCKED one counts as ready", () => {
    const a = game("Malkavian Dementia");
    const ids = optionIds(a.engine).filter((o) => o.startsWith("play:Malkavian Dementia"));
    expect(ids.some((o) => targetOf(o) === "MK")).toBe(true);
    // "Ready" is the region, not the lock (p. 11): LK is locked and legal.
    expect(ids.some((o) => targetOf(o) === "LK")).toBe(true);
    // Not the Brujah, and not an ally.
    expect(ids.some((o) => targetOf(o) === "W")).toBe(false);
    expect(ids.some((o) => targetOf(o) === "AL")).toBe(false);
  });

  it("NEGATIVE SPACE: a Malkavian in TORPOR is not ready", () => {
    const a = game("Malkavian Dementia");
    find(a.state, "MK")!.inTorpor = true;
    find(a.state, "LK")!.inTorpor = true;
    expect(
      optionIds(a.engine).some((o) => o.startsWith("play:Malkavian Dementia")),
    ).toBe(false);
  });

  it("THE DIFFERENCE: still yours at the end of the turn, back at your unlock", () => {
    const a = game("Malkavian Dementia");
    // LK, the LOCKED Malkavian, so the lock state is observable on the way
    // back: a minion borrowed locked must not come home rested.
    playOn(a.engine, "Malkavian Dementia", "LK");
    expect(controllerOf(a.state, "LK")).toBe("Alice");

    // Bob's turn — where The Art of Love would already have ended. This is the
    // assertion that the two durations are not the same code path.
    walkToTurnOf(a.engine, a.state, "Bob");
    expect(controllerOf(a.state, "LK")).toBe("Alice");
    walkToTurnOf(a.engine, a.state, "Carol");
    expect(controllerOf(a.state, "LK")).toBe("Alice");

    // …and back the moment Alice's own unlock phase comes round.
    walkToTurnOf(a.engine, a.state, "Alice");
    expect(controllerOf(a.state, "LK")).toBe("Bob");
    // Returned BEFORE the unlock sweep, so the borrower's own unlock phase does
    // not rest somebody else's vampire on the way out of the door: LK goes home
    // locked and unlocks in Bob's next unlock phase.
    expect(find(a.state, "LK")!.locked).toBe(true);
    expect(find(a.state, "LK")!.controlRevertsTo).toBeUndefined();
  });
});

describe("From a Sinking Ship (100793) — a theft, from a Methuselah who is sinking", () => {
  it("offers only minions of a Methuselah on 3 or fewer pool", () => {
    const a = game("From a Sinking Ship");
    const ids = optionIds(a.engine).filter((o) => o.startsWith("play:From a Sinking Ship"));
    // Carol is on 3 pool; Bob is on 10.
    expect(ids.some((o) => targetOf(o) === "N")).toBe(true);
    for (const who of ["W", "MK", "AL"]) {
      expect(ids.some((o) => targetOf(o) === who), `offered Bob's ${who}`).toBe(false);
    }
  });

  it("NEGATIVE SPACE: not a vampire with capacity 7 or more", () => {
    const a = game("From a Sinking Ship");
    const ids = optionIds(a.engine).filter((o) => o.startsWith("play:From a Sinking Ship"));
    // BIG is capacity 8 and Carol's, so only the cap keeps it out.
    expect(ids.some((o) => targetOf(o) === "BIG")).toBe(false);
  });

  it("keeps the minion: no loan, no return", () => {
    const a = game("From a Sinking Ship");
    playOn(a.engine, "From a Sinking Ship", "N");
    expect(controllerOf(a.state, "N")).toBe("Alice");
    // No return address at all — the difference between a theft and a loan.
    expect(find(a.state, "N")!.controlRevertsTo).toBeUndefined();
    walkToTurnOf(a.engine, a.state, "Bob");
    expect(controllerOf(a.state, "N")).toBe("Alice");
    walkToTurnOf(a.engine, a.state, "Alice");
    expect(controllerOf(a.state, "N")).toBe("Alice");
  });

  it("ONCE IN A GAME, and the pool is paid", () => {
    const a = game("From a Sinking Ship");
    const before = seatOf(a.state, "Alice").pool;
    seatOf(a.state, "Alice").hand.push({ id: "bm2", name: "From a Sinking Ship" });
    playOn(a.engine, "From a Sinking Ship", "N");
    expect(seatOf(a.state, "Alice").pool).toBe(before - 1);
    // A second master action, a second copy in hand, and no option.
    const tf = a.state.frames[0]!;
    if (tf.kind === "turn") tf.masterActionsLeft = 1;
    expect(
      optionIds(a.engine).some((o) => o.startsWith("play:From a Sinking Ship")),
    ).toBe(false);
  });
});
