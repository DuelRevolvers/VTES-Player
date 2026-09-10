/**
 * The last equipment and the last modifiers
 * (docs/last-equipment-modifiers-design.md).
 *
 * Bowl of Convergence (100243), Flaming Candle (100743), Living Manse
 * (101114), Monkey Wrench (101239), Spying Mission (101857), Go-getter
 * (102355).
 *
 * Equipment finishes at zero; Action Modifier finishes at two, both
 * wraith/zombie-BLOCKED.
 */

import { describe, expect, it } from "vitest";
import type {
  ActionFrame,
  CombatFrame,
  GameState,
  MinionState,
  PermanentInPlay,
} from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { currentIntercept } from "../../src/engine/derived.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function combat(state: GameState): CombatFrame | undefined {
  const f = state.frames.find((x) => x.kind === "combat");
  return f?.kind === "combat" ? f : undefined;
}

function action(state: GameState): ActionFrame | undefined {
  const f = state.frames.find((x) => x.kind === "action");
  return f?.kind === "action" ? f : undefined;
}

/** An equipment card already in play on `minion`, entered the way the
 *  engine enters it — through the handler, so the central "every
 *  equipment card is tagged `equipment`" backfill is exercised. */
function equip(
  state: GameState,
  minionId: string,
  cardId: string,
  name: string,
): PermanentInPlay {
  const m = find(state, minionId);
  const h = testRegistry[name];
  if (!h) throw new Error(`no handler ${name}`);
  const e: PermanentInPlay = {
    card: { id: cardId, name },
    locked: false,
    usedThisPhase: false,
    statics: h.permanentStatics ?? {},
    tags: h.permanentTags ?? [],
  };
  m.attached.push(e);
  return e;
}

/** A standing +N intercept on a blocker, so that p. 26's only-when-needed
 *  gate lets a STEALTH modifier onto the table at all. */
function giveIntercept(state: GameState, minionId: string, amount: number): void {
  find(state, minionId).attached.push({
    card: { id: `int-${minionId}`, name: "watchfulness" },
    locked: false,
    usedThisPhase: false,
    statics: { intercept: amount },
    tags: ["watchfulness"],
  });
}

/** Walk the impulse cycle until some seat is offered `prefix`, passing
 *  everything else. */
function walkTo(engine: VtesEngine, prefix: string, limit = 60): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    engine.choose(pick.id);
  }
  return false;
}

// ---------------------------------------------------------------------------
// §1 — the equipment tag, and the one card that opts out
// ---------------------------------------------------------------------------

