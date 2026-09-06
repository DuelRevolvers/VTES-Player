/**
 * Hunting grounds and the other locations that feed blood
 * (docs/blood-locations-design.md).
 *
 * Carfax Abbey (100297), Papillon (101350), Meditative Grove (102252),
 * Cappadocian Crypt (102298), The Hungry Coyote (100945).
 *
 * Three of them finish the hunting-ground family (13 generic ones were
 * already supported off one mechanic); the other two answer the same
 * question — how blood reaches a vampire — from different windows.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { CITY_TITLES, VtesEngine } from "../../src/engine/index.ts";
import registry from "../../src/cards/registry.json" with { type: "json" };
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function must(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function location(
  id: string,
  name: string,
  extra: Partial<PermanentInPlay> = {},
): PermanentInPlay {
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["location"],
    ...extra,
  };
}

/** Alice's UNLOCK phase, with `card` in play and `unlockDone` still open —
 *  the window every hunting ground lives in. */
function unlockPhase(name: string, tweak: (s: GameState) => void = () => {}): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = "unlock";
    tf.unlockDone = false;
    tf.unlockAbilitiesDone = false;
  }
  state.seats[0]!.permanents.push(location("L1", name));
  tweak(state);
  return state;
}

/** Pass every decision until `done()`, or the budget runs out. */
function passUntil(
  engine: VtesEngine,
  state: GameState,
  done: () => boolean,
  limit = 40,
): void {
  for (let i = 0; i < limit && !done(); i++) {
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [
      [dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id],
    ]);
  }
  void state;
}

/** Which hunting-ground grants Alice is being offered right now. */
function grants(engine: VtesEngine, name: string): string[] {
  const dp = engine.decision();
  if (!dp) return [];
  return dp.options
    .filter((o) => o.id.startsWith(`ability:${name}:`))
    .map((o) => o.id.split(":").pop()!);
}

describe("city titles are DERIVED, not guessed", () => {
  it("only prince, baron and archbishop print \"of <city>\" in the V5 crypt", () => {
    const printed = new Set<string>();
    for (const e of Object.values(registry.entries)) {
      const c = e.card as { kind: string; cardText?: string };
      if (c.kind !== "crypt") continue;
      const first = (c.cardText ?? "").split("\n")[0] ?? "";
      const m = /^(?:Camarilla|Sabbat|Anarch|Independent)\s+(\w+) of /.exec(first);
      if (m) printed.add(m[1]!.toLowerCase());
    }
    expect([...printed].sort()).toEqual(["archbishop", "baron", "prince"]);
    expect([...CITY_TITLES].sort()).toEqual(["archbishop", "baron", "prince"]);
  });

  it("the titles that are NOT city titles never do", () => {
    // The negative space: a filter that matched nothing for the wrong
    // reason would look exactly like one that matched nothing correctly.
    for (const t of ["primogen", "bishop", "cardinal", "priscus", "justicar"]) {
      expect(CITY_TITLES).not.toContain(t);
    }
  });
});

describe("Carfax Abbey (100297)", () => {
  const anarchs = (s: GameState): void => {
    Object.assign(must(s, "V1"), { sect: "anarch", blood: 1 });
    s.seats[0]!.minions.push(
      makeMinion("V2", "Alice", { sect: "anarch", blood: 1 }),
      makeMinion("V3", "Alice", { sect: "camarilla", blood: 1 }),
    );
  };

  it("grants to Anarchs only", () => {
    const state = unlockPhase("Carfax Abbey", anarchs);
    const engine = new VtesEngine(state, testRegistry);
    expect(grants(engine, "Carfax Abbey").sort()).toEqual(["V1", "V2"]);
  });

  it("without a ready baron it is ONE grant per turn", () => {
    const state = unlockPhase("Carfax Abbey", anarchs);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "ability:Carfax Abbey:L1:V1"]]);
    expect(must(state, "V1").blood).toBe(2);
    expect(grants(engine, "Carfax Abbey")).toEqual([]);
  });

  it("with a ready baron a SECOND Anarch may gain, but never the same one", () => {
    const state = unlockPhase("Carfax Abbey", (s) => {
      anarchs(s);
      must(s, "V2").title = "baron";
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "ability:Carfax Abbey:L1:V1"]]);
    // V1 already used a hunting ground this turn, so only V2 is left.
    expect(grants(engine, "Carfax Abbey")).toEqual(["V2"]);
    runTrace(engine, [["Alice", "ability:Carfax Abbey:L1:V2"]]);
    expect(must(state, "V1").blood).toBe(2);
    expect(must(state, "V2").blood).toBe(2);
    expect(grants(engine, "Carfax Abbey")).toEqual([]);
  });

  it("a baron in TORPOR does not unlock the second grant", () => {
    const state = unlockPhase("Carfax Abbey", (s) => {
      anarchs(s);
      s.seats[0]!.minions.push(
        makeMinion("B", "Alice", { sect: "anarch", title: "baron", inTorpor: true }),
      );
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "ability:Carfax Abbey:L1:V1"]]);
    expect(grants(engine, "Carfax Abbey")).toEqual([]);
  });

  it("requires a ready Anarch to play at all", () => {
    const cam = threeSeatGame();
    const tf = cam.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    cam.seats[0]!.hand.push({ id: "c9", name: "Carfax Abbey" });
    must(cam, "V1").sect = "camarilla";
    const e1 = new VtesEngine(cam, testRegistry);
    expect(e1.decision()!.options.some((o) => o.id.startsWith("play:Carfax Abbey"))).toBe(
      false,
    );
    must(cam, "V1").sect = "anarch";
    const e2 = new VtesEngine(cam, testRegistry);
    expect(e2.decision()!.options.some((o) => o.id.startsWith("play:Carfax Abbey"))).toBe(
      true,
    );
  });
});

