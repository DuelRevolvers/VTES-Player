/**
 * Hand rush cards, wave 114 (docs/hand-rush-design.md).
 *
 * Games of Instinct (100801), Harass (100886), Monomancy (101241), Purity
 * of the Beast (101522), Rumble (101661), Taunt the Caged Beast (101947).
 *
 * What the wave builds: one target predicate read at announcement AND at
 * resolution (`rushTargetOk`), two riders, two end-of-combat payoffs, an
 * end-combat offer from a card that is not in play, and the end-of-action
 * tail. And the order fix it found (§3): a successful rush's combat runs
 * INSIDE resolution, before the after-resolution window and before "do not
 * replace until after this action".
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const handlers = buildHandlerRegistry();

function must(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

const seat = (state: GameState, id: string) => state.seats.find((s) => s.id === id)!;

const combat = (state: GameState): CombatFrame | undefined =>
  [...state.frames].reverse().find((f): f is CombatFrame => f.kind === "combat");

/** Alice's minion phase: V1 is a Sabbat vampire, `cards` in hand. */
function game(cards: string[], tweak: (s: GameState) => void = () => {}): GameState {
  const state = threeSeatGame();
  Object.assign(must(state, "V1"), { sect: "sabbat" });
  seat(state, "Alice").hand = cards.map((n, i) => ({ id: `a${i}`, name: n }));
  tweak(state);
  return state;
}

const ids = (engine: VtesEngine): string[] => engine.decision()?.options.map((o) => o.id) ?? [];

/** The minions a card's basic mode offers V1 as rush targets. */
const targetsOf = (engine: VtesEngine, name: string, minion = "V1"): string[] =>
  ids(engine)
    .filter((i) => i.startsWith(`play:${name}:basic:${minion}:`))
    .map((i) => i.split(":")[4]!)
    .sort();

/** Play the card and pass the "as played" and announcement windows. */
const announce = (playId: string): Array<[string, string]> => [
  ["Alice", playId],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
];

/** Nobody blocks: state A, then C, and the action resolves. */
const unblocked: Array<[string, string]> = [
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state C → resolves
];

/**
 * Answer every decision until `until` holds or only the turn frame is
 * left: a seat's scripted pick when it is offered, else `pass`, else a
 * hand strike, else the first option (a choice frame has no `pass`).
 */
function walk(
  engine: VtesEngine,
  state: GameState,
  until: () => boolean = () => false,
  picks: Record<string, string[]> = {},
  limit = 80,
): void {
  for (let i = 0; i < limit && !until() && state.frames.length > 1; i++) {
    const dp = engine.decision();
    if (!dp) return;
    const options = dp.options.map((o) => o.id);
    const scripted = (picks[dp.seat] ?? [])
      .map((p) => options.find((o) => o.startsWith(p)))
      .find((o) => o !== undefined);
    const pick =
      scripted ??
      (options.includes("pass") ? "pass" : options.includes("strike:hand") ? "strike:hand" : options[0]!);
    engine.choose(pick);
  }
}

const actionOver = (state: GameState) => () => !state.frames.some((f) => f.kind === "action");
const combatBegan = (state: GameState) => state.eventLog.some((e) => e.type === "CombatBegan");

// ---------------------------------------------------------------------------
// Targets: one predicate, every term (§4.1)
// ---------------------------------------------------------------------------

