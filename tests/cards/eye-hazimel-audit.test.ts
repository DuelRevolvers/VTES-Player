import { describe, expect, it } from "vitest";
import { VtesEngine, disciplinesOf } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Eye of Hazimel discipline grants", () => {
  it("grants both Potence and Chimerstry at superior without changing printed disciplines", () => {
    const state = threeSeatGame();
    const v = state.seats[0]!.minions[0]!;
    v.disciplines = { pot: "basic", aus: "basic" };
    const handler = testRegistry["Eye of Hazimel"]!;
    v.attached.push({ card: { id: "eye", name: "Eye of Hazimel" }, locked: false, usedThisPhase: false,
      statics: handler.permanentStatics!, tags: handler.permanentTags ?? [] });
    expect(disciplinesOf(v)).toMatchObject({ pot: "superior", chi: "superior", aus: "basic" });
    expect(v.disciplines).toEqual({ pot: "basic", aus: "basic" });
    v.attached = v.attached.filter(p => p.card.id !== "eye");
    expect(disciplinesOf(v)).toEqual({ pot: "basic", aus: "basic" });
  });
});

describe("Eye of Hazimel burn damage (batch 2)", () => {
  function setup() {
    const state = threeSeatGame();
    const v = state.seats[0]!.minions[0]!;
    v.blood = 8;
    v.attached.push({ card: { id: "eye", name: "Eye of Hazimel" }, locked: false, usedThisPhase: false,
      statics: testRegistry["Eye of Hazimel"]!.permanentStatics ?? {}, tags: testRegistry["Eye of Hazimel"]!.permanentTags ?? [] });
    return { state, v, engine: new VtesEngine(state, testRegistry) };
  }

  it("a burned Eye inflicts 5 environmental damage on its bearer", () => {
    const { v, engine } = setup();
    (engine as unknown as { burnPermanent(id: string): void }).burnPermanent("eye");
    expect(v.blood).toBe(3);
    expect(v.attached.some((p) => p.card.id === "eye")).toBe(false);
  });

  it("is applied at once even when the bearer has little blood", () => {
    const { v, engine } = setup();
    v.blood = 2;
    (engine as unknown as { burnPermanent(id: string): void }).burnPermanent("eye");
    expect(v.blood).toBe(0);
  });
});
