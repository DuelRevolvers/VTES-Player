/**
 * Wave 103 — victory points (docs/victory-points-design.md).
 *
 * Momentum's Edge (101237), Gambit Accepted (100799), Lextalionis (101099),
 * Life Boon (101103) — the first cards that read, spend, move or date a
 * victory point. And what they found: two Methuselahs ousted at once were
 * scored one at a time, so a predator at 0 pool could be paid 6 pool for
 * its prey and survive (p. 46 says it does not).
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay, SeatState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const ids = (engine: VtesEngine): string[] => engine.decision()?.options.map((o) => o.id) ?? [];
const seat = (state: GameState, id: string): SeatState => {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
};
const minion = (state: GameState, id: string): MinionState => {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
};
const entry = (id: string, name: string, extra: Partial<PermanentInPlay> = {}): PermanentInPlay => ({
  card: { id, name },
  locked: false,
  usedThisPhase: false,
  statics: {},
  tags: [name],
  ...extra,
});
const turn = (state: GameState) => {
  const tf = state.frames[0];
  if (tf?.kind !== "turn") throw new Error("no turn frame");
  return tf;
};

/** `seatId`'s turn, at `phase`. */
function at(state: GameState, seatId: string, phase: "master" | "minion" | "unlock"): VtesEngine {
  const tf = turn(state);
  tf.seat = seatId;
  tf.phase = phase;
  if (phase === "master") tf.masterActionsLeft = 1;
  if (phase === "unlock") {
    Object.assign(tf, {
      unlockDone: false,
      edgeDone: false,
      unlockAbilitiesDone: false,
      unlockOthersDone: [],
    });
  }
  return new VtesEngine(state, testRegistry);
}

/** Answer every decision with `pass` (or the first option) while `keepGoing`
 *  holds, returning every option id seen on the way. */
function walk(engine: VtesEngine, keepGoing: () => boolean, limit = 80): string[] {
  const seen: string[] = [];
  for (let i = 0; i < limit && keepGoing(); i++) {
    const dp = engine.decision();
    if (!dp) break;
    seen.push(...dp.options.map((o) => o.id));
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return seen;
}

/** Answer with pass until `prefix` is offered; true if it was. */
function walkTo(engine: VtesEngine, prefix: string, limit = 80): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return false;
}

/** Pass the as-played window of a card just played. */
function passAsPlayed(engine: VtesEngine): void {
  while (engine.decision()?.window === "card.asPlayed") {
    runTrace(engine, [[engine.decision()!.seat, "pass"]]);
  }
}

/** A card in play, as if played: the `CardPlayed` event is what orders boons. */
function inPlay(state: GameState, holder: string, e: PermanentInPlay): void {
  seat(state, holder).permanents.push(e);
  state.eventLog.push({
    type: "CardPlayed",
    cardId: e.card.id,
    name: e.card.name,
    seat: holder,
    minion: null,
    mode: null,
  });
}

// ---------------------------------------------------------------------------

