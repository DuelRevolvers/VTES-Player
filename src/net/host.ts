/**
 * The host side of a networked game (docs/multiplayer-design.md).
 *
 * The host runs the real engine — a `LocalTransport`, exactly the one
 * hotseat uses — and serves every other player from it. That is the whole
 * of Cockatrice's `LocalServer : public Server` lesson: single-player is
 * not a special code path, it is the authority running in-process, and
 * this class is the same authority with sockets attached.
 *
 * What it adds over the local game is only what the network makes
 * necessary:
 *
 *  - **Masking per recipient.** Each peer is sent `stateFor(their seat)`,
 *    never the deciding seat's view and never the raw state.
 *  - **Withholding decisions.** A peer is sent a `DecisionPoint` only when
 *    it is theirs; another seat's option list would say what is in their
 *    hand.
 *  - **Refusing stale answers.** A click made against decision 41 must not
 *    be applied to decision 42.
 *
 * Everything else was already true: the engine enumerates every legal
 * option and rejects anything else, so an intent from a peer is validated
 * by the same code that validates a click.
 */

import { HeuristicAgent } from "../ai/heuristic.ts";
import type { SeatId } from "../engine/index.ts";
import { addChat } from "../ui/chat.ts";
import { colorProblem } from "../ui/profile.ts";
import { seatSeed } from "../ui/settings.ts";
import type { LocalTransport } from "../ui/transport.ts";
import type { ChooseMsg, HelloMsg, HostChannel, PeerMessage } from "./protocol.ts";
import { PROTOCOL_VERSION } from "./protocol.ts";

interface Connected {
  seat: SeatId;
  channel: HostChannel;
  name: string;
  /** Their name colour, so the host can stamp it on what it relays. */
  chatColor: string | null;
  off: () => void;
}

export class HostSession {
  /** Seat id → the peer playing it. A seat with no entry is played at the
   *  host's own screen, or by an AI, which the transport already handles. */
  private readonly peers = new Map<SeatId, Connected>();
  /**
   * Connections watching rather than playing. Kept in a list rather than
   * the seat map because they hold no seat — there is nothing to key them
   * by, and nothing they can be asked.
   */
  private readonly spectators: HostChannel[] = [];
  private readonly offChanged: () => void;
  private closed = false;

  constructor(private readonly transport: LocalTransport) {
    // One subscription for the whole session: every change — a local
    // click, a peer's intent, an AI seat's move, an auto-pass — reaches
    // every peer the same way. Nothing has to remember to broadcast.
    this.offChanged = this.transport.onChanged(() => this.broadcast());
  }

  /** Seats currently played by a connected peer. */
  get connectedSeats(): SeatId[] {
    return [...this.peers.keys()];
  }

  /** Who is at the table, for a lobby to show. */
  get roster(): Array<{ seat: SeatId; name: string }> {
    return [...this.peers.values()].map((p) => ({ seat: p.seat, name: p.name }));
  }

  /**
   * Take a new connection. The channel is not bound to a seat until the
   * peer says which one it is claiming, because a reconnecting peer names
   * the seat it already had.
   */
  accept(channel: HostChannel): void {
    const off = channel.onMessage((msg) => this.handle(channel, msg, off));
  }

  private handle(channel: HostChannel, msg: PeerMessage, off: () => void): void {
    if (this.closed) return;
    if (msg.type === "hello") this.onHello(channel, msg, off);
    else if (msg.type === "choose") this.onChoose(channel, msg);
    // The conversation carries on into the game on the same channel: the
    // host is still the only relay, so the order is still one order
    // (src/ui/chat.ts).
    else if (msg.type === "chat") {
      const who = [...this.peers.values()].find((p) => p.channel === channel);
      // A chat ban is enforced HERE, at the relay, not on the sender's
      // client — a banned player's browser has no reason to cooperate.
      // They are not told, and nothing of theirs reaches anybody.
      if (who && this.chatBanned.has(who.seat)) return;
      this.say(msg.text, who?.name ?? "someone", false, who?.chatColor ?? null);
    }
    // A peer that says goodbye mid-game leaves its seat to a bot rather
    // than to nobody — see `onLeave`.
    else if (msg.type === "leave") this.onLeave(channel);
  }

  /** Seats whose chat the host is dropping. Not game state: it is about
   *  the room, never the table, and nothing here reaches the engine. */
  private readonly chatBanned = new Set<SeatId>();

  get bannedSeats(): SeatId[] {
    return [...this.chatBanned];
  }

  setChatBan(seat: SeatId, banned: boolean): void {
    if (banned) this.chatBanned.add(seat);
    else this.chatBanned.delete(seat);
    this.say(
      banned ? `${seat} can no longer use the chat.` : `${seat} can use the chat again.`,
      "",
      true,
    );
  }

