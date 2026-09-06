/**
 * "Ⓓ Put this card on a minion" — actions that become permanents
 * (docs/action-attachments-design.md).
 *
 * Heroic Might (100913), Khabar: Glory (101043), Rutor's Hand (101664),
 * Tier of Souls (101984), Phantasmagoria (102358).
 *
 * `attachSelf` covered the static half already; what is new is everything
 * these cards do AFTER they land.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function must(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function entry(state: GameState, cardId: string): PermanentInPlay | undefined {
  return state.seats
    .flatMap((s) => [...s.permanents, ...s.minions.flatMap((m) => m.attached)])
    .find((p) => p.card.id === cardId);
}

/** Alice's minion phase with `cards` in hand. */
function game(cards: string[], tweak: (s: GameState) => void = () => {}): GameState {
  const state = threeSeatGame();
  cards.forEach((n, i) => state.seats[0]!.hand.push({ id: `a${i}`, name: n }));
  tweak(state);
  return state;
}

/** Pass every decision until `done()`, or the budget runs out. */
function passUntil(engine: VtesEngine, done: () => boolean, limit = 40): void {
  for (let i = 0; i < limit && !done(); i++) {
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [
      [dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id],
    ]);
  }
}

function offered(engine: VtesEngine): string[] {
  return (engine.decision()?.options ?? []).map((o) => o.id);
}

/**
 * Announce an action and walk it to resolution with nobody blocking.
 * Walked rather than a fixed pass-trace because a DIRECTED action's
 * announce and block cycles carry only the actor and the defenders, so the
 * number of passes differs from card to card.
 */
function resolveUnopposed(engine: VtesEngine, state: GameState, playId: string): void {
  const before = state.eventLog.filter((e) => e.type === "ActionResolved").length;
  runTrace(engine, [["Alice", playId]]);
  passUntil(
    engine,
    () => state.eventLog.filter((e) => e.type === "ActionResolved").length > before,
  );
}

describe("Heroic Might (100913)", () => {
  const pot = (level: "basic" | "superior") => (s: GameState) => {
    Object.assign(must(s, "V1"), { disciplines: { pot: level }, blood: 5, strength: 1 });
  };

  it("attaches, grants +1 strength, and is a +3 stealth action", () => {
    const state = game(["Heroic Might"], pot("basic"));
    const engine = new VtesEngine(state, testRegistry);
    resolveUnopposed(engine, state, "play:Heroic Might:basic:V1:a0");
    const e = entry(state, "a0");
    expect(e?.statics.strength).toBe(1);
    expect(must(state, "V1").attached.map((p) => p.card.name)).toContain("Heroic Might");
    expect(
      state.eventLog.some((ev) => ev.type === "StealthModified" && ev.delta === 3),
    ).toBe(true);
    // The blood cost is paid at resolution (p. 27).
    expect(must(state, "V1").blood).toBe(2);
    // "You still control this card" is recorded, not inferred (p. 16).
    expect(e?.controller).toBe("Alice");
  });

  it("superior grants +2 strength", () => {
    const state = game(["Heroic Might"], pot("superior"));
    const engine = new VtesEngine(state, testRegistry);
    resolveUnopposed(engine, state, "play:Heroic Might:superior:V1:a0");
    expect(entry(state, "a0")?.statics.strength).toBe(2);
  });

  it("offers strike: burn equipment, and burns the chosen card", () => {
    const state = game(["Heroic Might"], (s) => {
      pot("basic")(s);
      must(s, "W").attached.push({
        card: { id: "gun", name: ".44 Magnum" },
        locked: false,
        usedThisPhase: false,
        statics: {},
        tags: ["equipment"],
      });
    });
    const engine = new VtesEngine(state, testRegistry);
    resolveUnopposed(engine, state, "play:Heroic Might:basic:V1:a0");
    // Rush W so V1 is in combat with the equipped vampire.
    state.seats[0]!.hand.push({ id: "uc", name: "Umbrous Clutch" });
    must(state, "V1").disciplines = { pot: "basic", obl: "basic" };
    must(state, "V1").locked = false;
    runTrace(engine, [["Alice", "play:Umbrous Clutch:basic:V1:W:uc"]]);
    passUntil(engine, () =>
      (engine.decision()?.window ?? "") === "combat.chooseStrike",
    );
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.chooseStrike");
    const strike = dp.options.find((o) => o.id.startsWith("ability:Heroic Might"));
    expect(strike?.id).toBe("ability:Heroic Might:a0:strike:gun");
    runTrace(engine, [[dp.seat, strike!.id]]);
    passUntil(engine, () => !state.frames.some((f) => f.kind === "combat"));
    expect(must(state, "W").attached.some((p) => p.card.id === "gun")).toBe(false);
    // A destroying strike inflicts nothing.
    expect(
      state.eventLog.some((ev) => ev.type === "DamageInflicted" && ev.minion === "W"),
    ).toBe(false);
  });

  it("with nothing to burn, the strike is not offered", () => {
    const state = game(["Heroic Might", "Umbrous Clutch"], (s) => {
      pot("basic")(s);
      must(s, "V1").disciplines = { pot: "basic", obl: "basic" };
    });
    const engine = new VtesEngine(state, testRegistry);
    resolveUnopposed(engine, state, "play:Heroic Might:basic:V1:a0");
    must(state, "V1").locked = false;
    runTrace(engine, [["Alice", "play:Umbrous Clutch:basic:V1:W:a1"]]);
    passUntil(engine, () =>
      (engine.decision()?.window ?? "") === "combat.chooseStrike",
    );
    expect(offered(engine).some((i) => i.startsWith("ability:Heroic Might"))).toBe(false);
  });

  it("burns when the bearer goes to torpor", () => {
    // Reached through real damage: V1 rushes a stronger vampire, cannot
    // mend everything, and goes to torpor (p. 31).
    const state = game(["Heroic Might", "Umbrous Clutch"], (s) => {
      pot("basic")(s);
      Object.assign(must(s, "V1"), {
        disciplines: { pot: "basic", obl: "basic" },
        blood: 4,
      });
      Object.assign(must(s, "W"), { strength: 5, blood: 4 });
    });
    const engine = new VtesEngine(state, testRegistry);
    resolveUnopposed(engine, state, "play:Heroic Might:basic:V1:a0");
    expect(entry(state, "a0")).toBeDefined();
    must(state, "V1").locked = false;
    runTrace(engine, [["Alice", "play:Umbrous Clutch:basic:V1:W:a1"]]);
    passUntil(engine, () => must(state, "V1").inTorpor, 60);
    expect(must(state, "V1").inTorpor).toBe(true);
    expect(entry(state, "a0")).toBeUndefined();
  });
});

