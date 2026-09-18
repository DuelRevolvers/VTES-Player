/**
 * Gehenna: the recurring event (docs/gehenna-events-design.md).
 *
 * Dragonbound (100581), Thirst (101974), Conquest of Humanity (100409) —
 * one card, in one play area, that fires in EVERY Methuselah's phase.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id)!;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function entry(id: string, name: string): PermanentInPlay {
  const h = testRegistry[name];
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h?.permanentStatics ?? {},
    tags: h?.permanentTags ?? [],
  };
}

// ---------------------------------------------------------------------------

describe("Dragonbound (100581)", () => {
  it("burns the PHASE's Methuselah 1 pool per torpid vampire, wherever it sits", () => {
    const state = threeSeatGame();
    // Carol's play area — "each Methuselah's discard phase" is not "your".
    state.seats[2]!.permanents.push(entry("dg", "Dragonbound"));
    find(state, "V1").inTorpor = true;
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { inTorpor: true }));
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") tf.phase = "influence";
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "pass"]]); // influence → discard
    expect(state.seats[0]!.pool).toBe(8);
    expect(state.seats[1]!.pool).toBe(10);
  });
});

describe("Thirst (101974)", () => {
  it("bites the ready vampires under the waterline that did not hunt", () => {
    const state = threeSeatGame();
    // Three Gehenna events in play, so "capacity less than the number of
    // Gehenna events in play" is capacity < 3.
    state.seats[0]!.permanents.push(
      entry("th", "Thirst"),
      entry("dg", "Dragonbound"),
      entry("cq", "Conquest of Humanity"),
    );
    Object.assign(find(state, "V1"), { capacity: 2, blood: 1 });
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { capacity: 2, blood: 2 }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "end"],
    ]);
    // V1 hunted (+1 blood) and is spared; V2 did not and pays.
    expect(find(state, "V1").blood).toBe(2);
    expect(find(state, "V2").blood).toBe(1);
  });
});

describe("Conquest of Humanity (100409)", () => {
  /** Alice, in her discard phase, holding Conquest, with `others` other
   *  Gehenna events already in play. */
  function withGehenna(others: number) {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "ev", name: "Conquest of Humanity" });
    const names = ["Dragonbound", "Thirst"];
    for (let i = 0; i < others; i++) {
      state.seats[1]!.permanents.push(entry(`g${i}`, names[i]!));
    }
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") {
      tf.phase = "discard";
      tf.discardActionsLeft = 1;
    }
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("NEGATIVE SPACE: requires 2 or more OTHER Gehenna events in play", () => {
    expect(optionIds(withGehenna(1).engine).some((i) => i.includes("Conquest"))).toBe(false);
    expect(optionIds(withGehenna(2).engine).some((i) => i.includes("Conquest"))).toBe(true);
  });

  it("lets each Methuselah threaten a PREY location, which pays or burns", () => {
    const state = threeSeatGame();
    state.seats[2]!.permanents.push(entry("cq", "Conquest of Humanity"));
    // Alice's prey is Bob.
    state.seats[1]!.permanents.push(entry("loc", "Therbold Realty"));
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") {
      tf.phase = "unlock";
      tf.unlockDone = false;
    }
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "choice:Conquest of Humanity:cq:gehennaPickLocation:loc"],
      ["Bob", "choice:Conquest of Humanity:cq:gehennaRansom:burn"],
    ]);
    expect(state.seats[1]!.permanents.some((p) => p.card.id === "loc")).toBe(false);
    expect(state.seats[1]!.pool).toBe(10);
  });
});
