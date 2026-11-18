import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: any, id: string) {
  const m = state.seats.flatMap((s: any) => s.minions).find((x: any) => x.id === id);
  if (!m) throw new Error(id);
  return m;
}

function setup() {
  const state: any = threeSeatGame();
  const alice = state.seats.find((s: any) => s.id === "Alice")!;
  const bob = state.seats.find((s: any) => s.id === "Bob")!;
  Object.assign(find(state, "W"), { sect: "sabbat", blood: 4, strength: 1, disciplines: { cel: "superior" } });
  Object.assign(find(state, "V1"), { title: "prince", blood: 4, strength: 1, capacity: 3, disciplines: { pre: "superior", cel: "superior" } });
  Object.assign(find(state, "M"), { capacity: 8, disciplines: { dom: "superior", cel: "superior" }, strength: 0, blood: 6 });
  alice.hand.push({ id: "maj", name: "Majesty" }, { id: "psyA", name: "Psyche!" });
  bob.hand.push({ id: "psy", name: "Psyche!" }, { id: "psy2", name: "Psyche!" });
  bob.pool = 10;
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "block:M"]]);
  return { state, engine };
}

describe("Psyche! superior after an end-of-combat press (user rule: offered when combat ends by a card)", () => {
  it("is offered to the other side right after a cancelling press is played", () => {
    const { state, engine } = setup();
    let bobContinued = false;
    let aliceCancelled = false;
    let superiorAfterCancel: string[] | null = null;
    for (let i = 0; i < 200; i++) {
      const dp: any = engine.decision();
      if (!dp) break;
      const ids: string[] = dp.options.map((o: any) => o.id);
      if (dp.window === "combat.press" && dp.seat === "Bob" && !bobContinued) {
        const c = ids.find((x) => x.startsWith("play:Psyche!:basic") && x.includes("continue"));
        if (c) { bobContinued = true; engine.choose(c); continue; }
      }
      if (dp.window === "combat.press" && dp.seat === "Alice" && bobContinued && !aliceCancelled) {
        const c = ids.find((x) => x.startsWith("play:Psyche!:basic") && x.includes("cancel"));
        if (c) { aliceCancelled = true; engine.choose(c); continue; }
      }
      if (aliceCancelled && dp.window === "combat.press" && dp.seat === "Bob" && superiorAfterCancel === null) {
        superiorAfterCancel = ids.filter((x) => x.startsWith("play:Psyche!:superior"));
        if (superiorAfterCancel.length) { engine.choose(superiorAfterCancel[0]!); continue; }
      }
      const pick = ids.find((x) => x === "pass") ?? ids.find((x) => x.startsWith("strike:")) ?? ids[0];
      engine.choose(pick!);
    }
    expect(bobContinued && aliceCancelled).toBe(true);
    expect(superiorAfterCancel).not.toBeNull();
    expect(superiorAfterCancel!.length).toBe(1);
    const began = state.eventLog.filter((e: any) => e.type === "CombatBegan").length;
    expect(began).toBeGreaterThanOrEqual(2);
  });

  it("is not offered while nobody has pressed to end the combat", () => {
    const { engine } = setup();
    let offered = "unset";
    for (let i = 0; i < 200; i++) {
      const dp: any = engine.decision();
      if (!dp) break;
      const ids: string[] = dp.options.map((o: any) => o.id);
      if (dp.window === "combat.press" && dp.seat === "Bob") {
        offered = JSON.stringify(ids.filter((x) => x.startsWith("play:Psyche!:superior")));
        break;
      }
      engine.choose((ids.find((x) => x === "pass") ?? ids[0])!);
    }
    expect(offered).toBe("[]");
  });
});
