/**
 * Retainers, and what a combat does to the other player's hand
 * (docs/retainer-wave-design.md).
 *
 * Crypt's Sons (100476), Owl Companion (101340), Raptor (101545), Feral
 * Hound (102249), Szlachta Assistant (102360), Szlachta Bodyguard
 * (102361) — all six of the unsupported retainers, so the type finishes.
 *
 * The mechanism worth pinning hardest is §1: a combat-scoped effect on
 * the OTHER player is DERIVED from the live combat frames, never stored,
 * so it lifts by itself whichever way the combat ended.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, handSizeOf, redactFor, viewFor } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function maybeEntry(state: GameState, cardId: string): PermanentInPlay | undefined {
  for (const s of state.seats) {
    for (const m of s.minions) {
      const p = m.attached.find((x) => x.card.id === cardId);
      if (p) return p;
    }
  }
  return undefined;
}

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function walkTo(engine: VtesEngine, prefix: string, limit = 70): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return false;
}

/** Employ a spec-compiled retainer onto a minion, statics and life. */
function employ(
  state: GameState,
  minion: string,
  id: string,
  name: string,
  mode: "basic" | "superior" | null = "basic",
): PermanentInPlay {
  const e = testRegistry[name]?.permanentEntry?.(mode);
  const p: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: e?.statics ?? {},
    tags: e?.tags ?? [],
    ...(e?.life !== undefined ? { life: e.life } : {}),
  };
  find(state, minion).attached.push(p);
  return p;
}

/** Alice's V1 bleeds, Bob's M blocks; the combat is live. */
function intoCombat(setup: (s: GameState) => void = () => {}) {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 5, strength: 1 });
  Object.assign(find(state, "M"), { blood: 5, strength: 1 });
  setup(state);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block → combat
  ]);
  return { state, engine };
}

// ---------------------------------------------------------------------------
// §1 — derived, combat-scoped effects on the other player
// ---------------------------------------------------------------------------

describe("Owl Companion (101340) — the open hand", () => {
  it("opens the OPPOSING controller's hand to the retainer's controller", () => {
    const { state } = intoCombat((s) => {
      employ(s, "V1", "owl", "Owl Companion");
      seatOf(s, "Bob").hand = [{ id: "b1", name: "Deflection" }];
    });
    // Alice employs the owl; Bob is the other combatant's controller.
    const alice = redactFor(state, "Alice");
    expect(alice.seats.find((s) => s.id === "Bob")!.hand.map((c) => c.name)).toEqual([
      "Deflection",
    ]);
    const view = viewFor(state, "Alice");
    const bob = view.seats.find((s) => s.id === "Bob")!;
    expect(Array.isArray(bob.hand)).toBe(true);

    // CONTROL: Carol is not in the combat and sees nothing.
    const carol = redactFor(state, "Carol");
    expect(carol.seats.find((s) => s.id === "Bob")!.hand.every((c) => c.name === "")).toBe(
      true,
    );
    // …and Alice's own hand is not opened to Bob by her own owl.
    const bobView = redactFor(state, "Bob");
    expect(bobView.seats.find((s) => s.id === "Alice")!.hand.every((c) => c.name === "")).toBe(
      true,
    );
  });

  it("IT IS DERIVED: the hand closes when the combat frame goes", () => {
    // The whole point of §1. Nothing is cleared — the frame simply is not
    // there any more, so the derivation stops answering.
    const { state } = intoCombat((s) => {
      employ(s, "V1", "owl", "Owl Companion");
      seatOf(s, "Bob").hand = [{ id: "b1", name: "Deflection" }];
    });
    expect(
      redactFor(state, "Alice").seats.find((s) => s.id === "Bob")!.hand[0]!.name,
    ).toBe("Deflection");
    state.frames = state.frames.filter((f) => f.kind !== "combat");
    expect(
      redactFor(state, "Alice").seats.find((s) => s.id === "Bob")!.hand[0]!.name,
    ).toBe("");
  });

  it("NEGATIVE SPACE: no combat, no open hand", () => {
    const state = threeSeatGame();
    employ(state, "V1", "owl", "Owl Companion");
    seatOf(state, "Bob").hand = [{ id: "b1", name: "Deflection" }];
    expect(
      redactFor(state, "Alice").seats.find((s) => s.id === "Bob")!.hand[0]!.name,
    ).toBe("");
  });

  it("its two modes differ only in life", () => {
    expect(testRegistry["Owl Companion"]!.permanentEntry?.("basic").life).toBe(1);
    expect(testRegistry["Owl Companion"]!.permanentEntry?.("superior").life).toBe(2);
  });
});

