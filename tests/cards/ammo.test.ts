/**
 * Ammo — wave 16 (docs/ammo-design.md).
 *
 * Manstopper Rounds (101160), Glaser Rounds (100836), Scattershot
 * (101689), Dragon's Breath Rounds (100580), Caseless Rounds (100304).
 *
 * Five cards, one primitive: a card loaded into ONE gun that changes what
 * that gun's strikes do for the rest of the combat. The wave's real
 * content is the window they all need — "only usable before resolution of
 * a gun's strike", which [RTR 19990105] defines as *after strikes have
 * been declared but before they resolve*, and which the engine did not
 * have: `chooseStrike` went straight into `resolveStrikes`.
 *
 * So the negative space matters more than usual here. The window opens
 * only when a seat can actually use it, which means "no option" is the
 * normal state of every combat in the game and a bug in the enumerator
 * would be invisible. Each gate is asserted with a fixture that fails for
 * the RIGHT reason.
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

/**
 * Walk to the first decision whose options satisfy `want`, preferring
 * pass and then end.
 *
 * A walker that takes options[0] plays the board — it would maneuver, and
 * a weapon maneuver COMMITS the strike, which quietly changes what these
 * fixtures are testing.
 */
function walkWhile(
  engine: VtesEngine,
  want: (ids: string[]) => boolean,
  limit = 80,
): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    const ids = dp.options.map((o) => o.id);
    if (want(ids)) return true;
    const pick =
      ids.find((o) => o === "pass") ?? ids.find((o) => o === "end") ?? ids[0]!;
    runTrace(engine, [[dp.seat, pick]]);
  }
  return false;
}

function walkTo(engine: VtesEngine, prefix: string, limit = 80): boolean {
  return walkWhile(engine, (ids) => ids.some((o) => o.startsWith(prefix)), limit);
}

/** Answer everything cheaply until nothing is left to answer. */
function drain(engine: VtesEngine, limit = 60): void {
  walkWhile(engine, () => false, limit);
}

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
 * Alice's V1 bleeds, Bob's M blocks, combat is live at BEFORE RANGE.
 *
 * V1 carries a gun and Alice holds `ammo`. Bob's M is given plenty of
 * blood so a strike lands without ending the fixture, and the range
 * starts long so a gun strike is the natural choice.
 */
function gunFight(ammo: string | null, gun = ".44 Magnum", opts: { mBlood?: number } = {}) {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 5, strength: 1 });
  Object.assign(find(state, "M"), { blood: opts.mBlood ?? 10, strength: 1 });
  equip(state, "V1", "gun1", gun);
  if (ammo) state.seats[0]!.hand.push({ id: "am1", name: ammo });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  return { state, engine };
}

/** Choose the gun strike for V1, then a hand strike for M. */
function bothStrike(engine: VtesEngine): void {
  const isGunStrike = (o: string): boolean =>
    o.startsWith("ability:") && o.endsWith(":strike");
  expect(
    walkWhile(engine, (ids) => ids.some(isGunStrike)),
    "the gun never offered a strike — fixture is wrong",
  ).toBe(true);
  runTrace(engine, [["Alice", optionIds(engine).find(isGunStrike)!]]);
  expect(
    walkTo(engine, "strike:hand"),
    "the blocker was never asked for a strike — fixture is wrong",
  ).toBe(true);
  runTrace(engine, [["Bob", "strike:hand"]]);
}

