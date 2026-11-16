import { afterEach, describe, expect, it, vi } from "vitest";
import { runLocalTraining } from "../../src/ui/ai-lab.ts";
import { runLocalHeuristicGame } from "../../src/ui/training-games.ts";
import type { TrainingGameTask } from "../../src/ai/trainer.ts";
import { preconDeck } from "../../src/ui/deckimport.ts";
import type { DeckList } from "../../src/ui/decks.ts";

class GameWorker {
  static instances: GameWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  constructor() { GameWorker.instances.push(this); }
  postMessage(message: { index: number; task: TrainingGameTask; candidateDeck?: DeckList }) {
    setTimeout(() => {
      if (!this.terminated) this.onmessage?.({ data: { index: message.index, result: runLocalHeuristicGame(message.task, message.candidateDeck) } } as MessageEvent);
    }, message.index % 2 ? 0 : 3);
  }
  terminate() { this.terminated = true; }
}

afterEach(() => { vi.unstubAllGlobals(); GameWorker.instances = []; });

describe("heuristic training worker integration", () => {
  it("matches serial results with real seeded games across generations", async () => {
    const options = { population: 2, generations: 2, gamesPerCandidate: 2, seed: 42, workers: 2 };
    vi.stubGlobal("Worker", undefined);
    const serial = await runLocalTraining(options);
    vi.stubGlobal("Worker", GameWorker);
    const progress: number[] = [];
    const parallel = await runLocalTraining({ ...options, onProgress: (p) => progress.push(p.completedGames) });
    expect(parallel).toEqual(serial);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(GameWorker.instances).toHaveLength(2);
    expect(GameWorker.instances.every((worker) => worker.terminated)).toBe(true);
    expect(parallel.candidates.every((candidate) => candidate.errors === 0)).toBe(true);
  }, 30_000);

  it("uses the same custom deck and results in serial and worker games", async () => {
    const candidateDeck = preconDeck("Fifth Edition (Anarch)", "Brujah", "candidate")!;
    const options = { population: 2, generations: 1, gamesPerCandidate: 1, seed: 42, workers: 2, candidateDeck };
    vi.stubGlobal("Worker", undefined);
    const serial = await runLocalTraining(options);
    vi.stubGlobal("Worker", GameWorker);
    const parallel = await runLocalTraining(options);
    expect(parallel).toEqual(serial);
    expect(parallel.candidates.every((candidate) => candidate.errors === 0)).toBe(true);
  }, 60_000);

  it("cleans up workers when a game fails", async () => {
    class BrokenWorker extends GameWorker {
      override postMessage(message: { index: number; task: TrainingGameTask }) {
        setTimeout(() => this.onmessage?.({ data: { index: message.index, error: "fixture failure" } } as MessageEvent), 0);
      }
    }
    vi.stubGlobal("Worker", BrokenWorker);
    await expect(runLocalTraining({ population: 2, generations: 1, gamesPerCandidate: 2, seed: 1, workers: 2 })).rejects.toThrow("fixture failure");
    expect(GameWorker.instances).toHaveLength(2);
    expect(GameWorker.instances.every((worker) => worker.terminated)).toBe(true);
  });
});
