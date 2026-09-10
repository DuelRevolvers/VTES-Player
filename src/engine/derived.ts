/**
 * Derived values — never stored, always recomputed (design §7, §9.5).
 * Stealth, bleed, intercept, block eligibility, and sequencing order are
 * pure functions of the event log and current frame data, so effects like
 * Deflection's target change compose with zero bookkeeping.
 */

import type {
  ActionFrame,
  ActionId,
  ActionKind,
  CombatFrame,
  ConditionalStatic,
  DisciplineLevel,
  GameEvent,
  GameState,
  MinionId,
  MinionState,
  PermanentInPlay,
  PermanentStatics,
  PlayCostCardType,
  PlayCostMod,
  SeatId,
} from "./state.ts";
// No `getMinion` here on purpose: a derived read must be TOTAL. Everything
// in this module is asked about a minion that may have left play mid-action
// or mid-combat, and a throw from here surfaces as a game that cannot be
// answered rather than as an error anyone can act on.
import { findMinion, getSeat, isReady } from "./state.ts";

/**
 * A vampire's capacity, including cards that raise it (the Discipline
 * master cards: "+1 level of Celerity and +1 capacity").
 *
 * Capacity is three things at once (p. 11): the blood maximum, the pool a
 * Methuselah must invest to gain control, and the older/younger comparison.
 * Every one of those must read THIS, not the printed `capacity` field —
 * which stays as the printed value, like `MinionState.strength` does.
 */
export function capacityOf(m: MinionState): number {
  let capacity = m.capacity;
  for (const p of m.attached) capacity += p.statics.capacityBonus ?? 0;
  return capacity;
}

/**
 * Can this minion actually gain blood (or, for an ally, life)?
 *
 * p. 6: "A vampire cannot have more blood than their capacity; **if an
 * effect puts more blood on them than their capacity allows, the excess
 * is always moved to the blood bank immediately.**" So blood added to a
 * full minion is not stored anywhere — it is simply gone.
 *
 * THE POINT OF THE HELPER IS THE OPTION LIST. An effect whose whole
 * content is "gain N blood" does nothing at all for a full minion, and
 * offering it invites a player to spend a transfer, a lock, or a pool
 * counter for nothing — which is exactly what an owner playtest found
 * (docs/futile-options-design.md). Asked in one place so a seventh site
 * cannot quietly disagree with the other six.
 *
 * Deliberately NOT used to gate an action that merely *includes* a blood
 * gain (a hunt still triggers `onHuntSuccess` cards, so a full vampire
 * hunting is a legal if unusual play).
 */
export function canGainBlood(m: MinionState): boolean {
  return m.blood < capacityOf(m);
}

/**
 * "While \<this vampire\> is ready, zombies (allies and retainers) you
 * recruit or employ get +1 starting life" (Ashur-uballit).
 *
 * Read at the entry path from the tags of the card ARRIVING, because the
 * minion does not exist yet — its own self-attached entry, which is where
 * a printed sub-type lives, is emitted after `AllyEnteredPlay`.
 * docs/crypt-wave-6.md §4
 */
export function startingLifeBonus(
  state: GameState,
  seat: SeatId,
  tags: readonly string[],
): number {
  let bonus = 0;
  for (const m of getSeat(state, seat).minions) {
    if (!isReady(m)) continue;
    for (const p of m.attached) {
      const r = p.statics.recruitLifeBonus;
      // "…YOU recruit or employ": the card's controller, who is not
      // always the bearer's controller (p. 16).
      if (!r || (p.controller ?? m.controller) !== seat) continue;
      if (tags.includes(r.tag)) bonus += r.amount;
    }
  }
  return bonus;
}

/**
 * The same question for an UNCONTROLLED vampire, whose counters are
 * invested pool rather than blood (p. 6). Once the stack reaches capacity
 * the vampire can be influenced out, and every further counter "drains
 * back to the blood bank" the moment they enter play — so a transfer past
 * this point burns a pool counter for nothing.
 */
export function uncontrolledCanTakeCounters(u: {
  card: MinionState;
  counters: number;
}): boolean {
  return u.counters < capacityOf(u.card);
}

/**
 * A vampire's Disciplines, including cards that grant levels ("+1 level of
 * Celerity"): none → basic → superior, and superior is the ceiling.
 *
 * Returns the printed record untouched when nothing modifies it, so the
 * common case allocates nothing.
 */
export function disciplinesOf(m: MinionState): Record<string, DisciplineLevel> {
  const boosts = m.attached.flatMap((p) =>
    p.statics.disciplineBoost ? [p.statics.disciplineBoost] : [],
  );
  if (boosts.length === 0) return m.disciplines;
  const out: Record<string, DisciplineLevel> = { ...m.disciplines };
  for (const d of boosts) {
    out[d] = out[d] === undefined ? "basic" : "superior";
  }
  return out;
}

export function seatIndex(state: GameState, seat: SeatId): number {
  const i = state.seats.findIndex((s) => s.id === seat);
  if (i < 0) throw new Error(`unknown seat: ${seat}`);
  return i;
}

/** Next standing seat clockwise — "when your prey is ousted, the next
 *  Methuselah to your left becomes your new prey" (p. 15). */
export function preyOf(state: GameState, seat: SeatId): SeatId {
  const n = state.seats.length;
  const start = seatIndex(state, seat);
  for (let k = 1; k <= n; k++) {
    const s = state.seats[(start + k) % n];
    if (s && !s.ousted) return s.id;
  }
  return seat;
}

export function predatorOf(state: GameState, seat: SeatId): SeatId {
  const n = state.seats.length;
  const start = seatIndex(state, seat);
  for (let k = 1; k <= n; k++) {
    const s = state.seats[(start - k + n * n) % n];
    if (s && !s.ousted) return s.id;
  }
  return seat;
}

/**
 * The universal sequencing order (rulebook p. 8, design §2.1): the acting
 * Methuselah first, then the defender(s) in the given order, then every
 * other standing Methuselah clockwise from the acting seat.
 */
export function sequencingOrder(
  state: GameState,
  actingSeat: SeatId,
  defenders: SeatId[],
): SeatId[] {
  const order: SeatId[] = [actingSeat];
  for (const d of defenders) {
    if (!order.includes(d) && !getSeat(state, d).ousted) order.push(d);
  }
  const n = state.seats.length;
  const start = seatIndex(state, actingSeat);
  for (let k = 1; k < n; k++) {
    const seat = state.seats[(start + k) % n];
    if (seat && !seat.ousted && !order.includes(seat.id)) order.push(seat.id);
  }
  return order;
}

/** Directed: only the targeted Methuselah(s) may block; undirected: prey
 *  first, then predator (rulebook p. 25). */
export function defendersFor(state: GameState, af: ActionFrame): SeatId[] {
  if (af.directed) return af.target === null ? [] : [af.target];
  return [preyOf(state, af.actingSeat), predatorOf(state, af.actingSeat)];
}

export function blockEligibleSeats(state: GameState, af: ActionFrame): SeatId[] {
  return defendersFor(state, af).filter(
    (s) => s !== af.actingSeat && !getSeat(state, s).ousted,
  );
}

/** Base bleed = acting minion's bleed amount, plus modifier events for
 *  this action ("all modifications … remain in effect for the duration of
 *  the action", p. 26). */
