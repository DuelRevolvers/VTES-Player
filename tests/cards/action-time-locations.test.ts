/**
 * Locations that intervene during an action
 * (docs/action-time-locations-design.md).
 *
 * Creepshow Casino (100444), WMRH Talk Radio (102189), The Rumor Mill
 * (101662), Club Illusion (100366), Warsaw Station (102149).
 *
 * These extend the closed lock-grant gate, so most of what is worth
 * pinning is the NEW knob on each: the p. 26 override, the recipient-paid
 * cost, the deferred pool bill, and the success-only unlock.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function loc(id: string, name: string): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: ["location"] };
}

/** The seat's own state-A decision, once the announce cycle has passed. */
function stateA(engine: VtesEngine): ReturnType<VtesEngine["decision"]> {
  runTrace(engine, [
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
  ]);
  return engine.decision();
}

describe("Creepshow Casino (100444)", () => {
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 2 });
    state.seats[0]!.permanents.push(loc("cc", "Creepshow Casino"));
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("is offered at announcement with NO block attempt — 'even if not yet needed'", () => {
    // Every other stealth location is gated behind p. 26: no live block
    // attempt, no option. This card overrides that in so many words.
    const { engine } = game();
    runTrace(engine, [["Alice", "hunt:V1"]]);
    const dp = stateA(engine)!;
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id === "ability:Creepshow Casino:cc:stealth")).toBe(true);
  });

  it("actually raises the stealth, and locks the location", () => {
    const { state, engine } = game();
    runTrace(engine, [["Alice", "hunt:V1"]]);
    stateA(engine);
    runTrace(engine, [["Alice", "ability:Creepshow Casino:cc:stealth"]]);
    expect(
      state.eventLog.some((e) => e.type === "StealthModified" && e.source === "Creepshow Casino"),
    ).toBe(true);
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "cc")!.locked).toBe(true);
  });

  it("is NOT offered on a directed action", () => {
    // "…announces an UNDIRECTED action." A bleed is directed (p. 25).
    const { engine } = game();
    runTrace(engine, [["Alice", "bleed:V1"]]);
    const dp = stateA(engine)!;
    expect(dp.options.some((o) => o.id.includes("Creepshow Casino"))).toBe(false);
  });
});

describe("Club Illusion (100366)", () => {
  function game(sect: string | null): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3, sect });
    state.seats[0]!.permanents.push(loc("ci", "Club Illusion"));
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("gives an Anarch +1 bleed for 1 blood, and does NOT lock", () => {
    const { state, engine } = game("anarch");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    stateA(engine);
    const before = find(state, "V1").blood;
    runTrace(engine, [["Alice", "ability:Club Illusion:ci:bleed"]]);
    expect(find(state, "V1").blood).toBe(before - 1); // the recipient pays
    expect(
      state.eventLog.some((e) => e.type === "BleedAmountModified" && e.source === "Club Illusion"),
    ).toBe(true);
    // A standing permission, not a lock — the card is still upright.
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "ci")!.locked).toBe(false);
  });

  it("is once per action, even though it never locks", () => {
    const { engine } = game("anarch");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    stateA(engine);
    runTrace(engine, [["Alice", "ability:Club Illusion:ci:bleed"]]);
    // Impulse rewinds to Alice after an effect; the card is spent.
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.includes("Club Illusion"))).toBe(false);
  });

  it("is not offered to a non-Anarch, nor on a non-bleed", () => {
    const { engine } = game("camarilla");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(stateA(engine)!.options.some((o) => o.id.includes("Club Illusion"))).toBe(false);

    const { engine: e2 } = game("anarch");
    runTrace(e2, [["Alice", "hunt:V1"]]);
    expect(stateA(e2)!.options.some((o) => o.id.includes("Club Illusion"))).toBe(false);
  });
});

describe("The Rumor Mill, Tabloid Newspaper (101662)", () => {
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3 });
    Object.assign(find(state, "M"), { blood: 3 });
    state.seats[1]!.permanents.push(loc("rm", "The Rumor Mill, Tabloid Newspaper"));
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("offers one option per eligible vampire, at ANY Methuselah's", () => {
    // "Choose a vampire" — not "a vampire you control".
    const { engine } = game();
    runTrace(engine, [["Alice", "bleed:V1"]]);
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
    ]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    const ids = dp.options.map((o) => o.id).filter((i) => i.includes("Rumor Mill"));
    expect(ids.some((i) => i.endsWith(":W"))).toBe(true); // Bob's own
    expect(ids.some((i) => i.endsWith(":V1"))).toBe(true); // Alice's actor
  });

  it("charges the CHOSEN vampire, not the location's controller", () => {
    const { state, engine } = game();
    const poolBefore = state.seats[1]!.pool;
    runTrace(engine, [["Alice", "bleed:V1"]]);
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    const before = find(state, "W").blood;
    runTrace(engine, [["Bob", "ability:The Rumor Mill, Tabloid Newspaper:rm:intercept:W"]]);
    expect(find(state, "W").blood).toBe(before - 1);
    expect(state.seats[1]!.pool).toBe(poolBefore); // the owner pays nothing
  });

  it("skips a vampire who cannot pay the blood", () => {
    const { state, engine } = game();
    find(state, "W").blood = 0;
    runTrace(engine, [["Alice", "bleed:V1"]]);
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.includes("Rumor Mill") && i.endsWith(":W"))).toBe(false);
  });
});

