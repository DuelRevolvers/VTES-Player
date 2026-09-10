/**
 * What a weapon does besides hit (docs/weapon-riders-design.md).
 *
 * AK-47 (100032), Sniper Rifle (101816), Righteous Blade (102359), Sword
 * of the Archangel (102261), Treasured Samadji (102015).
 *
 * Equipment's first per-card wave. The weapons gate has existed since
 * docs/weapons-design.md; `spec.weapon` has five fields, and each of the
 * five weapons left in the pool adds exactly one thing it cannot say.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function maybe(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function combat(state: GameState): CombatFrame | undefined {
  const f = state.frames.find((x) => x.kind === "combat");
  return f?.kind === "combat" ? f : undefined;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function walkTo(engine: VtesEngine, prefix: string, limit = 80): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return false;
}

/** Equip a minion with a spec-compiled weapon, statics and all. */
function equip(state: GameState, minion: string, id: string, name: string): PermanentInPlay {
  const h = testRegistry[name];
  const p: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h?.permanentStatics ?? {},
    tags: h?.permanentTags ?? [],
  };
  find(state, minion).attached.push(p);
  return p;
}

/**
 * Alice's V1 bleeds, Bob's M blocks, and the combat is live at the
 * BEFORE RANGE window. Equipment is attached before the engine starts.
 */
function intoCombat(setup: (state: GameState) => void = () => {}) {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 5, strength: 1 });
  Object.assign(find(state, "M"), { blood: 5, strength: 1 });
  setup(state);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block → combat
  ]);
  return { state, engine };
}

