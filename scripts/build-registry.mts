/**
 * Build src/cards/registry.json from the KRCG snapshot, filtered to the set
 * keys listed in config/v5-sets.json.
 *
 * Every card in the pool gets a registry entry with supported: false.
 * Support flags are maintained separately in config/supported.json
 * (id -> true) so re-running the pipeline never clobbers implementation
 * status. A card is only ever marked supported by adding its id there —
 * which we do when its effects implementation and scenario test land.
 *
 * Outputs:
 *   src/cards/registry.json  — consumed by the app (bundled by Vite)
 *   data/registry-report.txt — human-readable pool summary for review
 *
 * Run: npm run cards:registry
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  loadRawCards,
  isCryptRaw,
  parseCost,
  parseCryptDisciplines,
  type RawKrcgCard,
} from "./krcg-common.mts";
import type {
  CardDef,
  CardRegistry,
  CryptCardDef,
  LibraryCardDef,
  LibraryCardType,
  PreconDeck,
} from "../src/cards/types.ts";

const RAW = path.join(process.cwd(), "data", "vtes-raw.json");
const SETS_CONFIG = path.join(process.cwd(), "config", "v5-sets.json");
const CRYPT_GROUPS_CONFIG = path.join(process.cwd(), "config", "crypt-groups.json");
const SUPPORTED_CONFIG = path.join(process.cwd(), "config", "supported.json");
const OUT_REGISTRY = path.join(process.cwd(), "src", "cards", "registry.json");
const OUT_REPORT = path.join(process.cwd(), "data", "registry-report.txt");

const LIBRARY_TYPES: LibraryCardType[] = [
  "Master",
  "Action",
  "Action Modifier",
  "Ally",
  "Combat",
  "Equipment",
  "Event",
  "Political Action",
  "Reaction",
  "Retainer",
];

async function readJson<T>(p: string, fallback: T | null = null): Promise<T> {
  try {
    return JSON.parse(await readFile(p, "utf-8")) as T;
  } catch (err) {
    if (fallback !== null) return fallback;
    throw new Error(`Could not read ${p}: ${(err as Error).message}`);
  }
}

function toCryptDef(card: RawKrcgCard, poolSets: string[]): CryptCardDef {
  const groupRaw = card.group;
  const group =
    typeof groupRaw === "number"
      ? groupRaw
      : groupRaw && Number.isFinite(Number(groupRaw))
        ? Number(groupRaw)
        : "ANY";
  const def: CryptCardDef = {
    kind: "crypt",
    id: card.id,
    name: card.name,
    clan: card.clans?.[0] ?? "Unknown",
    capacity: typeof card.capacity === "number" ? card.capacity : 0,
    group,
    disciplines: parseCryptDisciplines(card.disciplines),
    cardText: card.card_text ?? "",
    advanced: /advanced/i.test(String(card.adv ?? "")) || card.adv === true,
    image: typeof card.url === "string" ? card.url : "",
    sets: intersectSets(card, poolSets),
  };
  // The Path of Enlightenment, printed on every Sabbat V5 vampire and on no
  // other. Dropping it here is what made the Path cards look unbuildable
  // for a day (docs/path-cards-design.md §0) — the data was in the KRCG
  // snapshot the whole time and simply never reached the registry.
  if (typeof card.path === "string" && card.path !== "") def.path = card.path;
  return def;
}

function toLibraryDef(card: RawKrcgCard, poolSets: string[]): LibraryCardDef {
  const pool = parseCost(card.pool_cost);
  const blood = parseCost(card.blood_cost);
  const types = (card.types ?? []).filter((t): t is LibraryCardType =>
    (LIBRARY_TYPES as string[]).includes(t)
  );
  const def: LibraryCardDef = {
    kind: "library",
    id: card.id,
    name: card.name,
    types,
    clans: card.clans ?? [],
    disciplines: (card.disciplines ?? []).map(String),
    poolCost: pool.value,
    bloodCost: blood.value,
    cardText: card.card_text ?? "",
    burnOption: card.burn_option === true,
    image: typeof card.url === "string" ? card.url : "",
    sets: intersectSets(card, poolSets),
  };
  const raw = pool.raw ?? blood.raw;
  if (raw !== undefined) def.rawCost = raw;
  return def;
}

function intersectSets(card: RawKrcgCard, poolSets: string[]): string[] {
  const keys = Object.keys(card.sets ?? {});
  return keys.filter((k) => poolSets.includes(k));
}

/** Crypt admitted from outside the V5 sets — see config/crypt-groups.json. */
interface CryptWidening {
  /**
   * ONE CLAN AT A TIME (owner ruling, 2026-11-08). Each entry opens the
   * named groups of ONE clan. A bare group list opened every clan in that
   * group at once — 126 vampires for groups 4 and 5 alone — which is not
   * how the §7 waves are meant to land. The clan is the KRCG clan name
   * (`clans[0]`), which is also the registry's `clan`.
   */
  open: Array<{ clan: string; groups: number[] }>;
  excludeSects?: string[];
}

