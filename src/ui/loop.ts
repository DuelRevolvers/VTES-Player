/**
 * The debug hotseat UI shell (docs/debug-ui-design.md §2).
 *
 * It renders whatever a `GameTransport` reports and submits option ids back;
 * it has no reference to the engine at all. Hotseat, agent-driven testing
 * and the phase-6 host all use LocalTransport; a peer transport swaps in
 * with no change here (docs/cockatrice-lessons.md §2).
 *
 * `Agent.decide()` is SYNCHRONOUS — it returns an option id — so a human
 * seat cannot implement it. That is why the UI is a pull loop over the
 * transport rather than an Agent: render the decision, wait for a click,
 * submit, re-render. Agent-driven seats are stepped by the authority, on
 * the far side of the seam.
 */

import type { DecisionPoint, GameState, LegalOption } from "../engine/index.ts";
import type { DeckDef, GameSetup } from "./decks.ts";
import { validateDecks } from "./decks.ts";
import { cardText } from "./cardinfo.ts";
import { chatProblem, onChat } from "./chat.ts";
import { DevServerSink, GameLog } from "./gamelog.ts";
import { downloadSave, readSaveFile } from "./history.ts";
import { autoSave, loadSaves, saveAs } from "./savedgames.ts";
import { DEFAULT_CHAT_COLOR } from "./profile.ts";
import type { FinishedView, ModerationView, SeatFace } from "./render.ts";
import { DEFAULT_EMOJI_CATEGORY } from "./render.ts";
import {
  allocationChoices,
  allocKey,
  orderHand,
  playsByCard,
  render,
  stillOffered,
} from "./render.ts";
import type { UiSettings } from "./settings.ts";
import { botAgentFor, playstyleOf } from "./botagent.ts";
import { loadSettings, saveSettings, seatSeed } from "./settings.ts";
import type { GameTransport } from "./transport.ts";
import { LocalTransport } from "./transport.ts";

/**
 * Who is at this table, as far as the SCREEN is concerned.
 *
 * None of it is game state — the engine knows seats by id and nothing
 * else — so it never reaches the command log and a save replays the same
 * game without it.
 */
export interface TableIdentity {
  /**
   * Seat id → the face on their mat.
   *
   * ASKED FOR ON EVERY REPAINT, not handed over once. A seat changes
   * hands mid-game — somebody is kicked, or leaves, and a bot takes over
   * — and the label on the mat has to change with it; a snapshot taken
   * when the table opened could not, which is why a kicked player's mat
   * never gained its "Bot" suffix.
   */
  faces?: () => Record<string, SeatFace>;
  /**
   * The seats a REMOTE player is sitting in, from the host's side.
   *
   * The host runs the engine, so it holds the real DecisionPoint for
   * every seat including theirs — and drew live buttons for it, which
   * let the host play other people's turns (owner report). Absent for a
   * guest and for a private table, where there is nobody else here.
   */
  remoteSeats?: () => string[];
  /**
   * The game is over and the player has answered the leaderboard prompt.
   * `save` is their answer; either way the caller takes the screen back.
   * Absent for a table with no shell behind it (the playtest snapshot),
   * where there is nowhere to go and nothing to record.
   */
  onFinished?: (save: boolean) => void;
  /** The seat the person at this client holds, if exactly one. */
  localSeat?: string | null;
  /** Called when they leave the game, if there is anywhere to go back to. */
  onLeave?: () => void;
  /**
   * Say something to the table, if there is a table to say it to.
   *
   * The panel is the lobby's, reading the same store (src/ui/chat.ts), so
   * the conversation survives the handover. WHO relays it — a host
   * session, a peer channel, or nobody on a private game — is the shell's
   * business; the table is handed one function and does not ask.
   */
  say?: (text: string) => void;
  /**
   * The host's moderation surface: who is connected, and the two things
   * that can be done about them. Absent for a guest and for a private
   * game — a guest's client has nothing to kick anybody WITH, so the
   * button is not drawn rather than drawn and refused.
   */
  moderate?: () => ModerationView;
  kick?: (seat: string, reason: string) => void;
  setChatBan?: (seat: string, banned: boolean) => void;
  /** Read and write this player's chat name colour. The value lives on
   *  their profile, which the shell owns — the table only shows it. */
  chatColor?: () => string;
  setChatColor?: (color: string) => void;
  /**
   * Keep this game in the browser's automatic slot, once per turn.
   *
   * OPT-IN, and the shell is the only thing that opts in. The playtest
   * snapshot runs through this same class, and it is a hand-authored
   * mid-game position somebody is poking at a card in — autosaving it
   * would quietly overwrite the real game a player left half-finished,
   * which is the one thing an automatic save must never do.
   *
   * A guest has no `history` and cannot snapshot a game it does not run,
   * so this does nothing there even when set.
   */
  autosave?: boolean;
}

/** The decision on the table, or none. Named because `waitingFor` reads
 *  better with it than with the union spelled out. */
type LegalDecision = DecisionPoint | null;

