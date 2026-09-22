/**
 * Debug table renderer (docs/debug-ui-design.md §4).
 *
 * The whole screen is a pure function of (GameState, DecisionPoint). Full
 * re-render on every step: there is at most one decision per few hundred
 * milliseconds of human time, so this is free, and it removes an entire
 * class of stale-view bugs.
 *
 * It renders whatever state the transport hands it, which is MASKED to the
 * deciding seat unless the debug "Show all" setting is on — so a card the
 * viewer may not see arrives already face down and renders as a card back.
 * The renderer is not the place hidden information is decided.
 */

import type {
  CardInstance,
  Frame,
  GameEvent,
  GameState,
  MinionState,
  PermanentInPlay,
  SeatState,
} from "../engine/index.ts";
import type { DecisionPoint, LegalOption } from "../engine/index.ts";
import { isFaceDown, resolvePerSeat } from "../engine/index.ts";
import { currentIntercept, currentStealth, predatorOf, preyOf } from "../engine/index.ts";
// The one reader of the `seat=N,seat=N` allocation format is the one that
// writes it (`allocToParams` beside it), so the picker below cannot drift
// from the option ids the engine enumerates.
import { parseAlloc } from "../cards/effects/compile.ts";
import { cardNamePattern, cardText, imageFor } from "./cardinfo.ts";
import { chatLines, MAX_CHAT_TEXT } from "./chat.ts";
import { minionName, narrate, owned } from "./narrate.ts";
import type { RuleSection } from "./rules.ts";
import { CREDITS, RULE_SECTIONS, searchRules } from "./rules.ts";
import type { LogNotice } from "./transport.ts";
import { AI_SPEEDS, CARD_TEXT_SIZES, PASS_TIMEOUTS } from "./settings.ts";

/**
 * Who is sitting in a seat, for the thumbnail on their mat.
 *
 * A player's picture comes from their own profile; a bot has none, and
 * gets its initial on a plain tile rather than a borrowed face — the
 * point of the thumbnail is telling people apart, and a bot that looked
 * like a player would defeat it.
 */
export interface SeatFace {
  avatar: string | null;
  bot: boolean;
  /**
   * What to CALL this seat, when that differs from its id.
   *
   * Display only. A seat's name IS the engine's identifier for it — every
   * option id, the command log and every saved game are written in terms
   * of it — so a seat a bot took over is relabelled here and nowhere else.
   */
  label?: string;
}

function seatThumb(seat: string, face: SeatFace | undefined): string {
  const initial = esc((seat.trim()[0] ?? "?").toUpperCase());
  const cls = face?.bot ? "seatface bot" : "seatface";
  if (face?.avatar) {
    return `<span class="${cls}"><img src="${esc(face.avatar)}" alt="" /></span>`;
  }
  return `<span class="${cls}">${face?.bot ? "🤖" : initial}</span>`;
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * The official KRCG scan for a card, as an <img>, with the card name as a
 * text fallback baked into the same element: `onerror` swaps in the name,
 * so an offline session or a 404 degrades to the readable text tile rather
 * than an empty box.
 *
 * `data-zoom` marks it for the hover magnifier.
 *
 * NO `title` ATTRIBUTE. The browser's own tooltip is the card name, and it
 * sits over the table for as long as the pointer rests there — which on a
 * board made entirely of cards means a name permanently in the way (owner
 * request: it should fade away after a few seconds). The name is drawn by
 * the magnifier instead, where it can be told to go (see `.zoomname`), and
 * `alt` still carries it for a failed scan and for a screen reader.
 */
function cardImage(name: string, cls: string, locked = false): string {
  // A card this viewer may not see renders as a card BACK, the way it sits
  // on the table — not as a blank or a name they should not know.
  if (isFaceDown({ name })) {
    return `<div class="scanwrap cardback ${cls} ${locked ? "locked" : ""}"><span>?</span></div>`;
  }
  const src = imageFor(name);
  const label = esc(name);
  // The name sits behind the image. If the scan fails to load, `failed`
  // hides the <img> and the name shows through — so an offline session
  // degrades to the readable text tile instead of an empty box.
  const fallback = `<span class="scanfallback">${label}</span>`;
  if (!src) return `<div class="scanwrap ${cls} ${locked ? "locked" : ""}">${fallback}</div>`;
  return `<div class="scanwrap ${cls} ${locked ? "locked" : ""}">
    ${fallback}
    <img class="scan" src="${esc(src)}" alt="${label}"
         loading="lazy" data-zoom="${esc(src)}"
         onerror="this.classList.add('failed')" />
  </div>`;
}

/**
 * THE TABLE IS AN INTERFACE TOO — the hand's rule, applied to the board.
 *
 * A card in your hand with a legal play is lit, badged with how many plays
 * it has, and clicked. Everything a minion or a card in play could do sat
 * in a list of buttons at the bottom of the screen instead, named by ids
 * the player had to match up against the table by eye. Now it does not:
 * an option that is ABOUT a card on the table is offered ON that card.
 *
 * Which card an option is about needs no id parsing — `LegalOption`
 * already carries it structurally (`minion`, `source`, `castVote.source`),
 * which is the richer-options principle paying out a second time
 * (docs/richer-options-design.md).
 *
 * An option lights EVERY table card it names, so a granted rush appears
 * both on the card granting it and on the minion that would perform it,
 * and a diablerie appears on the diablerist and on their victim. The badge
 * means "things you can do involving this card", which is true of each.
 */
export interface TableCtx {
  /** Table entity id → the options about it. */
  actions: Map<string, LegalOption[]>;
  /** Card in play → the cards SET ASIDE on it that this viewer may read
   *  (`readableStores`). */
  stores: Map<string, CardInstance[]>;
  /** The card the player has clicked open, if it is on the table. */
  selected: string | null;
  state: GameState;
  /** Answers given so far in the open card's stepped menu (`playMenu`).
   *  Pure view state; it never reaches the engine. */
  narrow: Record<string, string>;
}

/**
 * CARDS HELD ASIDE ON A CARD IN PLAY, for the ones this viewer may look at.
 *
 * A card in play can hold cards out of play on it — neither hand, nor
 * library, nor in play (`PermanentInPlay.stored`, docs/library-search-
 * design.md §5). Six of them hold theirs FACE DOWN, and every one of the
 * six lets its owner look: five print it ("you can look at the cards at
 * any time" — Shilmulo Tarot, Gift of Proteus, Storage Annex, Delivery
 * Truck, The Erciyes Fragments) and Maabara's card is public anyway, since
 * "all other players can see which card is selected from the ash heap"
 * [ANK 20200523].
 *
 * WHICH IS WHY THIS ASKS NO QUESTION OF ITS OWN. The permission has
 * already been decided upstream, by `maskStore` in the redaction: a store
 * whose cards this viewer may read arrives with their names on, and one
 * they may not arrives face down. Reading the names back out is therefore
 * the same answer, and a second rule here would be a second chance to
 * leak. A partly-readable store cannot happen — the mask is per entry —
 * but it is tested for rather than assumed, because "some names" would
 * mean the rule above had changed.
 */
export function readableStores(state: GameState): Map<string, CardInstance[]> {
  const out = new Map<string, CardInstance[]>();
  const add = (p: PermanentInPlay): void => {
    const stored = p.stored ?? [];
    if (stored.length === 0 || stored.some((c) => isFaceDown(c))) return;
    out.set(p.card.id, stored);
  };
  for (const s of state.seats) {
    for (const p of s.permanents) add(p);
    for (const m of s.minions) for (const p of m.attached) add(p);
  }
  return out;
}

/** Every id that is DRAWN on the table — the only keys an option may be
 *  indexed under, so a vote from the Edge or a strike is not mistaken for
 *  a card and quietly dropped from the action bar. */
function tableEntityIds(state: GameState): Set<string> {
  const ids = new Set<string>();
  for (const s of state.seats) {
    for (const m of s.minions) {
      ids.add(m.id);
      for (const p of m.attached) ids.add(p.card.id);
    }
    for (const p of s.permanents) ids.add(p.card.id);
    for (const u of s.uncontrolled) ids.add(u.card.id);
  }
  return ids;
}

/** Every legal option, indexed by the table card it is about. */
export function actionsByTableCard(
  dp: DecisionPoint | null,
  state: GameState,
): Map<string, LegalOption[]> {
  const drawn = tableEntityIds(state);
  const by = new Map<string, LegalOption[]>();
  const add = (key: string | null | undefined, o: LegalOption): void => {
    if (!key || !drawn.has(key)) return;
    const list = by.get(key) ?? [];
    if (!list.includes(o)) list.push(o);
    by.set(key, list);
  };
  for (const o of dp?.options ?? []) {
    switch (o.kind) {
      case "takeAction":
        // THE ACTOR'S CARD ONLY.
        //
        // Diablerie and rescue name a victim in somebody's torpor region,
        // and this used to index them under that victim as well, on the
        // theory that the victim's card is where a player looks for them.
        // What that actually drew was a torpor vampire lit up with an
        // eight-option menu of rescues and diableries — and "a vampire in
        // torpor can perform no action except the leave torpor action"
        // (p. 34), so the table was showing the opposite of the rule
        // (owner report). The engine was right all along: it offers a
        // torpor vampire nothing but `leave:<id>`.
        //
        // They are still reachable, on the READY vampire that would
        // perform them, which is whose action it is.
        add(o.minion, o);
        break;
      case "declareBlock":
      case "burnForIntercept":
      case "burnForUnlock":
      case "cancelBlock":
      case "transferToVampire":
      case "transferToPool":
      case "influenceOut":
        add(o.minion, o);
        break;
      case "useAbility":
        add(o.source, o);
        break;
      case "useEntryAction":
        add(o.source, o);
        add(o.minion, o);
        break;
      case "castVote":
        // "edge" and "caller" are not cards; `add` drops them, and they
        // stay on the bar where they belong.
        add(o.source.startsWith("card:") ? o.source.slice(5) : o.source, o);
        break;
      default:
        break;
    }
  }
  return by;
}

/**
 * The lit-and-badged treatment, for any card on the table.
 *
 * "Look at the cards set aside on this" counts as one of the entries: it
 * is not an engine option — nothing in the game changes — but it is one of
 * the things clicking this card can do, and giving it its own gesture
 * would be a second way to open a card (owner request, 2026-09-20).
 */
function tableActionMarks(id: string, ctx: TableCtx | null): { cls: string; body: string } {
  const opts = ctx?.actions.get(id) ?? [];
  const stored = ctx?.stores.get(id) ?? [];
  const count = opts.length + (stored.length > 0 ? 1 : 0);
  if (count === 0) return { cls: "", body: "" };
  const open = ctx!.selected === id;
  return {
    cls: `actionable${open ? " selected" : ""}`,
    body:
      `<span class="playdot" title="${count} action(s)">${count}</span>` +
      (open
        ? playMenu(
            opts,
            ctx!.state,
            "down",
            stored.length > 0 ? { id, count: stored.length } : null,
            ctx!.narrow,
          )
        : ""),
  };
}

/**
 * The cards set aside on a card in play, as teal pips over its scan.
 *
 * The same treatment counters get, and deliberately the same colour
 * (owner request): what is on a card that is not blood reads teal at this
 * table. Bottom RIGHT, because `counterOverlay` holds the bottom left and
 * one card can carry both.
 */
function storeOverlay(n: number): string {
  if (n <= 0) return "";
  return `<div class="store-overlay" title="${n} card(s) set aside">${pips(n, "counters")}</div>`;
}

/** Blood/life as pips, with the number for anything above a handful. */
function pips(n: number, extra = ""): string {
  const cls = extra ? `pips ${extra}` : "pips";
  if (n <= 0) return `<span class="${cls} empty">—</span>`;
  if (n > 6) return `<span class="${cls}">●×${n}</span>`;
  return `<span class="${cls}">${"●".repeat(n)}</span>`;
}

/**
 * The counters on a card in play, laid over its scan the way blood sits
 * over a vampire's.
 *
 * They used to be a number in a corner badge the size of the card's border,
 * which is not something a player tracking The Gate of Acheron's clock can
 * read across the table. Same pips as blood, teal rather than red: counters
 * on a card are not blood, and telling the two apart at a glance is the
 * whole reason the colour differs.
 */
function counterOverlay(n: number | undefined): string {
  if (!n || n <= 0) return "";
  return `<div class="counter-overlay" title="${n} counter(s)">${pips(n, "counters")}</div>`;
}

function disciplineList(m: MinionState): string {
  const entries = Object.entries(m.disciplines);
  if (entries.length === 0) return `<span class="dim">no disciplines</span>`;
  return entries
    .map(([d, lvl]) => `<span class="disc ${lvl}">${esc(d)}${lvl === "superior" ? "◆" : "▪"}</span>`)
    .join(" ");
}

/**
 * The card a minion's OWN text rides in on, which must never be drawn.
 *
 * A crypt card's ability, an ally's card text and a token vampire's card
 * all reach play as a SELF-ATTACHED entry — that is what lets the whole
 * `permanent` vocabulary reach them without a second set of rules
 * (docs/crypt-plan.md §2). The engine's own test for one is that its card
 * id IS the minion's id (`minionTags` in derived.ts), and that identity is
 * what makes hiding it safe: an option about it is indexed under the same
 * key as the minion, so `minionTile` already lights and badges it. Nothing
 * becomes unreachable — which is the property to preserve, since a missing
 * option looks exactly like an illegal one.
 */
function isSelfEntry(m: MinionState, p: PermanentInPlay): boolean {
  return p.card.id === m.id;
}

function attachedList(m: MinionState, ctx: TableCtx | null): string {
  const attached = m.attached.filter((p) => !isSelfEntry(m, p));
  if (attached.length === 0) return "";
  // Equipment, retainers and attached masters render as their own (small)
  // scans, tucked under the minion they sit on.
  return `<div class="attached-cards">${attached
    .map((p) => {
      const mark = tableActionMarks(p.card.id, ctx);
      return `<div class="attached-card ${mark.cls}" data-tcard="${esc(p.card.id)}">
        ${cardImage(p.card.name, "tiny", p.locked)}
        ${counterOverlay(p.counters)}
        ${storeOverlay((p.stored ?? []).length)}
        ${mark.body}
      </div>`;
    })
    .join("")}</div>`;
}

/**
 * A minion: the actual card scan, with the state that a physical table
 * would show with counters and card orientation laid over it — blood pips,
 * named counters, and a 90° turn for locked, the way a locked card really
 * sits on the table.
 */
function minionTile(m: MinionState, highlight: boolean, ctx: TableCtx | null): string {
  const mark = tableActionMarks(m.id, ctx);
  const badges = [
    m.inTorpor ? `<span class="badge torpor">torpor</span>` : "",
    m.awake ? `<span class="badge awake">awake</span>` : "",
    m.title ? `<span class="badge title">${esc(m.title)}</span>` : "",
  ].join("");
  const counters = m.counters
    ? Object.entries(m.counters)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `<span class="chip counter">${esc(k)} ${v}</span>`)
        .join("")
    : "";
  const corruption = m.corruption
    ? Object.entries(m.corruption)
        .filter(([, v]) => v > 0)
        .map(([seat, v]) => `<span class="chip counter">corr ${esc(seat)} ${v}</span>`)
        .join("")
    : "";
  return `
    <div class="minion ${m.kind} ${m.inTorpor ? "in-torpor" : ""} ${highlight ? "acting" : ""} ${mark.cls}"
         data-minion="${esc(m.id)}" data-tcard="${esc(m.id)}">
      <div class="cardslot">
        ${cardImage(m.name, "minion-scan", m.locked)}
        <div class="blood-overlay">${pips(m.blood)}</div>
        ${m.kind === "vampire" ? `<div class="cap-overlay">${m.capacity}</div>` : ""}
        ${mark.body}
      </div>
      <div class="mline">
        <span class="mid">${esc(m.id)}</span>
        ${m.locked ? `<span class="badge lock">locked</span>` : ""}
        ${badges}
      </div>
      <div class="mdisc">${disciplineList(m)}</div>
      ${counters || corruption ? `<div class="attached">${counters}${corruption}</div>` : ""}
      ${attachedList(m, ctx)}
    </div>`;
}