describe("Papillon (101350)", () => {
  it("grants 2 blood, and to ANY titled vampire — not only a city title", () => {
    const state = unlockPhase("Papillon", (s) => {
      Object.assign(must(s, "V1"), { title: "primogen", blood: 1 });
      s.seats[0]!.minions.push(
        makeMinion("V2", "Alice", { title: "prince", blood: 1 }),
        makeMinion("V3", "Alice", { blood: 1 }), // untitled
      );
    });
    const engine = new VtesEngine(state, testRegistry);
    expect(grants(engine, "Papillon").sort()).toEqual(["V1", "V2"]);
    runTrace(engine, [["Alice", "ability:Papillon:L1:V1"]]);
    expect(must(state, "V1").blood).toBe(3);
  });

  it("but PLAYING it needs a city title — a primogen is not enough", () => {
    const build = (title: string): GameState => {
      const s = threeSeatGame();
      const tf = s.frames[0]!;
      if (tf.kind === "turn") {
        tf.phase = "master";
        tf.masterActionsLeft = 1;
      }
      s.seats[0]!.hand.push({ id: "c9", name: "Papillon" });
      must(s, "V1").title = title as MinionState["title"];
      return s;
    };
    const primogen = new VtesEngine(build("primogen"), testRegistry);
    expect(primogen.decision()!.options.some((o) => o.id.startsWith("play:Papillon"))).toBe(
      false,
    );
    const prince = new VtesEngine(build("prince"), testRegistry);
    expect(prince.decision()!.options.some((o) => o.id.startsWith("play:Papillon"))).toBe(
      true,
    );
  });
});

