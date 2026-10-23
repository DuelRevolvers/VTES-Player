/**
 * The actor unlocks after the equip (docs/equip-unlocks-design.md).
 *
 * Baseball Bat (100137), Leather Jacket (101081), Powder of Rigidity
 * (101427), Repo Man (101605) — four cards that print "if the action to
 * equip with / recruit this card is successful, unlock the acting minion",
 * each with a second clause the engine did not have.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function entry(id: string, name: string): PermanentInPlay {
  const h = testRegistry[name];
  if (!h) throw new Error(`${name} is not in the registry — is it in supported.json?`);
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h.permanentStatics ?? {},
    tags: h.permanentTags ?? [],
  };
}

function combat(state: GameState): CombatFrame | undefined {
  const f = state.frames.find((x) => x.kind === "combat");
  return f?.kind === "combat" ? f : undefined;
}

function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Answer cheaply until `prefix` is on offer: pass, or a hand strike where
 *  a strike is owed. A walker that picks real options plays the board. */
function passUntil(engine: VtesEngine, prefix: string, limit = 40): void {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) throw new Error(`no decision before ${prefix}`);
    if (dp.options.some((o) => o.id.startsWith(prefix))) return;
    const pick = dp.options.some((o) => o.id === "pass") ? "pass" : "strike:hand";
    runTrace(engine, [[dp.seat, pick]]);
  }
  throw new Error(`${prefix} never offered`);
}

/** Every option id offered to `seat` until the combat frame is gone. Picks
 *  pass, then a hand strike, then the first option. */
function offeredThroughCombat(engine: VtesEngine, state: GameState, seat: string): string[] {
  const seen: string[] = [];
  for (let i = 0; i < 90 && combat(state); i++) {
    const dp = engine.decision();
    if (!dp) break;
    if (dp.seat === seat) seen.push(...dp.options.map((o) => o.id));
    const pick =
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "strike:hand") ??
      dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return seen;
}

/** Alice's V1 bleeds and Bob's `blocker` blocks; combat is live. */
function intoCombat(setup: (state: GameState) => void, blocker = "M") {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 5, strength: 1 });
  Object.assign(find(state, "M"), { blood: 5, strength: 1 });
  setup(state);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", `block:${blocker}`],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  expect(combat(state)).toBeDefined();
  return { state, engine };
}

/** Equip V1 from Alice's hand; the action goes unblocked. */
function equipFromHand(name: string, setup: (state: GameState) => void = () => {}) {
  const state = threeSeatGame();
  state.seats[0]!.hand.push({ id: "eq", name });
  state.seats[0]!.library.push({ id: "lib1", name: "Conditioning" });
  setup(state);
  const engine = new VtesEngine(state, testRegistry);
  const play = ids(engine).find((i) => i.startsWith(`play:${name}:`) && i.includes(":V1:"));
  if (!play) throw new Error(`${name} not offered to V1`);
  runTrace(engine, [["Alice", play]]);
  return { state, engine };
}

/** Pass the equip action to resolution (the NRA PAC trace). */
function resolveUnblocked(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
}

// ---------------------------------------------------------------------------
// §2–§3 — Baseball Bat
// ---------------------------------------------------------------------------