describe("Ousting at the same time (p. 46) — the defect the wave found", () => {
  it("a predator going out in the same oust gets the point and NOT the pool", () => {
    // Alice → Bob → Carol → Alice. On Bob's turn Alice and Carol are both at
    // 0. Alice's predator is Carol, who is going too; Carol's is Bob.
    const state = threeSeatGame();
    seat(state, "Alice").pool = 0;
    seat(state, "Carol").pool = 0;
    const engine = at(state, "Bob", "minion");
    expect(engine.decision()).toBeNull();
    expect(seat(state, "Alice").ousted).toBe(true);
    expect(seat(state, "Carol").ousted).toBe(true);
    // Carol scores Alice although she is ousted herself — and is not paid,
    // which is what used to keep her in the game on 6 pool.
    expect(seat(state, "Carol").victoryPoints).toBe(1);
    expect(seat(state, "Carol").pool).toBe(0);
    // Bob: Carol, plus the last Methuselah standing.
    expect(seat(state, "Bob").victoryPoints).toBe(2);
    expect(seat(state, "Bob").pool).toBe(16);
    expect(state.eventLog.some((ev) => ev.type === "GameEnded" && ev.winner === "Bob")).toBe(true);
  });

  it("each victim's point goes to its predator BEFORE the ring closes up", () => {
    // Bob and Carol out on Alice's turn: Bob's predator is Alice, Carol's is
    // Bob. One at a time, Alice scored both and Bob nothing.
    const state = threeSeatGame();
    seat(state, "Bob").pool = 0;
    seat(state, "Carol").pool = 0;
    at(state, "Alice", "minion").decision();
    expect(seat(state, "Alice").victoryPoints).toBe(2); // Bob + last standing
    expect(seat(state, "Alice").pool).toBe(16); // ONE 6, not two
    expect(seat(state, "Bob").victoryPoints).toBe(1);
    expect(seat(state, "Carol").victoryPoints).toBe(0);
  });

  it("stamps WHEN each point was received", () => {
    const state = threeSeatGame();
    turn(state).turnNumber = 7;
    seat(state, "Carol").pool = 0;
    at(state, "Alice", "minion").decision();
    expect(seat(state, "Bob").lastVictoryPointTurn).toBe(7);
    expect(seat(state, "Alice").lastVictoryPointTurn).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("Momentum's Edge (101237)", () => {
  function masterGame(vp: number): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    seat(state, "Alice").victoryPoints = vp;
    seat(state, "Alice").hand.push({ id: "me", name: "Momentum's Edge" });
    return { state, engine: at(state, "Alice", "master") };
  }

  it("NEGATIVE SPACE: not usable without a victory point", () => {
    const { engine } = masterGame(0);
    expect(ids(engine).some((id) => id.startsWith("play:Momentum's Edge"))).toBe(false);
  });

  it("with one, goes into play; and only one copy (unique)", () => {
    const { state, engine } = masterGame(1);
    seat(state, "Alice").hand.push({ id: "me2", name: "Momentum's Edge" });
    runTrace(engine, [["Alice", "play:Momentum's Edge:-:me"]]);
    passAsPlayed(engine);
    expect(seat(state, "Alice").permanents.map((p) => p.card.name)).toContain("Momentum's Edge");
    turn(state).masterActionsLeft = 1;
    expect(ids(engine).some((id) => id.startsWith("play:Momentum's Edge"))).toBe(false);
  });

  it("locks in YOUR unlock phase for 1 pool, once", () => {
    const state = threeSeatGame();
    // Locked from last turn: the sweep unlocks it, then it may lock again.
    inPlay(state, "Alice", entry("me", "Momentum's Edge", { locked: true }));
    const engine = at(state, "Alice", "unlock");
    expect(walkTo(engine, "ability:Momentum's Edge")).toBe(true);
    runTrace(engine, [["Alice", "ability:Momentum's Edge:me:lock"]]);
    expect(seat(state, "Alice").pool).toBe(11);
    expect(seat(state, "Alice").permanents.find((p) => p.card.id === "me")?.locked).toBe(true);
    const rest = walk(engine, () => turn(state).phase === "unlock");
    expect(rest.some((id) => id.startsWith("ability:Momentum's Edge"))).toBe(false);
  });

  it("NEGATIVE SPACE: not in another Methuselah's unlock phase", () => {
    const state = threeSeatGame();
    inPlay(state, "Alice", entry("me", "Momentum's Edge"));
    const engine = at(state, "Bob", "unlock");
    const seen = walk(engine, () => turn(state).phase === "unlock");
    expect(seen.some((id) => id.startsWith("ability:Momentum's Edge"))).toBe(false);
    expect(seat(state, "Alice").pool).toBe(10);
  });
});

// ---------------------------------------------------------------------------

describe("Gambit Accepted (100799)", () => {
  it("NEGATIVE SPACE: not usable without a victory point", () => {
    const state = threeSeatGame();
    seat(state, "Alice").hand.push({ id: "ga", name: "Gambit Accepted" });
    const engine = at(state, "Alice", "master");
    expect(ids(engine).some((id) => id.startsWith("play:Gambit Accepted"))).toBe(false);
  });

  it("costs the point it needs, and goes into play", () => {
    const state = threeSeatGame();
    seat(state, "Alice").victoryPoints = 1;
    seat(state, "Alice").hand.push({ id: "ga", name: "Gambit Accepted" });
    const engine = at(state, "Alice", "master");
    runTrace(engine, [["Alice", "play:Gambit Accepted:-:ga"]]);
    passAsPlayed(engine);
    expect(seat(state, "Alice").victoryPoints).toBe(0);
    expect(seat(state, "Alice").permanents.map((p) => p.card.name)).toContain("Gambit Accepted");
  });

  it("moves 1 pool from the prey in your unlock phase — not in theirs", () => {
    const state = threeSeatGame();
    inPlay(state, "Alice", entry("ga", "Gambit Accepted"));
    const engine = at(state, "Alice", "unlock");
    walk(engine, () => turn(state).phase === "unlock");
    expect(seat(state, "Bob").pool).toBe(9);
    expect(seat(state, "Alice").pool).toBe(11);
    expect(seat(state, "Carol").pool).toBe(10);

    const other = threeSeatGame();
    inPlay(other, "Alice", entry("ga", "Gambit Accepted"));
    const e2 = at(other, "Bob", "unlock");
    walk(e2, () => turn(other).phase === "unlock");
    expect(seat(other, "Alice").pool).toBe(10);
    expect(seat(other, "Bob").pool).toBe(10);
  });

  it("ousted: the predator takes an additional point", () => {
    const state = threeSeatGame();
    inPlay(state, "Alice", entry("ga", "Gambit Accepted"));
    seat(state, "Alice").pool = 0;
    at(state, "Bob", "minion").decision();
    expect(seat(state, "Alice").ousted).toBe(true);
    // Alice's predator is Carol: 1 for the oust, 1 from the Gambit.
    expect(seat(state, "Carol").victoryPoints).toBe(2);
    expect(seat(state, "Carol").pool).toBe(16);
    expect(seat(state, "Bob").victoryPoints).toBe(0);
  });

  it("withdrawing counts too [RTR 20040501] — and the withdrawer keeps their own point", () => {
    const state = threeSeatGame();
    inPlay(state, "Alice", entry("ga", "Gambit Accepted"));
    seat(state, "Alice").withdrawing = true;
    at(state, "Alice", "unlock").decision();
    expect(seat(state, "Alice").ousted).toBe(true);
    expect(seat(state, "Alice").victoryPoints).toBe(1);
    expect(seat(state, "Carol").victoryPoints).toBe(1);
    // A withdrawal pays the predator no pool (p. 38) — only the Gambit's point.
    expect(seat(state, "Carol").pool).toBe(10);
  });

  it("at the end of the game, a controller still in it gains a point", () => {
    const state = threeSeatGame();
    inPlay(state, "Alice", entry("ga", "Gambit Accepted"));
    seat(state, "Bob").pool = 0;
    seat(state, "Carol").pool = 0;
    at(state, "Alice", "minion").decision();
    // Bob's oust, the last Methuselah standing, and the Gambit.
    expect(seat(state, "Alice").victoryPoints).toBe(3);
    expect(seat(state, "Bob").victoryPoints).toBe(1);
  });

  it("…and the safeguard's draw is an end of the game too", () => {
    const state = threeSeatGame();
    inPlay(state, "Alice", entry("ga", "Gambit Accepted"));
    state.maxTurns = 1;
    const engine = at(state, "Alice", "minion");
    walk(engine, () => engine.decision() !== null, 200);
    expect(state.eventLog.some((ev) => ev.type === "GameEnded")).toBe(true);
    expect(seat(state, "Alice").victoryPoints).toBe(1);
    expect(seat(state, "Bob").victoryPoints).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("Lextalionis (101099)", () => {
  /** Alice's turn 5; her last turn was turn 2. */
  function lexGame(prepare: (s: GameState) => void): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    turn(state).turnNumber = 5;
    seat(state, "Alice").lastTurnEnded = 2;
    seat(state, "Alice").hand.push({ id: "lx", name: "Lextalionis" });
    prepare(state);
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  function call(engine: VtesEngine): void {
    runTrace(engine, [["Alice", "play:Lextalionis"]]);
    // As played, announce, A, C — each a full round of passes.
    for (let i = 0; i < 12; i++) {
      const dp = engine.decision()!;
      if (dp.window === "referendum.terms") return;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
  }

  it("offers only a Methuselah who received a point SINCE your last turn", () => {
    const { state, engine } = lexGame((s) => {
      seat(s, "Bob").lastVictoryPointTurn = 3; // after Alice's turn 2
      seat(s, "Carol").lastVictoryPointTurn = 2; // DURING it: does not qualify
    });
    call(engine);
    expect(engine.decision()!.window).toBe("referendum.terms");
    expect(ids(engine)).toEqual(["terms:Bob"]);
    runTrace(engine, [["Alice", "terms:Bob"], ["Alice", "vote:caller:for"]]);
    walk(engine, () => state.frames.some((f) => f.kind === "referendum"));
    expect(minion(state, "W").locked).toBe(true);
    expect(minion(state, "M").locked).toBe(true);
    expect(minion(state, "N").locked).toBe(false);

    // "…do not unlock as normal during the Methuselah's next unlock phase."
    const next = at(state, "Bob", "unlock");
    walk(next, () => turn(state).phase === "unlock");
    expect(minion(state, "W").locked).toBe(true);
    expect(minion(state, "M").locked).toBe(true);
  });

  it("your current turn qualifies [LSJ 20020429]", () => {
    const { engine } = lexGame((s) => {
      seat(s, "Carol").lastVictoryPointTurn = 5;
    });
    call(engine);
    expect(ids(engine)).toEqual(["terms:Carol"]);
  });

  it("before your first turn has ended, any point received qualifies", () => {
    const { engine } = lexGame((s) => {
      delete seat(s, "Alice").lastTurnEnded;
      seat(s, "Bob").lastVictoryPointTurn = 1;
    });
    call(engine);
    expect(ids(engine)).toEqual(["terms:Bob"]);
  });

  it("NEGATIVE SPACE: cannot be played with no legal choice [LSJ 20100129]", () => {
    const { engine } = lexGame((s) => {
      seat(s, "Bob").lastVictoryPointTurn = 2;
      seat(s, "Bob").victoryPoints = 1;
    });
    expect(ids(engine).some((id) => id.startsWith("play:Lextalionis"))).toBe(false);
  });

  it("the last turn is the caller's ENDED turn — stamped as a turn ends", () => {
    const state = threeSeatGame();
    const engine = at(state, "Alice", "minion");
    walk(engine, () => turn(state).seat === "Alice");
    expect(seat(state, "Alice").lastTurnEnded).toBe(1);
    expect(seat(state, "Bob").lastTurnEnded).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("Life Boon (101103)", () => {
  /** Alice's turn; Bob has run out of pool; Carol holds a Life Boon. */
  function boonGame(
    prepare: (s: GameState) => void = () => {},
    turnSeat = "Alice",
  ): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    seat(state, "Bob").pool = 0;
    seat(state, "Carol").hand.push({ id: "lb", name: "Life Boon" });
    prepare(state);
    return { state, engine: at(state, turnSeat, "minion") };
  }

  it("opens a window before the oust, offered to the holder, for the seat going out", () => {
    const { engine } = boonGame();
    const dp = engine.decision()!;
    expect(dp.window).toBe("oust");
    expect(dp.seat).toBe("Carol");
    expect(ids(engine)).toEqual(["pass", "play:Life Boon:-:Bob:lb"]);
  });

  it("gives pool, goes into play, and keeps them in the game", () => {
    const { state, engine } = boonGame();
    runTrace(engine, [["Carol", "play:Life Boon:-:Bob:lb"]]);
    passAsPlayed(engine);
    // Any amount that keeps Bob in, short of ousting Carol: 1 to 9.
    expect(engine.decision()!.window).toBe("choice");
    expect(ids(engine)).toEqual(
      Array.from({ length: 9 }, (_, i) => `choice:Life Boon:lb:amount:${i + 1}`),
    );
    runTrace(engine, [["Carol", "choice:Life Boon:lb:amount:2"]]);
    walk(engine, () => state.frames.some((f) => f.kind === "oust"));
    expect(seat(state, "Bob").ousted).toBe(false);
    expect(seat(state, "Bob").pool).toBe(2);
    expect(seat(state, "Carol").pool).toBe(8);
    expect(seat(state, "Alice").victoryPoints).toBe(0);
    expect(seat(state, "Carol").outOfTurnMasterUsed).toBe(true);
    const boon = seat(state, "Carol").permanents.find((p) => p.card.id === "lb");
    expect(boon?.boonTarget).toBe("Bob");
  });

  it("from negative pool, at least enough to compensate [RTR 19970630]", () => {
    const { engine } = boonGame((s) => {
      seat(s, "Bob").pool = -2;
    });
    runTrace(engine, [["Carol", "play:Life Boon:-:Bob:lb"]]);
    passAsPlayed(engine);
    const amounts = ids(engine).map((id) => Number(id.split(":").pop()));
    expect(amounts[0]).toBe(3);
    expect(amounts[amounts.length - 1]).toBe(9);
  });

  it("declined: the oust goes ahead as normal", () => {
    const { state, engine } = boonGame();
    runTrace(engine, [["Carol", "pass"]]);
    engine.decision();
    expect(seat(state, "Bob").ousted).toBe(true);
    expect(seat(state, "Alice").victoryPoints).toBe(1);
    expect(seat(state, "Alice").pool).toBe(16);
  });

  it("NEGATIVE SPACE: no window on your own turn, after an out-of-turn master, without the pool, or under a boon bar", () => {
    const gates: Array<[(s: GameState) => void, string]> = [
      [() => {}, "Carol"], // out-of-turn only (p. 8)
      [
        (s) => {
          seat(s, "Carol").outOfTurnMasterUsed = true;
        },
        "Alice",
      ],
      [
        (s) => {
          seat(s, "Carol").pool = 1; // giving 1 would oust Carol
        },
        "Alice",
      ],
      [
        (s) => {
          // "No more boons can be put in play" (Blood Trade).
          seat(s, "Alice").permanents.push(
            entry("bt", "Blood Trade", { statics: { barsBoons: true } }),
          );
        },
        "Alice",
      ],
    ];
    for (const [gate, turnSeat] of gates) {
      const { state, engine } = boonGame(gate, turnSeat);
      expect(engine.decision()?.window ?? null).not.toBe("oust");
      expect(seat(state, "Bob").ousted).toBe(true);
    }
  });

  it("steals 1 pool in each of the debtor's unlock phases — once, and only theirs", () => {
    const state = threeSeatGame();
    inPlay(state, "Carol", entry("lb", "Life Boon", { boonTarget: "Bob" }));
    const engine = at(state, "Bob", "unlock");
    expect(walkTo(engine, "ability:Life Boon")).toBe(true);
    expect(engine.decision()!.seat).toBe("Carol");
    runTrace(engine, [["Carol", "ability:Life Boon:lb:steal"]]);
    expect(seat(state, "Bob").pool).toBe(9);
    expect(seat(state, "Carol").pool).toBe(11);
    const rest = walk(engine, () => turn(state).phase === "unlock");
    expect(rest.some((id) => id.startsWith("ability:Life Boon"))).toBe(false);

    const other = threeSeatGame();
    inPlay(other, "Carol", entry("lb", "Life Boon", { boonTarget: "Bob" }));
    const seen = walk(at(other, "Alice", "unlock"), () => turn(other).phase === "unlock");
    expect(seen.some((id) => id.startsWith("ability:Life Boon"))).toBe(false);
  });

  it("takes the debtor's next point — the point only, not the pool — then burns", () => {
    // Alice holds a boon on Bob; Bob's prey Carol is ousted on Alice's turn.
    const state = threeSeatGame();
    inPlay(state, "Alice", entry("lb", "Life Boon", { boonTarget: "Bob" }));
    seat(state, "Carol").pool = 0;
    const engine = at(state, "Alice", "minion");
    engine.decision();
    expect(seat(state, "Carol").ousted).toBe(true);
    expect(seat(state, "Alice").victoryPoints).toBe(1);
    expect(seat(state, "Bob").victoryPoints).toBe(0);
    expect(seat(state, "Bob").pool).toBe(16); // [LSJ 20021029]
    expect(seat(state, "Alice").permanents.some((p) => p.card.id === "lb")).toBe(false);
    expect((seat(state, "Alice").ashHeap ?? []).some((c) => c.id === "lb")).toBe(true);
    // Spent: the next point is Bob's own.
    engine.gainVictoryPoint("Bob");
    expect(seat(state, "Bob").victoryPoints).toBe(1);
  });

  it("several boons reserve a SERIES of points, first played first [RTR 19951017]", () => {
    const state = threeSeatGame();
    inPlay(state, "Carol", entry("lbc", "Life Boon", { boonTarget: "Bob" }));
    inPlay(state, "Alice", entry("lba", "Life Boon", { boonTarget: "Bob" }));
    const engine = at(state, "Alice", "minion");
    engine.gainVictoryPoint("Bob");
    expect(seat(state, "Carol").victoryPoints).toBe(1);
    expect(seat(state, "Alice").victoryPoints).toBe(0);
    engine.gainVictoryPoint("Bob");
    expect(seat(state, "Alice").victoryPoints).toBe(1);
    engine.gainVictoryPoint("Bob");
    expect(seat(state, "Bob").victoryPoints).toBe(1);
  });

  it("a boon on your predator does not take the point for ousting you [RTR 20000501]", () => {
    // Carol holds a boon on Bob, who is her predator, and is ousted.
    const state = threeSeatGame();
    inPlay(state, "Carol", entry("lb", "Life Boon", { boonTarget: "Bob" }));
    seat(state, "Carol").pool = 0;
    at(state, "Alice", "minion").decision();
    expect(seat(state, "Bob").victoryPoints).toBe(1);
    expect(seat(state, "Carol").victoryPoints).toBe(0);
  });

  it("takes the point a debtor earns by withdrawing", () => {
    const state = threeSeatGame();
    inPlay(state, "Carol", entry("lb", "Life Boon", { boonTarget: "Bob" }));
    seat(state, "Bob").withdrawing = true;
    at(state, "Bob", "unlock").decision();
    expect(seat(state, "Bob").ousted).toBe(true);
    expect(seat(state, "Bob").victoryPoints).toBe(0);
    expect(seat(state, "Carol").victoryPoints).toBe(1);
  });
});
