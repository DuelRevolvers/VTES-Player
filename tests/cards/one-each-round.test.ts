/**
 * "A vampire can play only one X each round"
 * (docs/one-each-round-design.md).
 *
 * Death Seeker (100510), Leathery Hide (101082), High Ground (100925) —
 * three combat cards printing the per-VAMPIRE play limit, which the
 * engine had been enforcing per combat FRAME.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function combatFrame(state: GameState): CombatFrame {
  const f = state.frames.find((x) => x.kind === "combat");
  if (f?.kind !== "combat") throw new Error("no combat frame");
  return f;
}

/** Alice's V1 bleeds; Bob's W blocks. A real combat, so the frame is the
 *  engine's own rather than a hand-built one. Both hands hold `card`. */
function combat(card: string): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  find(state, "V1").blood = 5;
  find(state, "W").blood = 5;
  // Both combatants carry the card's printed clan icon (p. 10).
  const clan = testRegistry[card]?.requiresClans?.()?.[0] ?? null;
  find(state, "V1").clan = clan;
  find(state, "W").clan = clan;
  state.seats[0]!.hand = [{ id: "a1", name: card }];
  state.seats[1]!.hand = [{ id: "b1", name: card }];
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:W"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  return { state, engine };
}

/** Walk to the first decision offering `prefix`, preferring to pass. */
function walkTo(engine: VtesEngine, prefix: string, limit = 40): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
  }
  return false;
}

// ---------------------------------------------------------------------------
// §1 — the limit is per VAMPIRE
// ---------------------------------------------------------------------------

describe("`a vampire can play only one X each round` (§1)", () => {
  it("bars the vampire who played it, and NOT the one who did not", () => {
    const { state, engine } = combat("Leathery Hide");
    const cf = combatFrame(state);
    // W has played one this round; V1 has not. The OLD gate read the
    // frame-wide name list below and would have barred V1 too.
    cf.playedHistory = [{ name: "Leathery Hide", minion: "W", round: cf.round }];
    cf.playedThisRound = ["Leathery Hide"];
    expect(walkTo(engine, "play:Leathery Hide")).toBe(true);
  });

  it("NEGATIVE SPACE: the same vampire cannot play a second one this round", () => {
    const { state, engine } = combat("Leathery Hide");
    const cf = combatFrame(state);
    cf.playedHistory = [
      { name: "Leathery Hide", minion: "V1", round: cf.round },
      { name: "Leathery Hide", minion: "W", round: cf.round },
    ];
    expect(walkTo(engine, "play:Leathery Hide")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §2 — Death Seeker cancels any combat card, not only a strike
// ---------------------------------------------------------------------------

describe("Death Seeker (100510)", () => {
  it("is offered as the opposing minion plays a combat card", () => {
    const state = threeSeatGame();
    find(state, "V1").blood = 5;
    find(state, "W").blood = 5;
    // Alice plays a non-strike combat card; Bob answers with Death Seeker.
    state.seats[0]!.hand = [{ id: "a1", name: "Leathery Hide" }];
    state.seats[1]!.hand = [{ id: "b1", name: "Death Seeker" }];
    // Each side carries its card's printed clan icon (p. 10).
    find(state, "V1").clan = "Gangrel antitribu";
    find(state, "W").clan = "Salubri antitribu";
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walkTo(engine, "play:Leathery Hide")).toBe(true);
    const hide = ids(engine).find((i) => i.startsWith("play:Leathery Hide"))!;
    runTrace(engine, [["Alice", hide]]);
    // The as-played window belongs to everyone else; Bob may cancel.
    expect(walkTo(engine, "play:Death Seeker", 6)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §3 — High Ground's two clauses
// ---------------------------------------------------------------------------

describe("High Ground (100925)", () => {
  function withFlight(state: GameState, id: string): void {
    find(state, id).attached.push({
      card: { id: `w-${id}`, name: "wings" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["flight"],
    });
  }

  it("the set-range clause needs flight the opposing minion lacks", () => {
    // Nobody flies: the card first appears at the RANGE step, as a
    // maneuver — the before-range window offers nothing.
    const plain = combat("High Ground");
    expect(walkTo(plain.engine, "play:High Ground")).toBe(true);
    expect(combatFrame(plain.state).step).toBe("range");

    // V1 flies and W does not: now it appears a step earlier, which is
    // the set-range clause and not the maneuver.
    const state = threeSeatGame();
    find(state, "V1").blood = 5;
    find(state, "W").blood = 5;
    state.seats[0]!.hand = [{ id: "a1", name: "High Ground" }];
    withFlight(state, "V1");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:W"],
    ]);
    expect(walkTo(engine, "play:High Ground")).toBe(true);
    expect(combatFrame(state).step).toBe("beforeRange");
  });

  it("NEGATIVE SPACE: no maneuver to long once the range IS long", () => {
    const { state, engine } = combat("High Ground");
    expect(walkTo(engine, "play:High Ground")).toBe(true);
    combatFrame(state).range = "long";
    expect(ids(engine).some((i) => i.startsWith("play:High Ground"))).toBe(false);
  });
});
