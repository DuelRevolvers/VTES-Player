/**
 * Wave 104 — boons (docs/boons-design.md).
 *
 * Lesser Boon (101095), Major Boon (101145), Minor Boon (101219), Extremis
 * Boon (100676): four debts between two Methuselahs, each opened at a moment
 * the engine had no window for — a block that would succeed, a bleed after
 * blocks are declined, a vampire GOING to torpor, an oust — and each read
 * back later by a standing clause. And what they found: Blood Trade's "burn
 * all boons" could not see Life Boon, the one boon that stays in play.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay, SeatState } from "../../src/engine/index.ts";
import { VtesEngine, isReady } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const ids = (engine: VtesEngine): string[] => engine.decision()?.options.map((o) => o.id) ?? [];
const seat = (state: GameState, id: string): SeatState => {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
};
const minion = (state: GameState, id: string): MinionState => {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
};
const entry = (id: string, name: string, extra: Partial<PermanentInPlay> = {}): PermanentInPlay => ({
  card: { id, name },
  locked: false,
  usedThisPhase: false,
  statics: {},
  tags: [name, "boon"],
  ...extra,
});
const turn = (state: GameState) => {
  const tf = state.frames[0];
  if (tf?.kind !== "turn") throw new Error("no turn frame");
  return tf;
};

/** `seatId`'s turn, at `phase`. */
function at(state: GameState, seatId: string, phase: "master" | "minion"): VtesEngine {
  const tf = turn(state);
  tf.seat = seatId;
  tf.phase = phase;
  if (phase === "master") tf.masterActionsLeft = 1;
  return new VtesEngine(state, testRegistry);
}

/** The answer a walker gives when nobody is scripted: pass, else a hand
 *  strike, else the first option. */
function idle(engine: VtesEngine): void {
  const dp = engine.decision()!;
  const pick =
    dp.options.find((o) => o.id === "pass") ??
    dp.options.find((o) => o.id === "strike:hand") ??
    dp.options[0]!;
  runTrace(engine, [[dp.seat, pick.id]]);
}

/** Walk idly until `prefix` is offered; true if it was. Records every option
 *  id seen on the way into `seen`. */
function walkTo(engine: VtesEngine, prefix: string, seen: string[] = [], limit = 120): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    seen.push(...dp.options.map((o) => o.id));
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    idle(engine);
  }
  return false;
}

/** Walk idly while `keepGoing` holds, recording every option id seen. */
function walkWhile(engine: VtesEngine, keepGoing: () => boolean, limit = 120): string[] {
  const seen: string[] = [];
  for (let i = 0; i < limit && keepGoing(); i++) {
    const dp = engine.decision();
    if (!dp) break;
    seen.push(...dp.options.map((o) => o.id));
    idle(engine);
  }
  return seen;
}

/** Take the option starting with `prefix` for whoever is deciding. */
function take(engine: VtesEngine, prefix: string): void {
  const dp = engine.decision()!;
  runTrace(engine, [[dp.seat, prefix]]);
}

const anAction = (state: GameState): boolean => state.frames.some((f) => f.kind === "action");
const attachedNames = (state: GameState, id: string): string[] =>
  minion(state, id).attached.map((p) => p.card.name);

// ---------------------------------------------------------------------------
// Lesser Boon
// ---------------------------------------------------------------------------

