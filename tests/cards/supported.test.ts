/**
 * Mechanical half of the CLAUDE.md support contract: every id flipped in
 * config/supported.json has an implementation, every implementation is
 * flagged, and each spec's metadata (name, cost, disciplines) matches the
 * generated registry — so a KRCG data refresh that changes a card fails
 * loudly instead of silently diverging.
 */

import { describe, expect, it } from "vitest";
import supported from "../../config/supported.json";
import registry from "../../src/cards/registry.json";
import { buildHandlerRegistry, cardSpecs, cryptSpecs, implementedIds } from "../../src/cards/effects/cards.ts";

// Crypt entries shape `disciplines` as a record, library entries as an
// array — this test only reads library cards, so widen via unknown.
const entries = registry.entries as unknown as Record<
  string,
  {
    card: {
      id: number;
      name: string;
      bloodCost?: number | null;
      poolCost?: number | null;
      disciplines?: string[] | Record<string, string>;
      types?: string[];
      kind?: string;
    };
    supported: boolean;
  }
>;

describe("supported.json ↔ implementations", () => {
  it("every supported id has a spec, and every spec is supported", () => {
    const supportedIds = Object.entries(supported as Record<string, boolean>)
      .filter(([, v]) => v === true)
      .map(([k]) => Number(k))
      .sort((a, b) => a - b);
    expect(supportedIds).toEqual([...implementedIds].sort((a, b) => a - b));
  });

  it("spec metadata matches the generated registry", () => {
    for (const spec of cardSpecs) {
      const entry = entries[String(spec.krcgId)];
      expect(entry, `registry entry for ${spec.name} (${spec.krcgId})`).toBeDefined();
      expect(entry!.card.name).toBe(spec.name);
      expect(entry!.card.bloodCost ?? 0).toBe(spec.bloodCost);
      expect(entry!.card.poolCost ?? 0, `pool cost for ${spec.name}`).toBe(
        spec.poolCost ?? 0,
      );
      const specDisciplines = [
        ...new Set(
          spec.modes.flatMap((m) =>
            m.discipline === null
              ? []
              : Array.isArray(m.discipline)
                ? m.discipline
                : typeof m.discipline === "object"
                  ? m.discipline.all
                  : [m.discipline],
          ),
        ),
      ].sort();
      const raw = entry!.card.disciplines ?? [];
      const registryDisciplines = (Array.isArray(raw) ? [...raw] : Object.keys(raw))
        .filter((d) => d.length > 0)
        .sort();
      expect(specDisciplines, `disciplines for ${spec.name}`).toEqual(
        registryDisciplines,
      );
    }
  });

  it("every crypt spec names a real crypt card, exactly", () => {
    // The handler registry is keyed by NAME, and a vampire's abilities
    // reach it through `cryptEntry` looked up by that name — so a typo
    // (a missing "(G6)", a wrong accent) does not fail loudly, it makes
    // the vampire silently ability-less. That is the "empty for the wrong
    // reason" shape this project keeps finding, and this is its guard.
    for (const spec of cryptSpecs) {
      const entry = entries[String(spec.krcgId)];
      expect(entry, `registry entry for ${spec.name} (${spec.krcgId})`).toBeDefined();
      expect(entry!.card.name, `name for ${spec.krcgId}`).toBe(spec.name);
      expect(entry!.card.kind, `${spec.name} must be a crypt card`).toBe("crypt");
      expect(spec.cardType).toBe("crypt");
    }
  });

  it("every crypt spec actually compiles to SOMETHING", () => {
    // A spec that compiles to nothing would pass every other check here.
    //
    // "Something" is not only a self-entry: wave 1 was all statics, so
    // the entry was the whole card, but a wave-2 rush (Barachiel) carries
    // its ability in `actionOptions` and has an empty entry — correctly.
    // The guard checks the card DOES something, not where.
    const registry = buildHandlerRegistry();
    for (const spec of cryptSpecs) {
      const h = registry[spec.name];
      expect(h, `handler for ${spec.name}`).toBeDefined();
      const entry = h!.cryptEntry?.();
      expect(entry, `cryptEntry for ${spec.name}`).toBeDefined();
      const hasSomething =
        Object.keys(entry!.statics).length > 0 ||
        entry!.tags.length > 0 ||
        h!.actionOptions !== undefined ||
        h!.abilityOptions !== undefined ||
        h!.onActionResolved !== undefined;
      expect(hasSomething, `${spec.name} compiles to nothing at all`).toBe(true);
    }
  });

  /**
   * The spec is what the enumerator prices with; the HANDLER is what the
   * engine charges. `compileActionCard` never copied `poolCost` across,
   * so Aranthebes, The Immortal was gated on 1 pool and then charged
   * nothing — a supported card, free to play, asserted by nothing.
   * Cross-checking the two sides is the only guard: the fuzz cannot see a
   * cost that is never taken, and the registry agreed with the spec.
   */
  it("each compiled handler charges what its spec says", () => {
    const registryHandlers = buildHandlerRegistry();
    for (const spec of cardSpecs) {
      const h = registryHandlers[spec.name];
      expect(h, `handler for ${spec.name}`).toBeDefined();
      expect(h!.poolCost ?? 0, `handler pool cost for ${spec.name}`).toBe(
        spec.poolCost ?? 0,
      );
      expect(h!.bloodCost, `handler blood cost for ${spec.name}`).toBe(spec.bloodCost);
    }
  });

  it("the registry marks exactly the implemented ids as supported", () => {
    for (const [id, entry] of Object.entries(entries)) {
      const implemented = implementedIds.some((k) => String(k) === id);
      expect(
        entry.supported,
        `registry supported flag for ${entry.card.name} (${id})`,
      ).toBe(implemented);
    }
  });
});
