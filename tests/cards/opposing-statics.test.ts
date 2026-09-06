/**
 * Cards in play that change what OTHERS may do to you
 * (docs/opposing-statics-design.md).
 *
 * Perfect Paragon (101387), Stolen Police Cruiser (101872), Archon
 * (100084), Raising the Portcullis (102303), Haqim's Law: Retribution
 * (102226).
 *
 * The cluster exists because two cards print the SAME sentence with
 * different lifetimes — "allies and younger vampires get −1 intercept",
 * action-scoped on one and persistent on the other — so both read one
 * filter, and the reading that matters is that the "and" is a UNION.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, currentIntercept } from "../../src/engine/index.ts";
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

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

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

function attach(state: GameState, minion: string, id: string, name: string): PermanentInPlay {
  const h = testRegistry[name];
  const p: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h?.permanentStatics ?? {},
    tags: h?.permanentTags ?? [],
  };
  find(state, minion).attached.push(p);
  return p;
}

function currentActionId(state: GameState): string {
  const f = state.frames.find((x) => x.kind === "action");
  if (f?.kind !== "action") throw new Error("no action frame");
  return f.actionId;
}

/**
 * Alice's V1 (capacity 7) bleeds. Bob has a younger vampire, an older
 * one and an ally — the three cases the filter has to tell apart.
 */
function blockerGame(): GameState {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { capacity: 7, blood: 5, sect: "anarch" });
  Object.assign(find(state, "W"), { capacity: 3 }); // younger
  Object.assign(find(state, "M"), { capacity: 9 }); // older
  seatOf(state, "Bob").minions.push(makeAlly("BA", "Bob", 2));
  return state;
}

// ---------------------------------------------------------------------------
// §1 — one filter, two lifetimes
// ---------------------------------------------------------------------------

