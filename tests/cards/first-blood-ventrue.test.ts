/**
 * Wave 117 — First Blood Ventrue (docs/first-blood-ventrue-design.md).
 *
 * Opens Ventrue groups 4–5. Five vampires print an ability; every clause
 * is tested in both directions. Each crypt ability is the REAL compiled
 * entry (`cryptEntry`), never a hand-built copy of it.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, currentStealth } from "../../src/engine/index.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
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
const phaseIs = (s: GameState, phase: string) => () => {
  const tf = s.frames[0];
  return tf?.kind === "turn" && tf.seat === "Alice" && tf.phase === phase && s.frames.length === 1;
};

// ---------------------------------------------------------------------------
// The group is open
// ---------------------------------------------------------------------------

describe("Ventrue groups 4–5 are open", () => {
  const crypt = Object.values(
    (registry as { entries: Record<string, { card: { kind: string; name: string } }> }).entries,
  ).map((e) => e.card).filter((c) => c.kind === "crypt");

  it("admits every vampire First Blood Ventrue's crypt names", () => {
    for (const n of [
      "Emily Carson (G5)", "Graham Gottesman (G5)", "João Bilé (G4)",
      "Lodin (Olaf Holte) (G5)", "Mustafa, The Heir (G4)", "Victor Donaldson (G5)",
    ]) {
      expect(crypt.some((c) => c.name === n), n).toBe(true);
    }
  });

  it("puts First Blood Ventrue in the chooser, as a labelled half deck", () => {
    const s = supportedPrecons().find((p) => p.set === "First Blood" && p.name === "Ventrue");
    expect(s).toBeDefined();
    expect(s!.unsupported).toEqual([]);
    expect(s!.halfDeck).toBe(true);
    const d = preconDeck("First Blood", "Ventrue", "A");
    expect(d!.crypt.length).toBe(s!.cryptCount);
  });
});

// ---------------------------------------------------------------------------
// Emily Carson — burn the Edge to unlock, in the discard phase only
// ---------------------------------------------------------------------------

describe("Emily Carson — during your discard phase, burn the Edge to unlock", () => {
  const USE = "ability:Emily Carson (G5):V1:edgeUnlock";
  function setup(opts: { edge?: string | null; locked?: boolean } = {}) {
    const state = threeSeatGame();
    asVampire(must(state, "V1"), "Emily Carson (G5)");
    must(state, "V1").locked = opts.locked ?? true;
    state.edge = opts.edge === undefined ? "Alice" : opts.edge;
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("is offered in Alice's discard phase; using it burns the Edge and unlocks her", () => {
    const { state, engine } = setup();
    walk(engine, phaseIs(state, "discard"));
    expect(ids(engine)).toContain(USE);
    runTrace(engine, [["Alice", USE]]);
    expect(must(state, "V1").locked).toBe(false);
    expect(state.edge).toBeNull();
    // NEGATIVE SPACE: a ready Emily is not offered it again.
    expect(ids(engine)).not.toContain(USE);
  });

  it("NEGATIVE SPACE: not in the minion phase, where Kalinda's would be", () => {
    const { engine } = setup();
    expect(ids(engine)).not.toContain(USE);
  });

  it("NEGATIVE SPACE: not without the Edge, and not while she is ready", () => {
    for (const opts of [{ edge: "Bob" }, { edge: null }, { locked: false }]) {
      const { state, engine } = setup(opts);
      walk(engine, phaseIs(state, "discard"));
      expect(ids(engine), JSON.stringify(opts)).not.toContain(USE);
    }
  });
});

// ---------------------------------------------------------------------------
// João Bilé — the block bar, and stealth on actions to put vampires in play
// ---------------------------------------------------------------------------

describe("João Bilé — while untitled, he cannot block titled vampires", () => {
  /** Alice's V1 bleeds Bob; return Bob's block options. */
  function blocks(actorTitled: boolean, joaoTitled: boolean): string[] {
    const state = threeSeatGame();
    if (actorTitled) must(state, "V1").title = "prince";
    const m = asVampire(must(state, "M"), "João Bilé (G4)");
    if (joaoTitled) m.title = "primogen";
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    return ids(engine).filter((i) => i.startsWith("block:"));
  }

  it("cannot block a titled acting vampire while untitled", () => {
    const b = blocks(true, false);
    expect(b).not.toContain("block:M");
    // Bob's other vampire still can: the bar is João's own.
    expect(b).toContain("block:W");
  });
  it("can block an untitled one", () => {
    expect(blocks(false, false)).toContain("block:M");
  });
  it("can block a titled one once he has a title himself", () => {
    expect(blocks(true, true)).toContain("block:M");
  });
});

