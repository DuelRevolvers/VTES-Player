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
  Frame,
  GameEvent,
  GameState,
  MinionState,
  PermanentInPlay,
  SeatState,
} from "../engine/index.ts";
import type { DecisionPoint, LegalOption } from "../engine/index.ts";
import { isFaceDown } from "../engine/index.ts";
import { currentIntercept, currentStealth, predatorOf, preyOf } from "../engine/index.ts";
import { cardText, imageFor } from "./cardinfo.ts";
import { chatLines, MAX_CHAT_TEXT } from "./chat.ts";
import { minionName, narrate, owned } from "./narrate.ts";
import type { RuleSection } from "./rules.ts";
import { CREDITS, RULE_SECTIONS, searchRules } from "./rules.ts";
import { AI_SPEEDS, CARD_TEXT_SIZES } from "./settings.ts";

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
  /** The card the player has clicked open, if it is on the table. */
  selected: string | null;
  state: GameState;
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
        add(o.minion, o);
        // Diablerie and rescue name a victim in somebody's torpor region;
        // that card is where a player looks for them.
        add(o.targetMinion, o);
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

/** The lit-and-badged treatment, for any card on the table. */
function tableActionMarks(id: string, ctx: TableCtx | null): { cls: string; body: string } {
  const opts = ctx?.actions.get(id) ?? [];
  if (opts.length === 0) return { cls: "", body: "" };
  const open = ctx!.selected === id;
  return {
    cls: `actionable${open ? " selected" : ""}`,
    body:
      `<span class="playdot" title="${opts.length} action(s)">${opts.length}</span>` +
      (open ? playMenu(opts, ctx!.state, "down") : ""),
  };
}

/** Blood/life as pips, with the number for anything above a handful. */
function pips(n: number): string {
  if (n <= 0) return `<span class="pips empty">—</span>`;
  if (n > 6) return `<span class="pips">●×${n}</span>`;
  return `<span class="pips">${"●".repeat(n)}</span>`;
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
        ${p.counters ? `<span class="counter-badge">${p.counters}</span>` : ""}
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
    ${p.counters ? `<span class="counter-badge">${p.counters}</span>` : ""}
    ${mark.body}
  </div>`;
}

/** One player mat, with every zone the physical table has (design §4). */
function seatMat(
  state: GameState,
  seat: SeatState,
  dp: DecisionPoint | null,
  face: SeatFace | undefined,
  ctx: TableCtx | null,
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
        <span class="pile crypt" title="crypt draw pile">CRYPT ${seat.crypt.length}</span>
        <span class="pile library" title="library draw pile">LIBRARY ${seat.library.length}</span>
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
  return `<div class="ev ${line.weight}">${esc(line.text)}${tag}</div>`;
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

function decisionBar(
  dp: DecisionPoint | null,
  thinking: boolean,
  onTable: Set<LegalOption>,
  waitingFor: string | null,
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
      <div class="decision thinking">
        <span class="tdots"><i></i><i></i><i></i></span>
        <b>${esc(waitingFor)}</b> is deciding…
        ${dp ? `<span class="dim">${esc(dp.window)}</span>` : ""}
      </div>`;
  }
  if (!dp) {
    return `<div class="decision over"><b>Game over</b> — no decision pending.</div>`;
  }
  // An AI's move is being held back so it can be watched. The decision on
  // the table is THEIRS, so its options must not appear as buttons — a
  // human at the same screen would be answering for the computer.
  if (thinking) {
    return `
      <div class="decision thinking">
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
      <div class="decision">
        <div class="dhead">
          <span class="dseat">${esc(dp.seat)}</span>
          <span class="dwindow">${esc(dp.window)}</span>
          <span class="dim">seq ${dp.seq}</span>
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
  for (const o of dp.options) {
    // Card plays live ON the cards in hand, not as buttons up here — click
    // or drag the card itself.
    if (o.kind === "playCard" || o.kind === "discard") {
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
    <div class="decision">
      <div class="dhead">
        <span class="dseat">${esc(dp.seat)}</span>
        <span class="dwindow">${esc(dp.window)}</span>
        <span class="dim">seq ${dp.seq}</span>
      </div>
      ${body}
    </div>`;
}

