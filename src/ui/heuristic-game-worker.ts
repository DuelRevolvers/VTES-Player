/** One isolated game at a time; every worker has its own engine registry. */
import { runLocalHeuristicGame } from "./training-games.ts";
import type { TrainingGameTask } from "../ai/trainer.ts";
import type { DeckList } from "./decks.ts";

self.onmessage = (event: MessageEvent<{ index: number; task: TrainingGameTask; candidateDeck?: DeckList }>) => {
  try {
    self.postMessage({ index: event.data.index, result: runLocalHeuristicGame(event.data.task, event.data.candidateDeck) });
  } catch (error) {
    self.postMessage({ index: event.data.index, error: error instanceof Error ? error.message : String(error) });
  }
};
