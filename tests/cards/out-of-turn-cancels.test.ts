/**
 * Wave 99 — out-of-turn cancels (docs/out-of-turn-cancels-design.md).
 *
 * Direct Intervention (100545), Dark Influences (100493), Not to Be
 * (101303), Wash (102151), Emergency Preparations (100636), Personal
 * Involvement (101394) — and the three engine defects they found: a
 * cancelled card vanished instead of reaching the ash heap, a cancelled
 * card's held replacement was never released, and an out-of-turn trifle's
 * master phase action (p. 9) was lost.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay, SeatState } from "../../src/engine/index.ts";
import { VtesEngine, viewFor } from "../../src/engine/index.ts";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const ids = (engine: VtesEngine): string[] => engine.decision()!.options.map((o) => o.id);
const ash = (state: GameState, seat: number): string[] =>
  (state.seats[seat]!.ashHeap ?? []).map((c) => c.name);
const turn = (state: GameState) => {
  const t = state.frames[0]!;
  if (t.kind !== "turn") throw new Error("fixture");
  return t;
};

/** Alice bleeds Bob with V1; the trace stops where Alice may play
 *  Conditioning in action.effects. */
const BLEED_TO_MODIFIER: Array<[string, string]> = [
  ["Alice", "bleed:V1"],
  ["Alice", "pass"],
  ["Bob", "pass"],
  ["Carol", "pass"],
  ["Alice", "pass"],
  ["Bob", "pass"],
  ["Carol", "pass"],
];

function inPlay(id: string, name: string, tags: string[] = []): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags };
}

function phase(state: GameState, p: "master" | "discard"): void {
  const t = turn(state);
  t.phase = p;
  if (p === "master") t.masterActionsLeft = 1;
  else t.discardActionsLeft = 1;
}

describe("Direct Intervention (100545)", () => {
  it("cancels a minion card as it is played, refunding nothing it does not owe", () => {
    const state = threeSeatGame();
    state.seats[2]!.hand.push({ id: "di1", name: "Direct Intervention" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...BLEED_TO_MODIFIER,
      ["Alice", "play:Conditioning"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "play:Direct Intervention"],
      // Direct Intervention's own as-played window, then Conditioning's.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    // Paid 1 pool, spent the out-of-turn budget (p. 9).
    expect(state.seats[2]!.pool).toBe(9);
    expect(state.seats[2]!.outOfTurnMasterUsed).toBe(true);
    // DEFECT 1: the cancelled card is still PLAYED (p. 16) and is filed in
    // the ash heap. It used to vanish.
    expect(ash(state, 0)).toEqual(["Conditioning"]);
    expect(ash(state, 2)).toEqual(["Direct Intervention"]);
    expect(state.eventLog.some((e) => e.type === "CardCanceled" && e.name === "Conditioning")).toBe(
      true,
    );
  });

  it("is not offered against a master, nor on your own turn", () => {
    // A master in Alice's master phase: Carol's Direct Intervention is silent.
    const state = threeSeatGame();
    phase(state, "master");
    state.seats[0]!.hand.push({ id: "mc0", name: "Misdirection" });
    state.seats[2]!.hand.push({ id: "di1", name: "Direct Intervention" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Misdirection:-:M"],
      ["Alice", "pass"],
      ["Bob", "pass"],
    ]);
    expect(engine.decision()!.seat).toBe("Carol");
    expect(ids(engine)).toEqual(["pass"]);

    // Alice's own Conditioning, Alice holding Direct Intervention: never on
    // your own turn (p. 9).
    const own = threeSeatGame();
    own.seats[0]!.hand.push({ id: "di1", name: "Direct Intervention" });
    own.seats[1]!.hand.push({ id: "c9", name: "Conditioning" });
    const e2 = new VtesEngine(own, testRegistry);
    runTrace(e2, [...BLEED_TO_MODIFIER, ["Alice", "play:Conditioning"]]);
    expect(ids(e2)).toEqual(["pass"]);
  });

  it("is not offered once the seat's out-of-turn budget is spent", () => {
    const state = threeSeatGame();
    state.seats[2]!.hand.push({ id: "di1", name: "Direct Intervention" });
    state.seats[2]!.outOfTurnMasterUsed = true;
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ...BLEED_TO_MODIFIER,
      ["Alice", "play:Conditioning"],
      ["Alice", "pass"],
      ["Bob", "pass"],
    ]);
    expect(engine.decision()!.seat).toBe("Carol");
    expect(ids(engine)).toEqual(["pass"]);
  });
});

