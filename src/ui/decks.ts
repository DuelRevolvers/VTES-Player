/**
 * Playtest decks for the debug hotseat UI (docs/debug-ui-design.md §6).
 *
 * Deck lists are validated against the card registry AND config/supported.json
 * and refuse to start with a clear list of offenders — never silently
 * dropped. That is the same rule the real deck importer must follow
 * (CLAUDE.md, "Card registry rules").
 *
 * Vampires are REAL V5 crypt cards, referenced by KRCG id; their stats and
 * scans come from the registry via cardinfo.ts. Their special abilities are
 * still unimplemented (crypt is 0/217, phase 7) and the UI marks them.
 */

import registry from "../cards/registry.json";
import type { CardRegistry } from "../cards/types.ts";
import { importCryptCard } from "./cardinfo.ts";
import type {
  CardInstance,
  GameState,
  MinionState,
  PermanentInPlay,
  SeatState,
} from "../engine/index.ts";
import { rngInt } from "../engine/rng.ts";
import { buildHandlerRegistry } from "../cards/effects/cards.ts";

const reg = registry as unknown as CardRegistry;
/** Built once: the crypt self-entry lookup runs per vampire per game. */
const registryHandlers = buildHandlerRegistry();

/**
 * A vampire in a playtest deck: a real V5 crypt card, by KRCG id (ids are
 * stable and are what deck lists and the phase-7 importer use). Name,
 * capacity, clan, disciplines, sect, title and the card scan all come from
 * the registry — nothing is hand-written any more.
 *
 * Its special ABILITY is still not implemented (crypt is 0/217); the UI
 * marks such a vampire so a playtest is not misled.
 */
export interface DeckVampire {
  id: number;
}

/**
 * A REAL deck, the thing a player builds and the deck importer produces:
 * a crypt and a library, and nothing else. Where it starts on the table is
 * not part of a deck — that is what dealing is for (p. 14).
 *
 * One entry per copy in both lists, so a deck with three copies of a card
 * has three entries. That matches how deck-builder exports read and keeps
 * `library.length` the number p. 14 puts a limit on.
 */
export interface DeckList {
  kind: "deck";
  seat: string;
  /** Crypt cards by KRCG id, one entry per copy. At least 12 (p. 14). */
  crypt: DeckVampire[];
  /** Library card names, one entry per copy. Between 60 and 90 (p. 14). */
  library: string[];
}

/**
 * A hand-authored MID-GAME position: vampires already in play, counters
 * already spent, a pool that has to add up (see poolSpent). This is what
 * `config/playtest-decks.json` holds and what every scenario fixture uses.
 *
 * It is deliberately NOT the same type as a deck. A snapshot says where
 * everything already is; a deck says only what is in it.
 */
export interface SnapshotDeck {
  seat: string;
  /** Vampires that start in the ready region, so a playtest can do
   *  something on turn 1 rather than spending three turns influencing. */
  ready: DeckVampire[];
  /** Vampires that start mid-influence, with counters already on them. */
  uncontrolled: Array<{ vampire: DeckVampire; counters: number }>;
  /** Vampires still in the crypt pile. */
  crypt: DeckVampire[];
  /** Library card names; each entry is one copy. */
  library: string[];
  pool: number;
}

/** Either kind of starting position. The `kind` tag is what tells them
 *  apart, and only a real deck carries it. */
export type DeckDef = SnapshotDeck | DeckList;

/** Is this a real deck to be dealt, rather than a mid-game snapshot? */
export function isDeckList(deck: DeckDef): deck is DeckList {
  return "kind" in deck && deck.kind === "deck";
}

/** p. 14: "at least 12 cards in their crypt and between 60 and 90 cards
 *  in their library. There is no maximum limit on … their crypt." */
export const MIN_CRYPT = 12;
export const MIN_LIBRARY = 60;
export const MAX_LIBRARY = 90;
/** p. 14: "Draw the top seven library cards to form your hand." */
export const STARTING_HAND = 7;
/** p. 14: "deal the top four crypt cards face down into your uncontrolled
 *  region." */
export const STARTING_UNCONTROLLED = 4;

