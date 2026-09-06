/**
 * Rush actions and what happens after the combat
 * (docs/rush-outcome-design.md).
 *
 * Abuse of Power (102309), Pillars Fall (102333), Hunting the Beast
 * (102356), Hunter's Mark (102228), Make the Misere (101147).
 *
 * The join this wave builds: a rider an ACTION installs on the combat it
 * starts, read once that combat ends and conditioned on who is still
 * standing. Plus `multiDiscipline` — the additive mode shape, where every
 * other card's modes are exclusive.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function must(state: GameState, id: string): MinionState {
  const m = find(state, id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Alice's minion phase with `cards` in hand and a tweak hook. */
function game(cards: string[], tweak: (s: GameState) => void = () => {}): GameState {
  const state = threeSeatGame();
  cards.forEach((n, i) => state.seats[0]!.hand.push({ id: `a${i}`, name: n }));
  tweak(state);
  return state;
}

/** Announce the rush and walk it through the block windows unopposed. */
const announceUnblocked = (playId: string): Array<[string, string]> => [
  ["Alice", playId],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state C → combat
];

/** Answer everything the cheapest way until no decision remains, or the
 *  budget runs out. Choice frames have no `pass`, so the first option is
 *  taken — every test that cares about a choice answers it explicitly
 *  before calling this. */
function drain(engine: VtesEngine, state: GameState, limit = 60): void {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return;
    // Stop once the whole action is over and the turn frame is back on top.
    if (state.frames.length === 1) return;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
}

/**
 * Fixture tweaks that decide who is still ready when the combat ends.
 * Done through real damage rather than by deleting a minion: a vampire
 * that cannot mend everything goes to torpor (p. 31), and torpor is what
 * "not ready" means to these riders.
 */
const opposingFalls = (s: GameState): void => {
  must(s, "W").blood = 0; // one hand strike it cannot mend
};
const actorFalls = (s: GameState): void => {
  must(s, "V1").blood = 1;
  must(s, "W").strength = 3; // 3 damage, 1 mended, 2 left → torpor
};

describe("Abuse of Power (102309)", () => {
  it("burns 1 pool from the opposing controller when only one combatant is left", () => {
    const state = game(["Abuse of Power"], opposingFalls);
    const engine = new VtesEngine(state, testRegistry);
    const bobPool = state.seats[1]!.pool;
    runTrace(engine, announceUnblocked("play:Abuse of Power:basic:V1:W:a0"));
    expect(state.eventLog.some((e) => e.type === "CombatBegan")).toBe(true);
    drain(engine, state);
    expect(must(state, "W").inTorpor).toBe(true);
    expect(state.seats[1]!.pool).toBe(bobPool - 1);
  });

  it("does nothing when both combatants are still ready", () => {
    const state = game(["Abuse of Power"]);
    const engine = new VtesEngine(state, testRegistry);
    const bobPool = state.seats[1]!.pool;
    runTrace(engine, announceUnblocked("play:Abuse of Power:basic:V1:W:a0"));
    drain(engine, state);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
    expect(state.seats[1]!.pool).toBe(bobPool);
  });

  it("fires the other way too: the ACTOR falling still bills the survivor", () => {
    // "If only one combatant is ready" names no exception — design §3.
    const state = game(["Abuse of Power"], actorFalls);
    const engine = new VtesEngine(state, testRegistry);
    const bobPool = state.seats[1]!.pool;
    runTrace(engine, announceUnblocked("play:Abuse of Power:basic:V1:W:a0"));
    drain(engine, state);
    expect(must(state, "V1").inTorpor).toBe(true);
    expect(must(state, "W").inTorpor).toBe(false);
    expect(state.seats[1]!.pool).toBe(bobPool - 1);
  });

  it("is a +1 stealth action", () => {
    const state = game(["Abuse of Power"]);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Abuse of Power:basic:V1:W:a0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(
      state.eventLog.some((e) => e.type === "StealthModified" && e.delta === 1),
    ).toBe(true);
  });
});