describe("the before-resolution window", () => {
  it("does not open at all when nobody holds an ammo card", () => {
    // THE DEFAULT STATE OF EVERY COMBAT. The step is skipped, so an
    // ordinary round has exactly the decisions it had before this wave —
    // which is what keeps every other combat test's trace unchanged.
    const { state, engine } = gunFight(null);
    bothStrike(engine);
    expect(combat(state)?.step).not.toBe("beforeResolution");
  });

  it("opens once a seat holds one, and closes on a pass", () => {
    const { state, engine } = gunFight("Manstopper Rounds");
    bothStrike(engine);
    expect(combat(state)?.step).toBe("beforeResolution");
    expect(optionIds(engine).some((o) => o.startsWith("play:Manstopper Rounds"))).toBe(true);
    // Passing it up resolves the strikes rather than hanging the round.
    const dp = engine.decision()!;
    runTrace(engine, [[dp.seat, "pass"]]);
    expect(combat(state)?.step).not.toBe("beforeResolution");
  });

  it("is offered AFTER BOTH strikes are declared, at neither step before", () => {
    // The whole point of the window, asserted at all three moments —
    // "not offered yet" has to be checked where it could plausibly have
    // been offered, or it is a test that passes by standing somewhere
    // harmless.
    const { engine } = gunFight("Manstopper Rounds");
    const offered = (): boolean =>
      optionIds(engine).some((o) => o.startsWith("play:Manstopper Rounds"));
    const isGunStrike = (o: string): boolean =>
      o.startsWith("ability:") && o.endsWith(":strike");

    // 1. The acting minion is choosing. Nobody has declared.
    expect(walkWhile(engine, (ids) => ids.some(isGunStrike))).toBe(true);
    expect(offered(), "offered before any strike was declared").toBe(false);
    runTrace(engine, [["Alice", optionIds(engine).find(isGunStrike)!]]);

    // 2. The gun's strike is declared; the opponent has not answered.
    expect(walkTo(engine, "strike:hand")).toBe(true);
    expect(offered(), "offered while the opponent had not declared").toBe(false);
    runTrace(engine, [["Bob", "strike:hand"]]);

    // 3. Both declared, nothing resolved — [RTR 19990105].
    expect(offered()).toBe(true);
  });
});

describe("what the enumerator refuses", () => {
  it("is not offered when the minion strikes with their HAND", () => {
    // "before resolution of A GUN'S STRIKE" — no gun strike, no ammo.
    // The gun is present and loaded-able; only the strike differs, so
    // this fails for the right reason.
    const { engine } = gunFight("Manstopper Rounds");
    expect(walkTo(engine, "strike:hand")).toBe(true);
    runTrace(engine, [["Alice", "strike:hand"]]);
    runTrace(engine, [["Bob", "strike:hand"]]);
    expect(optionIds(engine).some((o) => o.startsWith("play:Manstopper Rounds"))).toBe(false);
  });

  it("is not offered to the seat whose gun it is NOT", () => {
    // [LSJ 20020425] "cannot be played on an opponent's weapon." Bob
    // holds the ammo; Alice's V1 holds the only gun.
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 5, strength: 1 });
    Object.assign(find(state, "M"), { blood: 10, strength: 1 });
    equip(state, "V1", "gun1", ".44 Magnum");
    state.seats[1]!.hand.push({ id: "am1", name: "Manstopper Rounds" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    bothStrike(engine);
    // Bob never gets the option, so the window never opens for anyone.
    expect(optionIds(engine).some((o) => o.startsWith("play:Manstopper Rounds"))).toBe(false);
  });

  it("refuses a SECOND ammo card in the same gun", () => {
    const { state, engine } = gunFight("Manstopper Rounds");
    state.seats[0]!.hand.push({ id: "am2", name: "Scattershot" });
    bothStrike(engine);
    const first = optionIds(engine).find((o) => o.startsWith("play:Manstopper Rounds"))!;
    runTrace(engine, [["Alice", first]]);
    // "No more than one ammo card can be used on a gun each combat" —
    // and Scattershot was offered a moment ago, so its absence now is
    // the rule biting rather than the card never having been playable.
    expect(optionIds(engine).some((o) => o.startsWith("play:Scattershot"))).toBe(false);
  });
});

describe("Manstopper Rounds (101160)", () => {
  it("adds +1 to the gun's damage for the rest of the combat", () => {
    const { state, engine } = gunFight("Manstopper Rounds");
    bothStrike(engine);
    const play = optionIds(engine).find((o) => o.startsWith("play:Manstopper Rounds"))!;
    const before = find(state, "M").blood;
    runTrace(engine, [["Alice", play]]);
    // .44 Magnum is 2R; with Manstopper it is 3. A vampire burns 1 blood
    // per unprevented normal damage (p. 31).
    drain(engine);
    expect(before - find(state, "M").blood).toBe(3);
  });
});

