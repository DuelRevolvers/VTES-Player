/**
 * Legacy one-shot masters — tranche 3 wave 7
 * (docs/pool-widening-design.md §6).
 *
 * Six cards whose whole text is one thing happening once: Ascendance,
 * Vulnerability, Unnatural Disaster, Effective Management, Tribute to the
 * Master, Letter from Vienna.
 *
 * TWO OF THEM CARRY OPPOSITE RULINGS about the same question — may the
 * card be played when it would do nothing? — and getting either backwards
 * is invisible at the table:
 *
 *  - Effective Management: *"cannot be played when the target crypt is
 *    empty"* [RTR 20000501] — gated.
 *  - Tribute to the Master: *"can be played with no ready vampire"*
 *    [ANK 20210717] — not gated.
 *
 * So both gates are asserted, in both directions.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";

const WAVE: Array<[number, string]> = [
  [100104, "Ascendance"],
  [102134, "Vulnerability"],
  [102080, "Unnatural Disaster"],
  [100616, "Effective Management"],
  [102023, "Tribute to the Master"],
  [101097, "Letter from Vienna"],
];

/** A game parked in Alice's MASTER phase with `name` in hand. */
function masterPhase(name: string, setup: (s: GameState) => void = () => {}): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = "master";
    tf.masterActionsLeft = 1;
  }
  setup(state);
  state.seats[0]!.hand.push({ id: "m1", name });
  return state;
}

function options(state: GameState): string[] {
  return new VtesEngine(state, testRegistry).decision()?.options.map((o) => o.id) ?? [];
}

/** Play the master and let it RESOLVE — a master card opens an as-played
 *  window, and the effect fires only after it closes. */
function play(state: GameState, name: string): GameState {
  const engine = new VtesEngine(state, testRegistry);
  playWith(engine, state, name);
  return state;
}

function playWith(engine: VtesEngine, state: GameState, name: string): void {
  const opt = engine.decision()!.options.find((o) => o.id.startsWith(`play:${name}`));
  if (!opt) throw new Error(`${name} was not offered: ${options(state).join(", ")}`);
  runTrace(engine, [
    ["Alice", opt.id],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
  ]);
}

function loc(id: string, name: string): PermanentInPlay {
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["location"],
  };
}

describe("Ascendance (100104) — gain 1 pool", () => {
  it("pays its controller and nobody else", () => {
    const state = play(masterPhase("Ascendance"), "Ascendance");
    expect(state.seats.map((s) => s.pool)).toEqual([11, 10, 10]);
  });
});

