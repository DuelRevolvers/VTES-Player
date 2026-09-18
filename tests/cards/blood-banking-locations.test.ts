/**
 * The five Powerbases that BANK BLOOD
 * (docs/blood-banking-locations-design.md).
 *
 * Barranquilla (101431), Chicago (101434), Mexico City (101438),
 * New York (101440), Washington, D.C. (101444).
 *
 * The shape they share: blood sits on the card as counters, the
 * controller draws it down in one window, and (for four of the five) a
 * minion of another Methuselah can take the whole pile as a Ⓓ action.
 * What differs is worth asserting AGAINST each other — which window, how
 * much, who may raid, and whether an empty card burns.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, currentStealth } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function location(id: string, name: string, counters: number): PermanentInPlay {
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["location"],
    counters,
  };
}

/** Alice's own unlock phase, with `entry` on her table. */
function alicesUnlock(entry: PermanentInPlay): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = "unlock";
    tf.unlockDone = false;
    tf.unlockAbilitiesDone = false;
  }
  state.seats[0]!.permanents.push(entry);
  return state;
}

/** Alice's master phase with the turn's one master action still unspent. */
function alicesMaster(entry: PermanentInPlay): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = "master";
    tf.masterActionsLeft = 1;
  }
  state.seats[0]!.permanents.push(entry);
  return state;
}

/** Every option offered to anyone while the unlock phase lasts. */
function unlockOptions(state: GameState, engine: VtesEngine): string[] {
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) {
    const dp = engine.decision();
    if (!dp || dp.window !== "turn.unlock") break;
    if (dp.seat === "Alice") ids.push(...dp.options.map((o) => o.id));
    engine.choose(dp.options.find((o) => o.id === "pass")!.id);
  }
  void state;
  return ids;
}

