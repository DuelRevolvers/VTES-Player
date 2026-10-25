/**
 * Referendum outcomes, wave 110 (docs/referendum-outcomes-design.md).
 *
 * Treachery (102014), Poison Pill (101406), Political Backlash (101413),
 * Aura of Invincibility (100112), Vox Domini (102132).
 *
 * Five cards that act on HOW A REFERENDUM ENDS, and one question the engine
 * could not answer before: what happened after the tally, and WHEN. "After
 * the referendum effects are applied" is not the line after
 * `applyReferendum` — Ancient Influence pays out only when the last seat
 * answers — so most of these tests pin an ORDER, not just an amount.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, vampireVotes } from "../../src/engine/index.ts";
import { makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

type Seen = { seat: string; window: string; ids: string[] };

/**
 * Answer decisions until the referendum is over and the script is spent.
 * Each decision takes the script's HEAD if it is for that seat and offered,
 * otherwise `pass` (then `end`, then the first option of a mandatory
 * choice). Every decision is recorded, so a test can assert what was — and
 * was not — offered. A script that is not fully consumed throws: a step the
 * engine never offered is a failure, not a silent skip.
 */
function drive(
  engine: VtesEngine,
  state: GameState,
  script: Array<[string, string]>,
  until?: () => boolean,
): Seen[] {
  const queue = [...script];
  const seen: Seen[] = [];
  let moved = false;
  for (let i = 0; i < 300; i++) {
    if (until?.()) break;
    if (moved && queue.length === 0 && state.frames.every((f) => f.kind === "turn")) break;
    const dp = engine.decision();
    if (!dp) break;
    const ids = dp.options.map((o) => o.id);
    seen.push({ seat: dp.seat, window: dp.window, ids });
    const head = queue[0];
    let pick = head && head[0] === dp.seat ? ids.find((id) => id.startsWith(head[1])) : undefined;
    if (pick) queue.shift();
    else pick = ids.find((id) => id === "pass") ?? ids.find((id) => id === "end") ?? ids[0];
    engine.choose(pick!);
    moved = true;
  }
  if (queue.length > 0) throw new Error(`never offered: ${JSON.stringify(queue)}`);
  return seen;
}

function offered(seen: Seen[], seat: string, prefix: string): boolean {
  return seen.some((s) => s.seat === seat && s.ids.some((id) => id.startsWith(prefix)));
}

