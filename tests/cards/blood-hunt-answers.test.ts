/**
 * The blood hunt (docs/blood-hunt-answers-design.md).
 *
 * The Hunt Club (100946), Absolution of the Diabolist (100012), Lay Low (101075).
 *
 * One referendum, three cards: one tilts the VOTE, two answer the VERDICT. All
 * three meet at the single point where a passed blood hunt burns its target
 * (p. 35), which is why they are one wave.
 *
 * Every case drives a REAL diablerie (p. 34) rather than hand-building a
 * referendum frame: the blood hunt is part of the diablerie's own resolution,
 * and a fixture that pushes its own frame proves nothing about whether the
 * engine ever gets there.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, currentStealth } from "../../src/engine/index.ts";
import { makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [name], ...over };
}

/**
 * Alice's V1 is about to diablerize Bob's torpid W. Carol's N is a PRINCE, so
 * somebody at the table has votes and the hunt can actually pass — with no
 * votes at all it would tie, and a tie fails (p. 28), which would make every
 * one of these cards look like it worked.
 */
function game(opts: { sect?: "anarch" | "camarilla" } = {}): {
  state: GameState;
  engine: VtesEngine;
} {
  const state = threeSeatGame();
  Object.assign(find(state, "V1")!, {
    sect: opts.sect ?? "anarch",
    capacity: 6,
    blood: 4,
  });
  Object.assign(find(state, "W")!, { inTorpor: true, blood: 1, capacity: 3 });
  Object.assign(find(state, "N")!, { title: "prince" });
  return { state, engine: new VtesEngine(state, testRegistry) };
}

/** Give a seat a ready justicar, which is what Absolution requires. */
function withJusticar(state: GameState, seat: string): MinionState {
  const j = makeMinion("J", seat, { title: "justicar", blood: 3, capacity: 7 });
  seatOf(state, seat).minions.push(j);
  return j;
}

/**
 * Drive the diablerie to its end, voting FOR the blood hunt so it PASSES, and
 * taking `take` the moment it is offered.
 */
function drive(
  engine: VtesEngine,
  state: GameState,
  take?: string,
  limit = 60,
): { tookIt: boolean } {
  let tookIt = false;
  for (let i = 0; i < limit; i++) {
    if (state.frames.every((f) => f.kind === "turn")) return { tookIt };
    const dp = engine.decision();
    if (!dp) return { tookIt };
    const wanted = take ? dp.options.find((o) => o.id.startsWith(take)) : undefined;
    if (wanted) tookIt = true;
    const pick =
      wanted ??
      dp.options.find((o) => o.id.endsWith(":for")) ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "end") ??
      // Step 4 of the diablerie raises the engine's own question and offers
      // no `pass`; a walker that only passes stops dead before the hunt.
      dp.options.find((o) => o.id.startsWith("choice:"));
    if (!pick) return { tookIt };
    engine.choose(pick.id);
  }
  return { tookIt };
}

/** Every option any seat is offered between here and the end of the turn. */
function allOffered(engine: VtesEngine, state: GameState, limit = 60): string[] {
  const seen: string[] = [];
  for (let i = 0; i < limit; i++) {
    if (state.frames.every((f) => f.kind === "turn")) return seen;
    const dp = engine.decision();
    if (!dp) return seen;
    for (const o of dp.options) seen.push(o.id);
    const pick =
      dp.options.find((o) => o.id.endsWith(":for")) ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "end") ??
      dp.options.find((o) => o.id.startsWith("choice:"));
    if (!pick) return seen;
    engine.choose(pick.id);
  }
  return seen;
}

// ---------------------------------------------------------------------------

describe("the CONTROL: an unanswered blood hunt burns the diablerist", () => {
  it("passes and burns V1, with nothing in anyone's hand", () => {
    const { state, engine } = game();
    engine.choose("diablerize:V1:W");
    drive(engine, state);
    expect(state.eventLog.some((e) => e.type === "BloodHuntCalled")).toBe(true);
    expect(find(state, "V1")).toBeUndefined();
    expect(
      state.eventLog.some((e) => e.type === "MinionBurned" && e.minion === "V1"),
    ).toBe(true);
  });
});

describe("Lay Low (101075) — the anarch walks away from the pyre", () => {
  it("moves the anarch to its owner's uncontrolled region instead of burning", () => {
    const { state, engine } = game();
    seatOf(state, "Alice").hand.push({ id: "ll", name: "Lay Low" });
    engine.choose("diablerize:V1:W");
    const { tookIt } = drive(engine, state, "play:Lay Low");
    expect(tookIt, "Lay Low was never offered").toBe(true);

    // Not burned, and not in the ready region either.
    expect(find(state, "V1")).toBeUndefined();
    expect(
      state.eventLog.some((e) => e.type === "MinionBurned" && e.minion === "V1"),
    ).toBe(false);
    const unc = seatOf(state, "Alice").uncontrolled;
    expect(unc.map((u) => u.card.id)).toContain("V1");
    // Blood became counters (p. 28 card text): 4 to start, +1 taken from the
    // victim by the diablerie (step 1), −1 for the card itself = 4.
    expect(unc.find((u) => u.card.id === "V1")!.counters).toBe(4);
  });

  it("NEGATIVE SPACE: not offered when the diablerist is not an anarch", () => {
    const { state, engine } = game({ sect: "camarilla" });
    seatOf(state, "Alice").hand.push({ id: "ll", name: "Lay Low" });
    engine.choose("diablerize:V1:W");
    const offered = allOffered(engine, state);
    expect(offered.some((o) => o.startsWith("play:Lay Low"))).toBe(false);
    // …and the hunt did what it does.
    expect(find(state, "V1")).toBeUndefined();
  });

  it("NEGATIVE SPACE: only the victim's controller is offered it", () => {
    const { state, engine } = game();
    // Bob holds the card; Bob's vampire is the one being diablerized, not the
    // one being hunted. "THIS anarch" is the card's own player's vampire.
    seatOf(state, "Bob").hand.push({ id: "ll", name: "Lay Low" });
    engine.choose("diablerize:V1:W");
    expect(allOffered(engine, state).some((o) => o.startsWith("play:Lay Low"))).toBe(false);
  });
});

