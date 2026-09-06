/**
 * Scenario test for design trace §8.1: a modified bleed with a Deflection
 * redirect. Every decision the engine generates is scripted explicitly —
 * this test IS the trace table, un-elided, so any sequencing change that
 * alters who is asked (or when) fails loudly here.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "./fixtures.ts";

describe("trace 8.1 — modified bleed with Deflection redirect", () => {
  it("plays out exactly as the design document specifies", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      // Alice announces: V1 bleeds her prey Bob (directed). V1 locks.
      ["Alice", "bleed:V1"],
      // action.announce window — impulse cycle [Alice, Bob, Carol].
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // State A. Alice holds Conditioning back (FAQ p. 46). Bob's pass is
      // the sticky decline; Carol isn't eligible (directed at Bob).
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // State C. The acting Methuselah has the impulse first — now she
      // pumps the bleed.
      ["Alice", "play:Conditioning"],
      // as-played window for Conditioning (cancels/wakes only — none).
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Effect resolved → impulse rewinds to Alice (p. 8).
      ["Alice", "pass"],
      // Bob has declined blocks → Deflection is now legal. W has superior
      // Dominate so both modes are offered (p. 6); he uses superior. The
      // only legal redirect target is Carol (not the acting controller).
      ["Bob", "play:Deflection:superior"],
      // as-played window for Deflection.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Target changed Bob → Carol: back to state A, blocks reopened,
      // new sequencing order [Alice, Carol, Bob] (defender first).
      ["Alice", "pass"],
      ["Carol", "pass"], // Carol's sticky decline
      ["Bob", "pass"],
      // State C again; everyone passes → the action resolves.
      ["Alice", "pass"],
      ["Carol", "pass"],
      ["Bob", "pass"],
    ]);

    // Back in Alice's minion phase; V1 is locked, so ending is her only move.
    const after = engine.decision()!;
    expect(after.seat).toBe("Alice");
    expect(after.window).toBe("turn.minion");
    expect(after.options.map((o) => o.id)).toEqual(["end"]);

    // Carol was bled for 3 (base 1 + Conditioning basic +2).
    const carol = state.seats.find((s) => s.id === "Carol")!;
    expect(carol.pool).toBe(7);
    const bob = state.seats.find((s) => s.id === "Bob")!;
    expect(bob.pool).toBe(10);

    // Successful bleed ≥ 1 → Alice takes the Edge (even though the final
    // target was not her prey).
    expect(state.edge).toBe("Alice");

    // V1 locked by acting, paid 1 blood for Conditioning.
    const v1 = state.seats[0]!.minions[0]!;
    expect(v1.locked).toBe(true);
    expect(v1.blood).toBe(1);

    // W played superior Deflection: not locked, paid 1 blood.
    const w = bob.minions.find((m) => m.id === "W")!;
    expect(w.locked).toBe(false);
    expect(w.blood).toBe(2);
    expect(bob.hand).toHaveLength(0);

    // Event log tells the story.
    const types = state.eventLog.map((e) => e.type);
    expect(types).toContain("TargetChanged");
    const change = state.eventLog.find((e) => e.type === "TargetChanged")!;
    expect(change).toMatchObject({ from: "Bob", to: "Carol" });
    const resolved = state.eventLog.find((e) => e.type === "ActionResolved")!;
    expect(resolved).toMatchObject({ success: true });
    expect(types).not.toContain("BlockDeclared");
  });

  it("does not offer Deflection before its Methuselah declines blocks", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // State A, Alice passes; now it's Bob — he has NOT declined yet.
      ["Alice", "pass"],
    ]);

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    // Bob may block or pass, but Deflection is not yet legal ("after
    // blocks are declined").
    expect(dp.options.some((o) => o.id.startsWith("play:Deflection"))).toBe(false);
    expect(dp.options.some((o) => o.id === "block:W" || o.id === "block:M")).toBe(true);
  });
});