function minion(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function pool(state: GameState, seat: string): number {
  return state.seats.find((s) => s.id === seat)!.pool;
}

/** Pool burns after the tally, in order, as `seat:amount`. */
function burnsAfterTally(state: GameState): string[] {
  const at = state.eventLog.findIndex((e) => e.type === "ReferendumResolved");
  expect(at).toBeGreaterThanOrEqual(0);
  return state.eventLog
    .slice(at + 1)
    .flatMap((e) => (e.type === "PoolBurned" ? [`${e.seat}:${e.amount}`] : []));
}

function resolved(state: GameState): { passed: boolean; votesFor: number } {
  const ev = state.eventLog.find((e) => e.type === "ReferendumResolved");
  if (!ev || ev.type !== "ReferendumResolved") throw new Error("no ReferendumResolved");
  return { passed: ev.passed, votesFor: ev.votesFor };
}

/**
 * Alice calls Anarchist Uprising with V1, a prince (2 votes). Bob's W is a
 * prince too. A pass burns each Methuselah 1 pool per minion: Alice 1, Bob 2
 * (W and M), Carol 1 — three seats, two different amounts.
 */
function votingGame(): GameState {
  const state = threeSeatGame();
  Object.assign(minion(state, "V1"), { title: "prince", blood: 4 });
  state.seats[0]!.hand.push({ id: "au1", name: "Anarchist Uprising" });
  minion(state, "W").title = "prince";
  return state;
}

const CALL: [string, string] = ["Alice", "play:Anarchist Uprising:basic:V1"];

/** Ready V1 to call a second referendum this turn. */
function callAgain(state: GameState, id: string): void {
  Object.assign(minion(state, "V1"), { locked: false, calledPoliticalThisTurn: false });
  state.seats[0]!.hand.push({ id, name: "Anarchist Uprising" });
}

// ---------------------------------------------------------------------------

describe("Treachery (102014)", () => {
  function game(level: "basic" | "superior"): GameState {
    const state = votingGame();
    minion(state, "M").disciplines = { pre: level };
    state.seats[1]!.hand.push({ id: "tr", name: "Treachery" });
    return state;
  }

  it("on a PASS, the caller burns 1 pool AFTER the effect", () => {
    const state = game("basic");
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [CALL, ["Bob", "play:Treachery"], ["Alice", "vote:V1:for"]]);
    expect(resolved(state).passed).toBe(true);
    // The effect (Alice 1, Bob 2, Carol 1), THEN Treachery's 1 — last.
    const burns = burnsAfterTally(state);
    expect(burns.at(-1)).toBe("Alice:1");
    expect(burns.filter((b) => b.startsWith("Alice:"))).toHaveLength(2);
    expect(pool(state, "Alice")).toBe(8);
  });

  it("NEGATIVE SPACE: a FAIL costs the caller nothing", () => {
    const state = game("basic");
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [CALL, ["Bob", "play:Treachery"], ["Bob", "vote:W:against"]]);
    expect(resolved(state).passed).toBe(false);
    expect(pool(state, "Alice")).toBe(10);
  });

  it("SUPERIOR: other yes-voting seats burn 1 each at the TALLY, the reactor's own included", () => {
    const state = game("superior");
    minion(state, "N").title = "prince";
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [
      CALL,
      ["Bob", "play:Treachery:superior"],
      ["Alice", "vote:V1:for"],
      ["Bob", "vote:W:for"],
      ["Carol", "vote:N:for"],
    ]);
    expect(resolved(state).passed).toBe(true);
    const burns = burnsAfterTally(state);
    // Tally first (Bob and Carol, once each, never the caller), then the
    // effect, then the caller's 1 after it.
    expect(burns.slice(0, 2).sort()).toEqual(["Bob:1", "Carol:1"]);
    expect(burns.at(-1)).toBe("Alice:1");
    expect(burns).toHaveLength(6);
  });

  it("SUPERIOR on a FAIL burns nobody (owner ruling 2026-10-24)", () => {
    const state = game("superior");
    minion(state, "N").title = "prince";
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [
      CALL,
      ["Bob", "play:Treachery:superior"],
      ["Bob", "vote:W:against"],
      ["Carol", "vote:N:for"], // 2 against 2: a tie fails (p. 28)
    ]);
    expect(resolved(state).passed).toBe(false);
    expect(burnsAfterTally(state)).toEqual([]);
  });

  it("with Ancient Influence the burn lands after the LAST seat's choice", () => {
    const state = game("basic");
    state.seats[0]!.hand = [{ id: "ai", name: "Ancient Influence" }];
    Object.assign(minion(state, "V1"), { capacity: 6 });
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [
      ["Alice", "play:Ancient Influence"],
      ["Bob", "play:Treachery"],
      ["Alice", "vote:V1:for"],
      ["Alice", "choice:Ancient Influence"],
      ["Bob", "choice:Ancient Influence"],
      ["Carol", "choice:Ancient Influence"],
    ]);
    const lastChoice = state.eventLog.map((e) => e.type).lastIndexOf("PoolGained");
    const treachery = state.eventLog.length - 1 - [...state.eventLog].reverse().findIndex(
      (e) => e.type === "PoolBurned" && e.seat === "Alice" && e.amount === 1,
    );
    expect(lastChoice).toBeGreaterThan(0);
    expect(treachery).toBeGreaterThan(lastChoice);
    expect(burnsAfterTally(state).at(-1)).toBe("Alice:1");
  });

  it("NEGATIVE SPACE: not once a vote is cast, and never for the caller's seat", () => {
    const state = game("basic");
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { disciplines: { pre: "basic" } }));
    state.seats[0]!.hand.push({ id: "tr2", name: "Treachery" });
    const engine = new VtesEngine(state, testRegistry);
    const seen = drive(engine, state, [CALL, ["Alice", "vote:V1:for"]]);
    expect(offered(seen, "Alice", "play:Treachery")).toBe(false);
    // Bob is first asked AFTER Alice's vote, and is never offered it.
    expect(offered(seen, "Bob", "play:Treachery")).toBe(false);
  });
});

