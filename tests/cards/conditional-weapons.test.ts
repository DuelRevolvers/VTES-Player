/**
 * Conditional weapons (docs/conditional-weapons-design.md).
 *
 * Deer Rifle (100516), Blade of Bellona (100175), RPG Launcher (101656)
 * — three weapons whose conditions are on WHEN they may be used.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function entry(id: string, name: string): PermanentInPlay {
  const h = testRegistry[name];
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h?.permanentStatics ?? {},
    tags: h?.permanentTags ?? [],
  };
}

/**
 * A combat between V1 (Alice, armed with `weapon`) and W (Bob), with the
 * frame pushed directly — the wave's questions are all about the frame's
 * own state (round, range), which a scripted combat cannot vary cheaply.
 */
function combat(weapon: string, over: Partial<CombatFrame> = {}) {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  v1.attached.push(entry("wp", weapon));
  state.frames.push({
    kind: "combat",
    acting: "V1",
    actingSeat: "Alice",
    opposing: "W",
    opposingSeat: "Bob",
    fromBlock: true,
    round: 1,
    step: "range",
    range: "long",
    awaiting: "acting",
    declines: 0,
    strikes: { acting: null, opposing: null },
    strikeRound: "normal",
    additionalStrikes: { acting: 0, opposing: 0 },
    maneuverCredits: { acting: 0, opposing: 0 },
    closeManeuvers: { acting: 0, opposing: 0 },
    preventCreditsFirstRound: { acting: 0, opposing: 0 },
    unlockForBlood: { acting: 0, opposing: 0 },
    grantedCombatEnds: { acting: false, opposing: false },
    committedStrike: { acting: null, opposing: null },
    usedWeaponManeuver: { acting: null, opposing: null },
    restrict: {
      acting: { maneuver: false, press: false, equipment: false },
      opposing: { maneuver: false, press: false, equipment: false },
    },
    cycle: { order: ["Alice", "Bob", "Carol"], cursor: 0, passes: 0 },
    ...over,
  } as unknown as GameState["frames"][number]);
  return { state, engine: new VtesEngine(state, testRegistry) };
}

function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

// ---------------------------------------------------------------------------

describe("Deer Rifle (100516)", () => {
  it("offers a SECOND maneuver from the same weapon", () => {
    const { state, engine } = combat("Deer Rifle", {
      usedWeaponManeuver: { acting: "wp", opposing: null },
      weaponManeuversUsed: { wp: 1 },
    } as Partial<CombatFrame>);
    expect(ids(engine).some((i) => i.includes("Deer Rifle") && i.endsWith(":maneuver"))).toBe(
      true,
    );
    // …and not a third.
    const cf = state.frames.find((f) => f.kind === "combat")!;
    if (cf.kind === "combat") cf.weaponManeuversUsed = { wp: 2 };
    expect(ids(engine).some((i) => i.includes("Deer Rifle"))).toBe(false);
  });
});

describe("Blade of Bellona (100175)", () => {
  it("NEGATIVE SPACE: its maneuver is offered at long range only", () => {
    expect(
      ids(combat("Blade of Bellona").engine).some((i) => i.includes("Blade of Bellona")),
    ).toBe(true);
    expect(
      ids(combat("Blade of Bellona", { range: "close" }).engine).some((i) =>
        i.includes("Blade of Bellona"),
      ),
    ).toBe(false);
  });
});

describe("RPG Launcher (101656)", () => {
  it("NEGATIVE SPACE: no strike in the first round, and one in the second", () => {
    const first = combat("RPG Launcher", { step: "chooseStrike" } as Partial<CombatFrame>);
    expect(ids(first.engine).some((i) => i.includes("RPG Launcher"))).toBe(false);
    const second = combat("RPG Launcher", {
      step: "chooseStrike",
      round: 2,
    } as Partial<CombatFrame>);
    expect(ids(second.engine).some((i) => i.includes("RPG Launcher"))).toBe(true);
  });
});