/** Every legal play, indexed by the hand card it would play. */
export function playsByCard(dp: DecisionPoint | null): Map<string, LegalOption[]> {
  const byCard = new Map<string, LegalOption[]>();
  for (const o of dp?.options ?? []) {
    if (o.kind !== "playCard" && o.kind !== "discard") continue;
    const list = byCard.get(o.card) ?? [];
    list.push(o);
    byCard.set(o.card, list);
  }
  return byCard;
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
        ${isSelected && plays.length > 0 ? playMenu(plays, state) : ""}
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
function playMenu(
  plays: LegalOption[],
  state: GameState,
  // A hand card sits at the bottom of the screen, so its menu grows UP; a
  // card on the table has room below it.
  grow: "up" | "down" = "up",
): string {
  return `<div class="playmenu ${grow}">${plays
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
  // Which sections are expanded is remembered by the caller: the screen
  // fully re-renders on every state change, and an agent or auto-passing
  // seat can step while the panel is open, which would otherwise collapse
  // whatever the player was reading.
  const query = input.helpQuery.trim();
  const matches = searchRules(query);
  // While searching, every hit opens: the player is looking for a phrase,
  // not a heading, and making them click each result would defeat the
  // point. With no query the remembered open/closed state applies.
  const searching = query.length > 0;
  const section = (s: RuleSection): string => `
    <details class="rulesec" data-rule="${esc(s.id)}"
             ${searching || input.helpOpenSections.includes(s.id) ? "open" : ""}>
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
               value="${esc(input.helpQuery)}" />
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
  notices: string[];
  /**
   * The finished game, when it is over and this client has somewhere to
   * go afterwards — the leaderboard prompt. Null while the game runs, and
   * on a table with no shell behind it (the playtest snapshot).
   */
  finished: FinishedView | null;
  /** The pause after each visible AI move, in ms — the Settings control. */
  aiDelayMs: number;
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
  /** Whose ash heap is open, if any. View state — the zone is public. */
  ashOpen: string | null;
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
  /** The moderation panel, when it is open: who is here and who is
   *  chat-banned. Null when closed. */
  moderation: ModerationView | null;
}

export function render(input: RenderInput): string {
  const { state, dp } = input;

  // While an AI's move is paced — or while the seat being asked belongs to
  // somebody else entirely — the decision on the table is THEIRS, and
  // nothing on screen may offer to answer it, the table included.
  const ctx: TableCtx | null = input.thinking || input.waitingFor
    ? null
    : {
        actions: actionsByTableCard(dp, state),
        selected: input.selectedCard,
        state,
      };
  const onTable = new Set<LegalOption>();
  for (const list of ctx?.actions.values() ?? []) for (const o of list) onTable.add(o);

  const events = state.eventLog
    .slice(-400)
    .map((ev) => eventLine(ev, state, input.omniscient))
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
    ${actionStrip(state)}
    ${combatStrip(state)}
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
          <div class="table" style="--seat-cols:${seatColumns(state.seats.length)}">
            ${state.seats
              .map((s) => seatMat(state, s, dp, input.seatFaces[s.id], ctx))
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
          )}
          ${decisionBar(dp, input.thinking, onTable, input.waitingFor)}
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
          <!--
            NOTICES ARE LOG LINES, not chat. A seat changing hands is not
            an engine event — nothing in the game changed — but it changes
            who is answering, so it belongs where the players are already
            reading rather than in a conversation that scrolls away
            (owner request). They sit at the end, which is where the log
            is scrolled to.
          -->
          <div class="events" id="events">${events}${input.notices
            .map((n) => `<div class="ev notice">${esc(n)}</div>`)
            .join("")}</div>
        </div>
        ${input.canChat ? chatPanel(input.chatColor, input.chatSettingsOpen, input.emojiOpen) : ""}
      </aside>
    </div>
    ${moderationPanel(input)}
    ${settingsPanel(input)}
    ${helpPanel(input)}
    ${ashPanel(state, input.ashOpen)}
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
function chatPanel(color: string, settingsOpen: boolean, emojiOpen: boolean): string {
  return `
    <div class="panel chatbox tablechat">
      <h3>Table chat
        <button id="chat-gear" class="chatgear" title="Chat settings">⚙</button>
      </h3>
      ${chatSettings(color, settingsOpen)}
      ${chatLinesMarkup()}
      ${chatComposer(emojiOpen)}
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
export const CHAT_EMOJI = [
  "🙂", "😄", "😂", "😉", "😍", "😎", "🤔", "😐",
  "😢", "😡", "😱", "🎉", "👍", "👎", "👏", "🙏",
  "🩸", "🧛", "🦇", "⚰️", "💀", "🔥", "⚔️", "🛡",
  "🃏", "🎲", "👑", "💰", "⏳", "❤️", "💔", "✨",
];

function chatComposer(emojiOpen: boolean): string {
  return `
    ${
      emojiOpen
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
function chatSettings(color: string, open: boolean): string {
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

        <div class="row"><button id="mod-close" class="primary">Close</button></div>
      </div>
    </div>`;
}
