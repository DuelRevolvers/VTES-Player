/**
 * The library audit (docs/library-audit.md) — 2026-09-03.
 *
 * A sweep of all 444 supported library cards looking for the two failure
 * shapes this project keeps finding: a clause written off as "moot for
 * now" whose note went stale, and a card marked supported that no test
 * ever exercises.
 *
 * It found one live rules bug (Aggressive Corpse, three clauses, one of
 * them reachable by Entrancement), one targeting hole (`stealMinionOnSuccess`
 * never asked `untargetableBy`), and two supported cards with no test at
 * all. This file closes all four, and the last `describe` is the standing
 * guard that stops the coverage half regressing.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Answer the quietest way until `prefix` appears. `pass`, then `end`,
 *  then anything — a walker that takes the first option plays the board. */
function walkTo(engine: VtesEngine, prefix: string, limit = 120): boolean {
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

/** An Aggressive Corpse in play under `seat`, with its real statics. */
function corpse(id: string, seat: string): MinionState {
  const ally = makeAlly(id, seat, 3, { name: "Aggressive Corpse", strength: 2, bleedAmount: 0 });
  ally.attached.push({
    card: { id, name: "Aggressive Corpse" },
    controller: seat,
    owner: seat,
    locked: false,
    usedThisPhase: false,
    statics: {
      untargetableByDisciplines: ["dom", "pre"],
      strikesUndodgeable: true,
      cannotGainLife: true,
    },
    tags: ["zombie"],
  });
  return ally;
}

describe("Aggressive Corpse (102286) — the three clauses the audit found", () => {
  it("cannot be the target of a [PRE] steal (Entrancement superior)", () => {
    const state = threeSeatGame();
    // Bob controls the corpse AND a plain ally, so the option list can be
    // compared: one is a legal target and the other is not.
    state.seats[1]!.minions.push(corpse("AC", "Bob"));
    state.seats[1]!.minions.push(makeAlly("PA", "Bob", 3, { name: "Plain Ally" }));
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pre: "superior" };
    v1.blood = 5;
    state.seats[0]!.hand.push({ id: "en1", name: "Entrancement" });
    const engine = new VtesEngine(state, testRegistry);

    expect(walkTo(engine, "play:Entrancement:superior")).toBe(true);
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Entrancement:superior"));
    // The control: the ordinary ally IS offered, so an empty result for
    // the corpse is empty for the RIGHT reason.
    expect(ids.some((o) => o.includes("PA"))).toBe(true);
    expect(ids.some((o) => o.includes("AC"))).toBe(false);
  });

  it("the bar is keyed on the CARD's Discipline, not the actor's", () => {
    // A vampire who happens to have Presence, playing a card that does NOT
    // require it, is not barred. Hunter's Mark is [cel]/[tha] and targets a
    // minion, so it is the clean opposite of Entrancement.
    const state = threeSeatGame();
    state.seats[1]!.minions.push(corpse("AC", "Bob"));
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pre: "superior", cel: "basic", tha: "basic" };
    v1.blood = 5;
    state.seats[0]!.hand.push({ id: "hm1", name: "Hunter's Mark" });
    const engine = new VtesEngine(state, testRegistry);
    expect(walkTo(engine, "play:Hunter's Mark")).toBe(true);
    expect(optionIds(engine).some((o) => o.startsWith("play:Hunter's Mark") && o.includes("AC")))
      .toBe(true);
  });

  /**
   * Rush Bob's W with the corpse, have W dodge, have the corpse hand
   * strike, and report how much blood W lost. `undodgeable` toggles the
   * one static so the pair isolates exactly that field.
   */
  function dodgeDuel(undodgeable: boolean): number {
    const state = threeSeatGame();
    const ac = corpse("AC", "Alice");
    if (!undodgeable) delete ac.attached[0]!.statics.strikesUndodgeable;
    state.seats[0]!.minions.push(ac);
    const w = state.seats[1]!.minions[0]!;
    w.blood = 4;
    // W needs a real dodge card: `strike:dodge` is not a built-in option.
    w.disciplines = { ...w.disciplines, pro: "basic" };
    state.seats[1]!.hand.push({ id: "fm1", name: "Form of Mist" });
    const engine = new VtesEngine(state, testRegistry);
    const before = w.blood;

    // The corpse rushes "a minion" — ANY minion, its own side included —
    // so the target has to be named. Taking the first option sent it at
    // Alice's own vampire and quietly tested nothing.
    if (!walkTo(engine, "act:Aggressive Corpse")) {
      throw new Error("the corpse was never offered its rush");
    }
    const rush = optionIds(engine).find(
      (o) => o.startsWith("act:Aggressive Corpse") && o.endsWith(":W"),
    );
    if (!rush) throw new Error("no rush option naming W");
    runTrace(engine, [["Alice", rush]]);

    if (walkTo(engine, "play:Form of Mist", 40)) {
      const dp = engine.decision()!;
      runTrace(engine, [[dp.seat, optionIds(engine).find((o) => o.startsWith("play:Form of Mist"))!]]);
    }
    // Drive to the end of the round however the engine wants to get there.
    for (let i = 0; i < 60; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id === "press:end")) {
        runTrace(engine, [[dp.seat, "press:end"]]);
        break;
      }
      const pick =
        dp.options.find((o) => o.id === "strike:hand") ??
        dp.options.find((o) => o.id === "pass") ??
        dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
    }
    return before - find(state, "W").blood;
  }

  it("its strikes cannot be dodged — and the control proves the static is what does it", () => {
    // Paired, because a "damage happened" assertion on its own would pass
    // just as well if the dodge had never been played.
    const withStatic = dodgeDuel(true);
    const without = dodgeDuel(false);
    expect(withStatic).toBeGreaterThan(0);
    expect(without).toBe(0);
  });

  it("cannot gain life", () => {
    const state = threeSeatGame();
    const ac = corpse("AC", "Alice");
    ac.blood = 1;
    state.seats[0]!.minions.push(ac);
    const engine = new VtesEngine(state, testRegistry);
    engine.emit({ type: "BloodGained", minion: "AC", amount: 2 });
    expect(find(state, "AC").blood).toBe(1);
  });

  it("an ordinary ally DOES gain life — the control for the clause above", () => {
    const state = threeSeatGame();
    const plain = makeAlly("PL", "Alice", 3, { name: "Plain Ally" });
    plain.blood = 1;
    state.seats[0]!.minions.push(plain);
    const engine = new VtesEngine(state, testRegistry);
    engine.emit({ type: "BloodGained", minion: "PL", amount: 2 });
    expect(find(state, "PL").blood).toBe(3);
  });
});

