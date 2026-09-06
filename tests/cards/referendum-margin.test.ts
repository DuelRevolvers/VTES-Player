/**
 * The after-referendum window and the margin
 * (docs/referendum-margin-design.md).
 *
 * Voter Captivation (102131), Amici Noctis (102274), Magnetic Authority
 * (102331).
 *
 * All three are "only usable after resolution of a political action whose
 * referendum PASSED", and two of them pay out per vote of margin — so the
 * window's own shape (opens only on a pass, only when usable) gets its own
 * assertions before the cards do.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/**
 * Alice's V1 (a prince, so 2 votes) calls Kine Resources Contested and it
 * passes unopposed. Stops at the first decision after the polling step.
 */
function passedReferendum(
  hand: Array<{ id: string; name: string }>,
  v1: Partial<MinionState> = {},
): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  // Capacity 8: BloodGained clamps at capacity, and 2 blood of margin
  // would otherwise vanish against the fixture default of 5.
  Object.assign(find(state, "V1"), { title: "prince", blood: 4, capacity: 8, ...v1 });
  state.seats[0]!.hand.push({ id: "kr", name: "Kine Resources Contested" }, ...hand);
  const engine = new VtesEngine(state, testRegistry);
  const opt = engine
    .decision()!
    .options.find((o) => o.id.startsWith("play:Kine Resources Contested"));
  if (!opt) throw new Error("no political action to play");
  runTrace(engine, [
    ["Alice", opt.id],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // blocks declined
  ]);
  // Terms (if any), then vote in favour and let the others decline.
  for (let i = 0; i < 8; i++) {
    const dp = engine.decision();
    if (!dp) break;
    if (dp.window === "referendum.polling") break;
    runTrace(engine, [[dp.seat, dp.options[0]!.id]]);
  }
  runTrace(engine, [["Alice", "vote:V1:for"]]);
  for (let i = 0; i < 8; i++) {
    const dp = engine.decision();
    if (!dp || dp.window !== "referendum.polling") break;
    runTrace(engine, [[dp.seat, "pass"]]);
  }
  return { state, engine };
}

describe("the window itself", () => {
  it("does NOT open when nobody can use it", () => {
    const { state, engine } = passedReferendum([]);
    expect(state.frames.some((f) => f.kind === "referendum")).toBe(false);
    expect(
      state.eventLog.some((e) => e.type === "ReferendumResolved" && e.passed),
    ).toBe(true);
    expect(engine.decision()!.window).not.toBe("referendum.afterResolution");
  });

  it("opens on a passed referendum, with the margin recorded", () => {
    const { state, engine } = passedReferendum([{ id: "vc", name: "Voter Captivation" }], {
      disciplines: { pre: "basic" },
    });
    const dp = engine.decision()!;
    expect(dp.window).toBe("referendum.afterResolution");
    const rf = state.frames.find((f) => f.kind === "referendum");
    if (rf?.kind !== "referendum") throw new Error("no referendum");
    // A prince voted 2 for, nobody against.
    expect(rf.margin).toBe(2);
    expect(rf.passed).toBe(true);
    // The result has NOT been announced yet — the window is before the pop.
    expect(state.eventLog.some((e) => e.type === "ReferendumResolved")).toBe(false);
  });

  it("offers no vote options — the polling step is over", () => {
    const { engine } = passedReferendum([{ id: "vc", name: "Voter Captivation" }], {
      disciplines: { pre: "basic" },
    });
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.startsWith("vote:"))).toBe(false);
  });

  it("does not open when the referendum FAILED", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), {
      title: "prince",
      blood: 4,
      disciplines: { pre: "basic" },
    });
    // Bob out-votes Alice.
    Object.assign(find(state, "W"), { title: "justicar" });
    state.seats[0]!.hand.push(
      { id: "kr", name: "Kine Resources Contested" },
      { id: "vc", name: "Voter Captivation" },
    );
    const engine = new VtesEngine(state, testRegistry);
    const opt = engine
      .decision()!
      .options.find((o) => o.id.startsWith("play:Kine Resources Contested"))!;
    runTrace(engine, [
      ["Alice", opt.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    for (let i = 0; i < 8; i++) {
      const dp = engine.decision();
      if (!dp || dp.window === "referendum.polling") break;
      runTrace(engine, [[dp.seat, dp.options[0]!.id]]);
    }
    runTrace(engine, [["Alice", "vote:V1:for"]]);
    // Playing a card or casting a vote rewinds the impulse to the caller,
    // so pass around until Bob is asked.
    for (let i = 0; i < 4; i++) {
      const d = engine.decision()!;
      if (d.seat === "Bob") break;
      runTrace(engine, [[d.seat, "pass"]]);
    }
    runTrace(engine, [["Bob", "vote:W:against"]]);
    for (let i = 0; i < 8; i++) {
      const dp = engine.decision();
      if (!dp || dp.window !== "referendum.polling") break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    // 2 for, 3 against: it failed, so the window never opens.
    expect(
      state.eventLog.some((e) => e.type === "ReferendumResolved" && !e.passed),
    ).toBe(true);
    expect(state.frames.some((f) => f.kind === "referendum")).toBe(false);
  });
});

