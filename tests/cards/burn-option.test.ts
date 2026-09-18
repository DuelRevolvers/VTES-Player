/**
 * The burn option icon (p. 17), built for Sight Beyond Sight (101745)
 * (docs/burn-option-design.md): a Methuselah who controls no minion
 * meeting the card's requirements may discard it during ANY Methuselah's
 * unlock phase and replace it, once per Methuselah per unlock phase.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function unlockPhase(aliceClan: string | null): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = "unlock";
    tf.unlockDone = false;
    tf.unlockAbilitiesDone = false;
    tf.edgeDone = true;
  }
  state.seats[0]!.minions[0]!.clan = aliceClan;
  state.seats[0]!.hand = [
    { id: "sbs", name: "Sight Beyond Sight" },
    { id: "sbs2", name: "Sight Beyond Sight" },
  ];
  state.seats[0]!.library = [{ id: "lib1", name: "Conditioning" }];
  state.seats[1]!.hand = [{ id: "bsbs", name: "Sight Beyond Sight" }];
  return state;
}

function ids(engine: VtesEngine): string[] {
  return (engine.decision()?.options ?? []).map((o) => o.id);
}

describe("the burn option (p. 17) — Sight Beyond Sight", () => {
  it("discards and replaces, once per Methuselah, in the turn seat's phase AND another's", () => {
    const state = unlockPhase(null);
    const engine = new VtesEngine(state, testRegistry);
    let dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(dp.window).toBe("turn.unlock");
    expect(ids(engine)).toEqual(expect.arrayContaining(["burnOption:sbs", "burnOption:sbs2"]));

    runTrace(engine, [["Alice", "burnOption:sbs"]]);
    const hand = state.seats[0]!.hand.map((c) => c.id);
    expect(hand).not.toContain("sbs");
    expect(hand).toContain("lib1"); // replaced (p. 7)
    // "…limited to one such discard each unlock phase."
    expect(ids(engine).some((o) => o.startsWith("burnOption:"))).toBe(false);

    // Bob, in ALICE's unlock phase, gets his own discard.
    runTrace(engine, [["Alice", "pass"]]);
    dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(ids(engine)).toContain("burnOption:bsbs");
    runTrace(engine, [["Bob", "burnOption:bsbs"]]);
    expect(state.seats[1]!.hand.some((c) => c.id === "bsbs")).toBe(false);
    expect(state.eventLog.filter((e) => e.type === "CardDiscarded").length).toBe(2);
  });

  it("NEGATIVE SPACE: not offered while a Salubri is controlled", () => {
    const state = unlockPhase("Salubri");
    const engine = new VtesEngine(state, testRegistry);
    // Alice controls a Salubri, so her copies stay; Bob's is still offered.
    for (let i = 0; i < 4; i++) {
      const dp = engine.decision();
      if (!dp) break;
      expect(dp.options.some((o) => o.id === "burnOption:sbs" || o.id === "burnOption:sbs2")).toBe(false);
      if (dp.seat === "Bob") {
        expect(dp.options.some((o) => o.id === "burnOption:bsbs")).toBe(true);
        return;
      }
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    throw new Error("Bob was never asked");
  });
});
