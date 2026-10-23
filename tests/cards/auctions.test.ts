/**
 * Wave 105 — auctions for control (docs/auctions-design.md).
 *
 * Hostile Takeover (100939), Malkavian Time Auction (101158), Temptation of
 * Greater Power (101955): three masters that sell a card in play to the
 * highest bidder, on the one auction Extremis Boon built. They differ in
 * every part the auction leaves to the card — who bids, how much each may
 * bid, who is paid, and who pays — so each test pins one of those against
 * its siblings.
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

/** `seatId`'s master phase, with one master phase action. */
function masterPhase(state: GameState, seatId: string): VtesEngine {
  const tf = turn(state);
  tf.seat = seatId;
  tf.phase = "master";
  tf.masterActionsLeft = 1;
  return new VtesEngine(state, testRegistry);
}

/** Play `prefix` and wait out the as-played window. */
function play(engine: VtesEngine, who: string, prefix: string): void {
  runTrace(engine, [[who, prefix]]);
  while (engine.decision()?.window === "card.asPlayed") {
    const dp = engine.decision()!;
    runTrace(engine, [[dp.seat, "pass"]]);
  }
}

const bidsOf = (engine: VtesEngine): number[] =>
  ids(engine)
    .filter((id) => /:bid:\d+$/.test(id))
    .map((id) => Number(id.slice(id.lastIndexOf(":") + 1)));

// ---------------------------------------------------------------------------
// Hostile Takeover
// ---------------------------------------------------------------------------

describe("Hostile Takeover — the table bids, the controller is paid", () => {
  function takeover(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    seat(state, "Alice").hand.push({ id: "ht", name: "Hostile Takeover" });
    minion(state, "W").attached.push(entry("mag", ".44 Magnum"));
    return { state, engine: masterPhase(state, "Alice") };
  }

  it("the winner pays the controller and takes the vampire, with what is on it", () => {
    const { state, engine } = takeover();
    play(engine, "Alice", "play:Hostile Takeover:-:W:ht");
    expect(seat(state, "Alice").pool).toBe(9); // the card's 1 pool
    // "The player who played the card conducts the auction" [LSJ 19990104].
    expect(engine.decision()?.seat).toBe("Alice");
    runTrace(engine, [
      ["Alice", "choice:Hostile Takeover:ht:bid:2"],
      ["Bob", "choice:Hostile Takeover:ht:bid:pass"],
      ["Carol", "choice:Hostile Takeover:ht:bid:pass"],
    ]);
    engine.decision();
    expect(seat(state, "Alice").pool).toBe(7);
    expect(seat(state, "Bob").pool).toBe(12);
    const w = minion(state, "W");
    expect(w.controller).toBe("Alice");
    expect(seat(state, "Alice").minions.map((m) => m.id)).toContain("W");
    expect(w.blood).toBe(3);
    expect(w.attached.map((a) => a.card.name)).toEqual([".44 Magnum"]);
  });

  it("a master on the stolen vampire stays its player's; a minion card follows the vampire", () => {
    // "A master card in play is controlled by the Methuselah who played it"
    // (p. 9); "a minion card in play is controlled by the controller of the
    // minion it is on" (p. 10). Bob played this one on his own vampire, so
    // no controller was ever written down for it.
    const { state, engine } = takeover();
    minion(state, "W").attached.push(entry("hu", "Haven Uncovered", { owner: "Bob" }));
    play(engine, "Alice", "play:Hostile Takeover:-:W:ht");
    runTrace(engine, [
      ["Alice", "choice:Hostile Takeover:ht:bid:1"],
      ["Bob", "choice:Hostile Takeover:ht:bid:pass"],
      ["Carol", "choice:Hostile Takeover:ht:bid:pass"],
    ]);
    engine.decision();
    expect(minion(state, "W").controller).toBe("Alice");
    expect(engine.controllerOfEntry("hu")).toBe("Bob");
    expect(engine.controllerOfEntry("mag")).toBe("Alice");
  });

  it("the controller bids up to twice their pool [LSJ 19990825], and wins at half price", () => {
    const { state, engine } = takeover();
    play(engine, "Alice", "play:Hostile Takeover:-:W:ht");
    runTrace(engine, [["Alice", "choice:Hostile Takeover:ht:bid:2"]]);
    // Bob controls W: 10 pool, so bids of 3 to 20.
    expect(engine.decision()?.seat).toBe("Bob");
    expect(Math.max(...bidsOf(engine))).toBe(20);
    runTrace(engine, [
      ["Bob", "choice:Hostile Takeover:ht:bid:3"],
      // Carol is not the controller: her 10 pool is her limit.
      ["Carol", "choice:Hostile Takeover:ht:bid:pass"],
    ]);
    expect(Math.max(...bidsOf(engine))).toBe(9);
    runTrace(engine, [["Alice", "choice:Hostile Takeover:ht:bid:pass"]]);
    engine.decision();
    // Half of 3, rounded up, to the blood bank — not to anybody.
    expect(seat(state, "Bob").pool).toBe(8);
    expect(seat(state, "Alice").pool).toBe(9);
    expect(seat(state, "Carol").pool).toBe(10);
    expect(minion(state, "W").controller).toBe("Bob");
  });

  it("a pass is final: the auction goes round the bidders still in it", () => {
    const { state, engine } = takeover();
    play(engine, "Alice", "play:Hostile Takeover:-:W:ht");
    runTrace(engine, [
      ["Alice", "choice:Hostile Takeover:ht:bid:1"],
      ["Bob", "choice:Hostile Takeover:ht:bid:pass"],
      ["Carol", "choice:Hostile Takeover:ht:bid:2"],
    ]);
    // Bob passed, so Alice is next, and then nobody but Carol is left.
    expect(engine.decision()?.seat).toBe("Alice");
    runTrace(engine, [["Alice", "choice:Hostile Takeover:ht:bid:pass"]]);
    expect(engine.decision()?.options.some((o) => o.id.includes(":bid:"))).toBe(false);
    expect(minion(state, "W").controller).toBe("Carol");
    expect(seat(state, "Carol").pool).toBe(8);
    expect(seat(state, "Bob").pool).toBe(12);
  });

  it("nobody bids: nothing moves but the card's cost", () => {
    const { state, engine } = takeover();
    play(engine, "Alice", "play:Hostile Takeover:-:W:ht");
    runTrace(engine, [
      ["Alice", "choice:Hostile Takeover:ht:bid:pass"],
      ["Bob", "choice:Hostile Takeover:ht:bid:pass"],
      ["Carol", "choice:Hostile Takeover:ht:bid:pass"],
    ]);
    engine.decision();
    expect(minion(state, "W").controller).toBe("Bob");
    expect([9, 10, 10]).toEqual(["Alice", "Bob", "Carol"].map((s) => seat(state, s).pool));
  });

  it("NEGATIVE SPACE: capacity 7 is not offered, and an ally is not a vampire", () => {
    const state = threeSeatGame();
    seat(state, "Alice").hand.push({ id: "ht", name: "Hostile Takeover" });
    minion(state, "M").capacity = 7;
    minion(state, "N").kind = "ally";
    const offered = ids(masterPhase(state, "Alice")).filter((id) => id.startsWith("play:Hostile"));
    expect(offered).toContain("play:Hostile Takeover:-:W:ht");
    expect(offered).toContain("play:Hostile Takeover:-:V1:ht");
    expect(offered).not.toContain("play:Hostile Takeover:-:M:ht");
    expect(offered).not.toContain("play:Hostile Takeover:-:N:ht");
  });
});

