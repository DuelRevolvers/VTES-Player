/**
 * Allies with two Ⓓ actions (docs/plain-allies-design.md §5, wave 47).
 * Young Bloods (102202), Gregory Winter (100855), Amam the Devourer
 * (100042).
 *
 * The primitive under test is a card carrying MORE THAN ONE granted
 * action: each grant compiles in its own turn of the loop, so the risk is
 * one grant's resolver answering for another. Hence the assertions on
 * WHICH effect each option produced, not just that both were offered.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function allyInPlay(state: GameState, seat: string, id: string, name: string, life: number): MinionState {
  const stats = testRegistry[name]?.allyEntry?.(null);
  const self: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: stats?.statics ?? {},
    tags: stats?.tags ?? [],
  };
  const m = makeAlly(id, seat, life, { name, attached: [self], strength: 2 });
  state.seats.find((s) => s.id === seat)!.minions.push(m);
  return m;
}

function ids(engine: VtesEngine): string[] {
  return (engine.decision()?.options ?? []).map((o) => o.id);
}

function settle(engine: VtesEngine, state: GameState): void {
  for (let i = 0; i < 40; i++) {
    if (!state.frames.some((f) => f.kind === "action")) return;
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

describe("Young Bloods (102202)", () => {
  it("burns 2 blood only from a LOCKED vampire under capacity 8", () => {
    const state = threeSeatGame();
    allyInPlay(state, "Alice", "yb", "Young Bloods", 3);
    Object.assign(find(state, "W")!, { blood: 4, locked: true, capacity: 5 });
    Object.assign(find(state, "M")!, { blood: 4, locked: false, capacity: 5 });
    state.seats[1]!.minions.push(
      makeMinion("BIG", "Bob", { blood: 4, locked: true, capacity: 9 }),
    );
    const engine = new VtesEngine(state, testRegistry);
    const acts = ids(engine).filter((o) => o.startsWith("act:Young Bloods:yb"));
    expect(acts.some((o) => o.endsWith("blood:W"))).toBe(true);
    expect(acts.some((o) => o.endsWith("blood:M"))).toBe(false); // unlocked
    expect(acts.some((o) => o.endsWith("blood:BIG"))).toBe(false); // capacity 9
    runTrace(engine, [["Alice", acts.find((o) => o.endsWith("blood:W"))!]]);
    settle(engine, state);
    expect(find(state, "W")!.blood).toBe(2);
  });

  it("pays the burner 2 blood when another Methuselah's vampire kills it in combat", () => {
    const state = threeSeatGame();
    const yb = allyInPlay(state, "Alice", "yb", "Young Bloods", 3);
    const w = find(state, "W")!;
    Object.assign(w, { blood: 3, capacity: 8, strength: 3 });
    const engine = new VtesEngine(state, testRegistry);
    // A REAL combat: the ally bleeds, Bob's W blocks, and the ally is
    // burned inside the resulting combat frame.
    runTrace(engine, [
      ["Alice", `bleed:${yb.id}`],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "block:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block → combat
    ]);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(true);
    engine.burnMinion(yb.id);
    expect(find(state, "W")!.blood).toBe(5); // 3 + 2
    expect(find(state, "yb")).toBeUndefined();
  });
});

describe("Gregory Winter (100855) — the first card with TWO granted actions", () => {
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    allyInPlay(state, "Alice", "gw", "Gregory Winter", 4);
    Object.assign(find(state, "W")!, { blood: 3 });
    state.seats[1]!.minions.push(
      makeMinion("T", "Bob", { inTorpor: true, blood: 1, capacity: 3 }),
    );
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("offers BOTH grants, each with its own index", () => {
    const { engine } = game();
    const acts = ids(engine).filter((o) => o.startsWith("act:Gregory Winter:gw"));
    expect(acts.some((o) => o.endsWith("blood:W"))).toBe(true);
    expect(acts.some((o) => o.endsWith("torpor:T"))).toBe(true);
  });

  it("grant 0 STEALS the blood as life", () => {
    const { state, engine } = game();
    runTrace(engine, [
      ["Alice", ids(engine).find((o) => o.endsWith("blood:W"))!],
    ]);
    settle(engine, state);
    expect(find(state, "W")!.blood).toBe(2);
    expect(find(state, "gw")!.blood).toBe(5); // 4 life + 1 stolen
  });

  it("grant 1 burns the torpid vampire for 2 life — the OTHER grant's effect, not the first's", () => {
    const { state, engine } = game();
    runTrace(engine, [
      ["Alice", ids(engine).find((o) => o.endsWith("torpor:T"))!],
    ]);
    settle(engine, state);
    expect(find(state, "T")).toBeUndefined();
    expect(find(state, "gw")!.blood).toBe(6); // 4 life + 2
    expect(find(state, "W")!.blood).toBe(3); // untouched by the other grant
  });

  it("burns 1 life during its controller's unlock phase", () => {
    const { state, engine } = game();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "unlock";
      tf.unlockDone = false;
      tf.unlockAbilitiesDone = false;
    }
    for (let i = 0; i < 6; i++) {
      const dp = engine.decision();
      if (!dp || state.frames.some((f) => f.kind === "turn" && f.phase !== "unlock")) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(find(state, "gw")!.blood).toBe(3); // 4 - 1
  });
});

describe("Amam the Devourer (100042)", () => {
  it("is SHUFFLED into its owner's library when burned, not sent to the ash heap", () => {
    const state = threeSeatGame();
    const amam = allyInPlay(state, "Alice", "am", "Amam the Devourer", 3);
    const engine = new VtesEngine(state, testRegistry);
    engine.burnMinion(amam.id);
    expect(find(state, "am")).toBeUndefined();
    expect(state.seats[0]!.library.some((c) => c.id === "am")).toBe(true);
    expect((state.seats[0]!.ashHeap ?? []).some((c) => c.id === "am")).toBe(false);
  });
});
