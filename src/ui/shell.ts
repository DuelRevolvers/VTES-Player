/**
 * The app shell (docs/shell-design.md): profile → menu → new game → table.
 *
 * Until now `main.ts` booted straight into one hand-authored mid-game
 * snapshot. This is the front of the application: who you are, what you
 * want to do, and what table to sit at.
 *
 * Same rendering model as the table (docs/debug-ui-design.md §3): a screen
 * is a pure function of the shell's state, re-rendered whole on every
 * change. There is at most one interaction per few hundred milliseconds of
 * human time here, so it is free, and it removes stale-view bugs.
 *
 * The shell owns NO game state. It builds a `GameSetup` and hands it to
 * the table, which owns the game from then on.
 */

import { HeuristicAgent } from "../ai/heuristic.ts";
import { LobbyHost, LobbyPeer } from "../net/lobby.ts";
import type { HostSession } from "../net/host.ts";
import { PeerTransport } from "../net/peer.ts";
import type { RoomHandle } from "../net/peerjs.ts";
import { hostRoom, joinRoom } from "../net/peerjs.ts";
import type { LobbySeat, PeerChannel } from "../net/protocol.ts";
import { addChat, chatLines, chatProblem, clearChat, MAX_CHAT_TEXT, onChat } from "./chat.ts";
import { codeFromLink, isRoomCode, joinLink, newRoomCode, normaliseRoomCode } from "../net/room.ts";
import type { PreconSummary } from "./deckimport.ts";
import { preconStyle, supportedPrecons, supportedSets } from "./deckimport.ts";
import {
  deckSummary,
  deleteDeck,
  findDeck,
  loadDecks,
  MAX_DECK_NAME,
  renameDeck,
  saveDeck,
} from "./decklibrary.ts";
import { DevServerSink, GameLog } from "./gamelog.ts";
import type { GameResult } from "./results.ts";
import {
  clearResults,
  loadResults,
  playedOn,
  recordResult,
  resultFrom,
  standings,
} from "./results.ts";
import { DebugApp } from "./loop.ts";
import type { ModerationView, SeatFace } from "./render.ts";
import { chatLinesMarkup, chatSettings, DEFAULT_EMOJI_CATEGORY, emojiPad } from "./render.ts";
import type { DeckSource, SeatConfig, TableConfig } from "./newgame.ts";
import {
  botSeats,
  buildTable,
  defaultTable,
  isOnlineTable,
  seatDeckHash,
  uniqueSeatName,
  MAX_SEATS,
  MIN_SEATS,
  RECOMMENDED_SEATS,
} from "./newgame.ts";
import type { Profile } from "./profile.ts";
import {
  clearProfile,
  colorProblem,
  DEFAULT_CHAT_COLOR,
  loadProfile,
  MAX_NAME_LENGTH,
  nameProblem,
  newProfile,
  saveProfile,
} from "./profile.ts";
import bannerUrl from "../assets/banner.png";
import { PLATFORM_VERSION_LABEL } from "../version.ts";
import {
  botNameFor,
  botNameProblem,
  loadSettings,
  MAX_BOT_NAMES,
  OPENING_DELAY_MS,
  saveSettings,
  seatSeed,
} from "./settings.ts";
import type { SaveSlot } from "./savedgames.ts";
import {
  botSeatsFor,
  deleteSave,
  findSave,
  keepAuto,
  loadSaves,
  renameSave,
} from "./savedgames.ts";
import type { SavedGame } from "./history.ts";
import { readSaveFile } from "./history.ts";
import { LocalTransport } from "./transport.ts";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

type Screen = "profile" | "menu" | "newgame" | "lobby" | "join" | "leaderboard" | "table";

/**
 * "2 minutes ago", for a saved game's row.
 *
 * Relative rather than a timestamp because the question a player is
 * actually asking is "is this the one I was just playing?", and a clock
 * time makes them work that out. Falls back to the date once it stops
 * being a useful answer.
 */
function ago(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(then).toLocaleDateString();
}

export class Shell {
  private screen: Screen;
  private profile: Profile | null;
  private table: TableConfig;
  private error = "";
  /** The last deck-library problem, shown where it happened. Separate from
   *  `error` so a failed save does not clear a lobby's message. */
  private deckError = "";
  /** The saved-games panel's message. Separate from `deckError` and from
   *  `error` so a failed load does not clear what the deck importer or the
   *  profile form was telling you — they are three panels on one screen. */
  private saveError = "";
  private botNameError = "";
  /** Which seat's deck panel is open on the new-game screen. */
  private editingDeck: number | null = null;

  // --- online ---------------------------------------------------------------
  /** Hosting: the room on the broker, and the lobby it feeds. */
  private room: RoomHandle | null = null;
  private lobbyHost: LobbyHost | null = null;
  /** Joining: the connection, and the lobby on the far end of it. */
  private guestChannel: PeerChannel | null = null;
  private lobbyPeer: LobbyPeer | null = null;
  /** The code typed on the Join screen. */
  private joinCode = "";
  /** Something is being waited on — the broker, or a connection. */
  private busy = "";
  /** Watch rather than play: the Join screen's other option. */
  private wantSpectate = false;
  /** How many people are watching this table, for the host's lobby. */
  private spectators = 0;

  constructor(private readonly root: HTMLElement) {
    this.profile = loadProfile();
    this.table = this.newTable(this.profile?.name ?? "You");
    // A join LINK skips the menu — someone who clicked it has already said
    // what they want. They still need a profile first, since a seat is
    // labelled with a name.
    const invited = codeFromLink(location.href);
    if (invited) this.joinCode = invited;
    this.screen = !this.profile ? "profile" : invited ? "join" : "menu";
    // A chat line can arrive at any moment from the network, and the
    // screen is a pure function of state, so it only has to be told.
    onChat(() => {
      if (this.screen === "newgame" || this.screen === "lobby") this.paint();
    });
    this.paint();
  }

  /**
   * A fresh table, with the bot seats named the way this player likes.
   *
   * Every table starts here — the constructor, "Host a game", and the
   * moment a profile is first created — so the preference is read fresh
   * each time rather than captured once at boot: a name changed on the
   * Profile screen should be on the next table, not the next reload.
   */
  private newTable(name: string): TableConfig {
    const settings = loadSettings();
    return defaultTable(name, (i) => botNameFor(settings, i));
  }

  private go(screen: Screen): void {
    // Leaving the Profile screen abandons whatever was half-typed on it;
    // coming back should show what is SAVED. `paint` re-reads the draft
    // from the live form, so this has to come first.
    if (screen !== "profile") this.profileDraft = null;
    this.screen = screen;
    this.error = "";
    // A deliberate move somewhere else acknowledges the "you were removed"
    // banner. `leaveTable` does NOT go through here, which is what leaves
    // it on screen for the player who has just been shown the door.
    this.removedReason = "";
    this.paint();
  }

  private paint(): void {
    if (this.screen === "table") return; // the table owns the root now
    // WHAT WAS TYPED SURVIVES THE REPAINT.
    //
    // The screen is a pure function of state re-rendered whole, which is
    // what keeps it free of stale-view bugs — but a half-typed name is
    // state too, and it lived only in the DOM node about to be thrown
    // away. Everything else on the Profile screen repaints it (renaming a
    // deck, deleting a save, saving bot names), so typing a new name and
    // then touching anything else silently put the old one back.
    this.keepProfileDraft();
    // The menu is centred in the window (there is nothing else on screen
    // to align with); the lobby is sized to fill it, because it is a table
    // and a table should look like the room it is.
    const cls = this.screen === "menu" ? "shell centred" : "shell";
    this.root.innerHTML = `<div class="${cls}">${this.body()}</div>`;
    this.wire();
  }

  private body(): string {
    switch (this.screen) {
      case "profile":
        return this.profileScreen();
      case "menu":
        return this.menuScreen();
      // One screen, both cases. Building a table and waiting in a lobby
      // show the same thing, so opening a seat adds a room code rather
      // than throwing the host to a second page.
      case "newgame":
      case "lobby":
        return this.lobbyScreen();
      case "join":
        return this.joinScreen();
      case "leaderboard":
        return this.leaderboardScreen();
      default:
        return "";
    }
  }

  /**
   * Change this player's chat colour, everywhere at once.
   *
   * ONE PLACE, because there are four things to tell and three screens
   * that can start the change (the profile page, the lobby's gear, the
   * table's gear). The colour is a property of the PERSON, so it goes to
   * the profile first — and then to whoever is relaying, because the HOST
   * stamps every line from what IT recorded about a player, not from what
   * the line says. Without that last step a guest could pick a colour and
   * go on being written in the old one for the rest of the session, which
   * is exactly what was reported (2026-09-07).
   */
  private applyChatColor(color: string): void {
    if (!this.profile || colorProblem(color) || this.profile.chatColor === color) return;
    this.profile = { ...this.profile, chatColor: color };
    saveProfile(this.profile);
    // Whichever end this client is. A private table relays through
    // nobody, and reads the profile directly when it says something.
    this.lobbyPeer?.setColor(color);
    if (this.tableTransport instanceof PeerTransport) this.tableTransport.setColor(color);
    this.paint();
  }

  /** Why this client was shown the door, if it was. Cleared when they
   *  acknowledge it or go anywhere else. */
  private removedReason = "";

  /**
   * Removed from a table, and TOLD WHY, back on the MAIN MENU.
   *
   * The reason is the host's own words, typed into the kick prompt and
   * carried in the `bye` the protocol already had. This used to be a
   * screen of its own, and it never appeared: the shell painted it into
   * the root and the table — which had subscribed to the same transport
   * afterwards — painted straight over it, so being kicked looked exactly
   * like the connection dropping (owner report). The banner rides on the
   * menu instead, which is where a player with no table left belongs.
   */
  private removedBanner(): string {
    if (!this.removedReason) return "";
    return `
      <div class="card removed">
        <h2>You were removed from the table</h2>
        <p class="note">The host gave this reason:</p>
        <p class="err quoted">${esc(this.removedReason)}</p>
        <p class="note">
          A bot is playing your seat, so the game goes on without you.
        </p>
        <div class="row"><button id="removed-ok">OK</button></div>
      </div>`;
  }

  // --- profile -------------------------------------------------------------

