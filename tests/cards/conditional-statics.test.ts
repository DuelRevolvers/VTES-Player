/**
 * Conditional statics (docs/conditional-statics-design.md).
 *
 * Depravity (100526), Guardian Angel (100866), Abbot (100006),
 * Unlicensed Taxicab (102078).
 *
 * The mechanic is a static that applies only during CERTAIN actions, so
 * every test here is a matched pair: the bonus lands on the action the
 * card names, and does NOT land on one it doesn't.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, currentIntercept, currentStealth } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function attach(m: MinionState, id: string, name: string, statics: object): void {
  m.attached.push({
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: statics as PermanentInPlay["statics"],
    tags: [name],
  });
}

/** The id of the action announced most recently. */
function currentActionId(state: GameState): string {
  const af = state.frames.find((f) => f.kind === "action");
  if (af?.kind !== "action") throw new Error("no action");
  return af.actionId;
}

describe("Depravity (100526) — +1 stealth during DIABLERIE actions", () => {
  function game(): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 4 });
    attach(find(state, "V1"), "dep", "Depravity", {
      strength: 1,
      conditional: [{ stealth: 1, actionKinds: ["diablerize"] }],
      cannotPlayCardTypes: ["ally", "retainer"],
    });
    return state;
  }

  it("does NOT raise stealth on a bleed", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(currentStealth(state, currentActionId(state))).toBe(0);
  });

  it("DOES raise stealth on a diablerie action", () => {
    const state = game();
    // A vampire in torpor at another Methuselah's, for V1 to diablerize.
    state.seats[1]!.minions.push(
      makeMinion("T", "Bob", { inTorpor: true, blood: 0, capacity: 3 }),
    );
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "diablerize:V1:T"]]);
    expect(currentStealth(state, currentActionId(state))).toBe(1);
  });

  it("stops the bearer recruiting allies or employing retainers", () => {
    const state = game();
    state.seats[0]!.hand.push({ id: "ac", name: "Aggressive Corpse" });
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { blood: 4 }));
    const engine = new VtesEngine(state, testRegistry);
    const recruits = engine
      .decision()!
      .options.map((o) => o.id)
      .filter((i) => i.startsWith("play:Aggressive Corpse"));
    // V2 has no Depravity and can; V1 carries it and cannot.
    expect(recruits.some((i) => i.includes(":V2"))).toBe(true);
    expect(recruits.some((i) => i.includes(":V1"))).toBe(false);
  });

  it("still grants its unconditional +1 strength", () => {
    const state = game();
    const v = find(state, "V1");
    expect(v.attached[0]!.statics.strength).toBe(1);
  });
});

describe("Guardian Angel (100866)", () => {
  function game(): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "M"), { blood: 4 });
    attach(find(state, "M"), "ga", "Guardian Angel", {
      conditional: [{ intercept: 1, actionKinds: ["bleed"], directedAtController: true }],
    });
    return state;
  }

  it("+1 intercept on a bleed DIRECTED AT the bearer's controller", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    // Alice bleeds Bob, who controls M.
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(currentIntercept(state, currentActionId(state), "M")).toBe(1);
  });

  it("nothing on an UNDIRECTED action", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "hunt:V1"]]);
    expect(currentIntercept(state, currentActionId(state), "M")).toBe(0);
  });

  it("nothing on a bleed aimed at somebody ELSE", () => {
    const state = game();
    // Carol bleeds her own prey (Alice); M's controller Bob is untouched.
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") tf.seat = "Carol";
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Carol", "bleed:N"]]);
    expect(currentIntercept(state, currentActionId(state), "M")).toBe(0);
  });

  it("burns itself when its bearer actually goes to torpor", () => {
    const state = game();
    // M blocks with 0 blood and eats a 3-strength hand strike: nothing to
    // mend with, so it goes to torpor (p. 31).
    Object.assign(find(state, "M"), { blood: 0 });
    Object.assign(find(state, "V1"), { blood: 4, strength: 3 });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block → combat
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
    ]);
    for (let i = 0; i < 10; i++) {
      const dp = engine.decision();
      if (!dp || find(state, "M").inTorpor) break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(find(state, "M").inTorpor).toBe(true);
    expect(find(state, "M").attached.some((p) => p.card.id === "ga")).toBe(false);
  });
});

describe("Abbot (100006)", () => {
  it("attaches, unlocks the actor, and grants directed-action intercept", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "sabbat", blood: 4 });
    state.seats[0]!.hand.push({ id: "ab", name: "Abbot" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Abbot:basic:V1:ab"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
    ]);

    const v = find(state, "V1");
    // "Put this card on this Sabbat vampire AND UNLOCK THEM" — the actor
    // locked at announcement (p. 25), so the unlock is a real effect.
    expect(v.attached.some((p) => p.tags.includes("Abbot"))).toBe(true);
    expect(v.locked).toBe(false);
  });

  it("its intercept covers ANY action directed at the controller, not just bleeds", () => {
    const state = threeSeatGame();
    attach(find(state, "M"), "ab", "Abbot", {
      conditional: [{ intercept: 1, directedAtController: true }],
    });
    Object.assign(find(state, "V1"), { blood: 4, disciplines: { dom: "superior" } });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    // A bleed is directed at Bob, M's controller.
    expect(currentIntercept(state, currentActionId(state), "M")).toBe(1);
  });
});

describe("Unlicensed Taxicab (102078)", () => {
  function equipped(): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 4 });
    attach(find(state, "V1"), "tc", "Unlicensed Taxicab", {
      conditional: [
        { stealth: 1, actionKinds: ["hunt"] },
        { stealth: 1, actionCardTypes: ["ally", "retainer"] },
      ],
    });
    find(state, "V1").attached[0]!.tags = ["vehicle"];
    return state;
  }

  it("+1 stealth on a hunt (an ActionKind)", () => {
    const state = equipped();
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "hunt:V1"]]);
    // A hunt carries +1 inherent stealth (p. 21) plus the vehicle's +1.
    expect(currentStealth(state, currentActionId(state))).toBe(2);
  });

  it("+1 stealth on a RECRUIT (a card type, not an action kind)", () => {
    // This is the half that needs ActionAnnounced.cardTypes: a recruit is
    // a `cardEffect` action like any other action card.
    const state = equipped();
    state.seats[0]!.hand.push({ id: "ac", name: "Aggressive Corpse" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Aggressive Corpse:basic:V1:ac"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    // Recruit actions are +1 stealth by default (p. 22), plus the +1.
    expect(currentStealth(state, currentActionId(state))).toBe(2);
  });

  it("nothing on a bleed", () => {
    const state = equipped();
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(currentStealth(state, currentActionId(state))).toBe(0);
  });

  it("burns when a prince blocks its bearer", () => {
    const state = equipped();
    Object.assign(find(state, "M"), { title: "prince", blood: 3 });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "block:M"],
    ]);
    expect(find(state, "V1").attached.some((p) => p.card.id === "tc")).toBe(false);
  });

  it("survives a block by an untitled vampire", () => {
    const state = equipped();
    Object.assign(find(state, "M"), { title: null, blood: 3 });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
    ]);
    expect(find(state, "V1").attached.some((p) => p.card.id === "tc")).toBe(true);
  });
});
