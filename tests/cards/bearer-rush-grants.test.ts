/**
 * Bearer rush grants (docs/bearer-rush-grants-design.md) — cards that let
 * their BEARER, or the minions they choose, enter combat as a Ⓓ action:
 * Scourge (101695), Templar (101952), Enrage (100647) and Bloodlust
 * (100222). The rush is the existing `permanent.rushGrant`; what differs is
 * who may take it, at whom, and how long the card stays.
 *
 * Plus the two defects the design found (§6): War of Ages refused a regent,
 * and Kaymakli Barrier's surcharge reached only built-in actions.
 */

import { describe, expect, it } from "vitest";
import type { ActionFrame, GameState, MinionState, PermanentStatics } from "../../src/engine/index.ts";
import { VtesEngine, currentStealth } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function seatOf(state: GameState, id: string) {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function turnFrame(state: GameState) {
  const tf = state.frames[0];
  if (!tf || tf.kind !== "turn") throw new Error("no turn frame");
  return tf;
}

/** The named seat's minion phase (threeSeatGame starts in Alice's). */
function minionPhase(seat: string, edit?: (s: GameState) => void): GameState {
  const state = threeSeatGame();
  turnFrame(state).seat = seat;
  edit?.(state);
  return state;
}

/** Put a card in play on a minion, as its play would. */
function attach(
  state: GameState,
  minionId: string,
  cardId: string,
  name: string,
  controller: string,
  statics: PermanentStatics = {},
  tags: string[] = [],
): void {
  find(state, minionId).attached.push({
    card: { id: cardId, name },
    controller,
    locked: false,
    usedThisPhase: false,
    statics,
    tags,
  });
}

const ENRAGE_SUPERIOR: PermanentStatics = {
  actionToll: { blood: 2, exempt: ["hunt", "enterCombat"] },
  burnAfterBearerAction: true,
};

const ids = (engine: VtesEngine): string[] => engine.decision()?.options.map((o) => o.id) ?? [];
const has = (engine: VtesEngine, prefix: string): boolean => ids(engine).some((i) => i.startsWith(prefix));
const inAction = (state: GameState) => () => state.frames.some((f) => f.kind === "action");
const settled = (state: GameState) => () =>
  !state.frames.some((f) => f.kind === "action" || f.kind === "combat" || f.kind === "cardPlay");

/** Answer `pass` until `done()` holds. A decision with no `pass` that is
 *  not `done` is a failure, never a silent stop. */
function passUntil(engine: VtesEngine, done: () => boolean, max = 60): void {
  for (let i = 0; i < max && !done(); i++) {
    const options = ids(engine);
    if (!options.includes("pass")) throw new Error(`no pass offered: ${options.join(", ")}`);
    engine.choose("pass");
  }
  expect(done()).toBe(true);
}

/** `passUntil` through a combat: `pass` first, then the plain hand strike
 *  and ending the press, which are the decisions combat cannot pass. */
function walkUntil(engine: VtesEngine, done: () => boolean, max = 80): void {
  for (let i = 0; i < max && !done(); i++) {
    const options = ids(engine);
    const pick = ["pass", "press:end", "strike:hand"].find((p) => options.includes(p));
    if (!pick) throw new Error(`nothing to walk: ${options.join(", ")}`);
    engine.choose(pick);
  }
  expect(done()).toBe(true);
}

/** Pass until `seat` holds the decision (an as-played window's impulse). */
function passTo(engine: VtesEngine, seat: string): void {
  for (let i = 0; i < 6 && engine.decision()?.seat !== seat; i++) engine.choose("pass");
  expect(engine.decision()?.seat).toBe(seat);
}

/** End the current turn: the minion phase's `end`, then `pass` through the
 *  phases after it, until the next seat's turn begins. */
function endTurn(engine: VtesEngine, state: GameState): void {
  const start = turnFrame(state).seat;
  for (let i = 0; i < 40 && turnFrame(state).seat === start; i++) {
    const options = ids(engine);
    const pick = ["end", "pass"].find((p) => options.includes(p));
    if (!pick) throw new Error(`cannot end the turn: ${options.join(", ")}`);
    engine.choose(pick);
  }
  expect(turnFrame(state).seat).not.toBe(start);
}

const actionFrame = (state: GameState): ActionFrame => {
  const af = [...state.frames].reverse().find((f) => f.kind === "action");
  if (!af || af.kind !== "action") throw new Error("no action frame");
  return af;
};

// ---------------------------------------------------------------------------
// Scourge — a referendum puts it on a vampire of the caller's sect
// ---------------------------------------------------------------------------

describe("Scourge (101695)", () => {
  /** V1 (Alice) is a Camarilla prince; W and N are Camarilla, M Sabbat. */
  function scourgeGame(edit?: (s: GameState) => void): { state: GameState; engine: VtesEngine } {
    const state = minionPhase("Alice", (s) => {
      Object.assign(find(s, "V1"), { title: "prince", sect: "camarilla" });
      find(s, "W").sect = "camarilla";
      find(s, "M").sect = "sabbat";
      find(s, "N").sect = "camarilla";
      seatOf(s, "Alice").hand.push({ id: "sc", name: "Scourge" });
      edit?.(s);
    });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }
  const termsOffered = (engine: VtesEngine) => () => has(engine, "terms:");
  const pass = (engine: VtesEngine, state: GameState, bearer: string): void => {
    runTrace(engine, [["Alice", "play:Scourge"]]);
    passUntil(engine, termsOffered(engine));
    runTrace(engine, [
      ["Alice", `terms:${bearer}`],
      ["Alice", "vote:V1:for"],
    ]);
    passUntil(engine, () => find(state, bearer).attached.some((p) => p.card.id === "sc"));
  };

  it("requires a titled vampire", () => {
    expect(has(scourgeGame().engine, "play:Scourge")).toBe(true);
    expect(has(scourgeGame((s) => (find(s, "V1").title = null)).engine, "play:Scourge")).toBe(false);
  });

  it("the terms are ready vampires of the CALLER's sect, the caller included", () => {
    const { engine } = scourgeGame();
    runTrace(engine, [["Alice", "play:Scourge"]]);
    passUntil(engine, termsOffered(engine));
    const terms = ids(engine).filter((i) => i.startsWith("terms:")).sort();
    expect(terms).toEqual(["terms:N", "terms:V1", "terms:W"]);
    // Not the Sabbat M.
    expect(terms).not.toContain("terms:M");
  });

  it("goes on the chosen vampire on a pass and UNLOCKS the caller", () => {
    const { state, engine } = scourgeGame();
    pass(engine, state, "W");
    expect(find(state, "W").attached.find((p) => p.card.id === "sc")!.controller).toBe("Alice");
    expect(find(state, "V1").locked).toBe(false);
  });

  it("can be put on the caller itself", () => {
    const { state, engine } = scourgeGame();
    pass(engine, state, "V1");
    expect(find(state, "V1").locked).toBe(false);
  });

  it("the bearer rushes a capacity-4 vampire or an ally, its own side too, at +1 stealth — never a capacity-5 vampire", () => {
    const state = minionPhase("Bob", (s) => {
      attach(s, "W", "sc", "Scourge", "Alice");
      find(s, "V1").capacity = 5;
      find(s, "N").capacity = 4;
      find(s, "M").capacity = 4;
      seatOf(s, "Alice").minions.push(makeAlly("A1", "Alice", 2));
    });
    const engine = new VtesEngine(state, testRegistry);
    expect(ids(engine)).toContain("act:Scourge:sc:rush:W:N");
    expect(ids(engine)).toContain("act:Scourge:sc:rush:W:A1");
    expect(ids(engine)).toContain("act:Scourge:sc:rush:W:M");
    expect(ids(engine)).not.toContain("act:Scourge:sc:rush:W:V1");
    // Only the bearer has it.
    expect(has(engine, "act:Scourge:sc:rush:M:")).toBe(false);
    engine.choose("act:Scourge:sc:rush:W:N");
    expect(currentStealth(state, actionFrame(state).actionId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Templar
// ---------------------------------------------------------------------------

describe("Templar (101952)", () => {
  function caller(edit: (v: MinionState) => void): VtesEngine {
    const state = minionPhase("Alice", (s) => {
      Object.assign(find(s, "V1"), { title: "regent", sect: "sabbat" });
      edit(find(s, "V1"));
      seatOf(s, "Alice").hand.push({ id: "te", name: "Templar" });
    });
    return new VtesEngine(state, testRegistry);
  }

  it("a regent can call it; an untitled or a non-Sabbat vampire cannot", () => {
    expect(has(caller(() => {}), "play:Templar")).toBe(true);
    expect(has(caller((v) => (v.title = null)), "play:Templar")).toBe(false);
    expect(has(caller((v) => Object.assign(v, { sect: "camarilla", title: "prince" })), "play:Templar")).toBe(false);
  });

  /** Bob's phase, Templar on his W (Sabbat); M Sabbat beside him. */
  function templarGame(edit?: (s: GameState) => void): { state: GameState; engine: VtesEngine } {
    const state = minionPhase("Bob", (s) => {
      attach(s, "W", "te", "Templar", "Bob");
      find(s, "W").sect = "sabbat";
      find(s, "M").sect = "sabbat";
      seatOf(s, "Carol").minions.push(makeAlly("A2", "Carol", 2));
      edit?.(s);
    });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("the rush is at another Methuselah's ready vampire — never your own, never an ally", () => {
    const { state, engine } = templarGame((s) => (find(s, "N").inTorpor = true));
    expect(ids(engine)).toContain("act:Templar:te:rush:W:V1");
    expect(ids(engine)).not.toContain("act:Templar:te:rush:W:M");
    expect(ids(engine)).not.toContain("act:Templar:te:rush:W:A2");
    expect(ids(engine)).not.toContain("act:Templar:te:rush:W:N");
    engine.choose("act:Templar:te:rush:W:V1");
    expect(currentStealth(state, actionFrame(state).actionId)).toBe(1);
  });

  it("two copies give two rushes after an unlock [RTR 20030519]", () => {
    const { state, engine } = templarGame((s) => attach(s, "W", "t2", "Templar", "Bob"));
    engine.choose("act:Templar:te:rush:W:N");
    walkUntil(engine, settled(state));
    find(state, "W").locked = false;
    expect(ids(engine)).not.toContain("act:Templar:te:rush:W:N");
    expect(ids(engine)).toContain("act:Templar:t2:rush:W:N");
  });

  it("the bearer can rush and then call the burn referendum in one turn [LSJ 20100909]", () => {
    const { state, engine } = templarGame();
    engine.choose("act:Templar:te:rush:W:N");
    walkUntil(engine, settled(state));
    find(state, "W").locked = false;
    expect(ids(engine)).toContain("act:Templar:te:vote:W");
  });

  it("the burn referendum is a Sabbat vampire's, not a Camarilla one's", () => {
    expect(ids(templarGame().engine)).toContain("act:Templar:te:vote:M");
    const camarilla = templarGame((s) => (find(s, "M").sect = "camarilla"));
    expect(ids(camarilla.engine)).not.toContain("act:Templar:te:vote:M");
  });
});

// ---------------------------------------------------------------------------
// Enrage
// ---------------------------------------------------------------------------

describe("Enrage (100647), inferior", () => {
  /** Alice's V1 has Presence; V2 is hers too, V3 hers and in torpor. */
  function enrageGame(): { state: GameState; engine: VtesEngine } {
    const state = minionPhase("Alice", (s) => {
      Object.assign(find(s, "V1"), { disciplines: { pre: "basic" }, blood: 3 });
      seatOf(s, "Alice").minions.push(makeMinion("V2", "Alice"));
      seatOf(s, "Alice").minions.push(makeMinion("V3", "Alice", { inTorpor: true }));
      seatOf(s, "Alice").hand.push({ id: "en", name: "Enrage" });
    });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }
  const targets = (engine: VtesEngine): string[] =>
    (engine.decision()?.options ?? [])
      .filter((o) => o.kind === "playCard" && o.name === "Enrage" && o.mode === "basic")
      .map((o) => (o.kind === "playCard" ? (o.params["target"] ?? "") : ""))
      .sort();

  it("goes on a vampire you control — the actor, or one in torpor — and nobody else's", () => {
    expect(targets(enrageGame().engine)).toEqual(["V1", "V2", "V3"]);
  });

  it("gives +1 strength and a rush at ANY minion, its own side included", () => {
    const { state, engine } = enrageGame();
    runTrace(engine, [["Alice", "play:Enrage:basic:V1:V2"]]);
    passUntil(engine, () => find(state, "V2").attached.some((p) => p.card.id === "en"));
    passUntil(engine, settled(state));
    const entry = find(state, "V2").attached.find((p) => p.card.id === "en")!;
    expect(entry.statics.strength).toBe(1);
    expect(entry.tags).toContain("inferior");
    expect(ids(engine)).toContain("act:Enrage:en:rush:V2:W");
    expect(ids(engine)).toContain("act:Enrage:en:rush:V2:N");
    expect(ids(engine)).toContain("act:Enrage:en:rush:V2:V1");
    // Only the bearer.
    expect(has(engine, "act:Enrage:en:rush:V1:")).toBe(false);
  });

  it("burns at the end of the turn", () => {
    const { state, engine } = enrageGame();
    runTrace(engine, [["Alice", "play:Enrage:basic:V1:V2"]]);
    passUntil(engine, settled(state));
    expect(find(state, "V2").attached.some((p) => p.card.id === "en")).toBe(true);
    endTurn(engine, state);
    expect(find(state, "V2").attached.some((p) => p.card.id === "en")).toBe(false);
  });

  it("a superior Enrage on the bearer grants no rush — the version is on the card", () => {
    const state = minionPhase("Bob", (s) => attach(s, "W", "es", "Enrage", "Alice", ENRAGE_SUPERIOR));
    expect(has(new VtesEngine(state, testRegistry), "act:Enrage:es:rush:")).toBe(false);
  });
});

describe("Enrage (100647), superior", () => {
  /** Bob's W carries a superior Enrage, an Archon (for a rush to be
   *  exempt) and a title, with Scourge in Bob's hand (a political action). */
  function tollGame(blood: number): VtesEngine {
    const state = minionPhase("Bob", (s) => {
      Object.assign(find(s, "W"), { blood, title: "prince", sect: "camarilla" });
      attach(s, "W", "es", "Enrage", "Alice", ENRAGE_SUPERIOR);
      attach(s, "W", "ar", "Archon", "Bob");
      seatOf(s, "Bob").hand.push({ id: "sc", name: "Scourge" });
    });
    return new VtesEngine(state, testRegistry);
  }

  it("with 2 blood to spare the bearer may bleed or call a referendum", () => {
    const engine = tollGame(3);
    expect(ids(engine)).toContain("bleed:W");
    expect(has(engine, "play:Scourge:basic:W")).toBe(true);
  });

  it("with 1 blood the bearer may only hunt or enter combat [ANK 20180327]", () => {
    const engine = tollGame(1);
    expect(ids(engine)).not.toContain("bleed:W");
    expect(has(engine, "play:Scourge:basic:W")).toBe(false);
    expect(ids(engine)).toContain("hunt:W");
    expect(ids(engine)).toContain("act:Archon:ar:rush:W:N");
    // The toll is the bearer's alone.
    expect(ids(engine)).toContain("bleed:M");
  });

  it("the bleed costs 2 blood at announcement, and the card burns after it", () => {
    const state = minionPhase("Bob", (s) => attach(s, "W", "es", "Enrage", "Alice", ENRAGE_SUPERIOR));
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("bleed:W");
    expect(find(state, "W").blood).toBe(1);
    passUntil(engine, settled(state));
    expect(find(state, "W").attached.some((p) => p.card.id === "es")).toBe(false);
  });

  it("a rush pays no toll", () => {
    const state = minionPhase("Bob", (s) => {
      attach(s, "W", "es", "Enrage", "Alice", ENRAGE_SUPERIOR);
      attach(s, "W", "ar", "Archon", "Bob");
    });
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("act:Archon:ar:rush:W:N");
    expect(find(state, "W").blood).toBe(3);
  });

  /** W plays an inferior Enrage on M while carrying a superior one. */
  function cancelGame(withIntervention: boolean): { state: GameState; engine: VtesEngine } {
    const state = minionPhase("Bob", (s) => {
      Object.assign(find(s, "W"), { disciplines: { pre: "basic" } });
      attach(s, "W", "es", "Enrage", "Alice", ENRAGE_SUPERIOR);
      seatOf(s, "Bob").hand.push({ id: "e2", name: "Enrage" });
      if (withIntervention) seatOf(s, "Alice").hand.push({ id: "di", name: "Direct Intervention" });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Bob", "play:Enrage:basic:W:M"]]);
    return { state, engine };
  }

  it("an action card cancelled as played pays no toll, and the Enrage stays [LSJ 20090208]", () => {
    const { state, engine } = cancelGame(true);
    passTo(engine, "Alice");
    const di = ids(engine).find((i) => i.startsWith("play:Direct Intervention"));
    expect(di).toBeDefined();
    engine.choose(di!);
    passUntil(engine, () => !state.frames.some((f) => f.kind === "cardPlay"));
    expect(find(state, "W").blood).toBe(3);
    expect(find(state, "W").locked).toBe(false);
    expect(find(state, "W").attached.some((p) => p.card.id === "es")).toBe(true);
  });

  it("the same card, not cancelled, pays the toll as it is announced", () => {
    const { state, engine } = cancelGame(false);
    passUntil(engine, inAction(state));
    expect(find(state, "W").blood).toBe(1);
  });

  it("does not burn on the action that put it in play — only on the bearer's next", () => {
    const state = minionPhase("Alice", (s) => {
      Object.assign(find(s, "V1"), { disciplines: { pre: "superior" }, blood: 4 });
      seatOf(s, "Alice").hand.push({ id: "en", name: "Enrage" });
    });
    const engine = new VtesEngine(state, testRegistry);
    // "Any vampire" — the acting vampire included.
    runTrace(engine, [["Alice", "play:Enrage:superior:V1:V1"]]);
    passUntil(engine, settled(state));
    expect(find(state, "V1").attached.some((p) => p.card.id === "en")).toBe(true);
    find(state, "V1").locked = false;
    engine.choose("hunt:V1");
    passUntil(engine, settled(state));
    expect(find(state, "V1").attached.some((p) => p.card.id === "en")).toBe(false);
  });

  it("is directed at a rival's vampire and undirected on your own", () => {
    const state = minionPhase("Alice", (s) => {
      Object.assign(find(s, "V1"), { disciplines: { pre: "superior" }, blood: 4 });
      seatOf(s, "Alice").hand.push({ id: "en", name: "Enrage" });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Enrage:superior:V1:W"]]);
    passUntil(engine, inAction(state));
    expect(actionFrame(state).directed).toBe(true);
    expect(actionFrame(state).target).toBe("Bob");
  });
});

// ---------------------------------------------------------------------------
// Bloodlust
// ---------------------------------------------------------------------------

describe("Bloodlust (100222)", () => {
  /** Alice's V1 (Presence, 2 blood), V2 and the ally A1. */
  function bloodlustGame(edit?: (s: GameState) => void): { state: GameState; engine: VtesEngine } {
    const state = minionPhase("Alice", (s) => {
      Object.assign(find(s, "V1"), { disciplines: { pre: "basic" }, blood: 2 });
      seatOf(s, "Alice").minions.push(makeMinion("V2", "Alice"), makeAlly("A1", "Alice", 2));
      seatOf(s, "Alice").hand.push({ id: "bl", name: "Bloodlust" });
      edit?.(s);
    });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }
  const xs = (engine: VtesEngine, mode: string): string[] =>
    (engine.decision()?.options ?? [])
      .filter((o) => o.kind === "playCard" && o.name === "Bloodlust" && o.mode === mode)
      .map((o) => (o.kind === "playCard" ? (o.params["xBlood"] ?? "") : ""));
  const inPlay = (state: GameState) => seatOf(state, "Alice").permanents.find((p) => p.card.id === "bl");

  it("one play per X, capped by the actor's blood and by the minions there are to choose", () => {
    expect(xs(bloodlustGame().engine, "basic")).toEqual(["0", "1", "2"]);
    // Alone, V1 has one minion to choose.
    const alone = bloodlustGame((s) => (seatOf(s, "Alice").minions = [find(s, "V1")]));
    expect(xs(alone.engine, "basic")).toEqual(["0", "1"]);
    // Superior chooses X+1.
    const sup = bloodlustGame((s) => {
      find(s, "V1").disciplines = { pre: "superior" };
      seatOf(s, "Alice").minions = [find(s, "V1"), find(s, "V2")];
    });
    expect(xs(sup.engine, "superior")).toEqual(["0", "1"]);
  });

  it("asks for the minions BEFORE the card is played — your own only — and pays X on success", () => {
    const { state, engine } = bloodlustGame();
    engine.choose("play:Bloodlust:basic:V1:1:bl");
    expect(engine.decision()?.seat).toBe("Alice");
    expect(ids(engine).sort()).toEqual([
      "choice:Bloodlust:bl:prePlayPick:A1",
      "choice:Bloodlust:bl:prePlayPick:V1",
      "choice:Bloodlust:bl:prePlayPick:V2",
    ]);
    // Nothing has happened yet: the card is still in hand.
    expect(seatOf(state, "Alice").hand.some((c) => c.id === "bl")).toBe(true);
    engine.choose("choice:Bloodlust:bl:prePlayPick:V2");
    expect(seatOf(state, "Alice").hand.some((c) => c.id === "bl")).toBe(false);
    passUntil(engine, inAction(state));
    expect(find(state, "V1").blood).toBe(2);
    passUntil(engine, () => inPlay(state) !== undefined);
    expect(inPlay(state)!.chosenMinions).toEqual(["V2"]);
    expect(find(state, "V1").blood).toBe(1);
  });

  it("superior with X = 0 chooses one minion for free", () => {
    const { state, engine } = bloodlustGame((s) => (find(s, "V1").disciplines = { pre: "superior" }));
    engine.choose("play:Bloodlust:superior:V1:0:bl");
    engine.choose("choice:Bloodlust:bl:prePlayPick:A1");
    passUntil(engine, () => inPlay(state) !== undefined);
    expect(inPlay(state)!.chosenMinions).toEqual(["A1"]);
    expect(find(state, "V1").blood).toBe(2);
  });

  it("a blocked Bloodlust pays nothing and does not enter play", () => {
    const { state, engine } = bloodlustGame((s) => {
      attach(s, "W", "ey", "Eyes", "Bob", { intercept: 1 });
      find(s, "W").strength = 0;
    });
    engine.choose("play:Bloodlust:basic:V1:2:bl");
    engine.choose("choice:Bloodlust:bl:prePlayPick:V2");
    engine.choose("choice:Bloodlust:bl:prePlayPick:A1");
    for (let i = 0; i < 20 && !ids(engine).includes("block:W"); i++) engine.choose("pass");
    engine.choose("block:W");
    walkUntil(engine, settled(state));
    expect(find(state, "V1").blood).toBe(2);
    expect(inPlay(state)).toBeUndefined();
  });

  /** Bloodlust already in play, having chosen V2 and A1. */
  function inPlayGame(): { state: GameState; engine: VtesEngine } {
    const { state } = bloodlustGame((s) => {
      seatOf(s, "Alice").hand = [];
      seatOf(s, "Alice").permanents.push({
        card: { id: "bl", name: "Bloodlust" },
        controller: "Alice",
        locked: false,
        usedThisPhase: false,
        statics: { burnAtEndOfTurn: true, chosenPressPerCombat: 1 },
        tags: ["Bloodlust"],
        chosenMinions: ["V2", "A1"],
      });
    });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("each chosen minion may rush any minion; an unchosen one may not", () => {
    const { engine } = inPlayGame();
    expect(ids(engine)).toContain("act:Bloodlust:bl:rush:V2:W");
    expect(ids(engine)).toContain("act:Bloodlust:bl:rush:A1:N");
    expect(ids(engine)).toContain("act:Bloodlust:bl:rush:V2:V1");
    expect(has(engine, "act:Bloodlust:bl:rush:V1:")).toBe(false);
  });

  it("a chosen minion gets an optional press in its combat; the other side does not", () => {
    const { state, engine } = inPlayGame();
    engine.choose("act:Bloodlust:bl:rush:V2:W");
    passUntil(engine, () => state.frames.some((f) => f.kind === "combat"));
    const cf = state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat");
    expect(cf.pressesCombat.acting).toBe(1);
    expect(cf.pressesCombat.opposing).toBe(0);
  });

  it("burns at the end of the turn", () => {
    const { state, engine } = inPlayGame();
    endTurn(engine, state);
    expect(inPlay(state)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Meditative Grove sees frenzy ACTION cards (owner ruling 2026-10-28)
// ---------------------------------------------------------------------------

describe("Meditative Grove against frenzy action cards", () => {
  /** Carol holds the Grove; her N is a Salubri unless `salubri` is false. */
  function groveGame(card: string, play: string, salubri = true): { state: GameState; engine: VtesEngine } {
    const state = minionPhase("Bob", (s) => {
      Object.assign(find(s, "W"), { disciplines: { pre: "superior", ani: "superior" } });
      find(s, "N").clan = salubri ? "Salubri" : null;
      seatOf(s, "Bob").hand.push({ id: "fz", name: card });
      seatOf(s, "Carol").permanents.push({
        card: { id: "L1", name: "Meditative Grove" },
        controller: "Carol",
        locked: false,
        usedThisPhase: false,
        statics: {},
        tags: ["location", "huntingGround"],
      });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Bob", play]]);
    passTo(engine, "Carol");
    return { state, engine };
  }

  it("cancels Enrage put on a Salubri you control, and the location locks", () => {
    const { state, engine } = groveGame("Enrage", "play:Enrage:superior:W:N");
    expect(ids(engine)).toContain("ability:Meditative Grove:L1:cancel");
    engine.choose("ability:Meditative Grove:L1:cancel");
    passUntil(engine, settled(state));
    expect(find(state, "N").attached.some((p) => p.card.id === "fz")).toBe(false);
    expect(find(state, "W").locked).toBe(false);
    expect(seatOf(state, "Carol").permanents[0]!.locked).toBe(true);
  });

  it("is not offered when the vampire is not a Salubri", () => {
    const { engine } = groveGame("Enrage", "play:Enrage:superior:W:N", false);
    expect(has(engine, "ability:Meditative Grove")).toBe(false);
  });

  it("now reaches Deep Song superior entering combat with a Salubri", () => {
    const { engine } = groveGame("Deep Song", "play:Deep Song:superior:W:N");
    expect(ids(engine)).toContain("ability:Meditative Grove:L1:cancel");
  });

  it("cancelling your own Bloodlust still pays its X blood (the Grove's \"cost is still paid\")", () => {
    const state = minionPhase("Carol", (s) => {
      Object.assign(find(s, "N"), { clan: "Salubri", disciplines: { pre: "basic" }, blood: 3 });
      seatOf(s, "Carol").hand.push({ id: "bl", name: "Bloodlust" });
      seatOf(s, "Carol").permanents.push({
        card: { id: "L1", name: "Meditative Grove" },
        controller: "Carol",
        locked: false,
        usedThisPhase: false,
        statics: {},
        tags: ["location", "huntingGround"],
      });
    });
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("play:Bloodlust:basic:N:1:bl");
    engine.choose("choice:Bloodlust:bl:prePlayPick:N");
    expect(engine.decision()?.seat).toBe("Carol");
    engine.choose("ability:Meditative Grove:L1:cancel");
    passUntil(engine, settled(state));
    expect(find(state, "N").blood).toBe(2);
    expect(find(state, "N").locked).toBe(false);
    expect(seatOf(state, "Carol").permanents.some((p) => p.card.id === "bl")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The two defects (design §6)
// ---------------------------------------------------------------------------

describe("Kaymakli Barrier reaches every directed action", () => {
  const KAYMAKLI: PermanentStatics = { cannotBlockUndirected: true, directedActionBloodTax: 1 };

  it("a granted directed rush pays the extra blood; an undirected one does not", () => {
    const directed = minionPhase("Bob", (s) => {
      attach(s, "W", "kb", "Kaymakli Barrier", "Alice", KAYMAKLI);
      attach(s, "W", "ar", "Archon", "Bob");
    });
    new VtesEngine(directed, testRegistry).choose("act:Archon:ar:rush:W:N");
    expect(find(directed, "W").blood).toBe(2);

    const own = minionPhase("Bob", (s) => {
      attach(s, "W", "kb", "Kaymakli Barrier", "Alice", KAYMAKLI);
      attach(s, "W", "ar", "Archon", "Bob");
    });
    new VtesEngine(own, testRegistry).choose("act:Archon:ar:rush:W:M");
    expect(find(own, "W").blood).toBe(3);
  });

  it("a directed action CARD pays it too", () => {
    const state = minionPhase("Bob", (s) => {
      Object.assign(find(s, "W"), { disciplines: { pre: "superior" } });
      attach(s, "W", "kb", "Kaymakli Barrier", "Alice", KAYMAKLI);
      seatOf(s, "Bob").hand.push({ id: "e2", name: "Enrage" });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Bob", "play:Enrage:superior:W:N"]]);
    passUntil(engine, inAction(state));
    expect(find(state, "W").blood).toBe(2);
  });
});

describe("War of Ages (102348) takes a regent", () => {
  function warOfAges(title: MinionState["title"]): VtesEngine {
    const state = minionPhase("Alice", (s) => {
      Object.assign(find(s, "V1"), { sect: "sabbat", title });
      seatOf(s, "Alice").hand.push({ id: "wa", name: "War of Ages" });
    });
    return new VtesEngine(state, testRegistry);
  }

  it("a regent with no other title can call it; an untitled vampire cannot", () => {
    expect(has(warOfAges("regent"), "play:War of Ages")).toBe(true);
    expect(has(warOfAges("bishop"), "play:War of Ages")).toBe(true);
    expect(has(warOfAges(null), "play:War of Ages")).toBe(false);
  });
});
