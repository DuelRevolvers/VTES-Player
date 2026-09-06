/**
 * Choice frames (docs/choice-frames-design.md) — a card stopping to ask
 * one Methuselah a question. The Rack (101536) asks at play *and* when its
 * controller changes, and reads the answer back later; Fragment of the
 * Book of Nod (100785) asks repeatedly (discard down after drawing 2).
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function loc(id: string, name: string): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: ["location"] };
}

function masterPhase(state: GameState, seat = "Alice"): GameState {
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.seat = seat;
    tf.phase = "master";
    tf.masterActionsLeft = 1;
  }
  return state;
}

describe("The Rack (101536)", () => {
  it("asks its controller to choose a vampire as it is played", () => {
    const state = masterPhase(threeSeatGame());
    state.seats[0]!.minions.push(makeMinion("A2", "Alice"));
    state.seats[0]!.hand.push({ id: "rack", name: "The Rack" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:The Rack:-:rack"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);

    // The question is up, and it is Alice's alone.
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(dp.window).toBe("choice");
    expect(dp.options.map((o) => o.id).sort()).toEqual([
      "choice:The Rack:rack:chooseVampire:A2",
      "choice:The Rack:rack:chooseVampire:V1",
    ]);
    // Not optional: no decline.
    expect(dp.options.some((o) => o.id === "pass")).toBe(false);

    engine.choose("choice:The Rack:rack:chooseVampire:A2");
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "rack")!.chosen).toBe("A2");
  });

  it("feeds the chosen vampire 2 blood in its controller's unlock phase, and no one else", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "unlock";
      tf.unlockDone = false;
      tf.unlockAbilitiesDone = false;
    }
    state.seats[0]!.minions.push(makeMinion("A2", "Alice", { blood: 1 }));
    const rack = loc("rack", "The Rack");
    rack.chosen = "A2";
    state.seats[0]!.permanents.push(rack);
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "ability:The Rack:rack:A2")).toBe(true);
    expect(dp.options.some((o) => o.id === "ability:The Rack:rack:V1")).toBe(false);

    runTrace(engine, [["Alice", "ability:The Rack:rack:A2"]]);
    expect(state.seats[0]!.minions.find((m) => m.id === "A2")!.blood).toBe(3);
  });

  it("asks the thief to choose again when control changes", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    const rack = loc("rack", "The Rack");
    rack.chosen = "V1"; // Alice's pick
    state.seats[0]!.permanents.push(rack);
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Bob", "act:The Rack:rack:steal:W"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // announce
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // A
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // C → steal
    ]);

    // Control moved, so BOB now answers "choose a ready vampire you control".
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.window).toBe("choice");
    expect(dp.options.every((o) => o.id.startsWith("choice:The Rack:rack:chooseVampire:"))).toBe(
      true,
    );
    engine.choose("choice:The Rack:rack:chooseVampire:M");
    expect(state.seats[1]!.permanents.find((p) => p.card.id === "rack")!.chosen).toBe("M");
  });
});

describe("Fragment of the Book of Nod (100785)", () => {
  function withHand(cards: number): GameState {
    const state = masterPhase(threeSeatGame());
    const alice = state.seats[0]!;
    alice.hand = [];
    for (let i = 0; i < cards; i++) alice.hand.push({ id: `h${i}`, name: "Conditioning" });
    for (let i = 0; i < 10; i++) alice.library.push({ id: `l${i}`, name: "Conditioning" });
    alice.permanents.push(loc("nod", "Fragment of the Book of Nod"));
    return state;
  }

  it("locks to draw 2, then forces a discard down to hand size, player's pick", () => {
    const state = withHand(7); // already at hand size
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "ability:Fragment of the Book of Nod:nod:draw"]]);

    const alice = state.seats[0]!;
    expect(alice.permanents.find((p) => p.card.id === "nod")!.locked).toBe(true);
    expect(alice.hand).toHaveLength(9); // drew 2 over the limit

    // Two forced discards follow, each a free pick; no decline offered.
    const first = engine.decision()!;
    expect(first.seat).toBe("Alice");
    expect(first.window).toBe("choice");
    expect(first.options.some((o) => o.id === "pass")).toBe(false);
    engine.choose(first.options[0]!.id);
    expect(state.seats[0]!.hand).toHaveLength(8);

    const second = engine.decision()!;
    expect(second.window).toBe("choice");
    engine.choose(second.options[0]!.id);

    // Down to hand size, and no replacement draws for the forced discards.
    expect(state.seats[0]!.hand).toHaveLength(7);
    expect(engine.decision()!.window).not.toBe("choice");
  });

  it("asks nothing when the draw leaves the hand at or under size", () => {
    const state = withHand(4);
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "ability:Fragment of the Book of Nod:nod:draw"]]);

    expect(state.seats[0]!.hand).toHaveLength(6);
    expect(engine.decision()!.window).not.toBe("choice");
  });

  it("cannot be used twice without unlocking", () => {
    const state = withHand(4);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "ability:Fragment of the Book of Nod:nod:draw"]]);
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("ability:Fragment"))).toBe(false);
  });
});
