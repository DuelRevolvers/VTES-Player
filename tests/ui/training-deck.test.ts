import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createInitialMlModel } from "../../src/ai/ml-agent.ts";
import { runLocalMlEpisode } from "../../src/ui/ai-lab.ts";
import { comparisonGame, type ComparisonConfig } from "../../src/ui/bot-comparison.ts";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";
import type { DeckList } from "../../src/ui/decks.ts";
import { preconDeck } from "../../src/ui/deckimport.ts";
import { resolveTrainingDeck } from "../../src/ui/training-deck.ts";
import { buildTrainingState, TRAINING_SEATS } from "../../src/ui/training-games.ts";
import { viewFor } from "../../src/engine/agent.ts";
import { HeuristicWorkerPool } from "../../src/ui/heuristic-worker-pool.ts";
import { MlWorkerPool } from "../../src/ui/ml-worker-pool.ts";
import type { MlModel } from "../../src/ai/ml-agent.ts";

const reg = registry as unknown as CardRegistry;
const precon = preconDeck("Fifth Edition (Anarch)", "Brujah", "Original")!;
function deckText(deck: DeckList): string {
  const crypt = new Map<number, number>();
  for (const card of deck.crypt) crypt.set(card.id, (crypt.get(card.id) ?? 0) + 1);
  const library = new Map<string, number>();
  for (const card of deck.library) library.set(card, (library.get(card) ?? 0) + 1);
  return ["Crypt:", ...[...crypt].map(([id, count]) => `${count} ${reg.entries[id]!.card.name}`),
    "Library:", ...[...library].map(([name, count]) => `${count} ${name}`)].join("\n");
}

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  sent: any[] = [];
  postMessage(message: unknown) { this.sent.push(message); }
  terminate() {}
}

describe("Training Lab candidate decks", () => {
  it("imports a pasted deck and a saved precon without changing card counts", () => {
    const parsed = resolveTrainingDeck({ kind: "paste", text: deckText(precon) }).deck;
    const saved = resolveTrainingDeck({ kind: "saved", deck: { name: "mine", created: "", source: { kind: "precon", set: "Fifth Edition (Anarch)", name: "Brujah" } } }).deck;
    expect(parsed.crypt.map((c) => c.id).sort()).toEqual(precon.crypt.map((c) => c.id).sort());
    expect(parsed.library.slice().sort()).toEqual(precon.library.slice().sort());
    expect(saved).toEqual(parsed);
  });

  it("rejects unknown, malformed, missing saved and oversized decks without dropping cards", () => {
    expect(() => resolveTrainingDeck({ kind: "paste", text: deckText(precon) + "\n1 Not A Real Card" })).toThrow(/line .*Not A Real Card/);
    expect(() => resolveTrainingDeck({ kind: "paste", text: "Crypt:\n1 Invalid" })).toThrow(/Cannot use deck/);
    expect(() => resolveTrainingDeck({ kind: "paste", text: "99999999 Govern the Unaligned" })).toThrow(/2,000/);
    expect(() => resolveTrainingDeck({ kind: "saved", deck: { name: "x", created: "", source: { kind: "precon", set: "missing", name: "missing" } } })).toThrow(/unavailable/);
    expect(() => resolveTrainingDeck({ kind: "paste", text: "Half deck\n1 Invalid" })).toThrow();
  });

  it("deals the selected deck to the candidate in every rotated seat with real-deck opponents", () => {
    const original = structuredClone(precon);
    for (const seatId of TRAINING_SEATS) {
      const state = buildTrainingState(12345, { seat: seatId, deck: precon });
      const candidate = state.seats.find((s) => s.id === seatId)!;
      expect(candidate.deckList!.library.slice().sort()).toEqual(precon.library.slice().sort());
      expect(candidate.deckList!.crypt).toHaveLength(precon.crypt.length);
      expect(candidate.uncontrolled).toHaveLength(4);
      expect(state.seats.every((s) => s.pool === 30 && s.minions.length === 0 && s.deckList)).toBe(true);
      expect(state.seats.filter((s) => s.id !== seatId).map((s) => s.deckList!.library.join("|"))).toHaveLength(4);
      expect(viewFor(state, seatId).seats.find((s) => s.id !== seatId)!.deckList).toBeUndefined();
      expect(buildTrainingState(12345, { seat: seatId, deck: precon })).toEqual(state);
    }
    expect(precon).toEqual(original);
  });

  it("keeps the default snapshot setup when no deck is selected", () => {
    const state = buildTrainingState(12345);
    expect(state.seats.some((s) => s.minions.length > 0)).toBe(true);
    expect(state.seats.every((s) => !s.deckList)).toBe(true);
  });

  it("plays a complete seeded neural episode and a matched comparison with the chosen deck", async () => {
    const episode = runLocalMlEpisode(createInitialMlModel(42), 42, 2, precon);
    expect(episode.errors).toBeNull();
    expect(episode.samples.length).toBeGreaterThan(0);
    const config: ComparisonConfig = { a: "balanced", b: "balanced", deals: 1, seed: 42, model: "unused", neural: null, trained: null, candidateDeck: precon, deckLabel: "test" };
    const a = await comparisonGame(config, "balanced", 42, 2);
    const b = await comparisonGame(config, "balanced", 42, 2);
    expect({ ...a, decisionMs: 0 }).toEqual({ ...b, decisionMs: 0 });
  }, 60_000);

  it("exposes paste and saved deck selection in the Lab", () => {
    const shell = readFileSync("src/ui/shell.ts", "utf8");
    expect(shell).toContain('id="lab-deck-source"');
    expect(shell).toContain('id="lab-deck-paste"');
    expect(shell).toContain('this.labDeckText = labPaste.value');
    expect(shell).toContain('const selection = this.selectedLabDeck()');
    expect(shell).toContain('candidateDeck: selection.deck');
  });

  it("sends the captured deck to both types of worker", async () => {
    const hw = new FakeWorker();
    const hp = new HeuristicWorkerPool(1, () => hw as unknown as Worker, precon);
    const task = { candidateIndex: 0, gameIndex: 3, seed: 123, weights: {} };
    const hd = hp.run([task], () => false, () => {});
    expect(hw.sent[0]).toMatchObject({ task, candidateDeck: precon });
    hw.onmessage?.({ data: { index: 0, result: { victoryPoints: 0, won: false, ousted: false, error: false } } } as MessageEvent);
    await hd; hp.close();
    const mw = new FakeWorker();
    const mp = new MlWorkerPool(1, () => mw as unknown as Worker);
    const md = mp.run({} as MlModel, [{ seed: 123, gameIndex: 3, candidateDeck: precon }], () => false, () => {});
    expect(mw.sent[1]).toMatchObject({ type: "game", gameIndex: 3, candidateDeck: precon });
    mw.onmessage?.({ data: { index: 0, episode: { seed: 123 } } } as MessageEvent);
    await md; mp.close();
  });
});
