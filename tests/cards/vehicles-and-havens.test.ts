/**
 * Vehicles and havens (docs/vehicles-and-havens-design.md).
 *
 * Helicopter (100909), Delivery Truck (100520), Body Bag (100229) — three
 * equipment cards carrying "a minion may have only one <class>", the
 * first exclusivity class shared by cards of DIFFERENT names.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
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
// §1 — the exclusivity CLASS
// ---------------------------------------------------------------------------

describe("`a minion may have only one vehicle` (§1)", () => {
  it("NEGATIVE SPACE: a second vehicle of a DIFFERENT name is not offered", () => {
    const state = threeSeatGame();
    const seat = state.seats[0]!;
    seat.pool = 20;
    seat.hand = [{ id: "h1", name: "Helicopter" }];
    const with1 = new VtesEngine(state, testRegistry);
    expect(ids(with1).some((i) => i.startsWith("play:Helicopter"))).toBe(true);

    // A Delivery Truck already parked bars the Helicopter, and the key is
    // the CLASS, not the card name.
    equip(state, "V1", "dt", "Delivery Truck");
    expect(ids(new VtesEngine(state, testRegistry)).some((i) => i.startsWith("play:Helicopter"))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// §2 — Helicopter
// ---------------------------------------------------------------------------

describe("Helicopter (100909)", () => {
  it("comes into play LOCKED when equipped, and buys an unlock back", () => {
    const state = threeSeatGame();
    state.seats[0]!.pool = 20;
    state.seats[0]!.hand = [{ id: "h1", name: "Helicopter" }];
    const engine = new VtesEngine(state, testRegistry);
    const play = ids(engine).find((i) => i.startsWith("play:Helicopter"))!;
    runTrace(engine, [["Alice", play]]);
    // Walk the equip action out; nobody blocks.
    for (let i = 0; i < 24; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const heli = find(engine.state, "V1").attached.find((p) => p.card.name === "Helicopter");
      if (heli) break;
      engine.choose(dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id);
    }
    const heli = find(engine.state, "V1").attached.find((p) => p.card.name === "Helicopter");
    expect(heli?.locked).toBe(true);
  });

  it("NEGATIVE SPACE: a Helicopter already locked offers no unlock", () => {
    const state = threeSeatGame();
    equip(state, "V1", "h", "Helicopter");
    find(state, "V1").attached[0]!.locked = true;
    find(state, "V1").locked = true;
    const engine = new VtesEngine(state, testRegistry);
    expect(ids(engine).some((i) => i.includes("Helicopter"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3 — Body Bag: the sect is on the ABILITY, not on the card
// ---------------------------------------------------------------------------

describe("Body Bag (100229)", () => {
  /** Bob's W is bled at by Alice's V1 — a DIRECTED action is what the
   *  card asks for, so a rush is used rather than a bleed. */
  function setup(sect: "anarch" | "camarilla"): VtesEngine {
    const state = threeSeatGame();
    find(state, "W").sect = sect;
    find(state, "W").blood = 5;
    equip(state, "W", "bb", "Body Bag");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    return engine;
  }

  it("is equippable by anyone, but its ability asks the sect", () => {
    // The card itself carries no requirement — it still counts as a haven
    // on a Camarilla vampire [LSJ 20030607].
    const state = threeSeatGame();
    state.seats[0]!.pool = 20;
    state.seats[0]!.hand = [{ id: "b1", name: "Body Bag" }];
    find(state, "V1").sect = "camarilla";
    expect(
      ids(new VtesEngine(state, testRegistry)).some((i) => i.startsWith("play:Body Bag")),
    ).toBe(true);
  });

  /** A real Ⓓ action at W: Veneficorum's granted rush (wave 40), whose
   *  target is its own bearer — so W wears both cards and Alice's Tremere
   *  comes for it. */
  function directedAt(sect: "anarch" | "camarilla"): VtesEngine {
    const state = threeSeatGame();
    find(state, "V1").clan = "Tremere";
    find(state, "W").sect = sect;
    find(state, "W").blood = 5;
    equip(state, "W", "vas", "Veneficorum Artum Sanguis");
    equip(state, "W", "bb", "Body Bag");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "act:Veneficorum Artum Sanguis:vas:rush:V1:W"]]);
    return engine;
  }

  /** Walk the announce cycle to the defender's state-A impulse, which is
   *  where a reaction-shaped ability lives (the three-gates rule). */
  function walkTo(engine: VtesEngine, id: string): boolean {
    for (let i = 0; i < 12; i++) {
      const dp = engine.decision();
      if (!dp) return false;
      if (dp.options.some((o) => o.id === id)) return true;
      engine.choose(dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id);
    }
    return false;
  }

  it("burns 2 blood to fail a directed action — and only for an anarch", () => {
    const engine = directedAt("anarch");
    const id = "ability:Body Bag:bb:failaction";
    expect(walkTo(engine, id)).toBe(true);
    const before = find(engine.state, "W").blood;
    runTrace(engine, [["Bob", id]]);
    expect(find(engine.state, "W").blood).toBe(before - 2);
    expect(engine.state.frames.some((f) => f.kind === "combat")).toBe(false);

    // NEGATIVE SPACE: the same card on a Camarilla vampire is a haven and
    // nothing else [LSJ 20030607].
    expect(walkTo(directedAt("camarilla"), id)).toBe(false);
  });

  it("NEGATIVE SPACE: a bleed is directed at a SEAT, so it is not offered", () => {
    // The action names no minion, so "directed at him or her" is false —
    // even for an anarch with the blood to pay.
    expect(walkTo(setup("anarch"), "ability:Body Bag:bb:failaction")).toBe(false);
  });
});
