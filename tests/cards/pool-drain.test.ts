/**
 * Recurring pool drains from a card in play (docs/pool-drain-design.md).
 *
 * Anarch Revolt (100055), Judgment: Camarilla Segregation (101028),
 * Augury of Doom (102310), War of Ages (102348), Fame (100698), Tension
 * in the Ranks (101958).
 *
 * Each card is a standing tax plus a printed price for removing it, so
 * both halves are pinned — including the negative space: who does NOT pay,
 * and when the removal is not on the table.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function inPlay(id: string, name: string): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [name] };
}

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

/** Run `seat`'s unlock phase to completion and return the pool deltas. */
function unlockPhase(state: GameState, seat: string): Record<string, number> {
  const before = Object.fromEntries(state.seats.map((s) => [s.id, s.pool]));
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn frame");
  tf.seat = seat;
  tf.phase = "unlock";
  tf.unlockDone = false;
  new VtesEngine(state, testRegistry).decision();
  return Object.fromEntries(
    state.seats.map((s) => [s.id, (before[s.id] ?? 0) - s.pool]),
  );
}

// ---------------------------------------------------------------------------

describe("Anarch Revolt (100055)", () => {
  it("taxes every Methuselah with no ready Anarch, and spares those who have one", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("ar", "Anarch Revolt"));
    find(state, "W").sect = "anarch"; // Bob has a ready Anarch
    expect(unlockPhase(state, "Bob")["Bob"]).toBe(0);
    expect(unlockPhase(state, "Carol")["Carol"]).toBe(1);
    // Its own controller is not exempt — the card says "a Methuselah".
    expect(unlockPhase(state, "Alice")["Alice"]).toBe(1);
  });

  it("a LOCKED Anarch still counts — the card says ready, not unlocked", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("ar", "Anarch Revolt"));
    Object.assign(find(state, "W"), { sect: "anarch", locked: true });
    expect(unlockPhase(state, "Bob")["Bob"]).toBe(0);
  });

  it("an Anarch in TORPOR does not count", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("ar", "Anarch Revolt"));
    Object.assign(find(state, "W"), { sect: "anarch", inTorpor: true });
    expect(unlockPhase(state, "Bob")["Bob"]).toBe(1);
  });

  it("any Methuselah's vampire can call a referendum to burn it", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("ar", "Anarch Revolt"));
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    const engine = new VtesEngine(state, testRegistry);
    const opt = engine
      .decision()!
      .options.find((o) => o.id.startsWith("act:Anarch Revolt:ar:vote:"));
    expect(opt).toBeDefined();

    runTrace(engine, [
      ["Bob", opt!.id],
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], // announce
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], // state A
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], // blocks declined
    ]);
    // A political action: the referendum is up, and the card is still in
    // play — the vote decides, not the action's success.
    const rf = state.frames.find((f) => f.kind === "referendum");
    if (rf?.kind !== "referendum") throw new Error("no referendum");
    expect(rf.cardName).toBe("Anarch Revolt");
    expect(rf.fromCardInPlay).toBe(true);
    expect(seatOf(state, "Alice").permanents.some((p) => p.card.id === "ar")).toBe(true);
  });

  it("the political action is undirected, and one per vampire per turn", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("ar", "Anarch Revolt"));
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    find(state, "M").calledPoliticalThisTurn = true;
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine
      .decision()!
      .options.filter((o) => o.id.startsWith("act:Anarch Revolt:ar:vote:"))
      .map((o) => o.id);
    // W may call it; M already called one this turn (p. 24).
    expect(ids).toEqual(["act:Anarch Revolt:ar:vote:W"]);

    runTrace(engine, [
      ["Bob", "act:Anarch Revolt:ar:vote:W"],
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"],
    ]);
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action");
    expect(af.directed).toBe(false); // political actions are undirected
    expect(find(state, "W").calledPoliticalThisTurn).toBe(true);
  });
});

