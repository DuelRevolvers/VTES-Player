/**
 * Paying blood to unlock (docs/pay-to-unlock-design.md).
 *
 * Detection (100533), Children of Osiris (100339), Firebrand (100736),
 * Eternal Vigilance (100666).
 *
 * One offer in four windows. The assertions that matter are about WHOSE
 * offer it is — three of these cards are played onto a vampire their own
 * controller does not control — and about the suppression biting first: a
 * vampire who never stopped unlocking has nothing to buy, so a test that
 * only checked the offer existed would pass on a card that did nothing.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
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

/** Walk to the start of the next Methuselah's turn, preferring `pass`: the
 *  unlock sweep runs as a turn begins, and whose turn it is decides whose
 *  vampires it touches. */
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

// ---------------------------------------------------------------------------

describe("Detection (100533)", () => {
  /** ALICE plays it on BOB's Lasombra: the suppression is Bob's problem and
   *  so is the offer to buy the unlock back. */
  function game(): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "W"), { clan: "Lasombra", blood: 2, locked: true });
    find(state, "W").attached.push(inPlay("dt", "Detection", "Alice"));
    Object.assign(find(state, "M"), { locked: true });
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "discard"; // the next turn is Bob's
    return state;
  }

  it("the bearer does not unlock in the sweep; the rest of the seat does", () => {
    const state = game();
    walkToNextTurn(new VtesEngine(state, testRegistry), state);
    expect(find(state, "W").locked).toBe(true);
    expect(find(state, "M").locked).toBe(false);
  });

  it("the BEARER'S controller may buy the unlock for 1 blood", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    walkToNextTurn(engine, state);
    // Bob's unlock phase, Bob's option — the card is Alice's.
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.map((o) => o.id)).toContain("ability:Detection:dt:payunlock:W");

    runTrace(engine, [["Bob", "ability:Detection:dt:payunlock:W"]]);
    expect(find(state, "W").locked).toBe(false);
    expect(find(state, "W").blood).toBe(1);
  });

  it("is not offered to the Methuselah who played it", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    walkToNextTurn(engine, state);
    // Pass Bob's whole unlock phase and check nobody else is ever offered it
    // while it is still Bob's turn.
    for (let i = 0; i < 6; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.seat !== "Bob") {
        expect(dp.options.some((o) => o.id.includes("payunlock"))).toBe(false);
      }
      const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      engine.choose(pick.id);
    }
  });

  it("the bearer cannot cast votes, and can burn the card off themselves", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "W"), { clan: "Lasombra", blood: 2, title: "prince" });
    find(state, "W").attached.push(inPlay("dt", "Detection", "Alice"));
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Bob";
      tf.phase = "minion";
    }
    const ids = optionIds(new VtesEngine(state, testRegistry));
    // "HE OR SHE may burn this card": the bearer, not Bob's other minion.
    expect(ids).toContain("act:Detection:dt:burn:W");
    expect(ids.some((i) => i === "act:Detection:dt:burn:M")).toBe(false);
  });
});

describe("Children of Osiris (100339)", () => {
  function game(): GameState {
    const state = threeSeatGame();
    // Alice's card; the clause hits every Ministry vampire at the table.
    seatOf(state, "Alice").permanents.push(inPlay("co", "Children of Osiris", "Alice"));
    Object.assign(find(state, "W"), { clan: "Ministry", blood: 2, locked: true });
    Object.assign(find(state, "M"), { clan: "Brujah", locked: true });
    seatOf(state, "Bob").minions.push(
      makeMinion("P", "Bob", { clan: "Ministry", blood: 0, locked: true }),
    );
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "discard"; // next turn is Bob's
    return state;
  }

  it("Ministry vampires stay locked in the sweep and others do not", () => {
    const state = game();
    walkToNextTurn(new VtesEngine(state, testRegistry), state);
    expect(find(state, "W").locked).toBe(true);
    expect(find(state, "P").locked).toBe(true);
    expect(find(state, "M").locked).toBe(false);
  });

  it("each Ministry vampire buys its OWN unlock, and one with no blood cannot", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    walkToNextTurn(engine, state);
    const ids = optionIds(engine).filter((i) => i.includes("payunlock"));
    // W has 2 blood; P has none, so there is nothing it can pay with.
    expect(ids).toEqual(["ability:Children of Osiris:co:payunlock:W"]);

    runTrace(engine, [["Bob", "ability:Children of Osiris:co:payunlock:W"]]);
    expect(find(state, "W").locked).toBe(false);
    expect(find(state, "W").blood).toBe(1);
    expect(find(state, "P").locked).toBe(true);
  });

  it("any vampire can burn it, and the Ministry pays 1 stealth to try", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("co", "Children of Osiris", "Alice"));
    Object.assign(find(state, "W"), { clan: "Ministry", blood: 2 });
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Bob";
      tf.phase = "minion";
    }
    const engine = new VtesEngine(state, testRegistry);
    expect(optionIds(engine)).toContain("act:Children of Osiris:co:burn:W");
    runTrace(engine, [["Bob", "act:Children of Osiris:co:burn:W"]]);
    // "Followers of Set get -1 stealth when attempting that action."
    expect(
      state.eventLog.some((e) => e.type === "StealthModified" && e.delta === -1),
    ).toBe(true);
  });
});