const escapeText = (s: string): string =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export class DebugApp {
  private eventFilter = "";
  /** The hand card the player has clicked; its plays show on the card. */
  private selectedCard: string | null = null;
  /**
   * Each seat's preferred hand order, as card ids. Purely cosmetic and
   * purely client-side: sorting your hand is not a game action, so it must
   * never reach the command log (an undo of a sort would rewind the game).
   * Reconciled against the real hand on every render by `orderHand`.
   */
  private handOrder: Record<string, string[]> = {};
  private settingsOpen = false;
  /** Whether the How to Play panel is open. Pure view state, like
   *  `settingsOpen`: it never reaches the command log. */
  private helpOpen = false;
  /** The rule sections the player has expanded; kept across repaints. */
  private helpOpenSections = new Set<string>();
  /** The How to Play search box. View state like the rest of the panel. */
  private helpQuery = "";
  /** Whose ash heap is open. The zone is public (p. 16), so any seat's. */
  private ashOpen: string | null = null;
  /** The pointer is down on a card — the hover preview stays out of the
   *  way until it comes back up. */
  private holding = false;
  /**
   * The card the pointer is currently over, if any.
   *
   * THE PREVIEW HAS TO SURVIVE A REPAINT. Every repaint is `innerHTML =`,
   * which destroys the element the pointer was over — the browser fires
   * no fresh `mouseover` for an element that was replaced under a
   * stationary cursor, so the preview vanished on every tick of the game
   * and only came back when the pointer moved (owner report: "previews
   * disappear with every new little action"). Remembering what is under
   * the pointer is what lets `paint()` put it back.
   */
  private hovering: { zoom: string; name: string } | null = null;
  /** Where the pointer is, for the same reason: after a repaint the panel
   *  has to be re-placed, and no mouse event will say where to. */
  private pointer = { x: 0, y: 0 };
  /** Whose deck list is open, as "<seat>:crypt" / "<seat>:library". */
  private deckOpen: string | null = null;
  /** The card in play whose SET-ASIDE cards are open. View state: looking
   *  at cards a card says you may look at is not a move. */
  private storeOpen: string | null = null;
  /**
   * THE ALLOCATION DIALOG, and the split being assembled in it.
   *
   * View state like every other panel: a draft is a split nobody has
   * chosen yet, so it never reaches the command log. It is thrown away
   * whenever the decision changes — a draft for one referendum means
   * nothing at the next, and leaving it would offer a stale split against
   * a fresh decision.
   */
  private allocOpen = false;
  private allocDraft: Record<string, number> = {};
  private allocContext: string | null = null;
  /** The decision the draft was assembled against, so a new one clears
   *  it. `seq` is the engine's own decision counter. */
  private allocSeq = -1;
  /** The moderation panel is open. View state, like the settings panel. */
  private modOpen = false;
  private chatSettingsOpen = false;
  private emojiOpen = false;
  /** Which emoji tab is showing. View state, like the pad itself. */
  private emojiCategory: string = DEFAULT_EMOJI_CATEGORY;
  private settings: UiSettings;

  constructor(
    private readonly root: HTMLElement,
    private readonly transport: GameTransport,
    /** Who is sitting where, for the thumbnails, and the one seat this
     *  client's player holds. Absent for the playtest snapshot, which is
     *  hotseat and has no profiles behind it. */
    private readonly table: TableIdentity = {},
  ) {
    this.settings = loadSettings();
    // Preferences are stored by this client but ENFORCED by the authority,
    // so hand them to the transport rather than acting on them here.
    if (this.transport instanceof LocalTransport) {
      this.transport.setOmniscient(this.settings.omniscient);
      // One human here means the view is masked to THEM, not to whoever is
      // being asked — so their hand stays readable while a bot thinks.
      this.transport.setLocalSeat(this.table.localSeat ?? null);
      // Hotseat and the playtest snapshot build their transport without a
      // delay, so this is where those get one. The SHELL sets it on the
      // transport it constructs instead: it attaches the bots before it
      // ever builds this table, so by the time we got here the opening
      // round had already been played at zero delay (owner report
      // 2026-09-07). Setting it twice is harmless — same value, and the
      // opening beat is latched until its timer fires.
      this.transport.setAiDelay(this.settings.aiDelayMs);
      // The pass clock survives a reload like every other preference, and
      // it is the HOST's copy that decides for the whole table — a guest's
      // stored value never reaches the transport, because a guest has no
      // LocalTransport to put it on.
      this.transport.setPassTimeout(this.settings.passTimeoutMs);
      for (const [seat, on] of Object.entries(this.settings.autoPass)) {
        if (on) this.transport.setAutoPass(seat, true);
      }
      // A seat handed to the AI stays handed over across a reload.
      for (const [seat, on] of Object.entries(this.settings.aiSeats)) {
        if (on) this.transport.setAgent(seat, botAgentFor(seat));
      }
    }
    // Once: these listeners live on the root, which survives every repaint.
    this.wireZoom();
    // Any state change repaints, whoever caused it — our own click today, a
    // message from the host once a peer transport exists.
    this.transport.onChanged(() => {
      // BEFORE the paint, not after: a paint can throw (an engine error
      // surfaces there on purpose), and the turn that just ended is worth
      // keeping precisely when something has gone wrong with the next one.
      this.autosave();
      this.paint();
    });
    // A chat line changes nothing about the GAME, so it arrives on its own
    // channel and has to ask for its own repaint.
    if (this.table.say) onChat(() => this.paint());
    this.paint();
  }

  private paint(): void {
    try {
      this.repaint();
      this.restorePreview();
    } catch (err) {
      // AN ENGINE ERROR MUST NOT LOOK LIKE A FROZEN TABLE. `decision()`
      // settles the game, so a throw from deep inside it leaves the old
      // markup on screen with its buttons already disabled — which reads
      // exactly like "the buttons disappeared and I can't do anything",
      // and that is how the ally-pays-its-last-life bug was reported.
      // Say what happened instead, and leave the log readable.
      this.root.innerHTML = `<div class="fatal">
        <h2>The game hit an error</h2>
        <p>This is a bug. The game cannot go on from here, but nothing is
           lost — the log file in <code>logs/</code> replays everything up
           to this point.</p>
        <pre>${escapeText((err as Error).stack ?? String(err))}</pre>
      </div>`;
      throw err;
    }
  }

  /**
   * Whose decision it is when this client may not answer it.
   *
   * Two ways that happens, and they are the same statement:
   *
   *  - A PEER is sent no DecisionPoint unless the decision is theirs, so
   *    `dp` is null through everybody else's turn. The host now names the
   *    seat in the sync, and without that the bar read "Game over".
   *  - The HOST holds the real decision for every seat, because it runs
   *    the engine. A seat a remote player is sitting in is not the host's
   *    to answer, however live the option list looks.
   *
   * A bot's seat is NOT here: it is nobody's to answer, and the existing
   * `thinking` pause already covers it.
   */
  private waitingFor(dp: LegalDecision): string | null {
    if (dp) {
      const remote = this.table.remoteSeats?.() ?? [];
      return remote.includes(dp.seat) ? dp.seat : null;
    }
    // No decision here. Either the game is over — and then the transport
    // names nobody — or it is somebody else's and we were not told the
    // options, only the name.
    return this.transport.decidingSeat?.() ?? null;
  }

  /**
   * The finished game, or null while it runs.
   *
   * `GameEnded` rather than "no decision pending": a peer between syncs
   * also has no decision, and the two must not look alike — that is the
   * whole of the bug this replaces.
   */
  private finished(): FinishedView | null {
    if (!this.table.onFinished || this.dismissedEnding) return null;
    const state = this.transport.view();
    const ended = [...state.eventLog].reverse().find((e) => e.type === "GameEnded");
    if (!ended || ended.type !== "GameEnded") return null;
    return {
      winner: ended.winner,
      standings: [...state.seats]
        .map((s) => ({ seat: s.id, victoryPoints: s.victoryPoints, ousted: s.ousted }))
        .sort((a, b) => b.victoryPoints - a.victoryPoints || a.seat.localeCompare(b.seat)),
    };
  }

  /** Answered once. Guards against a late repaint re-opening the prompt
   *  between the answer and the shell taking the screen back. */
  private dismissedEnding = false;

  /**
   * Put the magnifier back after a repaint, if the pointer never left.
   *
   * `innerHTML =` replaced the element the pointer was over, and the
   * browser fires no `mouseover` for a replacement under a cursor that
   * has not moved — so the preview stayed gone until the player moved the
   * mouse, which is what made it flicker off on every game tick.
   *
   * It re-asks the DOM what is under the pointer NOW rather than trusting
   * the remembered card: the repaint may have moved the table out from
   * under it (a card burned, a minion gone to torpor), and showing the
   * preview of a card that is no longer there would be worse than
   * showing none.
   */
  private restorePreview(): void {
    if (!this.hovering || this.holding) return;
    const under = document
      .elementFromPoint(this.pointer.x, this.pointer.y)
      ?.closest<HTMLElement>("[data-zoom]");
    const p = this.root.querySelector<HTMLDivElement>("#zoom");
    if (!under || !p) {
      this.hovering = null;
      return;
    }
    const img = p.querySelector("img");
    const text = p.querySelector<HTMLDivElement>(".zoomtext");
    if (!img || !text) return;
    const name = under.dataset["name"] ?? (under as HTMLImageElement).alt ?? "";
    img.src = under.dataset["zoom"] ?? "";
    text.textContent = cardText(name) ?? "";
    this.hovering = { zoom: under.dataset["zoom"] ?? "", name };
    // Deliberately NOT restarting the name's fade: the card has not
    // changed, so neither should its label — re-announcing it on every
    // repaint is the flicker in a different form.
    p.hidden = false;
    // AND PUT IT BACK WHERE IT WAS. The panel is a NEW element — the
    // repaint replaced the whole root — so it carries none of the inline
    // `left`/`top` the pointer-follow had set, and `.zoom` has no
    // position of its own in the stylesheet. Unhidden and unplaced, it
    // appears in the top-left corner and stays there until the player
    // moves the mouse. Positioned after `hidden = false`, so the panel
    // can be measured rather than falling back to its default size.
    this.positionPreview(p);
  }

  /**
   * A SELECTION IS A QUESTION ABOUT THE DECISION ON THE TABLE — "what can
   * this card do now?" — so it dies with that decision.
   *
   * `submit` cleared it for a play made FROM the menu, which covered only
   * one of the ways a decision ends. Passing, ending the phase, a bot
   * moving, a remote seat answering: each left the menu sitting open on a
   * card whose options had gone, and the list on it was the LAST
   * decision's, which is worse than a stale list — it is a wrong one.
   *
   * Checked against what is actually offered rather than against "the
   * decision changed", because that is the real question, and it answers
   * the awkward case for free: a decision that moves on but still offers
   * this card keeps its menu open, which is what a player mid-thought
   * wants.
   */
  private pruneSelection(dp: LegalDecision, state: GameState): void {
    if (this.selectedCard && !stillOffered(this.selectedCard, dp, state)) {
      this.selectedCard = null;
    }
  }

  /**
   * A DRAFT BELONGS TO ONE DECISION. The same reasoning as
   * `pruneSelection`: a split assembled against one referendum is not an
   * answer to the next one, and a dialog left open over a decision that
   * no longer asks for an allocation would offer a Confirm with nothing
   * behind it.
   */
  private pruneAlloc(dp: LegalDecision): void {
    const choices = allocationChoices(dp);
    if (choices.length === 0) {
      this.allocOpen = false;
      this.allocDraft = {};
      this.allocContext = null;
      this.allocSeq = -1;
      return;
    }
    if (dp && dp.seq !== this.allocSeq) {
      this.allocSeq = dp.seq;
      this.allocDraft = {};
      this.allocContext = null;
    }
  }

  private repaint(): void {
    // Read the scroll positions BEFORE the markup that holds them is
    // thrown away — see `saveScroll`.
    this.saveScroll();
    const dp = this.transport.decision();
    const state = this.transport.view();
    this.pruneSelection(dp, state);
    this.pruneAlloc(dp);
    this.root.innerHTML = render({
      state,
      dp,
      eventFilter: this.eventFilter,
      canUndo: this.transport.history?.canUndo() ?? false,
      canRewind: this.transport.history !== null,
      omniscient: this.transport instanceof LocalTransport && this.transport.isOmniscient,
      selectedCard: this.selectedCard,
      handOrder: this.handOrder[this.handSeat() ?? ""] ?? [],
      settingsOpen: this.settingsOpen,
      helpOpen: this.helpOpen,
      helpOpenSections: [...this.helpOpenSections],
      helpQuery: this.helpQuery,
      autoPass:
        this.transport instanceof LocalTransport
          ? this.transport.autoPassSeats
          : this.settings.autoPass,
      aiSeats:
        this.transport instanceof LocalTransport
          ? this.transport.agentSeats
          : this.settings.aiSeats,
      thinking: this.isThinking(),
      waitingFor: this.waitingFor(dp),
      notices: this.transport.notices?.() ?? [],
      finished: this.finished(),
      aiDelayMs:
        this.transport instanceof LocalTransport
          ? this.transport.aiDelay
          : this.settings.aiDelayMs,
      // The CONTROL reads the transport's value where there is one, like
      // the pacing above it — the panel must show what is actually being
      // enforced, not what this client last stored.
      passTimeoutMs:
        this.transport instanceof LocalTransport
          ? this.transport.passTimeout
          : this.settings.passTimeoutMs,
      // …and the COUNTDOWN is whatever the authority says is left, on
      // either side of the wire: a peer is told, and never counts for
      // itself.
      passClockMs: this.transport.passClockMs?.() ?? null,
      cardTextPx: this.settings.cardTextPx,
      seatFaces: this.table.faces?.() ?? {},
      localSeat: this.table.localSeat ?? null,
      ashOpen: this.ashOpen,
      deckOpen: this.deckOpen,
      storeOpen: this.storeOpen,
      allocOpen: this.allocOpen,
      allocDraft: this.allocDraft,
      allocContext: this.allocContext,
      canLeave: this.table.onLeave !== undefined,
      canChat: this.table.say !== undefined,
      canModerate: this.table.moderate !== undefined,
      chatColor: this.table.chatColor?.() ?? DEFAULT_CHAT_COLOR,
      chatSettingsOpen: this.chatSettingsOpen,
      emojiOpen: this.emojiOpen,
      emojiCategory: this.emojiCategory,
      moderation: this.modOpen ? (this.table.moderate?.() ?? null) : null,
    });
    this.wire();
    this.restoreScroll();
    // Keep the event log pinned to the newest entry.
    const log = this.root.querySelector("#events");
    if (log) log.scrollTop = log.scrollHeight;
    this.startPassClock();
  }

  /**
   * The live pass countdown.
   *
   * IT DOES NOT REPAINT. A repaint is `innerHTML =` on the whole table and
   * throws away every scroll position, the magnified card and the panel
   * that is open — costs this screen already pays on a real change and
   * has machinery to undo, but paying them once a second for a number
   * ticking down would be a table that could not be read while the clock
   * ran. So this touches exactly one text node, and the markup around it
   * stays render.ts's (docs/pass-timeout-design.md §5).
   *
   * Self-stopping: when the chip is gone — a new decision, the clock
   * turned off, or the shell having replaced this whole screen — there is
   * nothing to tick and the interval clears itself. Nothing else has to
   * remember to tear it down.
   */
  private passTicker: ReturnType<typeof setInterval> | null = null;

  private startPassClock(): void {
    if (this.passTicker !== null) {
      clearInterval(this.passTicker);
      this.passTicker = null;
    }
    if (this.transport.passClockMs?.() == null) return;
    // Four times a second: fast enough that the seconds fall when they
    // should, slow enough to cost nothing.
    this.passTicker = setInterval(() => this.tickPassClock(), 250);
  }

  private tickPassClock(): void {
    const chip = this.root.querySelector<HTMLElement>("#passclock");
    const digits = chip?.querySelector("b");
    const ms = this.transport.passClockMs?.() ?? null;
    if (!chip || !digits || ms === null) {
      if (this.passTicker !== null) clearInterval(this.passTicker);
      this.passTicker = null;
      // The chip is stale markup from the last paint if the clock has
      // stopped but the node is still there — a repaint is coming (the
      // pass itself emits), so it is left alone rather than half-erased.
      return;
    }
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    digits.textContent = `${seconds}s`;
    chip.classList.toggle("urgent", seconds <= 5);
  }

  /**
   * WHERE EACH SCROLLING PANEL WAS, kept across a repaint.
   *
   * The screen is re-rendered whole on every change — that is the model,
   * and it is what removes stale-view bugs — but `innerHTML =` throws away
   * the elements and every scroll position with them. On a table taller
   * than the window that meant scrolling down, clicking anything at all,
   * and being thrown back to the top by the repaint the click caused
   * (owner report 2026-09-07).
   *
   * Keyed by element id, so a panel that is not on screen this time
   * simply keeps its last position for when it comes back. The event log
   * is deliberately NOT in here: it is pinned to the newest line, which is
   * a different rule and the one it already had.
   */
  private readonly scrollTops: Record<string, { top: number; left: number }> = {};
  private static readonly SCROLLED = ["table", "decision", "chatlines"];

  private saveScroll(): void {
    for (const id of DebugApp.SCROLLED) {
      const el = this.root.querySelector<HTMLElement>(`#${id}`);
      if (el) this.scrollTops[id] = { top: el.scrollTop, left: el.scrollLeft };
    }
  }

  private restoreScroll(): void {
    for (const id of DebugApp.SCROLLED) {
      const el = this.root.querySelector<HTMLElement>(`#${id}`);
      const at = this.scrollTops[id];
      if (!el || !at) continue;
      el.scrollTop = at.top;
      el.scrollLeft = at.left;
    }
  }

  /**
   * Hover magnifier: any card scan shows full size, with its rules text.
   * Delegated from the root and attached ONCE in the constructor — `wire()`
   * runs on every repaint, and these listeners sit on the root element,
   * which survives `innerHTML =`, so wiring them there would stack up a new
   * set every render.
   */
  private wireZoom(): void {
    const panel = (): HTMLDivElement | null =>
      this.root.querySelector<HTMLDivElement>("#zoom");

    // THE PREVIEW GETS OUT OF THE WAY THE MOMENT YOU GRAB A CARD. It is
    // a full-size card that follows the pointer, so while dragging one it
    // covers the very targets being dragged at. `mousedown` rather than
    // `dragstart` because the panel is in the way from the press, not from
    // the moment the browser decides a drag has begun.
    const hide = (): void => {
      this.holding = true;
      const p = panel();
      if (p) p.hidden = true;
    };
    this.root.addEventListener("mousedown", hide);
    this.root.addEventListener("dragstart", hide);
    // Released: hovering shows the preview again.
    const release = (): void => {
      this.holding = false;
    };
    this.root.addEventListener("mouseup", release);
    this.root.addEventListener("dragend", release);
    this.root.addEventListener("drop", release);
    // THE BELT AND BRACES, and it is the one that actually fixed it.
    // After a hand card is dropped the element that was grabbed has been
    // re-rendered, so `dragend` fires on a node that is no longer in the
    // tree and never reaches this listener — leaving `holding` true and
    // the preview off until the next unrelated click (owner report:
    // "after I move a card in my hand, the previews don't show up until I
    // click somewhere else"). No button down means nothing is held,
    // whatever events did or did not arrive.
    this.root.addEventListener("mousemove", (ev) => {
      if (ev.buttons === 0) this.holding = false;
    });

    this.root.addEventListener("mouseover", (ev) => {
      // ANY element carrying `data-zoom`, not just a scan: card names in
      // the game log and in a deck list carry it too, so one handler
      // serves the table, the log and the lists.
      const target = (ev.target as HTMLElement).closest<HTMLElement>("[data-zoom]");
      const p = panel();
      if (!target || !p || this.holding) return;
      const img = p.querySelector("img");
      const text = p.querySelector<HTMLDivElement>(".zoomtext");
      const name = p.querySelector<HTMLDivElement>(".zoomname");
      if (!img || !text) return;
      // A scan says its name in `alt`; a text reference in `data-name`.
      const cardName =
        target.dataset["name"] ?? (target as HTMLImageElement).alt ?? "";
      img.src = target.dataset["zoom"] ?? "";
      text.textContent = cardText(cardName) ?? "";
      this.hovering = { zoom: target.dataset["zoom"] ?? "", name: cardName };
      // THE NAME FADES (owner request). It answers "what is this?" in the
      // first second and is clutter after that — the scan underneath says
      // the same thing permanently. Removing and re-adding the class
      // restarts the CSS animation, which is what makes it fade again for
      // the NEXT card rather than only for the first one hovered; the
      // reflow read between the two is what forces that restart.
      if (name && name.textContent !== cardName) {
        name.textContent = cardName;
        name.classList.remove("fading");
        void name.offsetWidth;
        name.classList.add("fading");
      }
      p.hidden = false;
    });
    this.root.addEventListener("mouseout", (ev) => {
      const target = (ev.target as HTMLElement).closest("[data-zoom]");
      const p = panel();
      if (!target || !p) return;
      this.hovering = null;
      p.hidden = true;
      // Forget which card it was, so coming BACK to the same one shows
      // its name again rather than a label that has already faded.
      const name = p.querySelector<HTMLDivElement>(".zoomname");
      if (name) name.textContent = "";
    });
    // Follow the pointer, but keep the panel on screen.
    this.root.addEventListener("mousemove", (ev) => {
      this.pointer = { x: ev.clientX, y: ev.clientY };
      const p = panel();
      if (!p || p.hidden) return;
      if (this.holding) {
        p.hidden = true;
        return;
      }
      this.positionPreview(p);
    });
  }

  /**
   * Where the magnifier sits for the pointer's CURRENT position.
   *
   * ONE PLACE, because the panel is positioned from two: the `mousemove`
   * that makes it follow the pointer, and the repaint that has to put it
   * back. `.zoom` is `position: fixed` with no `left`/`top` of its own, so
   * a panel that is shown without being placed lands in the top-left
   * corner of the window — which is exactly what a repaint did, on every
   * game tick, to a preview the player was reading (owner report,
   * 2026-09-17). `restorePreview` restored the CARD and not the PLACE.
   *
   * It reads `this.pointer` rather than taking coordinates, so there is
   * no call site that can pass the wrong ones.
   */
  private positionPreview(p: HTMLDivElement): void {
    const pad = 16;
    const w = p.offsetWidth || 300;
    const h = p.offsetHeight || 460;
    const x = Math.min(this.pointer.x + pad, window.innerWidth - w - pad);
    const y = Math.min(Math.max(pad, this.pointer.y - h / 2), window.innerHeight - h - pad);
    p.style.left = `${Math.max(pad, x)}px`;
    p.style.top = `${Math.max(pad, y)}px`;
  }

  /**
   * True while the authority is holding an AI's move back so it can be
   * watched. The decision on the table is that AI's, so the whole screen
   * goes read-only for the length of the pause.
   */
  private isThinking(): boolean {
    return this.transport instanceof LocalTransport && this.transport.isThinking;
  }

  /** Submit an option id, with the in-flight guard and error surfacing. */
  private submit(id: string): void {
    if (this.isThinking()) return;
    this.selectedCard = null;
    this.setBusy(true);
    void this.transport
      .choose(id)
      .catch((err: unknown) => {
        alert(`Rejected "${id}":\n\n${(err as Error).message}`);
        this.paint();
      })
      .finally(() => this.setBusy(false));
  }

  /**
   * Cards in hand: click one to select it (its legal plays appear on the
   * card), or drag it. The menu opens for ONE legal play as readily as for
   * five: a click is "show me what this would do", never "do it".
   *
   * DRAGGING MEANS TWO THINGS, told apart by where the card lands: onto a
   * minion or a player mat it plays the card, onto another hand card it
   * sorts your hand. So every card is draggable, playable or not — sorting
   * is something a player does constantly, including on decisions where
   * nothing at all is playable.
   */
  private wireHand(): void {
    // The hand on screen during an AI's pause is the AI's, face down. It is
    // not the watcher's to play, and not theirs to sort either.
    if (this.isThinking()) return;
    const dp = this.transport.decision();
    const byCard = playsByCard(dp);
    const handIds = this.renderedHandIds();

    for (const slot of Array.from(this.root.querySelectorAll<HTMLElement>(".handslot"))) {
      const cardId = slot.dataset["card"];
      if (!cardId) continue;
      const plays = byCard.get(cardId) ?? [];

      if (plays.length > 0) {
        slot.addEventListener("click", (ev) => {
          // A click inside the open menu is the menu's business.
          if ((ev.target as HTMLElement).closest(".playmenu")) return;
          // ALWAYS the menu, even for a single play. Resolving a lone
          // option on the click saved a click and cost the player the
          // chance to read what they were about to do — and a card's one
          // legal play is often not the one they had in mind (a mode they
          // cannot afford, a target they did not expect). The click means
          // "show me", never "do it".
          this.selectedCard = this.selectedCard === cardId ? null : cardId;
          this.paint();
        });
      }

      slot.addEventListener("dragstart", (ev) => {
        const dt = (ev as DragEvent).dataTransfer;
        if (!dt) return;
        dt.setData("text/plain", cardId);
        dt.effectAllowed = "move";
        this.root.classList.add("dragging");
        slot.classList.add("dragsource");
        // Light up only the targets this card can legally be played at.
        // An unplayable card lights nothing, and can still be sorted.
        for (const t of this.dropTargetsFor(plays)) t.classList.add("droptarget");
      });
      slot.addEventListener("dragend", () => this.clearDragMarks());

      // Sorting: drop a card on another hand card to put it there. The
      // pointer's side of the target decides before-or-after, so a card can
      // be dropped at either end of the hand.
      slot.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        const after = this.isAfter(ev as DragEvent, slot);
        slot.classList.toggle("insert-before", !after);
        slot.classList.toggle("insert-after", after);
      });
      slot.addEventListener("dragleave", () => {
        slot.classList.remove("insert-before", "insert-after");
      });
      slot.addEventListener("drop", (ev) => {
        ev.preventDefault();
        // Stop it reaching a play target underneath: within the hand, a
        // drop always means sort.
        ev.stopPropagation();
        const dragged = (ev as DragEvent).dataTransfer?.getData("text/plain");
        this.clearDragMarks();
        if (!dragged || dragged === cardId) return;
        this.reorderHand(handIds, dragged, cardId, this.isAfter(ev as DragEvent, slot));
      });
    }

    // Dropping a card on a target plays the option aimed at that target.
    for (const zone of Array.from(
      this.root.querySelectorAll<HTMLElement>("[data-minion], [data-seat]"),
    )) {
      zone.addEventListener("dragover", (ev) => {
        if (zone.classList.contains("droptarget")) ev.preventDefault();
      });
      zone.addEventListener("drop", (ev) => {
        ev.preventDefault();
        const cardId = (ev as DragEvent).dataTransfer?.getData("text/plain");
        if (!cardId) return;
        const target = zone.dataset["minion"] ?? zone.dataset["seat"];
        const plays = byCard.get(cardId) ?? [];
        const match = plays.find((o) => this.targetsOf(o).includes(target ?? ""));
        // Falling back to a lone play keeps an untargeted card droppable
        // anywhere sensible rather than silently doing nothing.
        const chosen = match ?? (plays.length === 1 ? plays[0] : undefined);
        if (chosen) this.submit(chosen.id);
      });
    }
  }

  /** Is the pointer past the midpoint of this card (drop to its right)? */
  private isAfter(ev: DragEvent, slot: HTMLElement): boolean {
    const rect = slot.getBoundingClientRect();
    return ev.clientX > rect.left + rect.width / 2;
  }

  private clearDragMarks(): void {
    this.root.classList.remove("dragging");
    for (const el of Array.from(
      this.root.querySelectorAll(".droptarget, .insert-before, .insert-after, .dragsource"),
    )) {
      el.classList.remove("droptarget", "insert-before", "insert-after", "dragsource");
    }
  }

  /** Whose hand the strip is showing — this client's player when there is
   *  one, otherwise whoever is being asked (hotseat). Must agree with
   *  `handStrip`, or a sort would be recorded against the wrong seat. */
  private handSeat(): string | null {
    return this.table.localSeat ?? this.transport.decision()?.seat ?? null;
  }

  /** The hand as it is currently ON SCREEN — the engine's hand put through
   *  the player's own order, which is what a sort has to be relative to. */
  private renderedHandIds(): string[] {
    const owner = this.handSeat();
    if (!owner) return [];
    const seat = this.transport.view().seats.find((s) => s.id === owner);
    if (!seat) return [];
    return orderHand(seat.hand, this.handOrder[owner] ?? []).map((c) => c.id);
  }

  /** Move `dragged` next to `target`, and remember the result for the seat. */
  private reorderHand(
    handIds: string[],
    dragged: string,
    target: string,
    after: boolean,
  ): void {
    const seat = this.handSeat();
    if (!seat) return;
    const next = handIds.filter((id) => id !== dragged);
    const at = next.indexOf(target);
    if (at < 0) return;
    next.splice(after ? at + 1 : at, 0, dragged);
    this.handOrder[seat] = next;
    this.paint();
  }

  /** Which table entities an option is aimed at (minion ids and seat ids). */
  private targetsOf(o: LegalOption): string[] {
    const out: string[] = [];
    if (o.kind === "playCard") {
      if (o.minion) out.push(o.minion);
      for (const v of Object.values(o.params)) out.push(v);
    }
    return out;
  }

  private dropTargetsFor(plays: LegalOption[]): HTMLElement[] {
    const wanted = new Set(plays.flatMap((o) => this.targetsOf(o)));
    return Array.from(
      this.root.querySelectorAll<HTMLElement>("[data-minion], [data-seat]"),
    ).filter((el) => {
      const id = el.dataset["minion"] ?? el.dataset["seat"] ?? "";
      return wanted.has(id);
    });
  }

  /**
   * Cards on the TABLE, the same way as cards in hand: a minion or a card
   * in play with something it could do is lit and badged, and a click
   * opens a menu on the card — however few options it has.
   *
   * Deliberately click-only — a table card is not draggable. Dragging a
   * hand card ONTO these tiles already means "play this card here", and
   * one gesture cannot mean two things on the same element.
   */
  private wireTable(): void {
    if (this.isThinking()) return;

    for (const tile of Array.from(this.root.querySelectorAll<HTMLElement>("[data-tcard]"))) {
      const id = tile.dataset["tcard"];
      if (!id) continue;
      // WHAT THE RENDERER DREW IS WHAT IS CLICKABLE. This used to
      // re-derive the option list and ask whether it was empty, which was
      // a second copy of a question `tableActionMarks` had already
      // answered — and stopped agreeing with it the moment a card could
      // be lit for something that is not an option (cards set aside on
      // it). The class it puts on the tile IS the answer.
      if (!tile.classList.contains("actionable")) continue;
      tile.addEventListener("click", (ev) => {
        // A click inside the open menu is the menu's business.
        if ((ev.target as HTMLElement).closest(".playmenu")) return;
        // ...and a click on an attached card is about THAT card, not the
        // minion under it — the tiles nest, so the inner one wins.
        if ((ev.target as HTMLElement).closest("[data-tcard]") !== tile) return;
        // The menu opens even for a single option — see wireHand: the
        // click means "show me what this would do", never "do it".
        this.selectedCard = this.selectedCard === id ? null : id;
        this.paint();
      });
    }
  }

  /**
   * ANSWER THE DECISION. One path, whether the id came from a button in
   * the bar, a card on the table or the allocation dialog — a second copy
   * of this would be a second place the busy latch and the rejection
   * alert have to be got right.
   */
  private submitOption(id: string): void {
    // Disable the whole bar while the submission is in flight: over a
    // network the answer does not come back on this tick, and a second
    // click would submit against a stale decision.
    this.setBusy(true);
    void this.transport
      .choose(id)
      .catch((err: unknown) => {
        // A rejected option means an engine or UI bug (or, later, that
        // the host disagreed). Surface it rather than swallowing it.
        alert(`Rejected "${id}":\n\n${(err as Error).message}`);
        this.paint();
      })
      .finally(() => this.setBusy(false));
  }

  /**
   * The allocation dialog (docs/table-ux-2026-09-18.md §3).
   *
   * The boxes DO NOT REPAINT as they are typed in: a repaint is
   * `innerHTML =`, which would take the caret out of the box mid-number.
   * So the total line and the Confirm button are updated in place, and
   * the draft is only read back out of the DOM.
   */
  private wireAlloc(): void {
    const q = <T extends HTMLElement>(sel: string): T | null =>
      this.root.querySelector<T>(sel);

    q<HTMLButtonElement>("#alloc-open")?.addEventListener("click", () => {
      if (this.isThinking()) return;
      this.allocOpen = true;
      this.paint();
    });
    const close = (): void => {
      this.allocOpen = false;
      this.paint();
    };
    q<HTMLButtonElement>("#alloc-cancel")?.addEventListener("click", close);
    q<HTMLElement>("#alloc-scrim")?.addEventListener("click", close);
    // Changing WHO the split is for changes which splits are legal, so
    // the draft it was assembled against is thrown away with it.
    q<HTMLSelectElement>("#alloc-ctx")?.addEventListener("change", (ev) => {
      this.allocContext = (ev.target as HTMLSelectElement).value;
      this.allocDraft = {};
      this.paint();
    });

    const boxes = Array.from(this.root.querySelectorAll<HTMLInputElement>(".allocnum"));
    if (boxes.length === 0) return;
    const choices = allocationChoices(this.transport.decision());
    const choice = choices.find((c) => c.key === this.allocContext) ?? choices[0];
    if (!choice) return;
    const total = q<HTMLElement>("#alloc-total");
    const ok = q<HTMLButtonElement>("#alloc-ok");

    const refresh = (): void => {
      this.allocDraft = {};
      for (const box of boxes) {
        const who = box.dataset["who"];
        if (who === undefined) continue;
        // A box can hold anything a keyboard can type, including nothing
        // and a minus sign. Clamp on the way IN rather than trusting the
        // `min`/`max` attributes, which the browser enforces on its own
        // spinner and not on typing.
        const cap = choice.caps[who] ?? choice.points;
        const n = Math.max(0, Math.min(cap, Math.floor(Number(box.value) || 0)));
        if (n > 0) this.allocDraft[who] = n;
      }
      const spent = Object.values(this.allocDraft).reduce((a, b) => a + b, 0);
      const id = choice.byAlloc.get(allocKey(this.allocDraft));
      if (total) {
        total.textContent =
          `${spent} of ${choice.points} allocated` +
          (id !== undefined
            ? ""
            : spent === choice.points
              ? " — not a legal split"
              : spent > choice.points
                ? " — too many"
                : "");
      }
      if (ok) ok.disabled = id === undefined;
    };
    for (const box of boxes) {
      box.addEventListener("input", refresh);
      box.addEventListener("change", refresh);
    }
    ok?.addEventListener("click", () => {
      refresh();
      // The id came from an option the engine offered — this never builds
      // one. A split with no id is not legal and Confirm is disabled, so
      // reaching here without one means something moved under us.
      const id = choice.byAlloc.get(allocKey(this.allocDraft));
      if (id === undefined || this.isThinking()) return;
      this.allocOpen = false;
      this.submitOption(id);
    });
  }

  private wire(): void {
    this.wireHand();
    this.wireTable();
    // Array.from rather than for..of: the project's tsconfig lib list is
    // ["ES2022", "DOM"] without DOM.Iterable, so a NodeList is not iterable.
    for (const btn of Array.from(this.root.querySelectorAll<HTMLButtonElement>("button.opt"))) {
      btn.addEventListener("click", () => {
        const id = btn.dataset["opt"];
        if (!id || this.isThinking()) return;
        this.submitOption(id);
      });
    }
    this.wireAlloc();

    const history = this.transport.history;
    const on = (sel: string, fn: () => void): void => {
      this.root.querySelector<HTMLButtonElement>(sel)?.addEventListener("click", fn);
    };
    if (history) {
      on("#undo", () => void history.undo(1));
      on("#undo-action", () => void history.undoToActionStart());
      on("#restart", () => void history.restart());
      on("#save", () => {
        // A NAME, because there is more than one slot now. Cancelling is
        // not an error and neither is an empty box — both mean "no, not
        // after all", and the automatic slot has this turn anyway.
        const suggested = loadSaves().filter((s) => !s.auto).length + 1;
        const name = prompt("Save this game as:", `Game ${suggested}`);
        if (name === null || name.trim() === "") return;
        const problem = saveAs(name, history.snapshot(), this.saveLabel());
        // Unlike the autosave, this was asked for — so a refusal is said
        // out loud rather than swallowed.
        if (problem) alert(problem);
      });
      on("#download", () => downloadSave(history.snapshot()));
      on("#load", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json";
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (!file) return;
          void readSaveFile(file)
            .then((save) => {
              void history.load(save);
              // THE AGENTS DO NOT COME WITH IT. `load` replaces the engine
              // and leaves the transport's agents alone — which is right
              // when the seats are the same game's and wrong when they are
              // not, so a save that says who its bots were is honoured.
              // Without this, loading someone else's file at the table
              // leaves every seat waiting on a human who is not there.
              if (save.botSeats && this.transport instanceof LocalTransport) {
                const wanted = new Set(save.botSeats);
                for (const seat of save.setup.decks.map((d) => d.seat)) {
                  this.transport.setAgent(
                    seat,
                    wanted.has(seat)
                      ? botAgentFor(seat, {
                          // The save says how each bot was PLAYING, so a load
                          // resumes the same game rather than the same board.
                          ...(playstyleOf({ playstyle: save.botPlaystyles?.[seat] })
                            ? { playstyle: playstyleOf({ playstyle: save.botPlaystyles?.[seat] })! }
                            : {}),
                        })
                      : null,
                  );
                }
              }
            })
            .catch((err: unknown) => alert((err as Error).message));
        });
        input.click();
      });
    }

    // LEAVING IS CONFIRMED — see `#leave-btn` below for what it costs.
    // Table chat. The same panel as the lobby's, over the same store, so
    // the conversation carries on rather than starting again.
    const chatBox = this.root.querySelector<HTMLInputElement>("#chatinput");
    const sayIt = (): void => {
      const say = this.table.say;
      if (!chatBox || !say || chatProblem(chatBox.value)) return;
      const text = chatBox.value;
      chatBox.value = "";
      // SENDING PUTS THE PICKER AWAY (owner request 2026-09-07). It is
      // open because you were composing; once the line has gone there is
      // nothing left to compose, and it was covering the conversation you
      // had just added to.
      this.emojiOpen = false;
      say(text);
      this.paint();
    };
    on("#chatsend", () => sayIt());

    // THE END OF THE GAME, answered once. Both answers leave the table —
    // there is nothing left to do at a finished one — and the difference
    // is only whether it goes on this device's leaderboard.
    const finish = (save: boolean): void => {
      if (this.dismissedEnding) return;
      this.dismissedEnding = true;
      this.table.onFinished?.(save);
    };
    on("#over-save", () => finish(true));
    on("#over-discard", () => finish(false));

    // Moderation — host only, and the buttons only exist there.
    on("#mod-btn", () => {
      this.modOpen = !this.modOpen;
      this.paint();
    });
    on("#mod-close", () => {
      this.modOpen = false;
      this.paint();
    });
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>(".mod-kick"))) {
      el.addEventListener("click", () => {
        const seat = el.dataset["seat"] ?? "";
        // ASK FOR A REASON, and send it to the person it is about. Being
        // removed from a game with no explanation is the thing worth
        // avoiding; `prompt` returning null is a cancelled kick, which is
        // different from an empty reason.
        const reason = prompt(
          `Remove ${seat} from the game? A bot will play their seat.\n\nWhy? (they will be told)`,
          "",
        );
        if (reason === null) return;
        this.table.kick?.(seat, reason.trim() || "no reason given");
        this.paint();
      });
    }

    // Chat settings, and the emoji pad. Both are pure view state: they
    // never reach the command log, like every other client preference.
    on("#chat-gear", () => {
      this.chatSettingsOpen = !this.chatSettingsOpen;
      this.paint();
    });
    on("#chatemoji", () => {
      this.emojiOpen = !this.emojiOpen;
      this.paint();
    });
    // The category tabs under the grid. View state, like the pad itself.
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>(".emojitab"))) {
      el.addEventListener("click", () => {
        this.emojiCategory = el.dataset["emojicat"] ?? DEFAULT_EMOJI_CATEGORY;
        this.paint();
      });
    }
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>(".emoji"))) {
      el.addEventListener("click", () => {
        const box = this.root.querySelector<HTMLInputElement>("#chatinput");
        if (!box) return;
        // Insert AT THE CARET rather than appending: somebody adding a
        // face mid-sentence should not have it land at the end.
        const at = box.selectionStart ?? box.value.length;
        const end = box.selectionEnd ?? at;
        const emoji = el.dataset["emoji"] ?? "";
        box.value = box.value.slice(0, at) + emoji + box.value.slice(end);
        box.focus();
        box.setSelectionRange(at + emoji.length, at + emoji.length);
      });
    }
    // Committed by a button, and nothing repaints before it: Chrome's
    // colour well is a popover anchored to the input, and a repaint takes
    // that element away and closes it. See `chatSettings` in render.ts.
    const colorBox = this.root.querySelector<HTMLInputElement>("#chatcolor");
    on("#chatcolor-ok", () => {
      if (colorBox) this.table.setChatColor?.(colorBox.value);
      this.chatSettingsOpen = false;
      this.paint();
    });
    on("#chatcolor-cancel", () => {
      this.chatSettingsOpen = false;
      this.paint();
    });
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>(".mod-ban"))) {
      el.addEventListener("click", () => {
        const seat = el.dataset["seat"] ?? "";
        const banned = this.table.moderate?.().people.find((p) => p.seat === seat)?.banned ?? false;
        this.table.setChatBan?.(seat, !banned);
        this.paint();
      });
    }
    chatBox?.addEventListener("keydown", (ev) => {
      if ((ev as KeyboardEvent).key === "Enter") sayIt();
    });
    const chatLinesEl = this.root.querySelector<HTMLElement>("#chatlines");
    if (chatLinesEl) chatLinesEl.scrollTop = chatLinesEl.scrollHeight;

    on("#leave-btn", () => {
      const leave = this.table.onLeave;
      if (!leave) return;
      // WHAT LEAVING COSTS depends on whether this client keeps the game.
      // With the automatic slot, walking out of a private game no longer
      // throws it away — it costs whatever has happened since the turn
      // began, and saying "anything since your last save is lost" would
      // now frighten a player out of a door that is safe to use.
      const kept = this.table.autosave === true && this.transport.history !== null;
      const rewindable = this.transport.history !== null;
      if (
        !confirm(
          "Leave this game?\n\n" +
            (kept
              ? "It is kept in Saved games on your profile — you can pick " +
                "it up from the start of this turn."
              : rewindable
                ? "Anything since your last save is lost."
                : "This game will not be kept."),
        )
      ) {
        return;
      }
      leave();
    });

    // The ash heap: public to every Methuselah at any time (p. 16), so
    // every seat's pile opens, not just your own.
    for (const btn of Array.from(
      this.root.querySelectorAll<HTMLButtonElement>("button[data-ash]"),
    )) {
      btn.addEventListener("click", () => {
        this.ashOpen = btn.dataset["ash"] ?? null;
        this.paint();
      });
    }
    on("#ash-close", () => {
      this.ashOpen = null;
      this.paint();
    });

    // YOUR OWN crypt and library, alphabetically. Only your own piles are
    // drawn as buttons (render.ts), so there is nothing here to gate.
    for (const btn of Array.from(
      this.root.querySelectorAll<HTMLButtonElement>("button[data-deck]"),
    )) {
      btn.addEventListener("click", () => {
        this.deckOpen = btn.dataset["deck"] ?? null;
        this.paint();
      });
    }
    on("#deck-close", () => {
      this.deckOpen = null;
      this.paint();
    });
    on("#deck-scrim", () => {
      this.deckOpen = null;
      this.paint();
    });
    on("#ash-scrim", () => {
      this.ashOpen = null;
      this.paint();
    });

    // "You can look at the cards at any time" — the menu entry on a card
    // that is holding cards set aside on it. It carries `data-peek` and
    // no `data-opt`, so the handler above that submits an option id has
    // already passed it over.
    for (const btn of Array.from(
      this.root.querySelectorAll<HTMLButtonElement>("button[data-peek]"),
    )) {
      btn.addEventListener("click", () => {
        this.storeOpen = btn.dataset["peek"] ?? null;
        // The card menu closes behind it: the panel IS the answer to the
        // click, and leaving the menu open under the scrim looks stuck.
        this.selectedCard = null;
        this.paint();
      });
    }
    on("#store-close", () => {
      this.storeOpen = null;
      this.paint();
    });
    on("#store-scrim", () => {
      this.storeOpen = null;
      this.paint();
    });

    this.wireSettings();
    this.wireHelp();

    const filter = this.root.querySelector<HTMLInputElement>("#evfilter");
    filter?.addEventListener("input", () => {
      this.eventFilter = filter.value;
      this.paint();
      // Re-focus after the full re-render, so typing is not interrupted.
      const next = this.root.querySelector<HTMLInputElement>("#evfilter");
      next?.focus();
      next?.setSelectionRange(next.value.length, next.value.length);
    });
  }

  /**
   * The How to Play dialog. Pure reference material — it reads no game
   * state and answers no decision, so nothing here touches the transport.
   * Which sections are expanded is held here rather than in the DOM,
   * because every repaint rebuilds the markup.
   */
  private wireHelp(): void {
    const on = (sel: string, fn: () => void): void => {
      this.root.querySelector<HTMLElement>(sel)?.addEventListener("click", fn);
    };
    on("#help-btn", () => {
      this.helpOpen = !this.helpOpen;
      this.paint();
    });
    on("#help-close", () => {
      this.helpOpen = false;
      this.paint();
    });
    on("#help-scrim", () => {
      this.helpOpen = false;
      this.paint();
    });

    // Searching the rules. Repaints on every keystroke — the panel is a
    // pure function of its query like everything else here — so the
    // caret has to be put back afterwards, or typing the second letter
    // would land at the start of the box.
    const search = this.root.querySelector<HTMLInputElement>("#help-search");
    search?.addEventListener("input", () => {
      this.helpQuery = search.value;
      const caret = search.selectionStart;
      this.paint();
      const again = this.root.querySelector<HTMLInputElement>("#help-search");
      if (again) {
        again.focus();
        if (caret !== null) again.setSelectionRange(caret, caret);
      }
    });

    // `toggle` does not bubble, so it is wired per section. These elements
    // are recreated by every repaint, so the listeners cannot stack up.
    this.root.querySelectorAll<HTMLDetailsElement>(".rulesec").forEach((el) => {
      el.addEventListener("toggle", () => {
        const id = el.dataset.rule;
        if (!id) return;
        if (el.open) this.helpOpenSections.add(id);
        else this.helpOpenSections.delete(id);
        // No repaint: the browser has already done the only visible work,
        // and repainting here would fight the animation.
      });
    });
  }

  /**
   * The settings dialog. Every preference is applied through the transport
   * (the authority) and mirrored to localStorage, so it survives a reload
   * and — in phase 6 — a peer applies its own without touching the game.
   */
  private wireSettings(): void {
    const on = (sel: string, fn: () => void): void => {
      this.root.querySelector<HTMLElement>(sel)?.addEventListener("click", fn);
    };
    on("#settings-btn", () => {
      this.settingsOpen = !this.settingsOpen;
      this.paint();
    });
    on("#settings-close", () => {
      this.settingsOpen = false;
      this.paint();
    });
    on("#settings-scrim", () => {
      this.settingsOpen = false;
      this.paint();
    });

    // How large card text is read at. A pure display preference, so it is
    // wired for EVERY transport — a peer needs it as much as a host does.
    const cardtext = this.root.querySelector<HTMLSelectElement>("#cardtext");
    cardtext?.addEventListener("change", () => {
      this.settings.cardTextPx = Number(cardtext.value) || 15;
      saveSettings(this.settings);
      this.paint();
    });

    if (!(this.transport instanceof LocalTransport)) return;
    const t = this.transport;

    // Debug reveal — only a local/host client can have one, since only it
    // holds the unredacted state to reveal.
    const omni = this.root.querySelector<HTMLInputElement>("#omni");
    omni?.addEventListener("change", () => {
      this.settings.omniscient = omni.checked;
      saveSettings(this.settings);
      t.setOmniscient(omni.checked);
    });

    const setSeat = (seat: string, value: boolean): void => {
      this.settings.autoPass[seat] = value;
      saveSettings(this.settings);
      t.setAutoPass(seat, value);
    };
    const all = this.root.querySelector<HTMLInputElement>("#autopass-all");
    all?.addEventListener("change", () => {
      // Read the box before the first setSeat: applying one repaints, which
      // detaches this element from the document.
      const value = all.checked;
      for (const s of t.view().seats) setSeat(s.id, value);
      this.paint();
    });
    for (const box of Array.from(
      this.root.querySelectorAll<HTMLInputElement>(".autopass-seat"),
    )) {
      box.addEventListener("change", () => {
        const seat = box.dataset["seat"];
        if (seat) setSeat(seat, box.checked);
        this.paint();
      });
    }

    // Hand a seat to the AI, or take it back (phase 5). Like auto-pass,
    // this is a client preference: it never enters the command log, so a
    // saved game replays identically whoever was playing the seat.
    for (const box of Array.from(
      this.root.querySelectorAll<HTMLInputElement>(".ai-seat"),
    )) {
      box.addEventListener("change", () => {
        const seat = box.dataset["seat"];
        if (!seat) return;
        const on = box.checked;
        this.settings.aiSeats[seat] = on;
        saveSettings(this.settings);
        // A fresh agent per seat, seeded from the seat name so two AI
        // seats do not make identical choices in identical spots.
        t.setAgent(seat, on ? botAgentFor(seat) : null);
        this.paint();
      });
    }

    // How long the table holds after each visible AI move. Applied through
    // the transport for the same reason as the rest: the authority runs the
    // agents, so the authority owns their pacing — a phase-6 peer will be
    // watching the host's clock, not its own.
    const speed = this.root.querySelector<HTMLSelectElement>("#aispeed");
    speed?.addEventListener("change", () => {
      this.settings.aiDelayMs = Number(speed.value) || 0;
      saveSettings(this.settings);
      t.setAiDelay(this.settings.aiDelayMs);
      this.paint();
    });

    // The pass clock (owner request 2026-09-21). On the transport for the
    // same reason as everything above it, and more strongly: this one
    // ANSWERS for seats on other machines, so it can only live on the side
    // that runs the engine (docs/pass-timeout-design.md §1).
    const clock = this.root.querySelector<HTMLSelectElement>("#passclock-set");
    clock?.addEventListener("change", () => {
      this.settings.passTimeoutMs = Number(clock.value) || 0;
      saveSettings(this.settings);
      t.setPassTimeout(this.settings.passTimeoutMs);
      this.paint();
    });
  }

  /**
   * Keep the game in the automatic slot, once per turn.
   *
   * ONCE PER TURN, not once per decision. A save is the setup plus every
   * command in the game, so writing it costs a full serialisation of both
   * — cheap next to a turn, wasteful next to a click, and there are
   * hundreds of clicks in a turn. A turn is also the unit a player thinks
   * in when they say where they got back to.
   *
   * `turnNumber` rather than a counter of our own: a game can be undone or
   * loaded underneath us, and a monotonic counter would then refuse to
   * write the turn it had already seen. Comparing the ACTUAL turn means a
   * rewind to turn 4 autosaves turn 4 again, which is right — the board
   * really is different.
   */
  private autosave(): void {
    const history = this.transport.history;
    if (!this.table.autosave || !history) return;
    const view = this.transport.view();
    const frame = view.frames.find((f) => f.kind === "turn");
    const turn = frame && frame.kind === "turn" ? frame.turnNumber : 0;
    if (turn === this.autosavedTurn) return;
    this.autosavedTurn = turn;
    autoSave(history.snapshot(), { turn, seats: view.seats.map((s) => s.id) });
  }

  /** The turn already written to the automatic slot. -1 so turn 0 — a
   *  game with no turn frame yet — still counts as a change. */
  private autosavedTurn = -1;

  /** What a slot's row should say about this game. Read fresh from the
   *  view, so a named save taken mid-turn is labelled with the turn it
   *  was actually taken in. */
  private saveLabel(): { turn: number; seats: string[] } {
    const view = this.transport.view();
    const frame = view.frames.find((f) => f.kind === "turn");
    return {
      turn: frame && frame.kind === "turn" ? frame.turnNumber : 0,
      seats: view.seats.map((s) => s.id),
    };
  }

  private setBusy(busy: boolean): void {
    for (const btn of Array.from(this.root.querySelectorAll<HTMLButtonElement>("button.opt"))) {
      btn.disabled = busy;
    }
  }
}