describe("WMRH Talk Radio (102189)", () => {
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3 });
    state.seats[1]!.permanents.push(loc("wm", "WMRH Talk Radio"));
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("bills its controller 1 pool when the boosted minion does not block", () => {
    // The attempt has to actually FAIL for the penalty to land, so Alice
    // out-stealths the boost: hunt (+1) plus a stealth modifier (+1)
    // beats W's 0 intercept plus WMRH's +1.
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3, disciplines: { obf: "superior" } });
    state.seats[0]!.hand.push({ id: "sbn", name: "Swallowed by the Night" });
    state.seats[1]!.permanents.push(loc("wm", "WMRH Talk Radio"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "hunt:V1"], // +1 stealth, so intercept is 'needed'
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "block:W"],
      ["Alice", "pass"],
    ]);
    const opt = engine.decision()!.options.find((o) => o.id.includes("WMRH Talk Radio"));
    expect(opt).toBeDefined();
    const poolBefore = state.seats[1]!.pool;
    runTrace(engine, [["Bob", opt!.id]]);
    expect(state.seats[1]!.pool).toBe(poolBefore); // deferred, not paid yet

    // Alice adds stealth; the attempt fails; the action resolves.
    const sneak = engine
      .decision()!
      .options.find((o) => o.id.startsWith("play:Swallowed by the Night"));
    expect(sneak).toBeDefined();
    runTrace(engine, [
      ["Alice", sneak!.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    for (let i = 0; i < 14; i++) {
      const dp = engine.decision();
      if (!dp || dp.window === "turn.minion") break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(state.eventLog.some((e) => e.type === "BlockFailed")).toBe(true);
    expect(state.seats[1]!.pool).toBe(poolBefore - 1);
  });

  it("charges nothing when that minion DOES block", () => {
    const { state, engine } = game();
    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:W"],
      ["Alice", "pass"],
    ]);
    const opt = engine.decision()!.options.find((o) => o.id.includes("WMRH Talk Radio"))!;
    const poolBefore = state.seats[1]!.pool;
    runTrace(engine, [["Bob", opt.id]]);
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // attempt resolves
    ]);
    // W blocked, so the deferred bill never lands.
    expect(state.seats[1]!.pool).toBe(poolBefore);
    expect(state.eventLog.some((e) => e.type === "BlockSucceeded")).toBe(true);
  });
});

describe("Warsaw Station (102149)", () => {
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 2, clan: "Nosferatu" });
    state.seats[0]!.permanents.push(loc("ws", "Warsaw Station"));
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("unlocks the acting Nosferatu after a SUCCESSFUL undirected action", () => {
    const { state, engine } = game();
    runTrace(engine, [["Alice", "hunt:V1"]]);
    stateA(engine);
    runTrace(engine, [["Alice", "ability:Warsaw Station:ws:unlockOnSuccess"]]);
    // Acting minions lock at announcement (p. 25).
    expect(find(state, "V1").locked).toBe(true);
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
    ]);
    expect(find(state, "V1").locked).toBe(false);
  });

  it("burns itself to bring a Nosferatu out of torpor — even while locked", () => {
    // Every other burn-self ability is gated on being unlocked; this
    // clause exists precisely to cash in a spent location.
    const state = threeSeatGame();
    state.seats[0]!.minions.push(
      makeMinion("V9", "Alice", { clan: "Nosferatu", inTorpor: true, blood: 0 }),
    );
    const spent = loc("ws", "Warsaw Station");
    spent.locked = true;
    state.seats[0]!.permanents.push(spent);
    const engine = new VtesEngine(state, testRegistry);
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") {
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    const e2 = new VtesEngine(state, testRegistry);
    const opt = e2.decision()!.options.find((o) => o.id.includes("Warsaw Station:ws:rescue"));
    expect(opt).toBeDefined();
    runTrace(e2, [["Alice", opt!.id]]);
    expect(find(state, "V9").inTorpor).toBe(false);
    expect(state.seats[0]!.permanents.some((p) => p.card.id === "ws")).toBe(false);
    void engine;
  });
});
