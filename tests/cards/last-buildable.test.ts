/**
 * The last buildable four (docs/last-buildable-design.md).
 *
 * Fiendish Tongue (100726), Revelations (101627), Deep Song (100515),
 * Revolutionary Council (101631).
 *
 * After these, every buildable library card is supported and what remains
 * is exactly the blocked set.
 */

import { describe, expect, it } from "vitest";
import type {
  CombatFrame,
  GameState,
  MinionState,
  PermanentInPlay,
} from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { currentIntercept, openHandsFor } from "../../src/engine/derived.ts";
import { redactFor, viewFor } from "../../src/engine/agent.ts";
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

function action(state: GameState) {
  const f = state.frames.find((x) => x.kind === "action");
  return f?.kind === "action" ? f : undefined;
}

function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: [name],
    ...over,
  };
}

/** Walk the impulse cycle until some seat is offered `prefix`. */
function walkTo(engine: VtesEngine, prefix: string, limit = 80): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    engine.choose(pick.id);
  }
  return false;
}

/** Pass everything until the turn returns to the minion phase (or the
 *  engine runs out of decisions). */
function settleToMinionPhase(engine: VtesEngine, limit = 60): void {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return;
    if (dp.window === "turn.minion") return;
    engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
  }
}

// ---------------------------------------------------------------------------
// §1 — Fiendish Tongue
// ---------------------------------------------------------------------------