describe("Poison Pill (101406)", () => {
  it("mirrors a plain burn onto the acting Methuselah", () => {
    const state = votingGame();
    state.seats[1]!.hand.push({ id: "pp", name: "Poison Pill" });
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [CALL, ["Bob", "play:Poison Pill"], ["Alice", "vote:V1:for"]]);
    // Bob lost 2 to the effect; Alice loses 2 more on top of her own 1.
    expect(burnsAfterTally(state).at(-1)).toBe("Alice:2");
    expect(pool(state, "Alice")).toBe(7);
  });

  it("with Ancient Influence mirrors the 5 BURNED, not the net [ANK 20180813]", () => {
    const state = votingGame();
    state.seats[0]!.hand = [{ id: "ai", name: "Ancient Influence" }];
    Object.assign(minion(state, "V1"), { capacity: 6 });
    state.seats[1]!.minions = [minion(state, "W")];
    Object.assign(minion(state, "W"), { capacity: 4, title: null });
    state.seats[1]!.hand.push({ id: "pp", name: "Poison Pill" });
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [
      ["Alice", "play:Ancient Influence"],
      ["Bob", "play:Poison Pill"],
      ["Alice", "vote:V1:for"],
      ["Alice", "choice:Ancient Influence"],
      ["Bob", "choice:Ancient Influence:ai:tableVampireChoice:W"],
      ["Carol", "choice:Ancient Influence"],
    ]);
    // Bob gained 4 and burned 5: a net loss of 1, a LOSS of 5.
    expect(burnsAfterTally(state).at(-1)).toBe("Alice:5");
  });

  it("mirrors what was ACTUALLY lost when the effect ousts you, and still fires", () => {
    const state = votingGame();
    state.seats[0]!.hand = [{ id: "ai", name: "Ancient Influence" }];
    state.seats[1]!.pool = 3;
    state.seats[1]!.hand.push({ id: "pp", name: "Poison Pill" });
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [
      ["Alice", "play:Ancient Influence"],
      ["Bob", "play:Poison Pill"],
      ["Alice", "vote:V1:for"],
      ["Alice", "choice:Ancient Influence"],
      ["Bob", "choice:Ancient Influence:ai:tableVampireChoice:none"],
      ["Carol", "choice:Ancient Influence"],
    ]);
    // Told to burn 5 on 3 pool, Bob lost 3 and is out — the mirror is 3.
    expect(state.seats[1]!.ousted).toBe(true);
    // The log says Bob was told to burn 5; the mirror reads what he had.
    expect(burnsAfterTally(state)).toEqual(["Alice:5", "Bob:5", "Carol:5", "Alice:3"]);
  });

  it("NEGATIVE SPACE: nothing on a FAIL", () => {
    const state = votingGame();
    state.seats[1]!.hand.push({ id: "pp", name: "Poison Pill" });
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [CALL, ["Bob", "play:Poison Pill"], ["Bob", "vote:W:against"]]);
    expect(resolved(state).passed).toBe(false);
    expect(pool(state, "Alice")).toBe(10);
  });

  it("NEGATIVE SPACE: Treachery's burn is not the effect (owner ruling 2026-10-24)", () => {
    // Bob plays Poison Pill, Carol plays Treachery. Carol's Treachery burns
    // ALICE, so it cannot be what Bob mirrors — but Bob's own loss is still
    // the effect's 2, measured before either rider ran.
    const state = votingGame();
    state.seats[1]!.hand.push({ id: "pp", name: "Poison Pill" });
    minion(state, "N").disciplines = { pre: "basic" };
    state.seats[2]!.hand.push({ id: "tr", name: "Treachery" });
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [
      CALL,
      ["Bob", "play:Poison Pill"],
      ["Carol", "play:Treachery"],
      ["Alice", "vote:V1:for"],
    ]);
    // In play order: Poison Pill mirrors 2, then Treachery burns 1.
    expect(burnsAfterTally(state).slice(-2)).toEqual(["Alice:2", "Alice:1"]);
    expect(pool(state, "Alice")).toBe(6);
  });

  it("two copies from two vampires pay twice", () => {
    const state = votingGame();
    state.seats[1]!.hand.push({ id: "pp1", name: "Poison Pill" }, { id: "pp2", name: "Poison Pill" });
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [
      CALL,
      ["Bob", "play:Poison Pill:basic:W"],
      ["Bob", "play:Poison Pill:basic:M"],
      ["Alice", "vote:V1:for"],
    ]);
    expect(burnsAfterTally(state).slice(-2)).toEqual(["Alice:2", "Alice:2"]);
  });
});

