/**
 * The host/peer wire protocol (docs/multiplayer-design.md) — phase 6.
 *
 * Everything the two sides say to each other, and nothing about HOW it is
 * carried. PeerJS is one carrier; an in-memory pair of queues is another,
 * and that is what the tests use. Keeping the protocol above the carrier
 * is the same move as `LocalServer : public Server` one level down
 * (docs/cockatrice-lessons.md §2): the interesting half is testable
 * without a network.
 *
 * THE HOST IS AUTHORITATIVE. A peer never holds a `GameState` it can act
 * on — it holds the last masked snapshot the host chose to send, and every
 * intent goes back to the host to be validated against the legal-move
 * generator. That was already true of the engine before any of this
 * existed: it enumerates every legal option and rejects anything else, so
 * the host-authoritative half needed no engine work at all.
 *
 * Two properties of the message shapes are load-bearing:
 *
 *  1. **A `sync` carries a MASKED state.** Not the game state with a note
 *     saying what to hide — the hidden cards are already gone when it
 *     leaves the host. A peer cannot leak what it was never sent.
 *  2. **A `choose` names the decision it is answering** (`seq`). Over a
 *     network a click can arrive after the decision it was made against
 *     has already been answered by somebody else; the host refuses it
 *     rather than applying it to whatever is current now.
 */

import type { DecisionPoint, GameState, SeatId } from "../engine/index.ts";

/** The protocol version. A peer on a different one is turned away with a
 *  message rather than left to fail in a confusing way later. */
export const PROTOCOL_VERSION = 1;

// --- peer → host -----------------------------------------------------------

/** "Let me in." Sent once on connect, and again on a reconnect — the same
 *  `seat` re-attaches to that seat rather than taking a new one. */
export interface HelloMsg {
  type: "hello";
  version: number;
  /** The seat this peer is claiming, as assigned by the lobby. Ignored
   *  when `spectate` is set — a spectator claims none. */
  seat: SeatId;
  /** Display name, for the lobby. Not a game concept. */
  name?: string;
  /**
   * Watch rather than play. A spectator is sent the table masked to
   * NOBODY — every hand face down, including the one they might have been
   * given — and never a decision, so there is nothing for them to answer
   * and nothing of anyone's to read.
   */
  spectate?: boolean;
}

/** "I choose this option, in answer to decision `seq`." */
export interface ChooseMsg {
  type: "choose";
  /** Per-peer request id, echoed in the ack so a caller can await it. */
  id: number;
  /** The `DecisionPoint.seq` this answers. Stale answers are refused. */
  seq: number;
  option: string;
}

/**
 * "I would like a seat at this table." Sent on arriving in a LOBBY, where
 * the host assigns the seat — unlike `hello`, which names a seat already
 * held and is how a dropped player comes back to a game in progress.
 */
export interface JoinMsg {
  type: "join";
  version: number;
  name: string;
  /** Watch rather than take a seat. A spectator is subject to none of the
   *  seat rules — any number may watch — and is sent the table masked to
   *  nobody once the game begins. */
  spectate?: boolean;
  /**
   * The joiner's avatar, as a data URI, so the table can put a face to a
   * name. Optional — a player with no picture is not a problem — and it
   * comes from their own profile, which is the only place one exists.
   *
   * Capped by the same limit the profile enforces (64KB, downscaled to
   * 128px), so it cannot be used to push a large payload at the host.
   */
  avatar?: string;
}

/** "This is the deck I am bringing." Re-sent freely: the lobby revalidates
 *  and tells everyone whether the table can start. */
export interface SetDeckMsg {
  type: "setDeck";
  /** A precon by set and name, or a pasted deck list. */
  deck: { kind: "precon"; set: string; name: string } | { kind: "paste"; text: string };
}

/**
 * "Call me this instead."
 *
 * A name arrives from the joiner's profile, which is the right default;
 * changing it in the lobby is a separate act, because a seat name IS the
 * engine's seat id and two players at one table cannot share one. The host
 * decides the final name (it may number a clash) and says so in the next
 * lobby broadcast — the client never assumes its request was taken.
 *
 * Refused once the game has started: the name is the seat id by then, and
 * renaming it would rewrite the command log's subject halfway through.
 */
export interface SetNameMsg {
  type: "setName";
  name: string;
}

/** "I am leaving." Distinct from simply vanishing: it frees the seat. */
export interface LeaveMsg {
  type: "leave";
}

export type PeerMessage =
  | HelloMsg
  | ChooseMsg
  | JoinMsg
  | SetDeckMsg
  | SetNameMsg
  | LeaveMsg;

// --- host → peer -----------------------------------------------------------

/** "You are in, and you are this seat." */
export interface WelcomeMsg {
  type: "welcome";
  version: number;
  /** Null for a SPECTATOR: someone watching a seat they do not hold. */
  seat: SeatId | null;
  /** Every seat at the table, in seating order. */
  seats: SeatId[];
}

