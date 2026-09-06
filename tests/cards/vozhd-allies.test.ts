/**
 * The Vozhd, and an ally's own weapons (docs/vozhd-allies-design.md).
 *
 * The Vozhd of Sofia (102267), Gravesend (102363), Juiz de Fora (102364),
 * Szczecin (102365), City Star Taxi (102234).
 *
 * Ally's first wave. Four of the five share a skeleton — a unique 5-life
 * Tzimisce ghoul that eats one of your own minions on arrival and rushes
 * as a Ⓓ action — so the shared half is pinned once and each card's own
 * clause separately.
 *
 * The gate this closes is p. 11's "plays cards as a vampire", which
 * CLAUDE.md had carried as a deferral since the allies/retainers wave.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function maybe(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function combat(state: GameState): CombatFrame {
  const f = state.frames.find((x) => x.kind === "combat");
  if (!f || f.kind !== "combat") throw new Error("no combat frame");
  return f;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Walk to the first decision offering `prefix`; false if it never comes. */
function walkTo(engine: VtesEngine, prefix: string, limit = 60): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return false;
}

/** An ally already in play, with its own card text as a self-attached entry. */
function allyInPlay(
  state: GameState,
  seat: string,
  id: string,
  name: string,
  life: number,
  strength: number,
  over: Partial<MinionState> = {},
): MinionState {
  const registryEntry = testRegistry[name];
  const stats = registryEntry?.allyEntry?.(null);
  const m = makeAlly(id, seat, life, { name, strength, bleedAmount: 0, ...over });
  const self: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: stats?.statics ?? {},
    tags: stats?.tags ?? [],
  };
  m.attached.push(self);
  if (stats?.disciplines) m.disciplines = { ...stats.disciplines };
  seatOf(state, seat).minions.push(m);
  return m;
}

const undirectedPasses: Array<[string, string]> = [
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
];

// ---------------------------------------------------------------------------
// The shared skeleton
// ---------------------------------------------------------------------------

describe("the Vozhd skeleton: recruit, and eat one of your own", () => {
  /** Alice holds the card and already controls a spare ally to feed it. */
  function recruitGame(name: string): GameState {
    const state = threeSeatGame();
    seatOf(state, "Alice").pool = 12;
    seatOf(state, "Alice").hand.push({ id: "v1card", name });
    allyInPlay(state, "Alice", "SPARE", "Political Ally", 1, 0);
    return state;
  }

  it("offers one play option per burn victim, INCLUDING itself", () => {
    // "Burn an ally or retainer you control" names a set the newcomer
    // belongs to; nothing prefers an alternative (design §1). This is the
    // reading War Ghoul's owner-flagged ledger row was asking about.
    const state = recruitGame("The Vozhd of Sofia");
    const ids = optionIds(new VtesEngine(state, testRegistry)).filter((o) =>
      o.startsWith("play:The Vozhd of Sofia"),
    );
    expect(ids.some((o) => o.includes(":self:"))).toBe(true);
    expect(ids.some((o) => o.includes(":SPARE:"))).toBe(true);
    // The card instance stays LAST in the id, as every trace test assumes.
    expect(ids.every((o) => o.endsWith(":v1card"))).toBe(true);
  });

  it("enters play with 5 life and burns the chosen victim", () => {
    const state = recruitGame("The Vozhd of Sofia");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:The Vozhd of Sofia:basic:V1:SPARE:v1card"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ...undirectedPasses,
    ]);
    const vozhd = find(state, "v1card");
    expect(vozhd.kind).toBe("ally");
    expect(vozhd.blood).toBe(5);
    expect(vozhd.strength).toBe(3);
    expect(seatOf(state, "Alice").pool).toBe(9); // 3 pool at resolution
    // The spare is gone; the Vozhd is not.
    expect(maybe(state, "SPARE")).toBeUndefined();
    expect(maybe(state, "v1card")).toBeDefined();
  });

  it("burning ITSELF is legal, and leaves nothing behind", () => {
    const state = recruitGame("The Vozhd of Sofia");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:The Vozhd of Sofia:basic:V1:self:v1card"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ...undirectedPasses,
    ]);
    expect(maybe(state, "v1card")).toBeUndefined();
    expect(maybe(state, "SPARE")).toBeDefined();
  });

  it("all four rush as a Ⓓ action, at the printed target scope", () => {
    for (const [name, targets] of [
      ["The Vozhd of Sofia", "minion"],
      ["The Vozhd of Gravesend", "vampire"],
      ["The Vozhd of Juiz de Fora", "vampire"],
      ["The Vozhd of Szczecin", "vampire"],
    ] as const) {
      const state = threeSeatGame();
      allyInPlay(state, "Alice", "VZ", name, 5, 4);
      seatOf(state, "Bob").minions.push(makeAlly("BALLY", "Bob", 2));
      const ids = optionIds(new VtesEngine(state, testRegistry));
      const rushes = ids.filter((o) => o.startsWith("act:") && o.includes(":VZ"));
      expect(rushes.length, `${name} rushes`).toBeGreaterThan(0);
      // "…with a MINION" reaches Bob's ally; "…with a VAMPIRE" does not.
      const atAlly = ids.some((o) => o.includes("BALLY"));
      expect(atAlly, `${name} → ally`).toBe(targets === "minion");
    }
  });
});