describe("Meditative Grove (102252)", () => {
  it("is a Salubri hunting ground", () => {
    const state = unlockPhase("Meditative Grove", (s) => {
      Object.assign(must(s, "V1"), { clan: "Salubri", blood: 1 });
      s.seats[0]!.minions.push(makeMinion("V2", "Alice", { clan: "Brujah", blood: 1 }));
    });
    const engine = new VtesEngine(state, testRegistry);
    expect(grants(engine, "Meditative Grove")).toEqual(["V1"]);
    runTrace(engine, [["Alice", "ability:Meditative Grove:L1:V1"]]);
    expect(must(state, "V1").blood).toBe(2);
  });

  /** Bob's M rushes Alice's Salubri V1 and plays Terror Frenzy on it. */
  function frenzyAtSalubri(withGrove: boolean): {
    state: GameState;
    engine: VtesEngine;
  } {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    Object.assign(must(state, "V1"), { clan: "Salubri", blood: 4 });
    Object.assign(must(state, "M"), { disciplines: { ani: "basic" }, blood: 4 });
    state.seats[1]!.hand.push(
      { id: "b0", name: "Terror Frenzy" },
      { id: "b1", name: "Umbrous Clutch" },
    );
    must(state, "M").disciplines = { ani: "basic", obl: "basic" };
    if (withGrove) state.seats[0]!.permanents.push(location("L1", "Meditative Grove"));
    const engine = new VtesEngine(state, testRegistry);
    // Bob rushes V1 with Umbrous Clutch, then plays Terror Frenzy on it.
    // The announce/block cycles for a DIRECTED action carry only the actor
    // and the defenders, so the trace is walked rather than hard-coded.
    runTrace(engine, [["Bob", "play:Umbrous Clutch:basic:M:V1:b1"]]);
    passUntil(engine, state, () => state.frames.some((f) => f.kind === "combat"));
    runTrace(engine, [["Bob", "play:Terror Frenzy:basic:M:b0"]]);
    return { state, engine };
  }

  it("offers the cancel to the Salubri's controller in the as-played window", () => {
    const { engine } = frenzyAtSalubri(true);
    // The as-played cycle opens with the playing seat; step to Alice.
    for (let i = 0; i < 5; i++) {
      const dp = engine.decision()!;
      if (dp.seat === "Alice") break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(dp.window).toBe("card.asPlayed");
    expect(dp.options.some((o) => o.id === "ability:Meditative Grove:L1:cancel")).toBe(true);
  });

  it("cancels the frenzy card, locks the location, and does NOT refund the cost", () => {
    const { state, engine } = frenzyAtSalubri(true);
    for (let i = 0; i < 5; i++) {
      const dp = engine.decision()!;
      if (dp.seat === "Alice") break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    const bloodBefore = must(state, "M").blood;
    runTrace(engine, [["Alice", "ability:Meditative Grove:L1:cancel"]]);
    // Terror Frenzy costs 1 blood and it stays paid.
    expect(must(state, "M").blood).toBe(bloodBefore);
    expect(state.seats[0]!.permanents[0]!.locked).toBe(true);
    // Its effect never applied.
    const cf = state.frames.find((f) => f.kind === "combat");
    expect(cf?.kind === "combat" && cf.restrict.opposing.equipment).toBe(false);
  });

  it("without the Grove the same frenzy card lands — the control case", () => {
    const { state, engine } = frenzyAtSalubri(false);
    for (let i = 0; i < 8; i++) {
      const dp = engine.decision();
      if (!dp || !state.frames.some((f) => f.kind === "cardPlay")) break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    const cf = state.frames.find((f) => f.kind === "combat");
    expect(cf?.kind === "combat" && cf.restrict.opposing.equipment).toBe(true);
  });

  it("a locked Grove cannot cancel", () => {
    const { state, engine } = frenzyAtSalubri(true);
    state.seats[0]!.permanents[0]!.locked = true;
    for (let i = 0; i < 5; i++) {
      const dp = engine.decision()!;
      if (dp.seat === "Alice") break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("ability:Meditative Grove")),
    ).toBe(false);
  });

  it("does not cancel a frenzy card played on somebody ELSE", () => {
    // Terror Frenzy is used ON the other combatant — here Bob's own M is
    // the one it would hit if Alice's vampire played it, so the Grove has
    // nothing to protect.
    const state = threeSeatGame();
    Object.assign(must(state, "V1"), {
      clan: "Salubri",
      blood: 4,
      disciplines: { ani: "basic", obl: "basic" },
    });
    Object.assign(must(state, "M"), { blood: 4 });
    state.seats[0]!.permanents.push(location("L1", "Meditative Grove"));
    state.seats[0]!.hand.push(
      { id: "a0", name: "Terror Frenzy" },
      { id: "a1", name: "Umbrous Clutch" },
    );
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Umbrous Clutch:basic:V1:M:a1"]]);
    passUntil(engine, state, () => state.frames.some((f) => f.kind === "combat"));
    runTrace(engine, [["Alice", "play:Terror Frenzy:basic:V1:a0"]]);
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("ability:Meditative Grove")),
    ).toBe(false);
  });
});