/**
 * Does this vampire do everything it prints? (§0, "no partial cards".)
 *
 * Two ways to be whole, and they are the same standard the V5 crypt
 * already meets: the ability is implemented, or there is no ability —
 * a card whose text is a bare sect/title clause and nothing else needs
 * no code to be completely correct.
 *
 * The "Advanced," marker is stripped first because it sits BEFORE the
 * clause; reading it as part of the text would call every advanced
 * vampire an ability-bearer.
 */
function isWhole(card: RawKrcgCard, supported: Record<string, boolean>): boolean {
  if (supported[String(card.id)] === true) return true;
  const text = (card.card_text ?? "").trim().replace(/^Advanced,\s*/i, "");
  return /^[^.:]*\.\s*$/.test(text);
}

/**
 * The vampires admitted from outside the V5 sets.
 *
 * THREE GATES, and each is load-bearing:
 *
 *  - **Vampire, never Imbued.** `isCryptRaw` counts both, because in the
 *    V5 pool there are no Imbued and the distinction never came up. They
 *    are a different card type — life instead of blood, conviction,
 *    powers — and the engine has no model for them, so admitting one
 *    would put a card in the crypt nothing can play.
 *  - **Group.** A deck's crypt may only mix adjacent groups, so a vampire
 *    from a group the pool cannot build alongside is browsing material
 *    rather than playable material.
 *  - **Sect.** A sect the engine's `Sect` union does not carry parses to
 *    null, and a sectless vampire is quietly wrong rather than loudly
 *    wrong. Excluded by name until there is a decision about it — which
 *    is the print-faithful reading (docs/pool-widening-design.md §4a):
 *    we do not relabel a Laibon as Independent to make it fit.
 *
 * Library cards are never admitted here, and that is the whole point:
 * an unimplemented library card makes a deck unplayable, an unimplemented
 * crypt ability is reported as inert and the vampire plays fine.
 */
