/**
 * Wave 118 — First Blood Tremere (docs/first-blood-tremere-design.md).
 *
 * Opens Tremere groups 4–5. Four vampires print an ability, plus the
 * retainer Charnas the Imp; every clause is tested in both directions.
 * Each crypt ability is the REAL compiled entry (`cryptEntry`).
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, currentIntercept } from "../../src/engine/index.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import { preconDeck, supportedPrecons } from "../../src/ui/deckimport";
import registry from "../../src/cards/registry.json";

const handlers = buildHandlerRegistry();

function seat(state: GameState, id: string) {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}
function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}
function must(state: GameState, id: string): MinionState {
  const m = find(state, id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}
function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}
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
const actionFrame = (s: GameState) => {
  const af = s.frames.find((f) => f.kind === "action");
  if (af?.kind !== "action") throw new Error("no action");
  return af;
};

// ---------------------------------------------------------------------------
// The group is open
// ---------------------------------------------------------------------------

describe("Tremere groups 4–5 are open", () => {
  const crypt = Object.values(
    (registry as { entries: Record<string, { card: { kind: string; name: string } }> }).entries,
  ).map((e) => e.card).filter((c) => c.kind === "crypt");

  it("admits every vampire First Blood Tremere's crypt names", () => {
    for (const n of [
      "Aidan Lyle (G5)", "Claus Wegener (G5)", "Muhsin Samir (G4)",
      "Rutor (G5)", "Troius (G4)", "Zane (G5)",
    ]) {
      expect(crypt.some((c) => c.name === n), n).toBe(true);
    }
  });

  it("puts First Blood Tremere in the chooser, as a labelled half deck", () => {
    const s = supportedPrecons().find((p) => p.set === "First Blood" && p.name === "Tremere");
    expect(s).toBeDefined();
    expect(s!.unsupported).toEqual([]);
    expect(s!.halfDeck).toBe(true);
    expect(preconDeck("First Blood", "Tremere", "A")!.crypt.length).toBe(s!.cryptCount);
  });
});

// ---------------------------------------------------------------------------
// Aidan Lyle and Troius's strength — flat statics with long-tested readers
// ---------------------------------------------------------------------------

describe("Aidan Lyle and Troius — the flat statics", () => {
  it("Aidan's entry carries 1 optional press each combat, and nothing else", () => {
    expect(handlers["Aidan Lyle (G5)"]!.cryptEntry!().statics).toEqual({ pressPerCombat: 1 });
  });
  it("Troius's entry carries +1 strength and the blood hunt vote bar", () => {
    expect(handlers["Troius (G4)"]!.cryptEntry!().statics).toEqual({
      cannotVoteAgainstBloodHunt: true,
      strength: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Rutor — Tzimisce get −1 intercept against him
// ---------------------------------------------------------------------------

describe("Rutor — Tzimisce get -1 intercept against Rutor", () => {
  /** Alice's V1 (Rutor) bleeds Bob. W is a Tzimisce with 1 intercept, M a
   *  Ventrue with 1 intercept — built here, because the pool has no
   *  Tzimisce. */
  function bleed(rutor: boolean) {
    const state = threeSeatGame();
    if (rutor) asVampire(must(state, "V1"), "Rutor (G5)");
    const plus1: PermanentInPlay = {
      card: { id: "i1", name: "Intercept Gear" }, locked: false, usedThisPhase: false,
      statics: { intercept: 1 }, tags: [],
    };
    Object.assign(must(state, "W"), { clan: "Tzimisce" });
    must(state, "W").attached.push(plus1);
    Object.assign(must(state, "M"), { clan: "Ventrue" });
    must(state, "M").attached.push({ ...plus1, card: { id: "i2", name: "Intercept Gear" } });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    const id = actionFrame(state).actionId;
    return { w: currentIntercept(state, id, "W"), m: currentIntercept(state, id, "M") };
  }

  it("a Tzimisce blocker loses 1 intercept; a Ventrue does not", () => {
    expect(bleed(true)).toEqual({ w: 0, m: 1 });
  });
  it("CONTROL: without Rutor, the Tzimisce keeps it", () => {
    expect(bleed(false)).toEqual({ w: 1, m: 1 });
  });
});

// ---------------------------------------------------------------------------
// Troius — no votes AGAINST a blood hunt
// ---------------------------------------------------------------------------

/** Every option any seat is offered until the stack is back to the turn,
 *  voting FOR where it can so the walk always ends. */
function allOffered(engine: VtesEngine, state: GameState, limit = 80): string[] {
  const seen: string[] = [];
  for (let i = 0; i < limit; i++) {
    if (state.frames.every((f) => f.kind === "turn")) return seen;
    const dp = engine.decision();
    if (!dp) return seen;
    for (const o of dp.options) seen.push(o.id);
    const pick =
      dp.options.find((o) => o.id.endsWith(":for")) ??
      dp.options.find((o) => o.id.startsWith("terms:")) ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "end") ??
      dp.options.find((o) => o.id.startsWith("choice:"));
    if (!pick) return seen;
    engine.choose(pick.id);
  }
  return seen;
}

