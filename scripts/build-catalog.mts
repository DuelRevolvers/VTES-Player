/**
 * Build src/cards/catalog.json — every card in the game, for BROWSING.
 *
 * The registry is the pool the engine deals from; this is the reference
 * book the Deck Builder's search reads (docs/deck-builder-design.md §2).
 * It is derived from the same `data/vtes-raw.json` snapshot, so there is
 * no second fetch and no second source of truth — and it reads the
 * REGISTRY for `status`, which is why `npm run cards:registry` runs this
 * second rather than leaving the two to be run by hand in the right
 * order.
 *
 * What it drops is as deliberate as what it keeps. The raw snapshot is
 * 7.3MB; translations, rulings, per-set scans and set metadata are the
 * bulk of that and none of it is on screen. What is left is 1.6MB, which
 * is a lazily-loaded chunk rather than part of the first paint
 * (docs/pages-design.md).
 *
 * Run: npm run cards:catalog  (or npm run cards:registry, which chains it)
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadRawCards, isCryptRaw, parseCost, type RawKrcgCard } from "./krcg-common.mts";
import type { CatalogCard, CatalogFile, CatalogStatus } from "../src/cards/catalog.ts";
import type { CardRegistry } from "../src/cards/types.ts";

const RAW = path.join(process.cwd(), "data", "vtes-raw.json");
const REGISTRY = path.join(process.cwd(), "src", "cards", "registry.json");
const OUT = path.join(process.cwd(), "src", "cards", "catalog.json");

/**
 * The sect clause every vampire opens with, read the way the importer
 * reads it (src/ui/cardinfo.ts).
 *
 * "Advanced," is stripped first for the same reason it is there: it is a
 * CARD-TYPE marker sitting in front of the clause (p. 6), and anchoring
 * the sect to the start of the text without removing it hid the sect on
 * all 22 advanced vampires in the pool for a day
 * (docs/pool-widening-design.md §5).
 */
const SECT = /^(Camarilla|Sabbat|Anarch|Independent|Laibon)\b/;

/**
 * The sect a LIBRARY card demands, read out of its text.
 *
 * KRCG has no field for it — a library card's sect requirement is a
 * printed sentence, "Requires a Sabbat vampire." — so unlike clan and
 * discipline it has to be parsed. It is parsed HERE, once, at build
 * time: the alternative is re-reading 4,149 card texts on every
 * keystroke of the search.
 *
 * Deliberately narrow. It matches only the requirement PHRASING —
 * "Requires a/an/the [ready] <Sect>", plus one "or <Sect>" for the eight
 * cards that take either — and so it does NOT match the 161 cards that
 * merely mention a sect in their effect ("Only usable if a Camarilla or
 * Sabbat vampire is bleeding"), which are not requirements at all.
 *
 * It also cannot match "non-Camarilla", because the article and the sect
 * are adjacent in the pattern and "non-" sits between them. A negation
 * read as a requirement would hide exactly the cards a deck of that sect
 * most wants.
 *
 * TWO THINGS MAKE IT PRECISE, and both were found by checking the output
 * rather than by reasoning about it:
 *
 *  - It demands "Requires", WITH the s, at the START of a sentence. An
 *    earlier `Requires?` anywhere in the text matched An Anarch
 *    Manifesto's "+1 stealth on actions that require an anarch" — a
 *    description of what other cards need, read as a rule about this
 *    one.
 *  - It stops at the sentence, so Bear-Baiting's "Requires a ready
 *    anarch. Only usable when an older non-Anarch vampire blocks" takes
 *    the requirement and ignores the rest.
 */
const SECTS = "Camarilla|Sabbat|Anarch|Independent|Laibon";
const REQUIRES_SECT = new RegExp(
  `(?:^|[.\\n]\\s*)Requires\\s+(?:an?|the)\\s+(?:ready\\s+)?(${SECTS})\\b(?:\\s+or\\s+(${SECTS})\\b)?`,
  "gi",
);

