/**
 * Dealing a real game from real decks (docs/fresh-game-design.md).
 *
 * Until now the client could only start from a hand-authored MID-GAME
 * snapshot: vampires already in play, counters already spent. Nothing
 * dealt a fresh table, which is what the lobby and the deck importer both
 * need before either can be tested.
 *
 * The decks here are BUILT FROM THE REGISTRY rather than hand-written, for
 * the reason the library audit gave: a fixture that names cards can quietly
 * stop matching the pool, and this one has to keep proving the setup rather
 * than proving a deck list.
 */

import { describe, expect, it } from "vitest";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";
import type { DeckList, GameSetup } from "../../src/ui/decks.ts";
import {
  buildGame,
  MAX_LIBRARY,
  MIN_CRYPT,
  MIN_LIBRARY,
  STARTING_HAND,
  STARTING_POOL,
  STARTING_UNCONTROLLED,
  validateDecks,
} from "../../src/ui/decks.ts";
import { LocalTransport } from "../../src/ui/transport.ts";
import { buildTable } from "../../src/ui/newgame.ts";
import { supportedPrecons } from "../../src/ui/deckimport.ts";

const reg = registry as unknown as CardRegistry;

/** The supported pool, as a deck builder would see it. */
const cryptIds = Object.values(reg.entries)
  .filter((e) => e.card.kind === "crypt" && e.supported)
  .map((e) => e.card.id)
  .sort((a, b) => a - b);
const libraryNames = Object.values(reg.entries)
  .filter((e) => e.card.kind === "library" && e.supported)
  .map((e) => e.card.name)
  .sort();

/** A legal deck: 12 crypt cards and 60 library cards, one entry per copy. */
function deckFor(seat: string, offset: number): DeckList {
  return {
    kind: "deck",
    seat,
    crypt: Array.from({ length: MIN_CRYPT }, (_, i) => ({
      id: cryptIds[(offset * 13 + i) % cryptIds.length]!,
    })),
    library: Array.from(
      { length: MIN_LIBRARY },
      (_, i) => libraryNames[(offset * 71 + i) % libraryNames.length]!,
    ),
  };
}

const decks = ["Alice", "Bob", "Carol"].map((s, i) => deckFor(s, i));
const setup: GameSetup = { decks, seed: 12345, maxTurns: 60 };

describe("dealing a fresh game", () => {
  it("deals the p. 14 opening: 30 pool, seven in hand, four uncontrolled", () => {
    const state = buildGame(setup);
    expect(state.seats).toHaveLength(3);
    for (const s of state.seats) {
      expect(s.pool).toBe(STARTING_POOL);
      expect(s.hand).toHaveLength(STARTING_HAND);
      expect(s.uncontrolled).toHaveLength(STARTING_UNCONTROLLED);
      expect(s.library).toHaveLength(MIN_LIBRARY - STARTING_HAND);
      expect(s.crypt).toHaveLength(MIN_CRYPT - STARTING_UNCONTROLLED);
      // NOTHING is in play. That is the whole difference from a snapshot:
      // the opening turns are the game, not something to skip past.
      expect(s.minions).toEqual([]);
      expect(s.permanents).toEqual([]);
      // The four dealt vampires carry no counters yet — influence has not
      // happened (p. 35).
      expect(s.uncontrolled.every((u) => u.counters === 0)).toBe(true);
    }
  });

  it("shuffles, and shuffles each seat differently", () => {
    const state = buildGame(setup);
    const inOrder = decks[0]!.library.slice(0, STARTING_HAND);
    const dealt = state.seats.find((s) => s.id === "Alice")!.hand.map((c) => c.name);
    expect(dealt).not.toEqual(inOrder);
    // Two seats dealt from the same shuffled stream would be a seeding bug.
    const bob = state.seats.find((s) => s.id === "Bob")!.hand.map((c) => c.name);
    expect(bob).not.toEqual(dealt);
  });

  it("keeps every card: what was dealt is exactly what was in the deck", () => {
    const state = buildGame(setup);
    const alice = state.seats.find((s) => s.id === "Alice")!;
    const dealt = [...alice.hand, ...alice.library].map((c) => c.name).sort();
    expect(dealt).toEqual([...decks[0]!.library].sort());
    expect(alice.uncontrolled.length + alice.crypt.length).toBe(MIN_CRYPT);
    // Ids are unique, or the engine cannot tell two copies apart.
    const ids = [...alice.hand, ...alice.library].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is reproducible from its seed, and a different seed deals differently", () => {
    const a = buildGame(setup);
    const b = buildGame(setup);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const c = buildGame({ ...setup, seed: setup.seed + 1 });
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });
});

