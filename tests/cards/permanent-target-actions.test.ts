/**
 * Actions that target a card in play
 * (docs/permanent-target-actions-design.md): Conceal (100391), Rewilding
 * (101632), Dominate Kine (100573), Open War (101324).
 *
 * The thing worth pinning is that these are DIRECTED at the target card's
 * controller — only they may block — and that Rewilding charges the
 * controller before the card leaves play.
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

/** Wind the turn frame back to the master phase — the fixture starts in
 *  the minion phase. */
function masterPhase(state: GameState): void {
  const tf = state.frames.find((f) => f.kind === "turn")!;
  if (tf.kind === "turn") {
    tf.phase = "master";
    tf.masterActionsLeft = 1;
  }
}

function location(id: string, name: string): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: ["location"] };
}

/** Alice acts; Bob controls a location. */
function game(card: string, disc: Record<string, "basic" | "superior">): GameState {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { disciplines: disc, blood: 4 });
  state.seats[0]!.hand.push({ id: "c", name: card });
  state.seats[1]!.permanents.push(location("loc", "Alamut"));
  return state;
}

function resolveUnblocked(engine: VtesEngine, play: string): void {
  runTrace(engine, [
    ["Alice", play],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
  ]);
}

describe("Conceal (100391)", () => {
  it("burns a location, and only its controller may block", () => {
    const state = game("Conceal", { obf: "superior" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Conceal:superior:V1:loc:c"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
    ]);
    // Directed at Bob, the location's controller — Carol gets no block.
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("block:"))).toBe(true);

    runTrace(engine, [
      ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
    ]);
    expect(state.seats[1]!.permanents.some((p) => p.card.id === "loc")).toBe(false);
  });

  it("does not offer your own location as a target", () => {
    const state = game("Conceal", { obf: "superior" });
    state.seats[0]!.permanents.push(location("mine", "Papillon"));
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.includes("Conceal:superior:V1:loc"))).toBe(true);
    expect(ids.some((i) => i.includes("Conceal:superior:V1:mine"))).toBe(false);
  });
});

describe("Rewilding (101632)", () => {
  it("burns the location AND charges its controller 2 pool", () => {
    const state = game("Rewilding", {});
    const before = state.seats[1]!.pool;
    const engine = new VtesEngine(state, testRegistry);
    resolveUnblocked(engine, "play:Rewilding:basic:V1:loc:c");
    expect(state.seats[1]!.permanents.some((p) => p.card.id === "loc")).toBe(false);
    // The controller is read BEFORE the burn; otherwise there is nobody
    // left to charge and this would silently be a no-op.
    expect(state.seats[1]!.pool).toBe(before - 2);
  });
});

describe("Dominate Kine (100573)", () => {
  it("steals the location rather than burning it", () => {
    const state = game("Dominate Kine", { dom: "superior" });
    const engine = new VtesEngine(state, testRegistry);
    resolveUnblocked(engine, "play:Dominate Kine:superior:V1:loc:c");
    expect(state.seats[1]!.permanents.some((p) => p.card.id === "loc")).toBe(false);
    expect(state.seats[0]!.permanents.some((p) => p.card.id === "loc")).toBe(true);
  });
});

describe("Open War (101324)", () => {
  function openWarInPlay(state: GameState): PermanentInPlay {
    const entry: PermanentInPlay = {
      card: { id: "ow", name: "Open War" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Open War"],
      counters: 0,
      controller: "Alice",
    };
    state.seats[0]!.permanents.push(entry);
    return entry;
  }

  it("requires a baron to play", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "ow1", name: "Open War" });
    const engine = new VtesEngine(state, testRegistry);
    expect(engine.decision()!.options.some((o) => o.id.includes("Open War"))).toBe(false);
    find(state, "V1").title = "baron";
    const engine2 = new VtesEngine(state, testRegistry);
    expect(engine2.decision()!.options.some((o) => o.id.includes("Open War"))).toBe(true);
  });

  it("can only ever be played once in a game", () => {
    // Stricter than "one in play": the event log remembers a copy that
    // has already been burned.
    const state = threeSeatGame();
    find(state, "V1").title = "baron";
    state.seats[0]!.hand.push({ id: "ow1", name: "Open War" });
    state.eventLog.push({
      type: "CardPlayed",
      cardId: "gone",
      name: "Open War",
      seat: "Carol",
      minion: null,
      mode: null,
    });
    const engine = new VtesEngine(state, testRegistry);
    expect(engine.decision()!.options.some((o) => o.id.includes("Open War"))).toBe(false);
  });

  it("lets EVERY Methuselah feed it in their own master phase", () => {
    const state = threeSeatGame();
    openWarInPlay(state);
    masterPhase(state);
    const engine = new VtesEngine(state, testRegistry);
    // Alice's master phase: Alice is offered it, and it is hers.
    expect(
      engine.decision()!.options.some((o) => o.id === "ability:Open War:ow:fund:Alice"),
    ).toBe(true);
  });

  it("pays the CONTROLLER 4 pool at the fourth counter, and burns", () => {
    // Owner ruling: the controller gains, not whoever placed the counter.
    const state = threeSeatGame();
    const entry = openWarInPlay(state);
    entry.counters = 3;
    masterPhase(state);
    const alice = state.seats[0]!.pool;
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "ability:Open War:ow:fund:Alice"]]);
    // -1 to fund, +4 payout.
    expect(state.seats[0]!.pool).toBe(alice - 1 + 4);
    expect(state.seats[0]!.permanents.some((p) => p.card.id === "ow")).toBe(false);
  });

  it("grants Anarchs a location-burn action costing 2 pool", () => {
    const state = threeSeatGame();
    openWarInPlay(state);
    find(state, "V1").sect = "anarch";
    state.seats[1]!.permanents.push(location("loc", "Alamut"));
    const engine = new VtesEngine(state, testRegistry);
    const opt = "act:Open War:ow:raze:V1:loc";
    expect(engine.decision()!.options.some((o) => o.id === opt)).toBe(true);

    const before = state.seats[0]!.pool;
    runTrace(engine, [
      ["Alice", opt],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
    ]);
    expect(state.seats[1]!.permanents.some((p) => p.card.id === "loc")).toBe(false);
    expect(state.seats[0]!.pool).toBe(before - 2); // "costs 2 pool"
  });

  it("offers the location burn only to Anarchs", () => {
    const state = threeSeatGame();
    openWarInPlay(state);
    find(state, "V1").sect = "camarilla";
    state.seats[1]!.permanents.push(location("loc", "Alamut"));
    const engine = new VtesEngine(state, testRegistry);
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("act:Open War:ow:raze")),
    ).toBe(false);
  });
});
