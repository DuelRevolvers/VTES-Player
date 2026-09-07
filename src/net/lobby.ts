/**
 * The lobby (docs/lobby-design.md) — the room people gather in before a
 * game starts.
 *
 * It holds a `TableConfig` (the same one the private-play screen builds)
 * and lets arriving players take the seats marked open and say what deck
 * they are bringing. When the host starts, it builds the game, hands it to
 * a `HostSession`, and the very same channels carry the game from then on.
 *
 * ONE CONNECTION, TWO PHASES. A peer does not reconnect when the game
 * begins: the lobby messages and the game messages share a channel, so
 * there is no window in which a player is connected to neither.
 *
 * WHAT A PEER IS TOLD is a summary, never the table's data: seat names,
 * whether each has a deck, and why the game cannot start. A deck LIST is
 * not sent to anyone — it is the sender's business and, once the game
 * starts, hidden information.
 */

import { HeuristicAgent } from "../ai/heuristic.ts";
import { addChat } from "../ui/chat.ts";
import { DevServerSink, GameLog } from "../ui/gamelog.ts";
import type { SeatConfig, TableConfig } from "../ui/newgame.ts";
import { botSeats, buildTable, MAX_SEATS, seatDeckHash } from "../ui/newgame.ts";
import { avatarProblem, colorProblem, nameProblem } from "../ui/profile.ts";
import type { GameResult } from "../ui/results.ts";
import { recordResult } from "../ui/results.ts";
import { loadSettings, OPENING_DELAY_MS, seatSeed } from "../ui/settings.ts";
import { LocalTransport } from "../ui/transport.ts";
import { HostSession } from "./host.ts";
import type {
  HostChannel,
  HostMessage,
  LobbySeat,
  PeerChannel,
  JoinMsg,
  PeerMessage,
  SetDeckMsg,
  SetNameMsg,
} from "./protocol.ts";
import { PROTOCOL_VERSION } from "./protocol.ts";

/** A colour off the wire, or nothing. One gate, both join paths. */
const cleanColor = (c: string | undefined): string | null =>
  c && !colorProblem(c) ? c : null;

interface LobbyGuest {
  channel: HostChannel;
  name: string;
  /** The seat they were given, or null if the table was full. */
  seat: string | null;
  /** Their chosen name colour, validated on arrival. The HOST holds it so
   *  it can be stamped onto every line it relays for them. */
  chatColor: string | null;
  off: () => void;
}

export class LobbyHost {
  private readonly guests: LobbyGuest[] = [];
  private session: HostSession | null = null;

  private started = false;

  constructor(
    public readonly code: string,
    private table: TableConfig,
    /** Called when the game starts, so the host's own screen can hand over
     *  to the table. */
    private readonly onStart: (t: LocalTransport, s: HostSession) => void,
    /**
     * The finished game, when there is one.
     *
     * HELD RATHER THAN RECORDED: the leaderboard row is the player's to
     * accept at the end-of-game prompt (owner request), so this hands it
     * over rather than writing it. Defaults to `recordResult` so a caller
     * that has no prompt — a test — keeps the old behaviour.
     */
    private readonly onResult: (r: GameResult) => void = recordResult,
  ) {}

  /** The lobby as the host's own screen shows it. */
  get seats(): SeatConfig[] {
    return this.table.seats;
  }

  get canStart(): boolean {
    return !this.started && buildTable(this.table).setup !== null;
  }

  /** Why not, for the host's screen and for every guest. */
  get problems(): string[] {
    return buildTable(this.table).problems.map((p) =>
      p.seat ? `${p.seat}: ${p.problem}` : p.problem,
    );
  }

  /** Change the table from the host's own screen (seat count, bots, decks). */
  update(table: TableConfig): void {
    this.table = table;
    this.broadcast();
  }

  accept(channel: HostChannel): void {
    const off = channel.onMessage((msg) => this.handle(channel, msg, off));
  }

  /** People watching this table rather than sitting at it. */
  get spectatorCount(): number {
    return this.guests.filter((g) => g.seat === null && g.channel.open).length;
  }

  /**
   * Tell the host's own screen that something changed.
   *
   * Every guest already learns through `broadcast`; the host learned
   * nothing, so a player joining, renaming or choosing a deck updated the
   * host's `TableConfig` and left the screen showing the state before it
   * (owner-reported 2026-09-06, "the host lobby doesn't update"). The
   * screen is a pure function of this object, so it only ever needed to
   * be told to repaint.
   */
  onChanged(cb: () => void): () => void {
    this.watchers.add(cb);
    return () => this.watchers.delete(cb);
  }

