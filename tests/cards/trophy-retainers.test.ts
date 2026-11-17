/**
 * Trophy: Retainers (102036): "Master. Trophy. During your unlock phase, if this
 * card is on a vampire, you may search your library (shuffle afterward) or hand
 * for a retainer. This vampire employs that retainer (he or she must meet the
 * requirements, if any). Pay the cost as normal. This is not an action."
 *
 * Alice's V1 carries the card. The unlock-phase trigger is fired directly.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function setup(): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 3, capacity: 6 });
  state.seats[0]!.pool = 5;
  const engine = new VtesEngine(state, testRegistry);
  engine.putPermanentInPlay({
    card: { id: "tr", name: "Trophy: Retainers" },
    seat: "Alice",
    attachTo: "V1",
    statics: {},
    tags: ["Trophy: Retainers"],
  });
  return { state, engine };
}

function fire(engine: VtesEngine, state: GameState): void {
  const card = find(state, "V1").attached.find((p) => p.card.name === "Trophy: Retainers")!;
  testRegistry["Trophy: Retainers"]!.onControllerUnlock!(card, { seat: "Alice", minion: "V1" }, engine as any);
  void state;
}

function retainerOptions(engine: VtesEngine) {
  const dp = engine.decision();
  if (!dp || dp.seat !== "Alice") return [];
  return dp.options.filter((o) => o.id.includes("Trophy: Retainers:"));
}

describe("Trophy: Retainers (102036)", () => {
  it("a retainer in hand is offered, and employing it puts it on the bearer", () => {
    const { state, engine } = setup();
    state.seats[0]!.hand = [{ id: "gr1", name: "Ghoul Retainer" } as any];
    fire(engine, state);
    const opts = retainerOptions(engine);
    expect(opts.length).toBe(1);
    engine.choose(opts[0]!.id);
    expect(find(state, "V1").attached.some((p) => p.card.name === "Ghoul Retainer")).toBe(true);
    expect(state.seats[0]!.hand.some((c) => c.name === "Ghoul Retainer")).toBe(false);
  });

  it("a retainer in library is offered; employing it removes it from the library", () => {
    const { state, engine } = setup();
    state.seats[0]!.library = [{ id: "gr2", name: "Ghoul Retainer" } as any, { id: "x", name: "Ghoul Retainer" } as any];
    const before = state.seats[0]!.library.length;
    fire(engine, state);
    const opts = retainerOptions(engine);
    expect(opts.some((o) => o.id.includes(":library:"))).toBe(true);
    engine.choose(opts.find((o) => o.id.includes(":library:"))!.id);
    expect(find(state, "V1").attached.some((p) => p.card.name === "Ghoul Retainer")).toBe(true);
    expect(state.seats[0]!.library.length).toBeLessThan(before);
  });

  it("declining employs nothing", () => {
    const { state, engine } = setup();
    state.seats[0]!.hand = [{ id: "gr1", name: "Ghoul Retainer" } as any];
    fire(engine, state);
    const decline = engine.decision()!.options.find((o) => !o.id.includes("Trophy: Retainers:"))!;
    engine.choose(decline.id);
    expect(find(state, "V1").attached.some((p) => p.card.name === "Ghoul Retainer")).toBe(false);
    expect(state.seats[0]!.hand.some((c) => c.name === "Ghoul Retainer")).toBe(true);
  });

  it("with no retainer in hand or library, nothing is offered", () => {
    const { state, engine } = setup();
    state.seats[0]!.hand = [{ id: "c1", name: "Conditioning" } as any];
    fire(engine, state);
    expect(retainerOptions(engine)).toHaveLength(0);
  });

  it("a retainer whose requirement the bearer does not meet is not offered (Dog Pack needs a Gangrel)", () => {
    const { state, engine } = setup();
    state.seats[0]!.hand = [{ id: "dp", name: "Dog Pack" } as any];
    find(state, "V1").clan = "Ventrue";
    fire(engine, state);
    expect(retainerOptions(engine)).toHaveLength(0);
  });

  it("the same retainer IS offered once the bearer is a Gangrel", () => {
    const { state, engine } = setup();
    state.seats[0]!.hand = [{ id: "dp", name: "Dog Pack" } as any];
    find(state, "V1").clan = "Gangrel";
    fire(engine, state);
    expect(retainerOptions(engine)).toHaveLength(1);
  });
});
