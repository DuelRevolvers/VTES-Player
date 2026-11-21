import { describe, expect, it } from "vitest";
import { cardSpecs } from "../../src/cards/effects/cards.ts";

describe("Alacrity (100036) — CONFIRMED_BUG audit", () => {
  const spec = cardSpecs.find((s) => s.name === "Alacrity");
  expect(spec).toBeDefined();

  it("has basic mode with single +1 stealth (not two)", () => {
    const basic = spec!.modes.find((m) => m.level === "basic");
    expect(basic).toBeDefined();
    const stealthEffects = basic!.effects.filter(
      (e) => e.kind === "modifyStealth"
    );
    expect(stealthEffects).toHaveLength(1);
    expect(stealthEffects[0]).toMatchObject({ amount: 1 });
  });

  it("has superior mode with +1 stealth and maneuverNextRound", () => {
    const superior = spec!.modes.find((m) => m.level === "superior");
    expect(superior).toBeDefined();
    const stealthEffects = superior!.effects.filter(
      (e) => e.kind === "modifyStealth"
    );
    expect(stealthEffects).toHaveLength(1);
    expect(stealthEffects[0]).toMatchObject({ amount: 1 });
    const maneuverEffects = superior!.effects.filter(
      (e) => e.kind === "maneuverNextRound"
    );
    expect(maneuverEffects).toHaveLength(1);
    expect((maneuverEffects[0] as any).count).toBe(1);
  });
});