  /**
   * The Profile screen's unsaved edits, carried across a repaint.
   *
   * Null when there is nothing in flight. Cleared whenever the screen
   * changes — a draft is about the form you are looking at, and coming
   * back to Profile later should show what is SAVED, not what you
   * abandoned three screens ago.
   */
  private profileDraft: { name: string; color: string } | null = null;

  private keepProfileDraft(): void {
    if (this.screen !== "profile") return;
    const name = this.root.querySelector<HTMLInputElement>("#pname");
    const color = this.root.querySelector<HTMLInputElement>("#pcolor");
    // Absent on the very first paint, when there is no form yet.
    if (!name) return;
    this.profileDraft = {
      name: name.value,
      color: color?.value ?? this.profile?.chatColor ?? DEFAULT_CHAT_COLOR,
    };
  }

  private profileScreen(): string {
    const p = this.profile;
    const draft = this.profileDraft;
    return `
      <div class="card">
        <h1>${p ? "Your profile" : "Welcome"}</h1>
        <p class="note">
          Your profile lives <b>in this browser only</b> — there is no
          account and no server. Your name is how other players see you at a
          table; it needs to be unique in a room, not in the world.
        </p>
        <label class="field">
          <span>Name</span>
          <input id="pname" maxlength="${MAX_NAME_LENGTH}"
                 value="${esc(draft?.name ?? p?.name ?? "")}" placeholder="Methuselah" />
        </label>
        <label class="field">
          <span>Avatar</span>
          <span class="avatarrow">
            <span class="avatar">${
              p?.avatar ? `<img src="${esc(p.avatar)}" alt="" />` : "?"
            }</span>
            <input id="pavatar" type="file" accept="image/*" />
          </span>
        </label>
        <p class="note">Pictures are shrunk to 128&times;128 before they are stored.</p>
        <!--
          The SAME setting as the chat's gear, not a copy of it: one value
          on the profile, two ways in. It is a property of the person
          rather than of a screen, so it travels to every table and
          everyone there sees them in it.
        -->
        <label class="field">
          <span>Chat name colour</span>
          <input id="pcolor" type="color"
                 value="${esc(draft?.color ?? p?.chatColor ?? DEFAULT_CHAT_COLOR)}" />
        </label>
        <p class="note">
          The colour your name is written in when you talk at a table.
        </p>
        ${this.error ? `<p class="err">${esc(this.error)}</p>` : ""}
        <div class="row">
          <button id="psave" class="primary">${p ? "Save" : "Create profile"}</button>
          ${p ? `<button id="pback">Back</button>` : ""}
          ${p ? `<button id="pclear" class="danger">Delete profile</button>` : ""}
        </div>
        ${p ? this.deckLibrary() : ""}
        ${p ? this.savedGamesPanel() : ""}
        ${p ? this.botNamesPanel() : ""}
      </div>`;
  }

  /**
   * The games this browser is holding (docs/saved-games-design.md).
   *
   * On the Profile screen for the reason the deck library is: this is
   * where the things that are YOURS live, and a saved game is one of them.
   * It could equally have been a menu entry, and the menu is deliberately
   * five buttons — a sixth that is empty for most of a player's first
   * session is a worse first screen than a section they find when they
   * have something in it.
   */
  private savedGamesPanel(): string {
    const saves = loadSaves();
    return `
      <div class="supported savestore">
        <div class="sethead">Saved games</div>
        <p class="note">
          Saved in this browser. <b>Last game</b> is kept for you
          automatically at the top of every turn — press <b>Keep</b> to
          hold on to a position before the next turn overwrites it.
        </p>
        ${
          saves.length === 0
            ? `<p class="note dim">No saved games yet. One will appear here
                 once you have played a turn.</p>`
            : `<div class="seats">${saves.map((s) => this.saveRow(s)).join("")}</div>`
        }
        <div class="row">
          <button id="save-file">Load from file…</button>
        </div>
        <p class="note dim">
          A save holds the whole game — every deck and every decision — so
          it can be handed over with a bug report and replayed exactly.
        </p>
        ${this.saveError ? `<p class="err">${esc(this.saveError)}</p>` : ""}
      </div>`;
  }

  private saveRow(s: SaveSlot): string {
    // The seat list is what tells two saves apart at a glance, far more
    // than the date does, so it is the widest thing in the row.
    const who = s.seats.length > 0 ? s.seats.join(", ") : "unknown table";
    const turn = s.turn > 0 ? `turn ${s.turn}` : "mid-game";
    return `
      <div class="lobbyrow saverow">
        <span class="lname">${esc(s.name)}${
          s.auto ? ` <span class="dim">auto</span>` : ""
        }</span>
        <span class="ldeck ready">${esc(turn)} · ${esc(who)}</span>
        <span class="dim savewhen">${esc(ago(s.savedAt))}</span>
        <button class="saveload primary" data-save="${esc(s.id)}">Load</button>
        ${
          s.auto
            ? `<button class="savekeep" data-save="${esc(s.id)}">Keep</button>`
            : `<button class="saverename" data-save="${esc(s.id)}">Rename</button>`
        }
        <button class="savedelete danger" data-save="${esc(s.id)}">Delete</button>
      </div>`;
  }

  /**
   * What this machine's tables call their bots.
   *
   * DEFAULTS, and the note says so: every bot seat is still renameable in
   * the lobby, and this only decides what it starts as. The boxes are
   * positional — box 1 is bot seat 1 — so a blank one is left in place
   * rather than closing the gap, and reads as "Bot 3" on the table.
   */
  private botNamesPanel(): string {
    const settings = loadSettings();
    const rows = [];
    for (let i = 1; i <= MAX_BOT_NAMES; i++) {
      const configured = settings.botNames[i - 1] ?? "";
      rows.push(`
        <label class="field botnamerow">
          <span>Bot ${i}</span>
          <input class="botname" data-bot="${i}" maxlength="${MAX_NAME_LENGTH}"
                 value="${esc(configured)}" placeholder="Bot ${i}" />
        </label>`);
    }
    return `
      <div class="supported botnames">
        <div class="sethead">Default bot names</div>
        <p class="note">
          What a new table calls its bot seats. Leave one blank and that
          seat is called "Bot 1", "Bot 2" and so on. You can still rename
          any seat in the lobby before a game starts.
        </p>
        ${rows.join("")}
        <div class="row">
          <button id="botnames-save" class="primary">Save names</button>
          <button id="botnames-reset">Reset to Bot 1…${MAX_BOT_NAMES}</button>
        </div>
        <p class="note dim">
          A bot's name decides how it plays: the AI is seeded from it, so
          "Bea" makes the same choices in the same spots every game, and
          renaming a bot gives it a different personality. Leaderboard
          standings are kept per name too.
        </p>
        ${this.botNameError ? `<p class="err">${esc(this.botNameError)}</p>` : ""}
      </div>`;
  }

  /**
   * Your saved decks. Shown on the Profile screen because that is where
   * "things that are yours" live — but they are CHOSEN from the deck
   * panel, which serves the new-game screen and the lobby through one code
   * path, so a deck saved here is available everywhere a deck is picked.
   */
  private deckLibrary(): string {
    const decks = loadDecks();
    return `
      <div class="supported deckstore">
        <div class="sethead">Your decks</div>
        <p class="note">
          Saved in this browser. Pick one from the deck panel when you
          start or join a game. Add a deck by pasting a list there and
          giving it a name.
        </p>
        ${
          decks.length === 0
            ? `<p class="note dim">No saved decks yet.</p>`
            : `<div class="seats">${decks
                .map((d) => {
                  // Re-derived on every read, never stored: a deck saved
                  // today can stop being legal tomorrow as the pool moves.
                  const s = deckSummary(d.source);
                  return `<div class="lobbyrow">
                    <span class="lname">${esc(d.name)}</span>
                    <span class="ldeck ${s.ok ? "ready" : ""}">${esc(s.detail)}</span>
                    ${s.hash ? `<span class="dhash" title="deck fingerprint">${esc(s.hash)}</span>` : ""}
                    <button class="deckrename" data-deck="${esc(d.name)}">Rename</button>
                    <button class="deckdelete danger" data-deck="${esc(d.name)}">Delete</button>
                  </div>`;
                })
                .join("")}</div>`
        }
        ${this.deckImporter()}
        ${this.deckError ? `<p class="err">${esc(this.deckError)}</p>` : ""}
      </div>`;
  }

  /**
   * Paste a deck list and keep it, without being in a game.
   *
   * The importer used to exist only inside the deck panel, which is only
   * reachable from a seat — so building a collection meant starting a game
   * you did not want (owner request 2026-09-06). It writes through the
   * same `saveDeck` the panel uses, so a deck added here is the same
   * object, in the same store, and appears at the top of every deck panel.
   *
   * `data-i="-1"` is deliberately not a seat: the save handler reads the
   * boxes by that index and never touches `this.table`.
   */
  private deckImporter(): string {
    return `
      <div class="sethead">Add a deck</div>
      <p class="note">
        Paste a list from VDB, Amaranth, ARDB, JOL, Lackey or the TWD
        archive. Unknown or unimplemented cards are reported, never dropped.
      </p>
      <textarea class="pastebox" data-i="-1" rows="6"
                placeholder="2x Blood Doll&#10;..."></textarea>
      <div class="row">
        <input class="deckname" data-i="-1" maxlength="${MAX_DECK_NAME}"
               placeholder="My Malkavian deck" />
        <button class="decksave primary" data-i="-1">Save to my decks</button>
      </div>`;
  }

  // --- menu ----------------------------------------------------------------

