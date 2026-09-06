/**
 * Diablerie, rescue, and the blood hunt (docs/diablerie-design.md): the
 * built-in diablerise and rescue-from-torpor actions, the indivisible
 * diablerie resolution, the automatic blood-hunt referendum (reusing the
 * politics machine), and the leave-torpor blocked-by-vampire path.
 */

import { describe, expect, it } from "vitest";
import type { CardInstance, GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "./fixtures.ts";

/** announce (3) → A declines (3) → C (3): a successful undirected/declined
 *  built-in action, next frame (diablerie/referendum) on top. */
const clearAction: Array<[string, string]> = [
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
];

describe("diablerise action", () => {
  it("directed at another Methuselah's torpor vampire; success → diablerie + blood hunt", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.blood = 2; // V1, capacity 5
    const bob = state.seats[1]!;
    bob.minions.find((x) => x.id === "W")!.title = "prince"; // 2 votes
    bob.minions.push(makeMinion("T", "Bob", { inTorpor: true, blood: 3, capacity: 3 }));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "diablerize:V1:T"],
      ...clearAction,
      // Diablerie committed → blood-hunt referendum. Alice (diablerist's
      // controller) has no votes; Bob votes his prince for the hunt.
      ["Alice", "pass"],
      ["Bob", "vote:W:for"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    const announced = state.eventLog.find(
      (e) => e.type === "ActionAnnounced" && e.actionKind === "diablerize",
    )!;
    expect(announced).toMatchObject({ target: "Bob", directed: true });
    // Directed diablerie is 0 stealth (no StealthModified from the action).
    expect(
      state.eventLog.some((e) => e.type === "StealthModified" && e.source === "diablerize"),
    ).toBe(false);
    // The victim's blood moved to the diablerist (capped at capacity 5),
    // then the victim burned — but the blood hunt passed, so V1 burns too.
    expect(state.eventLog.some((e) => e.type === "DiablerieCommitted")).toBe(true);
    expect(bob.minions.some((x) => x.id === "T")).toBe(false);
    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: true, votesFor: 2, votesAgainst: 0 });
    expect(state.eventLog.some((e) => e.type === "BloodHuntCalled")).toBe(true);
    expect(alice.minions.some((x) => x.id === "V1")).toBe(false); // diablerist burned
  });

  it("a failed blood hunt (tie) leaves the diablerist alive with the victim's blood", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.blood = 1; // V1, capacity 5
    const bob = state.seats[1]!;
    bob.minions.push(makeMinion("T", "Bob", { inTorpor: true, blood: 3, capacity: 3 }));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "diablerize:V1:T"],
      ...clearAction,
      // No titles anywhere → no votes → tie → the hunt fails.
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: false, votesFor: 0, votesAgainst: 0 });
    const v1 = alice.minions.find((x) => x.id === "V1")!;
    expect(v1).toBeDefined(); // survived the hunt
    expect(v1.blood).toBe(4); // 1 + T's 3 (under capacity 5)
    expect(bob.minions.some((x) => x.id === "T")).toBe(false);
  });

  it("a blocked diablerise fights the blocker; the torpor victim is untouched", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    bob.minions.push(makeMinion("T", "Bob", { inTorpor: true, blood: 3, capacity: 3 }));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "diablerize:V1:T"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce → A
      ["Alice", "pass"],
      ["Bob", "block:M"], // 0 stealth (different controller): 0 ≥ 0 blocks
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // attempt → success
      // Combat V1 vs M, one uneventful round.
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(state.eventLog.find((e) => e.type === "CombatBegan")).toMatchObject({
      acting: "V1",
      opposing: "M",
    });
    expect(state.eventLog.some((e) => e.type === "DiablerieCommitted")).toBe(false);
    const t = bob.minions.find((x) => x.id === "T")!;
    expect(t.blood).toBe(3); // untouched — the diablerie never happened
    expect(t.inTorpor).toBe(true);
  });

  it("diablerising your own torpor vampire is undirected at +1 stealth", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions.push(
      makeMinion("T2", "Alice", { inTorpor: true, blood: 2, capacity: 3 }),
    );
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "diablerize:V1:T2"]]);

    const announced = state.eventLog.find(
      (e) => e.type === "ActionAnnounced" && e.actionKind === "diablerize",
    )!;
    expect(announced).toMatchObject({ target: null, directed: false });
    expect(
      state.eventLog.some((e) => e.type === "StealthModified" && e.delta === 1),
    ).toBe(true);
  });
});