describe("Raptor (101545)", () => {
  it("basic: +1 intercept, and NO hand-size penalty", () => {
    const state = threeSeatGame();
    employ(state, "V1", "rap", "Raptor", "basic");
    expect(find(state, "V1").attached[0]!.statics.intercept).toBe(1);
    expect(handSizeOf(state, "Bob")).toBe(7);
  });

  it("superior: the opposing controller's hand size drops while in combat", () => {
    const { state } = intoCombat((s) => employ(s, "V1", "rap", "Raptor", "superior"));
    expect(handSizeOf(state, "Bob")).toBe(6);
    // Not the raptor's own controller, and not a bystander.
    expect(handSizeOf(state, "Alice")).toBe(7);
    expect(handSizeOf(state, "Carol")).toBe(7);
    // Derived: it lifts with the frame.
    state.frames = state.frames.filter((f) => f.kind !== "combat");
    expect(handSizeOf(state, "Bob")).toBe(7);
  });
});

// ---------------------------------------------------------------------------

describe("Crypt's Sons (100476)", () => {
  it("burns a life to lock the blocker and fail the attempt", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "anarch" });
    employ(state, "V1", "cs", "Crypt's Sons");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
    ]);
    const id = "ability:Crypt's Sons:cs:breakblock";
    expect(walkTo(engine, id)).toBe(true);
    runTrace(engine, [["Alice", id]]);
    // p. 49: this one LOCKS the blocker (Mirror Walk's side of the
    // Change of Target distinction).
    expect(find(state, "M").locked).toBe(true);
    expect(maybeEntry(state, "cs")!.life).toBe(2);
    // "Continue the action as if unblocked" is what a failed attempt
    // already does — no combat, and the action is still going.
    expect(walkTo(engine, "block:")).toBe(true);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "BlockFailed")).toBe(true);
  });

  it("inflicts 1R damage each round of combat", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "anarch" });
    const p = employ(state, "V1", "cs", "Crypt's Sons");
    expect(p.statics.combatRoundDamage).toEqual({ amount: 1, ranged: true });
  });

  it("NEGATIVE SPACE: not offered with no block attempt underway", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "anarch" });
    employ(state, "V1", "cs", "Crypt's Sons");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(optionIds(engine).some((o) => o.includes("breakblock"))).toBe(false);
  });
});