describe("Judgment: Camarilla Segregation (101028)", () => {
  function game(): GameState {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("jc", "Judgment: Camarilla Segregation"));
    return state;
  }

  it("taxes a Methuselah controlling any non-Camarilla vampire", () => {
    const state = game();
    find(state, "W").sect = "camarilla";
    find(state, "M").sect = "camarilla";
    // Bob is all-Camarilla; Carol's N has no sect at all, which is
    // "non-Camarilla" by the same reading `notClan` uses elsewhere.
    expect(unlockPhase(state, "Bob")["Bob"]).toBe(0);
    expect(unlockPhase(state, "Carol")["Carol"]).toBe(1);
  });

  it("any Methuselah can burn it by sacrificing a non-Camarilla vampire", () => {
    const state = game();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Bob";
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    find(state, "W").sect = "camarilla";
    find(state, "M").sect = "sabbat";
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine
      .decision()!
      .options.filter((o) => o.id.includes("razeMaster"))
      .map((o) => o.id);
    // Only the non-Camarilla vampire may be sacrificed.
    expect(ids).toEqual([
      "ability:Judgment: Camarilla Segregation:jc:razeMaster:M:-",
    ]);

    runTrace(engine, [["Bob", ids[0]!]]);
    expect(seatOf(state, "Alice").permanents.some((p) => p.card.id === "jc")).toBe(false);
    expect(state.seats.flatMap((s) => s.minions).some((m) => m.id === "M")).toBe(false);
    // It does NOT cost a master phase action — the card does not say so.
    const tf2 = state.frames[0]!;
    if (tf2.kind !== "turn") throw new Error("no turn frame");
    expect(tf2.masterActionsLeft).toBe(1);
  });

  it("is not offered to a Methuselah with nothing to sacrifice", () => {
    const state = game();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Bob";
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    for (const m of seatOf(state, "Bob").minions) m.sect = "camarilla";
    const engine = new VtesEngine(state, testRegistry);
    expect(
      engine.decision()!.options.some((o) => o.id.includes("razeMaster")),
    ).toBe(false);
  });
});

describe("Augury of Doom (102310)", () => {
  it("taxes the prey 1 per vampire in torpor, and nobody else", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("ad", "Augury of Doom"));
    // Alice's prey is Bob. Give Bob two vampires in torpor.
    seatOf(state, "Bob").minions.push(makeMinion("W2", "Bob"));
    find(state, "W").inTorpor = true;
    find(state, "W2").inTorpor = true;
    find(state, "N").inTorpor = true; // Carol is not the prey

    expect(unlockPhase(state, "Carol")["Carol"]).toBe(0);
    expect(unlockPhase(state, "Bob")["Bob"]).toBe(2);
  });

  it("burns itself when the prey has no vampires in torpor", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("ad", "Augury of Doom"));
    expect(unlockPhase(state, "Bob")["Bob"]).toBe(0);
    expect(seatOf(state, "Alice").permanents.some((p) => p.card.id === "ad")).toBe(false);
  });
});

describe("War of Ages (102348)", () => {
  function inPlayGame(): GameState {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("wa", "War of Ages"));
    return state;
  }

  it("taxes the prey 1 pool each of their unlock phases", () => {
    const state = inPlayGame();
    expect(unlockPhase(state, "Bob")["Bob"]).toBe(1);
    expect(unlockPhase(state, "Carol")["Carol"]).toBe(0);
    expect(unlockPhase(state, "Alice")["Alice"]).toBe(0);
  });

  it("burns itself for 3 pool when the prey is ousted", () => {
    const state = inPlayGame();
    const pool = seatOf(state, "Alice").pool;
    seatOf(state, "Bob").pool = 0;
    new VtesEngine(state, testRegistry).decision(); // settling ousts Bob

    expect(seatOf(state, "Bob").ousted).toBe(true);
    expect(seatOf(state, "Alice").permanents.some((p) => p.card.id === "wa")).toBe(false);
    // 3 from the card, plus the ordinary 6 for ousting your prey (p. 36).
    expect(seatOf(state, "Alice").pool).toBe(pool + 3 + 6);
  });

  it("its own two referendums are told apart", () => {
    // Played from hand it puts ITSELF in play; once in play, a referendum
    // burns it. Same card instance, same handler — `fromCardInPlay` is the
    // only thing distinguishing them (design §6).
    const state = inPlayGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    const engine = new VtesEngine(state, testRegistry);
    const opt = engine
      .decision()!
      .options.find((o) => o.id.startsWith("act:War of Ages:wa:vote:"));
    expect(opt).toBeDefined();
    runTrace(engine, [
      ["Bob", opt!.id],
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"],
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"],
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"],
    ]);
    const rf = state.frames.find((f) => f.kind === "referendum");
    if (rf?.kind !== "referendum") throw new Error("no referendum");
    expect(rf.fromCardInPlay).toBe(true);
  });

  it("its removal costs 1 pool, so a Methuselah at 1 pool cannot call it", () => {
    const state = inPlayGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    seatOf(state, "Bob").pool = 0;
    const engine = new VtesEngine(state, testRegistry);
    expect(
      engine.decision()?.options.some((o) => o.id.startsWith("act:War of Ages")),
    ).toBeFalsy();
  });
});

