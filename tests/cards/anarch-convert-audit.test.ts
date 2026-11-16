import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/engine.ts";
import { makeAlly, makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function setup() {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn");
  tf.phase = "influence";
  const seat = state.seats[0]!;
  const convert = makeMinion("convert", "Alice", { name: "Anarch Convert (ANY)", capacity: 1, sect: "anarch" });
  seat.uncontrolled = [{ card: convert, counters: 1 }];
  seat.crypt = [makeMinion("next", "Alice")];
  seat.minions[0]!.sect = "camarilla";
  seat.minions[0]!.title = null;
  return { state, seat, convert, engine: new VtesEngine(state, testRegistry) };
}

describe("Anarch Convert", () => {
  it("can be kept instead of using the optional effect", () => {
    const { seat, engine } = setup();
    engine.choose("inf:out:convert");
    expect(engine.decision()!.window).toBe("choice");
    engine.choose("choice:Anarch Convert (ANY):convert:convert:keep");
    expect(seat.minions.some(m => m.id === "convert")).toBe(true);
    expect(seat.minions[0]!.sect).toBe("camarilla");
  });
  it("removes the convert and makes a non-titled vampire Anarch, with a choice of benefit", () => {
    const { state, seat, engine } = setup();
    seat.minions[0]!.inTorpor = true;
    seat.minions.push(makeAlly("ally", "Alice", 3));
    seat.minions.push(makeMinion("titled", "Alice", { title: "prince" }));
    const pool = seat.pool;
    engine.choose("inf:out:convert");
    const opts = engine.decision()!.options.map(o => o.id);
    expect(opts).toContain("choice:Anarch Convert (ANY):convert:convert:V1:pool");
    expect(opts).toContain("choice:Anarch Convert (ANY):convert:convert:V1:crypt");
    expect(opts.some(o => o.includes(":ally:") || o.includes(":titled:"))).toBe(false);
    const copy = JSON.parse(JSON.stringify(state));
    const resumed = new VtesEngine(copy, testRegistry);
    resumed.choose("choice:Anarch Convert (ANY):convert:convert:V1:pool");
    expect(copy.seats[0].pool).toBe(pool + 1);
    expect(copy.seats[0].minions.find((m: { id: string }) => m.id === "V1").sect).toBe("anarch");
    expect(copy.seats[0].minions.some((m: { id: string }) => m.id === "convert")).toBe(false);
    expect(copy.eventLog.some((e: { type: string; minion?: string }) => e.type === "MinionRemovedFromGame" && e.minion === "convert")).toBe(true);
  });
  it("may target an already Anarch vampire and draw a crypt card", () => {
    const { seat, engine } = setup();
    seat.minions[0]!.sect = "anarch";
    engine.choose("inf:out:convert");
    engine.choose("choice:Anarch Convert (ANY):convert:convert:V1:crypt");
    expect(seat.minions[0]!.sect).toBe("anarch");
    expect(seat.uncontrolled.map(u => u.card.id)).toContain("next");
    expect(seat.crypt).toHaveLength(0);
  });
  it("can choose to draw from an empty crypt while still converting the vampire", () => {
    const { state, seat, engine } = setup();
    seat.crypt = [];
    const pool = seat.pool;
    engine.choose("inf:out:convert");
    const id = "choice:Anarch Convert (ANY):convert:convert:V1:crypt";
    expect(engine.decision()!.options.map(o => o.id)).toContain(id);
    const saved = JSON.parse(JSON.stringify(state));
    const resumed = new VtesEngine(saved, testRegistry);
    resumed.choose(id);
    expect(saved.seats[0].minions.find((m: { id: string }) => m.id === "V1").sect).toBe("anarch");
    expect(saved.seats[0].minions.some((m: { id: string }) => m.id === "convert")).toBe(false);
    expect(saved.seats[0].crypt).toHaveLength(0);
    expect(saved.seats[0].pool).toBe(pool);
  });
  it("enters normally when there is no eligible other vampire", () => {
    const { seat, engine } = setup();
    seat.minions = [makeAlly("ally", "Alice", 3), makeMinion("titled", "Alice", { title: "prince" })];
    engine.choose("inf:out:convert");
    expect(seat.minions.some(m => m.id === "convert")).toBe(true);
    expect(engine.decision()!.window).not.toBe("choice");
  });
  it("decides before contesting a copy controlled by another Methuselah", () => {
    const { state, seat, engine } = setup();
    state.seats[1]!.minions.push(makeMinion("other-convert", "Bob", { name: "Anarch Convert (ANY)", capacity: 1, sect: "anarch" }));
    engine.choose("inf:out:convert");
    engine.choose("choice:Anarch Convert (ANY):convert:convert:V1:pool");
    expect(state.eventLog.some(e => e.type === "ContestBegan" && (e.cardId === "convert" || e.cardId === "other-convert"))).toBe(false);
    expect(seat.minions.some(m => m.id === "convert")).toBe(false);
    expect(state.seats[1]!.minions.some(m => m.id === "other-convert")).toBe(true);
  });

});