describe("Pillars Fall (102333)", () => {
  it("offers the attachment when the opposing vampire is gone, and grants +1 bleed", () => {
    const state = game(["Pillars Fall"], opposingFalls);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announceUnblocked("play:Pillars Fall:basic:V1:W:a0"));
    // Walk to the choice.
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.includes(":attachOutcome:"))) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(dp.options.map((o) => o.id.split(":").pop())).toEqual(["yes", "no"]);
    runTrace(engine, [["Alice", "choice:Pillars Fall:a0:attachOutcome:yes"]]);
    const v1 = must(state, "V1");
    expect(v1.attached.map((p) => p.card.name)).toContain("Pillars Fall");
    expect(v1.attached.find((p) => p.card.name === "Pillars Fall")!.statics.bleed).toBe(1);
    // Held aside at resolution, so it was never burned.
    expect(state.eventLog.some((e) => e.type === "CardBurned" && e.cardId === "a0")).toBe(false);
  });

  it("declining is a real answer that burns the card, not a pass", () => {
    // An optional ChoiceFrame's decline never calls applyChoice, and the
    // card — held back from the ash heap at resolution — would vanish.
    const state = game(["Pillars Fall"], opposingFalls);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announceUnblocked("play:Pillars Fall:basic:V1:W:a0"));
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.includes(":attachOutcome:"))) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(engine.decision()!.options.some((o) => o.id === "pass")).toBe(false);
    runTrace(engine, [["Alice", "choice:Pillars Fall:a0:attachOutcome:no"]]);
    expect(must(state, "V1").attached.some((p) => p.card.name === "Pillars Fall")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "CardBurned" && e.cardId === "a0")).toBe(true);
  });

  it("no attachment and the card burns when the opposing vampire survives", () => {
    const state = game(["Pillars Fall"]);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announceUnblocked("play:Pillars Fall:basic:V1:W:a0"));
    drain(engine, state);
    expect(must(state, "V1").attached.some((p) => p.card.name === "Pillars Fall")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "CardBurned" && e.cardId === "a0")).toBe(true);
  });

  it("targets a VAMPIRE, so an ally is not a legal rush target", () => {
    const state = game(["Pillars Fall"], (s) => {
      s.seats[1]!.minions.push(
        makeMinion("ALLY", "Bob", { kind: "ally", blood: 2, disciplines: {} }),
      );
    });
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.startsWith("play:Pillars Fall") && i.includes(":W:"))).toBe(true);
    expect(ids.some((i) => i.includes(":ALLY:"))).toBe(false);
  });
});