/**
 * Alice's V1 bleeds, Bob's M blocks, and V1's hand strike beats M down
 * into torpor. Real combat rather than a poke at internal state: torpor is
 * what fires `onLeaveReady`, and the hook has to see it arrive the way the
 * engine actually produces it.
 */
function torporM(state: GameState): void {
  Object.assign(find(state, "V1"), { strength: 5, blood: 4 });
  Object.assign(find(state, "M"), { blood: 1, strength: 0, locked: false });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block → combat
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
    ["Alice", "pass"], ["Bob", "pass"], // range
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
    ["Alice", "strike:hand"], ["Bob", "strike:hand"],
  ]);
  for (let i = 0; i < 30; i++) {
    const dp = engine.decision();
    if (!dp || !state.frames.some((f) => f.kind === "combat")) break;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
}

describe("Fame (100698)", () => {
  function famed(): GameState {
    const state = threeSeatGame();
    // Alice plays Fame on BOB's vampire — the normal use. The card stays
    // controlled by the Methuselah who played it (p. 16).
    const entry = inPlay("fa", "Fame");
    entry.controller = "Alice";
    find(state, "M").attached.push(entry);
    return state;
  }

  it("does nothing while the bearer is ready", () => {
    const state = famed();
    expect(unlockPhase(state, "Bob")["Bob"]).toBe(0);
    expect(unlockPhase(state, "Alice")["Alice"]).toBe(0);
  });

  it("taxes EVERY Methuselah once the bearer is in torpor — its owner too", () => {
    const state = famed();
    find(state, "M").inTorpor = true;
    expect(unlockPhase(state, "Bob")["Bob"]).toBe(1);
    expect(unlockPhase(state, "Carol")["Carol"]).toBe(1);
    // The card says "that Methuselah", with no exemption (design §3).
    expect(unlockPhase(state, "Alice")["Alice"]).toBe(1);
  });

  it("charges the bearer's controller 3 pool when they go to torpor", () => {
    const state = famed();
    const pool = seatOf(state, "Bob").pool;
    torporM(state);
    expect(find(state, "M").inTorpor).toBe(true);
    // 3 for Fame alone: M BLOCKED the bleed, so it cost Bob nothing.
    expect(seatOf(state, "Bob").pool).toBe(pool - 3);
  });
});

describe("Tension in the Ranks (101958)", () => {
  it("charges a minion's controller 1 pool when it is BURNED", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("tr", "Tension in the Ranks"));
    const engine = new VtesEngine(state, testRegistry);
    const carol = seatOf(state, "Carol").pool;
    engine.burnMinion("N");
    expect(seatOf(state, "Carol").pool).toBe(carol - 1);
  });

  it("…and when it is sent to TORPOR", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("tr", "Tension in the Ranks"));
    const bob = seatOf(state, "Bob").pool;
    torporM(state);
    expect(find(state, "M").inTorpor).toBe(true);
    // 1 for Tension alone: the bleed was blocked.
    expect(seatOf(state, "Bob").pool).toBe(bob - 1);
  });

  it("costs a master phase action AND two discarded master cards to burn", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("tr", "Tension in the Ranks"));
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Bob";
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    const bobHand = seatOf(state, "Bob").hand;
    bobHand.push(
      { id: "m1", name: "Blood Doll" },
      { id: "m2", name: "Vessel" },
      { id: "m3", name: "Conditioning" }, // not a master
    );
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine
      .decision()!
      .options.filter((o) => o.id.includes("razeMaster"))
      .map((o) => o.id);
    // Exactly one way to pay: the two master cards. The action modifier
    // is not a master and cannot be spent.
    expect(ids).toEqual(["ability:Tension in the Ranks:tr:razeMaster:-:m1,m2"]);

    runTrace(engine, [["Bob", ids[0]!]]);
    expect(seatOf(state, "Alice").permanents.some((p) => p.card.id === "tr")).toBe(false);
    expect(seatOf(state, "Bob").hand.map((c) => c.id)).toEqual(["d1", "m3"]);
    const tf2 = state.frames[0]!;
    if (tf2.kind !== "turn") throw new Error("no turn frame");
    expect(tf2.masterActionsLeft).toBe(0);
  });

  it("is not offered to a Methuselah holding only one master card", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("tr", "Tension in the Ranks"));
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Bob";
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    seatOf(state, "Bob").hand.push({ id: "m1", name: "Blood Doll" });
    const engine = new VtesEngine(state, testRegistry);
    expect(
      engine.decision()!.options.some((o) => o.id.includes("razeMaster")),
    ).toBe(false);
  });
});