describe("Fiendish Tongue (100726)", () => {
  function game(clan: string | null): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "sabbat", clan, blood: 4 });
    seatOf(state, "Alice").hand = [{ id: "ft", name: "Fiendish Tongue" }];
    return state;
  }

  it("requires a Sabbat vampire", () => {
    const state = game("Tzimisce");
    find(state, "V1").sect = "camarilla";
    const engine = new VtesEngine(state, testRegistry);
    expect(optionIds(engine).filter((o) => o.startsWith("play:Fiendish Tongue"))).toEqual([]);

    const ok = new VtesEngine(game("Tzimisce"), testRegistry);
    expect(optionIds(ok).filter((o) => o.startsWith("play:Fiendish Tongue")).length).toBe(1);
  });

  it("bleeds for +1 and gives ANARCHS −1 intercept, registered at announcement", () => {
    const state = game("Tzimisce");
    find(state, "W").sect = "anarch";
    find(state, "M").sect = "camarilla";
    // Both blockers carry +1 intercept, so only the sect tells them apart.
    for (const id of ["W", "M"]) {
      find(state, id).attached.push(
        entry(`i-${id}`, "watchfulness", { statics: { intercept: 1 } }),
      );
    }
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Fiendish Tongue"]]);
    // Walk out of the as-played cycle so the action frame exists.
    expect(walkTo(engine, "block:W")).toBe(true);
    const af = action(engine.state)!;
    expect(currentIntercept(engine.state, af.actionId, "W")).toBe(0); // Anarch
    expect(currentIntercept(engine.state, af.actionId, "M")).toBe(1); // Camarilla
  });

  it("the −1 applies even when the action is BLOCKED — that is the point", () => {
    // Registering the clause at resolution would mean it never applied in
    // the case it is written for (the bleed-riders-sweep bug).
    const state = game("Tzimisce");
    find(state, "W").sect = "anarch";
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Fiendish Tongue"]]);
    expect(walkTo(engine, "block:W")).toBe(true);
    const af = action(engine.state)!;
    expect(
      engine.state.eventLog.some(
        (ev) => ev.type === "ActionInterceptModified" && ev.actionId === af.actionId,
      ),
    ).toBe(true);
  });

  it("a Tzimisce gets a discard-phase unlock after a successful bleed", () => {
    const engine = new VtesEngine(game("Tzimisce"), testRegistry);
    runTrace(engine, [["Alice", "play:Fiendish Tongue"]]);
    settleToMinionPhase(engine);
    expect(find(engine.state, "V1").discardPhaseUnlock).toBe(true);
    expect(find(engine.state, "V1").locked).toBe(true);

    // End the minion phase and walk into the discard phase.
    expect(walkTo(engine, "unlock:discard:V1")).toBe(true);
    const before = find(engine.state, "V1").blood;
    runTrace(engine, [["Alice", "unlock:discard:V1"]]);
    expect(find(engine.state, "V1").locked).toBe(false);
    expect(find(engine.state, "V1").blood).toBe(before - 1);
    // One chance only.
    expect(find(engine.state, "V1").discardPhaseUnlock).toBe(false);
  });

  it("does NOT consume the discard phase action (p. 37 — the card does not say so)", () => {
    const engine = new VtesEngine(game("Tzimisce"), testRegistry);
    seatOf(engine.state, "Alice").hand.push({ id: "spare", name: "Conditioning" });
    runTrace(engine, [["Alice", "play:Fiendish Tongue"]]);
    settleToMinionPhase(engine);
    expect(walkTo(engine, "unlock:discard:V1")).toBe(true);
    runTrace(engine, [["Alice", "unlock:discard:V1"]]);
    // The discard is still on the table afterwards.
    expect(optionIds(engine).some((o) => o.startsWith("discard:"))).toBe(true);
  });

  it("gives a NON-Tzimisce nothing — the same bleed, one field changed", () => {
    const engine = new VtesEngine(game("Lasombra"), testRegistry);
    runTrace(engine, [["Alice", "play:Fiendish Tongue"]]);
    settleToMinionPhase(engine);
    expect(find(engine.state, "V1").discardPhaseUnlock).toBeFalsy();
    expect(walkTo(engine, "unlock:discard:V1", 12)).toBe(false);
  });

  it("gives a Tzimisce nothing when the bleed is BLOCKED", () => {
    const state = game("Tzimisce");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Fiendish Tongue"]]);
    expect(walkTo(engine, "block:W")).toBe(true);
    runTrace(engine, [["Bob", "block:W"]]);
    settleToMinionPhase(engine);
    expect(find(engine.state, "V1").discardPhaseUnlock).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// §2 — Revelations
// ---------------------------------------------------------------------------

describe("Revelations (101627)", () => {
  function game(mode: "basic" | "superior"): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), {
      disciplines: { aus: mode === "superior" ? "superior" : "basic" },
      blood: 4,
    });
    seatOf(state, "Alice").hand = [{ id: "rv", name: "Revelations" }];
    seatOf(state, "Bob").hand = [
      { id: "b1", name: "Conditioning" },
      { id: "b2", name: "Deflection" },
    ];
    return state;
  }

  it("basic: the actor is asked which of the PREY's cards to discard", () => {
    const engine = new VtesEngine(game("basic"), testRegistry);
    runTrace(engine, [["Alice", "play:Revelations:basic"]]);
    expect(walkTo(engine, "choice:Revelations")).toBe(true);
    const dp = engine.decision()!;
    // The question belongs to the ACTOR, and names the prey's cards.
    expect(dp.seat).toBe("Alice");
    expect(dp.options.map((o) => o.id).sort()).toEqual([
      "choice:Revelations:rv:peekDiscard:b1",
      "choice:Revelations:rv:peekDiscard:b2",
    ]);
    runTrace(engine, [["Alice", "choice:Revelations:rv:peekDiscard:b2"]]);
    expect(seatOf(engine.state, "Bob").hand.map((c) => c.id)).toEqual(["b1"]);
  });

  it("basic: the LOG records what was discarded, never what was seen", () => {
    const engine = new VtesEngine(game("basic"), testRegistry);
    runTrace(engine, [["Alice", "play:Revelations:basic"]]);
    expect(walkTo(engine, "choice:Revelations")).toBe(true);
    runTrace(engine, [["Alice", "choice:Revelations:rv:peekDiscard:b1"]]);
    const named = engine.state.eventLog
      .filter((ev) => "name" in ev && typeof ev.name === "string")
      .map((ev) => (ev as { name: string }).name);
    expect(named).toContain("Conditioning"); // the discard
    expect(named).not.toContain("Deflection"); // the card merely SEEN
  });

  it("basic: leaves NO card in play — that is the superior's clause", () => {
    // A live bug, found while building the memory model. `[aus]` is "look
    // at your prey's hand and discard one"; only `[AUS]` says "put this
    // card in play". The handler is registered when ANY mode puts the card
    // in play and was returning a default entry for the mode that does
    // not — so the basic mode was also opening the prey's hand for the
    // rest of the game, and leaving a card the table had to burn.
    const engine = new VtesEngine(game("basic"), testRegistry);
    runTrace(engine, [["Alice", "play:Revelations:basic"]]);
    expect(walkTo(engine, "choice:Revelations")).toBe(true);
    runTrace(engine, [["Alice", "choice:Revelations:rv:peekDiscard:b1"]]);
    settleToMinionPhase(engine);

    expect(seatOf(engine.state, "Alice").permanents).toEqual([]);
    expect(openHandsFor(engine.state, "Alice")).toEqual([]);
    // ...and the card went to the ash heap like any other action card.
    expect((seatOf(engine.state, "Alice").ashHeap ?? []).some((c) => c.id === "rv")).toBe(
      true,
    );
  });

  it("basic: the actor REMEMBERS the cards they did not take", () => {
    // The gap this closes (docs/knowledge-design.md). A hotseat human
    // simply remembers what they saw; an AI seat had nothing in
    // `PlayerView` to remember it with, and the masking is a pure
    // function of the zone, which has not changed.
    const engine = new VtesEngine(game("basic"), testRegistry);
    runTrace(engine, [["Alice", "play:Revelations:basic"]]);
    expect(walkTo(engine, "choice:Revelations")).toBe(true);
    runTrace(engine, [["Alice", "choice:Revelations:rv:peekDiscard:b1"]]);
    settleToMinionPhase(engine);

    // b1 was discarded; b2 is still in Bob's hand and Alice still knows it.
    const alice = viewFor(engine.state, "Alice");
    const bob = alice.seats.find((s) => s.id === "Bob")!;
    expect(Array.isArray(bob.hand)).toBe(false);
    const hand = bob.hand as { count: number; known: { id: string; name: string }[] };
    expect(hand.count).toBe(1);
    expect(hand.known.map((c) => c.name)).toEqual(["Deflection"]);
  });

  it("basic: nobody ELSE learns anything from the look", () => {
    // The knowledge is per seat. Carol was not shown the hand and must
    // still see a bare count — the assertion that keeps this from being a
    // leak rather than a memory.
    const engine = new VtesEngine(game("basic"), testRegistry);
    runTrace(engine, [["Alice", "play:Revelations:basic"]]);
    expect(walkTo(engine, "choice:Revelations")).toBe(true);
    runTrace(engine, [["Alice", "choice:Revelations:rv:peekDiscard:b1"]]);
    settleToMinionPhase(engine);

    const carol = viewFor(engine.state, "Carol");
    const bob = carol.seats.find((s) => s.id === "Bob")!;
    expect((bob.hand as { known: unknown[] }).known).toEqual([]);
    expect(JSON.stringify(carol)).not.toContain("Deflection");
  });

  it("basic: a card drawn AFTER the look is not known", () => {
    // `known` is a subset of the hand, never the whole of it: the owner
    // may have drawn since. Getting this wrong would turn a memory into
    // an open hand.
    const state = game("basic");
    seatOf(state, "Bob").library = [{ id: "b3", name: "Blood Doll" }];
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Revelations:basic"]]);
    expect(walkTo(engine, "choice:Revelations")).toBe(true);
    runTrace(engine, [["Alice", "choice:Revelations:rv:peekDiscard:b1"]]);
    settleToMinionPhase(engine);

    const hand = seatOf(engine.state, "Bob").hand;
    expect(hand.some((c) => c.id === "b3"), "Bob never drew — fixture wrong").toBe(true);
    const alice = viewFor(engine.state, "Alice");
    const bob = alice.seats.find((s) => s.id === "Bob")!;
    const known = (bob.hand as { known: { name: string }[] }).known.map((c) => c.name);
    expect(known).toContain("Deflection");
    expect(known).not.toContain("Blood Doll");
  });

  it("basic: the memory survives a replay of the command log", () => {
    // Event-sourced like everything else: a loaded save remembers exactly
    // what the original game's player remembered.
    const engine = new VtesEngine(game("basic"), testRegistry);
    runTrace(engine, [["Alice", "play:Revelations:basic"]]);
    expect(walkTo(engine, "choice:Revelations")).toBe(true);
    runTrace(engine, [["Alice", "choice:Revelations:rv:peekDiscard:b1"]]);
    settleToMinionPhase(engine);

    const replayed = new VtesEngine(game("basic"), testRegistry);
    for (const c of engine.state.commandLog) replayed.choose(c.option);
    expect(replayed.state.knowledge).toEqual(engine.state.knowledge);
  });

  it("basic: an empty prey hand raises no frame at all", () => {
    const state = game("basic");
    seatOf(state, "Bob").hand = [];
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Revelations:basic"]]);
    // A mandatory frame with no legal answer would hang the settle loop.
    expect(walkTo(engine, "choice:Revelations", 20)).toBe(false);
    settleToMinionPhase(engine);
    expect(engine.decision()).not.toBeNull();
  });

  it("superior: puts itself in play and opens the prey's hand", () => {
    const engine = new VtesEngine(game("superior"), testRegistry);
    runTrace(engine, [["Alice", "play:Revelations:superior"]]);
    settleToMinionPhase(engine);
    const perms = seatOf(engine.state, "Alice").permanents;
    expect(perms.map((p) => p.card.name)).toEqual(["Revelations"]);
    expect(openHandsFor(engine.state, "Alice")).toEqual(["Bob"]);
    // …and only to its controller.
    expect(openHandsFor(engine.state, "Carol")).toEqual([]);
  });

  it("superior: the open hand defeats BOTH masking layers", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(
      entry("rv", "Revelations", { statics: { opensPreyHand: true } }),
    );
    seatOf(state, "Bob").hand = [{ id: "b1", name: "Conditioning" }];
    // redactFor hides NAMES…
    const red = redactFor(state, "Alice");
    expect(red.seats.find((s) => s.id === "Bob")!.hand[0]!.name).toBe("Conditioning");
    // …and viewFor collapses another seat's hand to a COUNT. Both have to
    // be defeated, and they ask the same helper so they cannot disagree.
    const view = viewFor(state, "Alice");
    const bob = view.seats.find((s) => s.id === "Bob")!;
    expect(Array.isArray(bob.hand)).toBe(true);
    expect((bob.hand as Array<{ name: string }>).map((c) => c.name)).toEqual([
      "Conditioning",
    ]);
    // Carol, who controls nothing, still sees a count.
    const carol = viewFor(state, "Carol").seats.find((s) => s.id === "Bob")!;
    expect(Array.isArray(carol.hand)).toBe(false);
  });

  it("superior: the effect follows the PREY, derived on every read", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(
      entry("rv", "Revelations", { statics: { opensPreyHand: true } }),
    );
    expect(openHandsFor(state, "Alice")).toEqual(["Bob"]);
    seatOf(state, "Bob").ousted = true;
    expect(openHandsFor(state, "Alice")).toEqual(["Carol"]);
  });

  it("superior: any minion can burn it as a Ⓓ action", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn frame");
    tf.seat = "Bob";
    seatOf(state, "Alice").permanents.push(
      entry("rv", "Revelations", { statics: { opensPreyHand: true } }),
    );
    const engine = new VtesEngine(state, testRegistry);
    expect(optionIds(engine).some((o) => o.startsWith("act:Revelations"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §3 — Deep Song
// ---------------------------------------------------------------------------

describe("Deep Song (100515)", () => {
  function game(level: "basic" | "superior"): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: { ani: level }, blood: 4 });
    seatOf(state, "Alice").hand = [{ id: "ds", name: "Deep Song" }];
    return state;
  }

  it("basic is an ordinary +1 bleed", () => {
    const engine = new VtesEngine(game("basic"), testRegistry);
    const pool = seatOf(engine.state, "Bob").pool;
    runTrace(engine, [["Alice", "play:Deep Song:basic"]]);
    settleToMinionPhase(engine);
    expect(seatOf(engine.state, "Bob").pool).toBe(pool - 2);
  });

  it("superior enters combat with a vampire, LOCKS it, and inverts the roles", () => {
    const engine = new VtesEngine(game("superior"), testRegistry);
    runTrace(engine, [["Alice", "play:Deep Song:superior:V1:W"]]);
    for (let i = 0; i < 40 && !combat(engine.state); i++) {
      const dp = engine.decision();
      if (!dp) break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    const cf = combat(engine.state)!;
    // THE INVERSION: the TARGET is the acting minion of this combat.
    expect(cf.acting).toBe("W");
    expect(cf.actingSeat).toBe("Bob");
    expect(cf.opposing).toBe("V1");
    expect(cf.opposingSeat).toBe("Alice");
    expect(find(engine.state, "W").locked).toBe(true);
    // …and it is a rush, not a block.
    expect(cf.fromBlock).toBe(false);
  });

  it("the inverted combat asks the TARGET's controller for the first strike", () => {
    const engine = new VtesEngine(game("superior"), testRegistry);
    runTrace(engine, [["Alice", "play:Deep Song:superior:V1:W"]]);
    expect(walkTo(engine, "strike:hand")).toBe(true);
    // The acting side chooses first, and the acting side is now Bob's.
    expect(engine.decision()!.seat).toBe("Bob");
  });

  it("targets a VAMPIRE, never an ally and never itself", () => {
    const state = game("superior");
    seatOf(state, "Bob").minions.push(
      makeMinion("A1", "Bob", { name: "A1", kind: "ally", capacity: 2, blood: 2 }),
    );
    const engine = new VtesEngine(state, testRegistry);
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Deep Song:superior"));
    expect(ids.some((o) => o.endsWith(":W:ds"))).toBe(true);
    expect(ids.some((o) => o.includes(":A1:"))).toBe(false);
    expect(ids.some((o) => o.includes(":V1:ds"))).toBe(false);
  });

  it("an ordinary rush is NOT inverted — the control case", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), {
      disciplines: { cel: "basic", tha: "basic" },
      blood: 4,
    });
    seatOf(state, "Alice").hand = [{ id: "hm", name: "Hunter's Mark" }];
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Hunter's Mark:basic:V1:W"]]);
    for (let i = 0; i < 40 && !combat(engine.state); i++) {
      const dp = engine.decision();
      if (!dp) break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    const cf = combat(engine.state)!;
    expect(cf.acting).toBe("V1");
    expect(cf.opposing).toBe("W");
  });
});