describe("the shared 'allies and younger vampires' filter", () => {
  it("PERSISTENT (Stolen Police Cruiser): allies and younger vampires only", () => {
    const state = blockerGame();
    attach(state, "V1", "spc", "Stolen Police Cruiser");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const a = currentActionId(state);
    // The "and" is a UNION: the ally qualifies by kind, the capacity-3
    // vampire by age, and the capacity-9 vampire by neither.
    expect(currentIntercept(state, a, "BA")).toBe(-1);
    expect(currentIntercept(state, a, "W")).toBe(-1);
    expect(currentIntercept(state, a, "M")).toBe(0);
  });

  it("ACTION-SCOPED (Perfect Paragon superior): the same three answers", () => {
    const state = blockerGame();
    Object.assign(find(state, "V1"), { disciplines: { pre: "superior" } });
    seatOf(state, "Alice").hand.push({ id: "pp", name: "Perfect Paragon" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walkTo(engine, "play:Perfect Paragon:superior")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Perfect Paragon:superior"))!],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    const a = currentActionId(state);
    expect(currentIntercept(state, a, "BA")).toBe(-1);
    expect(currentIntercept(state, a, "W")).toBe(-1);
    expect(currentIntercept(state, a, "M")).toBe(0);
  });

  it("CONTROL: with neither card, nobody is penalised", () => {
    const state = blockerGame();
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const a = currentActionId(state);
    for (const id of ["BA", "W", "M"]) expect(currentIntercept(state, a, id)).toBe(0);
  });

  it("Stolen Police Cruiser's other two clauses", () => {
    const state = blockerGame();
    const p = attach(state, "V1", "spc", "Stolen Police Cruiser");
    expect(p.statics.bleed).toBe(1);

    // "Vampires can burn this card as a Ⓓ action that costs 1 pool; if
    // that action is successful, this Anarch is locked and does not
    // unlock as normal during their next unlock phase."
    const engine = new VtesEngine(state, testRegistry);
    // Bob's W takes it — but it is Alice's turn, so move the turn to Bob.
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn frame");
    tf.seat = "Bob";
    const e2 = new VtesEngine(state, testRegistry);
    const id = "act:Stolen Police Cruiser:spc:burn:W";
    expect(optionIds(e2)).toContain(id);
    runTrace(e2, [["Bob", id]]);
    // The action is DIRECTED at the card's controller, so the sequencing
    // order is not the plain seat order — walk it rather than script it.
    for (let i = 0; i < 24; i++) {
      const dp = e2.decision();
      if (!dp || !state.frames.some((f) => f.kind === "action")) break;
      runTrace(e2, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(find(state, "V1").attached.some((x) => x.card.id === "spc")).toBe(false);
    expect(find(state, "V1").locked).toBe(true);
    expect(find(state, "V1").skipNextUnlock).toBe(true);
    expect(seatOf(state, "Bob").pool).toBe(9); // the action's 1 pool
  });
});

describe("Perfect Paragon (101387) basic", () => {
  it("is a POLLING-step card: +3 votes, and not offered outside one", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), {
      disciplines: { pre: "basic" },
      blood: 4,
      title: "prince",
    });
    seatOf(state, "Alice").hand.push({ id: "krc", name: "Kine Resources Contested" });
    seatOf(state, "Alice").hand.push({ id: "pp", name: "Perfect Paragon" });
    const engine = new VtesEngine(state, testRegistry);
    // NEGATIVE SPACE: not on the table before the referendum exists.
    expect(optionIds(engine).some((o) => o.startsWith("play:Perfect Paragon:basic"))).toBe(
      false,
    );
    runTrace(engine, [
      ["Alice", "play:Kine Resources Contested"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "terms:Bob=2,Carol=2"],
    ]);
    expect(walkTo(engine, "play:Perfect Paragon:basic")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Perfect Paragon:basic"))!],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "vote:V1:for"], // the prince's own 2
      // The card's +3 arrive as a per-seat GRANT that still has to be
      // cast — the polling-votes gate's shape, not a silent bonus.
      ["Alice", "vote:grant:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    // A prince's 2 votes plus the card's 3.
    expect(resolved).toMatchObject({ passed: true, votesFor: 5 });
  });
});

// ---------------------------------------------------------------------------
// §2 — Archon
// ---------------------------------------------------------------------------

describe("Archon (100084)", () => {
  function archonGame(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { title: "prince", sect: "camarilla" });
    Object.assign(find(state, "W"), { sect: "camarilla" });
    Object.assign(find(state, "M"), { sect: "sabbat" });
    seatOf(state, "Alice").hand.push({ id: "ar", name: "Archon" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  const callTrace: Array<[string, string]> = [
    ["Alice", "play:Archon"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ];

  it("the terms are every CAMARILLA vampire, anyone's — and a Sabbat one is not", () => {
    const { engine } = archonGame();
    runTrace(engine, callTrace);
    const terms = optionIds(engine).filter((o) => o.startsWith("terms:"));
    expect(terms).toContain("terms:V1"); // the caller's own
    expect(terms).toContain("terms:W"); // an opponent's Camarilla
    expect(terms).not.toContain("terms:M"); // Sabbat
  });

  it("attaches on a pass, and the bearer's blockers pay a blood toll", () => {
    const { state, engine } = archonGame();
    runTrace(engine, [
      ...callTrace,
      ["Alice", "terms:W"],
      ["Alice", "vote:V1:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const on = find(state, "W").attached.find((p) => p.card.name === "Archon");
    expect(on).toBeDefined();
    expect(on!.statics.blockToll).toEqual({ amount: 1, payWith: "blood" });
    expect(on!.statics.noBloodHunt).toBe(true);
  });

  it("the block toll: a vampire pays, and an ALLY cannot attempt at all", () => {
    // p. 22 — allies hold life, not blood, so a toll printed in blood
    // locks them out. That falls out of the block-tax gate for free.
    const state = threeSeatGame();
    Object.assign(find(state, "W"), { sect: "camarilla", blood: 3 });
    attach(state, "W", "ar", "Archon");
    seatOf(state, "Carol").minions.push(makeAlly("CA", "Carol", 2));
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn frame");
    tf.seat = "Bob"; // Bob's W acts, Carol is his prey and may block
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Bob", "bleed:W"],
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"],
      ["Bob", "pass"],
    ]);
    const blocks = optionIds(engine).filter((o) => o.startsWith("block:"));
    expect(blocks).toContain("block:N"); // Carol's vampire, paying 1 blood
    expect(blocks).not.toContain("block:CA"); // her ally cannot pay
    const pool = find(state, "N").blood;
    runTrace(engine, [["Carol", "block:N"]]);
    // Paid to ATTEMPT, not to succeed (docs/block-tax-design.md).
    expect(find(state, "N").blood).toBe(pool - 1);
  });

  it("blood hunts cannot be called on the bearer — no referendum at all", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "camarilla", blood: 4 });
    attach(state, "V1", "ar", "Archon");
    // Bob's W is in torpor; V1 diablerises it.
    Object.assign(find(state, "W"), { inTorpor: true, blood: 1 });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "diablerize:V1:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.eventLog.some((e) => e.type === "DiablerieCommitted")).toBe(true);
    // The referendum is never pushed — a decision with no consequence is
    // not opened (§2).
    expect(state.frames.some((f) => f.kind === "referendum")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "BloodHuntCalled")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3 — a conditional aura
// ---------------------------------------------------------------------------

describe("Raising the Portcullis (102303)", () => {
  it("+1 bleed only WHILE the prey controls a vampire in torpor", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { title: "prince" });
    seatOf(state, "Alice").permanents.push({
      card: { id: "rtp", name: "Raising the Portcullis" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Raising the Portcullis"],
      aura: { scope: "controller", bleed: 1, whilePreyHasTorporVampire: true },
    });
    // Alice's prey is BOB. No torpid vampire yet.
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const first = state.eventLog.filter((e) => e.type === "PoolBurned" && e.seat === "Bob");
    expect(first.at(-1)).toMatchObject({ amount: 1 });

    // Now put one of Bob's vampires in torpor and bleed again.
    find(state, "M").inTorpor = true;
    find(state, "V1").locked = false;
    find(state, "V1").bledThisTurn = false;
    const e2 = new VtesEngine(state, testRegistry);
    runTrace(e2, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const second = state.eventLog.filter((e) => e.type === "PoolBurned" && e.seat === "Bob");
    expect(second.at(-1)).toMatchObject({ amount: 2 });
  });

  it("vampires can call a referendum to burn it", () => {
    const state = threeSeatGame();
    seatOf(state, "Bob").permanents.push({
      card: { id: "rtp", name: "Raising the Portcullis" },
      controller: "Bob",
      owner: "Bob",
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Raising the Portcullis"],
      aura: { scope: "controller", bleed: 1, whilePreyHasTorporVampire: true },
    });
    const engine = new VtesEngine(state, testRegistry);
    expect(optionIds(engine)).toContain("act:Raising the Portcullis:rtp:vote:V1");
  });
});

// ---------------------------------------------------------------------------
// §4 — Haqim's Law
// ---------------------------------------------------------------------------

describe("Haqim's Law: Retribution (102226)", () => {
  function lawGame(clan: string): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan });
    seatOf(state, "Alice").permanents.push({
      card: { id: "hl", name: "Haqim's Law: Retribution" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Haqim's Law: Retribution"],
    });
    seatOf(state, "Alice").hand.push({ id: "soak", name: "Soak" }); // combat
    seatOf(state, "Alice").library.push({ id: "L1", name: "Conditioning" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("a BANU HAQIM discards a combat card for +1 bleed", () => {
    // "Assamite" is the legacy name; the registry says Banu Haqim.
    const { state, engine } = lawGame("Banu Haqim");
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const id = "ability:Haqim's Law: Retribution:hl:bleedsale:soak";
    expect(walkTo(engine, id)).toBe(true);
    runTrace(engine, [["Alice", id]]);
    expect(
      state.eventLog.some(
        (e) =>
          e.type === "BleedAmountModified" &&
          e.source === "Haqim's Law: Retribution" &&
          e.delta === 1 &&
          e.limited === false,
      ),
    ).toBe(true);
    // The discard is REPLACED (p. 7).
    expect(seatOf(state, "Alice").hand.some((c) => c.id === "soak")).toBe(false);
    expect(seatOf(state, "Alice").hand.some((c) => c.id === "L1")).toBe(true);
  });

  it("NEGATIVE SPACE: the LEGACY name matches nothing", () => {
    // The Priority Contract trap, guarded for the fourth time.
    const { engine } = lawGame("Assamite");
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walkTo(engine, "ability:Haqim's Law", 15)).toBe(false);
  });

  it("NEGATIVE SPACE: a NON-combat card in hand is not a legal cost", () => {
    const { state, engine } = lawGame("Banu Haqim");
    seatOf(state, "Alice").hand = [{ id: "cond", name: "Conditioning" }];
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walkTo(engine, "ability:Haqim's Law", 15)).toBe(false);
  });
});