/** Answer everything cheaply until the combat frame is gone. */
function drain(engine: VtesEngine, state: GameState, limit = 90): void {
  for (let i = 0; i < limit && combat(state); i++) {
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

// ---------------------------------------------------------------------------

describe("AK-47 (100032)", () => {
  it("its strike grants an additional strike COMMITTED to the gun", () => {
    const { state, engine } = intoCombat((s) => equip(s, "V1", "ak", "AK-47"));
    expect(walkTo(engine, "ability:AK-47:ak:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:AK-47:ak:strike"]]);
    const cf = combat(state)!;
    const side = cf.acting === "V1" ? "acting" : "opposing";
    expect(cf.additionalStrikes[side]).toBe(1);
    // "…only usable to strike with this gun": the .44 ruling's commitment.
    expect(cf.committedStrike[side]).toBe("ak");
    // (limited) — a second source cannot stack another this round (p. 32).
    expect(cf.usedLimitedAddl[side]).toBe(true);
  });

  it("the extra sub-round offers ONLY the gun — no hand strike", () => {
    const { state, engine } = intoCombat((s) => equip(s, "V1", "ak", "AK-47"));
    expect(walkTo(engine, "ability:AK-47:ak:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:AK-47:ak:strike"]]);
    // Walk to the extra sub-round's strike choice for Alice.
    for (let i = 0; i < 60 && combat(state); i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (
        dp.seat === "Alice" &&
        dp.window === "combat.chooseStrike" &&
        dp.options.some((o) => o.id.startsWith("ability:AK-47"))
      ) {
        expect(dp.options.map((o) => o.id)).not.toContain("strike:hand");
        return;
      }
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    throw new Error("never reached the second strike choice");
  });
});

describe("Sniper Rifle (101816)", () => {
  it("NEGATIVE SPACE: its strike is not offered at CLOSE range", () => {
    const { state, engine } = intoCombat((s) => equip(s, "V1", "sr", "Sniper Rifle"));
    // Combat opens at long range; force close and check the gate bites.
    combat(state)!.range = "close";
    expect(walkTo(engine, "ability:Sniper Rifle:sr:strike", 25)).toBe(false);
  });

  it("…and IS offered at long range — the control case", () => {
    const { state, engine } = intoCombat((s) => equip(s, "V1", "sr", "Sniper Rifle"));
    combat(state)!.range = "long";
    expect(walkTo(engine, "ability:Sniper Rifle:sr:strike")).toBe(true);
  });

  it("a BLOCKING bearer sets the range to long and commits the strike", () => {
    // The blocker is the opposing side of the action's combat, so the
    // rifle goes on Bob's M.
    const { state, engine } = intoCombat((s) => equip(s, "M", "sr", "Sniper Rifle"));
    const cf = combat(state)!;
    cf.range = "close";
    expect(cf.fromBlock).toBe(true);
    expect(walkTo(engine, "ability:Sniper Rifle:sr:snipe")).toBe(true);
    runTrace(engine, [["Bob", "ability:Sniper Rifle:sr:snipe"]]);
    expect(combat(state)!.range).toBe("long");
    expect(combat(state)!.committedStrike.opposing).toBe("sr");
  });

  it("NEGATIVE SPACE: no snipe when the bearer is the ACTOR, not the blocker", () => {
    const { state, engine } = intoCombat((s) => equip(s, "V1", "sr", "Sniper Rifle"));
    combat(state)!.range = "close";
    expect(walkTo(engine, "ability:Sniper Rifle:sr:snipe", 25)).toBe(false);
  });
});

describe("Righteous Blade (102359)", () => {
  it("grants a press credit that can ONLY continue combat", () => {
    const { state, engine } = intoCombat((s) => equip(s, "V1", "rb", "Righteous Blade"));
    const cf = combat(state)!;
    const side = cf.acting === "V1" ? "acting" : "opposing";
    expect(cf.pressesContinueOnly?.[side]).toBe(1);
    // No general credit came with it — that is the whole distinction.
    expect(cf.presses[side] + cf.pressesCombat[side]).toBe(0);
  });

  it("the credit buys press:continue, and press:end is never offered by it", () => {
    const { state, engine } = intoCombat((s) => equip(s, "V1", "rb", "Righteous Blade"));
    expect(walkTo(engine, "press:continue")).toBe(true);
    const dp = engine.decision()!;
    expect(dp.options.map((o) => o.id)).not.toContain("press:end");
    runTrace(engine, [[dp.seat, "press:continue"]]);
    const cf = combat(state)!;
    const side = cf.acting === "V1" ? "acting" : "opposing";
    // Spent from the restricted pool — the shortest-lived-first rule.
    expect(cf.pressesContinueOnly?.[side]).toBe(0);
    expect(cf.willContinue).toBe(true);
  });

  it("its strike is strength+1", () => {
    const { state, engine } = intoCombat((s) => equip(s, "V1", "rb", "Righteous Blade"));
    expect(walkTo(engine, "ability:Righteous Blade:rb:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:Righteous Blade:rb:strike"]]);
    const cf = combat(state)!;
    const side = cf.acting === "V1" ? "acting" : "opposing";
    expect(cf.strikes[side]).toMatchObject({ damage: null, handBonus: 1, ranged: false });
  });
});

