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

import { PLAYSTYLES_LIST, PLAYSTYLE_LABELS } from "../ai/playstyles.ts";
import { botAgentFor, playstyleOf } from "./botagent.ts";
import type { CatalogCard, CatalogFile } from "../cards/catalog.ts";
import { disciplineName, loadCatalog } from "../cards/catalog.ts";
import type { CardQuery, CardView, Facets, SearchScope, SortDir, SortKey } from "./cardsearch.ts";
import type { DeckDraft } from "./deckbuild.ts";
import {
  countsOf,
  draftCards,
  draftToText,
  emptyDraft,
  indexCatalog,
  LIBRARY_TYPE_ORDER,
  parseDraft,
  reviewDraft,
  sectionOf,
  setCount,
  withCard,
} from "./deckbuild.ts";
import {
  cardDetailMarkup,
  DEFAULT_PAGE_SIZE,
  builderDefaultQuery,
  emptyQuery,
  facetsOf,
  PAGE_SIZES,
  resultsMarkup,
  searchCards,
  searchPanelMarkup,
  statusBadge,
  traitLine,
} from "./cardsearch.ts";
import { MAX_LIBRARY, MIN_CRYPT, MIN_LIBRARY } from "./decks.ts";

/**
 * The Deck Builder's three tabs, in the order the owner asked for them:
 * your decks, then the builder, then the search.
 */
type DeckTab = "decks" | "build" | "search";

/**
 * The panels whose scroll position outlives a repaint.
 *
 * `.shell` is the page itself; `.dblist` is the deck list on the My decks
 * viewer; `.dbdeck` and `.dbsearch` are the builder's two columns, which
 * scroll independently since 0.11.16. All of them are rebuilt by
 * `innerHTML` on every paint, and a rebuilt element starts at the top —
 * so a column left out of this list would jump on every +.
 */
const SCROLL_KEEPERS = [".shell", ".dblist", ".dbdeck", ".dbsearch"];

const DECK_TABS: Array<{ id: DeckTab; label: string }> = [
  { id: "decks", label: "My decks" },
  { id: "build", label: "Build a deck" },
  { id: "search", label: "Card search" },
];

type SettingsTab = "profile" | "bots" | "controls";
const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "bots", label: "Bots" },
  { id: "controls", label: "Controls" },
];
import { LobbyHost, LobbyPeer } from "../net/lobby.ts";
import type { HostSession } from "../net/host.ts";
import { PeerTransport } from "../net/peer.ts";
import type { RoomHandle } from "../net/peerjs.ts";
import { hostRoom, joinRoom } from "../net/peerjs.ts";
import type { LobbySeat, PeerChannel } from "../net/protocol.ts";
import { addChat, chatLines, chatProblem, clearChat, MAX_CHAT_TEXT, onChat } from "./chat.ts";
import { codeFromLink, isRoomCode, joinLink, newRoomCode, normaliseRoomCode } from "../net/room.ts";
import type { PreconSummary } from "./deckimport.ts";
import { preconDeck, preconStyle, supportedPrecons, supportedSets } from "./deckimport.ts";
import {
  deckSummary,
  deleteDeck,
  findDeck,
  findDeckLoosely,
  loadDecks,
  MAX_DECK_NAME,
  renameDeck,
  replaceDeck,
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
import {
  chatLinesMarkup,
  chatSettings,
  DEFAULT_EMOJI_CATEGORY,
  emojiPad,
  howToPlayPanel,
} from "./render.ts";
import type { DeckSource, SeatConfig, TableConfig } from "./newgame.ts";
import { deckLabel as labelForDeck } from "./newgame.ts";
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
  PLAYSTYLE_DEFAULT,
  botNameFor,
  botNameProblem,
  loadSettings,
  MAX_BOT_NAMES,
  OPENING_DELAY_MS,
  saveSettings,
  seatSeed,
} from "./settings.ts";
import { controlsPanel, wireControls, type KeyAction } from "./keybinds.ts";
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

