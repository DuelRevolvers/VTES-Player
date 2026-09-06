/**
 * Unlock-phase tolls and the Ⓓ-burn retrofits
 * (docs/unlock-tolls-design.md).
 *
 * The Gate of Acheron (102290) — newly supported — plus the four counter
 * cards whose "minions can burn this card as a Ⓓ action" clause was a
 * recorded deviation: Smiling Jack (101811), Constant Revolution (100416),
 * Powerbase: Madrid (101437), Wasserschloss Anif (102152).
 *
 * p. 50 rules Smiling Jack by name and settles the whole mechanism: the
 * accumulator is mandatory "even if it ousts you", the toll is per counter,
 * the units "mix between multiple vampires and the pool", and "failing to
 * burn 1 blood from an empty vampire will not lessen the obligation".
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function inPlay(id: string, name: string, counters = 0): PermanentInPlay {
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: [name],
    counters,
  };
}

/** Point the turn frame at `seat`'s unlock phase and start an engine. */
function atUnlock(state: GameState, seat: string): VtesEngine {
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn frame");
  tf.seat = seat;
  tf.phase = "unlock";
  tf.unlockDone = false;
  return new VtesEngine(state, testRegistry);
}

/**
 * Run `seat`'s unlock phase and answer every toll unit with `pick`, which
 * chooses among the toll option ids offered. Stops at the first decision
 * that is not a toll, so it never spends unrelated game decisions.
 */
function payToll(
  state: GameState,
  seat: string,
  pick: (ids: string[]) => string,
): { asked: number } {
  const engine = atUnlock(state, seat);
  let asked = 0;
  for (let i = 0; i < 30; i++) {
    const dp = engine.decision();
    if (!dp) break;
    const toll = dp.options.filter((o) => o.id.includes(":unlockToll:"));
    if (toll.length === 0) break;
    expect(dp.seat).toBe(seat); // the PAYER is asked, not the controller
    asked++;
    engine.choose(pick(toll.map((o) => o.id)));
  }
  return { asked };
}

/** The toll options a seat is offered, without answering any of them. */
function tollOptions(state: GameState, seat: string): string[] {
  const dp = atUnlock(state, seat).decision();
  return (dp?.options ?? []).filter((o) => o.id.includes(":unlockToll:")).map((o) => o.id);
}

const firstMatching = (ids: string[], needle: string): string => {
  const hit = ids.find((o) => o.includes(needle));
  if (!hit) throw new Error(`no toll option matching ${needle} in ${ids.join(", ")}`);
  return hit;
};

// ---------------------------------------------------------------------------
// Smiling Jack — the card the rulebook rules by name
// ---------------------------------------------------------------------------