describe("Sword of the Archangel (102261)", () => {
  it("strikes for strength+1 AGGRAVATED", () => {
    const { state, engine } = intoCombat((s) => equip(s, "V1", "sw", "Sword of the Archangel"));
    expect(walkTo(engine, "ability:Sword of the Archangel:sw:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:Sword of the Archangel:sw:strike"]]);
    const cf = combat(state)!;
    const side = cf.acting === "V1" ? "acting" : "opposing";
    expect(cf.strikes[side]).toMatchObject({ handBonus: 1, aggravated: true });
  });

  it("unlocks the bearer at the end of combat when its strike BURNED the foe", () => {
    const { state, engine } = intoCombat((s) =>
      equip(s, "V1", "sw", "Sword of the Archangel"),
    );
    // Aggravated damage BURNS an already-wounded vampire who cannot pay
    // to survive (p. 34). A minion in torpor cannot block, so the wound
    // is applied once the combat is live rather than legislated through
    // a two-round fight.
    Object.assign(find(state, "M"), { inTorpor: true, blood: 0 });
    expect(walkTo(engine, "ability:Sword of the Archangel:sw:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:Sword of the Archangel:sw:strike"]]);
    drain(engine, state);
    expect(maybe(state, "M")).toBeUndefined(); // burned
    // The bearer locked at announcement (p. 25) and the sword frees them.
    expect(find(state, "V1").locked).toBe(false);
    expect(find(state, "V1").attached[0]!.usedThisTurn).toBe(true);
  });

  it("NEGATIVE SPACE: no unlock when the foe SURVIVES", () => {
    // The control case — same weapon, same strike, a victim who lives.
    const { state, engine } = intoCombat((s) =>
      equip(s, "V1", "sw", "Sword of the Archangel"),
    );
    expect(walkTo(engine, "ability:Sword of the Archangel:sw:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:Sword of the Archangel:sw:strike"]]);
    drain(engine, state);
    expect(maybe(state, "M")).toBeDefined();
    expect(find(state, "V1").locked).toBe(true);
  });

  it("KEYWORD FILTER: exactly the grapple and aim cards are what it names", () => {
    // Written when both keyword cards were still unsupported, so this
    // asserted the EMPTY set — the Wall Street Night precedent. The
    // round-end wave shipped them and it became the positive, which is
    // why the negative was pinned to a REASON rather than to a number.
    //
    // It is scoped to the two keywords the Sword filters on, not to
    // every keyword in the pool: "Boon." is a printed keyword too, and a
    // card acquiring one must not break this.
    const named = (kw: string): string[] =>
      Object.entries(testRegistry)
        .filter(([, h]) => (h.cardKeywords?.() ?? []).includes(kw))
        .map(([n]) => n)
        .sort();
    expect(named("grapple")).toEqual(["Immortal Grapple"]);
    expect(named("aim")).toEqual(["Target Vitals"]);
    // The Sword itself has no keyword — it FILTERS on them.
    expect(testRegistry["Sword of the Archangel"]!.cardKeywords?.()).toEqual([]);
    expect(testRegistry["Conditioning"]!.cardKeywords?.()).toEqual([]);
  });

  it("…and the Sword can now actually cancel one", () => {
    // Bob's M carries the Sword; Alice's V1 plays Immortal Grapple.
    const { state, engine } = intoCombat((s) => {
      equip(s, "M", "sw", "Sword of the Archangel");
      Object.assign(find(s, "V1"), { disciplines: { pot: "basic" }, blood: 5 });
      s.seats[0]!.hand.push({ id: "ig", name: "Immortal Grapple" });
    });
    expect(walkTo(engine, "play:Immortal Grapple:basic")).toBe(true);
    const play = optionIds(engine).find((o) => o.startsWith("play:Immortal Grapple:basic"))!;
    runTrace(engine, [["Alice", play]]);
    const cancel = "ability:Sword of the Archangel:sw:cancelkw";
    expect(walkTo(engine, cancel)).toBe(true);
    const blood = find(state, "M").blood;
    runTrace(engine, [["Bob", cancel]]);
    expect(find(state, "M").blood).toBe(blood - 1);
    for (let i = 0; i < 12; i++) {
      const dp = engine.decision();
      if (!dp || state.eventLog.some((e) => e.type === "CardCanceled")) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(state.eventLog.some((e) => e.type === "CardCanceled")).toBe(true);
    // Cancelled as played, so the restriction never landed.
    expect(combat(state)?.handStrikesOnly ?? false).toBe(false);
  });
});