describe("Political Backlash (101413)", () => {
  function game(): GameState {
    const state = votingGame();
    state.seats[1]!.hand.push({ id: "pb", name: "Political Backlash" });
    return state;
  }

  it("on a FAIL, the acting Methuselah burns 2", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    const seen = drive(engine, state, [CALL, ["Bob", "vote:W:against"], ["Bob", "play:Political Backlash"]]);
    expect(seen.some((s) => s.window === "referendum.afterResolution")).toBe(true);
    expect(resolved(state).passed).toBe(false);
    expect(pool(state, "Alice")).toBe(8);
  });

  it("NEGATIVE SPACE: never on a PASS, and never as an ordinary reaction", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    const seen = drive(engine, state, [CALL, ["Alice", "vote:V1:for"]]);
    expect(resolved(state).passed).toBe(true);
    expect(offered(seen, "Bob", "play:Political Backlash")).toBe(false);
    expect(seen.some((s) => s.window === "referendum.afterResolution")).toBe(false);
  });

  it("is offered after Vox Domini's failure", () => {
    const state = game();
    state.seats[2]!.hand.push({ id: "vd", name: "Vox Domini" });
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [
      CALL,
      ["Alice", "vote:V1:for"],
      ["Carol", "play:Vox Domini"],
      ["Bob", "play:Political Backlash"],
    ]);
    expect(resolved(state).passed).toBe(false);
    expect(pool(state, "Alice")).toBe(8);
  });

  it("NEGATIVE SPACE: not after a CANCELLATION, which is not a failure", () => {
    const state = game();
    minion(state, "V1").disciplines = { aus: "basic" };
    state.seats[0]!.hand.push({ id: "tvc", name: "Telepathic Vote Counting" });
    const engine = new VtesEngine(state, testRegistry);
    const seen = drive(engine, state, [CALL, ["Alice", "play:Telepathic Vote Counting:basic:V1"]]);
    expect(state.eventLog.some((e) => e.type === "ReferendumCancelled")).toBe(true);
    expect(offered(seen, "Bob", "play:Political Backlash")).toBe(false);
    expect(pool(state, "Alice")).toBe(10);
  });

  it("NEGATIVE SPACE: not to the caller's seat — and the pass-side cards stay shut on a fail", () => {
    const state = game();
    state.seats[0]!.minions.push(makeMinion("V2", "Alice"));
    state.seats[0]!.hand.push({ id: "pb2", name: "Political Backlash" }, { id: "cr", name: "Cryptic Rider" });
    const engine = new VtesEngine(state, testRegistry);
    const seen = drive(engine, state, [CALL, ["Bob", "vote:W:against"], ["Bob", "play:Political Backlash"]]);
    const after = seen.filter((s) => s.window === "referendum.afterResolution");
    expect(after.length).toBeGreaterThan(0);
    // The window is open — for Bob — and Alice sees neither card in it.
    expect(after.some((s) => s.seat === "Alice" && s.ids.some((id) => id.startsWith("play:Political Backlash")))).toBe(false);
    expect(after.some((s) => s.ids.some((id) => id.startsWith("play:Cryptic Rider")))).toBe(false);
  });
});