describe("the two supported cards no test exercised", () => {
  /** Alice's V1 bleeds Bob. Bob holds `card` and has a primogen/Anarch. */
  function bleedAt(card: string, tweak: (s: GameState) => void): {
    state: GameState;
    engine: VtesEngine;
  } {
    const state = threeSeatGame();
    state.seats[1]!.hand.push({ id: "x1", name: card });
    tweak(state);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    return { state, engine };
  }

  it("Protected District reduces a bleed against you by 3", () => {
    const { state, engine } = bleedAt("Protected District", (s) => {
      s.seats[1]!.minions[0]!.title = "primogen";
    });
    expect(walkTo(engine, "play:Protected District")).toBe(true);
    // The variant rides AFTER the minion: play:<name>:<mode>:<minion>:<variant>:<card>
    const id = optionIds(engine).find(
      (o) => o.startsWith("play:Protected District") && o.includes(":reduce:"),
    )!;
    runTrace(engine, [["Bob", id]]);
    for (let i = 0; i < 30 && engine.decision(); i++) {
      const dp = engine.decision()!;
      const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
      if (state.eventLog.some((e) => e.type === "ActionResolved")) break;
    }
    // A 1-point bleed reduced by 3 transfers nothing.
    expect(state.eventLog.some((e) => e.type === "PoolBurned" && e.seat === "Bob")).toBe(false);
  });

  it("Protected District needs a primogen — the requirement is enforced", () => {
    // The `meetsRequirements` bug class: this card's line went unenforced
    // for a whole gate, and nothing asserted it.
    const { engine } = bleedAt("Protected District", (s) => {
      s.seats[1]!.minions[0]!.title = null;
    });
    expect(walkTo(engine, "play:Protected District", 40)).toBe(false);
  });

  it("Party Out Of Bounds [obf] reduces a bleed by 2, and needs an Anarch", () => {
    const { state, engine } = bleedAt("Party Out Of Bounds", (s) => {
      const w = s.seats[1]!.minions[0]!;
      w.sect = "anarch";
      w.disciplines = { ...w.disciplines, obf: "basic" };
    });
    expect(walkTo(engine, "play:Party Out Of Bounds")).toBe(true);
    const before = state.seats[1]!.pool;
    const id = optionIds(engine).find((o) => o.startsWith("play:Party Out Of Bounds"))!;
    runTrace(engine, [["Bob", id]]);
    for (let i = 0; i < 30 && engine.decision(); i++) {
      const dp = engine.decision()!;
      const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
      if (state.eventLog.some((e) => e.type === "ActionResolved")) break;
    }
    expect(state.seats[1]!.pool).toBe(before);
  });

  it("Party Out Of Bounds is not offered to a non-Anarch", () => {
    const { engine } = bleedAt("Party Out Of Bounds", (s) => {
      const w = s.seats[1]!.minions[0]!;
      w.sect = "camarilla";
      w.disciplines = { ...w.disciplines, obf: "basic" };
    });
    expect(walkTo(engine, "play:Party Out Of Bounds", 40)).toBe(false);
  });
});

describe("the coverage guard", () => {
  const entries = registry.entries as unknown as Record<
    string,
    { card: { id: number; name: string; kind: string }; supported: boolean }
  >;
  const supported = Object.values(entries).filter(
    (e) => e.card.kind === "library" && e.supported,
  );

  /** Every .ts file under tests/, concatenated. */
  function testCorpus(): string {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) walk(join(d, f.name));
        else if (f.name.endsWith(".ts")) files.push(join(d, f.name));
      }
    };
    walk(join(process.cwd(), "tests"));
    return files.map((f) => readFileSync(f, "utf-8")).join("\n");
  }

  it("every supported card is named by some test or fuzz deck", () => {
    // The project rule is that a card ships with a deterministic scenario
    // test. Eighteen cards were reaching support on a SIBLING's test —
    // defensible for pure data variants of one mechanic (eleven hunting
    // grounds, six lockGrant locations), and not something to discover by
    // accident a year later. They are in the fuzz decks now, so every
    // supported card is exercised by something, and this guard keeps it
    // that way (docs/library-audit.md §3).
    const corpus = testCorpus();
    const missing = supported.map((e) => e.card.name).filter((n) => !corpus.includes(n));
    expect(missing).toEqual([]);
  });
});