describe("Lesser Boon — a block that would succeed resolves as if unblocked", () => {
  /** Alice's V1 bleeds Bob; Bob blocks with W, whose block would succeed. */
  function blockedBleed(holder = "Bob"): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    seat(state, "Bob").hand = [];
    seat(state, holder).hand.push({ id: "lb", name: "Lesser Boon" });
    const engine = at(state, "Alice", "minion");
    take(engine, "bleed:V1");
    expect(walkTo(engine, "block:W")).toBe(true);
    take(engine, "block:W");
    return { state, engine };
  }

  it("the bleed goes through, the blocker stays unlocked, and the card sits on the actor", () => {
    const { state, engine } = blockedBleed();
    expect(walkTo(engine, "play:Lesser Boon")).toBe(true);
    take(engine, "play:Lesser Boon");
    walkWhile(engine, () => anAction(state));
    // "The action resolves as if unblocked instead": Bob is bled for 1.
    expect(seat(state, "Bob").pool).toBe(9);
    expect(state.edge).toBe("Alice");
    // "Effects that depend on the successful block do not see the block as
    // successful" [RTR 20080808]: no success was ever recorded.
    expect(state.eventLog.some((ev) => ev.type === "BlockSucceeded")).toBe(false);
    expect(minion(state, "W").locked).toBe(false);
    const boon = minion(state, "V1").attached.find((p) => p.card.name === "Lesser Boon");
    expect(boon?.controller).toBe("Bob");
    expect(boon?.tags).toContain("boon");
  });

  it("NEGATIVE SPACE: not for a block that would fail", () => {
    // A hunt has +1 stealth (p. 21), so W's attempt would fail.
    const state = threeSeatGame();
    seat(state, "Bob").hand = [{ id: "lb", name: "Lesser Boon" }];
    const engine = at(state, "Alice", "minion");
    take(engine, "hunt:V1");
    expect(walkTo(engine, "block:W")).toBe(true);
    take(engine, "block:W");
    const seen = walkWhile(engine, () => anAction(state));
    expect(seen.some((id) => id.startsWith("play:Lesser Boon"))).toBe(false);
  });

  it("NEGATIVE SPACE: not for a Methuselah whose minion is not the one blocking", () => {
    const { state, engine } = blockedBleed("Carol");
    const seen = walkWhile(engine, () => anAction(state));
    expect(seen.some((id) => id.startsWith("play:Lesser Boon"))).toBe(false);
    // The ordinary block, then: Bob is not bled.
    expect(seat(state, "Bob").pool).toBe(10);
  });

  it("\"this minion cannot block YOUR minions\" — the boon's controller's, not the bearer's", () => {
    // Bob's W hunts: undirected, so Alice (his predator) may block it.
    const bar = (controller: string): string[] => {
      const state = threeSeatGame();
      seat(state, "Bob").hand = [];
      minion(state, "V1").attached.push(entry("lb", "Lesser Boon", {
        controller,
        statics: { cannotBlockControllersMinions: true },
      }));
      const engine = at(state, "Bob", "minion");
      take(engine, "hunt:W");
      // This action only: a later one by Carol's minions is not barred.
      return walkWhile(engine, () => anAction(state));
    };
    expect(bar("Bob").some((id) => id === "block:V1")).toBe(false);
    // A boon Carol holds bars V1 from Carol's minions, not Bob's.
    expect(bar("Carol").some((id) => id === "block:V1")).toBe(true);
  });

  it("burns when its controller blocks the bearer again", () => {
    const state = threeSeatGame();
    seat(state, "Bob").hand = [];
    minion(state, "V1").attached.push(entry("lb", "Lesser Boon", {
      controller: "Bob",
      statics: { burnIfBlockedByController: true },
    }));
    const engine = at(state, "Alice", "minion");
    take(engine, "bleed:V1");
    expect(walkTo(engine, "block:W")).toBe(true);
    take(engine, "block:W");
    walkWhile(engine, () => anAction(state));
    expect(attachedNames(state, "V1")).not.toContain("Lesser Boon");
  });

  it("burns once the bearer's controller has less than 6 pool — and not at 6", () => {
    const state = threeSeatGame();
    minion(state, "V1").attached.push(entry("lb", "Lesser Boon", {
      controller: "Bob",
      statics: { burnWhenBearerControllerPoolBelow: 6 },
    }));
    seat(state, "Alice").pool = 6;
    const engine = at(state, "Alice", "minion");
    engine.decision();
    expect(attachedNames(state, "V1")).toContain("Lesser Boon");
    seat(state, "Alice").pool = 5;
    engine.decision();
    expect(attachedNames(state, "V1")).not.toContain("Lesser Boon");
  });
});

// ---------------------------------------------------------------------------
// Major Boon
// ---------------------------------------------------------------------------