  private menuScreen(): string {
    return `
      <div class="menuwrap">
        <!--
          The title art replaces the <h1>, rather than sitting above it:
          it says the same words, and two titles would be one too many.
          Alt text carries the name for anyone the picture does not reach.

          It sits OUTSIDE the card (owner: "the banner needs to be this
          big"), because the card is a 520px column and the art wants the
          window. So the menu is a wrapper: art at the full width above,
          buttons in their card below.
        -->
        <img class="banner" src="${bannerUrl}" alt="Vampire: The Eternal Struggle" />
      ${this.removedBanner()}
      <div class="card menu">
        <p class="note">Playing as <b>${esc(this.profile?.name ?? "")}</b></p>
        <div class="menubuttons">
          <button id="m-host" class="primary">Host a game</button>
          <button id="m-join">Join a game</button>
          <button id="m-profile">Profile</button>
          <button id="m-leaderboard">Leaderboard</button>
          <button id="m-exit">Exit</button>
        </div>
        <p class="note dim">
          A table with no open seats is <b>private</b> — it plays entirely on
          this machine, with bots. Open a seat and others can join with a
          room code.
        </p>
      </div>
      <!--
        THE DARK PACK LINE, on the first screen everybody sees.

        The full notice has always been in How to Play, which is a modal a
        visitor has to go looking for. That was fine while this ran on the
        owner's machine; published, the attribution should be where it can
        be read without hunting for it — this is a non-commercial fan work
        under Paradox's Dark Pack, and the card data and scans are KRCG's.
        The long form stays in the panel, with the full copyright text.
      -->
      <p class="attribution">
        A non-commercial fan project under the <b>Dark Pack</b> agreement.
        Portions are the copyrights and trademarks of Paradox Interactive AB,
        used with permission — <b>worldofdarkness.com</b>.
        Card data and scans from <b>KRCG</b>. Full credits in
        <b>❔ How to Play</b>.
      </p>
      <!--
        The build people can point at in a bug report (owner request
        2026-09-07). Under the copyright line and smaller than it: it is
        the least important thing on the screen and should look it, but a
        report that names a version is worth several that do not.
      -->
      <p class="version">${esc(PLATFORM_VERSION_LABEL)}</p>
      </div>`;
  }

  // --- new game ------------------------------------------------------------

  /**
   * THE TABLE — one screen, whether the game is private or online.
   *
   * There used to be two: a "new game" screen where you built the table,
   * and a separate lobby you were thrown to the moment a seat went online
   * (owner-reported 2026-09-06, "it goes to a second page"). They showed
   * the same thing — who is sitting where, with what deck, and why the
   * game cannot start — so they are one screen now, and opening a seat
   * adds a room code to it rather than replacing it.
   *
   * Three cases share it: a private table, a host's online table, and a
   * guest's view of somebody else's. The difference is only ever WHICH
   * BOX you may touch, which is the `mine` flag on each.
   */
  private lobbyScreen(): string {
    const host = this.lobbyHost;
    const guest = this.lobbyPeer?.state ?? null;
    // A GUEST WHOSE LOBBY HAS NOT ARRIVED YET IS STILL A GUEST. Falling
    // through to the host layout here drew somebody else's table with
    // THIS client's default seats and a live Start button — a button that
    // would deal a private game on their machine. `state` is null in a
    // real window: between `join` and the host's first `lobby` message.
    if (this.lobbyPeer && !guest) {
      return `<div class="card"><h1>Joining…</h1>
        <p class="note">Waiting for the host to send the table.</p>
        <div class="row"><button id="ng-back">Leave</button></div></div>`;
    }
    const build = buildTable(this.table);
    const precons = supportedPrecons().filter((p) => p.playable);
    const code = host?.code ?? guest?.code ?? "";
    const online = code !== "" || isOnlineTable(this.table);
    const problems = guest ? guest.problems : build.problems.map((p) => (p.seat ? `${p.seat}: ${p.problem}` : p.problem));
    const canStart = guest ? false : build.setup !== null;

    const boxes = guest
      ? guest.seats.map((s, i) => this.guestBox(s, i, precons))
      : this.table.seats.map((s, i) => this.seatBox(s, i, precons));

    return `
      <div class="card wide fit">
        <h1>${guest ? "Waiting to start" : "Your table"}</h1>
        <p class="note">
          The rulebook is written for <b>${RECOMMENDED_SEATS.join(" or ")} players</b>
          (p. 1); ${MIN_SEATS} to ${MAX_SEATS} will play.
        </p>
        ${online ? this.roomBar(code) : `<p class="note">
          Nobody is joining over the network yet. Set a seat to
          <b>Open (online)</b> and a room code appears here.
        </p>`}
        ${this.error ? `<p class="err">${esc(this.error)}</p>` : ""}

        <!--
          TWO COLUMNS: the table on the left, the conversation on the right
          in its own column (owner request). The chat was a full-width band
          between the seats and the Start button, which put a scrolling
          list in the middle of a form; beside it, it can be as tall as the
          card without pushing anything down.
        -->
        <div class="lobbycols">
          <div class="lobbymain">
            <div class="seatgrid">
              ${boxes.join("")}
              ${
                // The + box. Only the host adds seats, and only up to the
                // engine's ceiling; a guest is a visitor at somebody's table.
                !guest && this.table.seats.length < MAX_SEATS
                  ? `<button class="seatbox addbox" id="seat-add" title="add a seat">
                       <span class="plus">+</span><span class="note">add a player</span>
                     </button>`
                  : ""
              }
            </div>

            ${
              problems.length > 0
                ? `<div class="problems"><b>Not ready to start:</b><ul>${problems
                    .map((p) => `<li>${esc(p)}</li>`)
                    .join("")}</ul></div>`
                : `<p class="ok">Ready — ${(guest ? guest.seats.length : this.table.seats.length)} seats.</p>`
            }
            ${this.spectators > 0 ? `<p class="note">${this.spectators} watching.</p>` : ""}
            ${this.seatingNote()}
          </div>
          <aside class="lobbychat">${this.chatPanel()}</aside>
        </div>

        <div class="row">
          ${guest ? "" : `<button id="start" class="primary" ${canStart ? "" : "disabled"}>Start game</button>`}
          <button id="ng-back">${online ? (guest ? "Leave" : "Close table") : "Back"}</button>
        </div>
        ${this.setsNote()}
      </div>
      ${
        // THE DECK PICKER IS A POP-UP (owner request), not a panel that
        // unfolds inside a seat box. It carries your saved decks, 18
        // precons across seven sets and a paste box, which is several
        // times a seat box tall — inside one it stretched that column and
        // left the others empty beside it. As a modal it is the size it
        // wants to be and the grid never moves.
        this.editingDeck !== null && this.editingDeck >= 0
          ? this.deckModal(this.editingDeck, precons)
          : ""
      }`;
  }

  /** The deck picker, over the screen rather than inside a box. Same
   *  chrome as the in-game settings dialog, which is what it is. */
  private deckModal(i: number, precons: PreconSummary[]): string {
    return `
      <div class="scrim" id="deck-scrim"></div>
      <div class="modal deckmodal" role="dialog" aria-label="Choose a deck">
        <div class="modalcard">
          <h2>Choose a deck</h2>
          ${this.deckPanel(i, precons)}
        </div>
      </div>`;
  }

  private roomBar(code: string): string {
    const link = joinLink(code, location.href.split("#")[0] ?? location.href);
    return `
      <div class="roombox">
        <div>
          <div class="roomlabel">Room code</div>
          <div class="roomcode">${esc(code || "…")}</div>
        </div>
        <div class="row">
          <button id="copy-code" ${code ? "" : "disabled"}>Copy code</button>
          <button id="copy-link" data-link="${esc(link)}" ${code ? "" : "disabled"}>Copy join link</button>
        </div>
      </div>
      <p class="note">Send either one to the people you want to play with.</p>`;
  }

  /**
   * Who sits either side of a seat (p. 15): your prey is on your left, your
   * predator on your right, and the table is a CYCLE — so this is a
   * rotation of the seat list, not a lookup with an edge case at each end.
   * Shown small and unbolded next to the name because it is orientation,
   * not identity.
   */
  /**
   * SEATING IS NOT DECIDED HERE (owner request).
   *
   * This used to name each seat's prey and predator from its row in the
   * lobby, which quietly made the lobby the seating chart: taking the
   * third box meant choosing your predator, and people could see who
   * they were about to be fed to before anybody had committed to a deck.
   * Who sits where is now shuffled when the game is dealt
   * (`GameSetup.randomSeating`), so there is nothing true to say until
   * then — and saying nothing would look like an omission, so the lobby
   * says so instead.
   */
  private seatingNote(): string {
    return `<p class="note dim">
      Seating is drawn at random when the game starts — the order of these
      boxes is not the order of the table, and nobody's prey or predator
      is decided until then.
    </p>`;
  }

  /** One box on the host's (or a private table's) grid. */
  private seatBox(seat: SeatConfig, i: number, precons: PreconSummary[]): string {
    // THE FIRST BOX IS ALWAYS THE HOST. They cannot hand their own seat to
    // a bot or open it to the network without ceasing to be the host, so
    // the control is not offered rather than being offered and refused.
    const isHost = i === 0;
    // A seat a guest holds is theirs: they brought that deck and that name.
    const remote = seat.kind === "remote";
    const deckLabel =
      seat.deck === null
        ? "choose a deck"
        : seat.deck.kind === "precon"
          ? `${seat.deck.name} — ${seat.deck.set}`
          : "pasted deck list";
    const hash = seatDeckHash(seat);
    return `
      <div class="seatbox ${isHost ? "host" : ""} ${remote ? "remote" : ""}" data-i="${i}">
        ${
          isHost || remote
            ? ""
            : `<button class="seatx" data-i="${i}" title="remove this seat">&times;</button>`
        }
        <div class="sbhead">
          ${lobbyFace(seat.name, isHost ? (this.profile?.avatar ?? null) : (seat.avatar ?? null), seat.kind === "ai")}
          <div class="sbname">
            ${
              isHost || remote
                ? `<span class="lname">${esc(seat.name)}${isHost ? " (you)" : ""}</span>`
                : `<input class="seatname" data-i="${i}" value="${esc(seat.name)}"
                          maxlength="${MAX_NAME_LENGTH}" />`
            }
          </div>
        </div>
        ${
          isHost
            ? `<div class="sbkind">Host</div>`
            : remote
              ? `<div class="sbkind">Player (joined)</div>`
              : `<select class="seatkind" data-i="${i}">
                   <option value="ai" ${seat.kind === "ai" ? "selected" : ""}>Bot</option>
                   <option value="open" ${seat.kind === "open" ? "selected" : ""}>Open (online)</option>
                 </select>`
        }
        ${
          // The host owns their own deck and the bots'. A seat a person
          // joined on is not the host's to change.
          remote
            ? `<span class="ldeck ${seat.deck ? "ready" : ""}">${esc(
                seat.deck ? deckLabel : "no deck yet",
              )}</span>`
            : `<button class="deckbtn" data-i="${i}">${esc(deckLabel)}</button>`
        }
        ${hash ? `<span class="dhash" title="deck fingerprint">${esc(hash)}</span>` : ""}
      </div>`;
  }

