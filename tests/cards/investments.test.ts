/**
 * The investments (docs/investments-design.md).
 *
 * Protracted Investment (101502), Short-Term Investment (101769),
 * Slave Auction (101802).
 *
 * Pool paid in advance and drawn back one master action at a time. The twins
 * (5 for 2, 3 for 1) are asserted against each other; Slave Auction pays out
 * the same way but is not printed "Investment", which is what Wall Street
 * Night — in the pool since before any investment was — can and cannot raid.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Alice's master phase with `actions` master-phase actions. */
function masterPhase(state: GameState, actions = 1): void {
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn frame");
  tf.phase = "master";
  tf.masterActionsLeft = actions;
}

/** Play `card` from Alice's hand in her master phase; return its entry. */
function playFromHand(card: string, id: string): { state: GameState; engine: VtesEngine; entry: () => PermanentInPlay | undefined } {
  const state = threeSeatGame();
  masterPhase(state, 2);
  state.seats[0]!.hand.push({ id, name: card });
  const engine = new VtesEngine(state, testRegistry);
  const play = optionIds(engine).find((o) => o.startsWith(`play:${card}`));
  if (!play) throw new Error(`${card} not playable`);
  engine.choose(play);
  runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
  return {
    state,
    engine,
    entry: () => state.seats[0]!.permanents.find((p) => p.card.id === id),
  };
}

// ---------------------------------------------------------------------------

describe("the twins — 5 for 2 against 3 for 1", () => {
  it("Protracted Investment enters with 5 blood for 2 pool", () => {
    const { state, entry } = playFromHand("Protracted Investment", "pi");
    expect(entry()?.counters).toBe(5);
    expect(state.seats[0]!.pool).toBe(8);
    // The tag Wall Street Night reads, denormalized by the real play path.
    expect(entry()?.tags).toContain("investment");
  });

  it("Short-Term Investment enters with 3 blood for 1 pool", () => {
    const { state, entry } = playFromHand("Short-Term Investment", "si");
    expect(entry()?.counters).toBe(3);
    expect(state.seats[0]!.pool).toBe(9);
    expect(entry()?.tags).toContain("investment");
  });

  it("a master phase ACTION moves 1 blood to the pool — and costs the action", () => {
    const { state, engine, entry } = playFromHand("Short-Term Investment", "si");
    const actionsLeft = (): number => {
      const tf = state.frames[0]!;
      return tf.kind === "turn" ? tf.masterActionsLeft : -1;
    };
    // Playing it spent one of the two master actions; one is left.
    expect(actionsLeft()).toBe(1);
    const pool = state.seats[0]!.pool;
    engine.choose("ability:Short-Term Investment:si:store:0");
    expect(entry()?.counters).toBe(2);
    expect(state.seats[0]!.pool).toBe(pool + 1);
    // "USE A MASTER PHASE ACTION to move 1 blood" — the draw SPENDS the action.
    // Read directly: "no second draw offered" would also hold for the store's
    // own once-per-phase limit, and the first draft of this case asserted only
    // that — a mutation that made the draw free passed it.
    expect(actionsLeft()).toBe(0);
  });

  it("burns itself when the last blood is taken", () => {
    const state = threeSeatGame();
    masterPhase(state);
    state.seats[0]!.permanents.push({
      card: { id: "si", name: "Short-Term Investment" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["investment"],
      counters: 1,
    });
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("ability:Short-Term Investment:si:store:0");
    expect(state.seats[0]!.permanents.some((p) => p.card.id === "si")).toBe(false);
    expect(state.seats[0]!.pool).toBe(11);
  });
});

describe("Slave Auction (101802) — one blood per Methuselah still in the game", () => {
  it("three Methuselahs: 3 blood", () => {
    const { entry } = playFromHand("Slave Auction", "sa");
    expect(entry()?.counters).toBe(3);
  });

  it("one of them ousted: 2 blood — an ousted Methuselah is out of the game", () => {
    const state = threeSeatGame();
    masterPhase(state);
    state.seats[2]!.ousted = true;
    state.seats[0]!.hand.push({ id: "sa", name: "Slave Auction" });
    const engine = new VtesEngine(state, testRegistry);
    engine.choose(optionIds(engine).find((o) => o.startsWith("play:Slave Auction"))!);
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"]]);
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "sa")?.counters).toBe(2);
  });
});

describe("Wall Street Night — the clause that could not fire until now", () => {
  /** Alice holds Wall Street Night; Bob holds a real Protracted Investment and
   *  a Slave Auction, both put in play the way the engine does it. */
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "minion";
    state.seats[0]!.permanents.push({
      card: { id: "wsn", name: "Wall Street Night, Financial Newspaper" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["location"],
    });
    state.seats[1]!.permanents.push(
      { card: { id: "pi", name: "Protracted Investment" }, locked: false, usedThisPhase: false, statics: {}, tags: ["investment"], counters: 5 },
      { card: { id: "sa", name: "Slave Auction" }, locked: false, usedThisPhase: false, statics: {}, tags: [], counters: 3 },
    );
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("raids a printed Investment, and not a card that merely pays out like one", () => {
    const { engine } = game();
    const ids = optionIds(engine).filter((o) => o.startsWith("act:Wall Street Night:wsn:invest:"));
    expect(ids).toContain("act:Wall Street Night:wsn:invest:V1:pi");
    // Slave Auction is not printed "Investment".
    expect(ids.some((o) => o.endsWith(":sa"))).toBe(false);
  });
});
