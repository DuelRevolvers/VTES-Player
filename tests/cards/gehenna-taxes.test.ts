/**
 * Gehenna taxes (docs/gehenna-taxes-design.md).
 *
 * Torpid Blood (101994), The Slow Withering (101807), The Rising (101640)
 * — three events whose replacement draw waits on a CONDITION, and whose
 * text is a rule the whole table plays under.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, playCostFor } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id)!;
}

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

/** What a card requiring a superior Discipline costs `minion` right now. */
function costOfSuperiorCard(state: GameState, minion: MinionState): number {
  return playCostFor(
    state,
    {
      name: "Conditioning",
      bloodCost: 0,
      poolCost: 0,
      types: ["actionModifier"],
      requires: ["dom"],
      requiresSuperior: true,
    },
    minion,
    null,
    null,
  ).blood;
}

// ---------------------------------------------------------------------------

describe("Torpid Blood (101994)", () => {
  it("taxes leaving torpor, and the option goes with the blood to pay it", () => {
    const state = threeSeatGame();
    state.seats[1]!.permanents.push(entry("tb", "Torpid Blood"));
    Object.assign(find(state, "V1"), { inTorpor: true, blood: 2 });
    // 2 blood used to be enough; the tax makes it 3.
    let engine = new VtesEngine(state, testRegistry);
    expect(engine.decision()?.options.some((o) => o.id === "leave:V1")).toBe(false);
    find(state, "V1").blood = 3;
    engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "leave:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(find(state, "V1").inTorpor).toBe(false);
    expect(find(state, "V1").blood).toBe(0); // 2 printed + 1 tax
  });
});

describe("The Slow Withering (101807)", () => {
  it("charges superior-Discipline cards, but not a vampire who has diablerised", () => {
    const state = threeSeatGame();
    state.seats[2]!.permanents.push(entry("sw", "The Slow Withering"));
    const v = find(state, "V1");
    expect(costOfSuperiorCard(state, v)).toBe(1);
    // "Vampires who commit diablerie ignore this effect…"
    v.ignoresGehennaTax = true;
    expect(costOfSuperiorCard(state, v)).toBe(0);
  });
});

describe("The Rising (101640)", () => {
  it("swallows a Methuselah's own-turn pool gain until they have the Edge", () => {
    const state = threeSeatGame();
    state.seats[1]!.permanents.push(entry("ri", "The Rising"));
    const engine = new VtesEngine(state, testRegistry);
    engine.emit({ type: "PoolGained", seat: "Alice", amount: 3 });
    expect(state.seats[0]!.pool).toBe(10);
    // Bob is not the turn's Methuselah, so his gains are untouched.
    engine.emit({ type: "PoolGained", seat: "Bob", amount: 3 });
    expect(state.seats[1]!.pool).toBe(13);
    // …and the Edge lifts it for Alice.
    state.edge = "Alice";
    engine.emit({ type: "PoolGained", seat: "Alice", amount: 3 });
    expect(state.seats[0]!.pool).toBe(13);
  });

  it("holds the replacement draw until the PREY is ousted", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "ev", name: "The Rising" });
    state.seats[0]!.library.push({ id: "lib", name: "Conditioning" });
    state.seats[1]!.permanents.push(entry("g1", "Dragonbound"), entry("g2", "Thirst"));
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") {
      tf.phase = "discard";
      tf.discardActionsLeft = 1;
    }
    const engine = new VtesEngine(state, testRegistry);
    const id = engine.decision()?.options.find((o) => o.id.includes("The Rising"))!.id;
    runTrace(engine, [["Alice", id!]]);
    expect(state.seats[0]!.library.length).toBe(1); // not replaced yet
    // Carol is Alice's PREDATOR, not her prey — the wrong oust changes
    // nothing.
    engine.emit({ type: "Ousted", seat: "Carol" });
    expect(state.seats[0]!.library.length).toBe(1);
    engine.emit({ type: "Ousted", seat: "Bob" });
    expect(state.seats[0]!.library.length).toBe(0);
  });
});

describe("delayed replacement, centrally wired", () => {
  it("an EVENT's 'do not replace' clause reaches the handler at all", () => {
    // Narrow Minds shipped in wave 31 with this clause not wired: the
    // event compiler never read `delayedReplace`.
    expect(testRegistry["Narrow Minds"]?.delayedReplace).toBe("unlock");
    expect(testRegistry["The Slow Withering"]?.delayedReplaceUntil).toBe("diablerie");
  });
});