describe("Hunting the Beast (102356)", () => {
  /** A Salubri actor whose target loses the combat — the condition is
   *  "this vampire is ready and the opposing vampire is not". */
  const salubri = (s: GameState): void => {
    must(s, "V1").clan = "Salubri";
    must(s, "V1").disciplines = { aus: "superior" };
    opposingFalls(s);
  };

  it("superior adds 2 blood to the one Salubri in the uncontrolled region", () => {
    const state = game(["Hunting the Beast"], (s) => {
      salubri(s);
      s.seats[0]!.uncontrolled.push({
        card: makeMinion("U1", "Alice", { clan: "Salubri", blood: 0, capacity: 6 }),
        counters: 0,
      });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announceUnblocked("play:Hunting the Beast:superior:V1:W:a0"));
    drain(engine, state);
    expect(state.seats[0]!.uncontrolled[0]!.counters).toBe(2);
  });

  it("asks which Salubri when several qualify", () => {
    const state = game(["Hunting the Beast"], (s) => {
      salubri(s);
      for (const id of ["U1", "U2"]) {
        s.seats[0]!.uncontrolled.push({
          card: makeMinion(id, "Alice", { clan: "Salubri", blood: 0, capacity: 6 }),
          counters: 0,
        });
      }
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announceUnblocked("play:Hunting the Beast:superior:V1:W:a0"));
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.includes(":bloodToUncontrolled:"))) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    const dp = engine.decision()!;
    expect(dp.options.map((o) => o.id.split(":").pop()).sort()).toEqual(["U1", "U2"]);
    runTrace(engine, [["Alice", "choice:Hunting the Beast:a0:bloodToUncontrolled:U2"]]);
    expect(state.seats[0]!.uncontrolled.find((u) => u.card.id === "U2")!.counters).toBe(2);
    expect(state.seats[0]!.uncontrolled.find((u) => u.card.id === "U1")!.counters).toBe(0);
  });

  it("filters by clan: a non-Salubri in the uncontrolled region gets nothing", () => {
    const state = game(["Hunting the Beast"], (s) => {
      salubri(s);
      s.seats[0]!.uncontrolled.push({
        card: makeMinion("U1", "Alice", { clan: "Brujah", blood: 0, capacity: 6 }),
        counters: 0,
      });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announceUnblocked("play:Hunting the Beast:superior:V1:W:a0"));
    drain(engine, state);
    expect(state.seats[0]!.uncontrolled[0]!.counters).toBe(0);
  });

  it("the INFERIOR mode is a plain rush with no payoff", () => {
    const state = game(["Hunting the Beast"], (s) => {
      must(s, "V1").clan = "Salubri";
      must(s, "V1").disciplines = { aus: "basic" };
      opposingFalls(s);
      s.seats[0]!.uncontrolled.push({
        card: makeMinion("U1", "Alice", { clan: "Salubri", blood: 0, capacity: 6 }),
        counters: 0,
      });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announceUnblocked("play:Hunting the Beast:basic:V1:W:a0"));
    drain(engine, state);
    expect(state.seats[0]!.uncontrolled[0]!.counters).toBe(0);
  });

  it("requires a Salubri", () => {
    const state = game(["Hunting the Beast"], (s) => {
      must(s, "V1").disciplines = { aus: "superior" }; // no clan
    });
    const engine = new VtesEngine(state, testRegistry);
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("play:Hunting the Beast")),
    ).toBe(false);
  });
});