describe("Voter Captivation (102131)", () => {
  it("basic gives the vampire 1 blood per vote of margin", () => {
    const { state, engine } = passedReferendum([{ id: "vc", name: "Voter Captivation" }], {
      disciplines: { pre: "basic" },
    });
    const blood = find(state, "V1").blood;
    runTrace(engine, [
      ["Alice", "play:Voter Captivation:basic:V1:vc"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // window closes
    ]);
    expect(find(state, "V1").blood).toBe(blood + 2);
    // …and the referendum then resolves as normal.
    expect(
      state.eventLog.some((e) => e.type === "ReferendumResolved" && e.passed),
    ).toBe(true);
  });

  it("superior offers each split of those blood between vampire and pool", () => {
    const { state, engine } = passedReferendum([{ id: "vc", name: "Voter Captivation" }], {
      disciplines: { pre: "superior" },
    });
    const ids = engine
      .decision()!
      .options.filter((o) => o.id.startsWith("play:Voter Captivation:superior"))
      .map((o) => o.id);
    // A margin of 2 and a cap of 2: move 0, 1 or 2 to pool.
    expect(ids.length).toBe(3);

    const blood = find(state, "V1").blood;
    const pool = state.seats[0]!.pool;
    runTrace(engine, [
      ["Alice", ids[2]!], // both to pool
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.seats[0]!.pool).toBe(pool + 2);
    expect(find(state, "V1").blood).toBe(blood);
  });
});

describe("Amici Noctis (102274)", () => {
  it("distributes at most 1 blood to each ready Lasombra, plus capped pool", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), {
      title: "prince",
      blood: 4,
      clan: "Lasombra",
    });
    state.seats[0]!.minions.push(
      makeMinion("A2", "Alice", { clan: "Lasombra", blood: 1 }),
      makeMinion("A3", "Alice", { clan: "Brujah", blood: 1 }), // wrong clan
    );
    state.seats[0]!.hand.push(
      { id: "kr", name: "Kine Resources Contested" },
      { id: "an", name: "Amici Noctis" },
    );
    const engine = new VtesEngine(state, testRegistry);
    const opt = engine
      .decision()!
      .options.find((o) => o.id.startsWith("play:Kine Resources Contested"))!;
    runTrace(engine, [
      ["Alice", opt.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    for (let i = 0; i < 8; i++) {
      const dp = engine.decision();
      if (!dp || dp.window === "referendum.polling") break;
      runTrace(engine, [[dp.seat, dp.options[0]!.id]]);
    }
    runTrace(engine, [["Alice", "vote:V1:for"]]);
    for (let i = 0; i < 8; i++) {
      const dp = engine.decision();
      if (!dp || dp.window !== "referendum.polling") break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }

    const dp = engine.decision()!;
    expect(dp.window).toBe("referendum.afterResolution");
    const ids = dp.options.filter((o) => o.id.startsWith("play:Amici Noctis")).map((o) => o.id);
    // The Brujah is never a recipient.
    expect(ids.every((i) => !i.includes("A3"))).toBe(true);
    // The caller is titled, so up to 2 pool — and the margin is 2, so
    // "both Lasombra" and "2 pool" are both on offer.
    expect(ids.some((i) => i.includes("V1,A2"))).toBe(true);
    expect(ids.some((i) => i.endsWith(":2:an"))).toBe(true);

    const v1 = find(state, "V1").blood;
    const a2 = find(state, "A2").blood;
    const both = ids.find((i) => i.includes("V1,A2"))!;
    runTrace(engine, [
      ["Alice", both],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(find(state, "V1").blood).toBe(v1 + 1);
    expect(find(state, "A2").blood).toBe(a2 + 1);
  });

  it("requires a Lasombra to play it at all", () => {
    const { engine } = passedReferendum([{ id: "an", name: "Amici Noctis" }], {
      clan: "Brujah",
    });
    const dp = engine.decision()!;
    // The window never opens: nobody can play the only card that wants it.
    expect(dp.window).not.toBe("referendum.afterResolution");
  });
});

describe("Magnetic Authority (102331)", () => {
  function withUncontrolled(v1: Partial<MinionState>): {
    state: GameState;
    engine: VtesEngine;
  } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { title: "prince", blood: 4, ...v1 });
    state.seats[0]!.uncontrolled.push(
      { card: makeMinion("U1", "Alice", { sect: "sabbat" }), counters: 0 },
      { card: makeMinion("U2", "Alice", { sect: "sabbat" }), counters: 1 },
      { card: makeMinion("U3", "Alice", { sect: "camarilla" }), counters: 0 },
    );
    state.seats[0]!.hand.push(
      { id: "kr", name: "Kine Resources Contested" },
      { id: "ma", name: "Magnetic Authority" },
    );
    const engine = new VtesEngine(state, testRegistry);
    const opt = engine
      .decision()!
      .options.find((o) => o.id.startsWith("play:Kine Resources Contested"))!;
    runTrace(engine, [
      ["Alice", opt.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    for (let i = 0; i < 8; i++) {
      const dp = engine.decision();
      if (!dp || dp.window === "referendum.polling") break;
      runTrace(engine, [[dp.seat, dp.options[0]!.id]]);
    }
    runTrace(engine, [["Alice", "vote:V1:for"]]);
    for (let i = 0; i < 8; i++) {
      const dp = engine.decision();
      if (!dp || dp.window !== "referendum.polling") break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    return { state, engine };
  }

  it("basic offers one option per SABBAT vampire in the uncontrolled region", () => {
    const { engine } = withUncontrolled({ disciplines: { dom: "basic" } });
    const ids = engine
      .decision()!
      .options.filter((o) => o.id.startsWith("play:Magnetic Authority:basic"))
      .map((o) => o.id);
    expect(ids.length).toBe(2);
    expect(ids.every((i) => !i.includes("U3"))).toBe(true); // Camarilla
  });

  it("basic adds 2 counters to the chosen one; superior adds 1 to each", () => {
    const { state, engine } = withUncontrolled({ disciplines: { dom: "basic" } });
    const opt = engine
      .decision()!
      .options.find((o) => o.id.includes("Magnetic Authority:basic") && o.id.includes("U1"))!;
    runTrace(engine, [
      ["Alice", opt.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const region = state.seats[0]!.uncontrolled;
    expect(region.find((u) => u.card.id === "U1")!.counters).toBe(2);
    expect(region.find((u) => u.card.id === "U2")!.counters).toBe(1);

    const sup = withUncontrolled({ disciplines: { dom: "superior" } });
    const supOpt = sup.engine
      .decision()!
      .options.find((o) => o.id.startsWith("play:Magnetic Authority:superior"))!;
    runTrace(sup.engine, [
      ["Alice", supOpt.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const r2 = sup.state.seats[0]!.uncontrolled;
    expect(r2.find((u) => u.card.id === "U1")!.counters).toBe(1);
    expect(r2.find((u) => u.card.id === "U2")!.counters).toBe(2);
    expect(r2.find((u) => u.card.id === "U3")!.counters).toBe(0);
  });
});
