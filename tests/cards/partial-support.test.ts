/**
 * Keeps `docs/partial-support.md` honest, in BOTH directions.
 *
 * The ledger exists because the dangerous thing about a deferral is not
 * the missing clause, it is forgetting it: Terror Frenzy's superior sat
 * unimplemented behind a "deferred" note for a whole gate, and nothing
 * could see it — nothing asserts a mode that is not there, and the fuzz
 * cannot see a missing option.
 *
 * So:
 *   1. every card the ledger names must actually BE supported (an entry
 *      naming an unsupported card is stale — the card was never shipped,
 *      or was unflipped, and the row is now a lie);
 *   2. every `PARTIAL:` marker in cards.ts must have a ledger row (a
 *      deferral cannot be written into a comment and forgotten);
 *   3. and, reading the other way, every ledger row that names a card
 *      must name one the registry knows, so a renamed card fails here
 *      rather than quietly dropping out of the list.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import registry from "../../src/cards/registry.json";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const ledger = readFileSync(join(root, "docs", "partial-support.md"), "utf8");
const source = readFileSync(join(root, "src", "cards", "effects", "cards.ts"), "utf8");

const entries = registry.entries as unknown as Record<
  string,
  { card: { id: number; name: string; kind?: string }; supported: boolean }
>;

/**
 * The ledger has two halves and they assert OPPOSITE things, so the
 * section a row sits in is part of its meaning:
 *
 *   - before "## Cards deliberately CUT" — cards that SHIPPED with a hole;
 *   - from there to "## Retrofits"       — cards NOT shipped at all.
 *
 * A row in the wrong half is a real error, which is why this splits on the
 * headings rather than scanning the whole file.
 */
const CUT_HEADING = "## Cards deliberately CUT";
const END_HEADING = "## Retrofits available now";

function namesBetween(from: number, to: number): string[] {
  const out: string[] = [];
  for (const line of ledger.slice(from, to).split("\n")) {
    const m = /^\|\s*\*\*(.+?)\*\*\s*\|/.exec(line);
    if (m?.[1]) out.push(m[1]);
  }
  return out;
}

/** Cards marked supported that have a printed clause we do not implement. */
function ledgerNames(): string[] {
  return namesBetween(0, ledger.indexOf(CUT_HEADING));
}

/** Cards cut or deferred whole — deliberately NOT supported. */
function cutNames(): string[] {
  return namesBetween(ledger.indexOf(CUT_HEADING), ledger.indexOf(END_HEADING));
}

/** `// PARTIAL: <card name> — <clause>` markers in the card sources. */
/** The scanner, over any text — so the guard below can prove it still
 *  matches a well-formed marker even when cards.ts contains none. */
function scanMarkers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\/\/\s*PARTIAL:\s*([^—\n]+?)\s*—/g)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function markerNames(): string[] {
  return scanMarkers(source);
}

function supportedNames(): Set<string> {
  const s = new Set<string>();
  for (const e of Object.values(entries)) if (e.supported) s.add(e.card.name);
  return s;
}

function allNames(): Set<string> {
  return new Set(Object.values(entries).map((e) => e.card.name));
}

describe("the partial-support ledger", () => {
  it("the ledger scanner finds rows at all — it cannot silently read none", () => {
    // This named Heroic Might and Rutor's Hand, the two cards the wave
    // that wrote it shipped partially. Both were completed on 2026-09-03
    // (docs/ledger-closeout.md), so the assertion is now about the SCANNER
    // rather than about two particular cards — which is what it was
    // guarding. The rows that remain are the two `PlayerView`/reading
    // notes, which are not unimplemented clauses.
    const names = ledgerNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("Revelations");
  });

  it("names only cards the registry knows — a rename fails here", () => {
    const known = allNames();
    const unknown = ledgerNames().filter((n) => !known.has(n));
    expect(unknown).toEqual([]);
  });

  it("names only cards that are actually SUPPORTED — a stale row fails", () => {
    // A ledger row is a claim about a card that SHIPPED with a hole in it.
    // If the card is not supported, either it never shipped or it was
    // unflipped; either way the row has to go.
    const live = supportedNames();
    const stale = ledgerNames().filter((n) => !live.has(n));
    expect(stale).toEqual([]);
  });

  it("has a row for every PARTIAL: marker in cards.ts", () => {
    const listed = new Set(ledgerNames());
    const orphans = markerNames().filter((n) => !listed.has(n));
    expect(orphans).toEqual([]);
  });

  it("the marker regex still works, on a sample it is given", () => {
    // Guarding the guard: if the marker format drifts, the check above
    // passes vacuously. It used to require >= 2 real markers in cards.ts,
    // which stopped being possible on 2026-09-03 — **every clause on every
    // library card is now implemented, so there are no markers left**
    // (docs/ledger-closeout.md). The guard therefore tests the SCANNER
    // rather than counting the findings, which is what it was really for.
    expect(markerNames()).toEqual([]);
    expect(
      scanMarkers("// PARTIAL: Some Card — the clause that is missing\n"),
    ).toEqual(["Some Card"]);
  });
});

describe("the CUT half of the ledger", () => {
  it("has both sections, so neither half can silently scan nothing", () => {
    expect(ledger.indexOf(CUT_HEADING)).toBeGreaterThan(0);
    expect(ledger.indexOf(END_HEADING)).toBeGreaterThan(ledger.indexOf(CUT_HEADING));
    expect(ledgerNames().length).toBeGreaterThan(0);
    // The CUT half is EMPTY as of 2026-09-03: every library card is
    // supported, so no card is cut. This assertion used to require a
    // non-empty list — a guard against the scan silently matching nothing
    // — and that guard has to become an assertion about WHY the list is
    // empty, or it just fails forever. If a future card is cut, the row
    // must name a card the registry knows and does not support, which the
    // three tests below still enforce.
    const library = Object.values(entries).filter((e) => e.card.kind === "library");
    if (cutNames().length === 0) {
      expect(library.every((e) => e.supported)).toBe(true);
    }
  });

  it("names only cards the registry knows", () => {
    const known = allNames();
    expect(cutNames().filter((n) => !known.has(n))).toEqual([]);
  });

  it("names only cards that are NOT supported — shipping one means deleting its row", () => {
    // The inverse of the assertion on the other half. A card that gets
    // built and left listed here would send the next session off to
    // re-derive a blocker that no longer exists — which has already
    // happened twice (Touch of Valeren, New Carthage).
    const live = supportedNames();
    const shipped = cutNames().filter((n) => live.has(n));
    expect(shipped).toEqual([]);
  });

  it("does not list the same card in both halves", () => {
    const partial = new Set(ledgerNames());
    expect(cutNames().filter((n) => partial.has(n))).toEqual([]);
  });
});
