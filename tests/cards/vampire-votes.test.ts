/**
 * Wave 108 — a vampire's votes are one group (docs/vampire-votes-design.md).
 *
 * p. 28: "all of the votes and ballots from any given vampire or other source
 * must be cast in agreement as a group." The kernel half (§4) is pinned
 * first, then the four cards that read it: Traditionalist, Tribunal
 * Judgment, Emissary and Disarming Presence.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay, ReferendumFrame } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function perm(id: string, name: string, tags: string[] = []): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags };
}

function ref(state: GameState): ReferendumFrame {
  const f = state.frames.find((x) => x.kind === "referendum");
  if (!f || f.kind !== "referendum") throw new Error("no referendum underway");
  return f;
}

const pass3: Array<[string, string]> = [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]];

/** Alice's V1 calls Anarchist Uprising (no terms) and reaches polling. */
function toPolling(state: GameState): VtesEngine {
  state.seats[0]!.hand.push({ id: "au1", name: "Anarchist Uprising" });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [["Alice", "play:Anarchist Uprising"], ...pass3, ...pass3, ...pass3, ...pass3]);
  return engine;
}

/** Pass every decision until the referendum is gone. */
function finish(engine: VtesEngine, state: GameState): void {
  for (let i = 0; i < 30 && state.frames.some((f) => f.kind === "referendum"); i++) {
    const dp = engine.decision()!;
    runTrace(engine, [[dp.seat, dp.options.find((o) => o.id === "pass")!.id]]);
  }
}

function voteIds(engine: VtesEngine): string[] {
  return engine.decision()!.options.filter((o) => o.kind === "castVote").map((o) => o.id);
}

function countOf(engine: VtesEngine, id: string): number | undefined {
  const o = engine.decision()!.options.find((x) => x.id === id);
  return o && o.kind === "castVote" ? o.count : undefined;
}

/** Walk passes until `seat` has a decision. */
function walkTo(engine: VtesEngine, seat: string): void {
  for (let i = 0; i < 10 && engine.decision()!.seat !== seat; i++) {
    const dp = engine.decision()!;
    runTrace(engine, [[dp.seat, "pass"]]);
  }
  expect(engine.decision()!.seat).toBe(seat);
}

const resolved = (state: GameState) => state.eventLog.find((e) => e.type === "ReferendumResolved");

// ---------------------------------------------------------------------------
// The kernel (§4)
// ---------------------------------------------------------------------------

