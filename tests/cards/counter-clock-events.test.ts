/**
 * Events that keep a counter (docs/counter-clock-events-design.md).
 *
 * Dr. Marisa Fletcher, CDC (100577), FBI Special Affairs Division
 * (100709), Fueled by Heart's Blood (100796).
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Walk the engine, preferring `wanted` ids, then pass, then the first
 *  option — the test-walker rule: never play the board by accident. */
function walk(engine: VtesEngine, wanted: string[], stop?: () => boolean, steps = 60): void {
  for (let i = 0; i < steps; i++) {
    if (stop?.()) return;
    const dp = engine.decision();
    if (!dp) return;
    const pick =
      dp.options.find((o) => wanted.includes(o.id)) ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "end") ??
      dp.options[0]!;
    engine.choose(pick.id);
  }
}

/** An attached card with nothing but a static — an intercept source the
 *  fixture can hand a blocker without naming a real card. */
function statics(id: string, s: Record<string, unknown>): PermanentInPlay {
  return { card: { id, name: id }, locked: false, usedThisPhase: false, statics: s, tags: [] } as never;
}

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function entry(id: string, name: string, counters?: number): PermanentInPlay {
  const h = testRegistry[name];
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h?.permanentStatics ?? {},
    tags: h?.permanentTags ?? [],
    ...(counters !== undefined ? { counters } : {}),
  };
}

// ---------------------------------------------------------------------------

describe("Dr. Marisa Fletcher, CDC (100577)", () => {
  /** V1 hunts, Bob blocks with W. Returns the state after the block. */
  function blockedHunt(counters: number): GameState {
    const state = threeSeatGame();
    state.seats[1]!.permanents.push(entry("mf", "Dr. Marisa Fletcher, CDC", counters));
    // A hunt has +1 inherent stealth (p. 21), so the blocker needs more.
    find(state, "W")!.attached.push(statics("eye", { intercept: 2 }));
    const engine = new VtesEngine(state, testRegistry);
    // Stop the moment the block resolves: Fletcher adds 2 counters every
    // unlock phase, so a walker left running would reach the threshold on
    // a later turn and the negative case would burn after all.
    walk(engine, ["hunt:V1", "block:W"], () =>
      state.eventLog.some((e) => e.type === "BlockSucceeded"),
    );
    return state;
  }

  it("burns a vampire under the count, and spends every counter doing it", () => {
    const state = blockedHunt(6); // V1's capacity is 5
    expect(find(state, "V1")).toBeUndefined();
    expect(state.seats[1]!.permanents[0]!.counters ?? 0).toBe(0);
  });

  it("NEGATIVE SPACE: leaves a vampire whose capacity reaches the count", () => {
    const state = blockedHunt(5); // capacity 5 is not "less than" 5
    expect(find(state, "V1")).toBeDefined();
    expect(state.seats[1]!.permanents[0]!.counters).toBe(5);
  });
});

describe("FBI Special Affairs Division (100709)", () => {
  it("counts the burnt ally and damages the acting vampire after combat", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(entry("fbi", "FBI Special Affairs Division", 3));
    // Bob blocks Alice's bleed with an ally, which then burns.
    state.seats[1]!.minions.push(
      makeMinion("A1", "Bob", { kind: "ally", blood: 1, capacity: 1 }),
    );
    const engine = new VtesEngine(state, testRegistry);
    // A bleed has 0 stealth, so a bare ally can block it; then V1's hand
    // strike kills the 1-life ally.
    walk(engine, ["bleed:V1", "block:A1", "strike:hand"]);
    expect(find(state, "A1")).toBeUndefined();
    // Fourth counter burns the card, and V1 took 2 environmental damage.
    expect(state.seats[0]!.permanents.some((p) => p.card.id === "fbi")).toBe(false);
    expect(
      state.eventLog.some(
        (e) => e.type === "DamageInflicted" && e.minion === "V1" && e.source === null,
      ),
    ).toBe(true);
  });
});

describe("Fueled by Heart's Blood (100796)", () => {
  it("arrives with 10 counters and loses one per Gehenna event played", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "ev", name: "Fueled by Heart's Blood" });
    state.seats[0]!.hand.push({ id: "ev2", name: "Dragonbound" });
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") {
      tf.phase = "discard";
      tf.discardActionsLeft = 2;
    }
    const engine = new VtesEngine(state, testRegistry);
    const play = (name: string): void => {
      const id = engine.decision()!.options.find((o) => o.id.includes(name))!.id;
      engine.choose(id);
      for (let i = 0; i < 4; i++) {
        const dp = engine.decision();
        if (!dp || dp.window !== "card.asPlayed") break;
        engine.choose("pass");
      }
    };
    play("Fueled by Heart's Blood");
    const held = state.seats[0]!.permanents.find((p) => p.card.name === "Fueled by Heart's Blood");
    expect(held?.counters).toBe(10);
    play("Dragonbound");
    expect(held?.counters).toBe(9);
  });
});
