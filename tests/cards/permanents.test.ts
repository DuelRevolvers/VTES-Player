/**
 * The permanents gate: cards in play. Locations with statics (Elder
 * Library 100620, Information Highway 100984), lock-to-use abilities
 * (The Barrens 100135), on-vampire blood movers (Blood Doll 100199,
 * Vessel 102113), equipment via the equip action (Sport Bike 101856),
 * and weapons in combat (.44 Magnum 100001).
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function masterPhaseGame(aliceCards: string[]): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const frame = state.frames[0]!;
  if (frame.kind !== "turn") throw new Error("fixture");
  frame.phase = "master";
  frame.masterActionsLeft = 1;
  aliceCards.forEach((name, i) =>
    state.seats[0]!.hand.push({ id: `mc${i}`, name }),
  );
  return { state, engine: new VtesEngine(state, testRegistry) };
}

function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [], ...over };
}

describe("Elder Library (100620)", () => {
  it("costs 1 pool and raises hand size to 8, drawing up immediately", () => {
    const { state, engine } = masterPhaseGame(["Elder Library"]);
    const alice = state.seats[0]!;
    alice.library.push({ id: "lib1", name: "Threats" }, { id: "lib2", name: "Threats" });

    runTrace(engine, [
      ["Alice", "play:Elder Library"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    expect(alice.pool).toBe(9);
    expect(alice.permanents).toHaveLength(1);
    // Hand was 2 (Conditioning + Elder Library): play → replace draw →
    // 2 again, then the new hand size of 8 pulls the last library card.
    expect(alice.hand).toHaveLength(3);
    expect(alice.library).toHaveLength(0);
  });

  it("cannot be played while an own copy is in play (unique)", () => {
    const { state, engine } = masterPhaseGame(["Elder Library"]);
    state.seats[0]!.permanents.push(entry("el0", "Elder Library", { statics: { handSize: 1 } }));
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Elder Library"))).toBe(false);
  });
});

describe("Information Highway (100984)", () => {
  it("grants +2 transfers in the influence phase", () => {
    const { state, engine } = masterPhaseGame(["Information Highway"]);
    const alice = state.seats[0]!;
    alice.uncontrolled.push({
      card: { ...state.seats[0]!.minions[0]!, id: "X", name: "X", blood: 0, capacity: 5 },
      counters: 0,
    });

    runTrace(engine, [
      ["Alice", "play:Information Highway"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"], // end master phase
      ["Alice", "end"], // end minion phase → influence: 1 + 2 = 3 transfers
      ["Alice", "inf:add:X"],
      ["Alice", "inf:add:X"],
      ["Alice", "inf:add:X"],
    ]);

    expect(alice.uncontrolled[0]!.counters).toBe(3);
    // All 3 transfers spent → only pass remains.
    const dp = engine.decision()!;
    expect(dp.window).toBe("turn.influence");
    expect(dp.options.map((o) => o.id)).toEqual(["pass"]);
  });
});

describe("The Barrens (100135)", () => {
  it("locks to discard a card and draw up, anywhere the owner has impulse", () => {
    const { state, engine } = masterPhaseGame(["The Barrens"]);
    const alice = state.seats[0]!;
    alice.library.push({ id: "lib1", name: "Threats" });

    runTrace(engine, [
      ["Alice", "play:The Barrens"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Still in the master phase: the ability is available (no MPA cost).
      ["Alice", "ability:The Barrens"],
    ]);

    const barrens = alice.permanents[0]!;
    expect(barrens.locked).toBe(true);
    expect(state.eventLog.some((e) => e.type === "CardDiscarded")).toBe(true);
    expect(alice.hand.some((c) => c.id === "lib1")).toBe(true); // drew up
    // Locked → no further uses this turn.
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("ability:The Barrens"))).toBe(false);
  });
});

describe("Blood Doll (100199)", () => {
  it("attaches to an own vampire and moves blood in the same master phase, once", () => {
    const { state, engine } = masterPhaseGame(["Blood Doll"]);
    const alice = state.seats[0]!;
    const v1 = alice.minions[0]!;

    runTrace(engine, [
      ["Alice", "play:Blood Doll:-:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Usable the turn it is played (ruling p. 47).
      ["Alice", "ability:Blood Doll"],
    ]);

    // The first listed direction is vampire → pool.
    expect(v1.blood).toBe(1);
    expect(alice.pool).toBe(11);
    // Once per master phase.
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("ability:Blood Doll"))).toBe(false);
  });
});

describe("Vessel (102113)", () => {
  it("is a trifle; attaching can burn a Blood Doll in play", () => {
    const { state, engine } = masterPhaseGame(["Vessel"]);
    const alice = state.seats[0]!;
    const v1 = alice.minions[0]!;
    v1.attached.push(entry("bd0", "Blood Doll"));

    runTrace(engine, [
      ["Alice", "play:Vessel:-:V1:bd0"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    expect(alice.pool).toBe(9); // Vessel costs 1 pool
    expect(v1.attached.map((p) => p.card.name)).toEqual(["Vessel"]);
    expect(state.eventLog.some((e) => e.type === "PermanentBurned")).toBe(true);
    // Trifle refund: the master phase action is back.
    const frame = state.frames[0]!;
    if (frame.kind !== "turn") throw new Error("frame");
    expect(frame.masterActionsLeft).toBe(1);
  });

  it("moves blood during the controller's unlock phase", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    const v1 = alice.minions[0]!;
    v1.attached.push(entry("vs0", "Vessel"));
    const frame = state.frames[0]!;
    if (frame.kind !== "turn") throw new Error("fixture");
    frame.phase = "unlock";
    frame.unlockDone = false;
    frame.edgeDone = false;
    frame.unlockAbilitiesDone = false;
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.window).toBe("turn.unlock");
    expect(dp.options.some((o) => o.id.includes("Vessel"))).toBe(true);

    runTrace(engine, [["Alice", "ability:Vessel:vs0:toPool"]]);
    expect(v1.blood).toBe(1);
    expect(alice.pool).toBe(11);

    // Used → no options left → the phase advances on its own.
    const next = engine.decision()!;
    expect(next.window).toBe("turn.master");
  });
});

describe("Sport Bike (101856)", () => {
  it("equips via an undirected +1 stealth action, paying pool at resolution", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "sb1", name: "Sport Bike" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Sport Bike"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Undirected equip: announce, A (prey+predator decline), C.
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

    const v1 = state.seats[0]!.minions[0]!;
    expect(v1.attached.map((p) => p.card.name)).toEqual(["Sport Bike"]);
    expect(v1.attached[0]!.tags).toContain("vehicle");
    expect(state.seats[0]!.pool).toBe(9); // paid at resolution
    expect(state.eventLog.some((e) => e.type === "CardBurned")).toBe(false);
    expect(v1.locked).toBe(true);
  });

  it("its +1 intercept static lets the bearer catch a hunt", () => {
    const state = threeSeatGame();
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.attached.push(entry("sb2", "Sport Bike", { statics: { intercept: 1 }, tags: ["vehicle"] }));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "hunt:V1"], // +1 inherent stealth
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
      // Static intercept 1 ≥ stealth 1 → pending success; quiescence.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    expect(state.eventLog.some((e) => e.type === "BlockSucceeded")).toBe(true);
  });
});

describe(".44 Magnum (100001)", () => {
  it("maneuvers to long (committing the gun) and strikes for 2R", () => {
    const state = threeSeatGame();
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.attached.push(entry("gun1", ".44 Magnum", { tags: ["weapon", "gun"] }));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Combat. Before Range: quiet.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Range: Alice declines; M uses the gun's maneuver → long range,
      // strike committed to the gun.
      ["Alice", "pass"],
      ["Bob", "ability:.44 Magnum:gun1:maneuver"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      // Before Strikes: quiet.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Strikes: V1 can only flail (hand, useless at long); M must use
      // the committed gun.
      ["Alice", "strike:hand"],
      ["Bob", "ability:.44 Magnum:gun1:strike"],
      // Damage: only V1 takes 2 (ranged works at long; hand does not).
      ["Alice", "pass"],
      // Press, End of Round.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    const v1 = state.seats[0]!.minions[0]!;
    expect(v1.blood).toBe(0); // mended 2
    expect(v1.inTorpor).toBe(false);
    expect(m.blood).toBe(2); // untouched at long range
    const dmg = state.eventLog.find((e) => e.type === "DamageInflicted")!;
    expect(dmg).toMatchObject({ minion: "V1", amount: 2 });
    const range = state.eventLog.find((e) => e.type === "RangeSet")!;
    expect(range).toMatchObject({ range: "long" });
  });
});
