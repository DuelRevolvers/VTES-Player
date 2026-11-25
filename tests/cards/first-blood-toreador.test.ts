/**
 * Wave 119 — First Blood Toreador (docs/first-blood-toreador-design.md).
 *
 * Opens Toreador groups 4–5. Five vampires print an ability, plus the
 * library card Crocodile's Tongue; every clause is tested in both
 * directions. Each crypt ability is the REAL compiled entry (`cryptEntry`).
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, titleContestBloodCost } from "../../src/engine/index.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
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
/** Drive the game until `until` holds; `pick` may answer for a seat, else
 *  pass, then end, then the first option. */
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
    const id = pick(dp.seat, o) ?? o.find((x) => x === "pass") ?? o.find((x) => x === "end") ?? o[0]!;
    runTrace(engine, [[dp.seat, id]]);
  }
  throw new Error("condition never held");
}
/** Every option any seat is offered until the stack is back to the turn.
 *  `prefer` answers first; otherwise vote FOR, then terms, pass, end. */
function allOffered(
  engine: VtesEngine,
  state: GameState,
  prefer: (options: string[]) => string | undefined = () => undefined,
  limit = 120,
): string[] {
  const seen: string[] = [];
  for (let i = 0; i < limit; i++) {
    if (state.frames.every((f) => f.kind === "turn")) return seen;
    const dp = engine.decision();
    if (!dp) return seen;
    const o = dp.options.map((x) => x.id);
    seen.push(...o);
    const id =
      prefer(o) ??
      o.find((x) => x.endsWith(":for")) ??
      o.find((x) => x.startsWith("terms:")) ??
      o.find((x) => x === "pass") ??
      o.find((x) => x === "end") ??
      o.find((x) => x.startsWith("choice:"));
    if (!id) return seen;
    engine.choose(id);
  }
  return seen;
}
const actionFrame = (s: GameState) => {
  const af = s.frames.find((f) => f.kind === "action");
  if (af?.kind !== "action") throw new Error("no action");
  return af;
};

// ---------------------------------------------------------------------------
// The group is open
// ---------------------------------------------------------------------------

describe("Toreador groups 4–5 are open", () => {
  const crypt = Object.values(
    (registry as { entries: Record<string, { card: { kind: string; name: string } }> }).entries,
  ).map((e) => e.card).filter((c) => c.kind === "crypt");

  it("admits every vampire First Blood Toreador's crypt names", () => {
    for (const n of [
      "Epikasta Rigatos (G4)", "Gwendolyn Fleming (G5)", "Kateline Nadasdy (G4)",
      "Thomas De Lutrius (G4)", "Tyler McGill (G5)", "Vasily (G5)",
    ]) {
      expect(crypt.some((c) => c.name === n), n).toBe(true);
    }
  });

  it("puts First Blood Toreador in the chooser, as a labelled half deck", () => {
    const s = supportedPrecons().find((p) => p.set === "First Blood" && p.name === "Toreador");
    expect(s).toBeDefined();
    expect(s!.unsupported).toEqual([]);
    expect(s!.halfDeck).toBe(true);
    expect(preconDeck("First Blood", "Toreador", "A")!.crypt.length).toBe(s!.cryptCount);
  });
});

// ---------------------------------------------------------------------------
// Thomas De Lutrius — burn 1 pool after he goes to torpor
// ---------------------------------------------------------------------------