function permanentTile(p: PermanentInPlay, ctx: TableCtx | null): string {
  const mark = tableActionMarks(p.card.id, ctx);
  return `<div class="perm-card ${mark.cls}" data-tcard="${esc(p.card.id)}">
    ${cardImage(p.card.name, "small", p.locked)}
    ${counterOverlay(p.counters)}
    ${storeOverlay((p.stored ?? []).length)}
    ${mark.body}
  </div>`;
}

/**
 * The seats in TABLE ORDER STARTING FROM YOU — you, your prey, their prey,
 * … round to your predator.
 *
 * The array order is the table order already (prey is the next seat), so
 * this is a rotation and nothing more. What it fixes is that the mats used
 * to be drawn in raw array order, which put your prey and your predator
 * wherever the deal happened to leave them: you had to read the "prey ·
 * predator" line on each mat to work out which way round the table went.
 * Rotated, the direction of play is the direction you read in, and your
 * own mat is always first.
 *
 * A spectator has no seat, so they get the array as dealt.
 */
function seatsAroundTable(state: GameState, localSeat: string | null): Array<SeatState | null> {
  const at = localSeat === null ? -1 : state.seats.findIndex((s) => s.id === localSeat);
  const order =
    at < 0 ? state.seats : [...state.seats.slice(at), ...state.seats.slice(0, at)];
  const cols = seatColumns(order.length);
  const rows = Math.ceil(order.length / cols);
  // One row or one column IS a ring already — there is no second axis to
  // go round.
  if (rows < 2 || cols < 2) return order;

  // The grid cells, walked CLOCKWISE round the perimeter from the top
  // left: across the top, down the right, back along the bottom, up the
  // left. Row-major placement would instead read left-to-right on BOTH
  // rows, which is why a four-seat table put the predator diagonally
  // opposite and the seat below you was your prey's prey (owner report).
  const cells: Array<[number, number]> = [];
  for (let c = 0; c < cols; c++) cells.push([0, c]);
  for (let r = 1; r < rows; r++) cells.push([r, cols - 1]);
  for (let c = cols - 2; c >= 0; c--) cells.push([rows - 1, c]);
  for (let r = rows - 2; r >= 1; r--) cells.push([r, 0]);

  // Placed into the grid, then read back row-major, which is the order a
  // CSS grid fills from. HOLES ARE KEPT as nulls: dropping them would let
  // the next mat slide up into the gap and undo the placement — which is
  // the whole reason this returns a sparse array.
  const grid: Array<SeatState | null> = new Array(rows * cols).fill(null);
  order.forEach((s, i) => {
    const cell = cells[i];
    if (cell) grid[cell[0] * cols + cell[1]] = s;
  });
  return grid;
}

/** One player mat, with every zone the physical table has (design §4). */
function seatMat(
  state: GameState,
  seat: SeatState,
  dp: DecisionPoint | null,
  face: SeatFace | undefined,
  ctx: TableCtx | null,
  /** This viewer's own seat — the only one whose decks open. */
  localSeat: string | null,
): string {
  const ready = seat.minions.filter((m) => !m.inTorpor);
  const torpor = seat.minions.filter((m) => m.inTorpor);
  const acting = state.frames.find((f) => f.kind === "action");
  const actingId = acting && acting.kind === "action" ? acting.acting : null;

  const zone = (label: string, body: string): string =>
    `<div class="zone"><div class="zlabel">${label}</div><div class="zbody">${body}</div></div>`;

  return `
    <section class="mat ${seat.ousted ? "ousted" : ""} ${dp?.seat === seat.id ? "deciding" : ""}" data-seat="${esc(seat.id)}">
      <header>
        ${seatThumb(seat.id, face)}
        <span class="seatname">${esc(face?.label ?? seat.id)}</span>
        ${
          // Who they bleed and who bleeds them, small and unbolded beside
          // the name. Read through `preyOf`/`predatorOf` rather than the
          // seat array, so an OUST moves it: "when your prey is ousted,
          // the next Methuselah to your left becomes your new prey"
          // (p. 15). A one-seat table names nobody.
          seat.ousted || state.seats.filter((s) => !s.ousted).length < 2
            ? ""
            : `<span class="rel">prey ${esc(preyOf(state, seat.id))} &middot; predator ${esc(
                predatorOf(state, seat.id),
              )}</span>`
        }
        ${state.edge === seat.id ? `<span class="badge edge">EDGE</span>` : ""}
        ${seat.ousted ? `<span class="badge out">ousted</span>` : ""}
        <span class="spacer"></span>
        <span class="pool" title="pool">🩸 ${seat.pool}</span>
        <span class="vp" title="victory points">VP ${seat.victoryPoints}</span>
      </header>

      ${zone("READY", ready.length ? ready.map((m) => minionTile(m, m.id === actingId, ctx)).join("") : `<span class="dim">empty</span>`)}
      ${zone("TORPOR", torpor.length ? torpor.map((m) => minionTile(m, false, ctx)).join("") : `<span class="dim">empty</span>`)}
      ${zone(
        "UNCONTROLLED",
        seat.uncontrolled.length
          ? seat.uncontrolled
              .map((u) => {
                const mark = tableActionMarks(u.card.id, ctx);
                return `<div class="minion uncontrolled ${mark.cls}" data-tcard="${esc(u.card.id)}">
                  <div class="cardslot">
                    ${cardImage(u.card.name, "minion-scan")}
                    ${mark.body}
                    <div class="blood-overlay">${pips(u.counters)}</div>
                    ${isFaceDown(u.card) ? "" : `<div class="cap-overlay">${u.card.capacity}</div>`}
                  </div>
                  ${
                    // A face-down card shows only the counters stacked on it
                    // — its capacity and Disciplines are unreadable (p. 14).
                    isFaceDown(u.card)
                      ? `<div class="mline"><span class="mid">${u.counters} counters</span></div>`
                      : `<div class="mline"><span class="mid">${u.counters}/${u.card.capacity} to control</span></div>
                         <div class="mdisc">${disciplineList(u.card)}</div>`
                  }
                </div>`;
              })
              .join("")
          : `<span class="dim">empty</span>`,
      )}
      ${zone(
        "CARDS IN PLAY",
        seat.permanents.length
          ? seat.permanents.map((p) => permanentTile(p, ctx)).join("")
          : `<span class="dim">empty</span>`,
      )}

      <footer class="piles">
        ${
          // YOUR OWN decks open; nobody else's. p. 14 keeps a library face
          // down even to its owner, and this does not break that: the list
          // is sorted ALPHABETICALLY, so it shows composition and never
          // order — the same line the AI is held to
          // ("knows its own deck: composition, never order").
          localSeat === seat.id
            ? `<button class="pile crypt opens" data-deck="${esc(seat.id)}:crypt"
                       title="your crypt, alphabetically">CRYPT ${seat.crypt.length}</button>
               <button class="pile library opens" data-deck="${esc(seat.id)}:library"
                       title="your library, alphabetically">LIBRARY ${seat.library.length}</button>`
            : `<span class="pile crypt" title="crypt draw pile">CRYPT ${seat.crypt.length}</span>
               <span class="pile library" title="library draw pile">LIBRARY ${seat.library.length}</span>`
        }
        <span class="pile hand" title="cards in hand">HAND ${seat.hand.length}</span>
        ${
          // The ash heap "can be examined by any Methuselah at any time"
          // (p. 16) — the one fully public zone in the game — so EVERY
          // seat's pile opens, not just your own.
          //
          // The count is `seat.ashHeap`, the real zone. It used to be the
          // burn events divided by the number of seats, which is why it
          // read 0 all game: `CardBurned` is one of four ways into the
          // heap, and the commonest ones (a discard, a card in play
          // burning, an action card resolving) are not it.
          `<button class="pile ash opens" data-ash="${esc(seat.id)}"
                   title="ash heap — public, click to look">ASH ${
                     (seat.ashHeap ?? []).length
                   }</button>`
        }
        ${
          // Cards held face down and out of play in a contest (p. 17).
          // Shown because everyone watched them go down — the face-down
          // turn marks them out of play, it does not hide which card it
          // is — and because a pile that costs its holder 1 pool every
          // unlock phase should be visible to the table.
          (seat.contested ?? []).length > 0
            ? `<span class="pile contested"
                     title="contested — face down and out of play; 1 pool each unlock phase (p. 17): ${esc(
                       (seat.contested ?? []).map((c) => c.card.name).join(", "),
                     )}">CONTESTED ${(seat.contested ?? []).length}</span>`
            : ""
        }
      </footer>
    </section>`;
}

/**
 * The action strip: what is being played RIGHT NOW, big enough to read.
 *
 * The combat strip has always done this for a fight; every other card
 * flashed past in the log and was gone. So this is the same idea widened
 * to the whole game — every `cardPlay` frame on the stack (there can be
 * several: a cancel is played inside another card's as-played window), and
 * the action they are being played into.
 *
 * The numbers beside each minion are the ones that decide whether a block
 * lands, and they are OPEN INFORMATION: the acting minion is face up, and
 * stealth and intercept are sums of face-up cards (docs/ai-v1-design.md
 * §3 says the same thing about putting them in `PlayerView`). So showing
 * them leaks nothing — it saves a player adding up the table by eye.
 */
function actionStrip(state: GameState): string {
  const plays = state.frames.filter((f) => f.kind === "cardPlay");
  const af = state.frames.find((f) => f.kind === "action");
  if (plays.length === 0 && !af) return "";

  const cards = plays
    .map((f) => {
      if (f.kind !== "cardPlay") return "";
      const by = f.minion ? owned(state, f.minion) : f.seat;
      return `<span class="playing">
        <span class="cardslot mini">${cardImage(f.card.name, "playing-scan")}</span>
        <span class="playinfo">
          <b>${esc(f.card.name)}</b>
          ${f.mode ? `<span class="pmode">${esc(f.mode)}</span>` : ""}
          <span class="dim">played by ${esc(by)}</span>
        </span>
      </span>`;
    })
    .join("");

  let action = "";
  if (af && af.kind === "action") {
    const stealth = currentStealth(state, af.actionId);
    const actor = state.seats.flatMap((s) => s.minions).find((m) => m.id === af.acting);
    // Everyone who could still be blocking, with what their attempt is
    // worth against this action right now.
    const blockers = state.seats
      .filter((s) => s.id !== af.actingSeat && !s.ousted)
      .flatMap((s) => s.minions)
      .filter((m) => !m.inTorpor)
      .map((m) => ({ m, intercept: currentIntercept(state, af.actionId, m.id) }));
    action = `
      <span class="actinfo">
        <span class="clabel">ACTION</span>
        <span>${esc(af.actionKind)}</span>
        ${af.target ? `<span>at <b>${esc(af.target)}</b></span>` : `<span class="dim">undirected</span>`}
        <span class="dim">step ${esc(af.step)}</span>
      </span>
      <span class="actminions">
        <span class="am acting" title="the acting minion">
          ${esc(actor ? actor.name : af.acting)}
          <b class="num">stealth ${stealth}</b>
        </span>
        ${blockers
          .map(
            (b) => `<span class="am ${b.intercept >= stealth ? "canblock" : ""}"
                          title="intercept against this action">
              ${esc(owned(state, b.m.id))}
              <b class="num">int ${b.intercept}</b>
            </span>`,
          )
          .join("")}
      </span>`;
  }

  return `<div class="playstrip">${cards}${action}</div>`;
}

/**
 * THE RUNNING TALLY, while a referendum is on the stack (owner request).
 *
 * A referendum is the one thing at this table where the state that
 * matters is a pair of numbers nobody can see: every vote is cast in the
 * log, and a player deciding whether to spend a card on it was scrolling
 * back through the log adding them up by eye. So it goes where the card
 * being played goes — across the top, in front of everyone.
 *
 * It leaks nothing. Votes are cast openly (p. 28): who voted, with what,
 * and which way is public the moment it happens. This is arithmetic on
 * the log, not information out of it.
 *
 * `rf.votes` IS the ledger the tally sums (`resolveReferendum`), so the
 * two cannot drift. One thing it deliberately does not add: the blood
 * hunt's "additional votes against" static (Urban Jungle), which nobody
 * casts and which is only counted at the tally — it is named instead, so
 * a total that jumps at the end is not a surprise.
 */
/**
 * WHAT THE REFERENDUM ACTUALLY SAYS, in words, for the vote bar.
 *
 * A player deciding how to vote on Kine Resources Contested needs to
 * know who the 4 points were allocated to, and the bar used to name only
 * the card (owner request, 2026-09-20). Two readings, in order:
 *
 *  1. THE POOL, BY SEAT, when the card declared a seat map. This is the
 *     engine's own `resolvePerSeat`, the function the terms decision and
 *     the AI's vote scorer already use — signed, so "Bob −3" and
 *     "Alice +1" come out right on cards that move pool in opposite
 *     directions through the same terms key. A generic parse here would
 *     get Parity Shift backwards (docs/ai-referendum-view-design.md §5.1).
 *  2. Otherwise the caller's own chosen sentence (`termsLabel`) — a clan,
 *     a minion, a title, a location: terms that name no Methuselah.
 *
 * Nothing is leaked. Terms are announced before the vote (p. 27); this
 * is the announcement, written down where everyone is already looking.
 */
function termsSummary(rf: Extract<Frame, { kind: "referendum" }>): string {
  if (rf.step === "terms") return ""; // not chosen yet
  if (rf.seatMap) {
    const perSeat = resolvePerSeat(rf.terms, rf.seatMap);
    const parts = Object.entries(perSeat)
      .filter(([, n]) => n !== 0)
      .map(
        ([seat, n]) =>
          `<span class="vterm ${n < 0 ? "loses" : "gains"}">${esc(seat)} ${
            n < 0 ? "−" : "+"
          }${Math.abs(n)}</span>`,
      );
    if (parts.length > 0) return parts.join(`<span class="dim">·</span>`);
  }
  return rf.termsLabel ? `<span class="vterm">${esc(rf.termsLabel)}</span>` : "";
}

function voteStrip(state: GameState): string {
  const rf = state.frames.find((f) => f.kind === "referendum");
  if (!rf || rf.kind !== "referendum") return "";
  const forBy = new Map<string, number>();
  const againstBy = new Map<string, number>();
  for (const v of rf.votes) {
    const into = v.inFavor ? forBy : againstBy;
    into.set(v.seat, (into.get(v.seat) ?? 0) + v.count);
  }
  const sum = (m: Map<string, number>): number =>
    [...m.values()].reduce((a, b) => a + b, 0);
  const totalFor = sum(forBy);
  const totalAgainst = sum(againstBy);
  // "More for than against passes; ties fail" (p. 28) — the same test
  // `resolveReferendum` makes, so the reading on the bar and the result
  // cannot disagree.
  const passing = totalFor > totalAgainst;
  const what =
    rf.variant === "bloodHunt"
      ? "blood hunt"
      : rf.cardName
        ? rf.cardName
        : "referendum";
  return `
    <div class="votestrip">
      <span class="clabel">VOTE</span>
      <span><b>${esc(what)}</b></span>
      ${(() => {
        const terms = termsSummary(rf);
        return terms ? `<span class="voteterms">${terms}</span>` : "";
      })()}
      <span class="dim">called by ${esc(rf.caller)}</span>
      <span class="dim">${esc(rf.step)}</span>
      <span class="votetot ${passing ? "passing" : "failing"}">
        <b class="vfor">${totalFor}</b> for
        <span class="dim">·</span>
        <b class="vagainst">${totalAgainst}</b> against
        <span class="dim">— ${passing ? "would pass" : "would fail"}</span>
      </span>
      ${
        rf.variant === "bloodHunt"
          ? `<span class="dim">any "votes against blood hunts" are added at the tally</span>`
          : ""
      }
      <span class="voteseats">
        ${state.seats
          .filter((s) => !s.ousted)
          .map((s) => {
            const f = forBy.get(s.id) ?? 0;
            const a = againstBy.get(s.id) ?? 0;
            return `<span class="vseat ${f + a > 0 ? "voted" : ""}"
                          title="${esc(`${s.id}: ${f} for, ${a} against`)}">
              ${esc(s.id)}
              <b class="num vfor">${f}</b>
              <b class="num vagainst">${a}</b>
            </span>`;
          })
          .join("")}
      </span>
    </div>`;
}

/** The battlefield strip — only while a combat frame is on the stack. */
function combatStrip(state: GameState): string {
  const cf = state.frames.find((f) => f.kind === "combat");
  if (!cf || cf.kind !== "combat") return "";
  const find = (id: string): MinionState | undefined =>
    state.seats.flatMap((s) => s.minions).find((m) => m.id === id);
  const side = (id: string, label: string): string => {
    const m = find(id);
    if (!m) return `<span class="dim">${label}: gone</span>`;
    return `<span class="combatant">
      <span class="cardslot mini">
        ${cardImage(m.name, "combat-scan", m.locked)}
        <div class="blood-overlay">${pips(m.blood)}</div>
      </span>
      <b>${esc(m.name)}</b>
    </span>`;
  };
  const strikeOf = (s: { name: string | null; source: string } | null): string =>
    s ? esc(s.name ?? s.source) : "—";
  const pending = cf.pendingDamage.length
    ? cf.pendingDamage
        .map((d) => `${esc(d.minion)} ${d.amount}${d.aggravated ? " agg" : ""}`)
        .join(", ")
    : "none";
  return `
    <div class="combat">
      <span class="clabel">COMBAT</span>
      <span>round ${cf.round}</span>
      <span>${esc(cf.range)} range</span>
      <span>${esc(cf.step)}</span>
      <span class="vs">${side(cf.acting, "acting")} <b>⚔</b> ${side(cf.opposing, "opposing")}</span>
      <span>strikes: ${strikeOf(cf.strikes.acting)} / ${strikeOf(cf.strikes.opposing)}</span>
      <span>pending damage: ${pending}</span>
    </div>`;
}

/**
 * THE STAGE: one band across the top that is ALWAYS THERE (owner request).
 *
 * The three strips used to appear and vanish with the frames they
 * describe, which meant the whole table jumped down a hundred pixels the
 * moment a card was played and back up again when it resolved — every
 * card, every combat, every vote. A player following a card with their
 * eyes lost the board underneath it.
 *
 * So the band keeps its height whether or not there is anything in it.
 * The cost is a strip of empty space during the quiet parts of a turn;
 * the gain is that nothing else on the screen ever moves. `min-height`
 * rather than a fixed one: a four-way vote with a combat under it is
 * taller than the floor, and clipping it would be worse than the jump.
 */
function stage(state: GameState): string {
  const body = `${actionStrip(state)}${voteStrip(state)}${combatStrip(state)}`;
  return `
    <div class="stage">
      ${
        body === ""
          ? `<div class="stageidle"><span class="dim">nothing on the stack</span></div>`
          : body
      }
    </div>`;
}

function frameLine(f: Frame): string {
  switch (f.kind) {
    case "turn":
      return `<b>turn</b> ${esc(f.seat)} · ${esc(f.phase)} · #${f.turnNumber}` +
        (f.phase === "influence" ? ` · transfers ${f.transfersLeft}` : "") +
        (f.phase === "master" ? ` · MPA ${f.masterActionsLeft}` : "");
    case "action":
      return `<b>action</b> ${esc(f.actionKind)} ${esc(f.acting)}` +
        (f.target ? ` → ${esc(f.target)}` : "") +
        ` · step ${esc(f.step)}` +
        (f.blockCosts.length ? ` · toll ${f.blockCosts.reduce((a, c) => a + c.amount, 0)}` : "") +
        (f.noUnlock ? " · no-unlock" : "");
    case "blockAttempt":
      return `<b>blockAttempt</b> ${esc(f.blocker)}${f.forceFail ? " · forced fail" : ""}`;
    case "combat":
      return `<b>combat</b> r${f.round} ${esc(f.range)} ${esc(f.step)}`;
    case "cardPlay":
      return `<b>cardPlay</b> ${esc(f.card.name)}${f.mode ? ` (${esc(f.mode)})` : ""}`;
    case "referendum":
      return `<b>referendum</b> ${esc(f.variant)} · ${esc(f.step)}`;
    case "diablerieOffer":
      return `<b>diablerieOffer</b>`;
    case "choice":
      return `<b>choice</b> ${esc(f.cardName)} · ${esc(f.key)} · asks ${esc(f.seat)}`;
    default:
      return `<b>${esc((f as { kind: string }).kind)}</b>`;
  }
}

