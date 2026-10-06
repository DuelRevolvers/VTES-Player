/**
 * In this referendum (docs/in-this-referendum-design.md).
 *
 * Eat the Rich (100605), Investiture (101003), Praxis Seizure: Istanbul (101463).
 *
 * Three political actions whose OWN referendum changes who votes and how much:
 * titled vampires get quieter and the Edge louder; every ready cardinal gets
 * louder and the Camarilla are silenced; every ready Banu Haqim gets louder.
 * All three go through the one `applyReferendumRiders` helper the Justicars
 * now share, so each is asserted at the POLLING STEP — the only place a vote
 * rider is observable — as well as by its payout.
 */

import { describe, expect, it } from "vitest";
import type { GameState, LegalOption, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Announce the political action and pass every impulse up to the terms. */
function politicalTrace(prefix: string): Array<[string, string]> {
  return [
    ["Alice", prefix],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ];
}

/** Every vote option offered to `seat` at the polling step, with its count. */
function votesFor(engine: VtesEngine, seat: string): LegalOption[] {
  for (let i = 0; i < 12; i++) {
    const dp = engine.decision();
    if (!dp) return [];
    if (dp.seat === seat && dp.window === "referendum.polling") {
      return dp.options.filter((o) => o.kind === "castVote");
    }
    const pass = dp.options.find((o) => o.id === "pass");
    if (!pass) return [];
    engine.choose(pass.id);
  }
  return [];
}

function countOf(opts: LegalOption[], id: string): number | undefined {
  const o = opts.find((x) => x.id === id);
  return o && o.kind === "castVote" ? o.count : undefined;
}

/** Pass through the rest of the referendum. */
function finish(engine: VtesEngine, state: GameState): void {
  for (let i = 0; i < 40; i++) {
    if (!state.frames.some((f) => f.kind === "referendum")) return;
    const dp = engine.decision();
    if (!dp) return;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    engine.choose(pick.id);
  }
}

// ---------------------------------------------------------------------------

describe("Eat the Rich (100605) — titles quieter, the Edge louder", () => {
  /** Alice's anarch calls it. Bob's W is a PRINCE (2 votes); Bob holds the
   *  Edge; Carol controls no titled vampire. */
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "anarch" });
    Object.assign(find(state, "W"), { title: "prince", titleCity: "Chicago" });
    state.edge = "Bob";
    state.seats[0]!.hand.push({ id: "er", name: "Eat the Rich" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("at the polling step: the prince casts 1 instead of 2, the Edge 2 instead of 1", () => {
    const { engine } = game();
    runTrace(engine, [...politicalTrace("play:Eat the Rich"), ["Alice", "terms:Bob,Carol"]]);
    const bob = votesFor(engine, "Bob");
    expect(countOf(bob, "vote:W:against"), "the prince's vote").toBe(1);
    expect(countOf(bob, "vote:edge:against"), "the Edge's vote").toBe(2);
  });

  it("CONTROL: the same prince and Edge in an ordinary referendum cast 2 and 1", () => {
    // Empires Fall is a plain refChooseSeatsBurn — same shape, no riders.
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "sabbat" });
    Object.assign(find(state, "W"), { title: "prince", titleCity: "Chicago" });
    state.edge = "Bob";
    state.seats[0]!.hand.push({ id: "ef", name: "Empires Fall" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [...politicalTrace("play:Empires Fall"), ["Alice", "terms:Bob,Carol"]]);
    const bob = votesFor(engine, "Bob");
    expect(countOf(bob, "vote:W:against")).toBe(2);
    expect(countOf(bob, "vote:edge:against")).toBe(1);
  });

  it("the payout: +3 for a Methuselah controlling a ready TITLED vampire", () => {
    const { state, engine } = game();
    const bob = state.seats[1]!.pool;
    const carol = state.seats[2]!.pool;
    runTrace(engine, [
      ...politicalTrace("play:Eat the Rich"),
      ["Alice", "terms:Bob,Carol"],
      ["Alice", "vote:caller:for"],
    ]);
    finish(engine, state);
    expect(bob - state.seats[1]!.pool).toBe(4); // 1 + 3 (the prince)
    expect(carol - state.seats[2]!.pool).toBe(1); // untitled
  });

  it("NEGATIVE SPACE: needs an Anarch caller", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "camarilla" });
    state.seats[0]!.hand.push({ id: "er", name: "Eat the Rich" });
    const engine = new VtesEngine(state, testRegistry);
    expect(engine.decision()!.options.some((o) => o.id.startsWith("play:Eat the Rich"))).toBe(false);
  });
});