function widenedCrypt(
  cards: RawKrcgCard[],
  already: Set<number>,
  cfg: CryptWidening,
  supported: Record<string, boolean>,
): RawKrcgCard[] {
  if (cfg.open.length === 0) return [];
  // A misspelt clan matches nothing and opens nothing, which looks exactly
  // like a closed config. Refuse it loudly instead.
  for (const o of cfg.open) {
    if (!cards.some((c) => (c.types ?? []).includes("Vampire") && c.clans?.[0] === o.clan)) {
      throw new Error(`config/crypt-groups.json: no vampire has the clan "${o.clan}"`);
    }
  }
  const isOpen = (c: RawKrcgCard): boolean =>
    cfg.open.some((o) => o.clan === c.clans?.[0] && o.groups.includes(Number(c.group)));
  const excluded = (cfg.excludeSects ?? []).map((s) => s.toLowerCase());
  return cards.filter((c) => {
    if (already.has(c.id)) return false;
    if (!(c.types ?? []).includes("Vampire")) return false;
    if (!isOpen(c)) return false;
    // WHOLE, OR NOT AT ALL (docs/pool-widening-design.md §0). A vampire
    // comes in when its ability is implemented, or when it prints no
    // ability to implement — never on the strength of its stats with its
    // text doing nothing. Enforced HERE rather than trusted to whoever
    // edits the config, because the first widening admitted 1,104 inert
    // abilities precisely by opening a group and not looking further.
    if (!isWhole(c, supported)) return false;
    // The "Advanced," marker comes BEFORE the sect, so reading the first
    // word alone let four advanced Laibon through the exclusion. Stripped
    // here exactly as `importCryptCard` strips it — one convention, and
    // both places that read a sect clause have to know it.
    const text = (c.card_text ?? "").trim().replace(/^Advanced,\s*/i, "");
    const sect = /^([A-Za-z]+)/.exec(text)?.[1]?.toLowerCase() ?? "";
    return !excluded.includes(sect);
  });
}

/**
 * The library cards admitted from outside the V5 sets
 * (docs/pool-widening-design.md §6).
 *
 * THERE IS NO CONFIG FILE FOR THIS, and that is the design.
 * `config/supported.json` already says which cards are implemented, and
 * for the library "implemented" and "may be in the pool" are the same
 * question: an unimplemented library card makes every deck holding it
 * unplayable, and §0 forbids a partial one. So the list of admitted
 * legacy library cards IS the list of implemented ones — the pool cannot
 * get ahead of the card waves because there is no lever to pull that
 * would let it.
 *
 * Contrast `widenedCrypt`, which needs both a config and a wholeness gate:
 * a vampire can be legitimately whole with no implementation at all (it
 * prints no ability), so "supported" is not the same question there.
 */
function widenedLibrary(
  cards: RawKrcgCard[],
  already: Set<number>,
  supported: Record<string, boolean>,
): RawKrcgCard[] {
  return cards.filter(
    (c) => !already.has(c.id) && !isCryptRaw(c) && supported[String(c.id)] === true,
  );
}

/**
 * The preconstructed decks the pool's sets ship with.
 *
 * KRCG records this per CARD — `sets[<set>]` is a list of printings, and a
 * printing that belongs to a precon carries `precon` and `copies`. So a
 * precon deck is assembled by walking every card and collecting the ones
 * that name it, which means the table is derived from the same snapshot as
 * the cards and can never drift from them.
 *
 * A printing with no `precon` is a rarity entry (booster distribution) and
 * is skipped; one with no `copies` is skipped too, since a deck list with
 * no count is not a deck list.
 */
function collectPrecons(cards: RawKrcgCard[], poolSets: string[]): PreconDeck[] {
  const byKey = new Map<string, PreconDeck>();
  for (const card of cards) {
    for (const [set, printings] of Object.entries(card.sets ?? {})) {
      if (!poolSets.includes(set)) continue;
      for (const printing of printings as Array<{ precon?: string; copies?: number }>) {
        const name = printing.precon;
        const copies = printing.copies;
        if (typeof name !== "string" || name === "" || typeof copies !== "number") continue;
        const key = `${set} ${name}`;
        let deck = byKey.get(key);
        if (!deck) {
          deck = { set, name, cards: [] };
          byKey.set(key, deck);
        }
        deck.cards.push({ id: card.id, copies });
      }
    }
  }
  const out = [...byKey.values()];
  // Stable order, so a rebuild produces a byte-identical registry.
  out.sort((a, b) => a.set.localeCompare(b.set) || a.name.localeCompare(b.name));
  for (const deck of out) deck.cards.sort((a, b) => a.id - b.id);
  return out;
}