export interface DeckValidation {
  ok: boolean;
  /** Card names not present in the V5 registry at all. */
  unknown: string[];
  /** Card names in the registry but not yet implemented. */
  unsupported: string[];
  /** Crypt ids not in the V5 pool. */
  badCryptIds: number[];
  /** Vampires whose printed ability is not implemented (crypt is 0/217).
   *  Not an error — the game is playable, the ability simply does nothing —
   *  but it is reported so a playtest is never misled. */
  inertAbilities: string[];
  /** Seats whose starting pool does not match what influencing their
   *  starting vampires would actually have cost (see poolLedger()).
   *  Reported rather than fatal: a scenario may want an odd pool on
   *  purpose. Empty for a mid-game snapshot that adds up. */
  poolMismatches: Array<{ seat: string; configured: number; expected: number }>;
  /**
   * Real decks that break p. 14's construction limits. FATAL, unlike the
   * pool ledger: a snapshot may legitimately be an odd position, but a
   * deck too small to deal cannot be played at all.
   */
  illegalDecks: Array<{ seat: string; problem: string }>;
}

/** A Methuselah starts the game with 30 pool (p. 14). */
export const STARTING_POOL = 30;

/**
 * What a deck's starting position actually cost in pool.
 *
 * Influence moves counters one-for-one from your pool onto a vampire in
 * your uncontrolled region, and when the counters reach its capacity the
 * vampire is yours and the counters become its blood (p. 35, p. 36 — the
 * engine does exactly this in the influence phase). So a mid-game snapshot
 * that starts a seat with vampires already in play has to have PAID for
 * them: one pool per point of capacity for every ready vampire, plus one
 * per counter still sitting on an uncontrolled one.
 *
 * Vampires still in the crypt pile cost nothing — they have not been
 * influenced at all.
 */
export function poolSpent(deck: SnapshotDeck): number {
  let spent = 0;
  for (const v of deck.ready) spent += importCryptCard(v.id).capacity;
  for (const u of deck.uncontrolled) spent += u.counters;
  return spent;
}

/** Every crypt card in a starting position, however it is expressed. */
function allVampires(deck: DeckDef): DeckVampire[] {
  if (isDeckList(deck)) return deck.crypt;
  return [...deck.ready, ...deck.uncontrolled.map((u) => u.vampire), ...deck.crypt];
}

const libraryByName = new Map<string, { supported: boolean }>();
for (const entry of Object.values(reg.entries)) {
  if (entry.card.kind === "library") {
    libraryByName.set(entry.card.name, { supported: entry.supported });
  }
}

/** Validate every card in every deck — library names and crypt ids
 *  (design §6). Nothing is ever silently dropped. */
export function validateDecks(decks: DeckDef[]): DeckValidation {
  const unknown = new Set<string>();
  const unsupported = new Set<string>();
  const badCryptIds = new Set<number>();
  const inertAbilities = new Set<string>();
  for (const deck of decks) {
    for (const name of deck.library) {
      const found = libraryByName.get(name);
      if (!found) unknown.add(name);
      else if (!found.supported) unsupported.add(name);
    }
    for (const v of allVampires(deck)) {
      try {
        const card = importCryptCard(v.id);
        if (card.hasUnimplementedAbility) inertAbilities.add(card.name);
      } catch {
        badCryptIds.add(v.id);
      }
    }
  }
  // Pool ledger: a seat that starts with vampires in play must have paid
  // for them. Only checked for decks whose crypt ids all resolved, since
  // poolSpent() reads capacities from the registry.
  const poolMismatches: DeckValidation["poolMismatches"] = [];
  if (badCryptIds.size === 0) {
    for (const deck of decks) {
      if (isDeckList(deck)) continue; // a dealt game always starts at 30
      const expected = STARTING_POOL - poolSpent(deck);
      if (deck.pool !== expected) {
        poolMismatches.push({ seat: deck.seat, configured: deck.pool, expected });
      }
    }
  }

  // p. 14's construction limits, checked only on REAL decks: a snapshot is
  // a position, not a deck, and is meant to be small.
  const illegalDecks: DeckValidation["illegalDecks"] = [];
  for (const deck of decks) {
    if (!isDeckList(deck)) continue;
    if (deck.crypt.length < MIN_CRYPT) {
      illegalDecks.push({
        seat: deck.seat,
        problem: `crypt has ${deck.crypt.length} cards; at least ${MIN_CRYPT} are needed`,
      });
    }
    if (deck.library.length < MIN_LIBRARY || deck.library.length > MAX_LIBRARY) {
      illegalDecks.push({
        seat: deck.seat,
        problem: `library has ${deck.library.length} cards; it must hold between ${MIN_LIBRARY} and ${MAX_LIBRARY}`,
      });
    }
  }
  return {
    // Inert crypt abilities are reported, not fatal: the vampire is a real
    // card with real stats and the game plays fine without its text.
    ok:
      unknown.size === 0 &&
      unsupported.size === 0 &&
      badCryptIds.size === 0 &&
      illegalDecks.length === 0,
    unknown: [...unknown].sort(),
    unsupported: [...unsupported].sort(),
    badCryptIds: [...badCryptIds].sort((a, b) => a - b),
    inertAbilities: [...inertAbilities].sort(),
    poolMismatches,
    illegalDecks,
  };
}