  private readonly watchers = new Set<() => void>();

  /** Say something as the host, and relay it to everyone. */
  say(text: string, from: string, system = false, color: string | null = null): void {
    const tint = color && !colorProblem(color) ? { color } : {};
    const line = {
      type: "chatLine" as const,
      from,
      text,
      at: Date.now(),
      ...(system ? { system: true } : {}),
      ...tint,
    };
    addChat({ from, text, at: line.at, ...(system ? { system: true } : {}), ...tint });
    for (const g of this.guests) if (g.channel.open) g.channel.send(line);
    // THE HOST'S OWN SCREEN HAS TO BE TOLD, exactly as it does for a seat
    // change. Without this a guest's message reached the store and sat
    // there until something else happened to repaint — the same bug as
    // "the host lobby doesn't update", one message type along.
    this.notify();
  }

  private handle(channel: HostChannel, msg: PeerMessage, off: () => void): void {
    if (msg.type === "join") this.onJoin(channel, msg, off);
    else if (msg.type === "setDeck") this.onSetDeck(channel, msg);
    else if (msg.type === "setName") this.onSetName(channel, msg);
    else if (msg.type === "leave") this.onLeave(channel);
    else if (msg.type === "chat") {
      // The host is the only relay, so everybody lists the conversation in
      // the same order — including the sender, who does not add it locally.
      // The colour comes from what the HOST recorded at join, not from
      // the message — a guest may not write somebody else's name into the
      // conversation, and may not paint one either.
      const guest = this.guests.find((g) => g.channel === channel);
      this.say(msg.text, guest?.name ?? "someone", false, guest?.chatColor ?? null);
    }
    // Game-phase messages are the HostSession's business once it exists;
    // it has its own subscription on the same channel.
  }

  private onJoin(channel: HostChannel, msg: JoinMsg, off: () => void): void {
    const { version, name } = msg;
    if (version !== PROTOCOL_VERSION) {
      channel.send({
        type: "bye",
        reason: `this table speaks protocol ${PROTOCOL_VERSION}, you speak ${version}`,
      });
      channel.close();
      return;
    }
    // A SPECTATOR takes no seat, so none of the seat rules apply and there
    // is no limit on how many may watch. They are kept in the same guest
    // list with `seat: null`, which means they are handed to the game
    // session at start along with everyone else.
    if (msg.spectate) {
      this.guests.push({
        channel,
        name: name.trim() || "Spectator",
        seat: null,
        chatColor: cleanColor(msg.chatColor),
        off,
      });
      this.broadcast();
      return;
    }
    if (this.started) {
      channel.send({ type: "bye", reason: "that game has already started" });
      channel.close();
      return;
    }
    const open = this.table.seats.find((s) => s.kind === "open");
    if (!open) {
      channel.send({ type: "bye", reason: "this table is full" });
      channel.close();
      return;
    }
    // The seat takes the player's name, because a seat name IS the
    // engine's seat id and the mat is labelled with it. Two players with
    // the same name is the one uniqueness rule that exists at all without
    // an account server, so the later arrival is numbered.
    open.name = this.uniqueName(name);
    // Mark it TAKEN, or the next arrival finds the same open seat and
    // renames it out from under this player. Found by the second-guest
    // test, which is why there is one.
    open.kind = "remote";
    // Their picture travels with them, so the table can put a face to the
    // name. Refused unless it is a small image data URI — the same check
    // the profile makes on the way in, applied again here because this one
    // arrived over the wire from somebody else's client.
    open.avatar = msg.avatar && !avatarProblem(msg.avatar) ? msg.avatar : null;
    this.guests.push({
      channel,
      name: open.name,
      seat: open.name,
      chatColor: cleanColor(msg.chatColor),
      off,
    });
    this.broadcast();
  }

  private uniqueName(name: string): string {
    const taken = new Set(this.table.seats.map((s) => s.name));
    const base = name.trim() || "Player";
    if (!taken.has(base)) return base;
    for (let n = 2; n < MAX_SEATS + 2; n++) {
      if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
    }
    return `${base} ${Date.now() % 1000}`;
  }

  private onSetDeck(channel: HostChannel, msg: SetDeckMsg): void {
    const guest = this.guests.find((g) => g.channel === channel);
    if (!guest || !guest.seat || this.started) return;
    const seat = this.table.seats.find((s) => s.name === guest.seat);
    if (!seat) return;
    seat.deck = msg.deck;
    // Validation is the host's, and its RESULT goes to everyone: a player
    // whose deck is refused must be told why, and the others must be told
    // why the game is not starting.
    this.broadcast();
  }