describe("Major Boon — you burn pool for another Methuselah's bleed", () => {
  /** Alice's V1 bleeds Bob; Carol holds a Major Boon. */
  function bleedOfBob(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    seat(state, "Carol").hand.push({ id: "mb", name: "Major Boon" });
    const engine = at(state, "Alice", "minion");
    take(engine, "bleed:V1");
    return { state, engine };
  }

  it("Carol pays, the bleed is still Bob's and still successful", () => {
    const { state, engine } = bleedOfBob();
    expect(walkTo(engine, "play:Major Boon")).toBe(true);
    // "…after blocks are declined": state C.
    const af = state.frames.find((f) => f.kind === "action");
    expect(af?.kind === "action" && af.step).toBe("C");
    take(engine, "play:Major Boon");
    walkWhile(engine, () => anAction(state));
    expect(seat(state, "Carol").pool).toBe(9);
    expect(seat(state, "Bob").pool).toBe(10);
    // Still a successful bleed of 1: the Edge goes to the bleeder (p. 21).
    expect(state.edge).toBe("Alice");
    const boon = seat(state, "Carol").permanents.find((p) => p.card.name === "Major Boon");
    expect(boon?.boonTarget).toBe("Bob");
    // A boon in play carries the keyword Blood Trade burns (§6).
    expect(boon?.tags).toContain("boon");
  });

  it("NEGATIVE SPACE: not before blocks are declined, not to the target, not to the bleeder", () => {
    const { state, engine } = bleedOfBob();
    seat(state, "Bob").hand.push({ id: "mb2", name: "Major Boon" });
    seat(state, "Alice").hand.push({ id: "mb3", name: "Major Boon" });
    const seen: string[] = [];
    while (anAction(state)) {
      const dp = engine.decision()!;
      const af = state.frames.find((f) => f.kind === "action");
      for (const o of dp.options) {
        if (!o.id.startsWith("play:Major Boon")) continue;
        seen.push(`${dp.seat}@${af?.kind === "action" ? af.step : "?"}`);
      }
      idle(engine);
    }
    // Only Carol, and only in state C.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s === "Carol@C")).toBe(true);
  });

  it("NEGATIVE SPACE: not on a bleed of 0", () => {
    const state = threeSeatGame();
    minion(state, "V1").bleedAmount = 0;
    seat(state, "Carol").hand.push({ id: "mb", name: "Major Boon" });
    const engine = at(state, "Alice", "minion");
    take(engine, "bleed:V1");
    const seen = walkWhile(engine, () => anAction(state));
    expect(seen.some((id) => id.startsWith("play:Major Boon"))).toBe(false);
  });

  it("after it, only a card usable when the bleed WOULD BE SUCCESSFUL [LSJ 20090205]", () => {
    // Control: in state C Bob can redirect with Deflection.
    {
      const state = threeSeatGame();
      const engine = at(state, "Alice", "minion");
      take(engine, "bleed:V1");
      const seen = walkWhile(engine, () => anAction(state));
      expect(seen.some((id) => id.startsWith("play:Deflection"))).toBe(true);
    }
    // After Carol's boon he cannot — and Alice's Spying Mission still can be.
    const { state, engine } = bleedOfBob();
    minion(state, "V1").disciplines = { dom: "basic", obf: "superior" };
    seat(state, "Alice").hand.push({ id: "sm", name: "Spying Mission" });
    expect(walkTo(engine, "play:Major Boon")).toBe(true);
    take(engine, "play:Major Boon");
    const seen: string[] = [];
    expect(walkTo(engine, "play:Spying Mission:superior", seen)).toBe(true);
    expect(seen.some((id) => id.startsWith("play:Deflection"))).toBe(false);
    // "…or this card if you don't burn at least 1 pool": Spying Mission's
    // superior makes the bleed burn nothing, so the boon goes.
    take(engine, "play:Spying Mission:superior");
    walkWhile(engine, () => anAction(state));
    expect(seat(state, "Carol").pool).toBe(10);
    expect(seat(state, "Bob").pool).toBe(10);
    expect(seat(state, "Carol").permanents.some((p) => p.card.name === "Major Boon")).toBe(false);
  });

  it("burned when YOU are about to be bled: the Methuselah you saved pays", () => {
    // Bob's W bleeds Carol; Carol holds two boons on Alice.
    const state = threeSeatGame();
    seat(state, "Carol").permanents.push(
      entry("mb1", "Major Boon", { boonTarget: "Alice" }),
      entry("mb2", "Major Boon", { boonTarget: "Alice" }),
    );
    const engine = at(state, "Bob", "minion");
    take(engine, "bleed:W");
    const early: string[] = [];
    expect(walkTo(engine, "ability:Major Boon:mb1:burn", early)).toBe(true);
    const af = state.frames.find((f) => f.kind === "action");
    expect(af?.kind === "action" && af.step).toBe("C");
    take(engine, "ability:Major Boon:mb1:burn");
    // [LSJ 19990218]: the second cannot be burned on the same bleed.
    const later = walkWhile(engine, () => anAction(state));
    expect(later.some((id) => id.startsWith("ability:Major Boon"))).toBe(false);
    expect(seat(state, "Carol").pool).toBe(10);
    expect(seat(state, "Alice").pool).toBe(9);
    expect(state.edge).toBe("Bob");
    expect(seat(state, "Carol").permanents.map((p) => p.card.id)).toEqual(["mb2"]);
  });
});

