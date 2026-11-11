/**
 * Wave 116 — First Blood Nosferatu (docs/first-blood-nosferatu-design.md).
 *
 * Opens Nosferatu groups 4–5. Five vampires print an ability; every clause
 * is tested in both directions. Each crypt ability is the REAL compiled
 * entry (`cryptEntry`), never a hand-built copy of it.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, handSizeOf, redactFor } from "../../src/engine/index.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import { preconDeck, supportedPrecons } from "../../src/ui/deckimport";
import registry from "../../src/cards/registry.json";

const handlers = buildHandlerRegistry();

function seat(state: GameState, id: string) {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}
function must(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}
function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}
/** Put a real crypt card's ability onto a minion. */
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
/** Step the game, choosing `pick` when it returns an id, else `pass`, else
 *  `end`, else the first option — until `until` holds. */
function walk(
  engine: VtesEngine,
  until: () => boolean,
  pick: (seat: string, options: string[]) => string | undefined = () => undefined,
  limit = 300,
): void {
  for (let i = 0; i < limit; i++) {
    if (until()) return;
    const dp = engine.decision();
    if (!dp) throw new Error("game ended before the condition held");
    const o = dp.options.map((x) => x.id);
    const id =
      pick(dp.seat, o) ??
      o.find((x) => x === "pass") ??
      o.find((x) => x === "end") ??
      o[0]!;
    runTrace(engine, [[dp.seat, id]]);
  }
  throw new Error("condition never held");
}
const inCombat = (s: GameState) => () => s.frames.some((f) => f.kind === "combat");

/** Alice's V1 bleeds, Bob's M blocks; the combat is live. */
function intoCombat(setup: (s: GameState) => void) {
  const state = threeSeatGame();
  Object.assign(must(state, "V1"), { blood: 5, capacity: 6 });
  Object.assign(must(state, "M"), { blood: 5, capacity: 6 });
  setup(state);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  expect(inCombat(state)()).toBe(true);
  return { state, engine };
}
const handOf = (state: GameState, viewer: string, whose: string) =>
  redactFor(state, viewer).seats.find((s) => s.id === whose)!.hand.map((c) => c.name);

// ---------------------------------------------------------------------------
// The group is open
// ---------------------------------------------------------------------------

describe("Nosferatu groups 4–5 are open", () => {
  const crypt = Object.values(
    (registry as { entries: Record<string, { card: { kind: string; name: string } }> }).entries,
  ).map((e) => e.card).filter((c) => c.kind === "crypt");

  it("admits every vampire First Blood Nosferatu's crypt names", () => {
    for (const n of [
      "Beetleman (G4)", "Benjamin Rose (G5)", "Gustaphe Brunnelle (G4)",
      "Harold Tanner (G4)", 'Jeremy "Wix" Wyzchovsky (G4)', "Petra (G4)",
    ]) {
      expect(crypt.some((c) => c.name === n), n).toBe(true);
    }
  });

  it("puts First Blood Nosferatu in the chooser, as a labelled half deck", () => {
    const s = supportedPrecons().find((p) => p.set === "First Blood" && p.name === "Nosferatu");
    expect(s).toBeDefined();
    expect(s!.unsupported).toEqual([]);
    expect(s!.halfDeck).toBe(true);
    const d = preconDeck("First Blood", "Nosferatu", "A");
    expect(d!.crypt.length).toBe(s!.cryptCount);
  });
});

// ---------------------------------------------------------------------------
// Jeremy "Wix" Wyzchovsky — +1 bleed on his bleed actions
// ---------------------------------------------------------------------------