describe("who goes first", () => {
  it("is chosen at random, from the seed (p. 14)", () => {
    // Over a spread of seeds the first seat must actually move; a deal
    // that always starts with seat 0 is not the rulebook's setup.
    const firsts = new Set(
      Array.from({ length: 40 }, (_, i) => buildGame({ ...setup, seed: i + 1 }).seats[0]!.id),
    );
    expect(firsts.size).toBeGreaterThan(1);
  });

  it("rotates the table rather than reordering it, so neighbours are kept", () => {
    // Your prey is the Methuselah on your left. Choosing a starter must
    // change where the cycle STARTS, never who is next to whom.
    const seated = decks.map((d) => d.seat);
    for (let seed = 1; seed <= 20; seed++) {
      const order = buildGame({ ...setup, seed }).seats.map((s) => s.id);
      const at = seated.indexOf(order[0]!);
      expect(order).toEqual([...seated.slice(at), ...seated.slice(0, at)]);
    }
  });

  it("honours an explicitly named first seat, which is what a lobby sets", () => {
    for (const seat of ["Alice", "Bob", "Carol"]) {
      expect(buildGame({ ...setup, firstSeat: seat }).seats[0]!.id).toBe(seat);
    }
  });

  it("leaves a snapshot alone — every saved game expects seat 0 to lead", () => {
    // The RNG is only touched when the choice is actually being made, so
    // adding this could not have changed an existing game's deal.
    const snap: GameSetup = {
      seed: 7,
      maxTurns: 10,
      decks: [
        { seat: "A", ready: [], uncontrolled: [], crypt: [], library: [], pool: 30 },
        { seat: "B", ready: [], uncontrolled: [], crypt: [], library: [], pool: 30 },
      ],
    };
    expect(buildGame(snap).seats[0]!.id).toBe("A");
  });
});

/**
 * WHO SITS WHERE, decided at the deal (owner request 2026-09-07: "make it
 * random who sits where … don't pre-set who will be everyone's prey and
 * predator until the game starts").
 *
 * This is a different question from `firstSeat`, and that is the whole
 * point of it: rotating the cycle changes who leads and nobody's
 * neighbours, so a lobby row was still a seating chart. Shuffling the
 * seats is what makes the lobby order mean nothing.
 */
describe("random seating", () => {
  /** Six seats, so a shuffle that did nothing is a 1-in-720 coincidence
   *  rather than a coin flip — a two-seat table cannot tell the two
   *  apart, and neither could a test built on one. */
  const six = ["A", "B", "C", "D", "E", "F"].map((s, i) => deckFor(s, i));
  const order = (setup: GameSetup): string[] => buildGame(setup).seats.map((s) => s.id);

  it("shuffles the table when asked, and keeps the seed reproducible", () => {
    const base: GameSetup = { decks: six, seed: 99, maxTurns: 60, randomSeating: true };
    const dealt = order(base);
    expect([...dealt].sort()).toEqual(["A", "B", "C", "D", "E", "F"]);
    // Not the order it was handed. `firstSeat` is pinned so this cannot
    // pass on the rotation alone — the ROTATION was already random, and a
    // test that let it in would prove nothing about seating.
    const pinned = order({ ...base, firstSeat: "A" });
    expect(pinned[0]).toBe("A");
    expect(pinned).not.toEqual(["A", "B", "C", "D", "E", "F"]);
    // Same seed, same table: this is still a replay, not a coin toss.
    expect(order(base)).toEqual(dealt);
  });

  it("leaves the order alone when it is not asked for", () => {
    // The negative control, and the reason the flag is opt-in: every
    // hand-authored snapshot and saved game is written in seat order and
    // must keep replaying identically.
    expect(order({ decks: six, seed: 99, maxTurns: 60 })).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
    ]);
  });

  it("is what a table built from the lobby asks for", () => {
    // A deferral is a claim about the code as it was: this pins that the
    // flag is actually SET on the path the game is really dealt from,
    // not merely honoured by `buildGame`.
    const precon = supportedPrecons().find((p) => p.playable)!;
    const built = buildTable({
      seats: [
        { name: "Alice", kind: "you", deck: { kind: "precon", set: precon.set, name: precon.name } },
        { name: "Bob", kind: "ai", deck: { kind: "precon", set: precon.set, name: precon.name } },
      ],
      seed: 5,
      maxTurns: null,
      privateGame: true,
    });
    expect(built.setup?.randomSeating).toBe(true);
  });
});

