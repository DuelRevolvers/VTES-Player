/**
 * Events that are one table-wide rule (docs/table-rule-events-design.md).
 *
 * Port Authority (101420), NRA PAC (101305), Urban Jungle (102085).
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id)!;
}

function entry(id: string, name: string): PermanentInPlay {
  const h = testRegistry[name];
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h?.permanentStatics ?? {},
    tags: h?.permanentTags ?? [],
  };
}

// ---------------------------------------------------------------------------

describe("Port Authority (101420)", () => {
  it("holds the discard's replacement until the unlock phase", () => {
    const state = threeSeatGame();
    // Carol's play area — it rules the whole table, not its controller.
    state.seats[2]!.permanents.push(entry("pa", "Port Authority"));
    state.seats[0]!.library.push({ id: "lib", name: "Conditioning" });
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") {
      tf.phase = "discard";
      tf.discardActionsLeft = 1;
    }
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "discard:c1"]]);
    expect(state.seats[0]!.library.length).toBe(1); // not replaced
    expect(state.seats[0]!.delayedDraws).toBe(1);
  });
});

describe("NRA PAC (101305)", () => {
  it("unlocks the equipper at end of turn, even once the card has gone", () => {
    const state = threeSeatGame();
    state.seats[1]!.permanents.push(entry("nra", "NRA PAC"));
    state.seats[0]!.hand.push({ id: "gun", name: ".44 Magnum" });
    const engine = new VtesEngine(state, testRegistry);
    const equip = engine
      .decision()!
      .options.find((o) => o.id.includes(".44 Magnum"))!.id;
    runTrace(engine, [
      ["Alice", equip],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(find(state, "V1").locked).toBe(true);
    expect(find(state, "V1").unlocksAtEndOfTurn).toBe(true);
    // "…regardless of whether NRA PAC is still in play or not."
    state.seats[1]!.permanents.length = 0;
    runTrace(engine, [
      ["Alice", "end"],
      ["Alice", "pass"], // influence
      ["Alice", "pass"], // discard
    ]);
    expect(find(state, "V1").locked).toBe(false);
  });
});

describe("Urban Jungle (102085)", () => {
  it("adds 2 votes against a BLOOD HUNT and nothing to an ordinary vote", () => {
    function margin(variant: "political" | "bloodHunt"): number {
      const state = threeSeatGame();
      state.seats[0]!.permanents.push(entry("uj", "Urban Jungle"));
      state.frames.push({
        kind: "referendum",
        variant,
        caller: "Alice",
        callingMinion: variant === "bloodHunt" ? null : "V1",
        cardName: variant === "bloodHunt" ? "" : "Anarchist Uprising",
        cardInstanceId: null,
        step: "polling",
        votes: [{ seat: "Alice", count: 3, inFavor: true }],
        usedSources: [],
        voteGrants: {},
        cycle: { order: ["Alice", "Bob", "Carol"], cursor: 0, passes: 3 },
        bloodHuntTarget: null,
      } as unknown as GameState["frames"][number]);
      const engine = new VtesEngine(state, testRegistry);
      engine.decision(); // drains the quiescent cycle → tally
      return state.eventLog
        .filter((e) => e.type === "ReferendumResolved")
        .map((e) => (e.type === "ReferendumResolved" ? e.votesFor - e.votesAgainst : 0))
        .at(-1)!;
    }
    expect(margin("political")).toBe(3);
    expect(margin("bloodHunt")).toBe(1);
  });
});