describe("rescue from torpor", () => {
  it("moves the vampire to ready, un-wounded, splitting the 2-blood cost", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.blood = 2; // V1
    alice.minions.push(
      makeMinion("T2", "Alice", { inTorpor: true, blood: 3, capacity: 4 }),
    );
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "rescue:V1:T2:1"], // V1 pays 1, T2 pays 1
      ...clearAction,
    ]);

    const t2 = alice.minions.find((x) => x.id === "T2")!;
    expect(t2.inTorpor).toBe(false); // now ready
    expect(t2.blood).toBe(2); // paid 1 of the cost
    expect(alice.minions[0]!.blood).toBe(1); // V1 paid the other 1
    expect(state.eventLog.some((e) => e.type === "LeftTorpor" && e.minion === "T2")).toBe(true);
  });

  it("enumerates only affordable splits", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.blood = 1; // V1 can pay at most 1
    alice.minions.push(
      makeMinion("T2", "Alice", { inTorpor: true, blood: 1, capacity: 4 }),
    );
    const engine = new VtesEngine(state, testRegistry);

    const ids = engine.decision()!.options.map((o) => o.id);
    // V1 has 1, T2 has 1: only the 1/1 split is affordable.
    expect(ids.filter((id) => id.startsWith("rescue:V1:T2"))).toEqual([
      "rescue:V1:T2:1",
    ]);
  });
});

describe("leave torpor blocked by a vampire", () => {
  it("offers the blocker a diablerise, which commits and calls a blood hunt", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    const v1 = alice.minions[0]!;
    v1.inTorpor = true;
    v1.blood = 2;
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    w.blood = 3;
    w.capacity = 4;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "leave:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce → A
      ["Alice", "pass"],
      ["Bob", "block:W"],
    ]);
    // Give W the +1 intercept it needs to beat leave-torpor's +1 stealth.
    const af = engine.action()!;
    engine.emit({ type: "InterceptModified", actionId: af.actionId, minion: "W", delta: 1, source: "test" });
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block succeeds → offer
      ["Bob", "diablerize:offer:W:V1"], // Bob accepts → diablerise V1
      // Blood hunt on W (the diablerist); nobody has votes → tie → fails.
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"],
    ]);

    expect(state.eventLog.some(
      (e) => e.type === "DiablerieCommitted" && e.diablerist === "W" && e.victim === "V1",
    )).toBe(true);
    expect(alice.minions.some((x) => x.id === "V1")).toBe(false); // diablerised
    expect(w.blood).toBe(4); // 3 + V1's 2, capped at capacity 4
    expect(state.eventLog.find((e) => e.type === "ReferendumResolved")).toMatchObject({
      passed: false,
    });
    expect(state.seats[1]!.minions.some((x) => x.id === "W")).toBe(true); // hunt failed
  });

  it("declining the diablerise just fails the leave-torpor action", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.inTorpor = true;
    v1.blood = 3;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "leave:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:W"],
    ]);
    const af = engine.action()!;
    engine.emit({ type: "InterceptModified", actionId: af.actionId, minion: "W", delta: 1, source: "test" });
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Bob", "pass"], // decline the diablerie
    ]);

    expect(v1.inTorpor).toBe(true); // stayed in torpor
    expect(v1.blood).toBe(3); // cost not paid
    expect(state.eventLog.some((e) => e.type === "DiablerieCommitted")).toBe(false);
    expect(state.eventLog.find((e) => e.type === "ActionResolved")).toMatchObject({
      success: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Steps 2 and 4 of the resolution (p. 34), deferred until 2026-09-05
// ---------------------------------------------------------------------------

function gear(id: string, name: string, tags: string[]): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags };
}

