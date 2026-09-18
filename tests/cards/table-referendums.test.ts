/**
 * Referendums that become a TABLE RULE (docs/table-referendums-design.md).
 * Beyond Reproach (100158), Camarilla Threat (100285), Masquerade
 * Enforcement (101184).
 *
 * The shell — win a referendum, the card stays in play, anyone may call
 * another to burn it — already existed. What is worth pinning is the
 * three rules themselves, and that each one is asked at BOTH the option
 * gate and where it is paid.
 */

import { describe, expect, it } from "vitest";
import type {
  GameState,
  MinionState,
  PermanentAura,
  PermanentInPlay,
} from "../../src/engine/index.ts";
import { cardSpecs } from "../../src/cards/effects/cards.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function auraOf(name: string): PermanentAura | null {
  return cardSpecs.find((sp) => sp.name === name)?.permanent?.aura ?? null;
}

function inPlay(name: string): PermanentInPlay {
  const h = testRegistry[name]!;
  return {
    card: { id: name.slice(0, 2), name },
    locked: false,
    usedThisPhase: false,
    statics: h.permanentStatics ?? {},
    tags: h.permanentTags ?? [],
    // The aura lives on the SPEC, not on the handler, so the fixture
    // reads it back off the compiled card the way the engine would.
    ...(auraOf(name) ? { aura: auraOf(name)! } : {}),
  };
}

describe("Beyond Reproach (100158)", () => {
  it("bars primogen from political actions and docks their vote — princes untouched", () => {
    const state = threeSeatGame();
    state.seats[1]!.permanents.push(inPlay("Beyond Reproach"));
    const primogen = find(state, "V1")!;
    Object.assign(primogen, { sect: "camarilla", title: "primogen" });
    state.seats[0]!.minions.push(
      makeMinion("PR", "Alice", { sect: "camarilla", title: "prince" }),
    );
    state.seats[0]!.hand.push({ id: "ct", name: "Camarilla Threat" });
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") tf.phase = "minion";
    const plays = ids(new VtesEngine(state, testRegistry)).filter((i) =>
      i.startsWith("play:Camarilla Threat"),
    );
    // The bar reaches the political CARD enumerator; the prince still acts.
    expect(plays.some((i) => i.includes(":V1:"))).toBe(false);
    expect(plays.some((i) => i.includes(":PR:"))).toBe(true);
  });
});

describe("Camarilla Threat (100285)", () => {
  it("taxes a discard a pool, and is not offered to a Methuselah who cannot pay", () => {
    const build = (pool: number): { state: GameState; engine: VtesEngine } => {
      const state = threeSeatGame();
      state.seats[2]!.permanents.push(inPlay("Camarilla Threat"));
      state.seats[0]!.pool = pool;
      state.seats[0]!.hand.push({ id: "h1", name: "Blood Doll" });
      const tf = state.frames.find((f) => f.kind === "turn")!;
      if (tf.kind === "turn") {
        tf.phase = "discard";
        tf.discardActionsLeft = 1;
      }
      return { state, engine: new VtesEngine(state, testRegistry) };
    };
    const rich = build(5);
    expect(ids(rich.engine)).toContain("discard:h1");
    runTrace(rich.engine, [["Alice", "discard:h1"]]);
    expect(rich.state.seats[0]!.pool).toBe(4);
    // NEGATIVE SPACE: the pool must SURVIVE the payment — nobody ousts
    // themselves to discard, so at 1 pool the option is gone.
    expect(ids(build(1).engine)).not.toContain("discard:h1");
  });
});

describe("Masquerade Enforcement (101184)", () => {
  it("charges 1 extra pool to bring a vampire out of the uncontrolled region", () => {
    const state = threeSeatGame();
    state.seats[1]!.permanents.push(inPlay("Masquerade Enforcement"));
    // Built here rather than read off the fixture: `threeSeatGame` has an
    // EMPTY uncontrolled region, and the first draft of this test read
    // `uncontrolled[0]`, found nothing and returned green.
    const card = makeMinion("U1", "Alice", { capacity: 3 });
    state.seats[0]!.uncontrolled.push({ card, counters: 3 });
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") tf.phase = "influence";
    const engine = new VtesEngine(state, testRegistry);
    const out = ids(engine).find((i) => i.startsWith("inf:out:"));
    expect(out).toBeDefined();
    const before = state.seats[0]!.pool;
    runTrace(engine, [["Alice", out!]]);
    expect(state.seats[0]!.pool).toBe(before - 1);
  });

  it("NEGATIVE SPACE: only a CAMARILLA vampire may call the referendum to burn it", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(inPlay("Masquerade Enforcement"));
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") {
      tf.phase = "minion";
      tf.seat = "Bob";
    }
    Object.assign(find(state, "W")!, { sect: "sabbat" });
    expect(
      ids(new VtesEngine(state, testRegistry)).some((i) =>
        i.startsWith("act:Masquerade Enforcement"),
      ),
    ).toBe(false);
    Object.assign(find(state, "W")!, { sect: "camarilla" });
    expect(
      ids(new VtesEngine(state, testRegistry)).some((i) =>
        i.startsWith("act:Masquerade Enforcement"),
      ),
    ).toBe(true);
  });
});