  /**
   * Remove a player. Their seat is handed to a bot, exactly as if they had
   * left of their own accord — the table plays on.
   */
  kick(seat: SeatId, reason = "the host removed you from this table"): void {
    const peer = this.peers.get(seat);
    if (!peer) return;
    if (peer.channel.open) {
      // The reason goes to the person it is about, in the `bye` they were
      // already being sent — being removed with no explanation is the
      // thing worth avoiding here, and the field existed all along.
      peer.channel.send({ type: "bye", reason });
      // HANG UP ON THE NEXT TICK, not in the same breath. `close()` tears
      // the data channel down, and a message written and then closed over
      // in one synchronous run can go out with it — which is how a kicked
      // player got dropped without ever seeing the reason. The task queue
      // is enough: the send has already been handed to the channel.
      const { channel } = peer;
      setTimeout(() => {
        if (channel.open) channel.close();
      }, 0);
    }
    this.takeOver(peer.seat, peer.name, `was removed by the host: ${reason}`);
  }

  /** Relay a chat line to every peer, and to the host's own screen. */
  say(text: string, from: string, system = false, color: string | null = null): void {
    const at = Date.now();
    const tint = color ? { color } : {};
    addChat({ from, text, at, ...(system ? { system: true } : {}), ...tint });
    const line = {
      type: "chatLine" as const,
      from,
      text,
      at,
      ...(system ? { system: true } : {}),
      ...tint,
    };
    for (const p of this.peers.values()) if (p.channel.open) p.channel.send(line);
    for (const c of this.spectators) if (c.open) c.send(line);
  }

  /**
   * A player leaves mid-game: a BOT takes the seat (owner request).
   *
   * The alternative is a seat nobody can answer, which stalls the table
   * for everyone else — a game of VTES cannot skip a Methuselah's turn.
   * A bot is the same `Agent` the seat could have been played by from the
   * start, so nothing about the game changes shape; `stepAutomatic` picks
   * it up on the next decision.
   *
   * It is announced in the GAME LOG, not the chat (owner request). The
   * chat is a conversation and scrolls away; a seat changing hands is a
   * fact about the table that every player is entitled to find later,
   * which is what the log is for.
   */
  private onLeave(channel: HostChannel): void {
    const peer = [...this.peers.values()].find((p) => p.channel === channel);
    if (!peer) return;
    peer.off();
    this.takeOver(peer.seat, peer.name, "left");
  }

  /** One place a seat changes hands, so a kick and a departure cannot
   *  drift apart in what they leave behind. */
  private takeOver(seat: SeatId, name: string, how: string): void {
    this.peers.delete(seat);
    this.chatBanned.delete(seat);
    this.transport.setAgent(seat, new HeuristicAgent({ seed: seatSeed(seat) }));
    // MARK THE SEAT AS A BOT'S, but only for display. The seat name IS the
    // engine's seat id — renaming it would invalidate every option id, the
    // command log and every saved game — so the suffix is a label the mat
    // draws and nothing else ever sees.
    //
    // It is kept on the TRANSPORT, not here, because everybody at the
    // table has to see it: the labels ride along with each sync, so a
    // guest's mat is relabelled by the same fact that relabels the host's
    // (owner request 2026-09-07). This class holding them privately meant
    // one screen out of four told the truth.
    this.transport.setBotName(seat, `${seat} Bot`);
    // ONE ANNOUNCEMENT, IN THE GAME LOG. `note` writes the log file and
    // the on-screen panel, and the panel's contents reach every peer in
    // the next sync — so the host and the guests read the same line in
    // the same place. It is deliberately NOT in the table chat.
    this.transport.note(
      `${name} ${how} — ${seat} is played by a bot from now on, as "${seat} Bot".`,
    );
    // `note` emits on the transport, so every screen — the host's and, via
    // the next sync, every peer's — repaints and picks up the new label
    // without this class knowing anything about a screen.
  }

  /**
   * Seats a bot took over, and what to CALL them.
   *
   * Delegated to the transport, which is where they now live so that
   * every client sees them — see `takeOver`. Kept as a getter because
   * this is the name the moderation panel and the tests ask by, and one
   * question asked in two places will drift.
   */
  get botSeatNames(): Record<string, string> {
    return this.transport.botNames();
  }

  /** How many people are watching without a seat. */
  get spectatorCount(): number {
    return this.spectators.filter((c) => c.open).length;
  }