describe("Aura of Invincibility (100112)", () => {
  function game(): GameState {
    const state = votingGame();
    state.seats[0]!.hand.push({ id: "aura", name: "Aura of Invincibility" });
    return state;
  }

  function aura(state: GameState) {
    return minion(state, "V1").attached.find((p) => p.card.name === "Aura of Invincibility");
  }

  it("a pass puts it on the acting vampire with exactly ONE counter (owner ruling 2026-10-24)", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [CALL, ["Alice", "play:Aura of Invincibility"], ["Alice", "vote:V1:for"]]);
    expect(resolved(state).passed).toBe(true);
    expect(aura(state)?.counters).toBe(1);
    expect(state.seats[0]!.ashHeap?.some((c) => c.id === "aura")).toBe(false);
  });

  it("+1 vote per counter on referendums its bearer calls; a pass adds a counter; a fail burns it and sends the bearer to torpor", () => {
    const state = game();
    state.seats[0]!.minions.push(makeMinion("V2", "Alice"));
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [CALL, ["Alice", "play:Aura of Invincibility"], ["Alice", "vote:V1:for"]]);

    // Second referendum, called by V1: 2 (prince) + 1 (one counter).
    callAgain(state, "au2");
    let votes = -1;
    drive(engine, state, [CALL, ["Alice", "vote:V1:for"]], () => {
      const rf = state.frames.find((f) => f.kind === "referendum");
      if (rf?.kind === "referendum" && votes < 0) votes = vampireVotes(state, rf, minion(state, "V1")).votes;
      return false;
    });
    expect(votes).toBe(3);
    expect(aura(state)?.counters).toBe(2);

    // A referendum V2 calls: the Aura adds nothing to V1.
    Object.assign(minion(state, "V2"), { title: "prince" });
    state.seats[0]!.hand.push({ id: "au3", name: "Anarchist Uprising" });
    let v1Votes = -1;
    drive(engine, state, [["Alice", "play:Anarchist Uprising:basic:V2"], ["Alice", "vote:V2:for"]], () => {
      const rf = state.frames.find((f) => f.kind === "referendum");
      if (rf?.kind === "referendum" && v1Votes < 0) v1Votes = vampireVotes(state, rf, minion(state, "V1")).votes;
      return false;
    });
    expect(v1Votes).toBe(2);
    expect(aura(state)?.counters).toBe(2); // V2's pass is not V1's

    // A fail V1 calls: burn the card, V1 to torpor.
    callAgain(state, "au4");
    minion(state, "W").title = "primogen"; // 3 votes against V1's 2 + 2
    minion(state, "N").title = "prince";
    drive(engine, state, [CALL, ["Bob", "vote:W:against"], ["Carol", "vote:N:against"]]);
    expect(aura(state)).toBeUndefined();
    expect(minion(state, "V1").inTorpor).toBe(true);
  });

  it("NEGATIVE SPACE: a CANCELLED referendum neither burns it nor sends the bearer to torpor", () => {
    const state = game();
    Object.assign(minion(state, "V1"), { disciplines: { aus: "basic" } });
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [CALL, ["Alice", "play:Aura of Invincibility"], ["Alice", "vote:V1:for"]]);
    callAgain(state, "au2");
    state.seats[0]!.hand.push({ id: "tvc", name: "Telepathic Vote Counting" });
    drive(engine, state, [CALL, ["Alice", "play:Telepathic Vote Counting:basic:V1"]]);
    expect(state.eventLog.some((e) => e.type === "ReferendumCancelled")).toBe(true);
    expect(aura(state)?.counters).toBe(1);
    expect(minion(state, "V1").inTorpor).toBe(false);
  });

  it("NEGATIVE SPACE: its first referendum failing leaves it in the ash heap [LSJ 20040730]", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [CALL, ["Alice", "play:Aura of Invincibility"], ["Bob", "vote:W:against"]]);
    expect(resolved(state).passed).toBe(false);
    expect(aura(state)).toBeUndefined();
    expect(state.seats[0]!.ashHeap?.some((c) => c.id === "aura")).toBe(true);
    expect(minion(state, "V1").inTorpor).toBe(false);
  });

  it("NEGATIVE SPACE: taken out of the ash heap before the pass, it does nothing [ANK 20220805]", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [CALL, ["Alice", "play:Aura of Invincibility"]], () =>
      state.seats[0]!.ashHeap?.some((c) => c.id === "aura") ?? false,
    );
    state.seats[0]!.ashHeap = state.seats[0]!.ashHeap!.filter((c) => c.id !== "aura");
    drive(engine, state, [["Alice", "vote:V1:for"]]);
    expect(resolved(state).passed).toBe(true);
    expect(aura(state)).toBeUndefined();
  });

  it("NEGATIVE SPACE: a vampire that has one cannot play another [LSJ 20040730-2]", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [CALL, ["Alice", "play:Aura of Invincibility"], ["Alice", "vote:V1:for"]]);
    callAgain(state, "au2");
    state.seats[0]!.hand.push({ id: "aura2", name: "Aura of Invincibility" });
    const seen = drive(engine, state, [CALL, ["Alice", "vote:V1:for"]]);
    expect(seen.some((s) => s.window === "referendum.polling")).toBe(true);
    expect(offered(seen, "Alice", "play:Aura of Invincibility")).toBe(false);
  });
});

