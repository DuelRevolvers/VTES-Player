/**
 * Answering a bleed: redirect it, or shrink it
 * (docs/bleed-answers-design.md).
 *
 * Redirection (101578), Bait and Switch (102218), Deep Ecology (102219),
 * Visions of Zapathasura (102265).
 *
 * Most of what is worth pinning is the GATES: these cards differ from
 * Deflection and from each other only in who may play them and when.
 */

import { describe, expect, it } from "vitest";
import type { ActionFrame, GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, currentBleed } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function action(state: GameState): ActionFrame {
  const af = state.frames.find((f) => f.kind === "action");
  if (af?.kind !== "action") throw new Error("no action");
  return af;
}

/**
 * Alice's V1 bleeds Bob. Stops in state C — after blocks are declined,
 * which is where every card in this cluster except Deep Ecology's
 * intercept mode lives.
 */
function bleedDeclined(
  bobCards: Array<{ id: string; name: string }>,
  m: Partial<MinionState> = {},
  v1: Partial<MinionState> = {},
): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 4, ...v1 });
  Object.assign(find(state, "M"), { blood: 4, ...m });
  state.seats[1]!.hand.push(...bobCards);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A: declined
  ]);
  // State C opens with the ACTING seat's impulse, so pass round to Bob —
  // otherwise every assertion below reads Alice's option list.
  for (let i = 0; i < 4; i++) {
    const dp = engine.decision();
    if (!dp || dp.seat === "Bob") break;
    runTrace(engine, [[dp.seat, "pass"]]);
  }
  return { state, engine };
}

