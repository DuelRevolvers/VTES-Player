/**
 * Legacy equipment statics — tranche 3 wave 3
 * (docs/pool-widening-design.md §6).
 *
 * Seven cards whose whole printed text is a standing property of whoever
 * carries them. There is nothing to use and nothing to decide, which is
 * exactly why they need testing: a static that is never read produces no
 * error, no option and no event — the card simply does nothing, and the
 * table looks normal.
 *
 * Three of them needed one new knob each, and those are the ones with a
 * negative-space partner below: `statics.hunt`, `cannotBeBlockedBy.
 * minCapacity` and `cannotBeBlockedBy.clans`.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, huntAmountFor } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";

const WAVE: Array<[number, string]> = [
  [100003, "Aaron's Feeding Razor"],
  [101007, "IR Goggles"],
  [100898, "Hawg"],
  [101073, "Laptop Computer"],
  [101670, "Sacré-Cœur Cathedral, France"],
  [101781, "The Signet of King Saul"],
  [100361, "Cloak of the Abalone"],
];

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Attach a spec-compiled equipment card, statics and tags and all — the
 *  statics come from the REGISTRY, so a spec that forgot one fails here
 *  rather than being papered over by a hand-written fixture. */
function equip(state: GameState, minion: string, id: string, name: string): PermanentInPlay {
  const h = testRegistry[name];
  if (!h) throw new Error(`${name} has no handler — is it in supported.json?`);
  const p: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h.permanentStatics ?? {},
    tags: h.permanentTags ?? [],
  };
  find(state, minion).attached.push(p);
  return p;
}

// --- the bearer bonuses ----------------------------------------------------

describe("Aaron's Feeding Razor (100003) — +1 hunt", () => {
  it("raises the hunt amount for its bearer", () => {
    const state = threeSeatGame();
    expect(huntAmountFor(state, find(state, "V1"))).toBe(1);
    equip(state, "V1", "afr", "Aaron's Feeding Razor");
    expect(huntAmountFor(state, find(state, "V1"))).toBe(2);
  });

  it("NEGATIVE SPACE: and for NOBODY else", () => {
    // The reason this is a bearer static and not an aura. `auraBonus`
    // scans attached cards too, so an unfiltered aura on a piece of
    // equipment would quietly feed every minion at the table.
    const state = threeSeatGame();
    equip(state, "V1", "afr", "Aaron's Feeding Razor");
    expect(huntAmountFor(state, find(state, "M"))).toBe(1);
    expect(huntAmountFor(state, find(state, "N"))).toBe(1);
  });

  it("actually puts the extra blood on, end to end", () => {
    const state = threeSeatGame();
    find(state, "V1").blood = 1;
    equip(state, "V1", "afr", "Aaron's Feeding Razor");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A → unblocked
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
    ]);
    expect(find(state, "V1").blood).toBe(3); // 1 + 2, not 1 + 1
  });
});

describe("the per-combat credits", () => {
  it("IR Goggles (101007) grants a maneuver, Hawg (100898) a press", () => {
    // Both are plain seat-visible statics with existing readers; what is
    // worth pinning is that the SPEC carries them, since a spec with an
    // empty `statics` compiles and installs happily.
    expect(testRegistry["IR Goggles"]?.permanentStatics?.maneuverPerCombat).toBe(1);
    expect(testRegistry["Hawg"]?.permanentStatics?.pressPerCombat).toBe(1);
  });

  it("IR Goggles puts a real maneuver on the table", () => {
    const state = threeSeatGame();
    equip(state, "V1", "irg", "IR Goggles");
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

  it("Hawg is a VEHICLE, so a minion cannot take a second one", () => {
    // BEHAVIOUR, not the tag. The limit is enforced centrally in
    // `compileEquipment`, and asserting only the tag would pass even if
    // that enforcement were deleted.
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "h1", name: "Hawg" });
    const before = new VtesEngine(state, testRegistry).decision()!.options.map((o) => o.id);
    expect(before.some((o) => o.startsWith("play:Hawg"))).toBe(true);

    equip(state, "V1", "h0", "Hawg"); // already riding one
    const after = new VtesEngine(state, testRegistry).decision()!.options.map((o) => o.id);
    expect(after.some((o) => o.startsWith("play:Hawg:") && o.endsWith(":h1"))).toBe(false);
  });
});