describe("Baseball Bat (100137)", () => {
  it("unlocks the equipper at the end of the turn, and replaces after the action", () => {
    const { state, engine } = equipFromHand("Baseball Bat");
    // "Do not replace until after this action": announced, not yet drawn.
    expect(state.seats[0]!.library.map((c) => c.id)).toEqual(["lib1"]);
    resolveUnblocked(engine);
    expect(find(state, "V1").attached.map((p) => p.card.name)).toEqual(["Baseball Bat"]);
    expect(state.seats[0]!.library).toEqual([]);
    expect(find(state, "V1").locked).toBe(true);
    expect(find(state, "V1").unlocksAtEndOfTurn).toBe(true);
    runTrace(engine, [["Alice", "end"], ["Alice", "pass"]]);
    // NEGATIVE SPACE: the discard phase is not the end of the turn.
    expect(find(state, "V1").locked).toBe(true);
    runTrace(engine, [["Alice", "pass"]]);
    expect(find(state, "V1").locked).toBe(false);
  });

  it("a BLOCKED equip earns no unlock, and still replaces only once the action ends", () => {
    // An equip is a +1 stealth action (p. 20): Sport Bike's +1 intercept is
    // what lets M's block land rather than merely be attempted.
    const { state, engine } = equipFromHand("Baseball Bat", (s) =>
      find(s, "M").attached.push(entry("sb", "Sport Bike")),
    );
    passUntil(engine, "block:M");
    runTrace(engine, [["Bob", "block:M"]]);
    passUntil(engine, "strike:");
    expect(combat(state)).toBeDefined();
    // *"Is not replaced if the action is blocked; it is replaced when the
    // action ends, after all combats"* [LSJ 20001120].
    expect(state.seats[0]!.library.map((c) => c.id)).toEqual(["lib1"]);
    offeredThroughCombat(engine, state, "Alice");
    for (let i = 0; i < 20 && engine.decision()?.window !== "turn.minion"; i++) {
      const dp = engine.decision()!;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(state.seats[0]!.library).toEqual([]);
    expect(find(state, "V1").unlocksAtEndOfTurn).not.toBe(true);
  });

  it("put into play in a special way, it is replaced at once [LSJ 20080702-2]", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "bat", name: "Baseball Bat" });
    state.seats[0]!.library.push({ id: "lib1", name: "Conditioning" });
    const engine = new VtesEngine(state, testRegistry);
    // Inside some OTHER action — the one "after this action" would wait on.
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(engine.action()).not.toBeNull();
    engine.playCardFromHand({ cardId: "bat", seat: "Alice", minion: "V1", mode: null });
    expect(find(state, "V1").attached.map((p) => p.card.name)).toEqual(["Baseball Bat"]);
    expect(state.seats[0]!.library).toEqual([]);
    // Nor is it an equip ACTION, so nothing unlocks anyone.
    expect(find(state, "V1").unlocksAtEndOfTurn).not.toBe(true);
  });

  it("the same clause on an ACTION card now holds too (Arson)", () => {
    // The defect the Bat found: an action card's own "after this action"
    // fell through to an immediate draw, because its action is announced
    // only once the card resolves. §3
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "ar", name: "Arson" });
    state.seats[0]!.library.push({ id: "lib1", name: "Conditioning" });
    state.seats[1]!.permanents.push(entry("loc", "Anarch Railroad"));
    const engine = new VtesEngine(state, testRegistry);
    const play = ids(engine).find((i) => i.startsWith("play:Arson:"));
    if (!play) {
      // Arson burns a LOCATION; with none on the table it is not offered,
      // and the fixture must not pass by skipping.
      throw new Error("Arson not offered");
    }
    runTrace(engine, [["Alice", play]]);
    passUntil(engine, "pass");
    expect(state.seats[0]!.library.map((c) => c.id)).toEqual(["lib1"]);
  });

  it("strikes for strength+1", () => {
    const { state, engine } = intoCombat((s) => find(s, "V1").attached.push(entry("bb", "Baseball Bat")));
    passUntil(engine, "ability:Baseball Bat:bb:strike");
    runTrace(engine, [["Alice", "ability:Baseball Bat:bb:strike"]]);
    offeredThroughCombat(engine, state, "Alice");
    const hit = state.eventLog.find((e) => e.type === "DamageInflicted" && e.minion === "M");
    expect(hit?.type === "DamageInflicted" ? hit.amount : 0).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §2–§3 — Leather Jacket
// ---------------------------------------------------------------------------

describe("Leather Jacket (101081)", () => {
  it("unlocks the equipper at the end of the turn", () => {
    const { state, engine } = equipFromHand("Leather Jacket");
    resolveUnblocked(engine);
    expect(find(state, "V1").unlocksAtEndOfTurn).toBe(true);
  });

  it("burns to prevent ALL the damage from the opposing minion's strike", () => {
    const { state, engine } = intoCombat((s) => {
      find(s, "V1").attached.push(entry("lj", "Leather Jacket"));
      find(s, "M").strength = 3;
    });
    passUntil(engine, "ability:Leather Jacket:lj:burnpreventstrike");
    const before = find(state, "V1").blood;
    runTrace(engine, [["Alice", "ability:Leather Jacket:lj:burnpreventstrike"]]);
    expect(find(state, "V1").attached).toEqual([]);
    offeredThroughCombat(engine, state, "Alice");
    expect(find(state, "V1").blood).toBe(before);
    expect(
      state.eventLog.some((e) => e.type === "DamagePrevented" && e.minion === "V1" && e.amount === 3),
    ).toBe(true);
  });

  it("is not offered with nothing to prevent [LSJ 20001114]", () => {
    const { state, engine } = intoCombat((s) => {
      find(s, "V1").attached.push(entry("lj", "Leather Jacket"));
      find(s, "M").strength = 0;
    });
    const seen = offeredThroughCombat(engine, state, "Alice");
    expect(seen.some((i) => i.includes("Leather Jacket"))).toBe(false);
    expect(find(state, "V1").attached.map((p) => p.card.name)).toEqual(["Leather Jacket"]);
  });

  it("a minion may have only one", () => {
    const state = threeSeatGame();
    find(state, "V1").attached.push(entry("lj", "Leather Jacket"));
    state.seats[0]!.hand.push({ id: "lj2", name: "Leather Jacket" });
    const offered = ids(new VtesEngine(state, testRegistry));
    expect(offered.some((i) => i.startsWith("play:Leather Jacket:") && i.includes(":V1:"))).toBe(false);
    // The control: without the first one, the same minion is offered it.
    const control = threeSeatGame();
    control.seats[0]!.hand.push({ id: "lj2", name: "Leather Jacket" });
    expect(
      ids(new VtesEngine(control, testRegistry)).some(
        (i) => i.startsWith("play:Leather Jacket:") && i.includes(":V1:"),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2, §4 — Powder of Rigidity
// ---------------------------------------------------------------------------

describe("Powder of Rigidity (101427)", () => {
  it("unlocks the equipper as the next DISCARD phase opens, not at end of turn", () => {
    const { state, engine } = equipFromHand("Powder of Rigidity");
    resolveUnblocked(engine);
    expect(find(state, "V1").unlocksInDiscardPhase).toBe(true);
    expect(find(state, "V1").unlocksAtEndOfTurn).not.toBe(true);
    runTrace(engine, [["Alice", "end"]]);
    expect(find(state, "V1").locked).toBe(true); // influence phase
    runTrace(engine, [["Alice", "pass"]]);
    expect(engine.decision()?.window).toBe("turn.discard");
    expect(find(state, "V1").locked).toBe(false);
  });

  /** V1 wears the Powder; Bob's M has Protean and Earth Meld ([pro]
   *  Strike: combat ends) in hand. */
  function proteanCombat() {
    return intoCombat((s) => {
      find(s, "V1").attached.push(entry("pr", "Powder of Rigidity"));
      find(s, "M").disciplines = { pro: "basic" };
      s.seats[1]!.hand.push({ id: "em", name: "Earth Meld" });
    });
  }

  it("burned before range, bars the opposing minion's Protean cards for the combat", () => {
    const { state, engine } = proteanCombat();
    passUntil(engine, "ability:Powder of Rigidity:pr:ban");
    runTrace(engine, [["Alice", "ability:Powder of Rigidity:pr:ban"]]);
    expect(find(state, "V1").attached).toEqual([]);
    const bob = offeredThroughCombat(engine, state, "Bob");
    expect(bob.some((i) => i.includes("Earth Meld"))).toBe(false);
    // The bar is on Protean cards, not on striking.
    expect(bob).toContain("strike:hand");
  });

  it("the control: unburned, the same Earth Meld is on offer", () => {
    const { state, engine } = proteanCombat();
    const bob = offeredThroughCombat(engine, state, "Bob");
    expect(bob.some((i) => i.startsWith("play:Earth Meld:"))).toBe(true);
  });

  it("gives a werewolf -2 strength for the combat, and nobody else", () => {
    const wolf = intoCombat((s) => {
      find(s, "V1").attached.push(entry("pr", "Powder of Rigidity"));
      const dd = makeAlly("DD", "Bob", 3);
      dd.attached.push(entry("DD", "Double Deuce"));
      s.seats[1]!.minions.push(dd);
    }, "DD");
    passUntil(wolf.engine, "ability:Powder of Rigidity:pr:ban");
    runTrace(wolf.engine, [["Alice", "ability:Powder of Rigidity:pr:ban"]]);
    expect(combat(wolf.state)!.strengthBonus.opposing).toBe(-2);

    const vamp = intoCombat((s) => find(s, "V1").attached.push(entry("pr", "Powder of Rigidity")));
    passUntil(vamp.engine, "ability:Powder of Rigidity:pr:ban");
    runTrace(vamp.engine, [["Alice", "ability:Powder of Rigidity:pr:ban"]]);
    expect(combat(vamp.state)!.strengthBonus.opposing).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §5 — Repo Man
// ---------------------------------------------------------------------------

describe("Repo Man (101605)", () => {
  it("recruiting him unlocks the recruiter at the end of the turn", () => {
    const { state, engine } = equipFromHand("Repo Man");
    resolveUnblocked(engine);
    const rm = state.seats[0]!.minions.find((m) => m.kind === "ally");
    expect(rm?.name).toBe("Repo Man");
    expect(find(state, "V1").unlocksAtEndOfTurn).toBe(true);
  });

  /** Alice controls V1 and Repo Man ("RM"); her library is `library`. */
  function repoTable(library: string[], setup: (state: GameState) => void = () => {}) {
    const state = threeSeatGame();
    const rm = makeAlly("RM", "Alice", 1, { strength: 0, bleedAmount: 0 });
    rm.attached.push(entry("RM", "Repo Man"));
    state.seats[0]!.minions.push(rm);
    state.seats[0]!.library = library.map((name, i) => ({ id: `L${i}`, name }));
    setup(state);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "act:Repo Man:RM:repo:RM"]]);
    return { state, engine };
  }

  it("places the FIRST vehicle on a ready minion Alice chooses, paying its cost", () => {
    const { state, engine } = repoTable(["Conditioning", "Sport Bike", "Helicopter"]);
    passUntil(engine, "choice:Repo Man:RM:bearer:");
    const offered = ids(engine);
    // Both of Alice's ready minions — the locked ally too — and nobody else.
    expect(offered.sort()).toEqual(["choice:Repo Man:RM:bearer:RM", "choice:Repo Man:RM:bearer:V1"]);
    runTrace(engine, [["Alice", "choice:Repo Man:RM:bearer:V1"]]);
    expect(find(state, "V1").attached.map((p) => p.card.name)).toEqual(["Sport Bike"]);
    expect(state.seats[0]!.pool).toBe(9);
    expect(state.seats[0]!.library.map((c) => c.name).sort()).toEqual(["Conditioning", "Helicopter"]);
    expect(state.eventLog.at(-1)?.type === "LibraryShuffled" || state.eventLog.some((e) => e.type === "LibraryShuffled")).toBe(true);
  });

  it("burns the vehicle without cost when no minion can take it", () => {
    const { state, engine } = repoTable(["Sport Bike"], (s) => {
      find(s, "V1").attached.push(entry("h1", "Hawg"));
      s.seats[0]!.minions.find((m) => m.id === "RM")!.attached.push(entry("h2", "Hawg"));
    });
    for (let i = 0; i < 40 && state.seats[0]!.library.length > 0; i++) {
      const dp = engine.decision()!;
      expect(dp.options.some((o) => o.id.startsWith("choice:Repo Man"))).toBe(false);
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(state.seats[0]!.ashHeap?.map((c) => c.name)).toEqual(["Sport Bike"]);
    expect(state.seats[0]!.pool).toBe(10);
  });

  it("must pay, even when paying ousts [RTR 19941109]", () => {
    const { state, engine } = repoTable(["Helicopter"], (s) => {
      s.seats[0]!.pool = 2;
    });
    passUntil(engine, "choice:Repo Man:RM:bearer:");
    // NEGATIVE SPACE: no decline — the payment is not optional.
    expect(ids(engine)).not.toContain("pass");
    runTrace(engine, [["Alice", "choice:Repo Man:RM:bearer:V1"]]);
    expect(state.seats[0]!.ousted).toBe(true);
  });
});
