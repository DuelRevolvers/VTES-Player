/**
 * The debug UI's deck layer and its replay-based undo
 * (docs/debug-ui-design.md §5, §6).
 *
 * Headless validation of the thing the browser will do: the shipped
 * playtest decks must validate, build a legal game, play to completion
 * without the engine ever offering an empty decision, and replay
 * identically — because undo IS a replay.
 */

import { describe, expect, it } from "vitest";
import playtestDecks from "../../config/playtest-decks.json";
import registry from "../../src/cards/registry.json";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import type { DeckDef, GameSetup } from "../../src/ui/decks.ts";
import { buildGame, STARTING_POOL, validateDecks } from "../../src/ui/decks.ts";
import { imageFor } from "../../src/ui/cardinfo.ts";
import { replay, undo } from "../../src/ui/history.ts";

const config = playtestDecks as unknown as {
  seed: number;
  maxTurns: number | null;
  decks: DeckDef[];
};

const setup: GameSetup = {
  decks: config.decks,
  seed: config.seed,
  // The real config runs unlimited; tests need a bound.
  maxTurns: 40,
};

/** Deterministic pseudo-random agent, independent of the engine's RNG. */
function pick(seed: { n: number }, count: number): number {
  seed.n = (seed.n * 1103515245 + 12345) & 0x7fffffff;
  return seed.n % count;
}

