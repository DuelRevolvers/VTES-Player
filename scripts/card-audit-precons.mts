/** Cross-reference selectable precons against the existing card audit.
 * This is an inventory of recorded evidence, not a new complete rules audit. */
import { readFileSync, writeFileSync } from "node:fs";
import { supportedPrecons } from "../src/ui/deckimport.ts";
import type { CardRegistry } from "../src/cards/types.ts";
import { VtesEngine } from "../src/engine/engine.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../tests/engine/fixtures.ts";

type Finding = { id: number; name: string; status: string; evidence: string };
type Deck = CardRegistry["precons"][number];
const registry = JSON.parse(readFileSync("src/cards/registry.json", "utf8")) as CardRegistry & { fetchedAt: string };
const findings = JSON.parse(readFileSync("docs/card-audit/manual-findings.json", "utf8")) as Finding[];
const byId = new Map(findings.map((f) => [f.id, f]));
const summaries = supportedPrecons();
const key = (set: string, name: string) => JSON.stringify([set, name]);
const summariesByKey = new Map(summaries.map((s) => [key(s.set, s.name), s]));
const selected = registry.precons.filter((d) => {
  const summary = summariesByKey.get(key(d.set, d.name));
  return summary && (summary.playable || summary.halfDeck);
});
const open = new Set(["CODE_DISCREPANCY", "PARTIAL_FIX", "CONFIRMED_BUG", "UNRESOLVED"]);
const name = (deck: Deck) => `${deck.set} / ${deck.name}`;
const deckIds = (deck: Deck) => [...new Set(deck.cards.map((c) => c.id))];
const allIds = [...new Set(selected.flatMap(deckIds))].sort((a, b) => a - b);
const deckNamesById = new Map(allIds.map((id) => [id, selected.filter((d) => deckIds(d).includes(id)).map(name)]));
const status = (id: number) => byId.get(id)?.status ?? "UNREVIEWED";
const count = (statuses: string[]) => allIds.filter((id) => statuses.includes(status(id))).length;
const problemIds = allIds.filter((id) => open.has(status(id)));
const unreviewedIds = allIds.filter((id) => status(id) === "UNREVIEWED");
const unresolvedDecks = selected.filter((d) => deckIds(d).some((id) => open.has(status(id)) || status(id) === "UNREVIEWED"));
const missing = allIds.filter((id) => !registry.entries[id]);
const unsupported = allIds.filter((id) => registry.entries[id] && !registry.entries[id]!.supported);
const md = (text: string) => text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// Diagnostic observations, not assertions that all clauses are correct.
function bloodDollDiagnostic(): string {
  try {
    const state = threeSeatGame();
    const frame = state.frames[0]!;
    if (frame.kind !== "turn") throw new Error("brak ramki tury");
    frame.phase = "master"; frame.masterActionsLeft = 1;
    state.seats[0]!.hand.push({ id: "bd", name: "Blood Doll" });
    state.seats[0]!.minions.push(makeAlly("ally", "Alice", 3));
    const options = new VtesEngine(state, testRegistry).decision()!.options;
    const ally = options.some((o) => o.kind === "playCard" && o.name === "Blood Doll" && o.params["target"] === "ally");
    return ally
      ? "W syntetycznej grze z własnym wampirem i ally opcja zagrania na ally jest dostępna, choć tekst wymaga wampira. Sprawdzono ofertę, nie wszystkie skutki zagrania."
      : "Nie zaoferowano zagrania na ally w tym scenariuszu; nie dowodzi to pełnej poprawności karty.";
  } catch (e) { return `Nie udało się przeprowadzić scenariusza: ${e instanceof Error ? e.message : String(e)}.`; }
}
function villeinDiagnostic(): string {
  try {
    const state = threeSeatGame();
    const frame = state.frames[0]!;
    if (frame.kind !== "turn") throw new Error("brak ramki tury");
    frame.phase = "master"; frame.masterActionsLeft = 3;
    state.seats[0]!.minions[0]!.blood = 5;
    state.seats[0]!.hand.push({ id: "vl1", name: "Villein" }, { id: "vl2", name: "Villein" });
    const engine = new VtesEngine(state, testRegistry);
    const first = engine.decision()!.options.find((o) => o.kind === "playCard" && o.name === "Villein" && o.id.includes(":2:") && o.card === "vl1");
    if (!first) throw new Error("brak opcji pierwszej Villein");
    runTrace(engine, [["Alice", first.id], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    const next = engine.decision()!.options.find((o) => o.kind === "playCard" && o.name === "Villein" && o.card === "vl2" && o.params["target"] === "V1");
    if (!next || next.kind !== "playCard" || !next.cost) throw new Error("brak drugiej opcji z kosztem");
    const correct = next.cost.pool === 1 ? "zgodny z wymaganym +1 pool w tym scenariuszu" : "niezgodny z wymaganym +1 pool w tym scenariuszu";
    return `Po zagraniu pierwszej Villein na wampira z 5 blood i przeniesieniu 2, druga opcja na tego wampira ma koszt **${next.cost.pool} pool** — ${correct}. To kontrola konkretnego scenariusza, nie wszystkich klauzul.`;
  } catch (e) { return `Nie udało się przeprowadzić scenariusza: ${e instanceof Error ? e.message : String(e)}.`; }
}
const output = [
  "# Audyt kart w przygotowanych taliach",
  "",
  `Zakres: ${selected.length} talii dostępnych w wyborze (shell.ts: playable || halfDeck): ${summaries.filter((s) => s.playable).length} pełnych i ${summaries.filter((s) => s.halfDeck).length} half-decków. Źródło talii: src/cards/registry.json, snapshot ${registry.fetchedAt}.`,
  "",
  `To zestawienie aktualnych wpisów audytu, nie ponowna weryfikacja wszystkich klauzul ${allIds.length} kart. Do identyfikacji statusów użyto ǀdocs/card-audit/manual-findings.jsonǀ; statusy i uzasadnienia mogą wymagać aktualizacji. Sama flaga ǀsupportedǀ, handler ani brak wykrytych błędów nie dowodzą pełnej poprawności.`.replace(/ǀ/g, "`"),
  "",
  "## Podsumowanie",
  "",
  `- Unikalne karty: **${allIds.length}**; z wpisem w audycie: **${allIds.length - unreviewedIds.length}**; bez wpisu: **${unreviewedIds.length}**. Brakujące ID w registry: **${missing.length}**; karty bez flagi supported: **${unsupported.length}**.`,
  `- Otwarte ustalenia dotyczą **${problemIds.length} różnych kart**: CODE_DISCREPANCY ${count(["CODE_DISCREPANCY"])}, PARTIAL_FIX ${count(["PARTIAL_FIX"])}, CONFIRMED_BUG ${count(["CONFIRMED_BUG"])}, UNRESOLVED ${count(["UNRESOLVED"])}. UNRESOLVED oznacza kwestię nierozstrzygniętą, nie potwierdzony błąd.`,
  `- **${unresolvedDecks.length}/${selected.length} talii** zawiera co najmniej jeden otwarty lub niezweryfikowany wpis. Pozostałe talie nie mają takich wpisów, ale to nadal nie dowód kompletnej poprawności.`,
  `- REVIEWED_NO_ISSUE_FOUND: **${count(["REVIEWED_NO_ISSUE_FOUND"])}** kart; FIXED_TARGETED: **${count(["FIXED_TARGETED"])}**. Obie klasy oznaczają ograniczony zakres sprawdzenia/naprawy, a nie certyfikat wszystkich interakcji.`,
  "",
  "## Dodatkowe scenariusze odtworzone w silniku",
  "",
  `- **Blood Doll (100199)**: ${bloodDollDiagnostic()} Liczba talii: ${deckNamesById.get(100199)?.length ?? 0}.`,
  `- **Villein (102121)**: ${villeinDiagnostic()} Liczba talii: ${deckNamesById.get(102121)?.length ?? 0}.`,
  "",
  "Regeneracja: `npx tsx scripts/card-audit-precons.mts`. Scenariusze używają syntetycznych fixture'ów z `tests/engine/fixtures.ts`; dane produkcyjne i silnik są takie jak w aplikacji.",
  "",
  "## Zestawienie talii",
  "",
  "Liczby to **różne ID kart**, a nie liczba kopii. Listy obejmują tylko otwarte ustalenia i brakujące wpisy; szczegółową ewidencję wszystkich kart i ich dowodów zawiera `preconstructed-cards.csv`.",
  "",
  "| Zestaw / talia | Typ | Różnych kart | Otwarte / bez wpisu | Karty z otwartym ustaleniem |",
  "|---|---|---:|---:|---|",
];
for (const deck of selected) {
  const ids = deckIds(deck);
  const problems = ids.filter((id) => open.has(status(id)) || status(id) === "UNREVIEWED");
  const summary = summariesByKey.get(key(deck.set, deck.name))!;
  const names = problems.map((id) => `[${md(byId.get(id)?.name ?? String(id))}](#karta-${id})`).join(", ") || "—";
  output.push(`| ${md(name(deck))} | ${summary.playable ? "pełna" : "half-deck"} | ${ids.length} | ${problems.length} | ${names} |`);
}
output.push("", "## Otwarte ustalenia — karty", "", "Poniższe opisy przytoczono z audytu. CODE_DISCREPANCY bywa oparte wyłącznie na analizie statycznej; CONFIRMED_BUG jest statusem historycznym i nie zawsze oznacza odtworzenie nowym testem. Nie wolno traktować UNRESOLVED jako potwierdzonego błędu.", "");
for (const id of [...problemIds, ...unreviewedIds]) {
  const f = byId.get(id);
  output.push(`<a id="karta-${id}"></a>`, `### ${f?.name ?? `Nieznana karta ${id}`} (${id}) — ${status(id)}`,
    "", `Występuje w **${deckNamesById.get(id)?.length ?? 0}** taliach. ${f?.evidence ?? "Brak wpisu w manual-findings.json."}`, "");
}
writeFileSync("docs/card-audit/preconstructed-decks.md", output.join("\n").replace(/\u007f/g, "`") + "\n");
const rows = [["id", "card", "kind", "supported", "audit_status", "deck_count", "decks", "evidence"]];
for (const id of allIds) {
  const entry = registry.entries[id];
  const f = byId.get(id);
  rows.push([String(id), entry?.card.name ?? f?.name ?? "", entry?.card.kind ?? "", String(entry?.supported ?? false), status(id),
    String(deckNamesById.get(id)?.length ?? 0), (deckNamesById.get(id) ?? []).join("; "), f?.evidence ?? ""]);
}
writeFileSync("docs/card-audit/preconstructed-cards.csv", rows.map((row) => row.map(csv).join(",")).join("\n") + "\n");
console.log(`${selected.length} selectable decks, ${allIds.length} unique cards, ${problemIds.length} open findings, ${unresolvedDecks.length} affected decks`);
