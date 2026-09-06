/**
 * Shared fixtures for engine scenario tests. Since phase 3, the handler
 * registry is the REAL card implementation set from src/cards/effects —
 * the engine tests exercise production card code, not stand-ins.
 */

import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";

export const testRegistry = buildHandlerRegistry();

// ---------------------------------------------------------------------------
// Game setup
// ---------------------------------------------------------------------------

export function makeMinion(
  id: string,
  controller: string,
  overrides: Partial<MinionState> = {},
): MinionState {
  return {
    id,
    name: id,
    kind: "vampire",
    controller,
    blood: 2,
    capacity: 5,
    strength: 1,
    bleedAmount: 1,
    locked: false,
    awake: false,
    inTorpor: false,
    disciplines: {},
    bledThisTurn: false,
    calledPoliticalThisTurn: false,
    title: null,
    clan: null,
    sect: null,
    cannotActThisTurn: false,
    playedSinceUnlock: [],
    attached: [],
    ...overrides,
  };
}

/** An ally in play: kind "ally", no disciplines, life stored in `blood`. */
export function makeAlly(
  id: string,
  controller: string,
  life: number,
  overrides: Partial<MinionState> = {},
): MinionState {
  return makeMinion(id, controller, {
    kind: "ally",
    blood: life,
    capacity: life,
    ...overrides,
  });
}

/**
 * Alice → Bob → Carol (clockwise; Alice's prey is Bob, Bob's prey Carol).
 * Alice: V1 (dom basic) with Conditioning in hand.
 * Bob:   W (dom superior) with Deflection in hand, plus M (no disciplines).
 * Carol: N, empty hand.
 */
export function threeSeatGame(): GameState {
  return {
    seats: [
      {
        id: "Alice",
        pool: 10,
        minions: [makeMinion("V1", "Alice", { disciplines: { dom: "basic" } })],
        hand: [{ id: "c1", name: "Conditioning" }],
        library: [],
        uncontrolled: [],
        crypt: [],
        ousted: false,
        victoryPoints: 0,
        delayedDraws: 0,
        outOfTurnMasterUsed: false,
        permanents: [],
        autoPassWhenOnlyPass: false,
      },
      {
        id: "Bob",
        pool: 10,
        minions: [
          makeMinion("W", "Bob", { disciplines: { dom: "superior" }, blood: 3 }),
          makeMinion("M", "Bob"),
        ],
        hand: [{ id: "d1", name: "Deflection" }],
        library: [],
        uncontrolled: [],
        crypt: [],
        ousted: false,
        victoryPoints: 0,
        delayedDraws: 0,
        outOfTurnMasterUsed: false,
        permanents: [],
        autoPassWhenOnlyPass: false,
      },
      {
        id: "Carol",
        pool: 10,
        minions: [makeMinion("N", "Carol")],
        hand: [],
        library: [],
        uncontrolled: [],
        crypt: [],
        ousted: false,
        victoryPoints: 0,
        delayedDraws: 0,
        outOfTurnMasterUsed: false,
        permanents: [],
        autoPassWhenOnlyPass: false,
      },
    ],
    edge: null,
    frames: [
      {
        kind: "turn",
        seat: "Alice",
        phase: "minion",
        turnNumber: 1,
        unlockDone: true,
        edgeDone: true,
        unlockAbilitiesDone: true,
        unlockOthersDone: [],
        transfersLeft: 0,
        masterActionsLeft: 0,
        trifleGained: false,
      },
    ],
    eventLog: [],
    commandLog: [],
    decisionSeq: 0,
    rngState: 42,
    maxTurns: null,
  };
}

// ---------------------------------------------------------------------------
// Trace runner
// ---------------------------------------------------------------------------

export type TraceStep = [seat: string, optionIdOrPrefix: string];

/**
 * Drives the engine through an explicit decision-by-decision script,
 * asserting at every step that the engine asks the expected seat. This is
 * the executable form of the trace tables in docs/impulse-design.md §8 —
 * with zero elision: every single decision appears.
 */
export function runTrace(engine: VtesEngine, steps: TraceStep[]): void {
  steps.forEach(([seat, pick], i) => {
    const dp = engine.decision();
    if (!dp) {
      throw new Error(`step ${i} (${seat}: ${pick}): no decision pending`);
    }
    if (dp.seat !== seat) {
      throw new Error(
        `step ${i}: expected ${seat} to decide, but engine asks ${dp.seat} ` +
          `in ${dp.window} (options: ${dp.options.map((o) => o.id).join(", ")})`,
      );
    }
    const opt =
      dp.options.find((o) => o.id === pick) ??
      dp.options.find((o) => o.id.startsWith(pick));
    if (!opt) {
      throw new Error(
        `step ${i}: ${seat} has no option "${pick}" in ${dp.window}; ` +
          `legal: ${dp.options.map((o) => o.id).join(", ")}`,
      );
    }
    engine.choose(opt.id);
  });
}
