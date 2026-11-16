/** Shared deterministic fixtures for local heuristic and neural game workers. */
import playtestConfig from "../../config/playtest-decks.json" with { type: "json" };
import { buildHandlerRegistry } from "../cards/effects/cards.ts";
import { runTrainingGame, type TrainingGameTask } from "../ai/trainer.ts";
import type { SeatId } from "../engine/state.ts";
import { buildGame, validateDecks, type DeckDef, type DeckList } from "./decks.ts";
import { preconDeck } from "./deckimport.ts";

const config = playtestConfig as unknown as { decks: DeckDef[]; maxTurns: number | null };
export const TRAINING_SEATS: SeatId[] = ["Lab 1", "Lab 2", "Lab 3", "Lab 4", "Lab 5"];
export const TRAINING_REGISTRY = buildHandlerRegistry();

let opponentDecks: DeckList[] | null = null;
function fullOpponentDecks(): DeckList[] {
  if (opponentDecks) return opponentDecks;
  const names = ["Hecata", "Lasombra", "Malkavian", "Nosferatu", "Toreador", "Tremere", "Ventrue"];
  const loaded = names.map((name) => {
    const deck = preconDeck("Fifth Edition", name, "opponent");
    if (!deck || !validateDecks([deck]).ok) throw new Error(`Training opponent deck ${name} is unavailable or invalid`);
    return deck;
  });
  opponentDecks = loaded;
  return loaded;
}

/** Rotate the included deck snapshots and seed the seating and shuffle. */
export function buildTrainingState(seed: number, candidate?: { seat: SeatId; deck: DeckList }) {
  if (candidate) {
    // Real decks must play against real decks, not the default mid-game
    // snapshots: otherwise the candidate starts several turns behind.
    // Prefer different crypts to reduce accidental contests, but contests
    // remain possible and are genuine game effects.
    const own = new Set(candidate.deck.crypt.map((v) => v.id));
    const opponents = fullOpponentDecks().map((deck) => ({
      deck, overlap: new Set(deck.crypt.filter((v) => own.has(v.id)).map((v) => v.id)).size,
    })).sort((a, b) => a.overlap - b.overlap);
    const otherSeats = TRAINING_SEATS.filter((seat) => seat !== candidate.seat);
    if (otherSeats.length !== TRAINING_SEATS.length - 1) throw new Error("Unknown candidate seat");
    const decks = TRAINING_SEATS.map((seat) => seat === candidate.seat
      ? { ...candidate.deck, seat }
      : { ...opponents[otherSeats.indexOf(seat)]!.deck, seat });
    return buildGame({ decks, seed, maxTurns: config.maxTurns, randomSeating: true });
  }
  const source = config.decks;
  const offset = Math.abs(seed) % source.length;
  const decks = TRAINING_SEATS.map((seat, i) => ({ ...source[(i + offset) % source.length]!, seat }));
  return buildGame({ decks, seed, maxTurns: config.maxTurns, randomSeating: true });
}

export function runLocalHeuristicGame(task: TrainingGameTask, deck?: DeckList) {
  return runTrainingGame(task, TRAINING_SEATS,
    (seed, seat) => buildTrainingState(seed, deck ? { seat, deck } : undefined), TRAINING_REGISTRY);
}
