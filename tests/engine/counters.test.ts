/**
 * Counters infrastructure (docs/counters-design.md, Gate 8): the shared
 * `counters` field on cards in play, plus the enter-with-N-counters,
 * add, and remove (clamped) primitives. The ~19 counter cards themselves
 * are bespoke one-offs built on top of this — this kernel test validates
 * the shared field they will all use.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "./fixtures.ts";

describe("card counters", () => {
  it("enters play with a starting count, then adds and removes (clamped)", () => {
    const engine = new VtesEngine(threeSeatGame(), testRegistry);
    const state = engine.state;

    // "Put this card in play with 2 counters."
    engine.putPermanentInPlay({
      card: { id: "loc1", name: "Test Counter Location" },
      seat: "Alice",
      attachTo: null,
      statics: {},
      tags: ["location"],
      counters: 2,
    });
    const perm = () => state.seats[0]!.permanents.find((p) => p.card.id === "loc1")!;
    expect(perm().counters).toBe(2);

    engine.addCounters("loc1", 3);
    expect(perm().counters).toBe(5);

    engine.removeCounters("loc1", 2);
    expect(perm().counters).toBe(3);

    // Removing more than present clamps at zero — never negative.
    engine.removeCounters("loc1", 10);
    expect(perm().counters).toBe(0);

    // Every change is event-sourced (replayable).
    const changes = state.eventLog.filter((e) => e.type === "CountersChanged");
    expect(changes.length).toBe(3);
  });

  it("defaults to undefined counters for permanents that don't use them", () => {
    const engine = new VtesEngine(threeSeatGame(), testRegistry);
    engine.putPermanentInPlay({
      card: { id: "loc2", name: "Plain Location" },
      seat: "Alice",
      attachTo: null,
      statics: {},
      tags: ["location"],
    });
    const perm = engine.state.seats[0]!.permanents.find((p) => p.card.id === "loc2")!;
    expect(perm.counters).toBeUndefined();
  });
});
