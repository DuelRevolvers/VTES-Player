/**
 * Wave 109 — changing a vampire's votes (docs/vote-changing-design.md).
 *
 * Pulling Strings, Under the Skin, Kindred Coercion and Distant Friend, plus
 * the two defects the wave found: the abstain cards' "has a vote" check
 * (§3.1) and the same reaction twice in one referendum (§3.2).
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay, ReferendumFrame } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
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

/** Walk passes until `seat` has a decision. */
function walkTo(engine: VtesEngine, seat: string): void {
  for (let i = 0; i < 10 && engine.decision()!.seat !== seat; i++) {
    runTrace(engine, [[engine.decision()!.seat, "pass"]]);
  }
  expect(engine.decision()!.seat).toBe(seat);
}

const ids = (engine: VtesEngine): string[] => engine.decision()!.options.map((o) => o.id);
const resolved = (state: GameState) => state.eventLog.find((e) => e.type === "ReferendumResolved");

/** A Distant Friend already in Alice's region, about `chosen`. */
function distantFriendInPlay(state: GameState, chosen: string, superior = false): PermanentInPlay {
  const entry: PermanentInPlay = {
    card: { id: "df1", name: "Distant Friend" },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: superior ? ["Distant Friend", "superior"] : ["Distant Friend"],
    chosenMinion: chosen,
  };
  state.seats[0]!.permanents.push(entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Pulling Strings
// ---------------------------------------------------------------------------

describe("Pulling Strings — a younger vampire, or any at superior", () => {
  /** W (Bob, capacity 5) reacts; V1 is younger, N the same age, M older. */
  function table(): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { title: "primogen", capacity: 3 });
    Object.assign(find(state, "N"), { title: "primogen", capacity: 5 });
    Object.assign(find(state, "M"), { title: "primogen", capacity: 8 });
    state.seats[1]!.hand.push({ id: "ps1", name: "Pulling Strings" });
    return state;
  }

  it("basic reaches only a younger vampire; superior reaches the same age and older", () => {
    const state = table();
    const engine = toPolling(state);
    walkTo(engine, "Bob");
    const o = ids(engine);
    expect(o).toContain("play:Pulling Strings:basic:W:V1:ps1");
    expect(o).not.toContain("play:Pulling Strings:basic:W:N:ps1"); // same age is not younger
    expect(o).not.toContain("play:Pulling Strings:basic:W:M:ps1");
    expect(o).toContain("play:Pulling Strings:superior:W:N:ps1");
    expect(o).toContain("play:Pulling Strings:superior:W:M:ps1");
  });

  it("cancels the votes a younger vampire already cast", () => {
    const state = table();
    const engine = toPolling(state);
    runTrace(engine, [["Alice", "vote:V1:for"]]);
    walkTo(engine, "Bob");
    runTrace(engine, [["Bob", "play:Pulling Strings:basic:W:V1"], ...pass3]);
    expect(ref(state).abstaining).toContain("V1");
    finish(engine, state);
    expect(resolved(state)).toMatchObject({ votesFor: 0 });
  });

  it("is not offered during a referendum that passes automatically [PIB 20150105]", () => {
    const state = table();
    const engine = toPolling(state);
    walkTo(engine, "Bob");
    expect(ids(engine).some((id) => id.startsWith("play:Pulling Strings"))).toBe(true);
    ref(state).autoPass = true;
    expect(ids(engine).some((id) => id.startsWith("play:Pulling Strings"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3.2 — the same reaction twice in one referendum
// ---------------------------------------------------------------------------

describe("p. 24 — one minion, one copy of a reaction per action, polling included", () => {
  it("the vampire that played Pulling Strings cannot play a second copy; another vampire can", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { title: "primogen", capacity: 3 });
    Object.assign(find(state, "N"), { title: "primogen", capacity: 2 });
    find(state, "M").disciplines = { dom: "basic" };
    state.seats[1]!.hand.push(
      { id: "ps1", name: "Pulling Strings" },
      { id: "ps2", name: "Pulling Strings" },
    );
    const engine = toPolling(state);
    walkTo(engine, "Bob");
    runTrace(engine, [["Bob", "play:Pulling Strings:basic:W:V1:ps1"], ...pass3]);
    expect(ref(state).played).toContainEqual({ minion: "W", card: "Pulling Strings" });
    walkTo(engine, "Bob");
    const o = ids(engine);
    expect(o.some((id) => id.startsWith("play:Pulling Strings:basic:W:"))).toBe(false);
    expect(o).toContain("play:Pulling Strings:basic:M:N:ps2");
  });
});

// ---------------------------------------------------------------------------
// §3.1 — a vote is a vote, whatever gave it
// ---------------------------------------------------------------------------

describe("§3.1 — abstaining reads the one vote count", () => {
  it("a titleless vampire with a referendum rider has votes to abstain from", () => {
    const state = threeSeatGame();
    find(state, "M").capacity = 8;
    state.seats[1]!.hand.push({ id: "ps1", name: "Pulling Strings" });
    const engine = toPolling(state);
    walkTo(engine, "Bob");
    // No title, no grant, no cast: nothing to take away.
    expect(ids(engine)).not.toContain("play:Pulling Strings:superior:W:M:ps1");
    // "This vampire gets an additional 2 votes" (Cloak of Blood's shape).
    ref(state).extraVotes = [{ minion: "M", amount: 2 }];
    expect(ids(engine)).toContain("vote:M:for");
    expect(ids(engine)).toContain("play:Pulling Strings:superior:W:M:ps1");
  });
});

// ---------------------------------------------------------------------------
// Under the Skin
// ---------------------------------------------------------------------------

describe("Under the Skin — the caller's younger vampire abstains, before any vote", () => {
  /** V1 (capacity 6) calls; W is younger and titled, N older, M younger and voiceless. */
  function table(): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), {
      title: "primogen",
      capacity: 6,
      disciplines: { dom: "basic", aus: "superior", pre: "superior" },
    });
    Object.assign(find(state, "W"), { title: "primogen", capacity: 5 });
    Object.assign(find(state, "N"), { title: "primogen", capacity: 7 });
    state.seats[0]!.hand.push({ id: "us1", name: "Under the Skin" });
    return state;
  }

  it("is offered on a younger vampire with a vote, and not on an older one", () => {
    const state = table();
    const engine = toPolling(state);
    const o = ids(engine);
    expect(o).toContain("play:Under the Skin:basic:V1:W:us1");
    expect(o).not.toContain("play:Under the Skin:basic:V1:N:us1");
    // M is younger but has no vote: futile at basic, live at superior,
    // whose lock lands either way.
    expect(o).not.toContain("play:Under the Skin:basic:V1:M:us1");
    expect(o).toContain("play:Under the Skin:superior:V1:M:us1");
  });

  it("is not offered once a vote has been cast", () => {
    const state = table();
    const engine = toPolling(state);
    runTrace(engine, [["Alice", "vote:V1:for"]]);
    walkTo(engine, "Alice");
    expect(ids(engine).some((id) => id.startsWith("play:Under the Skin"))).toBe(false);
  });

  it("superior locks the vampire at the end of the action when the referendum passes", () => {
    const state = table();
    const engine = toPolling(state);
    runTrace(engine, [["Alice", "play:Under the Skin:superior:V1:W"], ...pass3]);
    expect(ref(state).abstaining).toContain("W");
    expect(ids(engine)).not.toContain("vote:W:for");
    runTrace(engine, [["Alice", "vote:V1:for"]]);
    expect(find(state, "W").locked).toBe(false); // not until the action ends
    finish(engine, state);
    expect(resolved(state)).toMatchObject({ passed: true });
    expect(find(state, "W").locked).toBe(true);
  });

  it("superior leaves the vampire unlocked when the referendum fails", () => {
    const state = table();
    const engine = toPolling(state);
    runTrace(engine, [["Alice", "play:Under the Skin:superior:V1:W"], ...pass3]);
    runTrace(engine, [["Alice", "vote:V1:against"]]);
    finish(engine, state);
    expect(resolved(state)).toMatchObject({ passed: false });
    expect(find(state, "W").locked).toBe(false);
  });

  it("basic does not lock even on a pass", () => {
    const state = table();
    const engine = toPolling(state);
    runTrace(engine, [["Alice", "play:Under the Skin:basic:V1:W"], ...pass3]);
    runTrace(engine, [["Alice", "vote:V1:for"]]);
    finish(engine, state);
    expect(resolved(state)).toMatchObject({ passed: true });
    expect(find(state, "W").locked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Kindred Coercion
// ---------------------------------------------------------------------------

describe("Kindred Coercion — X vampires no older than the reactor, X blood", () => {
  /** W (Bob, capacity 5, 3 blood) reacts; V1 is the same age, N younger, M older. */
  function table(): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { title: "primogen", capacity: 5 });
    Object.assign(find(state, "N"), { title: "primogen", capacity: 4 });
    Object.assign(find(state, "M"), { title: "primogen", capacity: 8 });
    state.seats[1]!.hand.push({ id: "kc1", name: "Kindred Coercion" });
    return state;
  }

  it("offers every choice of eligible vampires, the same age included and the older excluded", () => {
    const state = table();
    const engine = toPolling(state);
    walkTo(engine, "Bob");
    const o = ids(engine).filter((id) => id.startsWith("play:Kindred Coercion:basic:"));
    expect(o).toEqual(
      expect.arrayContaining([
        "play:Kindred Coercion:basic:W:V1:1:kc1",
        "play:Kindred Coercion:basic:W:N:1:kc1",
        "play:Kindred Coercion:basic:W:V1,N:2:kc1",
      ]),
    );
    expect(o).toHaveLength(3);
    expect(o.some((id) => id.includes("M"))).toBe(false);
  });

  it("X is bounded by the reactor's blood", () => {
    const state = table();
    find(state, "W").blood = 1;
    const engine = toPolling(state);
    walkTo(engine, "Bob");
    const o = ids(engine).filter((id) => id.startsWith("play:Kindred Coercion:basic:"));
    expect(o).toContain("play:Kindred Coercion:basic:W:V1:1:kc1");
    expect(o.some((id) => id.includes(":2:"))).toBe(false);
  });

  it("basic: pays X blood as it is played and both targets abstain", () => {
    const state = table();
    const engine = toPolling(state);
    runTrace(engine, [["Alice", "vote:V1:for"]]);
    walkTo(engine, "Bob");
    runTrace(engine, [["Bob", "play:Kindred Coercion:basic:W:V1,N:2"]]);
    expect(find(state, "W").blood).toBe(1); // paid at the play (p. 16)
    runTrace(engine, pass3);
    expect(ref(state).abstaining).toEqual(expect.arrayContaining(["V1", "N"]));
    finish(engine, state);
    expect(resolved(state)).toMatchObject({ votesFor: 0, votesAgainst: 0 });
  });

  it("superior: a cast vote can be turned, and is not offered the way it already goes", () => {
    const state = table();
    const engine = toPolling(state);
    runTrace(engine, [["Alice", "vote:V1:for"]]);
    walkTo(engine, "Bob");
    runTrace(engine, [["Bob", "play:Kindred Coercion:superior:W:V1:1"], ...pass3]);
    const o = ids(engine);
    expect(o).toContain("choice:Kindred Coercion:kc1:coerce:abstain");
    expect(o).toContain("choice:Kindred Coercion:kc1:coerce:against");
    expect(o).not.toContain("choice:Kindred Coercion:kc1:coerce:for");
    runTrace(engine, [["Bob", "choice:Kindred Coercion:kc1:coerce:against"]]);
    finish(engine, state);
    expect(resolved(state)).toMatchObject({ votesFor: 0, votesAgainst: 1 });
  });

  it("superior on a vampire that has not voted restricts its choice [RTR 19991001]", () => {
    const state = table();
    const engine = toPolling(state);
    walkTo(engine, "Bob");
    runTrace(engine, [["Bob", "play:Kindred Coercion:superior:W:N:1"], ...pass3]);
    runTrace(engine, [["Bob", "choice:Kindred Coercion:kc1:coerce:for"]]);
    walkTo(engine, "Carol");
    const o = ids(engine);
    expect(o).toContain("vote:N:for");
    expect(o).not.toContain("vote:N:against");
    // It is not forced to vote: Carol may still pass.
    expect(o).toContain("pass");
  });
});

// ---------------------------------------------------------------------------
// Distant Friend
// ---------------------------------------------------------------------------

describe("Distant Friend — the action", () => {
  it("chooses a vampire, is directed at its controller, and enters play remembering it", () => {
    const state = threeSeatGame();
    find(state, "V1").disciplines = { dom: "basic", pre: "basic" };
    state.seats[0]!.hand.push({ id: "df1", name: "Distant Friend" });
    const engine = new VtesEngine(state, testRegistry);
    const o = ids(engine);
    expect(o.some((id) => id.startsWith("play:Distant Friend:basic:V1:W:"))).toBe(true);
    // A combo card: Dominate alone does not play it.
    expect(o.some((id) => id.startsWith("play:Distant Friend:superior:"))).toBe(false);
    runTrace(engine, [["Alice", "play:Distant Friend:basic:V1:W"]]);
    for (
      let i = 0;
      i < 20 && state.frames.some((f) => f.kind === "action" || f.kind === "cardPlay");
      i++
    ) {
      runTrace(engine, [[engine.decision()!.seat, "pass"]]);
    }
    expect(state.eventLog.find((e) => e.type === "ActionAnnounced")).toMatchObject({
      target: "Bob",
    });
    const entry = state.seats[0]!.permanents.find((p) => p.card.id === "df1");
    expect(entry).toMatchObject({ chosenMinion: "W", tags: ["Distant Friend"] });
    expect(entry!.tags).not.toContain("location");
    expect(find(state, "V1").unlocksAtEndOfTurn).toBe(true);
  });
});

describe("Distant Friend — the burn", () => {
  it("turns the chosen vampire's cast votes, and is burned doing it", () => {
    const state = threeSeatGame();
    find(state, "W").title = "primogen";
    distantFriendInPlay(state, "W");
    const engine = toPolling(state);
    walkTo(engine, "Bob");
    runTrace(engine, [["Bob", "vote:W:for"]]);
    walkTo(engine, "Alice");
    const o = ids(engine);
    expect(o).toContain("ability:Distant Friend:df1:against");
    expect(o).not.toContain("ability:Distant Friend:df1:for"); // already for
    expect(o.some((id) => id.endsWith(":cast"))).toBe(false); // basic
    runTrace(engine, [["Alice", "ability:Distant Friend:df1:against"]]);
    expect(state.seats[0]!.permanents.some((p) => p.card.id === "df1")).toBe(false);
    finish(engine, state);
    expect(resolved(state)).toMatchObject({ votesFor: 0, votesAgainst: 1 });
  });

  it("superior forces the vampire to cast now, through the ordinary cast — toll included", () => {
    const state = threeSeatGame();
    find(state, "W").title = "primogen";
    // "Vampires must burn 1 blood to cast votes against referendums called
    // by Alexander Silverson" — carried by the calling vampire.
    find(state, "V1").attached.push({
      card: { id: "as1", name: "Toll" },
      locked: false,
      usedThisPhase: false,
      statics: { voteTollAgainst: { blood: 1 } },
      tags: [],
    });
    distantFriendInPlay(state, "W", true);
    const engine = toPolling(state);
    const o = ids(engine);
    expect(o).toEqual(
      expect.arrayContaining([
        "ability:Distant Friend:df1:for",
        "ability:Distant Friend:df1:for:cast",
        "ability:Distant Friend:df1:against",
        "ability:Distant Friend:df1:against:cast",
      ]),
    );
    const blood = find(state, "W").blood;
    runTrace(engine, [["Alice", "ability:Distant Friend:df1:against:cast"]]);
    expect(find(state, "W").blood).toBe(blood - 1);
    expect(ref(state).votes).toContainEqual(
      expect.objectContaining({ seat: "Bob", source: "W", minion: "W", inFavor: false, count: 1 }),
    );
    walkTo(engine, "Bob");
    expect(ids(engine).some((id) => id.startsWith("vote:W:"))).toBe(false); // spent
  });

  it("without the cast, a vampire that has not voted may abstain but not vote the other way", () => {
    const state = threeSeatGame();
    find(state, "W").title = "primogen";
    distantFriendInPlay(state, "W");
    const engine = toPolling(state);
    runTrace(engine, [["Alice", "ability:Distant Friend:df1:for"]]);
    walkTo(engine, "Bob");
    const o = ids(engine);
    expect(o).toContain("vote:W:for");
    expect(o).not.toContain("vote:W:against");
  });

  it("is not offered when the chosen vampire is not ready, nor in an auto-passing referendum", () => {
    const state = threeSeatGame();
    find(state, "W").title = "primogen";
    distantFriendInPlay(state, "W");
    const engine = toPolling(state);
    expect(ids(engine)).toContain("ability:Distant Friend:df1:against");
    find(state, "W").inTorpor = true;
    expect(ids(engine).some((id) => id.startsWith("ability:Distant Friend"))).toBe(false);
    expect(state.seats[0]!.permanents.some((p) => p.card.id === "df1")).toBe(true); // it stays
    find(state, "W").inTorpor = false;
    ref(state).autoPass = true;
    expect(ids(engine).some((id) => id.startsWith("ability:Distant Friend"))).toBe(false);
  });

  it("is only its controller's to burn", () => {
    const state = threeSeatGame();
    find(state, "W").title = "primogen";
    distantFriendInPlay(state, "W");
    const engine = toPolling(state);
    walkTo(engine, "Bob");
    expect(ids(engine).some((id) => id.startsWith("ability:Distant Friend"))).toBe(false);
  });
});