// ---------------------------------------------------------------------------
// Malkavian Time Auction
// ---------------------------------------------------------------------------

describe("Malkavian Time Auction — the two highest bidders pay you", () => {
  function auction(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    seat(state, "Alice").hand.push({ id: "mta", name: "Malkavian Time Auction" });
    // `owner` as play records it: a burned card goes to its OWNER's ash
    // heap (p. 16), whoever controls it by then.
    seat(state, "Alice").permanents.push(
      entry("bhg", "Base Hunting Ground", { tags: ["location"], owner: "Alice" }),
    );
    minion(state, "V1").attached.push(entry("mag", ".44 Magnum", { owner: "Alice" }));
    // A master Alice played on Bob's vampire is a card she controls (p. 16).
    minion(state, "W").attached.push(
      entry("hu", "Haven Uncovered", { controller: "Alice", owner: "Alice" }),
    );
    return { state, engine: masterPhase(state, "Alice") };
  }

  it("offers every card Alice controls and nothing she does not", () => {
    const { engine } = auction();
    const offered = ids(engine).filter((id) => id.startsWith("play:Malkavian"));
    for (const id of ["V1", "bhg", "mag", "hu"]) {
      expect(offered).toContain(`play:Malkavian Time Auction:-:${id}:mta`);
    }
    // Bob's vampire, though Alice's master is on it, and Carol's.
    expect(offered).not.toContain("play:Malkavian Time Auction:-:W:mta");
    expect(offered).not.toContain("play:Malkavian Time Auction:-:N:mta");
  });

  it("from Alice's left, without Alice; the winner takes it and the runner-up pays too", () => {
    const { state, engine } = auction();
    play(engine, "Alice", "play:Malkavian Time Auction:-:bhg:mta");
    expect(engine.decision()?.seat).toBe("Bob");
    runTrace(engine, [
      ["Bob", "choice:Malkavian Time Auction:mta:bid:2"],
      ["Carol", "choice:Malkavian Time Auction:mta:bid:3"],
      // "You do not participate in the bid" [LSJ 20030604]: back to Bob.
      ["Bob", "choice:Malkavian Time Auction:mta:bid:4"],
      ["Carol", "choice:Malkavian Time Auction:mta:bid:pass"],
    ]);
    engine.decision();
    expect(seat(state, "Alice").pool).toBe(17);
    expect(seat(state, "Bob").pool).toBe(6);
    expect(seat(state, "Carol").pool).toBe(7);
    expect(seat(state, "Bob").permanents.map((p) => p.card.id)).toContain("bhg");
    expect(seat(state, "Alice").permanents.map((p) => p.card.id)).not.toContain("bhg");
  });

  it("a single bidder pays alone", () => {
    const { state, engine } = auction();
    play(engine, "Alice", "play:Malkavian Time Auction:-:V1:mta");
    runTrace(engine, [
      ["Bob", "choice:Malkavian Time Auction:mta:bid:pass"],
      ["Carol", "choice:Malkavian Time Auction:mta:bid:5"],
    ]);
    engine.decision();
    expect(seat(state, "Alice").pool).toBe(15);
    expect(seat(state, "Bob").pool).toBe(10);
    expect(minion(state, "V1").controller).toBe("Carol");
    expect(minion(state, "V1").attached.map((a) => a.card.id)).toContain("mag");
  });

  it("equipment goes on a minion its new controller chooses [LSJ 20030606]", () => {
    const { state, engine } = auction();
    play(engine, "Alice", "play:Malkavian Time Auction:-:mag:mta");
    runTrace(engine, [
      ["Bob", "choice:Malkavian Time Auction:mta:bid:1"],
      ["Carol", "choice:Malkavian Time Auction:mta:bid:pass"],
    ]);
    // Mandatory: no pass, and only Bob's own minions.
    const answers = ids(engine);
    expect(answers).toEqual([
      "choice:Malkavian Time Auction:mta:bearer:W",
      "choice:Malkavian Time Auction:mta:bearer:M",
    ]);
    runTrace(engine, [["Bob", "choice:Malkavian Time Auction:mta:bearer:M"]]);
    expect(minion(state, "M").attached.map((a) => a.card.id)).toContain("mag");
    expect(minion(state, "V1").attached.map((a) => a.card.id)).not.toContain("mag");
    expect(seat(state, "Alice").pool).toBe(11);
  });

  it("equipment won by a Methuselah with no minion has nothing to sit on, and burns", () => {
    const { state, engine } = auction();
    seat(state, "Carol").minions = [];
    play(engine, "Alice", "play:Malkavian Time Auction:-:mag:mta");
    runTrace(engine, [
      ["Bob", "choice:Malkavian Time Auction:mta:bid:pass"],
      ["Carol", "choice:Malkavian Time Auction:mta:bid:1"],
    ]);
    engine.decision();
    const anywhere = state.seats.flatMap((s) => s.minions).flatMap((m) => m.attached);
    expect(anywhere.map((a) => a.card.id)).not.toContain("mag");
    expect((seat(state, "Alice").ashHeap ?? []).map((c) => c.id)).toContain("mag");
  });

  it("a master on a minion changes controller and stays where it is", () => {
    const { state, engine } = auction();
    play(engine, "Alice", "play:Malkavian Time Auction:-:hu:mta");
    runTrace(engine, [
      ["Bob", "choice:Malkavian Time Auction:mta:bid:pass"],
      ["Carol", "choice:Malkavian Time Auction:mta:bid:2"],
    ]);
    expect(ids(engine).some((id) => id.includes(":bearer:"))).toBe(false);
    const hu = minion(state, "W").attached.find((a) => a.card.id === "hu");
    expect(hu?.controller).toBe("Carol");
  });
});

