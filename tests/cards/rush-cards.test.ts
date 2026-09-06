/**
 * The rush gate's card wave (docs/rush-actions-design.md §3): hand-card
 * rushes with riders (Umbrous Clutch, Fleetness), and the rush-capable
 * allies (Aggressive Corpse, Freakish Conglomeration, War Ghoul).
 * Twisted Bloodhound drives the kernel tests in
 * tests/engine/rush-kernel.test.ts.
 */

import { describe, expect, it } from "vitest";
import type { PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [], ...over };
}

describe("Umbrous Clutch (102306)", () => {
  it("superior rushes with a maneuver credit usable in the range step", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.disciplines = { obl: "superior" };
    alice.hand.push({ id: "uc1", name: "Umbrous Clutch" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Umbrous Clutch:superior:V1:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A (Bob declines)
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → combat
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      // Range: the rush's maneuver credit moves V1 to long.
      ["Alice", "maneuver:credit"],
      ["Bob", "pass"], ["Alice", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      // Both hand strikes at long range: no damage, straight to press.
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(state.eventLog.find((e) => e.type === "CombatBegan")).toMatchObject({
      acting: "V1",
      opposing: "W",
    });
    expect(state.eventLog.some((e) => e.type === "RangeSet" && e.range === "long")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "DamageInflicted")).toBe(false);
    // A rush action card is burned on success like any action card.
    expect(state.eventLog.some((e) => e.type === "CardBurned" && e.cardId === "uc1")).toBe(true);
  });
});

describe("Fleetness (100747)", () => {
  it("superior may only target locked minions", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.disciplines = { cel: "superior" };
    alice.hand.push({ id: "fl1", name: "Fleetness" });
    const engine = new VtesEngine(state, testRegistry);

    // Nobody is locked: the superior rush offers no targets; the basic
    // bleed mode is still there.
    let dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Fleetness:superior"))).toBe(false);
    expect(dp.options.some((o) => o.id.startsWith("play:Fleetness:basic"))).toBe(true);

    state.seats[1]!.minions.find((x) => x.id === "W")!.locked = true;
    dp = engine.decision()!;
    const superiors = dp.options.filter((o) => o.id.startsWith("play:Fleetness:superior"));
    expect(superiors.map((o) => o.id)).toEqual(["play:Fleetness:superior:V1:W:fl1"]);
  });

  it("basic is a +1 stealth bleed costing 1 blood at resolution", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.disciplines = { cel: "basic" };
    alice.hand.push({ id: "fl1", name: "Fleetness" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Fleetness:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);

    expect(state.seats[1]!.pool).toBe(9); // bled for 1
    expect(alice.minions[0]!.blood).toBe(1); // paid 1 at resolution
    expect(state.edge).toBe("Alice");
    expect(
      state.eventLog.some((e) => e.type === "StealthModified" && e.delta === 1),
    ).toBe(true);
  });
});

describe("Aggressive Corpse (102286)", () => {
  it("recruits for 2 of the recruiter's blood", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.hand.push({ id: "ac1", name: "Aggressive Corpse" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Aggressive Corpse"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(alice.minions[0]!.blood).toBe(0); // 2 blood at resolution
    const corpse = alice.minions.find((m) => m.id === "ac1")!;
    expect(corpse.blood).toBe(3);
    expect(corpse.strength).toBe(2);
  });

  it("rushes a minion via its own card text", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions.push(
      makeAlly("ac0", "Alice", 3, {
        name: "Aggressive Corpse",
        strength: 2,
        attached: [entry("ac0", "Aggressive Corpse")],
      }),
    );
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "act:Aggressive Corpse:ac0:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → combat
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      ["Alice", "pass"], // corpse takes W's 1 (life 3 → 2)
      ["Bob", "pass"], // W takes 2 (mends, blood 3 → 1)
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(state.seats[0]!.minions.find((m) => m.id === "ac0")!.blood).toBe(2);
    expect(state.seats[1]!.minions.find((x) => x.id === "W")!.blood).toBe(1);
  });
});

