/**
 * The last of the "Minions can burn this card as a Ⓓ action" family that
 * needed a sub-system each (docs/granted-actions-design.md §5):
 * Brujah Debate (100260) — a *global* aura plus an automatic forced lock
 * in every Methuselah's master phase; Mob Connections (101229) — a press
 * credit granted from a card in play; Powerbase: Munich (102301) — an
 * Oblivion blood mover, and the first granted action with a cost.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentAura, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function entry(id: string, name: string, aura?: PermanentAura): PermanentInPlay {
  const e: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: [],
  };
  if (aura) e.aura = aura;
  return e;
}

const debateAura: PermanentAura = {
  scope: "global",
  clan: "Brujah",
  strength: 1,
  maneuverPerCombat: 1,
};

/** Alice's turn, about to enter the master phase. */
function enteringMaster(state: GameState): GameState {
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = "unlock";
    tf.unlockDone = true;
    tf.edgeDone = true;
    tf.unlockAbilitiesDone = true;
  }
  return state;
}

describe("Brujah Debate (100260)", () => {
  it("locks the oldest Brujah automatically when only one qualifies", () => {
    const state = enteringMaster(threeSeatGame());
    const alice = state.seats[0]!;
    alice.minions[0]!.clan = "Brujah";
    alice.minions[0]!.capacity = 7;
    alice.minions.push(makeMinion("B2", "Alice", { clan: "Brujah", capacity: 3 }));
    alice.permanents.push(entry("bd1", "Brujah Debate", debateAura));
    const engine = new VtesEngine(state, testRegistry);

    engine.decision(); // settle into the master phase

    expect(alice.minions.find((m) => m.id === "V1")!.locked).toBe(true); // the 7
    expect(alice.minions.find((m) => m.id === "B2")!.locked).toBe(false);
  });

  it("asks which to lock when the oldest tie", () => {
    const state = enteringMaster(threeSeatGame());
    const alice = state.seats[0]!;
    alice.minions[0]!.clan = "Brujah";
    alice.minions[0]!.capacity = 5;
    alice.minions.push(makeMinion("B2", "Alice", { clan: "Brujah", capacity: 5 }));
    alice.permanents.push(entry("bd1", "Brujah Debate", debateAura));
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.window).toBe("choice");
    expect(dp.seat).toBe("Alice");
    expect(dp.options.map((o) => o.id).sort()).toEqual([
      "choice:Brujah Debate:bd1:lockBrujah:B2",
      "choice:Brujah Debate:bd1:lockBrujah:V1",
    ]);

    engine.choose("choice:Brujah Debate:bd1:lockBrujah:B2");
    expect(alice.minions.find((m) => m.id === "B2")!.locked).toBe(true);
    expect(alice.minions.find((m) => m.id === "V1")!.locked).toBe(false);
  });

  it("does nothing for a Methuselah with no Brujah", () => {
    const state = enteringMaster(threeSeatGame());
    state.seats[0]!.permanents.push(entry("bd1", "Brujah Debate", debateAura));
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.window).toBe("turn.master");
    expect(state.seats[0]!.minions[0]!.locked).toBe(false);
  });

  it("gives every Methuselah's Brujah +1 strength and a maneuver each combat", () => {
    const state = threeSeatGame();
    // The card is ALICE's, but Bob's Brujah benefits too (unqualified).
    state.seats[0]!.permanents.push(entry("bd1", "Brujah Debate", debateAura));
    state.seats[1]!.minions[0]!.clan = "Brujah";
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // → combat
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
    ]);

    // The aura granted a maneuver credit to Bob's Brujah (the opposing
    // side) and none to Alice's non-Brujah acting minion.
    const cf = state.frames.find((f) => f.kind === "combat")!;
    expect(cf.kind === "combat" && cf.maneuverCredits).toEqual({ acting: 0, opposing: 1 });
    const atRange = engine.decision()!;
    expect(atRange.window).toBe("combat.range");
    expect(atRange.seat).toBe("Alice"); // acting side first, with no credit
    expect(atRange.options.some((o) => o.id === "maneuver:credit")).toBe(false);

    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      ["Alice", "pass"], ["Bob", "pass"], // damage
    ]);

    // Bob's Brujah strikes for 1 + 1 = 2; Alice's non-Brujah for 1.
    const dealt = state.eventLog.filter((e) => e.type === "DamageInflicted");
    expect(dealt.some((e) => e.type === "DamageInflicted" && e.minion === "V1" && e.amount === 2)).toBe(true);
    expect(dealt.some((e) => e.type === "DamageInflicted" && e.minion === "W" && e.amount === 1)).toBe(true);
  });

  it("is burned by a non-Ventrue minion only", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    state.seats[0]!.permanents.push(entry("bd1", "Brujah Debate", debateAura));
    state.seats[1]!.minions[0]!.clan = "Ventrue";
    state.seats[1]!.minions[1]!.clan = "Brujah";
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "act:Brujah Debate:bd1:burn:M")).toBe(true);
    expect(dp.options.some((o) => o.id === "act:Brujah Debate:bd1:burn:W")).toBe(false);
  });
});

describe("Mob Connections (101229)", () => {
  it("locks to give its controller's combatant a press", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(entry("mc1", "Mob Connections"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // → combat
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      ["Alice", "pass"], ["Bob", "pass"], // damage
      ["Alice", "ability:Mob Connections:mc1:press"],
    ]);

    expect(state.seats[0]!.permanents[0]!.locked).toBe(true);
    // Alice now holds a press credit and may continue the combat.
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id.startsWith("press:"))).toBe(true);
  });
});

describe("Powerbase: Munich (102301)", () => {
  function munichGame(): GameState {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    state.seats[0]!.minions[0]!.disciplines = { obl: "basic" };
    state.seats[0]!.permanents.push(entry("pm1", "Powerbase: Munich"));
    return state;
  }

  it("locks to move blood from an Oblivion vampire to pool", () => {
    const state = munichGame();
    const poolBefore = state.seats[0]!.pool;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "ability:Powerbase: Munich:pm1:toPool:V1"]]);

    expect(state.seats[0]!.pool).toBe(poolBefore + 1);
    expect(state.seats[0]!.minions[0]!.blood).toBe(1);
    expect(state.seats[0]!.permanents[0]!.locked).toBe(true);
  });

  it("offers nothing for a vampire without Oblivion", () => {
    const state = munichGame();
    state.seats[0]!.minions[0]!.disciplines = {};
    const engine = new VtesEngine(state, testRegistry);
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("ability:Powerbase: Munich"))).toBe(false);
  });

  it("is burned only by an independent vampire, and costs it 1 blood", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    state.seats[0]!.permanents.push(entry("pm1", "Powerbase: Munich"));
    state.seats[1]!.minions[0]!.sect = "independent"; // W
    state.seats[1]!.minions[1]!.sect = "camarilla"; // M
    const bloodBefore = state.seats[1]!.minions[0]!.blood;
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "act:Powerbase: Munich:pm1:burn:W")).toBe(true);
    expect(dp.options.some((o) => o.id === "act:Powerbase: Munich:pm1:burn:M")).toBe(false);

    runTrace(engine, [
      ["Bob", "act:Powerbase: Munich:pm1:burn:W"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // announce
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // A
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // C → resolves
    ]);

    expect(state.seats[0]!.permanents).toHaveLength(0);
    // "…that costs 1 blood", paid at resolution on success (p. 27).
    expect(state.seats[1]!.minions[0]!.blood).toBe(bloodBefore - 1);
  });
});
