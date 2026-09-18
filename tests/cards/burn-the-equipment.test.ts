/**
 * Burn the equipment (docs/burn-the-equipment-design.md).
 *
 * Blood Tears of Kephran (100212), Mummy's Tongue (101252), Vial of Elder
 * Vitae (102114) — three equipment cards whose price is the card itself.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { DISCIPLINES, VtesEngine } from "../../src/engine/index.ts";
import { disciplinesOf } from "../../src/engine/derived.ts";
import registry from "../../src/cards/registry.json" with { type: "json" };
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function equip(state: GameState, minionId: string, cardId: string, name: string): void {
  const h = testRegistry[name];
  if (!h) throw new Error(`no handler ${name}`);
  const e: PermanentInPlay = {
    card: { id: cardId, name },
    locked: false,
    usedThisPhase: false,
    statics: h.permanentStatics ?? {},
    tags: h.permanentTags ?? [],
  };
  find(state, minionId).attached.push(e);
}

function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

// ---------------------------------------------------------------------------
// §1 — Blood Tears of Kephran: one price, two windows
// ---------------------------------------------------------------------------

describe("Blood Tears of Kephran (100212)", () => {
  it("burns itself for 2 blood — and is withheld from a vampire at capacity", () => {
    const state = threeSeatGame();
    equip(state, "V1", "btk", "Blood Tears of Kephran");
    const engine = new VtesEngine(state, testRegistry);
    const id = "ability:Blood Tears of Kephran:btk:burnblood";
    expect(ids(engine)).toContain(id);
    const before = find(engine.state, "V1").blood;
    runTrace(engine, [["Alice", id]]);
    expect(find(engine.state, "V1").blood).toBe(before + 2);
    expect(find(engine.state, "V1").attached).toEqual([]);

    // NEGATIVE SPACE: full is not offered the option at all — "ignore
    // excess blood" is what happens, not a reason to ask.
    const full = threeSeatGame();
    find(full, "V1").blood = find(full, "V1").capacity;
    equip(full, "V1", "btk", "Blood Tears of Kephran");
    expect(ids(new VtesEngine(full, testRegistry))).not.toContain(id);
  });
});

// ---------------------------------------------------------------------------
// §2 — Mummy's Tongue
// ---------------------------------------------------------------------------

describe("Mummy's Tongue (101252)", () => {
  it("locks any vampire in the master phase, and bars their next unlock", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn frame");
    tf.phase = "master";
    equip(state, "V1", "mt", "Mummy's Tongue");
    const engine = new VtesEngine(state, testRegistry);
    // "Any vampire" reaches across the table; an already-locked one is not
    // offered, since there is nothing left to lock.
    expect(ids(engine)).toContain("ability:Mummy's Tongue:mt:lockvamp:W");
    find(engine.state, "M").locked = true;
    expect(ids(engine)).not.toContain("ability:Mummy's Tongue:mt:lockvamp:M");

    runTrace(engine, [["Alice", "ability:Mummy's Tongue:mt:lockvamp:W"]]);
    expect(find(engine.state, "W").locked).toBe(true);
    expect(find(engine.state, "W").skipNextUnlock).toBe(true);
    expect(find(engine.state, "V1").attached).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3 — Vial of Elder Vitae, and the Discipline vocabulary
// ---------------------------------------------------------------------------

describe("Vial of Elder Vitae (102114)", () => {
  it("gives +1 level of a chosen Discipline, and never one already superior", () => {
    const state = threeSeatGame();
    find(state, "V1").disciplines = { dom: "superior", aus: "basic" };
    equip(state, "V1", "vial", "Vial of Elder Vitae");
    const engine = new VtesEngine(state, testRegistry);
    const offered = ids(engine).filter((i) => i.includes("Vial of Elder Vitae"));
    // NEGATIVE SPACE: superior Dominate disqualifies itself; basic Auspex
    // does not, because a basic can still go up.
    expect(offered).not.toContain("ability:Vial of Elder Vitae:vial:disc:dom");
    expect(offered).toContain("ability:Vial of Elder Vitae:vial:disc:aus");

    runTrace(engine, [["Alice", "ability:Vial of Elder Vitae:vial:disc:aus"]]);
    expect(disciplinesOf(find(engine.state, "V1"))["aus"]).toBe("superior");
    expect(find(engine.state, "V1").attached).toEqual([]);

    // "Until YOUR next unlock phase": the sweep clears it, card long gone.
    delete find(engine.state, "V1").disciplineBoostUntilUnlock;
    expect(disciplinesOf(find(engine.state, "V1"))["aus"]).toBe("basic");
  });

  it("DISCIPLINES names every Discipline the pool actually uses", () => {
    // The `CLANS` drift guard in a new place: a vampire HAS Disciplines
    // and a library card REQUIRES them, and the two sets agreeing today is
    // not a reason for either to go unasserted.
    const onVampires = new Set<string>();
    const onLibrary = new Set<string>();
    for (const key of Object.keys(registry.entries)) {
      const card = (registry.entries as Record<string, { card?: { disciplines?: unknown } }>)[
        key
      ]?.card;
      const d = card?.disciplines;
      if (Array.isArray(d)) for (const x of d) onLibrary.add(String(x).toLowerCase());
      else if (d && typeof d === "object") {
        for (const x of Object.keys(d)) onVampires.add(x.toLowerCase());
      }
    }
    expect([...onVampires].sort()).toEqual([...DISCIPLINES].sort());
    expect([...onLibrary].sort()).toEqual([...DISCIPLINES].sort());
  });
});