describe("Treasured Samadji (102015)", () => {
  it("gives +1 bleed and a once-per-combat granted DODGE", () => {
    const { state, engine } = intoCombat((s) => {
      Object.assign(find(s, "V1"), { clan: "Ravnos" });
      equip(s, "V1", "ts", "Treasured Samadji");
    });
    expect(find(state, "V1").attached[0]!.statics.bleed).toBe(1);

    expect(walkTo(engine, "ability:Treasured Samadji:ts:grantstrike")).toBe(true);
    runTrace(engine, [["Alice", "ability:Treasured Samadji:ts:grantstrike"]]);
    // The granted strike appears in the same chooseStrike step…
    expect(optionIds(engine)).toContain("strike:dodge");
    runTrace(engine, [["Alice", "strike:dodge"]]);
    const cf = combat(state)!;
    const side = cf.acting === "V1" ? "acting" : "opposing";
    expect(cf.strikes[side]).toMatchObject({ dodge: true, damage: 0 });
    // …and is SPENT when taken.
    expect(cf.grantedStrikes?.[side] ?? []).not.toContain("dodge");
  });

  it("NEGATIVE SPACE: a non-Ravnos bearer is offered nothing", () => {
    const { engine } = intoCombat((s) => {
      Object.assign(find(s, "V1"), { clan: "Ventrue" });
      equip(s, "V1", "ts", "Treasured Samadji");
    });
    expect(walkTo(engine, "ability:Treasured Samadji:ts:grantstrike", 25)).toBe(false);
  });

  it("NEGATIVE SPACE: 'strike: dodge' is never on the table unGRANTED", () => {
    // The sharpest control for §1: the same combat with no card granting
    // it offers only the built-in hand strike.
    const { engine } = intoCombat();
    expect(walkTo(engine, "strike:hand")).toBe(true);
    expect(optionIds(engine)).not.toContain("strike:dodge");
  });
});

// ---------------------------------------------------------------------------
// Whose strike is it? (regression, tranche 3 wave 11)
// ---------------------------------------------------------------------------

describe("a weapon in an ADDITIONAL sub-round", () => {
  it("is offered to the OPPOSING side when only they have the extra strike", () => {
    // The bug the fuzz found. The weapon compiler decided whose turn it
    // was with "`strikes.acting === null` means the acting side" — true
    // in a normal round, WRONG in an additional sub-round, where only the
    // minions with additional strikes strike (p. 32) and a
    // non-participant's `strikes[side]` stays null all sub-round. The
    // opposing bearer was offered nothing; with the AK-47's commitment
    // also barring the hand strike, they had NO legal option at all.
    const { state, engine } = intoCombat((s) => equip(s, "M", "ak", "AK-47"));
    expect(walkTo(engine, "ability:AK-47:ak:strike")).toBe(true);
    runTrace(engine, [["Bob", "ability:AK-47:ak:strike"]]);
    const cf = combat(state)!;
    const side = cf.opposing === "M" ? "opposing" : "acting";
    expect(cf.additionalStrikes[side]).toBe(1);
    expect(cf.committedStrike[side]).toBe("ak");

    // Walk into the extra sub-round and check the bearer is asked, with
    // the gun on offer.
    expect(walkTo(engine, "ability:AK-47:ak:strike")).toBe(true);
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.chooseStrike");
    expect(dp.options.length).toBeGreaterThan(0);
  });

  it("a commitment to a weapon that has LEFT PLAY frees the hand strike", () => {
    // The other half of the same dead end: a commitment names a card, and
    // that card can be burned between the maneuver and the strike. A
    // commitment to a card that is gone is no commitment.
    const { state, engine } = intoCombat((s) => equip(s, "V1", "sr", "Sniper Rifle"));
    const cf = combat(state)!;
    cf.range = "close";
    const side = cf.acting === "V1" ? "acting" : "opposing";
    cf.committedStrike[side] = "sr";
    // Burn the weapon out from under the commitment.
    find(state, "V1").attached = find(state, "V1").attached.filter((p) => p.card.id !== "sr");

    expect(walkTo(engine, "strike:hand")).toBe(true);
  });
});
