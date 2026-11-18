/**
 * Waters of Duat (102159): "You can search your library (shuffle afterward),
 * hand, and/or ash heap for a Discipline master card and put it on this new
 * vampire." The must-hunt boundary is in waters-of-duat-boundary.test.ts;
 * this file pins the search choice itself.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Play Waters of Duat and stop at the discipline-search choice. */
function toSearch(setup: (state: GameState) => void): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(find(state, "V1")!, { clan: "Ministry", capacity: 5, blood: 5 });
  state.seats[0]!.hand.push({ id: "wd", name: "Waters of Duat" });
  setup(state);
  const engine = new VtesEngine(state, testRegistry);
  for (let i = 0; i < 30 && !optionIds(engine).some((o) => o.startsWith("play:Waters of Duat")); i++) {
    engine.choose("pass");
  }
  engine.choose(optionIds(engine).find((o) => o.startsWith("play:Waters of Duat"))!);
  for (let i = 0; i < 30 && engine.decision()?.window !== "choice"; i++) {
    const dp = engine.decision()!;
    engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
  }
  return { state, engine };
}

describe("Waters of Duat (102159): discipline-master search", () => {
  it("a master in the ash heap is offered and goes onto the new vampire", () => {
    const { state, engine } = toSearch((s) => {
      s.seats[0]!.ashHeap = [{ id: "ob", name: "Obfuscate" }];
    });
    const pick = optionIds(engine).find((o) => o.endsWith(":searchDiscipline:ashHeap:ob"));
    expect(pick).toBeDefined();
    engine.choose(pick!);
    const token = find(engine.state, "wd");
    expect(token?.attached.some((p) => p.card.name === "Obfuscate")).toBe(true);
    expect(engine.state.seats[0]!.ashHeap?.some((c) => c.id === "ob")).toBe(false);
  });

  it("a master in the hand is offered too", () => {
    const { engine } = toSearch((s) => {
      s.seats[0]!.hand.push({ id: "dm", name: "Protean" });
    });
    expect(optionIds(engine).some((o) => o.endsWith(":searchDiscipline:hand:dm"))).toBe(true);
  });

  it("NEGATIVE SPACE: a card with no discipline tag is never offered", () => {
    const { engine } = toSearch((s) => {
      s.seats[0]!.ashHeap = [{ id: "cd", name: "Conditioning" }];
    });
    expect(optionIds(engine).some((o) => o.includes(":cd"))).toBe(false);
    // Finding nothing is still the answer.
    expect(optionIds(engine)).toContain("choice:Waters of Duat:wd:searchDiscipline:none");
  });
});
