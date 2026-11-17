/**
 * Conniver (100407): "Master: archetype. Put this card on a vampire you control.
 * If your prey loses pool when it is neither your turn nor your prey's turn,
 * you may lock this card to move 1 blood from the blood bank to this vampire."
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function minion(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Alice's V1 carries Conniver. `turnSeat` is whose turn it is. */
function setup(turnSeat: "Alice" | "Bob" | "Carol"): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const turn = state.frames[0]! as any;
  turn.seat = turnSeat;
  Object.assign(minion(state, "V1"), { blood: 1, capacity: 5 });
  const engine = new VtesEngine(state, testRegistry);
  engine.putPermanentInPlay({ card: { id: "cn", name: "Conniver" }, seat: "Alice", attachTo: "V1", statics: {}, tags: ["archetype"] });
  return { state, engine };
}

function cardOf(state: GameState) {
  return minion(state, "V1").attached.find((p) => p.card.name === "Conniver")!;
}

describe("Conniver (100407)", () => {
  it("prey loses pool on a third seat's turn: the controller is asked, and 'yes' locks the card and gains 1 blood", () => {
    const { state, engine } = setup("Carol");
    engine.emit({ type: "PoolBurned", seat: "Bob", amount: 1 }); // Bob is Alice's prey
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    const yes = dp.options.find((o) => o.id.includes(":yes"))!;
    expect(yes).toBeDefined();
    engine.choose(yes.id);
    expect(minion(state, "V1").blood).toBe(2);
    expect(cardOf(state).locked).toBe(true);
  });

  it("'no' (declining) changes nothing", () => {
    const { state, engine } = setup("Carol");
    engine.emit({ type: "PoolBurned", seat: "Bob", amount: 1 });
    const dp = engine.decision()!;
    const decline = dp.options.find((o) => !o.id.includes(":yes"))!;
    engine.choose(decline.id);
    expect(minion(state, "V1").blood).toBe(1);
    expect(cardOf(state).locked).toBe(false);
  });

  it("does nothing when the loss is by a seat that is not the prey", () => {
    const { state, engine } = setup("Carol");
    engine.emit({ type: "PoolBurned", seat: "Carol", amount: 1 });
    expect(minion(state, "V1").blood).toBe(1);
    expect(cardOf(state).locked).toBe(false);
  });

  it("does nothing on the controller's own turn", () => {
    const { state, engine } = setup("Alice");
    engine.emit({ type: "PoolBurned", seat: "Bob", amount: 1 });
    expect(minion(state, "V1").blood).toBe(1);
  });

  it("does nothing on the prey's own turn", () => {
    const { state, engine } = setup("Bob");
    engine.emit({ type: "PoolBurned", seat: "Bob", amount: 1 });
    expect(minion(state, "V1").blood).toBe(1);
  });

  it("a locked card is not offered again", () => {
    const { state, engine } = setup("Carol");
    engine.emit({ type: "PoolBurned", seat: "Bob", amount: 1 });
    engine.choose(engine.decision()!.options.find((o) => o.id.includes(":yes"))!.id);
    engine.emit({ type: "PoolBurned", seat: "Bob", amount: 1 });
    expect(engine.decision()?.options.some((o) => o.id.includes(":yes")) ?? false).toBe(false);
    expect(minion(state, "V1").blood).toBe(2);
  });
});
