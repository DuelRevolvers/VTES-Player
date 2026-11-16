/**
 * Seeded self-play tuning for HeuristicAgent.
 *
 * This is deliberately a light-weight evolutionary tuner, not an opaque
 * neural policy: it mutates a documented subset of the existing weights,
 * evaluates each candidate in five-seat games against a changing mix of
 * known playstyles, rotates the candidate's seat, and keeps the top
 * performers. Game construction is injected so the AI layer stays separate
 * from the UI/deck builder.
 */

import type { Agent } from "../engine/agent.ts";
import type { HandlerRegistry } from "../engine/handlers.ts";
import type { GameState, SeatId } from "../engine/state.ts";
import { HeuristicAgent, DEFAULT_WEIGHTS, type Weights } from "./heuristic.ts";
import { PLAYSTYLES, PLAYSTYLES_LIST } from "./playstyles.ts";
import { runGame } from "./batch.ts";

export const TRAINABLE_WEIGHT_KEYS = [
  "bleedPrey",
  "bleedPerPoint",
  "bleedNonPrey",
  "huntWhenEmpty",
  "hunt",
  "influenceTransfer",
  "influenceProgress",
  "influenceOut",
  "rescue",
  "diablerize",
  "blockBleed",
  "blockPerBleedPoint",
  "blockDiablerize",
  "playCard",
  "poolCost",
  "voteOwn",
  "voteAgainstOthers",
  "votePoolMe",
  "votePoolPrey",
  "votePoolPredator",
  "voteBurnMyMinion",
  "voteBurnTheirMinion",
] as const satisfies readonly (keyof Omit<Weights, "effectValue">)[];

export type TunableWeights = Partial<Pick<Weights, (typeof TRAINABLE_WEIGHT_KEYS)[number]>>;

export interface TrainingCandidate {
  id: string;
  weights: TunableWeights;
  meanVictoryPoints: number;
  wins: number;
  games: number;
  ousted: number;
  errors: number;
}

export interface TrainingProgress {
  completedGames: number;
  totalGames: number;
  generation: number;
  candidate: number;
  gamesForCandidate: number;
  candidateMeanVp: number;
  candidateWins: number;
}

export interface TrainingGameTask {
  candidateIndex: number;
  gameIndex: number;
  seed: number;
  weights: TunableWeights;
}

export interface TrainingGameResult {
  victoryPoints: number;
  won: boolean;
  ousted: boolean;
  error: boolean;
}

/** The executor reports each completed task exactly once; completion may be out of order. */
export type TrainingGameExecutor = (
  tasks: TrainingGameTask[], cancelled: () => boolean,
  onResult: (taskIndex: number, result: TrainingGameResult) => void,
) => Promise<void>;

export interface TrainingOptions {
  population: number;
  generations: number;
  gamesPerCandidate: number;
  seed: number;
  seats: SeatId[];
  registry: HandlerRegistry;
  buildState: (seed: number, candidateSeat: SeatId) => GameState;
  shouldCancel?: () => boolean;
  onProgress?: (p: TrainingProgress) => void;
  onGeneration?: (trend: GenerationTrend) => void;
  executeGames?: TrainingGameExecutor;
}

export interface GenerationTrend {
  generation: number;
  baselineMeanVictoryPoints: number | null;
  bestVariantId: string;
  bestVariantMeanVictoryPoints: number;
  /** Best non-baseline candidate minus the Balanced control on that generation's seeds. */
  differenceFromBaseline: number | null;
  games: number;
}

export interface TrainingReport {
  candidates: TrainingCandidate[];
  best: TrainingCandidate | null;
  history: GenerationTrend[];
  generationsCompleted: number;
  completedGames: number;
  totalGames: number;
  cancelled: boolean;
}

interface RandomState { value: number }

function random01(rng: RandomState): number {
  let x = rng.value | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  rng.value = x | 0;
  return (x >>> 0) / 0x1_0000_0000;
}

function baselineWeights(): TunableWeights {
  const out: TunableWeights = {};
  for (const key of TRAINABLE_WEIGHT_KEYS) out[key] = DEFAULT_WEIGHTS[key];
  return out;
}

function randomWeights(rng: RandomState): TunableWeights {
  const out: TunableWeights = {};
  for (const key of TRAINABLE_WEIGHT_KEYS) {
    const base = DEFAULT_WEIGHTS[key];
    const radius = Math.max(1, Math.abs(base)) * 0.55;
    out[key] = base + (random01(rng) * 2 - 1) * radius;
  }
  return out;
}