describe("p. 28 — one vampire, one group", () => {
  it("votes a vampire gains after it casts go its way only (owner ruling Q1)", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { title: "primogen", disciplines: { pre: "basic" } });
    state.seats[0]!.hand.push({ id: "bo1", name: "Bewitching Oration" });
    const engine = toPolling(state);
    runTrace(engine, [["Alice", "vote:V1:for"]]); // the primogen's 1
    runTrace(engine, [["Alice", "play:Bewitching Oration:basic"], ...pass3]);
    // "This vampire gets +2 votes" after it went FOR: castable, FOR only.
    expect(countOf(engine, "vote:V1:for")).toBe(2);
    expect(voteIds(engine)).not.toContain("vote:V1:against");
    runTrace(engine, [["Alice", "vote:V1:for"]]);
    finish(engine, state);
    expect(resolved(state)).toMatchObject({ votesFor: 3, votesAgainst: 0 });
  });

  it("a vampire that bought votes AGAINST may cast its title votes against only (owner ruling Q2)", () => {
    const state = threeSeatGame();
    find(state, "W").title = "primogen";
    const engine = toPolling(state);
    ref(state).bloodVoteOffers = [{ votesPerBlood: 1 }]; // Mob Rule's shape
    walkTo(engine, "Bob");
    expect(voteIds(engine)).toEqual(
      expect.arrayContaining(["vote:W:for", "vote:W:against", "vote:blood:W:0:for"]),
    );
    runTrace(engine, [["Bob", "vote:blood:W:0:against"]]);
    walkTo(engine, "Bob");
    const ids = voteIds(engine);
    expect(ids).toContain("vote:W:against");
    expect(ids).not.toContain("vote:W:for");
    expect(ids).not.toContain("vote:blood:W:0:for");
    // M never cast, so its group is still free.
    expect(ids).toContain("vote:blood:M:0:for");
  });

  it("a vampire's granted votes need the vampire ready, and obey its bars", () => {
    const state = threeSeatGame();
    const engine = toPolling(state);
    const rf = ref(state);
    rf.minionVoteGrants = { W: { any: 2, for: 0, against: 0 } };
    walkTo(engine, "Bob");
    expect(countOf(engine, "vote:W:for")).toBe(2); // the positive control
    expect(voteIds(engine).some((id) => id.startsWith("vote:grant"))).toBe(false);

    const w = find(state, "W");
    w.inTorpor = true; // p. 28: "only when the minion is ready"
    expect(voteIds(engine).some((id) => id.startsWith("vote:W:"))).toBe(false);
    w.inTorpor = false;

    rf.voteRestriction = { sect: "camarilla" }; // W has no sect (Closed Session)
    expect(voteIds(engine).some((id) => id.startsWith("vote:W:"))).toBe(false);
    delete rf.voteRestriction;

    rf.abstaining = ["W"];
    expect(voteIds(engine).some((id) => id.startsWith("vote:W:"))).toBe(false);
  });

  it("an abstention un-casts a vampire's bought votes too", () => {
    const state = threeSeatGame();
    find(state, "W").title = "primogen";
    const engine = toPolling(state);
    ref(state).bloodVoteOffers = [{ votesPerBlood: 1 }];
    walkTo(engine, "Bob");
    runTrace(engine, [["Bob", "vote:blood:W:0:for"]]);
    walkTo(engine, "Bob");
    runTrace(engine, [["Bob", "vote:W:for"]]);
    expect(ref(state).votes.filter((v) => v.minion === "W").map((v) => v.source)).toEqual([
      "blood:W",
      "W",
    ]);
    engine.forceAbstain("W");
    expect(ref(state).votes.some((v) => v.minion === "W")).toBe(false);
  });

  it("each Methuselah card is its own source, castable its own way (owner ruling Q3)", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(
      perm("vh0", "Ventrue Headquarters", ["location"]),
      perm("bt0", "The Black Throne", ["location"]),
    );
    const engine = toPolling(state);
    runTrace(engine, [["Alice", "ability:Ventrue Headquarters"], ["Alice", "ability:The Black Throne"]]);
    runTrace(engine, [["Alice", "vote:grant:vh0:for"]]);
    expect(voteIds(engine)).toContain("vote:grant:bt0:against");
    runTrace(engine, [["Alice", "vote:grant:bt0:against"]]);
    finish(engine, state);
    expect(resolved(state)).toMatchObject({ votesFor: 3, votesAgainst: 2 });
  });

  it("a tallied referendum leaves a record of who cast how many", () => {
    const state = threeSeatGame();
    find(state, "W").title = "prince";
    const engine = toPolling(state);
    walkTo(engine, "Bob");
    runTrace(engine, [["Bob", "vote:W:against"]]);
    finish(engine, state);
    expect(state.lastReferendum?.votesByMinion).toEqual({ W: 2 });
  });
});

// ---------------------------------------------------------------------------
// Traditionalist (102005)
// ---------------------------------------------------------------------------

