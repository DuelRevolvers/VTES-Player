/**
 * Dual-purpose cards printed as both an action modifier and a combat card
 * (docs/modifier-or-combat-design.md): Swallowed by the Night (101913),
 * Rapid Change (101542), Swift Cover (102342), Resist Earth's Grasp
 * (101610) and Form of the Cobra (102224). Each *mode* is one or the
 * other, so the spec splits by mode and each half is compiled by the
 * compiler that already knows its rules.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { currentStealth, VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Alice's V1 with the named discipline and blood, holding `card`. */
function game(disc: Record<string, "basic" | "superior">, card: string): GameState {
  const state = threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, { disciplines: disc, blood: 4 });
  state.seats[1]!.minions.find((m) => m.id === "M")!.blood = 3;
  state.seats[0]!.hand.push({ id: "c", name: card });
  return state;
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Bleed, then M blocks → combat at Before Range. */
function enterCombat(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"],
    ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
}

const actionId = (state: GameState): string => {
  const af = [...state.frames].reverse().find((f) => f.kind === "action");
  if (!af || af.kind !== "action") throw new Error("no action frame");
  return af.actionId;
};

describe("Swallowed by the Night (101913)", () => {
  it("is a stealth modifier at inferior, in the action's effect window", () => {
    const state = game({ obf: "basic" }, "Swallowed by the Night");
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"], // stealth is "needed" only once a block is up
      ["Alice", "play:Swallowed by the Night:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);

    expect(currentStealth(state, actionId(state))).toBe(1);
  });

  it("is a maneuver at superior, in combat", () => {
    const state = game({ obf: "superior" }, "Swallowed by the Night");
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "play:Swallowed by the Night:superior"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);

    const cf = state.frames.find((f) => f.kind === "combat");
    expect(cf?.kind === "combat" && cf.range).toBe("long");
  });
});

describe("Rapid Change (101542)", () => {
  it("ends the combat as a superior strike", () => {
    const state = game({ pro: "superior" }, "Rapid Change");
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range → close
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "play:Rapid Change:superior"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Bob", "strike:hand"],
      // "Strike: combat ends" resolves before all other strikes (p. 33),
      // so no damage lands and the End of Round step runs.
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(find(state, "M").blood).toBe(3); // untouched
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
  });
});

describe("Swift Cover (102342)", () => {
  it("dodges at inferior with either discipline", () => {
    const state = game({ obf: "basic" }, "Swift Cover");
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range → close
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "play:Swift Cover:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Bob", "strike:hand"],
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    // A dodge takes no damage and deals none.
    expect(find(state, "V1").blood).toBe(4);
    expect(find(state, "M").blood).toBe(3);
  });
});

describe("Resist Earth's Grasp (101610)", () => {
  it("offers both printed variants of its inferior combat mode", () => {
    const state = game({ cel: "basic" }, "Resist Earth's Grasp");
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    const range = engine.decision()!;
    // The maneuver variant lives in the range step…
    expect(
      range.options.some((o) => o.id.startsWith("play:Resist Earth's Grasp:basic:V1:maneuver")),
    ).toBe(true);
    expect(range.options.some((o) => o.id.includes(":press"))).toBe(false);
  });

  it("is a stealth modifier at superior", () => {
    const state = game({ cel: "superior" }, "Resist Earth's Grasp");
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "play:Resist Earth's Grasp:superior"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(currentStealth(state, actionId(state))).toBe(1);
    expect(find(state, "V1").blood).toBe(3); // 1 blood cost
  });
});

describe("Form of the Cobra (102224)", () => {
  it("gives stealth even when no block is up yet", () => {
    const state = game({ pro: "superior" }, "Form of the Cobra");
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      // No block attempt is underway, so the p. 26 "only when needed"
      // gate would normally hide a stealth modifier.
      ["Alice", "play:Form of the Cobra:superior"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);

    expect(currentStealth(state, actionId(state))).toBe(1);
  });

  it("steals blood as an inferior strike", () => {
    const state = game({ pro: "basic" }, "Form of the Cobra");
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range → close
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "play:Form of the Cobra:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Bob", "strike:hand"],
      ["Alice", "pass"], // V1 takes M's hand strike
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    // 1 blood moved from M to V1, then V1 mends 1 off M's hand strike.
    expect(find(state, "M").blood).toBe(2);
  });

  it("is offered in exactly one window per mode", () => {
    // The inferior (combat) mode is not on offer during an action…
    const state = game({ pro: "basic" }, "Form of the Cobra");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Form of the Cobra")),
    ).toBe(false);
  });
});
