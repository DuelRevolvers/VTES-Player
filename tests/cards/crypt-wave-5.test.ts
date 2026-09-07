/**
 * Crypt wave 5 — granted actions with a cost (docs/crypt-wave-5.md).
 *
 * Six cards, one clause. Every one is DRIVEN TO RESOLUTION rather than
 * merely offered, because wave 2's two silent no-ops were both options
 * that were offered, legal, taken — and accomplished nothing, with no
 * error anywhere. An offered option that cannot do its job looks exactly
 * like a working one.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentStatics } from "../../src/engine/index.ts";
import { VtesEngine, blockTollFor, playCostFor } from "../../src/engine/index.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const handlers = buildHandlerRegistry();

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

function attach(
  m: MinionState,
  id: string,
  name: string,
  statics: PermanentStatics = {},
  tags: string[] = [],
) {
  m.attached.push({
    card: { id, name },
    controller: m.controller,
    owner: m.controller,
    locked: false,
    usedThisPhase: false,
    statics,
    tags,
  });
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}
function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}
function walkTo(engine: VtesEngine, prefix: string, limit = 160): boolean {
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
/**
 * Run the action in flight to resolution and STOP.
 *
 * It answers choice frames and otherwise passes, and it stops the moment
 * no action or choice frame is left — deliberately never falling through
 * to `options[0]`. A walker that takes the first option plays the board:
 * the first version of this helper kept going after Eulogio's action
 * resolved, he took a SECOND action with the turn still his, and the
 * re-lock made his unlock look broken. The engine was right.
 */