describe("every equipment card is tagged `equipment` (§1)", () => {
  const registry = buildHandlerRegistry();

  it("tags every equipment handler, spec-compiled and hand-rolled alike", () => {
    const untagged = Object.values(registry)
      .filter((h) => h.isEquipment)
      .filter((h) => !(h.permanentTags ?? []).includes("equipment"))
      .map((h) => h.name);
    // The opt-out is PRINTED, so this list grows only when a card that
    // says so is added. Sacré-Cœur Cathedral arrived with tranche 3
    // wave 3 and prints the same clause as Living Manse: "this equipment
    // card represents a location and does not count as equipment while
    // in play". Sorted, so the order the specs happen to sit in cannot
    // break it.
    expect(untagged.sort()).toEqual(["Living Manse", "Sacré-Cœur Cathedral, France"]);
  });

  it("covers the hand-rolled .44 Magnum, which listed only weapon/gun", () => {
    expect(registry[".44 Magnum"]?.permanentTags).toContain("equipment");
    expect(registry[".44 Magnum"]?.permanentTags).toContain("gun");
  });

  it("makes an equipped weapon reachable by a burn-equipment effect", () => {
    // End to end, not just the tag: Conceal's basic mode is "Ⓓ Burn an
    // equipment", and before the fix it could find neither of these.
    const state = threeSeatGame();
    find(state, "V1").disciplines = { obf: "basic" };
    find(state, "V1").blood = 4;
    seatOf(state, "Alice").hand = [{ id: "c", name: "Conceal" }];
    equip(state, "W", "gun", ".44 Magnum"); // hand-rolled handler
    equip(state, "M", "ak", "AK-47"); // spec-compiled, tagged weapon/gun
    const engine = new VtesEngine(state, testRegistry);
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Conceal"));
    expect(ids.some((o) => o.includes(":gun:"))).toBe(true);
    expect(ids.some((o) => o.includes(":ak:"))).toBe(true);
  });

  it("and a Living Manse is NOT reachable by one — its printed clause", () => {
    const state = threeSeatGame();
    find(state, "V1").disciplines = { obf: "basic" };
    find(state, "V1").blood = 4;
    seatOf(state, "Alice").hand = [{ id: "c", name: "Conceal" }];
    equip(state, "W", "lm", "Living Manse");
    equip(state, "M", "ak", "AK-47"); // the control case
    const engine = new VtesEngine(state, testRegistry);
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Conceal"));
    expect(ids.some((o) => o.includes(":ak:"))).toBe(true);
    expect(ids.some((o) => o.includes(":lm:"))).toBe(false);
  });

  it("Living Manse does NOT count as equipment, which is its printed clause", () => {
    const state = threeSeatGame();
    const e = equip(state, "V1", "lm", "Living Manse");
    expect(e.tags).toContain("location");
    expect(e.tags).not.toContain("equipment");
  });

  // REGRESSION: `compileEquipment.options` never called `meetsRequirements`
  // — the third instance of that bug — so the requirement lines on three
  // already-shipped cards were unenforced. Nothing asserted it, and a
  // too-permissive option list is invisible to the fuzz.
  it("an equip action honours the card's Requires line", () => {
    for (const [card, ok, bad] of [
      ["Shilmulo Tarot", { clan: "Ravnos" }, { clan: "Toreador" }],
      ["Treasured Samadji", { clan: "Ravnos" }, { clan: "Toreador" }],
      ["Stolen Police Cruiser", { sect: "anarch" }, { sect: "camarilla" }],
    ] as const) {
      for (const [who, expected] of [
        [ok, true],
        [bad, false],
      ] as const) {
        const state = threeSeatGame();
        Object.assign(find(state, "V1"), { blood: 4, ...who });
        seatOf(state, "Alice").pool = 20;
        seatOf(state, "Alice").hand = [{ id: "e", name: card }];
        const engine = new VtesEngine(state, testRegistry);
        const offered = optionIds(engine).some((o) => o.startsWith(`play:${card}`));
        expect(offered, `${card} for ${JSON.stringify(who)}`).toBe(expected);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — Bowl of Convergence
// ---------------------------------------------------------------------------

describe("Bowl of Convergence (100243)", () => {
  /** Carol hunts (＋1 inherent stealth, so intercept is live); Bob's M
   *  wears the Bowl and attempts the block. */
  function huntSetup(disciplines: Record<string, "basic" | "superior">): GameState {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn frame");
    tf.seat = "Carol";
    seatOf(state, "Bob").minions.push(
      makeMinion("B2", "Bob", { name: "B2", disciplines }),
    );
    equip(state, "B2", "bowl", "Bowl of Convergence");
    return state;
  }

  /** Give the acting minion a standing +2 stealth, so the Bowl's static
   *  +1 is not enough on its own and the blood ability becomes "needed". */
  function outStealth(state: GameState): void {
    find(state, "N").attached.push({
      card: { id: "cloak", name: "cloak" },
      locked: false,
      usedThisPhase: false,
      statics: { stealth: 2 },
      tags: ["cloak"],
    });
  }

  it("the +1 intercept static needs Auspex — and reads the DERIVED level", () => {
    const engine = new VtesEngine(huntSetup({ aus: "basic" }), testRegistry);
    runTrace(engine, [["Carol", "hunt:N"]]);
    const af = action(engine.state)!;
    expect(currentIntercept(engine.state, af.actionId, "B2")).toBe(1);
  });

  it("does nothing for a bearer without Auspex — the same card, no bonus", () => {
    const engine = new VtesEngine(huntSetup({}), testRegistry);
    runTrace(engine, [["Carol", "hunt:N"]]);
    const af = action(engine.state)!;
    expect(currentIntercept(engine.state, af.actionId, "B2")).toBe(0);
  });

  it("switches on when a Discipline master grants the Auspex", () => {
    const state = huntSetup({});
    // The Discipline master's own statics, as they sit on the vampire.
    find(state, "B2").attached.push({
      card: { id: "dm", name: "Auspex" },
      locked: false,
      usedThisPhase: false,
      statics: { disciplineBoost: "aus" },
      tags: ["Auspex"],
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Carol", "hunt:N"]]);
    const af = action(engine.state)!;
    expect(currentIntercept(engine.state, af.actionId, "B2")).toBe(1);
  });

  it("superior Auspex can burn 1 blood for another +1, but only when needed", () => {
    const engine = new VtesEngine(huntSetup({ aus: "superior" }), testRegistry);
    runTrace(engine, [["Carol", "hunt:N"]]);
    expect(walkTo(engine, "block:B2")).toBe(true);
    runTrace(engine, [["Bob", "block:B2"]]);
    // Intercept 1 vs stealth 1: the block already succeeds, so p. 26's
    // only-when-needed rule withholds the option for the whole attempt.
    expect(walkTo(engine, "ability:Bowl of Convergence", 12)).toBe(false);
  });

  it("is offered once the acting minion out-stealths the bearer", () => {
    const state = huntSetup({ aus: "superior" });
    outStealth(state);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Carol", "hunt:N"]]);
    expect(walkTo(engine, "block:B2")).toBe(true);
    runTrace(engine, [["Bob", "block:B2"]]);
    expect(walkTo(engine, "ability:Bowl of Convergence:bowl:intercept")).toBe(true);
    const before = find(engine.state, "B2").blood;
    const af = action(engine.state)!;
    const was = currentIntercept(engine.state, af.actionId, "B2");
    runTrace(engine, [["Bob", "ability:Bowl of Convergence:bowl:intercept"]]);
    expect(find(engine.state, "B2").blood).toBe(before - 1);
    expect(currentIntercept(engine.state, af.actionId, "B2")).toBe(was + 1);
  });

  it("is not offered to a bearer with only basic Auspex", () => {
    const state = huntSetup({ aus: "basic" });
    outStealth(state);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Carol", "hunt:N"]]);
    expect(walkTo(engine, "block:B2")).toBe(true);
    runTrace(engine, [["Bob", "block:B2"]]);
    expect(walkTo(engine, "ability:Bowl of Convergence", 12)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3 — Flaming Candle
// ---------------------------------------------------------------------------

describe("Flaming Candle (100743)", () => {
  it("burns 1 blood and itself as the action is announced, barring vampires", () => {
    const state = threeSeatGame();
    equip(state, "V1", "fc", "Flaming Candle");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    const ids = optionIds(engine).filter((o) => o.includes("Flaming Candle"));
    expect(ids).toEqual(["ability:Flaming Candle:fc:unblockable"]);
    const before = find(engine.state, "V1").blood;
    runTrace(engine, [["Alice", "ability:Flaming Candle:fc:unblockable"]]);
    expect(find(engine.state, "V1").blood).toBe(before - 1);
    expect(find(engine.state, "V1").attached).toEqual([]);
    expect(action(engine.state)!.blockRestrictions.noVampires).toBe(true);
  });

  it("takes the block off the table for a vampire", () => {
    const state = threeSeatGame();
    equip(state, "V1", "fc", "Flaming Candle");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "ability:Flaming Candle:fc:unblockable"],
    ]);
    expect(walkTo(engine, "block:W")).toBe(false);
  });

  it("is not offered to a vampire who is not the acting minion", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").minions.push(makeMinion("V2", "Alice", { name: "V2" }));
    equip(state, "V2", "fc", "Flaming Candle");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(optionIds(engine).filter((o) => o.includes("Flaming Candle"))).toEqual([]);
  });

  it("only one can be played in a game — the event log is the record", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn frame");
    seatOf(state, "Alice").hand = [{ id: "f1", name: "Flaming Candle" }];
    const engine = new VtesEngine(state, testRegistry);
    expect(optionIds(engine).some((o) => o.startsWith("play:Flaming Candle"))).toBe(true);

    // A copy already played — even one long since burnt — closes the door.
    const state2 = threeSeatGame();
    seatOf(state2, "Alice").hand = [{ id: "f1", name: "Flaming Candle" }];
    state2.eventLog.push({
      type: "CardPlayed",
      seat: "Bob",
      cardId: "f0",
      name: "Flaming Candle",
      minion: null,
      mode: null,
    });
    const engine2 = new VtesEngine(state2, testRegistry);
    expect(optionIds(engine2).some((o) => o.startsWith("play:Flaming Candle"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §4 — Living Manse
// ---------------------------------------------------------------------------

describe("Living Manse (101114)", () => {
  it("gives its bearer +1 bleed", () => {
    const state = threeSeatGame();
    equip(state, "V1", "lm", "Living Manse");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    const pool = seatOf(engine.state, "Bob").pool;
    while (engine.decision()) {
      const dp = engine.decision()!;
      const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      if (dp.window === "turn.minion") break;
      engine.choose(pick.id);
    }
    expect(seatOf(engine.state, "Bob").pool).toBe(pool - 2);
  });

  it("burns itself before range to end the combat", () => {
    const state = threeSeatGame();
    equip(state, "V1", "lm", "Living Manse");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(walkTo(engine, "block:W")).toBe(true);
    runTrace(engine, [["Bob", "block:W"]]);
    expect(walkTo(engine, "ability:Living Manse:lm:endcombat")).toBe(true);
    runTrace(engine, [["Alice", "ability:Living Manse:lm:endcombat"]]);
    // The card is gone and the combat is over.
    expect(find(engine.state, "V1").attached).toEqual([]);
    while (engine.decision() && combat(engine.state)) {
      const dp = engine.decision()!;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    expect(combat(engine.state)).toBeUndefined();
  });

  it("a vampire can have only one", () => {
    const state = threeSeatGame();
    equip(state, "V1", "lm", "Living Manse");
    find(state, "V1").clan = "Tzimisce";
    seatOf(state, "Alice").hand = [{ id: "lm2", name: "Living Manse" }];
    find(state, "V1").blood = 5;
    const engine = new VtesEngine(state, testRegistry);
    expect(
      optionIds(engine).filter((o) => o.startsWith("play:Living Manse")),
    ).toEqual([]);
  });

  it("requires a Tzimisce — the Shilmulo Tarot precedent for a clan tag", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").hand = [{ id: "lm2", name: "Living Manse" }];
    find(state, "V1").blood = 5;
    find(state, "V1").clan = "Toreador";
    const noClan = new VtesEngine(state, testRegistry);
    expect(optionIds(noClan).filter((o) => o.startsWith("play:Living Manse"))).toEqual([]);

    const state2 = threeSeatGame();
    seatOf(state2, "Alice").hand = [{ id: "lm2", name: "Living Manse" }];
    find(state2, "V1").blood = 5;
    find(state2, "V1").clan = "Tzimisce";
    const yes = new VtesEngine(state2, testRegistry);
    expect(optionIds(yes).filter((o) => o.startsWith("play:Living Manse")).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §5 — Monkey Wrench
// ---------------------------------------------------------------------------

describe("Monkey Wrench (101239)", () => {
  /** Announce the bleed and walk to the state-A window where a modifier
   *  is actually offered — modifiers are never offered in the announce
   *  cycle. */
  function anarchBleed(): VtesEngine {
    const state = threeSeatGame();
    find(state, "V1").sect = "anarch";
    seatOf(state, "Alice").hand = [{ id: "mw", name: "Monkey Wrench" }];
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    walkTo(engine, "play:Monkey Wrench");
    return engine;
  }

  it("offers one option per legal X — 1, 2 and 3, no more", () => {
    const engine = anarchBleed();
    const ids = optionIds(engine)
      .filter((o) => o.startsWith("play:Monkey Wrench"))
      .sort();
    expect(ids.length).toBe(3);
    expect(ids.every((o) => /:[123]:mw$/.test(o))).toBe(true);
  });

  it("+3 bleed really is +3", () => {
    const engine = anarchBleed();
    const three = optionIds(engine).find((o) => o.endsWith(":3:mw"))!;
    const pool = seatOf(engine.state, "Bob").pool;
    runTrace(engine, [["Alice", three]]);
    while (engine.decision()) {
      const dp = engine.decision()!;
      if (dp.window === "turn.minion") break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    expect(seatOf(engine.state, "Bob").pool).toBe(pool - 4);
  });

  it("requires an Anarch", () => {
    const state = threeSeatGame();
    find(state, "V1").sect = "camarilla";
    seatOf(state, "Alice").hand = [{ id: "mw", name: "Monkey Wrench" }];
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(walkTo(engine, "play:Monkey Wrench", 10)).toBe(false);
  });

  it("is (limited), so a second one is not offered whatever X", () => {
    const state = threeSeatGame();
    find(state, "V1").sect = "anarch";
    seatOf(state, "Alice").hand = [
      { id: "mw", name: "Monkey Wrench" },
      { id: "mw2", name: "Monkey Wrench" },
    ];
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    walkTo(engine, "play:Monkey Wrench");
    const first = optionIds(engine).find((o) => o.endsWith(":1:mw"))!;
    runTrace(engine, [["Alice", first]]);
    expect(walkTo(engine, "play:Monkey Wrench", 8)).toBe(false);
  });

  it("is not offered on a non-bleed action", () => {
    const state = threeSeatGame();
    find(state, "V1").sect = "anarch";
    seatOf(state, "Alice").hand = [{ id: "mw", name: "Monkey Wrench" }];
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "hunt:V1"]]);
    expect(walkTo(engine, "play:Monkey Wrench", 10)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §6 — Spying Mission
// ---------------------------------------------------------------------------

describe("Spying Mission (101857)", () => {
  function bleedWithCard(level: Record<string, "basic" | "superior">): VtesEngine {
    const state = threeSeatGame();
    find(state, "V1").disciplines = level;
    seatOf(state, "Alice").hand = [{ id: "sm", name: "Spying Mission" }];
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    return engine;
  }

  it("the superior is NOT offered in state A, where a block is still possible", () => {
    const engine = bleedWithCard({ obf: "superior" });
    // The announce cycle and state A both precede state C.
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Spying Mission"));
    expect(ids.some((o) => o.includes(":superior:"))).toBe(false);
  });

  it("is offered in state C, and then fails the bleed for no pool", () => {
    const engine = bleedWithCard({ obf: "superior" });
    expect(walkTo(engine, "play:Spying Mission:superior")).toBe(true);
    const pool = seatOf(engine.state, "Bob").pool;
    runTrace(engine, [["Alice", "play:Spying Mission:superior"]]);
    while (engine.decision() && action(engine.state)) {
      const dp = engine.decision()!;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    // "the bleed burns no pool, is unsuccessful"
    expect(seatOf(engine.state, "Bob").pool).toBe(pool);
    // "…and this card is put on this vampire", remembering the Methuselah.
    const att = find(engine.state, "V1").attached;
    expect(att.map((p) => p.card.name)).toEqual(["Spying Mission"]);
    expect(att[0]!.againstSeat).toBe("Bob");
  });

  it("pays out +2 on the next bleed against the SAME Methuselah, and burns", () => {
    const state = threeSeatGame();
    find(state, "V1").attached.push({
      card: { id: "sm", name: "Spying Mission" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Spying Mission", "spyingMission"],
      againstSeat: "Bob",
    });
    const engine = new VtesEngine(state, testRegistry);
    const pool = seatOf(state, "Bob").pool;
    runTrace(engine, [["Alice", "bleed:V1"]]);
    while (engine.decision()) {
      const dp = engine.decision()!;
      if (dp.window === "turn.minion") break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    // 1 base + 2 = 3 pool.
    expect(seatOf(engine.state, "Bob").pool).toBe(pool - 3);
    expect(find(engine.state, "V1").attached).toEqual([]);
  });

  it("does NOT pay out against a different Methuselah", () => {
    const state = threeSeatGame();
    find(state, "V1").attached.push({
      card: { id: "sm", name: "Spying Mission" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Spying Mission", "spyingMission"],
      againstSeat: "Carol", // not Alice's prey
    });
    const engine = new VtesEngine(state, testRegistry);
    const pool = seatOf(state, "Bob").pool;
    runTrace(engine, [["Alice", "bleed:V1"]]);
    while (engine.decision()) {
      const dp = engine.decision()!;
      if (dp.window === "turn.minion") break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    expect(seatOf(engine.state, "Bob").pool).toBe(pool - 1);
    // Still there, waiting for the right target.
    expect(find(engine.state, "V1").attached.length).toBe(1);
  });

  it("the payout is NOT (limited) — it stacks with a limited bonus", () => {
    const state = threeSeatGame();
    find(state, "V1").sect = "anarch";
    find(state, "V1").attached.push({
      card: { id: "sm", name: "Spying Mission" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Spying Mission", "spyingMission"],
      againstSeat: "Bob",
    });
    seatOf(state, "Alice").hand = [{ id: "mw", name: "Monkey Wrench" }];
    const engine = new VtesEngine(state, testRegistry);
    const pool = seatOf(state, "Bob").pool;
    runTrace(engine, [["Alice", "bleed:V1"]]);
    walkTo(engine, "play:Monkey Wrench");
    const one = optionIds(engine).find((o) => o.endsWith(":1:mw"))!;
    runTrace(engine, [["Alice", one]]);
    while (engine.decision()) {
      const dp = engine.decision()!;
      if (dp.window === "turn.minion") break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    // 1 base + 1 limited + 2 from the card in play.
    expect(seatOf(engine.state, "Bob").pool).toBe(pool - 4);
  });

  it("the basic mode is an ordinary +1 stealth", () => {
    const state = threeSeatGame();
    find(state, "V1").disciplines = { obf: "basic" };
    seatOf(state, "Alice").hand = [{ id: "sm", name: "Spying Mission" }];
    giveIntercept(state, "W", 1);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "hunt:V1"]]);
    // p. 26: stealth is only offered when NEEDED, so the blocker's
    // intercept has to have caught up with the hunt's inherent +1.
    expect(walkTo(engine, "block:W")).toBe(true);
    runTrace(engine, [["Bob", "block:W"]]);
    expect(walkTo(engine, "play:Spying Mission:basic")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §7 — Go-getter (basic only; the superior is PARTIAL)
// ---------------------------------------------------------------------------

describe("Go-getter (102355)", () => {
  it("gives +1 stealth on a non-bleed action when stealth is needed", () => {
    const state = threeSeatGame();
    find(state, "V1").disciplines = { obf: "basic" };
    find(state, "V1").clan = "Ravnos";
    seatOf(state, "Alice").hand = [{ id: "gg", name: "Go-getter" }];
    giveIntercept(state, "W", 1);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "hunt:V1"]]);
    expect(walkTo(engine, "block:W")).toBe(true);
    runTrace(engine, [["Bob", "block:W"]]);
    expect(walkTo(engine, "play:Go-getter")).toBe(true);
  });

  // Both negatives below reproduce the POSITIVE case exactly and change
  // one thing, so a "not offered" cannot be not-offered for some unrelated
  // reason (a stealth modifier is withheld entirely when stealth is not
  // needed, which would make either assertion vacuous).
  it("is NOT usable during a bleed", () => {
    const state = threeSeatGame();
    find(state, "V1").disciplines = { obf: "basic" };
    find(state, "V1").clan = "Ravnos";
    seatOf(state, "Alice").hand = [{ id: "gg", name: "Go-getter" }];
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    // A bleed is 0 stealth against 0 intercept, so stealth IS needed once
    // somebody attempts — the card is withheld by its own timing clause.
    expect(walkTo(engine, "block:W")).toBe(true);
    runTrace(engine, [["Bob", "block:W"]]);
    expect(walkTo(engine, "play:Go-getter", 12)).toBe(false);
  });

  it("requires a Ravnos", () => {
    const state = threeSeatGame();
    find(state, "V1").disciplines = { obf: "basic" };
    find(state, "V1").clan = "Toreador";
    seatOf(state, "Alice").hand = [{ id: "gg", name: "Go-getter" }];
    giveIntercept(state, "W", 1);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "hunt:V1"]]);
    expect(walkTo(engine, "block:W")).toBe(true);
    runTrace(engine, [["Bob", "block:W"]]);
    expect(walkTo(engine, "play:Go-getter", 12)).toBe(false);
  });

  it("both modes exist — the superior shipped 2026-09-03", () => {
    // This asserted `["basic"]` for as long as the superior was ledgered
    // as PARTIAL. It is the guard that would have caught the superior
    // being quietly dropped, so it flips rather than being deleted
    // (docs/ledger-closeout.md §11).
    const modes = testRegistry["Go-getter"]?.modesPlayableBy?.(
      makeMinion("x", "Alice", { disciplines: { obf: "superior" }, clan: "Ravnos" }),
      false,
    );
    expect(modes).toEqual(["basic", "superior"]);
  });
});
