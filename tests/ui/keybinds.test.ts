import { describe, expect, it } from "vitest";
import {
  actionForKey,
  cleanKeybinds,
  controlsPanel,
  DEFAULT_KEYBINDS,
  KEY_ACTIONS,
  keyName,
  primaryOption,
  rebind,
} from "../../src/ui/keybinds.ts";

describe("keyboard shortcuts", () => {
  it("Space answers the only option, else Pass, else the hand strike — else nothing", () => {
    expect(primaryOption(["bleed:m1"])).toBe("bleed:m1");
    expect(primaryOption(["play:X:-:m1:c1", "pass"])).toBe("pass");
    expect(primaryOption(["strike:hand", "ability:Gun:c2:"])).toBe("strike:hand");
    // A vote: two real choices and no default — Space must not pick one.
    expect(primaryOption(["vote:m1:for", "vote:m1:against"])).toBeNull();
    expect(primaryOption([])).toBeNull();
  });

  it("defaults: Space, the digits, and a key each for the table's buttons", () => {
    expect(actionForKey(DEFAULT_KEYBINDS, "Space")).toBe("primary");
    expect(actionForKey(DEFAULT_KEYBINDS, "3")).toBe("option3");
    for (const a of ["undo", "save", "load", "moderation", "settings"] as const) {
      expect(DEFAULT_KEYBINDS[a]).not.toBe("");
    }
    // No key does two things out of the box.
    const keys = KEY_ACTIONS.map((a) => DEFAULT_KEYBINDS[a]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("names keys the way they are stored", () => {
    expect(keyName({ key: " " })).toBe("Space");
    expect(keyName({ key: "z" })).toBe("Z");
    expect(keyName({ key: "s", ctrlKey: true })).toBe("Ctrl+S");
    expect(keyName({ key: "Shift" })).toBeNull();
  });

  it("rebinding steals the key from whatever held it, and nothing else", () => {
    const b = rebind(DEFAULT_KEYBINDS, "undo", "S");
    expect(b.undo).toBe("S");
    expect(b.save).toBe("");
    expect(b.load).toBe(DEFAULT_KEYBINDS.load);
    // An unbound action matches no key, including the empty one.
    expect(actionForKey(b, "")).toBeNull();
  });

  it("a stored blob is cleaned: junk dropped, missing actions defaulted", () => {
    const b = cleanKeybinds({ undo: "U", save: 7, bogus: "Q" });
    expect(b.undo).toBe("U");
    expect(b.save).toBe(DEFAULT_KEYBINDS.save);
    expect(Object.keys(b).sort()).toEqual([...KEY_ACTIONS].sort());
    expect(cleanKeybinds(null)).toEqual(DEFAULT_KEYBINDS);
  });

  it("the Controls panel lists every action and shows the one being captured", () => {
    const html = controlsPanel(DEFAULT_KEYBINDS, "save");
    for (const a of KEY_ACTIONS) expect(html).toContain(`data-key="${a}"`);
    expect(html).toContain("Press a key…");
  });
});
