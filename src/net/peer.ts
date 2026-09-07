/**
 * The peer side of a networked game (docs/multiplayer-design.md).
 *
 * `PeerTransport` is a `GameTransport`, so `DebugApp` renders a networked
 * game with no change whatsoever — which is what the seam was built for
 * (docs/cockatrice-lessons.md §2.1). The four properties that were written
 * into that interface a month early all pay out here, in order:
 *
 *  - **`choose()` is async.** Here the answer genuinely does arrive later.
 *  - **`view()` is a snapshot, not a handle.** A peer only ever has the
 *    last masked state the host sent; there is nothing to reach into.
 *  - **Agents are stepped by the authority.** A peer runs none, and does
 *    not know or care which seats are AI.
 *  - **`history` is a nullable privilege.** A peer cannot unilaterally
 *    rewind a shared game, so it is `null` and the UI omits the controls.
 *
 * Nothing here validates a move. The host does that with the same
 * legal-move generator it uses for its own clicks, and a refusal comes
 * back as a rejected promise — the same failure the UI already handles for
 * a local illegal id.
 */

import type { DecisionPoint, GameState } from "../engine/index.ts";
import { addChat } from "../ui/chat.ts";
import type { GameHistory, GameTransport } from "../ui/transport.ts";
import type { HostMessage, PeerChannel } from "./protocol.ts";
import { PROTOCOL_VERSION } from "./protocol.ts";

export class PeerTransport implements GameTransport {
  private state: GameState | null = null;
  private dp: DecisionPoint | null = null;
  private seatId: string | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  private readonly listeners = new Set<() => void>();
  /** Why the host closed us out, if it did. */
  private goodbye: string | null = null;

  /**
   * A peer cannot rewind, save or load a game it does not own, so the
   * whole control group is absent rather than shown disabled.
   */
  readonly history: GameHistory | null = null;

  /** True when this client is watching rather than playing. */
  readonly spectating: boolean;

  constructor(
    private readonly channel: PeerChannel,
    seat: string | null,
    name?: string,
    /** Their chat name colour, so a RECONNECT (which arrives straight at
     *  the session, never through the lobby) still carries it. */
    chatColor?: string | null,
  ) {
    // A null seat means SPECTATE: watch a table you hold no seat at. The
    // host then sends everything face down and never a decision, so there
    // is nothing here to answer and nothing of anyone's to read.
    this.spectating = seat === null;
    this.channel.onMessage((msg) => this.receive(msg));
    this.channel.send({
      type: "hello",
      version: PROTOCOL_VERSION,
      seat: seat ?? "",
      ...(this.spectating ? { spectate: true } : {}),
      ...(name === undefined ? {} : { name }),
      ...(chatColor ? { chatColor } : {}),
    });
  }

  /** The seat this client is playing, or null while unconfirmed — and
   *  always null for a spectator. */
  get seat(): string | null {
    return this.seatId;
  }

  /** Set once the host has sent anything at all. Until then there is
   *  nothing to render and the UI shows a connecting state. */
  get connected(): boolean {
    return this.state !== null && this.goodbye === null;
  }

  /** Why we were turned away or dropped, if we were. */
  get closedReason(): string | null {
    return this.goodbye;
  }

  /** Whose decision it is, when it is not ours. The host sends the NAME
   *  without the options — see SyncMsg.deciding. */
  private deciding: string | null = null;
  /** Log lines the host sent that are not engine events. */
  private uiNotices: string[] = [];

  decision(): DecisionPoint | null {
    return this.dp;
  }

  decidingSeat(): string | null {
    return this.deciding;
  }

  notices(): string[] {
    return [...this.uiNotices];
  }

  /** Seat id → what to call it, when a bot has taken it over. Display
   *  only: the ids in `view()` are untouched. */
  private labels: Record<string, string> = {};

  botNames(): Record<string, string> {
    return { ...this.labels };
  }

  /**
   * The masked table the host last sent.
   *
   * Throwing before the first sync is deliberate: an empty `GameState`
   * would render as a table with nothing on it, which looks like a game
   * rather than like a client that has not connected yet. Callers check
   * `connected` first.
   */
  view(): GameState {
    if (!this.state) throw new Error("not connected to the table yet");
    return this.state;
  }

  async choose(optionId: string): Promise<void> {
    if (!this.dp) throw new Error("it is not your decision");
    const id = this.nextId++;
    // The decision this answers travels WITH the answer. Over a network a
    // click can arrive after somebody else has already moved the game on,
    // and the host refuses it rather than applying it to whatever is
    // current now.
    const seq = this.dp.seq;
    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.channel.send({ type: "choose", id, seq, option: optionId });
    });
  }

  onChanged(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Say something to the table; the host relays it to everyone. */
  say(text: string): void {
    if (this.channel.open) this.channel.send({ type: "chat", text });
  }

  /**
   * Leave the table.
   *
   * `leave` is SENT before the channel closes, so the host learns this was
   * deliberate and hands the seat to a bot rather than leaving a seat
   * nobody can answer — a game of VTES cannot skip a Methuselah's turn,
   * so a silent disappearance would stall the table for everyone else.
   */
  close(): void {
    this.failPending("left the table");
    if (this.channel.open) this.channel.send({ type: "leave" });
    this.channel.close();
  }

  private receive(msg: HostMessage): void {
    switch (msg.type) {
      case "welcome":
        this.seatId = msg.seat;
        return;
      case "sync":
        this.state = msg.state;
        this.dp = msg.decision;
        this.deciding = msg.deciding ?? null;
        this.uiNotices = msg.notices ?? [];
        this.labels = msg.botNames ?? {};
        this.emit();
        return;
      case "ack": {
        const waiting = this.pending.get(msg.id);
        if (!waiting) return;
        this.pending.delete(msg.id);
        if (msg.error) waiting.reject(new Error(msg.error));
        else waiting.resolve();
        return;
      }
      case "chatLine":
        // Ordered by the host, like every other client (src/ui/chat.ts).
        addChat({
          from: msg.from,
          text: msg.text,
          at: msg.at,
          ...(msg.system ? { system: true } : {}),
          ...(msg.color ? { color: msg.color } : {}),
        });
        return;
      case "bye":
        this.goodbye = msg.reason;
        // Anything still in flight will never be answered now; failing it
        // is what stops the UI sitting with its buttons disabled for ever.
        this.failPending(msg.reason);
        this.dp = null;
        this.emit();
        return;
    }
  }

  private failPending(reason: string): void {
    for (const [, waiting] of this.pending) waiting.reject(new Error(reason));
    this.pending.clear();
  }

  private emit(): void {
    for (const cb of [...this.listeners]) cb();
  }
}
