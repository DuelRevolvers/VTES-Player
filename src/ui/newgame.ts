/**
 * Setting up a game — the part with no DOM in it (docs/shell-design.md).
 *
 * A table is a list of seats, each with a name, someone to play it, and a
 * deck to play. This turns that into a `GameSetup` the engine can deal, or
 * into the exact list of what is stopping it.
 *
 * Kept separate from the screen that collects it for the reason the whole
 * project is arranged this way: this is where the decisions are, so this
 * is what gets tested. The screen is markup.
 */

import { deckHash } from "./deckhash.ts";
import type { DeckList, GameSetup } from "./decks.ts";
import { validateDecks } from "./decks.ts";
import type { ImportReport } from "./deckimport.ts";
import { importDeck, preconDeck, supportedPrecons } from "./deckimport.ts";

/** Where a seat's deck comes from. */
export type DeckSource =
  | { kind: "precon"; set: string; name: string }
  | { kind: "paste"; text: string };

/**
 * Who plays a seat.
 *
 * "open" is a seat waiting for someone to join; "remote" is one a peer has
 * taken. The two must be distinct or a lobby hands the same seat to every
 * arrival in turn, renaming it each time — which is exactly what happened
 * when this type had only three values (docs/lobby-design.md §3).
 *
 * "remote" needs no special handling anywhere else: a seat held by a
 * distant human behaves like one held by the local human, and only `open`
 * (nobody yet) and `ai` (a bot to attach) are asked about.
 */
export type SeatKind = "you" | "ai" | "open" | "remote";

export interface SeatConfig {
  /** The name on the mat. Unique within the table — that is as far as
   *  uniqueness goes without a backend (see profile.ts). */
  name: string;
  kind: SeatKind;
  deck: DeckSource | null;
  /**
   * The player's picture, as a data URI, or null.
   *
   * NOT game state — the engine knows a seat by its id and nothing else —
   * so it never reaches the command log and a save replays the same game
   * without it. It is here because this is where a seat is described.
   */
  avatar?: string | null;
}

export interface TableConfig {
  seats: SeatConfig[];
  /** Null seeds from the clock, so two games are not identical. */
  seed: number | null;
  /** Engine safeguard, not a rule. */
  maxTurns: number | null;
  /** No network: everything is played or bot-driven on this machine. */
  privateGame: boolean;
}

export interface TableProblem {
  /** Which seat, or null for a problem with the table as a whole. */
  seat: string | null;
  problem: string;
}

export interface TableBuild {
  setup: GameSetup | null;
  problems: TableProblem[];
  /** Per-seat import report, when that seat pasted a deck. The screen
   *  shows it whether or not the table is playable — an unsupported card
   *  is something to read, not just something to block on. */
  reports: Record<string, ImportReport>;
}

/**
 * p. 1: "a card game in which four or five players take on the role of
 * ancient vampires". Four is the default here for that reason.
 *
 * The engine runs any number from two up, and a two-player game is a real
 * thing people play, so the range is wider than the recommendation — but
 * the recommendation is what the screen should say.
 */
export const MIN_SEATS = 2;
export const MAX_SEATS = 6;
export const DEFAULT_SEATS = 4;
export const RECOMMENDED_SEATS = [4, 5];

/** A table to start from: you, three bots, and a precon each. */
export function defaultTable(playerName: string): TableConfig {
  const precons = supportedPrecons().filter((p) => p.playable);
  const seats: SeatConfig[] = [];
  for (let i = 0; i < DEFAULT_SEATS; i++) {
    const p = precons[i % Math.max(1, precons.length)];
    seats.push({
      name: i === 0 ? playerName : `Bot ${i}`,
      kind: i === 0 ? "you" : "ai",
      // Spread every seat across a different precon, so a first game is
      // not four copies of one deck playing itself.
      deck: p ? { kind: "precon", set: p.set, name: p.name } : null,
    });
  }
  return { seats, seed: null, maxTurns: null, privateGame: true };
}

/** Resolve one seat's deck source, with the reason if it cannot be. */
function deckFor(
  seat: SeatConfig,
): { deck: DeckList | null; problem: string | null; report?: ImportReport } {
  if (!seat.deck) return { deck: null, problem: "no deck chosen" };
  if (seat.deck.kind === "precon") {
    const deck = preconDeck(seat.deck.set, seat.deck.name, seat.name);
    if (!deck) return { deck: null, problem: `no precon "${seat.deck.name}" in ${seat.deck.set}` };
    return { deck, problem: null };
  }
  const { deck, report } = importDeck(seat.deck.text, seat.name);
  if (!deck) {
    // The report holds the detail; this is the one-line summary the seat
    // row shows next to it.
    const why =
      report.unknown.length > 0
        ? `${report.unknown.length} card(s) not in the V5 pool`
        : report.unsupported.length > 0
          ? `${report.unsupported.length} card(s) not implemented`
          : (report.illegal[0] ?? "the deck list could not be read");
    return { deck: null, problem: why, report };
  }
  return { deck, problem: null, report };
}

