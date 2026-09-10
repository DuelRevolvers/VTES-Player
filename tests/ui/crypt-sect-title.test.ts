/**
 * Every crypt card's SECT and TITLE, checked against its printed text.
 *
 * Titles are votes (p. 28, `TITLE_VOTES`), so a title the importer fails
 * to read is a vampire who silently votes with one fewer ballot than the
 * card says — the kind of wrong that never throws and never looks broken.
 * Sect matters for the same reason: half the political pool filters on it.
 *
 * Both are the only two crypt facts NOT read straight from the KRCG data:
 * they are parsed out of the card text, so they are the two that can rot.
 * This walks all 217 and reads the text back independently.
 */

import { describe, expect, it } from "vitest";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";
import { importCryptCard } from "../../src/ui/cardinfo.ts";
import { CITY_TITLES, TITLE_VOTES } from "../../src/engine/index.ts";
import type { VampireTitle } from "../../src/engine/index.ts";

const reg = registry as unknown as CardRegistry;
const crypt = Object.values(reg.entries)
  .map((e) => e.card)
  .filter((c) => c.kind === "crypt");

/**
 * The sect/title clause: everything before the first "." or ":".
 *
 * The leading "Advanced," is dropped first, exactly as `importCryptCard`
 * does — it is a card-type marker, not part of the clause (p. 6). Reading
 * it as part of the clause is what hid the sect and the title on every
 * advanced vampire until the legacy groups brought some into the pool.
 */
const clauseOf = (text: string): string =>
  (/^[^.:]*/.exec(text.trim().replace(/^Advanced,\s*/i, ""))?.[0] ?? "").trim();

/** Every title word the rulebook prints, read from the ENGINE's own vote
 *  table rather than a second list here — one question, one place.
 *
 *  LONGEST FIRST, and on word boundaries: "Archbishop" contains "bishop",
 *  and a naive substring scan reads six real archbishops as bishops —
 *  which is the 1-vote-vs-2-vote error this file exists to catch, so it
 *  had better not be the test making it. */
const TITLE_WORDS: Array<{ word: string; title: VampireTitle }> = (
  Object.keys(TITLE_VOTES) as VampireTitle[]
)
  .map((t) => ({ word: t === "innerCircle" ? "inner circle" : t, title: t }))
  .sort((a, b) => b.word.length - a.word.length);

/** The title a card PRINTS, read independently of the importer. */
function printedTitle(clause: string): VampireTitle | null {
  const lower = clause.toLowerCase();
  return (
    TITLE_WORDS.find((t) => new RegExp(`\\b${t.word}\\b`).test(lower))?.title ?? null
  );
}

describe("every crypt card's sect", () => {
  it("is read for all 217, or the card prints no sect at all", () => {
    const missing = crypt.filter((c) => {
      const clause = clauseOf(c.cardText).toLowerCase();
      const printsSect = /^(camarilla|sabbat|anarch|independent|laibon)\b/.test(clause);
      return printsSect && importCryptCard(c.id).sect === null;
    });
    expect(missing.map((c) => `${c.name}: ${clauseOf(c.cardText)}`)).toEqual([]);
  });

  it("invents no sect for a card that prints none", () => {
    // The negative space. A parse that defaulted to "camarilla" would pass
    // the test above and quietly make every sect filter wrong.
    const invented = crypt.filter((c) => {
      const clause = clauseOf(c.cardText).toLowerCase();
      const printsSect = /^(camarilla|sabbat|anarch|independent|laibon)\b/.test(clause);
      return !printsSect && importCryptCard(c.id).sect !== null;
    });
    expect(invented.map((c) => c.name)).toEqual([]);
  });
});

describe("every crypt card's title", () => {
  it("is read whenever the card prints one — a missed title is a lost vote", () => {
    const missed: string[] = [];
    for (const c of crypt) {
      const clause = clauseOf(c.cardText).toLowerCase();
      const printed = printedTitle(clause);
      if (!printed) continue;
      const got = importCryptCard(c.id).title;
      if (got !== printed) {
        missed.push(
          `${c.name}: printed "${printed}" (${TITLE_VOTES[printed]} votes), parsed ${String(got)} — "${clauseOf(c.cardText)}"`,
        );
      }
    }
    expect(missed).toEqual([]);
  });

  it("invents no title for a card that prints none", () => {
    const invented = crypt.filter((c) => {
      const clause = clauseOf(c.cardText).toLowerCase();
      return printedTitle(clause) === null && importCryptCard(c.id).title !== null;
    });
    expect(invented.map((c) => `${c.name}: ${clauseOf(c.cardText)}`)).toEqual([]);
  });

  it("reads the city for every city title, and for no other title", () => {
    // "prince of Melbourne" is contestable by another claim to Melbourne
    // (p. 39-40); a title with no city is not. Both directions matter.
    for (const c of crypt) {
      const v = importCryptCard(c.id);
      if (v.title === null) continue;
      const hasOf = / of \w/i.test(clauseOf(c.cardText));
      if (CITY_TITLES.includes(v.title) && hasOf) {
        expect(v.titleCity, `${c.name} should name a city`).toBeTruthy();
      }
      if (!CITY_TITLES.includes(v.title)) {
        expect(v.titleCity, `${c.name} is not a city title`).toBeUndefined();
      }
    }
  });
});
