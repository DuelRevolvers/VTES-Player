/**
 * Powder of Rigidity and the bot (docs/equip-unlocks-design.md §6). The
 * burn bars an opponent's Protean and Vicissitude cards and weakens a
 * werewolf; against anyone else it does nothing, and the card has no other
 * use, so the bot keeps it.
 */

import { describe, expect, it } from "vitest";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import { viewFor } from "../../src/engine/agent.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import type { DecisionPoint, GameState, LegalOption, MinionState } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const agent = new HeuristicAgent({ seed: 3 });
const find = (state: GameState, id: string): MinionState =>
  state.seats.flatMap((s) => s.minions).find((m) => m.id === id)!;
const option = (dp: DecisionPoint, prefix: string): LegalOption => {
  const o = dp.options.find((x) => x.id.startsWith(prefix));
  if (!o) throw new Error(`no ${prefix} in ${dp.options.map((x) => x.id).join(", ")}`);
  return o;
};

/** V1 (wearing the Powder) bleeds, M blocks; returns the decision that
 *  offers the burn. */
function powderDecision(opponent: Partial<MinionState>): { state: GameState; dp: DecisionPoint } {
  const state = threeSeatGame();
  const h = testRegistry["Powder of Rigidity"]!;
  find(state, "V1").attached.push({
    card: { id: "pr", name: "Powder of Rigidity" },
    locked: false,
    usedThisPhase: false,
    statics: h.permanentStatics ?? {},
    tags: h.permanentTags ?? [],
  });
  Object.assign(find(state, "M"), opponent);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  for (let i = 0; i < 20; i++) {
    const dp = engine.decision()!;
    if (dp.options.some((o) => o.id.startsWith("ability:Powder of Rigidity"))) return { state, dp };
    runTrace(engine, [[dp.seat, "pass"]]);
  }
  throw new Error("the burn was never offered");
}

describe("Powder of Rigidity and the bot", () => {
  it("burns it against a Protean opponent", () => {
    const { state, dp } = powderDecision({ disciplines: { pro: "basic" } });
    const view = viewFor(state, dp.seat);
    expect(agent.score(option(dp, "ability:Powder of Rigidity"), dp, view)).toBeGreaterThan(
      agent.score(option(dp, "pass"), dp, view),
    );
  });

  it("keeps it against an opponent it would do nothing to", () => {
    const { state, dp } = powderDecision({ disciplines: { dom: "superior" } });
    const view = viewFor(state, dp.seat);
    expect(agent.score(option(dp, "ability:Powder of Rigidity"), dp, view)).toBeLessThan(
      agent.score(option(dp, "pass"), dp, view),
    );
  });
});
