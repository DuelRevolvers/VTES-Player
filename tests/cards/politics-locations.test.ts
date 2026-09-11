/**
 * Locations that buy votes (docs/politics-locations-design.md).
 *
 * Elysium: The Palace of Versailles (100632), Ferraille (100722), New
 * Carthage (101277), Día de los Muertos (100541), Black Forest Base
 * (100165).
 *
 * New Carthage retires a deferral that had already expired: it was
 * deferred for want of "per-minion vote counting", which `pollingOptions`
 * has done since Saulot's Guiding Wisdom.
 */

import { describe, expect, it } from "vitest";
import type {
  GameState,
  MinionState,
  PermanentAura,
  PermanentInPlay,
  ReferendumFrame,
} from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function must(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function location(
  id: string,
  name: string,
  extra: Partial<PermanentInPlay> = {},
): PermanentInPlay {
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["location"],
    ...extra,
  };
}

/** Alice calls a referendum with Kine Resources Contested and stops in the
 *  polling step. `V1` is the caller. */
function inPolling(tweak: (s: GameState) => void = () => {}): {
  state: GameState;
  engine: VtesEngine;
} {
  const state = threeSeatGame();
  Object.assign(must(state, "V1"), { title: "prince", sect: "camarilla", blood: 4 });
  state.seats[0]!.hand.push({ id: "kr", name: "Kine Resources Contested" });
  tweak(state);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "play:Kine Resources Contested:basic:V1:kr"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state C → referendum
  ]);
  return { state, engine };
}

function referendum(state: GameState): ReferendumFrame {
  const f = state.frames.find((x) => x.kind === "referendum");
  if (!f || f.kind !== "referendum") throw new Error("no referendum");
  return f;
}

/** Walk to the polling step, answering terms with the first option. */
function toPolling(engine: VtesEngine, state: GameState): void {
  for (let i = 0; i < 10; i++) {
    if (referendum(state).step === "polling") return;
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, dp.options[0]!.id]]);
  }
}