describe("rush targets", () => {
  it("Games of Instinct: an OLDER vampire of ANOTHER Methuselah, and nothing else", () => {
    const state = game(["Games of Instinct"], (s) => {
      Object.assign(must(s, "V1"), { capacity: 5 });
      Object.assign(must(s, "W"), { capacity: 6 }); // older: offered
      Object.assign(must(s, "M"), { capacity: 5 }); // same age: not older
      Object.assign(must(s, "N"), { capacity: 4 }); // younger
      seat(s, "Alice").minions.push(makeMinion("V2", "Alice", { capacity: 9 })); // own
      seat(s, "Bob").minions.push(makeAlly("A1", "Bob", 2)); // not a vampire
    });
    expect(targetsOf(new VtesEngine(state, testRegistry), "Games of Instinct")).toEqual(["W"]);
  });

  it("Games of Instinct, Monomancy and Rumble require a Sabbat vampire", () => {
    for (const name of ["Games of Instinct", "Monomancy", "Rumble"]) {
      const sabbat = game([name], (s) => {
        Object.assign(must(s, "W"), { capacity: 6, sect: "sabbat" });
      });
      expect(targetsOf(new VtesEngine(sabbat, testRegistry), name).length, name).toBeGreaterThan(0);
      const other = game([name], (s) => {
        Object.assign(must(s, "V1"), { sect: "camarilla" });
        Object.assign(must(s, "W"), { capacity: 6, sect: "sabbat" });
      });
      expect(targetsOf(new VtesEngine(other, testRegistry), name), name).toEqual([]);
    }
  });

  it("Monomancy: a Sabbat vampire of another Methuselah", () => {
    const state = game(["Monomancy"], (s) => {
      Object.assign(must(s, "W"), { sect: "sabbat" });
      Object.assign(must(s, "M"), { sect: "camarilla" });
      Object.assign(must(s, "N"), { sect: "sabbat" });
      seat(s, "Alice").minions.push(makeMinion("V2", "Alice", { sect: "sabbat" })); // own
    });
    expect(targetsOf(new VtesEngine(state, testRegistry), "Monomancy")).toEqual(["N", "W"]);
  });

  it("Purity of the Beast: an ally of your PREY — never a vampire, never another seat's ally", () => {
    const state = game(["Purity of the Beast"], (s) => {
      seat(s, "Bob").minions.push(makeAlly("A1", "Bob", 2)); // prey's ally
      seat(s, "Carol").minions.push(makeAlly("A2", "Carol", 2)); // predator's
      seat(s, "Alice").minions.push(makeAlly("A3", "Alice", 2)); // own
    });
    expect(targetsOf(new VtesEngine(state, testRegistry), "Purity of the Beast")).toEqual(["A1"]);
  });

  it("Purity of the Beast requires a vampire: an ally cannot play it", () => {
    const state = game(["Purity of the Beast"], (s) => {
      seat(s, "Bob").minions.push(makeAlly("A1", "Bob", 2));
      seat(s, "Alice").minions.push(makeAlly("A3", "Alice", 2));
    });
    expect(targetsOf(new VtesEngine(state, testRegistry), "Purity of the Beast", "A3")).toEqual([]);
  });

  it("Rumble: any ready minion of another Methuselah, allies included", () => {
    const state = game(["Rumble"], (s) => {
      seat(s, "Bob").minions.push(makeAlly("A1", "Bob", 2));
      seat(s, "Alice").minions.push(makeMinion("V2", "Alice")); // own
      Object.assign(must(s, "M"), { inTorpor: true }); // not ready (p. 30)
    });
    expect(targetsOf(new VtesEngine(state, testRegistry), "Rumble")).toEqual(["A1", "N", "W"]);
  });

  it("Harass: a vampire with 3 or fewer blood, or a locked minion", () => {
    const state = game(["Harass"], (s) => {
      Object.assign(must(s, "W"), { blood: 3 }); // 3 or fewer: offered
      Object.assign(must(s, "M"), { blood: 4 }); // 4, unlocked: not
      Object.assign(must(s, "N"), { blood: 5, locked: true }); // locked: offered
      seat(s, "Bob").minions.push(makeAlly("A1", "Bob", 2)); // an ally's life is not blood
      seat(s, "Carol").minions.push(makeAlly("A2", "Carol", 2, { locked: true })); // locked minion
      seat(s, "Alice").minions.push(makeMinion("V2", "Alice", { blood: 1 })); // own: legal, undirected
    });
    expect(targetsOf(new VtesEngine(state, testRegistry), "Harass")).toEqual(["A2", "N", "V2", "W"]);
  });

  it("Taunt the Caged Beast [ani]: any vampire, own included, never an ally", () => {
    const state = game(["Taunt the Caged Beast"], (s) => {
      Object.assign(must(s, "V1"), { disciplines: { ani: "basic" } });
      seat(s, "Alice").minions.push(makeMinion("V2", "Alice"));
      seat(s, "Bob").minions.push(makeAlly("A1", "Bob", 2));
    });
    expect(targetsOf(new VtesEngine(state, testRegistry), "Taunt the Caged Beast")).toEqual([
      "M",
      "N",
      "V2",
      "W",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Harass: the fizzle and the press
// ---------------------------------------------------------------------------

describe("Harass (100886)", () => {
  const harass = (
    tweak: (s: GameState) => void,
    target: string,
    mid: (s: GameState) => void,
  ): GameState => {
    const state = game(["Harass"], tweak);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announce(`play:Harass:basic:V1:${target}:a0`));
    mid(state);
    runTrace(engine, unblocked);
    return state;
  };

  it("FIZZLES when the target has gained blood and is unlocked by resolution [LSJ 20070411]", () => {
    const state = harass((s) => Object.assign(must(s, "W"), { blood: 3 }), "W", (s) => {
      must(s, "W").blood = 4;
    });
    expect(combatBegan(state)).toBe(false);
    // The action still succeeded; it simply starts no combat.
    expect(state.eventLog.some((e) => e.type === "ActionResolved" && e.success)).toBe(true);
  });

  it("does not fizzle while EITHER term still holds", () => {
    // 4 blood, but locked.
    const locked = harass((s) => Object.assign(must(s, "W"), { blood: 3 }), "W", (s) => {
      Object.assign(must(s, "W"), { blood: 4, locked: true });
    });
    expect(combatBegan(locked)).toBe(true);
    // Unlocked since announcement, but a vampire with 3 or fewer blood.
    const low = harass((s) => Object.assign(must(s, "W"), { blood: 2, locked: true }), "W", (s) => {
      must(s, "W").locked = false;
    });
    expect(combatBegan(low)).toBe(true);
  });

  it("the press can CONTINUE the combat", () => {
    const state = game(["Harass"]);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [...announce("play:Harass:basic:V1:W:a0"), ...unblocked]);
    walk(engine, state, () => engine.decision()?.window === "combat.press");
    expect(engine.decision()!.seat).toBe("Alice");
    expect(ids(engine)).toContain("press:continue");
    runTrace(engine, [["Alice", "press:continue"]]);
    walk(engine, state, () => (combat(state)?.round ?? 0) === 2);
    expect(combat(state)!.round).toBe(2);
  });

  it("…and can never END it", () => {
    const state = game(["Harass"]);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [...announce("play:Harass:basic:V1:W:a0"), ...unblocked]);
    // Bob gets a press of his own, so the combat can be continued against
    // Alice — the one moment an ending press is worth anything.
    combat(state)!.pressesCombat.opposing = 1;
    walk(engine, state, () => engine.decision()?.window === "combat.press");
    runTrace(engine, [["Alice", "pass"], ["Bob", "press:continue"]]);
    // Alice is asked whether to end it, and her only press cannot.
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.press");
    expect(dp.seat).toBe("Alice");
    expect(ids(engine)).not.toContain("press:end");
    walk(engine, state, () => (combat(state)?.round ?? 0) === 2);
    expect(combat(state)!.round).toBe(2);
  });

  it("(control) an ordinary press in the same spot CAN end it", () => {
    const state = game(["Harass"]);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [...announce("play:Harass:basic:V1:W:a0"), ...unblocked]);
    combat(state)!.pressesCombat.opposing = 1;
    combat(state)!.pressesCombat.acting = 1;
    walk(engine, state, () => engine.decision()?.window === "combat.press");
    runTrace(engine, [["Alice", "pass"], ["Bob", "press:continue"]]);
    expect(engine.decision()!.seat).toBe("Alice");
    expect(ids(engine)).toContain("press:end");
  });
});

// ---------------------------------------------------------------------------
// Games of Instinct: either combatant, the capacity, the cap
// ---------------------------------------------------------------------------

describe("Games of Instinct (100801)", () => {
  it("the ACTOR gains when the target goes to torpor, capped at its capacity (p. 5)", () => {
    const state = game(["Games of Instinct"], (s) => {
      Object.assign(must(s, "V1"), { capacity: 5, blood: 2 });
      Object.assign(must(s, "W"), { capacity: 6, blood: 0 }); // one hand strike → torpor
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [...announce("play:Games of Instinct:basic:V1:W:a0"), ...unblocked]);
    walk(engine, state, actionOver(state));
    expect(must(state, "W").inTorpor).toBe(true);
    // 2 − 1 (W's strike) + 6, and the excess back to the bank.
    expect(must(state, "V1").blood).toBe(5);
  });

  it("the TARGET gains when the actor goes to torpor: the actor's capacity", () => {
    const state = game(["Games of Instinct"], (s) => {
      Object.assign(must(s, "V1"), { capacity: 3, blood: 1 });
      Object.assign(must(s, "W"), { capacity: 8, blood: 3, strength: 2 });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [...announce("play:Games of Instinct:basic:V1:W:a0"), ...unblocked]);
    walk(engine, state, actionOver(state));
    expect(must(state, "V1").inTorpor).toBe(true);
    // 3 − 1 (V1's strike) + 3.
    expect(must(state, "W").blood).toBe(5);
  });

  it("reads the capacity of an opponent BURNED in the combat", () => {
    // 1 blood, not 0: a vampire with none must hunt (p. 21).
    const state = game(["Games of Instinct"], (s) => {
      Object.assign(must(s, "V1"), { capacity: 3, blood: 1 });
      Object.assign(must(s, "W"), { capacity: 8, blood: 3, strength: 3 });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [...announce("play:Games of Instinct:basic:V1:W:a0"), ...unblocked]);
    // 3 aggravated on a vampire with 1 blood: wounded by the first point,
    // and 1 blood cannot pay for the other 2 — burned (p. 32).
    combat(state)!.handStrikesAggravated.opposing = true;
    walk(engine, state, actionOver(state));
    expect(state.seats.flatMap((s) => s.minions).some((m) => m.id === "V1")).toBe(false);
    // 3 − 1 + 3, read off the ash-heap entry.
    expect(must(state, "W").blood).toBe(5);
  });

  it("nobody gains while both combatants are ready", () => {
    const state = game(["Games of Instinct"], (s) => {
      Object.assign(must(s, "W"), { capacity: 6, blood: 3 });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [...announce("play:Games of Instinct:basic:V1:W:a0"), ...unblocked]);
    walk(engine, state, actionOver(state));
    expect(must(state, "V1").blood).toBe(1);
    expect(must(state, "W").blood).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Monomancy: the target's offer
// ---------------------------------------------------------------------------

describe("Monomancy (101241)", () => {
  const start = (): { state: GameState; engine: VtesEngine } => {
    const state = game(["Monomancy"], (s) => Object.assign(must(s, "W"), { sect: "sabbat" }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [...announce("play:Monomancy:basic:V1:W:a0"), ...unblocked]);
    return { state, engine };
  };

  it("offers the TARGET, before range in round 1, to end combat — and not the actor", () => {
    const { state, engine } = start();
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.beforeRange");
    expect(dp.seat).toBe("Alice");
    expect(ids(engine).some((i) => i.startsWith("endcombat:"))).toBe(false);
    runTrace(engine, [["Alice", "pass"]]);
    expect(engine.decision()!.seat).toBe("Bob");
    expect(ids(engine)).toContain("endcombat:Monomancy:a0");
    runTrace(engine, [["Bob", "endcombat:Monomancy:a0"]]);
    walk(engine, state, actionOver(state));
    // No strike was made: the combat ended before range.
    expect(must(state, "W").blood).toBe(3);
    const card = must(state, "W").attached.find((p) => p.card.name === "Monomancy");
    expect(card?.statics.bleed).toBe(-1);
    expect(card?.controller).toBe("Alice"); // still Alice's card (p. 16)
    expect(state.eventLog.some((e) => e.type === "CardBurned" && e.cardId === "a0")).toBe(false);
  });

  it("is not offered after range, nor in round 2; a combat ended otherwise BURNS the card", () => {
    const { state, engine } = start();
    // A press for Alice, so a second round happens.
    combat(state)!.pressesCombat.acting = 1;
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"]]);
    // From here on — after range, and all of round 2 — the offer is gone.
    for (let i = 0; i < 80 && combat(state); i++) {
      const options = ids(engine);
      expect(options.some((o) => o.startsWith("endcombat:"))).toBe(false);
      const pick =
        engine.decision()!.window === "combat.press" && options.includes("press:continue") && combat(state)!.round === 1
          ? "press:continue"
          : options.includes("pass")
            ? "pass"
            : options.includes("strike:hand")
              ? "strike:hand"
              : options[0]!;
      engine.choose(pick);
    }
    expect(state.eventLog.some((e) => e.type === "CombatEnded" && e.rounds === 2)).toBe(true);
    walk(engine, state, actionOver(state));
    expect(must(state, "W").attached.some((p) => p.card.name === "Monomancy")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "CardBurned" && e.cardId === "a0")).toBe(true);
  });

  it("is a +1 stealth action", () => {
    const state = game(["Monomancy"], (s) => Object.assign(must(s, "W"), { sect: "sabbat" }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Monomancy:basic:V1:W:a0"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(state.eventLog.some((e) => e.type === "StealthModified" && e.delta === 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Purity of the Beast
// ---------------------------------------------------------------------------

describe("Purity of the Beast (101522)", () => {
  it("the acting vampire has +2 strength in that combat", () => {
    const state = game(["Purity of the Beast"], (s) => seat(s, "Bob").minions.push(makeAlly("A1", "Bob", 4)));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [...announce("play:Purity of the Beast:basic:V1:A1:a0"), ...unblocked]);
    expect(combat(state)!.acting).toBe("V1");
    expect(combat(state)!.strengthBonus.acting).toBe(2);
    walk(engine, state, actionOver(state));
    // A 3-damage hand strike on 4 life.
    expect(must(state, "A1").blood).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Rumble: the hand size, and the end-of-action burn
// ---------------------------------------------------------------------------

describe("Rumble (101661)", () => {
  const withLibrary = (s: GameState): void => {
    seat(s, "Alice").hand.push(...[1, 2, 3, 4, 5, 6].map((i) => ({ id: `h${i}`, name: "Conditioning" })));
    seat(s, "Alice").library = [1, 2, 3, 4, 5].map((i) => ({ id: `l${i}`, name: "Conditioning" }));
  };

  it("+1 hand size during the rush combat, shed when it ends (p. 7)", () => {
    const state = game(["Rumble"], withLibrary);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announce("play:Rumble:basic:V1:W:a0"));
    const before = seat(state, "Alice").hand.length;
    runTrace(engine, unblocked);
    expect(combat(state)).toBeDefined();
    expect(seat(state, "Alice").hand.length).toBe(before + 1);
    walk(engine, state, actionOver(state));
    expect(seat(state, "Alice").hand.length).toBe(before);
  });

  it("burns 1 pool when the actor goes to torpor in the rush combat", () => {
    const state = game(["Rumble"], (s) => {
      Object.assign(must(s, "V1"), { blood: 1 });
      Object.assign(must(s, "W"), { strength: 3 });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [...announce("play:Rumble:basic:V1:W:a0"), ...unblocked]);
    walk(engine, state, actionOver(state));
    expect(must(state, "V1").inTorpor).toBe(true);
    expect(seat(state, "Alice").pool).toBe(9);
  });

  it("burns nothing while the actor is still ready", () => {
    const state = game(["Rumble"]);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [...announce("play:Rumble:basic:V1:W:a0"), ...unblocked]);
    walk(engine, state, actionOver(state));
    expect(must(state, "V1").inTorpor).toBe(false);
    expect(seat(state, "Alice").pool).toBe(10);
  });

  it("BLOCKED: the actor sent to torpor by the blocker still costs 1 pool — and no hand size", () => {
    const state = game(["Rumble"], (s) => {
      withLibrary(s);
      Object.assign(must(s, "V1"), { blood: 1 });
      Object.assign(must(s, "M"), { strength: 3 });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announce("play:Rumble:basic:V1:W:a0"));
    const before = seat(state, "Alice").hand.length;
    walk(engine, state, () => combat(state) !== undefined, { Bob: ["block:M"] });
    expect(combat(state)!.opposing).toBe("M");
    expect(seat(state, "Alice").hand.length).toBe(before);
    walk(engine, state, actionOver(state));
    expect(must(state, "V1").inTorpor).toBe(true);
    expect(seat(state, "Alice").pool).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// Taunt the Caged Beast
// ---------------------------------------------------------------------------

describe("Taunt the Caged Beast (101947)", () => {
  const taunt = (tweak: (s: GameState) => void = () => {}): GameState =>
    game(["Taunt the Caged Beast"], (s) => {
      Object.assign(must(s, "V1"), { disciplines: { ani: "superior" } });
      tweak(s);
    });
  const superiorIds = (engine: VtesEngine): string[] =>
    ids(engine).filter((i) => i.startsWith("play:Taunt the Caged Beast:superior:V1:"));

  it("[ani] gives the actor an optional maneuver in the rush combat", () => {
    const state = taunt((s) => Object.assign(must(s, "V1"), { disciplines: { ani: "basic" } }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [...announce("play:Taunt the Caged Beast:basic:V1:W:a0"), ...unblocked]);
    expect(combat(state)!.maneuverCredits.acting).toBe(1);
  });

  it("[ANI] pairs one ready vampire of the prey with one of the predator", () => {
    const state = taunt((s) => {
      seat(s, "Bob").minions.push(makeAlly("A1", "Bob", 2)); // not a vampire
      seat(s, "Carol").minions.push(makeMinion("N2", "Carol", { inTorpor: true })); // not ready
    });
    const options = superiorIds(new VtesEngine(state, testRegistry));
    expect(options).toHaveLength(2);
    for (const prey of ["W", "M"]) {
      expect(options.some((o) => o.includes(`:${prey}:`) && o.includes(":N:"))).toBe(true);
    }
    expect(options.some((o) => o.includes(":A1:") || o.includes(":N2:"))).toBe(false);
  });

  it("[ANI] is not offered when only one other Methuselah is in the game", () => {
    const state = taunt((s) => {
      s.seats = s.seats.filter((x) => x.id !== "Carol");
    });
    const engine = new VtesEngine(state, testRegistry);
    expect(superiorIds(engine)).toEqual([]);
    // The basic mode is still there — the gate is the superior's own.
    expect(targetsOf(engine, "Taunt the Caged Beast").length).toBeGreaterThan(0);
  });

  const playSuperior = (state: GameState): VtesEngine => {
    const engine = new VtesEngine(state, testRegistry);
    const id = superiorIds(engine).find((o) => o.includes(":W:") && o.includes(":N:"))!;
    runTrace(engine, [...announce(id), ...unblocked]);
    return engine;
  };

  it("[ANI] the prey's vampire goes first, and the actor does not fight", () => {
    const state = taunt();
    const engine = playSuperior(state);
    walk(engine, state, () => combat(state) !== undefined);
    const began = state.eventLog.find((e) => e.type === "CombatBegan");
    expect(began).toMatchObject({ acting: "W", opposing: "N" });
    expect(must(state, "V1").locked).toBe(true);
  });

  it("[ANI] the one ready combatant gains 4 blood", () => {
    const state = taunt((s) => {
      Object.assign(must(s, "W"), { capacity: 10, blood: 3 });
      Object.assign(must(s, "N"), { blood: 0 }); // one hand strike → torpor
    });
    const engine = playSuperior(state);
    walk(engine, state, () => state.frames.length === 1);
    expect(must(state, "N").inTorpor).toBe(true);
    // 3 − 1 (N's strike) + 4.
    expect(must(state, "W").blood).toBe(6);
  });

  it("[ANI] nobody gains while both are ready", () => {
    const state = taunt((s) => Object.assign(must(s, "W"), { capacity: 10, blood: 3 }));
    const engine = playSuperior(state);
    walk(engine, state, () => state.frames.length === 1);
    expect(must(state, "W").blood).toBe(2);
    expect(must(state, "N").blood).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The two defects (§3): the rush combat runs inside resolution
// ---------------------------------------------------------------------------

describe("the rush combat runs inside resolution (D1, D2)", () => {
  it("D1: Bum's Rush draws its replacement AFTER the rush combat [LSJ 20001120]", () => {
    const state = game(["Bum's Rush"], (s) => {
      seat(s, "Alice").library = [{ id: "l1", name: "Conditioning" }];
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [...announce("play:Bum's Rush:basic:V1:W:a0"), ...unblocked]);
    expect(combat(state)).toBeDefined();
    expect(seat(state, "Alice").hand.some((c) => c.id === "l1")).toBe(false);
    walk(engine, state, actionOver(state));
    expect(seat(state, "Alice").hand.some((c) => c.id === "l1")).toBe(true);
  });

  it("D2: Freak Drive is offered AFTER the rush combat, not before it", () => {
    const state = game(["Bum's Rush", "Freak Drive"], (s) => {
      Object.assign(must(s, "V1"), { disciplines: { for: "basic" }, blood: 3 });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [...announce("play:Bum's Rush:basic:V1:W:a0"), ...unblocked]);
    expect(engine.decision()!.window).toBe("combat.beforeRange");
    walk(engine, state, () => engine.decision()?.window === "action.afterResolution");
    expect(state.eventLog.some((e) => e.type === "CombatEnded")).toBe(true);
    expect(ids(engine).some((i) => i.startsWith("play:Freak Drive:"))).toBe(true);
  });

  it("D3: Daring the Dawn's damage lands AFTER the rush combat, not before it", () => {
    // 2 aggravated damage puts V1 in torpor. Before the combat, that would
    // leave the rush with no ready actor, and no combat at all.
    const state = game(["Bum's Rush", "Daring the Dawn"], (s) => {
      Object.assign(must(s, "V1"), { disciplines: { for: "basic" }, blood: 3 });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announce("play:Bum's Rush:basic:V1:W:a0"));
    walk(engine, state, actionOver(state), { Alice: ["play:Daring the Dawn:basic"] });
    expect(seat(state, "Alice").hand).toEqual([]); // Daring the Dawn was played
    expect(combatBegan(state)).toBe(true);
    expect(must(state, "V1").inTorpor).toBe(true);
  });

  it("D3: an after-resolution unlock is offered AFTER the rush combat, not before it", () => {
    // Aline Gädeke: "…can burn 1 blood to unlock after another anarch you
    // control performs a successful action."
    const state = game(["Bum's Rush"], (s) => {
      Object.assign(must(s, "V1"), { sect: "anarch" });
      const aline = makeMinion("V2", "Alice", { blood: 4, sect: "anarch", locked: true });
      const entry = handlers["Aline Gädeke (G6)"]!.cryptEntry!();
      aline.attached.push({
        card: { id: aline.id, name: "Aline Gädeke (G6)" },
        controller: "Alice",
        owner: "Alice",
        locked: false,
        usedThisPhase: false,
        statics: entry.statics,
        tags: entry.tags,
      });
      seat(s, "Alice").minions.push(aline);
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [...announce("play:Bum's Rush:basic:V1:W:a0"), ...unblocked]);
    expect(engine.decision()!.window).toBe("combat.beforeRange");
    walk(engine, state, () => ids(engine).some((i) => i.startsWith("choice:Aline")));
    expect(state.eventLog.some((e) => e.type === "CombatEnded")).toBe(true);
    expect(combat(state)).toBeUndefined();
    runTrace(engine, [["Alice", "choice:Aline"]]);
    expect(must(state, "V2").locked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §5.3: a political action's referendum is INSIDE the action (0.11.61)
// ---------------------------------------------------------------------------

describe("the referendum is part of the political action (p. 43)", () => {
  const pass3: Array<[string, string]> = [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]];
  const at = (state: GameState, type: string): number =>
    state.eventLog.findIndex((e) => e.type === type);

  /** V1 calls Anarchist Uprising (no terms); `hand` joins it. */
  function political(hand: string[], tweak: (s: GameState) => void = () => {}): GameState {
    const state = threeSeatGame();
    seat(state, "Alice").hand = ["Anarchist Uprising", ...hand].map((n, i) => ({ id: `a${i}`, name: n }));
    tweak(state);
    return state;
  }

  it("Freak Drive's after-resolution window opens AFTER the referendum, not before it", () => {
    const state = political(["Freak Drive"], (s) => {
      Object.assign(must(s, "V1"), { disciplines: { dom: "basic", for: "basic" } });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Anarchist Uprising"]]);
    walk(engine, state, () => ids(engine).some((i) => i.startsWith("play:Freak Drive")));
    expect(engine.decision()!.window).toBe("action.afterResolution");
    // The referendum has been called AND tallied by now, and is gone.
    expect(at(state, "ReferendumCalled")).toBeGreaterThanOrEqual(0);
    expect(at(state, "ReferendumResolved")).toBeGreaterThan(at(state, "ReferendumCalled"));
    expect(state.frames.some((f) => f.kind === "referendum")).toBe(false);
    // …and the action is still running: this is not a window after it.
    expect(state.frames.at(-1)?.kind).toBe("action");
  });

  it("Warsaw Station's unlock lands AFTER the referendum, not during it", () => {
    const state = political([], (s) => {
      Object.assign(must(s, "V1"), { blood: 2, clan: "Nosferatu" });
      seat(s, "Alice").permanents.push({
        card: { id: "ws", name: "Warsaw Station" },
        controller: "Alice",
        owner: "Alice",
        locked: false,
        usedThisPhase: false,
        statics: {},
        tags: ["Warsaw Station"],
      });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Anarchist Uprising"], ...pass3, ...pass3]); // as played, announce
    runTrace(engine, [["Alice", "ability:Warsaw Station:ws:unlockOnSuccess"]]);
    runTrace(engine, [...pass3, ...pass3]); // state A, state C → resolves
    // Polling: the action has resolved, and the acting vampire is still
    // locked — "after action resolution" is after the referendum.
    expect(state.frames.at(-1)?.kind).toBe("referendum");
    expect(must(state, "V1").locked).toBe(true);
    walk(engine, state, actionOver(state));
    expect(must(state, "V1").locked).toBe(false);
    const unlocked = state.eventLog.findIndex((e) => e.type === "MinionUnlocked" && e.minion === "V1");
    expect(unlocked).toBeGreaterThan(at(state, "ReferendumResolved"));
  });

  it("Under the Skin superior locks at the END of the action — after the after-resolution window", () => {
    const state = political(["Under the Skin", "Freak Drive"], (s) => {
      Object.assign(must(s, "V1"), {
        title: "primogen",
        capacity: 6,
        disciplines: { dom: "basic", aus: "superior", pre: "superior", for: "basic" },
      });
      Object.assign(must(s, "W"), { title: "primogen", capacity: 5 });
      Object.assign(must(s, "N"), { title: "primogen", capacity: 7 });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Anarchist Uprising"], ...pass3, ...pass3, ...pass3, ...pass3]);
    runTrace(engine, [["Alice", "play:Under the Skin:superior:V1:W"], ...pass3]);
    runTrace(engine, [["Alice", "vote:V1:for"]]);
    walk(engine, state, () => ids(engine).some((i) => i.startsWith("play:Freak Drive")));
    expect(state.eventLog.find((e) => e.type === "ReferendumResolved")).toMatchObject({ passed: true });
    // The referendum has passed, but the action has not ended yet.
    expect(engine.decision()!.window).toBe("action.afterResolution");
    expect(must(state, "W").locked).toBe(false);
    walk(engine, state, actionOver(state));
    expect(must(state, "W").locked).toBe(true);
  });
});