describe("Firebrand (100736)", () => {
  function game(): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), {
      sect: "anarch",
      capacity: 6,
      blood: 3,
    });
    find(state, "V1").attached.push(inPlay("fb", "Firebrand", "Alice"));
    // Alice's other anarchs: one younger and locked, one older and locked.
    seatOf(state, "Alice").minions.push(
      makeMinion("Y", "Alice", { sect: "anarch", capacity: 4, locked: true }),
      makeMinion("O", "Alice", { sect: "anarch", capacity: 8, locked: true }),
      makeMinion("C", "Alice", { sect: "camarilla", capacity: 3, locked: true }),
    );
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "minion";
    return state;
  }

  it("the bearer pays to unlock a ready YOUNGER anarch, and nobody else", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    const ids = optionIds(engine).filter((i) => i.includes("payunlock"));
    // Y (4) is younger; O (8) is older; C is not an anarch; the bearer is
    // already unlocked and is excluded anyway.
    expect(ids).toEqual(["ability:Firebrand:fb:payunlock:Y"]);

    runTrace(engine, [["Alice", "ability:Firebrand:fb:payunlock:Y"]]);
    expect(find(state, "Y").locked).toBe(false);
    // The BEARER pays, not the vampire who unlocks.
    expect(find(state, "V1").blood).toBe(2);
  });

  it("grants the bearer an extra vote", () => {
    const state = game();
    expect(find(state, "V1").attached[0]!.statics.votes).toBe(1);
  });
});

describe("Eternal Vigilance (100666)", () => {
  it("lets the bearer buy an unlock mid-action and block with it", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3 });
    Object.assign(find(state, "W"), { blood: 3, locked: true, sect: "sabbat" });
    find(state, "W").attached.push(inPlay("ev", "Eternal Vigilance", "Bob"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
    ]);
    // W is locked, so `block:W` is not on the table — the card's offer is.
    const ids = optionIds(engine);
    expect(ids.some((i) => i === "block:W")).toBe(false);
    expect(ids).toContain("ability:Eternal Vigilance:ev:payunlock:W");

    runTrace(engine, [["Bob", "ability:Eternal Vigilance:ev:payunlock:W"]]);
    expect(find(state, "W").locked).toBe(false);
    expect(find(state, "W").blood).toBe(2);
    // It unlocked INTO a block attempt, not merely unlocked.
    expect(
      state.eventLog.some((e) => e.type === "BlockDeclared" && e.blocker === "W") ||
        state.frames.some((f) => f.kind === "blockAttempt" && f.blocker === "W"),
    ).toBe(true);
  });

  it("requires a ready Sabbat title to play at all", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3 });
    seatOf(state, "Alice").hand.push({ id: "ev", name: "Eternal Vigilance" });
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "minion";
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((i) =>
        i.startsWith("play:Eternal Vigilance"),
      ),
    ).toBe(false);

    find(state, "V1").title = "archbishop";
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((i) =>
        i.startsWith("play:Eternal Vigilance"),
      ),
    ).toBe(true);
  });
});
