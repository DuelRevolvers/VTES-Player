/**
 * Legacy political actions — tranche 1 wave 13
 * (docs/pool-widening-design.md §6).
 *
 * Transfer of Power, Tithings, Diversity, The Final Nights,
 * Consanguineous Condemnation.
 *
 * Wave 6's `refPerMinion` counts MINIONS INSIDE a seat. These five ask a
 * question ABOUT the seat — is it richer than the caller, does it field
 * an elder, how many clans does it field — and a per-seat predicate that
 * is one notch off pays or charges the wrong table without throwing.
 * So each card is asserted on both sides of its boundary.
 *
 * The Final Nights is why the engine changed: it is the first card in the
 * pool with a clause for a referendum that FAILS.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";

const WAVE: Array<[number, string]> = [
  [102010, "Transfer of Power"],
  [101986, "Tithings"],
  [100564, "Diversity"],
  [100731, "The Final Nights"],
  [100411, "Consanguineous Condemnation"],
];

function setup(name: string, prepare: (s: GameState) => void = () => {}) {
  const state = threeSeatGame();
  prepare(state);
  state.seats[0]!.hand.push({ id: "pa", name });
  return { state, engine: new VtesEngine(state, testRegistry) };
}

/** Announce the referendum and take it to the polling step, choosing the
 *  named terms if the card has any. */
function announce(engine: VtesEngine, name: string, terms?: string): void {
  runTrace(engine, [
    ["Alice", `play:${name}`],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
  ]);
  // Terms are step 1 of the referendum, which begins once the action has
  // resolved — after the four windows, not before them.
  if (terms !== undefined) runTrace(engine, [["Alice", `terms:${terms}`]]);
}

/** Drain whatever windows remain until the referendum frame is gone,
 *  preferring `pass` — a walker that takes options[0] plays the board. */