function mutate(parent: TunableWeights, rng: RandomState): TunableWeights {
  const out: TunableWeights = {};
  for (const key of TRAINABLE_WEIGHT_KEYS) {
    const base = DEFAULT_WEIGHTS[key];
    const center = parent[key] ?? base;
    const radius = Math.max(1, Math.abs(base)) * 0.35;
    const bound = Math.max(1, Math.abs(base)) * 1.5;
    out[key] = Math.max(base - bound, Math.min(base + bound, center + (random01(rng) * 2 - 1) * radius));
  }
  return out;
}

function freshPopulation(size: number, rng: RandomState): Array<{ id: string; weights: TunableWeights }> {
  const out = [{ id: "baseline", weights: baselineWeights() }];
  while (out.length < size) out.push({ id: `random-${out.length}`, weights: randomWeights(rng) });
  return out;
}

function nextPopulation(
  previous: TrainingCandidate[],
  size: number,
  generation: number,
  rng: RandomState,
): Array<{ id: string; weights: TunableWeights }> {
  const ranked = [...previous].sort((a, b) => b.meanVictoryPoints - a.meanVictoryPoints || b.wins - a.wins);
  const parents = ranked.slice(0, Math.min(3, ranked.length));
  // A fresh copy of today's policy is evaluated in EVERY generation. This
  // control makes the trend comparable instead of comparing different
  // random deals or opponent mixes.
  const out = [{ id: `g${generation}-baseline`, weights: baselineWeights() }];
  const elite = ranked.find((p) => p.id !== "baseline" && !p.id.endsWith("-baseline"));
  // Reserve at least one slot for a mutation, even in the smallest
  // population, so a two-candidate run can still explore after generation 1.
  if (elite && size > 2) {
    out.push({ id: `g${generation}-elite`, weights: { ...elite.weights } });
  }
  while (out.length < size) {
    // Keep occasional fresh samples so the population does not collapse
    // around an early lucky result.
    if (random01(rng) < 0.2) {
      out.push({ id: `g${generation}-random${out.length + 1}`, weights: randomWeights(rng) });
      continue;
    }
    const parent = parents[Math.floor(random01(rng) * parents.length)]!;
    out.push({
      id: `g${generation}-mutant${out.length + 1}`,
      weights: mutate(parent.weights, rng),
    });
  }
  return out;
}

