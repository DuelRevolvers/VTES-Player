/**
 * The blood-bank actions (docs/blood-bank-actions-design.md).
 *
 * Blood Feast (100200), Patshiv (101376), Esbat (100660),
 * Khabar: Loyalty (101045).
 *
 * The assertion that matters most is the one about WHOSE vampires get
 * fed: Blood Feast says "you control" and Patshiv and Esbat do not, and a
 * single-seat test cannot tell those apart.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function blood(state: GameState, id: string): number {
  return state.seats.flatMap((s) => s.minions).find((m) => m.id === id)!.blood;
}

/** Play an action from Alice's hand and walk it to resolution. */
function resolve(engine: VtesEngine, optionId: string): void {
  runTrace(engine, [
    ["Alice", optionId],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state C
  ]);
}

describe("Blood Feast (100200)", () => {
  it("feeds every ready Sabbat vampire ITS CONTROLLER has, and nobody else's", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, {
      sect: "sabbat",
      title: "archbishop",
      capacity: 8,
      blood: 2,
    });
    state.seats[0]!.minions.push(
      makeMinion("V2", "Alice", { sect: "sabbat", capacity: 6, blood: 1 }),
      makeMinion("V3", "Alice", { sect: "camarilla", capacity: 6, blood: 1 }),
    );
    // Bob's Sabbat vampire must NOT be fed — the card says "you control".
    Object.assign(state.seats[1]!.minions[0]!, { sect: "sabbat", capacity: 6, blood: 1 });
    state.seats[0]!.hand.push({ id: "bf", name: "Blood Feast" });
    const engine = new VtesEngine(state, testRegistry);
    resolve(engine, "play:Blood Feast:basic:V1");

    expect(blood(state, "V1")).toBe(2); // 2 − 1 blood cost + 1 gained
    expect(blood(state, "V2")).toBe(2);
    expect(blood(state, "V3")).toBe(1); // camarilla
    expect(blood(state, "W")).toBe(1); // Bob's Sabbat vampire
  });

  it("is not playable by an untitled vampire", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { sect: "sabbat", capacity: 8, blood: 3 });
    state.seats[0]!.hand.push({ id: "bf", name: "Blood Feast" });
    const engine = new VtesEngine(state, testRegistry);
    expect(engine.decision()!.options.some((o) => o.id.startsWith("play:Blood Feast"))).toBe(false);
  });
});

describe("Patshiv (101376)", () => {
  it("feeds EVERY Methuselah's unlocked Ravnos, the actor's own included", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { clan: "Ravnos", capacity: 8, blood: 1 });
    // Bob's Ravnos is fed too: the card names no controller.
    Object.assign(state.seats[1]!.minions[0]!, { clan: "Ravnos", capacity: 6, blood: 1 });
    // …but a LOCKED one is not, and a non-Ravnos is not.
    Object.assign(state.seats[1]!.minions[1]!, {
      clan: "Ravnos",
      capacity: 6,
      blood: 1,
      locked: true,
    });
    Object.assign(state.seats[2]!.minions[0]!, { clan: "Brujah", capacity: 6, blood: 1 });
    state.seats[0]!.hand.push({ id: "ps", name: "Patshiv" });
    const engine = new VtesEngine(state, testRegistry);
    resolve(engine, "play:Patshiv:basic:V1");

    // The actor locks at announcement (p. 25) and so is no longer
    // unlocked when the effect resolves — which is the card working, not
    // a bug: "each ready UNLOCKED Ravnos".
    expect(blood(state, "V1")).toBe(1);
    expect(blood(state, "W")).toBe(2);
    expect(blood(state, "M")).toBe(1); // locked
    expect(blood(state, "N")).toBe(1); // Brujah
  });
});

describe("Esbat (100660)", () => {
  it("offers both splits and pays the one the player picked", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { sect: "sabbat", capacity: 8, blood: 1 });
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { sect: "sabbat", capacity: 6, blood: 1 }));
    Object.assign(state.seats[1]!.minions[0]!, { sect: "sabbat", capacity: 6, blood: 1 });
    state.seats[0]!.hand.push({ id: "es", name: "Esbat" });
    const engine = new VtesEngine(state, testRegistry);

    const ids = engine.decision()!.options.map((o) => o.id);
    // One recipient (2 blood) and two recipients (1 each), both offered.
    expect(ids.some((i) => i.startsWith("play:Esbat:basic:V1:V2:"))).toBe(true);
    expect(ids.some((i) => i.startsWith("play:Esbat:basic:V1:V2|W:"))).toBe(true);

    resolve(engine, "play:Esbat:basic:V1:V2|W");
    expect(blood(state, "V2")).toBe(2);
    expect(blood(state, "W")).toBe(2);
    expect(blood(state, "V1")).toBe(1); // the actor locked, so never a target
  });

  it("offers no two-recipient split when only one vampire qualifies", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { sect: "sabbat", capacity: 8, blood: 1 });
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { sect: "sabbat", capacity: 6, blood: 1 }));
    state.seats[0]!.hand.push({ id: "es", name: "Esbat" });
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.startsWith("play:Esbat:basic:V1:V2:"))).toBe(true);
    // The ACTOR is never a recipient of its own unlocked-only card: it
    // locks at announcement (p. 25), so the two-recipient split has only
    // one candidate and is not offered at all.
    expect(ids.some((i) => i.startsWith("play:Esbat:basic:V1:V1"))).toBe(false);
    expect(ids.some((i) => i.includes("|"))).toBe(false);
  });
});

describe("Khabar: Loyalty (101045)", () => {
  it("feeds a YOUNGER Banu Haqim in the uncontrolled region — the registry clan, not 'Assamite'", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    Object.assign(alice.minions[0]!, { clan: "Banu Haqim", capacity: 8 });
    alice.uncontrolled.push(
      { card: makeMinion("U", "Alice", { clan: "Banu Haqim", capacity: 5, blood: 0 }), counters: 0 },
      { card: makeMinion("O", "Alice", { clan: "Banu Haqim", capacity: 9, blood: 0 }), counters: 0 },
      { card: makeMinion("X", "Alice", { clan: "Ventrue", capacity: 5, blood: 0 }), counters: 0 },
    );
    alice.hand.push({ id: "kl", name: "Khabar: Loyalty" });
    const engine = new VtesEngine(state, testRegistry);

    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.startsWith("play:Khabar: Loyalty:basic:V1:U"))).toBe(true);
    expect(ids.some((i) => i.startsWith("play:Khabar: Loyalty:basic:V1:O"))).toBe(false); // older
    expect(ids.some((i) => i.startsWith("play:Khabar: Loyalty:basic:V1:X"))).toBe(false); // Ventrue

    resolve(engine, "play:Khabar: Loyalty:basic:V1:U");
    expect(alice.uncontrolled.find((u) => u.card.id === "U")!.counters).toBe(2);
  });
});
