/**
 * The §9.4 policy layer: the engine core always generates every decision;
 * the per-seat autoPassWhenOnlyPass toggle (default OFF, per owner
 * decision) is honored by nextDecision() outside the core. Also a first
 * termination check: a full bleed action driven by a pass-everything
 * agent ends, with a bounded number of decisions.
 */

import { describe, expect, it } from "vitest";
import {
  nextDecision,
  PassAgent,
  viewFor,
  VtesEngine,
} from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "./fixtures.ts";

function playOut(engine: VtesEngine): number {
  const agent = new PassAgent();
  let decisions = 0;
  for (let i = 0; i < 10_000; i++) {
    const dp = nextDecision(engine);
    if (!dp) return decisions;
    decisions += 1;
    const choice = agent.decide(dp, dp.options, viewFor(engine.state, dp.seat));
    engine.choose(choice);
  }
  throw new Error("game did not terminate within 10k decisions");
}

describe("auto-pass policy layer (§9.4)", () => {
  it("default off: every seat is asked, even with only Pass available", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    const asked = playOut(engine);
    // PassAgent takes the first option when there is no pass: it bleeds
    // with V1, then passes everything, then ends the phase. With the
    // toggle off, all the no-op passes are surfaced.
    expect(asked).toBeGreaterThan(8);
    const resolved = state.eventLog.find((e) => e.type === "ActionResolved");
    expect(resolved).toMatchObject({ success: true });
  });

  it("toggled on: pass-only decisions are answered silently", () => {
    const askedWithoutToggle = playOut(
      new VtesEngine(threeSeatGame(), testRegistry),
    );

    const state = threeSeatGame();
    for (const seat of state.seats) seat.autoPassWhenOnlyPass = true;
    const engine = new VtesEngine(state, testRegistry);
    const asked = playOut(engine);

    expect(asked).toBeLessThan(askedWithoutToggle);
    // The auto-passes still went through choose(): the command log keeps
    // the full record for replay either way.
    expect(state.commandLog.length).toBeGreaterThanOrEqual(askedWithoutToggle);
    // The game reached the same outcome.
    const resolved = state.eventLog.find((e) => e.type === "ActionResolved");
    expect(resolved).toMatchObject({ success: true });
  });
});
