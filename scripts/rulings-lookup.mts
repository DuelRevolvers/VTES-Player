/** Offline lookup in the pinned vtes-rulings snapshot. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

type Ruling = string | { text: string; overrides?: Record<string, string> };
type Database = {
  rulings: Record<string, Ruling[]>;
  groups: Record<string, Record<string, string>>;
  references: Record<string, string>;
  cards: Record<string, { card: { id: number; name: string } }>;
};

export function loadDatabase(root = process.cwd()): Database {
  const readYaml = (file: string) => parse(readFileSync(resolve(root, "docs/rules-reference/vtes-rulings", file), "utf8"));
  return {
    rulings: readYaml("rulings.yaml"), groups: readYaml("groups.yaml"),
    references: readYaml("references.yaml"),
    cards: JSON.parse(readFileSync(resolve(root, "src/cards/registry.json"), "utf8")).entries,
  };
}
const normalized = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
const idOf = (key: string) => key.split("|", 1)[0]!;

export function lookup(db: Database, query: string): string {
  const needle = normalized(query.trim());
  if (!needle) throw new Error("Podaj nazwę lub ID karty.");
  const cards = new Map<string, Set<string>>();
  const add = (id: string, name: string) => {
    if (!cards.has(id)) cards.set(id, new Set());
    cards.get(id)!.add(name);
  };
  for (const { card } of Object.values(db.cards)) add(String(card.id), card.name);
  for (const key of Object.keys(db.rulings)) if (/^\d+\|/.test(key)) add(idOf(key), key.slice(key.indexOf("|") + 1));
  for (const group of Object.values(db.groups)) for (const key of Object.keys(group)) add(idOf(key), key.slice(key.indexOf("|") + 1));
  const matching = [...cards].filter(([id, names]) => /^\d+$/.test(needle) ? id === needle : [...names].some(name => normalized(name).includes(needle)));
  if (!matching.length) return `Nie znaleziono karty: ${query}.`;
  const blocks: string[] = [];
  for (const [id, names] of matching.sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const lines = [`${id} | ${[...names].join(" / ")}`];
    const references = new Set<string>();
    const print = (items: Ruling[] | undefined, group = false) => {
      if (!items?.length) { lines.push("  (brak wpisu w tej migawce)"); return; }
      for (const item of items) {
        const override = typeof item === "string" ? undefined : Object.entries(item.overrides ?? {}).find(([key]) => idOf(key) === id)?.[1];
        const text = typeof item === "string" ? item : override ?? item.text;
        lines.push(`  - ${text}`);
        // Overrides do not always repeat the references. Show the default
        // wording separately, rather than attributing its sources to the override.
        const defaultText = typeof item === "string" || !override ? "" : item.text;
        if (defaultText) lines.push(`    Ogólny tekst grupy (zob. źródła): ${defaultText}`);
        for (const match of (text + " " + defaultText).matchAll(/\[((?:ANK|LSJ|PIB|RTR|RBK|TOM|SFC|JON)\s+[^\]]+)\]/g)) references.add(match[1]!.replace(/\s+/g, " "));
      }
      if (group) lines.push("  (dotyczy grupy; sprawdź warunki i ewentualne ograniczenie wariantu)");
    };
    const directKey = Object.keys(db.rulings).find(key => idOf(key) === id);
    lines.push("Interpretacje karty:");
    print(directKey ? db.rulings[directKey] : undefined);
    for (const [groupKey, members] of Object.entries(db.groups)) {
      const member = Object.entries(members).find(([key]) => idOf(key) === id);
      if (!member) continue;
      lines.push(`Grupa ${groupKey}${member[1] ? ` (warunek: ${member[1]})` : ""}:`);
      print(db.rulings[groupKey], true);
    }
    if (references.size) {
      lines.push("Źródła:");
      for (const ref of references) lines.push(`  ${ref}: ${db.references[ref] ?? "brak adresu w migawce"}`);
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) {
    console.error('Użycie: npm run rules:lookup -- "The Sleeping Mind" lub npm run rules:lookup -- 102082');
    process.exitCode = 2;
  } else {
    console.log(lookup(loadDatabase(), query));
  }
}
