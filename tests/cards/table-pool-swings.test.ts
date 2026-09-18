/**
 * Table-wide pool swings (docs/table-pool-swings-design.md).
 *
 * Treaty of Tyre Enforced (102019), Political Stranglehold (101417),
 * Can't Take it with You (100289), Mark of the Damned (101167).
 *
 * Four referendums that hand EVERY Methuselah a bill or a windfall
 * counted from something they control. The assertions worth having are
 * about the seats whose tally is ZERO and about where the counted things
 * actually sit.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const politicalTrace = (prefix: string): Array<[string, string]> => [
  ["Alice", prefix],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
];

/** A caller with enough votes to pass unopposed, plus the card in hand. */
function callerWith(state: GameState, card: string): void {
  Object.assign(state.seats[0]!.minions[0]!, { title: "innerCircle", sect: "camarilla" });
  state.seats[0]!.hand.push({ id: "pa", name: card });
}

function pass(engine: VtesEngine, card: string): void {
  runTrace(engine, [
    ...politicalTrace(`play:${card}`),
    ["Alice", "vote:V1:for"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
}

function entry(id: string, name: string, tags: string[]): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags };
}

const pools = (s: GameState): number[] => s.seats.map((x) => x.pool);

describe("Treaty of Tyre Enforced (102019)", () => {
  it("charges X+1 — and charges the +1 to a Methuselah with no Banu Haqim", () => {
    const state = threeSeatGame();
    callerWith(state, "Treaty of Tyre Enforced");
    // The card prints "Assamite"; the registry clan is Banu Haqim.
    state.seats[1]!.minions[0]!.clan = "Banu Haqim";
    state.seats[1]!.minions[1]!.clan = "Banu Haqim";
    const engine = new VtesEngine(state, testRegistry);
    pass(engine, "Treaty of Tyre Enforced");
    // Alice 0 → 1, Bob 2 → 3, Carol 0 → 1. The seat with none still pays.
    expect(pools(state)).toEqual([9, 7, 9]);
  });
});

describe("Political Stranglehold (101417)", () => {
  it("pays 3 per capacity-8 vampire and can never be called twice in a game", () => {
    const state = threeSeatGame();
    callerWith(state, "Political Stranglehold");
    state.seats[0]!.minions[0]!.capacity = 9;
    state.seats[1]!.minions[0]!.capacity = 8;
    state.seats[1]!.minions[1]!.capacity = 7; // below the line
    const engine = new VtesEngine(state, testRegistry);
    pass(engine, "Political Stranglehold");
    expect(pools(state)).toEqual([13, 13, 10]);

    // A second copy is not offered, even to another Methuselah.
    state.seats[0]!.hand.push({ id: "ps2", name: "Political Stranglehold" });
    const ids = engine.decision()?.options.map((o) => o.id) ?? [];
    expect(ids.some((i) => i.startsWith("play:Political Stranglehold"))).toBe(false);
  });
});

describe("Can't Take it with You (100289)", () => {
  it("counts equipment and retainers ON MINIONS as well as locations in play", () => {
    const state = threeSeatGame();
    callerWith(state, "Can't Take it with You");
    // Bob: a location in his play area, a weapon and a retainer on W.
    state.seats[1]!.permanents.push(entry("loc", "The Barrens", ["location"]));
    state.seats[1]!.minions[0]!.attached.push(
      entry("gun", ".44 Magnum", ["equipment", "weapon", "gun"]),
      entry("ret", "Raven Spy", ["retainer"]),
    );
    const engine = new VtesEngine(state, testRegistry);
    pass(engine, "Can't Take it with You");
    // Everyone +1; Bob then −3. A seat with nothing in play comes out ahead.
    expect(pools(state)).toEqual([11, 8, 11]);
  });
});

describe("Mark of the Damned (101167)", () => {
  it("bills each Methuselah from their PREY's ash heap, vampires only", () => {
    const state = threeSeatGame();
    callerWith(state, "Mark of the Damned");
    // Alice's prey is Bob: two burnt vampires plus a library card there.
    state.seats[1]!.ashHeap = [
      { id: "a1", name: "Someone", crypt: true },
      { id: "a2", name: "Someone Else", crypt: true },
      { id: "a3", name: "Conditioning" },
    ];
    const engine = new VtesEngine(state, testRegistry);
    pass(engine, "Mark of the Damned");
    // Only Alice pays, and only 2 — the library card is not a vampire.
    expect(pools(state)).toEqual([8, 10, 10]);
  });
});

describe("the fixture's own vampires", () => {
  it("are not accidentally Banu Haqim, so the Treaty test means something", () => {
    const state = threeSeatGame();
    expect(state.seats.flatMap((s) => s.minions).every((m) => m.clan !== "Banu Haqim")).toBe(true);
  });
});