describe("Freakish Conglomeration (102324)", () => {
  it("superior recruit enters with 4 life", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.disciplines = { tha: "superior" };
    alice.hand.push({ id: "fc1", name: "Freakish Conglomeration" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Freakish Conglomeration:superior"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(alice.minions.find((m) => m.id === "fc1")!.blood).toBe(4);
  });

  it("burns 1 life during its controller's unlock phase, and dies at 0", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions.push(
      makeAlly("fc0", "Alice", 1, {
        name: "Freakish Conglomeration",
        strength: 3,
        bleedAmount: 1,
        attached: [entry("fc0", "Freakish Conglomeration")],
      }),
    );
    const frame = state.frames[0]!;
    if (frame.kind !== "turn") throw new Error("fixture");
    frame.phase = "unlock";
    frame.unlockDone = false;
    const engine = new VtesEngine(state, testRegistry);

    engine.decision(); // settle the unlock phase
    expect(alice.minions.some((m) => m.id === "fc0")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "MinionBurned" && e.minion === "fc0")).toBe(true);
  });
});

describe("War Ghoul (102144)", () => {
  it("recruiting burns a chosen ally or retainer you control (fixed at announcement)", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions.push(
      makeAlly("pa0", "Alice", 1, {
        name: "Political Ally",
        attached: [entry("pa0", "Political Ally")],
      }),
    );
    alice.hand.push({ id: "wg1", name: "War Ghoul" });
    const engine = new VtesEngine(state, testRegistry);

    // Both the existing ally and "self" are offered as the burn victim —
    // and the Political Ally is itself a legal recruiter ("any ready
    // minion", p. 22).
    const dp = engine.decision()!;
    const plays = dp.options.filter((o) => o.id.startsWith("play:War Ghoul"));
    expect(plays.map((o) => o.id).sort()).toEqual([
      "play:War Ghoul:basic:V1:pa0:wg1",
      "play:War Ghoul:basic:V1:self:wg1",
      "play:War Ghoul:basic:pa0:pa0:wg1",
      "play:War Ghoul:basic:pa0:self:wg1",
    ]);

    runTrace(engine, [
      ["Alice", "play:War Ghoul:basic:V1:pa0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(alice.pool).toBe(7); // 3 pool
    expect(alice.minions.some((m) => m.id === "wg1")).toBe(true);
    expect(alice.minions.some((m) => m.id === "pa0")).toBe(false); // eaten
  });

  it("rushes vampires only, and its prevention ability caps at 1 per round", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions.push(
      makeAlly("wg0", "Alice", 5, {
        name: "War Ghoul",
        strength: 4,
        attached: [entry("wg0", "War Ghoul")],
      }),
    );
    // Bob also controls an ally — not a legal War Ghoul target.
    state.seats[1]!.minions.push(makeAlly("BA", "Bob", 2));
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    const rushes = dp.options.filter((o) => o.id.startsWith("act:War Ghoul"));
    // Vampires only (Bob's ally BA is not offered); own vampires are
    // legal targets (owner decision — undirected in that case).
    expect(rushes.map((o) => o.id).sort()).toEqual([
      "act:War Ghoul:wg0:M",
      "act:War Ghoul:wg0:N",
      "act:War Ghoul:wg0:V1",
      "act:War Ghoul:wg0:W",
    ]);

    runTrace(engine, [
      ["Alice", "act:War Ghoul:wg0:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → combat
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      // Ghoul takes W's 1: prevent it with the each-round ability.
      ["Alice", "ability:War Ghoul:wg0:prevent"],
      // W takes 4: mends 3, wounded → torpor; combat ends.
      ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(state.seats[0]!.minions.find((m) => m.id === "wg0")!.blood).toBe(5);
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    expect(w.inTorpor).toBe(true);
    expect(state.eventLog.some((e) => e.type === "DamagePrevented")).toBe(true);
  });

  it("locks and burns itself to burn a location, outside combat", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions.push(
      makeAlly("wg0", "Alice", 5, {
        name: "War Ghoul",
        strength: 4,
        attached: [entry("wg0", "War Ghoul")],
      }),
    );
    state.seats[1]!.permanents.push(
      entry("el0", "Elder Library", { statics: { handSize: 1 }, tags: ["location"] }),
    );
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "ability:War Ghoul:wg0:burnloc:el0"]]);

    expect(state.seats[0]!.minions.some((m) => m.id === "wg0")).toBe(false);
    expect(state.seats[1]!.permanents).toHaveLength(0);
  });
});
