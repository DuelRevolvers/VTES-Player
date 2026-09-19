/**
 * The uncontrolled region as a place you pump and graduate from
 * (docs/uncontrolled-graduation-design.md).
 *
 * Gather (100812), Heartblood of the Clan (100906), Social Ladder (101820),
 * Tomb of Rameses III (101987).
 *
 * `threeSeatGame`'s uncontrolled region is EMPTY — a fixture the lessons
 * name as one that has passed tests for the wrong reason — so every test
 * here builds the region it needs and asserts against what is in it.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** A card in play carrying the statics its spec compiled. */
function inPlay(
  id: string,
  name: string,
  controller: string,
  over: Partial<PermanentInPlay> = {},
): PermanentInPlay {
  const h = testRegistry[name];
  if (!h) throw new Error(`no handler for ${name}`);
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: { ...(h.permanentStatics ?? {}) },
    tags: [...(h.permanentTags ?? [])],
    controller,
    ...over,
  };
}

function influencePhase(state: GameState, seat: string, transfers: number): GameState {
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn frame");
  tf.seat = seat;
  tf.phase = "influence";
  tf.transfersLeft = transfers;
  return state;
}

function uncontrolled(
  state: GameState,
  seat: string,
  id: string,
  over: Partial<MinionState> = {},
  counters = 0,
): void {
  seatOf(state, seat).uncontrolled.push({
    card: makeMinion(id, seat, { capacity: 4, ...over }),
    counters,
  });
}

const undirectedActionPasses: Array<[string, string]> = [
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // blocks declined
];

// ---------------------------------------------------------------------------

describe("Gather (100812)", () => {
  /** V1 is a capacity-5 Gangrel; the region holds a 4-cap Gangrel (younger),
   *  a 6-cap Gangrel (older) and a 3-cap Nosferatu. */
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Gangrel", capacity: 5, blood: 3 });
    seatOf(state, "Alice").hand.push({ id: "g", name: "Gather" });
    uncontrolled(state, "Alice", "U1", { clan: "Gangrel", capacity: 4 }, 4);
    uncontrolled(state, "Alice", "U2", { clan: "Gangrel", capacity: 6 });
    uncontrolled(state, "Alice", "U3", { clan: "Nosferatu", capacity: 3 });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("chooses a YOUNGER Gangrel and enters LOCKED", () => {
    const { state, engine } = game();
    runTrace(engine, [["Alice", "play:Gather"], ...undirectedActionPasses]);

    const ids = optionIds(engine);
    // U1 is younger; U2 is older than the acting vampire; U3 is not a
    // Gangrel. Both exclusions matter, and only one of them is about clan.
    expect(ids).toEqual(["choice:Gather:g:chooseUncontrolled:U1"]);
    runTrace(engine, [["Alice", "choice:Gather:g:chooseUncontrolled:U1"]]);

    const entry = seatOf(state, "Alice").permanents.find((p) => p.card.id === "g");
    expect(entry?.linkedUncontrolled).toBe("U1");
    // "Put this card in play, LOCKED": the graduation cannot happen the turn
    // the card is played.
    expect(entry?.locked).toBe(true);
  });

  it("moves the chosen vampire out with its counters, once unlocked", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Gangrel", capacity: 5 });
    uncontrolled(state, "Alice", "U1", { clan: "Gangrel", capacity: 4 }, 4);
    seatOf(state, "Alice").permanents.push(
      inPlay("g", "Gather", "Alice", { linkedUncontrolled: "U1" }),
    );
    influencePhase(state, "Alice", 0);
    const engine = new VtesEngine(state, testRegistry);

    expect(optionIds(engine)).toContain("ability:Gather:g:graduate:U1");
    runTrace(engine, [["Alice", "ability:Gather:g:graduate:U1"]]);

    // Out with 4 counters as 4 blood, and the card is locked — so it cannot
    // do it twice in one phase.
    expect(seatOf(state, "Alice").uncontrolled).toEqual([]);
    expect(find(state, "U1").blood).toBe(4);
    expect(seatOf(state, "Alice").permanents.find((p) => p.card.id === "g")?.locked).toBe(true);
  });

  it("is NOT offered while the move would contest a vampire in play", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Gangrel", capacity: 5 });
    // Bob controls a vampire with the same NAME as the uncontrolled one.
    seatOf(state, "Bob").minions.push(makeMinion("U1", "Bob", { clan: "Gangrel" }));
    uncontrolled(state, "Alice", "U1", { clan: "Gangrel", capacity: 4 }, 4);
    seatOf(state, "Alice").permanents.push(
      inPlay("g", "Gather", "Alice", { linkedUncontrolled: "U1" }),
    );
    influencePhase(state, "Alice", 0);
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((i) => i.includes("graduate")),
    ).toBe(false);
  });

  it("any vampire can burn it as a directed action costing 1 pool", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("g", "Gather", "Alice"));
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Bob";
      tf.phase = "minion";
    }
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((i) =>
        i.startsWith("act:Gather:g:burn:"),
      ),
    ).toBe(true);
  });
});

