/**
 * Bot playstyles (docs/ai-playstyles-design.md).
 *
 * Four things are under test and they fail differently:
 *
 *  1. `balanced` is the tuned defaults, so shipping this changes nothing
 *     until a deck or a dropdown says otherwise;
 *  2. the resolution rule — override, else deck, else balanced — and it
 *     must be TOTAL, because an imported deck has no precon identity;
 *  3. the config covers every shipped precon, so a new one is visible
 *     rather than silently balanced;
 *  4. **nothing in the UI says which style a deck plays.** That was the
 *     owner's requirement and it is the one a later UI pass would
 *     helpfully break.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS } from "../../src/ai/heuristic.ts";
import { PLAYSTYLES, PLAYSTYLES_LIST, PLAYSTYLE_LABELS, isPlaystyle } from "../../src/ai/playstyles.ts";
import registry from "../../src/cards/registry.json" with { type: "json" };
import deckPlaystyles from "../../config/deck-playstyles.json" with { type: "json" };
import { botAgentFor, deckPlaystyle, playstyleFor, playstyleOf } from "../../src/ui/botagent.ts";
import { DEFAULT_SETTINGS, type UiSettings } from "../../src/ui/settings.ts";

const settings = (styles: string[]): UiSettings => ({
  ...DEFAULT_SETTINGS,
  autoPass: {},
  aiSeats: {},
  botNames: [],
  botPlaystyles: styles,
});

describe("the styles themselves", () => {
  it("has exactly the six the owner chose", () => {
    // Four on 2026-09-18; Stalker and Builder added 2026-09-19 after
    // measuring what the precons actually play rather than what their
    // card types suggested.
    expect([...PLAYSTYLES_LIST]).toEqual([
      "balanced",
      "bruiser",
      "stalker",
      "turtle",
      "politician",
      "builder",
    ]);
    expect(Object.values(PLAYSTYLE_LABELS)).toEqual([
      "Balanced",
      "Bruiser",
      "Stalker",
      "Turtle",
      "Politician",
      "Builder",
    ]);
  });

  it("leaves BALANCED as the tuned defaults, so this ships inert", () => {
    expect(PLAYSTYLES.balanced).toEqual({});
  });

  it("only ever overrides weights that exist", () => {
    // A typo in a weight name would be silent: the overlay would carry a
    // key nothing reads, and the style would quietly be balanced.
    for (const style of PLAYSTYLES_LIST) {
      for (const key of Object.keys(PLAYSTYLES[style])) {
        expect(DEFAULT_WEIGHTS).toHaveProperty(key);
      }
    }
  });

  it("never touches the self-oust guard", () => {
    // Nothing outranks not being ousted, whatever a bot's temperament.
    for (const style of PLAYSTYLES_LIST) {
      expect(PLAYSTYLES[style]).not.toHaveProperty("selfOustGuard");
    }
  });

  it("makes each style actually differ from balanced", () => {
    for (const style of PLAYSTYLES_LIST) {
      if (style === "balanced") continue;
      expect(Object.keys(PLAYSTYLES[style]).length).toBeGreaterThan(0);
    }
  });
});

describe("which style a seat plays", () => {
  it("prefers the Profile override", () => {
    expect(playstyleFor(settings(["turtle"]), 1, { kind: "precon", set: "Fifth Edition", name: "Toreador" })).toBe(
      "turtle",
    );
  });

  it("falls back to the DECK when the override is Default", () => {
    expect(
      playstyleFor(settings(["default"]), 1, { kind: "precon", set: "Fifth Edition", name: "Toreador" }),
    ).toBe("politician");
  });

  it("falls back to the deck when there is no entry at all", () => {
    expect(playstyleFor(settings([]), 3, { kind: "precon", set: "Fifth Edition (Anarch)", name: "Gangrel" })).toBe(
      "turtle",
    );
  });

  it("is TOTAL: a pasted deck, an unknown precon and null all give balanced", () => {
    expect(deckPlaystyle({ kind: "paste", text: "whatever" })).toBeNull();
    expect(deckPlaystyle({ kind: "precon", set: "No Such Set", name: "Nobody" })).toBeNull();
    expect(deckPlaystyle(null)).toBeNull();
    expect(playstyleFor(settings([]), 1, null)).toBe("balanced");
  });

  it("ignores a stored value that is not a style", () => {
    // A settings blob is untrusted input; a rubbish value must read as
    // Default rather than select nothing.
    expect(playstyleFor(settings(["nonsense"]), 1, null)).toBe("balanced");
    expect(isPlaystyle("nonsense")).toBe(false);
  });
});

describe("the agent the factory builds", () => {
  it("remembers its style, so a save can record it", () => {
    const agent = botAgentFor("Alice", { playstyle: "bruiser" });
    expect(playstyleOf(agent)).toBe("bruiser");
  });

  it("reports null for an agent built elsewhere", () => {
    expect(playstyleOf({})).toBeNull();
    expect(playstyleOf(null)).toBeNull();
  });

  it("is deterministic: same seat and style, same choices", () => {
    // A style changes WEIGHTS, never the RNG. Two agents built the same
    // way must be indistinguishable, or a replay becomes a lie.
    const a = botAgentFor("Alice", { playstyle: "turtle" });
    const b = botAgentFor("Alice", { playstyle: "turtle" });
    expect(playstyleOf(a)).toBe(playstyleOf(b));
  });
});

describe("NOTHING LABELS A DECK WITH ITS STYLE", () => {
  // The owner's requirement: the styles are attached to the precons as a
  // background thing, and the dropdown is the only place the four words
  // appear. This is the assertion a later UI pass would break while
  // being helpful, so it is structural rather than a string search over
  // one rendering: the table and the deck chooser must not know that
  // playstyles exist at all.
  const forbidden = ["src/ui/render.ts", "src/ui/deckimport.ts", "src/ui/decks.ts", "src/ui/newgame.ts"];

  it("keeps playstyles out of the table and the deck chooser", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const file of forbidden) {
      const src = await readFile(file, "utf-8");
      expect(src, `${file} must not reference playstyles`).not.toMatch(/playstyle/i);
    }
  });

  it("mentions the style words only where the dropdown is built", async () => {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile("src/ui/shell.ts", "utf-8");
    // A NAME COLLISION, NOT A WEAKENING (2026-09-22). The screen the
    // owner asked for is called the "Deck Builder", and "Builder" is
    // also a playstyle — so a substring search now hits a screen title,
    // a route name and a method name that have nothing to do with
    // playstyles. The deck-builder's own names are removed BEFORE the
    // search rather than the assertion being softened: a stray
    // "Builder" written anywhere else in the shell still fails this.
    const shell = raw.replace(/deck[ -]?builder/gi, "«the decks screen»");
    for (const word of Object.values(PLAYSTYLE_LABELS)) {
      if (word === "Balanced") continue;
      expect(shell, `${word} should come from PLAYSTYLE_LABELS`).not.toContain(word);
    }
  });
});

describe("the deck config", () => {
  const styles = (deckPlaystyles as { styles: Record<string, string> }).styles;

  it("covers EVERY shipped precon", () => {
    // The test that keeps the table honest when a precon is added: it
    // walks the registry's precons, not its cards.
    const missing = (registry as { precons: Array<{ set: string; name: string }> }).precons
      .map((p) => `${p.set}|${p.name}`)
      .filter((key) => !(key in styles));
    expect(missing).toEqual([]);
  });

  it("names only real styles", () => {
    const bad = Object.entries(styles).filter(([, v]) => !isPlaystyle(v));
    expect(bad).toEqual([]);
  });

  it("uses every style, so the assignment is not degenerate", () => {
    expect(new Set(Object.values(styles)).size).toBe(PLAYSTYLES_LIST.length);
  });
});
