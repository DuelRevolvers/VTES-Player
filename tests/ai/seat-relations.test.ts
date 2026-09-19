/**
 * Seat relationships — one helper, four relations
 * (docs/ai-seat-relationships-design.md).
 *
 * The ring assertions are HAND-WRITTEN tables rather than a loop, on
 * purpose: a loop that recomputes the thing it is checking passes when
 * the thing is wrong, which is the whole failure mode this file is here
 * to prevent.
 */

import { describe, expect, it } from "vitest";
import { predatorOf, preyOf, relationTo, relations, type SeatRing } from "../../src/ai/seats.ts";
import { viewFor } from "../../src/engine/agent.ts";
import { threeSeatGame } from "../engine/fixtures.ts";

/** A ring of `n` seats named S1…Sn, with the named ones ousted. */
function ring(n: number, ousted: string[] = []): SeatRing {
  return {
    seats: Array.from({ length: n }, (_, i) => ({
      id: `S${i + 1}`,
      ousted: ousted.includes(`S${i + 1}`),
    })),
  };
}

describe("the ring", () => {
  it("puts your prey on your left and your predator on your right (p. 15)", () => {
    const r = ring(4);
    expect(preyOf(r, "S1")).toBe("S2");
    expect(preyOf(r, "S2")).toBe("S3");
    expect(preyOf(r, "S3")).toBe("S4");
    expect(preyOf(r, "S4")).toBe("S1");

    expect(predatorOf(r, "S1")).toBe("S4");
    expect(predatorOf(r, "S2")).toBe("S1");
    expect(predatorOf(r, "S3")).toBe("S2");
    expect(predatorOf(r, "S4")).toBe("S3");
  });

  it("relates every seat at a five-seat table", () => {
    const r = ring(5);
    expect(relations(r, "S1")).toEqual({
      S1: "me",
      S2: "prey",
      S3: "cross",
      S4: "cross",
      S5: "predator",
    });
  });

  it("names three at a three-seat table, with nobody cross", () => {
    expect(relations(ring(3), "S2")).toEqual({ S1: "predator", S2: "me", S3: "prey" });
  });

  it("has nothing to say at a table of one", () => {
    expect(preyOf(ring(1), "S1")).toBeNull();
    expect(predatorOf(ring(1), "S1")).toBeNull();
    expect(relationTo(ring(1), "S1", "S1")).toBe("me");
  });

  it("returns null for a seat that is not in the ring at all", () => {
    // A derived read must be TOTAL: a seat id can outlive the seat.
    expect(preyOf(ring(3), "nobody")).toBeNull();
    expect(predatorOf(ring(3), "nobody")).toBeNull();
  });
});

describe("ousted seats leave the ring before it is walked", () => {
  it("does not make a live neighbour cross-table", () => {
    // S2 and S3 are gone, so S1's prey is S4 — not S2, and not "cross".
    const r = ring(5, ["S2", "S3"]);
    expect(preyOf(r, "S1")).toBe("S4");
    expect(predatorOf(r, "S1")).toBe("S5");
    expect(relationTo(r, "S1", "S4")).toBe("prey");
  });

  it("still answers for the ousted seat itself, as cross", () => {
    // `relations` covers every seat including the dead ones, so a caller
    // walking a set of terms that names a departed seat gets a relation
    // rather than an undefined that reads as a silent zero.
    const r = ring(4, ["S3"]);
    expect(relations(r, "S1")["S3"]).toBe("cross");
  });

  it("collapses to a heads-up game when everyone else is gone", () => {
    const r = ring(4, ["S3", "S4"]);
    expect(preyOf(r, "S1")).toBe("S2");
    expect(predatorOf(r, "S1")).toBe("S2");
  });
});

describe("the two-seat tie", () => {
  it("resolves to PREY, which is the relation that scores", () => {
    // The same seat is both. You get the victory point for ousting them
    // (p. 44), so a heads-up game is about who ousts whom.
    const r = ring(2);
    expect(preyOf(r, "S1")).toBe("S2");
    expect(predatorOf(r, "S1")).toBe("S2");
    expect(relationTo(r, "S1", "S2")).toBe("prey");
    expect(relations(r, "S1")).toEqual({ S1: "me", S2: "prey" });
  });

  it("never calls you cross-table to yourself", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(relationTo(ring(n), "S1", "S1")).toBe("me");
    }
  });
});

describe("the policy and the search now agree", () => {
  it("gives the same answer for a PlayerView and the GameState behind it", () => {
    // These were two implementations of one question until 2026-09-18:
    // `preyOf` in heuristic.ts and `neighbour(state, me, ±1)` in
    // search.ts. One helper serves both shapes, so they cannot drift.
    const state = threeSeatGame();
    for (const seat of ["Alice", "Bob", "Carol"]) {
      const view = viewFor(state, seat);
      expect(preyOf(view, seat)).toBe(preyOf(state, seat));
      expect(predatorOf(view, seat)).toBe(predatorOf(state, seat));
    }
  });

  it("agrees that prey and predator are different seats at three", () => {
    const state = threeSeatGame();
    expect(preyOf(state, "Alice")).toBe("Bob");
    expect(predatorOf(state, "Alice")).toBe("Carol");
  });
});
