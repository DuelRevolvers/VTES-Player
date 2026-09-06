/**
 * Kernel invariants for rush actions (docs/rush-actions-design.md):
 * minion-targeted actions, derived directedness, blocked-rush behavior,
 * and the per-copy per-turn limit — engine behaviors, driven through the
 * simplest granting card (Twisted Bloodhound).
 */

import { describe, expect, it } from "vitest";
import type { PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "./fixtures.ts";

function hound(id: string): PermanentInPlay {
  return {
    card: { id, name: "Twisted Bloodhound" },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["ghoul"],
    life: 3,
  };
}

describe("rush at another Methuselah's minion", () => {
  it("is directed: only the target's controller may block; the target does not lock", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.attached.push(hound("tb1"));
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    const rushIds = dp.options.filter((o) => o.id.startsWith("act:Twisted Bloodhound"));
    // Targets: W, M, N — never the acting minion itself.
    expect(rushIds.map((o) => o.id).sort()).toEqual([
      "act:Twisted Bloodhound:tb1:M",
      "act:Twisted Bloodhound:tb1:N",
      "act:Twisted Bloodhound:tb1:W",
    ]);

    runTrace(engine, [
      ["Alice", "act:Twisted Bloodhound:tb1:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], // A: Bob (the target) declines
    ]);

    // Carol is not the target: no block options for her.
    const carol = engine.decision()!;
    expect(carol.seat).toBe("Carol");
    expect(carol.options.some((o) => o.id.startsWith("block:"))).toBe(false);

    runTrace(engine, [
      ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
      // Combat V1 vs W begins on success.
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      ["Alice", "pass"], ["Bob", "pass"], // damage: 1 each
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    const began = state.eventLog.find((e) => e.type === "CombatBegan")!;
    expect(began).toMatchObject({ acting: "V1", opposing: "W" });
    const announced = state.eventLog.find((e) => e.type === "ActionAnnounced")!;
    expect(announced).toMatchObject({ target: "Bob", directed: true });
    // The rusher locked at announcement; the rush target never locks.
    expect(state.seats[0]!.minions[0]!.locked).toBe(true);
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    expect(w.locked).toBe(false);
    // Per-minion per-copy per-turn use recorded (p. 20).
    expect(state.seats[0]!.minions[0]!.attached[0]!.grantedActionUses).toEqual([
      { minion: "V1", key: "enterCombat" },
    ]);
  });

  it("rushing your own minion is undirected: prey and predator may block", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions.push(makeMinion("V2", "Alice"));
    alice.minions[0]!.attached.push(hound("tb1"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "act:Twisted Bloodhound:tb1:V2"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
    ]);

    const announced = state.eventLog.find((e) => e.type === "ActionAnnounced")!;
    expect(announced).toMatchObject({ target: null, directed: false });
    // Bob (the prey, not the target) may block an undirected action.
    const bob = engine.decision()!;
    expect(bob.seat).toBe("Bob");
    expect(bob.options.some((o) => o.id === "block:W")).toBe(true);
  });

  it("a blocked rush fights the blocker; the intended target is untouched", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.attached.push(hound("tb1"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "act:Twisted Bloodhound:tb1:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"], // Bob blocks with the OTHER minion
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // attempt → success
      // Combat is V1 vs M (the blocker), not W.
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const combats = state.eventLog.filter((e) => e.type === "CombatBegan");
    expect(combats).toHaveLength(1);
    expect(combats[0]).toMatchObject({ acting: "V1", opposing: "M" });
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    expect(w.blood).toBe(3); // untouched
    expect(
      state.eventLog.find((e) => e.type === "ActionResolved"),
    ).toMatchObject({ success: false });
    // The copy is still spent for that minion this turn (p. 20: even if
    // it unlocks).
    expect(state.seats[0]!.minions[0]!.attached[0]!.grantedActionUses).toEqual([
      { minion: "V1", key: "enterCombat" },
    ]);
  });
});