describe("Heartblood of the Clan (100906)", () => {
  function game(counters: number): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Banu Haqim", blood: 3 });
    seatOf(state, "Alice").permanents.push(
      inPlay("hb", "Heartblood of the Clan", "Alice", { counters }),
    );
    uncontrolled(state, "Alice", "U1", { clan: "Banu Haqim", capacity: 4 }, 1);
    uncontrolled(state, "Alice", "U2", { clan: "Brujah", capacity: 4 });
    return state;
  }

  it("any Banu Haqim feeds it as an UNDIRECTED action, one blood for one counter", () => {
    const state = game(0);
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "minion";
    const engine = new VtesEngine(state, testRegistry);
    const id = "act:Heartblood of the Clan:hb:feed:V1";
    expect(optionIds(engine)).toContain(id);

    runTrace(engine, [
      ["Alice", id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // blocks declined
    ]);
    expect(find(state, "V1").blood).toBe(2); // the cost, paid at resolution
    expect(seatOf(state, "Alice").permanents[0]!.counters).toBe(1);
  });

  it("moves any amount to a Banu Haqim in the region, and never past capacity", () => {
    const state = game(5);
    influencePhase(state, "Alice", 4);
    const ids = optionIds(new VtesEngine(state, testRegistry)).filter((i) =>
      i.includes("Heartblood"),
    );
    // U1 is a 4-capacity Banu Haqim holding 1: three counters fit, and a
    // fourth would drain straight back to the bank (p. 6). U2 is Brujah.
    expect(ids).toEqual([
      "ability:Heartblood of the Clan:hb:store:0:U1:1",
      "ability:Heartblood of the Clan:hb:store:0:U1:2",
      "ability:Heartblood of the Clan:hb:store:0:U1:3",
    ]);

    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "ability:Heartblood of the Clan:hb:store:0:U1:3"]]);
    expect(seatOf(state, "Alice").uncontrolled[0]!.counters).toBe(4);
    expect(seatOf(state, "Alice").permanents[0]!.counters).toBe(2);
  });

  it("offers nothing in the influence phase while it is empty", () => {
    const state = game(0);
    influencePhase(state, "Alice", 4);
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((i) => i.includes("hb:store")),
    ).toBe(false);
  });
});