describe("Vox Domini (102132)", () => {
  it("fails the referendum AT ONCE: the votes cast stay, no more are asked for", () => {
    const state = votingGame();
    state.seats[1]!.hand.push({ id: "vd", name: "Vox Domini" });
    const engine = new VtesEngine(state, testRegistry);
    const seen = drive(engine, state, [CALL, ["Alice", "vote:V1:for"], ["Bob", "play:Vox Domini"]]);
    expect(resolved(state)).toEqual({ passed: false, votesFor: 2 });
    // After Bob's play, nobody is asked to vote again.
    const at = seen.findIndex((s) => s.seat === "Bob" && s.ids.some((id) => id.startsWith("play:Vox Domini")));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(seen.slice(at + 1).some((s) => s.window === "referendum.polling")).toBe(false);
    expect(state.seats[1]!.pool).toBe(9); // its 1 pool
  });

  it("is a FAILURE, not a cancellation: a title-granting card burns (p. 27)", () => {
    const state = threeSeatGame();
    Object.assign(minion(state, "V1"), { sect: "camarilla", capacity: 6, blood: 4 });
    state.seats[0]!.hand.push({ id: "ps", name: "Praxis Seizure: Washington, D.C." });
    state.seats[1]!.hand.push({ id: "vd", name: "Vox Domini" });
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [
      ["Alice", "play:Praxis Seizure: Washington, D.C."],
      ["Alice", "vote:caller:for"],
      ["Bob", "play:Vox Domini"],
    ]);
    expect(resolved(state).passed).toBe(false);
    expect(state.eventLog.some((e) => e.type === "CardBurned" && e.cardId === "ps")).toBe(true);
  });

  it("ONE PER METHUSELAH PER GAME — while another Methuselah can still play theirs", () => {
    const state = votingGame();
    state.seats[1]!.hand.push({ id: "vd1", name: "Vox Domini" }, { id: "vd2", name: "Vox Domini" });
    state.seats[2]!.hand.push({ id: "vd3", name: "Vox Domini" });
    const engine = new VtesEngine(state, testRegistry);
    drive(engine, state, [CALL, ["Bob", "play:Vox Domini"]]);
    // Spend nothing else: the out-of-turn budget (p. 9) would otherwise be
    // what bars Bob, and this test would pass for the wrong reason.
    state.seats[1]!.outOfTurnMasterUsed = false;
    callAgain(state, "au2");
    const seen = drive(engine, state, [CALL, ["Alice", "vote:V1:for"]]);
    expect(seen.some((s) => s.window === "referendum.polling")).toBe(true);
    expect(offered(seen, "Bob", "play:Vox Domini")).toBe(false);
    expect(offered(seen, "Carol", "play:Vox Domini")).toBe(true);
  });

  it("NEGATIVE SPACE: not on your own turn, and not at 1 pool", () => {
    const state = votingGame();
    state.seats[0]!.hand.push({ id: "vd0", name: "Vox Domini" });
    state.seats[1]!.hand.push({ id: "vd1", name: "Vox Domini" });
    state.seats[1]!.pool = 1;
    state.seats[2]!.hand.push({ id: "vd2", name: "Vox Domini" });
    const engine = new VtesEngine(state, testRegistry);
    const seen = drive(engine, state, [CALL, ["Alice", "vote:V1:for"]]);
    expect(offered(seen, "Alice", "play:Vox Domini")).toBe(false);
    expect(offered(seen, "Bob", "play:Vox Domini")).toBe(false);
    // The positive control: Carol, on 10 pool, could have.
    expect(offered(seen, "Carol", "play:Vox Domini")).toBe(true);
  });
});

