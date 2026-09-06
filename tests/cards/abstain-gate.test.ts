/**
 * The abstain gate (docs/abstain-gate-design.md) — the first effects that
 * UN-cast a vote, stop a referendum, outlive the tally, or silence a minion
 * for the rest of the turn.
 *
 * Scalpel Tongue (101686), Telepathic Vote Counting (101951), Scorn of
 * Adonis (101692), Expulsion (102276).
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Alice calls Anarchist Uprising and reaches the polling step. */
function toPolling(): Array<[string, string]> {
  return [
    ["Alice", "play:Anarchist Uprising"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → polling
  ];
}

/** Alice calls; Bob's W is a prince, so he has a vote to lose. */
function votingGame(): GameState {
  const state = threeSeatGame();
  state.seats[0]!.minions[0]!.title = "prince";
  state.seats[0]!.hand.push({ id: "au1", name: "Anarchist Uprising" });
  state.seats[1]!.minions[0]!.title = "prince";
  return state;
}

describe("Scalpel Tongue (101686) — un-casting a vote", () => {
  it("cancels votes already cast and bars the vampire from casting again", () => {
    const state = votingGame();
    state.seats[0]!.minions[0]!.disciplines = { cel: "basic", pre: "basic" };
    state.seats[0]!.hand.push({ id: "st1", name: "Scalpel Tongue" });
    const engine = new VtesEngine(state, testRegistry);

    // Bob's prince votes against, then Alice silences him.
    runTrace(engine, [...toPolling(), ["Alice", "pass"], ["Bob", "vote:W:against"]]);
    const ref = state.frames.find((f) => f.kind === "referendum");
    expect(ref!.kind === "referendum" && ref!.votes.length).toBe(1);

    // Casting a vote rewinds the impulse to the acting seat, so Alice is
    // asked next — not Carol.
    runTrace(engine, [
      ["Alice", "play:Scalpel Tongue:basic:V1:W:st1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);

    const after = state.frames.find((f) => f.kind === "referendum");
    expect(after!.kind === "referendum" && after!.votes.length).toBe(0);
    expect(after!.kind === "referendum" && after!.abstaining).toContain("W");
    // Locked, per the card.
    expect(state.seats[1]!.minions.find((m) => m.id === "W")!.locked).toBe(true);
    // A prince casts 2 votes, and all of them go.
    expect(
      state.eventLog.some((e) => e.type === "VampireAbstained" && e.votesCancelled === 2),
    ).toBe(true);

    // And Bob is not offered that vote source again.
    for (let i = 0; i < 8 && engine.decision(); i++) {
      const d = engine.decision()!;
      if (d.seat === "Bob") {
        expect(d.options.some((o) => o.id.startsWith("vote:W"))).toBe(false);
        return;
      }
      runTrace(engine, [[d.seat, "pass"]]);
    }
    throw new Error("Bob was never polled again");
  });

  it("only targets a vampire who HAS cast — the card says so", () => {
    const state = votingGame();
    state.seats[0]!.minions[0]!.disciplines = { cel: "basic", pre: "basic" };
    state.seats[0]!.hand.push({ id: "st1", name: "Scalpel Tongue" });
    const engine = new VtesEngine(state, testRegistry);
    // Nobody has voted yet, so there is no legal target at all.
    runTrace(engine, [...toPolling()]);
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Scalpel Tongue")),
    ).toBe(false);
  });

  it("burns the target's blood at superior", () => {
    const state = votingGame();
    state.seats[0]!.minions[0]!.disciplines = { cel: "superior", pre: "superior" };
    state.seats[0]!.hand.push({ id: "st1", name: "Scalpel Tongue" });
    const engine = new VtesEngine(state, testRegistry);
    const before = state.seats[1]!.minions.find((m) => m.id === "W")!.blood;
    runTrace(engine, [
      ...toPolling(),
      ["Alice", "pass"], ["Bob", "vote:W:against"],
      ["Alice", "play:Scalpel Tongue:superior:V1:W:st1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.seats[1]!.minions.find((m) => m.id === "W")!.blood).toBe(before - 1);
  });
});

describe("Telepathic Vote Counting (101951)", () => {
  it("cancels the referendum and returns the calling card to hand", () => {
    const state = votingGame();
    state.seats[0]!.minions[0]!.disciplines = { aus: "basic" };
    state.seats[0]!.hand.push({ id: "tvc", name: "Telepathic Vote Counting" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ...toPolling(),
      ["Alice", "play:Telepathic Vote Counting:basic:V1:tvc"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);

    // Cancelled, not resolved: no result and no effects.
    expect(state.eventLog.some((e) => e.type === "ReferendumCancelled")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "ReferendumResolved")).toBe(false);
    expect(state.frames.some((f) => f.kind === "referendum")).toBe(false);
    // The calling card ends up back in hand. Note it was already burned at
    // ACTION resolution — only a title-granting card is held past that
    // point (p. 27) — so "return it to its owner's hand" is a retrieval,
    // and the log honestly shows both the burn and the return.
    expect(state.eventLog.some((e) => e.type === "CardReturnedToHand")).toBe(true);
    expect(state.seats[0]!.hand.some((c) => c.name === "Anarchist Uprising")).toBe(true);
  });

  it("forces an abstention at superior, with no lock and no vote needed", () => {
    const state = votingGame();
    state.seats[0]!.minions[0]!.disciplines = { aus: "superior" };
    state.seats[0]!.hand.push({ id: "tvc", name: "Telepathic Vote Counting" });
    const engine = new VtesEngine(state, testRegistry);
    // W has not voted; Scalpel Tongue could not touch him, this can.
    runTrace(engine, [
      ...toPolling(),
      ["Alice", "play:Telepathic Vote Counting:superior:V1:W:tvc"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const ref = state.frames.find((f) => f.kind === "referendum");
    expect(ref!.kind === "referendum" && ref!.abstaining).toContain("W");
    expect(state.seats[1]!.minions.find((m) => m.id === "W")!.locked).toBe(false);
  });
});

describe("Scorn of Adonis (101692) — an effect after the tally", () => {
  it("burns 1 pool from each Methuselah who voted against", () => {
    const state = votingGame();
    state.seats[0]!.hand.push({ id: "soa", name: "Scorn of Adonis" });
    const bobPool = state.seats[1]!.pool;
    const carolPool = state.seats[2]!.pool;
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ...toPolling(),
      ["Alice", "play:Scorn of Adonis:basic:V1:soa"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      // Alice casts nothing, so the referendum FAILS. That is deliberate:
      // the card says "once results are tallied", not "if it passes", and
      // a failed Anarchist Uprising burns nobody — which leaves only
      // Scorn's own burn in the log to assert on.
      ["Alice", "pass"],
      ["Bob", "vote:W:against"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // quiesce → tally
    ]);
    expect(
      state.eventLog.some((e) => e.type === "ReferendumResolved" && !e.passed),
    ).toBe(true);
    // Assert on the POST-TALLY burn specifically. The referendum itself
    // (Anarchist Uprising) burns pool from everyone when it passes, so
    // comparing raw pools would credit Scorn with that card's work.
    const tallyAt = state.eventLog.findIndex((e) => e.type === "ReferendumResolved");
    expect(tallyAt).toBeGreaterThanOrEqual(0);
    const after = state.eventLog.slice(tallyAt + 1).filter((e) => e.type === "PoolBurned");
    // Bob voted against and pays; Carol did not vote and does not.
    expect(after.some((e) => e.type === "PoolBurned" && e.seat === "Bob" && e.amount === 1)).toBe(
      true,
    );
    expect(after.some((e) => e.type === "PoolBurned" && e.seat === "Carol")).toBe(false);
    expect(after.some((e) => e.type === "PoolBurned" && e.seat === "Alice")).toBe(false);
    // Silence the unused-binding lint on the captured baselines.
    expect(bobPool).toBeGreaterThan(0);
    expect(carolPool).toBeGreaterThan(0);
  });
});

describe("Yoruba Shrine (102201)", () => {
  /** Bob holds the Shrine and a ready Banu Haqim; Alice rushes it. */
  function rushGame(clan: string): GameState {
    const state = threeSeatGame();
    const target = state.seats[1]!.minions[0]!;
    target.clan = clan;
    state.seats[1]!.permanents.push({
      card: { id: "ys", name: "Yoruba Shrine" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["location"],
    });
    // Alice needs a rush to make a minion-targeted directed action.
    // Umbrous Clutch is a rush: a directed action whose target is a minion.
    state.seats[0]!.minions[0]!.disciplines = { obl: "superior" };
    state.seats[0]!.hand.push({ id: "uc1", name: "Umbrous Clutch" });
    return state;
  }

  it("fails a directed action aimed at a Banu Haqim and unlocks the actor", () => {
    const state = rushGame("Banu Haqim");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Umbrous Clutch:superior:V1:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ]);
    // Announced, so V1 is locked. Bob's Shrine is offered.
    expect(state.seats[0]!.minions[0]!.locked).toBe(true);
    runTrace(engine, [["Alice", "pass"]]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("ability:Yoruba Shrine"))).toBe(true);

    runTrace(engine, [["Bob", "ability:Yoruba Shrine:ys:cancel"]]);
    // The action failed and the actor was unlocked, so it may act again.
    expect(state.seats[1]!.permanents[0]!.locked).toBe(true);
    expect(state.seats[0]!.minions[0]!.locked).toBe(false);
    expect(state.eventLog.some((e) => e.type === "CombatBegan")).toBe(false);
  });

  it("does NOT fire for the legacy clan name — the registry says Banu Haqim", () => {
    // The Priority Contract bug in miniature: filtering "Assamite" would
    // match no imported vampire, and an empty option list for the wrong
    // reason looks exactly like one for the right reason.
    const state = rushGame("Assamite");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Umbrous Clutch:superior:V1:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
    ]);
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("ability:Yoruba Shrine")),
    ).toBe(false);
  });

  it("is not offered when the target is not the Shrine controller's clan", () => {
    const state = rushGame("Brujah");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Umbrous Clutch:superior:V1:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
    ]);
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("ability:Yoruba Shrine")),
    ).toBe(false);
  });
});