describe("Smiling Jack, The Anarch (101811)", () => {
  const withJack = (counters: number): GameState => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("sj", "Smiling Jack, The Anarch", counters));
    return state;
  };

  it("the controller buys a counter with 1 pool each of their unlock phases", () => {
    const state = withJack(0);
    atUnlock(state, "Alice").decision();
    expect(seatOf(state, "Alice").pool).toBe(9);
    expect(seatOf(state, "Alice").permanents[0]!.counters).toBe(1);
  });

  it("RULING (p. 50): the controller pays 'even if it ousts you'", () => {
    // The guard `if (pool >= 1)` was there until 2026-09-02 and quietly
    // stopped the card on its controller's last pool. It is the reason
    // this ruling was looked up at all.
    const state = withJack(0);
    seatOf(state, "Alice").pool = 1;
    atUnlock(state, "Alice").decision();
    expect(seatOf(state, "Alice").pool).toBe(0);
    // And the consequence the ruling is warning about actually happens:
    // she is ousted, which is why her cards in play are gone.
    expect(seatOf(state, "Alice").ousted).toBe(true);
    expect(seatOf(state, "Alice").permanents).toEqual([]);
  });

  it("charges each OTHER Methuselah one unit per counter, asking them how to pay", () => {
    const state = withJack(2);
    const { asked } = payToll(state, "Bob", (ids) => firstMatching(ids, ":unlockToll:pool"));
    expect(asked).toBe(2);
    expect(seatOf(state, "Bob").pool).toBe(8);
  });

  it("RULING (p. 50): the units mix freely between vampires and the pool", () => {
    const state = withJack(2);
    const bloodBefore = find(state, "W").blood;
    let n = 0;
    payToll(state, "Bob", (ids) =>
      n++ === 0 ? firstMatching(ids, ":unlockToll:pool") : firstMatching(ids, ":unlockToll:blood:W"),
    );
    expect(seatOf(state, "Bob").pool).toBe(9);
    expect(find(state, "W").blood).toBe(bloodBefore - 1);
  });

  it("RULING (p. 50): an EMPTY vampire is not a way to pay", () => {
    // "Failing to burn 1 blood from an empty vampire will not lessen the
    // obligation" — so a 0-blood vampire is not offered at all, and the
    // unit still has to come from the pool.
    const state = withJack(1);
    for (const m of seatOf(state, "Bob").minions) m.blood = 0;
    const ids = tollOptions(state, "Bob");
    expect(ids.some((o) => o.includes(":blood:"))).toBe(false);
    expect(ids).toEqual([expect.stringContaining(":unlockToll:pool")]);
  });

  it("only VAMPIRE blood pays it — an ally is not offered", () => {
    const state = withJack(1);
    seatOf(state, "Bob").minions.push(makeAlly("ALLY", "Bob", 3));
    const ids = tollOptions(state, "Bob");
    expect(ids.some((o) => o.includes(":blood:W"))).toBe(true);
    expect(ids.some((o) => o.includes(":blood:ALLY"))).toBe(false);
  });

  it("NEGATIVE SPACE: the controller is never charged the toll", () => {
    const state = withJack(2);
    // Alice's own unlock phase: she buys a counter (−1 pool) and is asked
    // nothing. The control case is the −2 Bob would have paid.
    expect(tollOptions(state, "Alice")).toEqual([]);
    expect(seatOf(state, "Alice").pool).toBe(9);
  });

  it("a card with no counters charges nobody", () => {
    const state = withJack(0);
    // Bob's phase first, before Alice's has bought anything.
    expect(tollOptions(state, "Bob")).toEqual([]);
    expect(seatOf(state, "Bob").pool).toBe(10);
  });

  it("RETROFIT: a vampire can burn it as a Ⓓ action", () => {
    const state = threeSeatGame();
    seatOf(state, "Bob").permanents.push(inPlay("sj", "Smiling Jack, The Anarch", 3));
    const engine = new VtesEngine(state, testRegistry);
    const id = `act:Smiling Jack, The Anarch:sj:burn:V1`;
    expect(engine.decision()!.options.some((o) => o.id === id)).toBe(true);
    runTrace(engine, [
      ["Alice", id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);
    expect(seatOf(state, "Bob").permanents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Constant Revolution — the same toll, paid out of the hand
// ---------------------------------------------------------------------------

describe("Constant Revolution (100416)", () => {
  const withRevolution = (counters: number): GameState => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("cr", "Constant Revolution", counters));
    return state;
  };

  it("adds a free counter each of the controller's unlock phases", () => {
    const state = withRevolution(1);
    atUnlock(state, "Alice").decision();
    expect(seatOf(state, "Alice").permanents[0]!.counters).toBe(2);
    // Free, unlike Smiling Jack's: no pool moves.
    expect(seatOf(state, "Alice").pool).toBe(10);
  });

  it("a unit paid from the hand burns a card at random AND REPLACES it (p. 7)", () => {
    const state = withRevolution(1);
    const bob = seatOf(state, "Bob");
    bob.hand = [
      { id: "b1", name: "Conditioning" },
      { id: "b2", name: "Govern the Unaligned" },
    ];
    bob.library = [
      { id: "bl1", name: "Conditioning" },
      { id: "bl2", name: "Conditioning" },
    ];
    payToll(state, "Bob", (ids) => firstMatching(ids, ":unlockToll:hand"));
    // "Whenever an effect … removes cards from your hand, immediately …
    // draw up to match your hand size" — so the hand is the same size and
    // the library is one shorter. The punishment is card quality, not
    // hand size (that is Mirror Walk's, which prints "do not replace").
    expect(bob.hand.length).toBe(2);
    expect(bob.library.length).toBe(1);
    expect(bob.pool).toBe(10);
    expect((bob.ashHeap ?? []).length).toBe(1);
  });

  it("NEGATIVE SPACE: with an empty hand only the pool option is offered", () => {
    const state = withRevolution(1);
    seatOf(state, "Bob").hand = [];
    const ids = tollOptions(state, "Bob");
    expect(ids.some((o) => o.includes(":unlockToll:hand"))).toBe(false);
    expect(ids).toEqual([expect.stringContaining(":unlockToll:pool")]);
  });

  it("RETROFIT: the Ⓓ-burn costs 1 pool, and a Methuselah who cannot pay is not offered it", () => {
    // A separate state: a 0-pool Methuselah is ousted the moment an engine
    // touches the state, taking their minions with them.
    const broke = threeSeatGame();
    seatOf(broke, "Bob").permanents.push(inPlay("cr", "Constant Revolution", 2));
    seatOf(broke, "Alice").pool = 1;
    expect(
      new VtesEngine(broke, testRegistry)
        .decision()!
        .options.some((o) => o.id.includes("Constant Revolution:cr:burn:")),
    ).toBe(true);
    // The gate is the cost: with the pool spoken for it disappears.
    seatOf(broke, "Alice").pool = 0;
    expect(
      new VtesEngine(broke, testRegistry)
        .decision()!
        .options.some((o) => o.id.includes("Constant Revolution:cr:burn:")),
    ).toBe(false);

    const state = threeSeatGame();
    seatOf(state, "Bob").permanents.push(inPlay("cr", "Constant Revolution", 2));
    seatOf(state, "Alice").pool = 5;
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "act:Constant Revolution:cr:burn:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);
    expect(seatOf(state, "Bob").permanents).toEqual([]);
    // Paid at resolution (p. 27), not at announcement.
    expect(seatOf(state, "Alice").pool).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// The Gate of Acheron — the new card; every clause is data
// ---------------------------------------------------------------------------

describe("The Gate of Acheron (102290)", () => {
  /** Alice holds a capacity-6 Hecata (V1) and a capacity-3 Hecata (H3). */
  function gateGame(): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Hecata", capacity: 6 });
    state.seats[0]!.minions.push(makeMinion("H3", "Alice", { clan: "Hecata", capacity: 3 }));
    state.seats[0]!.minions.push(makeMinion("VEN", "Alice", { clan: "Ventrue", capacity: 6 }));
    return state;
  }

  const withGate = (counters: number): GameState => {
    const state = gateGame();
    seatOf(state, "Alice").permanents.push(inPlay("ga", "The Gate of Acheron", counters));
    return state;
  };

  it("is a +1 stealth Hecata action that puts itself in play with 1 counter", () => {
    const state = gateGame();
    state.seats[0]!.hand.push({ id: "g1", name: "The Gate of Acheron" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:The Gate of Acheron:basic:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);
    const entry = seatOf(state, "Alice").permanents.find(
      (p) => p.card.name === "The Gate of Acheron",
    );
    expect(entry?.counters).toBe(1);
    expect(
      state.eventLog.some(
        (e) =>
          e.type === "StealthModified" && e.source === "The Gate of Acheron" && e.delta === 1,
      ),
    ).toBe(true);
  });

  it("is NOT a location — the card prints 'Unique.', not 'Unique location.'", () => {
    // A location-burner (Conceal, Rewilding) enumerates by the tag, so
    // getting this wrong would silently widen four other cards.
    const state = withGate(1);
    expect(seatOf(state, "Alice").permanents[0]!.tags).not.toContain("location");
  });

  it("adds a counter each of the controller's unlock phases", () => {
    const state = withGate(1);
    atUnlock(state, "Alice").decision();
    expect(seatOf(state, "Alice").permanents[0]!.counters).toBe(2);
  });

  it("the PREY pays one unit per counter, and may remove a random ash-heap card", () => {
    const state = withGate(2);
    seatOf(state, "Bob").ashHeap = [
      { id: "x1", name: "Conditioning" },
      { id: "x2", name: "Govern the Unaligned" },
      { id: "x3", name: "Deflection" },
    ];
    let n = 0;
    const { asked } = payToll(state, "Bob", (ids) =>
      n++ === 0 ? firstMatching(ids, ":unlockToll:ash") : firstMatching(ids, ":unlockToll:pool"),
    );
    expect(asked).toBe(2);
    // One card left the ash heap for good, and one pool paid the other unit.
    expect((seatOf(state, "Bob").ashHeap ?? []).length).toBe(2);
    expect(seatOf(state, "Bob").pool).toBe(9);
  });

  it("NEGATIVE SPACE: only the PREY pays — the grand-prey does not", () => {
    // Seating is Alice → Bob → Carol, so Alice's prey is BOB. Carol is
    // charged by Smiling Jack's "each other Methuselah" and by this card
    // is not charged at all.
    const state = withGate(2);
    expect(tollOptions(state, "Carol")).toEqual([]);
    expect(seatOf(state, "Carol").pool).toBe(10);
  });

  it("NEGATIVE SPACE: an empty ash heap leaves only the pool option", () => {
    const state = withGate(1);
    seatOf(state, "Bob").ashHeap = [];
    const ids = tollOptions(state, "Bob");
    expect(ids).toEqual([expect.stringContaining(":unlockToll:pool")]);
  });

  it("a Hecata with capacity 4+ adds a counter as a +1 stealth action", () => {
    const state = withGate(1);
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids).toContain("act:The Gate of Acheron:ga:counter:V1");
    // Negative space, both filters: a capacity-3 Hecata and a Ventrue.
    expect(ids).not.toContain("act:The Gate of Acheron:ga:counter:H3");
    expect(ids).not.toContain("act:The Gate of Acheron:ga:counter:VEN");

    runTrace(engine, [
      ["Alice", "act:The Gate of Acheron:ga:counter:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);
    expect(seatOf(state, "Alice").permanents[0]!.counters).toBe(2);
    // One use per minion per copy per turn (p. 20).
    expect(
      engine.decision()!.options.some((o) => o.id === "act:The Gate of Acheron:ga:counter:V1"),
    ).toBe(false);
  });

  it("vampires can burn it as a Ⓓ action", () => {
    const state = gateGame();
    seatOf(state, "Bob").permanents.push(inPlay("ga", "The Gate of Acheron", 3));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "act:The Gate of Acheron:ga:burn:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);
    expect(seatOf(state, "Bob").permanents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The two remaining retrofits
// ---------------------------------------------------------------------------

describe("Powerbase: Madrid (101437) — burnCounters", () => {
  it("another Methuselah's vampire strips the counters and LEAVES THE CARD in play", () => {
    const state = threeSeatGame();
    seatOf(state, "Bob").permanents.push(inPlay("pm", "Powerbase: Madrid", 3));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "act:Powerbase: Madrid:pm:strip:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);
    const entry = seatOf(state, "Bob").permanents[0];
    expect(entry?.card.name).toBe("Powerbase: Madrid");
    expect(entry?.counters).toBe(0);
  });

  it("NEGATIVE SPACE: 'vampires controlled by OTHER Methuselahs' excludes its own controller", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("pm", "Powerbase: Madrid", 3));
    const ids = new VtesEngine(state, testRegistry).decision()!.options.map((o) => o.id);
    expect(ids.some((o) => o.includes("Powerbase: Madrid:pm:strip:"))).toBe(false);
  });

  it("an empty Powerbase is still a legal target, and stripping it does nothing", () => {
    // The clause names no precondition, so the permissiveness is printed.
    const state = threeSeatGame();
    seatOf(state, "Bob").permanents.push(inPlay("pm", "Powerbase: Madrid", 0));
    expect(
      new VtesEngine(state, testRegistry)
        .decision()!
        .options.some((o) => o.id === "act:Powerbase: Madrid:pm:strip:V1"),
    ).toBe(true);
  });
});

describe("Wasserschloss Anif, Austria (102152)", () => {
  it("ANY minion can burn it — an ally too — and a Malkavian gets +1 stealth", () => {
    const state = threeSeatGame();
    seatOf(state, "Bob").permanents.push(inPlay("wa", "Wasserschloss Anif, Austria", 2));
    seatOf(state, "Alice").minions.push(makeAlly("ALLY", "Alice", 2));
    seatOf(state, "Alice").minions.push(makeMinion("MAL", "Alice", { clan: "Malkavian" }));
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    // "Any minion": no `who` filter at all, unlike its three siblings.
    expect(ids).toContain("act:Wasserschloss Anif, Austria:wa:burn:ALLY");
    expect(ids).toContain("act:Wasserschloss Anif, Austria:wa:burn:MAL");

    runTrace(engine, [
      ["Alice", "act:Wasserschloss Anif, Austria:wa:burn:MAL"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);
    expect(
      state.eventLog.some(
        (e) =>
          e.type === "StealthModified" &&
          e.source === "Wasserschloss Anif, Austria" &&
          e.delta === 1,
      ),
    ).toBe(true);
    expect(seatOf(state, "Bob").permanents).toEqual([]);
  });

  it("RULING (p. 51): only ONE Tremere can feed it per turn", () => {
    const state = threeSeatGame();
    const alice = seatOf(state, "Alice");
    alice.permanents.push(inPlay("wa", "Wasserschloss Anif, Austria", 0));
    Object.assign(find(state, "V1"), { clan: "Tremere", blood: 3 });
    alice.minions.push(makeMinion("T2", "Alice", { clan: "Tremere", blood: 3 }));
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn frame");
    tf.phase = "master";
    tf.masterActionsLeft = 1;
    const engine = new VtesEngine(state, testRegistry);

    const first = engine.decision()!.options.map((o) => o.id);
    expect(first).toContain("ability:Wasserschloss Anif, Austria:wa:feed:V1");
    expect(first).toContain("ability:Wasserschloss Anif, Austria:wa:feed:T2");

    engine.choose("ability:Wasserschloss Anif, Austria:wa:feed:V1");
    expect(alice.permanents[0]!.counters).toBe(1);
    // The second Tremere is now shut out — the offer was unlatched before.
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Wasserschloss Anif, Austria:wa:feed:")),
    ).toBe(false);
  });
});