/** One log line in plain English (src/ui/narrate.ts). `raw` appends the
 *  engine's own event name, for when you are debugging rather than
 *  playing. */
function eventLine(ev: GameEvent, state: GameState, raw: boolean): string {
  const line = narrate(ev, state);
  if (!line) return "";
  const tag = raw ? ` <span class="evtype">${esc(ev.type)}</span>` : "";
  return `<div class="ev ${line.weight}">${linkifyCards(line.text)}${tag}</div>`;
}

/**
 * Card names in a log line become HOVER TARGETS for the magnifier.
 *
 * The log is where you read what happened, and "what was that card?" is
 * the question it raises most — but the scan is on the table, or already
 * in an ash heap, or was never yours to see. So the names carry
 * `data-zoom` exactly as a scan does, and one handler serves both.
 *
 * ESCAPING FIRST, then matching: the pattern is built from card names,
 * which contain apostrophes and accents but no HTML, so a match inside
 * escaped text is still a card name and no tag can be forged by one.
 */
function linkifyCards(text: string): string {
  return esc(text).replace(cardNamePattern(), (name) => {
    const src = imageFor(name);
    if (!src) return name;
    return `<span class="cardref" data-zoom="${esc(src)}" data-name="${esc(name)}">${name}</span>`;
  });
}

/** Options grouped by kind so a twenty-option minion phase stays readable. */
const GROUP_LABEL: Record<string, string> = {
  takeAction: "Actions",
  playCard: "Play a card",
  declareBlock: "Block",
  useAbility: "Card abilities",
  useEntryAction: "Granted actions",
  castVote: "Votes",
  chooseTerms: "Referendum terms",
  answerChoice: "Choose",
  chooseStrike: "Strike",
  usePress: "Press",
  useManeuver: "Maneuver",
  burnForIntercept: "Burn for intercept",
  cancelBlock: "Withdraw the block",
  discard: "Discard",
  transferToVampire: "Influence",
  transferToPool: "Influence",
  cryptDraw: "Influence",
  influenceOut: "Influence",
  gainEdgePool: "Edge",
  endMinionPhase: "Phase",
  diablerizeOffer: "Diablerie",
  pass: "Pass",
};

/**
 * ONE ALLOCATION QUESTION, gathered from the options that answer it.
 *
 * "Allocate 5 points among two or more Methuselahs" (Kine Resources
 * Contested) is enumerated by the legal-move generator as every legal
 * split — which is correct, and is what makes the AI and the host
 * validator work, but as a column of buttons it is dozens of rows of
 * `Allocate: Methuselah 2=3,Methuselah 4=2` that a player has to read
 * like a spreadsheet (owner request). The numbers are what the player is
 * choosing; the options are how the engine spells them.
 *
 * So the picker is built FROM the options and answers WITH one of them.
 * It never constructs an option id: `byAlloc` maps a normalised
 * allocation back to the id the engine offered, so a split the player
 * assembles that is not legal simply has no id and cannot be sent. That
 * is what enforces "the exact number of points" and the card's
 * "two or more" at once, without this file knowing either rule.
 *
 * `key` is everything the option chose BESIDES the split — the
 * beneficiary (Reckless Agitation) or the vampires being locked
 * (Revolutionary Council). Those are a separate question and get a
 * separate control; the spinners are only ever the split.
 */
export interface AllocChoice {
  /** The non-allocation half of these options' params, normalised. */
  key: string;
  /** What that half says, for the selector. Empty when the split is the
   *  whole question. */
  label: string;
  points: number;
  /** Recipients in the order the engine listed them, which is target
   *  order — seats first, then locations and equipment. */
  recipients: string[];
  /** Per-recipient ceiling. A location is BURNED by one point, so the
   *  engine never offers it two; the spinner must not either. */
  caps: Record<string, number>;
  /** Normalised split → the option id that is that split. */
  byAlloc: Map<string, string>;
}

/** Order-independent identity of a split, so a draft assembled by hand
 *  and an option enumerated by the engine compare equal. */
export function allocKey(alloc: Record<string, number>): string {
  return Object.entries(alloc)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([who, n]) => `${who}=${n}`)
    .join(",");
}

export function allocationChoices(dp: DecisionPoint | null): AllocChoice[] {
  const out: AllocChoice[] = [];
  const byKey = new Map<string, AllocChoice>();
  for (const o of dp?.options ?? []) {
    if (o.kind !== "chooseTerms") continue;
    const spelled = o.params["alloc"];
    if (spelled === undefined || spelled === "") continue;
    const rest = Object.entries(o.params)
      .filter(([k]) => k !== "alloc")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const key = rest.map(([k, v]) => `${k}=${v}`).join(";");
    let choice = byKey.get(key);
    if (!choice) {
      choice = {
        key,
        // The option's own words for the other half of the choice —
        // "Alice gains", "Lock Lucita, Anson" — which is everything its
        // label says before it starts spelling out the split.
        label: rest.length === 0 ? "" : o.label.replace(/;?\s*[Aa]llocate.*$/, "").trim(),
        points: 0,
        recipients: [],
        caps: {},
        byAlloc: new Map(),
      };
      byKey.set(key, choice);
      out.push(choice);
    }
    const entries = parseAlloc(spelled);
    let total = 0;
    const draft: Record<string, number> = {};
    for (const [who, n] of entries) {
      total += n;
      draft[who] = n;
      if (!choice.recipients.includes(who)) choice.recipients.push(who);
      choice.caps[who] = Math.max(choice.caps[who] ?? 0, n);
    }
    // Every option for one context spends the same points — the card says
    // how many — so this is a read, not a max.
    choice.points = total;
    choice.byAlloc.set(allocKey(draft), o.id);
  }
  return out;
}

/**
 * The allocation dialog: how many points are going, who may have them,
 * and a box per recipient.
 *
 * The boxes are plain number inputs and NOTHING HERE REPAINTS while they
 * are being typed in — a repaint is `innerHTML =`, which would take the
 * caret out of the box mid-number. The running total and the Confirm
 * button are updated in place by the wiring in loop.ts instead.
 */
function allocPanel(
  choices: AllocChoice[],
  contextKey: string | null,
  draft: Record<string, number>,
): string {
  const choice = choices.find((c) => c.key === contextKey) ?? choices[0];
  if (!choice) return "";
  const spent = choice.recipients.reduce((a, who) => a + (draft[who] ?? 0), 0);
  const legal = choice.byAlloc.has(allocKey(draft));
  return `
    <div class="scrim" id="alloc-scrim"></div>
    <div class="modal allocmodal" role="dialog" aria-label="Allocate points">
      <div class="modalcard">
        <h2>Allocate ${choice.points} point${choice.points === 1 ? "" : "s"}</h2>
        ${
          // The other half of the choice, when the card asks one. A
          // selector rather than a second dialog: the two halves are one
          // option in the engine, and answering them in one place is what
          // keeps the picker honest about which splits are legal for
          // which beneficiary.
          choices.length > 1
            ? `<label class="field">
                 <span>…for</span>
                 <select id="alloc-ctx">
                   ${choices
                     .map(
                       (c) =>
                         `<option value="${esc(c.key)}" ${c.key === choice.key ? "selected" : ""}>${esc(
                           c.label || "this split",
                         )}</option>`,
                     )
                     .join("")}
                 </select>
               </label>`
            : choice.label
              ? `<p class="note">${esc(choice.label)}</p>`
              : ""
        }
        <div class="alloclist">
          ${choice.recipients
            .map(
              (who) => `
            <div class="allocrow">
              <span class="allocwho">${esc(who)}</span>
              <input class="allocnum" type="number" inputmode="numeric"
                     data-who="${esc(who)}" min="0" max="${choice.caps[who] ?? choice.points}"
                     value="${draft[who] ?? 0}" />
            </div>`,
            )
            .join("")}
        </div>
        <p class="note alloctotal" id="alloc-total">
          ${spent} of ${choice.points} allocated${
            legal ? "" : spent === choice.points ? " — not a legal split" : ""
          }
        </p>
        <div class="row">
          <button id="alloc-ok" class="primary" ${legal ? "" : "disabled"}>Confirm</button>
          <button id="alloc-cancel">Cancel</button>
        </div>
      </div>
    </div>`;
}

/**
 * The pass clock, as a chip in the decision bar.
 *
 * SECONDS, ROUNDED UP, so the last second shown is "1s" and not "0s" —
 * a countdown that sits on zero while the buttons still work reads as
 * broken. `id` is fixed because the ticker updates this one node's text
 * between repaints rather than re-rendering the screen every second
 * (docs/pass-timeout-design.md §5); `.urgent` at five seconds is the only
 * thing about it that changes appearance, and the ticker sets that too.
 *
 * Empty when no clock is running, which is the ordinary case: the setting
 * is off by default.
 */
