/**
 * Summon History (101897) — step 1: the X. "Cost: X blood" is decided as the
 * card is played (LSJ 20100314) and paid THEN, not on success like Bloodlust
 * (docs/cheap-tail-design.md, `variableBloodX`). The search and the crypt
 * summon are not built yet.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

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
