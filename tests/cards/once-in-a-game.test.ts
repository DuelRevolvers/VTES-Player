/**
 * Once in a game (docs/once-in-a-game-design.md).
 *
 * Ancient Influence (100064), Reins of Power (101591),
 * Camarilla Exemplary (100284), Sabbat Priest (101667).
 *
 * Four political actions that name a VAMPIRE and pay out from what that vampire
 * IS, in two pairs of twins. Each pair differs in exactly one thing, and that
 * one thing is what these tests are for: whose capacity is read, and which sect
 * is named. Either card alone would look right with the difference reversed.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/**
 * Alice calls the referendum with V1 (a titled PRINCE, so it passes on its own
 * two votes against a silent table). Every seat controls one ready vampire, and
 * the three capacities are DIFFERENT — 6, 4 and 9 — so a payout that read the
 * wrong seat's choice produces a different number rather than the same one.
 *
 * Seating: Alice → Bob → Carol → Alice, so Alice's predator is Carol.
 */
function game(card: string): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(find(state, "V1")!, {
    title: "prince",
    sect: "camarilla",
    capacity: 6,
    blood: 4,
  });
  Object.assign(find(state, "W")!, { sect: "sabbat", capacity: 4, blood: 2 });
  // Bob's second minion is irrelevant here and would only add questions.
  seatOf(state, "Bob").minions = seatOf(state, "Bob").minions.filter((m) => m.id === "W");
  Object.assign(find(state, "N")!, { sect: "camarilla", capacity: 9, blood: 3 });
  seatOf(state, "Alice").hand.push({ id: "c9", name: card });
  const tf = state.frames[0]!;
  if (tf.kind === "turn") tf.phase = "minion";
  return { state, engine: new VtesEngine(state, testRegistry) };
}

/**
 * Announce the political action, pass the impulses, vote FOR with the caller,
 * and answer every per-seat choice by taking `pick(seat)`.
 */
function callAndAnswer(
  engine: VtesEngine,
  state: GameState,
  playPrefix: string,
  pick: (seat: string) => string,
  limit = 60,
): void {
  const id = optionIds(engine).find((o) => o.startsWith(playPrefix));
  if (!id) throw new Error(`${playPrefix} not offered`);
  engine.choose(id);
  for (let i = 0; i < limit; i++) {
    if (state.frames.every((f) => f.kind === "turn")) return;
    const dp = engine.decision();
    if (!dp) return;
    const want = pick(dp.seat);
    const chosen =
      dp.options.find((o) => o.id.includes(want)) ??
      dp.options.find((o) => o.id.endsWith(":for")) ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "end");
    if (!chosen) return;
    engine.choose(chosen.id);
  }
}

// ---------------------------------------------------------------------------

describe("Ancient Influence (100064) — gain your OWN capacity, then pay 5", () => {
  it("pays each Methuselah their chosen vampire's capacity and charges 5 flat", () => {
    const { state, engine } = game("Ancient Influence");
    const pools = { Alice: seatOf(state, "Alice").pool, Bob: seatOf(state, "Bob").pool, Carol: seatOf(state, "Carol").pool };
    callAndAnswer(engine, state, "play:Ancient Influence", (seat) =>
      seat === "Alice" ? "tableVampireChoice:V1" : seat === "Bob" ? "tableVampireChoice:W" : "tableVampireChoice:N",
    );
    // Alice +6−5 = +1, Bob +4−5 = −1, Carol +9−5 = +4. Three different answers
    // from one card, which is what makes a mis-read seat visible.
    expect(seatOf(state, "Alice").pool - pools.Alice).toBe(1);
    expect(seatOf(state, "Bob").pool - pools.Bob).toBe(-1);
    expect(seatOf(state, "Carol").pool - pools.Carol).toBe(4);
  });

  it("a seat that chooses NOBODY still burns the 5", () => {
    const { state, engine } = game("Ancient Influence");
    const before = seatOf(state, "Bob").pool;
    callAndAnswer(engine, state, "play:Ancient Influence", (seat) =>
      seat === "Bob" ? "tableVampireChoice:none" : "tableVampireChoice:",
    );
    expect(seatOf(state, "Bob").pool - before).toBe(-5);
  });

  it("ONCE IN A GAME: a second copy is not playable", () => {
    const { state, engine } = game("Ancient Influence");
    seatOf(state, "Alice").hand.push({ id: "c9b", name: "Ancient Influence" });
    callAndAnswer(engine, state, "play:Ancient Influence", () => "tableVampireChoice:");
    // Back in Alice's minion phase with a second copy in hand and a second
    // vampire to call it with.
    const v2 = makeMinion("V2", "Alice", { title: "prince", capacity: 5, blood: 3 });
    seatOf(state, "Alice").minions.push(v2);
    expect(optionIds(engine).some((o) => o.startsWith("play:Ancient Influence"))).toBe(false);
  });
});

