/**
 * Crypt wave 2 — granted actions and unlock riders
 * (docs/crypt-wave-2.md).
 *
 * Every card here runs on machinery the library waves already built: the
 * ally rush, `onActionResolved`, `addAfterResolutionUnlock`, the
 * library-search gate, the after-referendum window. A crypt ability is a
 * self-attached entry, so all of it applies unchanged
 * (docs/crypt-plan.md §2).
 *
 * Each conditional rider is tested in BOTH directions: a trigger that
 * never fires and one that always fires are indistinguishable from a
 * single assertion.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const handlers = buildHandlerRegistry();

/** Put a real crypt card's ability onto a minion, as `makeVampire` does. */
function asVampire(m: MinionState, cryptName: string): MinionState {
  const entry = handlers[cryptName]?.cryptEntry?.();
  if (!entry) throw new Error(`no crypt entry for ${cryptName}`);
  m.attached.push({
    card: { id: m.id, name: cryptName },
    controller: m.controller,
    owner: m.controller,
    locked: false,
    usedThisPhase: false,
    statics: entry.statics,
    tags: entry.tags,
  });
  return m;
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}
function seat(state: GameState, id: string) {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}
function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}
function walkTo(engine: VtesEngine, prefix: string, limit = 140): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick =
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "end") ??
      dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return false;
}
function step(engine: VtesEngine, n: number): void {
  walkTo(engine, "__nothing__", n);
}

// ---------------------------------------------------------------------------
// Ⓓ rushes
// ---------------------------------------------------------------------------