describe("Laptop Computer (101073) — +1 bleed, one per minion", () => {
  it("raises the bleed", () => {
    const state = threeSeatGame();
    equip(state, "V1", "lap", "Laptop Computer");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A → unblocked
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
    ]);
    expect(state.seats[1]!.pool).toBe(8); // 10 − 2, not 10 − 1
  });

  it("is NOT unique — the limit is per minion, not per Methuselah", () => {
    // Two claims that look alike. `unique` would stop a second copy
    // reaching the TABLE; `exclusiveKey` stops a second copy reaching the
    // same MINION, which is what the card says. Both halves asserted as
    // behaviour: barred on the bearer, still offered to another minion.
    const state = threeSeatGame();
    state.seats[0]!.minions.push(makeMinion("V2", "Alice"));
    state.seats[0]!.hand.push({ id: "l1", name: "Laptop Computer" });
    equip(state, "V1", "l0", "Laptop Computer");
    const ids = new VtesEngine(state, testRegistry).decision()!.options.map((o) => o.id);
    expect(ids.some((o) => o.startsWith("play:Laptop Computer:basic:V1"))).toBe(false);
    expect(ids.some((o) => o.startsWith("play:Laptop Computer:basic:V2"))).toBe(true);
  });
});

// --- the block bars --------------------------------------------------------

/** Alice's V1 bleeds; stop where Bob is deciding whether to block. */
function toBlockDecision(state: GameState): VtesEngine {
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce → A
    ["Alice", "pass"],
  ]);
  return engine;
}

/** Can Bob still attempt the block with M? */
function bobCanBlock(engine: VtesEngine): boolean {
  return (engine.decision()?.options ?? []).some((o) => o.id === "block:M");
}

describe("The Signet of King Saul (101781) — capacity 8+ cannot block", () => {
  it("bars a capacity-8 blocker", () => {
    const state = threeSeatGame();
    find(state, "M").capacity = 8;
    equip(state, "V1", "sks", "The Signet of King Saul");
    expect(bobCanBlock(toBlockDecision(state))).toBe(false);
  });

  it("NEGATIVE SPACE: leaves a capacity-7 blocker alone", () => {
    // The boundary, and the control: without it, a bar that stopped
    // EVERYONE would pass the test above.
    const state = threeSeatGame();
    find(state, "M").capacity = 7;
    equip(state, "V1", "sks", "The Signet of King Saul");
    expect(bobCanBlock(toBlockDecision(state))).toBe(true);
  });
});

describe("Cloak of the Abalone (100361) — Toreador cannot block", () => {
  it("bars a Toreador blocker", () => {
    const state = threeSeatGame();
    find(state, "M").clan = "Toreador";
    equip(state, "V1", "cka", "Cloak of the Abalone");
    expect(bobCanBlock(toBlockDecision(state))).toBe(false);
  });

  it("NEGATIVE SPACE: leaves every other clan alone", () => {
    const state = threeSeatGame();
    find(state, "M").clan = "Brujah";
    equip(state, "V1", "cka", "Cloak of the Abalone");
    expect(bobCanBlock(toBlockDecision(state))).toBe(true);
  });

  it("does not choke on an ALLY, which has no clan at all", () => {
    // `MinionState.clan` is nullable and a clan bar is the first thing to
    // read it against a list. A null slipping into `includes` would be a
    // silent false rather than a crash, so this is pinned deliberately.
    const state = threeSeatGame();
    const m = find(state, "M");
    m.clan = null;
    m.kind = "ally";
    equip(state, "V1", "cka", "Cloak of the Abalone");
    expect(bobCanBlock(toBlockDecision(state))).toBe(true);
  });
});

describe("Sacré-Cœur Cathedral, France (101670) — allies cannot block", () => {
  it("bars an ALLY blocker", () => {
    const state = threeSeatGame();
    const m = find(state, "M");
    m.kind = "ally";
    m.clan = null;
    equip(state, "V1", "scc", "Sacré-Cœur Cathedral, France");
    expect(bobCanBlock(toBlockDecision(state))).toBe(false);
  });

  it("NEGATIVE SPACE: leaves a VAMPIRE blocker alone", () => {
    const state = threeSeatGame();
    equip(state, "V1", "scc", "Sacré-Cœur Cathedral, France");
    expect(bobCanBlock(toBlockDecision(state))).toBe(true);
  });

  it("does not count as equipment while in play", () => {
    // The Living Manse opt-out, printed on the card. A card that punishes
    // or burns equipment must not see this one.
    const tags = testRegistry["Sacré-Cœur Cathedral, France"]?.permanentTags ?? [];
    expect(tags).not.toContain("equipment");
    expect(tags).toContain("location");
  });
});

// --- admission -------------------------------------------------------------

describe("the admission path (§6)", () => {
  const reg = registry as unknown as CardRegistry;

  it("all seven are in the pool, implemented, and named exactly as printed", () => {
    const wrong = WAVE.filter(([id, name]) => {
      const e = reg.entries[id];
      return !e || !e.supported || e.card.name !== name;
    });
    expect(wrong.map(([id, name]) => `${name} (${id})`)).toEqual([]);
  });
});