describe("Hunter's Mark (102228)", () => {
  const arm = (level: "basic" | "superior") => (s: GameState) => {
    must(s, "V1").disciplines = { cel: level, tha: level };
    must(s, "V1").blood = 4;
  };

  it("grants a press credit for the resulting combat", () => {
    const state = game(["Hunter's Mark"], arm("basic"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announceUnblocked("play:Hunter's Mark:basic:V1:W:a0"));
    const cf = state.frames.find((f) => f.kind === "combat");
    expect(cf?.kind === "combat" && cf.pressesCombat.acting).toBe(1);
  });

  it("superior bars the OPPOSING minion's combat-ends strike in round 1", () => {
    const state = game(["Hunter's Mark", "Catatonic Fear"], (s) => {
      arm("superior")(s);
      must(s, "W").disciplines = { pre: "superior" };
      must(s, "W").blood = 4;
      // Bob holds a "strike: combat ends" card for the barred vampire.
      s.seats[1]!.hand.push({ id: "b0", name: "Catatonic Fear" });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announceUnblocked("play:Hunter's Mark:superior:V1:W:a0"));
    const cf = state.frames.find((f) => f.kind === "combat");
    expect(cf?.kind === "combat" && cf.noCombatEndsFirstRound.opposing).toBe(true);
    // Walk to Bob's strike choice.
    for (let i = 0; i < 20; i++) {
      const dp = engine.decision()!;
      if (dp.window === "combat.chooseStrike" && dp.seat === "Bob") break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.chooseStrike");
    expect(dp.options.some((o) => o.id.startsWith("play:Catatonic Fear"))).toBe(false);
  });

  it("the basic mode does NOT bar it — the control case", () => {
    const state = game(["Hunter's Mark"], (s) => {
      arm("basic")(s);
      must(s, "W").disciplines = { pre: "superior" };
      must(s, "W").blood = 4;
      s.seats[1]!.hand.push({ id: "b0", name: "Catatonic Fear" });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announceUnblocked("play:Hunter's Mark:basic:V1:W:a0"));
    for (let i = 0; i < 20; i++) {
      const dp = engine.decision()!;
      if (dp.window === "combat.chooseStrike" && dp.seat === "Bob") break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("play:Catatonic Fear")),
    ).toBe(true);
  });
});

describe("Make the Misere (101147) — the additive mode shape", () => {
  const anarch = (disc: Record<string, "basic" | "superior">) => (s: GameState) => {
    Object.assign(must(s, "V1"), { sect: "anarch", disciplines: disc, blood: 4 });
    must(s, "W").locked = true; // "a LOCKED minion"
  };

  it("offers ONE option per target, with no mode to choose", () => {
    const state = game(["Make the Misere"], anarch({ cel: "basic", pot: "basic" }));
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine
      .decision()!
      .options.filter((o) => o.id.startsWith("play:Make the Misere"));
    expect(ids).toHaveLength(1);
    expect(ids[0]!.id).toBe("play:Make the Misere:basic:V1:W:a0");
  });

  it("applies EVERY rider the actor's Disciplines allow, at once", () => {
    const state = game(["Make the Misere"], anarch({ cel: "basic", pot: "basic" }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announceUnblocked("play:Make the Misere:basic:V1:W:a0"));
    const cf = state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat");
    expect(cf.maneuverCredits.acting).toBe(1); // [cel]
    expect(cf.strengthBonus.acting).toBe(1); // [pot]
  });

  it("applies only the riders the actor has — one Discipline, one rider", () => {
    const state = game(["Make the Misere"], anarch({ cel: "basic" }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announceUnblocked("play:Make the Misere:basic:V1:W:a0"));
    const cf = state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat");
    expect(cf.maneuverCredits.acting).toBe(1);
    expect(cf.strengthBonus.acting).toBe(0);
  });

  it("[obf] makes it a +1 stealth action; without Obfuscate it is not", () => {
    const withObf = game(["Make the Misere"], anarch({ obf: "basic" }));
    const e1 = new VtesEngine(withObf, testRegistry);
    runTrace(e1, [
      ["Alice", "play:Make the Misere:basic:V1:W:a0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(withObf.eventLog.some((e) => e.type === "StealthModified" && e.delta === 1)).toBe(
      true,
    );

    const without = game(["Make the Misere"], anarch({ cel: "basic" }));
    const e2 = new VtesEngine(without, testRegistry);
    runTrace(e2, [
      ["Alice", "play:Make the Misere:basic:V1:W:a0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(without.eventLog.some((e) => e.type === "StealthModified" && e.delta === 1)).toBe(
      false,
    );
  });

  it("targets only a LOCKED minion, and requires an Anarch", () => {
    const unlocked = game(["Make the Misere"], (s) => {
      anarch({ cel: "basic" })(s);
      must(s, "W").locked = false;
      must(s, "M").locked = true;
    });
    const e1 = new VtesEngine(unlocked, testRegistry);
    const ids = e1.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.startsWith("play:Make the Misere") && i.includes(":W:"))).toBe(
      false,
    );
    expect(ids.some((i) => i.startsWith("play:Make the Misere") && i.includes(":M:"))).toBe(true);

    const notAnarch = game(["Make the Misere"], (s) => {
      anarch({ cel: "basic" })(s);
      must(s, "V1").sect = "camarilla";
    });
    const e2 = new VtesEngine(notAnarch, testRegistry);
    expect(
      e2.decision()!.options.some((o) => o.id.startsWith("play:Make the Misere")),
    ).toBe(false);
  });
});
