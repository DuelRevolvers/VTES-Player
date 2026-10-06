/**
 * Hunting-ground variants (docs/hunting-ground-variants-design.md).
 *
 * Gurchon Hall (100871), Kingston Penitentiary, Ontario (101060),
 * Poacher's Hunting Ground (101404).
 *
 * Three hunting grounds that each bend a different part of the p. 21 rule:
 * WHO it feeds (the two oldest, fixed), WHO may use it (a rival, for rent),
 * and HOW MANY times (as many as the other seats have grounds). The rule they
 * all keep — "a vampire can gain blood from only one hunting ground each
 * turn" — is asserted against each.
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

function ground(id: string, name: string, extra: string[] = []): PermanentInPlay {
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["location", "huntingGround", ...extra],
  };
}

/** `seat`'s own unlock phase, before the sweep. */
function unlockOf(state: GameState, seat: string): void {
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn frame");
  tf.seat = seat;
  tf.phase = "unlock";
  tf.unlockDone = false;
  tf.unlockAbilitiesDone = false;
}

/** Walk to the first decision offered to `seat` in its unlock window. */
function unlockOptions(engine: VtesEngine, seat: string): string[] {
  for (let i = 0; i < 10; i++) {
    const dp = engine.decision();
    if (!dp) return [];
    if (dp.seat === seat && dp.window === "turn.unlock") return dp.options.map((o) => o.id);
    const pass = dp.options.find((o) => o.id === "pass");
    if (!pass) return [];
    engine.choose(pass.id);
  }
  return [];
}

// ---------------------------------------------------------------------------

describe("Gurchon Hall (100871) — the TWO OLDEST, fixed", () => {
  /** Alice's V1 (capacity 9), OA (7), OB (`bCap`) and YG (5). */
  function game(bCap: number): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    unlockOf(state, "Alice");
    Object.assign(find(state, "V1"), { capacity: 9, blood: 3 });
    state.seats[0]!.minions.push(
      makeMinion("OA", "Alice", { capacity: 7, blood: 2 }),
      makeMinion("OB", "Alice", { capacity: bCap, blood: 2 }),
      makeMinion("YG", "Alice", { capacity: 5, blood: 2 }),
    );
    state.seats[0]!.permanents.push(ground("gh", "Gurchon Hall"));
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("feeds the two oldest together, and nobody else", () => {
    const { state, engine } = game(6);
    const ids = unlockOptions(engine, "Alice").filter((o) => o.startsWith("ability:Gurchon Hall"));
    // One option: no choice of recipient when the oldest two are clear.
    expect(ids).toEqual(["ability:Gurchon Hall:gh:V1+OA"]);
    engine.choose(ids[0]!);
    expect(find(state, "V1").blood).toBe(4);
    expect(find(state, "OA").blood).toBe(3);
    expect(find(state, "OB").blood).toBe(2);
    expect(find(state, "YG").blood).toBe(2);
  });

  it("a TIE for second place is the controller's to break — one option per pair", () => {
    const { engine } = game(7);
    const ids = unlockOptions(engine, "Alice").filter((o) => o.startsWith("ability:Gurchon Hall"));
    expect(ids.sort()).toEqual(["ability:Gurchon Hall:gh:V1+OA", "ability:Gurchon Hall:gh:V1+OB"]);
  });

  it("a vampire that already fed from a hunting ground this turn is skipped, not replaced", () => {
    // OA feeds from a SECOND ground first, in this same unlock phase. (Setting
    // `usedHuntingGroundThisTurn` in the fixture does nothing: the unlock sweep
    // resets it before the card is asked — the first draft's precondition was
    // wiped, and the case passed nothing it claimed to.)
    const { state, engine } = game(6);
    state.seats[0]!.permanents.push(ground("ahg", "Academic Hunting Ground"));
    const first = unlockOptions(engine, "Alice");
    expect(first).toContain("ability:Academic Hunting Ground:ahg:OA");
    engine.choose("ability:Academic Hunting Ground:ahg:OA");
    expect(find(state, "OA").blood).toBe(3);
    const ids = unlockOptions(engine, "Alice").filter((o) => o.startsWith("ability:Gurchon Hall"));
    // Still V1 and OA — the recipients are fixed; the younger OB does NOT step
    // in — and only V1 is fed: OA stays at the 3 the other ground gave it.
    expect(ids).toEqual(["ability:Gurchon Hall:gh:V1+OA"]);
    engine.choose(ids[0]!);
    expect(find(state, "V1").blood).toBe(4);
    expect(find(state, "OA").blood).toBe(3);
    expect(find(state, "OB").blood).toBe(2);
  });
});