// ---------------------------------------------------------------------------
// §4 — Revolutionary Council
// ---------------------------------------------------------------------------

describe("Revolutionary Council (101631)", () => {
  /** V1 calls the referendum, so it is LOCKED at announcement (p. 25) and
   *  can never be one of the "ready unlocked Anarchs you control" — the
   *  choosable pool is V2 and V3. */
  function game(): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "anarch", title: "baron", blood: 4 });
    seatOf(state, "Alice").minions.push(
      makeMinion("V2", "Alice", { name: "V2", sect: "anarch" }),
      makeMinion("V3", "Alice", { name: "V3", sect: "anarch" }),
    );
    seatOf(state, "Alice").hand = [{ id: "rc", name: "Revolutionary Council" }];
    return state;
  }

  /** Announce the political action and walk to the terms step. */
  function toTerms(engine: VtesEngine): void {
    runTrace(engine, [["Alice", "play:Revolutionary Council"]]);
    expect(walkTo(engine, "terms:")).toBe(true);
  }

  it("requires a baron", () => {
    const state = game();
    find(state, "V1").title = null;
    const engine = new VtesEngine(state, testRegistry);
    expect(
      optionIds(engine).filter((o) => o.startsWith("play:Revolutionary Council")),
    ).toEqual([]);
  });

  it("offers 2 points per chosen Anarch, over seats AND cards in play", () => {
    const state = game();
    seatOf(state, "Bob").permanents.push(entry("loc", "Alamut", { tags: ["location"] }));
    find(state, "W").attached.push(entry("gun", ".44 Magnum", { tags: ["equipment"] }));
    const engine = new VtesEngine(state, testRegistry);
    toTerms(engine);
    const terms = optionIds(engine).filter((o) => o.startsWith("terms:"));
    // One Anarch = 2 points; two = 4. Both subsets are offered.
    expect(terms.some((o) => o.startsWith("terms:V2:"))).toBe(true);
    expect(terms.some((o) => o.startsWith("terms:V2,V3:"))).toBe(true);
    // The CALLER locked at announcement (p. 25), so it is never choosable.
    expect(terms.every((o) => !o.startsWith("terms:V1"))).toBe(true);
    // A location and an equipment are both legal recipients.
    expect(terms.some((o) => o.includes("card:loc="))).toBe(true);
    expect(terms.some((o) => o.includes("card:gun="))).toBe(true);
    // 2X: choosing two Anarchs really does place four points.
    const four = terms.find((o) => o.startsWith("terms:V2,V3:"))!;
    const total = four
      .slice("terms:V2,V3:".length)
      .split(",")
      .reduce((n, part) => n + Number(part.split("=")[1]), 0);
    expect(total).toBe(4);
  });

  it("caps a card at ONE point — a second would be wasted, so it is not a choice", () => {
    const state = game();
    seatOf(state, "Bob").permanents.push(entry("loc", "Alamut", { tags: ["location"] }));
    const engine = new VtesEngine(state, testRegistry);
    toTerms(engine);
    const terms = optionIds(engine).filter((o) => o.startsWith("terms:"));
    expect(terms.some((o) => /card:loc=[2-9]/.test(o))).toBe(false);
    expect(terms.some((o) => o.includes("card:loc=1"))).toBe(true);
  });

  it("locks the chosen Anarchs, burns pool per point and burns the card", () => {
    const state = game();
    seatOf(state, "Bob").permanents.push(entry("loc", "Alamut", { tags: ["location"] }));
    const engine = new VtesEngine(state, testRegistry);
    const pool = seatOf(engine.state, "Carol").pool;
    toTerms(engine);
    const pick = optionIds(engine).find(
      (o) => o.startsWith("terms:V2,V3:") && o.includes("Carol=3") && o.includes("card:loc=1"),
    );
    expect(pick).toBeDefined();
    runTrace(engine, [["Alice", pick!]]);
    // Vote it through: Alice's baron carries the referendum in a 3-seat
    // game only if nobody votes against, so everyone simply passes.
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.window === "turn.minion") break;
      const vote = dp.options.find((o) => o.id.endsWith(":for"));
      engine.choose(
        (dp.seat === "Alice" && vote ? vote : dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id,
      );
    }
    expect(find(engine.state, "V2").locked).toBe(true);
    expect(find(engine.state, "V3").locked).toBe(true);
    expect(seatOf(engine.state, "Carol").pool).toBe(pool - 3);
    expect(seatOf(engine.state, "Bob").permanents.some((p) => p.card.id === "loc")).toBe(
      false,
    );
  });

  it("only ready UNLOCKED ANARCHS YOU CONTROL may be chosen", () => {
    const state = game();
    find(state, "V2").locked = true; // locked
    find(state, "V3").sect = "camarilla"; // not an Anarch
    find(state, "W").sect = "anarch"; // an Anarch, but Bob's
    seatOf(state, "Alice").minions.push(
      makeMinion("V4", "Alice", { name: "V4", sect: "anarch" }),
    );
    const engine = new VtesEngine(state, testRegistry);
    toTerms(engine);
    const terms = optionIds(engine).filter((o) => o.startsWith("terms:"));
    // V4 is the only legal choice, so every option names exactly it.
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.every((o) => o.startsWith("terms:V4:"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The wave's own claim: nothing buildable is left
// ---------------------------------------------------------------------------

describe("what remains in the pool", () => {
  it("THE LIBRARY IS COMPLETE — every library card is supported", async () => {
    const reg = (await import("../../src/cards/registry.json", { with: { type: "json" } }))
      .default as {
      entries: Record<string, { card: { kind: string; name: string }; supported: boolean }>;
    };
    const library = Object.values(reg.entries).filter((e) => e.card.kind === "library");
    const unsupported = library.filter((e) => !e.supported);

    // This assertion used to be "every unsupported card names a BLOCKED
    // gate", which as of 2026-09-03 passes VACUOUSLY: there are no
    // unsupported cards, so the filter and the total are both zero and a
    // regression would look identical to success. That is the exact
    // "empty for the wrong reason" shape this project keeps finding in
    // cards, so the assertion is now about the number that means
    // something.
    //
    // The last blocker was the Path cards, and it turned out not to be a
    // blocker at all: a Path is a printed CRYPT trait carried by all 48
    // Sabbat V5 vampires, and the registry pipeline was simply dropping
    // the field (docs/path-cards-design.md §0).
    expect(unsupported.map((e) => e.card.name)).toEqual([]);
    // PIN THE REASON, NOT THE COUNT. This used to read `toBe(444)`, which
    // made a true statement — every library card in the pool is
    // implemented — a hostage to the pool ever changing size
    // (docs/pool-widening-design.md §2.4). The claim worth keeping is
    // that the library is whole and non-empty; the number is the
    // registry's business.
    expect(library.length).toBeGreaterThan(400);
    expect(unsupported).toHaveLength(0);
  });
});
