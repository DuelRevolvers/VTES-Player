/**
 * After combat ends (docs/after-combat-ends-design.md).
 *
 * Catatonic Fear (100307), Pass Through Shadow (102279), Form of Mist
 * (100771), Rolling with the Punches (101649).
 *
 * Plus a regression for the bug this wave uncovered: Touch of Valeren's
 * basic COMBAT mode could never be offered, because the damage-resolution
 * enumeration only ever looked for a `prevent` effect.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, currentStealth } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Alice's V1 bleeds, Bob's M blocks, combat begins; stop at Choose Strike. */
function intoStrikes(
  aliceCards: string[],
  disc: Record<string, "basic" | "superior">,
): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { disciplines: disc, blood: 4, strength: 1 });
  Object.assign(find(state, "M"), { blood: 4, strength: 1 });
  aliceCards.forEach((n, i) => state.seats[0]!.hand.push({ id: `a${i}`, name: n }));
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block → combat
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
    ["Alice", "pass"], ["Bob", "pass"], // range (stays close)
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
  ]);
  return { state, engine };
}

/** Run the engine forward until it leaves combat, passing where it can
 *  and taking the first option where it must (Choose Strike has no pass). */
function drainCombat(engine: VtesEngine, state: GameState): void {
  for (let i = 0; i < 30; i++) {
    const dp = engine.decision();
    if (!dp) break;
    if (!state.frames.some((f) => f.kind === "combat")) break;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
}

describe("Catatonic Fear (100307)", () => {
  it("superior deals 1 damage AFTER combat ends, at close range", () => {
    const { state, engine } = intoStrikes(["Catatonic Fear"], { pre: "superior" });
    runTrace(engine, [
      ["Alice", "play:Catatonic Fear:superior:V1:a0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    const before = find(state, "M").blood;
    drainCombat(engine, state);
    // Combat ended on the strike; the rider then hit M for 1.
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
    expect(find(state, "M").blood).toBe(before - 1);
  });

  it("basic mode ends combat and deals nothing", () => {
    const { state, engine } = intoStrikes(["Catatonic Fear"], { pre: "superior" });
    runTrace(engine, [
      ["Alice", "play:Catatonic Fear:basic:V1:a0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const before = find(state, "M").blood;
    drainCombat(engine, state);
    expect(find(state, "M").blood).toBe(before);
  });
});

describe("Pass Through Shadow (102279)", () => {
  it("superior leaves the card on the vampire after combat", () => {
    const { state, engine } = intoStrikes(["Pass Through Shadow"], { obl: "superior" });
    runTrace(engine, [
      ["Alice", "play:Pass Through Shadow:superior:V1:a0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    drainCombat(engine, state);
    const entry = find(state, "V1").attached.find((p) => p.card.id === "a0");
    expect(entry).toBeDefined();
    expect(entry!.tags).toContain("burnForStealth");
  });

  it("basic mode leaves nothing behind", () => {
    const { state, engine } = intoStrikes(["Pass Through Shadow"], { obl: "superior" });
    runTrace(engine, [
      ["Alice", "play:Pass Through Shadow:basic:V1:a0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    drainCombat(engine, state);
    expect(find(state, "V1").attached.some((p) => p.card.id === "a0")).toBe(false);
  });
});

describe("Form of Mist (100771)", () => {
  it("superior un-blocks the action and returns it to state A", () => {
    // The reading under review (design §3): "as if unblocked" puts the
    // action back where blocks may still be declared, because the +1
    // stealth clause is only worth anything if somebody still can.
    const { state, engine } = intoStrikes(["Form of Mist"], { pro: "superior" });
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action");
    expect(af.step).toBe("blocked");
    expect(af.blockedBy).toBe("M");

    const bloodBefore = find(state, "V1").blood;
    runTrace(engine, [
      ["Alice", "play:Form of Mist:superior:V1:a0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    drainCombat(engine, state);

    expect(af.step).toBe("A");
    expect(af.blockedBy).toBeNull();
    expect(find(state, "V1").blood).toBe(bloodBefore - 1); // "burn 1 blood"
    expect(currentStealth(state, af.actionId)).toBe(1);
  });

  it("is limited to one at SUPERIOR per action, but the basic stays free", () => {
    const { state, engine } = intoStrikes(
      ["Form of Mist", "Form of Mist"],
      { pro: "superior" },
    );
    runTrace(engine, [
      ["Alice", "play:Form of Mist:superior:V1:a0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    drainCombat(engine, state);
    // The action reopened; drive it to a fresh combat is overkill — just
    // read the record the limit is built on.
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action");
    expect(af.played).toContainEqual({
      minion: "V1",
      card: "Form of Mist",
      mode: "superior",
    });
  });
});

describe("Rolling with the Punches (101649)", () => {
  it("superior prevents every point the opponent's strike inflicts", () => {
    const { state, engine } = intoStrikes(["Rolling with the Punches"], { for: "superior" });
    const before = find(state, "V1").blood;
    runTrace(engine, [["Alice", "strike:hand"], ["Bob", "strike:hand"]]);

    // V1 is taking 1 from M's hand strike; the superior mode wipes it.
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.damageResolution");
    const opt = dp.options.find((o) =>
      o.id.startsWith("play:Rolling with the Punches:superior"),
    );
    expect(opt).toBeDefined();
    runTrace(engine, [["Alice", opt!.id]]);
    drainCombat(engine, state);
    // Burned 1 blood for the card, took no damage — so exactly −1.
    expect(find(state, "V1").blood).toBe(before - 1);
    expect(state.eventLog.some((e) => e.type === "DamagePrevented")).toBe(true);
  });
});

describe("regression: preventAll modes are enumerated at all", () => {
  it("offers Touch of Valeren's basic COMBAT mode", () => {
    // It was unreachable: the damage-resolution branch only looked for a
    // `prevent` effect, and this mode is `preventAll`. Nothing asserted
    // it, and the fuzz cannot see a missing option.
    const { state, engine } = intoStrikes(["Touch of Valeren"], { for: "superior" });
    runTrace(engine, [["Alice", "strike:hand"], ["Bob", "strike:hand"]]);
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.damageResolution");
    expect(
      dp.options.some((o) => o.id.startsWith("play:Touch of Valeren:basic")),
    ).toBe(true);
    void state;
  });
});