describe("Kingston Penitentiary, Ontario (101060) — a rival may rent it", () => {
  function game(seat: string): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    unlockOf(state, seat);
    Object.assign(find(state, "V1"), { capacity: 6, blood: 2 });
    Object.assign(find(state, "W"), { capacity: 6, blood: 2 });
    state.seats[0]!.permanents.push(ground("kp", "Kingston Penitentiary, Ontario"));
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("in its OWNER's unlock phase it is an ordinary hunting ground", () => {
    const { state, engine } = game("Alice");
    const ids = unlockOptions(engine, "Alice");
    expect(ids).toContain("ability:Kingston Penitentiary, Ontario:kp:V1");
    expect(ids.some((o) => o.includes(":rent:"))).toBe(false);
    engine.choose("ability:Kingston Penitentiary, Ontario:kp:V1");
    expect(find(state, "V1").blood).toBe(3);
  });

  it("in a RIVAL's unlock phase: 1 pool to the owner, the card locks, the rival feeds", () => {
    const { state, engine } = game("Bob");
    const alice = state.seats[0]!.pool;
    const bob = state.seats[1]!.pool;
    const ids = unlockOptions(engine, "Bob");
    expect(ids).toContain("ability:Kingston Penitentiary, Ontario:kp:rent:W");
    engine.choose("ability:Kingston Penitentiary, Ontario:kp:rent:W");
    expect(state.seats[1]!.pool).toBe(bob - 1);
    expect(state.seats[0]!.pool).toBe(alice + 1);
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "kp")!.locked).toBe(true);
    expect(find(state, "W").blood).toBe(3);
  });

  it("NEGATIVE SPACE: a LOCKED Kingston cannot be rented", () => {
    const { state, engine } = game("Bob");
    state.seats[0]!.permanents.find((p) => p.card.id === "kp")!.locked = true;
    // The owner's own sweep does not run in Bob's turn, so it stays locked.
    expect(unlockOptions(engine, "Bob").some((o) => o.includes("Kingston"))).toBe(false);
  });
});

describe("Poacher's Hunting Ground (101404) — as many as the table has", () => {
  /** Alice holds Poacher's and three ready anarchs. Bob holds a real ground
   *  and ANOTHER Poacher's (derivative — does not count); Carol holds one. */
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    unlockOf(state, "Alice");
    Object.assign(find(state, "V1"), { sect: "anarch", capacity: 6, blood: 2 });
    state.seats[0]!.minions.push(
      makeMinion("A2", "Alice", { sect: "anarch", capacity: 6, blood: 2 }),
      makeMinion("A3", "Alice", { sect: "anarch", capacity: 6, blood: 2 }),
      makeMinion("CM", "Alice", { sect: "camarilla", capacity: 6, blood: 2 }),
    );
    state.seats[0]!.permanents.push(ground("ph", "Poacher's Hunting Ground", ["derivative"]));
    state.seats[1]!.permanents.push(ground("bg", "Academic Hunting Ground"));
    state.seats[1]!.permanents.push(ground("bp", "Poacher's Hunting Ground", ["derivative"]));
    state.seats[2]!.permanents.push(ground("cg", "Asylum Hunting Ground"));
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("X = 2 (Bob's real ground and Carol's): two anarchs feed, the third is not offered", () => {
    const { state, engine } = game();
    let ids = unlockOptions(engine, "Alice").filter((o) => o.startsWith("ability:Poacher's"));
    expect(ids.sort()).toEqual([
      "ability:Poacher's Hunting Ground:ph:A2",
      "ability:Poacher's Hunting Ground:ph:A3",
      "ability:Poacher's Hunting Ground:ph:V1",
    ]);
    // Not the Camarilla vampire.
    expect(ids.some((o) => o.endsWith(":CM"))).toBe(false);
    engine.choose("ability:Poacher's Hunting Ground:ph:V1");
    ids = unlockOptions(engine, "Alice").filter((o) => o.startsWith("ability:Poacher's"));
    engine.choose(ids.find((o) => o.endsWith(":A2"))!);
    // Two grants spent: Bob's own Poacher's is DERIVATIVE and counted for nothing.
    ids = unlockOptions(engine, "Alice").filter((o) => o.startsWith("ability:Poacher's"));
    expect(ids).toEqual([]);
    expect(find(state, "V1").blood).toBe(3);
    expect(find(state, "A2").blood).toBe(3);
    expect(find(state, "A3").blood).toBe(2);
  });

  it("NEGATIVE SPACE: with no other seat holding a real ground, X = 0", () => {
    const { state, engine } = game();
    state.seats[1]!.permanents = state.seats[1]!.permanents.filter((p) => p.card.id === "bp");
    state.seats[2]!.permanents = [];
    expect(unlockOptions(engine, "Alice").some((o) => o.startsWith("ability:Poacher's"))).toBe(false);
  });
});