describe("Traditionalist (102005)", () => {
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    v1.title = "primogen";
    v1.attached.push(perm("tr1", "Traditionalist", ["archetype"]));
    find(state, "W").title = "prince";
    return { state, engine: toPolling(state) };
  }
  const gains = (state: GameState): number =>
    state.eventLog.filter((e) => e.type === "BloodGained" && e.minion === "V1").length;

  it("gains 1 blood when its vampire votes against and the referendum fails", () => {
    const { state, engine } = game();
    runTrace(engine, [["Alice", "vote:V1:against"]]);
    finish(engine, state);
    expect(resolved(state)).toMatchObject({ passed: false });
    expect(gains(state)).toBe(1);
  });

  it("NEGATIVE SPACE: not when the referendum passes anyway", () => {
    const { state, engine } = game();
    runTrace(engine, [["Alice", "vote:V1:against"]]);
    walkTo(engine, "Bob");
    runTrace(engine, [["Bob", "vote:W:for"]]); // 2 for, 1 against
    finish(engine, state);
    expect(resolved(state)).toMatchObject({ passed: true });
    expect(gains(state)).toBe(0);
  });

  it("NEGATIVE SPACE: not when its vampire voted FOR a referendum that failed", () => {
    const { state, engine } = game();
    runTrace(engine, [["Alice", "vote:V1:for"]]);
    walkTo(engine, "Bob");
    runTrace(engine, [["Bob", "vote:W:against"]]); // 1 for, 2 against
    finish(engine, state);
    expect(resolved(state)).toMatchObject({ passed: false });
    expect(gains(state)).toBe(0);
  });

  it("NEGATIVE SPACE: a cancelled referendum is not a failed one", () => {
    const { state, engine } = game();
    const entry = find(state, "V1").attached[0]!;
    testRegistry["Traditionalist"]!.onReferendumLost!(
      entry,
      { seat: "Alice", minion: "V1" },
      { callingMinion: "V1", how: "cancelled", votedAgainst: ["V1"] },
      engine,
    );
    expect(gains(state)).toBe(0);
    testRegistry["Traditionalist"]!.onReferendumLost!(
      entry,
      { seat: "Alice", minion: "V1" },
      { callingMinion: "V1", how: "failed", votedAgainst: ["V1"] },
      engine,
    );
    expect(gains(state)).toBe(1); // the control, and the use is spent…
    testRegistry["Traditionalist"]!.onReferendumLost!(
      entry,
      { seat: "Alice", minion: "V1" },
      { callingMinion: "V1", how: "failed", votedAgainst: ["V1"] },
      engine,
    );
    expect(gains(state)).toBe(1); // …once per turn
  });
});

// ---------------------------------------------------------------------------
// Tribunal Judgment (102022)
// ---------------------------------------------------------------------------

