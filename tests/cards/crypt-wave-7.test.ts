/**
 * Crypt wave 7 — the last seven crypt cards (docs/crypt-wave-7.md).
 *
 * THE CRYPT IS FINISHED with these. Each is driven to its actual effect
 * rather than merely offered: wave 2's two silent no-ops were both
 * options that were offered, legal and taken, and accomplished nothing
 * with no error anywhere.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentStatics } from "../../src/engine/index.ts";
import { VtesEngine, currentBleed } from "../../src/engine/index.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const handlers = buildHandlerRegistry();

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

function attach(
  m: MinionState,
  id: string,
  name: string,
  statics: PermanentStatics = {},
  tags: string[] = [],
) {
  m.attached.push({
    card: { id, name },
    controller: m.controller,
    owner: m.controller,
    locked: false,
    usedThisPhase: false,
    statics,
    tags,
  });
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}
function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}
/** Step, preferring to do NOTHING, until `prefix` is offered. */
function walkTo(engine: VtesEngine, prefix: string, limit = 160): boolean {
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
/** Run the action in flight out, answering choices, and STOP. */
function resolve(engine: VtesEngine, state: GameState, limit = 60): void {
  for (let i = 0; i < limit; i++) {
    // `cardPlay` is in the list because playing an action card pushes a
    // CARD-PLAY frame first — the action is not announced until its
    // as-played window closes, and a helper that stopped at "no action
    // frame" would return before the action ever existed.
    const busy = state.frames.some(
      (f) => f.kind === "action" || f.kind === "choice" || f.kind === "cardPlay",
    );
    if (!busy) return;
    const dp = engine.decision();
    if (!dp) return;
    const pick =
      dp.options.find((o) => o.id.startsWith("choice:")) ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
}

// ---------------------------------------------------------------------------
// Evan Klein — a coin flip at ANNOUNCEMENT
// ---------------------------------------------------------------------------

describe("Evan Klein", () => {
  /** Rush Evan with `seed`; report whether the action failed. */
  function rushEvan(seed: number): { flipped: boolean; tails: boolean } {
    const state = threeSeatGame();
    state.rngState = seed;
    const evan = find(state, "W"); // Bob's, so Alice can rush him
    asVampire(evan, "Evan Klein (G6)");
    const v1 = find(state, "V1");
    v1.disciplines = { cel: "basic", tha: "basic" };
    v1.blood = 4;
    state.seats[0]!.hand.push({ id: "rush9", name: "Hunter's Mark" });
    const engine = new VtesEngine(state, testRegistry);
    if (!walkTo(engine, "play:Hunter's Mark")) throw new Error("no rush");
    const rush = optionIds(engine).find(
      (o) => o.startsWith("play:Hunter's Mark") && o.includes(":W:"),
    )!;
    runTrace(engine, [["Alice", rush]]);
    // Playing a card pushes a CARD-PLAY frame; the action is announced
    // only once its as-played window closes. Stopping at the play is how
    // the first version of this test saw no coin at all.
    for (let i = 0; i < 10; i++) {
      if (state.eventLog.some((e) => e.type === "ActionAnnounced")) break;
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [
        [dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id],
      ]);
    }
    const flip = state.eventLog.find((e) => e.type === "CoinFlipped");
    return {
      flipped: flip !== undefined,
      tails: flip?.type === "CoinFlipped" ? flip.tails : false,
    };
  }

  it("flips a coin as an action DIRECTED AT HIM is announced", () => {
    const results = [1, 2, 3, 4, 5, 6, 7, 8].map(rushEvan);
    // The flip happens on EVERY such action — that is what proves the
    // hook fired, and it is recorded either way so a heads is
    // distinguishable from the card never having fired at all.
    expect(results.every((r) => r.flipped)).toBe(true);
    // Both outcomes must be reachable across seeds, or it is not a coin.
    expect(results.some((r) => r.tails)).toBe(true);
    expect(results.some((r) => !r.tails)).toBe(true);
  });

  it("fails the action on tails, and lets it through on heads", () => {
    function outcome(seed: number): { tails: boolean; failed: boolean } {
      const state = threeSeatGame();
      state.rngState = seed;
      asVampire(find(state, "W"), "Evan Klein (G6)");
      const v1 = find(state, "V1");
      v1.disciplines = { cel: "basic", tha: "basic" };
      v1.blood = 4;
      state.seats[0]!.hand.push({ id: "rush9", name: "Hunter's Mark" });
      const engine = new VtesEngine(state, testRegistry);
      walkTo(engine, "play:Hunter's Mark");
      runTrace(engine, [
        [
          "Alice",
          optionIds(engine).find(
            (o) => o.startsWith("play:Hunter's Mark") && o.includes(":W:"),
          )!,
        ],
      ]);
      for (let i = 0; i < 40; i++) {
        const dp = engine.decision();
        if (!dp) break;
        if (state.eventLog.some((e) => e.type === "ActionResolved")) break;
        runTrace(engine, [
          [dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id],
        ]);
      }
      const flip = state.eventLog.find((e) => e.type === "CoinFlipped");
      return {
        tails: flip?.type === "CoinFlipped" ? flip.tails : false,
        failed: state.eventLog.some((e) => e.type === "ActionResolved" && !e.success),
      };
    }
    const results = [1, 2, 3, 4, 5, 6, 7, 8].map(outcome);
    // Every tails failed, and no heads did — the two halves must line up
    // exactly, or the coin is decorative.
    expect(results.filter((r) => r.tails).every((r) => r.failed)).toBe(true);
    expect(results.filter((r) => !r.tails).every((r) => !r.failed)).toBe(true);
    expect(results.some((r) => r.tails)).toBe(true);
  });

  it("does NOT flip for a BLEED, which targets a seat and not a minion", () => {
    // "Directed at HIM" is a minion target, narrower than "directed at
    // you" — the Szlachta Bodyguard reading, which falls out of
    // `targetMinion` being null rather than needing a rule.
    const state = threeSeatGame();
    asVampire(find(state, "W"), "Evan Klein (G6)");
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "bleed:V1");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(state.eventLog.some((e) => e.type === "CoinFlipped")).toBe(false);
  });

  it("does not flip for an action aimed at somebody else", () => {
    const state = threeSeatGame();
    state.rngState = 1;
    asVampire(find(state, "W"), "Evan Klein (G6)"); // Bob's W
    const v1 = find(state, "V1");
    v1.disciplines = { cel: "basic", tha: "basic" };
    v1.blood = 4;
    state.seats[0]!.hand.push({ id: "rush9", name: "Hunter's Mark" });
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "play:Hunter's Mark");
    // …aimed at Bob's OTHER vampire, M.
    const rush = optionIds(engine).find(
      (o) => o.startsWith("play:Hunter's Mark") && o.includes(":M:"),
    );
    if (!rush) return;
    runTrace(engine, [["Alice", rush]]);
    expect(state.eventLog.some((e) => e.type === "CoinFlipped")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Elen Kamjian — the second mandatory action in the game
// ---------------------------------------------------------------------------

describe("Elen Kamjian", () => {
  function elenGame(lockOne: boolean) {
    const state = threeSeatGame();
    asVampire(find(state, "V1"), "Elen Kamjian (G6)");
    state.seats[0]!.minions.push(makeMinion("V9", "Alice", { locked: lockOne }));
    const engine = new VtesEngine(state, testRegistry);
    return { state, engine };
  }

  it("offers ONLY her bleed while you control a locked minion", () => {
    const { engine } = elenGame(true);
    walkTo(engine, "bleed:V1");
    const ids = optionIds(engine);
    expect(ids).toContain("bleed:V1");
    // Mandatory actions come first (p. 19): nothing else is on the table,
    // not even ending the phase.
    expect(ids).not.toContain("hunt:V1");
    expect(ids).not.toContain("end");
    expect(ids).not.toContain("bleed:V9");
  });

  it("leaves the phase alone when no minion of yours is locked", () => {
    // The control case. Without it, a gate that fired unconditionally
    // would look identical.
    const { engine } = elenGame(false);
    walkTo(engine, "bleed:V1");
    const ids = optionIds(engine);
    expect(ids).toContain("bleed:V1");
    expect(ids).toContain("end");
    expect(ids).toContain("hunt:V1");
  });

  it("gives the compelled bleed +1, and an uncompelled one nothing", () => {
    function bleedAmount(lockOne: boolean): number {
      const { state, engine } = elenGame(lockOne);
      walkTo(engine, "bleed:V1");
      runTrace(engine, [["Alice", "bleed:V1"]]);
      const af = state.frames.find((f) => f.kind === "action");
      if (af?.kind !== "action") throw new Error("no action");
      return currentBleed(state, af);
    }
    // The compulsion and the bonus are ONE sentence, so they read the
    // same condition — a bonus that applied while she was free would be
    // inventing text.
    expect(bleedAmount(true)).toBe(2);
    expect(bleedAmount(false)).toBe(1);
  });

  it("still defers to the mandatory HUNT — 'unless she must hunt'", () => {
    const state = threeSeatGame();
    const elen = find(state, "V1");
    asVampire(elen, "Elen Kamjian (G6)");
    elen.blood = 0;
    state.seats[0]!.minions.push(makeMinion("V9", "Alice", { locked: true }));
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "hunt:V1");
    const ids = optionIds(engine);
    expect(ids).toContain("hunt:V1");
    expect(ids).not.toContain("bleed:V1");
  });
});

// ---------------------------------------------------------------------------
// Nonu Dis — a window opened by the event log
// ---------------------------------------------------------------------------

describe("Nonu Dis", () => {
  function masterGame(playMaster: boolean) {
    const state = threeSeatGame();
    const nonu = find(state, "V1");
    asVampire(nonu, "Nonu Dis (G6)");
    nonu.clan = "Ministry";
    nonu.blood = 2;
    nonu.capacity = 8;
    state.seats[0]!.hand.push({ id: "m1", name: "Blood Doll" });
    const engine = new VtesEngine(state, testRegistry);
    // Walk to ALICE'S master phase. `threeSeatGame()` opens at
    // `turn.minion`, so this crosses a full rotation — and checking the
    // phase without the seat stops at Bob's, where her card is not
    // playable and the option list is bare.
    for (let i = 0; i < 200; i++) {
      const tf = state.frames.find((f) => f.kind === "turn");
      if (tf?.kind === "turn" && tf.phase === "master" && tf.seat === "Alice") break;
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [
        [dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id],
      ]);
    }
    if (playMaster) {
      const play = optionIds(engine).find((o) => o.startsWith("play:Blood Doll"));
      if (play) {
        runTrace(engine, [["Alice", play]]);
        for (let i = 0; i < 10; i++) {
          const dp = engine.decision();
          if (!dp || dp.options.some((o) => o.id.includes("masterblood"))) break;
          runTrace(engine, [
            [dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id],
          ]);
        }
      }
    }
    return { state, engine };
  }

  it("offers the blood only AFTER a master card has been played", () => {
    expect(optionIds(masterGame(false).engine).some((o) => o.includes("masterblood"))).toBe(false);
    expect(optionIds(masterGame(true).engine).some((o) => o.includes("masterblood"))).toBe(true);
  });

  it("adds the blood to a ready Ministry, and spends the phase", () => {
    const { state, engine } = masterGame(true);
    const opt = optionIds(engine).find((o) => o.includes("masterblood:V1"))!;
    expect(opt).toBeDefined();
    const before = find(state, "V1").blood;
    runTrace(engine, [["Alice", opt]]);
    expect(find(state, "V1").blood).toBe(before + 1);
    // Once each master phase.
    expect(optionIds(engine).some((o) => o.includes("masterblood"))).toBe(false);
  });

  it("does not reach a vampire of another clan", () => {
    const { engine } = masterGame(true);
    // Bob's W is not a Ministry, and is not his to feed anyway.
    expect(optionIds(engine).some((o) => o.includes("masterblood:W"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gathii — a gamble on the top of your own library
// ---------------------------------------------------------------------------

describe("Gathii", () => {
  function gathiiBleed(topCard: string) {
    const state = threeSeatGame();
    const g = find(state, "V1");
    asVampire(g, "Gathii (G7)");
    g.blood = 3;
    state.seats[0]!.library.unshift({ id: "top", name: topCard });
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "bleed:V1");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    return { state, engine };
  }

  it("burns 1 blood when the top card is a MASTER", () => {
    const { state, engine } = gathiiBleed("Blood Doll");
    const opt = optionIds(engine).find((o) => o.includes(":reveal"))!;
    expect(opt).toBeDefined();
    const before = find(state, "V1").blood;
    runTrace(engine, [["Alice", opt]]);
    expect(state.eventLog.some((e) => e.type === "LibraryTopRevealed")).toBe(true);
    expect(find(state, "V1").blood).toBe(before - 1);
    expect(
      state.eventLog.some((e) => e.type === "StealthModified" && e.source === "Gathii (G7)"),
    ).toBe(false);
  });

  it("gives +1 stealth when it is anything else", () => {
    const { state, engine } = gathiiBleed("Cats' Guidance");
    runTrace(engine, [["Alice", optionIds(engine).find((o) => o.includes(":reveal"))!]]);
    expect(
      state.eventLog.some((e) => e.type === "StealthModified" && e.source === "Gathii (G7)"),
    ).toBe(true);
    // …and no blood was burnt.
    expect(state.eventLog.some((e) => e.type === "BloodBurned")).toBe(false);
  });

  it("the OPTION does not say what the card is — it is a gamble", () => {
    // Knowing would make it a choice, and the top of your own library is
    // not something you may read (p. 14).
    const { engine } = gathiiBleed("Blood Doll");
    const opt = engine.decision()?.options.find((o) => o.id.includes(":reveal"));
    expect(opt?.label).not.toContain("Blood Doll");
  });

  it("is not offered with an empty library", () => {
    const state = threeSeatGame();
    asVampire(find(state, "V1"), "Gathii (G7)");
    state.seats[0]!.library.length = 0;
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "bleed:V1");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(optionIds(engine).some((o) => o.includes(":reveal"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ilonka — look, then discard at random
// ---------------------------------------------------------------------------

describe("Ilonka", () => {
  /** Carol's N bleeds Alice, who has Ilonka. (Carol's prey is Alice.) */
  function bledByCarol(ilonkaReady = true) {
    const state = threeSeatGame();
    const ilonka = find(state, "V1");
    asVampire(ilonka, "Ilonka (G7)");
    if (!ilonkaReady) ilonka.inTorpor = true;
    state.seats[2]!.hand.push(
      { id: "c1", name: "Aire of Elation" },
      { id: "c2", name: "Cats' Guidance" },
    );
    for (let i = 0; i < 6; i++) {
      state.seats[2]!.library.push({ id: `cl${i}`, name: "Aire of Elation" });
    }
    const engine = new VtesEngine(state, testRegistry);
    if (!walkTo(engine, "bleed:N")) throw new Error("Carol never got to bleed");
    runTrace(engine, [["Carol", "bleed:N"]]);
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const choice = dp.options.find((o) => o.id.includes("peekAndDiscard"));
      if (choice) return { state, engine, choice: choice.id, seat: dp.seat, options: dp.options };
      if (state.eventLog.some((e) => e.type === "ActionResolved")) break;
      runTrace(engine, [
        [dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id],
      ]);
    }
    return { state, engine, choice: null, seat: null, options: [] };
  }

  it("asks ILONKA'S controller, and shows them the bleeder's hand", () => {
    const { choice, seat, options } = bledByCarol();
    expect(choice).not.toBeNull();
    // A ChoiceFrame is addressed to ONE Methuselah, which is what keeps
    // the look from leaking (the Revelations precedent).
    expect(seat).toBe("Alice");
    const opt = options.find((o) => o.id.includes("peekAndDiscard"))!;
    expect(opt.label).toContain("Aire of Elation");
    expect(opt.label).toContain("Cats' Guidance");
  });

  it("offers ONE option naming no card — the discard is at random", () => {
    const { options } = bledByCarol();
    expect(options.filter((o) => o.id.includes("peekAndDiscard"))).toHaveLength(1);
  });

  it("discards one of theirs, and REPLACES it (p. 7)", () => {
    const { state, engine, choice } = bledByCarol();
    const before = state.seats[2]!.hand.length;
    runTrace(engine, [["Alice", choice!]]);
    expect(state.eventLog.some((e) => e.type === "CardDiscarded" && e.seat === "Carol")).toBe(true);
    expect(state.seats[2]!.hand.length).toBe(before);
  });

  it("declining does nothing — 'she CAN look', so the frame is optional", () => {
    const { state, engine, options } = bledByCarol();
    expect(options.some((o) => o.id === "pass")).toBe(true);
    const before = state.seats[2]!.hand.map((c) => c.id).sort();
    runTrace(engine, [["Alice", "pass"]]);
    expect(state.seats[2]!.hand.map((c) => c.id).sort()).toEqual(before);
  });

  it("does nothing if Ilonka is in torpor", () => {
    expect(bledByCarol(false).choice).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Parijat — a block toll in a third currency
// ---------------------------------------------------------------------------

describe("Parijat", () => {
  /** Alice's wraith ally bleeds; Bob may try to block it. */
  function wraithBleed(withParijat: boolean, bobLibrary = 3) {
    const state = threeSeatGame();
    const ally = makeAlly("A1", "Alice", 3);
    state.seats[0]!.minions.push(ally);
    attach(ally, "A1", "Screamer", {}, ["wraith"]);
    if (withParijat) {
      state.seats[0]!.minions.push(makeMinion("V9", "Alice"));
      asVampire(find(state, "V9"), "Parijat, the Dark Oracle (G6)");
    }
    state.seats[1]!.library.length = 0;
    for (let i = 0; i < bobLibrary; i++) {
      state.seats[1]!.library.push({ id: `bl${i}`, name: "Aire of Elation" });
    }
    const engine = new VtesEngine(state, testRegistry);
    if (!walkTo(engine, "bleed:A1")) throw new Error("no ally bleed");
    runTrace(engine, [["Alice", "bleed:A1"]]);
    return { state, engine };
  }

  it("charges the blocker the top card of their library", () => {
    const { state, engine } = wraithBleed(true);
    expect(walkTo(engine, "block:W")).toBe(true);
    const before = state.seats[1]!.library.length;
    runTrace(engine, [["Bob", "block:W"]]);
    expect(state.seats[1]!.library.length).toBe(before - 1);
    // A burnt card goes to its OWNER's ash heap (p. 16).
    expect(state.seats[1]!.ashHeap?.some((c) => c.id === "bl0")).toBe(true);
  });

  it("charges nothing when Parijat is not on the table", () => {
    const { state, engine } = wraithBleed(false);
    walkTo(engine, "block:W");
    const before = state.seats[1]!.library.length;
    runTrace(engine, [["Bob", "block:W"]]);
    expect(state.seats[1]!.library.length).toBe(before);
  });

  it("bars a blocker with an EMPTY library from attempting at all", () => {
    // A toll that cannot be paid is a block that cannot be attempted —
    // the block-tax gate's own rule, in a third currency.
    const { engine } = wraithBleed(true, 0);
    for (let i = 0; i < 12; i++) {
      const dp = engine.decision();
      if (!dp) break;
      expect(dp.options.some((o) => o.id === "block:W")).toBe(false);
      if (dp.options.every((o) => o.id === "pass")) break;
      runTrace(engine, [
        [dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id],
      ]);
    }
  });

  it("does not charge for blocking an ordinary VAMPIRE", () => {
    // The control: the toll is keyed on WHO IS ACTING, so a plain bleed
    // by V1 with Parijat still in play must cost nothing.
    const state = threeSeatGame();
    state.seats[0]!.minions.push(makeMinion("V9", "Alice"));
    asVampire(find(state, "V9"), "Parijat, the Dark Oracle (G6)");
    state.seats[1]!.library.push({ id: "bl0", name: "Aire of Elation" });
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "bleed:V1");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    walkTo(engine, "block:W");
    const before = state.seats[1]!.library.length;
    runTrace(engine, [["Bob", "block:W"]]);
    expect(state.seats[1]!.library.length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Tommaso — ending a combat he is not in
// ---------------------------------------------------------------------------

describe("Tommaso Sforza", () => {
  /** Bob's W rushes Alice's wraith ally; Tommaso watches from outside. */
  function wraithCombat(tommassoBlood = 3) {
    const state = threeSeatGame();
    const ally = makeAlly("A1", "Alice", 3);
    state.seats[0]!.minions.push(ally);
    attach(ally, "A1", "Screamer", {}, ["wraith"]);
    // LOCKED when he has no blood: a vampire at 0 blood MUST hunt
    // (p. 21), and the walker would answer that hunt and feed him — so an
    // unlocked one would measure the walk, not the gate. Locked is still
    // READY (p. 16), which is what his own clause asks for.
    const tom = makeMinion("V9", "Alice", {
      blood: tommassoBlood,
      capacity: 7,
      locked: tommassoBlood === 0,
    });
    state.seats[0]!.minions.push(tom);
    asVampire(find(state, "V9"), "Tommaso Sforza (G6)");
    const w = find(state, "W");
    w.disciplines = { cel: "basic", tha: "basic" };
    w.blood = 4;
    state.seats[1]!.hand.push({ id: "rush9", name: "Hunter's Mark" });
    const engine = new VtesEngine(state, testRegistry);
    if (!walkTo(engine, "play:Hunter's Mark")) throw new Error("no rush");
    const rush = optionIds(engine).find(
      (o) => o.startsWith("play:Hunter's Mark") && o.includes(":A1:"),
    );
    if (!rush) throw new Error("no rush at the ally");
    runTrace(engine, [["Bob", rush]]);
    return { state, engine };
  }

  it("ends a combat involving his controller's wraith ally, for 1 blood", () => {
    const { state, engine } = wraithCombat();
    expect(walkTo(engine, "ability:Tommaso Sforza (G6)")).toBe(true);
    const opt = optionIds(engine).find((o) => o.includes(":endcombat"))!;
    expect(opt).toBeDefined();
    const before = find(state, "V9").blood;
    runTrace(engine, [["Alice", opt]]);
    expect(find(state, "V9").blood).toBe(before - 1);
    // He is NOT in the combat, so ending it must not lock him — the card
    // names blood as its whole price.
    expect(find(state, "V9").locked).toBe(false);
    // End of Round still runs after a combat "ends immediately"
    // (p. 30/p. 32), so the frame outlives the ability by a few impulses.
    for (let i = 0; i < 30; i++) {
      if (!state.frames.some((f) => f.kind === "combat")) break;
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [
        [dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id],
      ]);
    }
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
    // It ENDED rather than being fought out: nobody struck.
    expect(state.eventLog.some((e) => e.type === "DamageInflicted")).toBe(false);
  });

  it("is not offered to a Tommaso who cannot pay", () => {
    const { engine } = wraithCombat(0);
    for (let i = 0; i < 14; i++) {
      const dp = engine.decision();
      if (!dp) break;
      expect(dp.options.some((o) => o.id.includes(":endcombat"))).toBe(false);
      if (dp.options.some((o) => o.id === "strike:hand")) break;
      runTrace(engine, [
        [dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id],
      ]);
    }
  });

  it("is not offered for a combat with no wraith or zombie of yours in it", () => {
    // The control case: an ordinary vampire duel.
    const state = threeSeatGame();
    const tom = makeMinion("V9", "Alice", { blood: 3, capacity: 7 });
    state.seats[0]!.minions.push(tom);
    asVampire(find(state, "V9"), "Tommaso Sforza (G6)");
    const w = find(state, "W");
    w.disciplines = { cel: "basic", tha: "basic" };
    w.blood = 4;
    state.seats[1]!.hand.push({ id: "rush9", name: "Hunter's Mark" });
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "play:Hunter's Mark");
    const rush = optionIds(engine).find(
      (o) => o.startsWith("play:Hunter's Mark") && o.includes(":V1:"),
    );
    if (!rush) return;
    runTrace(engine, [["Bob", rush]]);
    for (let i = 0; i < 14; i++) {
      const dp = engine.decision();
      if (!dp) break;
      expect(dp.options.some((o) => o.id.includes(":endcombat"))).toBe(false);
      if (dp.options.some((o) => o.id === "strike:hand")) break;
      runTrace(engine, [
        [dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id],
      ]);
    }
  });
});