describe("Social Ladder (101820)", () => {
  function game(): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { capacity: 5, blood: 4 });
    find(state, "V1").attached.push(inPlay("sl", "Social Ladder", "Alice"));
    uncontrolled(state, "Alice", "U1", { capacity: 7 }, 1); // older
    uncontrolled(state, "Alice", "U2", { capacity: 3 }); // younger
    return influencePhase(state, "Alice", 4);
  }

  it("spends its bearer to fill an OLDER vampire in the region", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    const ids = optionIds(engine).filter((i) => i.includes("spendbearer"));
    // Only the 7-capacity vampire is older than the 5-capacity bearer.
    expect(ids).toEqual(["ability:Social Ladder:sl:spendbearer:U1"]);

    runTrace(engine, [["Alice", "ability:Social Ladder:sl:spendbearer:U1"]]);
    // All four blood moved, and the bearer is REMOVED from the game — not
    // burned, so nothing reaches the ash heap.
    expect(seatOf(state, "Alice").uncontrolled.find((u) => u.card.id === "U1")?.counters).toBe(5);
    expect(state.seats.flatMap((s) => s.minions).some((m) => m.id === "V1")).toBe(false);
    expect(
      state.eventLog.some((e) => e.type === "MinionRemovedFromGame" && e.minion === "V1"),
    ).toBe(true);
  });

  it("offers nothing with no older vampire in the region", () => {
    const state = game();
    seatOf(state, "Alice").uncontrolled = seatOf(state, "Alice").uncontrolled.filter(
      (u) => u.card.id === "U2",
    );
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((i) => i.includes("spendbearer")),
    ).toBe(false);
  });
});

describe("Tomb of Rameses III (101987)", () => {
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(
      inPlay("tr", "Tomb of Rameses III", "Alice", { linkedUncontrolled: "U1", counters: 0 }),
    );
    uncontrolled(state, "Alice", "U1", { capacity: 4 }, 0);
    influencePhase(state, "Alice", 4);
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("matches each transfer to the chosen vampire from the blood bank", () => {
    const { state, engine } = game();
    runTrace(engine, [["Alice", "inf:add:U1"]]);
    expect(seatOf(state, "Alice").uncontrolled[0]!.counters).toBe(1);
    expect(seatOf(state, "Alice").permanents[0]!.counters).toBe(1);
  });

  it("does NOT match a transfer to a vampire it did not choose", () => {
    const { state, engine } = game();
    uncontrolled(state, "Alice", "U2", { capacity: 4 });
    runTrace(new VtesEngine(state, testRegistry), [["Alice", "inf:add:U2"]]);
    expect(seatOf(state, "Alice").permanents[0]!.counters).toBe(0);
    void engine;
  });

  it("graduates the vampire at the end of the phase — the card's counters COUNT", () => {
    const { state, engine } = game();
    // Two transfers: the vampire holds 2 and the Tomb holds 2, which is the
    // 4-capacity threshold without the Tomb's counters ever moving.
    runTrace(engine, [
      ["Alice", "inf:add:U1"],
      ["Alice", "inf:add:U1"],
      ["Alice", "pass"], // ends the influence phase
    ]);
    expect(optionIds(engine)).toContain("choice:Tomb of Rameses III:tr:graduateAtEnd:yes");
    runTrace(engine, [["Alice", "choice:Tomb of Rameses III:tr:graduateAtEnd:yes"]]);

    expect(seatOf(state, "Alice").uncontrolled).toEqual([]);
    // Out with ITS OWN counters as blood — 2, not 4.
    expect(find(state, "U1").blood).toBe(2);
    // "Burn this card when this vampire leaves the uncontrolled region."
    expect(seatOf(state, "Alice").permanents.some((p) => p.card.id === "tr")).toBe(false);
  });

  it("does not offer the move below the threshold", () => {
    const { state, engine } = game();
    runTrace(engine, [
      ["Alice", "inf:add:U1"],
      ["Alice", "pass"],
    ]);
    // 1 + 1 = 2, under the capacity of 4.
    expect(optionIds(engine).some((i) => i.includes("graduateAtEnd"))).toBe(false);
    expect(seatOf(state, "Alice").uncontrolled.length).toBe(1);
  });

  it("burns when the chosen vampire leaves the region by the ORDINARY route", () => {
    const { state, engine } = game();
    seatOf(state, "Alice").uncontrolled[0]!.counters = 4;
    runTrace(engine, [["Alice", "inf:out:U1"]]);
    expect(seatOf(state, "Alice").permanents.some((p) => p.card.id === "tr")).toBe(false);
  });
});