export function currentBleed(state: GameState, af: ActionFrame): number {
  // THE ACTING MINION CAN BE GONE. An ally's life is its blood (p. 11), so
  // one at 1 life that pays a card's blood cost pays with the last of
  // itself and `burnDepleted` removes it — in the middle of its own
  // action. Every other reader of `af.acting` in the engine already uses
  // `findMinion` for exactly this ("a minion can leave play at any point,
  // so read it with findMinion, not getMinion" — the lesson the combat
  // sweeps learned); this was the one that did not, and it threw out of
  // `settle`, which surfaced as a table with no buttons on it.
  //
  // A bleed with nobody doing the bleeding is worth NOTHING. The event-log
  // fold below is deliberately skipped with it: those modifiers are
  // bonuses TO a bleed, and there is no longer a bleed to add them to.
  const acting = findMinion(state, af.acting);
  if (!acting) return 0;
  return bleedOf(state, acting, af.actionKind, af.target, af.actionId);
}

/**
 * What a bleed by this minion WOULD be worth, announced right now.
 *
 * The same computation as `currentBleed`, against an announcement that has
 * not happened yet — so the option list can say what a bleed is actually
 * worth instead of leaving every reader to guess from the minion's printed
 * `bleedAmount` (docs/richer-options-design.md). The AI was doing exactly
 * that guessing, and a bleed is its most common real decision.
 *
 * Everything the calculation needs is fixed at announcement anyway (p. 25)
 * — the kind, the target, the actor — so synthesizing it is not a second
 * model. `actionId` is null, which correctly contributes nothing from the
 * event-log fold: no modifier has been played on an action that does not
 * exist.
 */
export function prospectiveBleed(
  state: GameState,
  minion: MinionState,
  target: SeatId | null,
): number {
  return bleedOf(state, minion, "bleed", target, null);
}

function bleedOf(
  state: GameState,
  acting: MinionState,
  actionKind: ActionKind,
  target: SeatId | null,
  actionId: ActionId | null,
): number {
  const af = { actionKind, target } as const;
  let bleed = acting.bleedAmount;
  // Persistent +bleed statics from attached cards (Heart of the City).
  for (const p of acting.attached) bleed += p.statics.bleed ?? 0;
  // "If you control a locked minion, Elen must bleed WITH +1 BLEED" — the
  // compulsion and the bonus are one sentence, so this reads the same
  // condition the mandatory-action gate does. Applying it while she is
  // free would be inventing text.
  if (af.actionKind === "bleed") {
    // "If you control a LOCKED MINION" — never counting HERSELF. She
    // locked at announcement (p. 25), so a check that included her would
    // be true of every bleed she ever makes, and the condition would be
    // no condition at all. The gate in `minionPhaseOptions` reads the
    // board before she locks and so agrees by construction.
    const controlsLocked = getSeat(state, acting.controller).minions.some(
      (m) => m.id !== acting.id && isReady(m) && m.locked,
    );
    for (const p of acting.attached) {
      const mb = p.statics.mustBleed;
      if (!mb) continue;
      if (mb.whileControlsLocked && !controlsLocked) continue;
      bleed += mb.bonus;
    }
  }
  // "+1 bleed for each unique equipment attached to him" (Hesha) — a
  // count over the bearer's OTHER attachments, matched by tag.
  for (const p of acting.attached) {
    const per = p.statics.bleedPerAttached;
    if (!per) continue;
    const n = acting.attached.filter(
      (q) => q.card.id !== p.card.id && per.tags.every((t) => q.tags.includes(t)),
    ).length;
    bleed += per.amount * n;
  }
  // "+N bleed AGAINST YOUR PREY" (Tier of Souls) — "your" is the card's
  // controller, which is not always the bearer's
  // (docs/action-attachments-design.md §3).
  if (af.actionKind === "bleed" && af.target !== null) {
    for (const p of acting.attached) {
      const n = p.statics.bleedAgainstPrey;
      if (!n) continue;
      if (af.target === preyOf(state, p.controller ?? acting.controller)) bleed += n;
    }
  }
  // "Ravnos get +1 bleed" — a clan-wide aura from a card in play.
  bleed += auraBonus(state, acting, "bleed");
  // "While your prey has 10 or fewer pool, Üresség gets +1 bleed" — a
  // crypt card's own conditional static, read against this action.
  //
  // For a PROSPECTIVE bleed there is no announcement to look up, so one is
  // synthesized from what announcing would fix (p. 25). A built-in bleed
  // plays no card, so it requires no card types, and a bleed is directed.
  bleed += conditionalStaticFor(
    state,
    actionId === null
      ? {
          type: "ActionAnnounced",
          actionId: "",
          seat: acting.controller,
          acting: acting.id,
          actionKind,
          target,
          directed: true,
        }
      : ((state.eventLog.find(
          (ev) => ev.type === "ActionAnnounced" && ev.actionId === actionId,
        ) as Extract<GameEvent, { type: "ActionAnnounced" }> | undefined) ?? {
          type: "ActionAnnounced",
          actionId,
          seat: acting.controller,
          acting: acting.id,
          actionKind,
          target,
          directed: target !== null,
        }),
    acting,
    "bleed",
  );
  // Only a real action has modifiers played on it.
  if (actionId !== null) {
    for (const ev of state.eventLog) {
      if (ev.type === "BleedAmountModified" && ev.actionId === actionId) {
        bleed += ev.delta;
      }
    }
  }
  // "Vampires with capacity 4 or less get -1 bleed against you".
  if (af.actionKind === "bleed" && af.target !== null && acting.kind === "vampire") {
    bleed += bleedAuraAgainst(state, acting, af.target);
  }
  return bleed;
}

/** "Vampires with capacity 4 or less get -1 bleed against you"
 *  (Aranthebes) — an aura on the bleed TARGET's cards in play, so it is
 *  resolved here rather than through auraBonus (which keys off the acting
 *  minion alone). */
export function bleedAuraAgainst(
  state: GameState,
  acting: MinionState,
  target: SeatId,
): number {
  let total = 0;
  for (const p of getSeat(state, target).permanents) {
    const aura = p.aura;
    if (!aura?.bleedAgainstController) continue;
    if (aura.requiresUnlocked && p.locked) continue;
    if ((p.controller ?? target) !== target) continue;
    if (aura.clan !== undefined && acting.clan !== aura.clan) continue;
    if (aura.sect !== undefined && acting.sect !== aura.sect) continue;
    if (aura.maxCapacity !== undefined && capacityOf(acting) > aura.maxCapacity) continue;
    total += aura.bleedAgainstController;
  }
  return total;
}

