/**
 * Summon History (101897) — step 1: the X. "Cost: X blood" is decided as the
 * card is played (LSJ 20100314) and paid THEN, not on success like Bloodlust
 * (docs/cheap-tail-design.md, `variableBloodX`). The search and the crypt
 * summon are not built yet.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function game(blood: number) {
  const state = threeSeatGame();
  const t = state.frames[0];
  if (t?.kind !== "turn") throw new Error("no turn frame");
  const alice = state.seats.find((s) => s.id === "Alice")!;
  const v1 = makeMinion("V1", "Alice");
  Object.assign(v1, { blood, disciplines: { tem: "basic" } });
  alice.minions.push(v1);
  alice.hand.push({ id: "sh", name: "Summon History" });
  return { state, engine: new VtesEngine(state, testRegistry) };
}

const xs = (engine: VtesEngine): string[] =>
  (engine.decision()?.options ?? [])
    .filter((o) => o.kind === "playCard" && o.name === "Summon History")
    .map((o) => (o.kind === "playCard" ? (o.params["xBlood"] ?? "") : ""));

describe("Summon History (101897): X chosen as it is played", () => {
  it("offers one play per X from 0 up to the blood the vampire has", () => {
    expect(xs(game(2).engine)).toEqual(["0", "1", "2"]);
    expect(xs(game(1).engine)).toEqual(["0", "1"]);
  });

  it("pays X blood AT PLAY, before anything resolves", () => {
    const { state, engine } = game(2);
    const option = engine.decision()!.options.find(
      (o) => o.kind === "playCard" && o.name === "Summon History" && o.params["xBlood"] === "2",
    )!;
    engine.choose(option.id);
    expect(find(state, "V1").blood).toBe(0);
  });

  it("is not charged a second time on success (Bloodlust's X is the success-paid kind)", () => {
    const { state, engine } = game(2);
    const option = engine.decision()!.options.find(
      (o) => o.kind === "playCard" && o.name === "Summon History" && o.params["xBlood"] === "1",
    )!;
    engine.choose(option.id);
    // One blood paid at play, one kept: no further burn when it resolves.
    expect(find(state, "V1").blood).toBe(1);
  });
});

describe("Summon History (101897): search for retainers and equipment, cost X or fewer", () => {
  /** V1 with tem and blood; a library and an ash heap to search. */
  function searchGame(x: number) {
    const state = threeSeatGame();
    const alice = state.seats.find((s) => s.id === "Alice")!;
    const v1 = makeMinion("V1", "Alice");
    Object.assign(v1, { blood: x, disciplines: { tem: "basic" } });
    alice.minions.push(v1);
    alice.hand.push({ id: "sh", name: "Summon History" });
    alice.library.push(
      { id: "filler", name: "Conditioning" }, // replacement draw on play
      { id: "mag", name: ".44 Magnum" }, // 2 pool: within X=2
      { id: "rifle", name: "Assault Rifle" }, // 5 pool: beyond X=2
      { id: "cond", name: "Conditioning" }, // not equipment
    );
    alice.ashHeap = [{ id: "ahMag", name: ".44 Magnum" }];
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  /** Play Summon History for X and pass through to the search question. */
  function toSearch(engine: VtesEngine, x: number): void {
    const option = engine.decision()!.options.find(
      (o) => o.kind === "playCard" && o.name === "Summon History" && o.params["xBlood"] === String(x),
    )!;
    engine.choose(option.id);
    for (let i = 0; i < 60; i++) {
      const dp = engine.decision();
      if (!dp || dp.options.some((o) => o.id.includes(":searchCostX:"))) return;
      runTrace(engine, [[dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id]]);
    }
  }

  const searchIds = (engine: VtesEngine): string[] =>
    (engine.decision()?.options ?? []).map((o) => o.id).filter((id) => id.includes(":searchCostX:"));

  it("offers the library and ash heap cards costing X or fewer, and always 'find nothing'", () => {
    const { engine } = searchGame(2);
    toSearch(engine, 2);
    const ids = searchIds(engine);
    expect(ids).toContain("choice:Summon History:sh:searchCostX:library:mag");
    expect(ids).toContain("choice:Summon History:sh:searchCostX:ashHeap:ahMag");
    expect(ids).toContain("choice:Summon History:sh:searchCostX:none");
    // Too expensive for X=2, and not a retainer or equipment.
    expect(ids.some((i) => i.endsWith(":rifle"))).toBe(false);
    expect(ids.some((i) => i.endsWith(":cond"))).toBe(false);
  });

  it("with X=1, nothing costs 2 pool, so only 'find nothing' is offered", () => {
    const { engine } = searchGame(1);
    toSearch(engine, 1);
    expect(searchIds(engine)).toEqual(["choice:Summon History:sh:searchCostX:none"]);
  });

  it("puts the chosen card on the vampire, pays nothing, and shuffles the library", () => {
    const { state, engine } = searchGame(2);
    const pool = state.seats[0]!.pool;
    toSearch(engine, 2);
    runTrace(engine, [["Alice", "choice:Summon History:sh:searchCostX:library:mag"]]);
    expect(find(state, "V1").attached.some((p) => p.card.id === "mag")).toBe(true);
    expect(state.seats[0]!.pool).toBe(pool);
    expect(state.eventLog.some((e) => e.type === "LibraryShuffled" && e.seat === "Alice")).toBe(true);
  });

  it("'find nothing' still shuffles the library (p. 14, p. 48)", () => {
    const { state, engine } = searchGame(2);
    toSearch(engine, 2);
    runTrace(engine, [["Alice", "choice:Summon History:sh:searchCostX:none"]]);
    expect(find(state, "V1").attached.length).toBe(0);
    expect(state.eventLog.some((e) => e.type === "LibraryShuffled" && e.seat === "Alice")).toBe(true);
  });
});