function requiredSects(card: RawKrcgCard): string[] {
  if (isCryptRaw(card)) return [];
  const text = card.card_text ?? "";
  const out = new Set<string>();
  for (const m of text.matchAll(REQUIRES_SECT)) {
    // Capitalised to one spelling: the cards print both "Anarch" and
    // "anarch", and a set holding both would make the filter miss half
    // of them.
    for (const found of [m[1], m[2]]) {
      if (found) out.add(found[0]!.toUpperCase() + found.slice(1).toLowerCase());
    }
  }
  return [...out].sort();
}

/**
 * The clans a LIBRARY card demands.
 *
 * A CLAN ICON ON A MINION CARD IS A REQUIREMENT (p. 10) and KRCG's text
 * does not repeat it — but **a master is the exception**, and that is
 * not a detail: 179 masters carry a clan field, and on them it is a
 * label rather than a gate. Achilles' Heel is played on a vampire
 * another Methuselah controls; Acquired Ventrue Assets counts Giovanni.
 * Treating those as requirements would hide cards any deck can play.
 */
const MINION_TYPES = [
  "Action",
  "Action Modifier",
  "Ally",
  "Combat",
  "Equipment",
  "Political Action",
  "Reaction",
  "Retainer",
];

function requiredClans(card: RawKrcgCard): string[] {
  if (isCryptRaw(card)) return [];
  const types = card.types ?? [];
  if (!types.some((t) => MINION_TYPES.includes(t))) return [];
  return [...(card.clans ?? [])].sort();
}

function sectOf(card: RawKrcgCard): string | null {
  if (!isCryptRaw(card)) return null;
  const text = (card.card_text ?? "").trim().replace(/^Advanced,\s*/i, "");
  const m = SECT.exec(text);
  return m ? m[1]! : null;
}

/**
 * Every set the card was printed in, oldest first, with its first date —
 * AND the date of each set itself.
 *
 * The second half is not the same question as the first and that is why
 * it is here rather than being derived later. A card's `firstPrinted` is
 * its earliest printing ANYWHERE; a set's date is a fact about the set.
 * Deriving one from the other looks obvious and is wrong the moment a set
 * contains a reprint: New Blood III (2025) holds cards from 1994, so the
 * earliest `firstPrinted` among its cards is 1994 and "newest set first"
 * filed a 2025 set behind a 2023 promo. Caught by the facet test.
 */
function printings(
  card: RawKrcgCard,
  setDates: Map<string, string>,
): { sets: string[]; firstPrinted: string } {
  const sets = (card.sets ?? {}) as Record<string, unknown>;
  const dated: Array<{ name: string; date: string }> = [];
  for (const [name, info] of Object.entries(sets)) {
    // KRCG records a set as a list of printings, each with a release
    // date — except the odd one that is a bare object. Take the earliest
    // date we can see and fall back to a far-future string, so an
    // undated printing sorts LAST rather than pretending to be from 1994.
    const rows = Array.isArray(info) ? info : [info];
    let date = "9999-12-31";
    for (const row of rows) {
      const d = (row as { release_date?: unknown }).release_date;
      if (typeof d === "string" && d < date) date = d;
    }
    dated.push({ name, date });
    // THIS printing's date is the set's, and the earliest one wins —
    // every card in a set carries the same release date for it, so this
    // is a fact being read many times rather than an average.
    const seen = setDates.get(name);
    if (seen === undefined || date < seen) setDates.set(name, date);
  }
  dated.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1));
  return {
    sets: dated.map((d) => d.name),
    firstPrinted: dated[0]?.date ?? "9999-12-31",
  };
}

/**
 * How completely we play this card — the three honest states.
 *
 * A vampire whose whole text is its sect/title clause is WHOLE without an
 * implementation: there is nothing to implement. 118 V5 vampires are in
 * that position, and reading `supported` alone would report every one of
 * them as broken. The test beside this asserts the middle state is empty,
 * which is the "no partial cards" rule restated where a player can see
 * it (CLAUDE.md; src/cards/catalog.ts).
 */