function resolve(engine: VtesEngine, state: GameState, limit = 60): void {
  for (let i = 0; i < limit; i++) {
    const busy = state.frames.some((f) => f.kind === "action" || f.kind === "choice");
    if (!busy) return;
    const dp = engine.decision();
    if (!dp) return;
    const pick =
      dp.options.find((o) => o.id.startsWith("choice:")) ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
}

/** A game where Alice's V1 carries `cryptName` and can act. */
function withCrypt(cryptName: string, setUp: (s: GameState) => void = () => {}) {
  const state = threeSeatGame();
  const v1 = find(state, "V1");
  asVampire(v1, cryptName);
  v1.blood = 4;
  setUp(state);
  const engine = new VtesEngine(state, testRegistry);
  return { state, engine, v1 };
}

// ---------------------------------------------------------------------------
// Seraphina — add blood, capped at starting life
// ---------------------------------------------------------------------------

describe("Seraphina", () => {
  it("adds 2 blood to one of your own minions", () => {
    const { state, engine } = withCrypt("Seraphina (G7)", (s) => {
      s.seats[0]!.minions.push(makeMinion("V9", "Alice", { capacity: 8, blood: 1 }));
    });
    expect(walkTo(engine, "act:Seraphina (G7)")).toBe(true);
    const opt = optionIds(engine).find((o) => o.includes(":granted:") && o.includes("blood:V9"))!;
    expect(opt).toBeDefined();
    runTrace(engine, [["Alice", opt]]);
    resolve(engine, state);
    expect(find(state, "V9").blood).toBe(3);
  });

  it("adds LIFE to an ally too — the same field behind the kind discriminant", () => {
    const { state, engine } = withCrypt("Seraphina (G7)", (s) => {
      // makeAlly's third argument is LIFE, positional — an ally at 1 of 5.
      s.seats[0]!.minions.push(makeAlly("A9", "Alice", 5, { blood: 1 }));
    });
    walkTo(engine, "act:Seraphina (G7)");
    const opt = optionIds(engine).find((o) => o.includes("blood:A9"))!;
    runTrace(engine, [["Alice", opt]]);
    resolve(engine, state);
    expect(find(state, "A9").blood).toBe(3);
  });

  it("caps at STARTING LIFE, and offers nothing to a minion already full", () => {
    const { state, engine } = withCrypt("Seraphina (G7)", (s) => {
      // One point of room: "not to exceed starting life" must give 1, not 2.
      s.seats[0]!.minions.push(makeMinion("V9", "Alice", { capacity: 5, blood: 4 }));
      // And one with none at all.
      s.seats[0]!.minions.push(makeMinion("V8", "Alice", { capacity: 5, blood: 5 }));
    });
    walkTo(engine, "act:Seraphina (G7)");
    const ids = optionIds(engine);
    // A full minion is not offered: the whole content of the option is
    // the blood gain (docs/futile-options-design.md).
    expect(ids.some((o) => o.includes("blood:V8"))).toBe(false);
    runTrace(engine, [["Alice", ids.find((o) => o.includes("blood:V9"))!]]);
    resolve(engine, state);
    expect(find(state, "V9").blood).toBe(5);
  });

  it("cannot reach ANOTHER Methuselah's minion", () => {
    const { engine } = withCrypt("Seraphina (G7)");
    walkTo(engine, "act:Seraphina (G7)");
    const ids = optionIds(engine).filter((o) => o.includes(":granted:"));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((o) => o.includes(":W") || o.includes(":N"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Saankaláxt — steal an equipment
// ---------------------------------------------------------------------------

describe("Saankaláxt", () => {
  it("moves the equipment onto herself and charges 1 blood at resolution", () => {
    const { state, engine, v1 } = withCrypt("Saankaláxt (G6)", (s) => {
      attach(find(s, "W"), "gun", ".44 Magnum", {}, ["equipment"]);
    });
    expect(walkTo(engine, "act:Saankaláxt (G6)")).toBe(true);
    const opt = optionIds(engine).find((o) => o.includes("equip:gun"))!;
    expect(opt).toBeDefined();
    const bloodBefore = v1.blood;
    runTrace(engine, [["Alice", opt]]);
    resolve(engine, state);
    expect(find(state, "V1").attached.some((p) => p.card.id === "gun")).toBe(true);
    expect(find(state, "W").attached.some((p) => p.card.id === "gun")).toBe(false);
    // Paid at RESOLUTION (p. 27), not at announcement.
    expect(find(state, "V1").blood).toBe(bloodBefore - 1);
  });

  it("does NOT enter combat with the target — it is a steal, not a rush", () => {
    const { state, engine } = withCrypt("Saankaláxt (G6)", (s) => {
      attach(find(s, "W"), "gun", ".44 Magnum", {}, ["equipment"]);
    });
    walkTo(engine, "act:Saankaláxt (G6)");
    runTrace(engine, [["Alice", optionIds(engine).find((o) => o.includes("equip:gun"))!]]);
    resolve(engine, state);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
  });

  it("offers nothing with no equipment on the table", () => {
    const { engine } = withCrypt("Saankaláxt (G6)");
    walkTo(engine, "end");
    expect(optionIds(engine).some((o) => o.includes("act:Saankaláxt"))).toBe(false);
  });

  it("is not offered to a vampire who cannot pay the blood", () => {
    // LOCKED, not at 0 blood: a vampire at 0 blood MUST hunt (p. 21) and
    // the walker would feed him, measuring the walk rather than the gate.
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    asVampire(v1, "Saankaláxt (G6)");
    v1.blood = 0;
    v1.locked = true;
    attach(find(state, "W"), "gun", ".44 Magnum", {}, ["equipment"]);
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "end");
    expect(optionIds(engine).some((o) => o.includes("act:Saankaláxt"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lenelle — an exchange, so no replacement either way
// ---------------------------------------------------------------------------

describe("Lenelle", () => {
  it("swaps a hand card for one in the ash heap", () => {
    const { state, engine } = withCrypt("Lenelle, Mambo of Birmingham (G6)", (s) => {
      s.seats[0]!.hand.push({ id: "give1", name: "Aire of Elation" });
      s.seats[0]!.ashHeap = [{ id: "take1", name: "Cats' Guidance" }];
      s.seats[0]!.library.push({ id: "lib1", name: "Aire of Elation" });
    });
    expect(walkTo(engine, "act:Lenelle")).toBe(true);
    const opt = optionIds(engine).find((o) => o.includes("swap:give1:take1"))!;
    expect(opt).toBeDefined();
    const handBefore = state.seats[0]!.hand.length;
    runTrace(engine, [["Alice", opt]]);
    resolve(engine, state);
    expect(state.seats[0]!.hand.some((c) => c.id === "take1")).toBe(true);
    expect(state.seats[0]!.hand.some((c) => c.id === "give1")).toBe(false);
    // An EXCHANGE draws no replacement either way — the hand is the same
    // size and the library is untouched.
    expect(state.seats[0]!.hand.length).toBe(handBefore);
    expect(state.seats[0]!.library.some((c) => c.id === "lib1")).toBe(true);
  });

  it("will not take a burnt VAMPIRE out of the ash heap", () => {
    // "A LIBRARY card in your ash heap" — burnt vampires are in there too
    // since the ledger closeout, and a vampire card has no handler.
    const { engine } = withCrypt("Lenelle, Mambo of Birmingham (G6)", (s) => {
      s.seats[0]!.hand.push({ id: "give1", name: "Aire of Elation" });
      s.seats[0]!.ashHeap = [{ id: "vamp1", name: "Alexa Draper (G6)", crypt: true }];
    });
    walkTo(engine, "end");
    expect(optionIds(engine).some((o) => o.includes("swap:"))).toBe(false);
  });

  it("offers nothing with an empty ash heap", () => {
    const { engine } = withCrypt("Lenelle, Mambo of Birmingham (G6)", (s) => {
      s.seats[0]!.hand.push({ id: "give1", name: "Aire of Elation" });
      s.seats[0]!.ashHeap = [];
    });
    walkTo(engine, "end");
    expect(optionIds(engine).some((o) => o.includes("swap:"))).toBe(false);
  });

  /**
   * THE CRASH THE FAIR-MATCH HARNESS FOUND (2026-09-06).
   *
   * Both cards are named AT ANNOUNCEMENT (p. 25) and moved AT RESOLUTION,
   * and the hand card can be gone in between — the action's own impulse
   * cycle is a window in which its owner may play it. The engine threw
   * `card not in hand`, which is a crash rather than a rules outcome:
   * four games in 160 died on it.
   *
   * `stealEquipment`, four cases up in the same switch, had guarded
   * against exactly this since it was written. This one had not — the
   * drift this project keeps finding between two clauses that share a
   * shape.
   *
   * Neither the fuzz nor `npm run simulate` could see it: both play the
   * mid-game playtest snapshot, and it took games dealt fresh from a real
   * precon for a full hand and this ability to meet.
   */
  it("survives the named hand card leaving between announcement and resolution", () => {
    const { state, engine } = withCrypt("Lenelle, Mambo of Birmingham (G6)", (s) => {
      s.seats[0]!.hand.push({ id: "give1", name: "Aire of Elation" });
      s.seats[0]!.ashHeap = [{ id: "take1", name: "Cats' Guidance" }];
    });
    expect(walkTo(engine, "act:Lenelle")).toBe(true);
    const opt = optionIds(engine).find((o) => o.includes("swap:give1:take1"))!;
    expect(opt).toBeDefined();

    // ANNOUNCE, then take the card away before the action resolves — the
    // shape the crash had.
    runTrace(engine, [["Alice", opt]]);
    state.seats[0]!.hand = state.seats[0]!.hand.filter((c) => c.id !== "give1");

    expect(() => resolve(engine, state)).not.toThrow();
    // ONE exchange with one cost, so no give means no take: the ash-heap
    // card stays where it is rather than being handed over free.
    expect(state.seats[0]!.hand.some((c) => c.id === "take1")).toBe(false);
    expect((state.seats[0]!.ashHeap ?? []).some((c) => c.id === "take1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hel-Blá — an ally back from the ash heap, LOCKED
// ---------------------------------------------------------------------------

describe("Hel-Blá", () => {
  it("returns a qualifying ally to the ready region, locked", () => {
    const { state, engine } = withCrypt("Hel-Blá (G6)", (s) => {
      // Bone Shambler is a real ally requiring Oblivion.
      s.seats[0]!.ashHeap = [{ id: "ally1", name: "Bone Shambler" }];
    });
    expect(walkTo(engine, "act:Hel-Blá (G6)")).toBe(true);
    const opt = optionIds(engine).find((o) => o.includes("ally:ally1"))!;
    expect(opt).toBeDefined();
    runTrace(engine, [["Alice", opt]]);
    resolve(engine, state);
    const revived = state.seats[0]!.minions.find((m) => m.id === "ally1");
    expect(revived).toBeDefined();
    expect(revived!.kind).toBe("ally");
    // "…LOCKED" — the clause the generic return does not supply.
    expect(revived!.locked).toBe(true);
    // "…with life equal to its STARTING LIFE".
    expect(revived!.blood).toBe(revived!.capacity);
  });

  it("does NOT return an ally requiring neither Hecata nor Oblivion", () => {
    // Screamer is a REAL ally in the ash heap that simply requires
    // nothing — so this fails for the filter's reason, not because the
    // card was unrecognised. A negative that is empty for the wrong
    // reason looks exactly like a correct one.
    const { engine } = withCrypt("Hel-Blá (G6)", (s) => {
      s.seats[0]!.ashHeap = [{ id: "ally1", name: "Screamer" }];
    });
    expect(handlers["Screamer"]?.allyEntry).toBeDefined();
    walkTo(engine, "end");
    expect(optionIds(engine).some((o) => o.includes("ally:ally1"))).toBe(false);
  });

  it("does not treat a non-ally library card as an ally", () => {
    const { engine } = withCrypt("Hel-Blá (G6)", (s) => {
      s.seats[0]!.ashHeap = [{ id: "c1", name: "Shroud of Decay" }];
    });
    walkTo(engine, "end");
    expect(optionIds(engine).some((o) => o.includes("ally:c1"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Eulogio — reorder the top of the library, and unlock
// ---------------------------------------------------------------------------

describe("Eulogio", () => {
  function stacked() {
    return withCrypt("Eulogio Sánchez de los Reyes (G6)", (s) => {
      s.seats[0]!.library.length = 0;
      for (const n of ["a", "b", "c", "d", "e", "f"]) {
        s.seats[0]!.library.push({ id: n, name: "Aire of Elation" });
      }
    });
  }

  it("puts a chosen card on top, and unlocks him", () => {
    const { state, engine } = stacked();
    expect(walkTo(engine, "act:Eulogio")).toBe(true);
    runTrace(engine, [["Alice", optionIds(engine).find((o) => o.includes(":granted:"))!]]);
    // The first question is which card goes first.
    if (!walkTo(engine, "choice:Eulogio")) throw new Error("no reorder choice");
    const pickC = optionIds(engine).find((o) => o.endsWith(":c"))!;
    expect(pickC).toBeDefined();
    runTrace(engine, [["Alice", pickC]]);
    expect(state.seats[0]!.library[0]!.id).toBe("c");
    resolve(engine, state);
    // "…AND UNLOCK" is a real effect: he locked at announcement (p. 25).
    expect(find(state, "V1").locked).toBe(false);
  });

  it("only ever reaches into the top 5 — the sixth card is not offered", () => {
    const { engine } = stacked();
    walkTo(engine, "act:Eulogio");
    runTrace(engine, [["Alice", optionIds(engine).find((o) => o.includes(":granted:"))!]]);
    walkTo(engine, "choice:Eulogio");
    const ids = optionIds(engine);
    expect(ids.some((o) => o.endsWith(":e"))).toBe(true);
    expect(ids.some((o) => o.endsWith(":f"))).toBe(false);
  });

  it("never reveals the cards to the table — the log names none of them", () => {
    // A REORDER is not a search: the cards stay in the library, so a log
    // entry naming them would leak what only the owner may see.
    const { state, engine } = stacked();
    walkTo(engine, "act:Eulogio");
    runTrace(engine, [["Alice", optionIds(engine).find((o) => o.includes(":granted:"))!]]);
    walkTo(engine, "choice:Eulogio");
    runTrace(engine, [["Alice", optionIds(engine).find((o) => o.endsWith(":c"))!]]);
    const moved = state.eventLog.filter((e) => e.type === "LibraryCardMoved");
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.every((e) => !("name" in e))).toBe(true);
    // And it is not a search, so nothing is shuffled.
    expect(state.eventLog.some((e) => e.type === "LibraryShuffled")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase hooks that ask a question
// ---------------------------------------------------------------------------

/** Walk to the given phase of Alice's turn, answering choice frames. */
function toPhase(engine: VtesEngine, state: GameState, phase: string, limit = 80): boolean {
  for (let i = 0; i < limit; i++) {
    const tf = state.frames.find((f) => f.kind === "turn");
    if (tf?.kind === "turn" && tf.phase === phase) return true;
    const dp = engine.decision();
    if (!dp) return false;
    const pick =
      dp.options.find((o) => o.id.startsWith("choice:")) ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return false;
}

describe("Mora", () => {
  it("puts an ash-heap card on the BOTTOM of the library, not the top", () => {
    const { state, engine } = withCrypt("Mora, the Death Seer (G6)", (s) => {
      s.seats[0]!.ashHeap = [{ id: "ash1", name: "Cats' Guidance" }];
      s.seats[0]!.library.push({ id: "lib1", name: "Aire of Elation" });
    });
    expect(toPhase(engine, state, "discard")).toBe(true);
    const opt = optionIds(engine).find((o) => o.includes("discardPhaseChoice:ash1"));
    expect(opt).toBeDefined();
    runTrace(engine, [["Alice", opt!]]);
    const lib = state.seats[0]!.library;
    expect(lib[lib.length - 1]!.id).toBe("ash1");
    expect(lib[0]!.id).toBe("lib1");
    expect(state.seats[0]!.ashHeap).toHaveLength(0);
  });

  it("declining does nothing — 'you CAN', so the frame is optional", () => {
    const { state, engine } = withCrypt("Mora, the Death Seer (G6)", (s) => {
      s.seats[0]!.ashHeap = [{ id: "ash1", name: "Cats' Guidance" }];
    });
    toPhase(engine, state, "discard");
    // The option list carries a plain pass, which an optional frame's
    // decline is (a mandatory one would offer no way out).
    expect(optionIds(engine)).toContain("pass");
    runTrace(engine, [["Alice", "pass"]]);
    expect(state.seats[0]!.ashHeap).toHaveLength(1);
  });

  it("will not move a burnt VAMPIRE — 'a LIBRARY card in your ash heap'", () => {
    const { state, engine } = withCrypt("Mora, the Death Seer (G6)", (s) => {
      s.seats[0]!.ashHeap = [{ id: "v1c", name: "Alexa Draper (G6)", crypt: true }];
    });
    toPhase(engine, state, "discard");
    expect(optionIds(engine).some((o) => o.includes("discardPhaseChoice:v1c"))).toBe(false);
  });
});

describe("Luciano Carvalho", () => {
  it("moves an ANIMAL retainer between two vampires you control", () => {
    const { state, engine } = withCrypt("Luciano Carvalho (G7)", (s) => {
      s.seats[0]!.minions.push(makeMinion("V9", "Alice"));
      attach(find(s, "V1"), "pet", "Raven Spy", {}, ["animal"]);
    });
    expect(toPhase(engine, state, "discard")).toBe(true);
    const opt = optionIds(engine).find((o) => o.includes("discardPhaseChoice:pet:V9"));
    expect(opt).toBeDefined();
    runTrace(engine, [["Alice", opt!]]);
    expect(find(state, "V9").attached.some((p) => p.card.id === "pet")).toBe(true);
    expect(find(state, "V1").attached.some((p) => p.card.id === "pet")).toBe(false);
  });

  it("does not move a retainer that is not an ANIMAL", () => {
    const { state, engine } = withCrypt("Luciano Carvalho (G7)", (s) => {
      s.seats[0]!.minions.push(makeMinion("V9", "Alice"));
      attach(find(s, "V1"), "guy", "Carlton Van Wyk", {}, ["retainer"]);
    });
    toPhase(engine, state, "discard");
    expect(optionIds(engine).some((o) => o.includes("discardPhaseChoice:guy"))).toBe(false);
  });

  it("does not reach ANOTHER Methuselah's vampire", () => {
    const { state, engine } = withCrypt("Luciano Carvalho (G7)", (s) => {
      attach(find(s, "V1"), "pet", "Raven Spy", {}, ["animal"]);
    });
    toPhase(engine, state, "discard");
    // Only Alice's own V1 has the pet and she controls no other vampire,
    // so there is nowhere legal to move it — and Bob's W is not offered.
    expect(optionIds(engine).some((o) => o.includes(":pet:W"))).toBe(false);
  });
});

describe("Gnaeus Aemilius Augustinus", () => {
  it("makes the PREY choose which of their own minions takes the damage", () => {
    const state = threeSeatGame();
    asVampire(find(state, "V1"), "Gnaeus Aemilius Augustinus (G6)");
    find(state, "W").blood = 5;
    find(state, "M").blood = 5;
    const engine = new VtesEngine(state, testRegistry);
    // `threeSeatGame()` OPENS AT `turn.minion` — Alice's unlock phase has
    // already happened — so this walks a full rotation to her next one,
    // ending turns rather than taking actions.
    let asked: string | null = null;
    for (let i = 0; i < 200; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const opt = dp.options.find((o) => o.id.includes("unlockPhaseDamage:"));
      if (opt) {
        // Alice's PREY is Bob, and Bob is the one being asked.
        expect(dp.seat).toBe("Bob");
        asked = opt.id;
        // Mandatory ("your prey CHOOSES"): no way to decline.
        expect(dp.options.some((o) => o.id === "pass")).toBe(false);
        break;
      }
      const pick =
        dp.options.find((o) => o.id === "pass") ??
        dp.options.find((o) => o.id === "end") ??
        dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
    }
    expect(asked).not.toBeNull();
    const target = asked!.split(":").pop()!;
    const before = find(state, target).blood;
    runTrace(engine, [["Bob", asked!]]);
    expect(find(state, target).blood).toBe(before - 1);
  });

  it("does not fire on a seat that is not the card's controller", () => {
    // "YOUR unlock phase" — the unlock window is offered to EVERY seat,
    // which is the 2026-08-02 bug this gate exists for.
    const state = threeSeatGame();
    asVampire(find(state, "W"), "Gnaeus Aemilius Augustinus (G6)"); // Bob's
    const engine = new VtesEngine(state, testRegistry);
    for (let i = 0; i < 20; i++) {
      const dp = engine.decision();
      if (!dp) break;
      // It is Alice's turn, so Bob's card must stay silent.
      expect(dp.options.some((o) => o.id.includes("unlockPhaseDamage:"))).toBe(false);
      const tf = state.frames.find((f) => f.kind === "turn");
      if (tf?.kind === "turn" && tf.phase !== "unlock") break;
      runTrace(engine, [[dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id]]);
    }
  });
});

// ---------------------------------------------------------------------------
// Filters on the minion opposite you
// ---------------------------------------------------------------------------

describe("Djeneba and Algirdas — strike cards cost the OTHER combatant", () => {
  const strike = {
    name: "Torn Signpost",
    bloodCost: 0,
    poolCost: 0,
    types: ["combat" as const, "strike" as const],
    requires: [] as string[],
  };

  /** A live combat between Alice's V1 (carrying `cryptName`) and Bob's W. */
  function inCombat(cryptName: string, tweak: (s: GameState) => void = () => {}) {
    const state = threeSeatGame();
    asVampire(find(state, "V1"), cryptName);
    tweak(state);
    state.frames.push({
      kind: "combat",
      acting: "V1",
      opposing: "W",
    } as unknown as GameState["frames"][number]);
    return state;
  }

  it("Djeneba charges the minion fighting her, and nobody else", () => {
    const state = inCombat("Djeneba (G7)");
    const cf = state.frames.find((f) => f.kind === "combat")!;
    expect(playCostFor(state, strike, find(state, "W"), null, cf as never).blood).toBe(1);
    // A third party not in the fight pays the printed price.
    expect(playCostFor(state, strike, find(state, "N"), null, cf as never).blood).toBe(0);
  });

  it("…and the surcharge lifts when the combat is gone — nothing is stored", () => {
    // The rule docs/retainer-wave-design.md §1 states: a combat ends four
    // different ways, so the modifier is read off the live frame.
    const state = inCombat("Djeneba (G7)");
    expect(playCostFor(state, strike, find(state, "W"), null, null).blood).toBe(0);
  });

  it("Djeneba's toll is payable in LIFE, so it reaches an ally", () => {
    // p. 22 gives allies life, not blood: a cost printed in blood alone
    // would exempt them entirely, which is why `bloodOrLife` matters.
    const state = inCombat("Djeneba (G7)", (s) => {
      s.seats[1]!.minions.push(makeAlly("A1", "Bob", 4));
    });
    const cf = state.frames.find((f) => f.kind === "combat")!;
    (cf as unknown as { opposing: string }).opposing = "A1";
    expect(playCostFor(state, strike, find(state, "A1"), null, cf as never).blood).toBe(1);
  });

  it("Algirdas charges only a YOUNGER opposing vampire", () => {
    const younger = inCombat("Algirdas, The Solar Prophet (G6)", (s) => {
      find(s, "V1").capacity = 7;
      find(s, "W").capacity = 4;
    });
    const older = inCombat("Algirdas, The Solar Prophet (G6)", (s) => {
      find(s, "V1").capacity = 7;
      find(s, "W").capacity = 9;
    });
    const cfY = younger.frames.find((f) => f.kind === "combat")!;
    const cfO = older.frames.find((f) => f.kind === "combat")!;
    expect(playCostFor(younger, strike, find(younger, "W"), null, cfY as never).blood).toBe(1);
    expect(playCostFor(older, strike, find(older, "W"), null, cfO as never).blood).toBe(0);
  });

  it("neither touches a card that is not a strike", () => {
    const state = inCombat("Djeneba (G7)");
    const cf = state.frames.find((f) => f.kind === "combat")!;
    const notStrike = { ...strike, types: ["combat" as const] };
    expect(playCostFor(state, notStrike, find(state, "W"), null, cf as never).blood).toBe(0);
  });
});

describe("Sergio — a block toll that only the corrupted pay", () => {
  function toll(corruption: Record<string, number> | undefined): number | null {
    const state = threeSeatGame();
    const sergio = find(state, "V1");
    asVampire(sergio, "Sergio Bueno (G6)");
    const blocker = find(state, "W");
    if (corruption) blocker.corruption = corruption;
    const af = { blockCosts: [] } as unknown as Parameters<typeof blockTollFor>[0];
    return blockTollFor(af, blocker, sergio);
  }

  it("charges a blocker carrying YOUR corruption", () => {
    expect(toll({ Alice: 1 })).toBe(1);
  });

  it("charges nothing to an uncorrupted blocker", () => {
    expect(toll(undefined)).toBe(0);
  });

  it("charges nothing for SOMEBODY ELSE's corruption counters", () => {
    // "1 or more of YOUR corruption counters" — `corruption` is keyed by
    // the seat that placed it, and the card's controller is the one that
    // counts (p. 16).
    expect(toll({ Bob: 3 })).toBe(0);
  });
});

describe("Faruq — the corrupted cannot end the combat", () => {
  function combatEndsOffered(corruption: Record<string, number> | undefined): boolean {
    const state = threeSeatGame();
    asVampire(find(state, "V1"), "Faruq Abd al-Qadir (G6)");
    const w = find(state, "W");
    w.blood = 6;
    w.capacity = 8;
    // Majesty requires PRESENCE — the discipline the card actually names.
    w.disciplines = { pre: "superior", for: "superior" };
    if (corruption) w.corruption = corruption;
    // Bob holds a combat card whose whole point is ending the combat.
    state.seats[1]!.hand.push({ id: "ce1", name: "Majesty" });
    const v1 = find(state, "V1");
    v1.disciplines = { cel: "basic", tha: "basic" };
    v1.blood = 4;
    state.seats[0]!.hand.push({ id: "rush9", name: "Hunter's Mark" });
    const engine = new VtesEngine(state, testRegistry);
    if (!walkTo(engine, "play:Hunter's Mark")) throw new Error("no rush");
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Hunter's Mark") && o.includes(":W:"))!],
    ]);
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.startsWith("play:Majesty"))) return true;
      if (dp.options.some((o) => o.id === "strike:hand") && dp.seat === "Bob") return false;
      runTrace(engine, [[dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id]]);
    }
    return false;
  }

  it("bars a combat-ends strike from a minion you have corrupted", () => {
    expect(combatEndsOffered({ Alice: 1 })).toBe(false);
  });

  it("leaves an UNCORRUPTED minion's combat-ends strike alone", () => {
    // The control case: without it, a bar that fired on everybody would
    // look identical from the negative test alone.
    expect(combatEndsOffered(undefined)).toBe(true);
  });

  it("ignores another Methuselah's corruption counters", () => {
    expect(combatEndsOffered({ Carol: 2 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Aniel — strip a counter or a card off another minion
// ---------------------------------------------------------------------------

describe("Aniel", () => {
  it("burns one of YOUR corruption counters off another minion", () => {
    const { state, engine } = withCrypt("Aniel (G7)", (s) => {
      const w = find(s, "W");
      w.corruption = { Alice: 2, Bob: 1 };
    });
    expect(walkTo(engine, "act:Aniel (G7)")).toBe(true);
    const opt = optionIds(engine).find((o) => o.includes("corrupt:W"))!;
    expect(opt).toBeDefined();
    runTrace(engine, [["Alice", opt]]);
    resolve(engine, state);
    expect(find(state, "W").corruption?.["Alice"]).toBe(1);
    // Somebody else's counters are not hers to burn.
    expect(find(state, "W").corruption?.["Bob"]).toBe(1);
  });

  it("burns a card that REQUIRES a Discipline, and not one that does not", () => {
    const { state, engine } = withCrypt("Aniel (G7)", (s) => {
      const w = find(s, "W");
      attach(w, "disc", "Cats' Guidance"); // requires Animalism
      attach(w, "plain", ".44 Magnum", {}, ["equipment"]); // requires none
    });
    walkTo(engine, "act:Aniel (G7)");
    const ids = optionIds(engine);
    expect(ids.some((o) => o.includes("card:disc"))).toBe(true);
    // The negative half: a filter that matched everything would look
    // identical from the positive test alone.
    expect(ids.some((o) => o.includes("card:plain"))).toBe(false);
    runTrace(engine, [["Alice", ids.find((o) => o.includes("card:disc"))!]]);
    resolve(engine, state);
    expect(find(state, "W").attached.some((p) => p.card.id === "disc")).toBe(false);
  });

  it("never targets HERSELF — 'another ready minion'", () => {
    const { engine } = withCrypt("Aniel (G7)", (s) => {
      const v1 = find(s, "V1");
      v1.corruption = { Alice: 2 };
      attach(v1, "mine", "Cats' Guidance");
      find(s, "W").corruption = { Alice: 1 };
    });
    walkTo(engine, "act:Aniel (G7)");
    const ids = optionIds(engine).filter((o) => o.includes(":granted:"));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((o) => o.includes("corrupt:V1"))).toBe(false);
    expect(ids.some((o) => o.includes("card:mine"))).toBe(false);
  });

  it("does not offer a minion carrying nothing of hers", () => {
    const { engine } = withCrypt("Aniel (G7)", (s) => {
      find(s, "W").corruption = { Bob: 3 };
    });
    walkTo(engine, "end");
    expect(optionIds(engine).some((o) => o.includes("corrupt:W"))).toBe(false);
  });
});
