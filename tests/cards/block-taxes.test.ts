/**
 * Taxing and barring a block from a card in play
 * (docs/block-taxes-design.md).
 *
 * Aching Beauty (100018), Artistically Inept (100101),
 * Kaymakli Barrier (101034), Burden the Mind (100268).
 *
 * Four cards that sit on a minion and change what blocking costs or
 * whether it is possible at all. Two of them needed no new machinery —
 * `blockedPoolToll` and `cannotBeBlockedBy.clans` were already there — so
 * what their tests pin is that the SPEC wires them, and the two new ones
 * are pinned in both directions: the bar that bites and the case it leaves
 * alone.
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

/** Pass as whoever is asked, until no action frame is left. Preferring
 *  `pass` (never `options[0]`, which plays the board) and asking the engine
 *  whose impulse it is, rather than spelling a sequencing order the engine
 *  owns. */
function drainAction(engine: VtesEngine, state: GameState, limit = 40): void {
  for (let i = 0; i < limit && state.frames.some((f) => f.kind !== "turn"); i++) {
    const dp = engine.decision();
    if (!dp) return;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options.find((o) => o.id === "end");
    if (!pick) return;
    engine.choose(pick.id);
  }
}

/** A card in play carrying the statics its spec compiled — the whole point
 *  for three of these four cards. */
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

// ---------------------------------------------------------------------------

describe("Aching Beauty (100018)", () => {
  it("charges the blocking minion's controller 1 pool before block resolution", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Toreador", blood: 3 });
    find(state, "V1").attached.push(inPlay("ab", "Aching Beauty", "Alice"));
    const bobPool = seatOf(state, "Bob").pool;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block resolves
    ]);
    // The BLOCKER's controller pays, not the bearer — and the bearer's own
    // blood is untouched, which is what separates this from `blockedToll`.
    expect(seatOf(state, "Bob").pool).toBe(bobPool - 1);
    expect(find(state, "V1").blood).toBe(3);
  });

  it("charges nothing when the bleed goes unblocked", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Toreador", blood: 3 });
    find(state, "V1").attached.push(inPlay("ab", "Aching Beauty", "Alice"));
    const bobPool = seatOf(state, "Bob").pool;
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // "IF this Toreador is blocked" — a penalty for a block, not a toll for
    // the attempt.
    expect(seatOf(state, "Bob").pool).toBe(bobPool);
  });
});

describe("Artistically Inept (100101)", () => {
  function game(blockerClan: string | null): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Brujah", blood: 3 });
    find(state, "V1").attached.push(inPlay("ai", "Artistically Inept", "Alice"));
    find(state, "M").clan = blockerClan;
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
    ]);
    return { state, engine };
  }

  it("a Toreador cannot attempt to block the bearer", () => {
    const { engine } = game("Toreador");
    expect(optionIds(engine).some((i) => i === "block:M")).toBe(false);
  });

  it("anyone else still can — the bar names ONE clan", () => {
    const { engine } = game("Nosferatu");
    expect(optionIds(engine)).toContain("block:M");
  });

  it("is burned by a Toreador as a directed action, and by nobody else", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Brujah" });
    find(state, "V1").attached.push(inPlay("ai", "Artistically Inept", "Alice"));
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Bob";
      tf.phase = "minion";
    }
    find(state, "W").clan = "Nosferatu";
    find(state, "M").clan = "Toreador";
    const ids = optionIds(new VtesEngine(state, testRegistry));
    expect(ids).toContain("act:Artistically Inept:ai:burn:M");
    expect(ids.some((i) => i === "act:Artistically Inept:ai:burn:W")).toBe(false);
  });
});

