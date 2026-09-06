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
import { PeerTransport } from "../net/peer.ts";
import type { RoomHandle } from "../net/peerjs.ts";
import { hostRoom, joinRoom } from "../net/peerjs.ts";
import type { PeerChannel } from "../net/protocol.ts";
import { codeFromLink, isRoomCode, joinLink, newRoomCode, normaliseRoomCode } from "../net/room.ts";
import type { PreconSummary } from "./deckimport.ts";
import { supportedPrecons, supportedSets } from "./deckimport.ts";
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
import type { SeatFace } from "./render.ts";
import type { DeckSource, SeatConfig, TableConfig } from "./newgame.ts";
import {
  botSeats,
  buildTable,
  defaultTable,
  isOnlineTable,
  seatDeckHash,
  MAX_SEATS,
  MIN_SEATS,
  RECOMMENDED_SEATS,
} from "./newgame.ts";
import type { Profile } from "./profile.ts";
import {
  clearProfile,
  loadProfile,
  MAX_NAME_LENGTH,
  nameProblem,
  newProfile,
  saveProfile,
} from "./profile.ts";
import { seatSeed } from "./settings.ts";
import { LocalTransport } from "./transport.ts";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

type Screen = "profile" | "menu" | "newgame" | "lobby" | "join" | "leaderboard" | "table";

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
    this.paint();
  }

  private go(screen: Screen): void {
    this.screen = screen;
    this.error = "";
    this.paint();
  }

  private paint(): void {
    if (this.screen === "table") return; // the table owns the root now
    this.root.innerHTML = `<div class="shell">${this.body()}</div>`;
    this.wire();
  }

  private body(): string {
    switch (this.screen) {
      case "profile":
        return this.profileScreen();
      case "menu":
        return this.menuScreen();
      case "newgame":
        return this.newGameScreen();
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
        ${this.deckError ? `<p class="err">${esc(this.deckError)}</p>` : ""}
      </div>`;
  }

  // --- menu ----------------------------------------------------------------

  private menuScreen(): string {
    return `
      <div class="card menu">
        <h1>Vampire: The Eternal Struggle</h1>
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
      </div>`;
  }

  // --- new game ------------------------------------------------------------

  private newGameScreen(): string {
    const build = buildTable(this.table);
    const precons = supportedPrecons().filter((p) => p.playable);
    return `
      <div class="card wide">
        <h1>New game</h1>
        <p class="note">
          The rulebook is written for <b>${RECOMMENDED_SEATS.join(" or ")} players</b>
          (p. 1); ${MIN_SEATS} to ${MAX_SEATS} will play.
        </p>
        <div class="seats">
          ${this.table.seats.map((s, i) => this.seatRow(s, i, precons)).join("")}
        </div>
        <div class="row">
          <button id="seat-add" ${this.table.seats.length >= MAX_SEATS ? "disabled" : ""}>Add seat</button>
          <button id="seat-remove" ${this.table.seats.length <= MIN_SEATS ? "disabled" : ""}>Remove seat</button>
        </div>
        ${
          build.problems.length > 0
            ? `<div class="problems"><b>Not ready to start:</b><ul>${build.problems
                .map(
                  (p) =>
                    `<li>${p.seat ? `<b>${esc(p.seat)}</b> — ` : ""}${esc(p.problem)}</li>`,
                )
                .join("")}</ul></div>`
            : `<p class="ok">Ready — ${this.table.seats.length} seats.</p>`
        }
        <div class="row">
          <button id="start" class="primary" ${build.setup ? "" : "disabled"}>Start game</button>
          <button id="ng-back">Back</button>
        </div>
        ${this.setsNote()}
      </div>`;
  }

  private seatRow(seat: SeatConfig, i: number, precons: PreconSummary[]): string {
    const deckLabel =
      seat.deck === null
        ? "no deck"
        : seat.deck.kind === "precon"
          ? `${seat.deck.name} — ${seat.deck.set}`
          : "pasted deck list";
    const open = this.editingDeck === i;
    return `
      <div class="seatrow">
        <input class="seatname" data-i="${i}" value="${esc(seat.name)}" maxlength="${MAX_NAME_LENGTH}" />
        <select class="seatkind" data-i="${i}">
          <option value="you" ${seat.kind === "you" ? "selected" : ""}>You</option>
          <option value="ai" ${seat.kind === "ai" ? "selected" : ""}>Bot</option>
          <option value="open" ${seat.kind === "open" ? "selected" : ""}>Open (online)</option>
        </select>
        <button class="deckbtn" data-i="${i}">${esc(deckLabel)}</button>
      </div>
      ${open ? this.deckPanel(i, precons) : ""}`;
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
                .map(
                  (p) =>
                    `<button class="precon" data-i="${i}" data-set="${esc(p.set)}" data-name="${esc(
                      p.name,
                    )}">${esc(p.name)}</button>`,
                )
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
  private lobbyScreen(): string {
    const host = this.lobbyHost;
    const guest = this.lobbyPeer?.state ?? null;
    const code = host?.code ?? guest?.code ?? "";
    const problems = host ? host.problems : (guest?.problems ?? []);
    const canStart = host ? host.canStart : false;
    const link = joinLink(code, location.href.split("#")[0] ?? location.href);

    const rows = host
      ? host.seats.map((s, i) => ({
          name: s.name,
          kind: s.kind,
          mine: s.kind === "you",
          deck:
            s.deck === null
              ? null
              : s.deck.kind === "precon"
                ? `${s.deck.name} — ${s.deck.set}`
                : "a pasted deck list",
          deckHash: seatDeckHash(s),
          avatar: s.kind === "you" ? (this.profile?.avatar ?? null) : (s.avatar ?? null),
          index: i,
        }))
      : (guest?.seats ?? []).map((s, i) => ({ ...s, avatar: s.avatar ?? null, index: i }));

    return `
      <div class="card wide">
        <h1>${host ? "Your table" : "Waiting to start"}</h1>
        <div class="roombox">
          <div>
            <div class="roomlabel">Room code</div>
            <div class="roomcode">${esc(code)}</div>
          </div>
          <div class="row">
            <button id="copy-code">Copy code</button>
            <button id="copy-link" data-link="${esc(link)}">Copy join link</button>
          </div>
        </div>
        ${
          this.error
            ? `<p class="err">${esc(this.error)}</p>`
            : `<p class="note">Send either one to the people you want to play with.</p>`
        }

        <div class="seats">
          ${rows
            .map(
              (s) => `<div class="lobbyrow ${s.mine ? "mine" : ""}">
                ${lobbyFace(s.name, s.avatar, s.kind === "ai")}
                <span class="lname">${esc(s.name)}${s.mine ? " (you)" : ""}</span>
                <span class="lkind">${
                  s.kind === "ai"
                    ? "bot"
                    : s.kind === "open"
                      ? "waiting for a player"
                      : "player"
                }</span>
                ${
                  // The host may still change a seat they own — a bot's
                  // deck, or turning a bot into another open seat — right
                  // up until the game starts.
                  host && s.kind !== "remote"
                    ? `<select class="seatkind" data-i="${s.index}">
                         <option value="you" ${s.kind === "you" ? "selected" : ""}>You</option>
                         <option value="ai" ${s.kind === "ai" ? "selected" : ""}>Bot</option>
                         <option value="open" ${s.kind === "open" ? "selected" : ""}>Open</option>
                       </select>
                       <button class="deckbtn" data-i="${s.index}">${esc(s.deck ?? "choose a deck")}</button>`
                    : `<span class="ldeck ${s.deck ? "ready" : ""}">${esc(
                        s.deck ?? "no deck yet",
                      )}</span>`
                }
                ${s.deckHash ? `<span class="dhash" title="deck fingerprint">${esc(s.deckHash)}</span>` : ""}
              </div>
              ${host && this.editingDeck === s.index ? this.deckPanel(s.index, supportedPrecons().filter((p) => p.playable)) : ""}`,
            )
            .join("")}
        </div>
        ${
          this.spectators > 0
            ? `<p class="note">${this.spectators} watching.</p>`
            : ""
        }

        ${
          guest
            ? // A guest brings their own name and their own deck, and can
              // change either while they wait. The name STARTS from their
              // profile (sent on join) — this is for the clash the host
              // numbered, or for simply wanting to be someone else today.
              `<label class="field">
                 <span>Your name at this table</span>
                 <input id="guest-name" value="${esc(guest.you ?? "")}"
                        maxlength="${MAX_NAME_LENGTH}" />
               </label>
               <div class="row"><button id="guest-deck" class="primary">Choose my deck</button></div>
               ${this.editingDeck === 0 ? this.deckPanel(0, supportedPrecons().filter((p) => p.playable)) : ""}`
            : ""
        }

        ${
          problems.length > 0
            ? `<div class="problems"><b>Not ready to start:</b><ul>${problems
                .map((p) => `<li>${esc(p)}</li>`)
                .join("")}</ul></div>`
            : `<p class="ok">Everyone is ready.</p>`
        }

        <div class="row">
          ${host ? `<button id="lobby-start" class="primary" ${canStart ? "" : "disabled"}>Start game</button>` : ""}
          <button id="lobby-leave">${host ? "Close table" : "Leave"}</button>
        </div>
      </div>`;
  }

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
    this.on("#lb-back, #ng-back, #pback, #join-back", () => this.go("menu"));
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

    this.on("#lobby-start", () => {
      this.lobbyHost?.start();
      this.paint();
    });
    this.on("#lobby-leave", () => {
      this.lobbyHost?.close("the host closed the table");
      this.room?.close();
      this.lobbyPeer?.leave();
      this.lobbyHost = null;
      this.room = null;
      this.lobbyPeer = null;
      this.guestChannel = null;
      this.go("menu");
    });

    // A guest choosing their deck reuses the new-game deck panel, and
    // sends the choice rather than writing it into a local table.
    this.on("#guest-deck", () => {
      this.editingDeck = this.editingDeck === 0 ? null : 0;
      this.paint();
    });

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
      const profile = { ...newProfile(name, avatar), created: this.profile?.created ?? new Date().toISOString() };
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

    this.on("#seat-add", () => {
      const n = this.table.seats.length + 1;
      this.table.seats.push({ name: `Bot ${n - 1}`, kind: "ai", deck: null });
      this.paint();
    });
    this.on("#seat-remove", () => {
      this.table.seats.pop();
      this.editingDeck = null;
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
    this.table.privateGame = !isOnlineTable(this.table);
    if (!this.table.privateGame) {
      void this.openRoom();
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

  /** Register a room with the broker and show the lobby. */
  private async openRoom(): Promise<void> {
    const code = newRoomCode();
    this.lobbyHost = new LobbyHost(code, this.table, (transport) => this.toTable(transport));
    this.screen = "lobby";
    this.error = "";
    this.paint();
    try {
      // Not shown until the broker confirms the id: a room code nobody can
      // dial yet is worse than a moment's wait.
      this.room = await hostRoom(code, (channel) => {
        this.lobbyHost?.accept(channel);
        this.paint();
      });
    } catch (err) {
      this.error = `could not open a room: ${(err as Error).message}`;
      this.lobbyHost = null;
      this.screen = "newgame";
      this.paint();
    }
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
    );
    // A peer has no state to render until the host's first sync arrives.
    const off = transport.onChanged(() => {
      if (!transport.connected) return;
      off();
      this.toTable(transport);
    });
  }

  /** Hand the root over to the table. The shell paints nothing after this. */
  private toTable(transport: LocalTransport | PeerTransport): void {
    this.screen = "table";
    this.root.innerHTML = "";
    new DebugApp(this.root, transport, {
      faces: this.seatFaces(),
      localSeat: this.mySeat(),
      onLeave: () => this.leaveTable(),
    });
  }

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
    for (const s of seats) {
      faces[s.name] = {
        avatar: s.kind === "you" ? (this.profile?.avatar ?? null) : (s.avatar ?? null),
        bot: s.kind === "ai",
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