/** Pass everything until the acting seat reaches its minion phase. */
function toMinionPhase(engine: VtesEngine, state: GameState): void {
  for (let i = 0; i < 20; i++) {
    const tf = state.frames[0];
    if (tf?.kind === "turn" && tf.phase === "minion") return;
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

/** Option ids offered to the seat currently being asked. */
function offered(engine: VtesEngine): string[] {
  return (engine.decision()?.options ?? []).map((o) => o.id);
}

describe("Elysium: The Palace of Versailles (100632)", () => {
  const setup = (s: GameState): void => {
    s.seats[0]!.permanents.push(location("L1", "Elysium: The Palace of Versailles"));
    s.seats[0]!.minions.push(
      makeMinion("V2", "Alice", { title: "primogen", sect: "camarilla" }),
      makeMinion("V3", "Alice", { sect: "camarilla" }), // untitled
      makeMinion("V4", "Alice", { title: "baron", sect: "anarch" }), // wrong sect
    );
  };

  it("grants +1 vote per TITLED Camarilla you control, and locks", () => {
    const { state, engine } = inPolling(setup);
    toPolling(engine, state);
    // V1 (prince) and V2 (primogen) qualify; V3 is untitled, V4 is Anarch.
    expect(offered(engine)).toContain("ability:Elysium: The Palace of Versailles:L1:votes");
    const dp = engine.decision()!;
    const opt = dp.options.find((o) => o.id.startsWith("ability:Elysium"))!;
    expect(opt.label).toContain("+2 votes");
    runTrace(engine, [["Alice", opt.id]]);
    expect(referendum(state).voteGrants["Alice"]).toBe(2);
    expect(state.seats[0]!.permanents[0]!.locked).toBe(true);
  });

  it("is not offered when no titled Camarilla qualifies", () => {
    const { state, engine } = inPolling((s) => {
      s.seats[0]!.permanents.push(location("L1", "Elysium: The Palace of Versailles"));
      // The caller is Anarch, so nothing of Alice's is a titled Camarilla.
      Object.assign(must(s, "V1"), { sect: "anarch", title: "baron" });
    });
    toPolling(engine, state);
    expect(offered(engine).some((i) => i.startsWith("ability:Elysium"))).toBe(false);
  });
});

describe("Ferraille (100722)", () => {
  const setup = (s: GameState): void => {
    s.seats[0]!.permanents.push(location("L1", "Ferraille", { tags: [] }));
  };

  it("burns 1 pool for +3 votes, and does NOT lock", () => {
    const { state, engine } = inPolling(setup);
    toPolling(engine, state);
    const pool = state.seats[0]!.pool;
    const opt = engine.decision()!.options.find((o) => o.id.startsWith("ability:Ferraille"))!;
    expect(opt.label).toContain("burn 1 pool for +3 votes");
    runTrace(engine, [["Alice", opt.id]]);
    expect(referendum(state).voteGrants["Alice"]).toBe(3);
    expect(state.seats[0]!.pool).toBe(pool - 1);
    expect(state.seats[0]!.permanents[0]!.locked).toBe(false);
  });

  it("is once each turn", () => {
    const { state, engine } = inPolling(setup);
    toPolling(engine, state);
    runTrace(engine, [["Alice", "ability:Ferraille:L1:votes"]]);
    expect(offered(engine).some((i) => i.startsWith("ability:Ferraille"))).toBe(false);
    expect(state.seats[0]!.permanents[0]!.usedThisTurn).toBe(true);
  });

  it("is still offered at exactly 1 pool — the boundary", () => {
    // The unaffordable case cannot arise for this card: a Methuselah at 0
    // pool is ousted, so 1 is the lowest a live seat can hold. The gate
    // exists for a future grant with a larger price.
    const { state, engine } = inPolling((s) => {
      setup(s);
      s.seats[0]!.pool = 1;
    });
    toPolling(engine, state);
    expect(offered(engine).some((i) => i.startsWith("ability:Ferraille"))).toBe(true);
  });

  it("works in ANOTHER Methuselah's referendum", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    Object.assign(must(state, "W"), { title: "prince", sect: "camarilla", blood: 4 });
    state.seats[1]!.hand.push({ id: "kr", name: "Kine Resources Contested" });
    state.seats[0]!.permanents.push(location("L1", "Ferraille", { tags: [] }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Bob", "play:Kine Resources Contested:basic:W:kr"],
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"],
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"],
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"],
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"],
    ]);
    toPolling(engine, state);
    // Step round to Alice, who holds the card.
    for (let i = 0; i < 4; i++) {
      const dp = engine.decision()!;
      if (dp.seat === "Alice") break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(offered(engine).some((i) => i.startsWith("ability:Ferraille"))).toBe(true);
  });
});

describe("New Carthage (101277)", () => {
  const auras: PermanentAura[] = [
    { scope: "global", clan: "Brujah", titledOnly: true, bleed: 1, votes: 1 },
    { scope: "global", clan: "Ventrue", votes: -1 },
  ];

  it("a titled Brujah casts one MORE vote than their title", () => {
    const { state, engine } = inPolling((s) => {
      s.seats[0]!.permanents.push(location("L1", "New Carthage", { auras }));
      Object.assign(must(s, "V1"), { clan: "Brujah", title: "primogen" });
    });
    toPolling(engine, state);
    // primogen = 1 vote, +1 from the aura.
    const opt = engine.decision()!.options.find((o) => o.id === "vote:V1:for")!;
    expect(opt.label).toContain("2 votes");
    void state;
  });

  it("an UNTITLED Brujah is still not a vote source", () => {
    const { state, engine } = inPolling((s) => {
      s.seats[0]!.permanents.push(location("L1", "New Carthage", { auras }));
      s.seats[0]!.minions.push(makeMinion("B2", "Alice", { clan: "Brujah" }));
    });
    toPolling(engine, state);
    expect(offered(engine).some((i) => i.startsWith("vote:B2:"))).toBe(false);
  });

  it("it is GLOBAL: another Methuselah's Ventrue loses a vote too", () => {
    const { state, engine } = inPolling((s) => {
      s.seats[0]!.permanents.push(location("L1", "New Carthage", { auras }));
      Object.assign(must(s, "W"), { clan: "Ventrue", title: "prince" }); // Bob's
    });
    toPolling(engine, state);
    // Step round to Bob.
    for (let i = 0; i < 4; i++) {
      const dp = engine.decision()!;
      if (dp.seat === "Bob") break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    const opt = engine.decision()!.options.find((o) => o.id === "vote:W:for")!;
    expect(opt.label).toContain("1 vote"); // prince 2, minus 1
    void state;
  });

  it("clamps at zero: a Ventrue primogen is not a vote source, and never votes against", () => {
    const { state, engine } = inPolling((s) => {
      s.seats[0]!.permanents.push(location("L1", "New Carthage", { auras }));
      Object.assign(must(s, "W"), { clan: "Ventrue", title: "primogen" });
    });
    toPolling(engine, state);
    for (let i = 0; i < 4; i++) {
      const dp = engine.decision()!;
      if (dp.seat === "Bob") break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(offered(engine).some((i) => i.startsWith("vote:W:"))).toBe(false);
  });

  it("also grants the titled Brujah +1 bleed", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(location("L1", "New Carthage", { auras }));
    Object.assign(must(state, "V1"), { clan: "Brujah", title: "primogen" });
    const engine = new VtesEngine(state, testRegistry);
    const bobPool = state.seats[1]!.pool;
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.seats[1]!.pool).toBe(bobPool - 2);
  });
});

describe("Día de los Muertos (100541)", () => {
  /** Alice's master phase with the card in hand. */
  function masterPhase(tweak: (s: GameState) => void = () => {}): GameState {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    state.seats[0]!.hand.push({ id: "dm", name: "Día de los Muertos" });
    tweak(state);
    return state;
  }

  it("a Sabbat vampire's referendum passes with no polling step at all", () => {
    const state = masterPhase((s) => {
      Object.assign(must(s, "V1"), { sect: "sabbat", title: "bishop", blood: 4 });
      s.seats[0]!.hand.push({ id: "kr", name: "Kine Resources Contested" });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Día de los Muertos:-:dm"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    expect(state.seats[0]!.autoPassReferendum).toEqual({ sect: "sabbat", thisTurnOnly: true });
    toMinionPhase(engine, state);
    runTrace(engine, [
      ["Alice", "play:Kine Resources Contested:basic:V1:kr"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // Terms are still chosen (the card skips only the POLLING step).
    const dp = engine.decision()!;
    expect(dp.window).toBe("referendum.terms");
    runTrace(engine, [["Alice", dp.options[0]!.id]]);
    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved");
    expect(resolved).toMatchObject({ passed: true, votesFor: 0, votesAgainst: 0 });
    // Nobody ever voted.
    expect(state.eventLog.some((e) => e.type === "VoteCast")).toBe(false);
    // Consumed — the grant is a record now, and spending it removes it.
    expect(state.seats[0]!.autoPassReferendum).toBeUndefined();
  });

  it("a NON-Sabbat caller polls as normal", () => {
    const state = masterPhase((s) => {
      Object.assign(must(s, "V1"), { sect: "camarilla", title: "prince", blood: 4 });
      s.seats[0]!.hand.push({ id: "kr", name: "Kine Resources Contested" });
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Día de los Muertos:-:dm"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    toMinionPhase(engine, state);
    runTrace(engine, [
      ["Alice", "play:Kine Resources Contested:basic:V1:kr"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    toPolling(engine, state);
    expect(referendum(state).step).toBe("polling");
    expect(referendum(state).autoPass ?? false).toBe(false);
    // The flag is still armed: it was never spent by a non-Sabbat caller.
    expect(state.seats[0]!.autoPassReferendum).toEqual({ sect: "sabbat", thisTurnOnly: true });
  });

  it("only one can be played in a game, even after the first has resolved", () => {
    const state = masterPhase((s) => {
      const tf = s.frames[0]!;
      if (tf.kind === "turn") tf.masterActionsLeft = 2;
      s.seats[0]!.hand.push({ id: "dm2", name: "Día de los Muertos" });
    });
    const engine = new VtesEngine(state, testRegistry);
    expect(offered(engine).filter((i) => i.startsWith("play:Día de los Muertos"))).toHaveLength(
      2,
    );
    runTrace(engine, [
      ["Alice", "play:Día de los Muertos:-:dm"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(offered(engine).some((i) => i.startsWith("play:Día de los Muertos"))).toBe(false);
    expect(state.seats[0]!.hand.some((c) => c.id === "dm2")).toBe(true);
  });
});

describe("Black Forest Base (100165)", () => {
  const setup = (s: GameState): void => {
    s.seats[0]!.permanents.push(location("L1", "Black Forest Base"));
    Object.assign(must(s, "V1"), { sect: "sabbat", blood: 4 });
  };

  it("a Sabbat vampire calls a referendum that pays its caller 2 pool", () => {
    const state = threeSeatGame();
    setup(state);
    const engine = new VtesEngine(state, testRegistry);
    const pool = state.seats[0]!.pool;
    expect(offered(engine)).toContain("act:Black Forest Base:L1:referendum:V1");
    runTrace(engine, [
      ["Alice", "act:Black Forest Base:L1:referendum:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state C
    ]);
    // Undirected political action, +1 stealth (p. 24).
    expect(
      state.eventLog.some((e) => e.type === "StealthModified" && e.delta === 1),
    ).toBe(true);
    // Polling: Alice votes with the calling card, nobody opposes.
    toPolling(engine, state);
    runTrace(engine, [["Alice", "vote:caller:for"]]);
    for (let i = 0; i < 8; i++) {
      if (!state.frames.some((f) => f.kind === "referendum")) break;
      const dp = engine.decision()!;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(state.seats[0]!.pool).toBe(pool + 2);
  });

  it("is once each turn, and only for a Sabbat vampire", () => {
    const state = threeSeatGame();
    setup(state);
    state.seats[0]!.minions.push(makeMinion("C1", "Alice", { sect: "camarilla" }));
    const engine = new VtesEngine(state, testRegistry);
    const ids = offered(engine).filter((i) => i.startsWith("act:Black Forest Base"));
    expect(ids).toEqual(["act:Black Forest Base:L1:referendum:V1"]);
    runTrace(engine, [["Alice", "act:Black Forest Base:L1:referendum:V1"]]);
    expect(state.seats[0]!.permanents[0]!.usedThisTurn).toBe(true);
  });

  it("requires a ready Sabbat vampire to play at all", () => {
    const build = (sect: string): GameState => {
      const s = threeSeatGame();
      const tf = s.frames[0]!;
      if (tf.kind === "turn") {
        tf.phase = "master";
        tf.masterActionsLeft = 1;
      }
      s.seats[0]!.hand.push({ id: "b", name: "Black Forest Base" });
      must(s, "V1").sect = sect as MinionState["sect"];
      return s;
    };
    const cam = new VtesEngine(build("camarilla"), testRegistry);
    expect(offered(cam).some((i) => i.startsWith("play:Black Forest Base"))).toBe(false);
    const sab = new VtesEngine(build("sabbat"), testRegistry);
    expect(offered(sab).some((i) => i.startsWith("play:Black Forest Base"))).toBe(true);
  });

  it("the changeling clause offers nothing — no V5 ally carries that tag", () => {
    const state = threeSeatGame();
    setup(state);
    // An ordinary ally is not a changeling, so the burn action is absent.
    state.seats[1]!.minions.push(
      makeMinion("A1", "Bob", { kind: "ally", blood: 2, disciplines: {} }),
    );
    const engine = new VtesEngine(state, testRegistry);
    const all: string[] = [];
    for (const seat of ["Alice", "Bob", "Carol"]) {
      void seat;
    }
    all.push(...offered(engine));
    expect(all.some((i) => i.includes("Black Forest Base") && i.includes(":burn:"))).toBe(
      false,
    );
  });
});
