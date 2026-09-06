/**
 * The ash heap (docs/ash-heap-design.md) — the ZONE, separately from the
 * cards that read it.
 *
 * Built on owner decision 2026-09-01, after a survey found nine
 * unsupported cards blocked on it. Every assertion here is a rulebook
 * quote, because p. 16 and the glossary settle what would otherwise be
 * readings: the zone is public, keyed on OWNER, and removal from the game
 * is a different fate from burning.
 */

import { describe, expect, it } from "vitest";
import type { CardInstance, GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, redactFor, viewFor } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "./fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function heap(state: GameState, seat: string): CardInstance[] {
  return state.seats.find((s) => s.id === seat)?.ashHeap ?? [];
}

function names(state: GameState, seat: string): string[] {
  return heap(state, seat).map((c) => c.name);
}

/** Answer everything the cheapest way until `prefix` is offered. */
function walkTo(engine: VtesEngine, prefix: string, limit = 60): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return false;
}

describe("the ash heap: the four ways in", () => {
  it("a DISCARDED card goes to its owner's heap", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "a0", name: "Blood Doll" });
    const engine = new VtesEngine(state, testRegistry);
    expect(walkTo(engine, "discard:a0")).toBe(true);
    runTrace(engine, [["Alice", "discard:a0"]]);
    expect(names(state, "Alice")).toContain("Blood Doll");
  });

  it("a played card goes there UPON RESOLUTION (p. 8) — but not one that entered play", () => {
    const state = threeSeatGame();
    // Blood Doll is a master that ENTERS PLAY; Villein resolves and goes.
    state.seats[0]!.hand.push({ id: "a0", name: "Blood Doll" });
    const engine = new VtesEngine(state, testRegistry);
    expect(walkTo(engine, "play:Blood Doll")).toBe(true);
    const id = engine.decision()!.options.find((o) => o.id.startsWith("play:Blood Doll"))!.id;
    runTrace(engine, [
      ["Alice", id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // It is in play — ATTACHED to a vampire, not at seat level; Blood
    // Doll is "put on a vampire" — so it must NOT also be in the heap.
    // Double-filing is the failure this condition exists to prevent.
    const inPlay = state.seats
      .flatMap((s) => [...s.permanents, ...s.minions.flatMap((m) => m.attached)])
      .some((p) => p.card.name === "Blood Doll");
    expect(inPlay).toBe(true);
    expect(names(state, "Alice")).not.toContain("Blood Doll");
  });

  it("…and lands there when it later leaves play", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push({
      card: { id: "bd", name: "Blood Doll" },
      controller: "Alice",
      owner: "Alice",
      statics: {},
      tags: ["Blood Doll"],
      locked: false,
      usedThisPhase: false,
    });
    const engine = new VtesEngine(state, testRegistry);
    (engine as unknown as { burnPermanent(id: string): void }).burnPermanent("bd");
    expect(names(state, "Alice")).toEqual(["Blood Doll"]);
  });

  it("A BURNED CARD GOES TO ITS OWNER'S HEAP, NOT ITS CONTROLLER'S (p. 16)", () => {
    // The distinction is live: a master played on another Methuselah's
    // minion is controlled by the player who played it (p. 16), but it
    // came from — and returns to — its owner's deck.
    const state = threeSeatGame();
    find(state, "M").attached.push({
      card: { id: "px", name: "Pentex™ Subversion" },
      controller: "Alice", // played by Alice…
      owner: "Bob", // …but this fixture says Bob owns the card
      statics: {},
      tags: ["Pentex™ Subversion"],
      locked: false,
      usedThisPhase: false,
    });
    const engine = new VtesEngine(state, testRegistry);
    (engine as unknown as { burnPermanent(id: string): void }).burnPermanent("px");
    expect(names(state, "Bob")).toContain("Pentex™ Subversion");
    expect(names(state, "Alice")).not.toContain("Pentex™ Subversion");
  });
});

describe("the ash heap is PUBLIC (p. 16)", () => {
  const seeded = (): GameState => {
    const state = threeSeatGame();
    state.seats[1]!.ashHeap = [{ id: "b9", name: "Govern the Unaligned" }];
    return state;
  };

  it("redactFor shows another Methuselah's heap in full — the only unmasked zone", () => {
    const state = seeded();
    const view = redactFor(state, "Alice");
    const bob = view.seats.find((s) => s.id === "Bob")!;
    expect(bob.ashHeap?.map((c) => c.name)).toEqual(["Govern the Unaligned"]);
    // The control case: their HAND and library are still masked, so this
    // is not passing because redaction is off altogether.
    expect(bob.hand.every((c) => c.name === "")).toBe(true);
    expect(bob.library.every((c) => c.name === "")).toBe(true);
  });

  it("PlayerView carries it too", () => {
    const view = viewFor(seeded(), "Alice");
    const bob = view.seats.find((s) => s.id === "Bob")!;
    expect(bob.ashHeap.map((c) => c.name)).toEqual(["Govern the Unaligned"]);
  });
});

describe("removal from the game is NOT the ash heap (p. 16)", () => {
  it("a removed card leaves the state entirely — there is no zone for it", () => {
    const state = threeSeatGame();
    state.seats[1]!.ashHeap = [
      { id: "b1", name: "Govern the Unaligned" },
      { id: "b2", name: "Conditioning" },
    ];
    const engine = new VtesEngine(state, testRegistry);
    (
      engine as unknown as { removeFromAshHeap(s: string, c: string): void }
    ).removeFromAshHeap("Bob", "b1");
    expect(names(state, "Bob")).toEqual(["Conditioning"]);
    // "…cannot be retrieved or affected in any way": it is in no zone at
    // all, so nothing can name it again.
    expect(
      state.seats.some((s) => (s.ashHeap ?? []).some((c) => c.id === "b1")),
    ).toBe(false);
  });
});