export function passClockChip(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `<span class="passclock${seconds <= 5 ? " urgent" : ""}" id="passclock"
                title="the table will pass for this seat when the clock runs out">
            ⏳ <b>${seconds}s</b>
          </span>`;
}

function decisionBar(
  dp: DecisionPoint | null,
  thinking: boolean,
  onTable: Set<LegalOption>,
  waitingFor: string | null,
  passClockMs: number | null | undefined,
): string {
  // SOMEBODY ELSE IS BEING ASKED, and this client may not answer for them.
  //
  // Two cases, one bar. A peer is sent no DecisionPoint at all when the
  // decision is not theirs, so `dp` is null and the bar used to read "Game
  // over" through every one of another player's turns (owner report). The
  // host has the real `dp` for every seat — it runs the engine — and was
  // therefore drawing live buttons for seats a remote player was sitting
  // in, and could press them (owner report). Both are the same statement:
  // this is not your decision, here is who it belongs to.
  if (waitingFor) {
    return `
      <div class="decision thinking" id="decision">
        <span class="tdots"><i></i><i></i><i></i></span>
        <b>${esc(waitingFor)}</b> is deciding…
        ${dp ? `<span class="dim">${esc(dp.window)}</span>` : ""}
        ${
          // THE CLOCK BELONGS TO THE DECISION, not to the viewer, so the
          // rest of the table can see how long they are waiting for. This
          // is the host's screen watching a remote player: a guest is sent
          // no clock for anybody else's decision (SyncMsg.passIn), so
          // there is nothing to draw there and nothing is drawn.
          passClockChip(passClockMs)
        }
      </div>`;
  }
  if (!dp) {
    return `<div class="decision over" id="decision"><b>Game over</b> — no decision pending.</div>`;
  }
  // An AI's move is being held back so it can be watched. The decision on
  // the table is THEIRS, so its options must not appear as buttons — a
  // human at the same screen would be answering for the computer.
  if (thinking) {
    return `
      <div class="decision thinking" id="decision">
        <span class="tdots"><i></i><i></i><i></i></span>
        <b>${esc(dp.seat)}</b> is deciding…
        <span class="dim">${esc(dp.window)}</span>
      </div>`;
  }
  // A choice that picks a CARD is shown as cards. Looking through a
  // library or an ash heap is exactly the moment a player needs to read
  // what they are choosing between, and a column of names is the one
  // thing a physical table never makes you do.
  const picks = dp.options.filter((o) => o.kind === "answerChoice" && o.card);
  if (picks.length > 0) {
    const rest = dp.options.filter((o) => !(o.kind === "answerChoice" && o.card));
    return `
      <div class="decision" id="decision">
        <div class="dhead">
          <span class="dseat">${esc(dp.seat)}</span>
          <span class="dwindow">${esc(dp.window)}</span>
          <span class="dim">seq ${dp.seq}</span>
          ${passClockChip(passClockMs)}
        </div>
        <div class="cardgrid picker">
          ${picks
            .map(
              (o) => `<button class="opt gridcard" data-opt="${esc(o.id)}" title="${esc(o.label)}">
                ${cardImage(o.kind === "answerChoice" ? (o.card ?? "") : "", "small")}
                <span class="gcname">${esc(o.label)}</span>
              </button>`,
            )
            .join("")}
        </div>
        <div class="obuttons">${rest
          .map(
            (o) =>
              `<button class="opt ${o.kind}" data-opt="${esc(o.id)}" title="${esc(
                o.id,
              )}">${esc(o.label)}</button>`,
          )
          .join("")}</div>
      </div>`;
  }

  const groups = new Map<string, LegalOption[]>();
  let cardPlays = 0;
  let tablePlays = 0;
  // Every legal split of an allocation is an option, and there are dozens
  // of them. They are answered in a dialog with a box per recipient
  // instead (owner request) — so they are taken out of the bar here and
  // replaced by the one button that opens it.
  const allocs = allocationChoices(dp);
  const allocIds = new Set<string>();
  for (const c of allocs) for (const id of c.byAlloc.values()) allocIds.add(id);
  for (const o of dp.options) {
    if (allocIds.has(o.id)) continue;
    // Card plays live ON the cards in hand, not as buttons up here — click
    // or drag the card itself.
    if (o.kind === "playCard" || o.kind === "discard" || o.kind === "burnOptionDiscard") {
      cardPlays += 1;
      continue;
    }
    // ...and anything ABOUT a card on the table lives on that card, for
    // the same reason. What is left here is what no card could carry: end
    // the phase, pass, strike, press, vote from the Edge, answer a
    // question.
    if (onTable.has(o)) {
      tablePlays += 1;
      continue;
    }
    const label = GROUP_LABEL[o.kind] ?? o.kind;
    const list = groups.get(label) ?? [];
    list.push(o);
    groups.set(label, list);
  }
  if (cardPlays > 0) {
    groups.set("From hand", []);
  }
  if (tablePlays > 0) {
    groups.set("On the table", []);
  }
  const body = [...groups.entries()]
    .map(
      ([label, opts]) => `
      <div class="ogroup">
        <div class="olabel">${esc(label)}</div>
        <div class="obuttons">${
          opts.length === 0
            ? // Both empty groups are signposts to somewhere else on the
              // screen: the hand is directly above this bar, the table
              // further up again.
              `<span class="hint">${
                label === "From hand"
                  ? "click or drag a lit card in your hand ↑"
                  : "click a lit card on the table ↑"
              }</span>`
            : opts
                .map(
                  (o) =>
                    // A block the engine says would FAIL is marked, not
                    // hidden: p. 25 makes the attempt legal and either
                    // side may still play a card, so it is the player's
                    // call — but they should not have to compare two
                    // numbers printed elsewhere on the screen to make it
                    // (docs/richer-options-design.md §1).
                    `<button class="opt ${o.kind}${
                      o.kind === "declareBlock" && !o.wouldSucceed ? " wouldfail" : ""
                    }" data-opt="${esc(o.id)}" title="${esc(o.id)}">${esc(
                      o.label,
                    )}</button>`,
                )
                .join("")
        }</div>
      </div>`,
    )
    .join("");
  return `
    <div class="decision" id="decision">
      <div class="dhead">
        <span class="dseat">${esc(dp.seat)}</span>
        <span class="dwindow">${esc(dp.window)}</span>
        <span class="dim">seq ${dp.seq}</span>
        ${passClockChip(passClockMs)}
      </div>
      ${
        allocs.length > 0 && allocs[0]
          ? `<div class="ogroup">
               <div class="olabel">Terms</div>
               <div class="obuttons">
                 <button id="alloc-open" class="opt chooseTerms primary">
                   Allocate ${allocs[0].points} point${allocs[0].points === 1 ? "" : "s"}…
                 </button>
               </div>
             </div>`
          : ""
      }
      ${body}
    </div>`;
}

/** Every legal play, indexed by the hand card it would play. */
export function playsByCard(dp: DecisionPoint | null): Map<string, LegalOption[]> {
  const byCard = new Map<string, LegalOption[]>();
  for (const o of dp?.options ?? []) {
    if (o.kind !== "playCard" && o.kind !== "discard" && o.kind !== "burnOptionDiscard") continue;
    const list = byCard.get(o.card) ?? [];
    list.push(o);
    byCard.set(o.card, list);
  }
  return byCard;
}

/**
 * Does the decision on the table still offer anything about this card?
 *
 * The question a SELECTION asks, and the reason it lives here beside the
 * two indexes rather than in the screen that keeps the selection: a card
 * is selected to ask "what can this do now?", and "now" is the decision.
 * When the decision moves on and the card is no longer in either index,
 * the menu on it is showing the LAST decision's options, which is not
 * stale so much as wrong.
 */
export function stillOffered(
  id: string | null,
  dp: DecisionPoint | null,
  state: GameState,
): boolean {
  if (!id) return false;
  // "Look at the cards set aside on this" is one of the things a card can
  // do now — `tableActionMarks` has counted it as a menu entry since the
  // store panel landed, and this did not. The two disagreeing is why the
  // Shilmulo Tarot menu snapped shut on every bot decision: the selection
  // was pruned as "nothing offered here" while the menu drawn on it said
  // otherwise (owner-reported, 2026-09-22).
  return (
    playsByCard(dp).has(id) ||
    actionsByTableCard(dp, state).has(id) ||
    readableStores(state).has(id)
  );
}

/**
 * Apply the player's own hand order to the hand the engine reports.
 *
 * The engine owns what is IN your hand; the order you keep it in is a
 * purely cosmetic client preference, so it lives in the UI and never
 * touches game state (a reorder must not become a command in the log —
 * that would make an undo of it a game rewind).
 *
 * Reconciliation is total in both directions: ids no longer in hand fall
 * out of the order, and a card the order has never seen (a fresh draw)
 * lands at the end, where a real player would put it.
 */
export function orderHand<T extends { id: string }>(hand: T[], order: string[]): T[] {
  if (order.length === 0) return hand;
  const rank = new Map(order.map((id, i) => [id, i]));
  const known = hand.filter((c) => rank.has(c.id));
  const fresh = hand.filter((c) => !rank.has(c.id));
  known.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...known, ...fresh];
}

/**
 * The hand: real cards you click, not buttons in a list. A card with at
 * least one legal play is lit and clickable; clicking selects it and its
 * plays appear on the card itself.
 *
 * EVERY card is draggable, playable or not, because dragging means two
 * different things depending on where it lands: onto a minion or a player
 * mat it plays the card, onto another hand card it just reorders your
 * hand. Sorting your hand is something a player does constantly and at any
 * time, including on a decision where nothing is playable at all.
 */
function handStrip(
  state: GameState,
  dp: DecisionPoint | null,
  selected: string | null,
  handOrder: string[],
  thinking = false,
  localSeat: string | null = null,
  narrow: Record<string, string> = {},
): string {
  // WHOSE HAND. With one human at this client (playing bots, or online)
  // the answer is always theirs: a player wants to read their own hand
  // while somebody else is thinking, and swapping the strip to whoever is
  // deciding took it away exactly when there was time to look at it.
  //
  // Falling back to the deciding seat keeps HOTSEAT right, where there is
  // no single local player and the hand on screen must follow the turn.
  const owner = localSeat ?? dp?.seat ?? null;
  if (!owner) return "";
  const seat = state.seats.find((s) => s.id === owner);
  if (!seat) return "";
  // Plays are only ever lit for the seat actually being asked. While an
  // AI's move is paused, or on another seat's decision, the hand is there
  // to be READ, not played.
  const mine = !thinking && dp?.seat === owner;
  const byCard = mine ? playsByCard(dp) : new Map<string, LegalOption[]>();
  const hand = orderHand(seat.hand, handOrder);

  const card = (c: { id: string; name: string }, i: number): string => {
    const plays = byCard.get(c.id) ?? [];
    const playable = plays.length > 0;
    // A card that is no longer playable goes back to its default state.
    // Without this a card clicked open stayed "selected" — lit and lifted
    // — after the decision moved on and greyed it out, so the table showed
    // a highlighted card with nothing behind it.
    const isSelected = playable && selected === c.id;
    return `
      <div class="handslot ${playable ? "playable" : "unplayable"} ${isSelected ? "selected" : ""}"
           data-card="${esc(c.id)}" data-hand-index="${i}" draggable="true">
        ${cardImage(c.name, "hand-card")}
        ${playable ? `<span class="playdot" title="${plays.length} legal play(s)">${plays.length}</span>` : ""}
        ${isSelected && plays.length > 0 ? playMenu(plays, state, "up", null, narrow) : ""}
      </div>`;
  };

  return `
    <div class="${mine ? "hand" : "hand watching"}" id="hand">
      <!--
        SORTING WORKS OFF-TURN and always did (the slots are draggable
        whichever seat is being asked, and hand order is a client
        preference that never reaches the command log). What did not work
        was SAYING so:
        the label read "not your decision", which reads as "hands off".
        Reported twice as a missing feature — the same shape as the
        auto-pass report, where a feature that cannot be discovered is
        indistinguishable from one that is absent.
      -->
      <!--
        The hint sits UNDER the name rather than beside it, and without
        the em dash (owner request): the label is two lines of different
        weight, not one sentence, and next to the name it pushed the first
        card along.
      -->
      <span class="hlabel"><span class="hname">${esc(seat.id)}'s hand</span>
        <span class="dim hhint">${mine ? "drag to sort" : "drag to sort (not your decision)"}</span></span>
      ${hand.map(card).join("")}
      ${hand.length === 0 ? `<span class="dim">empty</span>` : ""}
    </div>`;
}

/**
 * The ash heap, as cards.
 *
 * p. 16: the ash heap "can be examined by any Methuselah at any time" —
 * the one fully public zone in the game — so this opens for any seat and
 * `redactFor` deliberately never masks it.
 */
function ashPanel(state: GameState, seatId: string | null): string {
  if (!seatId) return "";
  const seat = state.seats.find((s) => s.id === seatId);
  if (!seat) return "";
  const cards = seat.ashHeap ?? [];
  return `
    <div class="scrim" id="ash-scrim"></div>
    <div class="settings ashheap" id="ashheap" role="dialog" aria-label="Ash heap">
      <header>
        <h3>${esc(seat.id)}'s ash heap — ${cards.length} card${cards.length === 1 ? "" : "s"}</h3>
        <button id="ash-close" title="Close">✕</button>
      </header>
      <section>
        <p class="setnote">
          Burned and discarded cards. Any Methuselah may look through any
          ash heap at any time (p. 16) — it is the only fully public zone
          in the game.
        </p>
        ${
          cards.length === 0
            ? `<p class="dim">Nothing here yet.</p>`
            : `<div class="cardgrid">${cards
                .map(
                  (c) => `<div class="gridcard">${cardImage(c.name, "small")}
                    <span class="gcname">${esc(c.name)}</span></div>`,
                )
                .join("")}</div>`
        }
      </section>
    </div>`;
}

/**
 * THE CARDS SET ASIDE ON ONE CARD IN PLAY (owner request, 2026-09-20).
 *
 * Shilmulo Tarot holds two cards out of play and says "you can look at
 * the cards at any time", and until now there was no at-any-time to do
 * it in: the count was invisible and the names were only ever seen at the
 * moment the engine offered to draw one of them.
 *
 * Same shape as the ash heap panel next door on purpose — scrim, header,
 * card grid. It opens on a card id rather than a seat, and it renders
 * ONLY what `readableStores` admits, so a store the viewer may not look
 * at has no way in: the panel is opened from a menu entry that is not
 * drawn, and it re-checks here rather than trusting the click.
 */
function storePanel(state: GameState, openId: string | null): string {
  if (!openId) return "";
  const entry = [...state.seats.flatMap((s) => s.permanents), ...state.seats
    .flatMap((s) => s.minions)
    .flatMap((m) => m.attached)].find((p) => p.card.id === openId);
  const cards = readableStores(state).get(openId);
  if (!entry || !cards) return "";
  return `
    <div class="scrim" id="store-scrim"></div>
    <div class="settings ashheap" id="storeview" role="dialog" aria-label="Cards set aside">
      <header>
        <h3>${esc(entry.card.name)} — ${cards.length} card${cards.length === 1 ? "" : "s"} set aside</h3>
        <button id="store-close" title="Close">✕</button>
      </header>
      <section>
        <p class="setnote">
          Held on this card and <b>out of play</b> — not in your hand, not
          in your library, not in play. Looking at them changes nothing and
          costs nothing.
        </p>
        <div class="cardgrid">${cards
          .map(
            (c) => `<div class="gridcard">${cardImage(c.name, "small")}
              <span class="gcname">${esc(c.name)}</span></div>`,
          )
          .join("")}</div>
      </section>
    </div>`;
}

/**
 * YOUR OWN crypt or library, as a list — **alphabetical, with counts**.
 *
 * Alphabetical is not a presentation choice, it is the whole reason this
 * is allowed to exist. p. 14 keeps the library face down even to its
 * owner, so showing it in DECK ORDER would hand you your next draws. What
 * a player legitimately knows is what they built: composition, never
 * order. Sorting destroys the order and leaves exactly that — the same
 * line the AI is held to (CLAUDE.md, "The AI knows its own deck").
 *
 * Counts rather than one row per copy, because "how many Villeins are
 * left" is the question being asked.
 */
function deckPanel(state: GameState, open: string | null): string {
  if (!open) return "";
  const [seatId, which] = open.split(":");
  const seat = state.seats.find((s) => s.id === seatId);
  if (!seat || (which !== "crypt" && which !== "library")) return "";
  // NOT `seat.library` — the piles are masked to face-down cards for
  // everyone including their owner (p. 14), so reading them showed one
  // row of nothing. `ownPiles` is the redaction's own answer to "what is
  // in there", sorted there so no order reaches this client.
  const names = (which === "crypt" ? seat.ownPiles?.crypt : seat.ownPiles?.library) ?? [];
  const cards = which === "crypt" ? seat.crypt : seat.library;
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const rows = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return `
    <div class="scrim" id="deck-scrim"></div>
    <div class="settings ashheap" id="deckview" role="dialog" aria-label="Your deck">
      <header>
        <h3>Your ${which} — ${cards.length} card${cards.length === 1 ? "" : "s"}</h3>
        <button id="deck-close" title="Close">✕</button>
      </header>
      <section>
        <p class="setnote">
          What is still in the pile, <b>alphabetically</b> — never in deck
          order. A library stays face down even to its owner (p. 16), so
          this shows you what you built and not what you are about to draw.
        </p>
        ${
          rows.length === 0
            ? `<p class="dim">Empty.</p>`
            : `<div class="decklist">${rows
                .map(
                  ([name, n]) =>
                    `<div class="deckrow">
                       <span class="dqty">${n}×</span>
                       <span class="cardref" data-zoom="${esc(imageFor(name) ?? "")}"
                             data-name="${esc(name)}">${esc(name)}</span>
                     </div>`,
                )
                .join("")}</div>`
        }
      </section>
    </div>`;
}

/**
 * The chooser that opens on a selected card: one row per legal play.
 *
 * The engine's own label is built for a log and an option id — it names
 * the card again (you clicked it), says "(superior)" in Discipline jargon,
 * and prints its targets as raw ids: "Aire of Elation (superior) — Muhsin
 * Samir → V3, Bob". Nobody can read that at speed. So the row is REBUILT
 * from the option's structured fields, with ids resolved to names against
 * the same redacted state the table is drawn from — exactly what the game
 * log already does (narrate.ts), and it cannot leak for the same reason.
 *
 * A card with a hand-written label keeps it: those are already prose, and
 * they say things the structured fields cannot ("fill Muhsin Samir to
 * capacity"). Only the repeated card name is trimmed off the front.
 */
/**
 * SEQUENTIAL PICKERS FOR A CARD WITH TOO MANY PLAYS
 * (docs/play-menu-steps-design.md; owner request 2026-09-21).
 *
 * A long menu is almost never a long LIST — it is a CROSS PRODUCT. Vessel
 * enumerates every minion at the table × (nothing, or each Blood Doll in
 * play), so a busy table offers it forty-odd ways and the menu runs off
 * the screen. A grid would make forty cells instead of forty rows; what
 * actually shrinks it is asking one question at a time, because 12 + 4 is
 * not 48.
 *
 * `cheap-tail-design.md` §1 is the precedent and the licence: a
 * cross-product menu becomes sequential pickers FOR FREE, and the
 * sequencing is unobservable — nothing here reaches the engine, nobody
 * else is asked anything between the steps, and the final click submits
 * exactly the option id that was always there. The engine, the AI, the
 * transport and every option-id test are untouched.
 *
 * (That doc's caveat — it does not work where the params are fixed at
 * announcement, p. 25 — does not bite here, because this is narrowing a
 * list of whole options that already exist rather than assembling one.)
 */
const PLAY_MENU_FLAT_MAX = 8;

/**
 * One option's value on one axis, or null if it has none.
 *
 * TOTAL over the union on purpose: the table menu carries `useAbility`
 * and `useEntryAction` options, which have `params` but no `minion` or
 * `mode`, and a narrowing that threw those away would hide a legal play.
 */
function axisValue(o: LegalOption, axis: string): string | null {
  if (axis === "mode") return "mode" in o ? (o.mode ?? null) : null;
  if (axis === "minion") return "minion" in o ? (o.minion ?? null) : null;
  return ("params" in o ? o.params : undefined)?.[axis] ?? null;
}

/**
 * The axes this set of plays could be split on, in the order to ask them.
 *
 * ORDER IS THE CARD AUTHOR'S, not a heuristic: `mode` and `minion` first
 * because they are the frame of the play ("at which level, played by
 * whom"), then the params in the order the enumerator wrote them — which
 * on Vessel is target, then Blood Doll, which is the order a player would
 * say it out loud. Sorting by how many values an axis has would read as
 * arbitrary and would change between turns.
 *
 * AN AXIS ONLY QUALIFIES IF EVERY PLAY HAS A VALUE FOR IT. An option
 * missing the param could not be reached by any of that axis's buttons,
 * so narrowing on it would silently make a legal play unclickable.
 */
export function playAxes(plays: LegalOption[]): string[] {
  const keys: string[] = ["mode", "minion"];
  for (const o of plays) {
    if (!("params" in o)) continue;
    for (const k of Object.keys(o.params)) if (!keys.includes(k)) keys.push(k);
  }
  return keys.filter((k) => {
    const values = new Set<string>();
    for (const o of plays) {
      const v = axisValue(o, k);
      if (v === null) return false;
      values.add(v);
    }
    return values.size > 1;
  });
}

/** The plays still reachable under the answers given so far. Falls back to
 *  the whole list if the narrowing matches nothing, so a stale answer can
 *  never present an empty menu. */
export function narrowPlays(
  plays: LegalOption[],
  narrow: Record<string, string>,
): LegalOption[] {
  const entries = Object.entries(narrow);
  if (entries.length === 0) return plays;
  const kept = plays.filter((o) => entries.every(([k, v]) => axisValue(o, k) === v));
  return kept.length > 0 ? kept : plays;
}

/** What each axis is asking, as a question. Falls back to the key, which
 *  is still a word rather than an id. */
const AXIS_QUESTION: Record<string, string> = {
  mode: "At which level?",
  minion: "Played by whom?",
  target: "On whom?",
  targetSeat: "At which Methuselah?",
  seat: "At which Methuselah?",
  victim: "At whom?",
  recipient: "To whom?",
  permanent: "On which card?",
  equipment: "On which equipment?",
  card: "On which card?",
  clan: "Naming which clan?",
  x: "How much?",
  amount: "How much?",
  n: "How much?",
  blood: "How much blood?",
};

/** One axis value, as a person would say it. */
function axisLabel(axis: string, value: string, state: GameState): string {
  if (axis === "mode") return value === "superior" ? "Superior" : "Basic";
  if (axis === "minion") return owned(state, value);
  // A card that spells "no second thing" as a literal — Vessel's `bd`.
  if (value === "none") return "None";
  return resolveId(state, value);
}

function playMenu(
  plays: LegalOption[],
  state: GameState,
  // A hand card sits at the bottom of the screen, so its menu grows UP; a
  // card on the table has room below it.
  grow: "up" | "down" = "up",
  /** "Look at the cards set aside on this", when there are any to look
   *  at. It carries `data-peek` and NOT `data-opt`: the one handler that
   *  submits an id reads `data-opt`, so an entry without one cannot be
   *  mistaken for a move. */
  peek: { id: string; count: number } | null = null,
  /** The answers given so far, when this menu is being asked one question
   *  at a time. View state — it never reaches the engine. */
  narrow: Record<string, string> = {},
): string {
  const peekItem = peek
    ? `<button class="opt peek" data-peek="${esc(peek.id)}"
               title="Cards set aside on this card, out of play">
        <span class="pmain">Look at the ${peek.count} card${peek.count === 1 ? "" : "s"} set aside on this</span>
        <span class="pdetail">Out of play — looking at them changes nothing</span>
      </button>`
    : "";

  const remaining = narrowPlays(plays, narrow);
  // The answers already given, and the way back. Drawn whenever anything
  // has been narrowed, INCLUDING on the final flat list — a player who
  // has picked a target must be able to change their mind without
  // closing the card and opening it again.
  // Only the answers that mean something HERE. A card on the table can
  // have no plays at all and still open its menu to show the cards set
  // aside on it, so `remaining` may be empty — and an answer left over
  // from a different card must not be drawn as this one's.
  const sample = remaining[0];
  const chosen = sample
    ? Object.entries(narrow).filter(([k]) => axisValue(sample, k) !== null)
    : [];
  const trail =
    chosen.length === 0
      ? ""
      : `<div class="pcrumbs">
          ${chosen
            .map((e) => `<span class="pcrumb">${esc(axisLabel(e[0], e[1], state))}</span>`)
            .join("")}
          <button class="opt pback" data-narrow-reset="1">⟲ Start over</button>
        </div>`;

  // TOO MANY TO READ: ask the next question instead of listing the cross
  // product. `axes[0]` is the frame of the play before its details — see
  // `playAxes` on why the order is the enumerator's and not a heuristic.
  const axes = remaining.length > PLAY_MENU_FLAT_MAX ? playAxes(remaining) : [];
  const axis = axes.find((a) => !(a in narrow));
  if (axis) {
    const byValue = new Map<string, number>();
    for (const o of remaining) {
      const v = axisValue(o, axis)!;
      byValue.set(v, (byValue.get(v) ?? 0) + 1);
    }
    return `<div class="playmenu ${grow} stepped">${peekItem}${trail}
      <div class="pstep">${esc(AXIS_QUESTION[axis] ?? axis)}</div>
      ${[...byValue.entries()]
        .map(
          ([value, count]) =>
            `<button class="opt narrow" data-narrow="${esc(axis)}=${esc(value)}"
                     title="${count} play${count === 1 ? "" : "s"}">
              <span class="pmain">${esc(axisLabel(axis, value, state))}</span>
              ${count > 1 ? `<span class="pdetail">${count} ways</span>` : ""}
            </button>`,
        )
        .join("")}
    </div>`;
  }

  return `<div class="playmenu ${grow}">${peekItem}${trail}${remaining
    .map((o) => {
      const p = describePlay(o, state);
      return `<button class="opt ${o.kind}" data-opt="${esc(o.id)}" title="${esc(o.id)}">
        <span class="pmain">${esc(p.main)}</span>
        ${p.detail ? `<span class="pdetail">${esc(p.detail)}</span>` : ""}${costTag(o)}
      </button>`;
    })
    .join("")}</div>`;
}

/** How each param reads in front of its value. An unlisted one falls back
 *  to its own key, which is still a word rather than an id. */
const PARAM_WORD: Record<string, string> = {
  target: "at",
  targetSeat: "at",
  seat: "at",
  victim: "at",
  blocker: "at",
  minion: "at",
  permanent: "on",
  equipment: "on",
  bearer: "on",
  card: "on",
  recipient: "to",
  payer: "paid by",
  from: "using",
  payFrom: "paying from",
  clan: "naming",
  x: "for",
  amount: "for",
  n: "for",
  blood: "for",
};

/** Params that are plumbing, not a choice the player is making. */
const PARAM_HIDDEN = new Set(["variant", "fmode", "mode", "act", "do"]);

/**
 * One play, in plain language: what it does on top, who and what it
 * touches underneath.
 */
export function describePlay(
  o: LegalOption,
  state: GameState,
): { main: string; detail: string } {
  if (o.kind !== "playCard") return { main: o.label, detail: "" };

  // A hand-written label is prose already; keep it, minus the card name
  // the player just clicked. The generic one always opens "<name> (".
  const generic = o.label.startsWith(`${o.name} (`);
  if (!generic) {
    const stripped = o.label
      .replace(new RegExp(`^${o.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[—:-]\\s*`), "")
      .trim();
    return { main: stripped || o.label, detail: whoPlays(o, state) };
  }

  const variant = o.params["variant"];
  const level = o.mode === "superior" ? "Superior" : o.mode === "basic" ? "Basic" : "Play";
  const main = variant ? `${level} — ${variant}` : level;

  const bits: string[] = [];
  const who = whoPlays(o, state);
  if (who) bits.push(who);
  for (const [key, value] of Object.entries(o.params)) {
    if (PARAM_HIDDEN.has(key)) continue;
    bits.push(`${PARAM_WORD[key] ?? key} ${resolveId(state, value)}`);
  }
  return { main, detail: bits.join(", ") };
}

/** "played by Bob's Muhsin Samir" — omitted when the card plays itself. */
function whoPlays(o: Extract<LegalOption, { kind: "playCard" }>, state: GameState): string {
  return o.minion ? `played by ${owned(state, o.minion)}` : "";
}

/**
 * A raw option-id value as a person would say it: a minion by name and
 * controller, a Methuselah by their own name, a card by its name — and
 * anything else (a number, a clan, a discipline) unchanged, because it is
 * already a word.
 */
function resolveId(state: GameState, value: string): string {
  for (const s of state.seats) {
    if (s.id === value) return s.id;
    if (s.minions.some((m) => m.id === value)) return owned(state, value);
    for (const c of s.hand) if (c.id === value) return c.name || "a card in hand";
    for (const p of s.permanents) if (p.card.id === value) return p.card.name;
    for (const m of s.minions) {
      for (const p of m.attached) if (p.card.id === value) return p.card.name;
    }
    for (const u of s.uncontrolled) if (u.card.id === value) return minionName(state, value);
  }
  return value;
}

/**
 * What a play costs, on the button.
 *
 * The LIVE cost, not the printed one, because that is what the option
 * reports — a discount or surcharge in force right now is already in the
 * number (docs/play-cost-design.md). A free play shows nothing rather
 * than "0", which would be noise on most cards.
 */
function costTag(o: LegalOption): string {
  if (o.kind !== "playCard" || !o.cost) return "";
  const parts: string[] = [];
  if (o.cost.blood > 0) parts.push(`${o.cost.blood}🩸`);
  if (o.cost.pool > 0) parts.push(`${o.cost.pool}◈`);
  return parts.length > 0 ? ` <span class="ocost">${parts.join(" ")}</span>` : "";
}

/** The compact turn readout in the header — whose turn it is, and where. */
function turnStatus(state: GameState): string {
  const tf = state.frames.find((f) => f.kind === "turn");
  if (!tf || tf.kind !== "turn") {
    return `<span class="dim">no turn in progress</span>`;
  }
  return `<span class="tnum">Turn ${tf.turnNumber}</span>
    <span class="tseat">${esc(tf.seat)}</span>
    <span class="tphase">${esc(tf.phase)} phase</span>`;
}

/**
 * The settings menu. Auto-pass is PER SEAT and off by default: the standing
 * rule is that a player is never skipped, so each seat opts in, and even
 * then only when Pass is genuinely the sole legal option.
 */
function settingsPanel(input: RenderInput): string {
  if (!input.settingsOpen) return "";
  // WHAT A GUEST MAY SET, and why it is a shorter list.
  //
  // `canModerate` is this client being the AUTHORITY — a private table or
  // the host of an online one. Everything cut here is something a guest
  // has no business with rather than something merely unhelpful: auto-pass
  // for ANOTHER seat would answer for a person who is sitting right there;
  // the debug reveal would show them every hand at the table, which is the
  // one setting that must never be reachable from a seat in a real game.
  // The AI section is not cut but MOVED — it is in Moderation now, beside
  // the other things the host does to seats (owner request).
  const authority = input.canModerate;
  const seats = authority
    ? input.state.seats.map((s) => s.id)
    : input.state.seats.map((s) => s.id).filter((id) => id === input.localSeat);
  const allOn = seats.length > 0 && seats.every((id) => input.autoPass[id]);
  // Marking your OWN seat matters: auto-pass is per seat and off by
  // default (nobody is ever skipped without asking), so a player looking
  // for "stop asking me to pass" has to be able to find which row is
  // theirs among four names.
  const you = (id: string): string =>
    id === input.localSeat ? ` <span class="dim">(you)</span>` : "";
  const seatRow = (id: string): string => `
    <label class="toggle">
      <input type="checkbox" class="autopass-seat" data-seat="${esc(id)}"
             ${input.autoPass[id] ? "checked" : ""} /> ${esc(id)}${you(id)}
    </label>`;
  return `
    <div class="scrim" id="settings-scrim"></div>
    <div class="settings" id="settings" role="dialog" aria-label="Settings">
      <header>
        <h3>Settings</h3>
        <button id="settings-close" title="Close">✕</button>
      </header>

      <section>
        <div class="sethead">Auto-pass</div>
        <p class="setnote">
          Answer for a seat automatically when <b>Pass</b> is its only legal
          option. A seat with any real choice is always asked — nobody is
          ever skipped past a decision they could have made.
          <b>This works for your own seat too</b>, not just for bots: tick
          your name to stop being asked to pass when there is nothing you
          could do.
        </p>
        ${
          authority
            ? `<label class="toggle strong">
                 <input type="checkbox" id="autopass-all" ${allOn ? "checked" : ""} />
                 All seats
               </label>`
            : ""
        }
        <div class="setseats">${seats.map(seatRow).join("")}</div>
      </section>

      <section>
        <div class="sethead">Reading cards</div>
        <label class="setrow">
          <span>Card text size</span>
          <select id="cardtext">
            ${CARD_TEXT_SIZES.map(
              (s) =>
                `<option value="${s.px}" ${s.px === input.cardTextPx ? "selected" : ""}>${esc(
                  s.label,
                )} — ${s.px}px</option>`,
            ).join("")}
          </select>
        </label>
        <p class="setnote">
          The size of the rules text under a magnified card. The scan is
          read at a glance; the text is read word by word.
        </p>
      </section>

      ${
        authority
          ? `<section>
        <div class="sethead">Debug</div>
        <label class="toggle">
          <input type="checkbox" id="omni" ${input.omniscient ? "checked" : ""} />
          Show all hidden cards
        </label>
        <p class="setnote">
          Reveals every seat's hand, crypt and uncontrolled region, tags each
          log line with the engine event behind it, and shows the frame
          stack. For debugging the engine — not for playing.
        </p>
      </section>`
          : ""
      }
    </div>`;
}

/**
 * How to Play: the rules of the game, straight from the rulebook summary in
 * `rules.ts`. Sections are `<details>`, so the panel opens short and the
 * player expands what they need — a wall of rules helps nobody.
 */
function helpPanel(input: RenderInput): string {
  if (!input.helpOpen) return "";
  return howToPlayPanel(input.helpQuery, input.helpOpenSections);
}

/**
 * The How to Play panel itself — ONE renderer for the table's ❔ button
 * and the main menu's How to Play button (owner request, 2026-09-22).
 *
 * It takes only what it reads — the search text and which sections are
 * open — rather than the table's whole render input, which is what lets
 * the menu draw it at all: the menu has no game, and a second copy of
 * the panel for it would be the one that fell behind when a rule section
 * was added.
 */
export function howToPlayPanel(helpQuery: string, openSections: readonly string[]): string {
  // Which sections are expanded is remembered by the caller: the screen
  // fully re-renders on every state change, and an agent or auto-passing
  // seat can step while the panel is open, which would otherwise collapse
  // whatever the player was reading.
  const query = helpQuery.trim();
  const matches = searchRules(query);
  // While searching, every hit opens: the player is looking for a phrase,
  // not a heading, and making them click each result would defeat the
  // point. With no query the remembered open/closed state applies.
  const searching = query.length > 0;
  const section = (s: RuleSection): string => `
    <details class="rulesec" data-rule="${esc(s.id)}"
             ${searching || openSections.includes(s.id) ? "open" : ""}>
      <summary>
        ${esc(s.title)}
        ${s.pages ? `<span class="rulepage">${esc(s.pages)}</span>` : ""}
      </summary>
      <div class="rulebody">${searching ? highlight(s.body, query) : s.body}</div>
    </details>`;

  return `
    <div class="scrim" id="help-scrim"></div>
    <div class="settings help" id="help" role="dialog" aria-label="How to play">
      <header>
        <h3>How to Play</h3>
        <button id="help-close" title="Close">✕</button>
      </header>
      <section>
        <p class="setnote">
          A summary of the official Fifth Edition rules, with the rulebook
          page beside each section. When a card contradicts the rules, the
          card wins.
        </p>
        <input id="help-search" class="helpsearch" type="search"
               placeholder="Search the rules — e.g. block, torpor, bleed"
               value="${esc(helpQuery)}" />
        ${
          searching
            ? `<p class="setnote">${matches.length === 0
                ? `Nothing matches <b>${esc(query)}</b>.`
                : `${matches.length} of ${RULE_SECTIONS.length} sections match <b>${esc(query)}</b>.`}</p>`
            : ""
        }
        ${matches.map(section).join("")}
      </section>
      <section class="credits">${CREDITS}</section>
    </div>`;
}

/**
 * Wrap each search term in a `<mark>`, inside the section's own markup.
 *
 * Only TEXT is touched: the body is authored HTML, so the split below
 * keeps tags (`<b>`, `<li>`, …) intact and highlights only what sits
 * between them. Highlighting the raw string would corrupt attributes and
 * could rewrite a tag name.
 */
function highlight(body: string, query: string): string {
  const terms = query
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (terms.length === 0) return body;
  const re = new RegExp(`(${terms.join("|")})`, "gi");
  // Split on tags: odd indices are tags and pass through untouched.
  return body
    .split(/(<[^>]*>)/g)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(re, "<mark>$1</mark>")))
    .join("");
}

export interface RenderInput {
  state: GameState;
  dp: DecisionPoint | null;
  /** Substring filter for the event log. */
  eventFilter: string;
  canUndo: boolean;
  /** False for a client that may not rewind (a peer, phase 6) — the whole
   *  history control group is hidden rather than shown disabled. */
  canRewind: boolean;
  /** Debug view: show hidden information and tag each log line with the
   *  engine event name behind it. */
  omniscient: boolean;
  /** The hand card the player has clicked, if any — its legal plays are
   *  shown on the card itself. */
  selectedCard: string | null;
  /** The deciding seat's preferred hand order, as card ids. Cosmetic and
   *  client-side; see orderHand(). */
  handOrder: string[];
  /** Whether the settings dialog is open. */
  settingsOpen: boolean;
  /** Whether the How to Play dialog is open. */
  helpOpen: boolean;
  /** Ids of the rule sections the player has expanded. */
  helpOpenSections: string[];
  /** The How to Play search box contents. View state, like the rest of
   *  the panel: it never reaches the command log. */
  helpQuery: string;
  /** Seat id → auto-pass when Pass is the only option. */
  autoPass: Record<string, boolean>;
  /** Seats an AI is playing (phase 5). */
  aiSeats: Record<string, boolean>;
  /** True while an AI's move is being held back so it can be watched. The
   *  decision on the table belongs to that AI, so nothing on screen may
   *  offer to answer it (docs/debug-ui-design.md §10). */
  thinking: boolean;
  /**
   * A seat this client may NOT answer for is being asked — a remote
   * player's seat on the host's screen, or anybody else's seat on a
   * peer's. Null when the decision (if there is one) is ours to make.
   * Suppresses every button, exactly as `thinking` does.
   */
  waitingFor: string | null;
  /** Log lines that are not engine events (a seat changing hands). Drawn
   *  under the event log, which is where players look for them. */
  notices: LogNotice[];
  /**
   * The finished game, when it is over and this client has somewhere to
   * go afterwards — the leaderboard prompt. Null while the game runs, and
   * on a table with no shell behind it (the playtest snapshot).
   */
  finished: FinishedView | null;
  /** The pause after each visible AI move, in ms — the Settings control. */
  aiDelayMs: number;
  /**
   * The pass clock's interval, in ms — the Moderation control. 0 is off.
   *
   * Optional so every existing render fixture keeps its shape; absent
   * reads as off, which is also the default.
   */
  passTimeoutMs?: number;
  /**
   * Milliseconds left before the table passes for the seat being asked,
   * or null/absent when no clock is running.
   *
   * DRAWN, not merely enforced. A feature that cannot be seen is
   * indistinguishable from one that is absent, and a clock nobody can see
   * is worse than that — the pass would arrive as the table answering for
   * you out of nowhere. The number is the authority's (the transport's),
   * never counted up in here.
   */
  passClockMs?: number | null;
  /** Point size for the rules text under a magnified card. */
  cardTextPx: number;
  /** Seat id → the face on their mat. A bot has none by design. */
  seatFaces: Record<string, SeatFace>;
  /**
   * The seat this client's player holds, when there is exactly one — the
   * hand strip always shows THEIR hand, so a player can read it while
   * somebody else is thinking. Null in hotseat, where the hand must follow
   * whoever is being asked.
   */
  localSeat: string | null;
  /**
   * The answers given so far in the open card's STEPPED play menu.
   *
   * View state, like the selection it hangs off: a card with more plays
   * than fit on screen is asked one question at a time (`playMenu`), and
   * these are the answers so far. Nothing here reaches the engine — the
   * final click submits an option id that existed all along. Optional so
   * the existing render fixtures keep their shape.
   */
  playNarrow?: Record<string, string>;
  /** Whose ash heap is open, if any. View state — the zone is public. */
  ashOpen: string | null;
  /** "<seat>:crypt" or "<seat>:library" while your own deck list is open.
   *  Optional so the existing render tests keep their fixtures. */
  deckOpen?: string | null;
  /** The card in play whose SET-ASIDE cards are open, if any. View state:
   *  looking at them is not a move and never reaches the command log. */
  storeOpen?: string | null;
  /** Whether to offer Leave — false when there is nowhere to go back to. */
  canLeave: boolean;
  /** Whether to show the table chat — false when there is nobody to talk to
   *  and nothing relaying it. */
  canChat: boolean;
  /** Whether to offer moderation — the HOST only. A guest cannot kick or
   *  ban anybody, so the button is not drawn rather than drawn and
   *  refused. */
  canModerate: boolean;
  /** This player's own name colour, `#rrggbb`. */
  chatColor: string;
  /** Whether the chat's gear panel and emoji pad are open. View state. */
  chatSettingsOpen: boolean;
  emojiOpen: boolean;
  /** Which emoji category tab is showing. View state, like the rest of
   *  the panel: it never reaches the command log. */
  emojiCategory: string;
  /** The moderation panel, when it is open: who is here and who is
   *  chat-banned. Null when closed. */
  moderation: ModerationView | null;
  /**
   * The allocation dialog (Kine Resources Contested and its family).
   *
   * Pure view state, like every other panel: the draft is a split the
   * player is assembling and has not chosen, so it never reaches the
   * command log. Optional so the existing render fixtures keep their
   * shape.
   */
  allocOpen?: boolean;
  /** Recipient → points, as the boxes currently read. */
  allocDraft?: Record<string, number>;
  /** Which half-of-the-choice context is selected, when the card asks
   *  one. Null means the first. */
  allocContext?: string | null;
}

export function render(input: RenderInput): string {
  const { state, dp } = input;

  // While an AI's move is paced — or while the seat being asked belongs to
  // somebody else entirely — the decision on the table is THEIRS, and
  // nothing on screen may offer to answer it, the table included.
  //
  // BUT THE MOVES ARE ALL THAT GOES. The context used to be dropped whole,
  // and the set-aside cards went with it: Shilmulo Tarot prints "you can
  // look at the cards AT ANY TIME", and on a table with bots that was
  // "only on your own decisions", a fraction of the game (owner-reported,
  // 2026-09-22). Looking changes nothing and asks the engine nothing, so
  // it has no business waiting for a turn — only `actions` is emptied.
  const deciding = !(input.thinking || input.waitingFor);
  const ctx: TableCtx = {
    actions: deciding ? actionsByTableCard(dp, state) : new Map(),
    stores: readableStores(state),
    selected: input.selectedCard,
    state,
    narrow: input.playNarrow ?? {},
  };
  const onTable = new Set<LegalOption>();
  for (const list of ctx?.actions.values() ?? []) for (const o of list) onTable.add(o);

  // THE LOG IS EVENTS AND NOTICES, IN ORDER. A notice is not an engine
  // event — a seat changing hands changes nothing in the game — but it
  // happened at a point in the game, and appending them after everything
  // left them piled at the foot of the log with newer events above
  // (owner: "stuck at the bottom"). Each carries the event count at the
  // time it was written, which is exactly where it goes back.
  //
  // The window is applied AFTER interleaving, so a notice cannot be
  // dropped by the 400-event trim while the events around it survive.
  const noticeAt = new Map<number, string[]>();
  for (const n of input.notices) {
    noticeAt.set(n.afterEvent, [...(noticeAt.get(n.afterEvent) ?? []), n.text]);
  }
  const noticeLines = (afterEvent: number): string =>
    (noticeAt.get(afterEvent) ?? [])
      .map((t) => `<div class="ev notice">${esc(t)}</div>`)
      .join("");
  const lines: string[] = [];
  // Anything written before the first event still belongs at the top.
  lines.push(noticeLines(0));
  state.eventLog.forEach((ev, i) => {
    lines.push(eventLine(ev, state, input.omniscient));
    lines.push(noticeLines(i + 1));
  });
  const events = lines
    .filter((line) => line !== "")
    .slice(-400)
    .filter((line) =>
      input.eventFilter
        ? line.toLowerCase().includes(input.eventFilter.toLowerCase())
        : true,
    )
    .join("");

  // Layout, top to bottom: a slim header, the table, then YOUR half of the
  // screen — your hand with the action bar directly beneath it, so the
  // cards and the buttons that act on them sit together under your cursor
  // rather than at opposite ends of the window.
  return `
    <div class="top">
      <div class="turnstatus">${turnStatus(state)}</div>
      <span class="spacer"></span>
      ${
        // A client without history (a peer, phase 6) cannot rewind a shared
        // game, so the group is absent rather than shown disabled.
        input.canRewind
          ? `<div class="controls">
        <button id="undo" ${input.canUndo ? "" : "disabled"}>Undo</button>
        <button id="undo-action" ${input.canUndo ? "" : "disabled"}>Undo action</button>
        <button id="save">Save</button>
        <button id="load">Load</button>
        <!--
          SAVING AND DOWNLOADING ARE TWO THINGS, and Save used to be both:
          it wrote the browser's slot AND dropped a .json in Downloads, so
          a player keeping a position collected a file they never asked
          for. The file is for handing over with a bug report, which is a
          different errand and now has its own button.
        -->
        <!--
          "DOWNLOAD LOG" (owner request), because that is what the file
          is: a save records the whole command log, so opening it replays
          every decision of the game from the deal. "Download" on its own
          sat next to Save and Load and read as a third way to do the
          same thing.
        -->
        <button id="download" title="the game's full log as a .json, to attach to a bug report">
          Download Log
        </button>
        <button id="restart">Restart</button>
      </div>`
          : ""
      }
      <button id="help-btn" class="gear" title="How to play">❔ How to Play</button>
      ${
        // Beside How to Play and Settings, not tucked into the chat panel
        // (owner request). It is a peer of those two: a menu about the
        // table, reached the same way, and a shield glyph on a chat
        // header was not something anybody would find.
        input.canModerate
          ? `<button id="mod-btn" class="gear" title="Moderation">🛡 Moderation</button>`
          : ""
      }
      <button id="settings-btn" class="gear" title="Settings">⚙ Settings</button>
      ${input.canLeave ? `<button id="leave-btn" class="gear leave" title="Leave this game">⏻ Leave</button>` : ""}
    </div>
    ${stage(state)}
    <!--
      THE SIDE COLUMN RUNS THE FULL HEIGHT, and the hand and action bar
      sit beside it rather than under it (owner request 2026-09-06:
      "extend the Table Chat down to the bottom, pushing aside the bar for
      player hand and action bar. Keep the top of the table chat where
      it's at"). So the table and the bottom bar are one column, and the
      log and the chat are the other — which also means the chat gets the
      height, not the log: the log keeps its size and the chat grows into
      what used to be nothing.
    -->
    <div class="lower">
      <div class="leftcol">
        <div class="main">
          <div class="table" id="table" style="--seat-cols:${seatColumns(state.seats.length)}">
            ${seatsAroundTable(state, input.localSeat)
              .map((s) =>
                s === null
                  ? `<div class="matgap"></div>`
                  : seatMat(state, s, dp, input.seatFaces[s.id], ctx, input.localSeat),
              )
              .join("")}
          </div>
        </div>
        <div class="bottom">
          ${handStrip(
            state,
            dp,
            input.selectedCard,
            input.handOrder,
            input.thinking || input.waitingFor !== null,
            input.localSeat,
            input.playNarrow ?? {},
          )}
          ${decisionBar(dp, input.thinking, onTable, input.waitingFor, input.passClockMs)}
        </div>
      </div>
      <aside class="side">
        <div class="panel" ${input.omniscient ? "" : "hidden"}>
          <h3>Frame stack <span class="dim">(debug)</span></h3>
          <div class="frames">
            ${state.frames.map((f) => `<div class="frame">${frameLine(f)}</div>`).join("")}
          </div>
        </div>
        <div class="panel log">
          <h3>Game log <input id="evfilter" placeholder="filter…" value="${esc(input.eventFilter)}" /></h3>
          <!-- Events and notices are interleaved above, in order. -->
          <div class="events" id="events">${events}</div>
        </div>
        ${input.canChat ? chatPanel(input.chatColor, input.chatSettingsOpen, input.emojiOpen, input.emojiCategory) : ""}
      </aside>
    </div>
    ${moderationPanel(input)}
    ${settingsPanel(input)}
    ${helpPanel(input)}
    ${ashPanel(state, input.ashOpen)}
    ${deckPanel(state, input.deckOpen ?? null)}
    ${storePanel(state, input.storeOpen ?? null)}
    ${
      // Only ever over a decision this client may actually answer: the
      // same gate the buttons are behind, since the dialog IS a button.
      input.allocOpen && !input.thinking && input.waitingFor === null
        ? allocPanel(allocationChoices(dp), input.allocContext ?? null, input.allocDraft ?? {})
        : ""
    }
    <div id="zoom" class="zoom" hidden style="--cardtext:${input.cardTextPx}px">
      <!-- The card's name, which FADES (owner request): it is what you
           need in the first second of a hover and clutter after that. The
           scan below it says the same thing permanently. -->
      <div class="zoomname"></div>
      <img alt="" /><div class="zoomtext"></div>
    </div>
    ${gameOverDialog(input)}
  `;
}

/**
 * How many mats sit across the table.
 *
 * "3 on top, 3 on the bottom" — the seats wrap into two rows so the table
 * reads like people sitting round one, rather than a single line that runs
 * off the side of the screen. Two rows means half the seats each, capped
 * at three across so a mat never gets too narrow to read.
 */
/**
 * The finished game, as the end-of-game prompt needs it.
 *
 * Built by the table from the state it already has, so a peer and the
 * host draw the same dialog from their own copy of the result rather than
 * one of them being told.
 */
export interface FinishedView {
  /** The seat that won, or null for a draw (the engine's turn cap). */
  winner: string | null;
  /** Every seat, best first, for the final tally. */
  standings: Array<{ seat: string; victoryPoints: number; ousted: boolean }>;
}

/**
 * "The game is over — keep it?" (owner request.)
 *
 * ONE DIALOG, BOTH ANSWERS LEAVE. Saving is the only choice on offer: the
 * leaderboard is per device (docs/shell-design.md §6), so this is the one
 * moment the person at this screen decides whether this game counts, and
 * either way there is nothing left to do at a finished table. It is modal
 * because a table nobody can act on that still looks playable is the
 * worse of the two failures.
 */
function gameOverDialog(input: RenderInput): string {
  const f = input.finished;
  if (!f) return "";
  const rows = f.standings
    .map(
      (s) => `<tr class="${s.seat === f.winner ? "won" : ""}">
        <td>${esc(s.seat)}</td>
        <td>${s.victoryPoints} VP</td>
        <td class="dim">${s.ousted ? "ousted" : ""}</td>
      </tr>`,
    )
    .join("");
  return `
    <div class="scrim" id="over-scrim"></div>
    <div class="modal overmodal" role="dialog" aria-label="The game is over">
      <div class="modalcard">
        <h2>${f.winner ? `${esc(f.winner)} wins` : "A draw"}</h2>
        <table class="lbtable">
          <thead><tr><th>Player</th><th>VP</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="note">
          Add this game to your leaderboard? It is kept
          <b>in this browser only</b> — there is no server to share it
          with. Either way, this takes you back to the main menu.
        </p>
        <div class="row">
          <button id="over-save" class="primary">Save to my leaderboard</button>
          <button id="over-discard">Don't save</button>
        </div>
      </div>
    </div>`;
}

export function seatColumns(seats: number): number {
  return Math.max(1, Math.min(3, Math.ceil(seats / 2)));
}

/**
 * The table's chat panel — the lobby's, in the side column.
 *
 * Deliberately the same markup and the same store (src/ui/chat.ts): the
 * conversation is one conversation, and a player who agreed a house rule
 * in the lobby should still be able to read it three turns in.
 */
function chatPanel(
  color: string,
  settingsOpen: boolean,
  emojiOpen: boolean,
  emojiCategory: string,
): string {
  return `
    <div class="panel chatbox tablechat">
      <h3>Table chat
        <button id="chat-gear" class="chatgear" title="Chat settings">⚙</button>
      </h3>
      ${chatSettings(color, settingsOpen)}
      ${chatLinesMarkup()}
      ${chatComposer(emojiOpen, emojiCategory)}
    </div>`;
}

/** The conversation itself. Shared by the table and the lobby, so a name
 *  is drawn in its owner's colour in both. */
export function chatLinesMarkup(): string {
  const lines = chatLines();
  return `
    <div class="chatlines" id="chatlines">
      ${
        lines.length === 0
          ? `<p class="note dim">Nothing said yet.</p>`
          : lines
              .map((l) =>
                l.system
                  ? `<div class="chatline system">${esc(l.text)}</div>`
                  : // The colour was validated as `#rrggbb` on the way into
                    // the store (src/ui/chat.ts), which is why it can go in
                    // a style attribute at all.
                    `<div class="chatline"><b${
                      l.color ? ` style="color:${esc(l.color)}"` : ""
                    }>${esc(l.from)}</b> ${esc(l.text)}</div>`,
              )
              .join("")
      }
    </div>`;
}

/**
 * A palette of emoji, and the box to type in.
 *
 * A fixed list rather than a picker library: it is one grid of buttons
 * that inserts a character at the caret, which is the whole of what was
 * asked for, and it adds no dependency to a project that has exactly one.
 */
/**
 * The emoji picker, by category (owner request 2026-09-07).
 *
 * WRITTEN OUT RATHER THAN GENERATED FROM UNICODE RANGES. A range is the
 * obvious way to get "all of them" and it is the wrong way: the blocks are
 * not contiguous, they carry unassigned codepoints and modifier bases that
 * render as tofu or as a stray skin tone, and the result is a grid with
 * holes in it that looks broken rather than complete. Every character
 * here is one that draws.
 *
 * The VTES row comes first because it is the one a player at this table
 * actually reaches for; the rest follow the order every other picker uses,
 * so the tabs are where the hand expects them.
 */
export const EMOJI_CATEGORIES: Array<{ id: string; tab: string; name: string; emoji: string[] }> = [
  {
    id: "vtes",
    tab: "🩸",
    name: "Vampire",
    emoji: [
      "🩸", "🧛", "🧛‍♂️", "🧛‍♀️", "🦇", "⚰️", "💀", "☠️", "👻", "🧟", "🧟‍♂️", "🧟‍♀️",
      "🧙", "🧝", "👹", "👺", "😈", "👿", "🕯️", "🔮", "⛧", "🕸️", "🕷️", "🐺",
      "🌙", "🌚", "🌑", "🦉", "🗝️", "⛓️", "🏰", "⚱️", "🪦", "🥀", "🌹", "🍷",
      "⚔️", "🗡️", "🛡️", "🏹", "🔥", "💥", "👑", "🃏", "🎲", "💰", "⏳", "📜",
    ],
  },
  {
    id: "smileys",
    tab: "🙂",
    name: "Smileys",
    emoji: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊",
      "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙", "🥲", "😋", "😛", "😜",
      "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨", "😐", "😑", "😶",
      "😏", "😒", "🙄", "😬", "🤥", "😌", "😔", "😪", "🤤", "😴", "😷", "🤒",
      "🤕", "🤢", "🤮", "🤧", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "😎",
      "🤓", "🧐", "😕", "😟", "🙁", "😮", "😯", "😲", "😳", "🥺", "😦", "😧",
      "😨", "😰", "😥", "😢", "😭", "😱", "😖", "😣", "😞", "😓", "😩", "😫",
      "🥱", "😤", "😡", "😠", "🤬", "😈", "💩", "🤡", "👽", "🤖", "🎃", "😺",
    ],
  },
  {
    id: "people",
    tab: "👍",
    name: "People",
    emoji: [
      "👍", "👎", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉",
      "👆", "👇", "☝️", "✋", "🤚", "🖐️", "🖖", "👋", "🤝", "👏", "🙌", "👐",
      "🤲", "🙏", "✍️", "💅", "💪", "🦾", "🦵", "🦶", "👂", "👃", "🧠", "🦷",
      "👀", "👁️", "👅", "👄", "💋", "🧑", "👶", "🧒", "👦", "👧", "👨", "👩",
      "🧓", "👴", "👵", "🙅", "🙆", "💁", "🙋", "🧏", "🙇", "🤦", "🤷", "👮",
      "🕵️", "💂", "👷", "🤴", "👸", "👳", "👲", "🧕", "🤵", "👰", "🤰", "🎅",
      "🦸", "🦹", "🧚", "🧜", "🧞", "💃", "🕺", "👯", "🧖", "🧘", "🛌", "👥",
    ],
  },
  {
    id: "nature",
    tab: "🐺",
    name: "Nature",
    emoji: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮",
      "🐷", "🐸", "🐵", "🙈", "🙉", "🙊", "🐔", "🐧", "🐦", "🐤", "🦆", "🦅",
      "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛", "🦋", "🐌", "🐞", "🐜", "🦂",
      "🕷️", "🐢", "🐍", "🦎", "🦖", "🐙", "🦑", "🦐", "🦀", "🐡", "🐠", "🐟",
      "🐬", "🐳", "🦈", "🐊", "🐅", "🐆", "🦓", "🦍", "🐘", "🦏", "🐪", "🦒",
      "🐃", "🐎", "🐖", "🐑", "🐐", "🦌", "🐕", "🐈", "🐓", "🕊️", "🐇", "🐁",
      "🌵", "🎄", "🌲", "🌳", "🌴", "🌱", "🌿", "☘️", "🍀", "🎍", "🍃", "🍂",
      "🍁", "🌺", "🌻", "🌹", "🥀", "🌷", "🌸", "💐", "🍄", "🌰", "🌍", "🌕",
    ],
  },
  {
    id: "food",
    tab: "🍷",
    name: "Food",
    emoji: [
      "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈", "🍒",
      "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🍆", "🥑", "🥦", "🥬", "🥒", "🌶️",
      "🌽", "🥕", "🧄", "🧅", "🥔", "🍠", "🥐", "🥯", "🍞", "🥖", "🧀", "🥚",
      "🍳", "🥞", "🥓", "🍔", "🍟", "🍕", "🌭", "🥪", "🌮", "🌯", "🥗", "🍝",
      "🍜", "🍲", "🍛", "🍣", "🍱", "🥟", "🍤", "🍙", "🍚", "🍥", "🥠", "🍢",
      "🍡", "🍦", "🍰", "🎂", "🧁", "🥧", "🍫", "🍬", "🍭", "🍯", "🍼", "🥛",
      "☕", "🍵", "🍶", "🍾", "🍷", "🍸", "🍹", "🍺", "🍻", "🥂", "🥃", "🧊",
    ],
  },
  {
    id: "activity",
    tab: "🎲",
    name: "Activity",
    emoji: [
      "⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱", "🪀", "🏓",
      "🏸", "🏒", "🏑", "🥍", "🏏", "🥅", "⛳", "🪁", "🏹", "🎣", "🤿", "🥊",
      "🥋", "🎽", "🛹", "🛷", "⛸️", "🥌", "🎿", "⛷️", "🏂", "🏋️", "🤼", "🤸",
      "⛹️", "🤺", "🤾", "🏌️", "🏇", "🧗", "🏊", "🚴", "🚵", "🏆", "🥇", "🥈",
      "🥉", "🏅", "🎖️", "🎫", "🎪", "🎭", "🎨", "🎬", "🎤", "🎧", "🎼", "🎹",
      "🥁", "🎷", "🎺", "🎸", "🎻", "🎲", "♟️", "🎯", "🎳", "🎮", "🕹️", "🎰",
      "🃏", "🀄", "🎴", "🧩", "🪄", "🎁", "🎉", "🎊", "🎈", "✨", "🎇", "🎆",
    ],
  },
  {
    id: "travel",
    tab: "🏰",
    name: "Places",
    emoji: [
      "🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "🚐", "🚚", "🚛",
      "🚜", "🛵", "🏍️", "🚲", "🛴", "🚨", "🚔", "🚍", "🚝", "🚄", "🚅", "🚈",
      "🚂", "🚆", "🚇", "🚊", "🚉", "✈️", "🛫", "🛬", "🚀", "🛸", "🚁", "⛵",
      "🚤", "🛥️", "🛳️", "⚓", "⛽", "🚧", "🗺️", "🗿", "🗽", "🗼", "🏰", "🏯",
      "🏟️", "🎡", "🎢", "🎠", "⛲", "⛱️", "🏖️", "🏝️", "🏜️", "🌋", "⛰️", "🏔️",
      "🗻", "🏕️", "⛺", "🏠", "🏡", "🏘️", "🏚️", "🏗️", "🏭", "🏢", "🏬", "🏣",
      "🏥", "🏦", "🏨", "🏪", "🏫", "🏩", "💒", "⛪", "🕌", "🕍", "🛕", "⛩️",
      "🌃", "🌆", "🌇", "🌉", "🌌", "🌁", "🌫️", "🌊", "🔥", "❄️", "⭐", "🌟",
    ],
  },
  {
    id: "objects",
    tab: "💡",
    name: "Objects",
    emoji: [
      "⌚", "📱", "💻", "⌨️", "🖥️", "🖨️", "🖱️", "💽", "💾", "💿", "📀", "📷",
      "📸", "📹", "🎥", "📽️", "📺", "📻", "🎙️", "⏱️", "⏲️", "⏰", "🕰️", "⌛",
      "⏳", "📡", "🔋", "🔌", "💡", "🔦", "🕯️", "🪔", "🧯", "🛢️", "💸", "💵",
      "💴", "💶", "💷", "🪙", "💰", "💳", "💎", "⚖️", "🪜", "🧰", "🔧", "🔨",
      "⚒️", "🛠️", "⛏️", "🔩", "⚙️", "🧱", "⛓️", "🧲", "🔫", "💣", "🧨", "🪓",
      "🔪", "🗡️", "⚔️", "🛡️", "🚬", "⚰️", "🪦", "⚱️", "🏺", "🔮", "📿", "🧿",
      "💈", "⚗️", "🔭", "🔬", "🕳️", "💊", "💉", "🩸", "🩹", "🩺", "🚪", "🪞",
      "🪟", "🛏️", "🛋️", "🪑", "🚽", "🧹", "🧺", "🔑", "🗝️", "🗄️", "📋", "📌",
      "📎", "✂️", "🖊️", "✏️", "📝", "📖", "📚", "📕", "📜", "📄", "📰", "🔖",
    ],
  },
  {
    id: "symbols",
    tab: "❤️",
    name: "Symbols",
    emoji: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕",
      "💞", "💓", "💗", "💖", "💘", "💝", "☮️", "✝️", "☪️", "🕉️", "☸️", "✡️",
      "🔯", "🕎", "☯️", "☦️", "⛎", "♈", "♉", "♊", "♋", "♌", "♍", "♎",
      "♏", "♐", "♑", "♒", "♓", "🆔", "⚛️", "🉑", "☢️", "☣️", "📴", "📳",
      "🈶", "🈚", "🈸", "🈺", "🈷️", "✴️", "🆚", "💮", "🉐", "㊙️", "㊗️", "🈴",
      "❗", "❓", "❕", "❔", "‼️", "⁉️", "💯", "🔅", "🔆", "〽️", "⚠️", "🚸",
      "🔱", "⚜️", "🔰", "♻️", "✅", "🈯", "💹", "❇️", "✳️", "❎", "🌐", "💠",
      "Ⓜ️", "🌀", "💤", "🏧", "🚾", "♿", "🅿️", "🈳", "🈂️", "🛂", "🛃", "🛄",
      "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "⚫", "⚪", "🟤", "🔶", "🔷", "🔺",
    ],
  },
  {
    id: "flags",
    tab: "🏁",
    name: "Flags",
    emoji: [
      "🏁", "🚩", "🎌", "🏴", "🏳️", "🏳️‍🌈", "🏳️‍⚧️", "🏴‍☠️", "🇦🇷", "🇦🇺", "🇦🇹", "🇧🇪",
      "🇧🇷", "🇨🇦", "🇨🇱", "🇨🇳", "🇨🇿", "🇩🇰", "🇪🇬", "🇫🇮", "🇫🇷", "🇩🇪", "🇬🇷", "🇭🇰",
      "🇭🇺", "🇮🇸", "🇮🇳", "🇮🇩", "🇮🇪", "🇮🇱", "🇮🇹", "🇯🇵", "🇰🇷", "🇲🇽", "🇳🇱", "🇳🇿",
      "🇳🇴", "🇵🇭", "🇵🇱", "🇵🇹", "🇷🇴", "🇷🇺", "🇸🇦", "🇷🇸", "🇸🇬", "🇸🇰", "🇿🇦", "🇪🇸",
      "🇸🇪", "🇨🇭", "🇹🇭", "🇹🇷", "🇺🇦", "🇦🇪", "🇬🇧", "🇺🇸", "🇻🇪", "🇻🇳", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
    ],
  },
];

/** The tab shown when nobody has picked one. */
export const DEFAULT_EMOJI_CATEGORY = EMOJI_CATEGORIES[0]!.id;

/**
 * Every emoji the picker offers, flattened.
 *
 * Kept because "what can be inserted" is one question and the answer must
 * not depend on which tab happens to be open — the click handler validates
 * against this, not against the visible grid.
 */
export const CHAT_EMOJI: string[] = [
  // DEDUPED, because the categories deliberately overlap: the Vampire tab
  // is a shortcut to the ones a player at this table actually reaches for,
  // and several of those live in Objects or Symbols as well. That is right
  // for the tabs and wrong for a set of "what may be inserted".
  ...new Set(EMOJI_CATEGORIES.flatMap((c) => c.emoji)),
];

/**
 * The pad: one category's grid, with the tabs UNDER it (owner request).
 *
 * Shared by the lobby and the table rather than copied into each. The two
 * had their own inline copies of the old flat list, which is how a picker
 * ends up different in two places nobody compares side by side.
 */
export function emojiPad(active: string): string {
  const cat = EMOJI_CATEGORIES.find((c) => c.id === active) ?? EMOJI_CATEGORIES[0]!;
  return `
    <div class="emojipad" id="emojipad">
      <div class="emojigrid">
        ${cat.emoji
          .map((e) => `<button class="emoji" data-emoji="${esc(e)}" title="${esc(e)}">${e}</button>`)
          .join("")}
      </div>
      <div class="emojitabs" role="tablist">
        ${EMOJI_CATEGORIES.map(
          (c) => `<button class="emojitab ${c.id === cat.id ? "on" : ""}"
                          data-emojicat="${esc(c.id)}" role="tab"
                          aria-selected="${c.id === cat.id}"
                          title="${esc(c.name)}">${c.tab}</button>`,
        ).join("")}
      </div>
    </div>`;
}

function chatComposer(emojiOpen: boolean, emojiCategory: string): string {
  return `
    ${emojiOpen ? emojiPad(emojiCategory) : ""}
    <div class="row">
      <input id="chatinput" maxlength="${MAX_CHAT_TEXT}" placeholder="Say something…" />
      <button id="chatemoji" title="Emoji">🙂</button>
      <button id="chatsend">Send</button>
    </div>`;
}

/**
 * This player's own chat settings, behind the gear.
 *
 * The colour lives on the PROFILE, not in `settings.ts`, because it is
 * something about the person rather than about this screen: it travels
 * with them to a table and everyone sees them in it. That is why the same
 * control appears on the profile page — one value, two ways in.
 */
/**
 * The chat's colour control — OK and Cancel, and NOTHING that repaints
 * while it is open (owner report 2026-09-07: "the color picker on Chrome
 * closes when I click on it").
 *
 * Chrome's colour well is a native popover ANCHORED TO THE INPUT ELEMENT.
 * The screen re-renders whole on every change, so listening for `input`
 * — which fires as the player drags around the colour field — tore that
 * element out from under the popover and Chrome closed it. The value is
 * therefore held in the input until the player commits it, which is what
 * the two buttons are for: nothing here calls back into the app until OK.
 *
 * Shared by the lobby and the table so the control cannot end up
 * different in two places (see `emojiPad`).
 */
export function chatSettings(color: string, open: boolean): string {
  if (!open) return "";
  return `
    <div class="chatsettings">
      <label class="setrow">
        <span>Your name colour</span>
        <input type="color" id="chatcolor" value="${esc(color)}" />
      </label>
      <p class="setnote">
        Saved to your profile, so it follows you to every table — and
        everyone at the table sees you in it.
      </p>
      <div class="row setbuttons">
        <button id="chatcolor-ok" class="primary">OK</button>
        <button id="chatcolor-cancel">Cancel</button>
      </div>
    </div>`;
}

/**
 * The host's moderation panel: who is at the table, and what can be done
 * about them.
 *
 * HOST ONLY, and not merely hidden from everyone else — a guest's client
 * has nothing to kick anybody WITH. The host is the authority for the
 * game already (it validates every intent against the legal-move
 * generator), so it is the authority for the room too; there is no second
 * mechanism here, only a second use of the one that exists.
 *
 * A kick and a chat ban are deliberately different. Kicking removes a
 * PLAYER, and their seat is handed to a bot rather than left empty — a
 * game of VTES cannot skip a Methuselah's turn. Banning silences someone
 * who is still playing, which is the lighter thing to reach for and does
 * not touch the game at all.
 */
export interface ModerationView {
  people: Array<{ seat: string; name: string; remote: boolean; banned: boolean }>;
}

function moderationPanel(input: RenderInput): string {
  const view = input.moderation;
  if (!view) return "";
  // ONE ROW PER SEAT AT THE TABLE (owner request), not one per connected
  // peer. The seat list is the state's — every Methuselah in the game,
  // bot or person — and `moderation.people` only adds what the network
  // knows about them. Listing connections instead left the host and every
  // bot off a panel whose whole subject is who answers for each seat.
  const byId = new Map(view.people.map((p) => [p.seat, p]));
  const row = (id: string): string => {
    const p = byId.get(id);
    const remote = p?.remote ?? false;
    const you = id === input.localSeat;
    // A bot cannot be handed to a bot, and neither can a seat somebody is
    // sitting in: kick them first, which hands the seat over anyway. The
    // box is DISABLED rather than absent so the row still lines up and
    // still says what is true of that seat.
    const aiLocked = remote || you;
    const kind = you ? "you" : remote ? "player" : "bot";
    return `
      <div class="modrow">
        <span class="lname">${esc(p?.name ?? id)}</span>
        <span class="dim kind">${kind}</span>
        <label class="toggle ${aiLocked ? "off" : ""}"
               title="${
                 you
                   ? "your own seat — use Settings if you want to hand it over"
                   : remote
                     ? "somebody is playing this seat; kick them to hand it to a bot"
                     : "hand this seat to the computer"
               }">
          <input type="checkbox" class="ai-seat" data-seat="${esc(id)}"
                 ${input.aiSeats[id] ? "checked" : ""} ${aiLocked ? "disabled" : ""} /> AI
        </label>
        ${
          remote
            ? `<button class="mod-ban" data-seat="${esc(id)}">${
                p?.banned ? "Unban" : "Ban"
              }</button>
               <button class="mod-kick danger" data-seat="${esc(id)}">Kick</button>`
            : `<span class="dim">&mdash;</span>`
        }
      </div>`;
  };

  return `
    <div class="modal" id="mod-panel">
      <div class="modalcard">
        <h2>Moderation</h2>
        <p class="note">
          Everything here is about WHO ANSWERS FOR A SEAT — a person, a
          bot, or a person who is no longer welcome. Kicking a player hands
          their seat to a bot, because a game of VTES cannot skip a
          Methuselah's turn. A chat ban only silences them; they keep
          playing. A bot sees only what its seat may legitimately see and
          plays from the same list of legal moves a human does.
        </p>

        <div class="modrows">${input.state.seats.map((s) => row(s.id)).join("")}</div>

        <label class="setrow">
          <span>AI pace</span>
          <select id="aispeed">
            ${AI_SPEEDS.map(
              (s) =>
                `<option value="${s.ms}" ${s.ms === input.aiDelayMs ? "selected" : ""}>${esc(
                  s.label,
                )}${s.ms > 0 ? ` — ${(s.ms / 1000).toFixed(1)}s` : ""}</option>`,
            ).join("")}
          </select>
        </label>
        <p class="note">
          How long the table holds after each AI move you can see, so there
          is time to read what happened. Passes are never paced. Pacing
          changes no decision: the same game replays identically at any
          speed.
        </p>

        <label class="setrow">
          <span>Pass clock</span>
          <select id="passclock-set">
            ${PASS_TIMEOUTS.map(
              (t) =>
                `<option value="${t.ms}" ${
                  t.ms === (input.passTimeoutMs ?? 0) ? "selected" : ""
                }>${esc(t.label)}</option>`,
            ).join("")}
          </select>
        </label>
        <p class="note">
          How long a player may sit on a decision <b>during somebody
          else's turn</b> before the table passes for them. It applies to
          every person at the table, yourself included, and to no bot. It
          never runs on your own turn, and it can only ever take an answer
          the rules already offer — a pass. A decision you <i>must</i>
          answer (a strike, a discard) has no pass to take and is never
          timed out.
        </p>

        <div class="row"><button id="mod-close" class="primary">Close</button></div>
      </div>
    </div>`;
}
