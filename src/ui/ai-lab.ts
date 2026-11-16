/** Browser wiring for the local AI Lab; deck/UI dependencies stay out of src/ai. */

import { trainHeuristic, type TrainingOptions } from "../ai/trainer.ts";
import { HeuristicWorkerPool } from "./heuristic-worker-pool.ts";
import type { DeckList } from "./decks.ts";
import type { SeatId } from "../engine/state.ts";
import { buildTrainingState, TRAINING_SEATS, TRAINING_REGISTRY } from "./training-games.ts";
export { buildTrainingState, TRAINING_SEATS } from "./training-games.ts";
import { HeuristicAgent } from "../ai/heuristic.ts";
import { MlAgent, type MlDecisionSample, type MlModel } from "../ai/ml-agent.ts";
import { PLAYSTYLES } from "../ai/playstyles.ts";
import { runGame } from "../ai/batch.ts";
import { seatSeed } from "./settings.ts";

const registry = TRAINING_REGISTRY;

export type LocalTrainingOptions = Omit<TrainingOptions, "seats" | "registry" | "buildState" | "executeGames"> & { workers?: number; candidateDeck?: DeckList };

export async function runLocalTraining(options: LocalTrainingOptions) {
  const { workers = 1, candidateDeck, ...training } = options;
  // In environments without Web Workers (including node tests), keep the
  // original serial executor. A worker startup failure is reported, not hidden.
  const pool = typeof Worker === "undefined" ? undefined : new HeuristicWorkerPool(
    Math.max(1, Math.min(32, Math.floor(workers) || 1, options.population * options.gamesPerCandidate)),
    undefined, candidateDeck,
  );
  try {
    return await trainHeuristic({
      ...training, seats: TRAINING_SEATS, registry,
      buildState: (seed, seat) => buildTrainingState(seed, candidateDeck ? { seat, deck: candidateDeck } : undefined),
      ...(pool ? { executeGames: pool.run } : {}),
    });
  } finally {
    pool?.close();
  }
}

export interface MlTrainingEpisode {
  seed: number;
  reward: number;
  ownVictoryPoints: number;
  opponentMeanVictoryPoints: number;
  winner: boolean;
  ousted: boolean;
  errors: string | null;
  samples: MlDecisionSample[];
}

const ML_OPPONENT_STYLES = ["balanced", "bruiser", "stalker", "turtle", "politician", "builder"] as const;

/** Play a real five-seat engine game and collect only the candidate's
 *  masked-view decisions. Four changing heuristic styles provide opponents. */
export function runLocalMlEpisode(model: MlModel, seed: number, gameIndex: number, candidateDeck?: DeckList): MlTrainingEpisode {
  const candidateSeat = TRAINING_SEATS[gameIndex % TRAINING_SEATS.length]!;
  const candidate = new MlAgent({ model, seed: seed ^ 0x1f123bb5, explore: true });
  const agents: Record<SeatId, MlAgent | HeuristicAgent> = {};
  const start = Math.abs(seed + gameIndex * 3) % ML_OPPONENT_STYLES.length;
  let opponent = 0;
  for (const seat of TRAINING_SEATS) {
    if (seat === candidateSeat) {
      agents[seat] = candidate;
      continue;
    }
    const style = ML_OPPONENT_STYLES[(start + opponent) % ML_OPPONENT_STYLES.length]!;
    const styleSeed = (seatSeed(seat) ^ seed ^ (gameIndex * 0x45d9f3b)) | 0;
    agents[seat] = new HeuristicAgent({ seed: styleSeed, weights: PLAYSTYLES[style] });
    opponent++;
  }
  const result = runGame(seed, buildTrainingState(seed, candidateDeck ? { seat: candidateSeat, deck: candidateDeck } : undefined), agents, registry);
  const ownVp = result.victoryPoints[candidateSeat] ?? 0;
  const otherVps = TRAINING_SEATS.filter((seat) => seat !== candidateSeat)
    .map((seat) => result.victoryPoints[seat] ?? 0);
  const opponentMean = otherVps.reduce((a, b) => a + b, 0) / otherVps.length;
  const winner = result.winner === candidateSeat;
  const ousted = result.ousted.includes(candidateSeat);
  const reward = ownVp - opponentMean + (winner ? 1.25 : 0) - (ousted ? 0.75 : 0);
  return {
    seed,
    reward,
    ownVictoryPoints: ownVp,
    opponentMeanVictoryPoints: opponentMean,
    winner,
    ousted,
    errors: result.error ?? null,
    samples: candidate.samples,
  };
}