describe("Cappadocian Crypt (102298)", () => {
  /** Alice's Hecata takes a successful action with the named card. */
  function afterAction(
    card: string,
    tweak: (s: GameState) => void = () => {},
  ): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(must(state, "V1"), {
      clan: "Hecata",
      blood: 4,
      disciplines: { obl: "superior", dom: "superior" },
    });
    state.seats[0]!.permanents.push(location("L1", "Cappadocian Crypt"));
    state.seats[0]!.uncontrolled = [];
    state.seats[0]!.minions.push(makeMinion("H2", "Alice", { clan: "Hecata", blood: 1 }));
    state.seats[0]!.hand.push({ id: "a0", name: card });
    tweak(state);
    const engine = new VtesEngine(state, testRegistry);
    return { state, engine };
  }

  it("opens after a successful action requiring Oblivion, and adds 1 blood to a Hecata", () => {
    // Umbrous Clutch requires [obl].
    const { state, engine } = afterAction("Umbrous Clutch");
    runTrace(engine, [
      ["Alice", "play:Umbrous Clutch:basic:V1:W:a0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolves
    ]);
    const dp = engine.decision()!;
    expect(dp.window).toBe("action.afterResolution");
    const ids = dp.options.filter((o) => o.id.startsWith("ability:Cappadocian Crypt"));
    expect(ids.map((o) => o.id.split(":").pop()).sort()).toEqual(["H2", "V1"]);
    runTrace(engine, [["Alice", "ability:Cappadocian Crypt:L1:blood:H2"]]);
    expect(must(state, "H2").blood).toBe(2);
    expect(state.seats[0]!.permanents[0]!.locked).toBe(true);
  });

  it("does NOT open after an action requiring neither Hecata nor Oblivion", () => {
    // Govern the Unaligned requires [dom], which the card does not name.
    const { engine } = afterAction("Govern the Unaligned");
    runTrace(engine, [
      ["Alice", "play:Govern the Unaligned:basic:V1:a0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const dp = engine.decision();
    expect(
      dp?.options.some((o) => o.id.startsWith("ability:Cappadocian Crypt")) ?? false,
    ).toBe(false);
  });

  it("does NOT open when the action was blocked", () => {
    // Umbrous Clutch is a +1 stealth action, so a 0-intercept blocker
    // simply fails and may try again for ever (p. 25) — the blocker needs
    // the intercept to actually block.
    const { state, engine } = afterAction("Umbrous Clutch", (s) => {
      must(s, "M").attached.push({
        card: { id: "eq", name: "Sport Bike" },
        locked: false,
        usedThisPhase: false,
        statics: { intercept: 2 },
        tags: [],
      });
    });
    runTrace(engine, [["Alice", "play:Umbrous Clutch:basic:V1:W:a0"]]);
    // Walk to Bob's block window and take it.
    passUntil(engine, state, () =>
      (engine.decision()?.options ?? []).some((o) => o.id === "block:M"),
    );
    runTrace(engine, [["Bob", "block:M"]]);
    // From here to the end of the turn the crypt is never offered: a
    // blocked action is not a successful one (p. 27).
    let offered = false;
    let blocked = false;
    for (let i = 0; i < 60; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.startsWith("ability:Cappadocian Crypt"))) {
        offered = true;
      }
      runTrace(engine, [
        [dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id],
      ]);
      if (state.eventLog.some((e) => e.type === "ActionResolved" && !e.success)) {
        blocked = true;
      }
    }
    expect(blocked).toBe(true); // the scenario really did block
    expect(offered).toBe(false);
    expect(state.seats[0]!.permanents[0]!.locked).toBe(false);
    expect(must(state, "H2").blood).toBe(1);
  });
});

describe("The Hungry Coyote (100945)", () => {
  it("a Sabbat vampire you control hunts for 2", () => {
    const state = threeSeatGame();
    Object.assign(must(state, "V1"), { sect: "sabbat", blood: 1 });
    state.seats[0]!.permanents.push(location("L1", "The Hungry Coyote", {
      // The aura is denormalized onto the entry when the card enters play.
      aura: { scope: "controller", sect: "sabbat", hunt: 1 },
    }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolves
    ]);
    expect(must(state, "V1").blood).toBe(3);
  });

  it("a non-Sabbat vampire still hunts for 1 — the control case", () => {
    const state = threeSeatGame();
    Object.assign(must(state, "V1"), { sect: "camarilla", blood: 1 });
    state.seats[0]!.permanents.push(location("L1", "The Hungry Coyote", {
      // The aura is denormalized onto the entry when the card enters play.
      aura: { scope: "controller", sect: "sabbat", hunt: 1 },
    }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(must(state, "V1").blood).toBe(2);
  });

  it("it is 'you control': another Methuselah's Sabbat vampire gets nothing", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    Object.assign(must(state, "W"), { sect: "sabbat", blood: 1 });
    state.seats[0]!.permanents.push(location("L1", "The Hungry Coyote", {
      // The aura is denormalized onto the entry when the card enters play.
      aura: { scope: "controller", sect: "sabbat", hunt: 1 },
    }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Bob", "hunt:W"],
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"],
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"],
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"],
    ]);
    expect(must(state, "W").blood).toBe(2);
  });
});