// ---------------------------------------------------------------------------
// Minor Boon
// ---------------------------------------------------------------------------

describe("Minor Boon — keeping a vampire out of torpor", () => {
  /** Alice's V1 (1 blood) bleeds Bob; Bob's W (strength 2) blocks and the
   *  combat sends V1 to torpor. Carol holds the boon. */
  function torporCombat(holder = "Carol"): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    minion(state, "V1").blood = 1;
    minion(state, "W").strength = 2;
    seat(state, "Bob").hand = [];
    seat(state, holder).hand.push({ id: "mnb", name: "Minor Boon" });
    const engine = at(state, "Alice", "minion");
    take(engine, "bleed:V1");
    expect(walkTo(engine, "block:W")).toBe(true);
    take(engine, "block:W");
    return { state, engine };
  }

  it("the window opens AFTER the combat ends, and the boon keeps V1 in the ready region", () => {
    const { state, engine } = torporCombat();
    expect(walkTo(engine, "play:Minor Boon")).toBe(true);
    const dp = engine.decision()!;
    expect(dp.window).toBe("torpor");
    expect(dp.seat).toBe("Carol");
    // "Is played after the combat ends" [RTR 19950509-2].
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
    // Going, not gone: neither ready nor in torpor.
    expect(minion(state, "V1").inTorpor).toBe(false);
    expect(isReady(minion(state, "V1"))).toBe(false);
    take(engine, "play:Minor Boon");
    walkWhile(engine, () => anAction(state) || state.frames.some((f) => f.kind === "torpor"));
    expect(minion(state, "V1").inTorpor).toBe(false);
    expect(isReady(minion(state, "V1"))).toBe(true);
    const boon = minion(state, "V1").attached.find((p) => p.card.name === "Minor Boon");
    expect(boon?.controller).toBe("Carol");
    expect(state.eventLog.some((ev) => ev.type === "WentToTorpor")).toBe(false);
  });

  it("declined, the vampire arrives in torpor when the window closes", () => {
    const { state, engine } = torporCombat();
    expect(walkTo(engine, "play:Minor Boon")).toBe(true);
    walkWhile(engine, () => anAction(state) || state.frames.some((f) => f.kind === "torpor"));
    expect(minion(state, "V1").inTorpor).toBe(true);
    expect(minion(state, "V1").torporPending).toBeUndefined();
  });

  it("NEGATIVE SPACE: with no boon in any hand there is no window at all", () => {
    const state = threeSeatGame();
    minion(state, "V1").blood = 1;
    minion(state, "W").strength = 2;
    seat(state, "Bob").hand = [];
    const engine = at(state, "Alice", "minion");
    take(engine, "bleed:V1");
    expect(walkTo(engine, "block:W")).toBe(true);
    take(engine, "block:W");
    let windows = 0;
    while (anAction(state)) {
      if (engine.decision()?.window === "torpor") windows++;
      idle(engine);
    }
    expect(windows).toBe(0);
    expect(minion(state, "V1").inTorpor).toBe(true);
    expect(state.eventLog.some((ev) => ev.type === "TorporPending")).toBe(false);
  });

  it("NEGATIVE SPACE: not for a vampire you control", () => {
    // V1 going to torpor on Bob's turn; Alice, its controller, holds the boon.
    const own = threeSeatGame();
    own.seats[0]!.hand.push({ id: "mnb", name: "Minor Boon" });
    minion(own, "V1").torporPending = { other: null };
    const e1 = at(own, "Bob", "minion");
    expect(e1.decision()?.window).not.toBe("torpor");
    expect(minion(own, "V1").inTorpor).toBe(true);
    // Control: Carol holding it is asked.
    const other = threeSeatGame();
    seat(other, "Carol").hand.push({ id: "mnb", name: "Minor Boon" });
    minion(other, "V1").torporPending = { other: null };
    const e2 = at(other, "Bob", "minion");
    expect(e2.decision()?.window).toBe("torpor");
    expect(ids(e2).some((id) => id.startsWith("play:Minor Boon:-:V1"))).toBe(true);
  });

  it("\"this vampire cannot bleed you\" — the boon's controller", () => {
    const bleeds = (controller: string): string[] => {
      const state = threeSeatGame();
      minion(state, "V1").attached.push(entry("mnb", "Minor Boon", {
        controller,
        statics: { cannotBleedController: true },
      }));
      return ids(at(state, "Alice", "minion"));
    };
    // Bob is Alice's prey, so a boon Bob holds stops the bleed.
    expect(bleeds("Bob")).not.toContain("bleed:V1");
    expect(bleeds("Carol")).toContain("bleed:V1");
  });

  it("\"…cannot be redirected to you either\" [PIB 20130711]", () => {
    const deflections = (controller: string): string[] => {
      const state = threeSeatGame();
      minion(state, "V1").attached.push(entry("mnb", "Minor Boon", {
        controller,
        statics: { cannotBleedController: true },
      }));
      const engine = at(state, "Alice", "minion");
      take(engine, "bleed:V1");
      return walkWhile(engine, () => anAction(state)).filter((id) => id.startsWith("play:Deflection"));
    };
    // Bob's only other destination is Carol.
    expect(deflections("Carol")).toEqual([]);
    expect(deflections("Alice").length).toBeGreaterThan(0);
  });

  it("burns when its vampire rescues one of the boon controller's vampires", () => {
    const rescue = (controller: string): string[] => {
      const state = threeSeatGame();
      minion(state, "N").inTorpor = true;
      minion(state, "V1").attached.push(entry("mnb", "Minor Boon", {
        controller,
        statics: { burnOnRescueOfController: true },
      }));
      const engine = at(state, "Alice", "minion");
      take(engine, "rescue:V1:N:2");
      walkWhile(engine, () => anAction(state));
      expect(minion(state, "N").inTorpor).toBe(false);
      return attachedNames(state, "V1");
    };
    expect(rescue("Carol")).not.toContain("Minor Boon");
    // Rescuing someone else's vampire is not the clause.
    expect(rescue("Bob")).toContain("Minor Boon");
  });
});

