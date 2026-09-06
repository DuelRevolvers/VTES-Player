/**
 * Fourth sweep (docs/card-primitives.md §6): clan uncontrolled-blood
 * locations (`lockGrant: "uncontrolledBlood"`), a clan-attached static
 * master (`permanent.attachClan`), and a long-range-only combat card
 * (`onlyAtLongRange`).
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function loc(id: string, name: string): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: ["location"] };
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

describe("Arcane Library (100081) — clan uncontrolled-blood location", () => {
  it("locks in the influence phase to add 1 blood to a Tremere in the uncontrolled region", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.permanents.push(loc("al0", "Arcane Library"));
    alice.uncontrolled.push({
      card: makeMinion("T", "Alice", { clan: "Tremere", blood: 0, capacity: 5 }),
      counters: 2,
    });
    alice.uncontrolled.push({
      card: makeMinion("V", "Alice", { clan: "Ventrue", blood: 0, capacity: 5 }),
      counters: 0,
    });
    const frame = state.frames[0]!;
    if (frame.kind !== "turn") throw new Error("fixture");
    frame.phase = "influence";
    frame.transfersLeft = 0;
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.window).toBe("turn.influence");
    // Only the Tremere is a legal target (not the Ventrue).
    const ids = dp.options.filter((o) => o.id.startsWith("ability:Arcane Library"));
    expect(ids.map((o) => o.id)).toEqual(["ability:Arcane Library:al0:T"]);

    runTrace(engine, [["Alice", "ability:Arcane Library:al0:T"]]);
    expect(alice.uncontrolled.find((u) => u.card.id === "T")!.counters).toBe(3);
    expect(alice.permanents[0]!.locked).toBe(true);
    // Locked → no second use.
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("ability:Arcane Library")),
    ).toBe(false);
  });
});

describe("Sight Beyond Sight (101780) — clan-attached +1 intercept", () => {
  it("attaches to an own Salubri and grants it +1 intercept", () => {
    const { state, engine } = masterPhaseGame(["Sight Beyond Sight"]);
    const alice = state.seats[0]!;
    alice.minions[0]!.clan = "Salubri";
    alice.minions.push(makeMinion("V2", "Alice", { clan: "Brujah" }));

    // Only the Salubri is offered as a target.
    const dp = engine.decision()!;
    const opts = dp.options.filter((o) => o.id.startsWith("play:Sight Beyond Sight"));
    expect(opts).toHaveLength(1);
    expect(opts[0]!.id).toContain("V1");

    runTrace(engine, [
      ["Alice", "play:Sight Beyond Sight:-:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);

    const v1 = alice.minions.find((m) => m.id === "V1")!;
    const sbs = v1.attached.find((p) => p.card.name === "Sight Beyond Sight")!;
    expect(sbs.statics.intercept).toBe(1);
  });

  it("is not offered when no own Salubri exists", () => {
    const { state, engine } = masterPhaseGame(["Sight Beyond Sight"]);
    state.seats[0]!.minions[0]!.clan = "Ventrue";
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("play:Sight Beyond Sight")),
    ).toBe(false);
  });
});

describe("No Trace (101292) — long-range-only combat ends", () => {
  it("basic is offered only at long range; superior at any range", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { obf: "superior" };
    state.seats[0]!.hand.push({ id: "nt1", name: "No Trace" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // attempt → combat
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range → close
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
    ]);

    // At close range: only the superior mode is offered (basic is long-only).
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.chooseStrike");
    const ids = dp.options.filter((o) => o.id.startsWith("play:No Trace")).map((o) => o.id);
    expect(ids.some((id) => id.includes(":superior:"))).toBe(true);
    expect(ids.some((id) => id.includes(":basic:"))).toBe(false);
  });
});
