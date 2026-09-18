/**
 * A second minion helps the action through
 * (docs/second-minion-modifiers-design.md).
 *
 * Suppressing Fire (101907), Zapaderin (102204), Stealth Ritus (101867).
 *
 * All three are played on the ACTING side by a minion that is not the
 * actor, so the gate — who may play it, and against whom it counts — is
 * most of what is worth pinning.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, currentIntercept, currentStealth } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  const h = testRegistry[name];
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h?.permanentStatics ?? {},
    tags: h?.permanentTags ?? [],
    ...over,
  };
}

function actionId(state: GameState): string {
  const af = state.frames.find((f) => f.kind === "action");
  if (af?.kind !== "action") throw new Error("no action");
  return af.actionId;
}

/**
 * Let a played card finish. A modifier resolves when the impulse cycle it
 * was played in COMPLETES, not when its as-played window closes — so
 * reading the effect after three passes reads it too early, which is how
 * the first draft of this file "proved" that three working cards did
 * nothing.
 */
function settle(engine: VtesEngine, passes = 6): void {
  for (let i = 0; i < passes; i++) {
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, "pass"]]);
  }
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function walkTo(engine: VtesEngine, prefix: string, limit = 10): boolean {
  for (let i = 0; i < limit; i++) {
    if (optionIds(engine).some((x) => x.startsWith(prefix))) return true;
    const dp = engine.decision();
    if (!dp) return false;
    runTrace(engine, [[dp.seat, "pass"]]);
  }
  return optionIds(engine).some((x) => x.startsWith(prefix));
}

/**
 * Alice's V1 bleeds with a SECOND minion, V2, in her ready region — the
 * one that plays these cards. `blocked` runs on to a live block attempt
 * by Bob's W, which the two intercept cards need and the stealth one
 * does not.
 */
function setup(
  card: string,
  v2: Partial<MinionState>,
  blocked: boolean,
): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  find(state, "V1").blood = 4;
  state.seats[0]!.minions.push(makeMinion("V2", "Alice", { blood: 4, ...v2 }));
  // NOT "c1": the fixture already deals Alice a Conditioning with that
  // id, and two cards sharing an instance id means the engine resolves
  // the wrong one — which looked exactly like three working cards doing
  // nothing.
  state.seats[0]!.hand.push({ id: "wave", name: card });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  if (blocked) runTrace(engine, [["Alice", "pass"], ["Bob", "block:W"]]);
  return { state, engine };
}

// ---------------------------------------------------------------------------

describe("Suppressing Fire (101907)", () => {
  it("a minion with a GUN pushes the blocker down 1", () => {
    const { state, engine } = setup(
      "Suppressing Fire",
      { attached: [entry("gun", ".44 Magnum", { tags: ["equipment", "gun"] })] },
      true,
    );
    expect(walkTo(engine, "play:Suppressing Fire:basic:V2")).toBe(true);
    const aid = actionId(state);
    runTrace(engine, [["Alice", optionIds(engine).find((i) => i.startsWith("play:Suppressing Fire"))!]]);
    settle(engine);
    expect(currentIntercept(state, aid, "W")).toBe(-1);
  });

  it("NEGATIVE SPACE: no gun, no card", () => {
    const { engine } = setup("Suppressing Fire", {}, true);
    expect(walkTo(engine, "play:Suppressing Fire")).toBe(false);
  });
});

describe("Zapaderin (102204)", () => {
  it("taxes minions younger than the RAVNOS WHO PLAYED IT, not the actor", () => {
    // V2 (the Ravnos) is capacity 6; the acting V1 is capacity 5. W at 5
    // is younger than the player and NOT younger than the actor, so a
    // yardstick read off the actor would miss it entirely.
    const { state, engine } = setup(
      "Zapaderin",
      { clan: "Ravnos", capacity: 6 },
      true,
    );
    find(state, "V1").capacity = 5;
    find(state, "W").capacity = 5;
    expect(walkTo(engine, "play:Zapaderin:basic:V2")).toBe(true);
    const aid = actionId(state);
    runTrace(engine, [["Alice", optionIds(engine).find((i) => i.startsWith("play:Zapaderin"))!]]);
    settle(engine);
    expect(currentIntercept(state, aid, "W")).toBe(-1);
  });
});

describe("Stealth Ritus (101867)", () => {
  it("is offered once per affordable Sabbat helper, and they pay", () => {
    const { state, engine } = setup(
      "Stealth Ritus",
      { sect: "sabbat", blood: 2 },
      false,
    );
    find(state, "V1").sect = "sabbat";
    expect(walkTo(engine, "play:Stealth Ritus:basic:V1:V2")).toBe(true);
    const id = optionIds(engine).find((i) => i.startsWith("play:Stealth Ritus:basic:V1:V2"))!;
    const aid = actionId(state);
    runTrace(engine, [["Alice", id]]);
    settle(engine);
    // The helper paid, and the action got its stealth.
    expect(find(state, "V2").blood).toBe(1);
    expect(currentStealth(state, aid)).toBe(1);
  });

  it("NEGATIVE SPACE: a helper of the wrong SECT is not offered", () => {
    // Not "blood: 0" for the unaffordable case: a minion at 0 blood has a
    // MANDATORY hunt (p. 21) and the fixture never reaches the bleed —
    // the trap CLAUDE.md records seven instances of.
    const { state, engine } = setup("Stealth Ritus", { sect: "camarilla", blood: 2 }, false);
    find(state, "V1").sect = "sabbat";
    // Read the announce window directly: "only usable when the action is
    // announced" means walking past it is walking past the card.
    expect(optionIds(engine).some((i) => i.startsWith("play:Stealth Ritus"))).toBe(false);
  });
});
