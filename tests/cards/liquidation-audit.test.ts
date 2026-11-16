import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/engine.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function game(n: number) {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("missing turn");
  tf.phase = "master"; tf.masterActionsLeft = 1;
  const seat = state.seats[0]!;
  seat.hand = [{ id: "liq", name: "Liquidation" }];
  seat.library = Array.from({ length: n }, (_, i) => ({ id: `l${i}`, name: "Conditioning" }));
  return { state, seat, engine: new VtesEngine(state, testRegistry) };
}

describe("Liquidation", () => {
  it("burns the top seven into the ash heap, gains pool and delays replacement", () => {
    const { state, seat, engine } = game(9);
    const pool = seat.pool;
    runTrace(engine, [["Alice", "play:Liquidation"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(seat.library.map(c => c.id)).toEqual(["l7", "l8"]);
    expect(seat.ashHeap!.filter(c => /^l[0-9]+$/.test(c.id)).map(c => c.id)).toEqual(["l0", "l1", "l2", "l3", "l4", "l5", "l6"]);
    expect(seat.pool).toBe(pool + 3);
    expect(seat.hand).toHaveLength(0);
    expect(state.eventLog.filter(e => e.type === "LibraryTopBurned")).toHaveLength(7);
  });
  it.each([0, 6])("is not playable with only %s cards in the library", (n) => {
    const { engine } = game(n);
    expect(engine.decision()!.options.some(o => o.id.startsWith("play:Liquidation"))).toBe(false);
  });
  it("does not grant pool if the seven cards are no longer available on resolution", () => {
    const { seat, engine } = game(7);
    const pool = seat.pool;
    engine.choose("play:Liquidation:-:liq");
    seat.library.pop();
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(seat.pool).toBe(pool);
    expect(seat.library).toHaveLength(6);
  });
});