/** Hand size = 7 + statics from cards in play (p. 7). */
export function handSizeOf(state: GameState, seatId: SeatId): number {
  let size = 7;
  for (const p of getSeat(state, seatId).permanents) {
    size += p.statics.handSize ?? 0;
    // "+1 hand size for each counter on this card" (Visit from the
    // Capuchin) — moves with the counters (docs/counter-sinks-design.md).
    if (p.statics.handSizePerCounter) size += p.counters ?? 0;
  }
  // "While Carmelita is ready, you get +1 hand size" — a crypt card's own
  // text, which rides on the MINION rather than at seat level, and is
  // conditional on board state that moves under it (Khin Aye's compares
  // the predator's ready minions to yours). Asked with no action, so a
  // static carrying an action condition correctly contributes nothing
  // (docs/crypt-wave-1.md §2).
  for (const m of getSeat(state, seatId).minions) {
    if (!isReady(m)) continue;
    size += conditionalStaticNoAction(state, m, "handSize");
  }
  // "While the employer is in combat, the opposing minion's controller
  // gets −1 hand size" (Raptor superior) — DERIVED from the live combat,
  // never stored, so it lifts by itself whichever way the combat ended
  // (docs/retainer-wave-design.md §1).
  for (const s of opposingCombatStatics(state, seatId)) {
    size -= s.opposingHandSizePenalty ?? 0;
  }
  // "+2 hand size until the end of the turn" (Dreams of the Sphinx) and
  // "this combat, you get +1 hand size" (Rage of Apedemak): a bonus held
  // on the frame whose lifetime it shares, so the frame going away IS the
  // expiry — the same derivation, for the same reason
  // (docs/temporary-hand-size-design.md §2).
  for (const f of state.frames) {
    if (f.kind !== "turn" && f.kind !== "combat") continue;
    for (const g of f.handSizeBonus ?? []) {
      if (g.seat === seatId) size += g.amount;
    }
  }
  return size;
}

/**
 * Statics radiated at `seatId` by a retainer on the OTHER combatant of a
 * live combat — the derivation both of §1's cards share.
 *
 * Nothing is stored and nothing is cleared: a combat can end by a strike,
 * by a card, by a combatant leaving play or by the frame popping from
 * three sites, and a flag that has to be cleaned up at all of them is a
 * flag that will one day survive one of them.
 */
/**
 * The minion on the other side of the live combat from `minionId`, or
 * null when they are not fighting.
 *
 * Read on demand rather than stored, for the reason
 * `docs/retainer-wave-design.md` §1 gives: a combat ends four different
 * ways, and anything that has to be cleaned up at all of them will one
 * day survive one of them.
 */
export function opposingCombatantOf(
  state: GameState,
  minionId: MinionId,
): MinionState | null {
  for (const f of state.frames) {
    if (f.kind !== "combat") continue;
    if (f.acting === minionId) return findMinion(state, f.opposing);
    if (f.opposing === minionId) return findMinion(state, f.acting);
  }
  return null;
}

/**
 * "\<Clan\> get +N strength in combat with \<this vampire\>" (Kevin
 * Jackson's second half) — a bonus a combatant grants to whoever is
 * fighting them, which is the mirror of every other static here.
 */
export function opposingGrantedStrength(state: GameState, m: MinionState): number {
  const foe = opposingCombatantOf(state, m.id);
  if (!foe) return 0;
  let total = 0;
  for (const p of foe.attached) {
    const g = p.statics.opposingStrengthBonus;
    if (!g) continue;
    if (g.clan !== undefined && m.clan !== g.clan) continue;
    total += g.amount;
  }
  return total;
}

export function opposingCombatStatics(
  state: GameState,
  seatId: SeatId,
): PermanentStatics[] {
  const out: PermanentStatics[] = [];
  for (const f of state.frames) {
    if (f.kind !== "combat") continue;
    for (const [me, foe] of [
      [f.acting, f.opposing],
      [f.opposing, f.acting],
    ] as const) {
      const victim = findMinion(state, me);
      const bearer = findMinion(state, foe);
      // "The OPPOSING minion's controller" — the seat, not the minion.
      if (!victim || !bearer || victim.controller !== seatId) continue;
      if (bearer.controller === seatId) continue; // both sides one seat: vacuous
      for (const p of bearer.attached) {
        if (p.statics.revealsOpposingHand || p.statics.opposingHandSizePenalty) {
          out.push(p.statics);
        }
      }
    }
  }
  return out;
}

/**
 * Whose hands `viewer` may read, beyond their own — "the opposing
 * minion's controller plays with an OPEN HAND" (Owl Companion).
 * docs/retainer-wave-design.md §1
 */
export function openHandsFor(state: GameState, viewer: SeatId): SeatId[] {
  const out: SeatId[] = [];
  // A viewer who holds no seat sees nobody's hand — which is not an edge
  // case but the SPECTATOR view (docs/lobby-design.md §10): `redactFor` is
  // asked to mask to nobody, and both rules below are keyed on the viewer
  // controlling something. Without this, masking to nobody throws in
  // `getSeat`, and "mask to nobody" is the one call that has to be total.
  if (!state.seats.some((s) => s.id === viewer)) return out;
  // "Your prey plays with an open hand" (Revelations superior) — a card in
  // play rather than a combat, so it is not bounded by a frame; but "prey"
  // is derived on every read, so an oust that changes who your prey is
  // moves the effect with no bookkeeping.
  // docs/last-buildable-design.md §2
  for (const p of getSeat(state, viewer).permanents) {
    if (p.statics.opensPreyHand) out.push(preyOf(state, viewer));
  }
  for (const s of state.seats) {
    if (s.id === viewer || s.ousted) continue;
    const open = opposingCombatStatics(state, s.id).some(
      (st) => st.revealsOpposingHand,
    );
    if (!open) continue;
    // …and it is open to the RETAINER's controller, not to the table.
    for (const f of state.frames) {
      if (f.kind !== "combat") continue;
      for (const [me, foe] of [
        [f.acting, f.opposing],
        [f.opposing, f.acting],
      ] as const) {
        const victim = findMinion(state, me);
        const bearer = findMinion(state, foe);
        if (!victim || !bearer || victim.controller !== s.id) continue;
        if (bearer.controller !== viewer) continue;
        if (bearer.attached.some((p) => p.statics.revealsOpposingHand)) {
          out.push(s.id);
        }
      }
    }
  }
  return out;
}

/**
 * Bonus a minion picks up from *other* cards in play that radiate onto it
 * ("Gangrel you control get +1 strength", "Assamites get +1 stealth when
 * bleeding") — as opposed to statics on cards attached to the minion
 * itself. Every seat's cards in play are scanned; a "controller"-scoped
 * aura only reaches minions of the seat controlling that card.
 */
export function auraBonus(
  state: GameState,
  minion: MinionState,
  key: "strength" | "bleedStealth" | "maneuverPerCombat" | "bleed" | "hunt" | "votes",
): number {
  let total = 0;
  const apply = (entry: PermanentInPlay, holder: SeatId): void => {
    const controller = entry.controller ?? holder;
    // A card may print more than one aura clause with different filters
    // (New Carthage) — `auras` is additive with the singular `aura`, so
    // every existing card reads exactly as before.
    for (const aura of [...(entry.aura ? [entry.aura] : []), ...(entry.auras ?? [])]) {
      if (aura.scope === "controller" && minion.controller !== controller) continue;
      if (aura.clan !== undefined && minion.clan !== aura.clan) continue;
      if (aura.sect !== undefined && minion.sect !== aura.sect) continue;
      if (aura.titledOnly && minion.title === null) continue;
      // "WHILE your prey controls a vampire in torpor" (Raising the
      // Portcullis) — the first aura condition that reads another seat's
      // board, derived on every read so nothing has to notice when it
      // stops holding (docs/opposing-statics-design.md §3).
      if (aura.whilePreyHasTorporVampire) {
        const prey = getSeat(state, preyOf(state, controller));
        if (!prey.minions.some((m) => m.kind === "vampire" && m.inTorpor)) continue;
      }
      total += aura[key] ?? 0;
    }
  };
  for (const seat of state.seats) {
    for (const p of seat.permanents) apply(p, seat.id);
    for (const m of seat.minions) {
      for (const p of m.attached) apply(p, m.controller);
    }
  }
  return total;
}