function makeVampire(v: DeckVampire, id: string, seat: string, inCrypt: boolean): MinionState {
  const card = importCryptCard(v.id);
  // A Path is a printed trait, so it travels with clan/sect/title rather
  // than being granted by anything in play (docs/path-cards-design.md §1).
  // Spread-in, because `path` is optional and an explicit `undefined` would
  // still create the key.
  const path = card.path !== undefined ? { path: card.path } : {};
  // Same treatment, and for the same reason: the city is what a title
  // contest keys on (p. 18), and an explicit `undefined` would still
  // create the key. docs/contested-design.md §6
  const titleCity = card.titleCity !== undefined ? { titleCity: card.titleCity } : {};
  return {
    ...path,
    ...titleCity,
    id,
    name: card.name,
    kind: "vampire",
    controller: seat,
    owner: seat,
    blood: inCrypt ? 0 : card.capacity,
    capacity: card.capacity,
    strength: 1,
    bleedAmount: 1,
    locked: false,
    awake: false,
    inTorpor: false,
    disciplines: { ...card.disciplines },
    bledThisTurn: false,
    calledPoliticalThisTurn: false,
    title: card.title,
    clan: card.clan,
    sect: card.sect,
    cannotActThisTurn: false,
    playedSinceUnlock: [],
    // A crypt card's own ability text rides onto the vampire as a
    // SELF-ATTACHED entry, exactly as an ally's does — which is what lets
    // the whole `permanent` vocabulary reach it (docs/crypt-plan.md §2).
    // A vampire whose card is a bare sect/title line has no spec and gets
    // no entry, which is most of the crypt.
    attached: cryptSelfEntry(card.name, id, seat),
  };
}

/** The self-attached entry a crypt card puts on its own vampire, or none. */
function cryptSelfEntry(name: string, id: string, seat: string): PermanentInPlay[] {
  const handler = registryHandlers[name];
  const entry = handler?.cryptEntry?.();
  if (!entry) return [];
  return [
    {
      card: { id, name },
      controller: seat,
      owner: seat,
      locked: false,
      usedThisPhase: false,
      statics: entry.statics,
      tags: entry.tags,
    },
  ];
}

/** Fisher-Yates through the same seeded RNG the engine uses, so a game is
 *  reproducible from its seed (architecture principle 2). */
function shuffle<T>(cards: T[], rng: { rngState: number }): T[] {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rngInt(rng, i + 1);
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}

export interface GameSetup {
  decks: DeckDef[];
  seed: number;
  /** Engine safeguard, not a rule — null for an unlimited playtest. */
  maxTurns: number | null;
  /**
   * Who takes the first turn. p. 14: "Randomly determine a Methuselah to
   * act as first Methuselah" — so when this is absent one is picked with
   * the seeded RNG, which keeps the game reproducible from its seed.
   *
   * Seating ORDER is `decks` order and is not affected: the table is a
   * cycle (your prey is on your left), so choosing who starts rotates it
   * and changes nobody's neighbours. The lobby will set this once seats
   * are taken.
   */
  firstSeat?: string;
}

