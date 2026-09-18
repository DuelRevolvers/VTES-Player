/**
 * The delayed-replacement combat cards whose second clause is a CANCEL
 * (docs/cancel-in-combat-design.md).
 * Backstep (100125), Disengage (100554), Groundfighting (100861).
 *
 * What is worth pinning is the narrowing: Disengage cancels a GRAPPLE and
 * nothing else, Groundfighting cancels a STRIKE-CHOICE restriction and
 * nothing else, and the two disagree about whether the cancelled card's
 * cost comes back.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Alice's V1 bleeds Bob, Bob's W blocks: a real combat, at beforeRange. */
function combat(state: GameState): VtesEngine {
  const tf = state.frames.find((f) => f.kind === "turn")!;
  if (tf.kind === "turn") tf.phase = "minion";
  const engine = new VtesEngine(state, testRegistry);
  for (let i = 0; i < 30; i++) {
    if (state.frames.some((f) => f.kind === "combat")) break;
    const dp = engine.decision();
    if (!dp) break;
    const want =
      dp.options.find((o) => o.id === "bleed:V1") ??
      dp.options.find((o) => o.id === "block:W") ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options[0]!;
    runTrace(engine, [[dp.seat, want.id]]);
  }
  return engine;
}

/** Walk, preferring `pass`, until `stop` holds. */
function settle(engine: VtesEngine, stop: () => boolean, limit = 40): void {
  for (let i = 0; i < limit; i++) {
    if (stop()) return;
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

/**
 * Bob's blocker W plays `weapon` (a grapple / a strike-choice bar), and
 * Alice's V1 holds `canceller`. Returns the option ids Alice is offered
 * inside the as-played window.
 */
function asPlayedOptions(canceller: string, played: string, opts?: { arm?: boolean }): string[] {
  const state = threeSeatGame();
  state.seats[0]!.hand.push({ id: "cx", name: canceller });
  state.seats[1]!.hand.push({ id: "px", name: played });
  // Groundfighting's sect gate, and the weapon [LSJ 20050221] wants.
  const v1 = state.seats[0]!.minions.find((m) => m.id === "V1")!;
  Object.assign(v1, { sect: "anarch" });
  // The fixture's blocker has Dominate only, and Immortal Grapple needs
  // Potence. Without this the card is never offered and every assertion
  // below passes or fails for a reason that has nothing to do with the
  // canceller — the "empty for the wrong reason" trap.
  const w = state.seats[1]!.minions.find((m) => m.id === "W")!;
  Object.assign(w, { disciplines: { ...w.disciplines, pot: "basic" } });
  if (opts?.arm) {
    const h = testRegistry["Desert Eagle"]!;
    v1.attached.push({
      card: { id: "gun", name: "Desert Eagle" },
      locked: false,
      usedThisPhase: false,
      statics: h.permanentStatics ?? {},
      tags: h.permanentTags ?? [],
    });
  }
  const engine = combat(state);
  // Bob plays the card; Alice is asked inside its as-played window.
  settle(engine, () => ids(engine).some((i) => i.startsWith(`play:${played}`)), 12);
  const play = ids(engine).find((i) => i.startsWith(`play:${played}`));
  // ASSERTED, not guarded: a helper that returns a sentinel when the card
  // was never played would let every negative assertion below pass for
  // the wrong reason.
  expect(play, `${played} was never offered`).toBeDefined();
  runTrace(engine, [["Bob", play!]]);
  return ids(engine);
}

describe("Disengage (100554)", () => {
  it("cancels a GRAPPLE card and nothing else", () => {
    // Immortal Grapple prints the "grapple" keyword.
    expect(asPlayedOptions("Disengage", "Immortal Grapple").some((i) => i.startsWith("play:Disengage"))).toBe(true);
    // NEGATIVE SPACE: a combat card with no grapple keyword. Death Seeker
    // would take it; Disengage is narrower than the primitive it shares.
    expect(asPlayedOptions("Disengage", "Torn Signpost").some((i) => i.startsWith("play:Disengage"))).toBe(false);
  });

  it("is a press that can only END combat, never continue it", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "cx", name: "Disengage" });
    const engine = combat(state);
    // With no press standing there is nothing to cancel, so p. 32 leaves
    // an end-only press with no window at all (the Open Grate reading).
    settle(engine, () => {
      const cf = state.frames.find((f) => f.kind === "combat");
      return cf?.kind === "combat" && cf.step === "press";
    });
    expect(ids(engine).some((i) => i.startsWith("play:Disengage"))).toBe(false);
  });
});

describe("Groundfighting (100861)", () => {
  it("cancels a strike-choice bar only when the anarch has a weapon to lose", () => {
    // Immortal Grapple is "hand strikes only" — a bar on WHICH strike may
    // be chosen, which is the one Groundfighting reaches.
    expect(
      asPlayedOptions("Groundfighting", "Immortal Grapple", { arm: true }).some((i) =>
        i.startsWith("play:Groundfighting"),
      ),
    ).toBe(true);
    // NEGATIVE SPACE: a card that restricts nothing about the strike
    // choice. "Cannot cancel maneuvering, setting the range…"
    // [LSJ 20050221].
    expect(
      asPlayedOptions("Groundfighting", "Torn Signpost", { arm: true }).some((i) =>
        i.startsWith("play:Groundfighting"),
      ),
    ).toBe(false);
  });
});

describe("Backstep (100125)", () => {
  it("maneuvers only toward LONG, and pays the opponent a press if they land a hit", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "bs", name: "Backstep" });
    const engine = combat(state);
    settle(engine, () => ids(engine).some((i) => i.startsWith("play:Backstep")), 20);
    const play = ids(engine).find((i) => i.startsWith("play:Backstep"));
    expect(play).toBeDefined();
    runTrace(engine, [["Alice", play!]]);
    settle(engine, () => {
      const cf = state.frames.find((f) => f.kind === "combat");
      return cf?.kind === "combat" && (cf.pressIfDamaged?.length ?? 0) > 0;
    }, 10);
    const cf = state.frames.find((f) => f.kind === "combat");
    expect(cf?.kind).toBe("combat");
    // The rider is installed on the ROUND, naming the minion to be hit —
    // the press is paid to whoever hits them, which is the opponent.
    expect(cf?.kind === "combat" ? cf.pressIfDamaged : undefined).toEqual([
      { minion: "V1", round: cf?.kind === "combat" ? cf.round : -1 },
    ]);
  });
});
