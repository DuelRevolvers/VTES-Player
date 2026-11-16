import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/engine.ts";
import type { GameState } from "../../src/engine/state.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string) {
  return state.seats.flatMap(s => s.minions).find(m => m.id === id);
}
function combat(state: GameState) {
  const cf = state.frames.find(f => f.kind === "combat");
  if (!cf || cf.kind !== "combat") throw new Error("no combat");
  return cf;
}
function inCombat(defender: "ally" | "vampire", cardSide: "acting" | "opposing" = "acting", long = false, card = "Entombment") {
  const state = threeSeatGame();
  const attacker = state.seats[0]!.minions[0]!;
  const blocker = state.seats[1]!.minions.find(m => m.id === "M")!;
  Object.assign(attacker, { blood: 5, disciplines: { obt: "superior" } });
  Object.assign(blocker, { blood: 5, disciplines: { obt: "superior", obl: "superior", pre: "basic" } });
  if (defender === "ally") {
    const a = makeAlly("A1", cardSide === "acting" ? "Bob" : "Alice", 3, { strength: 2 });
    if (cardSide === "acting") state.seats[1]!.minions = [a];
    else state.seats[0]!.minions = [a];
  }
  const player = cardSide === "acting" ? state.seats[0]! : state.seats[1]!;
  player.hand.push({ id: "entomb", name: card });
  const acting = cardSide === "opposing" && defender === "ally" ? "A1" : "V1";
  const opposing = cardSide === "acting" && defender === "ally" ? "A1" : "M";
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [["Alice", `bleed:${acting}`], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", `block:${opposing}`], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
  if (long) combat(state).maneuverCredits.acting++;
  runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ...(long ? [["Alice", "maneuver:credit"], ["Bob", "pass"], ["Alice", "pass"]] as Array<[string, string]> : [["Alice", "pass"], ["Bob", "pass"]] as Array<[string, string]>),
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
  expect(engine.decision()!.window).toBe("combat.chooseStrike");
  return { state, engine };
}
function declare(engine: VtesEngine, seat: string, mode: "basic" | "superior") {
  const opt = engine.decision()!.options.find(o => o.id.startsWith(`play:Entombment:${mode}:`));
  expect(opt).toBeDefined();
  runTrace(engine, [[seat, opt!.id], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
}
function drainCombat(engine: VtesEngine, state: GameState) {
  for (let i = 0; i < 80 && state.frames.some(f => f.kind === "combat"); i++) {
    const dp = engine.decision()!;
    engine.choose(dp.options.find(o => o.id === "pass")?.id ?? dp.options[0]!.id);
  }
}

describe("Entombment", () => {
  it("basic burns an opposing ally at close range and pays 2 blood", () => {
    const { state, engine } = inCombat("ally");
    declare(engine, "Alice", "basic");
    expect(find(state, "V1")!.blood).toBe(3);
    expect(find(state, "A1")).toBeDefined(); // strike has not resolved
    engine.choose("strike:hand");
    expect(find(state, "A1")).toBeUndefined();
    drainCombat(engine, state);
    expect(find(state, "V1")!.blood).toBe(1); // simultaneous ally strike
  });
  it("superior sends a vampire to torpor and both simultaneous strikes resolve", () => {
    const { state, engine } = inCombat("vampire");
    declare(engine, "Alice", "superior");
    engine.choose("strike:hand");
    expect(find(state, "M")!.inTorpor).toBe(true);
    drainCombat(engine, state);
    expect(find(state, "V1")!.blood).toBe(2); // cost and opposing strike
  });
  it("an ally burned by the opposing minion still lands its simultaneous strike", () => {
    const { state, engine } = inCombat("ally", "opposing");
    engine.choose("strike:hand");
    declare(engine, "Bob", "basic");
    expect(find(state, "A1")).toBeUndefined();
    drainCombat(engine, state);
    expect(find(state, "M")!.blood).toBe(1); // 5 - 2 for Entombment - 2 damage
  });
  it("also preserves a burned ally's simultaneous strike against Touch of Oblivion", () => {
    const { state, engine } = inCombat("ally", "opposing", false, "Touch of Oblivion");
    engine.choose("strike:hand");
    const play = engine.decision()!.options.find(o => o.id.startsWith("play:Touch of Oblivion:superior"))!;
    expect(play).toBeDefined();
    engine.choose(play.id);
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(find(state, "A1")).toBeUndefined();
    drainCombat(engine, state);
    expect(find(state, "M")!.blood).toBe(1);
  });
  it.each([["basic", "vampire", "M"], ["superior", "ally", "A1"]] as const)("%s does not incapacitate the wrong type", (mode, type, victim) => {
    const { state, engine } = inCombat(type);
    declare(engine, "Alice", mode);
    engine.choose("strike:hand");
    drainCombat(engine, state);
    expect(find(state, victim)).toBeDefined();
    expect(find(state, victim)!.inTorpor).toBe(false);
  });
  it("has no effect at long range but still costs blood", () => {
    const { state, engine } = inCombat("vampire", "acting", true);
    expect(combat(state).range).toBe("long");
    declare(engine, "Alice", "superior");
    engine.choose("strike:hand");
    drainCombat(engine, state);
    expect(find(state, "M")!.inTorpor).toBe(false);
    expect(find(state, "V1")!.blood).toBe(3);
  });
  it.each(["Dodge", "Majesty"])("%s prevents the strike while its cost is paid", card => {
    const { state, engine } = inCombat("vampire");
    state.seats[1]!.hand.push({ id: "def", name: card });
    declare(engine, "Alice", "superior");
    const opt = engine.decision()!.options.find(o => o.id.startsWith(`play:${card}:basic`));
    expect(opt).toBeDefined();
    engine.choose(opt!.id);
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    drainCombat(engine, state);
    expect(find(state, "M")!.inTorpor).toBe(false);
    expect(find(state, "V1")!.blood).toBe(3);
  });
  it("a first-strike Entombment burns the ally before its strike can resolve", () => {
    const { state, engine } = inCombat("ally");
    combat(state).firstStrikeRound = { acting: true, opposing: false };
    declare(engine, "Alice", "basic");
    engine.choose("strike:hand");
    drainCombat(engine, state);
    expect(find(state, "A1")).toBeUndefined();
    expect(find(state, "V1")!.blood).toBe(3);
  });
  it("can be canceled as played without paying its cost or choosing the strike", () => {
    const { state, engine } = inCombat("vampire");
    state.seats[1]!.hand.push({ id: "di", name: "Direct Intervention" });
    const play = engine.decision()!.options.find(o => o.id.startsWith("play:Entombment:superior"))!;
    engine.choose(play.id);
    runTrace(engine, [["Alice", "pass"], ["Bob", "play:Direct Intervention"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(find(state, "V1")!.blood).toBe(5);
    expect(engine.decision()!.options.some(o => o.id === "strike:hand")).toBe(true);
    expect(find(state, "M")!.inTorpor).toBe(false);
  });

  it("is not offered when hand strikes alone are allowed", () => {
    const { state, engine } = inCombat("vampire");
    combat(state).handStrikesOnly = true;
    expect(engine.decision()!.options.some(o => o.id.startsWith("play:Entombment"))).toBe(false);
    expect(engine.decision()!.options.some(o => o.id === "strike:hand")).toBe(true);
  });
  it("requires sufficient blood to pay for the strike", () => {
    const { state, engine } = inCombat("vampire");
    find(state, "V1")!.blood = 1;
    expect(engine.decision()!.options.some(o => o.id.startsWith("play:Entombment"))).toBe(false);
  });

  it("preserves the specific target type across save/restore before strike resolution", () => {
    const { state, engine } = inCombat("ally");
    declare(engine, "Alice", "basic");
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    const resumed = new VtesEngine(saved, testRegistry);
    resumed.choose("strike:hand");
    expect(find(saved, "A1")).toBeUndefined();
  });
});

describe("direct strike torpor delay", () => {
  it.each(["Undead Persistence", "Undying Tenacity"]) ("%s delays Entombment, including across save/restore", card => {
    const { state, engine } = inCombat("vampire");
    find(state, "M")!.disciplines.for = "basic";
    state.seats[1]!.hand.push({ id: "delay", name: card });
    declare(engine, "Alice", "superior");
    engine.choose("strike:hand");
    let dp = engine.decision()!;
    expect(dp.window).toBe("combat.wouldGoTorpor");
    expect(dp.seat).toBe("Bob");
    expect(combat(state).pendingDamage.length).toBeGreaterThan(0);
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    const resumed = new VtesEngine(saved, testRegistry);
    dp = resumed.decision()!;
    const option = dp.options.find(o => o.id.startsWith(`play:${card}:basic:M:delay`));
    expect(option).toBeDefined();
    resumed.choose(option!.id);
    runTrace(resumed, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(combat(saved).deferredTorpor?.some(d => d.minion === "M")).toBe(true);
    expect(find(saved, "M")!.inTorpor).toBe(false);
    drainCombat(resumed, saved);
    expect(find(saved, "M")!.inTorpor).toBe(true);
    expect(find(saved, "V1")!.blood).toBe(2);
  });
  it("passing the direct torpor window sends the victim to torpor", () => {
    const { state, engine } = inCombat("vampire");
    find(state, "M")!.disciplines.for = "basic";
    state.seats[1]!.hand.push({ id: "delay", name: "Undying Tenacity" });
    declare(engine, "Alice", "superior");
    engine.choose("strike:hand");
    expect(engine.decision()!.window).toBe("combat.wouldGoTorpor");
    engine.choose("pass");
    expect(find(state, "M")!.inTorpor).toBe(true);
    drainCombat(engine, state);
    expect(find(state, "V1")!.blood).toBe(2);
  });
  it("allows the acting vampire to delay Touch of Oblivion", () => {
    const { state, engine } = inCombat("vampire", "opposing", false, "Touch of Oblivion");
    find(state, "V1")!.disciplines.for = "basic";
    state.seats[0]!.hand.push({ id: "delay", name: "Undying Tenacity" });
    engine.choose("strike:hand");
    const option = engine.decision()!.options.find(o => o.id.startsWith("play:Touch of Oblivion:superior"))!;
    engine.choose(option.id);
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(engine.decision()!.window).toBe("combat.wouldGoTorpor");
    expect(engine.decision()!.seat).toBe("Alice");
    expect(engine.decision()!.options.some(o => o.id.startsWith("play:Undying Tenacity:basic:V1:delay"))).toBe(true);
  });
  it.each([true, false])("first strike: torpor delayed=%s determines if the victim's strike resolves", delay => {
    const { state, engine } = inCombat("vampire");
    find(state, "M")!.disciplines.for = "basic";
    state.seats[1]!.hand.push({ id: "delay", name: "Undying Tenacity" });
    combat(state).firstStrikeRound = { acting: true, opposing: false };
    declare(engine, "Alice", "superior");
    engine.choose("strike:hand");
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.wouldGoTorpor");
    if (delay) {
      engine.choose(dp.options.find(o => o.id.startsWith("play:Undying Tenacity:basic"))!.id);
      runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    } else engine.choose("pass");
    drainCombat(engine, state);
    expect(find(state, "V1")!.blood).toBe(delay ? 2 : 3);
    expect(find(state, "M")!.inTorpor).toBe(true);
  });
});

describe("direct torpor edge cases", () => {
  it("allows both victims to delay simultaneous torpor strikes independently", () => {
    const { state, engine } = inCombat("vampire");
    find(state, "V1")!.disciplines.for = "basic";
    find(state, "M")!.disciplines.for = "basic";
    state.seats[0]!.hand.push({ id: "delay-a", name: "Undying Tenacity" });
    state.seats[1]!.hand.push({ id: "delay-b", name: "Undead Persistence" }, { id: "touch", name: "Touch of Oblivion" });
    declare(engine, "Alice", "superior");
    engine.choose(engine.decision()!.options.find(o => o.id.startsWith("play:Touch of Oblivion:superior"))!.id);
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    for (const [seat, card] of [["Alice", "Undying Tenacity"], ["Bob", "Undead Persistence"]]) {
      const dp = engine.decision()!;
      expect(dp.window).toBe("combat.wouldGoTorpor");
      expect(dp.seat).toBe(seat);
      engine.choose(dp.options.find(o => o.id.startsWith(`play:${card}:basic`))!.id);
      runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
      if (engine.decision()?.window === "combat.wouldGoTorpor" && engine.decision()?.seat === seat) engine.choose("pass");
    }
    expect(combat(state).deferredTorpor?.map(d => d.minion).sort()).toEqual(["M", "V1"]);
    drainCombat(engine, state);
    expect(find(state, "M")!.inTorpor).toBe(true);
    expect(find(state, "V1")!.inTorpor).toBe(true);
  });
  it("a canceled delay leaves the direct torpor pending and the vampire enters torpor on pass", () => {
    const { state, engine } = inCombat("vampire");
    find(state, "M")!.disciplines.for = "basic";
    state.seats[1]!.hand.push({ id: "delay", name: "Undying Tenacity" });
    state.seats[2]!.hand.push({ id: "di", name: "Direct Intervention" });
    declare(engine, "Alice", "superior");
    engine.choose("strike:hand");
    engine.choose(engine.decision()!.options.find(o => o.id.startsWith("play:Undying Tenacity:basic"))!.id);
    let canceled = false;
    for (let i = 0; i < 12 && engine.decision()?.window === "card.asPlayed"; i++) {
      const dp = engine.decision()!;
      const cancel = dp.options.find(o => o.id.startsWith("play:Direct Intervention"));
      if (cancel) canceled = true;
      engine.choose(cancel?.id ?? "pass");
    }
    expect(canceled).toBe(true);
    expect(engine.decision()!.window).toBe("combat.wouldGoTorpor");
    engine.choose("pass");
    expect(find(state, "M")!.inTorpor).toBe(true);
  });
  it("a vampire wounded by delayed direct torpor can be burned by aggravated damage", () => {
    const { state, engine } = inCombat("vampire");
    find(state, "M")!.blood = 0;
    find(state, "M")!.disciplines.for = "basic";
    state.seats[1]!.hand.push({ id: "delay", name: "Undying Tenacity" });
    declare(engine, "Alice", "superior");
    engine.choose("strike:hand");
    engine.choose(engine.decision()!.options.find(o => o.id.startsWith("play:Undying Tenacity:basic"))!.id);
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    const cf = combat(state);
    cf.pendingDamage.unshift({ minion: "M", source: "V1", amount: 1, aggravated: true });
    drainCombat(engine, state);
    expect(find(state, "M")).toBeUndefined();
  });
});