describe("the siblings: what the two engine changes reach beyond the five", () => {
  function privilegedPosition(state: GameState): void {
    state.seats[0]!.permanents.push({
      card: { id: "pp1", name: "Privileged Position" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: [],
    });
  }

  it("the after-resolution window opening on a FAIL does not open the PASS abilities (Privileged Position)", () => {
    const fail = votingGame();
    privilegedPosition(fail);
    fail.seats[1]!.hand.push({ id: "pb", name: "Political Backlash" });
    const failSeen = drive(new VtesEngine(fail, testRegistry), fail, [CALL, ["Bob", "vote:W:against"]]);
    expect(failSeen.some((s) => s.window === "referendum.afterResolution")).toBe(true);
    expect(offered(failSeen, "Alice", "ability:Privileged Position")).toBe(false);
    // The positive control: on a pass it is offered.
    const pass = votingGame();
    privilegedPosition(pass);
    const passSeen = drive(new VtesEngine(pass, testRegistry), pass, [CALL, ["Alice", "vote:V1:for"]]);
    expect(offered(passSeen, "Alice", "ability:Privileged Position")).toBe(true);
  });

  it("Elder Kindred Network, Bribes and Malkavian Rider Clause are no longer offered after a vote", () => {
    // All three print "before votes and ballots are cast" and were offered
    // after them until wave 110. The positive cases are in
    // referendum-riders.test.ts, played before any vote.
    const state = votingGame();
    state.seats[0]!.hand.push({ id: "br", name: "Bribes" });
    Object.assign(minion(state, "W"), { clan: "Ventrue" });
    Object.assign(minion(state, "M"), { clan: "Malkavian", blood: 3 });
    state.seats[1]!.hand.push({ id: "ekn", name: "Elder Kindred Network" }, { id: "mrc", name: "Malkavian Rider Clause" });
    const engine = new VtesEngine(state, testRegistry);
    const seen = drive(engine, state, [CALL, ["Alice", "vote:V1:for"]]);
    const firstVote = seen.findIndex((s) => s.ids.includes("vote:V1:for") && s.seat === "Alice");
    // Alice could play Bribes BEFORE her vote — the control — and not after.
    expect(seen[firstVote]!.ids.some((id) => id.startsWith("play:Bribes"))).toBe(true);
    const after = seen.slice(firstVote + 1);
    expect(offered(after, "Alice", "play:Bribes")).toBe(false);
    expect(offered(after, "Bob", "play:Elder Kindred Network")).toBe(false);
    expect(offered(after, "Bob", "play:Malkavian Rider Clause")).toBe(false);
  });
});

describe("a referendum passing AUTOMATICALLY takes none of them [PIB 20150105]", () => {
  it("resolves with no polling decision at all, the four cards still in hand", () => {
    const state = votingGame();
    state.seats[0]!.autoPassReferendum = {};
    state.seats[0]!.hand.push({ id: "aura", name: "Aura of Invincibility" });
    minion(state, "M").disciplines = { pre: "basic" };
    state.seats[1]!.hand.push({ id: "tr", name: "Treachery" }, { id: "pp", name: "Poison Pill" });
    state.seats[2]!.hand.push({ id: "vd", name: "Vox Domini" });
    const engine = new VtesEngine(state, testRegistry);
    const seen = drive(engine, state, [CALL]);
    expect(resolved(state).passed).toBe(true);
    expect(seen.some((s) => s.window === "referendum.polling")).toBe(false);
    const hands = state.seats.flatMap((s) => s.hand.map((c) => c.id));
    expect(hands).toEqual(expect.arrayContaining(["aura", "tr", "pp", "vd"]));
  });
});
