/** Each worker owns its engine registry; no game state is shared between threads. */
import { runLocalMlEpisode } from "./ai-lab.ts";
import type { DeckList } from "./decks.ts";
import type { MlModel } from "../ai/ml-agent.ts";

let model: MlModel | undefined;
self.onmessage = (event: MessageEvent<{ type: "model"; model: MlModel } | { type: "game"; seed: number; gameIndex: number; index: number; candidateDeck?: DeckList }>) => {
  const message = event.data;
  if (message.type === "model") {
    model = message.model;
    return;
  }
  try {
    if (!model) throw new Error("Worker has not received a model");
    self.postMessage({ index: message.index, episode: runLocalMlEpisode(model, message.seed, message.gameIndex, message.candidateDeck) });
  } catch (error) {
    self.postMessage({ index: message.index, error: error instanceof Error ? error.message : String(error) });
  }
};
