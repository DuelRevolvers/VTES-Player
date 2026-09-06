/**
 * Influence phase (transfers, crypt draw, influencing out — rulebook
 * p. 35–36) and the leave-torpor action (p. 24), including the no-combat
 * rule when a leave-torpor is blocked.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "./fixtures.ts";

describe("influence phase", () => {
  it("spends transfers, draws from the crypt, and influences a vampire out", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    // Turn 4+ → full 4 transfers. X needs 1 more counter to reach capacity.
    const frame = state.frames[0]!;
    if (frame.kind !== "turn") throw new Error("fixture");
    frame.turnNumber = 4;
    alice.uncontrolled.push({
      card: makeMinion("X", "Alice", { blood: 0, capacity: 2 }),
      counters: 1,
    });
    alice.crypt.push(makeMinion("Y", "Alice", { blood: 0, capacity: 3 }));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      // Skip straight through the minion phase.
      ["Alice", "end"],
      // Influence: 4 transfers granted. Move 1 pool onto X (1 transfer).
      ["Alice", "inf:add:X"],
      // X now has counters ≥ capacity → may enter play (free).
      ["Alice", "inf:out:X"],
    ]);

    // X is in play: unlocked, blood = capacity (2), Alice paid 1 pool.
    const x = alice.minions.find((m) => m.id === "X")!;
    expect(x.blood).toBe(2);
    expect(x.locked).toBe(false);
    expect(alice.uncontrolled).toHaveLength(0);
    expect(alice.pool).toBe(9);

    // 3 transfers left: not enough for a crypt draw (4 needed) — the
    // option must be gone; taking a counter back (2) is impossible with
    // nothing uncontrolled.
    const dp = engine.decision()!;
    expect(dp.window).toBe("turn.influence");
    expect(dp.options.map((o) => o.id)).toEqual(["pass"]);
  });

  it("crypt draw costs 4 transfers and 1 pool, and turn-1 grants only 1 transfer", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.crypt.push(makeMinion("Y", "Alice", { blood: 0, capacity: 3 }));
    const engine = new VtesEngine(state, testRegistry);

    // Turn 1 → only 1 transfer → no crypt draw offered.
    runTrace(engine, [["Alice", "end"]]);
    const dp = engine.decision()!;
    expect(dp.window).toBe("turn.influence");
    expect(dp.options.some((o) => o.id === "inf:crypt")).toBe(false);

    // Fast-forward: a later turn with 4 transfers.
    const state2 = threeSeatGame();
    const alice2 = state2.seats[0]!;
    const frame2 = state2.frames[0]!;
    if (frame2.kind !== "turn") throw new Error("fixture");
    frame2.turnNumber = 5;
    alice2.crypt.push(makeMinion("Y", "Alice", { blood: 0, capacity: 3 }));
    const engine2 = new VtesEngine(state2, testRegistry);
    runTrace(engine2, [
      ["Alice", "end"],
      ["Alice", "inf:crypt"],
    ]);
    expect(alice2.pool).toBe(9); // burned 1 pool
    expect(alice2.crypt).toHaveLength(0);
    expect(alice2.uncontrolled).toHaveLength(1);
    expect(alice2.uncontrolled[0]!.card.id).toBe("Y");
    expect(alice2.uncontrolled[0]!.counters).toBe(0);
    // All 4 transfers spent → only pass remains.
    const dp2 = engine2.decision()!;
    expect(dp2.options.map((o) => o.id)).toEqual(["pass"]);
  });
});

describe("leave torpor", () => {
  it("succeeds unblocked: 2 blood paid at resolution, vampire is ready again", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.inTorpor = true;
    v1.blood = 3;
    const engine = new VtesEngine(state, testRegistry);

    // A torpored vampire's only action is leave torpor.
    const dp = engine.decision()!;
    expect(dp.options.map((o) => o.id)).toEqual(["leave:V1", "end"]);

    runTrace(engine, [
      ["Alice", "leave:V1"],
      // Undirected: announce cycle [Alice, prey Bob, predator Carol].
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // State A: both prey and predator decline (stealth 1 anyway).
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // State C: everyone passes → resolves.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    expect(v1.inTorpor).toBe(false);
    expect(v1.blood).toBe(1); // paid 2 at resolution
    expect(v1.locked).toBe(true); // locked by taking the action
  });

  it("blocked: no combat, no cost, the vampire stays in torpor", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.inTorpor = true;
    v1.blood = 3;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "leave:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // State A: Alice passes; Bob blocks with M. Intercept 0 vs stealth
      // 1 (inherent) → pending failure... M has no intercept, so Bob
      // concedes and Carol blocks with N? No — nobody has intercept
      // cards, so a block cannot beat stealth 1. Bob's attempt will fail.
      ["Alice", "pass"],
      ["Bob", "block:M"],
      // State B cycle: nobody can add anything.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Attempt fails (intercept 0 < stealth 1) → back to A. Bob has not
      // declined; he declines now, Carol too.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // State C → resolves successfully despite the failed block.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    // The failed block did not lock M and did not stop the action.
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    expect(m.locked).toBe(false);
    expect(state.eventLog.some((e) => e.type === "BlockFailed")).toBe(true);
    expect(v1.inTorpor).toBe(false);

    // Now the true "blocked" case: stealth matched by intercept.
    const state2 = threeSeatGame();
    const v2 = state2.seats[0]!.minions[0]!;
    v2.inTorpor = true;
    v2.blood = 3;
    const engine2 = new VtesEngine(state2, testRegistry);
    runTrace(engine2, [
      ["Alice", "leave:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
    ]);
    // Give M enough intercept via a direct event (a stand-in for the
    // intercept reactions of phase 3).
    const af = engine2.action()!;
    engine2.emit({
      type: "InterceptModified",
      actionId: af.actionId,
      minion: "M",
      delta: 1,
      source: "test",
    });
    runTrace(engine2, [
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Block succeeds; M is a vampire, so Bob is offered the diablerie
      // of the acting torpor vampire (p. 24) — declined here.
      ["Bob", "pass"],
    ]);

    // Block succeeded: M locks, but NO combat happens; the action fails
    // and the cost is never paid (p. 24).
    const m2 = state2.seats[1]!.minions.find((x) => x.id === "M")!;
    expect(m2.locked).toBe(true);
    expect(state2.eventLog.some((e) => e.type === "BlockSucceeded")).toBe(true);
    expect(state2.eventLog.some((e) => e.type === "CombatBegan")).toBe(false);
    expect(v2.inTorpor).toBe(true);
    expect(v2.blood).toBe(3); // cost not paid
    const resolved = state2.eventLog.find((e) => e.type === "ActionResolved")!;
    expect(resolved).toMatchObject({ success: false });
  });
});
