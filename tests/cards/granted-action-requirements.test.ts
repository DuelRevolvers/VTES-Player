/**
 * What an action REQUIRES, and what TYPE it is, when a card in play grants
 * it (docs/granted-action-requirements-design.md).
 *
 * §3: a granted action "is considered to be an action requiring the listed
 * clan" [LSJ 20080604] — the clans in the grant's sentence, never the
 * granting card's icon. §4: a political action is a type of action
 * whatever provided it (p. 24). §5: a card requiring a title requires that
 * title's sect (pp. 39–40, [LSJ 20080603]).
 *
 * Each payoff is tested beside the action that must NOT pay it.
 */

import { describe, expect, it } from "vitest";
import type { ActionFrame, GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { TITLE_SECT, VtesEngine, currentIntercept, viewFor } from "../../src/engine/index.ts";
import { buildHandlerRegistry, cardSpecs } from "../../src/cards/effects/cards.ts";
import registry from "../../src/cards/registry.json" with { type: "json" };
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

function inPlay(id: string, name: string, extra: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [], ...extra };
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function actionFrame(state: GameState): ActionFrame {
  const af = state.frames.find((f): f is ActionFrame => f.kind === "action");
  if (!af) throw new Error("no action frame");
  return af;
}

/** Walk preferring `pass`, then `end`, until an option with `prefix` is
 *  offered. A walker taking `options[0]` would play the board. */
function walkTo(engine: VtesEngine, prefix: string, limit = 40): boolean {
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

const RESOLVE: Array<[string, string]> = [
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolves
];

function succeeded(state: GameState): boolean {
  return state.eventLog.some((e) => e.type === "ActionResolved" && e.success);
}

// ---------------------------------------------------------------------------
// §3 — the requirement belongs to the GRANT
// ---------------------------------------------------------------------------

describe("a granted action requires the clan its grant lists [LSJ 20080604]", () => {
  /** Alice's V1 is a capacity-6 Hecata with 4 blood; H2 is a second Hecata
   *  with room for blood. `where` puts the granting card in play. */
  function hecataGame(where: (s: GameState) => void): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Hecata", capacity: 6, blood: 4 });
    state.seats[0]!.minions.push(makeMinion("H2", "Alice", { clan: "Hecata", blood: 1 }));
    where(state);
    return state;
  }
  const crypt = (s: GameState) =>
    s.seats[0]!.permanents.push(inPlay("L1", "Cappadocian Crypt", { tags: ["location"] }));
  const gate = (s: GameState) =>
    s.seats[0]!.permanents.push(inPlay("ga", "The Gate of Acheron", { counters: 1 }));
  const pit = (s: GameState) =>
    s.seats[0]!.permanents.push(
      inPlay("pit1", "Pit of Contemplation", {
        tags: ["Pit of Contemplation", "location"],
        counters: 1,
      }),
    );
  const anja = (s: GameState) =>
    s.seats[0]!.minions.push(
      asVampire(makeMinion("AN", "Alice", { clan: "Hecata", blood: 2 }), '"Mother" Anja Giovanni (G6)'),
    );

  it("Cappadocian Crypt pays after The Gate of Acheron's counter action", () => {
    const state = hecataGame((s) => (gate(s), crypt(s)));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "act:The Gate of Acheron:ga:counter:V1"], ...RESOLVE]);
    expect(actionFrame(state).grantRequires).toEqual({ clans: ["Hecata"] });
    expect(walkTo(engine, "ability:Cappadocian Crypt:L1:blood:", 3)).toBe(true);
  });

  it("…and after Pit of Contemplation's counter action", () => {
    const state = hecataGame((s) => (pit(s), crypt(s)));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "act:Pit of Contemplation:pit1:counter:V1"], ...RESOLVE]);
    expect(walkTo(engine, "ability:Cappadocian Crypt:L1:blood:", 3)).toBe(true);
  });

  it("NEGATIVE: the Gate's BURN action requires nothing, though the card is Hecata", () => {
    // "Vampires can burn this card" lists nobody. Reading the card's icon
    // instead of the grant would pay out here.
    const state = hecataGame((s) => {
      s.seats[1]!.permanents.push(inPlay("ga", "The Gate of Acheron", { counters: 1 }));
      crypt(s);
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "act:The Gate of Acheron:ga:burn:V1"], ...RESOLVE]);
    expect(state.seats[1]!.permanents).toEqual([]); // the burn really succeeded
    expect(walkTo(engine, "ability:Cappadocian Crypt", 20)).toBe(false);
  });

  it("NEGATIVE: a BLOCKED counter action pays nothing (the Crypt prints 'successful')", () => {
    const state = hecataGame((s) => {
      gate(s);
      crypt(s);
      // The counter action has +1 stealth; the blocker needs the intercept.
      find(s, "M").attached.push(inPlay("eq", "Sport Bike", { statics: { intercept: 2 } }));
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "act:The Gate of Acheron:ga:counter:V1"]]);
    expect(walkTo(engine, "block:M")).toBe(true);
    runTrace(engine, [["Bob", "block:M"]]);
    expect(walkTo(engine, "ability:Cappadocian Crypt", 60)).toBe(false);
    expect(state.eventLog.some((e) => e.type === "ActionResolved" && !e.success)).toBe(true);
  });

  it('"Mother" Anja Giovanni unlocks the Hecata who took the Gate\'s counter action', () => {
    const state = hecataGame((s) => (gate(s), anja(s)));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "act:The Gate of Acheron:ga:counter:V1"], ...RESOLVE]);
    expect(succeeded(state)).toBe(true);
    expect(walkTo(engine, 'choice:"Mother" Anja Giovanni (G6)', 3)).toBe(true);
  });

  it("NEGATIVE: Anja does not answer the Gate's burn action", () => {
    const state = hecataGame((s) => {
      s.seats[1]!.permanents.push(inPlay("ga", "The Gate of Acheron", { counters: 1 }));
      anja(s);
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "act:The Gate of Acheron:ga:burn:V1"], ...RESOLVE]);
    expect(succeeded(state)).toBe(true);
    expect(walkTo(engine, 'choice:"Mother" Anja', 20)).toBe(false);
  });

  it("Anja reads 'Hecata OR Oblivion' as a union: an Oblivion card with no Hecata icon", () => {
    // Until 0.11.54 the two lists were separate gates, so this never fired.
    const state = hecataGame(anja);
    Object.assign(find(state, "V1"), { disciplines: { obl: "superior" } });
    state.seats[0]!.hand.push({ id: "a0", name: "Umbrous Clutch" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Umbrous Clutch:basic:V1:W:a0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ...RESOLVE,
    ]);
    expect(handlers["Umbrous Clutch"]?.requiresClans?.() ?? []).not.toContain("Hecata");
    expect(succeeded(state)).toBe(true);
    expect(walkTo(engine, 'choice:"Mother" Anja Giovanni (G6)', 3)).toBe(true);
  });

  it("Keegan has no positive to build: no supported grant lists Gangrel", () => {
    // If one is admitted, this fails and asks for Keegan's positive. The
    // Hecata control proves the search finds grants at all.
    const grants = (clan: string) =>
      Object.values(registry.entries)
        .filter((e) => e.supported && e.card.kind === "library")
        .filter((e) =>
          new RegExp(`\\b${clan}\\b[^.]*\\bcan\\b[^.]*\\baction\\b`).test(e.card.cardText ?? ""),
        )
        .map((e) => e.card.name)
        .sort();
    expect(grants("Hecata")).toEqual(
      expect.arrayContaining(["Pit of Contemplation", "The Gate of Acheron"]),
    );
    expect(grants("Gangrel")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §4 — a granted political action is a political action (p. 24)
// ---------------------------------------------------------------------------

describe("a granted political action is political (p. 24)", () => {
  const base = (s: GameState) =>
    s.seats[0]!.permanents.push(inPlay("bfb", "Black Forest Base", { tags: ["location"] }));

  it("Aaradhya unlocks after Black Forest Base's referendum, and the bots see it as political", () => {
    const state = threeSeatGame();
    const v1 = asVampire(find(state, "V1"), "Aaradhya, The Callous Tyrant (G6)");
    Object.assign(v1, { sect: "sabbat", title: "cardinal", blood: 4 });
    base(state);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "act:Black Forest Base:bfb:referendum:V1"]]);
    expect(actionFrame(state).political).toBe(true);
    expect(viewFor(state, "Bob").action?.political).toBe(true);
    expect(walkTo(engine, "choice:Aaradhya", 30)).toBe(true);
  });

  it("NEGATIVE: Aaradhya does not unlock after the Gate's counter action", () => {
    const state = threeSeatGame();
    const v1 = asVampire(find(state, "V1"), "Aaradhya, The Callous Tyrant (G6)");
    Object.assign(v1, { clan: "Hecata", capacity: 6, sect: "sabbat", title: "cardinal", blood: 4 });
    state.seats[0]!.permanents.push(inPlay("ga", "The Gate of Acheron", { counters: 1 }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "act:The Gate of Acheron:ga:counter:V1"]]);
    expect(actionFrame(state).political).toBeUndefined();
    runTrace(engine, RESOLVE);
    expect(succeeded(state)).toBe(true);
    expect(walkTo(engine, "choice:Aaradhya", 20)).toBe(false);
  });

  it("Oluwafunmilayo gets +1 intercept against Masquerade Enforcement's burn referendum", () => {
    const state = threeSeatGame();
    find(state, "V1").sect = "camarilla";
    asVampire(find(state, "M"), "Oluwafunmilayo (G6)");
    state.seats[1]!.permanents.push(inPlay("me", "Masquerade Enforcement"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "act:Masquerade Enforcement:me:vote:V1"]]);
    expect(currentIntercept(state, actionFrame(state).actionId, "M")).toBe(1);
  });

  it("NEGATIVE: …and none against the Gate's counter action", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Hecata", capacity: 6 });
    asVampire(find(state, "M"), "Oluwafunmilayo (G6)");
    state.seats[0]!.permanents.push(inPlay("ga", "The Gate of Acheron", { counters: 1 }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "act:The Gate of Acheron:ga:counter:V1"]]);
    expect(currentIntercept(state, actionFrame(state).actionId, "M")).toBe(0);
  });

  it("Rebel gains 1 blood on blocking a granted political action by an untitled vampire", () => {
    const state = threeSeatGame();
    find(state, "V1").sect = "sabbat"; // untitled, so only "political" can trigger it
    base(state);
    const blocker = find(state, "M");
    blocker.blood = 2;
    blocker.attached.push(inPlay("r1", "Rebel", { tags: ["archetype", "Rebel"] }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "act:Black Forest Base:bfb:referendum:V1"]]);
    expect(walkTo(engine, "block:M")).toBe(true);
    runTrace(engine, [["Bob", "block:M"]]);
    expect(blocker.blood).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §5 — a required title requires its sect (pp. 39–40)
// ---------------------------------------------------------------------------

describe("a card requiring a title requires that title's sect (pp. 39–40)", () => {
  it("pins the table as the rulebook prints it", () => {
    expect(TITLE_SECT).toEqual({
      primogen: "camarilla",
      prince: "camarilla",
      justicar: "camarilla",
      innerCircle: "camarilla",
      baron: "anarch",
      bishop: "sabbat",
      archbishop: "sabbat",
      priscus: "sabbat",
      cardinal: "sabbat",
      regent: "sabbat",
    });
  });

  it("every titled card in the pool requires its titles' sects", () => {
    const titled = cardSpecs.filter((s) => (s.requiresTitle ?? []).length > 0);
    expect(titled.map((s) => s.name)).toEqual(
      expect.arrayContaining([
        "Open War",
        "Bait and Switch",
        "Revolutionary Council",
        "Childe of the Revolution",
        "Masquerade Enforcement",
      ]),
    );
    for (const s of titled) {
      const sects = handlers[s.name]?.requiresSects?.() ?? [];
      for (const t of s.requiresTitle!) expect(sects, s.name).toContain(TITLE_SECT[t]);
    }
    // The control: a card requiring neither title nor sect requires none.
    expect(handlers["Conditioning"]?.requiresSects?.()).toEqual([]);
  });

  it("Powerbase: Los Angeles unlocks an Anarch after discarding Open War", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "discard";
      tf.discardActionsLeft = 1;
    }
    const alice = state.seats[0]!;
    alice.hand = [{ id: "ow", name: "Open War" }];
    alice.library.push({ id: "lib1", name: "Conditioning" });
    alice.permanents.push(inPlay("la1", "Powerbase: Los Angeles", { tags: ["location"] }));
    alice.minions.push(Object.assign(makeMinion("AN", "Alice", { sect: "anarch" }), { locked: true }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "ability:Powerbase: Los Angeles:la1:action"],
      ["Alice", "discard:ow"],
    ]);
    expect(engine.decision()!.options.map((o) => o.id)).toContain(
      "choice:Powerbase: Los Angeles:la1:unlockAnarch:AN",
    );
  });

  it("Garibaldi-Meucci Museum offers Open War from the ash heap, and not a plain card", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn frame");
    Object.assign(tf, { phase: "unlock", unlockDone: true, unlockAbilitiesDone: false });
    const alice = state.seats[0]!;
    alice.permanents.push(inPlay("gm", "Garibaldi-Meucci Museum", { tags: ["location"] }));
    alice.hand = [{ id: "h1", name: "Conditioning" }];
    alice.ashHeap = [
      { id: "ow", name: "Open War" },
      { id: "a2", name: "Govern the Unaligned" }, // requires nothing
    ];
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "ability:Garibaldi-Meucci Museum:gm:exchange"]]);
    expect(engine.decision()!.options.map((o) => o.id)).toEqual([
      "choice:Garibaldi-Meucci Museum:gm:ashExchangeTake:ow",
    ]);
  });
});