describe("Kaymakli Barrier (101034)", () => {
  /** Alice's V1 (capacity 5) plays it on one of Bob's vampires. */
  function play(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { capacity: 5, blood: 3 });
    Object.assign(find(state, "W"), { capacity: 4, blood: 3 }); // younger
    Object.assign(find(state, "M"), { capacity: 8 }); // older
    seatOf(state, "Alice").hand.push({ id: "kb", name: "Kaymakli Barrier" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("targets a YOUNGER ready vampire and nobody else", () => {
    const { state, engine } = play();
    seatOf(state, "Carol").minions.push(
      makeMinion("A1", "Carol", { kind: "ally", capacity: 1, blood: 1 }),
    );
    const ids = optionIds(engine).filter((i) => i.startsWith("play:Kaymakli Barrier"));
    // `play:<Name>:<mode>:<actor>:<target>:<cardId>` — ONE option: V1 acting
    // on W. W (4) is younger than V1 (5); M (8) is older, the ally is no
    // vampire, and V1 is not younger than itself. Asserting the whole list
    // rather than probing for `:M:` — the actor's own id sits in the same
    // string, so a substring probe answers about the wrong segment.
    expect(ids).toEqual(["play:Kaymakli Barrier:basic:V1:W:kb"]);
  });

  it("bars the bearer from blocking an UNDIRECTED action, not a directed one", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3 });
    find(state, "W").attached.push(inPlay("kb", "Kaymakli Barrier", "Alice"));
    // A bleed is DIRECTED at Bob: W may block it.
    const e1 = new VtesEngine(state, testRegistry);
    runTrace(e1, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    expect(optionIds(e1)).toContain("block:W");

    // A hunt is UNDIRECTED: W may not.
    const state2 = threeSeatGame();
    Object.assign(find(state2, "V1"), { blood: 0 }); // a 0-blood vampire must hunt (p. 21)
    find(state2, "W").attached.push(inPlay("kb", "Kaymakli Barrier", "Alice"));
    const e2 = new VtesEngine(state2, testRegistry);
    runTrace(e2, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    const ids = optionIds(e2);
    expect(ids.some((i) => i === "block:W")).toBe(false);
    // Bob's OTHER minion is untouched — the bar is on the bearer.
    expect(ids).toContain("block:M");
  });

  it("charges the bearer 1 extra blood for a DIRECTED action", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "W"), { blood: 3 });
    find(state, "W").attached.push(inPlay("kb", "Kaymakli Barrier", "Alice"));
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Bob", "bleed:W"]]);
    // A bleed is directed: the surcharge is paid at announcement.
    expect(find(state, "W").blood).toBe(2);
  });

  it("charges nothing for an UNDIRECTED action", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "W"), { blood: 0 });
    find(state, "W").attached.push(inPlay("kb", "Kaymakli Barrier", "Alice"));
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Bob", "hunt:W"]]);
    expect(find(state, "W").blood).toBe(0);
  });
});

describe("Burden the Mind (100268)", () => {
  it("taxes an unlock-to-block effect on another Methuselah's turn", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3 });
    // Guard Dogs is "[ani], usable by a LOCKED minion during a bleed of
    // you" — all three gates are the fixture's job (the three gates that
    // make an option vanish).
    Object.assign(find(state, "M"), { locked: true, disciplines: { ani: "basic" } });
    find(state, "M").attached.push(inPlay("bm", "Burden the Mind", "Alice"));
    // Bob's Guard Dogs unlocks M to block during ALICE's turn.
    seatOf(state, "Bob").hand.push({ id: "gd", name: "Guard Dogs" });
    const bobPool = seatOf(state, "Bob").pool;
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "play:Guard Dogs"],
      // The card unlocks M at RESOLUTION, so its as-played window closes
      // first (p. 7).
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(find(state, "M").locked).toBe(false);
    // "…costs an additional pool", paid by the Methuselah using the effect.
    expect(seatOf(state, "Bob").pool).toBe(bobPool - 1);
  });

  it("the bearer burns it as a directed action and ends up UNLOCKED", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "W"), { blood: 3 });
    find(state, "W").attached.push(inPlay("bm", "Burden the Mind", "Alice"));
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Bob";
      tf.phase = "minion";
    }
    const engine = new VtesEngine(state, testRegistry);
    const ids = optionIds(engine);
    // "THIS MINION may burn this card": the bearer and nobody else.
    expect(ids).toContain("act:Burden the Mind:bm:burn:W");
    expect(ids.some((i) => i === "act:Burden the Mind:bm:burn:M")).toBe(false);

    runTrace(engine, [["Bob", "act:Burden the Mind:bm:burn:W"]]);
    drainAction(engine, state);
    expect(find(state, "W").attached.some((p) => p.card.id === "bm")).toBe(false);
    // Announcing the action locked them (p. 25); burning the card is what
    // gives the lock back.
    expect(find(state, "W").locked).toBe(false);
  });
});