type Screen =
  | "profile"
  | "menu"
  | "deckbuilder"
  | "newgame"
  | "lobby"
  | "join"
  | "leaderboard"
  | "table";

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

  // --- the deck builder -----------------------------------------------------
  /**
   * The card catalogue, once it has arrived.
   *
   * Null means "not asked for yet or still coming", which is the honest
   * state: it is a 3MB lazily-imported chunk (src/cards/catalog.ts) and
   * the shell is drawn synchronously, so the screen shows that it is
   * loading and repaints when the promise settles. The facets are cached
   * beside it because deriving them walks all 4,149 cards and the answer
   * cannot change without the catalogue changing.
   */
  private catalog: CatalogFile | null = null;
  /** Built once with the catalogue, for the hover preview: a hover must not
   *  rebuild a 4,149-entry index every time the pointer crosses a card. */
  private catalogIndex: ReturnType<typeof indexCatalog> | null = null;
  /** Where the pointer is, for placing the preview beside it. */
  private pointer = { x: 0, y: 0 };
  private catalogFacets: Facets | null = null;
  private catalogError = "";
  /**
   * ONE QUERY PER TAB. The Build tab starts on "Playable here" — you are
   * building a deck to play — while Card search starts on Any, because it
   * exists to browse all 4,149 cards. Every reader goes through
   * `cardQuery`, which picks the tab's own.
   */
  private searchTabQuery: CardQuery = emptyQuery();
  private buildTabQuery: CardQuery = builderDefaultQuery();
  private get cardQuery(): CardQuery {
    return this.deckTab === "build" ? this.buildTabQuery : this.searchTabQuery;
  }
  private set cardQuery(q: CardQuery) {
    if (this.deckTab === "build") this.buildTabQuery = q;
    else this.searchTabQuery = q;
  }
  /** What "Clear filters" returns this tab to. */
  private defaultCardQuery(): CardQuery {
    return this.deckTab === "build" ? builderDefaultQuery() : emptyQuery();
  }
  private cardView: CardView = "grid";
  private advancedOpen = false;
  /** The card whose detail panel is open, by KRCG id. */
  private selectedCardId: number | null = null;
  /** Which tab of the Deck Builder is showing (owner request, 2026-09-22). */
  private deckTab: DeckTab = "decks";
  /** Which tab of the Settings screen is showing, and the shortcut on its
   *  Controls tab waiting for a new key. View state. */
  private settingsTab: SettingsTab = "profile";
  private keyCapturing: KeyAction | null = null;
  /**
   * The page of results, 1-based, and how many fit on one.
   *
   * The page number OUTLIVES THE LIST IT INDEXES — it survives every
   * repaint while the results under it change on every keystroke. It is
   * never clamped here; `paginate` does that, once, because it is the
   * only thing that knows how many pages exist.
   */
  private cardPage = 1;
  private cardPageSize = DEFAULT_PAGE_SIZE;
  /**
   * The deck being built, or null when the Build tab is showing its
   * start screen. It is a bag of counts, not a `DeckList` — see
   * `deckbuild.ts` for why that is the whole design.
   */
  private draft: DeckDraft | null = null;
  private draftError = "";
  /**
   * Keep the builder's search to what the crypt can play (owner request,
   * 2026-09-22).
   *
   * A setting on the SCREEN rather than on the draft: it is about how you
   * are looking for cards right now, not about the deck, so it must not
   * be saved into the deck's text and must not follow it to another
   * machine. It is off by default — a filter nobody asked for that hides
   * most of the game is worse than one they have to find.
   */
  private scopeToCrypt = false;
  /**
   * The How to Play panel on the main menu (owner request, 2026-09-22):
   * open, its search text, and which sections are expanded — the same
   * three things the table keeps, for the same reason. The menu repaints
   * whole on every change, and the sections someone opened must survive
   * the next keystroke in the search box.
   */
  private helpOpen = false;
  private helpQuery = "";
  private helpOpenSections = new Set<string>();
  /** The saved deck being READ on the My decks tab, by name. */
  private viewingDeck: string | null = null;
  /**
   * How a DECK's own cards are drawn — scans or rows.
   *
   * One setting for the viewer and the builder, because it is one
   * question: how do I want to look at a deck? Deliberately NOT the same
   * field as `cardView`, which is about the SEARCH — wanting pictures
   * while browsing 4,149 cards and rows while checking your own sixty is
   * a perfectly ordinary pair of preferences.
   */
  private deckCardView: CardView = "list";
  /** Lines of a reopened deck that named no card. Shown, never dropped. */
  private draftUnreadable: string[] = [];

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
    // ONCE, here, and never in `wire()`: `wire()` runs on every paint, and
    // these listeners sit on the ROOT, which survives every paint — so
    // binding them there would stack another copy per repaint.
    this.wireZoom();
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
    // The catalogue is 3MB and nothing else on any screen wants it, so it
    // is asked for HERE — on the way in, once — rather than from the
    // render, which runs on every keystroke and must stay a pure function
    // of state.
    if (screen === "deckbuilder") this.ensureCatalog();
    // The rules panel belongs to the menu screen; coming back to the menu
    // from somewhere else lands on the menu, not on a panel left open.
    this.helpOpen = false;
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
    // WHERE YOU WERE LOOKING SURVIVES THE REPAINT TOO.
    //
    // The same lesson as the half-typed name above, one layer out: the
    // scrolling element IS `.shell`, and `innerHTML` throws it away and
    // builds a new one at scrollTop 0. Nothing showed this until the
    // deck builder, because every earlier screen fits on a page — but
    // there, adding a card repaints, and the page jumped to the top on
    // every single **+** (owner-reported, 2026-09-22).
    //
    // `.dblist` is saved as well: the deck list is its own scroller, so
    // removing the fourth copy of a card 200 rows down would otherwise
    // fling you back to the crypt.
    const scrolls = this.savedScroll();
    this.root.innerHTML = `<div class="${cls}">${this.body()}</div>`;
    this.restoreScroll(scrolls);
    this.wire();
  }

  /** How far each scrolling panel is scrolled, before a repaint eats it. */
  private savedScroll(): Array<[string, number]> {
    const out: Array<[string, number]> = [];
    for (const sel of SCROLL_KEEPERS) {
      const el = this.root.querySelector<HTMLElement>(sel);
      if (el && el.scrollTop > 0) out.push([sel, el.scrollTop]);
    }
    return out;
  }

  private restoreScroll(saved: Array<[string, number]>): void {
    for (const [sel, top] of saved) {
      const el = this.root.querySelector<HTMLElement>(sel);
      // CLAMPED BY THE BROWSER, and that is the behaviour we want: if
      // the new content is shorter (a filter just cut the list), landing
      // at the bottom of what there is beats landing past the end.
      if (el) el.scrollTop = top;
    }
  }

  private body(): string {
    switch (this.screen) {
      case "profile":
        return this.profileScreen();
      case "menu":
        return this.menuScreen();
      case "deckbuilder":
        return this.deckBuilderScreen();
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
    // SETTINGS, IN THREE TABS (owner request, 2026-09-25): the menu's
    // Profile button became Settings, and what it holds split into the
    // person, their bots and their keys. A first-time visitor has no
    // profile yet, so they get the form alone — there is nothing else to
    // set before there is somebody to set it for.
    if (!p) return this.profileForm();
    const tab = this.settingsTab;
    const body =
      tab === "bots"
        ? this.botNamesPanel()
        : tab === "controls"
          ? `<div class="supported">${controlsPanel(loadSettings().keybinds, this.keyCapturing)}</div>`
          : this.profileForm();
    return `
      <div class="card">
        <div class="row cardhead">
          <h1>Settings</h1>
          <button id="pback">Back</button>
        </div>
        <div class="dbtabs" role="tablist">
          ${SETTINGS_TABS.map(
            (t) =>
              `<button class="dbtab${tab === t.id ? " on" : ""}" role="tab"
                       aria-selected="${tab === t.id}" data-stab="${t.id}">${esc(t.label)}</button>`,
          ).join("")}
        </div>
        <div class="dbbody">${body}</div>
      </div>`;
  }

  private profileForm(): string {
    const p = this.profile;
    const draft = this.profileDraft;
    return `
      <div class="${p ? "supported" : "card"}">
        <!--
          BACK SITS IN THE HEADER (owner request, 2026-09-22), not down
          among Save and Delete profile. It is navigation rather than an
          action on the form, and it was the one button in that row that
          did not change anything — next to a red Delete profile, which
          is a bad neighbour for the button you press to leave.

          On a profile that does not exist yet there is nowhere to go
          back TO, so the header is just the title.
        -->
        ${p ? "" : `<div class="row cardhead"><h1>Welcome</h1></div>`}
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
          ${p ? `<button id="pclear" class="danger">Delete profile</button>` : ""}
        </div>
        <!--
          YOUR DECKS USED TO BE HERE (owner request, 2026-09-22): they and
          the importer moved to the Deck Builder, which is where deck
          things now live. A feature that moved without a sign is
          indistinguishable from one that was deleted — the same report
          this project has had twice about features that worked — so the
          old place says where the new one is, and the button goes there.
        -->
        ${
          p
            ? `<p class="note dim">
                 Your saved decks and the deck importer are in the
                 <b>Deck Builder</b> now.
                 <button id="p-decks" class="linkish">Open it</button>
               </p>`
            : ""
        }
        ${p ? this.savedGamesPanel() : ""}
      </div>`;
  }

  /**
   * The games this browser is holding (docs/saved-games-design.md).
   *
   * On the Profile screen for the reason the deck library is: this is
   * where the things that are YOURS live, and a saved game is one of them.
   * It could equally have been a menu entry, and the menu is kept short
   * on purpose (seven buttons since the Deck Builder and How to Play
   * joined it) — an entry that is empty for most of a player's first
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
      const style = settings.botPlaystyles[i - 1] ?? PLAYSTYLE_DEFAULT;
      // "Default" is a stored value, not a style: it means "whatever the
      // deck this seat is playing is set to".
      const styleOptions = [
        `<option value="${PLAYSTYLE_DEFAULT}"${style === PLAYSTYLE_DEFAULT ? " selected" : ""}>Default</option>`,
        ...PLAYSTYLES_LIST.map(
          (p) => `<option value="${p}"${style === p ? " selected" : ""}>${PLAYSTYLE_LABELS[p]}</option>`,
        ),
      ].join("");
      rows.push(`
        <label class="field botnamerow">
          <span>Bot ${i}</span>
          <input class="botname" data-bot="${i}" maxlength="${MAX_NAME_LENGTH}"
                 value="${esc(configured)}" placeholder="Bot ${i}" />
          <select class="botstyle" data-bot="${i}" aria-label="Bot ${i} playstyle">
            ${styleOptions}
          </select>
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
          A bot's name fixes its luck: the AI is seeded from it, so "Bea"
          makes the same choices in the same spots every game, and
          renaming a bot shuffles which way its close calls fall.
          Leaderboard standings are kept per name too.
        </p>
        <p class="note dim">
          The dropdown decides how a bot <em>plays</em>. Leave it on
          Default and the bot plays to suit whichever deck it is dealt.
        </p>
        ${this.botNameError ? `<p class="err">${esc(this.botNameError)}</p>` : ""}
      </div>`;
  }

  /**
   * Your saved decks. On the DECK BUILDER since 2026-09-22 (owner
   * request) — it was on the Profile screen, which was where "things that
   * are yours" lived before there was a screen about decks. They are
   * still CHOSEN from the deck panel, which serves the new-game screen and
   * the lobby through one code path, so a deck saved here is available
   * everywhere a deck is picked.
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
                    <button class="lname deckopen" data-deck="${esc(d.name)}"
                            title="Look at the cards in this deck">${esc(d.name)}</button>
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

  // --- deck builder --------------------------------------------------------

  /**
   * THE DECK BUILDER (docs/deck-builder-design.md).
   *
   * One home for everything to do with decks, rather than three: your
   * saved decks and the importer moved here off the Profile screen, the
   * card search is new, and the building half has a section reserved for
   * it and nothing in it yet.
   *
   * THE RESERVED SECTION IS DELIBERATE AND IT IS NOT A STUB. It says what
   * will be there and what you can do instead today. A panel that says
   * "coming soon" and nothing else is worse than no panel; a panel that
   * points you at the importer is a working answer to the question that
   * brought you here.
   */
  private deckBuilderScreen(): string {
    // ONE TAB IS DRAWN, not three hidden with CSS. The search tab is a
    // grid of up to a hundred card scans; building it and then setting
    // `display: none` on it would cost every one of those requests to
    // show somebody their deck list.
    const body =
      this.deckTab === "decks"
        ? (this.viewingDeck ? this.deckViewer(this.viewingDeck) : this.deckLibrary())
        : this.deckTab === "build"
          ? this.buildPanel()
          : this.cardSearchPanel();
    return `
      <div class="card deckbuilder">
        <div class="row cardhead">
          <h1>Deck Builder</h1>
          <button id="db-back">Back</button>
        </div>
        <div class="dbtabs" role="tablist">
          ${DECK_TABS.map(
            (t) =>
              `<button class="dbtab${this.deckTab === t.id ? " on" : ""}"
                       role="tab" aria-selected="${this.deckTab === t.id}"
                       data-tab="${t.id}">${esc(t.label)}</button>`,
          ).join("")}
        </div>
        <div class="dbbody">${body}</div>
      </div>
      <!--
        THE SAME HOVER PREVIEW THE TABLE HAS (owner request, 2026-09-22) —
        same markup and same stylesheet, so a card looks the same wherever
        you hover it. Outside the card on purpose: it is position: fixed,
        and it must not be clipped by a scrolling column.
      -->
      <div id="zoom" class="zoom" hidden
           style="--cardtext:${loadSettings().cardTextPx}px">
        <div class="zoomname"></div>
        <img alt="" /><div class="zoomtext"></div>
      </div>`;
  }

  /**
   * The Build tab: either the start screen or the editor.
   *
   * The catalogue gates BOTH, because a draft is a bag of card ids and
   * every one of them has to be resolved before it can be drawn or
   * reviewed. Opening a precon before the cards have arrived would give
   * a deck with the right count of nothing.
   */
  private buildPanel(): string {
    if (!this.catalog) {
      return `<div class="supported dbbuild">
        <p class="note dim">Loading the card list…</p>
      </div>`;
    }
    return this.draft ? this.deckEditor(this.draft) : this.deckStart();
  }

  /**
   * Nothing open yet: the three ways in.
   *
   * A precon and a saved deck are the same act — open something that
   * exists and change it — so they sit together, above the empty one.
   * Starting from scratch is listed last on purpose: it is the option
   * that needs the most from you, and the owner asked for both.
   */
  private deckStart(): string {
    const precons = supportedPrecons().filter((p) => p.playable || p.halfDeck);
    const saved = loadDecks();
    return `
      <div class="supported dbbuild">
        <div class="sethead">Start a deck</div>
        ${this.draftError ? `<p class="err">${esc(this.draftError)}</p>` : ""}
        <p class="note">
          A legal deck is <b>at least 12 crypt cards</b> and
          <b>between 60 and 90 library cards</b> (p. 14). Your crypt may use
          one group or two consecutive ones (p. 4). There is
          <b>no limit on copies</b> of any one card.
        </p>

        <div class="dbstartrow">
          <label class="field">
            <span>Start from a preconstructed deck</span>
            <select id="db-precon">
              <option value="">Choose a precon…</option>
              ${precons
                .map(
                  (p) =>
                    `<option value="${esc(`${p.set}|${p.name}`)}">${esc(p.name)} — ${esc(
                      p.set,
                    )}${p.halfDeck ? " (half deck)" : ""}</option>`,
                )
                .join("")}
            </select>
          </label>
          <button id="db-openprecon" class="primary">Open it</button>
        </div>

        <div class="dbstartrow">
          <label class="field">
            <span>Or edit one of your saved decks</span>
            <select id="db-saved"${saved.length === 0 ? " disabled" : ""}>
              <option value="">${
                saved.length === 0 ? "You have no saved decks yet" : "Choose a deck…"
              }</option>
              ${saved.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join("")}
            </select>
          </label>
          <button id="db-opensaved"${saved.length === 0 ? " disabled" : ""}>Open it</button>
        </div>

        <div class="row">
          <button id="db-scratch">Start from scratch</button>
          <span class="note dim">an empty deck, built from the card search</span>
        </div>
      </div>`;
  }

  /**
   * The editor: the deck on the left, the card search on the right.
   *
   * The right-hand side is the SAME search the Card search tab draws —
   * one `searchPanelMarkup`, one `resultsMarkup`, one set of handlers —
   * with `counts` passed, which is the single thing that turns the add
   * controls on. Two searches would be two things to keep in step, and
   * the one that was not being looked at would be the one that rotted.
   */
  private deckEditor(draft: DeckDraft): string {
    const file = this.catalog!;
    const { byId } = indexCatalog(file);
    const review = reviewDraft(draft, byId);
    const facets = this.catalogFacets;
    // The scope is DERIVED from the draft on every paint, never stored —
    // it changes the moment a vampire is added or removed, and a stored
    // copy would be a second answer to the same question.
    const query = this.builderQuery(review.cryptScope);
    const results = searchCards(file.cards, query);
    return `
      ${this.closeAsk ? this.closeDialog(draft) : ""}
      <div class="dbeditor">
        <div class="dbdeck">
          <div class="row dbdeckhead">
            <input id="db-name" class="dbname" maxlength="${MAX_DECK_NAME}"
                   value="${esc(draft.name)}" placeholder="Name this deck" />
            <button id="db-save" class="primary">Save</button>
            <button id="db-close">Close</button>
          </div>
          <!--
            THE LABEL THE OWNER ASKED FOR, and it is a control rather than
            a badge because being half a deck is a DECLARATION, not
            something the counts can reveal: a starter and an unfinished
            deck look identical from the outside.
          -->
          <label class="dbhalf${draft.halfDeck ? " on" : ""}">
            <input id="db-half" type="checkbox"${draft.halfDeck ? " checked" : ""} />
            <span>Half deck</span>
            <span class="note dim">
              a New Blood–style starter: exempt from the 12-crypt and
              60-card minimums, and from nothing else
            </span>
          </label>
          ${this.draftError ? `<p class="err">${esc(this.draftError)}</p>` : ""}
          ${this.legalityPanel(review)}
          <div class="row dbdecktools">${this.deckViewToggle()}</div>
          ${this.deckCardsMarkup(draftCards(draft, byId), this.deckCardView, true)}
        </div>
        <div class="dbsearch">
          ${this.scopePanel(review)}
          ${facets ? searchPanelMarkup(query, facets, this.advancedOpen, this.cardView, builderDefaultQuery()) : ""}
          ${this.selectedCard() ? cardDetailMarkup(this.selectedCard()!) : ""}
          <div id="cs-results">${resultsMarkup(results, {
            view: this.cardView,
            selectedId: this.selectedCardId,
            total: file.cards.length,
            page: this.cardPage,
            pageSize: this.cardPageSize,
            counts: draft.counts,
          })}</div>
        </div>
      </div>`;
  }

  /**
   * The builder's search query: the screen's query, plus the scope.
   *
   * ONE PLACE, because the editor renders the query and the search
   * handlers read it, and a scope applied in only one of them would show
   * a filtered list with an unfiltered count beside it.
   */
  private builderQuery(cryptScope: NonNullable<CardQuery["withinCrypt"]>): CardQuery {
    if (!this.scopeToCrypt) return this.cardQuery;
    return { ...this.cardQuery, withinCrypt: cryptScope };
  }

  /**
   * "No vampire you have can play this card."
   *
   * Its own panel rather than one of the `cautions` strings: it names
   * cards, it names the discipline each one wants, and it offers a
   * button that does something about it. A sentence in a list could do
   * none of those.
   *
   * It is a CAUTION, not an error. Nothing in the rules stops you
   * putting a Dominate card in a Gangrel deck — it just means you have
   * dead cards, which is the most common way a real deck is quietly
   * broken and the reason this is reported by name rather than left for
   * a playtest to find.
   */
  private offScopePanel(review: ReturnType<typeof reviewDraft>): string {
    const off = review.offScope;
    if (off.length === 0) return "";
    const copies = off.reduce((n, r) => n + r.copies, 0);
    // NAME THE THING THE CARD ACTUALLY WANTS. `missing` says which of the
    // three gates failed, so a Sabbat card is not reported as needing a
    // discipline — guessing would send somebody looking for the wrong
    // fix.
    const needs = (r: (typeof off)[number]): string => {
      if (r.missing === "clan") return `needs ${r.card.requiresClans.join(" or ")}`;
      if (r.missing === "sect") return `needs a ${r.card.requiresSects.join(" or ")} vampire`;
      return `needs ${r.card.disciplines.map((d) => disciplineName(d)).join(" or ")}`;
    };
    const kinds = [...new Set(off.map((r) => r.missing))];
    return `
      <div class="dboffdisc">
        <p class="note dbcaution">
          <b>${copies} library card${copies === 1 ? "" : "s"}</b>
          need${copies === 1 ? "s" : ""} a
          ${esc(kinds.join(" or "))} no vampire in this crypt has. That is
          legal, but no minion you control will be able to play
          ${copies === 1 ? "it" : "them"}.
        </p>
        <p class="note">
          ${off
            .map(
              (r) =>
                `${esc(r.card.name)} ×${r.copies} <span class="dim">(${esc(needs(r))})</span>`,
            )
            .join(" · ")}
        </p>
        ${
          this.scopeToCrypt
            ? ""
            : `<button id="db-scopeon">Narrow the search to my crypt</button>`
        }
      </div>`;
  }

  /** The discipline-scope switch, and what it is currently doing. */
  private scopePanel(review: ReturnType<typeof reviewDraft>): string {
    const s = review.cryptScope;
    const empty = s.disciplines.length === 0 && s.clans.length === 0;
    // Each part of the scope is listed separately, because each is a
    // separate gate — and a crypt of one clan reads very differently
    // from a crypt of five.
    const part = (label: string, values: string[]): string =>
      values.length === 0 ? "" : `<b>${esc(label)}:</b> ${esc(values.join(", "))}`;
    return `
      <label class="dbscope${this.scopeToCrypt ? " on" : ""}">
        <input id="db-scope" type="checkbox"${this.scopeToCrypt ? " checked" : ""} />
        <span>Only cards my crypt can play</span>
        <span class="note dim">
          ${
            empty
              ? `No vampires in this deck yet, so there is nothing to narrow
                 to — add some and this will limit the library results to
                 the disciplines, clans and sects they have.`
              : `Hides library cards needing a discipline, clan or sect your
                 crypt has not got.
                 ${[
                   part("Disciplines", s.disciplines.map((d) => disciplineName(d))),
                   part("Clans", s.clans),
                   part("Sects", s.sects),
                 ]
                   .filter(Boolean)
                   .join(" · ")}.
                 Cards that require nothing are always shown, and a clan
                 icon on a <em>master</em> is a label rather than a
                 requirement, so those are never hidden.`
          }
        </span>
      </label>`;
  }

  /**
   * THE THREE QUESTIONS, kept apart because they have different answers.
   *
   * Is it legal (p. 14, p. 4)? Is there anything the rulebook cautions
   * about? And can THIS PLATFORM deal it? A builder that merged them
   * would tell you a deck with a duplicated unique vampire is broken —
   * it is not, the rulebook's own word is "CAUTION" — or that a banned
   * card makes a deck illegal, when "banned" appears nowhere in the
   * rulebook and is a tournament restriction.
   */
  private legalityPanel(review: ReturnType<typeof reviewDraft>): string {
    const c = review.counts;
    const cryptOk = c.crypt >= MIN_CRYPT;
    const libOk = c.library >= MIN_LIBRARY && c.library <= MAX_LIBRARY;
    // A HALF DECK'S METERS ARE NOT "SHORT" — nothing is wrong with them.
    // Drawing 6/12 in red on a deck that is meant to be six would be the
    // screen arguing with the rule it just applied.
    const meter = (label: string, n: number, ok: boolean, target: string): string =>
      `<span class="dbmeter ${review.halfDeck ? "half" : ok ? "ok" : "short"}">
         <b>${n}</b> ${esc(label)}
         <span class="dim">${esc(review.halfDeck ? "half deck" : target)}</span>
       </span>`;
    return `
      <div class="dblegal">
        <div class="dbmeters">
          ${meter("crypt", c.crypt, cryptOk, `need ${MIN_CRYPT}+`)}
          ${meter("library", c.library, libOk, `need ${MIN_LIBRARY}–${MAX_LIBRARY}`)}
          <span class="dbverdict ${
            review.dealable ? "ok" : review.legal ? "warn" : "short"
          }">${
            review.dealable
              ? review.halfDeck
                ? "Half deck — playable here"
                : "Legal, and playable here"
              : review.legal
                ? "Legal — but not all of it plays here"
                : "Not a legal deck yet"
          }</span>
        </div>
        ${review.illegal
          .map((p) => `<p class="err dbissue">${esc(p)}</p>`)
          .join("")}
        ${
          review.unplayable.length > 0
            ? `<div class="dbunplayable">
                 <p class="err">
                   ${review.unplayable.reduce((n, u) => n + u.copies, 0)} card${
                     review.unplayable.reduce((n, u) => n + u.copies, 0) === 1 ? "" : "s"
                   } in this deck ${
                     review.unplayable.length === 1 ? "is" : "are"
                   } not implemented here, so it cannot be dealt at a table
                   in this player yet:
                 </p>
                 <p class="note">${review.unplayable
                   .map((u) => `${esc(u.card.name)} ×${u.copies}`)
                   .join(" · ")}</p>
                 <button id="db-onlyplayable">Search only what plays here</button>
                 <button id="db-stripunplayable" class="danger">Remove them</button>
               </div>`
            : ""
        }
        ${this.offScopePanel(review)}
        ${review.cautions.map((p) => `<p class="note dbcaution">${esc(p)}</p>`).join("")}
        ${
          review.inert.length > 0
            ? `<p class="note dim">Printed ability not implemented, so it will do
                 nothing: ${esc(review.inert.join(", "))}.</p>`
            : ""
        }
        ${
          this.draftUnreadable.length > 0
            ? `<p class="note dim">${this.draftUnreadable.length} line${
                this.draftUnreadable.length === 1 ? "" : "s"
              } of that deck named no card and ${
                this.draftUnreadable.length === 1 ? "was" : "were"
              } left out: ${esc(this.draftUnreadable.slice(0, 5).join("; "))}</p>`
            : ""
        }
      </div>`;
  }

  /** The deck itself: crypt by capacity, library by the conventional order. */
  /**
   * A deck's cards, in whichever way they are being looked at.
   *
   * ONE RENDERER for two screens: the deck being built and a saved deck
   * being read (owner request, 2026-09-22). The only differences are
   * whether the −/+ controls are there and whether cards are drawn as
   * scans or as rows, so both are parameters rather than a second copy
   * of the crypt/library/section walk — which is the part that would
   * drift.
   */
  private deckCardsMarkup(
    rows: Array<{ card: CatalogCard; copies: number }>,
    view: CardView,
    editable: boolean,
  ): string {
    const counts = countsOf(rows);
    if (rows.length === 0) {
      return `<p class="note dim dbempty">${
        editable
          ? `Nothing in this deck yet. Search on the right and press <b>+</b> to add cards.`
          : `This deck has no cards in it.`
      }</p>`;
    }
    const line = (card: CatalogCard, copies: number): string => {
      if (view === "grid") {
        // The COUNT is drawn over the scan rather than beside it: at this
        // size the picture is the thing you are scanning for, and four
        // copies of a card should read as one entry with a 4 on it.
        return `
          <span class="dkcell ${card.status}">
            <button class="dbcard dkpic" data-card="${card.id}" data-zoomid="${card.id}">
              <img loading="lazy" src="${esc(card.image)}" alt="${esc(card.name)}" />
              <span class="dkcopies">${copies}</span>
            </button>
            ${
              editable
                ? `<span class="dkadd">
                     <button class="dbless" data-card="${card.id}" aria-label="One fewer">−</button>
                     <button class="dbmore" data-card="${card.id}" aria-label="One more">+</button>
                   </span>`
                : ""
            }
            <span class="dkname">${esc(card.name)}</span>
          </span>`;
      }
      return `
        <div class="dbrow ${card.status}">
          ${
            editable
              ? `<button class="dbless" data-card="${card.id}" aria-label="One fewer">−</button>`
              : ""
          }
          <span class="dbcount">${copies}</span>
          ${
            editable
              ? `<button class="dbmore" data-card="${card.id}" aria-label="One more">+</button>`
              : ""
          }
          <button class="dbcard" data-card="${card.id}" data-zoomid="${card.id}">${esc(card.name)}</button>
          <span class="dbtraits">${esc(traitLine(card))}</span>
          ${card.status === "playable" ? "" : statusBadge(card)}
        </div>`;
    };
    const group = (cells: string): string =>
      view === "grid" ? `<div class="dkgrid">${cells}</div>` : cells;

    const crypt = rows
      .filter((r) => r.card.kind === "crypt")
      .sort(
        (a, b) =>
          (b.card.capacity ?? 0) - (a.card.capacity ?? 0) ||
          a.card.name.localeCompare(b.card.name, "en"),
      );
    const library = rows.filter((r) => r.card.kind === "library");

    const sections = LIBRARY_TYPE_ORDER.map((type) => {
      const inType = library
        .filter((r) => sectionOf(r.card) === type)
        .sort((a, b) => a.card.name.localeCompare(b.card.name, "en"));
      if (inType.length === 0) return "";
      const n = inType.reduce((acc, r) => acc + r.copies, 0);
      return `
        <div class="dbsection">${esc(type)} <span class="dim">(${n})</span></div>
        ${group(inType.map((r) => line(r.card, r.copies)).join(""))}`;
    }).join("");

    return `
      <div class="dblist ${view}">
        <div class="dbsection big">Crypt <span class="dim">(${counts.crypt})</span></div>
        ${
          crypt.length === 0
            ? `<p class="note dim">No vampires yet.</p>`
            : group(crypt.map((r) => line(r.card, r.copies)).join(""))
        }
        <div class="dbsection big">Library <span class="dim">(${counts.library})</span></div>
        ${library.length === 0 ? `<p class="note dim">No library cards yet.</p>` : sections}
      </div>`;
  }

  /** Grid or list, for a deck's own cards. Shared by the builder and the viewer. */
  private deckViewToggle(): string {
    return `
      <span class="dktoggle">
        <button id="dk-grid" class="csview${this.deckCardView === "grid" ? " on" : ""}">Grid</button>
        <button id="dk-list" class="csview${this.deckCardView === "list" ? " on" : ""}">List</button>
      </span>`;
  }

  /**
   * A saved deck, read rather than edited (owner request, 2026-09-22).
   *
   * It runs the deck through the SAME `parseDraft` and `reviewDraft` the
   * builder uses, so the legality panel, the half-deck label and the
   * "no vampire can play this" warning all appear here for free and
   * cannot say something different from what the editor would say about
   * the same deck.
   */
  private deckViewer(name: string): string {
    const saved = findDeck(name);
    if (!saved || !this.catalog) {
      return `<div class="supported deckstore">
        <p class="note dim">${saved ? "Loading the card list…" : "That deck is no longer there."}</p>
        <div class="row"><button id="dv-back">Back to my decks</button></div>
      </div>`;
    }
    const { byId, byName } = indexCatalog(this.catalog);
    // A precon has no text of its own, so it is expanded the same way the
    // builder expands one.
    const text =
      saved.source.kind === "paste"
        ? saved.source.text
        : draftToText(this.preconDraft(saved.source.set, saved.source.name) ?? emptyDraft(), byId);
    const { draft } = parseDraft(text, byName);
    const review = reviewDraft(draft, byId);
    return `
      <div class="supported deckstore">
        <div class="row cardhead">
          <h1>${esc(saved.name)}</h1>
          ${this.deckViewToggle()}
          <button id="dv-edit" class="primary">Edit</button>
          <!--
            THE SAME CLASSES the My decks rows use, so these are the same
            two handlers rather than a second pair that would have to be
            kept in step. They read data-deck, which is the deck's own
            name either way.
          -->
          <button class="deckrename" data-deck="${esc(saved.name)}">Rename</button>
          <button class="deckdelete danger" data-deck="${esc(saved.name)}">Delete</button>
          <button id="dv-back">Back</button>
        </div>
        ${this.legalityPanel(review)}
        ${this.selectedCard() ? cardDetailMarkup(this.selectedCard()!) : ""}
        ${this.deckCardsMarkup(draftCards(draft, byId), this.deckCardView, false)}
      </div>`;
  }

  /**
   * Every card in the game, searchable (docs/deck-builder-design.md §3).
   *
   * The catalogue is not the registry: it is all 4,149 KRCG cards, and
   * each one is badged with what this platform can actually do with it.
   * That badge is the reason the panel exists at all — "is this card in
   * the player?" is the question a deck builder asks first, and until now
   * the only way to answer it was to paste a list and read the errors.
   */
  private cardSearchPanel(): string {
    if (this.catalogError) {
      return `<div class="supported cardsearch">
        <div class="sethead">Card search</div>
        <p class="err">${esc(this.catalogError)}</p>
      </div>`;
    }
    const file = this.catalog;
    const facets = this.catalogFacets;
    if (!file || !facets) {
      return `<div class="supported cardsearch">
        <div class="sethead">Card search</div>
        <p class="note dim">Loading the card list…</p>
      </div>`;
    }
    const selected = this.selectedCard();
    return `
      <div class="supported cardsearch">
        <div class="sethead">Card search</div>
        <p class="note">
          All ${file.cards.length} cards in the game. Each one says whether this
          platform plays it — ${file.cards.filter((c) => c.status === "playable").length}
          of them do, and the rest are here so you can see what a list of
          yours would be missing.
        </p>
        ${searchPanelMarkup(this.cardQuery, facets, this.advancedOpen, this.cardView)}
        ${selected ? cardDetailMarkup(selected) : ""}
        <div id="cs-results">${this.cardResultsMarkup()}</div>
      </div>`;
  }

  /** The card whose detail is open, or null — re-derived, never stored. */
  private selectedCard(): CatalogCard | null {
    if (this.selectedCardId === null) return null;
    return this.catalog?.cards.find((c) => c.id === this.selectedCardId) ?? null;
  }

  /**
   * The results block, and the ONE place it is built.
   *
   * Typing replaces only this block, so the search box keeps its cursor
   * (the alternative is a full repaint that throws the caret away on
   * every keystroke); everything else repaints the whole screen. Both
   * paths call this, so the two cannot disagree about what a result looks
   * like — "one question asked in two places will drift".
   */
  private cardResultsMarkup(): string {
    const file = this.catalog;
    if (!file) return "";
    const results = searchCards(file.cards, this.cardQuery);
    return resultsMarkup(results, {
      view: this.cardView,
      selectedId: this.selectedCardId,
      total: file.cards.length,
      page: this.cardPage,
      pageSize: this.cardPageSize,
      // NULL, not `{}`, when no deck is open: `{}` means "an empty deck
      // is being edited" and would draw a + on every card in the
      // standalone Card search tab.
      counts: this.deckTab === "build" ? (this.draft?.counts ?? null) : null,
    });
  }

  /**
   * The hover preview for every tab of the Deck Builder.
   *
   * The table has its own (`wireZoom` in loop.ts), and this matches it —
   * same panel, same fading name, same placement — with one difference
   * that is the reason it is not simply shared: the table looks a card's
   * text up in the REGISTRY, and most cards here are not in it. So the
   * hover names a card by catalogue id (`data-zoomid`) and reads the
   * scan and the text from the CATALOGUE, which knows all 4,149.
   *
   * Every handler checks `this.screen` first. The table renders into the
   * same root once a game starts, and it has its own `#zoom`; these must
   * not start moving that one around.
   */
  private wireZoom(): void {
    const active = (): boolean => this.screen === "deckbuilder" && this.catalogIndex !== null;
    const panel = (): HTMLDivElement | null => this.root.querySelector<HTMLDivElement>("#zoom");
    const place = (p: HTMLDivElement): void => {
      // The table's own arithmetic: beside the pointer, never off screen.
      const pad = 16;
      const w = p.offsetWidth || 300;
      const h = p.offsetHeight || 460;
      const x = Math.min(this.pointer.x + pad, window.innerWidth - w - pad);
      const y = Math.min(Math.max(pad, this.pointer.y - h / 2), window.innerHeight - h - pad);
      p.style.left = `${Math.max(pad, x)}px`;
      p.style.top = `${Math.max(pad, y)}px`;
    };

    this.root.addEventListener("mouseover", (ev) => {
      if (!active()) return;
      const target = (ev.target as HTMLElement).closest<HTMLElement>("[data-zoomid]");
      const p = panel();
      if (!target || !p) return;
      const card = this.catalogIndex!.byId.get(Number(target.dataset["zoomid"]));
      const img = p.querySelector("img");
      const text = p.querySelector<HTMLDivElement>(".zoomtext");
      const name = p.querySelector<HTMLDivElement>(".zoomname");
      if (!card || !img || !text || !name) return;
      img.src = card.image;
      text.textContent = card.text;
      // The name fades, as on the table; restarting the animation is what
      // makes it fade again for the NEXT card, not only the first.
      if (name.textContent !== card.name) {
        name.textContent = card.name;
        name.classList.remove("fading");
        void name.offsetWidth;
        name.classList.add("fading");
      }
      p.hidden = false;
      place(p);
    });
    this.root.addEventListener("mouseout", (ev) => {
      if (!active()) return;
      if (!(ev.target as HTMLElement).closest("[data-zoomid]")) return;
      const p = panel();
      if (!p) return;
      p.hidden = true;
      const name = p.querySelector<HTMLDivElement>(".zoomname");
      if (name) name.textContent = "";
    });
    this.root.addEventListener("mousemove", (ev) => {
      this.pointer = { x: ev.clientX, y: ev.clientY };
      if (!active()) return;
      const p = panel();
      if (p && !p.hidden) place(p);
    });
    // A press is about to repaint (every +, every click on a card), and the
    // preview would otherwise sit over the very thing being pressed.
    this.root.addEventListener("mousedown", () => {
      if (!active()) return;
      const p = panel();
      if (p) p.hidden = true;
    });
  }

  /**
   * Fetch the catalogue, once, and repaint when it lands.
   *
   * Called on the way IN to the screen rather than from the render, so a
   * repaint cannot start a second download and a render stays a pure
   * function of state. The promise is cached in `loadCatalog` too, which
   * is the belt to this braces.
   */
  private ensureCatalog(): void {
    if (this.catalog || this.catalogError) return;
    void loadCatalog()
      .then((file) => {
        this.catalog = file;
        this.catalogFacets = facetsOf(file);
        this.catalogIndex = indexCatalog(file);
        if (this.screen === "deckbuilder") this.paint();
      })
      .catch((err: unknown) => {
        this.catalogError = `could not load the card list: ${(err as Error).message}`;
        if (this.screen === "deckbuilder") this.paint();
      });
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
          <button id="m-decks">Deck Builder</button>
          <button id="m-profile">Settings</button>
          <button id="m-leaderboard">Leaderboard</button>
          <button id="m-help">How to Play</button>
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
      </div>
      ${
        // The table's own panel, drawn by the same function (render.ts),
        // so the rules on the menu and at the table cannot drift apart.
        this.helpOpen ? howToPlayPanel(this.helpQuery, [...this.helpOpenSections]) : ""
      }`;
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
    // Legal-as-printed decks AND the half decks. A New Blood starter is
    // fully implemented — every card in it plays — it is simply half a
    // deck, which is a thing to LABEL rather than a thing to hide.
    const precons = supportedPrecons().filter((p) => p.playable || p.halfDeck);
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
      seat.deck === null ? "choose a deck" : labelForDeck(seat.deck);
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
            : `<div class="deckrow">
                 <button class="deckbtn" data-i="${i}">${esc(deckLabel)}</button>
                 ${
                   // RANDOM DECK, for a bot only (owner request). Filling
                   // four seats by hand is four trips through the picker
                   // to make a choice nobody is making on merit; a die
                   // beside the button does it in one click. Not offered
                   // for the host's own seat — choosing your deck is the
                   // one decision in this screen that is yours.
                   seat.kind === "ai"
                     ? `<button class="deckrand" data-i="${i}"
                                title="give this bot a random preconstructed deck">🎲</button>`
                     : ""
                 }
               </div>`
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
  /**
   * WHICH SECTIONS OF THE DECK PICKER ARE OPEN.
   *
   * Every section is COLLAPSED BY DEFAULT (owner request): seven precon
   * sets, your own decks, a paste box and a save box is several screens
   * of panel, and a player who knows which set they want was scrolling
   * past the other six to reach it.
   *
   * The open set is view state HERE rather than left to the browser's own
   * `<details>` memory, because a repaint is `innerHTML =` and destroys
   * every element: saving a deck to the library repaints this panel while
   * it is still open, and without this every section would snap shut
   * underneath the player. Same treatment as the How to Play sections
   * (`helpOpenSections` in loop.ts).
   */
  private deckSectionsOpen = new Set<string>();

  /** One collapsible section of the deck picker. The key is what
   *  `deckSectionsOpen` remembers, so it must be stable across repaints —
   *  a set name or a fixed literal, never an index. */
  private deckSection(key: string, title: string, body: string): string {
    return `
      <details class="decksec" data-sec="${esc(key)}" ${this.deckSectionsOpen.has(key) ? "open" : ""}>
        <summary class="sethead">${esc(title)}</summary>
        ${body}
      </details>`;
  }

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
            ? this.deckSection(
                "mine",
                `Your decks (${saved.length})`,
                `<div class="preconset">
                 ${saved
                   .map((d) => {
                     const s = deckSummary(d.source);
                     return `<button class="mydeck ${s.ok ? "" : "broken"}"
                                     data-i="${i}" data-deck="${esc(d.name)}"
                                     ${s.ok ? "" : "disabled"}
                                     title="${esc(s.detail)}">${esc(d.name)}</button>`;
                   })
                   .join("")}
               </div>`,
              )
            : ""
        }
        <div class="sethead">Preconstructed decks</div>
        ${[...bySet.entries()]
          .map(
            ([set, list]) =>
              this.deckSection(
                `set:${set}`,
                `${set} (${list.length})`,
                `<div class="preconset">
              ${list
                .map((p) => {
                  // The play-style line is the button's tooltip AND its
                  // second line: a player choosing blind should be able
                  // to tell a combat deck from a vote deck without
                  // opening 60 cards.
                  const style = preconStyle(p.name);
                  // The set travels WITH the name. The panel groups by set
                  // already, but a player scrolling it reads the button,
                  // not the heading it scrolled past — and the clan names
                  // repeat across sets, so "Malkavian" alone names two
                  // different decks.
                  const half = p.halfDeck
                    ? ` — half deck (${p.cryptCount} crypt, ${p.libraryCount} library); not legal on its own, p. 14`
                    : "";
                  return `<button class="precon" data-i="${i}" data-set="${esc(p.set)}"
                                  data-name="${esc(p.name)}"
                                  title="${esc(`${p.name} — ${p.set}${half}${style ? `. ${style}` : ""}`)}">
                            <span class="ptitle">
                              <span class="pname">${esc(p.name)}</span>
                              <span class="pset">${esc(p.set)}${p.halfDeck ? " · half deck" : ""}</span>
                            </span>
                            ${style ? `<span class="pstyle">${esc(style)}</span>` : ""}
                          </button>`;
                })
                .join("")}</div>`,
              ),
          )
          .join("")}
        ${this.deckSection(
          "paste",
          "…or paste a deck list",
          `<p class="note">
          From VDB, Amaranth, ARDB, JOL, Lackey or the TWD archive — any of
          their text exports. Unknown or unimplemented cards are reported,
          never dropped.
        </p>
        <textarea class="pastebox" data-i="${i}" rows="6"
                  placeholder="2x Blood Doll&#10;..."></textarea>
        <div class="row">
          <button class="pasteuse primary" data-i="${i}">Use this list</button>
        </div>
        <p class="note">
          Save the pasted list under a name and it appears at the top of
          this panel every time — here, and in a lobby.
        </p>
        <div class="row">
          <input class="deckname" data-i="${i}" maxlength="${MAX_DECK_NAME}"
                 placeholder="My Malkavian deck" />
          <button class="decksave" data-i="${i}">Save to my decks</button>
        </div>`,
        )}
        ${this.deckError ? `<p class="err">${esc(this.deckError)}</p>` : ""}
        <!--
          CLOSE LIVES OUTSIDE THE SECTIONS. It used to sit in the row
          beside "Use this list"; with every section collapsed by default
          that put the only way out of the picker inside a fold, and a
          modal you cannot dismiss is a trap.
        -->
        <div class="row deckfoot">
          <button class="deckclose" data-i="${i}">Close</button>
        </div>
      </div>`;
  }

  private setsNote(): string {
    return `
      <details class="supported">
        <summary>What this client can play</summary>
        <p class="note"><b>Sets:</b> ${supportedSets().map(esc).join(", ")}.</p>
        <p class="note">
          <b>Precon decks:</b>
          ${supportedPrecons().filter((p) => p.playable).length} playable as printed,
          plus ${supportedPrecons().filter((p) => p.halfDeck).length} New Blood
          starters. Every card in a starter plays, but a starter is half a
          deck by design — under p. 14's minimums — so it is offered
          labelled <i>half deck</i> and is not a tournament-legal deck.
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
    // TWO WAYS IN, ONE PATH: the menu button and the pointer left behind
    // on the Profile screen where the decks used to be. Both have to
    // start the catalogue loading, so neither may be the one that knows
    // to do it — `go` does, for this screen.
    this.on("#m-decks, #p-decks", () => this.go("deckbuilder"));
    this.on("#m-profile", () => this.go("profile"));
    this.on("#m-leaderboard", () => this.go("leaderboard"));
    this.wireHelp();
    this.on("#lb-back, #pback, #join-back, #db-back", () => this.go("menu"));
    // --- looking at a saved deck (owner request, 2026-09-22) ---
    this.on(".deckopen", (el) => {
      this.viewingDeck = el.dataset["deck"] ?? null;
      this.deckError = "";
      this.paint();
    });
    this.on("#dv-back", () => {
      this.viewingDeck = null;
      this.paint();
    });
    this.on("#dv-edit", () => {
      const name = this.viewingDeck;
      const saved = name ? findDeck(name) : null;
      if (!saved) return;
      // The SAME path the Build tab's "open one of your decks" takes, so
      // a deck opened from the viewer is bound to its saved name exactly
      // as it would be the other way in — and Save overwrites rather
      // than duplicating.
      this.openSavedDraft(saved.name, saved.source);
      this.viewingDeck = null;
      this.deckTab = "build";
      this.paint();
    });
    // Clicking a card in a deck opens its detail — in the builder AND in
    // the viewer, which is why it is bound out here rather than inside
    // `wireDeckBuild`'s build-tab guard. Bound once, so the toggle works.
    this.on(".dbcard", (el) => {
      const id = Number(el.dataset["card"]);
      if (!Number.isFinite(id)) return;
      this.selectedCardId = this.selectedCardId === id ? null : id;
      this.paint();
    });
    this.on("#dk-grid", () => {
      this.deckCardView = "grid";
      this.paint();
    });
    this.on("#dk-list", () => {
      this.deckCardView = "list";
      this.paint();
    });

    this.on(".dbtab", (el) => {
      const tab = el.dataset["tab"];
      if (tab !== "decks" && tab !== "build" && tab !== "search") return;
      this.deckTab = tab;
      // Leaving the My decks tab closes whatever deck was open on it, so
      // coming back lands on the list rather than on a deck you have
      // since stopped thinking about.
      if (tab !== "decks") this.viewingDeck = null;
      // The deck error belongs to the decks tab; carrying it onto the
      // search would leave a message pointing at a panel that is no
      // longer on screen.
      this.deckError = "";
      this.paint();
    });
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
      // THE VIEWER IS KEYED BY NAME, so deleting the deck you are looking
      // at leaves it pointing at nothing. Go back to the list rather than
      // showing "that deck is no longer there" about something the person
      // has just deleted on purpose.
      if (this.viewingDeck === name) this.viewingDeck = null;
      this.deckError = "";
      this.paint();
    });
    this.on(".deckrename", (el) => {
      const from = el.dataset["deck"] ?? "";
      const to = prompt("New name for this deck:", from);
      // Cancelled, or unchanged — not an error, and not a rename.
      if (to === null || to.trim() === from) return;
      this.deckError = renameDeck(from, to) ?? "";
      // FOLLOW THE RENAME, for the same reason: the viewer is keyed by
      // name, so without this the deck you have just renamed reads as
      // gone. Only on success — a refused rename leaves the old name in
      // place, and the viewer must stay on it.
      if (this.viewingDeck === from && this.deckError === "") {
        this.viewingDeck = to.trim();
      }
      this.paint();
    });
    this.on("#m-exit", () => {
      // A browser tab cannot reliably close itself, so say so rather than
      // wiring a button that does nothing on most machines.
      this.root.innerHTML = `<div class="shell"><div class="card">
        <h1>Goodbye</h1><p class="note">You can close this tab now.</p></div></div>`;
    });

    this.wireProfile();
    this.on("[data-stab]", (el) => {
      const tab = el.dataset["stab"];
      if (tab !== "profile" && tab !== "bots" && tab !== "controls") return;
      this.settingsTab = tab;
      this.keyCapturing = null;
      this.paint();
    });
    wireControls(
      this.root,
      (a) => {
        this.keyCapturing = a;
        this.paint();
      },
      {
        get: () => loadSettings().keybinds,
        set: (binds) => saveSettings({ ...loadSettings(), keybinds: binds }),
      },
    );
    this.wireDeckBuild();
    this.wireCardSearch();
    this.wireNewGame();
    this.wireLobby();
    this.wireJoin();
  }

  /**
   * The card search's controls.
   *
   * Two kinds of handler, and the split is the whole design. A control
   * that CHANGES THE SHAPE of the screen (view toggle, opening a card,
   * opening the advanced panel) repaints it whole, the way every other
   * screen in the shell works. TYPING does not: a repaint would destroy
   * the input the person is still using, so the search box updates only
   * the results block. Both render through `cardResultsMarkup`, so there
   * is one answer to "what does a result look like" and it cannot drift.
   */
  /**
   * Change the search, and GO BACK TO PAGE ONE.
   *
   * The one place a query is replaced, because the page number has to
   * move with it and there are five ways to change a query — typing, a
   * multi-select, a single select, a numeric bound and the reset button.
   * Five sites resetting the page by hand is five chances to forget one,
   * and the symptom is nasty and quiet: type a narrower search while on
   * page 12 and you get an empty result area that looks exactly like
   * "nothing matched" (CLAUDE.md, "one question asked in two places").
   */
  private setCardQuery(q: CardQuery): void {
    this.cardQuery = q;
    this.cardPage = 1;
  }

  /**
   * The menu's How to Play panel — the same handlers the table's panel
   * has (loop.ts `wireHelp`), on the same element ids, because it is the
   * same panel. Every element here is recreated by each paint, so these
   * per-element listeners cannot stack up the way root-level ones would.
   */
  private wireHelp(): void {
    this.on("#m-help", () => {
      this.helpOpen = true;
      this.paint();
    });
    this.on("#help-close, #help-scrim", () => {
      this.helpOpen = false;
      this.paint();
    });

    // Searching repaints on every keystroke, so the caret is put back
    // afterwards — or the second letter would land before the first.
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

    // `toggle` does not bubble, so each section is wired on its own.
    this.root.querySelectorAll<HTMLDetailsElement>(".rulesec").forEach((el) => {
      el.addEventListener("toggle", () => {
        const id = el.dataset["rule"];
        if (!id) return;
        if (el.open) this.helpOpenSections.add(id);
        else this.helpOpenSections.delete(id);
      });
    });
  }

  /**
   * The builder's controls.
   *
   * Only the ones the BUILD tab owns. The + and − on a search result are
   * wired in `wireCardResults` with the rest of the results block,
   * because that block is replaced on every keystroke and a handler
   * bound here would be lost the moment somebody typed.
   */
  private wireDeckBuild(): void {
    if (this.screen !== "deckbuilder" || this.deckTab !== "build") return;
    const find = <T extends HTMLElement>(sel: string): T | null =>
      this.root.querySelector<T>(sel);

    // --- starting a deck ---
    this.on("#db-openprecon", () => {
      const pick = find<HTMLSelectElement>("#db-precon")?.value ?? "";
      const [set, name] = pick.split("|");
      if (!set || !name) {
        this.draftError = "choose a precon first";
        this.paint();
        return;
      }
      this.openPreconDraft(set, name);
    });
    this.on("#db-opensaved", () => {
      const name = find<HTMLSelectElement>("#db-saved")?.value ?? "";
      const deck = name ? findDeck(name) : null;
      if (!deck) {
        this.draftError = "choose one of your decks first";
        this.paint();
        return;
      }
      this.openSavedDraft(deck.name, deck.source);
    });
    this.on("#db-scratch", () => {
      this.draft = emptyDraft("");
      this.draftUnreadable = [];
      this.draftError = "";
      this.markDraftClean();
      this.paint();
    });

    // --- editing one ---
    // CLOSING ASKS WHEN THERE IS SOMETHING TO LOSE (owner request,
    // 2026-09-22). This replaces an earlier "no confirm" on the reasoning
    // that nothing unsaved mattered — it did. Only a DIRTY draft asks: a
    // deck opened and closed untouched has nothing to save, and a
    // question there would be friction for nothing.
    this.on("#db-close", () => {
      if (this.isDraftDirty()) {
        this.closeAsk = true;
        this.paint();
        return;
      }
      this.closeDraft();
    });
    // The dialog's two answers. "Close" is the second press of Close and
    // closes for real; "Save" saves and THEN closes — but only if the save
    // went through. A refused save (no name) or a cancelled overwrite
    // leaves the deck open with the reason on screen.
    this.on("#db-close-save", () => {
      this.closeAsk = false;
      if (this.saveDraft()) this.closeDraft();
      else this.paint();
    });
    this.on("#db-close-discard", () => {
      this.closeAsk = false;
      this.closeDraft();
    });
    // Clicking outside the dialog backs out of it and keeps editing — the
    // way out that is neither answer.
    this.on("#db-close-scrim", () => {
      this.closeAsk = false;
      this.paint();
    });
    this.on("#db-save", () => this.saveDraft());
    this.on("#db-onlyplayable", () => {
      // The search filter the warning is about, applied for you. It is a
      // normal query change, so it goes through the one setter and
      // resets the page like any other.
      this.setCardQuery({ ...this.cardQuery, status: "playable" });
      this.paint();
    });
    this.on("#db-stripunplayable", () => {
      const draft = this.draft;
      if (!draft || !this.catalog) return;
      const { byId } = indexCatalog(this.catalog);
      const doomed = reviewDraft(draft, byId).unplayable;
      if (doomed.length === 0) return;
      if (!confirm(`Remove ${doomed.length} card(s) this player cannot deal?`)) return;
      let next = draft;
      for (const u of doomed) next = setCount(next, u.card.id, 0);
      this.draft = next;
      this.paint();
    });

    // The name box is not a repaint: typing in it would lose the caret,
    // exactly as the search box would. It is read at save time instead.
    const name = find<HTMLInputElement>("#db-name");
    name?.addEventListener("input", () => {
      if (this.draft) this.draft = { ...this.draft, name: name.value };
    });

    // Ticking it repaints, because it changes the verdict and both
    // meters at once — the one control on this panel whose effect is
    // entirely in what the panel says.
    const half = find<HTMLInputElement>("#db-half");
    half?.addEventListener("change", () => {
      if (!this.draft) return;
      // The half-typed name would be thrown away by the repaint, so it
      // is taken off the box first — the same reason `keepProfileDraft`
      // exists on the Profile screen.
      const typed = find<HTMLInputElement>("#db-name")?.value;
      this.draft = {
        ...this.draft,
        halfDeck: half.checked,
        name: typed ?? this.draft.name,
      };
      this.paint();
    });

    const scope = find<HTMLInputElement>("#db-scope");
    scope?.addEventListener("change", () => {
      this.scopeToCrypt = scope.checked;
      // A narrower list can leave you past the end of it.
      this.cardPage = 1;
      this.paint();
    });
    this.on("#db-scopeon", () => {
      this.scopeToCrypt = true;
      this.cardPage = 1;
      this.paint();
    });

    this.on(".dbless", (el) => this.bumpCard(el, -1));
    this.on(".dbmore", (el) => this.bumpCard(el, +1));
    // `.dbcard` is wired in `wire()`, NOT here. It exists on the deck
    // viewer too, and binding it in both places would fire the toggle
    // twice — opening and immediately closing the card, which looks
    // exactly like a button that does nothing.
  }

  /**
   * The draft as it was last opened or saved, as deck text — what "unsaved
   * changes" is measured against.
   *
   * TEXT, not a flag set by each edit. A flag has to be remembered at every
   * place a draft changes (four +/− controls, the name box, the half-deck
   * box, "remove unplayable"…) and the one that forgets it is a close that
   * silently loses work. Comparing the serialised deck asks the question
   * directly, and adding a card and removing it again is correctly clean.
   */
  private draftBaseline: string | null = null;
  /** The "save before closing?" dialog is up. */
  private closeAsk = false;

  private draftSnapshot(): string | null {
    if (!this.draft || !this.catalogIndex) return null;
    return draftToText(this.draft, this.catalogIndex.byId);
  }

  private markDraftClean(): void {
    this.draftBaseline = this.draftSnapshot();
  }

  private isDraftDirty(): boolean {
    const now = this.draftSnapshot();
    return now !== null && now !== this.draftBaseline;
  }

  private closeDraft(): void {
    this.draft = null;
    this.draftUnreadable = [];
    this.draftError = "";
    this.draftBaseline = null;
    this.closeAsk = false;
    this.paint();
  }

  /**
   * "Save this deck before closing?" — an in-page dialog rather than the
   * browser's `confirm`, because the answer has two NAMED buttons the
   * owner asked for, Save and Close, and `confirm` only offers OK and
   * Cancel, which would have to be mapped onto them and read wrongly.
   */
  private closeDialog(draft: DeckDraft): string {
    const name = draft.name.trim() || "this deck";
    return `
      <div class="dbscrim" id="db-close-scrim"></div>
      <div class="dbclosecard" role="dialog" aria-label="Save before closing">
        <h2>Save ${esc(name)} before closing?</h2>
        <p class="note">
          It has changes that are not saved. <b>Close</b> again to close it
          without saving them.
        </p>
        <div class="row">
          <button id="db-close-save" class="primary">Save</button>
          <button id="db-close-discard" class="danger">Close</button>
        </div>
      </div>`;
  }

  /** One card, one step, from any of the four +/− controls. */
  private bumpCard(el: HTMLElement, delta: number): void {
    const id = Number(el.dataset["card"]);
    if (!Number.isFinite(id) || !this.draft) return;
    this.draft = withCard(this.draft, id, delta);
    this.draftError = "";
    this.paint();
  }

  /**
   * A precon expanded into a draft, named exactly as the precon is.
   *
   * Pulled out of `openPreconDraft` so the deck VIEWER can expand a
   * saved precon the same way — a precon has no deck text of its own, and
   * two expansions would be two chances to tally it differently.
   */
  private preconDraft(set: string, name: string): DeckDraft | null {
    const deck = preconDeck(set, name, "You");
    if (!deck || !this.catalog) return null;
    const { byName } = indexCatalog(this.catalog);
    const isHalf = supportedPrecons().some(
      (p) => p.set === set && p.name === name && p.halfDeck,
    );
    let draft = emptyDraft(name, isHalf);
    // A PRECON IS A DECKLIST, ONE ENTRY PER COPY — the builder counts
    // copies, so it is tallied rather than assigned. Assigning would
    // leave every card at one copy and quietly halve the deck.
    for (const v of deck.crypt) draft = withCard(draft, v.id, 1);
    for (const cardName of deck.library) {
      const card = byName.get(cardName.toLowerCase());
      if (card) draft = withCard(draft, card.id, 1);
    }
    return draft;
  }

  private openPreconDraft(set: string, name: string): void {
    const built = this.preconDraft(set, name);
    if (!built) {
      this.draftError = "that precon could not be read";
      this.paint();
      return;
    }
    // A NEW BLOOD STARTER ARRIVES WITH THE HALF-DECK BOX ALREADY TICKED —
    // `preconDraft` sets it, because for a precon the answer is known and
    // asking would leave the deck reading as illegal until somebody
    // answered a question the screen could already answer.
    //
    // The "(copy)" is added HERE rather than in `preconDraft`: a precon
    // opened to be EDITED is a new deck, but one opened to be READ is
    // still the printed deck and should be called by its name.
    this.draft = { ...built, name: `${name} (copy)` };
    this.draftUnreadable = [];
    this.markDraftClean();
    // A precon opens as a NEW deck, never bound to the printed one:
    // `savedAs` stays null, so Save writes a new entry rather than
    // overwriting something that came in a box.
    this.draftError = "";
    this.paint();
  }

  private openSavedDraft(name: string, source: DeckSource): void {
    if (!this.catalog) return;
    const { byName } = indexCatalog(this.catalog);
    // A saved deck is either pasted text or a named precon. Both end up
    // as text, so there is one path through the parser.
    let text: string;
    if (source.kind === "paste") {
      text = source.text;
    } else {
      const deck = preconDeck(source.set, source.name, "You");
      if (!deck) {
        this.draftError = "that deck could not be read";
        this.paint();
        return;
      }
      this.openPreconDraft(source.set, source.name);
      return;
    }
    const { draft, unreadable } = parseDraft(text, byName);
    this.draft = { ...draft, name: draft.name.trim() === "" ? name : draft.name, savedAs: name };
    this.draftUnreadable = unreadable;
    this.markDraftClean();
    this.draftError = "";
    this.paint();
  }

  /**
   * Save the draft into the SAME store every other deck lives in.
   *
   * It is written as the deck-list text `importDeck` reads, which is why
   * a deck built here needs no new plumbing: it appears in My decks, in
   * every seat's deck panel and in the lobby, indistinguishable from one
   * that was pasted in.
   *
   * An ILLEGAL DECK STILL SAVES. A draft is work in progress, and a
   * builder that refused to keep a 40-card deck would be a builder you
   * could not use to build. The legality panel says what is wrong the
   * whole time, and `deckSummary` says it again wherever the deck is
   * picked, so nothing can be taken to a table by mistake.
   */
  /**
   * Save the draft. Returns whether it was SAVED — the close dialog needs
   * to know, because "Save" there means "save, and then close", and a
   * save that was refused or cancelled must leave the deck open.
   */
  private saveDraft(): boolean {
    const draft = this.draft;
    if (!draft || !this.catalog) return false;
    const box = this.root.querySelector<HTMLInputElement>("#db-name");
    const name = (box?.value ?? draft.name).trim();
    if (name === "") {
      this.draftError = "give this deck a name before saving it";
      this.paint();
      return false;
    }
    const { byId } = indexCatalog(this.catalog);
    if (Object.keys(draft.counts).length === 0) {
      this.draftError = "there is nothing in this deck to save";
      this.paint();
      return false;
    }
    // WHICH DECK, IF ANY, IS THIS ABOUT TO LAND ON? Matched without case,
    // the same way `deckNameProblem` decides two names collide — so the
    // question asked here and the rule enforced underneath cannot give
    // different answers.
    const clash = findDeckLoosely(name);
    // EVERY SAVE THAT REPLACES A SAVED DECK ASKS FIRST — including the
    // deck you opened, under the name you opened it with (owner request,
    // 2026-09-22). 0.11.12 exempted that case as "not a collision", and it
    // is not one; but it IS an overwrite, and the saved copy is the only
    // other copy there is. A rename-in-place of an opened deck replaces it
    // too, so `draft.savedAs` asks even when the new name lands on nothing.
    //
    // The question names the deck that will be LOST, which is the clash
    // when there is one and the opened deck otherwise.
    const replaced = clash?.name ?? draft.savedAs;
    if (replaced !== null) {
      const sameDeck = replaced === draft.savedAs;
      const question = sameDeck
        ? `Overwrite your saved deck "${replaced}" with these changes?`
        : `You already have a deck called "${replaced}". Overwrite it?`;
      if (!confirm(question)) {
        // Answering no leaves the draft exactly as it was, still open and
        // still unsaved — it is a cancelled save, not a failed one, so it
        // does not set `draftError`.
        return false;
      }
    }
    const source: DeckSource = { kind: "paste", text: draftToText({ ...draft, name }, byId) };
    // ONLY ONE CASE NEEDS A DELETE: renaming this deck ONTO a different
    // one that already exists. Then two entries would survive — the
    // overwritten target and the abandoned original — so the original
    // goes. A plain rename must NOT delete, because `replaceDeck` renames
    // the entry in place and keeps its position and its created date.
    const failed = (() => {
      if (clash && draft.savedAs && clash.name !== draft.savedAs) {
        deleteDeck(draft.savedAs);
        return replaceDeck(clash.name, name, source);
      }
      if (clash) return replaceDeck(clash.name, name, source);
      if (draft.savedAs) return replaceDeck(draft.savedAs, name, source);
      return saveDeck(name, source);
    })();
    if (failed) {
      this.draftError = failed;
      this.paint();
      return false;
    }
    this.draft = { ...draft, name, savedAs: name };
    this.draftError = "";
    // What is on disk now matches what is on screen, so closing after this
    // has nothing to ask about.
    this.markDraftClean();
    this.paint();
    return true;
  }

  private wireCardSearch(): void {
    if (this.screen !== "deckbuilder") return;
    const find = <T extends HTMLElement>(sel: string): T | null =>
      this.root.querySelector<T>(sel);

    // Typing: results only, so the caret survives. The results are
    // rewired afterwards because they are new nodes.
    const box = find<HTMLInputElement>("#cs-q");
    box?.addEventListener("input", () => {
      this.setCardQuery({ ...this.cardQuery, text: box.value });
      const slot = find<HTMLElement>("#cs-results");
      if (!slot) return;
      slot.innerHTML = this.cardResultsMarkup();
      this.wireCardResults();
    });

    // A multi-select hands back its chosen options; a single one hands
    // back a value. Both repaint, because a filter change can empty the
    // list and the counts beside each label have to move with it.
    const multi = (sel: string, key: keyof CardQuery): void => {
      const el = find<HTMLSelectElement>(sel);
      el?.addEventListener("change", () => {
        const chosen = Array.from(el.selectedOptions).map((o) => o.value);
        this.setCardQuery({ ...this.cardQuery, [key]: chosen });
        this.paint();
      });
    };
    const single = (sel: string, apply: (v: string) => Partial<CardQuery>): void => {
      const el = find<HTMLSelectElement>(sel);
      el?.addEventListener("change", () => {
        this.setCardQuery({ ...this.cardQuery, ...apply(el.value) });
        this.paint();
      });
    };
    const bound = (sel: string, key: "capacityMin" | "capacityMax" | "costMin" | "costMax"): void => {
      const el = find<HTMLInputElement>(sel);
      el?.addEventListener("change", () => {
        // AN EMPTY BOX IS "NO BOUND", NOT ZERO. `Number("")` is 0, which
        // would silently turn a cleared "cost from" into "cost at least
        // 0" — true of every card, so it would look like it worked while
        // meaning something else the day a card costs nothing.
        const raw = el.value.trim();
        const value = raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw);
        this.setCardQuery({ ...this.cardQuery, [key]: value });
        this.paint();
      });
    };

    multi("#cs-types", "types");
    multi("#cs-clans", "clans");
    multi("#cs-disc", "disciplines");
    multi("#cs-sects", "sects");
    multi("#cs-titles", "titles");
    multi("#cs-groups", "groups");
    multi("#cs-sets", "sets");
    single("#cs-pile", (v) => ({ pile: v as CardQuery["pile"] }));
    single("#cs-scope", (v) => ({ scope: v as SearchScope }));
    single("#cs-status", (v) => ({ status: v as CardQuery["status"] }));
    single("#cs-sort", (v) => ({ sort: v as SortKey }));
    single("#cs-sortdir", (v) => ({ sortDir: v as SortDir }));
    single("#cs-discmode", (v) => ({ disciplineMode: v as CardQuery["disciplineMode"] }));
    bound("#cs-capmin", "capacityMin");
    bound("#cs-capmax", "capacityMax");
    bound("#cs-costmin", "costMin");
    bound("#cs-costmax", "costMax");

    this.on("#cs-adv", () => {
      this.advancedOpen = !this.advancedOpen;
      this.paint();
    });
    this.on("#cs-reset", () => {
      // The TEXT survives a filter reset: the button says "clear
      // filters", and throwing away what somebody typed as well would be
      // doing more than it says.
      //
      // READ FROM `this`, NOT FROM A SNAPSHOT TAKEN WHEN THE HANDLER WAS
      // BOUND. Typing replaces `this.cardQuery` with a new object and
      // does NOT repaint, so a `const q` captured at wiring time holds
      // the text as it was before the person typed — and "clear filters"
      // would quietly put the old search back.
      this.setCardQuery({ ...this.defaultCardQuery(), text: this.cardQuery.text });
      this.paint();
    });
    this.on("#cs-grid", () => {
      this.cardView = "grid";
      this.paint();
    });
    this.on("#cs-list", () => {
      this.cardView = "list";
      this.paint();
    });
    this.on("#cs-close", () => {
      this.selectedCardId = null;
      this.paint();
    });
    this.wireCardResults();
  }

  /**
   * Everything INSIDE the results block — re-run whenever it is redrawn.
   *
   * The pager and the per-page dropdown live in that block, so typing
   * replaces their nodes and takes their listeners with them. They are
   * bound here rather than in `wireCardSearch` for that reason: a
   * handler bound to a node that has since been thrown away is a control
   * that silently stops working, and only after the person has typed.
   */
  private wireCardResults(): void {
    this.on(".cspage", (el) => {
      const to = Number(el.dataset["page"]);
      if (!Number.isFinite(to)) return;
      // Not clamped here: `paginate` is the only thing that knows how
      // many pages there are, and it clamps on the way out.
      this.cardPage = to;
      this.paint();
    });

    const size = this.root.querySelector<HTMLSelectElement>("#cs-size");
    size?.addEventListener("change", () => {
      const n = Number(size.value);
      if (!PAGE_SIZES.includes(n)) return;
      this.cardPageSize = n;
      // BACK TO PAGE ONE. Page 9 of 30-a-page is past the end at 100 a
      // page, and "show me more per page" landing on an empty screen is
      // the opposite of what was asked for.
      this.cardPage = 1;
      this.paint();
    });

    // The add controls on a search result. Bound HERE rather than in
    // `wireDeckBuild` because they live in the block that typing
    // replaces — the whole point of the split.
    this.on(".csmore", (el) => this.bumpCard(el, +1));
    this.on(".csless", (el) => this.bumpCard(el, -1));

    this.on(".cscard, .csrow", (el) => {
      const id = Number(el.dataset["card"]);
      if (!Number.isFinite(id)) return;
      // Clicking the open card closes it — the same toggle the seat deck
      // panel uses, so the two behave alike.
      this.selectedCardId = this.selectedCardId === id ? null : id;
      this.paint();
    });
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
      // The row saves as a ROW. Two save buttons in one panel would be a
      // worse UI than one that saves what is in front of you.
      settings.botPlaystyles = Array.from(
        this.root.querySelectorAll<HTMLSelectElement>(".botstyle"),
        (sel) => sel.value,
      );
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
      // Reset means the whole row, styles included — back to Default,
      // which is "play to suit the deck".
      settings.botPlaystyles = [];
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
      passTimeoutMs: loadSettings().passTimeoutMs,
      // NO OPENING BEAT. That pause exists so a fresh deal does not open
      // on a board the bots have already played; a load lands mid-game,
      // where a hold before the next move reads as the load having hung.
      // `restart` makes the same distinction, for the same reason.
    });
    for (const seat of bots.seats) {
      // The save records how each bot was PLAYING; without it the seat
      // falls back to balanced, which is what an older save means.
      const saved = game.botPlaystyles?.[seat];
      transport.setAgent(
        seat,
        botAgentFor(seat, playstyleOf({ playstyle: saved }) ? { playstyle: playstyleOf({ playstyle: saved })! } : {}),
      );
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

    // THE DIE. Playable-as-printed precons only: a New Blood starter is
    // half a deck by design (p. 14's two minimums), so handing one to a
    // bot at random would deal a seat that cannot legally play — the
    // chooser offers them labelled, which is a different thing from
    // picking one for somebody.
    //
    // `Math.random`, not the seeded RNG: this happens in the lobby,
    // BEFORE the game exists. The deal's own seed still reproduces the
    // game from the decks it was given (principle 2) — what is random
    // here is which deck the owner asked for, not anything the engine
    // does with it.
    this.on(".deckrand", (el) => {
      const pool = supportedPrecons().filter((p) => p.playable);
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (pick) chooseDeck(seatAt(el), { kind: "precon", set: pick.set, name: pick.name });
    });

    // `toggle` does not bubble, so it is wired per section — and these
    // elements are rebuilt by every repaint, so the listeners cannot
    // stack up. No repaint of our own: the browser has already done the
    // only visible work.
    for (const el of Array.from(this.root.querySelectorAll<HTMLDetailsElement>(".decksec"))) {
      el.addEventListener("toggle", () => {
        const key = el.dataset["sec"];
        if (!key) return;
        if (el.open) this.deckSectionsOpen.add(key);
        else this.deckSectionsOpen.delete(key);
      });
    }
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
      // The saved NAME rides along, so the seat says what it is.
      if (deck)
        chooseDeck(
          seatAt(el),
          deck.source.kind === "paste" ? { ...deck.source, name: deck.name } : deck.source,
        );
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
      // The pass clock rides along for the same reason, though it is the
      // weaker case: `DebugApp` sets it too, and it re-arms against
      // whatever decision is on the table when it does. Setting it here
      // means a table that opens straight onto somebody's reaction window
      // is already clocked (docs/pass-timeout-design.md §1).
      passTimeoutMs: loadSettings().passTimeoutMs,
      openingDelayMs: OPENING_DELAY_MS,
    });
    const settings = loadSettings();
    botSeats(this.table).forEach((seat, i) => {
      transport.setAgent(
        seat,
        botAgentFor(seat, {
          settings,
          // 1-based and positional, matching the "Bot 1…5" boxes.
          botIndex: i + 1,
          deck: this.table.seats.find((s) => s.name === seat)?.deck ?? null,
        }),
      );
    });
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
      out[s.name] = labelForDeck(s.deck, "a pasted deck list");
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