/**
 * Blood gained by a successful hunt: 1 by default (p. 21), plus any
 * "+N hunt" aura ("Sabbat vampires you control get +1 hunt", The Hungry
 * Coyote). The bonus is a TRAIT of the minion, not of the action, so it
 * applies to every hunt they make. docs/blood-locations-design.md §4
 */
export function huntAmountFor(state: GameState, minion: MinionState): number {
  // Two sources, and they are different questions: an AURA radiates onto
  // other minions ("Sabbat vampires you control get +1 hunt"), while a
  // STATIC sits on a card attached to this minion and applies to it alone
  // (Aaron's Feeding Razor). Equipment cannot use the aura — an unfiltered
  // one would feed every minion at the table.
  const attached = minion.attached.reduce((n, p) => n + (p.statics.hunt ?? 0), 0);
  return 1 + auraBonus(state, minion, "hunt") + attached;
}

/**
 * What a hunt would ACTUALLY put on this vampire — the hunt amount capped
 * by what they can still hold.
 *
 * p. 6 is the reason the cap belongs here: excess blood goes to the BLOOD
 * BANK, not to the Methuselah's pool, so hunting at capacity gains
 * nobody anything. **Zero is a real answer**, and the option stays legal
 * with it — a full vampire hunting still triggers cards that care about a
 * successful hunt, which is why the hunt is deliberately not gated by
 * `canGainBlood` (docs/futile-options-design.md).
 */
export function huntGain(state: GameState, minion: MinionState): number {
  return Math.max(0, Math.min(huntAmountFor(state, minion), capacityOf(minion) - minion.blood));
}

/** Inherent stealth (e.g. hunt's +1, p. 21) is emitted as a
 *  StealthModified event at announcement, so one fold covers everything.
 *  Stealth may go below 0 (p. 26). */
/**
 * Does a conditional static apply to this action, for a static sitting on
 * `bearer`? Every condition present must hold; an absent one does not
 * constrain (docs/conditional-statics-design.md §2).
 */
function conditionHolds(
  c: ConditionalStatic,
  announced: Extract<GameEvent, { type: "ActionAnnounced" }> | null,
  bearer: MinionState,
  state: GameState,
): boolean {
  // Every clause that talks about an ACTION cannot hold when there is no
  // action — `handSizeOf` asks with none. Absent clauses do not
  // constrain, so a purely board-conditioned static still applies.
  const needsAction =
    c.actionKinds !== undefined ||
    c.actionCardTypes !== undefined ||
    c.directedAtController !== undefined ||
    c.actionDirected !== undefined ||
    c.actingMinion !== undefined ||
    c.controller?.targetControlsClan !== undefined;
  if (needsAction && !announced) return false;
  if (announced) {
    if (c.actionKinds && !c.actionKinds.includes(announced.actionKind)) return false;
    if (c.actionCardTypes) {
      const types = announced.cardTypes ?? [];
      if (!c.actionCardTypes.some((t) => types.includes(t))) return false;
    }
    // "…directed at their controller" — the action names a seat (p. 25)
    // and that seat is the one this static's bearer answers to.
    if (c.directedAtController) {
      if (!announced.directed || announced.target !== bearer.controller) return false;
    }
    // "…during directed / undirected actions": only whether the action
    // names a seat, not which one.
    if (c.actionDirected !== undefined && announced.directed !== c.actionDirected) {
      return false;
    }
    // A condition on the ACTING minion — "against titled vampires".
    if (c.actingMinion) {
      const a = findMinion(state, announced.acting);
      const f = c.actingMinion;
      if (!a) return false;
      if (f.titled === true && a.title === null) return false;
      if (f.titled === false && a.title !== null) return false;
      if (f.clan !== undefined && a.clan !== f.clan) return false;
      if (f.kind !== undefined && a.kind !== f.kind) return false;
      if (f.maxCapacity !== undefined && capacityOf(a) > f.maxCapacity) return false;
      // Relative to the BEARER's DERIVED capacity, so a granted point
      // counts on both sides.
      if (f.younger === true && capacityOf(a) >= capacityOf(bearer)) return false;
      if (f.older === true && capacityOf(a) <= capacityOf(bearer)) return false;
    }
    if (c.controller?.targetControlsClan) {
      if (announced.target === null) return false;
      const seat = state.seats.find((s) => s.id === announced.target);
      const clans = c.controller.targetControlsClan;
      if (!seat || !seat.minions.some((m) => m.clan !== null && clans.includes(m.clan))) {
        return false;
      }
    }
  }
  // "The bearer with (superior) Auspex …" (Bowl of Convergence). Derived,
  // not printed: a Discipline master grants the level while it is in play
  // and takes it away again when it leaves (§2).
  if (c.bearerDiscipline) {
    const have = disciplinesOf(bearer)[c.bearerDiscipline.discipline];
    if (!have) return false;
    if (c.bearerDiscipline.level === "superior" && have !== "superior") return false;
  }
  // "…in combat with a Brujah" — read off the live combat frame, so it
  // is true exactly while the fight lasts and needs no cleanup.
  if (c.inCombatWith) {
    const foe = opposingCombatantOf(state, bearer.id);
    const f = c.inCombatWith;
    if (!foe) return false;
    if (f.titled === true && foe.title === null) return false;
    if (f.clan !== undefined && foe.clan !== f.clan) return false;
    if (f.kind !== undefined && foe.kind !== f.kind) return false;
    if (f.younger === true && capacityOf(foe) >= capacityOf(bearer)) return false;
  }
  // Board conditions, every one derived on this read.
  const cc = c.controller;
  if (cc) {
    const seat = state.seats.find((s) => s.id === bearer.controller);
    if (!seat) return false;
    if (cc.poolAtMost !== undefined && seat.pool > cc.poolAtMost) return false;
    if (cc.hasEdge === true && state.edge !== bearer.controller) return false;
    if (cc.controlsReadyTitle) {
      const has = seat.minions.some(
        (m) =>
          m.kind === "vampire" &&
          isReady(m) &&
          m.title !== null &&
          cc.controlsReadyTitle!.includes(m.title),
      );
      if (!has) return false;
    }
    if (cc.locations !== undefined) {
      const n = seat.permanents.filter((p) => p.tags.includes("location")).length;
      if (cc.locations === "none" && n > 0) return false;
      if (cc.locations === "some" && n === 0) return false;
    }
    if (cc.preyPoolAtMost !== undefined) {
      const prey = state.seats.find((s) => s.id === preyOf(state, bearer.controller));
      if (!prey || prey.pool > cc.preyPoolAtMost) return false;
    }
    if (cc.predatorHasMoreReadyMinions === true) {
      const pred = state.seats.find((s) => s.id === predatorOf(state, bearer.controller));
      if (!pred) return false;
      const mine = seat.minions.filter(isReady).length;
      if (pred.minions.filter(isReady).length <= mine) return false;
    }
  }
  return true;
}