describe("Tribunal Judgment (102022)", () => {
  function game(record: GameState["lastReferendum"], lastTurnEnded?: number): GameState {
    const state = threeSeatGame();
    find(state, "V1").sect = "sabbat"; // "Requires a Sabbat vampire"
    state.seats[0]!.hand.push({ id: "tj1", name: "Tribunal Judgment" });
    if (record) state.lastReferendum = record;
    if (lastTurnEnded !== undefined) state.seats[0]!.lastTurnEnded = lastTurnEnded;
    return state;
  }
  const playable = (state: GameState): boolean =>
    new VtesEngine(state, testRegistry)
      .decision()!
      .options.some((o) => o.id.startsWith("play:Tribunal Judgment"));

  it("damages a chosen voter by the votes it cast in the last referendum", () => {
    const state = game({ turnNumber: 2, votesByMinion: { W: 2, N: 1 } }, 1);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Tribunal Judgment"], ...pass3, ...pass3, ...pass3, ...pass3]);
    const terms = engine.decision()!.options.map((o) => o.id);
    expect(terms).toEqual(expect.arrayContaining(["terms:W", "terms:N"]));
    expect(terms).not.toContain("terms:M"); // M cast nothing
    runTrace(engine, [["Alice", "terms:W"], ["Alice", "vote:caller:for"]]);
    const before = find(state, "W").blood;
    finish(engine, state);
    expect(resolved(state)).toMatchObject({ passed: true });
    expect(find(state, "W").blood).toBe(before - 2);
  });

  it("NEGATIVE SPACE: not playable when the last referendum was before your last turn ended", () => {
    // [LSJ 20020429]: your last turn does not qualify, your current one does.
    expect(playable(game({ turnNumber: 4, votesByMinion: { W: 2 } }, 4))).toBe(false);
    expect(playable(game({ turnNumber: 5, votesByMinion: { W: 2 } }, 4))).toBe(true);
  });

  it("NEGATIVE SPACE: not playable with no referendum, or no voter still in play", () => {
    expect(playable(game(undefined))).toBe(false);
    expect(playable(game({ turnNumber: 5, votesByMinion: { gone: 3 } }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Emissary (100638)
// ---------------------------------------------------------------------------

describe("Emissary (100638)", () => {
  /** Alice's V1 is an Anarch baron (the requirement) and A2 a younger
   *  anarch. Bob's W is an OLDER Camarilla vampire, his M a younger one;
   *  Carol's N is old but Sabbat. */
  function game(baron = true): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "anarch", title: baron ? "baron" : null });
    state.seats[0]!.minions.push(makeMinion("A2", "Alice", { sect: "anarch", capacity: 4 }));
    Object.assign(find(state, "W"), { sect: "camarilla", capacity: 6 });
    Object.assign(find(state, "M"), { sect: "camarilla", capacity: 3 });
    Object.assign(find(state, "N"), { sect: "sabbat", capacity: 9 });
    state.seats[0]!.hand.push({ id: "em1", name: "Emissary" });
    return { state, engine: toPolling(state) };
  }

  it("locks the anarch for 3 votes of its own, and only an older Camarilla can cancel them", () => {
    const { state, engine } = game();
    runTrace(engine, [["Alice", "play:Emissary:-:V1:A2"], ...pass3]);
    expect(find(state, "A2").locked).toBe(true);
    expect(countOf(engine, "vote:A2:for")).toBe(3);

    walkTo(engine, "Bob");
    const bob = engine.decision()!.options.map((o) => o.id);
    expect(bob).toContain("cancelvotes:W:A2");
    expect(bob).not.toContain("cancelvotes:M:A2"); // younger than the anarch
    runTrace(engine, [["Bob", "cancelvotes:W:A2"]]);
    expect(find(state, "W").locked).toBe(true);
    expect(ref(state).abstaining).toContain("A2");

    walkTo(engine, "Alice");
    expect(voteIds(engine).some((id) => id.startsWith("vote:A2:"))).toBe(false);
  });

  it("NEGATIVE SPACE: a Sabbat vampire cannot cancel, however old", () => {
    const { engine } = game();
    runTrace(engine, [["Alice", "play:Emissary:-:V1:A2"], ...pass3]);
    walkTo(engine, "Carol");
    expect(engine.decision()!.options.some((o) => o.id.startsWith("cancelvotes:"))).toBe(false);
  });

  it("NEGATIVE SPACE: not without a ready baron, and not once a vote is cast", () => {
    const noBaron = game(false);
    expect(noBaron.engine.decision()!.options.some((o) => o.id.startsWith("play:Emissary"))).toBe(false);
    const { engine } = game();
    expect(engine.decision()!.options.some((o) => o.id.startsWith("play:Emissary"))).toBe(true);
    runTrace(engine, [["Alice", "vote:V1:for"]]);
    expect(engine.decision()!.options.some((o) => o.id.startsWith("play:Emissary"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Disarming Presence (100550)
// ---------------------------------------------------------------------------

describe("Disarming Presence (100550)", () => {
  function game(level: "basic" | "superior"): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    find(state, "V1").disciplines = { pre: level };
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { title: "primogen" }));
    find(state, "W").title = "prince";
    state.seats[0]!.hand.push({ id: "dp1", name: "Disarming Presence" });
    return { state, engine: toPolling(state) };
  }

  it("[pre] locks every vampire as it votes", () => {
    const { state, engine } = game("basic");
    runTrace(engine, [["Alice", "play:Disarming Presence:basic"], ...pass3]);
    runTrace(engine, [["Alice", "vote:V2:for"]]);
    expect(find(state, "V2").locked).toBe(true);
    walkTo(engine, "Bob");
    runTrace(engine, [["Bob", "vote:W:against"]]);
    expect(find(state, "W").locked).toBe(true);
  });

  it("[PRE] spares the player's own vampires, and a locked vampire still votes", () => {
    const { state, engine } = game("superior");
    runTrace(engine, [["Alice", "play:Disarming Presence:superior"], ...pass3]);
    runTrace(engine, [["Alice", "vote:V2:for"]]);
    expect(find(state, "V2").locked).toBe(false);
    find(state, "W").locked = true; // [RTR 19941109]: a side effect, not a cost
    walkTo(engine, "Bob");
    expect(voteIds(engine)).toContain("vote:W:against");
    find(state, "W").locked = false;
    runTrace(engine, [["Bob", "vote:W:against"]]);
    expect(find(state, "W").locked).toBe(true);
  });

  it("NEGATIVE SPACE: needs Presence, and is gone once a vote is cast", () => {
    const { engine } = game("basic");
    const ids = (): string[] => engine.decision()!.options.map((o) => o.id);
    expect(ids()).toContain("play:Disarming Presence:basic:V1:dp1");
    expect(ids().some((id) => id.startsWith("play:Disarming Presence:superior"))).toBe(false);
    runTrace(engine, [["Alice", "vote:V2:for"]]);
    expect(ids().some((id) => id.startsWith("play:Disarming Presence"))).toBe(false);
  });
});
