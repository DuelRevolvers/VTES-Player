/**
 * How to Play on the main menu (owner request, 2026-09-22).
 *
 * The rules panel already existed at the table. The risk in putting it on
 * the menu is a SECOND COPY of it — the one that falls behind the day a
 * rule section is added or reworded. So the claim tested here is that
 * there is one renderer and both screens call it, plus the behaviour a
 * reader of the menu's copy actually depends on.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { howToPlayPanel } from "../../src/ui/render.ts";
import { CREDITS, RULE_SECTIONS } from "../../src/ui/rules.ts";

const read = (p: string): string =>
  readFileSync(join(import.meta.dirname, "..", "..", p), "utf8");

describe("the How to Play panel", () => {
  it("draws every rule section, with the credits under them", () => {
    const html = howToPlayPanel("", []);
    for (const s of RULE_SECTIONS) expect(html).toContain(`data-rule="${s.id}"`);
    expect(html).toContain(CREDITS);
    // The Dark Pack line is part of the credits, and the menu is the one
    // screen everyone sees — it must come with the panel, not be left out.
    expect(html).toContain("Dark Pack");
  });

  it("opens only the sections it is told are open", () => {
    const first = RULE_SECTIONS[0]!.id;
    const second = RULE_SECTIONS[1]!.id;
    const html = howToPlayPanel("", [first]);
    expect(html).toMatch(new RegExp(`data-rule="${first}"\\s+open`));
    // The negative: the one not asked for stays closed.
    expect(html).not.toMatch(new RegExp(`data-rule="${second}"\\s+open`));
  });

  it("narrows to the sections a search matches, and says how many", () => {
    const html = howToPlayPanel("torpor", []);
    expect(html).toContain("<mark>");
    expect(html).toMatch(/\d+ of \d+ sections match/);
    expect((html.match(/data-rule="/g) ?? []).length).toBeLessThan(RULE_SECTIONS.length);
    expect(howToPlayPanel("qqzzxx", [])).toContain("Nothing matches");
  });
});

describe("one panel, two screens", () => {
  const shell = read("src/ui/shell.ts");
  const render = read("src/ui/render.ts");

  it("puts a How to Play button on the main menu", () => {
    expect(shell).toContain(`<button id="m-help">How to Play</button>`);
  });

  it("draws the menu's panel with the TABLE's renderer, not a copy of it", () => {
    expect(shell).toContain("howToPlayPanel(this.helpQuery, [...this.helpOpenSections])");
    // The table's own entry point delegates to the same function.
    expect(render).toMatch(
      /function helpPanel\(input: RenderInput\)[\s\S]{0,160}return howToPlayPanel\(input\.helpQuery, input\.helpOpenSections\);/,
    );
    // And there is exactly one place the panel's markup is written.
    expect((render.match(/aria-label="How to play"/g) ?? []).length).toBe(1);
    expect(shell).not.toContain(`aria-label="How to play"`);
  });

  it("wires open, close, search and the sections on the menu", () => {
    for (const id of ["#m-help", "#help-close, #help-scrim", "#help-search", ".rulesec"]) {
      expect(shell, id).toContain(id);
    }
  });

  it("closes the panel when the menu is left", () => {
    // Coming back to the menu should land on the menu, not on a panel
    // left open three screens ago.
    expect(shell).toMatch(/private go\(screen: Screen\)[\s\S]{0,1400}this\.helpOpen = false;/);
  });
});
