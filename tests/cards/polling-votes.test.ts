/**
 * Votes granted by cards during polling (docs/polling-votes-design.md):
 * the polling step accepting card plays, the `modifyVotes` action
 * modifiers/reactions, and location vote-grants.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function loc(id: string, name: string): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: ["location"] };
}

/** Alice calls Anarchist Uprising (a terms-less referendum) and reaches
 *  the polling step. Requires "au1" (Anarchist Uprising) in Alice's hand. */
function toPolling(): Array<[string, string]> {
  return [
    ["Alice", "play:Anarchist Uprising"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → referendum polling
  ];
}

describe("Bewitching Oration (100157) — action-modifier votes", () => {
  it("the caller plays it during polling to add votes it then casts", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.disciplines = { pre: "basic" };
    alice.hand.push({ id: "au1", name: "Anarchist Uprising" });
    alice.hand.push({ id: "bo1", name: "Bewitching Oration" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...toPolling(),
      ["Alice", "play:Bewitching Oration:basic"], // V1 gets +2 votes
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Alice", "vote:V1:for"], // the 2 granted votes are V1's own (p. 47)
      ["Alice", "vote:caller:for"], // +1 from the calling card
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // quiesce
    ]);

    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: true, votesFor: 3, votesAgainst: 0 });
  });

  it("is not offered to a non-caller during polling (it is an action modifier)", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.disciplines = { pre: "basic" };
    alice.hand.push({ id: "au1", name: "Anarchist Uprising" });
    const bob = state.seats[1]!;
    bob.minions.find((x) => x.id === "W")!.disciplines = { pre: "basic" };
    bob.hand.push({ id: "bo1", name: "Bewitching Oration" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [...toPolling(), ["Alice", "pass"]]); // Alice done → Bob polls
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("play:Bewitching Oration"))).toBe(false);
  });
});

describe("Ominous Chorus (102278) — dual action-modifier/reaction", () => {
  it("is playable by the caller (as a modifier)", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.clan = "Lasombra";
    alice.hand.push({ id: "au1", name: "Anarchist Uprising" });
    alice.hand.push({ id: "oc1", name: "Ominous Chorus" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [...toPolling()]);
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("play:Ominous Chorus")),
    ).toBe(true);
  });

  it("is playable by a non-caller Lasombra (as a reaction)", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.hand.push({ id: "au1", name: "Anarchist Uprising" });
    const bob = state.seats[1]!;
    bob.minions.find((x) => x.id === "W")!.clan = "Lasombra";
    bob.hand.push({ id: "oc1", name: "Ominous Chorus" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [...toPolling(), ["Alice", "pass"]]); // → Bob polls
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("play:Ominous Chorus"))).toBe(true);

    runTrace(engine, [
      ["Bob", "play:Ominous Chorus:basic:W"], // "This Lasombra gets +3 votes"
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Alice", "pass"], // impulse rewound to the caller; Alice declines
      ["Bob", "vote:W:against"], // W casts its 3 against
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // quiesce
    ]);

    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    // Alice cast nothing (no title/vote); Bob cast 3 against → fails.
    expect(resolved).toMatchObject({ passed: false, votesAgainst: 3 });
  });
});

describe("Ventrue Headquarters (102109) / Oxford University (101341) — location votes", () => {
  it("Ventrue Headquarters locks during polling for +3 votes", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.permanents.push(loc("vh0", "Ventrue Headquarters"));
    alice.hand.push({ id: "au1", name: "Anarchist Uprising" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...toPolling(),
      ["Alice", "ability:Ventrue Headquarters"], // lock → +3 votes
      ["Alice", "vote:grant:vh0:for"], // the card is its own source (p. 28)
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(alice.permanents[0]!.locked).toBe(true);
    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: true, votesFor: 3 });
  });

  it("Oxford University burns X pool for +2X votes", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.pool = 5;
    alice.permanents.push(loc("ox0", "Oxford University, England"));
    alice.hand.push({ id: "au1", name: "Anarchist Uprising" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...toPolling(),
      ["Alice", "ability:Oxford University, England:ox0:votes:2"], // burn 2 → +4 votes
      ["Alice", "vote:grant:ox0:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: true, votesFor: 4 });
    // Anarchist Uprising passed: Alice burns 2 (Oxford) + 1 (one minion).
    expect(alice.pool).toBe(2); // 5 − 2 (Oxford) − 1 (Anarchist Uprising)
  });
});

describe("Protected District (102214) — a grant the CARD aims", () => {
  /** Bob's W is the primogen the card requires. A primogen also votes on
   *  its own title. Both are W's votes, so they are ONE group (p. 28): the
   *  card's +3 can only go against, and so the title vote goes with it or
   *  the +3 is left uncast. docs/vampire-votes-design.md §4.3 (this
   *  reverses polling-votes-design.md §3, which made them two sources). */
  function districtGame(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.hand.push({ id: "au1", name: "Anarchist Uprising" });
    const bob = state.seats[1]!;
    bob.minions.find((x) => x.id === "W")!.title = "primogen";
    bob.hand.push({ id: "pd1", name: "Protected District" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("W casts 1 + 3 AGAINST, or only its title vote FOR — the +3 never goes for", () => {
    const { state, engine } = districtGame();
    runTrace(engine, [
      ...toPolling(),
      ["Alice", "pass"], // → Bob polls
      ["Bob", "play:Protected District:basic:W:votes"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Alice", "pass"], // impulse rewound to the caller; Alice declines
    ]);

    // THE POINT OF THE CARD. The granted votes exist in one direction only,
    // and there is no Methuselah bucket to launder them through. Asserted
    // BEFORE casting, because an option list is the only place a
    // too-permissive grant shows.
    const votes = engine.decision()!.options.filter((o) => o.kind === "castVote");
    expect(votes.map((o) => o.id).filter((id) => id.startsWith("vote:grant"))).toEqual([]);
    const count = (id: string): number | undefined => {
      const o = votes.find((x) => x.id === id);
      return o && o.kind === "castVote" ? o.count : undefined;
    };
    expect(count("vote:W:against")).toBe(4);
    expect(count("vote:W:for")).toBe(1);

    runTrace(engine, [
      ["Bob", "vote:W:against"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // quiesce
    ]);

    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: false, votesFor: 0, votesAgainst: 4 });
  });

  it("NEGATIVE SPACE (p. 28): once W's title vote goes FOR, the +3 AGAINST is gone", () => {
    const { state, engine } = districtGame();
    runTrace(engine, [
      ...toPolling(),
      ["Alice", "pass"],
      ["Bob", "play:Protected District:basic:W:votes"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "vote:W:for"],
      ["Alice", "pass"],
    ]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("vote:W:"))).toBe(false);

    runTrace(engine, [["Bob", "pass"], ["Carol", "pass"]]);
    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: true, votesFor: 1, votesAgainst: 0 });
  });
});