// ---------------------------------------------------------------------------
// Extremis Boon
// ---------------------------------------------------------------------------

describe("Extremis Boon — the table bids to keep you in", () => {
  /** Carol has no pool on Alice's turn and holds the boon. */
  function carolGoingOut(pool = 0): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    seat(state, "Carol").pool = pool;
    seat(state, "Carol").hand.push({ id: "xb", name: "Extremis Boon" });
    const engine = at(state, "Alice", "minion");
    expect(engine.decision()?.window).toBe("oust");
    return { state, engine };
  }

  it("the high bidder pays the victim, the losers pay nothing, and the card stays", () => {
    const { state, engine } = carolGoingOut();
    runTrace(engine, [["Carol", "play:Extremis Boon"]]);
    while (engine.decision()?.window === "card.asPlayed") idle(engine);
    // Bidding runs in turn order from Carol's prey, Alice.
    runTrace(engine, [
      ["Alice", "choice:Extremis Boon:xb:bid:1"],
      ["Bob", "choice:Extremis Boon:xb:bid:3"],
    ]);
    // Alice must top 3.
    expect(ids(engine)).not.toContain("choice:Extremis Boon:xb:bid:3");
    expect(ids(engine)).toContain("choice:Extremis Boon:xb:bid:4");
    runTrace(engine, [["Alice", "choice:Extremis Boon:xb:bid:pass"]]);
    engine.decision();
    expect(seat(state, "Carol").ousted).toBe(false);
    expect(seat(state, "Carol").pool).toBe(3);
    expect(seat(state, "Bob").pool).toBe(7);
    expect(seat(state, "Alice").pool).toBe(10);
    const boon = seat(state, "Carol").permanents.find((p) => p.card.name === "Extremis Boon");
    expect(boon?.boonCreditor).toBe("Bob");
  });

  it("the opening bid must keep the victim in [ANK 20190827]", () => {
    const { engine } = carolGoingOut(-2);
    runTrace(engine, [["Carol", "play:Extremis Boon"]]);
    while (engine.decision()?.window === "card.asPlayed") idle(engine);
    const bids = ids(engine).filter((id) => /:bid:\d+$/.test(id));
    expect(bids[0]).toBe("choice:Extremis Boon:xb:bid:3");
  });

  it("nobody bids: the card goes and so does Carol", () => {
    const { state, engine } = carolGoingOut();
    runTrace(engine, [["Carol", "play:Extremis Boon"]]);
    while (engine.decision()?.window === "card.asPlayed") idle(engine);
    runTrace(engine, [
      ["Alice", "choice:Extremis Boon:xb:bid:pass"],
      ["Bob", "choice:Extremis Boon:xb:bid:pass"],
    ]);
    // The oust window is still open, and Carol is out of answers.
    while (engine.decision()?.window === "oust") idle(engine);
    expect(seat(state, "Carol").ousted).toBe(true);
    expect(seat(state, "Carol").permanents).toEqual([]);
    expect(seat(state, "Bob").pool).toBe(16); // her predator: 6 pool (p. 37)
  });

  it("NEGATIVE SPACE: not on your own turn, and not when nobody can bid", () => {
    const own = threeSeatGame();
    seat(own, "Carol").pool = 0;
    seat(own, "Carol").hand.push({ id: "xb", name: "Extremis Boon" });
    const e1 = at(own, "Carol", "minion");
    e1.decision();
    expect(seat(own, "Carol").ousted).toBe(true);
    const broke = threeSeatGame();
    seat(broke, "Carol").pool = 0;
    seat(broke, "Alice").pool = 1;
    seat(broke, "Bob").pool = 1;
    seat(broke, "Carol").hand.push({ id: "xb", name: "Extremis Boon" });
    at(broke, "Alice", "minion").decision();
    expect(seat(broke, "Carol").ousted).toBe(true);
  });

  it("the high bidder steals up to 2 as a master phase action — and only he", () => {
    const state = threeSeatGame();
    seat(state, "Carol").permanents.push(entry("xb", "Extremis Boon", { boonCreditor: "Bob" }));
    const engine = at(state, "Bob", "master");
    expect(ids(engine)).toContain("ability:Extremis Boon:xb:steal:1");
    runTrace(engine, [["Bob", "ability:Extremis Boon:xb:steal:2"]]);
    expect(seat(state, "Carol").pool).toBe(8);
    expect(seat(state, "Bob").pool).toBe(12);
    // The master phase action is spent, and with it the offer.
    expect(turn(state).masterActionsLeft).toBe(0);
    expect(ids(engine).some((id) => id.startsWith("ability:Extremis Boon"))).toBe(false);
    // Alice is nobody's high bidder.
    const other = threeSeatGame();
    seat(other, "Carol").permanents.push(entry("xb", "Extremis Boon", { boonCreditor: "Bob" }));
    expect(ids(at(other, "Alice", "master")).some((id) => id.startsWith("ability:Extremis Boon"))).toBe(false);
  });

  it("Carol buys it out with 6 pool in her own master phase — never her last pool", () => {
    const state = threeSeatGame();
    seat(state, "Carol").permanents.push(entry("xb", "Extremis Boon", { boonCreditor: "Bob" }));
    seat(state, "Carol").pool = 7;
    const engine = at(state, "Carol", "master");
    runTrace(engine, [["Carol", "ability:Extremis Boon:xb:payoff"]]);
    expect(seat(state, "Carol").pool).toBe(1);
    expect(seat(state, "Bob").pool).toBe(16);
    expect(seat(state, "Carol").permanents).toEqual([]);
    const poor = threeSeatGame();
    seat(poor, "Carol").permanents.push(entry("xb", "Extremis Boon", { boonCreditor: "Bob" }));
    seat(poor, "Carol").pool = 6;
    expect(ids(at(poor, "Carol", "master"))).not.toContain("ability:Extremis Boon:xb:payoff");
  });
});

// ---------------------------------------------------------------------------
// The defect: Blood Trade could not see Life Boon
// ---------------------------------------------------------------------------

describe("every boon in play carries the keyword (§6)", () => {
  it("Life Boon, played, is a boon Blood Trade can burn", () => {
    const state = threeSeatGame();
    seat(state, "Bob").pool = 0;
    seat(state, "Carol").hand.push({ id: "lb", name: "Life Boon" });
    const engine = at(state, "Alice", "minion");
    runTrace(engine, [["Carol", "play:Life Boon"]]);
    while (engine.decision()?.window !== "turn.minion") idle(engine);
    const boon = seat(state, "Carol").permanents.find((p) => p.card.name === "Life Boon");
    expect(boon?.tags).toContain("boon");
  });
});