describe("Reins of Power (101591) — the mirror: gain 6, pay your PREDATOR's pick", () => {
  it("charges each seat the capacity their PREDATOR chose, not their own", () => {
    const { state, engine } = game("Reins of Power");
    const pools = { Alice: seatOf(state, "Alice").pool, Bob: seatOf(state, "Bob").pool, Carol: seatOf(state, "Carol").pool };
    callAndAnswer(engine, state, "play:Reins of Power", (seat) =>
      seat === "Alice" ? "tableVampireChoice:V1" : seat === "Bob" ? "tableVampireChoice:W" : "tableVampireChoice:N",
    );
    // Alice's predator is Carol (chose 9): +6−9 = −3.
    // Bob's predator is Alice (chose 6):  +6−6 =  0.
    // Carol's predator is Bob (chose 4):  +6−4 = +2.
    // Every number differs from the Ancient Influence case above on the same
    // board, which is the assertion that the two cards did not swap.
    expect(seatOf(state, "Alice").pool - pools.Alice).toBe(-3);
    expect(seatOf(state, "Bob").pool - pools.Bob).toBe(0);
    expect(seatOf(state, "Carol").pool - pools.Carol).toBe(2);
  });

  it("a predator who chooses NOBODY charges nothing, so the 6 is clear profit", () => {
    const { state, engine } = game("Reins of Power");
    const before = seatOf(state, "Bob").pool;
    // Bob's predator is Alice.
    callAndAnswer(engine, state, "play:Reins of Power", (seat) =>
      seat === "Alice" ? "tableVampireChoice:none" : "tableVampireChoice:",
    );
    expect(seatOf(state, "Bob").pool - before).toBe(6);
  });
});

describe("the block-toll twins — one sect apart", () => {
  it("Camarilla Exemplary offers only CAMARILLA vampires as terms", () => {
    const { state, engine } = game("Camarilla Exemplary");
    const id = optionIds(engine).find((o) => o.startsWith("play:Camarilla Exemplary"));
    expect(id, "not offered to the Camarilla caller").toBeDefined();
    engine.choose(id!);
    // Walk to the terms.
    for (let i = 0; i < 12; i++) {
      const ids = optionIds(engine);
      if (ids.some((o) => o.startsWith("terms:"))) break;
      const pass = engine.decision()?.options.find((o) => o.id === "pass");
      if (!pass) break;
      engine.choose(pass.id);
    }
    const terms = optionIds(engine).filter((o) => o.startsWith("terms:"));
    // V1 and N are Camarilla; Bob's W is Sabbat and is not a legal choice.
    expect(terms.some((o) => o.includes("V1"))).toBe(true);
    expect(terms.some((o) => o.includes("N"))).toBe(true);
    expect(terms.some((o) => o.includes("W"))).toBe(false);
  });

  it("puts the card on the chosen vampire, and blockers then burn 1 blood", () => {
    const { state, engine } = game("Camarilla Exemplary");
    callAndAnswer(engine, state, "play:Camarilla Exemplary", () => "terms:N");
    const n = find(state, "N")!;
    expect(n.attached.map((p) => p.card.name)).toContain("Camarilla Exemplary");
    expect(n.attached.find((p) => p.card.name === "Camarilla Exemplary")!.statics.blockToll)
      .toEqual({ amount: 1, payWith: "blood" });
  });

  it("Sabbat Priest is the same card one sect over: only SABBAT vampires", () => {
    const state = threeSeatGame();
    // The caller must be Sabbat this time, which is the whole difference.
    Object.assign(find(state, "V1")!, { title: "prince", sect: "sabbat", capacity: 6, blood: 4 });
    Object.assign(find(state, "W")!, { sect: "sabbat", capacity: 4, blood: 2 });
    Object.assign(find(state, "N")!, { sect: "camarilla", capacity: 9, blood: 3 });
    seatOf(state, "Alice").hand.push({ id: "sp", name: "Sabbat Priest" });
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "minion";
    const engine = new VtesEngine(state, testRegistry);

    const id = optionIds(engine).find((o) => o.startsWith("play:Sabbat Priest"));
    expect(id, "not offered to the Sabbat caller").toBeDefined();
    engine.choose(id!);
    for (let i = 0; i < 12; i++) {
      const ids = optionIds(engine);
      if (ids.some((o) => o.startsWith("terms:"))) break;
      const pass = engine.decision()?.options.find((o) => o.id === "pass");
      if (!pass) break;
      engine.choose(pass.id);
    }
    const terms = optionIds(engine).filter((o) => o.startsWith("terms:"));
    expect(terms.some((o) => o.includes("V1"))).toBe(true);
    expect(terms.some((o) => o.includes("W"))).toBe(true);
    // Carol's Camarilla vampire is not a Sabbat priest.
    expect(terms.some((o) => o.includes("N"))).toBe(false);
  });

  it("NEGATIVE SPACE: neither card is playable by the other's sect", () => {
    // The Camarilla card in a Sabbat caller's hand, and the reverse.
    const cam = game("Camarilla Exemplary");
    Object.assign(find(cam.state, "V1")!, { sect: "sabbat" });
    const camEngine = new VtesEngine(cam.state, testRegistry);
    expect(optionIds(camEngine).some((o) => o.startsWith("play:Camarilla Exemplary"))).toBe(false);

    const sab = game("Sabbat Priest");
    // V1 is Camarilla in the shared fixture.
    expect(optionIds(sab.engine).some((o) => o.startsWith("play:Sabbat Priest"))).toBe(false);
  });
});

describe("the fixture itself", () => {
  it("the three capacities are distinct, or none of the above proves anything", () => {
    const { state } = game("Ancient Influence");
    const caps = ["V1", "W", "N"].map((id) => find(state, id)!.capacity);
    expect(new Set(caps).size).toBe(3);
    void runTrace;
  });
});
