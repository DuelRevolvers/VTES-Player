import type { DeckList } from "./decks.ts";
import { VtesEngine } from "../engine/engine.ts";
import { viewFor, type Agent } from "../engine/agent.ts";
import { buildHandlerRegistry } from "../cards/effects/cards.ts";
import { HeuristicAgent } from "../ai/heuristic.ts";
import { MlAgent, type MlModel } from "../ai/ml-agent.ts";
import { OllamaAgent } from "../ai/ollama-agent.ts";
import type { Weights } from "../ai/heuristic.ts";
import { PLAYSTYLES } from "../ai/playstyles.ts";
import { buildTrainingState, TRAINING_SEATS } from "./ai-lab.ts";
import { seatSeed } from "./settings.ts";

export type ComparedBot = "balanced" | "trained" | "neural" | "ollama" | "ollama-unguided";
export interface ComparisonConfig { a: ComparedBot; b: ComparedBot; deals: number; seed: number; model: string; neural: MlModel | null; trained: Partial<Weights> | null; candidateDeck?: DeckList; deckLabel?: string }
export interface ComparedGame { vp: number; win: boolean; ousted: boolean; decisions: number; decisionMs: number; ollamaRequests: number; fallbacks: number; maxPromptTokens: number | null }
export interface ComparisonPair { seed: number; seat: string; a: ComparedGame; b: ComparedGame }
const registry = buildHandlerRegistry();

/** One pair is committed only after both games finish; resume from the next pair. */
export function comparisonPosition(config: ComparisonConfig, pairIndex: number): { seed: number; seatIndex: number } {
  return { seed: (config.seed + Math.floor(pairIndex / TRAINING_SEATS.length)) | 0, seatIndex: pairIndex % TRAINING_SEATS.length };
}

/** Same seed, seat, opponents, and initial decks for each matched pair. */
export async function comparisonGame(config: ComparisonConfig, kind: ComparedBot, seed: number, seatIndex: number): Promise<ComparedGame> {
  const candidateSeat = TRAINING_SEATS[seatIndex]!;
  const engine = new VtesEngine(buildTrainingState(seed, config.candidateDeck ? { seat: candidateSeat, deck: config.candidateDeck } : undefined), registry);
  let candidate: Agent;
  if (kind === "neural") {
    if (!config.neural) throw new Error("No neural model is saved. Train one before testing it.");
    candidate = new MlAgent({ model: config.neural, seed: seed ^ seatSeed(candidateSeat), explore: false });
  } else if (kind === "trained") {
    if (!config.trained) throw new Error("No trained heuristic profile is saved.");
    candidate = new HeuristicAgent({ seed: seed ^ seatSeed(candidateSeat), weights: config.trained });
  } else if (kind === "ollama" || kind === "ollama-unguided") candidate = new OllamaAgent(config.model, seed ^ seatSeed(candidateSeat), kind === "ollama");
  else candidate = new HeuristicAgent({ seed: seed ^ seatSeed(candidateSeat) });
  const opponentStyles = ["balanced", "bruiser", "stalker", "turtle", "politician"] as const;
  const agents: Record<string, Agent> = {};
  for (const [i, seat] of TRAINING_SEATS.entries()) {
    agents[seat] = seat === candidateSeat ? candidate : new HeuristicAgent({ seed: seed ^ seatSeed(seat), weights: PLAYSTYLES[opponentStyles[i]!] });
  }
  let steps = 0, decisions = 0, decisionMs = 0;
  for (;;) {
    const dp = engine.decision();
    if (!dp) break;
    if (++steps > 20_000) throw new Error(`Game seed ${seed} exceeded 20000 decisions.`);
    const agent = agents[dp.seat]!;
    const view = viewFor(engine.state, dp.seat);
    const start = performance.now();
    const id = agent.decideAsync && dp.options.length > 1
      ? await agent.decideAsync(dp, dp.options, view, new AbortController().signal)
      : agent.decide(dp, dp.options, view);
    if (dp.seat === candidateSeat && dp.options.length > 1) { decisions++; decisionMs += performance.now() - start; }
    if (candidate instanceof OllamaAgent && candidate.fallbacks) throw new Error(`Comparison stopped: Ollama fell back to Balanced (${candidate.lastError}). No fallback game is scored as an LLM result.`);
    if (!dp.options.some((option) => option.id === id)) throw new Error("Bot returned an invalid option.");
    engine.choose(id);
  }
  const seat = engine.state.seats.find((s) => s.id === candidateSeat)!;
  const end = [...engine.state.eventLog].reverse().find((e) => e.type === "GameEnded");
  return { vp: seat.victoryPoints, win: !!end && end.type === "GameEnded" && end.winner === candidateSeat, ousted: seat.ousted, decisions, decisionMs,
    ollamaRequests: candidate instanceof OllamaAgent ? candidate.requests : 0, fallbacks: candidate instanceof OllamaAgent ? candidate.fallbacks : 0,
    maxPromptTokens: candidate instanceof OllamaAgent ? candidate.maxPromptTokens : null };
}