describe("Redirection (101578)", () => {
  it("basic needs the acting vampire to be YOUNGER", () => {
    // V1 capacity 5 (fixture default) vs M capacity 5 — not younger.
    const { engine } = bleedDeclined([{ id: "rd", name: "Redirection" }], {
      disciplines: { dom: "basic" },
      capacity: 5,
    });
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.startsWith("play:Redirection:basic"))).toBe(false);
  });

  it("…and is offered once it is", () => {
    const { engine } = bleedDeclined(
      [{ id: "rd", name: "Redirection" }],
      { disciplines: { dom: "basic" }, capacity: 8 },
      { capacity: 3 },
    );
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.startsWith("play:Redirection:basic"))).toBe(true);
  });

  it("superior drops the age clause", () => {
    const { engine } = bleedDeclined([{ id: "rd", name: "Redirection" }], {
      disciplines: { dom: "superior" },
      capacity: 3,
    });
    const ids = engine.decision()!.options.map((o) => o.id);
    // The actor is OLDER, so only the superior mode is on the table.
    expect(ids.some((i) => i.startsWith("play:Redirection:superior"))).toBe(true);
    expect(ids.some((i) => i.startsWith("play:Redirection:basic"))).toBe(false);
  });

  it("locks the reactor and sends the bleed to a third Methuselah", () => {
    const { state, engine } = bleedDeclined(
      [{ id: "rd", name: "Redirection" }],
      { disciplines: { dom: "superior" } },
    );
    const opt = engine
      .decision()!
      .options.find((o) => o.id.startsWith("play:Redirection:superior:M"))!;
    // Never back at the actor's own Methuselah, and never at the reactor.
    expect(opt.id).toContain("Carol");

    const bobPool = state.seats[1]!.pool;
    const carolPool = state.seats[2]!.pool;
    runTrace(engine, [
      ["Bob", opt.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    expect(action(state).target).toBe("Carol");
    expect(find(state, "M").locked).toBe(true);

    for (let i = 0; i < 12; i++) {
      const dp = engine.decision();
      if (!dp || !state.frames.some((f) => f.kind === "action")) break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(state.seats[1]!.pool).toBe(bobPool);
    expect(state.seats[2]!.pool).toBe(carolPool - 1);
  });
});

describe("Bait and Switch (102218)", () => {
  it("requires a baron, not a discipline", () => {
    const plain = bleedDeclined([{ id: "bs", name: "Bait and Switch" }]);
    expect(
      plain.engine.decision()!.options.some((o) => o.id.startsWith("play:Bait and Switch")),
    ).toBe(false);

    const baron = bleedDeclined([{ id: "bs", name: "Bait and Switch" }], {
      title: "baron",
    });
    expect(
      baron.engine.decision()!.options.some((o) => o.id.startsWith("play:Bait and Switch")),
    ).toBe(true);
  });

  it("redirects with no age clause at all", () => {
    const { state, engine } = bleedDeclined(
      [{ id: "bs", name: "Bait and Switch" }],
      { title: "baron", capacity: 2 },
      { capacity: 9 }, // a much older actor
    );
    const opt = engine
      .decision()!
      .options.find((o) => o.id.startsWith("play:Bait and Switch"))!;
    runTrace(engine, [
      ["Bob", opt.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(action(state).target).toBe("Carol");
  });
});

describe("Deep Ecology (102219)", () => {
  it("requires an Anarch", () => {
    const no = bleedDeclined([{ id: "de", name: "Deep Ecology" }], {
      disciplines: { for: "basic" },
    });
    expect(
      no.engine.decision()!.options.some((o) => o.id.startsWith("play:Deep Ecology")),
    ).toBe(false);

    const yes = bleedDeclined([{ id: "de", name: "Deep Ecology" }], {
      disciplines: { for: "basic" },
      sect: "anarch",
    });
    expect(
      yes.engine.decision()!.options.some((o) => o.id.startsWith("play:Deep Ecology")),
    ).toBe(true);
  });

  it("its [for] mode reduces the bleed by 2", () => {
    const { state, engine } = bleedDeclined([{ id: "de", name: "Deep Ecology" }], {
      disciplines: { for: "basic" },
      sect: "anarch",
    });
    const opt = engine
      .decision()!
      .options.find((o) => o.id.includes("Deep Ecology") && o.id.includes("reduce"))!;
    const pool = state.seats[1]!.pool;
    runTrace(engine, [
      ["Bob", opt.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // A bleed of 1 reduced by 2 lands as nothing.
    expect(currentBleed(state, action(state))).toBe(-1);
    for (let i = 0; i < 12; i++) {
      const dp = engine.decision();
      if (!dp || !state.frames.some((f) => f.kind === "action")) break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(state.seats[1]!.pool).toBe(pool);
  });

  /**
   * The unlock mode lives in STATE A, not state C: "unlock this vampire"
   * exists so they can then block, and the engine gates every
   * `unlockMinion` on that (Guard Dogs, Rat's Warning). So this one gets
   * its own trace rather than the after-blocks-declined helper.
   */
  function inStateA(m: Partial<MinionState>): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 4 });
    Object.assign(find(state, "M"), { blood: 4, ...m });
    state.seats[1]!.hand.push({ id: "de", name: "Deep Ecology" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], // state A opens with the acting seat
    ]);
    return { state, engine };
  }

  it("its [pro] mode is for a LOCKED vampire and costs 1 blood", () => {
    const { state, engine } = inStateA({
      disciplines: { pro: "basic" },
      sect: "anarch",
      locked: true,
      blood: 2,
    });
    const opt = engine
      .decision()!
      .options.find((o) => o.id.includes("Deep Ecology") && o.id.includes("unlock"))!;
    expect(opt).toBeDefined();

    runTrace(engine, [
      ["Bob", opt.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(find(state, "M").locked).toBe(false);
    expect(find(state, "M").blood).toBe(1);
  });

  it("…and is not offered to a locked vampire with no blood (p. 9)", () => {
    const { engine } = inStateA({
      disciplines: { pro: "basic" },
      sect: "anarch",
      locked: true,
      blood: 0,
    });
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Deep Ecology")),
    ).toBe(false);
  });
});

describe("Visions of Zapathasura (102265)", () => {
  it("basic reduces the bleed by 3", () => {
    const { state, engine } = bleedDeclined([{ id: "vz", name: "Visions of Zapathasura" }], {
      disciplines: { obf: "basic", pre: "basic" },
    });
    const opt = engine
      .decision()!
      .options.find((o) => o.id.startsWith("play:Visions of Zapathasura:basic"))!;
    runTrace(engine, [
      ["Bob", opt.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(currentBleed(state, action(state))).toBe(-2);
    expect(find(state, "M").blood).toBe(3); // the card's own 1 blood
  });

  it("superior sets it to 0 and locks the reactor — and later cards still raise it", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 4, bleedAmount: 4 });
    Object.assign(find(state, "M"), {
      blood: 4,
      disciplines: { obf: "superior", pre: "superior" },
    });
    state.seats[1]!.hand.push({ id: "vz", name: "Visions of Zapathasura" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], // state C opens with the acting seat
    ]);
    const opt = engine
      .decision()!
      .options.find((o) => o.id.startsWith("play:Visions of Zapathasura:superior:M"))!;
    runTrace(engine, [
      ["Bob", opt.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const af = action(state);
    expect(currentBleed(state, af)).toBe(0);
    expect(find(state, "M").locked).toBe(true);

    // "(The acting minion can still increase the bleed amount.)"
    engine.emit({
      type: "BleedAmountModified",
      actionId: af.actionId,
      delta: 2,
      limited: false,
      source: "test",
    });
    expect(currentBleed(state, af)).toBe(2);
  });

  it("a reduction is not '(limited)', so two of them stack", () => {
    // p. 20's one-limited-bonus rule is about a BONUS; these are played
    // by the defender and only ever reduce (design §3).
    const { state, engine } = bleedDeclined(
      [
        { id: "vz", name: "Visions of Zapathasura" },
        { id: "de", name: "Deep Ecology" },
      ],
      {
        disciplines: { obf: "basic", pre: "basic", for: "basic" },
        sect: "anarch",
        blood: 4,
      },
    );
    runTrace(engine, [
      ["Bob", "play:Visions of Zapathasura:basic:M:vz"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    // Playing a card rewinds the impulse to the acting seat (p. 8), so
    // pass round to Bob again before the second reduction.
    for (let i = 0; i < 4; i++) {
      const dp = engine.decision();
      if (!dp || dp.seat === "Bob") break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    const second = engine
      .decision()!
      .options.find((o) => o.id.includes("Deep Ecology") && o.id.includes("reduce"));
    expect(second).toBeDefined();
    runTrace(engine, [
      ["Bob", second!.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(currentBleed(state, action(state))).toBe(-4);
  });
});