function statusOf(card: RawKrcgCard, reg: CardRegistry): CatalogStatus {
  const entry = reg.entries[card.id];
  if (!entry) return "absent";
  if (entry.supported) return "playable";
  if (!isCryptRaw(card)) return "pool";
  const text = (card.card_text ?? "").trim().replace(/^Advanced,\s*/i, "");
  // "Camarilla Prince of Berlin." and nothing after it — no ability.
  return /^[^.:]*\.\s*$/.test(text) ? "playable" : "pool";
}

function toCatalog(
  card: RawKrcgCard,
  reg: CardRegistry,
  setDates: Map<string, string>,
): CatalogCard {
  const crypt = isCryptRaw(card);
  const pool = parseCost(card.pool_cost);
  const blood = parseCost(card.blood_cost);
  const conviction = parseCost(card["conviction_cost"] as number | string | undefined);
  const { sets, firstPrinted } = printings(card, setDates);

  const levels: Record<string, "basic" | "superior"> = {};
  const disciplines: string[] = [];
  for (const d of card.disciplines ?? []) {
    if (!d) continue;
    const code = d.toLowerCase();
    disciplines.push(code);
    // KRCG encodes a crypt level by CASE — "dom" basic, "DOM" superior —
    // the same convention `parseCryptDisciplines` reads. A library card's
    // codes are always lowercase because they are a requirement, not a
    // level, so this records nothing for them and the field stays empty.
    if (crypt) levels[code] = d === d.toUpperCase() ? "superior" : "basic";
  }

  const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

  return {
    id: card.id,
    name: card.name,
    printedName: str(card["printed_name"]) ?? card.name,
    kind: crypt ? "crypt" : "library",
    types: card.types ?? [],
    clans: card.clans ?? [],
    disciplines,
    levels,
    capacity: typeof card.capacity === "number" ? card.capacity : null,
    group: crypt ? (card.group === undefined ? "ANY" : String(card.group)) : null,
    sect: sectOf(card),
    requiresClans: requiredClans(card),
    requiresSects: requiredSects(card),
    title: str(card["title"]),
    path: str(card.path),
    advanced: /advanced/i.test(String(card["adv"] ?? "")) || card["adv"] === true,
    poolCost: pool.value,
    bloodCost: blood.value,
    convictionCost: conviction.value,
    rawCost: pool.raw ?? blood.raw ?? null,
    burnOption: card.burn_option === true,
    banned: str(card["banned"]),
    text: card.card_text ?? "",
    flavor: str(card["flavor_text"]),
    artists: (card["artists"] as string[] | undefined) ?? [],
    sets,
    firstPrinted,
    image: str(card.url) ?? "",
    status: statusOf(card, reg),
  };
}

async function main(): Promise<void> {
  const raw = await loadRawCards(RAW);
  const reg = JSON.parse(await readFile(REGISTRY, "utf-8")) as CardRegistry;

  const setDates = new Map<string, string>();
  const cards = raw
    .map((c) => toCatalog(c, reg, setDates))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  const file: CatalogFile = {
    cards,
    sets: Object.fromEntries([...setDates].sort((a, b) => a[0].localeCompare(b[0]))),
  };
  await writeFile(OUT, JSON.stringify(file), "utf-8");

  const counts = cards.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `Catalogue: ${cards.length} cards — ` +
      `${counts["playable"] ?? 0} playable, ${counts["pool"] ?? 0} partial, ` +
      `${counts["absent"] ?? 0} not in the pool`,
  );
  if ((counts["pool"] ?? 0) > 0) {
    // "No partial cards" is a binding rule, and this is the pipeline
    // noticing it has been broken rather than a test finding out later.
    console.warn(`WARNING: ${counts["pool"]} card(s) are dealt but not whole.`);
  }
  console.log(`Wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