  private onHello(channel: HostChannel, msg: HelloMsg, off: () => void): void {
    if (msg.spectate) {
      // A spectator claims no seat, so none of the seat checks apply —
      // and there is no "already taken" case, because any number of
      // people can watch.
      this.spectators.push(channel);
      channel.send({
        type: "welcome",
        version: PROTOCOL_VERSION,
        seat: null,
        seats: this.transport.view().seats.map((s) => s.id),
      });
      this.syncSpectator(channel);
      return;
    }
    if (msg.version !== PROTOCOL_VERSION) {
      // Say so rather than letting them fail confusingly three messages
      // later on a shape they do not understand.
      channel.send({
        type: "bye",
        reason: `this table speaks protocol ${PROTOCOL_VERSION}, you speak ${msg.version}`,
      });
      channel.close();
      return;
    }
    const seats = this.transport.view().seats.map((s) => s.id);
    if (!seats.includes(msg.seat)) {
      channel.send({ type: "bye", reason: `there is no seat "${msg.seat}" at this table` });
      channel.close();
      return;
    }
    const existing = this.peers.get(msg.seat);
    if (existing && existing.channel !== channel && existing.channel.open) {
      channel.send({ type: "bye", reason: `seat "${msg.seat}" is already taken` });
      channel.close();
      return;
    }
    // A RECONNECT is not a special case. The state is re-sent in full on
    // every change anyway, so a returning peer needs no catch-up
    // machinery: it just gets the next sync, which is the whole game.
    if (existing) existing.off();
    this.peers.set(msg.seat, {
      seat: msg.seat,
      channel,
      name: msg.name ?? msg.seat,
      chatColor: msg.chatColor && !colorProblem(msg.chatColor) ? msg.chatColor : null,
      off,
    });
    channel.send({ type: "welcome", version: PROTOCOL_VERSION, seat: msg.seat, seats });
    this.syncOne(msg.seat);
  }

  private onChoose(channel: HostChannel, msg: ChooseMsg): void {
    const peer = [...this.peers.values()].find((p) => p.channel === channel);
    if (!peer) {
      channel.send({ type: "ack", id: msg.id, error: "you are not seated at this table" });
      return;
    }
    const dp = this.transport.decision();
    if (!dp) {
      channel.send({ type: "ack", id: msg.id, error: "the game is over" });
      return;
    }
    // Two refusals a local click can never need, and both are about the
    // gap between deciding and arriving.
    //
    // WHICH decision is checked before WHOSE, and the order is deliberate:
    // a stale answer is usually stale *because* the game has moved on to
    // somebody else, so testing the seat first would report the symptom
    // ("it is Carol's decision") instead of the cause.
    if (dp.seq !== msg.seq) {
      // The decision they were looking at has already been answered.
      // Applying this to whatever is current now would be answering a
      // question they were never asked.
      channel.send({ type: "ack", id: msg.id, error: "that decision has already moved on" });
      this.syncOne(peer.seat);
      return;
    }
    if (dp.seat !== peer.seat) {
      channel.send({ type: "ack", id: msg.id, error: `it is ${dp.seat}'s decision, not yours` });
      return;
    }
    void this.transport
      .choose(msg.option)
      .then(() => {
        // The sync goes out first (through onChanged), so by the time the
        // caller's promise settles their view is already current.
        channel.send({ type: "ack", id: msg.id });
      })
      .catch((err: unknown) => {
        channel.send({ type: "ack", id: msg.id, error: (err as Error).message });
        this.syncOne(peer.seat);
      });
  }

  private broadcast(): void {
    for (const seat of this.peers.keys()) this.syncOne(seat);
    for (const channel of this.spectators) this.syncSpectator(channel);
  }

  /** Everything face down, and never a decision. */
  private syncSpectator(channel: HostChannel): void {
    if (!channel.open) return;
    channel.send({
      type: "sync",
      state: this.transport.spectatorState(),
      decision: null,
      deciding: this.transport.decision()?.seat ?? null,
      notices: this.transport.notices(),
      botNames: this.transport.botNames(),
    });
  }

  private syncOne(seat: SeatId): void {
    const peer = this.peers.get(seat);
    if (!peer || !peer.channel.open) return;
    const dp = this.transport.decision();
    peer.channel.send({
      type: "sync",
      state: this.transport.stateFor(seat),
      // Theirs, or nothing. A DecisionPoint carries that seat's legal
      // options, and another seat's options say what is in their hand.
      decision: dp && dp.seat === seat ? dp : null,
      // …but WHO is being asked is public, exactly as it is at a real
      // table. This is the whole of the fix for an off-turn peer drawing
      // "Game over" (see SyncMsg.deciding).
      deciding: dp?.seat ?? null,
      notices: this.transport.notices(),
      botNames: this.transport.botNames(),
    });
  }

  /** Drop one peer — they left, or the lobby removed them. */
  disconnect(seat: SeatId, reason = "disconnected"): void {
    const peer = this.peers.get(seat);
    if (!peer) return;
    peer.off();
    if (peer.channel.open) {
      peer.channel.send({ type: "bye", reason });
      peer.channel.close();
    }
    this.peers.delete(seat);
  }

  /** End the session. The game itself is untouched — the host can carry on
   *  playing it locally, which is what happens when everyone else leaves. */
  close(reason = "the table closed"): void {
    if (this.closed) return;
    this.closed = true;
    this.offChanged();
    for (const seat of [...this.peers.keys()]) this.disconnect(seat, reason);
    for (const channel of this.spectators.splice(0)) {
      if (channel.open) {
        channel.send({ type: "bye", reason });
        channel.close();
      }
    }
  }
}
