/**
 * The lock as a price (docs/lock-as-price-design.md).
 *
 * Elysium: Sforzesco Castle (100630), Elysium: The Arboretum (100631),
 * Powerbase: Savannah (101442), Atonement (100109).
 *
 * Blocking costs a lock (p. 25) and ending a combat from outside costs a
 * card's lock. These four move that price around: onto a card, onto ANOTHER
 * card, or off the table entirely. The assertions to care about are the ones
 * that show the price was actually paid by the thing that should pay it.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function inPlay(id: string, name: string, controller: string): PermanentInPlay {
  const h = testRegistry[name];
  if (!h) throw new Error(`no handler for ${name}`);
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: { ...(h.permanentStatics ?? {}) },
    tags: [...(h.permanentTags ?? [])],
    controller,
  };
}

/** Alice's V1 bleeds; Bob's M blocks. Stops with the block declared and not
 *  yet resolved — how far to walk from there is each test's business, since
 *  the window an ability appears in belongs to the engine. */
function blockedBleed(state: GameState): VtesEngine {
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "block:M"],
  ]);
  return engine;
}

/** Pass (never `options[0]`) until an option starting with `prefix` is on the
 *  table for whoever is asked, and return it. Null means it was offered to
 *  nobody before the combat ran out of windows — which is what the negative
 *  assertions here need: "not offered to the current seat" would be a much
 *  weaker claim. */
function sawOption(engine: VtesEngine, prefix: string, limit = 14): string | null {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return null;
    const hit = dp.options.find((o) => o.id.startsWith(prefix));
    if (hit) return hit.id;
    const pass = dp.options.find((o) => o.id === "pass");
    if (!pass) return null;
    engine.choose(pass.id);
  }
  return null;
}

/** Pass until the combat frame is gone — ending a combat from outside is
 *  recorded on the frame and unwinds when the current window finishes, not
 *  inside the ability's own apply. */
function settleCombat(engine: VtesEngine, state: GameState, limit = 10): void {
  for (let i = 0; i < limit; i++) {
    if (!state.frames.some((f) => f.kind === "combat")) return;
    const dp = engine.decision();
    if (!dp) return;
    const pass = dp.options.find((o) => o.id === "pass");
    if (!pass) return;
    engine.choose(pass.id);
  }
}

/** Walk until the block has resolved into a combat (or the action is over). */
function resolveBlock(engine: VtesEngine, state: GameState, limit = 14): void {
  for (let i = 0; i < limit; i++) {
    if (state.frames.some((f) => f.kind === "combat")) return;
    const dp = engine.decision();
    if (!dp) return;
    const pass = dp.options.find((o) => o.id === "pass");
    if (!pass) return;
    engine.choose(pass.id);
  }
}

// ---------------------------------------------------------------------------

describe("Elysium: Sforzesco Castle (100630)", () => {
  function game(actorSect: string | null): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: actorSect, blood: 3 });
    Object.assign(find(state, "M"), { blood: 2 });
    seatOf(state, "Bob").permanents.push(
      inPlay("sc", "Elysium: Sforzesco Castle", "Bob"),
    );
    return state;
  }

  it("trades the blocker's lock for the card's", () => {
    const state = game("camarilla");
    const engine = blockedBleed(state);
    const id = sawOption(engine, "ability:Elysium: Sforzesco Castle:sc:lockinstead");
    expect(id).toBe("ability:Elysium: Sforzesco Castle:sc:lockinstead:M");
    // The block locked M (p. 25) — that is the price this card buys back.
    expect(find(state, "M").locked).toBe(true);

    runTrace(engine, [["Bob", id!]]);
    expect(find(state, "M").locked).toBe(false);
    expect(seatOf(state, "Bob").permanents[0]!.locked).toBe(true);
  });

  it("does nothing for a blocked vampire of another sect", () => {
    const state = game("sabbat");
    const engine = blockedBleed(state);
    expect(sawOption(engine, "ability:Elysium: Sforzesco Castle")).toBeNull();
  });

  it("cannot pay twice: a locked Castle offers nothing", () => {
    const state = game("camarilla");
    seatOf(state, "Bob").permanents[0]!.locked = true;
    const engine = blockedBleed(state);
    expect(sawOption(engine, "ability:Elysium: Sforzesco Castle")).toBeNull();
  });
});

describe("Elysium: The Arboretum (100631)", () => {
  it("locks to end a combat between two Camarilla vampires", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "camarilla", blood: 3 });
    Object.assign(find(state, "M"), { sect: "camarilla", blood: 2 });
    seatOf(state, "Bob").permanents.push(inPlay("ar", "Elysium: The Arboretum", "Bob"));
    const engine = blockedBleed(state);
    const id = sawOption(engine, "ability:Elysium: The Arboretum:ar:endcombat");
    expect(id).toBe("ability:Elysium: The Arboretum:ar:endcombat");

    runTrace(engine, [["Bob", id!]]);
    settleCombat(engine, state);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
    expect(seatOf(state, "Bob").permanents[0]!.locked).toBe(true);
  });

  it("is not offered when only ONE combatant is Camarilla", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "sabbat", blood: 3 });
    Object.assign(find(state, "M"), { sect: "camarilla", blood: 2 });
    seatOf(state, "Bob").permanents.push(inPlay("ar", "Elysium: The Arboretum", "Bob"));
    const engine = blockedBleed(state);
    expect(sawOption(engine, "ability:Elysium: The Arboretum")).toBeNull();
  });
});

