/**
 * Legacy retainers and allies — tranche 3 wave 4
 * (docs/pool-widening-design.md §6).
 *
 * Seven cards that are a life total and one static apiece. No new
 * vocabulary, which is exactly why the risk here is a spec that compiles
 * and does nothing: a wrong `retainerLife`, a missing static or a static
 * on the wrong side all look like a card that is simply in play.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";

const RETAINERS: Array<[number, string]> = [
  [101015, "J. S. Simmons, Esq."],
  [101943, "Tasha Morgan"],
  [101018, "Jackie Therman"],
  [100338, "Childling Muse"],
];
const ALLIES: Array<[number, string]> = [
  [101129, "Loyal Street Gang"],
  [101063, "The Knights"],
  [100875, "Gypsies"],
];

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Employ a spec-compiled retainer, statics and tags from the REGISTRY —
 *  so a spec that forgot a static fails here rather than being papered
 *  over by a hand-written fixture. */
function employ(state: GameState, minion: string, id: string, name: string): PermanentInPlay {
  const h = testRegistry[name];
  if (!h) throw new Error(`${name} has no handler — is it in supported.json?`);
  const p: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h.permanentStatics ?? {},
    tags: h.permanentTags ?? [],
    life: 1,
  };
  find(state, minion).attached.push(p);
  return p;
}

/** V1 bleeds Bob unopposed; returns Bob's pool afterwards. */
function bleedOnce(state: GameState): number {
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A → unblocked
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
  ]);
  return state.seats[1]!.pool;
}

describe("the +1 bleed retainers", () => {
  for (const name of ["J. S. Simmons, Esq.", "Tasha Morgan", "Childling Muse"]) {
    it(`${name} raises the employer's bleed`, () => {
      const state = threeSeatGame();
      employ(state, "V1", "r1", name);
      expect(bleedOnce(state)).toBe(8); // 10 − 2, not 10 − 1
    });
  }

  it("NEGATIVE SPACE: an unequipped V1 still bleeds for 1", () => {
    // The control. Without it, a fixture that bled for 2 by some other
    // route would make all three tests above meaningless.
    expect(bleedOnce(threeSeatGame())).toBe(9);
  });
});

describe("Jackie Therman (101018) — an optional maneuver each combat", () => {
  it("puts a real maneuver credit on the table", () => {
    const state = threeSeatGame();
    employ(state, "V1", "jt", "Jackie Therman");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce → A
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block → combat
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
    ]);
    expect(engine.decision()!.options.map((o) => o.id)).toContain("maneuver:credit");
  });
});

describe("Childling Muse (100338) — requires a Malkavian", () => {
  it("is not offered to a vampire of another clan", () => {
    // `requiresClan` is the third instance of the `meetsRequirements`
    // bug's shape: an unenforced requirement offers the card to everyone
    // and nothing complains.
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.clan = "Brujah";
    state.seats[0]!.hand.push({ id: "cm1", name: "Childling Muse" });
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((o) => o.startsWith("play:Childling Muse"))).toBe(false);
  });

  it("…and IS offered to a Malkavian — the control", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.clan = "Malkavian";
    state.seats[0]!.hand.push({ id: "cm1", name: "Childling Muse" });
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((o) => o.startsWith("play:Childling Muse"))).toBe(true);
  });

  it("REGRESSION: the same gate was missing for the V5 cards too", () => {
    // The bug this wave found. `permanentActionOptions` — the shared
    // recruit-ally / employ-retainer enumerator — never called
    // `meetsRequirements`, so every clan- and sect-gated ally and
    // retainer already in the pool was offered to any minion at all.
    // Szlachta Bodyguard requires a Tzimisce; V1 is not one.
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.clan = "Brujah";
    state.seats[0]!.hand.push({ id: "sb1", name: "Szlachta Bodyguard" });
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((o) => o.startsWith("play:Szlachta Bodyguard"))).toBe(false);

    state.seats[0]!.minions[0]!.clan = "Tzimisce";
    const after = new VtesEngine(state, testRegistry).decision()!.options.map((o) => o.id);
    expect(after.some((o) => o.startsWith("play:Szlachta Bodyguard"))).toBe(true);
  });
});

describe("the legacy allies", () => {
  it("carry the statblock they print", () => {
    // Read through `allyEntry`, which is what actually builds the minion
    // — not off the spec, which would only assert that I typed what I
    // typed.
    expect(testRegistry["Loyal Street Gang"]?.allyEntry?.("basic")).toMatchObject({
      life: 2,
      strength: 1,
      bleed: 0,
    });
    expect(testRegistry["The Knights"]?.allyEntry?.("basic")).toMatchObject({
      life: 2,
      strength: 2,
      bleed: 0,
    });
    expect(testRegistry["Gypsies"]?.allyEntry?.("basic")).toMatchObject({
      life: 1,
      strength: 1,
      bleed: 1,
    });
  });

  it("Gypsies get +1 stealth on their own actions", () => {
    expect(testRegistry["Gypsies"]?.permanentStatics?.stealth).toBe(1);
    // …and the other two do NOT, so the line above is reading the spec
    // rather than a default.
    expect(testRegistry["The Knights"]?.permanentStatics?.stealth).toBeUndefined();
  });
});

describe("the admission path (§6)", () => {
  const reg = registry as unknown as CardRegistry;

  it("all seven are in the pool, implemented, and named exactly as printed", () => {
    const wrong = [...RETAINERS, ...ALLIES].filter(([id, name]) => {
      const e = reg.entries[id];
      return !e || !e.supported || e.card.name !== name;
    });
    expect(wrong.map(([id, name]) => `${name} (${id})`)).toEqual([]);
  });
});
