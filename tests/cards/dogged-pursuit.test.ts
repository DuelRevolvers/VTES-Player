/**
 * Dogged Pursuit (102353) — a locked vampire unlocks and attempts to block;
 * if it does NOT block, the "did not block" penalty fires at action
 * resolution (basic: lock it; superior: attach the card, which can later be
 * burned for +1 intercept).
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Alice bleeds Bob; M (locked) plays Dogged Pursuit and force-blocks, but
 *  Alice raises stealth so the block FAILS → the penalty applies. */
function forcedBlockFails(engine: VtesEngine, mode: "basic" | "superior"): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], // state A
    [`Bob`, `play:Dogged Pursuit:${mode}:M`], // unlock + forced block
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // reaction as-played
    // Block attempt opens: Alice raises stealth so M's block falls short.
    ["Alice", "play:Lost in Crowds:basic"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // LiC as-played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt → fails
    // Back to state A → C → resolve.
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
}

function setup(mode: "basic" | "superior"): { state: ReturnType<typeof threeSeatGame>; engine: VtesEngine } {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  v1.disciplines = { dom: "basic", obf: "basic" };
  state.seats[0]!.hand.push({ id: "lic1", name: "Lost in Crowds" });
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  m.disciplines = { ani: "superior" };
  m.locked = true;
  state.seats[1]!.hand.push({ id: "dp1", name: "Dogged Pursuit" });
  return { state, engine: new VtesEngine(state, testRegistry) };
}

describe("Dogged Pursuit (102353)", () => {
  it("basic: locks the vampire that did not block", () => {
    const { state, engine } = setup("basic");
    forcedBlockFails(engine, "basic");
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    expect(state.eventLog.some((e) => e.type === "BlockFailed")).toBe(true);
    expect(m.locked).toBe(true); // re-locked by the penalty
  });

  it("superior: attaches to the vampire that did not block", () => {
    const { state, engine } = setup("superior");
    forcedBlockFails(engine, "superior");
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    expect(m.attached.some((p) => p.card.name === "Dogged Pursuit")).toBe(true);
  });

  it("no penalty when the vampire successfully blocks", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.disciplines = { dom: "basic" };
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.disciplines = { ani: "superior" };
    m.locked = true;
    state.seats[1]!.hand.push({ id: "dp1", name: "Dogged Pursuit" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "play:Dogged Pursuit:superior:M"], // force-block (stealth 0 → succeeds)
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt → success → combat
    ]);

    expect(state.eventLog.some((e) => e.type === "CombatBegan")).toBe(true);
    // It blocked, so the card is NOT attached.
    expect(m.attached.some((p) => p.card.name === "Dogged Pursuit")).toBe(false);
  });

  it("an attached copy can be burned for +1 intercept during a block", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { dom: "basic", obf: "basic" };
    state.seats[0]!.hand.push({ id: "lic1", name: "Lost in Crowds" });
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.attached.push({
      card: { id: "dp1", name: "Dogged Pursuit" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Dogged Pursuit", "did-not-block"],
    });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "play:Lost in Crowds:basic"], // stealth 1
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // LiC as-played
      ["Alice", "pass"],
      ["Bob", "ability:Dogged Pursuit:dp1:intercept"], // burn for +1 intercept
    ]);

    expect(
      state.eventLog.some(
        (e) => e.type === "InterceptModified" && e.minion === "M" && e.delta === 1 && e.source === "Dogged Pursuit",
      ),
    ).toBe(true);
    expect(m.attached.some((p) => p.card.id === "dp1")).toBe(false); // burned
  });
});
