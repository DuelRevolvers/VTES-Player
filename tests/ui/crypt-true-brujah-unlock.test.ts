import { describe, expect, it } from "vitest";
import { VtesEngine, type GameState, type TurnFrame } from "../../src/engine/index.ts";
import { buildGame, type SnapshotDeck } from "../../src/ui/decks.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const deck = (seat: string, id: number): SnapshotDeck => ({ seat, ready: [{ id }], uncontrolled: [], crypt: [], library: [], pool: 20 });
function fixture(id: number, phase: TurnFrame["phase"] = "minion") {
  const state = threeSeatGame();
  const built = buildGame({ decks: [deck("Alice", id), deck("Bob", 200132)], seed: 1, maxTurns: 40 });
  const vampire = built.seats[0]!.minions[0]!;
  state.seats[0]!.minions = [vampire];
  const tf = state.frames[0];
  if (!tf || tf.kind !== "turn") throw new Error("missing turn");
  tf.phase = phase;
  const engine = new VtesEngine(state, testRegistry);
  return { state, vampire, tf, engine };
}
function ability(state: GameState): string {
  const m = state.seats[0]!.minions[0]!;
  return `ability:${m.name}:${m.id}:unlock`;
}
const options = (engine: VtesEngine) => engine.decision()!.options.map((o) => o.id);

