/**
 * Legacy rush and burn actions — tranche 3 wave 12
 * (docs/pool-widening-design.md §6).
 *
 * Arson, Bum's Rush, Ambush, Entrenching.
 *
 * Ambush is why this wave touched the engine. *"If the action is
 * unblocked when it resolves and the target is unlocked, the action
 * fizzles"* — the locked-target clause is a gate at ANNOUNCEMENT and
 * again at RESOLUTION, and only the first half existed. Fleetness
 * superior (V5) prints the same clause and had the same gap.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";

const WAVE: Array<[number, string]> = [
  [100094, "Arson"],
  [100266, "Bum's Rush"],
  [100046, "Ambush"],
  [100653, "Entrenching"],
];

function game(name: string, setup: (s: GameState) => void = () => {}) {
  const state = threeSeatGame();
  state.seats[0]!.minions[0]!.blood = 3;
  setup(state);
  state.seats[0]!.hand.push({ id: "ac", name });
  return { state, engine: new VtesEngine(state, testRegistry) };
}

function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Announce the named action (first matching option) and take it to
 *  resolution unblocked. */
function resolve(engine: VtesEngine, name: string, pick?: (o: string) => boolean): void {
  const opt = ids(engine).find((o) => o.startsWith(`play:${name}`) && (!pick || pick(o)));
  if (!opt) throw new Error(`${name} not offered: ${ids(engine).join(", ")}`);
  runTrace(engine, [
    ["Alice", opt],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A → unblocked
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
  ]);
}

function loc(id: string, name: string): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: ["location"] };
}

const combatLive = (s: GameState): boolean => s.frames.some((f) => f.kind === "combat");

describe("Arson (100094) — burn a location", () => {
  it("burns another Methuselah's location", () => {
    const { state, engine } = game("Arson", (s) => {
      s.seats[1]!.permanents.push(loc("bl", "Elder Library"));
    });
    resolve(engine, "Arson", (o) => o.includes("bl"));
    expect(state.seats[1]!.permanents.map((p) => p.card.id)).not.toContain("bl");
  });

  it("NEGATIVE SPACE: with no location in play it is not offered", () => {
    const { engine } = game("Arson");
    expect(ids(engine).some((o) => o.startsWith("play:Arson"))).toBe(false);
  });
});

describe("Bum's Rush (100266) — enter combat with any minion", () => {
  it("starts a combat with an UNLOCKED target", () => {
    const { state, engine } = game("Bum's Rush");
    expect(state.seats[1]!.minions.find((m) => m.id === "M")!.locked).toBe(false);
    resolve(engine, "Bum's Rush", (o) => o.endsWith(":M") || o.includes(":M:"));
    expect(combatLive(state)).toBe(true);
  });
});

describe("Ambush (100046) — enter combat with a LOCKED minion", () => {
  it("is offered only against a locked target", () => {
    const { state, engine } = game("Ambush", (s) => {
      s.seats[1]!.minions.find((m) => m.id === "M")!.locked = true;
    });
    const offered = ids(engine).filter((o) => o.startsWith("play:Ambush"));
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.every((o) => o.includes("M"))).toBe(true);
    // NEGATIVE SPACE: Bob's other vampire W is unlocked and never named.
    expect(state.seats[1]!.minions.find((m) => m.id === "W")!.locked).toBe(false);
    expect(offered.some((o) => o.includes(":W"))).toBe(false);
  });

  it("FIZZLES if the target unlocks before resolution", () => {
    // The ruling, and the reason `lockedOnly` is now re-read at
    // resolution. The action still SUCCEEDS — the cost is paid — but no
    // combat happens.
    const { state, engine } = game("Ambush", (s) => {
      s.seats[1]!.minions.find((m) => m.id === "M")!.locked = true;
    });
    const opt = ids(engine).find((o) => o.startsWith("play:Ambush"))!;
    runTrace(engine, [
      ["Alice", opt],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ]);
    // The target unlocks while the action is in the air.
    state.seats[1]!.minions.find((m) => m.id === "M")!.locked = false;
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A → unblocked
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
    ]);
    expect(combatLive(state)).toBe(false);
  });

  it("…and DOES fight when the target is still locked — the control", () => {
    // Same trace without the unlock. Without this the test above passes
    // for a card that never starts a combat at all.
    const { state, engine } = game("Ambush", (s) => {
      s.seats[1]!.minions.find((m) => m.id === "M")!.locked = true;
    });
    resolve(engine, "Ambush");
    expect(combatLive(state)).toBe(true);
  });
});

describe("Entrenching (100653) — 4 blood, if you already have 4", () => {
  it("pays a vampire at exactly 4 blood", () => {
    const { state, engine } = game("Entrenching", (s) => {
      Object.assign(s.seats[0]!.minions[0]!, { blood: 4, capacity: 10 });
    });
    resolve(engine, "Entrenching");
    expect(state.seats[0]!.minions[0]!.blood).toBe(8);
  });

  it("NEGATIVE SPACE: pays nothing at 3 — the boundary", () => {
    // The card is still playable and the action still succeeds; it just
    // does nothing, which is what "if" means.
    const { state, engine } = game("Entrenching", (s) => {
      Object.assign(s.seats[0]!.minions[0]!, { blood: 3, capacity: 10 });
    });
    resolve(engine, "Entrenching");
    expect(state.seats[0]!.minions[0]!.blood).toBe(3);
  });
});

describe("the admission path (§6)", () => {
  const reg = registry as unknown as CardRegistry;

  it("all four are in the pool, implemented, and named as printed", () => {
    const wrong = WAVE.filter(([id, name]) => {
      const e = reg.entries[id];
      return !e || !e.supported || e.card.name !== name;
    });
    expect(wrong.map(([id, name]) => `${name} (${id})`)).toEqual([]);
  });
});
