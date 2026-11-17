/**
 * Terror Frenzy (101960) superior — "combat cards cost the opposing vampire
 * +1 blood" also covers combat cards played at the end of the round or
 * combat (ANK 20180910-3; Telepathic Tracking, Psyche!, Taste of Vitae).
 */
import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}
function combat(state: GameState): CombatFrame | undefined {
  const f = state.frames.find((x) => x.kind === "combat");
  return f?.kind === "combat" ? f : undefined;
}

function frenzyCombat(bobHand: string[], mBlood: number, mDisc: Record<string, "basic" | "superior"> = {}) {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { disciplines: { ani: "superior" }, blood: 5, strength: 1 });
  Object.assign(find(state, "M"), { disciplines: mDisc, blood: mBlood, strength: 1 });
  state.seats[0]!.hand.push({ id: "fr", name: "Terror Frenzy" });
  bobHand.forEach((name, i) => state.seats[1]!.hand.push({ id: `b${i}`, name }));
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  return { state, engine };
}

/** Pass until the end-of-round window is open to Bob (the Telepathic seat). */
function walkToEndOfRound(engine: VtesEngine, state: GameState): void {
  for (let i = 0; i < 60; i++) {
    const dp = engine.decision();
    if (!dp) return;
    if (combat(state)?.step === "endOfRound" && dp.seat === "Bob") return;
    if (!combat(state) && !dp.options.some((o) => o.id === "pass")) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

describe("Terror Frenzy superior and end-of-round combat cards", () => {
  it("raises the opposing vampire's cost for a combat card played in the same combat", () => {
    const control = frenzyCombat(["Psyche!"], 5);
    expect(control.engine.decision()?.options.some((o) => o.id.includes("Psyche!")) ?? false).toBe(false);
    const { state, engine } = frenzyCombat(["Psyche!"], 1);
    runTrace(engine, [["Alice", "play:Terror Frenzy:superior:V1:fr"]]);
    expect(combat(state)).toBeDefined();
    // Psyche! costs 1 blood; with the +1 from Terror Frenzy the single blood
    // in M's account is not enough, so no combat card is offered to Bob.
    expect(engine.decision()?.options.some((o) => o.id.includes("Psyche!"))).toBe(false);
  });

  it("still raises it for a combat card played at the end of the round", () => {
    const { state, engine } = frenzyCombat(["Telepathic Tracking"], 1, { aus: "superior" });
    runTrace(engine, [["Alice", "play:Terror Frenzy:superior:V1:fr"]]);
    walkToEndOfRound(engine, state);
    expect(combat(state)?.step).toBe("endOfRound");
    const offered = (e: VtesEngine) => e.decision()?.options.filter((o) => o.id.includes("Telepathic Tracking")).map((o) => o.id) ?? [];
    const control = frenzyCombat(["Telepathic Tracking"], 5, { aus: "superior" });
    runTrace(control.engine, [["Alice", "play:Terror Frenzy:superior:V1:fr"]]);
    walkToEndOfRound(control.engine, control.state);
    expect(offered(control.engine).length).toBeGreaterThan(0);
    expect(offered(engine)).toEqual([]);
  });
});
