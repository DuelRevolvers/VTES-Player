/**
 * Deterministic scenario tests for the phase-3 starter cards (required
 * before an id is flipped in config/supported.json). Conditioning and
 * Deflection are covered by the §8.1 trace test; here: On the Qui Vive
 * (wake), Enhanced Senses (intercept "when needed"), Lost in Crowds
 * (stealth "when needed").
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("On the Qui Vive (101321)", () => {
  it("lets a locked vampire wake, then Deflect at basic (locking is a no-op)", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    // Both of Bob's minions are locked — without a wake he can neither
    // block nor react.
    const w = bob.minions.find((m) => m.id === "W")!;
    w.locked = true;
    w.disciplines = { dom: "basic" }; // basic only → Deflection will lock
    bob.minions.find((m) => m.id === "M")!.locked = true;
    bob.hand.push({ id: "q1", name: "On the Qui Vive" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      // Announce window: wake effects are legal even here? No — the
      // announce window is for "as the action is announced" cards; Qui
      // Vive lives in action.effects and card.asPlayed. Everyone passes.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // State A: Alice passes. Bob wakes W (his only play — no block
      // options exist while everything is locked).
      ["Alice", "pass"],
      ["Bob", "play:On the Qui Vive"],
      // as-played window of the wake itself.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Impulse rewinds to Alice. State A again: Bob is now able to
      // block with the woken W — he declines instead (sticky).
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // State C: Alice passes; Bob Deflects with the woken, still-locked
      // W at basic — legal thanks to the wake; the lock is a no-op
      // (ruling p. 48).
      ["Alice", "pass"],
      ["Bob", "play:Deflection:basic"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Target changed to Carol → state A reopens for her; she declines.
      ["Alice", "pass"],
      ["Carol", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Carol", "pass"],
      ["Bob", "pass"],
    ]);

    expect(state.eventLog.some((e) => e.type === "MinionWoke")).toBe(true);
    expect(state.seats[2]!.pool).toBe(9); // Carol ate the bleed
    expect(w.locked).toBe(true); // still locked; wake ≠ unlock
    expect(w.blood).toBe(2); // paid 1 for Deflection (Qui Vive is free)
  });

  it("cannot be played by an unlocked minion, and only once between unlocks", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    bob.hand.push({ id: "q1", name: "On the Qui Vive" });
    bob.hand.push({ id: "q2", name: "On the Qui Vive" });
    const w = bob.minions.find((m) => m.id === "W")!;
    w.locked = true;
    // M stays unlocked: Qui Vive must not be offered for M.
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
    ]);

    let dp = engine.decision()!;
    const quiViveIds = dp.options.filter((o) => o.id.startsWith("play:On the Qui Vive"));
    // Offered only for the locked W (two copies in hand → two options for
    // W, none for the unlocked M).
    expect(quiViveIds).toHaveLength(2);
    expect(quiViveIds.every((o) => o.kind === "playCard" && o.minion === "W")).toBe(true);

    runTrace(engine, [
      ["Bob", "play:On the Qui Vive"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
    ]);

    // W woke once this unlock-to-unlock span: the second copy is illegal.
    dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("play:On the Qui Vive"))).toBe(false);
  });
});

describe("Enhanced Senses (100644)", () => {
  it("adds intercept only when needed, letting a block catch a hunt's stealth", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    const m = bob.minions.find((x) => x.id === "M")!;
    m.disciplines = { aus: "basic" };
    bob.hand.push({ id: "es1", name: "Enhanced Senses" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      // Hunt: undirected, +1 inherent stealth.
      ["Alice", "hunt:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
    ]);

    // State A, Bob's impulse: no block attempt yet → intercept is not
    // "needed" → Enhanced Senses must NOT be offered.
    let dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("play:Enhanced Senses"))).toBe(false);

    runTrace(engine, [
      ["Bob", "block:M"],
      // State B: Alice first (nothing to add), then Bob — now stealth 1 >
      // intercept 0, so Enhanced Senses is legal, for the blocker M only.
      ["Alice", "pass"],
      ["Bob", "play:Enhanced Senses:basic"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Impulse rewound to Alice; intercept 1 ≥ stealth 1 now — Alice
      // could add stealth "when needed" but has none. Quiescence resolves
      // the attempt: blocked.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    expect(state.eventLog.some((e) => e.type === "BlockSucceeded")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "CombatBegan")).toBe(true);
    expect(m.locked).toBe(true);
  });
});

describe("Lost in Crowds (101125)", () => {
  it("adds stealth only when needed, making a pending block fail", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { dom: "basic", obf: "basic" };
    state.seats[0]!.hand.push({ id: "lic1", name: "Lost in Crowds" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    // State A, Alice's impulse: no block attempt → stealth is not
    // "needed" → Lost in Crowds must NOT be offered.
    let dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id.startsWith("play:Lost in Crowds"))).toBe(false);

    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "block:M"],
      // State B: intercept 0 ≥ stealth 0 → the block is pending success →
      // stealth IS needed now. Alice plays Lost in Crowds.
      ["Alice", "play:Lost in Crowds:basic"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Stealth 1 > intercept 0: Bob would need intercept but has none.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Attempt fails → state A. Bob declines for good; Carol not
      // eligible (directed at Bob).
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // State C → resolve.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    expect(state.eventLog.some((e) => e.type === "BlockFailed")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "CombatBegan")).toBe(false);
    expect(state.seats[1]!.pool).toBe(9); // the bleed landed on Bob
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    expect(m.locked).toBe(false); // failed attempts don't lock
  });
});
