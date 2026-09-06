/**
 * A locked card is drawn rotated 90°, and `transform` does not change the
 * layout box — so a rotated card reserves an upright card's space and its
 * long side overhangs whatever sits beside it. The fix is a margin that
 * swaps the reserved box to <height> wide by <width> tall, derived from the
 * card's own --cw/--ch.
 *
 * That is CSS, so there is no DOM here to measure. What IS worth pinning is
 * the structure that keeps it correct: the correction is computed from the
 * size variables rather than hand-tuned per size, so a new card size cannot
 * be added without its rotated footprint coming out right. The original bug
 * was exactly a hand-tuned margin — with its two axes swapped, so locked
 * minions overlapped instead of spacing out.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("../../src/ui/style.css", import.meta.url)),
  "utf8",
);

/** Every `.scanwrap.<size>` rule and its declaration block. */
function sizeRules(): { cls: string; body: string }[] {
  const out: { cls: string; body: string }[] = [];
  const re = /\.scanwrap\.([a-z-]+)\s*\{([^}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    out.push({ cls: m[1]!, body: m[2]! });
  }
  return out;
}

describe("a locked card's footprint", () => {
  it("derives the rotated margin from the card's own size variables", () => {
    const locked = sizeRules().find((r) => r.cls === "locked");
    expect(locked, "there must be a .scanwrap.locked rule").toBeDefined();
    expect(locked!.body).toContain("rotate(90deg)");
    // Both axes corrected, both from the variables: a literal margin here
    // is the bug this test exists to catch.
    const margin = /margin:\s*calc\(([^;]*?)\)\s*calc\(([^;]*?)\)\s*;/.exec(locked!.body);
    expect(margin, "the locked margin must be two calc() values").not.toBeNull();
    // Vertical correction is (width - height) / 2, horizontal is its
    // mirror — the box is being transposed, so the two must be opposite.
    expect(margin![1]!.replace(/\s/g, "")).toBe("(var(--cw)-var(--ch))/2");
    expect(margin![2]!.replace(/\s/g, "")).toBe("(var(--ch)-var(--cw))/2");
  });

  it("gives every card size both variables, and no size a fixed box", () => {
    const sizes = sizeRules().filter((r) => r.cls !== "locked" && r.cls !== "cardback");
    expect(sizes.length).toBeGreaterThan(0);
    for (const { cls, body } of sizes) {
      expect(body, `.scanwrap.${cls} must set --cw`).toMatch(/--cw:\s*\d+px/);
      expect(body, `.scanwrap.${cls} must set --ch`).toMatch(/--ch:\s*\d+px/);
      // A fixed width/height would size the card outside the variables the
      // locked correction reads, putting the two back out of step.
      expect(body, `.scanwrap.${cls} must not set width directly`).not.toMatch(
        /(^|;)\s*width:/,
      );
      expect(body, `.scanwrap.${cls} must not set height directly`).not.toMatch(
        /(^|;)\s*height:/,
      );
    }
  });

  it("sizes the card from those variables", () => {
    const base = /\.scanwrap\s*\{([^}]*)\}/.exec(css);
    expect(base).not.toBeNull();
    expect(base![1]!).toContain("width: var(--cw)");
    expect(base![1]!).toContain("height: var(--ch)");
  });
});
