/**
 * Legacy political actions, the pay-to-keep sweeps — tranche 1 wave 15
 * (docs/pool-widening-design.md §6).
 *
 * Jericho Founding (locations), Kindred Segregation (allies), Peace
 * Treaty (weapons).
 *
 * One referendum burns a whole category off the table and every
 * Methuselah is asked, card by card, whether to ransom theirs. The
 * failure shapes this file is written against:
 *
 *  - burning FIRST and refunding after. The question has to precede the
 *    burn (the Rutor's Hand rule), so a kept card must never have left
 *    play at all — asserted by its continued presence, not by a count.
 *  - a sweep that misses a seat. "ALL locations are burned" means every
 *    Methuselah's, the caller's own included.
 *  - the ransom offered when it cannot be paid. A seat too poor to pay
 *    must still be asked, and must be given only the burn.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";

const WAVE: Array<[number, string]> = [
  [101022, "Jericho Founding"],
  [101053, "Kindred Segregation"],
  [101380, "Peace Treaty"],
];

/** Real cards, so their pool costs come from the REGISTRY rather than
 *  from this file — a fixture inventing its own cost would prove nothing
 *  about "repaying THEIR pool cost". The three locations are deliberately
 *  DIFFERENT cards: the first draft gave two seats the same one, which is
 *  a unique-card contest, and the contest consumed the card before the
 *  sweep ever saw it. All three cost 2, as does the weapon. */
const LOCATIONS = ["Arcane Library", "Art Museum", "Academic Hunting Ground"];
const WEAPON = ".44 Magnum";
const ALLY = "Political Ally";

function permanent(id: string, name: string, tags: string[]): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags };
}

function setup(name: string, prepare: (s: GameState) => void = () => {}) {
  const state = threeSeatGame();
  // The caller is non-Camarilla so Jericho Founding is legal; the other
  // two cards do not care.
  state.seats[0]!.minions[0]!.sect = "independent";
  prepare(state);
  state.seats[0]!.hand.push({ id: "pa", name });
  return { state, engine: new VtesEngine(state, testRegistry) };
}

/** Announce and pass the referendum on the caller's own ballot, leaving
 *  the engine sitting on the first ransom question. */
function sweep(name: string, prepare: (s: GameState) => void) {
  const { state, engine } = setup(name, prepare);
  runTrace(engine, [
    ["Alice", `play:${name}`],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
    ["Alice", "vote:caller:for"],
  ]);
  return { state, engine };
}

/** Answer every ransom question with `pick`, which sees each question's
 *  options and returns the one to take. */
function answerAll(
  engine: VtesEngine,
  state: GameState,
  pick: (ids: string[]) => string,
): void {
  for (let i = 0; i < 40; i++) {
    const dp = engine.decision();
    if (!dp) return;
    const ids = dp.options.map((o) => o.id);
    const keep = ids.filter((o) => o.includes(":keepOrBurn:"));
    if (keep.length === 0) {
      if (!state.frames.some((f) => f.kind === "referendum" || f.kind === "choice")) return;
      runTrace(engine, [[dp.seat, ids.includes("pass") ? "pass" : ids[0]!]]);
      continue;
    }
    runTrace(engine, [[dp.seat, pick(keep)]]);
  }
}

const takeBurn = (ids: string[]): string => ids.find((o) => o.includes(":burn:"))!;
const takePayIfOffered = (ids: string[]): string =>
  ids.find((o) => o.includes(":pay:")) ?? ids.find((o) => o.includes(":burn:"))!;

const locIds = (s: GameState, i: number): string[] =>
  s.seats[i]!.permanents.filter((p) => p.tags.includes("location")).map((p) => p.card.id);
const weaponIds = (s: GameState, i: number): string[] =>
  s.seats[i]!.minions.flatMap((m) => m.attached.filter((p) => p.tags.includes("weapon")))
    .map((p) => p.card.id);
const allyIds = (s: GameState, i: number): string[] =>
  s.seats[i]!.minions.filter((m) => m.kind === "ally").map((m) => m.id);

describe("Jericho Founding (101022) — all locations burn unless ransomed", () => {
  const board = (s: GameState) => {
    s.seats[0]!.permanents.push(permanent("la", LOCATIONS[0]!, ["location"]));
    s.seats[1]!.permanents.push(permanent("lb", LOCATIONS[1]!, ["location"]));
    s.seats[2]!.permanents.push(permanent("lc", LOCATIONS[2]!, ["location"]));
  };

  it("burns every Methuselah's location, the CALLER's own included", () => {
    // "All locations" has no exception for the seat that called it, and a
    // sweep written from the caller's point of view would spare it.
    const { state, engine } = sweep("Jericho Founding", board);
    answerAll(engine, state, takeBurn);
    expect(locIds(state, 0)).toEqual([]);
    expect(locIds(state, 1)).toEqual([]);
    expect(locIds(state, 2)).toEqual([]);
  });

  it("a ransomed location never leaves play, and its cost is paid", () => {
    // The Rutor's Hand ordering: the question precedes the burn, so a
    // kept card was never burned rather than burned and restored.
    const { state, engine } = sweep("Jericho Founding", board);
    answerAll(engine, state, takePayIfOffered);
    expect(locIds(state, 1)).toEqual(["lb"]);
    // Art Museum costs 2 pool, taken from the seat that kept it.
    expect(state.seats[1]!.pool).toBe(8);
    // NEGATIVE SPACE: nothing was burned and re-created — no location
    // ever appears in a burn event.
    const burned = state.eventLog.filter(
      (e) => e.type === "PermanentBurned" && e.cardId === "lb",
    );
    expect(burned).toEqual([]);
  });

  it("a seat that cannot afford the ransom is still asked, and only offered the burn", () => {
    // Empty for the RIGHT reason: the question is raised, the pay arm is
    // absent because the pool is short, and the burn arm is there.
    const { state, engine } = sweep("Jericho Founding", (s) => {
      board(s);
      s.seats[1]!.pool = 1; // Art Museum costs 2
    });
    let sawBobsQuestion = false;
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const ids = dp.options.map((o) => o.id);
      const keep = ids.filter((o) => o.includes(":keepOrBurn:"));
      if (keep.length > 0 && dp.seat === "Bob") {
        sawBobsQuestion = true;
        expect(keep.some((o) => o.includes(":pay:"))).toBe(false);
        expect(keep.some((o) => o.includes(":burn:"))).toBe(true);
      }
      runTrace(engine, [
        [dp.seat, keep.length > 0 ? takePayIfOffered(keep) : ids.includes("pass") ? "pass" : ids[0]!],
      ]);
      if (!state.frames.some((f) => f.kind === "referendum" || f.kind === "choice")) break;
    }
    expect(sawBobsQuestion).toBe(true);
    expect(locIds(state, 1)).toEqual([]); // it burned
    expect(state.seats[1]!.pool).toBe(1); // and nothing was charged
  });

  it("requires a NON-Camarilla vampire to call it", () => {
    const offered = (sect: string): boolean =>
      setup("Jericho Founding", (s) => {
        board(s);
        s.seats[0]!.minions[0]!.sect = sect as never;
      })
        .engine.decision()!
        .options.some((o) => o.id.startsWith("play:Jericho Founding"));
    expect(offered("camarilla")).toBe(false);
    expect(offered("sabbat")).toBe(true);
    expect(offered("independent")).toBe(true);
  });
});