describe('Jeremy "Wix" Wyzchovsky — "can bleed with +1 bleed as a Ⓓ action"', () => {
  function bleed(wix: boolean): number {
    const state = threeSeatGame();
    if (wix) asVampire(must(state, "V1"), 'Jeremy "Wix" Wyzchovsky (G4)');
    const engine = new VtesEngine(state, testRegistry);
    const before = seat(state, "Bob").pool;
    runTrace(engine, [["Alice", "bleed:V1"]]);
    walk(engine, () => state.eventLog.some((e) => e.type === "ActionResolved"));
    return before - seat(state, "Bob").pool;
  }
  it("bleeds for 2 — and the same vampire without him bleeds for 1", () => {
    expect(bleed(true)).toBe(2);
    expect(bleed(false)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Gustaphe Brunnelle — a rush on predator or prey only
// ---------------------------------------------------------------------------

describe("Gustaphe Brunnelle — rush a minion of your predator or prey", () => {
  /** Four seats, so a minion exists that is neither predator nor prey:
   *  Alice → Bob → Carol → Dave. Alice's prey is Bob, her predator Dave. */
  function fourSeats() {
    const state = threeSeatGame();
    const carol = seat(state, "Carol");
    state.seats.push({
      ...carol,
      id: "Dave",
      minions: [makeMinion("D", "Dave")],
      hand: [],
      permanents: [],
    });
    seat(state, "Alice").minions.push(makeMinion("V2", "Alice"));
    asVampire(must(state, "V1"), "Gustaphe Brunnelle (G4)");
    return { state, engine: new VtesEngine(state, testRegistry) };
  }
  const RUSH = "act:Gustaphe Brunnelle (G4):V1:";

  it("offers the prey's and the predator's minions, and nobody else's", () => {
    const { engine } = fourSeats();
    const targets = ids(engine).filter((i) => i.startsWith(RUSH)).map((i) => i.slice(RUSH.length));
    expect(targets.sort()).toEqual(["D", "M", "W"]);
    // NEGATIVE SPACE: Carol is across the table; V2 is Alice's own.
    expect(targets).not.toContain("N");
    expect(targets).not.toContain("V2");
  });

  it("enters combat with the chosen minion when it resolves", () => {
    const { state, engine } = fourSeats();
    runTrace(engine, [["Alice", `${RUSH}D`]]);
    walk(engine, inCombat(state));
    const cf = state.frames.find((f) => f.kind === "combat");
    expect(cf && cf.kind === "combat" ? [cf.acting, cf.opposing] : []).toEqual(["V1", "D"]);
  });

  it("is his alone: another vampire of Alice's gets no such rush", () => {
    const { engine } = fourSeats();
    expect(ids(engine).some((i) => i.includes(":V2:") && i.startsWith("act:Gustaphe"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Harold Tanner — the open hand, to the whole table
// ---------------------------------------------------------------------------

describe("Harold Tanner — the opposing controller plays with an open hand", () => {
  const setup = (harold: boolean) => (s: GameState) => {
    if (harold) asVampire(must(s, "V1"), "Harold Tanner (G4)");
    seat(s, "Bob").hand = [{ id: "b1", name: "Deflection" }];
    seat(s, "Alice").hand = [{ id: "a1", name: "Conditioning" }];
  };

  it("opens Bob's hand to every seat, Carol included (owner ruling)", () => {
    const { state } = intoCombat(setup(true));
    expect(handOf(state, "Alice", "Bob")).toEqual(["Deflection"]);
    expect(handOf(state, "Carol", "Bob")).toEqual(["Deflection"]);
  });

  it("NEGATIVE SPACE: Harold's own controller's hand stays closed", () => {
    const { state } = intoCombat(setup(true));
    expect(handOf(state, "Bob", "Alice")).toEqual([""]);
    expect(handOf(state, "Carol", "Alice")).toEqual([""]);
  });

  it("CONTROL: the same combat without Harold opens nothing", () => {
    const { state } = intoCombat(setup(false));
    expect(handOf(state, "Carol", "Bob")).toEqual([""]);
  });

  it("is derived: the hand closes when the combat is gone", () => {
    const { state } = intoCombat(setup(true));
    state.frames = state.frames.filter((f) => f.kind !== "combat");
    expect(handOf(state, "Carol", "Bob")).toEqual([""]);
  });
});

// ---------------------------------------------------------------------------
// Petra — the press toll, and aggravated damage on Baali
// ---------------------------------------------------------------------------

describe("Petra — a vampire burns 1 blood after pressing to continue against her", () => {
  /** Bob's M gets one press; walk to his press decision and continue. */
  function pressAgainst(petra: boolean, blocker: "vampire" | "ally") {
    const { state, engine } = intoCombat((s) => {
      if (petra) asVampire(must(s, "V1"), "Petra (G4)");
      if (blocker === "ally") {
        const bob = seat(s, "Bob");
        bob.minions = bob.minions.map((m) => (m.id === "M" ? makeAlly("M", "Bob", 5) : m));
      }
    });
    const cf = state.frames.find((f) => f.kind === "combat");
    if (!cf || cf.kind !== "combat") throw new Error("no combat");
    cf.presses.opposing = 1;
    walk(
      engine,
      () => state.eventLog.some((e) => e.type === "PressUsed"),
      (s, o) => (s === "Bob" && o.includes("press:continue") ? "press:continue" : undefined),
    );
    // Only what follows the press: blood burned EARLIER mends strike
    // damage (p. 31), which is not the toll.
    const at = state.eventLog.findIndex((e) => e.type === "PressUsed");
    return state.eventLog
      .slice(at)
      .filter((e) => e.type === "BloodBurned" && e.minion === "M");
  }

  it("charges the pressing vampire 1 blood", () => {
    expect(pressAgainst(true, "vampire").map((e) => e.type === "BloodBurned" && e.amount)).toEqual([1]);
  });
  it("CONTROL: pressing against another vampire costs nothing", () => {
    expect(pressAgainst(false, "vampire")).toEqual([]);
  });
  it("NEGATIVE SPACE: an ALLY pressing against her owes nothing", () => {
    expect(pressAgainst(true, "ally")).toEqual([]);
  });
});

describe("Petra — damage she inflicts on Baali is aggravated", () => {
  /** Built anyway, though no Baali is in the pool yet (owner ruling
   *  2026-11-10): tested on a constructed Baali. */
  function strikeOn(clan: string): boolean | undefined {
    const { state, engine } = intoCombat((s) => {
      asVampire(must(s, "V1"), "Petra (G4)");
      must(s, "M").clan = clan;
    });
    walk(
      engine,
      () =>
        state.eventLog.some(
          (e) => e.type === "DamageInflicted" && e.minion === "M" && e.source === "V1",
        ),
      (s, o) => (o.includes("strike:hand") ? "strike:hand" : undefined),
    );
    const hit = state.eventLog.find(
      (e) => e.type === "DamageInflicted" && e.minion === "M" && e.source === "V1",
    );
    return hit && hit.type === "DamageInflicted" ? hit.aggravated === true : undefined;
  }
  it("is aggravated against a Baali", () => {
    expect(strikeOn("Baali")).toBe(true);
  });
  it("CONTROL: is normal against any other clan", () => {
    expect(strikeOn("Nosferatu")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Benjamin Rose — a referendum for +1 hand size until the end of the game
// ---------------------------------------------------------------------------

describe("Benjamin Rose — +1 hand size until the end of the game", () => {
  const CALL = "act:Benjamin Rose (G5):V1:referendum:V1";
  function setup() {
    const state = threeSeatGame();
    const v1 = asVampire(must(state, "V1"), "Benjamin Rose (G5)");
    v1.title = "prince";
    seat(state, "Alice").minions.push(makeMinion("V2", "Alice"));
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("is offered to Benjamin, and to no other vampire", () => {
    const { engine } = setup();
    const calls = ids(engine).filter((i) => i.startsWith("act:Benjamin Rose (G5)"));
    expect(calls).toEqual([CALL]);
  });

  it("a passed referendum gives Alice +1 hand size, and it outlives the turn", () => {
    const { state, engine } = setup();
    expect(handSizeOf(state, "Alice")).toBe(7);
    runTrace(engine, [["Alice", CALL]]);
    walk(
      engine,
      () => state.eventLog.some((e) => e.type === "ReferendumResolved"),
      (s, o) => (s === "Alice" ? o.find((x) => x.startsWith("vote:V1:") && x.endsWith(":for")) : undefined),
    );
    expect(
      state.eventLog.some((e) => e.type === "ReferendumResolved" && e.passed),
    ).toBe(true);
    expect(handSizeOf(state, "Alice")).toBe(8);
    // NEGATIVE SPACE: it is Alice's, not the table's.
    expect(handSizeOf(state, "Bob")).toBe(7);
    // "Until the end of the game": still there after the turn is gone.
    walk(engine, () => state.frames.some((f) => f.kind === "turn" && f.seat === "Bob"));
    expect(handSizeOf(state, "Alice")).toBe(8);
  });

  it("CONTROL: a failed referendum gives nothing", () => {
    const { state, engine } = setup();
    runTrace(engine, [["Alice", CALL]]);
    // Nobody votes, so it ties at 0–0 and fails (p. 28).
    walk(engine, () => state.eventLog.some((e) => e.type === "ReferendumResolved"));
    expect(
      state.eventLog.some((e) => e.type === "ReferendumResolved" && !e.passed),
    ).toBe(true);
    expect(handSizeOf(state, "Alice")).toBe(7);
  });
});
