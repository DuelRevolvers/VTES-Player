/**
 * Stores you fill yourself (docs/stores-you-fill-design.md).
 *
 * Threestar Cab Company (101980), Grand Temple of Set (100848),
 * Arcanum Chapterhouse, Alexandria (100082).
 *
 * Two locations you build up and then spend — on blood, or on buying a
 * vampire — and the tax on every hunting ground your neighbours hold, which the
 * first of them is.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function loc(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: ["location"], ...over };
}

function phase(state: GameState, seat: string, p: "unlock" | "master" | "influence"): void {
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn frame");
  tf.seat = seat;
  tf.phase = p;
  if (p === "unlock") {
    tf.unlockDone = false;
    tf.unlockAbilitiesDone = false;
  }
  if (p === "master") tf.masterActionsLeft = 1;
  if (p === "influence") tf.transfersLeft = 4;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function entryOf(state: GameState, id: string): PermanentInPlay | undefined {
  return state.seats.flatMap((s) => s.permanents).find((p) => p.card.id === id);
}

// ---------------------------------------------------------------------------

describe("Threestar Cab Company (101980) — lock to fill, lock to spend", () => {
  it("master phase: lock to bank a blood — the lock is the price, not a master action", () => {
    const state = threeSeatGame();
    phase(state, "Alice", "master");
    state.seats[0]!.permanents.push(loc("tc", "Threestar Cab Company", { tags: ["location", "huntingGround"] }));
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("ability:Threestar Cab Company:tc:store:0");
    expect(entryOf(state, "tc")!.counters).toBe(1);
    expect(entryOf(state, "tc")!.locked).toBe(true);
    const tf = state.frames[0]!;
    expect(tf.kind === "turn" ? tf.masterActionsLeft : -1).toBe(1);
    // Locked: nothing more from it this turn.
    expect(optionIds(engine).some((o) => o.startsWith("ability:Threestar"))).toBe(false);
  });

  it("unlock phase: the blood goes to your pool OR to a ready vampire", () => {
    const state = threeSeatGame();
    phase(state, "Alice", "unlock");
    Object.assign(find(state, "V1"), { capacity: 6, blood: 2 });
    state.seats[0]!.permanents.push(
      loc("tc", "Threestar Cab Company", { tags: ["location", "huntingGround"], counters: 2 }),
    );
    const engine = new VtesEngine(state, testRegistry);
    const ids = optionIds(engine).filter((o) => o.startsWith("ability:Threestar"));
    expect(ids).toContain("ability:Threestar Cab Company:tc:store:1"); // to pool
    expect(ids).toContain("ability:Threestar Cab Company:tc:store:2:V1"); // to V1
    const pool = state.seats[0]!.pool;
    engine.choose("ability:Threestar Cab Company:tc:store:1");
    expect(state.seats[0]!.pool).toBe(pool + 1);
    expect(entryOf(state, "tc")!.counters).toBe(1);
    expect(entryOf(state, "tc")!.locked).toBe(true);
  });

  it("a HUNTING GROUND: blood to a vampire uses up that vampire's one ground this turn", () => {
    const state = threeSeatGame();
    phase(state, "Alice", "unlock");
    Object.assign(find(state, "V1"), { capacity: 6, blood: 2 });
    state.seats[0]!.permanents.push(
      loc("tc", "Threestar Cab Company", { tags: ["location", "huntingGround"], counters: 2 }),
      loc("ahg", "Academic Hunting Ground", { tags: ["location", "huntingGround"] }),
    );
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("ability:Threestar Cab Company:tc:store:2:V1");
    expect(find(state, "V1").blood).toBe(3);
    // The ordinary hunting ground can no longer feed V1 this turn.
    expect(optionIds(engine)).not.toContain("ability:Academic Hunting Ground:ahg:V1");
  });

  it("NEGATIVE SPACE: a vampire that already fed from a ground is not offered it", () => {
    const state = threeSeatGame();
    phase(state, "Alice", "unlock");
    Object.assign(find(state, "V1"), { capacity: 6, blood: 2 });
    state.seats[0]!.permanents.push(
      loc("tc", "Threestar Cab Company", { tags: ["location", "huntingGround"], counters: 2 }),
      loc("ahg", "Academic Hunting Ground", { tags: ["location", "huntingGround"] }),
    );
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("ability:Academic Hunting Ground:ahg:V1");
    expect(optionIds(engine)).not.toContain("ability:Threestar Cab Company:tc:store:2:V1");
    // …while the pool branch is still there.
    expect(optionIds(engine)).toContain("ability:Threestar Cab Company:tc:store:1");
  });
});

describe("Grand Temple of Set (100848) — pool in, a vampire out", () => {
  it("master phase: moves 1 pool onto the card, once a phase", () => {
    const state = threeSeatGame();
    phase(state, "Alice", "master");
    state.seats[0]!.permanents.push(loc("gt", "Grand Temple of Set"));
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("ability:Grand Temple of Set:gt:store:0");
    expect(state.seats[0]!.pool).toBe(9);
    expect(entryOf(state, "gt")!.counters).toBe(1);
    expect(optionIds(engine).some((o) => o.startsWith("ability:Grand Temple"))).toBe(false);
  });

  it("influence phase: burn capacity+1 counters to steal a PREY vampire of lower capacity", () => {
    const state = threeSeatGame();
    phase(state, "Alice", "influence");
    Object.assign(find(state, "W"), { capacity: 4 });
    Object.assign(find(state, "M"), { capacity: 5 });
    state.seats[0]!.permanents.push(loc("gt", "Grand Temple of Set", { counters: 5 }));
    const engine = new VtesEngine(state, testRegistry);
    const ids = optionIds(engine).filter((o) => o.startsWith("ability:Grand Temple"));
    // W (capacity 4) costs 5: affordable. M (capacity 5) would cost 6: not.
    expect(ids).toContain("ability:Grand Temple of Set:gt:store:1:W");
    expect(ids).not.toContain("ability:Grand Temple of Set:gt:store:1:M");
    // Carol is the PREDATOR, not the prey: her N is never a target.
    expect(ids.some((o) => o.endsWith(":N"))).toBe(false);
    engine.choose("ability:Grand Temple of Set:gt:store:1:W");
    expect(state.seats[0]!.minions.some((m) => m.id === "W")).toBe(true);
    expect(entryOf(state, "gt")!.counters).toBe(0);
    expect(entryOf(state, "gt")!.locked).toBe(true);
  });
});

describe("Arcanum Chapterhouse, Alexandria (100082) — a tax on your neighbours' grounds", () => {
  /** Alice holds Arcanum. Bob (her prey) holds two grounds — one of them a
   *  Threestar Cab, a hunting ground by tag — Carol (her predator) holds one. */
  function game(unlocking: string): GameState {
    const state = threeSeatGame();
    phase(state, unlocking, "unlock");
    state.seats[0]!.permanents.push(loc("ac", "Arcanum Chapterhouse, Alexandria"));
    state.seats[0]!.permanents.push(loc("mine", "Academic Hunting Ground", { tags: ["location", "huntingGround"] }));
    state.seats[1]!.permanents.push(
      loc("b1", "Asylum Hunting Ground", { tags: ["location", "huntingGround"] }),
      loc("b2", "Threestar Cab Company", { tags: ["location", "huntingGround"] }),
    );
    state.seats[2]!.permanents.push(loc("c1", "Park Hunting Ground", { tags: ["location", "huntingGround"] }));
    return state;
  }

  it("the PREY burns 1 pool per hunting ground — Threestar counts", () => {
    const state = game("Bob");
    const engine = new VtesEngine(state, testRegistry);
    engine.decision();
    expect(state.seats[1]!.pool).toBe(8);
  });

  it("the PREDATOR too", () => {
    const state = game("Carol");
    const engine = new VtesEngine(state, testRegistry);
    engine.decision();
    expect(state.seats[2]!.pool).toBe(9);
  });

  it("NEGATIVE SPACE: its own controller pays nothing for their own ground", () => {
    const state = game("Alice");
    const engine = new VtesEngine(state, testRegistry);
    engine.decision();
    expect(state.seats[0]!.pool).toBe(10);
  });

  it("FOUR seats: the grand-prey across the table pays nothing", () => {
    const state = game("Bob");
    // A fourth seat, D, between Bob and Carol: Alice's prey is Bob, her
    // predator Carol — D is neither, and holds a ground.
    state.seats.splice(2, 0, {
      ...state.seats[2]!,
      id: "Dave",
      pool: 10,
      minions: [makeMinion("D1", "Dave")],
      permanents: [loc("d1", "Library Hunting Ground", { tags: ["location", "huntingGround"] })],
      hand: [],
    });
    phase(state, "Dave", "unlock");
    const engine = new VtesEngine(state, testRegistry);
    engine.decision();
    expect(state.seats.find((s) => s.id === "Dave")!.pool).toBe(10);
  });
});