describe("Khabar: Glory (101043)", () => {
  const banu = (s: GameState): void => {
    Object.assign(must(s, "V1"), { clan: "Banu Haqim", blood: 4 });
  };

  it("attaches, UNLOCKS the actor, and grants +1 bleed", () => {
    const state = game(["Khabar: Glory"], banu);
    const engine = new VtesEngine(state, testRegistry);
    resolveUnopposed(engine, state, "play:Khabar: Glory:basic:V1:a0");
    expect(entry(state, "a0")?.statics.bleed).toBe(1);
    // Locked at announcement (p. 25), then unlocked by the card.
    expect(must(state, "V1").locked).toBe(false);
  });

  it("requires a Banu Haqim — the registry clan, not the printed 'Assamite'", () => {
    const state = game(["Khabar: Glory"], (s) => {
      must(s, "V1").clan = "Brujah";
    });
    const engine = new VtesEngine(state, testRegistry);
    expect(offered(engine).some((i) => i.startsWith("play:Khabar: Glory"))).toBe(false);
  });

  it("burns during the controller's unlock phase", () => {
    const state = game(["Khabar: Glory"], banu);
    const engine = new VtesEngine(state, testRegistry);
    resolveUnopposed(engine, state, "play:Khabar: Glory:basic:V1:a0");
    expect(entry(state, "a0")).toBeDefined();
    // Run the turn out and round to Alice's next unlock phase.
    passUntil(
      engine,
      () =>
        state.eventLog.some(
          (e) => e.type === "PermanentBurned" && e.cardId === "a0",
        ),
      200,
    );
    expect(entry(state, "a0")).toBeUndefined();
  });
});