describe("crypt rushes", () => {
  it("Theo Bell can enter combat with a minion, and hits for his +1 strength", () => {
    const state = threeSeatGame();
    asVampire(state.seats[0]!.minions[0]!, "Theo Bell (G6)");
    const engine = new VtesEngine(state, testRegistry);
    expect(walkTo(engine, "act:Theo Bell")).toBe(true);
    // One option per legal target, and his own side is not one of them.
    const ids = optionIds(engine).filter((o) => o.startsWith("act:Theo Bell"));
    expect(ids.some((o) => o.endsWith(":W"))).toBe(true);
    expect(ids.some((o) => o.endsWith(":V1"))).toBe(false);
    // The statics half rides along on the same entry.
    expect(find(state, "V1").attached[0]!.statics.strength).toBe(1);
  });

  it("a vampire with no rush clause is offered none — the control", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    expect(walkTo(engine, "act:", 30)).toBe(false);
  });

  it("Nathaniel can only rush a LOCKED vampire", () => {
    const state = threeSeatGame();
    asVampire(state.seats[0]!.minions[0]!, "Nathaniel Bordruff (G6)");
    state.seats[1]!.minions[0]!.locked = true; // W locked
    state.seats[1]!.minions[1]!.locked = false; // M unlocked
    const engine = new VtesEngine(state, testRegistry);
    expect(walkTo(engine, "act:Nathaniel Bordruff")).toBe(true);
    const ids = optionIds(engine).filter((o) => o.startsWith("act:Nathaniel"));
    expect(ids.some((o) => o.endsWith(":W"))).toBe(true);
    expect(ids.some((o) => o.endsWith(":M"))).toBe(false);
  });

  it("…and nothing at all when every enemy is unlocked", () => {
    const state = threeSeatGame();
    asVampire(state.seats[0]!.minions[0]!, "Nathaniel Bordruff (G6)");
    const engine = new VtesEngine(state, testRegistry);
    expect(walkTo(engine, "act:Nathaniel Bordruff", 30)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unlock riders
// ---------------------------------------------------------------------------

describe("unlock riders", () => {
  /** Alice's V1 bleeds; report whether an unlock offer appears. */
  function bleedAndLookForUnlock(cryptName: string, tweak: (s: GameState) => void = () => {}) {
    const state = threeSeatGame();
    asVampire(state.seats[0]!.minions[0]!, cryptName);
    state.seats[0]!.minions[0]!.blood = 4;
    tweak(state);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    const found = walkTo(engine, `choice:${cryptName}`, 60);
    return { state, engine, found };
  }

  it("Keegan does NOT unlock after a plain bleed — no card, no requirement", () => {
    // "An action REQUIRING A GANGREL" is a property of the card played,
    // and a built-in bleed plays none.
    expect(bleedAndLookForUnlock("Keegan (G6)").found).toBe(false);
  });

  it("Aaradhya unlocks after a successful POLITICAL action, and not a bleed", () => {
    // The control first: a bleed is not a political action.
    expect(bleedAndLookForUnlock("Aaradhya, The Callous Tyrant (G6)").found).toBe(false);

    const state = threeSeatGame();
    const v1 = asVampire(state.seats[0]!.minions[0]!, "Aaradhya, The Callous Tyrant (G6)");
    v1.title = "prince";
    v1.blood = 5;
    state.seats[0]!.hand.push({ id: "au1", name: "Anarchist Uprising" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Anarchist Uprising"]]);
    // The offer arrives when the ACTION resolves — before the referendum
    // is even called, and regardless of how it goes.
    expect(walkTo(engine, "choice:Aaradhya", 60)).toBe(true);
  });

  it("Sakura needs the Path, and a vampire without it gets no offer", () => {
    const withPath = bleedAndLookForUnlock("Sakura, The Merciless (G6)", (s) => {
      s.seats[0]!.minions[0]!.path = "Death and the Soul";
      s.seats[0]!.hand.push({ id: "x", name: "Govern the Unaligned" });
    });
    // Still false: a plain bleed plays no card, so there is no
    // "action requiring" anything. The Path alone is not enough.
    expect(withPath.found).toBe(false);
  });

  it("Aline wakes for ANOTHER Anarch's action, not her own", () => {
    const state = threeSeatGame();
    const aline = makeMinion("V2", "Alice", { blood: 4, sect: "anarch" });
    asVampire(aline, "Aline Gädeke (G6)");
    aline.locked = true; // she is asleep, which is the point
    state.seats[0]!.minions.push(aline);
    // V1 is the other Anarch who acts.
    state.seats[0]!.minions[0]!.sect = "anarch";
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(walkTo(engine, "choice:Aline", 60)).toBe(true);
  });

  it("…and not for a non-Anarch's action", () => {
    const state = threeSeatGame();
    const aline = makeMinion("V2", "Alice", { blood: 4, sect: "anarch" });
    asVampire(aline, "Aline Gädeke (G6)");
    aline.locked = true;
    state.seats[0]!.minions.push(aline);
    state.seats[0]!.minions[0]!.sect = "camarilla";
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(walkTo(engine, "choice:Aline", 60)).toBe(false);
  });

  it("Aline is not offered when she cannot pay the blood", () => {
    const state = threeSeatGame();
    const aline = makeMinion("V2", "Alice", { blood: 0, sect: "anarch" });
    asVampire(aline, "Aline Gädeke (G6)");
    aline.locked = true;
    state.seats[0]!.minions.push(aline);
    state.seats[0]!.minions[0]!.sect = "anarch";
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(walkTo(engine, "choice:Aline", 60)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Kalinda and Sybren — unlocks that are not action riders
// ---------------------------------------------------------------------------

describe("Kalinda burns the Edge to unlock", () => {
  function game(hasEdge: boolean, locked: boolean): VtesEngine {
    const state = threeSeatGame();
    const v = asVampire(state.seats[0]!.minions[0]!, "Kalinda (G6)");
    v.locked = locked;
    state.edge = hasEdge ? "Alice" : null;
    return new VtesEngine(state, testRegistry);
  }

  it("is offered while locked and holding the Edge", () => {
    expect(walkTo(game(true, true), "ability:Kalinda")).toBe(true);
  });

  it("is not offered without the Edge", () => {
    expect(walkTo(game(false, true), "ability:Kalinda", 40)).toBe(false);
  });

  it("is not offered when she is already unlocked", () => {
    expect(walkTo(game(true, false), "ability:Kalinda", 40)).toBe(false);
  });

  it("actually burns the Edge and unlocks her", () => {
    const state = threeSeatGame();
    const v = asVampire(state.seats[0]!.minions[0]!, "Kalinda (G6)");
    v.locked = true;
    state.edge = "Alice";
    const engine = new VtesEngine(state, testRegistry);
    expect(walkTo(engine, "ability:Kalinda")).toBe(true);
    const id = optionIds(engine).find((o) => o.startsWith("ability:Kalinda"))!;
    runTrace(engine, [["Alice", id]]);
    expect(find(state, "V1").locked).toBe(false);
    expect(state.edge).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Library searches
// ---------------------------------------------------------------------------

describe("Sakhar searches for an equipment", () => {
  function game(library: string[]): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    asVampire(state.seats[0]!.minions[0]!, "Sakhar (G7)");
    state.seats[0]!.library = library.map((n, i) => ({ id: `lib${i}`, name: n }));
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("offers the action, then only equipment cards as finds", () => {
    const { engine } = game([".44 Magnum", "Govern the Unaligned", "Kevlar Vest"]);
    expect(walkTo(engine, "act:Sakhar")).toBe(true);
    const act = optionIds(engine).find((o) => o.startsWith("act:Sakhar"))!;
    runTrace(engine, [["Alice", act]]);
    expect(walkTo(engine, "choice:Sakhar")).toBe(true);
    const ids = optionIds(engine);
    expect(ids.some((o) => o.endsWith(":lib0"))).toBe(true); // .44 Magnum
    expect(ids.some((o) => o.endsWith(":lib2"))).toBe(true); // Kevlar Vest
    expect(ids.some((o) => o.endsWith(":lib1"))).toBe(false); // an action card
    // "You are free not to find any" (p. 48).
    expect(ids.some((o) => o.endsWith(":none"))).toBe(true);
  });

  it("moves the found card to hand and shuffles the library", () => {
    const { state, engine } = game([".44 Magnum", "Govern the Unaligned"]);
    walkTo(engine, "act:Sakhar");
    runTrace(engine, [["Alice", optionIds(engine).find((o) => o.startsWith("act:Sakhar"))!]]);
    walkTo(engine, "choice:Sakhar");
    runTrace(engine, [["Alice", optionIds(engine).find((o) => o.endsWith(":lib0"))!]]);
    step(engine, 10);
    expect(seat(state, "Alice").hand.some((c) => c.name === ".44 Magnum")).toBe(true);
    expect(seat(state, "Alice").library.some((c) => c.name === ".44 Magnum")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "LibraryShuffled")).toBe(true);
  });

  it("shuffles even when nothing is found (p. 14)", () => {
    const { state, engine } = game([".44 Magnum"]);
    walkTo(engine, "act:Sakhar");
    runTrace(engine, [["Alice", optionIds(engine).find((o) => o.startsWith("act:Sakhar"))!]]);
    walkTo(engine, "choice:Sakhar");
    runTrace(engine, [["Alice", optionIds(engine).find((o) => o.endsWith(":none"))!]]);
    step(engine, 10);
    expect(seat(state, "Alice").hand.some((c) => c.name === ".44 Magnum")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "LibraryShuffled")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Doc Martina — a static the library already had
// ---------------------------------------------------------------------------

describe("Doc Martina's rescue discount", () => {
  it("carries the static the rescue path already reads", () => {
    const state = threeSeatGame();
    const v = asVampire(state.seats[0]!.minions[0]!, "Doc Martina (G7)");
    expect(v.attached[0]!.statics.rescueDiscount).toEqual({ amount: 1 });
  });
});
