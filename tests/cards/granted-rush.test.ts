/**
 * Granted rush actions (docs/granted-rush-design.md) — cards in play that
 * let a minion enter combat with another: Haven Uncovered (100897),
 * Regent (101587), Saulot's Avenging Fist (102257), Frontal Assault
 * (100794) and Priority Contract (101487). The rush itself is the kernel's
 * (docs/rush-actions-design.md); what is new is *who* may take it, *what*
 * they may target, and the three hooks the surrounding clauses ride.
 */

import { describe, expect, it } from "vitest";
import type { ActionFrame, GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, currentStealth } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Alice's master phase with one master action and `cards` in her hand. */
function mastersPhase(...cards: Array<{ id: string; name: string }>): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = "master";
    tf.masterActionsLeft = 1;
  }
  state.seats[0]!.hand.push(...cards);
  return state;
}

/** The named seat's minion phase, with nothing else pending. */
function minionPhase(seat: string): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") tf.seat = seat;
  return state;
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Put a card in play attached to a minion, as its play would. */
function attach(
  state: GameState,
  minionId: string,
  cardId: string,
  name: string,
  controller: string,
  extra: Record<string, unknown> = {},
): void {
  find(state, minionId).attached.push({
    card: { id: cardId, name },
    controller,
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: [name],
    ...extra,
  });
}

function seatCard(
  state: GameState,
  seatIndex: number,
  cardId: string,
  name: string,
): void {
  state.seats[seatIndex]!.permanents.push({
    card: { id: cardId, name },
    controller: state.seats[seatIndex]!.id,
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: [name],
  });
}

const actionFrame = (state: GameState): ActionFrame => {
  const af = [...state.frames].reverse().find((f) => f.kind === "action");
  if (!af || af.kind !== "action") throw new Error("no action frame");
  return af;
};

// ---------------------------------------------------------------------------
// Haven Uncovered — anyone's minion rushes the bearer; the bearer escapes
// ---------------------------------------------------------------------------

