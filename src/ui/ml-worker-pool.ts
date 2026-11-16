import type { DeckList } from "./decks.ts";
import type { MlModel } from "../ai/ml-agent.ts";
import type { MlTrainingEpisode } from "./ai-lab.ts";

export interface MlGameTask { seed: number; gameIndex: number; candidateDeck?: DeckList }
type WorkerResponse = { index: number; episode?: MlTrainingEpisode; error?: string };

/** Persistent pool: one model snapshot per worker/round, and ordered results. */
export class MlWorkerPool {
  private readonly workers: Worker[] = [];

  constructor(count: number, factory: () => Worker = () => new Worker(new URL("./ml-episode-worker.ts", import.meta.url), { type: "module" })) {
    try {
      for (let i = 0; i < count; i++) this.workers.push(factory());
      if (!this.workers.length) throw new Error("At least one game worker is required.");
    } catch (error) {
      this.close();
      throw error;
    }
  }

  run(model: MlModel, tasks: MlGameTask[], cancelled: () => boolean,
      onGame: (episode: MlTrainingEpisode, completed: number) => void): Promise<MlTrainingEpisode[]> {
    return new Promise((resolve, reject) => {
      const results: Array<MlTrainingEpisode | undefined> = Array(tasks.length);
      let next = 0, running = 0, completed = 0, settled = false;
      const clear = () => { for (const worker of this.workers) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; } };
      const fail = (error: unknown) => { if (!settled) { settled = true; clear(); reject(error instanceof Error ? error : new Error(String(error))); } };
      const dispatch = (worker: Worker) => {
        if (!cancelled() && next < tasks.length) {
          const index = next++;
          running++;
          worker.postMessage({ type: "game", index, ...tasks[index] });
        } else if (running === 0 && !settled) {
          settled = true;
          clear();
          resolve(results.filter((episode): episode is MlTrainingEpisode => episode !== undefined));
        }
      };
      try {
        // Register all handlers and models before dispatching any tasks.
        for (const worker of this.workers) {
          worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            if (settled) return;
            try {
              const { index, episode, error } = event.data;
              if (error || !episode) throw new Error(error || "Game worker returned no episode.");
              results[index] = episode;
              running--;
              onGame(episode, ++completed);
              dispatch(worker);
            } catch (error) { fail(error); }
          };
          worker.onerror = (event) => fail(new Error(`Game worker failed: ${event.message}`));
          worker.onmessageerror = () => fail(new Error("Game worker returned an unreadable message."));
          worker.postMessage({ type: "model", model });
        }
        // Dispatch the initial set without resolving early when tasks is empty.
        for (const worker of this.workers) { if (!settled) dispatch(worker); }
      } catch (error) { fail(error); }
    });
  }

  close(): void { for (const worker of this.workers) worker.terminate(); }
}
