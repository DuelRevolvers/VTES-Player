/**
 * Eye of Hazimel (100678), the two clauses the earlier batches left open:
 *  - "During your unlock phase, burn 1 pool or burn this equipment."
 *  - "While the bearer is ready, this equipment cannot be moved or stolen."
 */
import { describe, expect, it } from "vitest";
import type { GameEvent, GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function eyeEntry(cardId = "eye"): PermanentInPlay {
  const h = testRegistry["Eye of Hazimel"]!;
  return {
    card: { id: cardId, name: "Eye of Hazimel" },
    locked: false,
    usedThisPhase: false,
    life: 1,
    statics: h.permanentStatics ?? {},
    tags: h.permanentTags ?? [],
  };
}

/** Records every emitted event, so a test can see what happened even when
 *  a later step (here, Alice's ouster) changes the final state. */
function recording(engine: VtesEngine): GameEvent[] {
  const log: GameEvent[] = [];
  const emit = engine.emit.bind(engine);
  engine.emit = (ev: GameEvent) => {
    log.push(ev);
    emit(ev);
  };
  return log;
}

function atUnlock(pool: number): VtesEngine {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn frame");
  tf.phase = "unlock";
  tf.unlockDone = false;
  state.seats[0]!.pool = pool;
  // The burned Eye deals 5 unpreventable damage to its bearer.
  find(state, "V1").blood = 8;
  find(state, "V1").attached.push(eyeEntry());
  return new VtesEngine(state, testRegistry);
}

function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

const PAY = "choice:Eye of Hazimel:eye:permanentPoolOrBurn:pool";
const BURN = "choice:Eye of Hazimel:eye:permanentPoolOrBurn:burn";

describe("Eye of Hazimel unlock upkeep", () => {
  it("offers pool or burn at the controller's unlock phase, and paying pool keeps the Eye", () => {
    const engine = atUnlock(3);
    expect(ids(engine)).toEqual(expect.arrayContaining([PAY, BURN]));
    runTrace(engine, [["Alice", PAY]]);
    expect(engine.state.seats[0]!.pool).toBe(2);
    expect(find(engine.state, "V1").attached.some((p) => p.card.id === "eye")).toBe(true);
  });

  it("burning the Eye declines the pool payment", () => {
    const engine = atUnlock(3);
    runTrace(engine, [["Alice", BURN]]);
    expect(engine.state.seats[0]!.pool).toBe(3);
    expect(find(engine.state, "V1").attached.some((p) => p.card.id === "eye")).toBe(false);
  });

  it("NEGATIVE SPACE: with no pool to pay, no choice is offered and the Eye burns at once", () => {
    const engine = atUnlock(0);
    const log = recording(engine);
    const opts = ids(engine);
    expect(opts).not.toContain(PAY);
    expect(opts).not.toContain(BURN);
    // The burn's 5 unpreventable damage lands on the bearer (8 blood -> 3).
    expect(log).toContainEqual(expect.objectContaining({ type: "BloodBurned", minion: "V1", amount: 3 }));
    expect(log).not.toContainEqual(expect.objectContaining({ type: "PoolBurned" }));
  });
});

describe("Eye of Hazimel cannot be moved or stolen while its bearer is ready", () => {
  function withEyeOnW(bearerLocked: boolean): VtesEngine {
    const state = threeSeatGame();
    const w = find(state, "W");
    w.locked = bearerLocked;
    w.attached.push(eyeEntry());
    return new VtesEngine(state, testRegistry);
  }

  it("a control change is refused while the bearer is ready", () => {
    const engine = withEyeOnW(false);
    const log = recording(engine);
    engine.changePermanentControl("eye", "Alice");
    expect(log.filter((e) => e.type === "ControlChanged")).toEqual([]);
  });

  it("a control change goes through once the bearer is locked", () => {
    const engine = withEyeOnW(true);
    const log = recording(engine);
    engine.changePermanentControl("eye", "Alice");
    expect(log).toContainEqual(expect.objectContaining({ type: "ControlChanged", id: "eye", to: "Alice" }));
  });
});