describe("Haven Uncovered (100897)", () => {
  it("goes on any Methuselah's ready vampire and stays controlled by its player", () => {
    const state = mastersPhase({ id: "hu", name: "Haven Uncovered" });
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    // "A ready vampire" — every seat's, including Alice's own.
    for (const target of ["V1", "W", "M", "N"]) {
      expect(dp.options.some((o) => o.id === `play:Haven Uncovered:-:${target}:hu`)).toBe(
        true,
      );
    }

    runTrace(engine, [
      ["Alice", "play:Haven Uncovered:-:W:hu"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);

    const hu = find(state, "W").attached.find((p) => p.card.id === "hu")!;
    expect(hu.controller).toBe("Alice"); // p. 16
  });

  it("lets another Methuselah's minion rush the bearer at +1 stealth", () => {
    const state = minionPhase("Carol");
    attach(state, "W", "hu", "Haven Uncovered", "Alice");
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Carol");
    expect(dp.options.some((o) => o.id === "act:Haven Uncovered:hu:rush:N:W")).toBe(true);

    engine.choose("act:Haven Uncovered:hu:rush:N:W");
    const af = actionFrame(state);
    expect(af.actingSeat).toBe("Carol");
    expect(currentStealth(state, af.actionId)).toBe(1);
    // Directed at W's controller (p. 25) — Bob alone may block, not the
    // Methuselah who played the card.
    expect(af.target).toBe("Bob");
  });

  it("only the bearer may burn it, and only the bearer", () => {
    const state = minionPhase("Bob");
    attach(state, "W", "hu", "Haven Uncovered", "Alice");
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "act:Haven Uncovered:hu:burn:W")).toBe(true);
    // Bob's other vampire is not the haven's occupant.
    expect(dp.options.some((o) => o.id === "act:Haven Uncovered:hu:burn:M")).toBe(false);
    // Nor may W rush itself.
    expect(dp.options.some((o) => o.id.includes(":rush:W:W"))).toBe(false);

    runTrace(engine, [
      ["Bob", "act:Haven Uncovered:hu:burn:W"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // announce
      // Effects: Alice's block window comes round in her impulse, and she
      // declines it — the card is hers, so she is the only one who could.
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"],
    ]);
    expect(find(state, "W").attached).toHaveLength(0);
  });

  it("spends the copy per minion per turn (p. 20)", () => {
    const state = minionPhase("Carol");
    state.seats[2]!.minions.push(makeMinion("N2", "Carol"));
    attach(state, "W", "hu", "Haven Uncovered", "Alice");
    const engine = new VtesEngine(state, testRegistry);

    // The use is recorded at announcement (p. 20 is a limit on taking the
    // action, not on it succeeding).
    engine.choose("act:Haven Uncovered:hu:rush:N:W");
    const hu = find(state, "W").attached.find((p) => p.card.id === "hu")!;
    expect(hu.grantedActionUses).toEqual([{ minion: "N", key: "enterCombat" }]);
  });

  it("still offers the rush to another minion once one has spent it", () => {
    const state = minionPhase("Carol");
    state.seats[2]!.minions.push(makeMinion("N2", "Carol"));
    attach(state, "W", "hu", "Haven Uncovered", "Alice", {
      grantedActionUses: [{ minion: "N", key: "enterCombat" }],
    });
    const dp = new VtesEngine(state, testRegistry).decision()!;

    expect(dp.options.some((o) => o.id === "act:Haven Uncovered:hu:rush:N:W")).toBe(false);
    expect(dp.options.some((o) => o.id === "act:Haven Uncovered:hu:rush:N2:W")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regent — a title carried by a card, and a rush granted by sect
// ---------------------------------------------------------------------------

describe("Regent (101587)", () => {
  function sabbatGame(): GameState {
    const state = mastersPhase({ id: "rg", name: "Regent" });
    Object.assign(find(state, "V1"), { sect: "sabbat", capacity: 9 });
    Object.assign(find(state, "W"), { sect: "sabbat", capacity: 10 });
    return state;
  }

  it("only goes on your own Sabbat vampire of capacity 8 or more", () => {
    const state = sabbatGame();
    // Alice's second vampire is Sabbat but too small.
    state.seats[0]!.minions.push(
      makeMinion("V2", "Alice", { sect: "sabbat", capacity: 7 }),
    );
    const dp = new VtesEngine(state, testRegistry).decision()!;

    expect(dp.options.some((o) => o.id === "play:Regent:-:V1:rg")).toBe(true);
    expect(dp.options.some((o) => o.id === "play:Regent:-:V2:rg")).toBe(false);
    expect(dp.options.some((o) => o.id === "play:Regent:-:W:rg")).toBe(false); // Bob's
  });

  it("grants the title, and loses it when the card burns", () => {
    const state = sabbatGame();
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Regent:-:V1:rg"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(find(state, "V1").title).toBe("regent"); // 4 votes, p. 28

    engine.burnPermanent("rg");
    expect(find(state, "V1").title).toBeNull();
  });

  it("lets any Sabbat vampire rush the bearer, and no one else", () => {
    const state = minionPhase("Bob");
    Object.assign(find(state, "V1"), { sect: "sabbat", capacity: 9 });
    Object.assign(find(state, "W"), { sect: "sabbat" }); // Bob's Sabbat vampire
    find(state, "M").sect = "camarilla";
    attach(state, "V1", "rg", "Regent", "Alice", { tags: ["Regent", "title"] });
    const dp = new VtesEngine(state, testRegistry).decision()!;

    expect(dp.options.some((o) => o.id === "act:Regent:rg:rush:W:V1")).toBe(true);
    expect(dp.options.some((o) => o.id === "act:Regent:rg:rush:M:V1")).toBe(false);
  });

  it("moves to a Sabbat diablerist with its title, before the blood hunt", () => {
    const state = minionPhase("Bob");
    Object.assign(find(state, "V1"), { sect: "sabbat", capacity: 9, inTorpor: true });
    Object.assign(find(state, "W"), { sect: "sabbat" });
    find(state, "V1").title = "regent";
    attach(state, "V1", "rg", "Regent", "Alice", { tags: ["Regent", "title"] });
    const engine = new VtesEngine(state, testRegistry);

    engine.commitDiablerie("W", "V1");

    const moved = find(state, "W").attached.find((p) => p.card.id === "rg")!;
    expect(moved.controller).toBe("Bob"); // it answers to the diablerist now
    expect(find(state, "W").title).toBe("regent");
    // The blood hunt referendum is on the stack, called after the move.
    expect(state.frames.some((f) => f.kind === "referendum")).toBe(true);
  });

  it("burns with the victim when the diablerist is not Sabbat", () => {
    const state = minionPhase("Bob");
    Object.assign(find(state, "V1"), { sect: "sabbat", capacity: 9, inTorpor: true });
    find(state, "W").sect = "camarilla";
    attach(state, "V1", "rg", "Regent", "Alice", { tags: ["Regent", "title"] });
    const engine = new VtesEngine(state, testRegistry);

    engine.commitDiablerie("W", "V1");

    expect(find(state, "W").attached).toHaveLength(0);
    expect(find(state, "W").title).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Saulot's Avenging Fist — a bearer rush filtered by the target's clan
// ---------------------------------------------------------------------------

describe("Saulot's Avenging Fist (102257)", () => {
  it("goes on your own Salubri, and only one archetype per vampire", () => {
    const state = mastersPhase({ id: "saf", name: "Saulot's Avenging Fist" });
    find(state, "V1").clan = "Salubri";
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { clan: "Salubri" }));
    // V2 already carries an archetype.
    attach(state, "V2", "arch", "Saulot's Guiding Wisdom", "Alice", {
      tags: ["archetype"],
    });
    const dp = new VtesEngine(state, testRegistry).decision()!;

    expect(dp.options.some((o) => o.id === "play:Saulot's Avenging Fist:-:V1:saf")).toBe(
      true,
    );
    expect(dp.options.some((o) => o.id === "play:Saulot's Avenging Fist:-:V2:saf")).toBe(
      false,
    );
  });

  it("rushes any non-Salubri vampire, at +1 stealth against a Tremere", () => {
    const state = minionPhase("Alice");
    find(state, "V1").clan = "Salubri";
    find(state, "W").clan = "Tremere";
    find(state, "M").clan = "Salubri"; // a fellow Salubri is off limits
    find(state, "N").clan = "Nosferatu";
    attach(state, "V1", "saf", "Saulot's Avenging Fist", "Alice", {
      statics: { strength: 1 },
    });
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    const rushes = dp.options.filter((o) => o.id.includes("Saulot's Avenging Fist"));
    expect(rushes.map((o) => o.id).sort()).toEqual([
      "act:Saulot's Avenging Fist:saf:rush:V1:N",
      "act:Saulot's Avenging Fist:saf:rush:V1:W",
    ]);

    engine.choose("act:Saulot's Avenging Fist:saf:rush:V1:W");
    expect(currentStealth(state, actionFrame(state).actionId)).toBe(1); // the Tremere rider
  });

  it("is a plain action against a non-Tremere target", () => {
    const state = minionPhase("Alice");
    find(state, "V1").clan = "Salubri";
    find(state, "N").clan = "Nosferatu";
    attach(state, "V1", "saf", "Saulot's Avenging Fist", "Alice");
    const engine = new VtesEngine(state, testRegistry);

    engine.choose("act:Saulot's Avenging Fist:saf:rush:V1:N");
    expect(currentStealth(state, actionFrame(state).actionId)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Frontal Assault — a seat-level grant plus the two new phase/leave hooks
// ---------------------------------------------------------------------------

describe("Frontal Assault (100794)", () => {
  it("grants each of your ready minions a rush at your prey's minions only", () => {
    const state = minionPhase("Alice");
    state.seats[0]!.minions.push(makeMinion("V2", "Alice"));
    seatCard(state, 0, "fa", "Frontal Assault");
    const dp = new VtesEngine(state, testRegistry).decision()!;

    const rushes = dp.options.filter((o) => o.id.includes("Frontal Assault")).map((o) => o.id);
    // Bob is Alice's prey; Carol's N is not a legal target.
    expect(rushes.sort()).toEqual([
      "act:Frontal Assault:fa:rush:V1:M",
      "act:Frontal Assault:fa:rush:V1:W",
      "act:Frontal Assault:fa:rush:V2:M",
      "act:Frontal Assault:fa:rush:V2:W",
    ]);
  });

  it("offers nothing to the Methuselah who does not control it", () => {
    const state = minionPhase("Carol");
    seatCard(state, 0, "fa", "Frontal Assault");
    const dp = new VtesEngine(state, testRegistry).decision()!;
    expect(dp.options.some((o) => o.id.includes("Frontal Assault"))).toBe(false);
  });

  it("gains 1 pool when a prey minion leaves the ready region", () => {
    const state = minionPhase("Alice");
    seatCard(state, 0, "fa", "Frontal Assault");
    const engine = new VtesEngine(state, testRegistry);

    engine.burnMinion("W"); // Bob's, and Bob is Alice's prey
    expect(state.seats[0]!.pool).toBe(11);

    engine.burnMinion("N"); // Carol's — not the prey, no pool
    expect(state.seats[0]!.pool).toBe(11);
  });

  it("burns itself and 1 pool per ready prey minion in its controller's influence phase", () => {
    const state = minionPhase("Alice");
    seatCard(state, 0, "fa", "Frontal Assault");
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "end"]]); // end the minion phase

    expect(state.seats[0]!.permanents).toHaveLength(0);
    expect(state.seats[0]!.pool).toBe(8); // Bob has two ready minions
  });
});

// ---------------------------------------------------------------------------
// Priority Contract — two picks at play time, and the "about to leave" cash-out
// ---------------------------------------------------------------------------

describe("Priority Contract (101487)", () => {
  function contractGame(): GameState {
    const state = mastersPhase({ id: "pc", name: "Priority Contract" });
    find(state, "V1").clan = "Banu Haqim";
    return state;
  }

  it("enumerates (chosen Assamite × prey minion) pairs and records the choice", () => {
    const state = contractGame();
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { clan: "Banu Haqim" }));
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    const plays = dp.options.filter((o) => o.id.includes("Priority Contract")).map((o) => o.id);
    expect(plays.sort()).toEqual([
      "play:Priority Contract:-:-:V1:M:pc",
      "play:Priority Contract:-:-:V1:W:pc",
      "play:Priority Contract:-:-:V2:M:pc",
      "play:Priority Contract:-:-:V2:W:pc",
    ]);

    runTrace(engine, [
      ["Alice", "play:Priority Contract:-:-:V1:W:pc"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const pc = find(state, "W").attached.find((p) => p.card.id === "pc")!;
    expect(pc.controller).toBe("Alice"); // on a prey minion, but Alice's card
    expect(pc.chosen).toBe("V1");
  });

  it("lets only the chosen Assamite rush the attached minion, at +1 stealth", () => {
    const state = minionPhase("Alice");
    find(state, "V1").clan = "Banu Haqim";
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { clan: "Banu Haqim" }));
    attach(state, "W", "pc", "Priority Contract", "Alice", { chosen: "V1" });
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "act:Priority Contract:pc:rush:V1:W")).toBe(true);
    expect(dp.options.some((o) => o.id === "act:Priority Contract:pc:rush:V2:W")).toBe(false);

    engine.choose("act:Priority Contract:pc:rush:V1:W");
    expect(currentStealth(state, actionFrame(state).actionId)).toBe(1);
  });

  it("offers its controller 3 pool as the attached minion is about to leave", () => {
    const state = minionPhase("Alice");
    find(state, "V1").clan = "Banu Haqim";
    attach(state, "W", "pc", "Priority Contract", "Alice", { chosen: "V1" });
    const engine = new VtesEngine(state, testRegistry);

    engine.burnMinion("W");

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice"); // the card's controller, not W's
    expect(dp.options.some((o) => o.id.includes("cashOut"))).toBe(true);
    engine.choose(dp.options.find((o) => o.id.includes("cashOut"))!.id);
    expect(state.seats[0]!.pool).toBe(13);
  });

  it("does not fire for some other minion leaving the ready region", () => {
    const state = minionPhase("Alice");
    find(state, "V1").clan = "Banu Haqim";
    attach(state, "W", "pc", "Priority Contract", "Alice", { chosen: "V1" });
    const engine = new VtesEngine(state, testRegistry);

    engine.burnMinion("M");
    expect(engine.decision()!.window).not.toBe("choice");
    expect(state.seats[0]!.pool).toBe(10);
  });
});
