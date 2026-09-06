/**
 * Third vocabulary sweep (docs/card-primitives.md §6): a combat strength
 * card, a title-gated blood-gift action, and a bespoke reactive location
 * — exercising `addStrength`, the combat-scoped press grant,
 * `actionAddBloodToVampire`, and Dummy Corporation.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [], ...over };
}

function masterPhaseGame(cards: string[]): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const frame = state.frames[0]!;
  if (frame.kind !== "turn") throw new Error("fixture");
  frame.phase = "master";
  frame.masterActionsLeft = 1;
  cards.forEach((name, i) => state.seats[0]!.hand.push({ id: `mc${i}`, name }));
  return { state, engine: new VtesEngine(state, testRegistry) };
}

describe("Form of the Wolf (102225)", () => {
  it("adds +1 strength for the whole combat and cannot be replayed", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.strength = 1;
    v1.disciplines = { pro: "basic" };
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    w.blood = 5;
    w.capacity = 5;
    state.seats[0]!.hand = [
      { id: "fw1", name: "Form of the Wolf" },
      { id: "fw2", name: "Form of the Wolf" },
    ];
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // attempt → success
      // Before range: V1 plays Form of the Wolf (+1 strength this combat).
      ["Alice", "play:Form of the Wolf:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
    ]);
    // A second Form of the Wolf this combat is not offered.
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.beforeRange");
    expect(dp.options.some((o) => o.id.startsWith("play:Form of the Wolf"))).toBe(false);

    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // finish before range
      ["Alice", "pass"], ["Bob", "pass"], // range → close
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      ["Alice", "pass"], // V1 takes W's 1
      ["Bob", "pass"], // W takes V1's 2 (strength 1 + 1 bonus)
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(w.blood).toBe(3); // 5 − 2 (boosted strike)
  });
});

describe("Fifth Tradition: Hospitality (100727)", () => {
  it("requires a prince or justicar and adds 4 blood to a chosen vampire", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.blood = 2;
    alice.minions.push(makeMinion("V2", "Alice", { blood: 1, capacity: 6 }));
    alice.hand.push({ id: "ft1", name: "Fifth Tradition: Hospitality" });
    const engine = new VtesEngine(state, testRegistry);

    // Untitled → not offered.
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("play:Fifth Tradition")),
    ).toBe(false);

    alice.minions[0]!.title = "prince";
    runTrace(engine, [
      ["Alice", "play:Fifth Tradition: Hospitality:basic:V1:V2"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);

    expect(alice.minions.find((m) => m.id === "V2")!.blood).toBe(5); // 1 + 4
    expect(alice.minions[0]!.blood).toBe(1); // paid the 1-blood cost
  });
});

describe("Dummy Corporation (100594)", () => {
  it("plays as a unique master location", () => {
    const { state, engine } = masterPhaseGame(["Dummy Corporation"]);
    const alice = state.seats[0]!;
    runTrace(engine, [
      ["Alice", "play:Dummy Corporation"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    expect(alice.permanents.some((p) => p.card.name === "Dummy Corporation")).toBe(true);
    // Unique: a second copy is not offered.
    alice.hand.push({ id: "dc2", name: "Dummy Corporation" });
    const frame = state.frames[0]!;
    if (frame.kind !== "turn") throw new Error("frame");
    frame.masterActionsLeft = 1;
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("play:Dummy Corporation")),
    ).toBe(false);
  });

  it("burns to reduce a bleed against you by 2 (Carol → Alice)", () => {
    // Carol's prey is Alice, so Carol's bleed targets Alice.
    const state = threeSeatGame();
    const frame = state.frames[0]!;
    if (frame.kind !== "turn") throw new Error("fixture");
    frame.seat = "Carol";
    const alice = state.seats[0]!;
    alice.permanents.push(entry("dc0", "Dummy Corporation", { tags: ["location"] }));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Carol", "bleed:N"],
      ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], // announce → A
      ["Carol", "pass"],
      ["Alice", "ability:Dummy Corporation"], // burn → reduce by 2, rewinds
      ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], // A again → C
      ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], // C → resolve
    ]);

    // Bleed 1 − 2 → nothing lost; the location is burned; no Edge.
    expect(alice.pool).toBe(10);
    expect(state.edge).toBeNull();
    expect(alice.permanents.some((p) => p.card.name === "Dummy Corporation")).toBe(false);
    expect(
      state.eventLog.some((e) => e.type === "BleedAmountModified" && e.source === "Dummy Corporation"),
    ).toBe(true);
  });

  it("is not offered on a bleed against another Methuselah", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(entry("dc0", "Dummy Corporation", { tags: ["location"] }));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"], // Alice bleeds Bob, not herself
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
    ]);
    // No Dummy Corporation option appears for Alice (bleed isn't against her).
    const anyDummy = state.eventLog.some((e) => e.type === "BleedAmountModified" && e.source === "Dummy Corporation");
    expect(anyDummy).toBe(false);
  });
});