/** Diablerise, then let the blood hunt fail (nobody votes, so it ties and
 *  fails, p. 28) so the diablerist survives to be looked at. */
const commitAndSurvive: Array<[string, string]> = [
  ["Alice", "diablerize:V1:T"],
  ...clearAction,
  ["Alice", "pass"],
  ["Bob", "pass"],
  ["Carol", "pass"],
];

describe("diablerie step 2 — taking the victim's equipment", () => {
  /** Alice's V1 (capacity 5) diablerises Bob's torpor vampire T. */
  function game(victimGear: PermanentInPlay[], capacity = 3): GameState {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.blood = 2;
    state.seats[1]!.minions.push(
      makeMinion("T", "Bob", {
        inTorpor: true,
        blood: 1,
        capacity,
        attached: victimGear,
      }),
    );
    return state;
  }

  it("moves equipment onto the diablerist instead of burning it", () => {
    const state = game([gear("g1", ".44 Magnum", ["equipment"])]);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, commitAndSurvive);

    const v1 = state.seats[0]!.minions.find((m) => m.id === "V1")!;
    expect(v1.attached.map((p) => p.card.id)).toContain("g1");
    // It did NOT burn with the victim.
    expect(state.eventLog.some((e) => e.type === "PermanentBurned" && e.cardId === "g1")).toBe(
      false,
    );
  });

  it("leaves NON-equipment behind to burn with the victim", () => {
    // A retainer is not equipment, and p. 34 says equipment. The negative
    // half matters: a filter that took everything would look identical on
    // the positive test alone.
    const state = game([
      gear("g1", ".44 Magnum", ["equipment"]),
      gear("r1", "Raven Spy", ["retainer"]),
    ]);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, commitAndSurvive);

    const v1 = state.seats[0]!.minions.find((m) => m.id === "V1")!;
    expect(v1.attached.map((p) => p.card.id)).toEqual(["g1"]);
    expect(state.eventLog.some((e) => e.type === "PermanentBurned" && e.cardId === "r1")).toBe(
      true,
    );
  });

  it("never reaches a UNIQUE two Methuselahs both control — they CONTEST first", () => {
    // This test used to assert the take's own-duplicate guard, on a board
    // where Alice and Bob each controlled a Treasured Samadji. Contested
    // cards (p. 17) make that board unreachable: "if more than one unique
    // card with the same name is brought into play … all of the contested
    // cards are turned face down and are out of play", so neither copy is
    // on a vampire for the diablerie to take.
    //
    // The guard in `takeDiablerieEquipment` is kept as defence in depth,
    // and this test now pins the reason it no longer fires.
    const state = game([gear("g1", "Treasured Samadji", ["equipment", "unique"])]);
    state.seats[0]!.minions[0]!.attached.push(
      gear("mine", "Treasured Samadji", ["equipment", "unique"]),
    );
    const engine = new VtesEngine(state, testRegistry);

    // The contest is settled before the first decision is offered.
    expect(engine.decision()).not.toBeNull();
    expect(state.seats[0]!.contested?.map((c) => c.card.id)).toEqual(["mine"]);
    expect(state.seats[1]!.contested?.map((c) => c.card.id)).toEqual(["g1"]);
    const v1 = state.seats[0]!.minions.find((m) => m.id === "V1")!;
    expect(v1.attached.map((p) => p.card.id)).toEqual([]);
    // Out of play is not burned: a contest can still be won.
    expect(state.eventLog.some((e) => e.type === "PermanentBurned" && e.cardId === "g1")).toBe(
      false,
    );
    expect(engine.decision()).not.toBeNull();
  });

  it("takes a unique the taker does NOT already control", () => {
    // The control for the case above — otherwise that test would pass
    // just as well if uniques were never taken at all.
    const state = game([gear("g1", "Treasured Samadji", ["equipment", "unique"])]);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, commitAndSurvive);

    const v1 = state.seats[0]!.minions.find((m) => m.id === "V1")!;
    expect(v1.attached.map((p) => p.card.id)).toContain("g1");
  });
});