/** Sum the conditional statics on `minion` that apply to this action. */
export function conditionalStatic(
  state: GameState,
  actionId: ActionId,
  minion: MinionState,
  field: "stealth" | "intercept" | "bleed" | "strength" | "votes",
): number {
  const announced = state.eventLog.find(
    (ev) => ev.type === "ActionAnnounced" && ev.actionId === actionId,
  );
  if (!announced || announced.type !== "ActionAnnounced") return 0;
  return conditionalStaticFor(state, announced, minion, field);
}

/**
 * The same sum against an announcement handed in rather than looked up.
 *
 * It exists so a PROSPECTIVE action can be priced — "what would this bleed
 * be worth if announced now" — without a second copy of these rules. The
 * caller synthesizes the announcement it is about to make, which is honest
 * because everything read here (kind, directedness, target, actor) is
 * fixed at announcement anyway (p. 25).
 */
export function conditionalStaticFor(
  state: GameState,
  announced: Extract<GameEvent, { type: "ActionAnnounced" }>,
  minion: MinionState,
  field: "stealth" | "intercept" | "bleed" | "strength" | "votes",
): number {
  let total = 0;
  for (const p of minion.attached) {
    for (const c of p.statics.conditional ?? []) {
      if (c[field] === undefined) continue;
      if (conditionHolds(c, announced, minion, state)) total += c[field]!;
    }
  }
  return total;
}

/**
 * The same sum with NO action in sight — for traits read outside one.
 * A static carrying any action condition correctly contributes nothing
 * here (docs/crypt-wave-1.md §2).
 */
export function conditionalStaticNoAction(
  state: GameState,
  minion: MinionState,
  field: "stealth" | "intercept" | "bleed" | "strength" | "votes" | "handSize",
): number {
  let total = 0;
  for (const p of minion.attached) {
    for (const c of p.statics.conditional ?? []) {
      if (c[field] === undefined) continue;
      if (conditionHolds(c, null, minion, state)) total += c[field]!;
    }
  }
  return total;
}

export function currentStealth(state: GameState, actionId: ActionId): number {
  let stealth = 0;
  for (const ev of state.eventLog) {
    if (ev.type === "StealthModified" && ev.actionId === actionId) {
      stealth += ev.delta;
    }
  }
  // Statics on the acting minion's attached cards (an ally's own +1
  // stealth, Double Deuce) apply to its actions continuously.
  const announced = state.eventLog.find(
    (ev) => ev.type === "ActionAnnounced" && ev.actionId === actionId,
  );
  if (announced && announced.type === "ActionAnnounced") {
    const acting = findMinion(state, announced.acting);
    if (acting) {
      for (const p of acting.attached) stealth += p.statics.stealth ?? 0;
      // "…+1 stealth during diablerie actions" (Depravity), "−2 stealth
      // during bleed actions" (Codex) — signed, and conditioned on the
      // action (docs/conditional-statics-design.md §3).
      stealth += conditionalStatic(state, actionId, acting, "stealth");
      // "Assamites get +1 stealth when bleeding" (The Khabar: Community).
      if (announced.actionKind === "bleed") {
        stealth += auraBonus(state, acting, "bleedStealth");
      }
    }
  }
  return stealth;
}

/** "Vampires with any hostage counters cannot be moved to the ready
 *  region or be diablerized" (Carver's Meat Packing). The counter is one
 *  card's, but the restriction is a general one the kernel has to ask
 *  about at the leave-torpor, rescue and diablerie option sites. */
/** "<clan> … do not hunt as normal" (Week of Nightmares) — an aura that
 *  takes the hunt action away rather than modifying it. */
export function auraBlocksHunt(state: GameState, minion: MinionState): boolean {
  for (const seat of state.seats) {
    for (const p of seat.permanents) {
      const aura = p.aura;
      if (!aura?.cannotHunt) continue;
      if (aura.scope === "controller" && minion.controller !== (p.controller ?? seat.id)) continue;
      if (aura.clan !== undefined && minion.clan !== aura.clan) continue;
      if (aura.sect !== undefined && minion.sect !== aura.sect) continue;
      return true;
    }
  }
  return false;
}

/**
 * What "the same action" means for "…cannot perform the same action again
 * this turn" (Change of Target, Obedience, Delaying Tactics): the CARD's
 * name for an action a card announced, and the `ActionKind` otherwise.
 * Playing a different card is a different action; bleeding again is the
 * same one. docs/end-action-design.md §4
 */
export function actionKeyOf(af: ActionFrame): string {
  return af.card ? af.card.instance.name : af.actionKind;
}

/** May this minion perform an action with `key` right now? Reads both the
 *  per-minion bar and the seat-wide one (Delaying Tactics). */
export function canRepeatAction(
  state: GameState,
  m: MinionState,
  key: string,
): boolean {
  if ((m.cannotRepeat ?? []).includes(key)) return false;
  return !(getSeat(state, m.controller).cannotRepeat ?? []).includes(key);
}

export function heldHostage(m: MinionState): boolean {
  return (m.counters?.["hostage"] ?? 0) > 0;
}

/** "A minion with one or more stun counters does not unlock as normal at
 *  the beginning of their controller's unlock phase" (owner ruling
 *  2026-08-31, docs/stun-design.md). Read by the unlock sweep; nothing
 *  else needs it, because a stunned minion is locked and `canAct` /
 *  `canReact` already gate on that. */
export function stunned(m: MinionState): boolean {
  return (m.counters?.["stun"] ?? 0) > 0;
}

/**
 * The printed SUB-TYPE of a minion — "wraith", "zombie", "ghoul",
 * "mortal". An ally carries its own card text into play as a SELF-attached
 * entry (`card.id === minion.id`), so its tags live there.
 *
 * Reading every attached entry would be wrong: a ghoul RETAINER employed
 * by a wraith would make the wraith a ghoul. A vampire has no self entry
 * and so has no sub-type, which is what every "non-wraith non-zombie"
 * filter wants.
 *
 * "Wraith" and "zombie" appear NOWHERE in the rulebook — like "ghoul",
 * they are printed words other cards filter on, with no rules of their
 * own. docs/wraith-zombie-design.md §1
 */
export function minionTags(m: MinionState): string[] {
  return m.attached.find((e) => e.card.id === m.id)?.tags ?? [];
}

/** Does this minion print any of these sub-types? */
export function minionHasTag(m: MinionState, ...tags: string[]): boolean {
  const mine = minionTags(m);
  return tags.some((t) => mine.includes(t));
}

/** "a wraith or zombie ally you control" — the gate's whole vocabulary. */
export function isUndeadAlly(m: MinionState): boolean {
  return m.kind === "ally" && minionHasTag(m, "wraith", "zombie");
}