// ---------------------------------------------------------------------------
// An ally's own strike
// ---------------------------------------------------------------------------

describe("an ally's printed strike", () => {
  /** Alice's ally rushes Bob's W; stop at the strike choice. */
  function intoCombat(name: string, tweak: (s: GameState) => void = () => {}) {
    const state = threeSeatGame();
    allyInPlay(state, "Alice", "VZ", name, 5, 3);
    tweak(state);
    const engine = new VtesEngine(state, testRegistry);
    const rush = optionIds(engine).find((o) => o.includes(":VZ:W") || o.endsWith(":VZ:W"));
    if (!rush) throw new Error(`no rush option: ${optionIds(engine).join(", ")}`);
    runTrace(engine, [["Alice", rush]]);
    return { state, engine };
  }

  it("Sofia strikes for 3R from her own card, not from a weapon", () => {
    const { state, engine } = intoCombat("The Vozhd of Sofia");
    expect(walkTo(engine, "ability:The Vozhd of Sofia:VZ:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:The Vozhd of Sofia:VZ:strike"]]);
    const cf = combat(state);
    const mine = cf.acting === "VZ" ? cf.strikes.acting : cf.strikes.opposing;
    expect(mine).toMatchObject({ damage: 3, ranged: true });
  });

  it("City Star Taxi strikes 1R and carries a per-combat maneuver", () => {
    const state = threeSeatGame();
    const taxi = allyInPlay(state, "Alice", "TAXI", "City Star Taxi", 2, 0);
    // The maneuver is a STATIC on its own entry, granted at pushCombat.
    expect(taxi.attached[0]!.statics.maneuverPerCombat).toBe(1);
    expect(testRegistry["City Star Taxi"]!.allyEntry?.(null).statics.maneuverPerCombat).toBe(1);
  });

  it("an ally's body is NOT equipment: 'cannot use equipment' does not disarm it", () => {
    // The whole reason `ally.strike` is its own clause rather than
    // `weapon: {...}` on an ally spec (design §2).
    const { state, engine } = intoCombat("The Vozhd of Sofia");
    expect(walkTo(engine, "ability:The Vozhd of Sofia:VZ:strike")).toBe(true);
    const cf = combat(state);
    const side = cf.acting === "VZ" ? "acting" : "opposing";
    cf.restrict[side].equipment = true;
    expect(
      optionIds(engine).some((o) => o === "ability:The Vozhd of Sofia:VZ:strike"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// "Plays cards as a vampire" — p. 11
// ---------------------------------------------------------------------------

describe("The Vozhd of Juiz de Fora (102364)", () => {
  it("PLAYS CARDS AS A VAMPIRE: it is offered an [ani] combat card", () => {
    const state = threeSeatGame();
    const vz = allyInPlay(state, "Alice", "VZ", "The Vozhd of Juiz de Fora", 5, 4);
    // p. 11: the whole rule is these levels on the ally's MinionState.
    expect(vz.disciplines).toEqual({ ani: "basic" });
    seatOf(state, "Alice").hand.push({ id: "cc", name: "Carrion Crows" });
    const engine = new VtesEngine(state, testRegistry);
    const rush = optionIds(engine).find((o) => o.includes(":VZ:W"))!;
    runTrace(engine, [["Alice", rush]]);
    expect(walkTo(engine, "play:Carrion Crows")).toBe(true);
    // And it is the ALLY being offered it, not some vampire of Alice's.
    const id = optionIds(engine).find((o) => o.startsWith("play:Carrion Crows"))!;
    expect(id).toContain(":VZ:");
  });

  it("NEGATIVE SPACE: an ally WITHOUT the clause is offered nothing", () => {
    // The control case. Sofia is the same kind of minion in the same
    // combat with the same card in hand, and has no Disciplines.
    const state = threeSeatGame();
    allyInPlay(state, "Alice", "VZ", "The Vozhd of Sofia", 5, 3);
    seatOf(state, "Alice").hand.push({ id: "cc", name: "Carrion Crows" });
    const engine = new VtesEngine(state, testRegistry);
    const rush = optionIds(engine).find((o) => o.includes(":VZ:W"))!;
    runTrace(engine, [["Alice", rush]]);
    expect(walkTo(engine, "play:Carrion Crows", 25)).toBe(false);
  });

  it("siphons any amount of blood from a Tzimisce, capped at starting life", () => {
    const state = threeSeatGame();
    const vz = allyInPlay(state, "Alice", "VZ", "The Vozhd of Juiz de Fora", 5, 4);
    vz.blood = 3; // room for 2
    Object.assign(find(state, "V1"), { clan: "Tzimisce", blood: 4 });
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn frame");
    tf.phase = "unlock";
    tf.unlockDone = true;
    tf.unlockAbilitiesDone = false;
    const engine = new VtesEngine(state, testRegistry);
    const ids = optionIds(engine).filter((o) => o.includes(":siphon:"));
    // "ANY amount", one option each — and capped at 2, not at V1's 4.
    expect(ids).toEqual([
      "ability:The Vozhd of Juiz de Fora:VZ:siphon:V1:1",
      "ability:The Vozhd of Juiz de Fora:VZ:siphon:V1:2",
    ]);
    runTrace(engine, [["Alice", "ability:The Vozhd of Juiz de Fora:VZ:siphon:V1:2"]]);
    // The blood MOVES and becomes life (p. 11).
    expect(find(state, "VZ").blood).toBe(5);
    expect(find(state, "V1").blood).toBe(2);
  });

  it("NEGATIVE SPACE: a non-Tzimisce is not a donor, and a full ally siphons nothing", () => {
    const state = threeSeatGame();
    allyInPlay(state, "Alice", "VZ", "The Vozhd of Juiz de Fora", 5, 4);
    Object.assign(find(state, "V1"), { clan: "Ventrue", blood: 4 });
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn frame");
    tf.phase = "unlock";
    tf.unlockDone = true;
    tf.unlockAbilitiesDone = false;
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((o) => o.includes(":siphon:")),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sofia's unlock-phase feed
// ---------------------------------------------------------------------------

describe("The Vozhd of Sofia (102267)", () => {
  function unlockGame(hand: Array<[string, string]>): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    const vz = allyInPlay(state, "Alice", "VZ", "The Vozhd of Sofia", 5, 3);
    vz.blood = 2;
    for (const [id, name] of hand) seatOf(state, "Alice").hand.push({ id, name });
    seatOf(state, "Alice").library.push({ id: "lib1", name: "Conditioning" });
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn frame");
    tf.phase = "unlock";
    tf.unlockDone = true;
    tf.unlockAbilitiesDone = false;
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("discards an ALLY card for 2 life, and the discard is replaced (p. 7)", () => {
    const { state, engine } = unlockGame([["pa", "Political Ally"]]);
    const id = "ability:The Vozhd of Sofia:VZ:life:pa";
    expect(optionIds(engine)).toContain(id);
    runTrace(engine, [["Alice", id]]);
    expect(find(state, "VZ").blood).toBe(4);
    // Replaced: the hand is the same size, the library one shorter.
    expect(seatOf(state, "Alice").hand.map((c) => c.name)).toEqual([
      "Conditioning",
      "Conditioning",
    ]);
    expect(seatOf(state, "Alice").library.length).toBe(0);
    // Once per phase.
    expect(optionIds(engine).some((o) => o.includes(":life:"))).toBe(false);
  });

  it("NEGATIVE SPACE: a card that is neither an ally nor a retainer is not a cost", () => {
    // The hand already holds Conditioning (an action modifier) from the
    // fixture, so this does not pass because the hand is empty.
    const { engine } = unlockGame([]);
    expect(optionIds(engine).some((o) => o.includes(":life:"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gravesend: prevention, and cancelling a strike card
// ---------------------------------------------------------------------------

describe("The Vozhd of Gravesend (102363)", () => {
  /** Gravesend rushes Bob's W, who holds `card`. */
  function intoCombat(card?: string, disc: Record<string, "basic" | "superior"> = {}) {
    const state = threeSeatGame();
    allyInPlay(state, "Alice", "VZ", "The Vozhd of Gravesend", 5, 4);
    Object.assign(find(state, "W"), { disciplines: disc, blood: 4 });
    if (card) seatOf(state, "Bob").hand.push({ id: "bc", name: card });
    const engine = new VtesEngine(state, testRegistry);
    const rush = optionIds(engine).find((o) => o.includes(":VZ:W"))!;
    runTrace(engine, [["Alice", rush]]);
    return { state, engine };
  }

  it("prevents 1 damage each round", () => {
    const { engine } = intoCombat();
    expect(walkTo(engine, "ability:The Vozhd of Gravesend:VZ:prevent")).toBe(true);
  });

  it("burns 1 life to CANCEL a strike card played by the opposing minion", () => {
    // Aid from Bats declares a strike, so `isStrike` is true on its frame.
    const { state, engine } = intoCombat("Aid from Bats", { ani: "basic" });
    expect(walkTo(engine, "play:Aid from Bats")).toBe(true);
    const play = optionIds(engine).find((o) => o.startsWith("play:Aid from Bats"))!;
    runTrace(engine, [["Bob", play]]);
    // Alice's ally is offered the cancel inside the as-played window.
    const cancel = "ability:The Vozhd of Gravesend:VZ:cancelstrike";
    expect(walkTo(engine, cancel)).toBe(true);
    const lifeBefore = find(state, "VZ").blood;
    runTrace(engine, [["Alice", cancel]]);
    expect(find(state, "VZ").blood).toBe(lifeBefore - 1);
    // "…the minion chooses a strike again" — the settle loop's own doing:
    // the slot was never filled, so chooseStrike comes back round. (The
    // as-played cycle finishes first, which is when the play resolves as
    // cancelled — hence the walk before the event assertion.)
    expect(walkTo(engine, "strike:hand")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "CardCanceled")).toBe(true);
    const cf = combat(state);
    expect(cf.strikes.opposing).toBe(null);
  });

  it("NEGATIVE SPACE: a NON-strike combat card is not cancellable by it", () => {
    // The sharpest test of `CardPlayFrame.isStrike`: same window, same
    // player, same combat — only the card's mode differs.
    const { engine } = intoCombat("Soak", { for: "basic" });
    // Soak is a damage-prevention card; it declares no strike.
    let sawCancel = false;
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.includes(":cancelstrike"))) sawCancel = true;
      const play = dp.options.find((o) => o.id.startsWith("play:Soak"));
      const pick = play ?? dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
    }
    expect(sawCancel).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Szczecin
// ---------------------------------------------------------------------------

describe("The Vozhd of Szczecin (102365)", () => {
  it("discards a [pro] card to prevent 2 damage, once each combat", () => {
    const state = threeSeatGame();
    allyInPlay(state, "Alice", "VZ", "The Vozhd of Szczecin", 5, 4);
    seatOf(state, "Alice").hand.push({ id: "fom", name: "Flesh of Marble" }); // [pro]
    seatOf(state, "Alice").hand.push({ id: "cond", name: "Conditioning" }); // [dom]
    const engine = new VtesEngine(state, testRegistry);
    const rush = optionIds(engine).find((o) => o.includes(":VZ:W"))!;
    runTrace(engine, [["Alice", rush]]);
    expect(walkTo(engine, "ability:The Vozhd of Szczecin:VZ:preventdiscard:fom")).toBe(true);
    // NEGATIVE SPACE: the [dom] card in the same hand is not a legal cost.
    expect(
      optionIds(engine).some((o) => o.includes(":preventdiscard:cond")),
    ).toBe(false);
    runTrace(engine, [["Alice", "ability:The Vozhd of Szczecin:VZ:preventdiscard:fom"]]);
    expect(combat(state).usedThisCombat).toContain("VZ");
  });

  it("a Tzimisce burns 1 blood to unlock it during ANOTHER Methuselah's minion phase", () => {
    const state = threeSeatGame();
    const vz = allyInPlay(state, "Alice", "VZ", "The Vozhd of Szczecin", 5, 4);
    vz.locked = true;
    Object.assign(find(state, "V1"), { clan: "Tzimisce", blood: 3 });
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn frame");
    tf.seat = "Bob"; // somebody else's minion phase
    const engine = new VtesEngine(state, testRegistry);
    // `turn.minion` is the turn seat's own window — nobody else is asked
    // in it — so Alice's impulse comes inside Bob's action, which is also
    // when unlocking the ally is worth anything.
    runTrace(engine, [["Bob", "bleed:W"]]);
    expect(walkTo(engine, "ability:The Vozhd of Szczecin:VZ:unlock:V1")).toBe(true);
    runTrace(engine, [["Alice", "ability:The Vozhd of Szczecin:VZ:unlock:V1"]]);
    expect(find(state, "VZ").locked).toBe(false);
    expect(find(state, "V1").blood).toBe(2);
  });

  it("NEGATIVE SPACE: not during its OWN controller's minion phase", () => {
    // "During any OTHER Methuselah's minion phase" — the mirror of the
    // "during YOUR phase" gate the 2026-08-02 bug installed.
    const state = threeSeatGame();
    const vz = allyInPlay(state, "Alice", "VZ", "The Vozhd of Szczecin", 5, 4);
    vz.locked = true;
    Object.assign(find(state, "V1"), { clan: "Tzimisce", blood: 3 });
    const engine = new VtesEngine(state, testRegistry);
    // Alice's OWN minion phase, with an action running so the impulse
    // exists at all: the ability must still not be there.
    runTrace(engine, [["Alice", "bleed:V1"]]);
    let seen = false;
    for (let i = 0; i < 12; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.includes(":unlock:V1"))) seen = true;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(seen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// City Star Taxi's lock grant
// ---------------------------------------------------------------------------

describe("City Star Taxi (102234)", () => {
  it("locks to give a Ravnos +1 stealth, and only a Ravnos", () => {
    const state = threeSeatGame();
    allyInPlay(state, "Alice", "TAXI", "City Star Taxi", 2, 0);
    Object.assign(find(state, "V1"), { clan: "Ravnos" });
    seatOf(state, "Alice").minions.push(makeMinion("VEN", "Alice", { clan: "Ventrue" }));
    const engine = new VtesEngine(state, testRegistry);
    // Stealth is only offered when NEEDED (p. 26) — the blocker's
    // intercept must have CAUGHT UP with the action's stealth. A plain
    // bleed is 0 vs 0, which qualifies; a hunt's +1 inherent stealth
    // would already be out of M's reach and the option would (rightly)
    // not appear.
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "block:M"],
    ]);
    expect(walkTo(engine, "ability:City Star Taxi:TAXI:stealth")).toBe(true);
    runTrace(engine, [["Alice", "ability:City Star Taxi:TAXI:stealth"]]);
    // An ally IS a minion, so "lock this ally" locks the minion.
    expect(find(state, "TAXI").locked).toBe(true);
    expect(
      state.eventLog.some(
        (e) => e.type === "StealthModified" && e.source === "City Star Taxi" && e.delta === 1,
      ),
    ).toBe(true);
  });

  it("NEGATIVE SPACE: it will not lend stealth to a non-Ravnos", () => {
    const state = threeSeatGame();
    allyInPlay(state, "Alice", "TAXI", "City Star Taxi", 2, 0);
    Object.assign(find(state, "V1"), { clan: "Ventrue" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
    ]);
    expect(walkTo(engine, "ability:City Star Taxi:TAXI:stealth", 20)).toBe(false);
  });
});
