/**
 * Scenario test for design trace §8.2: a blocked action into a full combat
 * round (seven steps, hand strikes, no maneuvers/presses).
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "./fixtures.ts";

describe("trace 8.2 — blocked action into a full combat round", () => {
  it("plays out exactly as the design document specifies", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      // Alice announces: V1 bleeds Bob. V1 locks.
      ["Alice", "bleed:V1"],
      // action.announce window.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // State A: Alice passes, Bob declares a block with M.
      ["Alice", "pass"],
      ["Bob", "block:M"],
      // State B: one impulse cycle; nobody has stealth/intercept cards.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Quiescence → intercept 0 ≥ stealth 0 → block succeeds: M locks,
      // combat begins. Round 1, step 1: Before Range.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Step 2: Determine Range — acting side first, both decline.
      ["Alice", "pass"],
      ["Bob", "pass"],
      // Step 3: Before Strikes.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Step 4: Strike — acting minion chooses first, then opponent.
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
      // Step 5: Damage Resolution — acting minion's damage first: each
      // declines prevention, mends 1 blood.
      ["Alice", "pass"],
      ["Bob", "pass"],
      // Step 6: Press — acting side first, both decline.
      ["Alice", "pass"],
      ["Bob", "pass"],
      // Step 7: End of Round — no continuation → combat ends, blocked
      // action fails.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    // Back in Alice's minion phase; V1 is locked, so ending is her only move.
    const after = engine.decision()!;
    expect(after.seat).toBe("Alice");
    expect(after.window).toBe("turn.minion");
    expect(after.options.map((o) => o.id)).toEqual(["end"]);

    const [alice, bob, carol] = state.seats;
    const v1 = alice!.minions.find((m) => m.id === "V1")!;
    const m = bob!.minions.find((x) => x.id === "M")!;

    // Both combatants burned 1 blood mending a hand strike.
    expect(v1.blood).toBe(1);
    expect(m.blood).toBe(1);
    expect(v1.inTorpor).toBe(false);
    expect(m.inTorpor).toBe(false);

    // Acting minion locked at announcement; blocker locked on success.
    expect(v1.locked).toBe(true);
    expect(m.locked).toBe(true);

    // Blocked action: no pool lost anywhere, no Edge.
    expect(alice!.pool).toBe(10);
    expect(bob!.pool).toBe(10);
    expect(carol!.pool).toBe(10);
    expect(state.edge).toBeNull();

    // The event log tells the story.
    const range = state.eventLog.find((e) => e.type === "RangeSet")!;
    expect(range).toMatchObject({ range: "close" });
    const ended = state.eventLog.find((e) => e.type === "CombatEnded")!;
    expect(ended).toMatchObject({ rounds: 1 });
    const resolved = state.eventLog.find((e) => e.type === "ActionResolved")!;
    expect(resolved).toMatchObject({ success: false });
    expect(state.eventLog.map((e) => e.type)).toContain("BlockSucceeded");
  });
});
