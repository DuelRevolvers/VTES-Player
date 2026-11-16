import { describe, expect, it } from "vitest";
import { disciplinesOf } from "../../src/engine/index.ts";
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