describe("Kindred Segregation (101053) — all allies burn unless ransomed", () => {
  const board = (s: GameState) => {
    s.seats[1]!.minions.push(makeMinion("a1", "Bob", { kind: "ally", name: ALLY }));
    s.seats[2]!.minions.push(makeMinion("a2", "Carol", { kind: "ally", name: ALLY }));
  };

  it("burns the allies and leaves every VAMPIRE alone", () => {
    // The filter that matters: allies are minions, and a sweep reading
    // "minion" instead of "ally" would empty the table.
    const { state, engine } = sweep("Kindred Segregation", board);
    answerAll(engine, state, takeBurn);
    expect(allyIds(state, 1)).toEqual([]);
    expect(allyIds(state, 2)).toEqual([]);
    expect(state.seats[1]!.minions.map((m) => m.id)).toEqual(["W", "M"]);
    expect(state.seats[0]!.minions.map((m) => m.id)).toEqual(["V1"]);
  });

  it("one seat can ransom while another lets theirs burn", () => {
    // Per-CARD questions, so the two seats are independent. A sweep that
    // asked once per seat, or once for the table, would tie them.
    const { state, engine } = sweep("Kindred Segregation", board);
    answerAll(engine, state, (ids) =>
      ids.some((o) => o.endsWith(":a1")) ? takePayIfOffered(ids) : takeBurn(ids),
    );
    expect(allyIds(state, 1)).toEqual(["a1"]);
    expect(allyIds(state, 2)).toEqual([]);
  });
});

describe("Peace Treaty (101380) — all weapons burn unless ransomed", () => {
  const board = (s: GameState) => {
    s.seats[1]!.minions[0]!.attached.push(permanent("w1", WEAPON, ["equipment", "weapon"]));
    s.seats[2]!.minions[0]!.attached.push(permanent("w2", WEAPON, ["equipment", "weapon"]));
    // NEGATIVE SPACE, on the table rather than in a comment: equipment
    // that is not a weapon must survive the sweep.
    s.seats[1]!.minions[1]!.attached.push(permanent("e1", "Laptop Computer", ["equipment"]));
  };

  it("burns weapons and leaves other equipment equipped", () => {
    const { state, engine } = sweep("Peace Treaty", board);
    answerAll(engine, state, takeBurn);
    expect(weaponIds(state, 1)).toEqual([]);
    expect(weaponIds(state, 2)).toEqual([]);
    const stillThere = state.seats[1]!.minions.flatMap((m) => m.attached.map((p) => p.card.id));
    expect(stillThere).toEqual(["e1"]);
  });

  it("a ransomed weapon stays equipped on the same minion", () => {
    const { state, engine } = sweep("Peace Treaty", board);
    answerAll(engine, state, takePayIfOffered);
    expect(state.seats[1]!.minions[0]!.attached.map((p) => p.card.id)).toEqual(["w1"]);
    expect(state.seats[1]!.pool).toBe(8); // .44 Magnum costs 2
  });
});

describe("the admission path (§6)", () => {
  const reg = registry as unknown as CardRegistry;

  it("all three are in the pool, implemented, and named as printed", () => {
    const wrong = WAVE.filter(([id, name]) => {
      const e = reg.entries[id];
      return !e || !e.supported || e.card.name !== name;
    });
    expect(wrong.map(([id, name]) => `${name} (${id})`)).toEqual([]);
  });

  it("the ransom is the card's PRINTED pool cost, read from the registry", () => {
    // The costs the tests above assert, pinned to their source. If any of
    // these is ever reprinted at a different cost the numbers above move,
    // and this says why rather than leaving magic numbers in assertions.
    const cost = (name: string): number => {
      const card = Object.values(reg.entries).find((e) => e.card.name === name)!.card;
      // A crypt card has no pool cost at all, so the narrowing is the
      // assertion that these are library cards as well as the lookup.
      return card.kind === "library" ? (card.poolCost ?? 0) : -1;
    };
    expect(cost(LOCATIONS[1]!)).toBe(2);
    expect(cost(WEAPON)).toBe(2);
  });
});