describe("polling-only effects stay out of ordinary action windows", () => {
  it("does not offer Scalpel Tongue as a plain reaction", () => {
    // Found by the fuzz, and the THIRD time this exact bug has appeared
    // (modifyVotes, then restrictVotes, then this): a polling-only mode
    // offered during a normal action resolves with no referendum and
    // throws. Both enumeration sites now read POLLING_ONLY_EFFECTS.
    const state = threeSeatGame();
    state.seats[1]!.minions[0]!.disciplines = { cel: "superior", pre: "superior" };
    state.seats[1]!.minions[0]!.blood = 4;
    state.seats[1]!.hand.push({ id: "st1", name: "Scalpel Tongue" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.includes("Scalpel Tongue"))).toBe(false);
  });
});

describe("Expulsion (102276) — a restriction that outlives the referendum", () => {
  it("stops the chosen minions blocking, reacting and voting this turn", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.title = "prince";
    state.seats[0]!.hand.push({ id: "ex1", name: "Expulsion" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Expulsion"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → terms
      ["Alice", "terms:W"],
      ["Alice", "vote:V1:for"],
      ["Alice", "vote:caller:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // tally
    ]);
    expect(state.eventLog.some((e) => e.type === "MinionExpelled")).toBe(true);
    const w = state.seats[1]!.minions.find((m) => m.id === "W")!;
    expect(w.expelledThisTurn).toBe(true);
    // It does NOT stop them acting — the card lists three verbs and
    // acting is not one of them.
    expect(w.locked).toBe(false);
  });

  it("keeps an expelled minion out of the block options", () => {
    const state = threeSeatGame();
    state.seats[1]!.minions[0]!.expelledThisTurn = true;
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id === "block:W")).toBe(false);
    // Bob's other minion is untouched.
    expect(dp.options.some((o) => o.id === "block:M")).toBe(true);
  });
});