// ---------------------------------------------------------------------------
// Temptation of Greater Power
// ---------------------------------------------------------------------------

describe("Temptation of Greater Power — the bank is paid, and some of it later", () => {
  function tempted(pool = 20): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    seat(state, "Alice").pool = pool;
    minion(state, "V1").title = "justicar";
    seat(state, "Alice").hand.push({ id: "tgp", name: "Temptation of Greater Power" });
    return { state, engine: masterPhase(state, "Alice") };
  }

  it("needs a READY justicar, and then offers every vampire in play", () => {
    const none = threeSeatGame();
    none.seats[0]!.hand.push({ id: "tgp", name: "Temptation of Greater Power" });
    expect(ids(masterPhase(none, "Alice")).some((id) => id.startsWith("play:Temptation"))).toBe(false);
    const torpid = tempted().state;
    minion(torpid, "V1").inTorpor = true;
    expect(ids(masterPhase(torpid, "Alice")).some((id) => id.startsWith("play:Temptation"))).toBe(false);
    const offered = ids(tempted().engine).filter((id) => id.startsWith("play:Temptation"));
    expect(offered.sort()).toEqual(
      ["M", "N", "V1", "W"].map((m) => `play:Temptation of Greater Power:-:${m}:tgp`),
    );
  });

  it("bids run 5 past the pool; the winner picks the credit, pays the bank, and takes control", () => {
    const { state, engine } = tempted();
    play(engine, "Alice", "play:Temptation of Greater Power:-:W:tgp");
    expect(seat(state, "Alice").pool).toBe(17);
    expect(Math.max(...bidsOf(engine))).toBe(22);
    runTrace(engine, [
      ["Alice", "choice:Temptation of Greater Power:tgp:bid:9"],
      ["Bob", "choice:Temptation of Greater Power:tgp:bid:pass"],
      ["Carol", "choice:Temptation of Greater Power:tgp:bid:pass"],
    ]);
    // "Up to 5": any credit from 0 to 5, the most first.
    expect(ids(engine)).toEqual(
      [5, 4, 3, 2, 1, 0].map((c) => `choice:Temptation of Greater Power:tgp:credit:${c}`),
    );
    runTrace(engine, [["Alice", "choice:Temptation of Greater Power:tgp:credit:3"]]);
    expect(seat(state, "Alice").pool).toBe(11);
    expect(seat(state, "Alice").poolDebt).toBe(3);
    // The bank, not the controller.
    expect(seat(state, "Bob").pool).toBe(10);
    expect(minion(state, "W").controller).toBe("Alice");
  });

  it("the credit is at least what the winner's pool cannot cover", () => {
    const { engine } = tempted(10);
    play(engine, "Alice", "play:Temptation of Greater Power:-:W:tgp");
    runTrace(engine, [
      ["Alice", "choice:Temptation of Greater Power:tgp:bid:10"],
      ["Bob", "choice:Temptation of Greater Power:tgp:bid:pass"],
      ["Carol", "choice:Temptation of Greater Power:tgp:bid:pass"],
    ]);
    // 7 pool against a bid of 10: owe 3, 4 or 5.
    expect(ids(engine)).toEqual(
      [5, 4, 3].map((c) => `choice:Temptation of Greater Power:tgp:credit:${c}`),
    );
  });

  it("the debt is paid 1 pool in each of the debtor's discard phases", () => {
    const { state, engine } = tempted();
    play(engine, "Alice", "play:Temptation of Greater Power:-:W:tgp");
    runTrace(engine, [
      ["Alice", "choice:Temptation of Greater Power:tgp:bid:9"],
      ["Bob", "choice:Temptation of Greater Power:tgp:bid:pass"],
      ["Carol", "choice:Temptation of Greater Power:tgp:bid:pass"],
      ["Alice", "choice:Temptation of Greater Power:tgp:credit:3"],
    ]);
    expect(seat(state, "Alice").pool).toBe(11);
    for (let i = 0; i < 40 && turn(state).phase !== "discard"; i++) {
      const dp = engine.decision()!;
      const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
    }
    expect(turn(state).seat).toBe("Alice");
    expect(seat(state, "Alice").pool).toBe(10);
    expect(seat(state, "Alice").poolDebt).toBe(2);
  });

  it("only one is played in a game", () => {
    const { state, engine } = tempted();
    seat(state, "Alice").hand.push({ id: "tgp2", name: "Temptation of Greater Power" });
    play(engine, "Alice", "play:Temptation of Greater Power:-:W:tgp");
    for (const s of ["Alice", "Bob", "Carol"]) {
      runTrace(engine, [[s, "choice:Temptation of Greater Power:tgp:bid:pass"]]);
    }
    turn(state).masterActionsLeft = 1;
    const again = new VtesEngine(state, testRegistry);
    expect(ids(again).some((id) => id.startsWith("play:Temptation"))).toBe(false);
  });
});