describe("Powerbase: Savannah (101442)", () => {
  /** ALICE's acting vampire is in the combat, so the offer is Alice's. */
  function game(withOther: boolean): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3 });
    Object.assign(find(state, "M"), { blood: 2 });
    seatOf(state, "Alice").permanents.push(inPlay("ps", "Powerbase: Savannah", "Alice"));
    if (withOther) {
      seatOf(state, "Alice").permanents.push(
        inPlay("ar", "Elysium: The Arboretum", "Alice"),
      );
    }
    return state;
  }

  it("locks ANOTHER unique location and stays unlocked itself", () => {
    const state = game(true);
    const engine = blockedBleed(state);
    const id = sawOption(engine, "ability:Powerbase: Savannah:ps:endcombat");
    // It never offers to lock ITSELF — the price is another card's lock.
    expect(id).toBe("ability:Powerbase: Savannah:ps:endcombat:ar");

    runTrace(engine, [["Alice", id!]]);
    settleCombat(engine, state);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
    const perms = seatOf(state, "Alice").permanents;
    expect(perms.find((p) => p.card.id === "ar")?.locked).toBe(true);
    expect(perms.find((p) => p.card.id === "ps")?.locked).toBe(false);
  });

  it("offers nothing with no other unique location to spend", () => {
    const state = game(false);
    const engine = blockedBleed(state);
    expect(sawOption(engine, "ability:Powerbase: Savannah")).toBeNull();
  });

  it("offers nothing to the seat whose vampire merely BLOCKED", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3 });
    Object.assign(find(state, "M"), { blood: 2 });
    // Bob's vampire is the blocker, not the actor.
    seatOf(state, "Bob").permanents.push(
      inPlay("ps", "Powerbase: Savannah", "Bob"),
      inPlay("ar", "Elysium: The Arboretum", "Bob"),
    );
    const engine = blockedBleed(state);
    expect(sawOption(engine, "ability:Powerbase: Savannah")).toBeNull();
  });
});

describe("Atonement (100109)", () => {
  function game(actorCapacity: number): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { capacity: actorCapacity, blood: 3 });
    Object.assign(find(state, "M"), { capacity: 4, blood: 2 });
    find(state, "M").attached.push(inPlay("at", "Atonement", "Bob"));
    return state;
  }

  it("does not lock for blocking a vampire the same age or younger", () => {
    const state = game(4); // the same age as the blocker
    resolveBlock(blockedBleed(state), state);
    expect(find(state, "M").locked).toBe(false);
    // The intercept is the card's other half, and it is real.
    expect(find(state, "M").attached[0]!.statics.intercept).toBe(1);
  });

  it("DOES lock for blocking an older vampire", () => {
    const state = game(7);
    resolveBlock(blockedBleed(state), state);
    expect(find(state, "M").locked).toBe(true);
  });

  it("requires a vampire of capacity 5 or less to play", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { capacity: 7, blood: 3 });
    seatOf(state, "Alice").hand.push({ id: "at", name: "Atonement" });
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "minion";
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((i) => i.startsWith("play:Atonement")),
    ).toBe(false);

    find(state, "V1").capacity = 5;
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((i) => i.startsWith("play:Atonement")),
    ).toBe(true);
  });

  it("the exemption holds on the OTHER path that locks a blocker", () => {
    // Mirror Walk ends the action and locks the blocker anyway (p. 49) — the
    // second site, and the reason both go through one helper.
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { capacity: 4, blood: 3, disciplines: { tha: "superior" } });
    Object.assign(find(state, "M"), { capacity: 4, blood: 2 });
    find(state, "M").attached.push(inPlay("at", "Atonement", "Bob"));
    seatOf(state, "Alice").hand.push({ id: "mw", name: "Mirror Walk" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "play:Mirror Walk:superior"],
    ]);
    expect(find(state, "M").locked).toBe(false);
  });

  it("an ally blocker has no age, so the exemption cannot apply", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3 });
    seatOf(state, "Bob").minions.push(
      makeMinion("A1", "Bob", { kind: "ally", capacity: 2, blood: 2 }),
    );
    // The card is on the BLOCKER; the vampire it blocks is what has an age.
    find(state, "A1").attached.push(inPlay("at", "Atonement", "Bob"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:A1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // V1's capacity is the fixture's 5, the ally's "capacity" is its life —
    // the clause compares vampires, and the blocker here is not one, so the
    // ordinary lock stands.
    expect(find(state, "A1").locked).toBe(true);
  });
});
