/**
 * Legacy referendums — tranche 3 wave 6
 * (docs/pool-widening-design.md §6).
 *
 * Four political actions sharing one new primitive, `refPerMinion`:
 * a filtered per-minion tally that either pays a Methuselah, charges one,
 * or burns blood from the minions themselves.
 *
 * ONE PRIMITIVE, FOUR FILTERS is the risk here. A filter that is too
 * broad pays for minions the card never named, and a filter that is too
 * narrow pays for none — and neither throws. So every card gets a case
 * that its filter EXCLUDES as well as one it includes.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";

const WAVE: Array<[number, string]> = [
  [100115, "Autarkis Persecution"],
  [101391, "Perpetual Care"],
  [100671, "Exclusion Principle"],
  [101535, "Rabble Razing"],
];

/** Alice calls the named referendum and it PASSES on her own ballot. */
function pass(name: string, setup: (s: GameState) => void = () => {}): GameState {
  const state = threeSeatGame();
  setup(state);
  state.seats[0]!.hand.push({ id: "pa", name });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", `play:${name}`],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → polling
    ["Alice", "vote:caller:for"],
  ]);
  for (let i = 0; i < 40; i++) {
    const dp = engine.decision();
    if (!dp || !state.frames.some((f) => f.kind === "referendum")) break;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
  return state;
}

const poolOf = (s: GameState, i: number): number => s.seats[i]!.pool;

describe("Autarkis Persecution (100115) — 1 pool per MINION", () => {
  it("pays every Methuselah for the minions they control", () => {
    // Alice has 1 minion, Bob 2, Carol 1 in the base fixture.
    const state = pass("Autarkis Persecution");
    expect(poolOf(state, 0)).toBe(11);
    expect(poolOf(state, 1)).toBe(12);
    expect(poolOf(state, 2)).toBe(11);
  });

  it("counts ALLIES too — the card says minion, not vampire", () => {
    // The filter that is deliberately ABSENT. Reading "minion" as
    // "vampire" would underpay by exactly the allies, and nothing on the
    // table would show it.
    const state = pass("Autarkis Persecution", (s) => {
      s.seats[2]!.minions.push(makeMinion("ally1", "Carol", { kind: "ally" }));
    });
    expect(poolOf(state, 2)).toBe(12); // 10 + 2 minions
  });
});

describe("Perpetual Care (101391) — 2 pool per vampire IN TORPOR", () => {
  it("charges only for torpid vampires", () => {
    const state = pass("Perpetual Care", (s) => {
      s.seats[1]!.minions[0]!.inTorpor = true;
    });
    expect(poolOf(state, 1)).toBe(8); // one torpid vampire → −2
    // NEGATIVE SPACE: seats with none pay nothing, so the filter is
    // reading torpor rather than counting vampires.
    expect(poolOf(state, 0)).toBe(10);
    expect(poolOf(state, 2)).toBe(10);
  });
});

describe("Exclusion Principle (100671) — 1 pool per ready Independent or Anarch", () => {
  it("pays for both named sects and for neither of the others", () => {
    const state = pass("Exclusion Principle", (s) => {
      s.seats[0]!.minions[0]!.sect = "independent";
      const bob = s.seats[1]!.minions;
      bob[0]!.sect = "anarch";
      bob[1]!.sect = "camarilla"; // not named
      s.seats[2]!.minions[0]!.sect = "sabbat"; // not named
    });
    expect(poolOf(state, 0)).toBe(11); // one independent
    expect(poolOf(state, 1)).toBe(11); // one anarch, the Camarilla ignored
    expect(poolOf(state, 2)).toBe(10); // sabbat pays nothing
  });

  it("NEGATIVE SPACE: a TORPID Independent is not ready, so it does not pay", () => {
    // The torpid one is BOB's: a vampire in torpor cannot act, so putting
    // it on the caller would make the referendum uncallable rather than
    // unpaid — the fixture would fail for the wrong reason.
    const state = pass("Exclusion Principle", (s) => {
      const bob = s.seats[1]!.minions;
      bob[0]!.sect = "independent";
      bob[0]!.inTorpor = true;
      bob[1]!.sect = "independent"; // ready: the control, in the same seat
    });
    expect(poolOf(state, 1)).toBe(11); // the ready one only
  });
});

describe("Rabble Razing (101535) — all small vampires burn 1 blood", () => {
  it("burns from capacity 3 and below, across every Methuselah", () => {
    const state = pass("Rabble Razing", (s) => {
      for (const seat of s.seats) {
        for (const m of seat.minions) {
          m.capacity = 3;
          m.blood = 2;
        }
      }
    });
    for (const seat of state.seats) {
      for (const m of seat.minions) expect(m.blood).toBe(1);
    }
  });

  it("NEGATIVE SPACE: capacity 4 is 'below 4' false, and an ally is not a vampire", () => {
    // Two boundaries in one: the off-by-one on capacity, and the kind
    // filter. Both are the kind of mistake that looks like nothing.
    const state = pass("Rabble Razing", (s) => {
      Object.assign(s.seats[0]!.minions[0]!, { capacity: 4, blood: 2 });
      Object.assign(s.seats[1]!.minions[0]!, { capacity: 3, blood: 2 });
      s.seats[2]!.minions.push(
        makeMinion("ally1", "Carol", { kind: "ally", capacity: 2, blood: 2 }),
      );
    });
    expect(state.seats[0]!.minions[0]!.blood).toBe(2); // capacity 4: spared
    expect(state.seats[1]!.minions[0]!.blood).toBe(1); // capacity 3: burned
    expect(state.seats[2]!.minions.find((m) => m.id === "ally1")!.blood).toBe(2);
  });

  it("a vampire with no blood burns nothing and is not burned", () => {
    // "Burn 1 blood", not "burn 1 blood or be burned" — the shortfall is
    // simply not paid.
    // On BOB's minion: a vampire at 0 blood has a MANDATORY hunt (p. 21),
    // so an empty caller cannot call anything.
    const state = pass("Rabble Razing", (s) => {
      Object.assign(s.seats[1]!.minions[0]!, { capacity: 3, blood: 0 });
      Object.assign(s.seats[1]!.minions[1]!, { capacity: 3, blood: 2 });
    });
    const [empty, fed] = state.seats[1]!.minions;
    expect(empty!.blood).toBe(0);
    expect(fed!.blood).toBe(1); // the control: the burn did happen
    expect(state.seats[1]!.minions.map((m) => m.id)).toContain(empty!.id);
  });
});

describe("the FAIL path", () => {
  it("a referendum nobody votes for does nothing at all", () => {
    // The control for all four: every assertion above is a difference
    // from this baseline, so a card that fired on failure — or one that
    // fired twice — shows up here.
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "pa", name: "Autarkis Persecution" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Autarkis Persecution"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp || !state.frames.some((f) => f.kind === "referendum")) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(state.seats.map((s) => s.pool)).toEqual([10, 10, 10]);
  });
});

describe("the admission path (§6)", () => {
  const reg = registry as unknown as CardRegistry;

  it("all four are in the pool, implemented, and named as printed", () => {
    const wrong = WAVE.filter(([id, name]) => {
      const e = reg.entries[id];
      return !e || !e.supported || e.card.name !== name;
    });
    expect(wrong.map(([id, name]) => `${name} (${id})`)).toEqual([]);
  });
});