describe("True Brujah phase unlocks", () => {
  it.each([[201067, "minion"], [200618, "discard"]] as const)("%i burns blood to unlock once in its controller's phase", (id, phase) => {
    const { state, vampire, engine } = fixture(id, phase);
    vampire.locked = true;
    const blood = vampire.blood;
    const opt = ability(state);
    expect(options(engine)).toContain(opt);
    engine.choose(opt);
    expect(vampire.locked).toBe(false);
    expect(vampire.blood).toBe(blood - 1);
    expect(state.eventLog.filter((e) => e.type === "BloodBurned" || e.type === "MinionUnlocked").slice(-2)).toEqual([
      { type: "BloodBurned", minion: vampire.id, amount: 1 },
      { type: "MinionUnlocked", minion: vampire.id },
    ]);
    engine.emit({ type: "MinionLocked", minion: vampire.id });
    expect(options(engine)).not.toContain(opt);
    expect(vampire.attached.find((e) => e.card.id === vampire.id)!.usedThisPhase).toBe(true);
  });

  it.each([[201067, "minion"], [200618, "discard"]] as const)("%i requires blood and a locked vampire, but can unlock in torpor", (id, phase) => {
    const { state, vampire, engine } = fixture(id, phase);
    const opt = ability(state);
    expect(options(engine)).not.toContain(opt);
    vampire.locked = true;
    vampire.blood = 0;
    expect(options(engine)).not.toContain(opt);
    vampire.blood = 1;
    vampire.inTorpor = true;
    expect(options(engine)).toContain(opt);
    engine.choose(opt);
    expect(vampire).toMatchObject({ blood: 0, locked: false, inTorpor: true });
  });

  it.each([[201067, "minion", "discard"], [200618, "discard", "minion"]] as const)("%i cannot use the ability in a different phase or another turn", (id, phase, wrongPhase) => {
    const { state, vampire, tf, engine } = fixture(id, wrongPhase);
    vampire.locked = true;
    const opt = ability(state);
    expect(options(engine)).not.toContain(opt);
    tf.phase = phase;
    tf.seat = "Bob";
    expect(options(engine)).not.toContain(opt);
  });

  it.each([[201067, "minion"], [200618, "discard"]] as const)("%i follows the current controller after a change of control", (id, phase) => {
    const { state, vampire, tf, engine } = fixture(id, phase);
    vampire.locked = true;
    const opt = ability(state);
    engine.changeMinionControl(vampire.id, "Bob");
    expect(options(engine)).not.toContain(opt);
    tf.seat = "Bob";
    expect(options(engine)).toContain(opt);
    engine.choose(opt);
    expect(vampire.locked).toBe(false);
    expect(vampire.blood).toBe(vampire.capacity - 1);
  });

  it.each([[201067, "minion"], [200618, "discard"]] as const)("%i keeps its spent latch through save/load and refreshes on the next unlock sweep", (id, phase) => {
    const { state, vampire, tf, engine } = fixture(id, phase);
    vampire.locked = true;
    const opt = ability(state);
    engine.choose(opt);
    engine.emit({ type: "MinionLocked", minion: vampire.id });
    const restored = JSON.parse(JSON.stringify(state)) as GameState;
    const resumed = new VtesEngine(restored, testRegistry);
    expect(options(resumed)).not.toContain(opt);
    tf.phase = "unlock";
    tf.unlockDone = false;
    engine.decision(); // real unlock sweep resets per-phase latches
    tf.phase = phase;
    vampire.locked = true;
    expect(options(engine)).toContain(opt);
  });

  it("Ibn's discard-phase ability is optional and does not spend the discard action", () => {
    const { state, vampire, tf, engine } = fixture(200618, "discard");
    vampire.locked = true;
    tf.discardActionsLeft = 1;
    state.seats[0]!.hand = [{ id: "discard-me", name: "Conditioning" }];
    expect(options(engine)).toContain("discard:discard-me");
    expect(options(engine)).toContain("pass");
    engine.choose(ability(state));
    expect(tf.discardActionsLeft).toBe(1);
    expect(options(engine)).toContain("discard:discard-me");
    engine.choose("discard:discard-me");
    expect(tf.discardActionsLeft).toBe(0);
    expect(state.seats[0]!.ashHeap?.some((card) => card.id === "discard-me")).toBe(true);
  });

  it("Nu can unlock during his bleed; it does not permit another bleed in the same turn", () => {
    const { state, vampire, engine } = fixture(201067);
    runTrace(engine, [["Alice", `bleed:${vampire.id}`]]);
    expect(engine.decision()!.window).toBe("action.announce");
    expect(vampire.locked).toBe(true);
    const opt = ability(state);
    expect(options(engine)).toContain(opt);
    const blood = vampire.blood;
    engine.choose(opt);
    expect(vampire.locked).toBe(false);
    expect(vampire.blood).toBe(blood - 1);
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(options(engine)).not.toContain(`bleed:${vampire.id}`);
    expect(options(engine)).toContain(`hunt:${vampire.id}`);
  });

  it("The Sleeping Mind superior bars Nu through the after-resolution impulse", () => {
    const { state, vampire, engine } = fixture(201067);
    vampire.locked = true;
    state.seats[0]!.minions.push(makeMinion("actor", "Alice", { blood: 4, disciplines: { dom: "superior", obl: "superior" } }));
    state.seats[1]!.minions.find((m) => m.id === "M")!.locked = true;
    // Shadow Cloak keeps the post-resolution window open without unlocking.
    state.seats[0]!.hand = [{ id: "sleep", name: "The Sleeping Mind" }, { id: "cloak", name: "Shadow Cloak" }];
    runTrace(engine, [["Alice", "bleed:actor"]]);
    expect(options(engine)).toContain(ability(state));
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    runTrace(engine, [["Alice", "play:The Sleeping Mind:superior:actor:sleep"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(options(engine)).not.toContain(ability(state));
    for (let i = 0; i < 20 && engine.decision()!.window !== "action.afterResolution"; i++) {
      const dp = engine.decision()!;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(engine.decision()!.window).toBe("action.afterResolution");
    expect(options(engine)).not.toContain(ability(state));
    for (let i = 0; i < 10 && engine.decision()!.window === "action.afterResolution"; i++) engine.choose("pass");
    expect(engine.decision()!.window).toBe("turn.minion");
    expect(options(engine)).toContain(ability(state));
  });

  it.each([true, false])("Nu can unlock during Domain Challenge polling (uses ability: %s)", (unlock) => {
    const { state, vampire, engine } = fixture(201067);
    state.seats[0]!.hand = [{ id: "domain", name: "Domain Challenge" }];
    runTrace(engine, [
      ["Alice", "play:Domain Challenge"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // Nu's available ability keeps the otherwise empty post-action window open.
    if (engine.decision()!.window === "action.afterResolution") {
      runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    }
    expect(engine.decision()!.window).toBe("referendum.polling");
    expect(vampire.locked).toBe(true);
    expect(options(engine)).toContain(ability(state));
    if (unlock) engine.choose(ability(state));
    runTrace(engine, [["Alice", "vote:caller:for"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    if (engine.decision()!.window === "referendum.afterResolution") {
      runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    }
    expect(state.seats[0]!.pool).toBe(unlock ? 10 : 9);
  });
});