/**
 * The key two vampires must share for their titles to contest (p. 18),
 * or null for a title that is not unique.
 *
 * The rulebook names three different shapes of uniqueness and this is all
 * three, which is why it is a key rather than a boolean:
 *
 *  - **city titles** — "the title of prince is associated with a
 *    particular city and can be contested by another vampire who claims
 *    ANY title to the same city" (p. 39), and archbishop is ruled the
 *    same way (p. 41), with baron contested by "prince, archbishop, or
 *    baron of the same city" (p. 40). All three therefore key on the CITY
 *    alone, so a prince and a baron of one city do contest.
 *  - **justicar and Inner Circle** — "each clan's justicar and Inner
 *    Circle titles are unique … and can only be held by vampires of that
 *    clan" (p. 41): the key is the title plus the clan.
 *  - **regent** — "the title of regent is unique" (p. 42), full stop.
 *
 * "The title of primogen is not unique and cannot be contested" (p. 41),
 * and the same is said of bishop, cardinal, priscus and magaji (p. 42) —
 * those answer null and never contest.
 */
export function titleContestKey(m: MinionState): string | null {
  const claim = m.titleContest ?? (m.title === null ? null : { title: m.title, city: m.titleCity });
  if (!claim) return null;
  switch (claim.title) {
    case "prince":
    case "baron":
    case "archbishop":
      // No city printed means nothing to contest OVER — the pool has no
      // such card, but a fixture can build one and it must not collide
      // with every other untitled-city claim.
      return claim.city ? `city:${claim.city.toLowerCase()}` : null;
    case "justicar":
    case "innerCircle":
      return m.clan ? `${claim.title}:${m.clan.toLowerCase()}` : null;
    case "regent":
      return "regent";
    default:
      return null;
  }
}

/**
 * "Another copy of this ally you control" (Bone Shambler, Gravebound
 * Drone). A minion already knows its own name, so this is a QUERY over
 * state that exists rather than a new field — the same shape as game-wide
 * uniqueness reading the event log. docs/wraith-zombie-design.md §3
 */
export function otherCopies(state: GameState, self: MinionState): MinionState[] {
  const seat = state.seats.find((s) => s.id === self.controller);
  if (!seat) return [];
  return seat.minions.filter((m) => m.name === self.name && m.id !== self.id);
}

/** The minion performing this action, from the announcement event. */
export function actingMinionOf(state: GameState, actionId: ActionId): MinionState | null {
  for (let i = state.eventLog.length - 1; i >= 0; i--) {
    const ev = state.eventLog[i]!;
    if (ev.type === "ActionAnnounced" && ev.actionId === actionId) {
      return findMinion(state, ev.acting);
    }
  }
  return null;
}

/**
 * Does this blocker fall under an "allies and younger vampires" clause?
 *
 * **The English "and" is a UNION.** "Allies **and** younger vampires get
 * −1 intercept" names two sets and applies to both, so a minion qualifies
 * by matching `kinds` OR by being younger than `youngerThan` — reading it
 * as an intersection would make the clause mean "younger allies", which
 * is not what any of the three cards printing it say.
 * docs/opposing-statics-design.md §1
 */
export function blockerMatchesFilter(
  blocker: MinionState,
  actor: MinionState | null,
  filter: { kinds?: MinionState["kind"][]; youngerThan?: MinionId; sects?: string[] },
): boolean {
  if ((filter.kinds ?? []).includes(blocker.kind)) return true;
  // "ANARCHS get −1 intercept during this action" (Fiendish Tongue) — a
  // third arm of the same union.
  if (blocker.sect !== null && (filter.sects ?? []).includes(blocker.sect)) return true;
  if (filter.youngerThan !== undefined) {
    const older = actor && actor.id === filter.youngerThan ? actor : null;
    // "Younger" compares DERIVED capacity, so a granted point counts.
    if (older && blocker.kind === "vampire" && capacityOf(blocker) < capacityOf(older)) {
      return true;
    }
  }
  return false;
}

export function currentIntercept(
  state: GameState,
  actionId: ActionId,
  minion: MinionId,
): number {
  let intercept = 0;
  // Statics from attached permanents (Sport Bike) apply continuously. The
  // minion can be gone (a blocker burned mid-action) — its attachments
  // went with it, and the event-log part below still holds.
  const holder = findMinion(state, minion);
  for (const p of holder?.attached ?? []) {
    intercept += p.statics.intercept ?? 0;
  }
  // "+1 intercept during actions directed at their controller" (Abbot),
  // "…during bleed actions directed at you" (Guardian Angel) — unlike the
  // unconditional statics above, these need to know what the action IS,
  // which this function did not previously ask (§3).
  if (holder) intercept += conditionalStatic(state, actionId, holder, "intercept");
  // "Allies and younger vampires get −1 intercept against this Anarch"
  // (Stolen Police Cruiser) — a PERSISTENT penalty on the ACTING minion,
  // so it holds for every action they take. The action-scoped twin is
  // the event below; both go through `blockerMatchesFilter`.
  const actor = actingMinionOf(state, actionId);
  if (holder && actor) {
    for (const p of actor.attached) {
      const pen = p.statics.opposingInterceptPenalty;
      if (!pen) continue;
      if (
        blockerMatchesFilter(holder, actor, {
          ...(pen.kinds ? { kinds: pen.kinds } : {}),
          ...(pen.younger ? { youngerThan: actor.id } : {}),
        })
      ) {
        intercept -= pen.amount;
      }
    }
  }
  for (const ev of state.eventLog) {
    if (
      ev.type === "InterceptModified" &&
      ev.actionId === actionId &&
      ev.minion === minion
    ) {
      intercept += ev.delta;
    }
    // "Minions get -1 intercept" (Unthinkable Humiliation superior) — one
    // event covering every minion, rather than one per minion, so a minion
    // that enters the action later is covered too. `appliesTo` narrows it
    // to one kind ("ALLIES get -1 intercept", Obedient Flesh).
    if (ev.type === "ActionInterceptModified" && ev.actionId === actionId) {
      const kind = holder?.kind;
      if (ev.filter) {
        // "Allies AND younger vampires" — a union (see the event's note).
        if (holder && blockerMatchesFilter(holder, actor, ev.filter)) {
          intercept += ev.delta;
        }
      } else if (!ev.appliesTo || ev.appliesTo === kind) {
        // "Minions WITHOUT Necromancy or Obtenebration" (Acheron Vortex).
        const exempt =
          holder !== undefined &&
          holder !== null &&
          (ev.exemptDisciplines ?? []).some((disc) => disciplinesOf(holder)[disc]);
        if (!exempt) intercept += ev.delta;
      }
    }
  }
  return intercept;
}

/** What this minion must burn to attempt to block (docs/block-tax-design.md)
 *  — the sum of the action's block costs it is not exempt from. `null` means
 *  it cannot pay at all, and so cannot attempt the block: an ally facing a
 *  cost payable only in blood, or a minion without the counters. */
/**
 * "Rescuing a non-Tremere vampire from torpor costs this Salubri -N blood"
 * (Saulot's Healing Touch) — the discount an actor's cards in play give to
 * their share of the 2-blood rescue cost, and the blood the rescued
 * vampire gains on success.
 *
 * Read at BOTH the enumeration site (so an actor who could not otherwise
 * afford the split is offered it) and the payment site, which is why it
 * lives here rather than inline.
 */
