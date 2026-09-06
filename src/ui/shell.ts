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
import { clearResults, loadResults, recordResult, standings } from "./results.ts";
import { DebugApp } from "./loop.ts";
import type { ModerationView, SeatFace } from "./render.ts";
import { CHAT_EMOJI, chatLinesMarkup } from "./render.ts";
import type { DeckSource, SeatConfig, TableConfig } from "./newgame.ts";
import {
  botSeats,
  buildTable,
  defaultTable,
  isOnlineTable,
  seatDeckHash,
  seatRelations,
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
import { seatSeed } from "./settings.ts";
import { LocalTransport } from "./transport.ts";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

type Screen = "profile" | "menu" | "newgame" | "lobby" | "join" | "leaderboard" | "table" | "removed";

export class Shell {
  private screen: Screen;
  private profile: Profile | null;
  private table: TableConfig;
  private error = "";
  /** The last deck-library problem, shown where it happened. Separate from
   *  `error` so a failed save does not clear a lobby's message. */
  private deckError = "";
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
    this.table = defaultTable(this.profile?.name ?? "You");
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

  private go(screen: Screen): void {
    this.screen = screen;
    this.error = "";
    this.paint();
  }

  private paint(): void {
    if (this.screen === "table") return; // the table owns the root now
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
      case "removed":
        return this.removedScreen();
      default:
        return "";
    }
  }

  /** Why this client was shown the door, if it was. */
  private removedReason = "";

  /**
   * Removed from a table, and TOLD WHY.
   *
   * The reason is the host's own words, typed into the kick prompt and
   * carried in the `bye` the protocol already had. Without a screen for
   * it, being kicked was indistinguishable from the connection dropping —
   * and those two deserve very different reactions from the player.
   */
  private removedScreen(): string {
    return `
      <div class="card">
        <h1>You were removed from the table</h1>
        <p class="note">The host gave this reason:</p>
        <p class="err quoted">${esc(this.removedReason)}</p>
        <p class="note">
          A bot is playing your seat, so the game goes on without you. You
          can join another table whenever you like.
        </p>
        <div class="row">
          <button id="m-join" class="primary">Join another game</button>
          <button id="pback">Main menu</button>
        </div>
      </div>`;
  }

  // --- profile -------------------------------------------------------------

  private profileScreen(): string {
    const p = this.profile;
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
                 value="${esc(p?.name ?? "")}" placeholder="Methuselah" />
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
          <input id="pcolor" type="color" value="${esc(p?.chatColor ?? DEFAULT_CHAT_COLOR)}" />
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
  private relations(names: string[], i: number): string {
    const r = seatRelations(names, i);
    if (!r) return "";
    return `<span class="rel">prey ${esc(r.prey)} &middot; predator ${esc(r.predator)}</span>`;
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
    const names = this.table.seats.map((s) => s.name);
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
            ${this.relations(names, i)}
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
    const names = this.lobbyPeer?.state?.seats.map((x) => x.name) ?? [];
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
            ${this.relations(names, i)}
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
        ${
          this.chatSettingsOpen
            ? `<div class="chatsettings">
                 <label class="setrow">
                   <span>Your name colour</span>
                   <input type="color" id="chatcolor"
                          value="${esc(this.profile?.chatColor ?? DEFAULT_CHAT_COLOR)}" />
                 </label>
                 <p class="note">Saved to your profile — it follows you to every table.</p>
               </div>`
            : ""
        }
        ${chatLinesMarkup()}
        ${
          this.emojiOpen
            ? `<div class="emojipad" id="emojipad">
                 ${CHAT_EMOJI.map(
                   (e) => `<button class="emoji" data-emoji="${esc(e)}">${e}</button>`,
                 ).join("")}
               </div>`
            : ""
        }
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
               <p class="note dim">${results.length} game${
                 results.length === 1 ? "" : "s"
               } recorded.</p>`
        }
        <div class="row">
          <button id="lb-back">Back</button>
          ${results.length > 0 ? `<button id="lb-clear" class="danger">Clear history</button>` : ""}
        </div>
      </div>`;
  }

  // --- wiring --------------------------------------------------------------

  private on(sel: string, fn: (el: HTMLElement) => void): void {
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>(sel))) {
      el.addEventListener("click", () => fn(el));
    }
  }

  private wire(): void {
    this.on("#m-host", () => {
      this.table = defaultTable(this.profile?.name ?? "You");
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
    const colorBox = this.root.querySelector<HTMLInputElement>("#chatcolor");
    colorBox?.addEventListener("change", () => {
      if (!this.profile || colorProblem(colorBox.value)) return;
      this.profile = { ...this.profile, chatColor: colorBox.value };
      saveProfile(this.profile);
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
      this.table = defaultTable(profile.name);
      this.go("menu");
    });

    this.on("#pclear", () => {
      clearProfile();
      this.profile = null;
      this.go("profile");
    });
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
      this.table.seats.push({ name: `Bot ${n}`, kind: "ai", deck: null });
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
      onResult: recordResult,
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
    this.lobbyHost = new LobbyHost(code, this.table, (transport, session) =>
      this.toTable(transport, session),
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
    this.root.innerHTML = "";
    if (session) this.hostSession = session;
    // BEING REMOVED HAS TO BE SAID OUT LOUD. The host sends a `bye` with
    // the reason it was given; without this the table simply stopped
    // answering, which looks like the connection dropping rather than a
    // decision somebody made about you. The shell takes the root back.
    if (transport instanceof PeerTransport) {
      const offBye = transport.onChanged(() => {
        const reason = transport.closedReason;
        if (!reason) return;
        offBye();
        this.removedReason = reason;
        this.guestChannel = null;
        clearChat();
        this.screen = "removed";
        this.paint();
      });
    }
    const me = this.profile?.name ?? "You";
    const mine = this.profile?.chatColor ?? null;
    new DebugApp(this.root, transport, {
      faces: this.seatFaces(),
      localSeat: this.mySeat(),
      onLeave: () => this.leaveTable(),
      // The conversation carries on at the table. Who relays it depends on
      // which end this client is, and the table does not need to know:
      // it is handed one function that says something.
      say: (text: string) => {
        if (transport instanceof PeerTransport) transport.say(text);
        else if (this.hostSession) this.hostSession.say(text, me, false, mine);
        else addChat({ from: me, text, at: Date.now(), ...(mine ? { color: mine } : {}) });
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
      setChatColor: (color: string) => {
        if (!this.profile || colorProblem(color)) return;
        this.profile = { ...this.profile, chatColor: color };
        saveProfile(this.profile);
      },
    });
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
    const remote = this.lobbyPeer?.state?.seats;
    if (remote) {
      for (const s of remote) {
        faces[s.name] = { avatar: s.avatar ?? null, bot: s.kind === "ai" };
      }
      return faces;
    }
    const seats = this.lobbyHost?.seats ?? this.table.seats;
    // A seat a bot took over mid-game is RELABELLED, never renamed: the
    // seat name is the engine's id for it, so "Bea Bot" is a label the mat
    // draws and nothing else ever sees.
    const botNames = this.hostSession?.botSeatNames ?? {};
    for (const s of seats) {
      const label = botNames[s.name];
      faces[s.name] = {
        avatar: s.kind === "you" ? (this.profile?.avatar ?? null) : (s.avatar ?? null),
        bot: s.kind === "ai" || label !== undefined,
        ...(label ? { label } : {}),
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
