import { describe, expect, it } from "vitest";
import { VtesEngine, vampireCircle, type GameState } from "../../src/engine/index.ts";
import { makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function setup() {
  const state = threeSeatGame();
  const turn = state.frames[0]!;
  if (turn.kind !== "turn") throw new Error("no turn");
  turn.phase = "influence";
  const seat = state.seats[0]!;
  seat.uncontrolled = [{ card: makeMinion("new", "Alice", { name: "New Blood (ANY)", clan: "Blood Brother", sect: "sabbat", capacity: 2, sterile: true }), counters: 2 }];
  seat.crypt = [makeMinion("crypt1", "Alice"), makeMinion("crypt2", "Alice")];
  return { state, seat, turn, engine: new VtesEngine(state, testRegistry) };
}

describe("New Blood crypt draw on entering", () => {
  it("draws one crypt card into uncontrolled after entering during influence", () => {
    const { state, seat, engine } = setup();
    engine.choose("inf:out:new");
    engine.choose("choice:New Blood (ANY):new:circle:named:Chicago");
    expect(seat.minions.find(m => m.id === "new")?.sterile).toBe(true);
    expect(seat.uncontrolled.map(u => u.card.id)).toEqual(["crypt1"]);
    expect(seat.crypt.map(m => m.id)).toEqual(["crypt2"]);
    expect(state.eventLog.filter(e => e.type === "CryptCardDrawn")).toHaveLength(1);
  });
  it("draws before contesting another player's copy", () => {
    const { state, seat, engine } = setup();
    state.seats[1]!.minions.push(makeMinion("opponent-new", "Bob", { name: "New Blood (ANY)", clan: "Blood Brother" }));
    engine.choose("inf:out:new");
    engine.choose("choice:New Blood (ANY):new:circle:named:Chicago");
    expect(seat.uncontrolled.map(u => u.card.id)).toEqual(["crypt1"]);
    const draw = state.eventLog.findIndex(e => e.type === "CryptCardDrawn");
    const contest = state.eventLog.findIndex(e => e.type === "ContestBegan" && e.cardId === "new");
    expect(draw).toBeGreaterThanOrEqual(0);
    expect(contest).toBeGreaterThan(draw);
  });
  it("does not draw on entering outside its controller's influence phase", () => {
    const { state, seat, turn, engine } = setup();
    turn.phase = "minion";
    engine.moveUncontrolledToReady("Alice", "new");
    expect(seat.minions.some(m => m.id === "new")).toBe(true);
    expect(seat.crypt.map(m => m.id)).toEqual(["crypt1", "crypt2"]);
    expect(state.eventLog.some(e => e.type === "CryptCardDrawn")).toBe(false);
  });
  it("draws during a delayed end-of-influence entry after the phase advanced", () => {
    const { seat, turn, engine } = setup();
    turn.phase = "discard";
    engine.moveUncontrolledToReady("Alice", "new", true);
    engine.choose("choice:New Blood (ANY):new:circle:named:Chicago");
    expect(seat.uncontrolled.map(u => u.card.id)).toEqual(["crypt1"]);
    expect(seat.crypt.map(m => m.id)).toEqual(["crypt2"]);
  });
  it("does not draw during another player's influence phase", () => {
    const { state, seat, turn, engine } = setup();
    turn.seat = "Bob";
    engine.moveUncontrolledToReady("Alice", "new");
    expect(seat.crypt.map(m => m.id)).toEqual(["crypt1", "crypt2"]);
    expect(state.eventLog.some(e => e.type === "CryptCardDrawn")).toBe(false);
  });
  it("handles an empty crypt and the delayed end-of-influence entry", () => {
    const { seat, turn, engine } = setup();
    seat.crypt = [];
    turn.phase = "discard";
    engine.moveUncontrolledToReady("Alice", "new", true);
    engine.choose("choice:New Blood (ANY):new:circle:named:Chicago");
    expect(seat.minions.some(m => m.id === "new")).toBe(true);
    expect(seat.uncontrolled).toEqual([]);
  });
});


describe("New Blood circle choice", () => {
  it("chooses any named circle as it enters, even when nobody in play has it", () => {
    const { state, seat, engine } = setup();
    engine.choose("inf:out:new");
    expect(seat.uncontrolled.some(u => u.card.id === "new")).toBe(true);
    expect(state.eventLog.some(e => e.type === "VampireEnteredPlay" && e.minion === "new")).toBe(false);
    const ids = engine.decision()!.options.map(o => o.id);
    for (const name of ["Budapest", "Chicago", "Kiev", "Mexico City", "Torrance"]) {
      expect(ids).toContain(`choice:New Blood (ANY):new:circle:named:${name}`);
    }
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    new VtesEngine(saved, testRegistry).choose("choice:New Blood (ANY):new:circle:named:Kiev");
    const newBlood = saved.seats[0]!.minions.find(m => m.id === "new")!;
    expect(vampireCircle(newBlood)).toBe("named:Kiev");
    expect(saved.seats[0]!.uncontrolled.map(u => u.card.id)).toEqual(["crypt1"]);
  });
  it("may join another vampire's circle of one under the later Rules Director ruling", () => {
    const { state, seat, engine } = setup();
    state.seats[1]!.minions.push(makeMinion("singleton", "Bob", { name: "Embrace", clan: "Blood Brother" }));
    state.seats[1]!.uncontrolled.push({ card: makeMinion("secret", "Bob"), counters: 0 });
    engine.choose("inf:out:new");
    const ids = engine.decision()!.options.map(o => o.id);
    expect(ids).toContain("choice:New Blood (ANY):new:circle:individual:singleton");
    expect(ids).toContain("choice:New Blood (ANY):new:circle:individual:V1"); // any vampire has its own circle
    expect(ids).not.toContain("choice:New Blood (ANY):new:circle:individual:secret");
    engine.choose("choice:New Blood (ANY):new:circle:individual:singleton");
    expect(vampireCircle(seat.minions.find(m => m.id === "new")!)).toBe(vampireCircle(state.seats[1]!.minions.find(m => m.id === "singleton")!));
  });
  it("ignores New Blood's selected circle while uncontrolled", () => {
    const m = makeMinion("new", "Alice", { chosenCircle: "named:Kiev" });
    expect(vampireCircle(m, false)).toBe("individual:new");
    expect(vampireCircle(m, true)).toBe("named:Kiev");
  });
  it("forgets a chosen circle when returned to uncontrolled and chooses again on re-entry", () => {
    const { state, seat, engine } = setup();
    engine.choose("inf:out:new");
    engine.choose("choice:New Blood (ANY):new:circle:named:Chicago");
    engine.emit({ type: "MovedToUncontrolled", seat: "Alice", minion: "new" });
    expect(seat.uncontrolled.find(u => u.card.id === "new")!.card.chosenCircle).toBeUndefined();
    // Keep the original blood counters and choose again on the next entry.
    engine.choose("inf:out:new");
    engine.choose("choice:New Blood (ANY):new:circle:named:Kiev");
    expect(vampireCircle(seat.minions.find(m => m.id === "new")!)).toBe("named:Kiev");
    expect(state.eventLog.filter(e => e.type === "VampireCircleChosen").map(e => e.circle)).toEqual(["named:Chicago", "named:Kiev"]);
    const chosen = state.eventLog.findIndex(e => e.type === "VampireCircleChosen");
    expect(chosen).toBeLessThan(state.eventLog.findIndex(e => e.type === "VampireEnteredPlay"));
    expect(state.eventLog.filter(e => e.type === "CryptCardDrawn")).toHaveLength(2);
  });
  it("does not offer a choice when entry is outside its controller's influence phase", () => {
    const { turn, seat, engine } = setup(); turn.phase = "minion";
    engine.moveUncontrolledToReady("Alice", "new");
    expect(vampireCircle(seat.minions.find(m => m.id === "new")!)).toBe("individual:new");
    expect(engine.decision()!.window).not.toBe("choice");
  });
});