export function rescueDiscountFor(
  actor: MinionState,
  victim: MinionState,
): { discount: number; bonusBlood: number } {
  let discount = 0;
  let bonusBlood = 0;
  for (const p of actor.attached) {
    const rd = p.statics.rescueDiscount;
    if (!rd) continue;
    if (rd.notClan !== undefined && victim.clan === rd.notClan) continue;
    discount += rd.amount;
    bonusBlood += rd.bonusBlood ?? 0;
  }
  return { discount, bonusBlood };
}

/**
 * "While \<this vampire\> is ready, minions must burn the top card of
 * their library to attempt to block \<tagged\> allies" (Parijat) — how
 * many cards a blocker owes to attempt a block on `actor`.
 *
 * Unlike `PermanentStatics.blockToll`, which rides on the minion being
 * blocked, this is radiated at the WHOLE TABLE and conditioned on who is
 * ACTING — so it is found by scanning ready minions rather than by
 * reading the actor's own attachments. Derived on every read: "while
 * \<they\> are ready" stops holding the moment they go to torpor.
 * docs/crypt-wave-7.md §6
 */
export function libraryBlockToll(state: GameState, actor: MinionState): number {
  let n = 0;
  for (const s of state.seats) {
    for (const m of s.minions) {
      if (!isReady(m)) continue;
      for (const p of m.attached) {
        const g = p.statics.globalBlockToll;
        if (!g) continue;
        if (g.actorTags.some((t) => minionHasTag(actor, t))) n += 1;
      }
    }
  }
  return n;
}

export function blockTollFor(
  af: ActionFrame,
  minion: MinionState,
  /** The acting minion, when the caller has it: "vampires attempting to
   *  block THE ATTACHED VAMPIRE burn 1 blood" (Archon) is a persistent
   *  toll carried by a card on the actor, not by this action.
   *  docs/opposing-statics-design.md §2 */
  actor?: MinionState | null,
  /** Needed only for a toll radiated at the WHOLE TABLE rather than
   *  carried by the minion being blocked (Parijat), which is the one kind
   *  that cannot be found from `af` and `actor` alone.
   *  docs/crypt-wave-7.md §6 */
  state?: GameState,
): number | null {
  // "While Parijat is ready, minions must BURN THE TOP CARD OF THEIR
  // LIBRARY to attempt to block <tagged> allies" — a third currency, and
  // a blocker with no library simply cannot pay it.
  if (
    state &&
    actor &&
    libraryBlockToll(state, actor) > 0 &&
    getSeat(state, minion.controller).library.length === 0
  ) {
    return null;
  }
  let toll = 0;
  const costs: ActionFrame["blockCosts"] = [
    ...af.blockCosts,
    ...(actor?.attached ?? []).flatMap((p) => {
      const t = p.statics.blockToll;
      if (!t) return [];
      // "Minions with 1 or more of YOUR corruption counters must burn 1
      // blood or life to attempt to block Sergio" — "your" is the CARD's
      // controller, which is not always the bearer's (p. 16).
      if (t.yourCorruption) {
        const owner = p.controller ?? actor?.controller;
        if (owner === undefined || (minion.corruption?.[owner] ?? 0) < 1) return [];
      }
      return [{ ...t, source: p.card.name }];
    }),
  ];
  for (const c of costs) {
    if (c.exemptDiscipline && disciplinesOf(minion)[c.exemptDiscipline]) continue;
    // "VAMPIRES must burn 1 blood to attempt to block" — checked BEFORE
    // the allies-cannot-pay-blood rule below, or a vampires-only toll
    // would bar allies from blocking instead of leaving them alone.
    if (c.kinds && !c.kinds.includes(minion.kind)) continue;
    // Allies hold life, not blood (p. 22): a cost printed as "1 blood" is
    // one they cannot pay, which is what "allies cannot burn blood" on
    // Where the Veil Thins spells out.
    if (minion.kind === "ally" && c.payWith === "blood") return null;
    toll += c.amount;
  }
  return minion.blood >= toll ? toll : null;
}

// ---------------------------------------------------------------------------
// Play cost (docs/play-cost-design.md)
// ---------------------------------------------------------------------------

/** What `playCostFor` needs to know about the card being priced. All of
 *  it is denormalized onto the handler already, so this is a plain
 *  description rather than a registry lookup. */
export interface PricedCard {
  name: string;
  bloodCost: number;
  poolCost: number;
  /** Every printed type the card carries, plus "strike" when the chosen
   *  mode sets a strike. */
  types: PlayCostCardType[];
  /** Disciplines the chosen mode requires (`requiresDisciplines`). */
  requires: string[];
  /** Clans the card requires (`requiresClans`) and printed sub-type tags
   *  (`permanentTags`) — "a GHOUL ally requiring a TZIMISCE" (Szlachta
   *  Assistant). Optional, so every existing caller is untouched.
   *  docs/retainer-wave-design.md §4 */
  requiresClans?: string[];
  tags?: string[];
}

/** Collect every play-cost modifier currently in force for `minion`. */
export function activePlayCostMods(
  state: GameState,
  minion: MinionState | null,
  af: ActionFrame | null,
  cf: CombatFrame | null,
  /** The minion the card being played TARGETS, if any — a different
   *  question from who pays (design §2). */
  target?: MinionId | null,
  /** The Methuselah playing the card, for `controllerOnly` modifiers. */
  payerSeat?: SeatId | null,
): PlayCostMod[] {
  const mods: PlayCostMod[] = [...(af?.playCostMods ?? []), ...(cf?.playCostMods ?? [])].filter(
    // "…costs the OPPOSING vampire +1 blood" (Terror Frenzy superior):
    // a frame-scoped modifier can name exactly one payer.
    (mod) => mod.minionId === undefined || mod.minionId === minion?.id,
  );
  /** "…while this Anarch is acting, attempting to block or in combat"
   *  (Libertas). */
  const engaged = (id: MinionId): boolean =>
    af?.acting === id ||
    af?.blockedBy === id ||
    cf?.acting === id ||
    cf?.opposing === id;
  // Cards in play radiate theirs. A modifier can name the bearer or
  // everyone BUT the bearer (Libertas charges "other minions"), so every
  // seat's cards are scanned, not just the playing minion's.
  for (const seat of state.seats) {
    // A modifier a Methuselah is holding, belonging to no frame and no
    // card in play — the card that granted it burned itself to do so
    // (Szlachta Assistant). It charges only its own seat.
    if (payerSeat === undefined || payerSeat === seat.id) {
      mods.push(...(seat.playCostMods ?? []));
    }
    for (const p of seat.permanents) {
      const mod = p.statics.playCostMod;
      if (!mod) continue;
      // A seat-level location has no bearer, so a bearer-scoped modifier
      // can never come from one, and neither can a target-scoped one.
      if (mod.minions === "bearer" || mod.onTarget) continue;
      if (mod.controllerOnly && payerSeat !== undefined && payerSeat !== seat.id) continue;
      mods.push(mod);
    }
    for (const m of seat.minions) {
      for (const p of m.attached) {
        const mod = p.statics.playCostMod;
        if (!mod) continue;
        if (mod.minions === "bearer" && m.id !== minion?.id) continue;
        if (mod.minions === "others" && m.id === minion?.id) continue;
        if (mod.whileBearerEngaged && !engaged(m.id)) continue;
        // "Strike cards cost THE OPPOSING MINION +1 blood" (Djeneba,
        // Algirdas) — the payer is whoever is fighting the bearer right
        // now, read off the live frame rather than stored.
        if (mod.opposingBearer) {
          if (!cf || !minion) continue;
          const other = cf.acting === m.id ? cf.opposing : cf.opposing === m.id ? cf.acting : null;
          if (other !== minion.id) continue;
          // "…opposing YOUNGER vampires": derived capacity on both sides,
          // so a granted point counts.
          if (mod.opposingBearer.youngerOnly) {
            if (minion.kind !== "vampire" || capacityOf(minion) >= capacityOf(m)) continue;
          }
        }
        // "…targeting THIS minion" (Secure Haven, Villein's self-clause):
        // keyed to what the card being played aims at, not to who pays.
        if (mod.onTarget && m.id !== target) continue;
        // "…cost YOU +1 pool" (Villein) — the card's controller only.
        if (mod.controllerOnly && payerSeat !== undefined) {
          const owner = p.controller ?? m.controller;
          if (owner !== payerSeat) continue;
        }
        mods.push(mod);
      }
    }
  }
  return mods;
}

