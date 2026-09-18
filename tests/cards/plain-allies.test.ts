/**
 * Plain allies (docs/plain-allies-design.md, tranche 1 wave 45).
 *
 * The Slashers (101799), Outcast Mage (101337), Rafastio Ghoul (101537),
 * Procurer (101491), Muddled Vampire Hunter (101250).
 *
 * The wave that landed the CLAN ICON as a requirement (p. 10), so the
 * recruit gate is asserted for every card that prints one, and its
 * negative space for the one that does not.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, currentStealth } from "../../src/engine/index.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** An ally in play with its own self-attached entry, statics from the registry. */
function allyInPlay(state: GameState, seat: string, id: string, name: string, life: number): MinionState {
  const stats = testRegistry[name]?.allyEntry?.(null);
  const self: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: stats?.statics ?? {},
    tags: stats?.tags ?? [],
  };
  const m = makeAlly(id, seat, life, { name, attached: [self] });
  if (stats?.disciplines) m.disciplines = { ...stats.disciplines };
  state.seats.find((s) => s.id === seat)!.minions.push(m);
  return m;
}

function ids(engine: VtesEngine): string[] {
  return (engine.decision()?.options ?? []).map((o) => o.id);
}

function walkTo(engine: VtesEngine, prefix: string, limit = 40): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
  }
  return false;
}

function settle(engine: VtesEngine, state: GameState): void {
  for (let i = 0; i < 40; i++) {
    if (!state.frames.some((f) => f.kind === "action")) return;
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

/** Alice bleeds; Bob's ally `id` blocks; the ally is asked for a strike. */
function allyBlocks(name: string, id: string, life: number): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  find(state, "V1").blood = 4;
  allyInPlay(state, "Bob", id, name, life);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", `block:${id}`],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block → combat
  ]);
  return { state, engine };
}

// ---------------------------------------------------------------------------

describe("the clan icon is a requirement (p. 10)", () => {
  const gated: Array<[string, string]> = [
    ["The Slashers", "Brujah"],
    ["Outcast Mage", "Tremere"],
    ["Muddled Vampire Hunter", "Malkavian"],
  ];
  for (const [name, clan] of gated) {
    it(`${name} is recruited by a ${clan} and by nobody else`, () => {
      const state = threeSeatGame();
      state.seats[0]!.hand.push({ id: "c", name });
      Object.assign(find(state, "V1"), { blood: 4, clan });
      expect(ids(new VtesEngine(state, testRegistry)).some((o) => o.startsWith(`play:${name}`))).toBe(true);
      find(state, "V1").clan = "Ventrue";
      expect(ids(new VtesEngine(state, testRegistry)).some((o) => o.startsWith(`play:${name}`))).toBe(false);
    });
  }

  it("NEGATIVE SPACE: Rafastio Ghoul prints no icon, so a clanless vampire recruits it", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "c", name: "Rafastio Ghoul" });
    expect(ids(new VtesEngine(state, testRegistry)).some((o) => o.startsWith("play:Rafastio Ghoul"))).toBe(true);
  });
});

describe("The Slashers (101799) and Outcast Mage (101337) — the printed strike", () => {
  it("The Slashers strike for 1R", () => {
    const { engine } = allyBlocks("The Slashers", "sl", 3);
    expect(walkTo(engine, "ability:The Slashers:sl:strike")).toBe(true);
  });

  it("Outcast Mage strikes for 2R and carries one maneuver each combat", () => {
    const { engine } = allyBlocks("Outcast Mage", "om", 2);
    expect(walkTo(engine, "ability:Outcast Mage:om:strike")).toBe(true);
    expect(testRegistry["Outcast Mage"]!.allyEntry!(null).statics.maneuverPerCombat).toBe(1);
  });
});

describe("Rafastio Ghoul (101537)", () => {
  it("plays cards requiring basic Blood Sorcery as a vampire", () => {
    expect(testRegistry["Rafastio Ghoul"]!.allyEntry!(null).disciplines).toEqual({ tha: "basic" });
    expect(testRegistry["Rafastio Ghoul"]!.permanentTags).toContain("ghoul");
  });
});

describe("Procurer (101491)", () => {
  it("moves 1 blood from the bank to a ready VAMPIRE you control, at +2 stealth", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 2, capacity: 4 });
    allyInPlay(state, "Alice", "pr", "Procurer", 1);
    allyInPlay(state, "Alice", "A9", "Rafastio Ghoul", 2);
    find(state, "A9").blood = 1; // an ally short of its life is NOT a legal target
    const engine = new VtesEngine(state, testRegistry);
    const acts = ids(engine).filter((o) => o.startsWith("act:Procurer:pr"));
    expect(acts.some((o) => o.includes("blood:V1"))).toBe(true);
    expect(acts.some((o) => o.includes("blood:A9"))).toBe(false);
    runTrace(engine, [["Alice", acts.find((o) => o.includes("blood:V1"))!]]);
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action");
    expect(currentStealth(state, af.actionId)).toBe(2);
    settle(engine, state);
    expect(find(state, "V1").blood).toBe(3);
  });
});

describe("Muddled Vampire Hunter (101250)", () => {
  it("rushes ready vampires of OTHER Methuselahs only, and strikes first", () => {
    const state = threeSeatGame();
    allyInPlay(state, "Alice", "mv", "Muddled Vampire Hunter", 1);
    state.seats[1]!.minions.push(makeAlly("BA", "Bob", 2));
    const engine = new VtesEngine(state, testRegistry);
    const rushes = ids(engine).filter((o) => o.startsWith("act:Muddled Vampire Hunter:mv"));
    // Not V1 (his own controller's), not BA (an ally).
    expect(rushes.sort()).toEqual([
      "act:Muddled Vampire Hunter:mv:M",
      "act:Muddled Vampire Hunter:mv:N",
      "act:Muddled Vampire Hunter:mv:W",
    ]);
    expect(testRegistry["Muddled Vampire Hunter"]!.allyEntry!(null).statics.firstStrike).toBe(true);
  });
});
