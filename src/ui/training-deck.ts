/** Resolve the candidate's deck at run start; never silently drop cards. */
import registry from "../cards/registry.json";
import type { CardRegistry } from "../cards/types.ts";
import { importDeck, preconDeck } from "./deckimport.ts";
import type { SavedDeck } from "./decklibrary.ts";
import { validateDecks, type DeckList } from "./decks.ts";

export type TrainingDeckSource = { kind: "paste"; text: string } | { kind: "saved"; deck: SavedDeck };

/** Full decks only. The returned deck is an independent run snapshot. */
export function resolveTrainingDeck(source: TrainingDeckSource): { deck: DeckList; warnings: string[] } {
  const inner = source.kind === "saved" ? source.deck.source : source;
  let deck: DeckList | null = null;
  if (inner.kind === "paste") {
    // Avoid expanding unbounded copy counts from pasted or saved text.
    // These are UI safety limits, not VTES deck-construction rules.
    if (inner.text.length > 100_000) throw new Error("Deck text exceeds 100,000 characters.");
    let copies = 0;
    for (const line of inner.text.split(/\r?\n/)) {
      const count = /^\s*(\d+)\s*(?:x\b)?\s*(?:[:.\-]\s+)?\s*\S/i.exec(line);
      if (count) copies += Number(count[1]);
      if (!Number.isFinite(copies) || copies > 2_000) throw new Error("Deck list exceeds the Lab limit of 2,000 listed copies.");
    }
    const parsed = importDeck(inner.text, "Candidate");
    if (!parsed.deck) {
      const issues = [
        ...parsed.report.unknown.map((p) => `line ${p.line}: ${p.text} — ${p.reason}`),
        ...parsed.report.unsupported.map((c) => `unsupported: ${c.name}`),
        ...parsed.report.illegal,
      ];
      throw new Error(`Cannot use deck: ${issues.join("; ") || "deck list is invalid"}`);
    }
    deck = parsed.deck;
  } else {
    const reg = registry as unknown as CardRegistry;
    const precon = reg.precons.find((p) => p.set === inner.set && p.name === inner.name);
    if (!precon) throw new Error(`Saved deck is unavailable: ${inner.set} / ${inner.name}`);
    const missing = precon.cards.filter(({ id }) => !reg.entries[id]);
    if (missing.length) throw new Error(`Saved deck has unknown card IDs: ${missing.map((c) => c.id).join(", ")}`);
    deck = preconDeck(inner.set, inner.name, "Candidate");
    if (!deck) throw new Error("Saved deck is unavailable.");
  }
  // Unlike the ordinary table's explicitly declared half-deck option, Lab
  // games start all five players with full decks and the same rules.
  const check = validateDecks([deck]);
  const issues = [
    ...check.unknown.map((c) => `unknown: ${c}`),
    ...check.unsupported.map((c) => `unsupported: ${c}`),
    ...check.badCryptIds.map((id) => `unknown crypt ID: ${id}`),
    ...check.illegalDecks.map((p) => p.problem),
  ];
  if (issues.length) throw new Error(`Cannot use deck: ${issues.join("; ")}`);
  return { deck, warnings: check.inertAbilities };
}