/**
 * Deal a real game from real decks — the p. 14 setup, in the order the
 * rulebook gives it:
 *
 *   "separate your crypt cards from your library cards. Shuffle both
 *    decks … Draw the top seven library cards to form your hand and deal
 *    the top four crypt cards face down into your uncontrolled region.
 *    You can look at the cards in your hand and in your uncontrolled
 *    region at any time during the game."
 *
 * and 30 pool each from the blood bank (p. 15).
 *
 * Nothing starts in play. That is the whole difference from the hand-
 * authored snapshots the playtest has used until now: those exist to skip
 * the opening, and a real game does not skip it — the first few turns ARE
 * influencing, which is why the transfer ramp (p. 24, and already in the
 * engine as `min(turnNumber, 4)`) exists.
 *
 * "Face down" needs no flag: the uncontrolled region is masked to its
 * owner by `redactFor`, which is where that rule already lives
 * (docs/debug-ui-design.md, PlayerView).
 */
function dealSeat(deck: DeckList, rng: { rngState: number }): SeatState {
  const crypt = shuffle(
    deck.crypt.map((v, k) => makeVampire(v, `${deck.seat}-c${k}`, deck.seat, true)),
    rng,
  );
  const library = shuffle(
    deck.library.map((name, k) => ({ id: `${deck.seat}-lib-${k}`, name }) as CardInstance),
    rng,
  );
  return {
    id: deck.seat,
    pool: STARTING_POOL,
    minions: [],
    uncontrolled: crypt
      .slice(0, STARTING_UNCONTROLLED)
      .map((card) => ({ card, counters: 0 })),
    crypt: crypt.slice(STARTING_UNCONTROLLED),
    hand: library.slice(0, STARTING_HAND),
    library: library.slice(STARTING_HAND),
    ousted: false,
    victoryPoints: 0,
    delayedDraws: 0,
    outOfTurnMasterUsed: false,
    permanents: [],
    autoPassWhenOnlyPass: false,
  };
}

/**
 * Build the initial GameState. Deterministic in `seed`: the same setup
 * replays identically, which is what makes undo and save/load a replay
 * rather than a snapshot stack (design §5).
 */
export function buildGame(setup: GameSetup): GameState {
  const rng = { rngState: setup.seed };
  const seats: SeatState[] = setup.decks.map((deck) => {
    // A real deck is DEALT (p. 14); a snapshot is placed as written.
    if (isDeckList(deck)) return dealSeat(deck, rng);
    const shuffled = shuffle(
      deck.library.map((name, k) => ({ id: `${deck.seat}-lib-${k}`, name }) as CardInstance),
      rng,
    );
    return {
      id: deck.seat,
      pool: deck.pool,
      minions: deck.ready.map((v, k) => makeVampire(v, `${deck.seat}-v${k}`, deck.seat, false)),
      uncontrolled: deck.uncontrolled.map((u, k) => ({
        card: makeVampire(u.vampire, `${deck.seat}-u${k}`, deck.seat, true),
        counters: u.counters,
      })),
      crypt: deck.crypt.map((v, k) => makeVampire(v, `${deck.seat}-c${k}`, deck.seat, true)),
      hand: shuffled.slice(0, 7),
      library: shuffled.slice(7),
      ousted: false,
      victoryPoints: 0,
      delayedDraws: 0,
      outOfTurnMasterUsed: false,
      permanents: [],
      autoPassWhenOnlyPass: false,
    };
  });

  // "Randomly determine a Methuselah to act as first Methuselah" (p. 14).
  // Rotating the seat array is the whole of it: the table is a cycle, so
  // everyone keeps the same prey and predator and only the starting point
  // moves. A snapshot with no `firstSeat` keeps seat 0, which is what
  // every existing fixture and saved game expects — the RNG is only ever
  // touched when the choice is actually being made.
  const named = setup.firstSeat ? seats.findIndex((s) => s.id === setup.firstSeat) : -1;
  const first =
    named >= 0 ? named : setup.decks.some(isDeckList) ? rngInt(rng, seats.length) : 0;
  const order = [...seats.slice(first), ...seats.slice(0, first)];

  return {
    seats: order,
    edge: null,
    frames: [
      {
        kind: "turn",
        seat: order[0]!.id,
        phase: "unlock",
        turnNumber: 1,
        unlockDone: false,
        edgeDone: false,
        unlockAbilitiesDone: false,
        unlockOthersDone: [],
        transfersLeft: 0,
        masterActionsLeft: 0,
        trifleGained: false,
      },
    ],
    eventLog: [],
    commandLog: [],
    decisionSeq: 0,
    rngState: rng.rngState,
    maxTurns: setup.maxTurns,
  };
}