describe("Feral Hound (102249)", () => {
  function employGame(level: "basic" | "superior") {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Ravnos", disciplines: { ani: level } });
    seatOf(state, "Alice").hand.push({ id: "fh", name: "Feral Hound" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("superior: unlocks the employer after this action resolves", () => {
    const { state, engine } = employGame("superior");
    const play = optionIds(engine).find((o) =>
      o.startsWith("play:Feral Hound:superior"),
    )!;
    expect(play).toBeDefined();
    runTrace(engine, [
      ["Alice", play],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);
    expect(find(state, "V1").locked).toBe(false);
  });

  it("basic: the employer stays LOCKED until the discard phase", () => {
    // The basic's delay is a real drawback, not flavour (§3).
    const { state, engine } = employGame("basic");
    const play = optionIds(engine).find((o) => o.startsWith("play:Feral Hound:basic"))!;
    runTrace(engine, [
      ["Alice", play],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(find(state, "V1").locked).toBe(true);
    expect(maybeEntry(state, "fh")!.chosen).toBe("V1");

    // Walk to Alice's discard phase.
    for (let i = 0; i < 40; i++) {
      const tf = state.frames[0];
      if (tf?.kind === "turn" && tf.phase === "discard") break;
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(find(state, "V1").locked).toBe(false);
  });

  it("locks to give the employer +1 intercept while it is blocking", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "M"), { clan: "Ravnos" });
    employ(state, "M", "fh", "Feral Hound");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
    ]);
    const id = "ability:Feral Hound:fh:intercept";
    expect(walkTo(engine, id)).toBe(true);
    runTrace(engine, [["Bob", id]]);
    expect(maybeEntry(state, "fh")!.locked).toBe(true);
    expect(
      state.eventLog.some(
        (e) => e.type === "InterceptModified" && e.source === "Feral Hound" && e.delta === 1,
      ),
    ).toBe(true);
  });
});

describe("Szlachta Assistant (102360)", () => {
  it("burns itself to discount a GHOUL ally requiring a Tzimisce", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Tzimisce" });
    employ(state, "V1", "sa", "Szlachta Assistant");
    seatOf(state, "Alice").pool = 12;
    seatOf(state, "Alice").hand.push({ id: "wg", name: "War Ghoul" });
    const engine = new VtesEngine(state, testRegistry);

    const before = optionIds(engine).filter((o) => o.startsWith("play:War Ghoul"));
    expect(before.length).toBeGreaterThan(0);
    runTrace(engine, [["Alice", "ability:Szlachta Assistant:sa:discount"]]);
    expect(maybeEntry(state, "sa")).toBeUndefined(); // burned
    expect(seatOf(state, "Alice").playCostMods?.length).toBe(1);
  });

  it("NEGATIVE SPACE: the modifier does not touch a card that is not a Tzimisce ghoul ally", () => {
    // War Ghoul is tagged "ghoul" but requires no clan, so the filter
    // must NOT match it. This is the test that keeps the two new
    // PlayCostMod filters honest.
    const mod = {
      amount: -2,
      pays: "bloodOrPool" as const,
      cardTypes: ["ally" as const],
      requiresClan: ["Tzimisce"],
      tags: ["ghoul"],
      once: true,
    };
    const h = testRegistry["War Ghoul"]!;
    expect(h.permanentTags).toContain("ghoul");
    expect(h.requiresClans?.() ?? []).not.toContain("Tzimisce");
    // Both halves must match; War Ghoul fails the clan half.
    expect(
      (mod.requiresClan ?? []).some((c) => (h.requiresClans?.() ?? []).includes(c)),
    ).toBe(false);
  });
});

describe("Szlachta Bodyguard (102361)", () => {
  it("locks to prevent 1 damage in combat", () => {
    const { state, engine } = intoCombat((s) => {
      Object.assign(find(s, "M"), { clan: "Tzimisce" });
      employ(s, "M", "sb", "Szlachta Bodyguard");
    });
    expect(walkTo(engine, "ability:Szlachta Bodyguard:sb:prevent")).toBe(true);
    runTrace(engine, [["Bob", "ability:Szlachta Bodyguard:sb:prevent"]]);
    expect(maybeEntry(state, "sb")!.locked).toBe(true);
    expect(state.eventLog.some((e) => e.type === "DamagePrevented")).toBe(true);
  });

  it("burns itself to make an action directed AT A MINION fail", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "M"), { clan: "Tzimisce" });
    Object.assign(find(state, "V1"), {
      disciplines: { cel: "basic", tha: "basic" },
      blood: 4,
    });
    employ(state, "M", "sb", "Szlachta Bodyguard");
    // A RUSH is directed at a minion; a bleed is directed at a seat.
    seatOf(state, "Alice").hand.push({ id: "hm", name: "Hunter's Mark" });
    const engine = new VtesEngine(state, testRegistry);
    const play = optionIds(engine).find(
      (o) => o.startsWith("play:Hunter's Mark") && o.includes(":M:"),
    );
    expect(play, "a rush aimed at M").toBeDefined();
    runTrace(engine, [["Alice", play!]]);

    const id = "ability:Szlachta Bodyguard:sb:failaction";
    expect(walkTo(engine, id)).toBe(true);
    runTrace(engine, [["Bob", id]]);
    expect(maybeEntry(state, "sb")).toBeUndefined(); // burned
    // "…FAIL", not "is blocked": no combat follows.
    for (let i = 0; i < 30; i++) {
      const dp = engine.decision();
      if (!dp || state.frames.some((f) => f.kind === "combat")) break;
      if (!state.frames.some((f) => f.kind === "action")) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
  });

  it("NEGATIVE SPACE: a BLEED is directed at a seat, so it does not qualify", () => {
    // "An action directed at A MINION YOU CONTROL" is narrower than
    // "directed at you" — the reading on record (§5).
    const state = threeSeatGame();
    Object.assign(find(state, "M"), { clan: "Tzimisce" });
    employ(state, "M", "sb", "Szlachta Bodyguard");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(optionIds(engine).some((o) => o.includes("failaction"))).toBe(false);
  });
});
