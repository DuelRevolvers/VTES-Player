import type { TrainingGameExecutor, TrainingGameResult, TrainingGameTask } from "../ai/trainer.ts";
import type { DeckList } from "./decks.ts";

type Response = { index: number; result?: TrainingGameResult; error?: string };

/** Persistent, bounded pool; a generation is a barrier before evolution. */
export class HeuristicWorkerPool {
  private readonly workers: Worker[] = [];

  constructor(count: number, factory: () => Worker = () => new Worker(new URL("./heuristic-game-worker.ts", import.meta.url), { type: "module" }), private readonly candidateDeck?: DeckList) {
    try {
      if (!Number.isInteger(count) || count < 1) throw new Error("At least one training worker is required.");
      for (let i = 0; i < count; i++) this.workers.push(factory());
    } catch (error) {
      this.close();
      throw error;
    }
  }

  readonly run: TrainingGameExecutor = (tasks, cancelled, onResult) => new Promise((resolve, reject) => {
    let next = 0, running = 0, settled = false;
    const assigned = new Map<Worker, number>();
    const clear = () => { for (const worker of this.workers) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; } };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; clear();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const dispatch = (worker: Worker) => {
      if (!cancelled() && next < tasks.length) {
        const index = next++;
        assigned.set(worker, index);
        running++;
        worker.postMessage({ index, task: tasks[index], ...(this.candidateDeck ? { candidateDeck: this.candidateDeck } : {}) });
      } else if (running === 0 && !settled) {
        settled = true; clear(); resolve();
      }
    };
    try {
      for (const worker of this.workers) {
        worker.onmessage = (event: MessageEvent<Response>) => {
          if (settled) return;
          try {
            const { index, result, error } = event.data;
            if (index !== assigned.get(worker)) throw new Error("Training worker returned an unexpected game.");
            if (error || !result) throw new Error(error || "Training worker returned no result.");
            assigned.delete(worker); running--;
            onResult(index, result);
            dispatch(worker);
          } catch (error) { fail(error); }
        };
        worker.onerror = (event) => fail(new Error(`Training worker failed: ${event.message}`));
        worker.onmessageerror = () => fail(new Error("Training worker returned an unreadable message."));
      }
      for (const worker of this.workers) if (!settled) dispatch(worker);
    } catch (error) { fail(error); }
  });

  close(): void { for (const worker of this.workers) worker.terminate(); }
}