function drain(engine: VtesEngine, state: GameState): void {
  for (let i = 0; i < 40; i++) {
    const dp = engine.decision();
    if (!dp || !state.frames.some((f) => f.kind === "referendum")) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

/** Alice calls the referendum and carries it on her own ballot. */
function pass(name: string, prepare?: (s: GameState) => void, terms?: string): GameState {
  const { state, engine } = setup(name, prepare);
  announce(engine, name, terms);
  runTrace(engine, [["Alice", "vote:caller:for"]]);
  drain(engine, state);
  return state;
}

/** The same referendum with nobody voting: 0 for, 0 against, so it
 *  RESOLVES and fails rather than being cancelled — the distinction the
 *  failure clause turns on. */
function fail(name: string, prepare?: (s: GameState) => void): GameState {
  const { state, engine } = setup(name, prepare);
  announce(engine, name);
  drain(engine, state);
  return state;
}

const pools = (s: GameState): number[] => s.seats.map((x) => x.pool);
const minion = (s: GameState, id: string) =>
  s.seats.flatMap((x) => x.minions).find((m) => m.id === id)!;

describe("Transfer of Power (102010) — steal 1 from each richer Methuselah", () => {
  it("takes from the richer seats only, and the caller gains what moved", () => {
    const state = pass("Transfer of Power", (s) => {
      s.seats[1]!.pool = 12; // richer
      s.seats[2]!.pool = 8; // poorer
    });
    // Bob gives 1, Carol gives nothing, Alice gains exactly the 1 that moved.
    expect(pools(state)).toEqual([11, 11, 8]);
  });

  it("NEGATIVE SPACE: EQUAL pool is not 'more' — the boundary", () => {
    // Off-by-one here would tax the whole table on a card that is
    // supposed to tax nobody, and the pools would still look plausible.
    const state = pass("Transfer of Power", (s) => {
      s.seats[1]!.pool = 10;
      s.seats[2]!.pool = 10;
    });
    expect(pools(state)).toEqual([10, 10, 10]);
  });

  it("the caller is never their own victim", () => {
    // "Each Methuselah who has more pool than you do" cannot name you.
    // A self-steal would net zero and hide in the totals, so this is
    // asserted against the EVENT LOG rather than the pool.
    const state = pass("Transfer of Power", (s) => {
      s.seats[1]!.pool = 20;
      s.seats[2]!.pool = 20;
    });
    const burns = state.eventLog.filter((e) => e.type === "PoolBurned");
    expect(burns.every((e) => e.type === "PoolBurned" && e.seat !== "Alice")).toBe(true);
    expect(pools(state)).toEqual([12, 19, 19]);
  });
});

describe("Tithings (101986) — steal 1 from each seat with no vampire above capacity 6", () => {
  const sabbatElder = (s: GameState) => {
    Object.assign(s.seats[0]!.minions[0]!, { sect: "sabbat", capacity: 7 });
  };

  it("charges the seats without an elder and spares the ones with", () => {
    const state = pass("Tithings", (s) => {
      sabbatElder(s);
      s.seats[1]!.minions[0]!.capacity = 8; // Bob is safe
      s.seats[2]!.minions[0]!.capacity = 6; // Carol is not
    });
    expect(pools(state)).toEqual([11, 10, 9]);
  });

  it("NEGATIVE SPACE: capacity exactly 6 is not 'above 6'", () => {
    // Read as ">= 6" every seat in the base fixture would be safe and the
    // card would silently do nothing at all.
    const state = pass("Tithings", (s) => {
      sabbatElder(s);
      for (const m of s.seats[1]!.minions) m.capacity = 6;
      s.seats[2]!.minions[0]!.capacity = 7; // the control: safe at 7
    });
    expect(pools(state)).toEqual([11, 9, 10]);
  });

  it("requires a Sabbat vampire above capacity 6 to call it", () => {
    // Both halves of the requirement, each failed on its own, then met —
    // so "not offered" is the requirement biting rather than the card
    // being absent.
    const camarillaElder = (s: GameState) => {
      Object.assign(s.seats[0]!.minions[0]!, { sect: "camarilla", capacity: 7 });
    };
    const smallSabbat = (s: GameState) => {
      Object.assign(s.seats[0]!.minions[0]!, { sect: "sabbat", capacity: 6 });
    };
    const offered = (prep: (s: GameState) => void): boolean =>
      setup("Tithings", prep)
        .engine.decision()!
        .options.some((o) => o.id.startsWith("play:Tithings"));
    expect(offered(camarillaElder)).toBe(false);
    expect(offered(smallSabbat)).toBe(false);
    expect(offered(sabbatElder)).toBe(true);
  });
});

describe("Diversity (100564) — 1 pool per CLAN a seat's ready vampires belong to", () => {
  it("counts distinct clans, not vampires", () => {
    // Bob fields two Brujah and one Ventrue: three vampires, two clans.
    // Counting vampires would pay him 3 and look entirely reasonable.
    const state = pass("Diversity", (s) => {
      s.seats[0]!.minions[0]!.clan = "Brujah";
      s.seats[1]!.minions[0]!.clan = "Brujah";
      s.seats[1]!.minions[1]!.clan = "Brujah";
      s.seats[1]!.minions.push(makeMinion("B3", "Bob", { clan: "Ventrue" }));
      s.seats[2]!.minions[0]!.clan = "Toreador";
    });
    expect(pools(state)).toEqual([11, 12, 11]);
  });

  it("NEGATIVE SPACE: a torpid vampire's clan and an ally do not count", () => {
    // Two ways to be excluded, asserted in the same seat as an included
    // vampire so the seat cannot read zero for the wrong reason.
    const state = pass("Diversity", (s) => {
      const bob = s.seats[1]!.minions;
      bob[0]!.clan = "Brujah";
      Object.assign(bob[1]!, { clan: "Ventrue", inTorpor: true });
      bob.push(makeMinion("A1", "Bob", { kind: "ally" }));
      s.seats[2]!.minions[0]!.clan = null; // clanless: nothing to count
    });
    expect(pools(state)).toEqual([10, 11, 10]);
  });
});

describe("The Final Nights (100731) — and the first failure clause in the pool", () => {
  it("PASSES: every vampire burns 1 blood, the caller's own included", () => {
    const state = pass("The Final Nights", (s) => {
      for (const seat of s.seats) for (const m of seat.minions) m.blood = 3;
    });
    for (const id of ["V1", "W", "M", "N"]) expect(minion(state, id).blood).toBe(2);
  });

  it("FAILS: only the acting vampire burns, and it still burns", () => {
    // The clause the engine gained `applyReferendumFailed` for. Read off
    // the other minions too: a failure that ran the PASS effect as well
    // would leave the caller at the same blood as this test expects.
    const state = fail("The Final Nights", (s) => {
      for (const seat of s.seats) for (const m of seat.minions) m.blood = 3;
    });
    expect(minion(state, "V1").blood).toBe(2);
    for (const id of ["W", "M", "N"]) expect(minion(state, id).blood).toBe(3);
  });

  it("NEGATIVE SPACE: the pass path does NOT charge the caller twice", () => {
    // The two clauses are alternatives. Wiring the failure hook where it
    // fires on both outcomes would take 2 blood from the caller here.
    const state = pass("The Final Nights", (s) => {
      for (const seat of s.seats) for (const m of seat.minions) m.blood = 4;
    });
    expect(minion(state, "V1").blood).toBe(3);
  });
});

describe("Consanguineous Condemnation (100411) — lock every vampire of a clan", () => {
  it("locks that clan across the whole table, the caller's own included", () => {
    const state = pass(
      "Consanguineous Condemnation",
      (s) => {
        s.seats[0]!.minions[0]!.clan = "Brujah";
        s.seats[1]!.minions[0]!.clan = "Brujah";
        s.seats[1]!.minions[1]!.clan = "Ventrue";
        s.seats[2]!.minions[0]!.clan = "Brujah";
      },
      "Brujah",
    );
    // V1 is the caller and locked at announcement anyway; W and N are
    // the ones this card locked.
    expect(minion(state, "W").locked).toBe(true);
    expect(minion(state, "N").locked).toBe(true);
    // NEGATIVE SPACE: the Ventrue in the same seat as a locked Brujah.
    expect(minion(state, "M").locked).toBe(false);
  });

  it("offers every clan in the POOL, not just the ones on the table [p. 49]", () => {
    // The Consanguineous Boon rule, and the reason both cards share one
    // terms enumeration. Nothing in this fixture has a clan at all.
    const { engine } = setup("Consanguineous Condemnation");
    announce(engine, "Consanguineous Condemnation");
    const terms = engine.decision()!.options.map((o) => o.id);
    expect(terms).toContain("terms:Brujah");
    expect(terms.length).toBeGreaterThan(10);
  });
});

describe("the admission path (§6)", () => {
  const reg = registry as unknown as CardRegistry;

  it("all five are in the pool, implemented, and named as printed", () => {
    const wrong = WAVE.filter(([id, name]) => {
      const e = reg.entries[id];
      return !e || !e.supported || e.card.name !== name;
    });
    expect(wrong.map(([id, name]) => `${name} (${id})`)).toEqual([]);
  });
});