describe("playtest decks", () => {
  it("contain only registered, implemented library cards and real crypt ids", () => {
    const check = validateDecks(config.decks);
    expect(check.unknown).toEqual([]);
    expect(check.unsupported).toEqual([]);
    expect(check.badCryptIds).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it("use only crypt cards whose printed ability is empty", () => {
    // Crypt abilities are unimplemented (0/217, phase 7), so a playtest deck
    // must not contain a vampire whose card text silently does nothing.
    expect(validateDecks(config.decks).inertAbilities).toEqual([]);
  });

  it("start with a pool that actually paid for the vampires in play", () => {
    // A mid-game snapshot is not a free lunch. Influence moves counters
    // one-for-one from pool onto an uncontrolled vampire, and the counters
    // become its blood when it comes under control (p. 35, p. 36) — so a
    // seat holding two ready vampires has spent their combined capacity.
    // Starting everyone at a full 30 pool is a position no sequence of
    // legal plays could reach, and it quietly distorts every pool-economy
    // card in the game.
    expect(validateDecks(config.decks).poolMismatches).toEqual([]);
  });

  it("charges capacity for ready vampires and counters for uncontrolled ones", () => {
    // The ledger itself, so the guard above cannot pass by being empty.
    for (const deck of config.decks) {
      const state = buildGame(setup);
      const seat = state.seats.find((s) => s.id === deck.seat)!;
      const readyCapacity = seat.minions.reduce((n, m) => n + m.capacity, 0);
      const counters = seat.uncontrolled.reduce((n, u) => n + u.counters, 0);
      expect(seat.pool + readyCapacity + counters).toBe(STARTING_POOL);
      // Crypt vampires are unpaid-for: they have not been influenced.
      expect(seat.crypt.length).toBeGreaterThan(0);
    }
  });

  it("read real stats off the registry for each vampire", () => {
    const state = buildGame(setup);
    const first = state.seats[0]!.minions[0]!;
    // Andi Liu (G6): Camarilla Prince of Taipei, capacity 6, superior Dominate.
    expect(first.name).toBe("Andi Liu (G6)");
    expect(first.capacity).toBe(6);
    expect(first.clan).toBe("Malkavian");
    expect(first.sect).toBe("camarilla");
    expect(first.title).toBe("prince");
    // The registry stores crypt disciplines capitalised ("Dom"); the engine
    // and every card spec want the lowercase code.
    expect(first.disciplines["dom"]).toBe("superior");
  });

  it("give every card in every deck a KRCG scan URL", () => {
    for (const deck of config.decks) {
      for (const name of deck.library) {
        expect(imageFor(name), `no scan for ${name}`).toBeTruthy();
      }
    }
    const state = buildGame(setup);
    for (const seat of state.seats) {
      for (const m of [...seat.minions, ...seat.crypt]) {
        expect(imageFor(m.name), `no scan for ${m.name}`).toBeTruthy();
      }
      for (const u of seat.uncontrolled) {
        expect(imageFor(u.card.name), `no scan for ${u.card.name}`).toBeTruthy();
      }
    }
  });

  it("catches a bad deck rather than silently dropping the card", () => {
    // The unsupported example is DERIVED, not named: hard-coding one meant
    // this test broke the day that card was implemented (it was Hedonism).
    //
    // As of 2026-09-03 **every library card is supported**, so there is no
    // longer a real card to use for the unsupported half. Rather than let
    // the whole test quietly become vacuous — the "empty for the wrong
    // reason" shape this project keeps finding in cards — the two halves
    // are asserted separately, and the unsupported half asserts the fact
    // that makes it unreachable. It comes back on its own if the pool ever
    // widens past what is implemented.
    const unimplemented = Object.values(
      (registry as { entries: Record<string, { card: { kind: string; name: string }; supported: boolean }> })
        .entries,
    ).find((e) => e.card.kind === "library" && !e.supported)?.card.name;

    const bad: DeckDef[] = [
      {
        ...config.decks[0]!,
        library: [
          "Govern the Unaligned",
          "Not A Real Card",
          ...(unimplemented ? [unimplemented] : []),
        ],
      },
    ];
    const check = validateDecks(bad);
    expect(check.ok).toBe(false);
    expect(check.unknown).toContain("Not A Real Card");
    if (unimplemented) {
      expect(check.unsupported).toContain(unimplemented);
    } else {
      // The library is complete — that is WHY there is nothing to report,
      // and asserting it keeps this branch honest rather than skipped.
      const libraryCards = Object.values(
        (registry as { entries: Record<string, { card: { kind: string }; supported: boolean }> })
          .entries,
      ).filter((e) => e.card.kind === "library");
      expect(libraryCards.every((e) => e.supported)).toBe(true);
      expect(check.unsupported).toEqual([]);
    }
  });

  it("build a legal starting state with every zone populated", () => {
    const state = buildGame(setup);
    expect(state.seats).toHaveLength(3);
    for (const seat of state.seats) {
      // Not 30: this is a mid-game snapshot and the vampires already in
      // play were paid for out of that 30 (see the pool ledger above).
      expect(seat.pool).toBeGreaterThan(0);
      expect(seat.pool).toBeLessThan(STARTING_POOL);
      expect(seat.hand).toHaveLength(7);
      expect(seat.minions.length).toBeGreaterThan(0);
      expect(seat.uncontrolled.length).toBeGreaterThan(0);
      expect(seat.crypt.length).toBeGreaterThan(0);
      expect(seat.library.length).toBeGreaterThan(0);
      // Minion ids must be unique across the whole table.
      for (const m of seat.minions) expect(m.controller).toBe(seat.id);
    }
    const ids = state.seats.flatMap((s) => [
      ...s.minions.map((m) => m.id),
      ...s.uncontrolled.map((u) => u.card.id),
      ...s.crypt.map((m) => m.id),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("play a full game with no empty or duplicated decision", () => {
    const engine = new VtesEngine(buildGame(setup), buildHandlerRegistry());
    const rng = { n: 99 };
    let steps = 0;
    for (;;) {
      const dp = engine.decision();
      if (!dp) break;
      expect(dp.options.length).toBeGreaterThan(0);
      const ids = dp.options.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
      engine.choose(ids[pick(rng, ids.length)]!);
      if (++steps > 20000) throw new Error("game did not terminate");
    }
    expect(steps).toBeGreaterThan(50);
  });

  it("replays a command log to an identical state — the basis of undo", () => {
    const engine = new VtesEngine(buildGame(setup), buildHandlerRegistry());
    const rng = { n: 7 };
    for (let i = 0; i < 300; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const ids = dp.options.map((o) => o.id);
      engine.choose(ids[pick(rng, ids.length)]!);
    }
    const commands = [...engine.state.commandLog];
    const replayed = replay(setup, commands);
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(engine.state));
  });

  it("undo steps back exactly one decision and stays playable", () => {
    const engine = new VtesEngine(buildGame(setup), buildHandlerRegistry());
    const rng = { n: 21 };
    for (let i = 0; i < 120; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const ids = dp.options.map((o) => o.id);
      engine.choose(ids[pick(rng, ids.length)]!);
    }
    const before = [...engine.state.commandLog];
    const stepped = undo(setup, before, 1);
    expect(stepped.state.commandLog).toHaveLength(before.length - 1);
    // And the resulting position is a real one the engine can carry on from.
    const dp = stepped.decision();
    expect(dp).not.toBeNull();
    expect(dp!.options.length).toBeGreaterThan(0);
  });
});