describe("validating a real deck", () => {
  const legal = deckFor("Alice", 0);

  it("passes a legal deck", () => {
    const check = validateDecks([legal]);
    expect(check.illegalDecks).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it("refuses a crypt under 12 and a library outside 60-90 (p. 14)", () => {
    const small = validateDecks([{ ...legal, crypt: legal.crypt.slice(0, 11) }]);
    expect(small.ok).toBe(false);
    expect(small.illegalDecks[0]!.problem).toContain("11");

    const short = validateDecks([{ ...legal, library: legal.library.slice(0, 59) }]);
    expect(short.ok).toBe(false);
    const long = validateDecks([
      { ...legal, library: [...legal.library, ...legal.library].slice(0, MAX_LIBRARY + 1) },
    ]);
    expect(long.ok).toBe(false);
    // ...and exactly 60 and exactly 90 are legal, since the limits are
    // inclusive.
    expect(validateDecks([{ ...legal, library: legal.library.slice(0, MIN_LIBRARY) }]).ok).toBe(
      true,
    );
  });

  it("does not judge a snapshot by the deck limits", () => {
    // A mid-game position is not a deck and is meant to be small.
    const check = validateDecks([
      { seat: "A", ready: [], uncontrolled: [], crypt: [], library: ["Blood Doll"], pool: 30 },
    ]);
    expect(check.illegalDecks).toEqual([]);
  });

  it("does not ask a dealt game to account for its pool", () => {
    // The ledger exists because a snapshot must have PAID for the vampires
    // it starts with. A dealt game starts with none and always has 30.
    expect(validateDecks([legal]).poolMismatches).toEqual([]);
  });
});

describe("a dealt game is playable", () => {
  it("plays from an empty table to a finish", async () => {
    // The real question this whole path exists to answer: the engine has
    // only ever been started mid-game, so nothing had checked that a seat
    // with NO minions can take a turn at all.
    const t = new LocalTransport({ setup });
    let steps = 0;
    for (;;) {
      const dp = t.decision();
      if (!dp) break;
      expect(dp.options.length).toBeGreaterThan(0);
      await t.choose(dp.options[steps % dp.options.length]!.id);
      if (++steps > 20000) throw new Error("a dealt game did not terminate");
    }
    expect(steps).toBeGreaterThan(100);
  });

  it("lets the first turns be spent influencing, which is the opening", () => {
    const t = new LocalTransport({ setup });
    const state = t.view();
    // Turn 1, and the first Methuselah has one transfer (p. 24): the ramp
    // is what makes an empty table a game rather than a stall.
    const turn = state.frames.find((f) => f.kind === "turn")!;
    expect(turn.kind === "turn" && turn.turnNumber).toBe(1);
  });

  it("puts an influenced vampire into play with its blood (p. 35-36)", async () => {
    const t = new LocalTransport({ setup, autoPass: { Alice: true, Bob: true, Carol: true } });
    // Influence, and nothing else, until some seat controls a vampire.
    // `inf:out` before `inf:add`: moving a fully-influenced vampire to the
    // ready region is the last step, and a walker that only ever adds
    // counters would sit at capacity for ever and prove nothing.
    for (let i = 0; i < 4000; i++) {
      const dp = t.decision();
      if (!dp) break;
      if (t.view().seats.some((s) => s.minions.length > 0)) break;
      const out = dp.options.find((o) => o.id.startsWith("inf:out"));
      const add = dp.options.find((o) => o.id.startsWith("inf:add"));
      await t.choose((out ?? add ?? dp.options[0]!).id);
    }
    const withMinion = t.view().seats.find((s) => s.minions.length > 0);
    expect(withMinion).toBeDefined();
    const v = withMinion!.minions[0]!;
    // The counters spent became its blood, and its controller paid for it.
    expect(v.blood).toBe(v.capacity);
    expect(withMinion!.pool).toBe(STARTING_POOL - v.capacity);
  });
});