describe("diablerie step 4 — the older victim's Discipline", () => {
  /** V1 has capacity 5; the victim's capacity is the variable. */
  function game(victimCapacity: number, library: CardInstance[]): GameState {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.blood = 2;
    state.seats[0]!.library = library;
    state.seats[1]!.minions.push(
      makeMinion("T", "Bob", { inTorpor: true, blood: 1, capacity: victimCapacity }),
    );
    return state;
  }

  /** Just the action: the Discipline question is step 4 of the diablerie
   *  resolution, so it is asked BEFORE the blood hunt is conducted
   *  (p. 34–35 — the resolution is one indivisible unit, and the
   *  referendum follows it). */
  const commit: Array<[string, string]> = [["Alice", "diablerize:V1:T"], ...clearAction];

  it("is asked before the blood hunt — the resolution comes first (p. 34–35)", () => {
    const state = game(7, [{ id: "d1", name: "Potence" }]);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, commit);
    // The question is on the table and the referendum has not resolved.
    expect(engine.decision()!.window).toBe("choice");
    expect(state.eventLog.some((e) => e.type === "ReferendumResolved")).toBe(false);
  });

  it("is offered when the victim was OLDER, and puts the card on the diablerist", () => {
    const state = game(7, [
      { id: "d1", name: "Potence" },
      { id: "x1", name: "Blood Doll" },
    ]);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, commit);

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    const ids = dp.options.map((o) => o.id);
    // The Discipline master, and "find nothing" — never the Blood Doll.
    expect(ids.some((i) => i.endsWith(":library:d1"))).toBe(true);
    expect(ids.some((i) => i.endsWith(":library:x1"))).toBe(false);
    expect(ids.some((i) => i.endsWith(":none"))).toBe(true);

    engine.choose(ids.find((i) => i.endsWith(":library:d1"))!);
    const v1 = state.seats[0]!.minions.find((m) => m.id === "V1")!;
    expect(v1.attached.map((p) => p.card.name)).toContain("Potence");
    // p. 14: the library is shuffled either way.
    expect(state.eventLog.some((e) => e.type === "LibraryShuffled")).toBe(true);
  });

  it("is NOT offered when the victim was younger or the same age", () => {
    // The whole condition. Without a negative case, "older" could be
    // implemented as "always" and the positive test would not notice.
    for (const capacity of [3, 5]) {
      const state = game(capacity, [{ id: "d1", name: "Potence" }]);
      const engine = new VtesEngine(state, testRegistry);
      runTrace(engine, commit);
      const ids = engine.decision()?.options.map((o) => o.id) ?? [];
      expect(ids.some((i) => i.includes("diablerieDiscipline"))).toBe(false);
    }
  });

  it("shuffles the library even when nothing is found (p. 14)", () => {
    const state = game(7, [{ id: "d1", name: "Potence" }]);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, commit);
    const none = engine.decision()!.options.find((o) => o.id.endsWith(":none"))!;
    engine.choose(none.id);
    expect(state.eventLog.some((e) => e.type === "LibraryShuffled")).toBe(true);
    const v1 = state.seats[0]!.minions.find((m) => m.id === "V1")!;
    expect(v1.attached).toEqual([]);
  });

  it("the gained card burns WITH the diablerist when the blood hunt passes", () => {
    // The Discipline is gained first and the hunt follows, so a diablerist
    // who is then burned takes it with them (p. 16 — the cards on a burned
    // minion burn too). The whole sequence, end to end.
    const state = game(7, [{ id: "d1", name: "Potence" }]);
    state.seats[1]!.minions.find((m) => m.id === "W")!.title = "prince";
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "diablerize:V1:T"],
      ...clearAction,
      ["Alice", "choice:diablerieDiscipline:V1:diablerieDiscipline:library:d1"],
      ["Alice", "pass"],
      ["Bob", "vote:W:for"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(state.seats[0]!.minions.some((m) => m.id === "V1")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "PermanentBurned" && e.cardId === "d1")).toBe(
      true,
    );
    // ...and the game is still answerable.
    expect(engine.decision()).not.toBeNull();
  });
});