  /**
   * A guest renaming themselves.
   *
   * The HOST decides the final name, because a seat name is the engine's
   * seat id and two seats cannot share one — so a clash is numbered, the
   * same rule an arrival gets. The guest is told the result by the
   * broadcast rather than assuming its request stood.
   *
   * Refused once the game has started: by then the name is a seat id
   * threaded through the command log, the event log and the save file.
   */
  private onSetName(channel: HostChannel, msg: SetNameMsg): void {
    const guest = this.guests.find((g) => g.channel === channel);
    if (!guest || !guest.seat || this.started) return;
    const seat = this.table.seats.find((s) => s.name === guest.seat);
    if (!seat) return;
    const wanted = msg.name.trim();
    if (wanted === "" || wanted === seat.name) return;
    if (nameProblem(wanted)) return;
    // `uniqueName` measures against every seat INCLUDING this one, so a
    // guest re-sending their own name would be numbered. Free it first.
    seat.name = "";
    seat.name = this.uniqueName(wanted);
    guest.seat = seat.name;
    guest.name = seat.name;
    this.broadcast();
  }

  private onLeave(channel: HostChannel): void {
    const i = this.guests.findIndex((g) => g.channel === channel);
    if (i < 0) return;
    const [guest] = this.guests.splice(i, 1);
    if (!guest) return;
    guest.off();
    const seat = this.table.seats.find((s) => s.name === guest.seat);
    if (seat && !this.started) {
      // The seat opens again, empty. Keeping their deck would deal a game
      // with a deck nobody at the table brought.
      seat.name = "Open seat";
      seat.kind = "open";
      seat.deck = null;
    }
    this.broadcast();
  }

  private lobbyFor(guest: LobbyGuest | null): HostMessage {
    const build = buildTable(this.table);
    const seats: LobbySeat[] = this.table.seats.map((s) => ({
      name: s.name,
      kind: s.kind,
      mine: guest?.seat === s.name,
      // A LABEL, never the list. What is in a deck is its owner's
      // business, and after the deal it is hidden information.
      deck:
        s.deck === null
          ? null
          : s.deck.kind === "precon"
            ? `${s.deck.name} — ${s.deck.set}`
            : "a pasted deck list",
      // The fingerprint IS shared, and that is the point of it: it says
      // two decks are the same without saying what either contains.
      deckHash: seatDeckHash(s),
      ready: s.deck !== null,
      avatar: s.avatar ?? null,
    }));
    return {
      type: "lobby",
      code: this.code,
      seats,
      you: guest?.seat ?? null,
      problems: build.problems.map((p) => (p.seat ? `${p.seat}: ${p.problem}` : p.problem)),
      canStart: build.setup !== null,
    };
  }

  /** Tell this client's own screen. A chat line changes nothing about the
   *  table, so it needs this and not a whole `broadcast`. */
  private notify(): void {
    for (const cb of [...this.watchers]) cb();
  }

  private broadcast(): void {
    this.notify();
    for (const guest of this.guests) {
      if (guest.channel.open) guest.channel.send(this.lobbyFor(guest));
    }
  }

  /**
   * Deal the game and hand every channel to a `HostSession`.
   *
   * The guests are told `started` first, so a client knows to stop
   * rendering a lobby before the first `sync` lands on it.
   */
  start(): { transport: LocalTransport; session: HostSession } | null {
    const build = buildTable(this.table);
    if (!build.setup || this.started) return null;
    this.started = true;

    const transport = new LocalTransport({
      setup: build.setup,
      log: new GameLog(new DevServerSink(), build.setup),
      // The HOST computes the result: it is the only side that sees the
      // game end, since a peer is simply told the final state. What is
      // done with it is the caller's — see `onResult`.
      onResult: this.onResult,
      // The pacing has to be live BEFORE the agents are attached below,
      // or every bot turn ahead of the first human decision is answered
      // instantly and the game opens on a board they already played
      // (owner report 2026-09-07). The host runs the agents, so this is
      // the one side that has to know — a peer only ever sees the result,
      // and sees it paced because the host paced it.
      aiDelayMs: loadSettings().aiDelayMs,
      openingDelayMs: OPENING_DELAY_MS,
      // What each seat brought, for the leaderboard row. A label, never a
      // list; resolved from the same seats the game is dealt from.
      deckLabels: Object.fromEntries(
        this.table.seats.flatMap((s) =>
          s.deck === null
            ? []
            : [
                [
                  s.name,
                  s.deck.kind === "precon"
                    ? `${s.deck.name} — ${s.deck.set}`
                    : "a pasted deck list",
                ] as const,
              ],
        ),
      ),
    });
    for (const seat of botSeats(this.table)) {
      transport.setAgent(seat, new HeuristicAgent({ seed: seatSeed(seat) }));
    }
    const session = new HostSession(transport);

    for (const guest of this.guests) {
      guest.off(); // the lobby stops listening; the session takes over
      if (!guest.channel.open) continue;
      guest.channel.send({ type: "started" });
      session.accept(guest.channel);
    }

    this.session = session;
    this.onStart(transport, session);
    return { transport, session };
  }