describe("Rutor's Hand (101664)", () => {
  const tha = (s: GameState): void => {
    Object.assign(must(s, "V1"), { disciplines: { tha: "basic" }, blood: 4 });
  };

  it("attaches LOCKED and deals 1 unpreventable aggravated damage to its bearer", () => {
    const state = game(["Rutor's Hand"], tha);
    const engine = new VtesEngine(state, testRegistry);
    resolveUnopposed(engine, state, "play:Rutor's Hand:basic:V1:a0");
    expect(entry(state, "a0")?.locked).toBe(true);
    expect(
      state.eventLog.some(
        (e) => e.type === "DamageInflicted" && e.minion === "V1" && e.aggravated,
      ),
    ).toBe(true);
    // Aggravated cannot be mended (p. 34) — one point sends them to torpor.
    expect(must(state, "V1").inTorpor).toBe(true);
  });

  it("a BLOCKED action does neither: no card, no damage (p. 27)", () => {
    const state = game(["Rutor's Hand"], (s) => {
      tha(s);
      must(s, "M").attached.push({
        card: { id: "eq", name: "Sport Bike" },
        locked: false,
        usedThisPhase: false,
        statics: { intercept: 2 },
        tags: ["equipment"],
      });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Rutor's Hand:basic:V1:a0"]]);
    passUntil(engine, () => offered(engine).includes("block:M"));
    runTrace(engine, [["Bob", "block:M"]]);
    passUntil(engine, () =>
      state.eventLog.some((e) => e.type === "ActionResolved" && !e.success),
    );
    expect(entry(state, "a0")).toBeUndefined();
    // The card's own aggravated environmental point (source null) never
    // happened. Ordinary combat damage from the blocker is a different
    // thing and is not what this asserts.
    expect(
      state.eventLog.some(
        (e) =>
          e.type === "DamageInflicted" &&
          e.minion === "V1" &&
          e.source === null &&
          e.aggravated,
      ),
    ).toBe(false);
  });

  it("the bearer can lock the card to unlock", () => {
    const state = game(["Rutor's Hand"], (s) => {
      tha(s);
      must(s, "V1").blood = 6; // survive the aggravated point
      must(s, "V1").capacity = 6;
    });
    const engine = new VtesEngine(state, testRegistry);
    resolveUnopposed(engine, state, "play:Rutor's Hand:basic:V1:a0");
    // The card entered locked; unlock it by hand so the ability is live.
    entry(state, "a0")!.locked = false;
    expect(must(state, "V1").locked).toBe(true);
    expect(offered(engine)).toContain("ability:Rutor's Hand:a0:unlock");
    runTrace(engine, [["Alice", "ability:Rutor's Hand:a0:unlock"]]);
    expect(must(state, "V1").locked).toBe(false);
    expect(entry(state, "a0")!.locked).toBe(true);
    // …and not twice.
    expect(offered(engine).some((i) => i.startsWith("ability:Rutor's Hand"))).toBe(false);
  });
});

describe("Tier of Souls (101984)", () => {
  const ani = (level: "basic" | "superior") => (s: GameState) => {
    Object.assign(must(s, "V1"), { disciplines: { ani: level }, blood: 2, capacity: 6 });
    // Bob is Alice's prey in the three-seat fixture.
    must(s, "W").blood = 3;
  };

  it("inferior steals 1 blood from a PREY minion and starts no combat", () => {
    const state = game(["Tier of Souls"], ani("basic"));
    const engine = new VtesEngine(state, testRegistry);
    resolveUnopposed(engine, state, "play:Tier of Souls:basic:V1:W:a0");
    expect(must(state, "W").blood).toBe(2);
    expect(must(state, "V1").blood).toBe(3);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
    // The inferior does not attach.
    expect(entry(state, "a0")).toBeUndefined();
  });

  it("only your prey's minions are legal targets", () => {
    const state = game(["Tier of Souls"], ani("basic"));
    const engine = new VtesEngine(state, testRegistry);
    const ids = offered(engine).filter((i) => i.startsWith("play:Tier of Souls"));
    // Bob's W and M, never Carol's N or Alice's own V1.
    expect(ids.some((i) => i.includes(":W:"))).toBe(true);
    expect(ids.some((i) => i.includes(":M:"))).toBe(true);
    expect(ids.some((i) => i.includes(":N:"))).toBe(false);
    expect(ids.some((i) => i.includes(":V1:V1:"))).toBe(false);
  });

  it("superior also attaches, for +1 bleed AGAINST YOUR PREY only", () => {
    const state = game(["Tier of Souls"], ani("superior"));
    const engine = new VtesEngine(state, testRegistry);
    resolveUnopposed(engine, state, "play:Tier of Souls:superior:V1:W:a0");
    expect(entry(state, "a0")?.statics.bleedAgainstPrey).toBe(1);
    must(state, "V1").locked = false;
    // Bleeding the prey: 1 base + 1.
    const bobPool = state.seats[1]!.pool;
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.seats[1]!.pool).toBe(bobPool - 2);
  });

  it("minions can burn the attached card as a Ⓓ action", () => {
    const state = game(["Tier of Souls"], ani("superior"));
    const engine = new VtesEngine(state, testRegistry);
    resolveUnopposed(engine, state, "play:Tier of Souls:superior:V1:W:a0");
    // Bob's turn: his minions can burn it.
    passUntil(engine, () => {
      const tf = state.frames[0];
      return tf?.kind === "turn" && tf.seat === "Bob" && tf.phase === "minion";
    }, 100);
    expect(offered(engine).some((i) => i.startsWith("act:Tier of Souls:a0:burn:"))).toBe(
      true,
    );
  });
});

describe("Phantasmagoria (102358)", () => {
  const ravnos = (level: "basic" | "superior") => (s: GameState) => {
    Object.assign(must(s, "V1"), {
      clan: "Ravnos",
      disciplines: { pre: level },
      blood: 4,
    });
  };

  it("attaches to ANY minion, still controlled by you (p. 16), for -1 stealth", () => {
    const state = game(["Phantasmagoria"], ravnos("basic"));
    const engine = new VtesEngine(state, testRegistry);
    resolveUnopposed(engine, state, "play:Phantasmagoria:basic:V1:W:a0");
    const e = entry(state, "a0");
    expect(must(state, "W").attached.map((p) => p.card.id)).toContain("a0");
    expect(e?.statics.stealth).toBe(-1);
    // "You still control this card" — Alice, not Bob.
    expect(e?.controller).toBe("Alice");
  });

  it("targets any Methuselah's minion, including your own", () => {
    const state = game(["Phantasmagoria"], ravnos("basic"));
    const engine = new VtesEngine(state, testRegistry);
    const ids = offered(engine).filter((i) => i.startsWith("play:Phantasmagoria"));
    for (const t of ["V1", "W", "M", "N"]) {
      expect(ids.some((i) => i.includes(`:${t}:`))).toBe(true);
    }
  });

  it("superior tolls the attached minion 1 blood when it is blocked", () => {
    const state = game(["Phantasmagoria"], (s) => {
      ravnos("superior")(s);
      Object.assign(must(s, "W"), { blood: 4 });
      // Bob's M can actually block.
      must(s, "M").attached.push({
        card: { id: "eq", name: "Sport Bike" },
        locked: false,
        usedThisPhase: false,
        statics: { intercept: 2 },
        tags: ["equipment"],
      });
    });
    const engine = new VtesEngine(state, testRegistry);
    resolveUnopposed(engine, state, "play:Phantasmagoria:superior:V1:W:a0");
    // Bob's turn: W bleeds and is blocked by Carol… no — W bleeds Carol,
    // and Carol blocks, which is when the toll bites.
    passUntil(engine, () => {
      const tf = state.frames[0];
      return tf?.kind === "turn" && tf.seat === "Bob" && tf.phase === "minion";
    }, 100);
    const before = must(state, "W").blood;
    runTrace(engine, [["Bob", "bleed:W"]]);
    passUntil(engine, () => offered(engine).includes("block:N"));
    runTrace(engine, [["Carol", "block:N"]]);
    passUntil(engine, () =>
      state.eventLog.some((e) => e.type === "BlockSucceeded"),
    );
    expect(must(state, "W").blood).toBe(before - 1);
  });

  it("the BASIC mode has no toll — the control case", () => {
    const state = game(["Phantasmagoria"], (s) => {
      ravnos("basic")(s);
      Object.assign(must(s, "W"), { blood: 4 });
      must(s, "M").attached.push({
        card: { id: "eq", name: "Sport Bike" },
        locked: false,
        usedThisPhase: false,
        statics: { intercept: 2 },
        tags: ["equipment"],
      });
    });
    const engine = new VtesEngine(state, testRegistry);
    resolveUnopposed(engine, state, "play:Phantasmagoria:basic:V1:W:a0");
    expect(entry(state, "a0")?.statics.blockedToll).toBeUndefined();
  });
});