describe("Absolution of the Diabolist (100012) — the blood hunt is called off", () => {
  it("cancels the hunt, leaving the diablerist ready, for 1 pool", () => {
    const { state, engine } = game();
    withJusticar(state, "Carol");
    seatOf(state, "Carol").hand.push({ id: "ab", name: "Absolution of the Diabolist" });
    const before = seatOf(state, "Carol").pool;
    engine.choose("diablerize:V1:W");
    const { tookIt } = drive(engine, state, "play:Absolution of the Diabolist");
    expect(tookIt, "Absolution was never offered").toBe(true);

    // The referendum still PASSED; only the burn was called off.
    expect(state.eventLog.some((e) => e.type === "ReferendumResolved")).toBe(true);
    expect(find(state, "V1")).toBeDefined();
    expect(
      state.eventLog.some((e) => e.type === "MinionBurned" && e.minion === "V1"),
    ).toBe(false);
    expect(seatOf(state, "Carol").pool).toBe(before - 1);
    // An out-of-turn master is a debt against the next master phase (p. 8).
    expect(seatOf(state, "Carol").outOfTurnMasterUsed).toBe(true);
  });

  it("NEGATIVE SPACE: not offered without a ready justicar or Inner Circle member", () => {
    const { state, engine } = game();
    seatOf(state, "Carol").hand.push({ id: "ab", name: "Absolution of the Diabolist" });
    engine.choose("diablerize:V1:W");
    expect(
      allOffered(engine, state).some((o) => o.startsWith("play:Absolution")),
    ).toBe(false);
    expect(find(state, "V1")).toBeUndefined();
  });

  it("NEGATIVE SPACE: a justicar in TORPOR is not a ready one", () => {
    const { state, engine } = game();
    withJusticar(state, "Carol").inTorpor = true;
    seatOf(state, "Carol").hand.push({ id: "ab", name: "Absolution of the Diabolist" });
    engine.choose("diablerize:V1:W");
    expect(
      allOffered(engine, state).some((o) => o.startsWith("play:Absolution")),
    ).toBe(false);
  });

  it("an INNER CIRCLE member satisfies it as well as a justicar", () => {
    const { state, engine } = game();
    const ic = withJusticar(state, "Carol");
    ic.title = "innerCircle";
    seatOf(state, "Carol").hand.push({ id: "ab", name: "Absolution of the Diabolist" });
    engine.choose("diablerize:V1:W");
    expect(drive(engine, state, "play:Absolution").tookIt).toBe(true);
    expect(find(state, "V1")).toBeDefined();
  });
});

describe("The Hunt Club (100946) — the victim cannot vote on its own pyre", () => {
  it("bars the bearer's votes in a blood hunt called on the bearer", () => {
    const { state, engine } = game();
    // V1 is a PRINCE, so it has votes of its own to lose.
    find(state, "V1")!.title = "prince";
    find(state, "V1")!.attached.push(
      entry("hc", "The Hunt Club", { statics: { cannotCastVotesInOwnBloodHunt: true } }),
    );
    engine.choose("diablerize:V1:W");
    const offered = allOffered(engine, state);
    expect(offered.some((o) => o.startsWith("vote:V1"))).toBe(false);
    // Carol's prince still votes, so the referendum was real.
    expect(offered.some((o) => o.startsWith("vote:N"))).toBe(true);
  });

  it("CONTROL: the same prince without the card DOES vote", () => {
    const { state, engine } = game();
    find(state, "V1")!.title = "prince";
    engine.choose("diablerize:V1:W");
    expect(allOffered(engine, state).some((o) => o.startsWith("vote:V1"))).toBe(true);
  });

  it("bars ONLY the bearer's own hunt: it votes in anybody else's", () => {
    const { state, engine } = game();
    // Carol's N carries the card; the hunt is on Alice's V1.
    find(state, "N")!.attached.push(
      entry("hc", "The Hunt Club", { statics: { cannotCastVotesInOwnBloodHunt: true } }),
    );
    engine.choose("diablerize:V1:W");
    expect(allOffered(engine, state).some((o) => o.startsWith("vote:N"))).toBe(true);
  });

  it("gives the bearer +1 stealth on the diablerie attempt", () => {
    const { state, engine } = game();
    find(state, "V1")!.attached.push(
      entry("hc", "The Hunt Club", {
        statics: { conditional: [{ stealth: 1, actionKinds: ["diablerize"] }] },
      }),
    );
    engine.choose("diablerize:V1:W");
    const ev = state.eventLog.find((e) => e.type === "ActionAnnounced");
    const id = ev?.type === "ActionAnnounced" ? ev.actionId : "";
    // A diablerie is a directed action with no inherent stealth; the card is
    // the whole of it.
    expect(currentStealth(state, id)).toBe(1);
  });

  it("is played onto ANY ready vampire, including another Methuselah's", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    seatOf(state, "Alice").hand.push({ id: "hc", name: "The Hunt Club" });
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    // Alice's own V1 and Bob's W and M — the card names no side.
    expect(ids.some((o) => o.startsWith("play:The Hunt Club") && o.includes("V1"))).toBe(true);
    expect(ids.some((o) => o.startsWith("play:The Hunt Club") && o.includes("M"))).toBe(true);
  });
});