  close(reason = "the table closed"): void {
    this.session?.close(reason);
    for (const guest of this.guests) {
      guest.off();
      if (guest.channel.open) {
        guest.channel.send({ type: "bye", reason });
        guest.channel.close();
      }
    }
    this.guests.length = 0;

  }
}

/**
 * The guest side of a lobby.
 *
 * Holds the last lobby the host sent and calls back when the game starts,
 * at which point the caller swaps its lobby screen for a `PeerTransport`
 * on the SAME channel.
 */
export class LobbyPeer {
  private lobby: LobbyState | null = null;
  private goodbye: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly off: () => void;

  constructor(
    private readonly channel: PeerChannel,
    name: string,
    /** Fires once, when the host starts the game. */
    private readonly onStarted: () => void,
    /** Watch rather than play. */
    private readonly spectate = false,
    /** This player's picture, so the table can put a face to the name. */
    avatar: string | null = null,
    /** The colour their name is written in, so everyone sees them the
     *  same way. Travels with the join, like the picture. */
    chatColor: string | null = null,
  ) {
    this.off = this.channel.onMessage((msg) => this.receive(msg));
    this.channel.send({
      type: "join",
      version: PROTOCOL_VERSION,
      name,
      ...(spectate ? { spectate: true } : {}),
      ...(avatar ? { avatar } : {}),
      ...(chatColor ? { chatColor } : {}),
    });
  }

  /** True when this client is watching rather than taking a seat. */
  get spectating(): boolean {
    return this.spectate;
  }

  /**
   * Stop listening, leaving the channel open.
   *
   * Called when the game starts and a `PeerTransport` takes over the same
   * connection: the lobby has nothing further to say, and leaving it
   * subscribed would have two objects reading one stream.
   */
  detach(): void {
    this.off();
  }

  get state(): LobbyState | null {
    return this.lobby;
  }

  get closedReason(): string | null {
    return this.goodbye;
  }

  /** Say what deck you are bringing. Freely re-sent — the host revalidates
   *  and everyone sees the result. */
  setDeck(deck: SetDeckMsg["deck"]): void {
    this.channel.send({ type: "setDeck", deck });
  }

  /** Ask to be called something else. The HOST decides the final name —
   *  it is a seat id, and a clash gets numbered — and the answer comes
   *  back in the next lobby broadcast, not from here. */
  setName(name: string): void {
    this.channel.send({ type: "setName", name });
  }

  leave(): void {
    if (this.channel.open) this.channel.send({ type: "leave" });
    this.channel.close();
  }

  /** Say something. Nothing is added locally: the host relays it back, so
   *  every client lists one conversation in one order (src/ui/chat.ts). */
  say(text: string): void {
    if (this.channel.open) this.channel.send({ type: "chat", text });
  }

  onChanged(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private receive(msg: HostMessage): void {
    if (msg.type === "lobby") {
      this.lobby = {
        code: msg.code,
        seats: msg.seats,
        you: msg.you,
        problems: msg.problems,
        canStart: msg.canStart,
      };
      this.emit();
    } else if (msg.type === "chatLine") {
      addChat({
        from: msg.from,
        text: msg.text,
        at: msg.at,
        ...(msg.system ? { system: true } : {}),
        ...(msg.color ? { color: msg.color } : {}),
      });
      // …and repaint, or the line sits in the store unseen until something
      // else happens. Same omission as the host's `say`.
      this.emit();
    } else if (msg.type === "started") {
      this.onStarted();
    } else if (msg.type === "bye") {
      this.goodbye = msg.reason;
      this.emit();
    }
  }

  private emit(): void {
    for (const cb of [...this.listeners]) cb();
  }
}

export interface LobbyState {
  code: string;
  seats: LobbySeat[];
  you: string | null;
  problems: string[];
  canStart: boolean;
}
