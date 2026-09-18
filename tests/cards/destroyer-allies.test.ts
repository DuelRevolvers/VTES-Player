/**
 * Allies whose Ⓓ action destroys a card in play
 * (docs/destroyer-allies-design.md).
 *
 * The Bruisers (100259), Arcanum Investigator (100083), Felix "Fix"
 * Hessian (100719).
 *
 * One granted action, three different answers to "whose cards?" — so the
 * negative space (the seat each one may NOT reach) is most of the test.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [], ...over };
}

function location(id: string, name: string): PermanentInPlay {
  return entry(id, name, { tags: ["location"] });
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function inPlay(state: GameState, cardId: string): boolean {
  return (
    state.seats.some((s) => s.permanents.some((p) => p.card.id === cardId)) ||
    state.seats.some((s) => s.minions.some((m) => m.attached.some((p) => p.card.id === cardId)))
  );
}

/** Alice's ally, in play with its own self-attached entry. */
function withAlly(name: string, id: string): { state: GameState; engine: () => VtesEngine } {
  const state = threeSeatGame();
  state.seats[0]!.minions.push(
    makeAlly(id, "Alice", 2, { name, attached: [entry(id, name)] }),
  );
  return { state, engine: () => new VtesEngine(state, testRegistry) };
}

function options(engine: VtesEngine): string[] {
  return (engine.decision()?.options ?? []).map((o) => o.id);
}

/**
 * Pass everything until the action has resolved, recording which seats
 * were offered a block. The impulse cycle does not start at the acting
 * seat, so a hand-written pass list pins the wrong seat order; what the
 * test is actually about is who could block and what was left standing.
 */
function resolve(engine: VtesEngine, state: GameState): Set<string> {
  const blockers = new Set<string>();
  for (let i = 0; i < 40; i++) {
    if (!state.frames.some((f) => f.kind === "action")) break;
    const dp = engine.decision();
    if (!dp) break;
    if (dp.options.some((o) => o.id.startsWith("block:"))) blockers.add(dp.seat);
    runTrace(engine, [[dp.seat, "pass"]]);
  }
  return blockers;
}

// ---------------------------------------------------------------------------

describe("The Bruisers (100259)", () => {
  it("reaches the PREY's location and not the predator's", () => {
    const { state, engine: make } = withAlly("The Bruisers", "br");
    state.seats[1]!.permanents.push(location("preyloc", "Alamut")); // Bob = prey
    state.seats[2]!.permanents.push(location("predloc", "Alamut")); // Carol = predator
    const engine = make();
    const ids = options(engine);
    expect(ids).toContain("act:The Bruisers:br:granted:br:burn:preyloc");
    expect(ids).not.toContain("act:The Bruisers:br:granted:br:burn:predloc");
  });

  it("burns it, and only its controller may block", () => {
    const { state, engine: make } = withAlly("The Bruisers", "br");
    state.seats[1]!.permanents.push(location("preyloc", "Alamut"));
    const engine = make();
    runTrace(engine, [["Alice", "act:The Bruisers:br:granted:br:burn:preyloc"]]);
    // Ⓓ at the location's controller (p. 25): Carol is never offered one.
    expect([...resolve(engine, state)]).toEqual(["Bob"]);
    expect(inPlay(state, "preyloc")).toBe(false);
  });
});

describe("Arcanum Investigator (100083)", () => {
  it("reaches equipment on either neighbour", () => {
    const { state, engine: make } = withAlly("Arcanum Investigator", "ai");
    find(state, "M").attached.push(entry("gun", ".44 Magnum", { tags: ["equipment"] }));
    find(state, "N").attached.push(entry("gun2", ".44 Magnum", { tags: ["equipment"] }));
    const ids = options(make());
    expect(ids).toContain("act:Arcanum Investigator:ai:granted:ai:burn:gun");
    expect(ids).toContain("act:Arcanum Investigator:ai:granted:ai:burn:gun2");
  });

  it("NEGATIVE SPACE: a LOCATION is not equipment", () => {
    const { state, engine: make } = withAlly("Arcanum Investigator", "ai");
    state.seats[1]!.permanents.push(location("preyloc", "Alamut"));
    expect(options(make()).some((i) => i.startsWith("act:Arcanum Investigator"))).toBe(false);
  });
});

describe('Felix "Fix" Hessian (100719)', () => {
  it("burns any other Methuselah's location, for 1 pool", () => {
    const { state, engine: make } = withAlly('Felix "Fix" Hessian', "fx");
    state.seats[2]!.permanents.push(location("predloc", "Alamut"));
    const engine = make();
    expect(options(engine)).toContain('act:Felix "Fix" Hessian:fx:granted:fx:burn:predloc');
    const before = state.seats[0]!.pool;
    runTrace(engine, [["Alice", 'act:Felix "Fix" Hessian:fx:granted:fx:burn:predloc']]);
    resolve(engine, state);
    expect(inPlay(state, "predloc")).toBe(false);
    // "…that costs 1 pool" — paid at resolution, only on success (p. 27).
    expect(state.seats[0]!.pool).toBe(before - 1);
  });
});
