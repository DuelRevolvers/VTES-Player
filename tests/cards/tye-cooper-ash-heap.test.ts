/**
 * Tye Cooper (102053): "can burn a non-ready minion as a Ⓓ action; if that
 * action is successful, you can move a library card from your ash heap to
 * your hand (discard down afterward)." "Non-ready" is the torpor region
 * (`isReady`), so the burn is the existing burnTorporVampire arm.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function tye(): PermanentInPlay {
  const h = testRegistry["Tye Cooper"]!;
  return {
    card: { id: "tc", name: "Tye Cooper" },
    locked: false,
    usedThisPhase: false,
    life: 1,
    statics: h.permanentStatics ?? {},
    tags: h.permanentTags ?? [],
  };
}

/** Alice's V1 carries Tye Cooper; Bob's W is in torpor; Alice's ash heap
 *  holds one library card (and an optional crypt card, to be ignored). */
function setup(opts: { wInTorpor?: boolean; crypt?: boolean } = {}): VtesEngine {
  const state = threeSeatGame();
  find(state, "V1").attached.push(tye());
  find(state, "W").inTorpor = opts.wInTorpor ?? true;
  find(state, "W").blood = 2;
  state.seats[0]!.ashHeap = [
    { id: "lib1", name: "Conditioning" },
    ...(opts.crypt ? [{ id: "cr1", name: "Lilith", crypt: true } as never] : []),
  ];
  return new VtesEngine(state, testRegistry);
}

/** Pass through the action's own windows until the ash-heap choice (or
 *  nothing) is left, so the granted action has resolved. */
function resolveAction(engine: VtesEngine, want: (ids: string[]) => boolean): void {
  for (let i = 0; i < 40; i++) {
    const ids = engine.decision()?.options.map((o) => o.id) ?? [];
    if (want(ids)) return;
    if (!ids.includes("pass")) return;
    // Whoever is asked passes: the action's windows rotate through seats.
    runTrace(engine, [[engine.decision()!.seat, "pass"]]);
  }
}

function burnOption(engine: VtesEngine): string | undefined {
  return engine.decision()?.options.find((o) => o.id.startsWith("act:Tye Cooper:tc:granted:") && o.id.includes(":torpor:W"))?.id;
}

describe("Tye Cooper (102053) ash-heap rider", () => {
  it("after a successful burn, the library card goes to hand and the choice is offered", () => {
    const engine = setup();
    const burn = burnOption(engine);
    expect(burn).toBeDefined();
    runTrace(engine, [["Alice", burn!]]);
    resolveAction(engine, (ids) => ids.some((id) => id.endsWith(":lib1")));
    expect(engine.state.seats.flatMap((s) => s.minions).some((m) => m.id === "W")).toBe(false);
    const pick = engine.decision()?.options.find((o) => o.id.endsWith(":lib1"));
    expect(pick).toBeDefined();
    runTrace(engine, [["Alice", pick!.id]]);
    expect(engine.state.seats[0]!.hand.some((c) => c.id === "lib1")).toBe(true);
    expect(engine.state.seats[0]!.ashHeap?.some((c) => c.id === "lib1")).toBe(false);
  });

  it("NEGATIVE SPACE: a crypt card in the ash heap is never offered", () => {
    const engine = setup({ crypt: true });
    runTrace(engine, [["Alice", burnOption(engine)!]]);
    resolveAction(engine, (ids) => ids.some((id) => id.endsWith(":lib1")));
    const ids = engine.decision()?.options.map((o) => o.id) ?? [];
    expect(ids.some((id) => id.includes(":cr1"))).toBe(false);
    // The library card IS offered, so the empty result is not a dead end.
    expect(ids.some((id) => id.endsWith(":lib1"))).toBe(true);
  });

  it("NEGATIVE SPACE: a burn that did not happen offers no ash-heap choice", () => {
    const engine = setup({ wInTorpor: false });
    // With W ready there is no torpor burn to announce.
    expect(burnOption(engine)).toBeUndefined();
  });
});