/**
 * Turn a table into something the engine can deal.
 *
 * Every problem is collected rather than thrown on the first one: a player
 * fixing a lobby wants the whole list, not one error at a time.
 */
export function buildTable(config: TableConfig): TableBuild {
  const problems: TableProblem[] = [];
  const reports: Record<string, ImportReport> = {};

  if (config.seats.length < MIN_SEATS) {
    problems.push({ seat: null, problem: `a table needs at least ${MIN_SEATS} seats` });
  }
  if (config.seats.length > MAX_SEATS) {
    problems.push({ seat: null, problem: `a table holds at most ${MAX_SEATS} seats` });
  }

  // Seat names are the seat IDS the engine uses, so they must be distinct
  // and non-empty — this is the "unique within a room" rule, and it is the
  // only place uniqueness is enforced at all.
  const seen = new Set<string>();
  for (const seat of config.seats) {
    const name = seat.name.trim();
    if (name === "") problems.push({ seat: null, problem: "a seat has no name" });
    else if (seen.has(name)) {
      problems.push({ seat: name, problem: "two seats share that name" });
    }
    seen.add(name);
  }

  // An online table needs somebody other than the host and the bots — but
  // "an open seat" is the wrong test, because once everyone has ARRIVED
  // there are no open seats left and the game must still be able to start.
  // A seat that is open OR already taken by a peer both satisfy it.
  if (!config.privateGame && !config.seats.some((s) => s.kind === "open" || s.kind === "remote")) {
    problems.push({
      seat: null,
      problem: "an online table needs a seat for someone to join",
    });
  }

  const decks: DeckList[] = [];
  for (const seat of config.seats) {
    // An OPEN seat's deck arrives with the player who takes it, so it is
    // not a problem now — but it does mean the table cannot be dealt yet.
    if (seat.kind === "open" && !seat.deck) {
      problems.push({ seat: seat.name, problem: "waiting for a player" });
      continue;
    }
    const { deck, problem, report } = deckFor(seat);
    if (report) reports[seat.name] = report;
    if (problem) problems.push({ seat: seat.name, problem });
    if (deck) decks.push(deck);
  }

  // The registry check the playtest decks already go through, so an
  // imported deck and a hand-authored one are held to one standard.
  if (problems.length === 0) {
    const check = validateDecks(decks);
    for (const d of check.illegalDecks) problems.push({ seat: d.seat, problem: d.problem });
    for (const name of check.unknown) problems.push({ seat: null, problem: `unknown card: ${name}` });
    for (const name of check.unsupported) {
      problems.push({ seat: null, problem: `not implemented: ${name}` });
    }
  }

  if (problems.length > 0) return { setup: null, problems, reports };
  return {
    setup: {
      decks,
      // A null seed means "a different game each time"; the seed is still
      // recorded in the setup, so the game stays reproducible from its save.
      seed: config.seed ?? Math.floor(Math.random() * 0x7fffffff),
      maxTurns: config.maxTurns,
    },
    problems,
    reports,
  };
}

/** Which seats an AI should play, for the transport to be told. */
export function botSeats(config: TableConfig): string[] {
  return config.seats.filter((s) => s.kind === "ai").map((s) => s.name.trim());
}

/**
 * A seat's deck fingerprint, or null when it has no valid build.
 *
 * Resolved through the SAME path the game will be dealt from, so the
 * fingerprint cannot describe a deck other than the one that gets played.
 * Lives here rather than in the lobby because the new-game screen wants it
 * too, and one definition cannot disagree with itself.
 */
export function seatDeckHash(seat: SeatConfig): string | null {
  if (!seat.deck) return null;
  const deck =
    seat.deck.kind === "precon"
      ? preconDeck(seat.deck.set, seat.deck.name, seat.name)
      : importDeck(seat.deck.text, seat.name).deck;
  return deck ? deckHash(deck) : null;
}

/**
 * Is this table one other people join?
 *
 * DERIVED from the seats rather than stored beside them, so the answer can
 * never disagree with the table it describes — a "play online" switch and
 * a set of seats are two facts that can contradict each other, and this is
 * one that cannot.
 */
export function isOnlineTable(config: TableConfig): boolean {
  return config.seats.some((s) => s.kind === "open" || s.kind === "remote");
}