describe("Troius — cannot cast votes or ballots against blood hunt referendums", () => {
  /** Alice's V1 diablerizes Bob's torpid W, calling a blood hunt. Carol's
   *  N is a prince with votes. */
  function bloodHunt(troius: boolean): string[] {
    const state = threeSeatGame();
    Object.assign(must(state, "V1"), { sect: "anarch", capacity: 6, blood: 4 });
    Object.assign(must(state, "W"), { inTorpor: true, blood: 1, capacity: 3 });
    const n = must(state, "N");
    n.title = "prince";
    if (troius) asVampire(n, "Troius (G4)");
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("diablerize:V1:W");
    return allOffered(engine, state);
  }

  it("offers his votes FOR the blood hunt and never AGAINST", () => {
    const seen = bloodHunt(true);
    expect(seen).toContain("vote:N:for");
    expect(seen).not.toContain("vote:N:against");
  });
  it("CONTROL: the same prince without Troius's text can vote against", () => {
    expect(bloodHunt(false)).toContain("vote:N:against");
  });
  it("votes either way on a referendum that is not a blood hunt", () => {
    const state = threeSeatGame();
    asVampire(must(state, "V1"), "Benjamin Rose (G5)").title = "prince";
    const n = asVampire(must(state, "N"), "Troius (G4)");
    n.title = "prince";
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "act:Benjamin Rose (G5):V1:referendum:V1"]]);
    walk(engine, () => engine.decision()?.seat === "Carol" && ids(engine).some((i) => i.startsWith("vote:N")));
    expect(ids(engine)).toEqual(expect.arrayContaining(["vote:N:for", "vote:N:against"]));
  });
});

// ---------------------------------------------------------------------------
// Zane — receive and contest a prince's title
// ---------------------------------------------------------------------------