/**
 * Boot straight into `config/playtest-decks.json`, refusing to start on a
 * bad deck.
 *
 * NO LONGER THE APP'S ENTRY POINT — `main.ts` boots the shell, which deals
 * a real game (docs/shell-design.md). This is kept because the playtest
 * snapshot is still the fastest way to reach a mid-game position for a
 * hands-on look at a card, which is what it was written for; a fresh deal
 * spends its first turns influencing, on purpose.
 */
export function startFromConfig(
  root: HTMLElement,
  config: { seed: number; maxTurns: number | null; decks: DeckDef[] },
  resume = true,
): void {
  const check = validateDecks(config.decks);
  if (!check.ok) {
    root.innerHTML = `
      <div class="fatal">
        <h2>Playtest decks failed validation</h2>
        <p>Fix <code>config/playtest-decks.json</code> — deck lists are never
           silently dropped.</p>
        ${check.unknown.length ? `<p><b>Not in the V5 registry:</b> ${check.unknown.join(", ")}</p>` : ""}
        ${check.unsupported.length ? `<p><b>In the pool but not implemented yet:</b> ${check.unsupported.join(", ")}</p>` : ""}
        ${check.badCryptIds.length ? `<p><b>Not a V5 crypt card id:</b> ${check.badCryptIds.join(", ")}</p>` : ""}
        ${
          check.illegalDecks.length
            ? `<p><b>Not a legal deck (rulebook p. 14):</b></p><ul>${check.illegalDecks
                .map((d) => `<li>${d.seat} — ${d.problem}</li>`)
                .join("")}</ul>`
            : ""
        }
      </div>`;
    return;
  }
  if (check.poolMismatches.length) {
    // Not fatal — a scenario may want an odd pool — but a mid-game
    // snapshot that never paid for its vampires is not a position any
    // sequence of legal plays could reach, and it silently distorts every
    // pool-economy card in the game.
    console.warn(
      "[vtes] starting pool does not match what these seats' vampires cost " +
        "to influence: " +
        check.poolMismatches
          .map((m) => `${m.seat} has ${m.configured}, expected ${m.expected}`)
          .join("; "),
    );
  }
  if (check.inertAbilities.length) {
    // Not fatal — the vampire is a real card with real stats — but a
    // playtester must not assume its printed ability is doing anything.
    console.warn(
      "[vtes] these vampires' printed ability is not implemented, so their " +
        `card text does nothing: ${check.inertAbilities.join(", ")}`,
    );
  }
  const setup: GameSetup = {
    decks: config.decks,
    seed: config.seed,
    maxTurns: config.maxTurns,
  };
  // Resume the last game saved in this browser, if there is one.
  //
  // The automatic slot, which is the same store the shell reads — there
  // is ONE answer to "what games are saved?" and this is not a second
  // one. Note that this path does not WRITE that slot (see
  // `TableIdentity.autosave`): a playtest snapshot may read the last real
  // game, but it must never overwrite it.
  const saved = resume ? (loadSaves().find((s) => s.auto)?.game ?? null) : null;
  // One log file per playthrough, written into `logs/` by the dev server
  // so a session can be read back afterwards (docs/game-log-design.md).
  // The logger belongs to the transport, not here: only the authority sees
  // the AI's moves and the auto-passes.
  const transport = new LocalTransport({
    setup: saved?.setup ?? setup,
    ...(saved ? { commands: saved.commands } : {}),
    log: new GameLog(new DevServerSink(), saved?.setup ?? setup),
  });
  new DebugApp(root, transport);
}