  /** One box as a GUEST sees it: read-only, except their own. */
  private guestBox(s: LobbySeat, i: number, precons: PreconSummary[]): string {
    return `
      <div class="seatbox ${s.mine ? "mine" : ""}" data-i="${i}">
        <div class="sbhead">
          ${lobbyFace(s.name, s.avatar ?? null, s.kind === "ai")}
          <div class="sbname">
            ${
              s.mine
                ? `<input id="guest-name" value="${esc(s.name)}" maxlength="${MAX_NAME_LENGTH}" />`
                : `<span class="lname">${esc(s.name)}</span>`
            }
          </div>
        </div>
        <div class="sbkind">${
          s.kind === "ai" ? "Bot" : s.kind === "open" ? "waiting for a player" : "Player"
        }</div>
        ${
          s.mine
            ? `<button class="deckbtn" data-i="0">${esc(s.deck ?? "choose a deck")}</button>`
            : `<span class="ldeck ${s.deck ? "ready" : ""}">${esc(s.deck ?? "no deck yet")}</span>`
        }
        ${s.deckHash ? `<span class="dhash" title="deck fingerprint">${esc(s.deckHash)}</span>` : ""}
      </div>`;
  }

  /**
   * The conversation. Same panel in the lobby and at the table, reading
   * one module-level store, which is what makes it survive the handover
   * (src/ui/chat.ts).
   */
  private chatPanel(): string {
    // The LINES come from `render.ts` so the lobby and the table draw a
    // name the same way — one place decides what a coloured name looks
    // like, and the conversation does not change appearance when the game
    // starts.
    return `
      <div class="chatbox">
        <div class="sethead">Table chat
          <button id="chat-gear" class="chatgear" title="Chat settings">⚙</button>
        </div>
        <!-- THE SAME CONTROL THE TABLE DRAWS, with its OK/Cancel. The
             lobby had its own copy, which is how one of the two ends up
             fixed and the other does not. -->
        ${chatSettings(this.profile?.chatColor ?? DEFAULT_CHAT_COLOR, this.chatSettingsOpen)}
        ${chatLinesMarkup()}
        <!--
          THE SAME PICKER THE TABLE DRAWS, not a second copy of it. Both
          screens had their own inline copy of a flat emoji list, which is
          how a control ends up different in two places nobody compares.
        -->
        ${this.emojiOpen ? emojiPad(this.emojiCategory) : ""}
        <div class="row">
          <input id="chatinput" maxlength="${MAX_CHAT_TEXT}" placeholder="Say something…" />
          <button id="chatemoji" title="Emoji">🙂</button>
          <button id="chatsend">Send</button>
        </div>
      </div>`;
  }

  /** The chat's own gear panel and emoji pad — pure view state, like every
   *  other client preference: never in the command log. */
  private chatSettingsOpen = false;
  private emojiOpen = false;
  /** Which emoji tab is showing. View state, like the pad itself. */
  private emojiCategory: string = DEFAULT_EMOJI_CATEGORY;
  private deckPanel(i: number, precons: PreconSummary[]): string {
    const bySet = new Map<string, PreconSummary[]>();
    for (const p of precons) bySet.set(p.set, [...(bySet.get(p.set) ?? []), p]);
    // Your own decks come FIRST. This panel serves the new-game screen and
    // a guest in a lobby through one code path, so saving a deck once puts
    // it everywhere a deck is chosen — which is the point of a library.
    const saved = loadDecks();
    return `
      <div class="deckpanel">
        ${
          saved.length > 0
            ? `<div class="sethead">Your decks</div>
               <div class="preconset">
                 ${saved
                   .map((d) => {
                     const s = deckSummary(d.source);
                     return `<button class="mydeck ${s.ok ? "" : "broken"}"
                                     data-i="${i}" data-deck="${esc(d.name)}"
                                     ${s.ok ? "" : "disabled"}
                                     title="${esc(s.detail)}">${esc(d.name)}</button>`;
                   })
                   .join("")}
               </div>`
            : ""
        }
        <div class="sethead">Preconstructed decks</div>
        ${[...bySet.entries()]
          .map(
            ([set, list]) => `<div class="preconset"><span class="dim">${esc(set)}</span>
              ${list
                .map((p) => {
                  // The play-style line is the button's tooltip AND its
                  // second line: a player choosing blind should be able
                  // to tell a combat deck from a vote deck without
                  // opening 60 cards.
                  const style = preconStyle(p.name);
                  return `<button class="precon" data-i="${i}" data-set="${esc(p.set)}"
                                  data-name="${esc(p.name)}" title="${esc(style ?? p.name)}">
                            <span class="pname">${esc(p.name)}</span>
                            ${style ? `<span class="pstyle">${esc(style)}</span>` : ""}
                          </button>`;
                })
                .join("")}</div>`,
          )
          .join("")}
        <div class="sethead">…or paste a deck list</div>
        <p class="note">
          From VDB, Amaranth, ARDB, JOL, Lackey or the TWD archive — any of
          their text exports. Unknown or unimplemented cards are reported,
          never dropped.
        </p>
        <textarea class="pastebox" data-i="${i}" rows="6"
                  placeholder="2x Blood Doll&#10;..."></textarea>
        <div class="row">
          <button class="pasteuse primary" data-i="${i}">Use this list</button>
          <button class="deckclose" data-i="${i}">Close</button>
        </div>
        <div class="sethead">…or keep it</div>
        <p class="note">
          Save the pasted list under a name and it appears at the top of
          this panel every time — here, and in a lobby.
        </p>
        <div class="row">
          <input class="deckname" data-i="${i}" maxlength="${MAX_DECK_NAME}"
                 placeholder="My Malkavian deck" />
          <button class="decksave" data-i="${i}">Save to my decks</button>
        </div>
        ${this.deckError ? `<p class="err">${esc(this.deckError)}</p>` : ""}
      </div>`;
  }

  private setsNote(): string {
    return `
      <details class="supported">
        <summary>What this client can play</summary>
        <p class="note"><b>Sets:</b> ${supportedSets().map(esc).join(", ")}.</p>
        <p class="note">
          <b>Precon decks:</b>
          ${supportedPrecons().filter((p) => p.playable).length} playable as printed.
          The New Blood starters are half decks by design and need combining
          before they are legal (${MIN_SEATS === 2 ? "p. 14" : "p. 14"}).
        </p>
      </details>`;
  }

  // --- lobby (hosting, and joined) -----------------------------------------

  /**
   * One screen for both sides of a lobby. The host's has a Start button
   * and the guests' does not; everything else — the code, who is here,
   * what is missing — is the same information, because it is the same
   * information (docs/lobby-design.md §3).
   */
  private joinScreen(): string {
    return `
      <div class="card">
        <h1>Join a game</h1>
        <p class="note">
          Type the room code the host gave you. There is no list of public
          rooms — this client has no server to keep one, so a code or a link
          is how you find a table.
        </p>
        <label class="field">
          <span>Room code</span>
          <input id="joincode" value="${esc(this.joinCode)}" placeholder="K7M2QP"
                 autocomplete="off" spellcheck="false" />
        </label>
        <label class="toggle">
          <input type="checkbox" id="spectate" ${this.wantSpectate ? "checked" : ""} />
          Watch instead of playing
        </label>
        <p class="note">
          A spectator takes no seat and is sent the table with
          <b>every hand face down</b> — including the ones the players can
          read. There is nothing for them to answer and nothing of anyone's
          to see.
        </p>
        ${this.busy ? `<p class="note">${esc(this.busy)}</p>` : ""}
        ${this.error ? `<p class="err">${esc(this.error)}</p>` : ""}
        <div class="row">
          <button id="dojoin" class="primary" ${this.busy ? "disabled" : ""}>Join</button>
          <button id="join-back">Back</button>
        </div>
      </div>`;
  }

  // --- leaderboard ---------------------------------------------------------

  private leaderboardScreen(): string {
    const results = loadResults();
    const table = standings(results);
    return `
      <div class="card wide">
        <h1>Leaderboard</h1>
        <p class="note">
          Games finished on <b>this device</b> — there is no server to
          share them with, which is the same reason your profile is local.
        </p>
        ${
          table.length === 0
            ? `<p class="note dim">
                 No finished games yet. A game counts when it ends: the
                 last Methuselah standing, or the turn cap.
               </p>`
            : `<table class="lbtable">
                 <!--
                   THE STANDINGS ARE A TALLY, and a tally is one row per
                   person. The decks came out of here (owner request) —
                   a player brings a different deck most games, so the
                   column was a growing list stapled to a number, and it
                   made the one thing this table is for harder to read.
                   Which deck was played WHEN is a fact about a game, and
                   it lives in the log below.
                 -->
                 <thead><tr>
                   <th>Player</th><th>Games</th><th>Wins</th><th>VP</th>
                 </tr></thead>
                 <tbody>
                   ${table
                     .map(
                       (r) => `<tr class="${r.bot ? "isbot" : ""}">
                         <td>${esc(r.name)}${r.bot ? ` <span class="dim">bot</span>` : ""}</td>
                         <td>${r.games}</td>
                         <td>${r.wins}</td>
                         <td>${r.victoryPoints}</td>
                       </tr>`,
                     )
                     .join("")}
                 </tbody>
               </table>
               ${this.gameHistory(results)}`
        }
        <div class="row">
          <button id="lb-back">Back</button>
          ${results.length > 0 ? `<button id="lb-clear" class="danger">Clear history</button>` : ""}
        </div>
      </div>`;
  }

  /**
   * Every finished game, newest first (owner request 2026-09-07).
   *
   * The standings above answer "who wins"; this answers "what happened" —
   * who was at that table, what each of them brought, and how it ended.
   * They are different questions and the same rows: `loadResults()` has
   * carried all of it since the deck labels were added, and nothing was
   * showing it.
   *
   * Seats are listed in VP order rather than seating order, because the
   * result is the thing being read here. The winner is marked rather than
   * merely being first: a draw has no winner, and top-of-the-list would
   * quietly claim one.
   */
  private gameHistory(results: GameResult[]): string {
    if (results.length === 0) return "";
    return `
      <h2 class="lbhead">Games played</h2>
      <p class="note dim">${results.length} game${results.length === 1 ? "" : "s"} recorded, newest first.</p>
      <div class="gamelist">
        ${results.map((r) => this.gameRow(r)).join("")}
      </div>`;
  }

