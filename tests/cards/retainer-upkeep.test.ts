/**
 * Retainer upkeep (docs/retainer-upkeep-design.md).
 *
 * Faithful Servant (100692), Fortune Teller (100776), Robert Carter
 * (101644) — three retainers whose text is a PHASE, which is how the
 * phase-hook family's missing opener was found.
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

function employ(state: GameState, minionId: string, cardId: string, name: string): void {
  const h = testRegistry[name];
  if (!h) throw new Error(`no handler ${name}`);
  const e: PermanentInPlay = {
    card: { id: cardId, name },
    locked: false,
    usedThisPhase: false,
    life: 1,
    statics: h.permanentStatics ?? {},
    tags: h.permanentTags ?? [],
  };
  find(state, minionId).attached.push(e);
}

function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Alice's turn rewound to the master phase, so passing it opens her
 *  minion phase and fires the new hook. */
function atMasterPhase(): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn frame");
  tf.phase = "master";
  return state;
}

// ---------------------------------------------------------------------------
// §2 — Faithful Servant, and the hook that did not exist
// ---------------------------------------------------------------------------

describe("Faithful Servant (100692)", () => {
  it("feeds a torpid employer as the minion phase OPENS", () => {
    const state = atMasterPhase();
    find(state, "V1").inTorpor = true;
    find(state, "V1").blood = 1;
    employ(state, "V1", "fs", "Faithful Servant");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "pass"]]);
    expect(find(engine.state, "V1").blood).toBe(2);
  });

  it("NEGATIVE SPACE: nothing for an employer who is not in torpor", () => {
    const state = atMasterPhase();
    find(state, "V1").blood = 1;
    employ(state, "V1", "fs", "Faithful Servant");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "pass"]]);
    expect(find(engine.state, "V1").blood).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §3 — Robert Carter: an upkeep, and a question only when affordable
// ---------------------------------------------------------------------------

describe("Robert Carter (101644)", () => {
  /** Alice's turn wound back to her unlock phase. */
  function atUnlock(blood: number): VtesEngine {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn frame");
    tf.phase = "unlock";
    tf.unlockDone = false;
    find(state, "V1").blood = blood;
    employ(state, "V1", "rc", "Robert Carter");
    return new VtesEngine(state, testRegistry);
  }

  it("asks the employer to pay, and burns Carter when they decline", () => {
    const engine = atUnlock(3);
    const pay = "choice:Robert Carter:rc:retainerUpkeep:pay";
    expect(ids(engine)).toContain(pay);
    runTrace(engine, [["Alice", pay]]);
    expect(find(engine.state, "V1").blood).toBe(2);
    expect(find(engine.state, "V1").attached.length).toBe(1);

    const declined = atUnlock(3);
    runTrace(declined, [["Alice", "choice:Robert Carter:rc:retainerUpkeep:burn"]]);
    expect(find(declined.state, "V1").attached).toEqual([]);
  });

  it("NEGATIVE SPACE: an employer with no blood is not asked at all", () => {
    // A frame with one answer is a frame nobody should be given.
    const engine = atUnlock(0);
    expect(ids(engine).some((i) => i.includes("Robert Carter"))).toBe(false);
    expect(find(engine.state, "V1").attached).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §4 — Fortune Teller
// ---------------------------------------------------------------------------

describe("Fortune Teller (100776)", () => {
  it("learns one card of the prey's hand, once, and deterministically", () => {
    const state = threeSeatGame();
    employ(state, "V1", "ft", "Fortune Teller");
    const engine = new VtesEngine(state, testRegistry);
    const id = "ability:Fortune Teller:ft:peek";
    expect(ids(engine)).toContain(id);
    runTrace(engine, [["Alice", id]]);
    // Bob is Alice's prey; his hand is one card, so the look is settled.
    expect(engine.state.knowledge?.["Alice"]).toEqual(["d1"]);
    // NEGATIVE SPACE: once each phase.
    expect(ids(engine)).not.toContain(id);
  });
});