/**
 * The whole of what a peer knows: the table as this peer may see it, and
 * the decision it is being asked for — `null` when the game is waiting on
 * somebody else.
 *
 * The decision is withheld rather than merely ignored, because a
 * `DecisionPoint` carries the seat's legal OPTIONS, and another seat's
 * option list says what is in their hand.
 */
export interface SyncMsg {
  type: "sync";
  state: GameState;
  decision: DecisionPoint | null;
}

/** The answer to one `choose`. `error` means the host refused it. */
export interface AckMsg {
  type: "ack";
  id: number;
  error?: string;
}

/** Turned away, or the game has ended. */
export interface ByeMsg {
  type: "bye";
  reason: string;
}

/** One seat as the lobby shows it. Deliberately a SUMMARY: a peer sees
 *  that a seat has a deck, never what is in it. */
export interface LobbySeat {
  name: string;
  /** "remote" is a seat another player has taken; "you" is the host's own.
   *  A recipient tells their own seat apart by `mine`, not by this. */
  kind: "you" | "ai" | "open" | "remote";
  /** Whose it is, from the recipient's point of view. */
  mine: boolean;
  /** A label such as "Brujah — Fifth Edition (Anarch)", or null. */
  deck: string | null;
  /**
   * The deck's fingerprint, so two players can confirm they have the same
   * cards without reading 90 lines aloud (docs/lobby-design.md §9). Null
   * when the deck has no valid build — there is nothing to fingerprint.
   */
  deckHash: string | null;
  ready: boolean;
  /** This player's avatar, as a data URI, or null (a bot, or a player
   *  with no picture). Shown in the lobby and on the mat in game. */
  avatar?: string | null;
}

/** The whole lobby, re-sent on every change. Same reasoning as `sync`:
 *  small enough to re-send, and no divergence to debug. */
export interface LobbyMsg {
  type: "lobby";
  code: string;
  seats: LobbySeat[];
  /** The seat this peer holds, or null while still waiting for one. */
  you: string | null;
  /** Why the host cannot start yet. Everyone sees it, so nobody has to
   *  ask why the button is greyed out. */
  problems: string[];
  canStart: boolean;
}

/** The lobby is over; the game messages start now. */
export interface StartedMsg {
  type: "started";
}

export type HostMessage = WelcomeMsg | SyncMsg | AckMsg | ByeMsg | LobbyMsg | StartedMsg;

/**
 * A two-way link carrying one side's messages to the other.
 *
 * Deliberately tiny, and deliberately not a PeerJS type: a `DataConnection`
 * satisfies it with a few lines of adapter, and so does a pair of arrays.
 * Nothing above this line knows which it is talking to.
 */
export interface Channel<In, Out> {
  send(msg: Out): void;
  onMessage(cb: (msg: In) => void): () => void;
  close(): void;
  /** True until `close()`. A send on a closed channel is dropped, not an
   *  error: a peer disappearing is ordinary, not exceptional. */
  readonly open: boolean;
}

export type HostChannel = Channel<PeerMessage, HostMessage>;
export type PeerChannel = Channel<HostMessage, PeerMessage>;

/**
 * A connected pair of channels, for tests and for a same-tab "join your own
 * game" mode. Messages are delivered ASYNCHRONOUSLY (a resolved promise, so
 * on the microtask queue) on purpose: a loopback that delivered
 * synchronously would let a re-entrancy bug through that a real network
 * would find immediately.
 */
export function loopback(): { host: HostChannel; peer: PeerChannel } {
  const toHost: Array<(m: PeerMessage) => void> = [];
  const toPeer: Array<(m: HostMessage) => void> = [];
  let open = true;

  // A message is dropped only if the channel was ALREADY closed when it
  // was sent. Once it is on the wire a later close does not recall it —
  // which matters because every goodbye is "send bye, then close", and a
  // loopback that cancelled it would make a peer look like it silently
  // vanished when in fact it had been told why.
  const deliver = <T>(subs: Array<(m: T) => void>, msg: T): void => {
    if (!open) return;
    void Promise.resolve().then(() => {
      for (const cb of [...subs]) cb(msg);
    });
  };

  return {
    host: {
      send: (m) => deliver(toPeer, m),
      onMessage: (cb) => {
        toHost.push(cb);
        return () => {
          const i = toHost.indexOf(cb);
          if (i >= 0) toHost.splice(i, 1);
        };
      },
      close: () => {
        open = false;
      },
      get open() {
        return open;
      },
    },
    peer: {
      send: (m) => deliver(toHost, m),
      onMessage: (cb) => {
        toPeer.push(cb);
        return () => {
          const i = toPeer.indexOf(cb);
          if (i >= 0) toPeer.splice(i, 1);
        };
      },
      close: () => {
        open = false;
      },
      get open() {
        return open;
      },
    },
  };
}
