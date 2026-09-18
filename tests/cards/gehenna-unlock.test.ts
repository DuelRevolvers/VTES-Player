/**
 * Gehenna: the unlock-phase trio (docs/gehenna-unlock-design.md).
 *
 * The New Inquisition (101279), Becoming of Ennoia (100148), Recalled to
 * the Founder (101566). All three fire in EVERY Methuselah's unlock
 * phase; what is worth pinning is where each one LOOKS (prey / self /
 * a clan that reached three), and that "can choose" and "chooses" are
 * different questions.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
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

function atUnlock(state: GameState): VtesEngine {
  const tf = state.frames.find((f) => f.kind === "turn")!;
  if (tf.kind === "turn") {
    tf.phase = "unlock";
    tf.unlockDone = false;
  }
  return new VtesEngine(state, testRegistry);
}

function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

// ---------------------------------------------------------------------------

describe("The New Inquisition (101279)", () => {
  it("offers the PHASE's Methuselah a ready vampire of their PREY, and may be declined", () => {
    const state = threeSeatGame(); // Alice → Bob → Carol
    state.seats[2]!.permanents.push(entry("ni", "The New Inquisition"));
    const engine = atUnlock(state);
    const opts = ids(engine).filter((i) => i.includes("gehennaPickVampire"));
    // Bob is Alice's prey; Carol (her predator) and her own V1 are not.
    expect(opts.some((i) => i.endsWith(":W"))).toBe(true);
    expect(opts.some((i) => i.endsWith(":V1"))).toBe(false);
    expect(opts.some((i) => i.endsWith(":N"))).toBe(false);
    // "CAN choose" — declining is a plain pass.
    expect(ids(engine)).toContain("pass");
    const before = find(state, "W")!.blood;
    runTrace(engine, [["Alice", opts.find((i) => i.endsWith(":W"))!]]);
    expect(find(state, "W")!.blood).toBe(before - 1);
  });

  it("NEGATIVE SPACE: only a TITLED vampire is offered the referendum to burn it", () => {
    const state = threeSeatGame();
    state.seats[2]!.permanents.push(entry("ni", "The New Inquisition"));
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") tf.phase = "minion";
    expect(ids(new VtesEngine(state, testRegistry)).some((i) => i.startsWith("act:The New"))).toBe(
      false,
    );
    find(state, "V1")!.title = "prince";
    expect(ids(new VtesEngine(state, testRegistry)).some((i) => i.startsWith("act:The New"))).toBe(
      true,
    );
  });
});

describe("Becoming of Ennoia (100148)", () => {
  it("NEGATIVE SPACE: its two Gehenna cards must be OTHER Methuselahs'", () => {
    const play = (mine: number, theirs: number): VtesEngine => {
      const state = threeSeatGame();
      state.seats[0]!.hand.push({ id: "ev", name: "Becoming of Ennoia" });
      const names = ["Dragonbound", "Thirst"];
      for (let i = 0; i < mine; i++) state.seats[0]!.permanents.push(entry(`m${i}`, names[i]!));
      for (let i = 0; i < theirs; i++) state.seats[1]!.permanents.push(entry(`t${i}`, names[i]!));
      const tf = state.frames.find((f) => f.kind === "turn")!;
      if (tf.kind === "turn") {
        tf.phase = "discard";
        tf.discardActionsLeft = 1;
      }
      return new VtesEngine(state, testRegistry);
    };
    expect(ids(play(2, 0)).some((i) => i.includes("Becoming"))).toBe(false);
    expect(ids(play(0, 2)).some((i) => i.includes("Becoming"))).toBe(true);
  });

  it("makes each Methuselah damage one of their OWN, with no pass", () => {
    const state = threeSeatGame();
    state.seats[1]!.permanents.push(entry("be", "Becoming of Ennoia"));
    const engine = atUnlock(state);
    const opts = ids(engine);
    expect(opts.filter((i) => i.includes("gehennaPickVampire"))).toEqual([
      "choice:Becoming of Ennoia:be:gehennaPickVampire:V1",
    ]);
    // "CHOOSES", not "can choose".
    expect(opts).not.toContain("pass");
  });
});

describe("Recalled to the Founder (101566)", () => {
  function threeOfAClan(capacity: number): GameState {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(entry("rf", "Recalled to the Founder"));
    Object.assign(find(state, "V1")!, { clan: "Ventrue", capacity });
    state.seats[0]!.minions.push(
      makeMinion("V2", "Alice", { clan: "Ventrue", capacity: 3 }),
      makeMinion("V3", "Alice", { clan: "Ventrue", capacity: 3 }),
      makeMinion("V4", "Alice", { clan: "Brujah", capacity: 3 }),
    );
    return state;
  }

  it("burns one of the clan that reached three — and only that clan", () => {
    const state = threeOfAClan(3);
    const engine = atUnlock(state);
    const opts = ids(engine).filter((i) => i.includes("gehennaSameClan"));
    expect(opts).toHaveLength(3);
    expect(opts.some((i) => i.endsWith(":V4"))).toBe(false); // the lone Brujah
    runTrace(engine, [["Alice", opts.find((i) => i.endsWith(":V2"))!]]);
    expect(find(state, "V2")).toBeUndefined();
  });

  it("a capacity-6 burn exempts that Methuselah for the rest of the game", () => {
    const state = threeOfAClan(6);
    const engine = atUnlock(state);
    const pick = ids(engine).find((i) => i.includes("gehennaSameClan") && i.endsWith(":V1"))!;
    runTrace(engine, [["Alice", pick]]);
    expect(find(state, "V1")).toBeUndefined();
    // Still three Ventrue? No — two left, so re-arm the group and re-ask.
    state.seats[0]!.minions.push(makeMinion("V5", "Alice", { clan: "Ventrue", capacity: 3 }));
    expect(ids(atUnlock(state)).some((i) => i.includes("gehennaSameClan"))).toBe(false);
  });
});