/** Does this modifier apply to this card? Every filter that is present
 *  must match; an absent filter does not constrain. */
export function playCostModApplies(mod: PlayCostMod, card: PricedCard): boolean {
  if (mod.cardName !== undefined && mod.cardName !== card.name) return false;
  if (mod.cardTypes && !mod.cardTypes.some((t) => card.types.includes(t))) return false;
  const byDiscipline =
    mod.requiresDiscipline !== undefined &&
    mod.requiresDiscipline.some((d) => card.requires.includes(d));
  const byClan =
    mod.requiresClan !== undefined &&
    mod.requiresClan.some((c) => (card.requiresClans ?? []).includes(c));
  // "Cards requiring Hecata AND/OR Oblivion cost Roger −1 blood" — the
  // printed "and/or" is a UNION of the two filters, where the default is
  // an intersection. Written as one modifier rather than two, because two
  // would charge −2 to a card matching both (docs/crypt-wave-4.md §2).
  if (mod.clanOrDiscipline) {
    if (!byDiscipline && !byClan) return false;
  } else {
    if (mod.requiresDiscipline && !byDiscipline) return false;
    if (mod.requiresClan && !byClan) return false;
  }
  if (mod.tags && !mod.tags.some((t) => (card.tags ?? []).includes(t))) return false;
  return true;
}

/**
 * What this card actually costs this minion to play, right now
 * (docs/play-cost-design.md §3). The printed cost plus every modifier in
 * force, clamped at zero — a cost never goes negative.
 *
 * Read at BOTH kinds of site, which is the lesson `rescueDiscountFor`
 * taught: at enumeration, or a discount is unreachable in exactly the
 * case it exists for and a surcharge lets a minion announce what it
 * cannot pay; and at payment, or the number on the table is a lie.
 */
export function playCostFor(
  state: GameState,
  card: PricedCard,
  minion: MinionState | null,
  af: ActionFrame | null,
  cf: CombatFrame | null,
  /** The minion this card TARGETS, and the seat paying — both needed for
   *  modifiers keyed to something other than the payer (design §2). */
  target?: MinionId | null,
  payerSeat?: SeatId | null,
): { blood: number; pool: number } {
  let blood = card.bloodCost;
  let pool = card.poolCost;
  for (const mod of activePlayCostMods(state, minion, af, cf, target, payerSeat)) {
    if (!playCostModApplies(mod, card)) continue;
    if (mod.pays === "pool") {
      pool += mod.amount;
    } else if (mod.pays === "bloodOrPool") {
      // "Costs −1 blood or pool" (Charisma): the change lands on
      // whichever resource the card actually charges, blood first when it
      // charges both (design doc §4).
      if (card.bloodCost > 0) blood += mod.amount;
      else pool += mod.amount;
    } else {
      // "blood" and "bloodOrLife" are the same field; the discriminant
      // exists for the ally pass, not for arithmetic (design doc §4).
      blood += mod.amount;
    }
  }
  return { blood: Math.max(0, blood), pool: Math.max(0, pool) };
}

/**
 * "This minion cannot be the target of OTHER Methuselahs' actions"
 * (Secure Haven). Asked wherever an action picks a minion target; a bleed
 * targets a seat rather than a minion, so a haven never stops one.
 * docs/granted-bleed-and-target-costs-design.md §3
 */
export function untargetableBy(
  target: MinionState,
  actorSeat: SeatId,
  /** The acting minion, when the caller has it: "minions WITHOUT Auspex
   *  cannot perform actions directed at this vampire" (Shadow Cloak) is a
   *  property of the actor, not of their Methuselah. */
  actor?: MinionState,
  /** The Disciplines the CARD being played requires, when a card is being
   *  played at all: "cannot be the target of directed actions requiring
   *  Dominate or Presence" (Aggressive Corpse) is a property of the card,
   *  not of the actor. A built-in action (a rush, a diablerie) requires no
   *  Discipline and so is never blocked by this. */
  cardDisciplines?: string[],
): boolean {
  if (target.controller === actorSeat) return false;
  if (target.attached.some((p) => p.statics.untargetableByOthers)) return true;
  if (cardDisciplines && cardDisciplines.length > 0) {
    const barred = target.attached.flatMap((p) => p.statics.untargetableByDisciplines ?? []);
    if (barred.some((d) => cardDisciplines.includes(d))) return true;
  }
  return target.attached.some((p) => {
    const d = p.statics.untargetableExceptDiscipline;
    if (d === undefined) return false;
    // No actor to ask (a seat-level target) means the escape hatch cannot
    // be satisfied, so the protection holds.
    return actor === undefined || disciplinesOf(actor)[d] === undefined;
  });
}

/** "The action is blocked if the blocker's intercept is equal to or
 *  greater than the acting minion's stealth" (p. 26). */
export function blockWouldSucceed(
  state: GameState,
  actionId: ActionId,
  blocker: MinionId,
): boolean {
  return (
    currentIntercept(state, actionId, blocker) >=
    currentStealth(state, actionId)
  );
}

/** "Does not unlock as normal" (Toreador Grand Ball's locked Toreador) —
 *  a card in play naming this minion suppresses its unlock for as long as
 *  the card is there. The one-shot form is `MinionState.skipNextUnlock`. */
export function unlockSuppressed(state: GameState, minion: MinionId): boolean {
  for (const seat of state.seats) {
    for (const p of seat.permanents) {
      if (p.preventsUnlock === minion) return true;
    }
    for (const m of seat.minions) {
      for (const p of m.attached) {
        if (p.preventsUnlock === minion) return true;
      }
    }
  }
  return false;
}

/** "That minion's (non-bleed) actions cannot be blocked" (Toreador Grand
 *  Ball) — a card in play makes the acting minion's action unblockable. */
export function actionUnblockable(state: GameState, af: ActionFrame): boolean {
  for (const seat of state.seats) {
    for (const p of seat.permanents) {
      const u = p.unblockable;
      if (!u || u.minion !== af.acting) continue;
      if (u.exceptBleed && af.actionKind === "bleed") continue;
      return true;
    }
  }
  return false;
}