describe("Thomas De Lutrius — burn 1 pool after Thomas goes to torpor", () => {
  function leave(how: "torpor" | "burn", thomas = true, who = "V1") {
    const state = threeSeatGame();
    if (thomas) asVampire(must(state, "V1"), "Thomas De Lutrius (G4)");
    const engine = new VtesEngine(state, testRegistry);
    if (how === "torpor") engine.sendToTorpor(who);
    else engine.burnMinion(who);
    return seat(state, "Alice").pool;
  }
  it("Alice burns 1 pool when Thomas goes to torpor", () => {
    expect(leave("torpor")).toBe(9);
  });
  it("NEGATIVE SPACE: nothing when he is burned outright", () => {
    expect(leave("burn")).toBe(10);
  });
  it("NEGATIVE SPACE: nothing when another vampire goes to torpor", () => {
    expect(leave("torpor", true, "W")).toBe(10);
  });
  it("CONTROL: the same vampire without his text burns nothing", () => {
    expect(leave("torpor", false)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Tyler McGill — +1 vote after the Edge is burned; cannot block Nosferatu
// ---------------------------------------------------------------------------

describe("Tyler McGill — cannot block Nosferatu", () => {
  function blocks(actorClan: string, tyler = true): string[] {
    const state = threeSeatGame();
    must(state, "V1").clan = actorClan;
    if (tyler) asVampire(must(state, "W"), "Tyler McGill (G5)");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    // M (no text) can always block, so his option marks the block step.
    walk(engine, () => ids(engine).includes("block:M"));
    return ids(engine).filter((i) => i.startsWith("block:"));
  }
  it("is not offered a block against a Nosferatu", () => {
    const b = blocks("Nosferatu");
    expect(b).not.toContain("block:W");
    expect(b).toContain("block:M");
  });
  it("blocks a Ventrue as usual", () => {
    expect(blocks("Ventrue")).toContain("block:W");
  });
  it("CONTROL: without his text, the same vampire blocks a Nosferatu", () => {
    expect(blocks("Nosferatu", false)).toContain("block:W");
  });
});

describe("Tyler McGill — +1 vote after a Methuselah burns the Edge for a vote", () => {
  /** Alice's V1 (Benjamin Rose, a prince) calls a referendum; Carol's N is
   *  untitled Tyler. */
  function referendum(edge: string | null, tyler = true): string[] {
    const state = threeSeatGame();
    asVampire(must(state, "V1"), "Benjamin Rose (G5)").title = "prince";
    if (tyler) asVampire(must(state, "N"), "Tyler McGill (G5)");
    state.edge = edge;
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "act:Benjamin Rose (G5):V1:referendum:V1"]]);
    // Carol is asked BEFORE the Edge is burned too: record that separately.
    const seen: string[] = [];
    walk(engine, () => state.frames.some((f) => f.kind === "referendum" && f.step === "polling"));
    seen.push(...allOffered(engine, state, (o) => o.find((x) => x === "vote:edge:for")));
    return seen;
  }
  it("gets a vote once the Edge is burned", () => {
    expect(referendum("Alice")).toContain("vote:N:for");
  });
  it("any Methuselah's Edge counts — Bob's too", () => {
    expect(referendum("Bob")).toContain("vote:N:for");
  });
  it("NEGATIVE SPACE: no vote when nobody burns the Edge", () => {
    expect(referendum(null)).not.toContain("vote:N:for");
  });
  it("CONTROL: an untitled vampire without his text gets nothing from the Edge", () => {
    expect(referendum("Alice", false)).not.toContain("vote:N:for");
  });
});

// ---------------------------------------------------------------------------
// Vasily — contesting a title costs him +1 blood unless you have the Edge
// ---------------------------------------------------------------------------

describe("Vasily — contesting a title costs +1 blood unless you have the Edge", () => {
  /** Alice's V1 is Vasily, Prince of Prague; Carol's N is a second Prince
   *  of Prague, built here because the pool has none (§1). */
  function setup() {
    const state = threeSeatGame();
    const v = asVampire(must(state, "V1"), "Vasily (G5)");
    Object.assign(v, { title: "prince", titleCity: "Prague", blood: 3 });
    Object.assign(must(state, "N"), { title: "prince", titleCity: "Prague", blood: 3 });
    return state;
  }
  it("costs Vasily 2 blood, and his rival 1", () => {
    const state = setup();
    expect(titleContestBloodCost(state, must(state, "V1"))).toBe(2);
    expect(titleContestBloodCost(state, must(state, "N"))).toBe(1);
  });
  it("costs him 1 while Alice has the Edge, and 2 again when Bob has it", () => {
    const state = setup();
    state.edge = "Alice";
    expect(titleContestBloodCost(state, must(state, "V1"))).toBe(1);
    state.edge = "Bob";
    expect(titleContestBloodCost(state, must(state, "V1"))).toBe(2);
  });
  it("the contest is raised, and the pay option names and burns 2 blood", () => {
    const state = setup();
    const engine = new VtesEngine(state, testRegistry);
    // Entering the contest is a state check; drive to the first contest
    // choice Alice is asked.
    const v = must(state, "V1");
    expect(engine.decision()).toBeDefined();
    walk(engine, () => ids(engine).some((i) => i.startsWith("choice:") && i.includes(`:${v.id}:`) && i.endsWith(":pay")));
    const pay = engine.decision()!.options.find((o) => o.id.endsWith(":pay"))!;
    expect(pay.label).toContain("burns 2 blood");
    runTrace(engine, [["Alice", pay.id]]);
    expect(must(state, "V1").blood).toBe(1);
  });
  it("NEGATIVE SPACE: with 1 blood he cannot pay, and is offered only the yield", () => {
    const state = setup();
    must(state, "V1").blood = 1;
    const engine = new VtesEngine(state, testRegistry);
    walk(engine, () => ids(engine).some((i) => i.includes(":V1:") && i.endsWith(":yield")));
    expect(ids(engine).filter((i) => i.includes(":V1:"))).toEqual(
      ids(engine).filter((i) => i.includes(":V1:") && i.endsWith(":yield")),
    );
  });
});

// ---------------------------------------------------------------------------
// Kateline Nadasdy — burn 1 blood to force a non-acting vampire to abstain
// ---------------------------------------------------------------------------

describe("Kateline Nadasdy — force a non-acting vampire to abstain", () => {
  const USE = "ability:Kateline Nadasdy (G4):N:M";
  /** Alice's V1 (Benjamin Rose, a prince) calls a referendum. Bob's M is a
   *  prince with votes; Carol's N is Kateline. */
  function setup(tweak: (s: GameState) => void = () => {}) {
    const state = threeSeatGame();
    asVampire(must(state, "V1"), "Benjamin Rose (G5)").title = "prince";
    must(state, "M").title = "prince";
    asVampire(must(state, "N"), "Kateline Nadasdy (G4)");
    tweak(state);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "act:Benjamin Rose (G5):V1:referendum:V1"]]);
    return { state, engine };
  }
  const kateline = (o: string[]) => o.filter((i) => i.startsWith("ability:Kateline"));

  it("offers every vampire with a voice except the acting one", () => {
    const { state, engine } = setup();
    const seen = kateline(allOffered(engine, state, () => undefined));
    expect(seen).toContain(USE);
    expect(seen).not.toContain("ability:Kateline Nadasdy (G4):N:V1");
  });
  it("burns 1 of her blood, M abstains, and it is not offered again", () => {
    const { state, engine } = setup();
    const after: string[] = [];
    let used = false;
    allOffered(engine, state, (o) => {
      if (!used && o.includes(USE)) {
        used = true;
        return USE;
      }
      if (used) after.push(...o);
      return undefined;
    });
    expect(used).toBe(true);
    expect(must(state, "N").blood).toBe(1);
    expect(kateline(after)).toEqual([]);
    expect(after).not.toContain("vote:M:for");
  });
  it("works while she is in torpor — her rulings win over the ready-only rule", () => {
    const { state, engine } = setup((s) => { must(s, "N").inTorpor = true; });
    expect(kateline(allOffered(engine, state))).toContain(USE);
  });
  it("NEGATIVE SPACE: not with 0 blood", () => {
    const { state, engine } = setup((s) => { must(s, "N").blood = 0; });
    expect(kateline(allOffered(engine, state))).toEqual([]);
  });
  it("NEGATIVE SPACE: not during a blood hunt — it is not a political action", () => {
    const state = threeSeatGame();
    Object.assign(must(state, "V1"), { sect: "anarch", capacity: 6, blood: 4 });
    Object.assign(must(state, "W"), { inTorpor: true, blood: 1, capacity: 3 });
    must(state, "M").title = "prince";
    asVampire(must(state, "N"), "Kateline Nadasdy (G4)");
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("diablerize:V1:W");
    expect(kateline(allOffered(engine, state))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Epikasta Rigatos — the action card back to the library
// ---------------------------------------------------------------------------

describe("Epikasta Rigatos — move an action card she played back to the library", () => {
  function setup(card: string, epikasta = "V1") {
    const state = threeSeatGame();
    const v1 = must(state, "V1");
    v1.disciplines = { pre: "basic" };
    asVampire(must(state, epikasta), "Epikasta Rigatos (G4)");
    seat(state, "Alice").hand = [{ id: "a1", name: card }];
    const engine = new VtesEngine(state, testRegistry);
    return { state, engine };
  }
  const isUse = (i: string) => i.startsWith("ability:Epikasta");

  it("after an Enchant Kindred bleed, offers the card back; taking it shuffles it in", () => {
    const { state, engine } = setup("Enchant Kindred");
    const play = ids(engine).find((i) => i.startsWith("play:Enchant Kindred:"));
    expect(play).toBeDefined();
    runTrace(engine, [["Alice", play!]]);
    let took = false;
    allOffered(engine, state, (o) => {
      const u = o.find(isUse);
      if (u) took = true;
      return u;
    });
    expect(took).toBe(true);
    expect(seat(state, "Alice").library.map((c) => c.id)).toContain("a1");
    expect((seat(state, "Alice").ashHeap ?? []).map((c) => c.id)).not.toContain("a1");
  });
  it("NEGATIVE SPACE: nothing after a plain bleed — there is no card", () => {
    const { state, engine } = setup("Enchant Kindred");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(allOffered(engine, state).some(isUse)).toBe(false);
  });
  it("NEGATIVE SPACE: nothing for a political action card", () => {
    const { state, engine } = setup("Kine Resources Contested");
    const play = ids(engine).find((i) => i.startsWith("play:Kine Resources Contested:"));
    expect(play).toBeDefined();
    runTrace(engine, [["Alice", play!]]);
    expect(allOffered(engine, state).some(isUse)).toBe(false);
  });
  it("NEGATIVE SPACE: nothing when another of Alice's vampires is the actor", () => {
    const { state, engine } = setup("Enchant Kindred", "V1");
    // Epikasta's text sits on V1; a second Alice vampire V2 bleeds.
    seat(state, "Alice").minions.push({ ...must(state, "V1"), id: "V2", name: "V2", attached: [] });
    runTrace(engine, [["Alice", "play:Enchant Kindred:basic:V2"]]);
    expect(allOffered(engine, state).some(isUse)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Crocodile's Tongue
// ---------------------------------------------------------------------------

describe("Crocodile's Tongue — an ally or younger vampire's block fails, and their Methuselah's", () => {
  /** Alice's V1 (Auspex, capacity 5) bleeds Bob; Bob's M attempts to block. */
  function setup(
    level: "basic" | "superior",
    tweak: (s: GameState) => void = () => {},
    blocker = "M",
  ) {
    const state = threeSeatGame();
    Object.assign(must(state, "V1"), { disciplines: { aus: level }, blood: 4 });
    Object.assign(must(state, "M"), { capacity: 4, blood: 2 });
    seat(state, "Alice").hand = [{ id: "ct", name: "Crocodile's Tongue" }];
    tweak(state);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    walk(engine, () => ids(engine).includes(`block:${blocker}`));
    runTrace(engine, [["Bob", `block:${blocker}`]]);
    walk(engine, () => engine.decision()?.seat === "Alice");
    return { state, engine };
  }
  const playId = (engine: VtesEngine, level: "basic" | "superior" = "basic") =>
    ids(engine).find((i) => i.startsWith(`play:Crocodile's Tongue:${level}:`));

  it("the attempt fails, and Bob can block with nobody else", () => {
    const { state, engine } = setup("basic");
    runTrace(engine, [["Alice", playId(engine)!]]);
    const seen: string[] = [];
    walk(
      engine,
      () => !state.frames.some((f) => f.kind === "blockAttempt" || f.kind === "cardPlay"),
      (_s, o) => { seen.push(...o); return undefined; },
    );
    expect(seen).toContain("cancelpay:ct");
    expect(actionFrame(state).blockRestrictions.cannotBlockSeats).toEqual(["Bob"]);
    // W was never barred by name — only the seat bar keeps it out.
    expect(actionFrame(state).blockRestrictions.cannotBlock).toEqual(["M"]);
    expect(allOffered(engine, state).filter((i) => i.startsWith("block:"))).toEqual([]);
  });
  it("CONTROL: without the card, Bob's W is offered the block", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    walk(engine, () => ids(engine).includes("block:W"));
    expect(ids(engine)).toContain("block:W");
  });
  it("is offered against a blocking ally, whatever its life", () => {
    const { engine } = setup(
      "basic",
      (s) => { seat(s, "Bob").minions.push(makeAlly("A", "Bob", 6)); },
      "A",
    );
    expect(playId(engine)).toBeDefined();
    runTrace(engine, [["Alice", playId(engine)!]]);
    walk(engine, () => ids(engine).includes("cancelpay:ct"));
    expect(engine.decision()!.options.find((o) => o.id === "cancelpay:ct")!.label).toContain("1 life");
  });
  it("NEGATIVE SPACE: not against an older vampire", () => {
    const { engine } = setup("basic", (s) => { must(s, "M").capacity = 6; });
    expect(playId(engine)).toBeUndefined();
  });
  it("NEGATIVE SPACE: not against a vampire of the same capacity", () => {
    const { engine } = setup("basic", (s) => { must(s, "M").capacity = 5; });
    expect(playId(engine)).toBeUndefined();
  });
  it("Bob's M burns 1 blood to cancel it: the block goes on", () => {
    const { state, engine } = setup("basic");
    runTrace(engine, [["Alice", playId(engine)!]]);
    walk(engine, () => ids(engine).includes("cancelpay:ct"));
    runTrace(engine, [["Bob", "cancelpay:ct"]]);
    expect(must(state, "M").blood).toBe(1);
    expect(actionFrame(state).blockRestrictions.cannotBlockSeats).toBeUndefined();
  });
  it("superior: the cancel costs 2, so a 1-blood blocker cannot pay", () => {
    const one = setup("superior", (s) => { must(s, "M").blood = 1; });
    runTrace(one.engine, [["Alice", playId(one.engine, "superior")!]]);
    expect(allOffered(one.engine, one.state)).not.toContain("cancelpay:ct");
    const two = setup("superior");
    runTrace(two.engine, [["Alice", playId(two.engine, "superior")!]]);
    walk(two.engine, () => ids(two.engine).includes("cancelpay:ct"));
    runTrace(two.engine, [["Bob", "cancelpay:ct"]]);
    expect(must(two.state, "M").blood).toBe(0);
  });
});
