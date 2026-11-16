import { describe, expect, it } from "vitest";
import { VtesEngine, currentBleed, type GameState } from "../../src/engine/index.ts";
import { buildGame, type SnapshotDeck } from "../../src/ui/decks.ts";
import { testRegistry } from "../engine/fixtures.ts";

function table(id: number, extra?: number) {
  const deck = (seat: string, ids: number[]): SnapshotDeck => ({ seat, ready: ids.map(id => ({ id })), crypt: [], uncontrolled: [], library: [], pool: 20 });
  const state = buildGame({ decks: [deck("Alice", extra ? [id, extra] : [id]), deck("Bob", [200067]), deck("Carol", [200132])], seed: 1, maxTurns: 40 });
  const turn = state.frames[0]!;
  if (turn.kind !== "turn") throw new Error("no turn");
  turn.phase = "minion";
  turn.unlockDone = turn.edgeDone = turn.unlockAbilitiesDone = true;
  const [bearer, actor] = state.seats[0]!.minions;
  for (const m of state.seats.flatMap(s => s.minions)) { m.blood = 5; m.locked = false; }
  return { state, engine: new VtesEngine(state, testRegistry), bearer: bearer!, actor: actor ?? bearer! };
}
function action(state: GameState) {
  const af = state.frames.find(f => f.kind === "action");
  if (!af || af.kind !== "action") throw new Error("no action");
  return af;
}
function until(engine: VtesEngine, predicate: () => boolean, limit = 80) {
  for (let i = 0; i < limit && !predicate(); i++) {
    const dp = engine.decision();
    if (!dp) throw new Error("no decision");
    const choice = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
    if (!choice) throw new Error(`unexpected ${dp.window}`);
    engine.choose(choice.id);
  }
  expect(predicate()).toBe(true);
}

const own = [
  [200476, "Francisco Domingo de Polonia (G2)", 1],
  [200679, "Jason, The World's Voice (G3)", 1],
  [200734, "Julia Prima (G2)", 1],
  [200992, "Mina Grotius (G3)", 1],
  [201093, "Papa Legba (G5)", 1],
  [201257, "Sébastien Goulet (G3)", 1],
  [201324, "Sundervere, The Devil Brahmin (G4)", 2],
  [201452, "Virginie, Prodigy (G4)", 1],
] as const;

describe("paid bleed crypt abilities", () => {
  it.each(own)("%s %s pays rather than receiving a free bonus", (id, name, base) => {
    const { state, engine, bearer } = table(id);
    engine.choose(`bleed:${bearer.id}`);
    const ability = `ability:${name}:${bearer.id}:bleedForBlood`;
    until(engine, () => engine.decision()?.options.some(o => o.id === ability) === true);
    expect(currentBleed(state, action(state))).toBe(base);
    engine.choose(ability);
    expect(bearer.blood).toBe(4);
    expect(currentBleed(state, action(state))).toBe(base + 1);
    expect(engine.decision()!.options.some(o => o.id === ability)).toBe(false);
    until(engine, () => !state.frames.some(f => f.kind === "action"));
    expect(state.seats[1]!.pool).toBe(20 - base - 1);
  });

  it.each([[200476, "Francisco Domingo de Polonia (G2)", false], [200734, "Julia Prima (G2)", true]] as const)("%s limit is applied across actions", (id, name, available) => {
    const { state, engine, bearer } = table(id);
    const ability = `ability:${name}:${bearer.id}:bleedForBlood`;
    engine.choose(`bleed:${bearer.id}`);
    until(engine, () => engine.decision()?.options.some(o => o.id === ability) === true);
    engine.choose(ability);
    until(engine, () => !state.frames.some(f => f.kind === "action"));
    engine.emit({ type: "MinionUnlocked", minion: bearer.id });
    bearer.bledThisTurn = false; // isolate the ability limit from the normal one-bleed rule
    engine.choose(`bleed:${bearer.id}`);
    expect(engine.decision()!.options.some(o => o.id === ability)).toBe(available);
  });

  it.each([
    [200119, "Anu Diptinatpa (G6)", { sect: "camarilla", clan: "Toreador" }, true],
    [200987, "Miguel Santo Domingo (G3)", { sect: "sabbat", clan: "Toreador" }, true],
    [200987, "Miguel Santo Domingo (G3)", { sect: "camarilla", clan: "Toreador" }, false],
    [201102, "Paul Forrest, False Prophet (G4)", { sect: "independent", clan: "Ravnos" }, true],
    [201102, "Paul Forrest, False Prophet (G4)", { sect: "independent", clan: "Toreador" }, false],
    [201376, "Toby (G4)", { sect: "anarch", clan: "Toreador" }, true],
    [201376, "Toby (G4)", { sect: "camarilla", clan: "Toreador" }, false],
  ] as const)("%s assists only a qualifying acting minion", (id, name, properties, eligible) => {
    const { state, engine, bearer, actor } = table(id, 200734);
    Object.assign(actor, properties);
    engine.choose(`bleed:${actor.id}`);
    const ability = `ability:${name}:${bearer.id}:bleedForBlood`;
    expect(engine.decision()!.options.some(o => o.id === ability)).toBe(eligible);
    if (eligible) {
      engine.choose(ability);
      expect(bearer.blood).toBe(4);
      expect(actor.blood).toBe(5);
      expect(currentBleed(state, action(state))).toBe(2);
      expect(engine.decision()!.options.some(o => o.id === ability)).toBe(false);
    }
  });

  it("a vampire in torpor cannot use an in-play ability", () => {
    const { engine, bearer, actor } = table(200119, 200734);
    bearer.inTorpor = true;
    engine.choose(`bleed:${actor.id}`);
    expect(engine.decision()!.options.some(o => o.id === `ability:Anu Diptinatpa (G6):${bearer.id}:bleedForBlood`)).toBe(false);
  });

  it("Anu can assist another Methuselah’s bleed during their priority", () => {
    const { state, engine, bearer } = table(200119);
    engine.changeMinionControl(bearer.id, "Bob");
    const actor = state.seats[2]!.minions[0]!;
    engine.changeMinionControl(actor.id, "Alice");
    engine.choose(`bleed:${actor.id}`);
    const ability = `ability:Anu Diptinatpa (G6):${bearer.id}:bleedForBlood`;
    until(engine, () => engine.decision()?.options.some(o => o.id === ability) === true);
    expect(engine.decision()!.seat).toBe("Bob");
    engine.choose(ability);
    expect(bearer.blood).toBe(4);
    expect(currentBleed(state, action(state))).toBe(2);
  });
});