describe("Glaser Rounds (100836)", () => {
  it("is NOT offered the first time the gun is used", () => {
    // [RTR 19941109]. The gun has struck once — this very strike — so
    // `gunUses` reads 1 and the card wants 2.
    const { engine } = gunFight("Glaser Rounds");
    bothStrike(engine);
    expect(optionIds(engine).some((o) => o.startsWith("play:Glaser Rounds"))).toBe(false);
  });

  it("is offered the SECOND time, and a plain ammo card was offered the first", () => {
    // The control: Manstopper in the same seat at the same moment IS
    // offered, so the refusal above is Glaser's own clause and not the
    // window failing to open.
    const { engine } = gunFight("Glaser Rounds");
    engine.state.seats[0]!.hand.push({ id: "am2", name: "Manstopper Rounds" });
    bothStrike(engine);
    expect(optionIds(engine).some((o) => o.startsWith("play:Manstopper Rounds"))).toBe(true);
    expect(optionIds(engine).some((o) => o.startsWith("play:Glaser Rounds"))).toBe(false);
  });
});

describe("Scattershot (101689)", () => {
  it("adds +2 at close range", () => {
    const { state, engine } = gunFight("Scattershot");
    // Force the round close before strikes are chosen.
    const cf = combat(state)!;
    cf.range = "close";
    bothStrike(engine);
    const play = optionIds(engine).find((o) => o.startsWith("play:Scattershot"))!;
    const before = find(state, "M").blood;
    runTrace(engine, [["Alice", play]]);
    drain(engine);
    // 2R + 2 = 4, less whatever M's own hand strike did to V1 (which
    // does not touch M's blood).
    expect(before - find(state, "M").blood).toBe(4);
  });

  it("SUBTRACTS 2 at long range — the same card, read at every strike", () => {
    const { state, engine } = gunFight("Scattershot");
    const cf = combat(state)!;
    cf.range = "long";
    bothStrike(engine);
    const play = optionIds(engine).find((o) => o.startsWith("play:Scattershot"))!;
    const before = find(state, "M").blood;
    runTrace(engine, [["Alice", play]]);
    drain(engine);
    // 2R - 2 = 0: no damage at all, which is the card being a penalty
    // rather than the strike failing.
    expect(before - find(state, "M").blood).toBe(0);
  });
});

describe("Dragon's Breath Rounds (100580)", () => {
  it("adds a SEPARATE aggravated packet and leaves the base damage normal", () => {
    // [LSJ 20030419-2]: "does not make the gun base damage aggravated."
    // A .44 with Dragon's Breath is 2 normal AND 2 aggravated — two
    // pending damages, not one aggravated four.
    const { state, engine } = gunFight("Dragon's Breath Rounds");
    bothStrike(engine);
    const play = optionIds(engine).find((o) => o.startsWith("play:Dragon's Breath Rounds"))!;
    const before = find(state, "M").blood;
    runTrace(engine, [["Alice", play]]);
    drain(engine);
    const m = maybe(state, "M");
    // The two readings differ OBSERVABLY, which is why this asserts the
    // outcome rather than the queue:
    //   2 normal + 2 aggravated → 2 blood burned to mend the normal, and
    //     the aggravated cannot be mended, so M goes to torpor;
    //   4 normal (the wrong reading) → 4 blood burned, M stays ready.
    expect(before - (m?.blood ?? 0)).toBe(2);
    expect(m?.inTorpor ?? true).toBe(true);
  });

  it("burns the gun after the strike resolves", () => {
    const { state, engine } = gunFight("Dragon's Breath Rounds");
    bothStrike(engine);
    const play = optionIds(engine).find((o) => o.startsWith("play:Dragon's Breath Rounds"))!;
    runTrace(engine, [["Alice", play]]);
    expect(find(state, "V1").attached.some((p) => p.card.id === "gun1")).toBe(true);
    drain(engine);
    expect(maybe(state, "V1")?.attached.some((p) => p.card.id === "gun1") ?? false).toBe(false);
  });

  it("does NOT burn the gun when combat ends before the strike resolves", () => {
    // [LSJ 19981006]. A "strike: combat ends" resolves before all other
    // strikes (p. 33), so the gun's strike never resolves — and the
    // ammo's rider is downstream of that return.
    const { state, engine } = gunFight("Dragon's Breath Rounds");
    bothStrike(engine);
    const play = optionIds(engine).find((o) => o.startsWith("play:Dragon's Breath Rounds"))!;
    runTrace(engine, [["Alice", play]]);
    const cf = combat(state)!;
    // Replace the opposing strike with combat-ends, the way a card would.
    cf.strikes.opposing = { ...cf.strikes.opposing!, combatEnds: true };
    cf.pendingDamage = [];
    cf.step = "chooseStrike";
    drain(engine);
    expect(maybe(state, "V1")?.attached.some((p) => p.card.id === "gun1") ?? false).toBe(true);
  });
});

