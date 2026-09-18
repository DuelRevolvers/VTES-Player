/**
 * Reactions that read the ACTING minion
 * (docs/acting-minion-reactions-design.md).
 *
 * Banner of Neutrality (100132), Keep it Simple (101038), Nest of Eagles
 * (101274), Venetian Conference (102105).
 *
 * Every `requires*` on a spec asks about the vampire PLAYING the card.
 * These four ask about the one being played against, so most of what is
 * worth pinning is the negative space: the option that must NOT appear.
 */

import { describe, expect, it } from "vitest";
import type { ActionFrame, GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, currentBleed } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function action(state: GameState): ActionFrame {
  const af = state.frames.find((f) => f.kind === "action");
  if (af?.kind !== "action") throw new Error("no action");
  return af;
}

/** Alice's V1 bleeds Bob; stops in state C, with Bob to answer. */
function bleedDeclined(
  card: string,
  v1: Partial<MinionState> = {},
  m: Partial<MinionState> = {},
): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 4, ...v1 });
  // The reacting minion carries the card's printed clan icon (p. 10).
  Object.assign(find(state, "M"), { blood: 4, clan: testRegistry[card]?.requiresClans?.()?.[0] ?? null, ...m });
  state.seats[1]!.hand.push({ id: "c1", name: card });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  for (let i = 0; i < 4; i++) {
    const dp = engine.decision();
    if (!dp || dp.seat === "Bob") break;
    runTrace(engine, [[dp.seat, "pass"]]);
  }
  return { state, engine };
}

/**
 * Let a played card finish. A card resolves only after its AS-PLAYED
 * cancel window closes (p. 7), so reading the bleed straight after
 * `runTrace` reads it before the card has done anything — an assertion
 * that would pass just as happily if the effect never arrived.
 */
function settle(engine: VtesEngine): void {
  for (let i = 0; i < 8; i++) {
    const dp = engine.decision();
    if (!dp || dp.window !== "card.asPlayed") return;
    runTrace(engine, [[dp.seat, "pass"]]);
  }
}

function offered(engine: VtesEngine, card: string): boolean {
  return (engine.decision()?.options ?? []).some((o) => o.id.startsWith(`play:${card}:`));
}

// ---------------------------------------------------------------------------

describe("Banner of Neutrality (100132)", () => {
  it("NEGATIVE SPACE: an ANARCH bleeding you is not what the card answers", () => {
    const { engine } = bleedDeclined("Banner of Neutrality", { sect: "anarch" }, { sect: "anarch" });
    expect(offered(engine, "Banner of Neutrality")).toBe(false);
  });

  it("…a Camarilla vampire is, and the bleed drops by 1", () => {
    const { state, engine } = bleedDeclined(
      "Banner of Neutrality",
      { sect: "camarilla", bleedAmount: 4 },
      { sect: "anarch" },
    );
    expect(offered(engine, "Banner of Neutrality")).toBe(true);
    const af = action(state);
    runTrace(engine, [["Bob", "play:Banner of Neutrality:basic:M:c1"]]);
    settle(engine);
    expect(currentBleed(state, af)).toBe(3);
  });

  it("NEGATIVE SPACE: and the reactor's own sect still gates it", () => {
    // Requires an Independent or Anarch vampire — a Camarilla reactor
    // cannot play it however right the acting minion is.
    const { engine } = bleedDeclined(
      "Banner of Neutrality",
      { sect: "camarilla" },
      { sect: "camarilla" },
    );
    expect(offered(engine, "Banner of Neutrality")).toBe(false);
  });
});

describe("Nest of Eagles (101274)", () => {
  it("NEGATIVE SPACE: 'Assamite' is the pool's BANU HAQIM, and it is excluded", () => {
    const { engine } = bleedDeclined("Nest of Eagles", { clan: "Banu Haqim" });
    expect(offered(engine, "Nest of Eagles")).toBe(false);
  });

  it("reduces by 1, or by 3 INSTEAD against a small acting minion", () => {
    const big = bleedDeclined("Nest of Eagles", { clan: "Ventrue", capacity: 8, bleedAmount: 4 });
    expect(offered(big.engine, "Nest of Eagles")).toBe(true);
    const bigAf = action(big.state);
    runTrace(big.engine, [["Bob", "play:Nest of Eagles:basic:M:c1"]]);
    settle(big.engine);
    expect(currentBleed(big.state, bigAf)).toBe(3);

    const small = bleedDeclined("Nest of Eagles", { clan: "Ventrue", capacity: 5, bleedAmount: 4 });
    const smallAf = action(small.state);
    runTrace(small.engine, [["Bob", "play:Nest of Eagles:basic:M:c1"]]);
    settle(small.engine);
    expect(currentBleed(small.state, smallAf)).toBe(1);
  });
});

describe("Keep it Simple (101038)", () => {
  it("NEGATIVE SPACE: not offered against a bleed with no stealth — it would reduce nothing", () => {
    const { engine } = bleedDeclined("Keep it Simple");
    expect(offered(engine, "Keep it Simple")).toBe(false);
  });

  it("reduces by the acting minion's stealth, read when it is played", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 4, bleedAmount: 4 });
    Object.assign(find(state, "M"), { blood: 4 });
    // Stealth from a card in play, which `currentStealth` folds in
    // alongside the modifiers played during the action.
    find(state, "V1").attached.push({
      card: { id: "cloak", name: "Double Deuce" },
      locked: false,
      usedThisPhase: false,
      statics: { stealth: 2 },
      tags: [],
    });
    state.seats[1]!.hand.push({ id: "c1", name: "Keep it Simple" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    for (let i = 0; i < 4; i++) {
      const dp = engine.decision();
      if (!dp || dp.seat === "Bob") break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(offered(engine, "Keep it Simple")).toBe(true);
    const af = action(state);
    runTrace(engine, [["Bob", "play:Keep it Simple:basic:M:c1"]]);
    settle(engine);
    expect(currentBleed(state, af)).toBe(2);
  });
});

describe("Venetian Conference (102105)", () => {
  it("NEGATIVE SPACE: nothing to offer while a SABBAT vampire is acting", () => {
    const { engine } = bleedDeclined("Venetian Conference", { sect: "sabbat" });
    expect(offered(engine, "Venetian Conference")).toBe(false);
  });
});
