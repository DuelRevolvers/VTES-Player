/**
 * Granted bleeds, and costs priced for a target
 * (docs/granted-bleed-and-target-costs-design.md).
 *
 * Codex of the Edenic Groundskeepers (100374), Villein (102121),
 * Secure Haven (101711).
 *
 * Both halves close a kernel HARD-CODE rather than add a mechanism, so
 * the tests aim at the thing that was hard-coded: that a granted action
 * can now be a bleed and obeys every bleed rule, and that a cost can
 * depend on what the card targets rather than on who pays.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, currentStealth, playCostFor } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function attach(m: MinionState, id: string, name: string, statics: object): void {
  m.attached.push({
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: statics as PermanentInPlay["statics"],
    tags: [name],
  });
}

function masterPhase(state: GameState): void {
  const tf = state.frames.find((f) => f.kind === "turn")!;
  if (tf.kind === "turn") {
    tf.phase = "master";
    tf.masterActionsLeft = 1;
  }
}

describe("Codex of the Edenic Groundskeepers (100374) — a granted BLEED", () => {
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 4 });
    attach(find(state, "V1"), "cx", "Codex of the Edenic Groundskeepers", {
      conditional: [{ stealth: -2, actionKinds: ["bleed"] }],
    });
    // The granted action lives on the entry, so it needs the real spec
    // wiring rather than a hand-built statics blob: play it properly.
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("offers the granted bleed, and it costs 1 blood", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 4 });
    state.seats[0]!.hand.push({ id: "cx", name: "Codex of the Edenic Groundskeepers" });
    const engine = new VtesEngine(state, testRegistry);
    // Equip first (an action), then the granted bleed becomes available.
    runTrace(engine, [
      ["Alice", "play:Codex of the Edenic Groundskeepers:basic:V1:cx"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → equipped
    ]);
    const entry = find(state, "V1").attached.find((p) => p.card.id === "cx");
    expect(entry).toBeDefined();
    // V1 locked to equip; unlock it so it can act again this turn.
    find(state, "V1").locked = false;
    const e2 = new VtesEngine(state, testRegistry);
    const opt = e2
      .decision()!
      .options.find((o) => o.id.startsWith("act:Codex of the Edenic Groundskeepers"));
    expect(opt).toBeDefined();
    expect(opt!.id).toContain(":bleed:V1");

    // TAKE it, not merely look at it: the option carried the wrong kind
    // until 2026-08-31 and threw the moment anyone chose it. An offered
    // option that cannot be used looks exactly like a working one.
    runTrace(e2, [["Alice", opt!.id]]);
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action announced");
    expect(af.actionKind).toBe("bleed");
    expect(af.acting).toBe("V1");
    expect(find(state, "V1").bledThisTurn).toBe(true);
  });

  it("obeys p. 23: one bleed per minion per turn", () => {
    // The whole point of the actionKind generalization — a granted bleed
    // is a bleed, so `bledThisTurn` gates it like any other.
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 4, bledThisTurn: true });
    attach(find(state, "V1"), "cx", "Codex of the Edenic Groundskeepers", {});
    const entry = find(state, "V1").attached[0]!;
    entry.card = { id: "cx", name: "Codex of the Edenic Groundskeepers" };
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.includes("Codex") && i.includes(":bleed:"))).toBe(false);
    // …and the built-in bleed is gone for the same reason.
    expect(ids.some((i) => i === "bleed:V1")).toBe(false);
  });

  it("−2 stealth applies to the bleed, including the one it grants", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 4 });
    attach(find(state, "V1"), "cx", "Codex of the Edenic Groundskeepers", {
      conditional: [{ stealth: -2, actionKinds: ["bleed"] }],
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action");
    // A plain bleed has 0 stealth; the Codex drags it to −2.
    expect(currentStealth(state, af.actionId)).toBe(-2);

    // …and a hunt, which is not a bleed, is untouched (+1 inherent).
    const s2 = threeSeatGame();
    Object.assign(find(s2, "V1"), { blood: 4 });
    attach(find(s2, "V1"), "cx", "Codex of the Edenic Groundskeepers", {
      conditional: [{ stealth: -2, actionKinds: ["bleed"] }],
    });
    const e2 = new VtesEngine(s2, testRegistry);
    runTrace(e2, [["Alice", "hunt:V1"]]);
    const af2 = s2.frames.find((f) => f.kind === "action");
    if (af2?.kind !== "action") throw new Error("no action");
    expect(currentStealth(s2, af2.actionId)).toBe(1);
  });
});

describe("Villein (102121) — a cost priced for the TARGET", () => {
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 4 });
    state.seats[0]!.hand.push({ id: "v1c", name: "Villein" });
    const state2 = state;
    masterPhase(state2);
    return { state: state2, engine: new VtesEngine(state2, testRegistry) };
  }

  it("offers one option per amount of blood moved, 2 through 5", () => {
    const { engine } = game();
    const ids = engine
      .decision()!
      .options.map((o) => o.id)
      .filter((i) => i.startsWith("play:Villein"));
    // V1 has 4 blood, so 2, 3 and 4 — not 5.
    expect(ids).toHaveLength(3);
  });

  it("moves the chosen blood from the vampire to the pool", () => {
    const { state, engine } = game();
    const poolBefore = state.seats[0]!.pool;
    const opt = engine
      .decision()!
      .options.find((o) => o.id.startsWith("play:Villein") && o.id.includes(":3:"))!;
    runTrace(engine, [
      ["Alice", opt.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    expect(find(state, "V1").blood).toBe(1);
    expect(state.seats[0]!.pool).toBe(poolBefore + 3);
  });

  it("costs +1 pool on a vampire that already carries one", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 4 });
    // A Villein already on V1 raises the price of the next one, but only
    // for a play that TARGETS V1.
    attach(find(state, "V1"), "old", "Villein", {
      playCostMod: { amount: 1, pays: "pool", cardName: "Villein", onTarget: true },
    });
    const priced = {
      name: "Villein",
      bloodCost: 0,
      poolCost: 0,
      types: ["master" as const],
      requires: [],
    };
    expect(playCostFor(state, priced, null, null, null, "V1").pool).toBe(1);
    expect(playCostFor(state, priced, null, null, null, "W").pool).toBe(0);
  });

  it("its Minion Tap surcharge is the CONTROLLER's problem only", () => {
    const state = threeSeatGame();
    attach(find(state, "V1"), "v", "Villein", {
      playCostMod: {
        amount: 1,
        pays: "pool",
        cardName: "Minion Tap",
        controllerOnly: true,
      },
    });
    const priced = {
      name: "Minion Tap",
      bloodCost: 0,
      poolCost: 1,
      types: ["master" as const],
      requires: [],
    };
    expect(playCostFor(state, priced, null, null, null, null, "Alice").pool).toBe(2);
    expect(playCostFor(state, priced, null, null, null, null, "Bob").pool).toBe(1);
  });
});

describe("Secure Haven (101711)", () => {
  function havened(): GameState {
    const state = threeSeatGame();
    attach(find(state, "W"), "sh", "Secure Haven", {
      untargetableByOthers: true,
      playCostMod: { amount: 1, pays: "pool", cardTypes: ["master"], onTarget: true },
    });
    find(state, "W").attached[0]!.tags = ["Secure Haven", "location", "haven"];
    return state;
  }

  it("taxes another Methuselah's master aimed at the havened minion", () => {
    const state = havened();
    const priced = {
      name: "Pentex™ Subversion",
      bloodCost: 0,
      poolCost: 2,
      types: ["master" as const],
      requires: [],
    };
    expect(playCostFor(state, priced, null, null, null, "W").pool).toBe(3);
    // A master aimed anywhere else is unaffected.
    expect(playCostFor(state, priced, null, null, null, "M").pool).toBe(2);
  });

  it("stops another Methuselah diablerizing the havened minion", () => {
    const state = havened();
    Object.assign(find(state, "W"), { inTorpor: true, blood: 0 });
    Object.assign(find(state, "V1"), { blood: 4 });
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i === "diablerize:V1:W")).toBe(false);
  });

  it("does NOT stop its OWN controller targeting it", () => {
    // "…other Methuselahs' actions."
    const state = havened();
    Object.assign(find(state, "W"), { inTorpor: true, blood: 0 });
    Object.assign(find(state, "M"), { blood: 4 });
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") tf.seat = "Bob";
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.startsWith("rescue:M:W"))).toBe(true);
  });

  it("does not stop a BLEED — a bleed targets a seat, not a minion", () => {
    const state = havened();
    Object.assign(find(state, "V1"), { blood: 4 });
    const engine = new VtesEngine(state, testRegistry);
    expect(engine.decision()!.options.some((o) => o.id === "bleed:V1")).toBe(true);
  });
});

describe("Villein actual-play regressions", () => {
  for (const blood of [0, 1, 2, 5, 7]) {
    it(`can target a vampire with ${blood} blood and transfers a legal amount`, () => {
      const state = threeSeatGame();
      find(state, "V1").blood = blood;
      find(state, "V1").capacity = 8;
      find(state, "V1").inTorpor = true;
      state.seats[0]!.hand.push({ id: "v", name: "Villein" });
      masterPhase(state);
      const engine = new VtesEngine(state, testRegistry);
      const opts = engine.decision()!.options.filter((o) => o.kind === "playCard" && o.name === "Villein" && o.params["target"] === "V1");
      expect(opts.map((o) => o.kind === "playCard" ? Number(o.params["x"]) : 0)).toEqual(Array.from({ length: Math.max(1, Math.min(5, blood) - 1) }, (_, i) => i + 2));
      const chosen = opts[0]!;
      runTrace(engine, [["Alice", chosen.id], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
      expect(find(state, "V1").blood).toBe(blood - Math.min(2, blood));
      expect(state.seats[0]!.pool).toBe(10 + Math.min(2, blood));
    });
  }

  it("actual copies stack target surcharges, while Minion Tap follows card control", () => {
    const state = threeSeatGame();
    find(state, "V1").blood = 7;
    state.seats[0]!.hand.push({ id: "v1", name: "Villein" }, { id: "v2", name: "Villein" }, { id: "v3", name: "Villein" });
    masterPhase(state);
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("fixture");
    tf.masterActionsLeft = 3;
    const engine = new VtesEngine(state, testRegistry);
    for (const [card, price] of [["v1", 0], ["v2", 1]] as const) {
      const opt = engine.decision()!.options.find((o) => o.kind === "playCard" && o.card === card && o.params["target"] === "V1" && o.params["x"] === "2");
      expect(opt?.kind === "playCard" && opt.cost?.pool).toBe(price);
      runTrace(engine, [["Alice", opt!.id], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    }
    const priced = { name: "Villein", bloodCost: 0, poolCost: 0, types: ["master" as const], requires: [] };
    const tap = { ...priced, name: "Minion Tap", poolCost: 1 };
    expect(playCostFor(state, priced, null, null, null, "V1", "Bob").pool).toBe(2);
    expect(playCostFor(state, priced, null, null, null, "W", "Bob").pool).toBe(0);
    engine.emit({ type: "ControlChanged", target: "minion", id: "V1", from: "Alice", to: "Bob" });
    expect(playCostFor(state, tap, null, null, null, null, "Alice").pool).toBe(3);
    expect(playCostFor(state, tap, null, null, null, null, "Bob").pool).toBe(1);
    expect(playCostFor(state, priced, null, null, null, "V1", "Bob").pool).toBe(2);
  });
});


describe("Walker Grimes — master cards targeting him cost his controller +1 pool", () => {
  it("gates target-priced masters that can attach to any ready minion", () => {
    const state = threeSeatGame();
    const w = find(state, "V1");
    w.attached.push({ card: { id: "V1", name: "Walker Grimes (G5)" }, locked: false, usedThisPhase: false,
      statics: testRegistry["Walker Grimes (G5)"]!.cryptEntry!().statics, tags: [] });
    state.seats[0]!.minions.push(makeMinion("second", "Alice"));
    state.seats[0]!.hand.push({ id: "pentex", name: "Pentex™ Subversion" });
    state.seats[0]!.pool = 3;
    masterPhase(state);
    const options = new VtesEngine(state, testRegistry).decision()!.options;
    expect(options.some(o => o.kind === "playCard" && o.name === "Pentex™ Subversion" && o.params["target"] === "V1")).toBe(false);
    expect(options.some(o => o.kind === "playCard" && o.name === "Pentex™ Subversion" && o.params["target"] === "second")).toBe(true);
  });

  it("prices, gates and pays on Walker, but not another vampire, and follows control", () => {
    const state = threeSeatGame();
    const walker = find(state, "V1");
    const statics = testRegistry["Walker Grimes (G5)"]!.cryptEntry!().statics;
    walker.attached.push({ card: { id: "V1", name: "Walker Grimes (G5)" }, controller: "Alice", locked: false, usedThisPhase: false, statics, tags: [] });
    state.seats[0]!.minions.push(makeMinion("second", "Alice"));
    state.seats[0]!.hand.push({ id: "villein", name: "Villein" });
    masterPhase(state);
    const engine = new VtesEngine(state, testRegistry);
    const opts = engine.decision()!.options.filter(o => o.kind === "playCard" && o.name === "Villein");
    const own = opts.find(o => o.kind === "playCard" && o.params["target"] === "V1")!;
    const other = opts.find(o => o.kind === "playCard" && o.params["target"] === "second")!;
    expect(own.kind === "playCard" && own.cost?.pool).toBe(1);
    expect(other.kind === "playCard" && other.cost?.pool).toBe(0);
    const price = { name: "Villein", bloodCost: 0, poolCost: 0, types: ["master" as const], requires: [] };
    expect(playCostFor(state, price, null, null, null, "V1", "Bob").pool).toBe(0);
    state.seats[0]!.pool = 1;
    expect(engine.decision()!.options.some(o => o.kind === "playCard" && o.name === "Villein" && o.params["target"] === "V1")).toBe(false);
    state.seats[0]!.pool = 10;
    engine.choose(own.id);
    expect(state.seats[0]!.pool).toBe(9);
    engine.emit({ type: "ControlChanged", target: "minion", id: "V1", from: "Alice", to: "Bob" });
    expect(playCostFor(state, price, null, null, null, "V1", "Alice").pool).toBe(0);
    expect(playCostFor(state, price, null, null, null, "V1", "Bob").pool).toBe(1);
  });
});