async function main() {
  const poolSets = await readJson<string[]>(SETS_CONFIG);
  if (!Array.isArray(poolSets) || poolSets.length === 0) {
    throw new Error(
      `${SETS_CONFIG} must be a non-empty array of KRCG set keys. Run "npm run cards:sets" to see the options.`
    );
  }
  const supported = await readJson<Record<string, boolean>>(SUPPORTED_CONFIG, {});
  const cards = await loadRawCards(RAW);

  const inPool = cards.filter((c) => intersectSets(c, poolSets).length > 0);

  // Crypt admitted from outside those sets (docs/pool-widening-design.md).
  // Its own sets are recorded, not the intersection with the V5 list —
  // that intersection is empty by definition here, and a card that says
  // it belongs to no set at all is worse than uninformative.
  const widenCfg = await readJson<CryptWidening>(CRYPT_GROUPS_CONFIG, {
    open: [],
  });
  if (!Array.isArray(widenCfg.open)) {
    throw new Error("config/crypt-groups.json needs an `open` list of { clan, groups }");
  }
  const poolIds = new Set(inPool.map((c) => c.id));
  const extraCrypt = widenedCrypt(cards, poolIds, widenCfg, supported);
  // Library from outside those sets — gated by `supported.json` alone (§6).
  const extraLibrary = widenedLibrary(cards, poolIds, supported);

  const defs: CardDef[] = [
    ...inPool.map((c) => (isCryptRaw(c) ? toCryptDef(c, poolSets) : toLibraryDef(c, poolSets))),
    ...extraCrypt.map((c) => toCryptDef(c, Object.keys(c.sets ?? {}))),
    ...extraLibrary.map((c) => toLibraryDef(c, Object.keys(c.sets ?? {}))),
  ];

  const registry: CardRegistry = {
    fetchedAt: new Date().toISOString(),
    pool: poolSets,
    entries: {},
    // PRECONS STAY V5-ONLY. `collectPrecons` already skips any set not in
    // `poolSets`, and it is handed `inPool` rather than the widened list —
    // a widened crypt card would otherwise drag its legacy set's precons
    // in half-built, since their library cards are not in the pool.
    precons: collectPrecons(inPool, poolSets),
  };
  for (const def of defs) {
    registry.entries[def.id] = {
      card: def,
      supported: supported[String(def.id)] === true,
    };
  }

  await writeFile(OUT_REGISTRY, JSON.stringify(registry, null, 1), "utf-8");

  // Report
  const crypt = defs.filter((d) => d.kind === "crypt");
  const library = defs.filter((d) => d.kind === "library");
  const supportedCount = defs.filter(
    (d) => supported[String(d.id)] === true
  ).length;
  const typeCounts = new Map<string, number>();
  for (const d of library) {
    for (const t of (d as LibraryCardDef).types) {
      typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    }
  }
  const lines = [
    `V5 pool registry — built ${registry.fetchedAt}`,
    `Sets: ${poolSets.join(", ")}`,
    ``,
    `Unique cards:   ${defs.length}`,
    `  Crypt:        ${crypt.length}`,
    `  Library:      ${library.length}`,
    `Supported:      ${supportedCount} / ${defs.length}`,
    `Precon decks:   ${registry.precons.length}`,
    ``,
    `Library by type:`,
    ...[...typeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `  ${t.padEnd(18)} ${n}`),
    ``,
    `Crypt by clan:`,
    ...Object.entries(
      crypt.reduce<Record<string, number>>((acc, c) => {
        const clan = (c as CryptCardDef).clan;
        acc[clan] = (acc[clan] ?? 0) + 1;
        return acc;
      }, {})
    )
      .sort((a, b) => b[1] - a[1])
      .map(([clan, n]) => `  ${clan.padEnd(18)} ${n}`),
  ];
  await writeFile(OUT_REPORT, lines.join("\n") + "\n", "utf-8");
  console.log(lines.join("\n"));
  console.log(`\nWrote ${OUT_REGISTRY}`);
  console.log(`Wrote ${OUT_REPORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