describe("Zane — a referendum to receive (and contest) the title held by a prince", () => {
  const CALL = "act:Zane (G5):V1:referendum:V1";
  /** Alice's V1 is Zane, a primogen. Bob's M is the Prince of Paris. */
  function setup(tweak: (s: GameState) => void = () => {}) {
    const state = threeSeatGame();
    const z = asVampire(must(state, "V1"), "Zane (G5)");
    Object.assign(z, { title: "primogen", sect: "camarilla" });
    Object.assign(must(state, "M"), { title: "prince", titleCity: "Paris", sect: "camarilla" });
    tweak(state);
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("passes: Zane becomes Prince of Paris, loses primogen, and the title is contested", () => {
    const { state, engine } = setup();
    expect(ids(engine)).toContain(CALL);
    runTrace(engine, [["Alice", CALL]]);
    const seen = allOffered(engine, state);
    // The terms named Bob's prince, and only him.
    expect(seen.filter((i) => i.startsWith("terms:"))).toEqual(["terms:M"]);
    const z = must(state, "V1");
    const m = must(state, "M");
    // p. 18: both claims to Paris are contested, so neither has the title.
    expect(z.titleContest).toEqual({ title: "prince", city: "Paris" });
    expect(m.titleContest).toEqual({ title: "prince", city: "Paris" });
    expect(z.title).toBeNull();
  });

  it("NEGATIVE SPACE: not offered with no prince in play", () => {
    const { engine } = setup((s) => { must(s, "M").title = null; });
    expect(ids(engine)).not.toContain(CALL);
  });
  it("NEGATIVE SPACE: not offered while Zane is himself a prince", () => {
    const { engine } = setup((s) => {
      Object.assign(must(s, "V1"), { title: "prince", titleCity: "Vienna" });
    });
    expect(ids(engine)).not.toContain(CALL);
  });
  it("does nothing if the prince is no longer one when it passes", () => {
    const { state, engine } = setup();
    runTrace(engine, [["Alice", CALL]]);
    walk(engine, () => ids(engine).includes("terms:M"));
    runTrace(engine, [["Alice", "terms:M"]]);
    must(state, "M").title = null;
    allOffered(engine, state);
    expect(must(state, "V1").title).toBe("primogen");
    expect(must(state, "V1").titleContest).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Charnas the Imp
// ---------------------------------------------------------------------------

describe("Charnas the Imp — employed onto any minion", () => {
  const PLAY = "play:Charnas the Imp:basic:V1:";
  function setup() {
    const state = threeSeatGame();
    Object.assign(must(state, "V1"), { clan: "Tremere", blood: 4 });
    seat(state, "Alice").hand.push({ id: "ch", name: "Charnas the Imp" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }
  const plays = (engine: VtesEngine) => ids(engine).filter((i) => i.startsWith(PLAY));

  it("offers every minion in play as the target", () => {
    const { engine } = setup();
    expect(plays(engine).sort()).toEqual(
      ["V1", "W", "M", "N"].map((t) => `${PLAY}${t}:ch`).sort(),
    );
  });
  it("NEGATIVE SPACE: a non-Tremere vampire is not offered the card", () => {
    const { state, engine } = setup();
    must(state, "V1").clan = "Ventrue";
    expect(ids(engine).some((i) => i.startsWith("play:Charnas"))).toBe(false);
  });
  it("on a rival's minion: a directed action, and Charnas lands there under Alice", () => {
    const { state, engine } = setup();
    runTrace(engine, [["Alice", `${PLAY}W:ch`]]);
    walk(engine, () => state.frames.some((f) => f.kind === "action"));
    expect(actionFrame(state).directed).toBe(true);
    expect(actionFrame(state).target).toBe("Bob");
    // Carol is not the target, so she is never offered a block.
    walk(engine, () => !state.frames.some((f) => f.kind === "action"), (s, o) => {
      expect(s === "Carol" && o.some((i) => i.startsWith("block:"))).toBe(false);
      return undefined;
    });
    const on = must(state, "W").attached.find((p) => p.card.name === "Charnas the Imp");
    expect(on).toBeDefined();
    expect(on!.controller).toBe("Alice");
    expect(on!.life).toBe(1);
  });
  it("on your own minion: the ordinary undirected employ action", () => {
    const { state, engine } = setup();
    runTrace(engine, [["Alice", `${PLAY}V1:ch`]]);
    walk(engine, () => state.frames.some((f) => f.kind === "action"));
    expect(actionFrame(state).directed).toBe(false);
    walk(engine, () => !state.frames.some((f) => f.kind === "action"));
    expect(must(state, "V1").attached.some((p) => p.card.name === "Charnas the Imp")).toBe(true);
  });
});

describe("Charnas the Imp — in play", () => {
  /** Charnas, played by Alice, already on Bob's W. */
  function onW() {
    const state = threeSeatGame();
    must(state, "W").attached.push({
      card: { id: "ch", name: "Charnas the Imp" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: { immuneToEmployerDamage: true },
      tags: ["demon"],
      life: 1,
    });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }
  const turnOf = (s: GameState) => {
    const tf = s.frames[0];
    return tf?.kind === "turn" ? `${tf.seat}:${tf.phase}` : "";
  };

  it("inflicts 1 damage on the employer in the EMPLOYER's unlock phase only", () => {
    const { state, engine } = onW();
    const before = must(state, "W").blood;
    // Alice's turn, then Bob's unlock: W takes 1 and mends it with 1 blood.
    walk(engine, () => turnOf(state) === "Bob:master");
    expect(must(state, "W").blood).toBe(before - 1);
    // NEGATIVE SPACE: Bob's M carries nothing and loses nothing.
    expect(must(state, "M").blood).toBe(threeSeatGame().seats[1]!.minions[1]!.blood);
  });

  it("is immune to damage from the employer, and not from anyone else", () => {
    const { state, engine } = onW();
    engine.burnRetainerLife("ch", 1, "W");
    expect(must(state, "W").attached.find((p) => p.card.id === "ch")?.life).toBe(1);
    engine.burnRetainerLife("ch", 1, "V1");
    expect(must(state, "W").attached.some((p) => p.card.id === "ch")).toBe(false);
  });

  it("when the employer is about to burn, Bob may move it to ANY minion — even Carol's", () => {
    const { state, engine } = onW();
    engine.burnMinion("W");
    expect(engine.decision()?.seat).toBe("Bob");
    const offered = ids(engine).filter((i) => i.startsWith("choice:Charnas the Imp:ch:moveOffBurned:"));
    expect(offered.sort()).toEqual(
      ["V1", "M", "N", "burn"].map((t) => `choice:Charnas the Imp:ch:moveOffBurned:${t}`).sort(),
    );
    runTrace(engine, [["Bob", "choice:Charnas the Imp:ch:moveOffBurned:N"]]);
    const on = must(state, "N").attached.find((p) => p.card.id === "ch");
    expect(on).toBeDefined();
    expect(on!.controller).toBe("Alice");
    expect(seat(state, "Alice").permanents.some((p) => p.card.id === "ch")).toBe(false);
  });

  it("burns with the employer when Bob lets it", () => {
    const { state, engine } = onW();
    engine.burnMinion("W");
    runTrace(engine, [["Bob", "choice:Charnas the Imp:ch:moveOffBurned:burn"]]);
    const inPlay = state.seats.some(
      (s) => s.permanents.some((p) => p.card.id === "ch") ||
        s.minions.some((m) => m.attached.some((p) => p.card.id === "ch")),
    );
    expect(inPlay).toBe(false);
    expect((seat(state, "Alice").ashHeap ?? []).some((c) => c.id === "ch")).toBe(true);
  });

  it("CONTROL: an ordinary retainer still just burns with its employer", () => {
    const { state, engine } = onW();
    must(state, "W").attached.push({
      card: { id: "fs", name: "Faithful Servant" }, controller: "Bob", owner: "Bob",
      locked: false, usedThisPhase: false, statics: {}, tags: ["mortal"], life: 1,
    });
    engine.burnMinion("W");
    expect(ids(engine).some((i) => i.includes(":fs:"))).toBe(false);
    expect(state.seats.some((s) => s.permanents.some((p) => p.card.id === "fs"))).toBe(false);
  });
});