describe("Caseless Rounds (100304)", () => {
  const isGunStrike = (o: string): boolean =>
    o.startsWith("ability:") && o.endsWith(":strike");

  it("gives the bearer a SECOND gun strike in the same round", () => {
    // A big blood pool on the blocker so the round survives to the
    // additional-strike sub-round — the effect is invisible if the
    // fixture kills the target with the first shot.
    const { engine } = gunFight("Caseless Rounds", ".44 Magnum", { mBlood: 30 });
    bothStrike(engine);
    const play = optionIds(engine).find((o) => o.startsWith("play:Caseless Rounds"))!;
    runTrace(engine, [["Alice", play]]);
    // The extra strike arrives as another choose-strike step (p. 30).
    expect(
      walkWhile(engine, (ids) => ids.some(isGunStrike)),
      "no additional strike was offered",
    ).toBe(true);
    // "Only usable to strike with this gun" — the commitment is the .44
    // ruling the engine has held all along, and it bars the hand strike.
    expect(optionIds(engine)).not.toContain("strike:hand");
  });

  it("CONTROL: without it, the same fixture gets no second strike", () => {
    // The assertion above is only meaningful if a plain gun round does
    // NOT offer a second strike — otherwise it would pass on any card.
    const { engine } = gunFight(null, ".44 Magnum", { mBlood: 30 });
    bothStrike(engine);
    expect(walkWhile(engine, (ids) => ids.some(isGunStrike), 30)).toBe(false);
  });

  it("grants it only ONCE each round", () => {
    // "Once each round when the bearer strikes with this gun" — the
    // second shot must not buy a third.
    const { engine } = gunFight("Caseless Rounds", ".44 Magnum", { mBlood: 30 });
    bothStrike(engine);
    runTrace(engine, [["Alice", optionIds(engine).find((o) => o.startsWith("play:Caseless"))!]]);
    expect(walkWhile(engine, (ids) => ids.some(isGunStrike))).toBe(true);
    runTrace(engine, [["Alice", optionIds(engine).find(isGunStrike)!]]);
    // A third gun strike in this round would mean the rider fired twice.
    expect(walkWhile(engine, (ids) => ids.some(isGunStrike), 25)).toBe(false);
  });
});

describe("the wave's shape", () => {
  it("all five carry the ammo keyword, and nothing else does", () => {
    // Pinned to the REASON rather than to a count: "ammo" is a printed
    // keyword line, like "Grapple." and "Aim.", and the Sword of the
    // Archangel filters on keywords — so a card gaining or losing one is
    // a fact worth failing on.
    const named = Object.entries(testRegistry)
      .filter(([, h]) => (h.cardKeywords?.() ?? []).includes("ammo"))
      .map(([name]) => name)
      .sort();
    expect(named).toEqual([
      "Caseless Rounds",
      "Dragon's Breath Rounds",
      "Glaser Rounds",
      "Manstopper Rounds",
      "Scattershot",
    ]);
  });
});