function offered(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

// ---------------------------------------------------------------------------

describe("Powerbase: Chicago (101434)", () => {
  it("offers both unlock-phase moves, and only one of them", () => {
    const state = alicesUnlock(location("pc", "Powerbase: Chicago", 2));
    const engine = new VtesEngine(state, testRegistry);
    const dp = engine.decision()!;
    expect(dp.window).toBe("turn.unlock");
    const bank = dp.options.find((o) => o.id === "ability:Powerbase: Chicago:pc:store:0")!;
    expect(bank).toBeDefined();
    expect(dp.options.some((o) => o.id === "ability:Powerbase: Chicago:pc:store:1")).toBe(true);

    engine.choose(bank.id);
    expect(state.seats[0]!.permanents[0]!.counters).toBe(3);
    // "During X, do Y" is once per phase (p. 16): the either/or is spent.
    expect(offered(engine).some((o) => o.startsWith("ability:Powerbase: Chicago"))).toBe(false);
  });

  it("cashes the whole pile into pool, and offers nothing to cash when empty", () => {
    const state = alicesUnlock(location("pc", "Powerbase: Chicago", 3));
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("ability:Powerbase: Chicago:pc:store:1");
    expect(state.seats[0]!.pool).toBe(13);
    expect(state.seats[0]!.permanents[0]!.counters).toBe(0);
    // It does NOT burn — Chicago prints no "burn this card if empty".
    expect(state.seats[0]!.permanents.length).toBe(1);

    const empty = alicesUnlock(location("pc", "Powerbase: Chicago", 0));
    const e2 = new VtesEngine(empty, testRegistry);
    const ids = unlockOptions(empty, e2);
    expect(ids).toContain("ability:Powerbase: Chicago:pc:store:0"); // banking still works
    expect(ids).not.toContain("ability:Powerbase: Chicago:pc:store:1");
  });
});

describe("Powerbase: Mexico City (101438)", () => {
  it("drips 1 blood to pool every unlock phase with no decision asked", () => {
    const state = alicesUnlock(location("pm", "Powerbase: Mexico City", 5));
    const engine = new VtesEngine(state, testRegistry);
    const ids = unlockOptions(state, engine);
    expect(ids.some((i) => i.includes("Mexico City"))).toBe(false); // no "may"
    expect(state.seats[0]!.pool).toBe(11);
    expect(state.seats[0]!.permanents[0]!.counters).toBe(4);
  });

  it("burns itself the turn the last blood leaves", () => {
    const state = alicesUnlock(location("pm", "Powerbase: Mexico City", 1));
    const engine = new VtesEngine(state, testRegistry);
    unlockOptions(state, engine);
    expect(state.seats[0]!.pool).toBe(11);
    expect(state.seats[0]!.permanents.length).toBe(0);
  });
});

describe("Powerbase: Washington, D.C. (101444)", () => {
  it("matches each pool moved with a blood from the bank", () => {
    const state = alicesUnlock(location("pw", "Powerbase: Washington, D.C.", 0));
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("ability:Powerbase: Washington, D.C.:pw:store:0:2");
    expect(state.seats[0]!.pool).toBe(8);
    expect(state.seats[0]!.permanents[0]!.counters).toBe(4);
  });

  it("never offers an amount that would oust its own controller", () => {
    const state = alicesUnlock(location("pw", "Powerbase: Washington, D.C.", 0));
    state.seats[0]!.pool = 2;
    const engine = new VtesEngine(state, testRegistry);
    const ids = offered(engine);
    expect(ids).toContain("ability:Powerbase: Washington, D.C.:pw:store:0:1");
    expect(ids).not.toContain("ability:Powerbase: Washington, D.C.:pw:store:0:2");
    expect(ids).not.toContain("ability:Powerbase: Washington, D.C.:pw:store:0:3");
  });
});

describe("Powerbase: New York (101440)", () => {
  it("buys 3 blood for 1 pool and spends the turn's master action", () => {
    const state = alicesMaster(location("pn", "Powerbase: New York", 0));
    const engine = new VtesEngine(state, testRegistry);
    expect(offered(engine)).toContain("ability:Powerbase: New York:pn:store:0");
    engine.choose("ability:Powerbase: New York:pn:store:0");
    expect(state.seats[0]!.pool).toBe(9);
    expect(state.seats[0]!.permanents[0]!.counters).toBe(3);
    const tf = state.frames.find((f) => f.kind === "turn");
    expect(tf?.kind === "turn" && tf.masterActionsLeft).toBe(0);
  });

  it("is offered nothing once the master action is gone, and survives being empty", () => {
    const state = alicesMaster(location("pn", "Powerbase: New York", 0));
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.masterActionsLeft = 0;
    const engine = new VtesEngine(state, testRegistry);
    expect(offered(engine).some((i) => i.includes("New York"))).toBe(false);
    // "Burn when the LAST blood counter is REMOVED" — it enters empty by
    // design, so an empty card that nothing has taken from stays in play.
    expect(state.seats[0]!.permanents.length).toBe(1);
  });
});

describe("Powerbase: Barranquilla (101431)", () => {
  it("enters play with the capacity of the biggest ready Sabbat vampire", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    Object.assign(state.seats[0]!.minions[0]!, { sect: "sabbat", capacity: 7 });
    state.seats[0]!.hand.push({ id: "pb", name: "Powerbase: Barranquilla" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Powerbase: Barranquilla"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const entry = state.seats[0]!.permanents.find((p) => p.card.name.includes("Barranquilla"))!;
    expect(entry.counters).toBe(7);
  });

  it("gives a TITLED raider +1 stealth on the action that burns it", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    state.seats[0]!.permanents.push(location("pb", "Powerbase: Barranquilla", 4));
    state.seats[1]!.minions[0]!.title = "prince";
    const engine = new VtesEngine(state, testRegistry);
    expect(offered(engine)).toContain("act:Powerbase: Barranquilla:pb:burn:W");
    engine.choose("act:Powerbase: Barranquilla:pb:burn:W");
    const ev = state.eventLog.find((e) => e.type === "ActionAnnounced")!;
    const id = ev.type === "ActionAnnounced" ? ev.actionId : "";
    expect(currentStealth(state, id)).toBe(1);
  });
});

describe("The raid (vulnerableTo.outcome 'takeCounters')", () => {
  it("moves every blood on the card to the raiding minion's controller", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    state.seats[0]!.permanents.push(location("pc", "Powerbase: Chicago", 4));
    const engine = new VtesEngine(state, testRegistry);
    expect(offered(engine)).toContain("act:Powerbase: Chicago:pc:raid:W");
    engine.choose("act:Powerbase: Chicago:pc:raid:W");
    for (let i = 0; i < 30; i++) {
      const dp = engine.decision();
      if (!dp || !state.frames.some((f) => f.kind === "action")) break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    expect(state.seats[1]!.pool).toBe(14);
    expect(state.seats[0]!.permanents[0]!.counters).toBe(0);
  });

  it("is offered to the card's OWN controller's minions on no card", () => {
    const state = alicesUnlock(location("pc", "Powerbase: Chicago", 4));
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "minion";
    const engine = new VtesEngine(state, testRegistry);
    expect(offered(engine).some((i) => i.startsWith("act:Powerbase: Chicago"))).toBe(false);
  });

  it("only a SABBAT vampire may raid Mexico City", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    state.seats[0]!.permanents.push(location("pm", "Powerbase: Mexico City", 3));
    const engine = new VtesEngine(state, testRegistry);
    expect(offered(engine).some((i) => i.startsWith("act:Powerbase: Mexico City"))).toBe(false);
    state.seats[1]!.minions[0]!.sect = "sabbat";
    const e2 = new VtesEngine(state, testRegistry);
    expect(offered(e2)).toContain("act:Powerbase: Mexico City:pm:raid:W");
  });
});