  private gameRow(r: GameResult): string {
    const seats = [...r.seats].sort(
      (a, b) => b.victoryPoints - a.victoryPoints || a.name.localeCompare(b.name),
    );
    return `
      <div class="gamerow">
        <div class="gamehead">
          <span class="gamedate">${esc(playedOn(r.played))}</span>
          <span class="gamewinner">${
            r.winner ? `${esc(r.winner)} won` : `<span class="dim">a draw</span>`
          }</span>
        </div>
        <table class="lbtable gseats">
          <tbody>
            ${seats
              .map(
                (s) => `<tr class="${s.name === r.winner ? "won" : ""} ${s.bot ? "isbot" : ""}">
                  <td class="gname">
                    ${esc(s.name)}
                    ${s.bot ? `<span class="dim">bot</span>` : ""}
                    ${s.name === r.you ? `<span class="dim">(you)</span>` : ""}
                  </td>
                  <!-- A game recorded before decks were kept has none,
                       and says so rather than claiming something. -->
                  <td class="gdeck">${
                    s.deck ? esc(s.deck) : `<span class="dim">deck not recorded</span>`
                  }</td>
                  <td class="gvp">${s.victoryPoints} VP</td>
                  <td class="gout">${s.ousted ? `<span class="dim">ousted</span>` : ""}</td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
  }

  // --- wiring --------------------------------------------------------------

