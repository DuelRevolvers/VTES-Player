/**
 * The ash heap as a resource (docs/ash-heap-resource-design.md).
 * Redeem the Lost Soul (101577), Waste Management Operation (102153),
 * Maabara (101136), The Erciyes Fragments (100656).
 *
 * What is worth pinning: that a burnt VAMPIRE and a burnt LIBRARY CARD
 * are different things to every one of these cards, and that the capacity
 * Redeem reads is the one recorded when the vampire burned.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function inPlay(id: string, name: string): PermanentInPlay {
  const h = testRegistry[name]!;
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h.permanentStatics ?? {},
    tags: h.permanentTags ?? [],
  };
}

function atPhase(state: GameState, phase: "master" | "discard"): VtesEngine {
  const tf = state.frames.find((f) => f.kind === "turn")!;
  if (tf.kind === "turn") {
    tf.phase = phase;
    // The fixture opens with no master action left, so a master-phase
    // test that does not grant one asserts against an empty option list.
    if (phase === "master") tf.masterActionsLeft = 1;
    if (phase === "discard") tf.discardActionsLeft = 1;
  }
  return new VtesEngine(state, testRegistry);
}

describe("Redeem the Lost Soul (101577)", () => {
  it("pays half the capacity RECORDED ON THE ASH ENTRY, and only for vampires", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "rl", name: "Redeem the Lost Soul" });
    state.seats[0]!.ashHeap = [
      { id: "dead", name: "Some Elder", crypt: true, capacity: 7 },
      { id: "lib", name: "Blood Doll" }, // a library card — not a choice
    ];
    const engine = atPhase(state, "master");
    const plays = ids(engine).filter((i) => i.startsWith("play:Redeem the Lost Soul"));
    expect(plays).toHaveLength(1);
    expect(plays[0]).toContain("dead");
    const pool = state.seats[0]!.pool;
    runTrace(engine, [["Alice", plays[0]!]]);
    // The as-played window has to close before a master resolves.
    for (let i = 0; i < 10 && state.frames.some((f) => f.kind === "cardPlay"); i++) {
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    // 7 / 2 rounded down = 3, and the vampire leaves the game entirely.
    expect(state.seats[0]!.pool).toBe(pool + 3);
    expect(state.seats[0]!.ashHeap!.some((c) => c.id === "dead")).toBe(false);
  });

  it("records capacity as the vampire burns, so a token vampire answers too", () => {
    const state = threeSeatGame();
    // A vampire with no registry entry at all — reading capacity back by
    // NAME would find nothing (docs/token-vampire-design.md).
    state.seats[0]!.minions.push(makeMinion("TOK", "Alice", { name: "Nameless Thing", capacity: 5 }));
    const engine = new VtesEngine(state, testRegistry);
    engine.burnMinion("TOK");
    const entry = state.seats[0]!.ashHeap!.find((c) => c.id === "TOK")!;
    expect(entry.capacity).toBe(5);
  });
});

describe("Waste Management Operation (102153)", () => {
  it("locks in the DISCARD phase to put an ash card on the BOTTOM of the library", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(inPlay("wm", "Waste Management Operation"));
    state.seats[0]!.ashHeap = [
      { id: "lib", name: "Blood Doll" },
      { id: "dead", name: "Some Elder", crypt: true, capacity: 4 },
    ];
    // NEGATIVE SPACE: not the master phase, and never a burnt vampire.
    expect(ids(atPhase(state, "master")).some((i) => i.includes(":a2l:"))).toBe(false);
    const engine = atPhase(state, "discard");
    const opts = ids(engine).filter((i) => i.includes(":a2l:"));
    expect(opts).toEqual(["ability:Waste Management Operation:wm:a2l:lib"]);
    const before = state.seats[0]!.library.length;
    runTrace(engine, [["Alice", opts[0]!]]);
    expect(state.seats[0]!.library.length).toBe(before + 1);
    expect(state.seats[0]!.library.at(-1)?.id).toBe("lib"); // the BOTTOM
    expect(state.seats[0]!.permanents[0]!.locked).toBe(true);
  });
});

describe("Maabara (101136) and The Erciyes Fragments (100656)", () => {
  it("Maabara takes from YOUR ash heap; the Fragments take from your PREY's", () => {
    const state = threeSeatGame(); // Alice → Bob → Carol
    state.seats[0]!.permanents.push(inPlay("mb", "Maabara"), inPlay("ef", "The Erciyes Fragments"));
    state.seats[0]!.ashHeap = [{ id: "mine", name: "Blood Doll" }];
    state.seats[1]!.ashHeap = [{ id: "theirs", name: "Vessel" }]; // Bob = prey
    const opts = ids(atPhase(state, "master")).filter((i) => i.includes(":fromash:"));
    expect(opts).toContain("ability:Maabara:mb:fromash:mine");
    expect(opts).toContain("ability:The Erciyes Fragments:ef:fromash:theirs");
    // NEGATIVE SPACE: neither card reaches into the other's heap.
    expect(opts).not.toContain("ability:Maabara:mb:fromash:theirs");
    expect(opts).not.toContain("ability:The Erciyes Fragments:ef:fromash:mine");
  });

  it("Maabara's stored card goes back to the TOP of the library", () => {
    const state = threeSeatGame();
    const mb = inPlay("mb", "Maabara");
    mb.stored = [{ id: "s1", name: "Blood Doll" }];
    state.seats[0]!.permanents.push(mb);
    const engine = atPhase(state, "master");
    const opt = ids(engine).find((i) => i.includes(":tolib:"))!;
    expect(opt).toBeDefined();
    runTrace(engine, [["Alice", opt]]);
    expect(state.seats[0]!.library[0]?.id).toBe("s1");
    expect(state.seats[0]!.permanents[0]!.stored).toHaveLength(0);
  });

  it("only a vampire with capacity ABOVE 4 may steal the Fragments", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(inPlay("ef", "The Erciyes Fragments"));
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") {
      tf.phase = "minion";
      tf.seat = "Bob";
    }
    // BOTH of Bob's vampires, not just one: the fixture gives him two and
    // leaving the second at its default capacity would offer the action
    // anyway and pass the positive half for the wrong reason.
    for (const m of state.seats[1]!.minions) Object.assign(m, { capacity: 4 });
    expect(
      ids(new VtesEngine(state, testRegistry)).some((i) => i.startsWith("act:The Erciyes")),
    ).toBe(false);
    Object.assign(state.seats[1]!.minions[0]!, { capacity: 5 });
    expect(
      ids(new VtesEngine(state, testRegistry)).some((i) => i.startsWith("act:The Erciyes")),
    ).toBe(true);
  });
});