describe("Vulnerability (102134) — burn a vampire in torpor", () => {
  it("offers every torpid vampire, whoever controls it, and burns the chosen one", () => {
    const state = masterPhase("Vulnerability", (s) => {
      s.seats[1]!.minions[0]!.inTorpor = true;
    });
    const torpid = state.seats[1]!.minions[0]!.id;
    const engine = new VtesEngine(state, testRegistry);
    const opt = engine.decision()!.options.find((o) => o.id.includes(torpid));
    expect(opt).toBeDefined();
    runTrace(engine, [
      ["Alice", opt!.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.seats[1]!.minions.map((m) => m.id)).not.toContain(torpid);
  });

  it("NEGATIVE SPACE: with nobody in torpor it is not playable at all", () => {
    // An empty target list must make the card unplayable rather than a
    // silently wasted master phase — the option enumerator returns before
    // the plain fallback option.
    const ids = options(masterPhase("Vulnerability"));
    expect(ids.some((o) => o.startsWith("play:Vulnerability"))).toBe(false);
  });

  it("does not offer a READY vampire", () => {
    // The filter, not the emptiness: a ready vampire on the table and the
    // card still offers nothing.
    const state = masterPhase("Vulnerability");
    expect(state.seats[1]!.minions.length).toBeGreaterThan(0);
    expect(options(state).some((o) => o.startsWith("play:Vulnerability"))).toBe(false);
  });
});

describe("Unnatural Disaster (102080) — burn a location", () => {
  it("burns another Methuselah's location", () => {
    const state = masterPhase("Unnatural Disaster", (s) => {
      s.seats[1]!.permanents.push(loc("bl", "Elder Library"));
    });
    const engine = new VtesEngine(state, testRegistry);
    const opt = engine.decision()!.options.find((o) => o.id.includes("bl"));
    expect(opt).toBeDefined();
    runTrace(engine, [
      ["Alice", opt!.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.seats[1]!.permanents.map((p) => p.card.id)).not.toContain("bl");
  });

  it("sees an ATTACHED location too — the tag, not the zone", () => {
    // Living Manse and Sacré-Cœur are equipment cards that print
    // "represents a location". Reading `seat.permanents` alone would miss
    // them, which is the recurring bug in this codebase.
    const state = masterPhase("Unnatural Disaster", (s) => {
      s.seats[1]!.minions[0]!.attached.push(loc("lm", "Living Manse"));
    });
    expect(options(state).some((o) => o.includes("lm"))).toBe(true);
  });

  it("NEGATIVE SPACE: no location in play, no card", () => {
    expect(options(masterPhase("Unnatural Disaster")).some((o) => o.startsWith("play:Unnatural"))).toBe(
      false,
    );
  });
});

describe("the two opposite rulings", () => {
  it("Effective Management is UNPLAYABLE on an empty crypt [RTR 20000501]", () => {
    const state = masterPhase("Effective Management");
    expect(state.seats[0]!.crypt).toEqual([]);
    expect(options(state).some((o) => o.startsWith("play:Effective Management"))).toBe(false);
  });

  it("…and moves the top crypt card when there is one", () => {
    const state = masterPhase("Effective Management", (s) => {
      s.seats[0]!.crypt.push(makeMinion("C1", "Alice"), makeMinion("C2", "Alice"));
    });
    play(state, "Effective Management");
    expect(state.seats[0]!.uncontrolled.map((u) => u.card.id)).toEqual(["C1"]);
    expect(state.seats[0]!.crypt.map((c) => c.id)).toEqual(["C2"]);
  });

  it("Tribute to the Master IS playable with no ready vampire [ANK 20210717]", () => {
    // The mirror. Same question, opposite answer, and the only way to
    // know either is the ruling — neither is derivable from the text.
    const state = masterPhase("Tribute to the Master", (s) => {
      s.seats[0]!.minions[0]!.inTorpor = true;
    });
    expect(options(state).some((o) => o.startsWith("play:Tribute to the Master"))).toBe(true);
    play(state, "Tribute to the Master");
    expect(state.seats[0]!.pool).toBe(10); // nothing moved, and no error
  });

  it("…and takes 1 from EACH of the controller's ready vampires", () => {
    const state = masterPhase("Tribute to the Master", (s) => {
      s.seats[0]!.minions[0]!.blood = 3;
      s.seats[0]!.minions.push(makeMinion("V2", "Alice", { blood: 2 }));
      s.seats[1]!.minions[0]!.blood = 3; // NOT the controller's
    });
    play(state, "Tribute to the Master");
    expect(state.seats[0]!.pool).toBe(12); // 10 + 2 vampires
    expect(state.seats[0]!.minions.map((m) => m.blood)).toEqual([2, 1]);
    expect(state.seats[1]!.minions[0]!.blood).toBe(3); // untouched
  });
});

describe("Letter from Vienna (101097) — lock all ready Tremere", () => {
  it("locks every Methuselah's Tremere, including its own controller's", () => {
    const state = masterPhase("Letter from Vienna", (s) => {
      s.seats[0]!.minions[0]!.clan = "Tremere";
      s.seats[1]!.minions[0]!.clan = "Tremere";
      s.seats[1]!.minions[1]!.clan = "Brujah"; // the control, same seat
    });
    play(state, "Letter from Vienna");
    expect(state.seats[0]!.minions[0]!.locked).toBe(true);
    expect(state.seats[1]!.minions[0]!.locked).toBe(true);
    expect(state.seats[1]!.minions[1]!.locked).toBe(false);
  });

  it("leaves a TORPID Tremere alone — 'all READY'", () => {
    const state = masterPhase("Letter from Vienna", (s) => {
      const m = s.seats[1]!.minions[0]!;
      m.clan = "Tremere";
      m.inTorpor = true;
    });
    play(state, "Letter from Vienna");
    expect(state.seats[1]!.minions[0]!.locked).toBe(false);
  });
});

describe("the admission path (§6)", () => {
  const reg = registry as unknown as CardRegistry;

  it("all six are in the pool, implemented, and named as printed", () => {
    const wrong = WAVE.filter(([id, name]) => {
      const e = reg.entries[id];
      return !e || !e.supported || e.card.name !== name;
    });
    expect(wrong.map(([id, name]) => `${name} (${id})`)).toEqual([]);
  });
});