describe("Investiture (101003) — cardinals louder, the Camarilla silenced", () => {
  /** Alice's V1 is a Sabbat CARDINAL (the requirement) and names her own
   *  Sabbat vampire SB as priscus. Bob's W is a CAMARILLA prince; Carol's N is
   *  a Sabbat cardinal too. */
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "sabbat", title: "cardinal" });
    state.seats[0]!.minions.push(makeMinion("SB", "Alice", { sect: "sabbat", blood: 2, capacity: 5 }));
    Object.assign(find(state, "W"), { sect: "camarilla", title: "prince", titleCity: "Chicago" });
    Object.assign(find(state, "N"), { sect: "sabbat", title: "cardinal" });
    state.seats[0]!.hand.push({ id: "iv", name: "Investiture" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("at the polling step: the Camarilla prince may not vote; a cardinal's seat gets +1", () => {
    const { engine } = game();
    runTrace(engine, [...politicalTrace("play:Investiture"), ["Alice", "terms:SB"]]);
    const bob = votesFor(engine, "Bob");
    // "Camarilla vampires cannot cast votes or ballots during this referendum."
    expect(bob.some((o) => o.id.startsWith("vote:W:"))).toBe(false);
    // …and Bob controls no CARDINAL, so the rider grants him nothing: the
    // bonus is keyed on the title, not on "any ready vampire".
    expect(bob.some((o) => o.id.startsWith("vote:grant:"))).toBe(false);
    const carol = votesFor(engine, "Carol");
    // N's own 3 (cardinal) and the rider's +1, granted to Carol.
    expect(countOf(carol, "vote:N:for")).toBe(3);
    expect(countOf(carol, "vote:grant:for")).toBe(1);
  });

  it("the payout: the chosen Sabbat vampire becomes a priscus", () => {
    const { state, engine } = game();
    runTrace(engine, [
      ...politicalTrace("play:Investiture"),
      ["Alice", "terms:SB"],
      ["Alice", "vote:caller:for"],
    ]);
    finish(engine, state);
    expect(find(state, "SB").title).toBe("priscus");
  });

  it("NEGATIVE SPACE: needs a cardinal or regent, and names only Sabbat vampires", () => {
    const { state, engine } = game();
    // Terms: SB and the Sabbat cardinals are eligible; Bob's Camarilla W is not.
    runTrace(engine, politicalTrace("play:Investiture"));
    const terms = engine.decision()!.options.map((o) => o.id);
    expect(terms).toContain("terms:SB");
    expect(terms).not.toContain("terms:W");

    const plain = threeSeatGame();
    Object.assign(find(plain, "V1"), { sect: "sabbat", title: "bishop" });
    plain.seats[0]!.hand.push({ id: "iv", name: "Investiture" });
    const e2 = new VtesEngine(plain, testRegistry);
    expect(e2.decision()!.options.some((o) => o.id.startsWith("play:Investiture"))).toBe(false);
    void state;
  });
});

describe("Praxis Seizure: Istanbul (101463) — Banu Haqim louder, and locked", () => {
  /** Bob controls a ready Banu Haqim (BH) and Carol another (BH2). */
  function game(caller: Partial<MinionState>): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "camarilla", title: null, ...caller });
    state.seats[1]!.minions.push(makeMinion("BH", "Bob", { clan: "Banu Haqim", capacity: 5, blood: 2 }));
    state.seats[2]!.minions.push(makeMinion("BH2", "Carol", { clan: "Banu Haqim", capacity: 5, blood: 2 }));
    state.seats[0]!.hand.push({ id: "pi", name: "Praxis Seizure: Istanbul" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("at the polling step: each ready Banu Haqim earns its controller +1 vote", () => {
    const { engine } = game({ clan: "Ventrue" });
    runTrace(engine, politicalTrace("play:Praxis Seizure: Istanbul"));
    expect(countOf(votesFor(engine, "Bob"), "vote:grant:for")).toBe(1);
  });

  it("a non-Assamite prince: every ready Banu Haqim at the table LOCKS", () => {
    const { state, engine } = game({ clan: "Ventrue" });
    runTrace(engine, [...politicalTrace("play:Praxis Seizure: Istanbul"), ["Alice", "vote:caller:for"]]);
    finish(engine, state);
    expect(find(state, "V1").title).toBe("prince");
    expect(find(state, "BH").locked).toBe(true);
    expect(find(state, "BH2").locked).toBe(true);
  });

  it("THE TWIN: a Banu Haqim prince locks nobody", () => {
    const { state, engine } = game({ clan: "Banu Haqim" });
    runTrace(engine, [...politicalTrace("play:Praxis Seizure: Istanbul"), ["Alice", "vote:caller:for"]]);
    finish(engine, state);
    expect(find(state, "V1").title).toBe("prince");
    expect(find(state, "BH").locked).toBe(false);
    expect(find(state, "BH2").locked).toBe(false);
  });
});