  private on(sel: string, fn: (el: HTMLElement) => void): void {
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>(sel))) {
      el.addEventListener("click", () => fn(el));
    }
  }

  private wire(): void {
    this.on("#removed-ok", () => {
      this.removedReason = "";
      this.paint();
    });
    this.on("#m-host", () => {
      this.table = this.newTable(this.profile?.name ?? "You");
      // A NEW TABLE STARTS A NEW CONVERSATION (owner request). The chat is
      // a module-level store so that it survives the lobby→table handover
      // (src/ui/chat.ts); the price of that is that it also survives
      // everything else, so the last game's talk was still sitting in the
      // new lobby.
      clearChat();
      this.removedReason = "";
      this.go("newgame");
    });
    this.on("#m-join", () => this.go("join"));
    this.on("#m-profile", () => this.go("profile"));
    this.on("#m-leaderboard", () => this.go("leaderboard"));
    this.on("#lb-back, #pback, #join-back", () => this.go("menu"));
    // Leaving the table screen has to hang up as well as navigate: an
    // online table has a room on the broker and, possibly, people in it.
    this.on("#ng-back", () => {
      if (this.lobbyHost || this.lobbyPeer) {
        if (!confirm("Leave this table?")) return;
      }
      this.closeRoom();
      this.lobbyPeer?.leave();
      this.lobbyPeer = null;
      this.guestChannel = null;
      clearChat();
      this.go("menu");
    });
    this.on("#lb-clear", () => {
      if (!confirm("Delete every recorded result? This cannot be undone.")) return;
      clearResults();
      this.paint();
    });

    // The deck library on the Profile screen.
    this.on(".deckdelete", (el) => {
      const name = el.dataset["deck"] ?? "";
      if (!confirm(`Delete the deck "${name}"?`)) return;
      deleteDeck(name);
      this.deckError = "";
      this.paint();
    });
    this.on(".deckrename", (el) => {
      const from = el.dataset["deck"] ?? "";
      const to = prompt("New name for this deck:", from);
      // Cancelled, or unchanged — not an error, and not a rename.
      if (to === null || to.trim() === from) return;
      this.deckError = renameDeck(from, to) ?? "";
      this.paint();
    });
    this.on("#m-exit", () => {
      // A browser tab cannot reliably close itself, so say so rather than
      // wiring a button that does nothing on most machines.
      this.root.innerHTML = `<div class="shell"><div class="card">
        <h1>Goodbye</h1><p class="note">You can close this tab now.</p></div></div>`;
    });

    this.wireProfile();
    this.wireNewGame();
    this.wireLobby();
    this.wireJoin();
  }

  private wireLobby(): void {
    const copy = (text: string, el: HTMLElement): void => {
      void navigator.clipboard
        ?.writeText(text)
        .then(() => {
          // Say it worked on the button itself. A toast would need a
          // timer and a place to live; this needs neither.
          const was = el.textContent;
          el.textContent = "Copied";
          setTimeout(() => (el.textContent = was), 1200);
        })
        .catch(() => {
          this.error = "this browser would not let the page copy — select it by hand";
          this.paint();
        });
    };
    this.on("#copy-code", (el) => copy(this.lobbyHost?.code ?? this.lobbyPeer?.state?.code ?? "", el));
    this.on("#copy-link", (el) => copy(el.dataset["link"] ?? "", el));

    // Chat. Send on the button or on Enter; a guest SENDS and the host
    // relays, so nothing is added locally and everyone lists one
    // conversation in one order (src/ui/chat.ts).
    const chatBox = this.root.querySelector<HTMLInputElement>("#chatinput");
    const send = (): void => {
      const text = chatBox?.value ?? "";
      if (!chatBox || chatProblem(text)) return;
      chatBox.value = "";
      // SENDING PUTS THE PICKER AWAY (owner request 2026-09-07).
      this.emojiOpen = false;
      const me = this.profile?.name ?? "You";
      const mine = this.profile?.chatColor ?? null;
      if (this.lobbyPeer) this.lobbyPeer.say(text);
      else if (this.lobbyHost) this.lobbyHost.say(text, me, false, mine);
      // A private table has nobody to relay to; it is still a notepad.
      else addChat({ from: me, text, at: Date.now(), ...(mine ? { color: mine } : {}) });
      this.paint();
    };
    this.on("#chatsend", () => send());
    chatBox?.addEventListener("keydown", (ev) => {
      if ((ev as KeyboardEvent).key !== "Enter") return;
      // Enter in the chat SENDS A MESSAGE and does nothing else. Stopped
      // explicitly rather than trusting that no ancestor ever becomes a
      // form or grows a key handler: this box sits on a screen whose other
      // button deals a game, and that is not a mistake to leave to luck.
      ev.preventDefault();
      ev.stopPropagation();
      send();
    });
    // The chat's own settings and the emoji pad. Both are view state, and
    // the COLOUR is written to the profile — the same value the profile
    // page edits, so the two controls cannot disagree.
    this.on("#chat-gear", () => {
      this.chatSettingsOpen = !this.chatSettingsOpen;
      this.paint();
    });
    this.on("#chatemoji", () => {
      this.emojiOpen = !this.emojiOpen;
      this.paint();
    });
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>(".emojitab"))) {
      el.addEventListener("click", () => {
        this.emojiCategory = el.dataset["emojicat"] ?? DEFAULT_EMOJI_CATEGORY;
        this.paint();
      });
    }
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>(".emoji"))) {
      el.addEventListener("click", () => {
        if (!chatBox) return;
        // At the caret, not appended: a face added mid-sentence belongs
        // where the player put it.
        const at = chatBox.selectionStart ?? chatBox.value.length;
        const end = chatBox.selectionEnd ?? at;
        const emoji = el.dataset["emoji"] ?? "";
        chatBox.value = chatBox.value.slice(0, at) + emoji + chatBox.value.slice(end);
        chatBox.focus();
        chatBox.setSelectionRange(at + emoji.length, at + emoji.length);
      });
    }
    // THE COLOUR IS COMMITTED BY A BUTTON, and nothing repaints before
    // that. Chrome's colour well is a popover anchored to the input, and
    // repainting on `input` — as the player drags around the colour field
    // — tore that element out from under it, so the picker shut the
    // moment it was touched (owner report 2026-09-07).
    const colorBox = this.root.querySelector<HTMLInputElement>("#chatcolor");
    this.on("#chatcolor-ok", () => {
      if (colorBox) this.applyChatColor(colorBox.value);
      this.chatSettingsOpen = false;
      this.paint();
    });
    this.on("#chatcolor-cancel", () => {
      // Nothing was applied on the way in, so cancelling is just closing.
      this.chatSettingsOpen = false;
      this.paint();
    });

    // Keep the newest line in view after a repaint.
    const lines = this.root.querySelector<HTMLElement>("#chatlines");
    if (lines) lines.scrollTop = lines.scrollHeight;

    // Renaming yourself. On BLUR, not per keystroke: every repaint rebuilds
    // the markup, and re-rendering under the caret would throw the player
    // out of the box they are typing in (the same rule the seat rows on
    // the new-game screen follow). The host has the last word on the name,
    // and says so in the next broadcast.
    const nameBox = this.root.querySelector<HTMLInputElement>("#guest-name");
    nameBox?.addEventListener("blur", () => {
      const wanted = nameBox.value.trim();
      const problem = nameProblem(wanted);
      if (problem) {
        this.error = problem;
        this.paint();
        return;
      }
      if (wanted !== this.lobbyPeer?.state?.you) this.lobbyPeer?.setName(wanted);
    });

    // The HOST may still change a seat they own while people are arriving
    // — a bot's deck, or turning a bot into another open seat. A seat a
    // guest holds is not editable: they brought that deck.
    if (this.lobbyHost) this.spectators = this.lobbyHost.spectatorCount;
  }

  private wireJoin(): void {
    const box = this.root.querySelector<HTMLInputElement>("#joincode");
    box?.addEventListener("input", () => (this.joinCode = box.value));
    const spec = this.root.querySelector<HTMLInputElement>("#spectate");
    spec?.addEventListener("change", () => (this.wantSpectate = spec.checked));
    this.on("#dojoin", () => {
      const code = normaliseRoomCode(this.joinCode);
      if (!isRoomCode(code)) {
        this.error = "that does not look like a room code";
        this.paint();
        return;
      }
      void this.join(code);
    });
  }

  private wireProfile(): void {
    const nameInput = this.root.querySelector<HTMLInputElement>("#pname");
    const file = this.root.querySelector<HTMLInputElement>("#pavatar");
    let avatar = this.profile?.avatar ?? null;

    file?.addEventListener("change", () => {
      const f = file.files?.[0];
      if (!f) return;
      void shrinkImage(f)
        .then((uri) => {
          avatar = uri;
          const slot = this.root.querySelector<HTMLElement>(".avatar");
          if (slot) slot.innerHTML = `<img src="${esc(uri)}" alt="" />`;
        })
        .catch((err: unknown) => {
          this.error = `could not read that image: ${(err as Error).message}`;
          this.paint();
        });
    });

    this.on("#psave", () => {
      const name = nameInput?.value ?? "";
      const problem = nameProblem(name);
      if (problem) {
        this.error = problem;
        this.paint();
        return;
      }
      const colorInput = this.root.querySelector<HTMLInputElement>("#pcolor");
      const profile = {
        ...newProfile(name, avatar, colorInput?.value ?? this.profile?.chatColor ?? null),
        created: this.profile?.created ?? new Date().toISOString(),
      };
      const failed = saveProfile(profile);
      if (failed) {
        this.error = failed;
        this.paint();
        return;
      }
      this.profile = profile;
      this.table = this.newTable(profile.name);
      this.go("menu");
    });

    this.on("#pclear", () => {
      clearProfile();
      this.profile = null;
      // The draft is the deleted profile's name — `go("profile")` does not
      // clear it, because it is not leaving the screen. Keeping it would
      // put the name straight back in the box of a profile just deleted.
      this.profileDraft = null;
      this.go("profile");
    });

    this.wireSavedGames();
    this.wireBotNames();
  }

  private wireSavedGames(): void {
    this.on(".saveload", (el) => {
      const slot = findSave(el.dataset["save"] ?? "");
      if (!slot) {
        // It was on screen a moment ago, so this is a second tab or a
        // stale click rather than a mistake. Repaint and say so.
        this.saveError = "that save is no longer there";
        this.paint();
        return;
      }
      this.loadSavedGame(slot.game);
    });

    this.on(".savekeep", () => {
      const name = prompt("Keep this game as:", "");
      if (name === null) return; // cancelled — not an error
      this.saveError = keepAuto(name) ?? "";
      this.paint();
    });

    this.on(".saverename", (el) => {
      const id = el.dataset["save"] ?? "";
      const from = findSave(id);
      if (!from) return;
      const to = prompt("New name for this save:", from.name);
      if (to === null || to.trim() === from.name) return;
      this.saveError = renameSave(id, to) ?? "";
      this.paint();
    });

    this.on(".savedelete", (el) => {
      const id = el.dataset["save"] ?? "";
      const slot = findSave(id);
      if (!slot) return;
      // A DELETED GAME IS GONE — there is no backend and no second copy,
      // so this is one of the few places a confirm is genuinely earned.
      if (!confirm(`Delete the saved game "${slot.name}"?`)) return;
      deleteSave(id);
      this.saveError = "";
      this.paint();
    });

    this.on("#save-file", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json";
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) return;
        void readSaveFile(file)
          .then((game) => this.loadSavedGame(game))
          .catch((err: unknown) => {
            this.saveError = (err as Error).message;
            this.paint();
          });
      });
      input.click();
    });
  }

  private wireBotNames(): void {
    this.on("#botnames-save", () => {
      const boxes = Array.from(
        this.root.querySelectorAll<HTMLInputElement>("input.botname"),
      );
      const names: string[] = [];
      for (const box of boxes) {
        const problem = botNameProblem(box.value);
        if (problem) {
          this.botNameError = `Bot ${box.dataset["bot"] ?? "?"}: ${problem}`;
          this.paint();
          return;
        }
        names.push(box.value.trim());
      }
      // TWO BOTS CANNOT SHARE A NAME. A seat name is the engine's seat id,
      // so a duplicate is a table that will not deal — `buildTable` does
      // catch it, but it catches it at Start, on a screen that cannot fix
      // it. Blanks are exempt: they are not names, they are gaps that
      // become "Bot 3" and "Bot 4".
      const filled = names.filter((n) => n !== "").map((n) => n.toLowerCase());
      const clash = filled.find((n, i) => filled.indexOf(n) !== i);
      if (clash) {
        this.botNameError = `two bots cannot both be called "${clash}"`;
        this.paint();
        return;
      }
      const settings = loadSettings();
      settings.botNames = names;
      saveSettings(settings);
      this.botNameError = "";
      // A TABLE ALREADY BUILT DOES NOT RENAME ITSELF. `this.table` was
      // made when the shell booted, and the player is looking at a screen
      // that says what the NEXT table will be called — so rebuild it now,
      // or Host would open a lobby still showing the old names and the
      // setting would look like it had not taken (a feature that cannot
      // be seen is indistinguishable from one that is absent). Only when
      // there is no live lobby: renaming seats out from under people who
      // have joined is not what this button says it does.
      if (!this.lobbyHost && !this.lobbyPeer) {
        this.table = this.newTable(this.profile?.name ?? "You");
      }
      this.paint();
    });

    this.on("#botnames-reset", () => {
      const settings = loadSettings();
      settings.botNames = [];
      saveSettings(settings);
      this.botNameError = "";
      if (!this.lobbyHost && !this.lobbyPeer) {
        this.table = this.newTable(this.profile?.name ?? "You");
      }
      this.paint();
    });
  }

  /**
   * Pick a saved game back up.
   *
   * The commands go to the transport, which replays them into a fresh
   * engine — the same operation as undo, and the reason a save is a setup
   * plus a command log rather than a snapshot of the state (architecture
   * principle 2).
   *
   * `this.table` is rebuilt from the save because the TABLE is what the
   * mats read: `seatFaces`, `mySeat` and `deckLabels` all go through it,
   * and left describing the lobby's table a loaded game would show the
   * wrong names on every mat and hand the local player the wrong seat.
   */
  private loadSavedGame(game: SavedGame): void {
    const bots = botSeatsFor(game, this.profile?.name ?? null);
    // THE GUESS IS SAID OUT LOUD. A save from before `botSeats` existed —
    // an older file, or the slot adopted from the single-slot key — does
    // not record who the bots were, and `botSeatsFor` assumes every seat
    // but yours. That is right for a private table and wrong for a
    // hotseat one, and handing somebody's seat to a bot without saying so
    // is the kind of thing that gets reported as "it played my turn".
    //
    // Asked HERE rather than on the row, because there are two ways in
    // (a slot and a file) and only one of them has a row.
    if (bots.assumed && bots.seats.length > 0) {
      const ok = confirm(
        `This game was saved before bot seats were recorded, so it does ` +
          `not say who the bots were.\n\n` +
          `Loading it will hand ${bots.seats.join(", ")} to the AI, and ` +
          `leave you the rest.\n\nLoad it anyway?`,
      );
      if (!ok) return;
    }
    const botSet = new Set(bots.seats);
    const seatNames = game.setup.decks.map((d) => d.seat);
    this.table = {
      seats: seatNames.map((name) => ({
        name,
        kind: botSet.has(name) ? ("ai" as const) : ("you" as const),
        // The save holds RESOLVED deck lists, not the precon or the pasted
        // text they came from, so there is no source to name. Null rather
        // than a guessed label: the leaderboard's deck column would rather
        // say nothing than say the wrong deck.
        deck: null,
      })),
      seed: game.setup.seed,
      maxTurns: game.setup.maxTurns,
      privateGame: true,
    };
    const transport = new LocalTransport({
      setup: game.setup,
      commands: game.commands,
      log: new GameLog(new DevServerSink(), game.setup),
      onResult: (r) => {
        this.pendingResult = r;
      },
      deckLabels: this.deckLabels(),
      aiDelayMs: loadSettings().aiDelayMs,
      // NO OPENING BEAT. That pause exists so a fresh deal does not open
      // on a board the bots have already played; a load lands mid-game,
      // where a hold before the next move reads as the load having hung.
      // `restart` makes the same distinction, for the same reason.
    });
    for (const seat of bots.seats) {
      transport.setAgent(seat, new HeuristicAgent({ seed: seatSeed(seat) }));
    }
    this.saveError = "";
    this.toTable(transport);
  }

  private wireNewGame(): void {
    const seatAt = (el: HTMLElement): number => Number(el.dataset["i"] ?? "-1");

    for (const el of Array.from(this.root.querySelectorAll<HTMLInputElement>(".seatname"))) {
      el.addEventListener("input", () => {
        const seat = this.table.seats[seatAt(el)];
        if (seat) seat.name = el.value;
      });
      // Repaint on blur rather than on every keystroke: re-rendering here
      // would take the caret out of the box the player is typing in.
      el.addEventListener("blur", () => this.paint());
    }
    for (const el of Array.from(this.root.querySelectorAll<HTMLSelectElement>(".seatkind"))) {
      el.addEventListener("change", () => {
        const seat = this.table.seats[seatAt(el)];
        if (seat) seat.kind = el.value as SeatConfig["kind"];
        // Opening a seat opens the ROOM, here and now — the code belongs
        // on this screen, next to the seats, rather than on a page the
        // host is thrown to when they press Start.
        this.syncRoom();
        // In a lobby the change has to reach everyone waiting, not just
        // this screen — they are being told why the game cannot start.
        this.lobbyHost?.update(this.table);
        this.paint();
      });
    }

    this.on(".deckbtn", (el) => {
      const i = seatAt(el);
      this.editingDeck = this.editingDeck === i ? null : i;
      this.paint();
    });
    this.on(".deckclose", () => {
      this.editingDeck = null;
      this.paint();
    });
    // Clicking away from a modal closes it — the settings dialog's own
    // behaviour, and the reason the picker reuses its chrome.
    this.on("#deck-scrim", () => {
      this.editingDeck = null;
      this.paint();
    });
    // The deck panel serves both the new-game table and a guest in a
    // lobby. A guest SENDS their choice — they have no local table to
    // write it into, and the host is the one that validates it.
    const chooseDeck = (i: number, deck: DeckSource): void => {
      if (this.lobbyPeer) this.lobbyPeer.setDeck(deck);
      else {
        const seat = this.table.seats[i];
        if (seat) seat.deck = deck;
        this.lobbyHost?.update(this.table);
      }
      this.editingDeck = null;
      this.paint();
    };

    this.on(".precon", (el) =>
      chooseDeck(seatAt(el), {
        kind: "precon",
        set: el.dataset["set"] ?? "",
        name: el.dataset["name"] ?? "",
      }),
    );
    this.on(".pasteuse", (el) => {
      const i = seatAt(el);
      const box = this.root.querySelector<HTMLTextAreaElement>(`.pastebox[data-i="${i}"]`);
      if (box) chooseDeck(i, { kind: "paste", text: box.value });
    });

    // Picking one of your own saved decks — the same `chooseDeck` every
    // other source goes through, so a library deck is not a special case
    // anywhere downstream.
    this.on(".mydeck", (el) => {
      const deck = findDeck(el.dataset["deck"] ?? "");
      if (deck) chooseDeck(seatAt(el), deck.source);
    });

    this.on(".decksave", (el) => {
      const i = seatAt(el);
      const box = this.root.querySelector<HTMLTextAreaElement>(`.pastebox[data-i="${i}"]`);
      const nameBox = this.root.querySelector<HTMLInputElement>(`.deckname[data-i="${i}"]`);
      if (!box || !nameBox) return;
      if (box.value.trim() === "") {
        this.deckError = "paste a deck list above first";
        this.paint();
        return;
      }
      this.deckError =
        saveDeck(nameBox.value, { kind: "paste", text: box.value }) ?? "";
      this.paint();
    });

    // The + box.
    this.on("#seat-add", () => {
      if (this.table.seats.length >= MAX_SEATS) return;
      const n = this.table.seats.length;
      // The same `botNameFor` the default table uses, so seat 4 is called
      // whatever the Profile screen says bot 4 is called — and uniquified,
      // because a configured name may already be on the table (a seat
      // renamed by hand, or a duplicate in the list) and a name the app
      // chose must not be one the player is then blamed for.
      const name = uniqueSeatName(
        botNameFor(loadSettings(), n),
        this.table.seats.map((s) => s.name),
      );
      this.table.seats.push({ name, kind: "ai", deck: null });
      this.lobbyHost?.update(this.table);
      this.paint();
    });
    // The red × on a box. Never the host's (index 0) and never a seat a
    // guest is sitting in — the markup does not draw it there, and this
    // refuses it too, because a stale click should not be able to remove
    // somebody who joined in between.
    this.on(".seatx", (el) => {
      const i = seatAt(el);
      const seat = this.table.seats[i];
      if (i <= 0 || !seat || seat.kind === "remote") return;
      if (this.table.seats.length <= MIN_SEATS) {
        this.error = `a table needs at least ${MIN_SEATS} seats`;
        this.paint();
        return;
      }
      this.table.seats.splice(i, 1);
      this.editingDeck = null;
      this.error = "";
      this.syncRoom();
      this.lobbyHost?.update(this.table);
      this.paint();
    });

    this.on("#start", () => this.start());
  }

  /**
   * Start, or open a room and wait for people.
   *
   * Which one is DERIVED from the seats (`isOnlineTable`) rather than from
   * a separate switch, so the choice cannot disagree with the table it
   * describes.
   */
  private start(): void {
    // A GUEST HAS NO START BUTTON, and must never take this path even if
    // one is somehow on screen: they would deal a private game on their
    // own machine while the host went on waiting for them.
    if (this.lobbyPeer) return;
    // THE ROOM BEING OPEN IS THE FACT THAT DECIDES, not what the seats
    // happen to say right now. `isOnlineTable` reads the seat kinds, and a
    // seat's kind changes as people arrive and leave — so a host with a
    // live room could fall through to the private path and start a game
    // that nobody was told about, which is exactly "the online player is
    // still in the lobby and not in the game that's started". The same
    // shape as the `buildTable` fix: a condition written against one
    // instant, applied at another.
    this.table.privateGame = this.lobbyHost === null && !isOnlineTable(this.table);
    if (!this.table.privateGame) {
      // The room is already open — it opened the moment a seat went online
      // — so starting is just starting. This used to be where the host was
      // sent to a second page.
      this.lobbyHost?.start();
      this.paint();
      return;
    }
    const build = buildTable(this.table);
    if (!build.setup) {
      this.paint();
      return;
    }
    const transport = new LocalTransport({
      setup: build.setup,
      log: new GameLog(new DevServerSink(), build.setup),
      // HELD, NOT RECORDED. The row is computed here because this is the
      // only side that sees a game bots finish; whether it counts is the
      // player's answer to the end-of-game prompt (owner request).
      onResult: (r) => {
        this.pendingResult = r;
      },
      deckLabels: this.deckLabels(),
      // THE PACING HAS TO BE LIVE BEFORE THE AGENTS ARE, and it was not.
      // `DebugApp` calls `setAiDelay` — its comment even says "before the
      // agents are attached, so the first AI move is already paced" — but
      // the shell attaches them on the line below, which is BEFORE the
      // table is built. So every bot turn ahead of the first human
      // decision was answered at zero delay, and the game opened on a
      // board they had already played (owner report 2026-09-07). Setting
      // it here is what makes that comment true on this path too.
      aiDelayMs: loadSettings().aiDelayMs,
      openingDelayMs: OPENING_DELAY_MS,
    });
    for (const seat of botSeats(this.table)) {
      transport.setAgent(seat, new HeuristicAgent({ seed: seatSeed(seat) }));
    }
    this.toTable(transport);
  }

  /**
   * Register a room with the broker, ON THE SAME SCREEN.
   *
   * Called when a seat first goes online, not when Start is pressed: the
   * code has to be there to be copied while people are still arriving,
   * which is what made a second page look necessary in the first place.
   * Idempotent — a second open seat does not open a second room.
   */
  private async openRoom(): Promise<void> {
    if (this.lobbyHost) return;
    const code = newRoomCode();
    this.lobbyHost = new LobbyHost(
      code,
      this.table,
      (transport, session) => this.toTable(transport, session),
      // Held until the end-of-game prompt is answered, exactly as on a
      // private table — see `finishGame`.
      (r) => {
        this.pendingResult = r;
      },
    );
    // THE HOST'S OWN SCREEN HAD TO BE TOLD. Every guest already learned
    // through `broadcast`; the host learned nothing, so someone joining,
    // renaming or choosing a deck left this screen showing the state
    // before it (owner-reported 2026-09-06).
    this.lobbyHost.onChanged(() => this.paint());
    this.error = "";
    this.paint();
    try {
      this.room = await hostRoom(code, (channel) => {
        this.lobbyHost?.accept(channel);
        this.paint();
      });
      this.paint(); // the code is real now, so the copy buttons come alive
    } catch (err) {
      this.error = `could not open a room: ${(err as Error).message}`;
      this.lobbyHost = null;
      this.paint();
    }
  }

  /** Open or close the room to match the seats. */
  private syncRoom(): void {
    if (isOnlineTable(this.table)) void this.openRoom();
    else this.closeRoom();
  }

  private closeRoom(): void {
    if (!this.lobbyHost) return;
    this.lobbyHost.close("the host closed the table");
    this.room?.close();
    this.lobbyHost = null;
    this.room = null;
  }

  /** Dial a room and wait in its lobby. */
  private async join(code: string): Promise<void> {
    this.busy = `connecting to ${code}…`;
    this.error = "";
    this.paint();
    try {
      const channel = await joinRoom(code);
      this.guestChannel = channel;
      this.lobbyPeer = new LobbyPeer(
        channel,
        this.profile?.name ?? "Player",
        () => this.guestGameStarted(),
        this.wantSpectate,
        this.profile?.avatar ?? null,
        this.profile?.chatColor ?? null,
      );
      this.lobbyPeer.onChanged(() => {
        // The host may have turned us away rather than seated us.
        const reason = this.lobbyPeer?.closedReason;
        if (reason) {
          this.error = reason;
          this.lobbyPeer = null;
          this.screen = "join";
        }
        this.paint();
      });
      this.busy = "";
      this.screen = "lobby";
      this.paint();
    } catch (err) {
      this.busy = "";
      this.error = (err as Error).message;
      this.paint();
    }
  }

  /** The host started: the same channel now carries the game. */
  private guestGameStarted(): void {
    const spectating = this.lobbyPeer?.spectating ?? false;
    const seat = this.lobbyPeer?.state?.you ?? null;
    const channel = this.guestChannel;
    // A spectator has no seat by definition, so "no seat" is only a
    // problem for someone who came to play.
    if (!channel || (!seat && !spectating)) return;
    // WHAT THE LOBBY KNEW, KEPT. The lobby is about to be dropped, and it
    // is the only thing on this side that ever learned which seats are
    // bots and what deck each one brought — a guest's own leaderboard row
    // needs both, and the game state carries neither.
    this.guestSeats = this.lobbyPeer?.state?.seats ?? [];
    for (const s of this.guestSeats) {
      if (s.kind === "ai") this.guestBots[s.name] = true;
      if (s.deck) this.guestDecks[s.name] = s.deck;
    }
    // The lobby stops reading the stream before the transport starts, or
    // two objects would be listening to one connection.
    this.lobbyPeer?.detach();
    this.lobbyPeer = null;
    const transport = new PeerTransport(
      channel,
      spectating ? null : seat,
      this.profile?.name ?? undefined,
      this.profile?.chatColor ?? null,
    );
    // A peer has no state to render until the host's first sync arrives.
    const off = transport.onChanged(() => {
      if (!transport.connected) return;
      off();
      this.toTable(transport);
    });
  }

  /** Hand the root over to the table. The shell paints nothing after this. */
  private toTable(transport: LocalTransport | PeerTransport, session?: HostSession): void {
    this.screen = "table";
    this.tableTransport = transport;
    this.root.innerHTML = "";
    if (session) this.hostSession = session;
    const me = this.profile?.name ?? "You";
    const mine = this.profile?.chatColor ?? null;
    new DebugApp(this.root, transport, {
      // A FUNCTION, not a snapshot: a kicked player's seat gains its
      // "Bot" label mid-game, and a value read once when the table opened
      // could never show it (owner report).
      faces: () => this.seatFaces(),
      localSeat: this.mySeat(),
      onLeave: () => this.leaveTable(),
      // A REAL GAME, so it is worth keeping. The playtest snapshot builds
      // its table without a shell and does not ask for this — see
      // `TableIdentity.autosave`. A guest sets it and nothing happens:
      // they have no history to snapshot.
      autosave: true,
      // THE HOST MAY NOT PLAY OTHER PEOPLE'S TURNS (owner report). The
      // host runs the engine, so it holds a live option list for every
      // seat at the table; these are the ones that are not its to answer.
      // A guest has no session and needs none — it is only ever sent its
      // own decisions.
      remoteSeats: () => (session?.roster ?? []).map((r) => r.seat),
      // THE END OF THE GAME. Both answers leave; the difference is only
      // whether it goes on this device's leaderboard (owner request).
      onFinished: (save: boolean) => this.finishGame(transport, save),
      // The conversation carries on at the table. Who relays it depends on
      // which end this client is, and the table does not need to know:
      // it is handed one function that says something.
      say: (text: string) => {
        // READ THE COLOUR NOW, not when the table was built. `mine` was
        // captured once at handover, so changing colour mid-game left
        // every later line painted in the old one (owner report
        // 2026-09-07) — the same shape of bug as a snapshot of the seat
        // faces, one screen along.
        const colour = this.profile?.chatColor ?? null;
        if (transport instanceof PeerTransport) transport.say(text);
        else if (this.hostSession) this.hostSession.say(text, me, false, colour);
        else addChat({ from: me, text, at: Date.now(), ...(colour ? { color: colour } : {}) });
      },
      // MODERATION IS THE AUTHORITY'S PANEL, not the online host's.
      //
      // It was first given only to a host with a live `HostSession`, which
      // meant it appeared nowhere on a private table — reported as "I
      // don't see the Moderation button anywhere". That was too narrow the
      // moment the AI-seat controls moved into it: a private game is
      // played entirely against bots, so it is the table that needs them
      // most. The test is whether this client RUNS the engine, which is
      // exactly `transport instanceof LocalTransport`.
      //
      // Kicking and banning still need a session, and are simply absent
      // without one: `people` is empty on a private table, because there
      // is nobody connected to remove.
      ...(transport instanceof LocalTransport
        ? {
            moderate: (): ModerationView => {
              const banned = new Set(session?.bannedSeats ?? []);
              const remote = new Set((session?.roster ?? []).map((r) => r.seat));
              return {
                people: session
                  ? transport
                      .view()
                      .seats.filter((s) => s.id !== this.mySeat())
                      .map((s) => ({
                        seat: s.id,
                        name: session.roster.find((r) => r.seat === s.id)?.name ?? s.id,
                        remote: remote.has(s.id),
                        banned: banned.has(s.id),
                      }))
                  : [],
              };
            },
            kick: (seat: string, reason: string) => session?.kick(seat, reason),
            setChatBan: (seat: string, ban: boolean) => session?.setChatBan(seat, ban),
          }
        : {}),
      // The colour is read and written through the profile, which the
      // shell owns; the table only shows it. Saving here rather than in
      // the table is what makes the chat's gear and the profile page the
      // same setting rather than two.
      chatColor: () => this.profile?.chatColor ?? DEFAULT_CHAT_COLOR,
      // One place, so the table's gear, the lobby's gear and the profile
      // page cannot disagree — and so a colour change actually reaches
      // the host, which is what stamps it onto the lines (applyChatColor).
      setChatColor: (color: string) => this.applyChatColor(color),
    });

    // BEING REMOVED HAS TO BE SAID OUT LOUD, and this has to be wired
    // AFTER the table is (owner report: no reason, and no way back).
    // Listeners fire in the order they subscribed: registered first, the
    // shell painted the menu into the root and the table — subscribed to
    // the same transport a moment later — painted the game straight back
    // over it. So the kicked player saw the table freeze, which is what
    // a dropped connection looks like.
    if (transport instanceof PeerTransport) {
      const offBye = transport.onChanged(() => {
        const reason = transport.closedReason;
        if (!reason) return;
        offBye();
        this.removedReason = reason;
        this.guestChannel = null;
        clearChat();
        // BACK TO THE MAIN MENU (owner request), with the reason on it.
        // `leaveTable` is the one place that hangs everything up.
        this.leaveTable();
      });
    }
  }

  /**
   * The game is over and the player has answered the prompt.
   *
   * SAVING IS THE PLAYER'S CALL (owner request). It used to be automatic:
   * `LocalTransport` was handed `recordResult` and wrote the row the
   * moment the engine stopped. The transport still computes the row — it
   * is the only side that sees a game bots finish — but it now hands it
   * here to be held, and this decides.
   *
   * A PEER computes its own: it has the final masked state, which carries
   * every seat's victory points, and it kept the lobby's bot list and
   * deck labels for exactly this. Its leaderboard therefore counts the
   * games it played, not only the ones it hosted.
   */
  private finishGame(transport: LocalTransport | PeerTransport, save: boolean): void {
    if (save) {
      const result =
        this.pendingResult ??
        resultFrom(transport.view(), {
          bots: this.guestBots,
          you: this.mySeat(),
          decks: this.guestDecks,
        });
      if (result) recordResult(result);
    }
    this.pendingResult = null;
    this.leaveTable();
  }

  /** The finished game the host's transport computed, held until the
   *  player says whether to keep it. */
  private pendingResult: GameResult | null = null;
  /** What the lobby told a GUEST before it was dropped: which seats are
   *  bots, and what deck each one brought. Neither is in the game state,
   *  and both belong on a leaderboard row. */
  private guestBots: Record<string, boolean> = {};
  private guestDecks: Record<string, string> = {};
  /** The lobby's last seat list, kept by a GUEST for the same reason: at
   *  the table the lobby is gone, and this client's own `table` describes
   *  a table it is not sitting at. */
  private guestSeats: LobbySeat[] = [];
  /** The transport the table is running on, so the shell can ask it what
   *  it knows — the bot labels, and a peer's final state. */
  private tableTransport: LocalTransport | PeerTransport | null = null;

  /**
   * Seat id → the deck label they brought, for the leaderboard.
   *
   * A LABEL, never the list: what is in a deck is its owner's business,
   * and a result is kept for ever. Read from the same `SeatConfig` the
   * game is dealt from, so it cannot describe a deck nobody played.
   */
  private deckLabels(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const s of this.lobbyHost?.seats ?? this.table.seats) {
      if (!s.deck) continue;
      out[s.name] =
        s.deck.kind === "precon" ? `${s.deck.name} — ${s.deck.set}` : "a pasted deck list";
    }
    return out;
  }

  /** The game-phase session, when this client is the host. Kept so the
   *  table can relay chat through it. */
  private hostSession: HostSession | null = null;

  /**
   * Who is in each seat, for the thumbnail on their mat.
   *
   * Local table: the host's own seat gets their profile picture and the
   * bots get none. Online: whatever the lobby last told us, which is where
   * a remote player's own picture arrives from.
   */
  private seatFaces(): Record<string, SeatFace> {
    const faces: Record<string, SeatFace> = {};
    // A seat a bot took over mid-game is RELABELLED, never renamed: the
    // seat name is the engine's id for it, so "Bea Bot" is a label the mat
    // draws and nothing else ever sees.
    //
    // ONE PLACE, BOTH ENDS. The labels are read off the transport, which
    // is the only object a host and a guest both have — the host writes
    // them there and every sync carries them out, so the relabelled mat
    // looks the same on all four screens (owner request 2026-09-07). Read
    // from the host session instead, they were a fact only the host knew.
    const botNames = this.tableTransport?.botNames?.() ?? {};
    const label = (seat: string): { label?: string } =>
      botNames[seat] ? { label: botNames[seat] } : {};

    // A GUEST'S ROSTER is what the lobby last told them — their own
    // `table` describes a table they are not at, and looking there gave
    // every seat the wrong name, so nothing matched and no mat had a face.
    const guests = this.lobbyPeer?.state?.seats ?? this.guestSeats;
    if (guests.length > 0) {
      for (const s of guests) {
        faces[s.name] = {
          avatar: s.avatar ?? null,
          bot: s.kind === "ai" || botNames[s.name] !== undefined,
          ...label(s.name),
        };
      }
      return faces;
    }

    for (const s of this.lobbyHost?.seats ?? this.table.seats) {
      faces[s.name] = {
        avatar: s.kind === "you" ? (this.profile?.avatar ?? null) : (s.avatar ?? null),
        bot: s.kind === "ai" || botNames[s.name] !== undefined,
        ...label(s.name),
      };
    }
    return faces;
  }

  /**
   * The one seat the person at this client holds, or null.
   *
   * Null is HOTSEAT — several humans at one screen — where there is no
   * single "you" and the table must follow whoever is being asked. Every
   * game the shell starts has exactly one local player, so this is
   * normally a name.
   */
  private mySeat(): string | null {
    if (this.lobbyPeer) return this.lobbyPeer.state?.you ?? null;
    const seats = this.lobbyHost?.seats ?? this.table.seats;
    return seats.find((s) => s.kind === "you")?.name ?? null;
  }

  /**
   * Leave the game and go back to the menu.
   *
   * The confirmation is asked by the table, which knows whether there is a
   * save to lose; by the time this runs the player has said yes. Closing
   * the room and the connection matters: a host who walks away without
   * doing it leaves a room code on the broker that dials into nothing.
   */
  private leaveTable(): void {
    this.lobbyHost?.close();
    this.lobbyHost = null;
    this.room?.close();
    this.room = null;
    this.lobbyPeer?.leave();
    this.lobbyPeer = null;
    this.guestChannel?.close();
    this.guestChannel = null;
    this.hostSession = null;
    this.pendingResult = null;
    this.guestBots = {};
    this.guestDecks = {};
    this.guestSeats = [];
    this.tableTransport = null;
    this.spectators = 0;
    this.screen = "menu";
    this.error = "";
    this.paint();
  }
}

/**
 * A picture, shrunk to fit in localStorage.
 *
 * An unscaled phone photo is megabytes, and the whole origin has a few —
 * shared with the settings and the saved game — so storing one would evict
 * the game rather than merely being wasteful. 128px square is what an
 * avatar is ever displayed at.
 */
export async function shrinkImage(file: Blob, size = 128): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser cannot resize images");
  // Cover, not stretch: a portrait avatar squashed into a square looks
  // broken, and cropping to the middle is what every other client does.
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.8);
}

/**
 * The face beside a name in the lobby, matching the one on the mat in
 * game. A bot gets a glyph rather than a borrowed picture — the point of
 * a thumbnail is telling people apart.
 */
function lobbyFace(name: string, avatar: string | null, bot: boolean): string {
  const initial = esc((name.trim()[0] ?? "?").toUpperCase());
  const cls = bot ? "seatface bot" : "seatface";
  if (avatar) return `<span class="${cls}"><img src="${esc(avatar)}" alt="" /></span>`;
  return `<span class="${cls}">${bot ? "\u{1F916}" : initial}</span>`;
}