function stylesForOpponents(): typeof PLAYSTYLES_LIST[number][] {
  return PLAYSTYLES_LIST.filter((s) => s !== "trained" && s !== "neural" && s !== "ollama");
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** One independently seeded game; shared by the serial path and workers. */
export function runTrainingGame(task: TrainingGameTask, seats: SeatId[], buildState: (seed: number, candidateSeat: SeatId) => GameState, registry: HandlerRegistry): TrainingGameResult {
  const candidateSeat = seats[task.gameIndex % seats.length]!;
  const agents: Record<SeatId, Agent> = {};
  const styles = stylesForOpponents();
  seats.forEach((seat, seatIndex) => {
    const agentSeed = (task.seed * 1009 + seatIndex * 9176) | 0;
    if (seat === candidateSeat) {
      agents[seat] = new HeuristicAgent({ seed: agentSeed, weights: task.weights });
    } else {
      const styleIndex = Math.abs(task.seed + seatIndex * 3) % styles.length;
      agents[seat] = new HeuristicAgent({ seed: agentSeed, weights: PLAYSTYLES[styles[styleIndex]!] });
    }
  });
  const result = runGame(task.seed, buildState(task.seed, candidateSeat), agents, registry);
  return {
    victoryPoints: result.victoryPoints[candidateSeat] ?? 0,
    won: result.winner === candidateSeat,
    ousted: result.ousted.includes(candidateSeat),
    error: Boolean(result.error),
  };
}

/**
 * Run a small evolutionary tournament. Each candidate plays one seat in a
 * five-seat table; the other seats receive varied built-in styles. The
 * candidate rotates seats across games and is ranked by its mean VPs.
 */
export async function trainHeuristic(
  opts: TrainingOptions,
): Promise<TrainingReport> {
  const populationSize = Math.max(2, Math.min(100, Math.floor(opts.population)));
  const generations = Math.max(1, Math.min(200, Math.floor(opts.generations)));
  const gamesPerCandidate = Math.max(1, Math.min(500, Math.floor(opts.gamesPerCandidate)));
  const seats = opts.seats.slice(0, 6);
  if (seats.length < 3) throw new Error("Training needs at least three seats.");
  const rng: RandomState = { value: (opts.seed | 0) || 1 };
  const totalGames = populationSize * generations * gamesPerCandidate;
  let completedGames = 0;
  let previous: TrainingCandidate[] = [];
  let best: TrainingCandidate | null = null;
  const history: GenerationTrend[] = [];
  let generationsCompleted = 0;
  let cancelled = false;
  for (let generation = 0; generation < generations; generation++) {
    if (opts.shouldCancel?.()) { cancelled = true; break; }
    const population = generation === 0
      ? freshPopulation(populationSize, rng)
      : nextPopulation(previous, populationSize, generation + 1, rng);
    const tasks: TrainingGameTask[] = population.flatMap((candidate, candidateIndex) =>
      Array.from({ length: gamesPerCandidate }, (_, gameIndex) => ({
        candidateIndex, gameIndex, seed: opts.seed + gameIndex, weights: candidate.weights,
      })),
    );
    const results: Array<TrainingGameResult | undefined> = Array(tasks.length);
    const counts = population.map(() => ({ games: 0, totalVp: 0, wins: 0 }));
    const record = (index: number, result: TrainingGameResult) => {
      const task = tasks[index];
      if (!task || results[index]) throw new Error("Invalid or duplicate training game result.");
      results[index] = result;
      completedGames++;
      const count = counts[task.candidateIndex]!;
      count.games++; count.totalVp += result.victoryPoints;
      if (result.won) count.wins++;
      opts.onProgress?.({
        completedGames, totalGames, generation: generation + 1,
        candidate: task.candidateIndex + 1, gamesForCandidate: count.games,
        candidateMeanVp: count.totalVp / count.games, candidateWins: count.wins,
      });
    };
    if (opts.executeGames) {
      await opts.executeGames(tasks, () => Boolean(opts.shouldCancel?.()), record);
    } else {
      for (let index = 0; index < tasks.length; index++) {
        if (opts.shouldCancel?.()) break;
        record(index, runTrainingGame(tasks[index]!, seats, opts.buildState, opts.registry));
        await yieldToUi();
      }
    }
    cancelled = Boolean(opts.shouldCancel?.());
    if (!cancelled && results.filter((result) => result !== undefined).length !== tasks.length) {
      throw new Error("Training executor did not return every game.");
    }
    // Fold in task order, not worker completion order: stable ranking, ties,
    // and subsequent mutations are independent of scheduling.
    const current: TrainingCandidate[] = population.flatMap((candidate, candidateIndex) => {
      const candidateResults = results.slice(candidateIndex * gamesPerCandidate, (candidateIndex + 1) * gamesPerCandidate)
        .filter((result): result is TrainingGameResult => result !== undefined);
      if (!candidateResults.length) return [];
      return [{
        id: candidate.id, weights: candidate.weights,
        meanVictoryPoints: candidateResults.reduce((sum, r) => sum + r.victoryPoints, 0) / candidateResults.length,
        wins: candidateResults.filter((r) => r.won).length, games: candidateResults.length,
        ousted: candidateResults.filter((r) => r.ousted).length, errors: candidateResults.filter((r) => r.error).length,
      }];
    });

    if (current.length > 0) {
      current.sort((a, b) => b.meanVictoryPoints - a.meanVictoryPoints || b.wins - a.wins);
      previous = current;
      const baseline = current.find((c) => c.id === "baseline" || c.id.endsWith("-baseline"));
      const fullyEvaluated = current.filter((c) => c.games === gamesPerCandidate);
      const challenger = fullyEvaluated.find(
        (c) => c.id !== "baseline" && !c.id.endsWith("-baseline"),
      );
      const generationBest = challenger ?? (baseline?.games === gamesPerCandidate ? baseline : null);
      if (generationBest) {
        const trend: GenerationTrend = {
          generation: generation + 1,
          baselineMeanVictoryPoints: baseline?.games === gamesPerCandidate
            ? baseline.meanVictoryPoints
            : null,
          bestVariantId: generationBest.id,
          bestVariantMeanVictoryPoints: generationBest.meanVictoryPoints,
          differenceFromBaseline: baseline?.games === gamesPerCandidate
            ? generationBest.meanVictoryPoints - baseline.meanVictoryPoints
            : null,
          games: current.reduce((sum, c) => sum + c.games, 0),
        };
        history.push(trend);
        opts.onGeneration?.(trend);
        if (!best || generationBest.meanVictoryPoints > best.meanVictoryPoints) best = generationBest;
      }
      if (!cancelled) generationsCompleted++;
    }
    if (cancelled) break;
  }

  return {
    candidates: previous,
    best,
    history,
    generationsCompleted,
    completedGames,
    totalGames,
    cancelled,
  };
}