describe("Dark Influences (100493)", () => {
  it("cancels a minion card, goes into play, and bars that card name this turn", () => {
    const state = threeSeatGame();
    state.seats[2]!.hand.push({ id: "dk1", name: "Dark Influences" });
    state.seats[0]!.hand.push({ id: "c2", name: "Conditioning" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...BLEED_TO_MODIFIER,
      ["Alice", "play:Conditioning:basic:V1:c1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "play:Dark Influences"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    expect(state.seats[2]!.pool).toBe(8);
    expect(state.seats[2]!.permanents.map((p) => p.card.name)).toEqual(["Dark Influences"]);
    expect(ash(state, 0)).toEqual(["Conditioning"]);
    // The second copy is in hand, the window is the same, and it is not
    // offered: "That card cannot be played again this turn" (§4, reading 1).
    expect(state.seats[0]!.hand.map((c) => c.id)).toContain("c2");
    expect(engine.decision()!.seat).toBe("Alice");
    expect(ids(engine)).toEqual(["pass"]);
    expect(turn(state).barredNames).toEqual(["Conditioning"]);
  });

  it("its shield cancels the next card that cancels another Methuselah's minion card, and burns", () => {
    const state = threeSeatGame();
    state.seats[2]!.permanents.push(inPlay("dk0", "Dark Influences"));
    state.seats[1]!.hand.push({ id: "di2", name: "Direct Intervention" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...BLEED_TO_MODIFIER,
      ["Alice", "play:Conditioning"],
      ["Alice", "pass"],
      ["Bob", "play:Direct Intervention"],
    ]);
    // Cancelled as it was PUSHED — before anyone answered it — with its cost
    // refunded; Dark Influences is burned instead.
    expect(state.seats[1]!.pool).toBe(10);
    expect(state.seats[2]!.permanents).toEqual([]);
    expect(ash(state, 2)).toEqual(["Dark Influences"]);
    // Still an out-of-turn master played, so still the budget (p. 9).
    expect(state.seats[1]!.outOfTurnMasterUsed).toBe(true);

    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    // Conditioning landed: 1 + 2, not the bare 1.
    expect(state.seats[1]!.pool).toBe(7);
    expect(ash(state, 1)).toEqual(["Direct Intervention"]);
  });

  it("with two in play, ONE answers the cancel and the other stays (owner ruling)", () => {
    const state = threeSeatGame();
    state.seats[2]!.permanents.push(inPlay("dk0", "Dark Influences"), inPlay("dk1", "Dark Influences"));
    state.seats[1]!.hand.push({ id: "di2", name: "Direct Intervention" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...BLEED_TO_MODIFIER,
      ["Alice", "play:Conditioning"],
      ["Alice", "pass"],
      ["Bob", "play:Direct Intervention"],
    ]);
    expect(state.seats[1]!.pool).toBe(10);
    expect(ash(state, 2)).toEqual(["Dark Influences"]);
    expect(state.seats[2]!.permanents.map((p) => p.card.id)).toEqual(["dk1"]);
  });

  it("the shield ignores a cancel of your OWN minion card", () => {
    const state = threeSeatGame();
    state.seats[2]!.permanents.push(inPlay("dk0", "Dark Influences"));
    state.seats[1]!.hand.push({ id: "di2", name: "Direct Intervention" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...BLEED_TO_MODIFIER,
      ["Alice", "pass"],
      ["Bob", "play:Deflection:basic"],
      ["Alice", "pass"],
      ["Bob", "play:Direct Intervention"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    // "Another Methuselah's" — Bob cancelled Bob's card, so the shield stood.
    expect(state.seats[2]!.permanents.map((p) => p.card.name)).toEqual(["Dark Influences"]);
    expect(ash(state, 1)).toEqual(["Direct Intervention", "Deflection"]);
    expect(state.seats[1]!.pool).toBe(9);
  });

  it("the shield ignores a cancel of a MASTER", () => {
    const state = threeSeatGame();
    phase(state, "master");
    state.seats[0]!.hand.push({ id: "mc0", name: "Misdirection" });
    state.seats[1]!.permanents.push(inPlay("dk0", "Dark Influences"));
    state.seats[2]!.hand.push({ id: "sr1", name: "Sudden Reversal" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Misdirection:-:M"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "play:Sudden Reversal"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(state.seats[1]!.minions.find((m) => m.id === "M")!.locked).toBe(false);
    expect(state.seats[1]!.permanents.map((p) => p.card.name)).toEqual(["Dark Influences"]);
  });
});

describe("Not to Be (101303)", () => {
  function eventGame(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    phase(state, "discard");
    state.seats[0]!.hand.push({ id: "ev1", name: "Dragonbound" });
    state.seats[0]!.library.push({ id: "L1", name: "Conditioning" });
    state.seats[2]!.hand.push({ id: "nb1", name: "Not to Be" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }
  const CANCEL: Array<[string, string]> = [
    ["Alice", "play:Dragonbound"],
    ["Alice", "pass"],
    ["Bob", "pass"],
    ["Carol", "play:Not to Be"],
    ["Alice", "pass"],
    ["Bob", "pass"],
    ["Carol", "pass"],
    ["Alice", "pass"],
    ["Bob", "pass"],
    ["Carol", "pass"],
  ];

  it("cancels an event, goes into play — and the event's held replacement is released", () => {
    const { state, engine } = eventGame();
    runTrace(engine, CANCEL);

    expect(state.seats[2]!.pool).toBe(9);
    expect(state.seats[2]!.permanents.map((p) => p.card.name)).toEqual(["Not to Be"]);
    expect(ash(state, 0)).toEqual(["Dragonbound"]);
    // DEFECT 2: "Do not replace as long as this card is in play" — a card
    // that never entered play held its draw for ever. The clause is
    // cancelled with the card and it is replaced normally [LSJ 20080630].
    expect(state.seats[0]!.library).toEqual([]);
    expect(state.seats[0]!.hand.map((c) => c.id)).toContain("L1");
    expect(state.drawWhenLeavesPlay ?? []).toEqual([]);
  });

  it("is not offered against a minion card", () => {
    const state = threeSeatGame();
    state.seats[2]!.hand.push({ id: "nb1", name: "Not to Be" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ...BLEED_TO_MODIFIER,
      ["Alice", "play:Conditioning"],
      ["Alice", "pass"],
      ["Bob", "pass"],
    ]);
    expect(ids(engine)).toEqual(["pass"]);
  });

  it("gives +1 master phase action in your master phase, then −1 discard action and burns", () => {
    const { state, engine } = eventGame();
    state.seats[2]!.hand.push({ id: "k1", name: "Conditioning" });
    runTrace(engine, [
      ...CANCEL,
      ["Alice", "pass"], // Alice's discard phase ends
      ["Bob", "pass"], // Bob: unlock
      ["Bob", "pass"], // master
      ["Bob", "end"], // minion
      ["Bob", "pass"], // influence
      ["Bob", "pass"], // discard
      ["Carol", "pass"], // Carol: unlock
    ]);
    // 0 for the out-of-turn debt (p. 9) + 1 from Not to Be.
    expect(turn(state).seat).toBe("Carol");
    expect(turn(state).phase).toBe("master");
    expect(turn(state).masterActionsLeft).toBe(1);

    runTrace(engine, [
      ["Carol", "pass"],
      ["Carol", "end"],
      ["Carol", "pass"],
    ]);
    expect(turn(state).phase).toBe("discard");
    expect(turn(state).discardActionsLeft).toBe(0);
    // A card in hand, and no discard offered: the action is gone.
    expect(ids(engine)).toEqual(["pass"]);
    expect(state.seats[2]!.permanents).toEqual([]);
    expect(ash(state, 2)).toContain("Not to Be");
  });
});

describe("Wash (102151)", () => {
  function washGame(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    phase(state, "master");
    state.seats[0]!.hand.push({ id: "mc0", name: "Misdirection" });
    state.seats[1]!.hand.push({ id: "w1", name: "Wash" });
    state.seats[1]!.library.push({ id: "L2", name: "Conditioning" });
    state.seats[2]!.hand.push({ id: "sr1", name: "Sudden Reversal" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("cancels the prey's master, refunds it, and gives the master phase action back NOW", () => {
    const { state, engine } = washGame();
    runTrace(engine, [
      ["Alice", "play:Misdirection:-:M"],
      ["Alice", "pass"],
      ["Bob", "play:Wash"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(state.seats[1]!.minions.find((m) => m.id === "M")!.locked).toBe(false);
    expect(state.seats[0]!.pool).toBe(10);
    // Spent 1, given 1 back — and Wash's own trifle gain is not Alice's.
    expect(turn(state).masterActionsLeft).toBe(1);
    expect(turn(state).trifleGained).toBe(false);
    // DEFECT 3: Bob's out-of-turn trifle gain is his, next master phase
    // (p. 9). It used to be lost: the only trifle branch wanted a master
    // phase as the parent frame, and Wash resolves inside Misdirection's.
    expect(state.seats[1]!.trifleNextMaster).toBe(true);
    // "Do not replace until your unlock phase."
    expect(state.seats[1]!.delayedDraws).toBe(1);
    expect(state.seats[1]!.library.map((c) => c.id)).toEqual(["L2"]);
  });

  it("on an out-of-turn master, the action comes back NEXT master phase and the budget stays spent", () => {
    const { state, engine } = washGame();
    runTrace(engine, [
      ["Alice", "play:Misdirection:-:M"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "play:Sudden Reversal"],
      // Carol is Bob's prey.
      ["Alice", "pass"],
      ["Bob", "play:Wash"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    // Sudden Reversal cancelled, so Misdirection resolved.
    expect(state.seats[1]!.minions.find((m) => m.id === "M")!.locked).toBe(true);
    expect(state.seats[2]!.masterActionsNext).toBe(1);
    // [LSJ 20070309-2]: still no second out-of-turn master before then.
    expect(state.seats[2]!.outOfTurnMasterUsed).toBe(true);
  });

  it("the booked actions arrive as that seat's master phase opens", () => {
    const { state, engine } = washGame();
    state.seats[1]!.trifleNextMaster = true;
    state.seats[1]!.outOfTurnMasterUsed = true;
    state.seats[1]!.masterActionsNext = 1;
    runTrace(engine, [
      ["Alice", "pass"],
      ["Alice", "end"],
      ["Alice", "pass"],
      ["Alice", "pass"],
    ]);
    // Bob's unlock phase asks nothing here; his master phase is open.
    expect(engine.decision()!.window).toBe("turn.master");
    expect(turn(state).seat).toBe("Bob");
    expect(turn(state).phase).toBe("master");
    // 0 (out-of-turn debt) + 1 booked + 1 trifle — and the trifle gain is
    // this phase's one.
    expect(turn(state).masterActionsLeft).toBe(2);
    expect(turn(state).trifleGained).toBe(true);
    expect(state.seats[1]!.masterActionsNext).toBeUndefined();
  });

  it("is not offered against a Methuselah who is neither predator nor prey", () => {
    const state = threeSeatGame();
    phase(state, "master");
    const carol = state.seats[2]!;
    const dave: SeatState = {
      ...carol,
      id: "Dave",
      minions: [makeMinion("D", "Dave")],
      hand: [],
      permanents: [],
    };
    state.seats.push(dave);
    state.seats[0]!.hand.push({ id: "mc0", name: "Misdirection" });
    // Alice's prey is Bob and her predator is Dave: Carol sits across.
    carol.hand.push({ id: "w1", name: "Wash" });
    dave.hand.push({ id: "w2", name: "Wash" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Misdirection:-:M"],
      ["Alice", "pass"],
      ["Bob", "pass"],
    ]);
    expect(engine.decision()!.seat).toBe("Carol");
    expect(ids(engine)).toEqual(["pass"]);
    runTrace(engine, [["Carol", "pass"]]);
    expect(engine.decision()!.seat).toBe("Dave");
    expect(ids(engine)).toContain("play:Wash:-:w2");
  });
});

describe("Emergency Preparations (100636)", () => {
  it("burns 1 pool to cancel a Gehenna card; the event's own cost is not refunded", () => {
    const state = threeSeatGame();
    phase(state, "discard");
    state.seats[0]!.hand.push({ id: "ev1", name: "Thirst" });
    state.seats[2]!.hand.push({ id: "ep1", name: "Emergency Preparations" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Thirst"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "play:Emergency Preparations"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(state.seats[2]!.pool).toBe(9);
    expect(state.seats.flatMap((s) => s.permanents)).toEqual([]);
    expect(ash(state, 0)).toEqual(["Thirst"]);
    // Each event is played once each game — a cancelled one was played.
    expect(state.eventsPlayed).toContain("Thirst");
  });

  function unlockGame(gehenna: number): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    for (let i = 0; i < gehenna; i++) {
      state.seats[1]!.permanents.push(inPlay(`g${i}`, "Thirst", ["event", "gehenna"]));
    }
    state.seats[0]!.hand.push({ id: "ep1", name: "Emergency Preparations" });
    const M = state.seats[1]!.minions.find((m) => m.id === "M")!;
    M.locked = true;
    M.capacity = 8;
    const N = state.seats[2]!.minions[0]!;
    N.locked = true;
    N.capacity = 7;
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("in your minion phase, with two Gehenna cards in play, unlocks a vampire of capacity above 7", () => {
    const { state, engine } = unlockGame(2);
    const offered = ids(engine).filter((id) => id.startsWith("play:Emergency Preparations"));
    // Capacity 8 yes; capacity 7 not ("above 7"); an unlocked one is futile.
    expect(offered).toEqual(["play:Emergency Preparations:-:unlock:M:ep1"]);
    runTrace(engine, [
      ["Alice", "play:Emergency Preparations:-:unlock:M"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(state.seats[1]!.minions.find((m) => m.id === "M")!.locked).toBe(false);
    // Still an out-of-turn master: next master phase's action is spent.
    expect(state.seats[0]!.outOfTurnMasterUsed).toBe(true);
  });

  it("is not offered in the minion phase under two Gehenna cards", () => {
    const { engine } = unlockGame(1);
    expect(ids(engine).some((id) => id.startsWith("play:Emergency Preparations"))).toBe(false);
  });
});

describe("Personal Involvement (101394)", () => {
  function piGame(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    phase(state, "master");
    state.seats[0]!.hand.push({ id: "pi1", name: "Personal Involvement" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("burns 3 from a prey with more pool than you after paying", () => {
    const { state, engine } = piGame();
    runTrace(engine, [
      ["Alice", "play:Personal Involvement"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(state.seats[0]!.pool).toBe(7);
    expect(state.seats[1]!.pool).toBe(7);
  });

  it("does nothing to a prey who is not richer", () => {
    const { state, engine } = piGame();
    state.seats[1]!.pool = 7;
    runTrace(engine, [
      ["Alice", "play:Personal Involvement"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(state.seats[1]!.pool).toBe(7);
  });

  it("ANY Methuselah may burn 2 pool to cancel it, and then its cost is not paid", () => {
    const { state, engine } = piGame();
    runTrace(engine, [["Alice", "play:Personal Involvement"]]);
    // Offered to the player too — "any Methuselah" — and naming its victim.
    const opt = engine.decision()!.options.find((o) => o.id === "cancelpay:pi1");
    expect(opt).toMatchObject({ kind: "payToCancel", pool: 2, harms: "Bob" });
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "cancelpay:pi1"],
      ["Carol", "pass"],
    ]);
    expect(state.seats[0]!.pool).toBe(10);
    expect(state.seats[1]!.pool).toBe(10);
    expect(state.seats[2]!.pool).toBe(8);
    expect(ash(state, 0)).toEqual(["Personal Involvement"]);
    // A cancelled master was still played: the master phase action is gone.
    expect(turn(state).masterActionsLeft).toBe(0);
  });

  it("a bot pays only to save itself, and never cancels its own card", () => {
    const { state, engine } = piGame();
    runTrace(engine, [["Alice", "play:Personal Involvement"]]);
    const bot = new HeuristicAgent();
    const pick = (seat: string): string => {
      const dp = engine.decision()!;
      expect(dp.seat).toBe(seat);
      return bot.decide(dp, dp.options, viewFor(state, dp.seat));
    };
    expect(pick("Alice")).toBe("pass");
    engine.choose("pass");
    expect(pick("Bob")).toBe("cancelpay:pi1");
    engine.choose("pass");
    expect(pick("Carol")).toBe("pass");
  });
});