describe("João Bilé — +1 stealth during actions to put vampires in play", () => {
  /** Alice's João bleeds; the announcement is TAGGED as a tagged action
   *  card's would be (no card in the pool carries the tag yet). */
  function stealth(tags: string[] | null): number {
    const state = threeSeatGame();
    asVampire(must(state, "V1"), "João Bilé (G4)");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    const ann = state.eventLog.find((e) => e.type === "ActionAnnounced");
    if (!ann || ann.type !== "ActionAnnounced") throw new Error("no action");
    if (tags) ann.cardTags = tags;
    return currentStealth(state, ann.actionId);
  }
  it("gets +1 stealth on an action tagged putsVampireInPlay", () => {
    expect(stealth(["putsVampireInPlay"])).toBe(1);
  });
  it("NEGATIVE SPACE: an untagged action, or another tag, gives nothing", () => {
    expect(stealth(null)).toBe(0);
    expect(stealth(["wraith"])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Lodin — once each combat, prevent 1 damage from an opposing strike
// ---------------------------------------------------------------------------

describe("Lodin — once each combat, prevent 1 damage from an opposing minion's strike", () => {
  const USE = "ability:Lodin (Olaf Holte) (G5):V1:vest";
  /** Alice's Lodin bleeds, Bob's M blocks, both strike with hands; walk to
   *  the moment M's 1 damage on Lodin awaits prevention. */
  function toDamage() {
    const state = threeSeatGame();
    Object.assign(must(state, "V1"), { blood: 5, capacity: 8 });
    Object.assign(must(state, "M"), { blood: 5, capacity: 6 });
    asVampire(must(state, "V1"), "Lodin (Olaf Holte) (G5)");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    walk(
      engine,
      () => {
        const cf = state.frames.find((f) => f.kind === "combat");
        return !!cf && cf.kind === "combat" && cf.pendingDamage[0]?.minion === "V1" && engine.decision()?.seat === "Alice";
      },
      (_s, o) => (o.includes("strike:hand") ? "strike:hand" : undefined),
    );
    const cf = state.frames.find((f) => f.kind === "combat");
    if (!cf || cf.kind !== "combat") throw new Error("no combat");
    return { state, engine, cf };
  }

  it("prevents 1 of M's strike damage, and then is spent for the combat", () => {
    const { state, engine, cf } = toDamage();
    expect(ids(engine)).toContain(USE);
    runTrace(engine, [["Alice", USE]]);
    expect(
      state.eventLog.some((e) => e.type === "DamagePrevented" && e.minion === "V1" && e.amount === 1),
    ).toBe(true);
    expect(cf.usedThisCombat).toContain("V1");
    // NEGATIVE SPACE: a second strike in the same combat finds it spent.
    cf.pendingDamage.unshift({ minion: "V1", amount: 1, source: "M", aggravated: false });
    expect(ids(engine)).not.toContain(USE);
  });

  it("NEGATIVE SPACE: not against damage that is not an opposing strike", () => {
    const { engine, cf } = toDamage();
    // Environmental damage (source null), and a striker's damage to himself.
    cf.pendingDamage[0]!.source = null;
    expect(ids(engine)).not.toContain(USE);
    cf.pendingDamage[0]!.source = "V1";
    expect(ids(engine)).not.toContain(USE);
  });
});

// ---------------------------------------------------------------------------
// Mustafa, The Heir — an older rival Toreador forces his votes
// ---------------------------------------------------------------------------

describe("Mustafa, The Heir — an older Toreador of another Methuselah forces his votes", () => {
  const CALL = "act:Benjamin Rose (G5):V1:referendum:V1";
  const USE = "ability:Mustafa, The Heir (G4):M:";
  /** Alice's Benjamin calls a referendum. Bob's M is Mustafa (Prince,
   *  capacity 6). Toreador: Carol's N (7, older), Carol's N2 (6, equal),
   *  Alice's V2 (8, older), Bob's own T (9). */
  function setup(tweak: (s: GameState) => void = () => {}) {
    const state = threeSeatGame();
    const v1 = asVampire(must(state, "V1"), "Benjamin Rose (G5)");
    v1.title = "prince";
    const m = asVampire(must(state, "M"), "Mustafa, The Heir (G4)");
    Object.assign(m, { title: "prince", capacity: 6, blood: 3, clan: "Ventrue" });
    const tor = (id: string, who: string, capacity: number) =>
      makeMinion(id, who, { clan: "Toreador", capacity, blood: 3 });
    seat(state, "Carol").minions.push(tor("N2", "Carol", 6));
    Object.assign(must(state, "N"), { clan: "Toreador", capacity: 7, blood: 3 });
    seat(state, "Alice").minions.push(tor("V2", "Alice", 8));
    seat(state, "Bob").minions.push(tor("T", "Bob", 9));
    tweak(state);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", CALL]]);
    return { state, engine };
  }
  const polling = (s: GameState) => s.frames.some((f) => f.kind === "referendum");
  const rf = (s: GameState) => {
    const f = s.frames.find((x) => x.kind === "referendum");
    if (!f || f.kind !== "referendum") throw new Error("no referendum");
    return f;
  };
  /** Walk to `who`'s polling decision. */
  const toSeat = (state: GameState, engine: VtesEngine, who: string) =>
    walk(engine, () => polling(state) && engine.decision()?.seat === who);

  it("offers each older Toreador of another Methuselah, and no other", () => {
    const { state, engine } = setup();
    // Polling asks Alice, Bob, then Carol.
    toSeat(state, engine, "Alice");
    expect(ids(engine).filter((i) => i.startsWith(USE)).sort()).toEqual([
      `${USE}V2:against`,
      `${USE}V2:for`,
    ]);
    toSeat(state, engine, "Bob");
    // NEGATIVE SPACE: Bob controls Mustafa, so his own Toreador cannot.
    expect(ids(engine).some((i) => i.startsWith(USE))).toBe(false);
    toSeat(state, engine, "Carol");
    const carol = ids(engine).filter((i) => i.startsWith(USE));
    expect(carol.sort()).toEqual([`${USE}N:against`, `${USE}N:for`]);
    // NEGATIVE SPACE: N2 is the same age, not older.
    expect(carol.some((i) => i.includes(":N2:"))).toBe(false);
  });

  it("moves 1 blood, forces the cast, and the LAST user has the final say", () => {
    const { state, engine } = setup();
    toSeat(state, engine, "Carol");
    runTrace(engine, [["Carol", `${USE}N:for`]]);
    expect(must(state, "N").blood).toBe(2);
    expect(must(state, "M").blood).toBe(4);
    const mine = () => rf(state).votes.filter((v) => v.minion === "M");
    expect(mine().length).toBeGreaterThan(0);
    expect(mine().every((v) => v.inFavor)).toBe(true);
    // Once per Toreador per referendum.
    expect(ids(engine).some((i) => i.startsWith(`${USE}N:`))).toBe(false);
    toSeat(state, engine, "Alice");
    runTrace(engine, [["Alice", `${USE}V2:against`]]);
    expect(mine().every((v) => !v.inFavor)).toBe(true);
    expect(must(state, "M").blood).toBe(5);
  });

  it("NEGATIVE SPACE: not during an automatically passing referendum", () => {
    const { state, engine } = setup();
    toSeat(state, engine, "Carol");
    rf(state).autoPass = true;
    expect(ids(engine).some((i) => i.startsWith(USE))).toBe(false);
  });

  it("NEGATIVE SPACE: not when Mustafa has no votes to cast", () => {
    const { state, engine } = setup((s) => {
      must(s, "M").title = null;
    });
    toSeat(state, engine, "Carol");
    expect(ids(engine).some((i) => i.startsWith(USE))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Victor Donaldson — a canceled Golconda goes back to the library
// ---------------------------------------------------------------------------

describe("Victor Donaldson — recover a canceled Golconda: Inner Peace", () => {
  const VICTOR = "Victor Donaldson (G5)";
  const RECOVER = `choice:${VICTOR}:V1:recover:g1`;
  /** Alice plays Golconda on Bob's capacity-8 M; Bob pays to cancel it. */
  function play(opts: { victor?: boolean; torpor?: boolean; cancel?: boolean } = {}) {
    const state = threeSeatGame();
    seat(state, "Alice").hand.push({ id: "g1", name: "Golconda: Inner Peace" });
    Object.assign(must(state, "M"), { capacity: 8, blood: 3 });
    if (opts.victor !== false) asVampire(must(state, "V1"), VICTOR);
    if (opts.torpor) must(state, "V1").inTorpor = true;
    const engine = new VtesEngine(state, testRegistry);
    walk(engine, () => ids(engine).some((i) => i.startsWith("play:Golconda")));
    runTrace(engine, [["Alice", ids(engine).find((i) => i.startsWith("play:Golconda"))!]]);
    runTrace(engine, [["Alice", "pass"]]);
    const pay = ids(engine).find((i) => i.startsWith("cancelpay:"));
    if (!pay) throw new Error("no pay-to-cancel");
    runTrace(engine, [["Bob", opts.cancel === false ? "pass" : pay]]);
    // The as-played window closes; a cancel files the card as it does.
    walk(engine, () =>
      opts.cancel === false
        ? state.eventLog.some((e) => e.type === "CardResolved" && e.cardId === "g1")
        : inAsh(state),
    );
    return { state, engine };
  }
  const inAsh = (s: GameState) => (seat(s, "Alice").ashHeap ?? []).some((c) => c.id === "g1");
  const inLibrary = (s: GameState) => seat(s, "Alice").library.some((c) => c.id === "g1");

  it("offers the move once the cancel files it, and moves it to the library", () => {
    const { state, engine } = play();
    expect(inAsh(state)).toBe(true);
    expect(ids(engine)).toContain(RECOVER);
    runTrace(engine, [["Alice", RECOVER]]);
    expect(inAsh(state)).toBe(false);
    expect(inLibrary(state)).toBe(true);
    expect(state.eventLog.some((e) => e.type === "LibraryShuffled" && e.seat === "Alice")).toBe(true);
  });

  it("is optional: declining leaves the card in the ash heap", () => {
    const { state, engine } = play();
    runTrace(engine, [["Alice", "pass"]]);
    expect(inAsh(state)).toBe(true);
  });

  it("NEGATIVE SPACE: no offer without Victor, or with Victor in torpor", () => {
    for (const opts of [{ victor: false }, { torpor: true }]) {
      const { state, engine } = play(opts);
      expect(inAsh(state)).toBe(true);
      expect(ids(engine).some((i) => i.startsWith(`choice:${VICTOR}`)), JSON.stringify(opts)).toBe(false);
    }
  });

  it("NEGATIVE SPACE: an uncanceled Golconda raises nothing", () => {
    const { engine } = play({ cancel: false });
    walk(engine, () => true);
    expect(ids(engine).some((i) => i.startsWith(`choice:${VICTOR}`))).toBe(false);
  });

  it("NEGATIVE SPACE: another canceled card raises nothing", () => {
    const state = threeSeatGame();
    const v1 = asVampire(must(state, "V1"), VICTOR);
    seat(state, "Alice").ashHeap = [{ id: "x1", name: "Giant's Blood" }];
    const engine = new VtesEngine(state, testRegistry);
    const before = state.frames.length;
    handlers[VICTOR]!.onCardCanceled!(
      v1.attached[0]!,
      { seat: "Alice", minion: "V1" },
      { seat: "Alice", cardId: "x1", cardName: "Giant's Blood" },
      engine,
    );
    expect(state.frames.length).toBe(before);
  });
});
