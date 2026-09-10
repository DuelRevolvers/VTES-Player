/**
 * Legacy action cards — tranche 3 wave 11
 * (docs/pool-widening-design.md §6).
 *
 * Computer Hacking, Vermin Channel, Art Scam, Dark Mirror of the Mind,
 * Kindred Intelligence, Forgery.
 *
 * These are numbers on a card — a stealth amount, a bleed bonus, a pool
 * payout — and a number that never reaches the table is the quietest
 * failure there is. Every one of them is asserted through a real action
 * rather than against its spec.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";

const WAVE: Array<[number, string]> = [
  [100390, "Computer Hacking"],
  [102112, "Vermin Channel"],
  [100099, "Art Scam"],
  [100494, "Dark Mirror of the Mind"],
  [101050, "Kindred Intelligence"],
  [100768, "Forgery"],
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

/** Play the named action and carry it through to resolution, unblocked. */
function resolve(engine: VtesEngine, name: string): void {
  const opt = ids(engine).find((o) => o.startsWith(`play:${name}`));
  if (!opt) throw new Error(`${name} not offered: ${ids(engine).join(", ")}`);
  runTrace(engine, [
    ["Alice", opt],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A → unblocked
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
  ]);
}

describe("the bleeds", () => {
  it("Computer Hacking (100390) bleeds for 2 — 1 base plus its bonus", () => {
    const { state, engine } = game("Computer Hacking");
    resolve(engine, "Computer Hacking");
    expect(state.seats[1]!.pool).toBe(8);
  });

  it("Vermin Channel (102112) bleeds for 1 but at +3 stealth", () => {
    // The trade the card makes, and the half a copy-paste bonus would
    // lose: a lot of stealth and NO bleed bonus.
    const { state, engine } = game("Vermin Channel");
    const opt = ids(engine).find((o) => o.startsWith("play:Vermin Channel"))!;
    runTrace(engine, [
      ["Alice", opt],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    const stealth = state.eventLog.filter((e) => e.type === "StealthModified");
    expect(stealth.some((e) => e.type === "StealthModified" && e.delta === 3)).toBe(true);
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.seats[1]!.pool).toBe(9); // 1 bleed, not 2
  });

  it("Forgery (100768) bleeds for 1 and pays the actor 1 blood on success", () => {
    const { state, engine } = game("Forgery", (s) => {
      s.seats[0]!.minions[0]!.capacity = 5;
    });
    resolve(engine, "Forgery");
    expect(state.seats[1]!.pool).toBe(9);
    expect(state.seats[0]!.minions[0]!.blood).toBe(4); // 3 + 1
  });

  it("NEGATIVE SPACE: Forgery is not offered below capacity 5", () => {
    const { state, engine } = game("Forgery", (s) => {
      s.seats[0]!.minions[0]!.capacity = 4;
    });
    expect(ids(engine).some((o) => o.startsWith("play:Forgery"))).toBe(false);
    // …and IS at 5, so the line above is the requirement rather than the
    // card being missing.
    state.seats[0]!.minions[0]!.capacity = 5;
    expect(
      new VtesEngine(state, testRegistry)
        .decision()!
        .options.some((o) => o.id.startsWith("play:Forgery")),
    ).toBe(true);
  });
});

describe("the pool payouts", () => {
  it("Art Scam (100099) gains 2 pool", () => {
    const { state, engine } = game("Art Scam");
    resolve(engine, "Art Scam");
    expect(state.seats[0]!.pool).toBe(12);
  });

  it("Dark Mirror of the Mind (100494) is Art Scam behind a capacity gate", () => {
    const { state, engine } = game("Dark Mirror of the Mind", (s) => {
      s.seats[0]!.minions[0]!.capacity = 8;
    });
    resolve(engine, "Dark Mirror of the Mind");
    expect(state.seats[0]!.pool).toBe(12);
  });

  it("NEGATIVE SPACE: capacity 7 is not 'capacity 8 or more'", () => {
    const { engine } = game("Dark Mirror of the Mind", (s) => {
      s.seats[0]!.minions[0]!.capacity = 7;
    });
    expect(ids(engine).some((o) => o.startsWith("play:Dark Mirror"))).toBe(false);
  });
});

describe("Kindred Intelligence (101050) — the crypt move", () => {
  it("moves the top crypt card to the uncontrolled region", () => {
    const { state, engine } = game("Kindred Intelligence", (s) => {
      s.seats[0]!.crypt.push(makeMinion("C1", "Alice"), makeMinion("C2", "Alice"));
    });
    resolve(engine, "Kindred Intelligence");
    expect(state.seats[0]!.uncontrolled.map((u) => u.card.id)).toEqual(["C1"]);
    expect(state.seats[0]!.crypt.map((c) => c.id)).toEqual(["C2"]);
  });

  it("is UNPLAYABLE on an empty crypt [RTR 20000501]", () => {
    // The same ruling Effective Management carries — one effect, one
    // gate, asserted on both sides of the card-type divide.
    const { state, engine } = game("Kindred Intelligence");
    expect(state.seats[0]!.crypt).toEqual([]);
    expect(ids(engine).some((o) => o.startsWith("play:Kindred Intelligence"))).toBe(false);
  });
});

describe("the admission path (§6)", () => {
  const reg = registry as unknown as CardRegistry;

  it("all six are in the pool, implemented, and named as printed", () => {
    const wrong = WAVE.filter(([id, name]) => {
      const e = reg.entries[id];
      return !e || !e.supported || e.card.name !== name;
    });
    expect(wrong.map(([id, name]) => `${name} (${id})`)).toEqual([]);
  });
});
