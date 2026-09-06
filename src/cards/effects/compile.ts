/**
 * CardSpec → CardHandler compiler (docs/card-primitives.md). The single
 * place where card-type rules live: who may play a modifier vs a
 * reaction vs a combat card, cost gating, once-per-action, "(limited)",
 * the stealth/intercept "only when needed" rules, wake's locked-only +
 * as-played window access, and combat window placement. Card specs stay
 * pure data.
 */

import type {
  ActionFrame,
  CardActionParams,
  CardHandler,
  CardInstance,
  CardInstanceId,
  CardPlayFrame,
  ChoiceFrame,
  EngineOps,
  GameState,
  HandlerRegistry,
  LegalOption,
  MinionId,
  CombatFrame,
  CombatRoundDamageRider,
  MinionState,
  SeatId,
  PermanentInPlay,
  PermanentStatics,
  PlayContext,
  PlayCostCardType,
  ReferendumFrame,
  Sect,
  WindowId,
} from "../../engine/index.ts";
import {
  blockEligibleSeats,
  canAct,
  canReact,
  canRepeatAction,
  canGainBlood,
  capacityOf,
  uncontrolledCanTakeCounters,
  CITY_TITLES,
  CLANS,
  disciplinesOf,
  currentBleed,
  currentIntercept,
  isUndeadAlly,
  minionHasTag,
  otherCopies,
  currentStealth,
  findMinion,
  getMinion,
  getSeat,
  isReady,
  playCostFor,
  untargetableBy,
  predatorOf,
  preyOf,
  playOptionId,
} from "../../engine/index.ts";
import type {
  CardMode,
  CardSpec,
  EffectPrimitive,
  ModifierCondition,
  PlayFromHandFilter,
  UsabilityRule,
} from "./spec.ts";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function rulesHold(
  rules: UsabilityRule[] | undefined,
  ctx: PlayContext,
  af: ActionFrame,
): boolean {
  for (const rule of rules ?? []) {
    switch (rule) {
      case "onlyDuringBleed":
        if (af.actionKind !== "bleed") return false;
        break;
      case "notDuringBleed":
        if (af.actionKind === "bleed") return false;
        break;
      case "bleedTargetsYou":
        if (af.actionKind !== "bleed" || af.target !== ctx.seat) return false;
        break;
      case "actionDirectedAtYou":
        if (!af.directed || af.target !== ctx.seat) return false;
        break;
      case "predatorIsActing":
        // "Only usable if a minion controlled by your predator is
        // ACTING" (Instinctive Reaction) — the plain form of the rule
        // below, with no bleed and no seat-count condition.
        if (af.actingSeat !== predatorOf(ctx.state, ctx.seat)) return false;
        break;
      case "predatorBleedingYou": {
        if (af.actionKind !== "bleed" || af.target !== ctx.seat) return false;
        if (af.actingSeat !== predatorOf(ctx.state, ctx.seat)) return false;
        if (ctx.state.seats.filter((s) => !s.ousted).length < 3) return false;
        break;
      }
      case "afterBlocksDeclined":
        if (!af.declinedBlocks.includes(ctx.seat)) return false;
        break;
      case "asUndeadRecruit": {
        // "As an action to recruit or employ a WRAITH OR ZOMBIE is
        // announced": the ally is not in play yet, so the question is
        // about the announcing CARD, whose sub-types ride on the event.
        const ann = ctx.state.eventLog.find(
          (e) => e.type === "ActionAnnounced" && e.actionId === af.actionId,
        );
        const tags = ann && ann.type === "ActionAnnounced" ? (ann.cardTags ?? []) : [];
        if (!tags.includes("wraith") && !tags.includes("zombie")) return false;
        break;
      }
      case "actingIsUndeadAlly": {
        const acting = findMinion(ctx.state, af.acting);
        if (!acting || !isUndeadAlly(acting)) return false;
        break;
      }
      case "ifActionWouldSucceed":
        // p. 27 A.4: state C is "every Methuselah has passed" — the action
        // is going through and no block can still be declared.
        if (af.step !== "C") return false;
        break;
      case "onlyAsAnnounced":
        // The closest the effect windows can get to "as announced".
        if (af.step !== "A" || ctx.blockAttempt) return false;
        break;
      case "afterResolutionByActor":
        // The window gate itself is structural (the option enumerator);
        // this only asserts we are actually in it.
        if (af.step !== "afterResolution") return false;
        break;
      case "ifActionSucceeded":
        if (af.resolvedSuccess !== true) return false;
        break;
      case "ifActionBlocked":
        // "…if the action was BLOCKED" — not merely unsuccessful: a
        // cancelled or self-ended action was never blocked.
        if (af.resolvedSuccess !== false || af.blockedBy === null) return false;
        break;
      case "ifActionDirected":
        if (!af.directed || af.target === null) return false;
        break;
      case "ifBleedSucceeded":
        // "…if the bleed is successful (for 1 or more)" (Fever Pitch).
        if (af.actionKind !== "bleed" || af.resolvedSuccess !== true) return false;
        if (currentBleed(ctx.state, af) < 1) return false;
        break;
      case "byLockedMinion":
      case "oncePerUnlockPhase":
      case "byVampire":
      case "onlyAtLongRange":
      case "onlyAtCloseRange":
      case "oncePerCombatAtSuperior":
      case "oncePerActionAtSuperior":
      case "onlyAfterFirstRound":
      case "onlyFirstRound":
      case "afterBlockResolution":
        break; // per-minion / combat rules, checked elsewhere
    }
  }
  return true;
}

/** "Requires a …" clauses: the playing vampire's title/sect/clan/capacity
 *  (docs/clan-sect-design.md §3). Allies (no clan/sect/title) fail any
 *  such requirement. */
export function meetsRequirements(m: MinionState, spec: CardSpec): boolean {
  if (spec.requiresTitle && (m.title === null || !spec.requiresTitle.includes(m.title))) {
    return false;
  }
  // "Requires a TITLED Camarilla vampire" — any title at all, which is
  // not the same question as `requiresTitle`'s named list. Listing the
  // eleven printed titles instead would be the Priority Contract trap in
  // reverse: a filter that silently narrows.
  if (spec.requiresTitled && m.title === null) return false;
  // "Requires a NON-STERILE …" (p. 42: "sterile vampires cannot perform
  // actions to put new vampires in play"). Nothing in the V5 pool grants
  // the trait, so this passes every vampire today — written because the
  // rulebook defines it and phase 7's importer is where it comes from.
  if (spec.requiresNonSterile && m.sterile === true) return false;
  if (spec.requiresSect && (m.sect === null || !spec.requiresSect.includes(m.sect))) {
    return false;
  }
  if (spec.requiresClan && (m.clan === null || !spec.requiresClan.includes(m.clan))) {
    return false;
  }
  if (spec.requiresCapacity !== undefined && capacityOf(m) < spec.requiresCapacity) {
    return false;
  }
  return true;
}

/** "[cel] or [pre]": any one listed discipline unlocks the mode; a
 *  `{ all }` clause requires every listed discipline ("[pot][pre]",
 *  p. 7). */
/**
 * "Requires a ready Anarch" / "…a ready vampire with a city title" — a
 * condition on the METHUSELAH, not on any acting minion: you must control
 * a ready vampire matching every clause the card prints
 * (docs/lock-grant-locations-design.md §6).
 *
 * One helper for all three clauses, because `requiresControlledTitle` was
 * read in exactly one place — the polling branch — so **Papillon's and
 * Expulsion's title requirements were unenforced**. That is the
 * `meetsRequirements` bug again (CLAUDE.md): a requirement line checked at
 * some sites and not others, invisible to the fuzz because a too-permissive
 * option list looks exactly like a correct one.
 */
export function controllerMeetsRequirements(
  state: GameState,
  seatId: SeatId,
  spec: Pick<
    CardSpec,
    | "requiresControlledSect"
    | "requiresControlledClan"
    | "requiresControlledTitle"
    | "requiresControlledPath"
  >,
): boolean {
  const reqSect = spec.requiresControlledSect;
  const reqClan = spec.requiresControlledClan;
  const reqTitle = spec.requiresControlledTitle;
  // "Requires 2 OR MORE ready vampires who follow the Path of <x>"
  // (Privileged Position) — a COUNT, which the `.some()` below cannot
  // express, so it is its own test (docs/path-cards-design.md §4).
  const reqPath = spec.requiresControlledPath;
  if (reqPath) {
    const n = getSeat(state, seatId).minions.filter(
      (m) => m.kind === "vampire" && isReady(m) && m.path === reqPath.path,
    ).length;
    if (n < reqPath.count) return false;
  }
  if (!reqSect && !reqClan && !reqTitle) return true;
  return getSeat(state, seatId).minions.some(
    (m) =>
      m.kind === "vampire" &&
      isReady(m) &&
      (!reqSect || (m.sect !== null && reqSect.includes(m.sect))) &&
      (!reqClan || (m.clan !== null && reqClan.includes(m.clan))) &&
      (!reqTitle || (m.title !== null && reqTitle.includes(m.title))),
  );
}

/**
 * The single per-minion gate on playing one mode of one card: the
 * Discipline requirement, plus any card on the minion that bars this card
 * BY NAME ("they cannot play cards named /Torn Signpost/", Preternatural
 * Strength).
 *
 * The name check lives here rather than beside `cannotPlayCardTypes` —
 * which is checked at the two recruit/employ sites — because the card it
 * bars is a COMBAT card, so the restriction has to reach every window a
 * minion can play in. Eleven call sites funnel through this function; one
 * of them learning a new rule and the other ten not is exactly how
 * `modifyVotes`/`restrictVotes` drifted (docs/ledger-closeout.md §2).
 */
function canPlayMode(m: MinionState, mode: CardMode, spec: CardSpec): boolean {
  if (
    m.attached.some((p) => (p.statics.cannotPlayCardNames ?? []).includes(spec.name))
  ) {
    return false;
  }
  return disciplineOk(m, mode);
}

function disciplineOk(m: MinionState, mode: CardMode): boolean {
  if (mode.discipline === null) return true;
  const hasAt = (d: string): boolean => {
    const lvl = disciplinesOf(m)[d];
    if (!lvl) return false;
    return mode.level === "basic" || lvl === "superior";
  };
  if (typeof mode.discipline === "object" && !Array.isArray(mode.discipline)) {
    return mode.discipline.all.every(hasAt);
  }
  const list = Array.isArray(mode.discipline) ? mode.discipline : [mode.discipline];
  return list.some(hasAt);
}

/** Which `PlayCostMod` types each spec card type counts as. A dual-typed
 *  card counts under BOTH halves of its printed type line, which is what
 *  makes "reaction cards cost +1" reach an Action Modifier/Reaction.
 *  docs/play-cost-design.md §2 */
const COST_TYPES_BY_CARD_TYPE: Record<CardSpec["cardType"], PlayCostCardType[]> = {
  action: ["action"],
  actionModifier: ["actionModifier"],
  reaction: ["reaction"],
  modifierOrReaction: ["actionModifier", "reaction"],
  modifierOrCombat: ["actionModifier", "combat"],
  actionOrCombat: ["action", "combat"],
  combat: ["combat"],
  master: ["master"],
  equipment: ["equipment"],
  retainer: ["retainer"],
  ally: ["ally"],
  politicalAction: ["politicalAction"],
  // A crypt card has no printed LIBRARY type, so it counts under none.
  // That is what it should answer: "cards requiring Dominate cost +1"
  // and every other play-cost modifier is about cards you play, and a
  // vampire is never played (docs/crypt-plan.md §4).
  crypt: [],
};

/**
 * What a card costs the given minion to play right now — the printed cost
 * put through `playCostFor` (docs/play-cost-design.md §3). Every
 * affordability gate in this file calls this rather than reading
 * `spec.bloodCost`, so a surcharge cannot let a minion announce something
 * it can no longer pay for and a discount is reachable in exactly the
 * case it exists for.
 */
function costOf(
  spec: CardSpec,
  ctx: PlayContext,
  minion: MinionState | null,
  mode?: CardMode,
  /** The minion this play would TARGET (a master's attach target), for
   *  modifiers keyed to the target rather than the payer (design §2). */
  target?: MinionId | null,
): { blood: number; pool: number } {
  const types = [...COST_TYPES_BY_CARD_TYPE[spec.cardType]];
  if (mode && combatWindowFor(mode) === "combat.chooseStrike") types.push("strike");
  return playCostFor(
    ctx.state,
    {
      name: spec.name,
      bloodCost: spec.bloodCost,
      poolCost: spec.poolCost ?? 0,
      types,
      requires: mode ? modeDisciplines(mode) : [],
      requiresClans: spec.requiresClan ?? [],
      tags: spec.permanent?.tags ?? [],
    },
    minion,
    ctx.action,
    ctx.combat,
    target,
    ctx.seat,
  );
}

/**
 * The Disciplines a mode REQUIRES, flattened out of all three shapes of
 * `CardMode.discipline` — the enabling query behind every "cards
 * requiring X" effect (docs/discipline-filtered-design.md §2).
 *
 * Note that `{ all: [...] }` and a plain array flatten the same way here.
 * That is deliberate: the question these cards ask is "does this card
 * require Fortitude at all", not "how do its requirements combine".
 */
export function modeDisciplines(mode: CardMode): string[] {
  if (mode.discipline === null) return [];
  if (typeof mode.discipline === "object" && !Array.isArray(mode.discipline)) {
    return [...mode.discipline.all];
  }
  return Array.isArray(mode.discipline) ? [...mode.discipline] : [mode.discipline];
}

/** Does this mode's Discipline requirement collide with a "cannot be
 *  prevented by cards requiring X" restriction on the damage? */
function blockedByNoPrevent(mode: CardMode, pd: { noPreventBy?: string[] }): boolean {
  if (!pd.noPreventBy?.length) return false;
  return modeDisciplines(mode).some((d) => pd.noPreventBy!.includes(d));
}

function hasLimitedBleedIncrease(state: GameState, af: ActionFrame): boolean {
  // "(limited)": an action modifier cannot increase the bleed if it is
  // already being increased by another modifier (p. 20). An action card's
  // own bonus (Govern) does not count — its event carries limited: false.
  return state.eventLog.some(
    (ev) =>
      ev.type === "BleedAmountModified" &&
      ev.actionId === af.actionId &&
      ev.limited &&
      ev.delta > 0,
  );
}

/**
 * Every way this minion could pay a play's cost using counters on cards
 * in play (docs/cost-sources-design.md §4). The first entry is always
 * "pay it all yourself", so the plain option keeps its usual id and
 * prefix-matching traces are unaffected. Each entry reports what the
 * player still owes, so the caller applies its normal affordability
 * check to that instead of the printed cost.
 */
function paymentSplits(
  ctx: PlayContext,
  minion: MinionState,
  cost: { blood: number; pool: number },
  cardType: "action" | "equipment",
): Array<{ params: Record<string, string>; blood: number; pool: number }> {
  const splits = [{ params: {} as Record<string, string>, ...cost }];
  if (cost.blood === 0 && cost.pool === 0) return splits;
  for (const entry of getSeat(ctx.state, ctx.seat).permanents) {
    const src = entry.costSource;
    if (!src || src.for !== cardType) continue;
    if (src.clan !== undefined && minion.clan !== src.clan) continue;
    // "…can lock this location to use those counters": a locked source
    // has nothing left to offer this turn.
    if (src.locks && entry.locked) continue;
    const available = entry.counters ?? 0;
    const payable =
      (src.pays.includes("blood") ? cost.blood : 0) +
      (src.pays.includes("pool") ? cost.pool : 0);
    for (let n = 1; n <= Math.min(available, payable); n++) {
      // Blood first when the source pays both — the cheaper resource to
      // a Methuselah is their vampire's blood, and no card in the pool
      // has a cost on both sides anyway.
      const blood = src.pays.includes("blood") ? Math.min(n, cost.blood) : 0;
      splits.push({
        params: { payFrom: `${entry.card.id}/${blood}/${n - blood}` },
        blood: cost.blood - blood,
        pool: cost.pool - (n - blood),
      });
    }
  }
  return splits;
}

function makeOption(
  spec: CardSpec,
  card: CardInstance,
  minion: MinionState,
  mode: CardMode,
  params: Record<string, string>,
): LegalOption {
  const extras = Object.values(params);
  const tags = mode.variant ? [mode.variant, ...extras] : extras;
  return {
    // Minion, variant, params, and card-instance ids keep option ids
    // unique across minions, printed variants, targets, and copies.
    id: playOptionId(spec.name, mode.level, minion.id, ...tags, card.id),
    kind: "playCard",
    label: `${spec.name} (${mode.level}${mode.variant ? ` ${mode.variant}` : ""}) — ${minion.name}${
      extras.length > 0 ? ` → ${extras.join(", ")}` : ""
    }`,
    card: card.id,
    name: spec.name,
    minion: minion.id,
    mode: mode.level,
    params: mode.variant ? { ...params, variant: mode.variant } : params,
  };
}

// ---------------------------------------------------------------------------
// "…from your hand (requirements and cost apply as normal)"
// docs/play-from-hand-design.md
// ---------------------------------------------------------------------------

/**
 * Every way a `playFromHand` effect can be satisfied right now: which
 * card in hand, on which bearer, in which printed version, and how it is
 * paid for. The answer rides in the option id (`from` / `fmode` / `fpay`
 * / `fblood`), so the whole choice is fixed at play time with no extra
 * decision point — the seat playing the card is already being asked.
 *
 * "Requirements apply as normal" is honoured by asking the incoming
 * card's own handler (`modesPlayableBy`, `isUnique`, `costTypes`,
 * `requiresDisciplines`), never by re-deriving them here. What is
 * deliberately NOT checked is `canAct` and the one-action-per-turn rule:
 * those gate taking an ACTION, and none of this family is one — three of
 * the five are played mid-combat, where the bearer is necessarily locked
 * (design §6).
 */
export function playFromHandChoices(
  ctx: PlayContext,
  filter: PlayFromHandFilter,
  defaultBearer: MinionState | null,
): Array<{ params: Record<string, string>; label: string }> {
  const seat = getSeat(ctx.state, ctx.seat);
  const bearers: MinionState[] = filter.actor
    ? seat.minions.filter(
        (m) =>
          m.kind === "vampire" &&
          isReady(m) &&
          (!filter.actor?.unlockedOnly || !m.locked) &&
          (!filter.actor?.sect || m.sect === filter.actor.sect),
      )
    : defaultBearer
      ? [defaultBearer]
      : [];
  const out: Array<{ params: Record<string, string>; label: string }> = [];
  for (const bearer of bearers) {
    for (const card of seat.hand) {
      const h = ctx.registry[card.name];
      if (!h) continue;
      const types = h.costTypes?.(null, undefined) ?? [];
      if (!filter.types.some((t) => types.includes(t))) continue;
      // "a melee weapon", "an animal retainer" — printed sub-types the
      // permanent already carries as tags.
      const tags = h.permanentTags ?? [];
      if ((filter.tags ?? []).some((t) => !tags.includes(t))) continue;
      // "a NON-UNIQUE equipment" (Contraband) — the printed keyword, a
      // different question from whether this seat already has a copy.
      if (filter.nonUniqueOnly && h.isUnique) continue;
      // Own-copy uniqueness, and "a minion can have only one vehicle".
      if (h.isUnique && seatControlsCopy(ctx.state, ctx.seat, card.name)) continue;
      if (tags.includes("vehicle") && bearer.attached.some((p) => p.tags.includes("vehicle"))) {
        continue;
      }
      // "This vampire cannot recruit allies or employ retainers"
      // (Depravity) — a restriction on the BEARER, matched against the
      // incoming card's printed type.
      if (
        bearer.attached.some((p) =>
          (p.statics.cannotPlayCardTypes ?? []).some((t) => types.includes(t)),
        )
      ) {
        continue;
      }
      for (const mode of h.modesPlayableBy?.(bearer, filter.ignoreRequirements) ?? []) {
        const cost = playCostFor(
          ctx.state,
          {
            name: h.name,
            bloodCost: h.bloodCost,
            poolCost: h.poolCost ?? 0,
            types,
            requires: h.requiresDisciplines?.(mode, undefined) ?? [],
          },
          bearer,
          ctx.action,
          ctx.combat,
          bearer.id,
          ctx.seat,
        );
        // "…can pay up to half the cost rounded down with their blood"
        // (Contraband superior): one option per legal split.
        const maxBlood = filter.halfCostInBlood ? Math.floor(cost.pool / 2) : 0;
        for (let b = 0; b <= maxBlood; b++) {
          if (bearer.blood < cost.blood + b) continue;
          if (seat.pool <= cost.pool - b) continue; // never oust yourself (p. 9)
          const params: Record<string, string> = { from: card.id, fmode: mode ?? "-" };
          // Only a card that CHOOSES its bearer records one; for the rest
          // it is the playing minion, already in the option id.
          if (filter.actor) params["fbearer"] = bearer.id;
          if (b > 0) params["fblood"] = String(b);
          out.push({
            params,
            label: `${card.name}${mode ? ` (${mode})` : ""} on ${bearer.name}${
              b > 0 ? `, ${b} blood` : ""
            }`,
          });
        }
      }
    }
  }
  return out;
}

/** Apply a `playFromHand` choice recorded in the option params. */
function applyPlayFromHand(
  ops: EngineOps,
  filter: PlayFromHandFilter,
  seat: SeatId,
  defaultBearer: MinionId | null,
  params: Record<string, string>,
): void {
  const cardId = params["from"];
  if (!cardId) throw new Error("playFromHand: no card chosen");
  const bearer = filter.actor ? params["fbearer"] : defaultBearer;
  if (!bearer) throw new Error("playFromHand: no bearer");
  // "Lock a ready unlocked Anarch you control" (Piper) — the price of
  // doing it without an action.
  if (filter.actor?.lock) ops.emit({ type: "MinionLocked", minion: bearer });
  const mode = params["fmode"];
  const blood = Number(params["fblood"] ?? 0);
  ops.playCardFromHand({
    cardId,
    seat,
    minion: bearer,
    mode: mode === "-" || mode === undefined ? null : (mode as "basic" | "superior"),
    ...(blood > 0 ? { blood } : {}),
  });
}

/** Every `k`-sized subset of `xs`, in order — one option per way of
 *  paying a cost spent in specific cards ("discard two master cards").
 *  Empty when `xs` is too short, which is what makes an unpayable
 *  ability un-enumerable. */
function combinations<T>(xs: T[], k: number): T[][] {
  if (k === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i <= xs.length - k; i++) {
    for (const rest of combinations(xs.slice(i + 1), k - 1)) {
      out.push([xs[i]!, ...rest]);
    }
  }
  return out;
}

/** "Choose X ready unlocked Anarchs you control" — every non-empty subset,
 *  because X is the player's choice and decides how many points there are
 *  (Revolutionary Council). docs/last-buildable-design.md §4 */
function nonEmptySubsets<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let k = 1; k <= xs.length; k++) out.push(...combinations(xs, k));
  return out;
}

/**
 * "The FIRST equipment you find in your library, working down from the
 * top" (Vast Wealth) — the one search in the pool with no choice in it,
 * because the card names the card by POSITION. Still shuffles (p. 14).
 */
function searchEquipDeterministic(
  spec: CardSpec,
  e: Extract<EffectPrimitive, { kind: "searchEquip" }>,
  seatId: SeatId,
  minion: MinionId,
  ops: EngineOps,
): void {
  const seat = getSeat(ops.state, seatId);
  const bearer = findMinion(ops.state, minion);
  const found = bearer
    ? seat.library.find(
        (c) =>
          searchMatches(c, ops.registry, e.cardTypes, false) &&
          (ops.registry[c.name]?.modesPlayableBy?.(bearer) ?? []).length > 0,
      )
    : undefined;
  if (found && bearer) {
    // "…requirements and cost apply as normal": priced and paid exactly as
    // an equip action would (docs/play-from-hand-design.md §4).
    const h = ops.registry[found.name]!;
    const mode = (h.modesPlayableBy?.(bearer) ?? [null])[0] ?? null;
    const cost = playCostFor(
      ops.state,
      {
        name: h.name,
        bloodCost: h.bloodCost,
        poolCost: h.poolCost ?? 0,
        types: h.costTypes?.(mode, undefined) ?? [],
        requires: h.requiresDisciplines?.(mode, undefined) ?? [],
      },
      bearer,
      ops.action(),
      null,
      bearer.id,
      seatId,
    );
    // "You are free not to find any" (p. 48) — and an unaffordable card
    // is not found, rather than played for free.
    if (bearer.blood >= cost.blood && seat.pool > cost.pool) {
      ops.playCardFromHand({
        cardId: found.id,
        seat: seatId,
        minion: bearer.id,
        mode,
        from: { zone: "library" },
      });
    }
  }
  void spec;
  ops.shuffleLibrary(seatId);
}

/** "If this location has no cards on it, burn it" — checked wherever a
 *  store shrinks (Black Market Cache). */
function burnEmptyStore(
  st: NonNullable<NonNullable<CardSpec["permanent"]>["store"]>,
  cardId: CardInstanceId,
  ops: EngineOps,
): void {
  if (!st.burnWhenEmpty) return;
  const entry = allPermanents(ops.state).find((p) => p.card.id === cardId);
  if (entry && (entry.stored ?? []).length === 0) ops.burnPermanent(cardId);
}

/**
 * Apply one after-referendum payout. Separate from the action-modifier
 * switch because these resolve with NO action frame: a political action
 * pops before its referendum is pushed, so the margin and the seat come
 * off the referendum frame instead (docs/referendum-margin-design.md §2).
 */
function applyReferendumPayout(
  e: EffectPrimitive,
  play: CardPlayFrame,
  ops: EngineOps,
): void {
  const rf = ops.state.frames.find((f) => f.kind === "referendum");
  if (rf?.kind !== "referendum") return;
  const margin = rf.margin ?? 0;
  if (e.kind === "bloodPerVoteMargin") {
    if (!play.minion) return;
    const toPool = Math.min(Number(play.params["x"] ?? "0"), margin);
    if (margin - toPool > 0) {
      ops.emit({ type: "BloodGained", minion: play.minion, amount: margin - toPool });
    }
    if (toPool > 0) ops.emit({ type: "PoolGained", seat: play.seat, amount: toPool });
    return;
  }
  if (e.kind === "distributePerVoteMargin") {
    for (const id of (play.params["to"] ?? "").split(",").filter((x) => x && x !== "-")) {
      // Capped at 1 blood each by the card, which is why the option
      // carries a subset rather than an allocation (design §4).
      ops.emit({ type: "BloodGained", minion: id, amount: 1 });
    }
    const p = Number(play.params["x"] ?? "0");
    if (p > 0) ops.emit({ type: "PoolGained", seat: play.seat, amount: p });
    return;
  }
  if (e.kind === "uncontrolledSectBlood") {
    const region = getSeat(ops.state, play.seat).uncontrolled.filter(
      (u) => u.card.sect === e.sect,
    );
    const targets = e.each
      ? region.map((u) => u.card.id)
      : [play.params["target"]].filter((x): x is string => !!x);
    for (const id of targets) {
      ops.emit({
        type: "UncontrolledBloodAdded",
        seat: play.seat,
        minion: id,
        amount: e.amount,
      });
    }
  }
}

/**
 * Options for one mode of an after-referendum payout card
 * (docs/referendum-margin-design.md). All three read the margin off the
 * frame rather than recomputing it, so a card cannot disagree with the
 * result that was announced.
 */
function referendumPayoutOptions(
  spec: CardSpec,
  card: CardInstance,
  caller: MinionState,
  mode: CardMode,
  rf: ReferendumFrame,
  ctx: PlayContext,
): LegalOption[] {
  const margin = rf.margin ?? 0;
  const out: LegalOption[] = [];
  for (const e of mode.effects) {
    if (e.kind === "bloodPerVoteMargin") {
      if (margin <= 0) continue;
      // "…move UP TO N of those blood to your pool instead": the split is
      // chosen at play time, one option per amount (the `x=N` shape).
      const maxPool = Math.min(e.toPool ?? 0, margin);
      for (let p = 0; p <= maxPool; p++) {
        out.push(makeOption(spec, card, caller, mode, p > 0 ? { x: String(p) } : {}));
      }
    } else if (e.kind === "distributePerVoteMargin") {
      if (margin <= 0) continue;
      const titled = caller.title !== null;
      const poolCap = Math.min(titled ? e.poolCapIfTitled : e.poolCap, margin);
      const eligible = getSeat(ctx.state, ctx.seat)
        .minions.filter((m) => m.kind === "vampire" && isReady(m) && m.clan === e.clan)
        .map((m) => m.id);
      // Every recipient is capped at 1 blood, so a distribution is just a
      // SUBSET of them plus a pool amount, together no larger than the
      // margin. "Distribute" need not be exhausted (design §4).
      for (let n = 0; n <= Math.min(eligible.length, margin); n++) {
        for (const set of combinations(eligible, n)) {
          for (let p = 0; p <= Math.min(poolCap, margin - n); p++) {
            if (n === 0 && p === 0) continue; // an option that does nothing
            out.push(
              makeOption(spec, card, caller, mode, {
                to: set.join(",") || "-",
                x: String(p),
              }),
            );
          }
        }
      }
    } else if (e.kind === "uncontrolledSectBlood") {
      const region = getSeat(ctx.state, ctx.seat).uncontrolled.filter(
        (u) => u.card.sect === e.sect,
      );
      if (region.length === 0) continue;
      if (e.each) {
        out.push(makeOption(spec, card, caller, mode, {}));
      } else {
        for (const u of region) {
          out.push(makeOption(spec, card, caller, mode, { target: u.card.id }));
        }
      }
    }
  }
  return out;
}

/** Every card in play, at seat level or attached — the set a ChoiceFrame
 *  has to search by card id, since it carries no owner. */
function allPermanents(state: GameState): PermanentInPlay[] {
  return state.seats.flatMap((s) => [
    ...s.permanents,
    ...s.minions.flatMap((m) => m.attached),
  ]);
}

/** Does a library card match a search filter? Its printed types come from
 *  its own handler (`costTypes`), the query built two waves ago — the
 *  card doing the searching has no reference to the other card's spec. */
function searchMatches(
  card: CardInstance,
  registry: HandlerRegistry,
  cardTypes: PlayCostCardType[] | undefined,
  nonUniqueOnly: boolean | undefined,
): boolean {
  const h = registry[card.name];
  if (!h) return false;
  if (nonUniqueOnly && h.isUnique) return false;
  if (!cardTypes) return true;
  const types = h.costTypes?.(null, undefined) ?? [];
  return cardTypes.some((t) => types.includes(t));
}

/** Does an unlock drain apply to the Methuselah whose phase it is?
 *  (docs/pool-drain-design.md §3). */
function drainConditionHolds(
  state: GameState,
  when: NonNullable<NonNullable<CardSpec["permanent"]>["unlockDrain"]>["when"],
  unlockingSeat: SeatId,
  bearer: MinionId | null,
): boolean {
  if (!when) return true;
  if (when.kind === "bearerInTorpor") {
    // A condition on the CARD's bearer, not on the unlocking seat — which
    // is why it shares the union: all three answer "does it apply now".
    const m = bearer === null ? null : findMinion(state, bearer);
    return m !== null && m.inTorpor;
  }
  const seat = getSeat(state, unlockingSeat);
  if (when.kind === "noReadySect") {
    return !seat.minions.some(
      (m) => m.kind === "vampire" && isReady(m) && m.sect === when.sect,
    );
  }
  // "…controlling a non-Camarilla vampire": Camarilla is a SECT, and an
  // untagged vampire is not of it, so it counts — exactly as `notClan`
  // reads elsewhere.
  return seat.minions.some((m) => m.kind === "vampire" && m.sect !== when.sect);
}

/** Locate the mode a play refers to (level + optional variant tag). */
/**
 * "More than one Discipline can be used to play this card" (Make the
 * Misere, Break the Bonds, The Platinum Protocol) — the ADDITIVE mode
 * shape, where every other card's modes are exclusive.
 *
 * Collapsing them into one synthetic mode is what keeps this from
 * branching the whole compiler: enumeration and resolution both keep
 * using the paths they already have, and the only difference is that the
 * mode list has one entry chosen by the actor's Disciplines instead of
 * several chosen by the player. A mode with `discipline: null` is the
 * card's unconditional clause (the rush itself, or the bleed) and is
 * always included. docs/rush-outcome-design.md §6
 */
function combinedMode(spec: CardSpec, m: MinionState): CardMode {
  const effects: EffectPrimitive[] = [];
  for (const mode of spec.modes) {
    if (!canPlayMode(m, mode, spec)) continue;
    effects.push(...mode.effects);
  }
  return { level: "basic", discipline: null, effects };
}

/** The mode list to enumerate for this actor: one synthetic combined mode
 *  for a `multiDiscipline` card, the printed modes otherwise. */
function modesFor(spec: CardSpec, m: MinionState): CardMode[] {
  return spec.multiDiscipline ? [combinedMode(spec, m)] : spec.modes;
}

function modeOf(spec: CardSpec, mode: string | null, variant: string | undefined): CardMode {
  const found =
    spec.modes.find(
      (m) => m.level === mode && (variant === undefined || m.variant === variant),
    ) ?? spec.modes[0];
  if (!found) throw new Error(`${spec.name} has no modes`);
  return found;
}

// ---------------------------------------------------------------------------
// Action cards
// ---------------------------------------------------------------------------

/** Resolve a modifier's conditional "+N more if <condition>" extra
 *  (Aire of Elation, Protection Racket) — 0 when absent or unmet. */
function conditionalExtra(
  bonus: { extra: number; when: ModifierCondition } | undefined,
  play: CardPlayFrame,
  af: ActionFrame,
  ops: EngineOps,
): number {
  if (!bonus) return 0;
  const cond = bonus.when;
  let holds = false;
  switch (cond.kind) {
    case "selfClan": {
      const m = play.minion ? findMinion(ops.state, play.minion) : null;
      holds = m?.clan === cond.clan;
      break;
    }
    case "selfTitled": {
      const m = play.minion ? findMinion(ops.state, play.minion) : null;
      holds = m !== null && m.title !== null;
      break;
    }
    case "actingTitled": {
      const a = findMinion(ops.state, af.acting);
      holds = a !== null && a.title !== null;
      break;
    }
    case "targetPoolAtMost": {
      holds = af.target !== null && getSeat(ops.state, af.target).pool <= cond.value;
      break;
    }
  }
  return holds ? bonus.extra : 0;
}

/** The one effect in a mode that needs an announced target, if any. */
function targetRider(mode: CardMode): EffectPrimitive | null {
  for (const e of mode.effects) {
    if (
      e.kind === "addUncontrolledBlood" ||
      e.kind === "bloodOnBleedSuccess" ||
      e.kind === "actionEnterCombat" ||
      e.kind === "actionAddBloodToVampire" ||
      e.kind === "stealMinionOnSuccess" ||
      e.kind === "actionStun" ||
      e.kind === "actionStealBlood" ||
      e.kind === "actionSteal" ||
      e.kind === "attachToOpponent"
    ) {
      return e;
    }
  }
  return null;
}

/** Eligible rush targets: ready minions anywhere, never the actor itself
 *  (rush design §2.2 — own minions are legal, the action is then
 *  undirected; torpor is excluded since that combat cannot happen,
 *  p. 30). */
function enumerateRushTargets(
  state: GameState,
  actor: MinionState,
  e: Extract<EffectPrimitive, { kind: "actionEnterCombat" }> | { targets: "minion" | "vampire"; lockedOnly?: boolean },
): string[] {
  const targets: string[] = [];
  for (const s of state.seats) {
    if (s.ousted) continue;
    for (const m of s.minions) {
      if (m.id === actor.id) continue;
      if (!isReady(m)) continue;
      // "…cannot be the target of other Methuselahs' actions" (Secure Haven).
      if (untargetableBy(m, actor.controller, actor)) continue;
      if (e.targets === "vampire" && m.kind !== "vampire") continue;
      if (e.lockedOnly && !m.locked) continue;
      targets.push(m.id);
    }
  }
  return targets;
}

/**
 * The option params for "remove N cards in <an> ash heap from the game to
 * <payoff>" (Shroud of Decay superior, Psychophagia).
 *
 * Two shapes, and both are chosen at announcement (p. 25):
 *  - a COUNT from one named seat's heap ("remove 7 cards in your PREY's
 *    ash heap") — offered only when there are 7 to remove, since a card
 *    that provably cannot pay its own cost is not a legal play;
 *  - ONE card of a printed type from ANY heap ("remove an ALLY in any
 *    Methuselah's ash heap") — one option per card, times one per payoff.
 *
 * docs/ash-heap-design.md §5–§6
 */
function ashHeapPicks(
  ctx: PlayContext,
  actor: MinionState,
  e: Extract<EffectPrimitive, { kind: "actionRemoveFromAshHeap" }>,
): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  const seats =
    e.whose === "prey"
      ? [getSeat(ctx.state, preyOf(ctx.state, ctx.seat))]
      : ctx.state.seats.filter((s) => !s.ousted);
  // "…to gain 3 blood OR to gain 2 blood and unlock": the payoffs are the
  // player's choice, so each is its own option rather than a decision the
  // card makes for them.
  const payoffs: string[] = [];
  if (e.gainBlood !== undefined) payoffs.push("gain");
  if (e.unlockInstead) payoffs.push("unlock");
  if (payoffs.length === 0) payoffs.push("-");

  // "…OR to add N life to a zombie ally you control" (Putrescent
  // Sustenance): a payoff that names a RECIPIENT, so it is one option per
  // eligible ally rather than one payoff. An ally already at its printed
  // starting life is not offered — the cap is `capacityOf`, and a
  // recipient that could gain nothing is not a choice.
  const lifeRecipients: string[] = [];
  if (e.addAllyLife) {
    for (const m of getSeat(ctx.state, ctx.seat).minions) {
      if (m.kind !== "ally" || !isReady(m)) continue;
      if (!minionHasTag(m, e.addAllyLife.tag)) continue;
      if (m.blood >= capacityOf(m)) continue;
      lifeRecipients.push(m.id);
    }
  }

  for (const s of seats) {
    // Every card that names a COUNT means library cards ("remove 7 cards
    // in your prey's ash heap"); a burnt vampire sits in the heap too and
    // is not one (docs/ledger-closeout.md §9).
    const heap = (s.ashHeap ?? []).filter((c) => !c.crypt);
    if (e.cardTypes) {
      for (const c of heap) {
        // The printed type of a card sitting in an ash heap — the query
        // built for the play-cost wave, asked of a card we do not hold.
        const types = ctx.registry[c.name]?.costTypes?.(null) ?? [];
        if (!e.cardTypes.some((t) => types.includes(t))) continue;
        for (const p of payoffs) out.push({ heap: s.id, card: c.id, payoff: p });
        for (const r of lifeRecipients) {
          out.push({ heap: s.id, card: c.id, payoff: "life", recipient: r });
        }
      }
      continue;
    }
    // A plain count: not offered at all unless the heap can pay it.
    if (heap.length < e.count) continue;
    for (const p of payoffs) out.push({ heap: s.id, payoff: p });
  }
  // "…and unlock" is worth nothing to a minion that is already unlocked,
  // but the card does not say so — both options stay on the table.
  void actor;
  return out;
}

function enumerateActionTargets(
  state: GameState,
  seatId: string,
  actor: MinionState,
  e: EffectPrimitive,
  /** What the card being played requires, for targets that are protected
   *  from a named Discipline (Aggressive Corpse). */
  cardDisciplines: string[] = [],
): string[] {
  const seat = getSeat(state, seatId);
  const targets: string[] = [];
  const younger = (cap: number, need: boolean): boolean => !need || cap < capacityOf(actor);
  // An uncontrolled vampire whose counters already reach its capacity
  // gains nothing: the excess drains to the blood bank the moment it
  // enters play (p. 6). The same rule the influence phase now applies
  // (docs/futile-options-design.md).
  if (e.kind === "addUncontrolledBlood") {
    for (const u of seat.uncontrolled) {
      if (e.clan !== undefined && u.card.clan !== e.clan) continue;
      if (!uncontrolledCanTakeCounters(u)) continue;
      if (younger(capacityOf(u.card), e.youngerOnly)) targets.push(u.card.id);
    }
  } else if (e.kind === "bloodOnBleedSuccess") {
    for (const u of seat.uncontrolled) {
      if (!uncontrolledCanTakeCounters(u)) continue;
      if (younger(capacityOf(u.card), e.youngerOnly)) targets.push(u.card.id);
    }
    if (e.scope === "anywhere") {
      // "…a younger vampire you control" — vampires only, never allies.
      for (const m of seat.minions) {
        if (m.kind !== "vampire" || !canGainBlood(m)) continue;
        if (m.id !== actor.id && younger(capacityOf(m), e.youngerOnly)) targets.push(m.id);
      }
    }
  } else if (e.kind === "actionAddBloodToVampire") {
    // "Another vampire" — any vampire in play, any controller, not self.
    // With `allies`/`self` this becomes "a minion" (Touch of Valeren).
    for (const s of state.seats) {
      if (s.ousted) continue;
      for (const m of s.minions) {
        if (m.kind !== "vampire" && !e.allies) continue;
        if (m.id === actor.id && !e.self) continue;
        // A minion at capacity has nothing to gain WHETHER OR NOT the
        // card prints "not to exceed" — p. 6 caps every minion, so the
        // excess drains either way. `capped` used to gate this check,
        // which meant an uncapped card still offered a full vampire an
        // option that did nothing (docs/futile-options-design.md).
        if (!canGainBlood(m)) continue;
        targets.push(m.id);
      }
    }
  } else if (e.kind === "actionStun") {
    // "Stun an UNLOCKED vampire" — any Methuselah's (a Ⓓ action, directed
    // at the target's controller). The actor is excluded: it locks at
    // announcement (p. 25), so it can never satisfy the card's own
    // condition when the effect resolves (docs/stun-design.md §6).
    for (const s of state.seats) {
      if (s.ousted) continue;
      for (const m of s.minions) {
        if (m.kind !== "vampire" || !isReady(m) || m.locked) continue;
        if (m.id === actor.id) continue;
        // "Cannot be the target of other Methuselahs' actions" (Secure
        // Haven) — asked wherever an action picks a minion target.
        if (untargetableBy(m, seatId, actor)) continue;
        targets.push(m.id);
      }
    }
  } else if (e.kind === "stealMinionOnSuccess") {
    // "…controlled by ANOTHER Methuselah" — never your own.
    for (const s of state.seats) {
      if (s.ousted || s.id === seatId) continue;
      for (const m of s.minions) {
        if (m.kind !== e.kindFilter || !isReady(m)) continue;
        // This branch was the ONE minion-targeting branch that never asked
        // (docs/library-audit.md §2): Secure Haven's "cannot be the target
        // of other Methuselahs' actions" and Aggressive Corpse's
        // Discipline bar both apply to a steal like any other action.
        if (untargetableBy(m, seatId, actor, cardDisciplines)) continue;
        targets.push(m.id);
      }
    }
  } else if (e.kind === "actionStealBlood") {
    // "…from a minion controlled by YOUR PREY" (Tier of Souls). A minion
    // with nothing to take is not a legal target.
    const from = e.from === "prey" ? [preyOf(state, seatId)] : state.seats.map((s) => s.id);
    for (const s of state.seats) {
      if (s.ousted || !from.includes(s.id)) continue;
      for (const m of s.minions) {
        if (!isReady(m) || m.blood <= 0) continue;
        if (untargetableBy(m, seatId, actor)) continue;
        targets.push(m.id);
      }
    }
  } else if (e.kind === "actionSteal") {
    // "Ⓓ Steal a retainer controlled by another VAMPIRE" is weaker than
    // "…an ally controlled by another METHUSELAH": the first allows
    // taking from your own other vampire (§4).
    for (const s of state.seats) {
      if (s.ousted) continue;
      if (e.from === "otherMethuselah" && s.id === seatId) continue;
      for (const m of s.minions) {
        if (e.what === "retainer") {
          if (m.kind !== "vampire" || m.id === actor.id) continue;
          if (untargetableBy(m, seatId, actor)) continue;
          // The target is the RETAINER, not its bearer.
          for (const p of m.attached) {
            if (p.tags.includes("retainer")) targets.push(p.card.id);
          }
          continue;
        }
        if (e.what === "ally") {
          if (m.kind !== "ally") continue;
        } else {
          // "…a vampire IN TORPOR".
          if (m.kind !== "vampire" || !m.inTorpor) continue;
        }
        if (untargetableBy(m, seatId, actor)) continue;
        targets.push(m.id);
      }
    }
  } else if (e.kind === "attachToOpponent") {
    const scope =
      e.whose === "predator" ? [predatorOf(state, seatId)] : state.seats.map((s) => s.id);
    for (const s of state.seats) {
      if (s.ousted || !scope.includes(s.id)) continue;
      for (const m of s.minions) {
        if (m.kind !== "vampire" || m.id === actor.id) continue;
        // "…on a YOUNGER vampire" — `capacityOf`, so a granted point
        // counts, as everywhere since the derived-traits wave.
        if (e.whose === "younger" && capacityOf(m) >= capacityOf(actor)) continue;
        if (untargetableBy(m, seatId, actor)) continue;
        targets.push(m.id);
      }
    }
  }
  return targets;
}

/**
 * Cards in play that "Ⓓ Burn a location" / "…an equipment" / "Ⓓ Steal a
 * location" can name. Locations sit at seat level and equipment on
 * minions, so both zones are scanned; a card the actor's own Methuselah
 * controls is excluded, since every card in this family says the target
 * belongs to someone else by being a directed action.
 */
function enumeratePermanentTargets(
  state: GameState,
  seatId: string,
  e: Extract<EffectPrimitive, { kind: "actionOnPermanent" }>,
): string[] {
  const out: string[] = [];
  for (const s of state.seats) {
    if (s.ousted || s.id === seatId) continue;
    if (e.what === "location") {
      for (const p of s.permanents) {
        if (p.tags.includes("location")) out.push(p.card.id);
      }
    } else {
      for (const m of s.minions) {
        for (const p of m.attached) {
          if (p.tags.includes("equipment")) out.push(p.card.id);
        }
      }
    }
  }
  return out;
}

/** Action cards: playing the card announces the action (rulebook p. 25). */
function compileActionCard(spec: CardSpec): CardHandler {
  const hasAttachSelf = spec.modes.some((m) =>
    m.effects.some((e) => e.kind === "attachSelf"),
  );
  const handler: CardHandler = {
    name: spec.name,
    bloodCost: spec.bloodCost,
    // Omitted until 2026-08-31, so an action card with a pool cost was
    // GATED on the pool at enumeration (which reads the spec) and then
    // charged nothing at resolution (which reads the handler) —
    // Aranthebes, The Immortal was free. Nothing asserts a number that is
    // never charged, and the fuzz cannot see a cost that is not taken.
    poolCost: spec.poolCost ?? 0,
    isActionCard: true,

    options(card, ctx) {
      if (ctx.window !== "turn.minion") return [];
      const seat = getSeat(ctx.state, ctx.seat);
      // A unique card that puts itself in play cannot be played twice (Under
      // Siege) — own-copy check.
      if (spec.unique && seatControlsCopy(ctx.state, ctx.seat, spec.name)) return [];
      // "Requires a prince or primogen" on an ACTION card is a condition on
      // the Methuselah (Expulsion), and was checked only in the polling
      // branch until now.
      if (!controllerMeetsRequirements(ctx.state, ctx.seat, spec)) return [];
      const options: LegalOption[] = [];
      for (const m of seat.minions) {
        if (!canAct(m)) continue;
        // "…can play NON-ACTION cards … as a vampire" (Spectral Servitor).
        if (playsNonActionOnly(m)) continue;
        /**
         * One option per way of paying, the plain one first.
         *
         * "Only a vampire with enough blood can play a card with a blood
         * cost" (p. 9), even though it is paid at resolution — counters
         * on a cost source (Ravnos Carnival) count toward affording it.
         * The cost is read PER MODE, because a play-cost modifier can key
         * on the Disciplines the chosen mode requires (Libertas), so one
         * mode of a card can be affordable while another is not
         * (docs/play-cost-design.md §3).
         */
        const push = (mode: CardMode, params: Record<string, string>): void => {
          const splits = paymentSplits(
            ctx,
            m,
            costOf(spec, ctx, m, mode),
            "action",
          ).filter((s) => m.blood >= s.blood && seat.pool >= s.pool);
          for (const s of splits) {
            options.push(makeOption(spec, card, m, mode, { ...params, ...s.params }));
          }
        };
        // Same named action card once per turn, even if they unlock (p. 20).
        if (m.playedSinceUnlock.includes(spec.name)) continue;
        // "…cannot perform the same action again this turn" (Change of
        // Target, Obedience, Delaying Tactics) — the action key for a
        // card-announced action is the card name.
        if (!canRepeatAction(ctx.state, m, spec.name)) continue;
        // "Requires a prince or justicar" / "…an Anarch" etc.
        if (!meetsRequirements(m, spec)) continue;
        for (const mode of modesFor(spec, m)) {
          if (!canPlayMode(m, mode, spec)) continue;
          const bleeds = mode.effects.some((e) => e.kind === "actionBleed");
          // An enhanced bleed is still a bleed action: once per turn (p. 20).
          if (bleeds && m.bledThisTurn) continue;
          // "A vampire can have only one Heart of the City / Preternatural
          // Strength" — own-duplicate prevention by card name. When the
          // card names its own target ("put this card on a minion you
          // control") the check belongs on the target, below.
          const attach = mode.effects.find((e) => e.kind === "attachSelf");
          if (
            attach?.kind === "attachSelf" &&
            attach.target === undefined &&
            m.attached.some((p) => p.tags.includes(spec.name))
          ) {
            continue;
          }
          if (attach?.kind === "attachSelf" && attach.target !== undefined) {
            // Target fixed at announcement (p. 25), one option each.
            // "…a minion you control" vs a bare "a minion" (Phantasmagoria).
            const pool =
              attach.target === "ownMinion"
                ? seat.minions
                : ctx.state.seats.filter((s) => !s.ousted).flatMap((s) => s.minions);
            for (const t of pool) {
              if (t.attached.some((p) => p.tags.includes(spec.name))) continue;
              // "…cannot be the target of other Methuselahs' actions".
              if (untargetableBy(t, ctx.seat, m)) continue;
              push(mode, { target: t.id });
            }
            continue;
          }
          const rider = targetRider(mode);
          const removeFromAsh = mode.effects.find(
            (e) => e.kind === "actionRemoveFromAshHeap",
          ) as Extract<EffectPrimitive, { kind: "actionRemoveFromAshHeap" }> | undefined;
          if (rider && rider.kind === "actionEnterCombat") {
            // Rush target fixed at announcement (p. 25).
            for (const t of enumerateRushTargets(ctx.state, m, rider)) {
              push(mode, { target: t });
            }
          } else if (mode.effects.some((e) => e.kind === "actionOnPermanent")) {
            // "Ⓓ Burn a location" — one option per legal card in play,
            // fixed at announcement (p. 25). Equipment lives on minions,
            // locations at seat level, so both zones are scanned.
            const eff = mode.effects.find((e) => e.kind === "actionOnPermanent") as Extract<
              EffectPrimitive,
              { kind: "actionOnPermanent" }
            >;
            for (const t of enumeratePermanentTargets(ctx.state, ctx.seat, eff)) {
              push(mode, { permanent: t });
            }
          } else if (mode.effects.some((e) => e.kind === "playFromHand")) {
            // "Employ an animal retainer from your hand" — the hand card
            // and its version are chosen at announcement like any other
            // target (p. 25), and ride in the option id.
            const eff = mode.effects.find((e) => e.kind === "playFromHand") as Extract<
              EffectPrimitive,
              { kind: "playFromHand" }
            >;
            for (const c of playFromHandChoices(ctx, eff, m)) push(mode, c.params);
          } else if (mode.effects.some((e) => e.kind === "actionStealPool")) {
            // "…from another Methuselah": a SEAT target, one option each,
            // fixed at announcement like any other target (p. 25).
            for (const s of ctx.state.seats) {
              if (s.ousted || s.id === ctx.seat) continue;
              push(mode, { seat: s.id });
            }
          } else if (removeFromAsh) {
            // "Remove N cards in <whose> ash heap from the game to
            // <payoff>". The cards are chosen at announcement like any
            // other target (p. 25); the action is UNDIRECTED whatever the
            // ash heap belongs to (glossary), so no target seat is set.
            for (const pick of ashHeapPicks(ctx, m, removeFromAsh)) {
              push(mode, pick);
            }
          } else if (rider) {
            // Target fixed at announcement (p. 25).
            for (const t of enumerateActionTargets(
              ctx.state,
              ctx.seat,
              m,
              rider,
              modeDisciplines(mode),
            )) {
              // "…and this acting vampire CAN burn N blood to move the
              // stolen vampire to your ready region" (Graverobbing
              // superior): optional and priced, so it is a second choice
              // made at announcement — one option per way, never decided
              // for the player (docs/taking-actions-design.md §5).
              if (rider.kind === "actionSteal" && rider.thenReady) {
                push(mode, { target: t, ready: "0" });
                if (m.blood >= rider.thenReady.bloodCost) {
                  push(mode, { target: t, ready: "1" });
                }
                continue;
              }
              push(mode, { target: t });
            }
          } else {
            push(mode, {});
          }
        }
      }
      return options;
    },

    resolve(play, ops) {
      // A multi-Discipline card has no mode to look up: which riders apply
      // is decided by the acting minion's Disciplines, read HERE, which is
      // announcement time for an action card (§6).
      const mode =
        spec.multiDiscipline && play.minion
          ? combinedMode(spec, getMinion(ops.state, play.minion))
          : modeOf(spec, play.mode, play.params["variant"]);
      const params: CardActionParams = { actionKind: "cardEffect" };
      // "During that combat" credits ACCUMULATE: a multi-Discipline card
      // hangs one off each Discipline (Make the Misere), and both
      // spellings — `actionEnterCombat.riders` and the standalone
      // `rushRiders` clause — write here, so they cannot drift.
      const riders: NonNullable<CardActionParams["rushRiders"]> = {};
      let anyRider = false;
      const addRiders = (r: NonNullable<CardActionParams["rushRiders"]>): void => {
        anyRider = true;
        if (r.maneuver) riders.maneuver = (riders.maneuver ?? 0) + r.maneuver;
        if (r.press) riders.press = (riders.press ?? 0) + r.press;
        if (r.strength) riders.strength = (riders.strength ?? 0) + r.strength;
        if (r.noCombatEndsFirstRound) riders.noCombatEndsFirstRound = true;
      };
      for (const e of mode.effects) {
        if (e.kind === "actionBleed") {
          params.actionKind = "bleed";
          params.bleedBonus = e.bonus;
        }
        if (e.kind === "actionStealth") {
          params.inherentStealth = e.amount;
        }
        if (e.kind === "rushRiders") {
          addRiders(e);
        }
        if (e.kind === "actionEnterCombat") {
          const target = play.params["target"];
          if (!target) throw new Error(`${spec.name}: no rush target`);
          params.targetMinion = target;
          if (e.riders) addRiders(e.riders);
          // "…and LOCK a vampire" (Deep Song superior) — on success, and
          // consistent with the inversion below: an acting minion is
          // normally locked at announcement (p. 25).
          if (e.lockTarget) params.lockTarget = true;
          // "The target vampire is considered the acting minion during
          // that combat" (§3).
          if (e.invertRoles) params.invertCombatRoles = true;
          // "At the end of that combat, …" — fixed at announcement (p. 25)
          // and installed on the rush's own combat by `finishAction`.
          if (e.outcome && play.minion) {
            const eff = e.outcome.effect;
            params.combatOutcome = {
              kind: "outcome",
              actor: play.minion,
              seat: play.seat,
              cardId: play.card.id,
              name: spec.name,
              when: e.outcome.when,
              effect:
                eff.kind === "attachToActor"
                  ? { kind: "attachToActor", statics: eff.statics, tags: eff.tags ?? [spec.name] }
                  : eff,
            };
          }
        }
        if (e.kind === "attachSelf" && e.target === "anyMinion") {
          // "Ⓓ Put this card on a minion": the Ⓓ makes it directed, and
          // directedness derives from the named minion's controller
          // (p. 25). It does NOT fight them — the Mind Numb shape.
          const target = play.params["target"];
          if (!target) throw new Error(`${spec.name}: no attach target`);
          params.targetMinion = target;
          params.noCombat = true;
        }
        if (e.kind === "actionStealBlood") {
          const target = play.params["target"];
          if (!target) throw new Error(`${spec.name}: no steal target`);
          params.targetMinion = target;
          params.noCombat = true;
        }
        if (e.kind === "actionStun") {
          const target = play.params["target"];
          if (!target) throw new Error(`${spec.name}: no stun target`);
          // Named for directedness (p. 25), NOT to fight: without
          // `noCombat` a successful action with a targetMinion rushes it.
          params.targetMinion = target;
          params.noCombat = true;
        }
        if (e.kind === "actionStealPool") {
          const seat = play.params["seat"];
          if (!seat) throw new Error(`${spec.name}: no target Methuselah`);
          params.targetSeat = seat;
        }
        if (e.kind === "actionOnPermanent") {
          const permanent = play.params["permanent"];
          if (!permanent) throw new Error(`${spec.name}: no target card in play`);
          params.targetPermanent = permanent;
        }
      }
      if (anyRider) params.rushRiders = riders;
      ops.announceCardAction(play, params);
      // Effects that must be in place BEFORE the block window, not at
      // resolution: "titled vampires cannot block THIS action", and "if
      // this action is blocked, the actor gets X in the resulting
      // combat". A blocked action never resolves, so registering these in
      // `resolveCardAction` would mean they never applied in exactly the
      // case they are written for. docs/bleed-riders-sweep.md
      for (const e of mode.effects) {
        if (e.kind === "blockRestriction") {
          if (e.who === "chosen") {
            const t = play.params["target"];
            if (t) ops.restrictBlocking("chosen", t);
          } else {
            ops.restrictBlocking(e.who);
          }
        }
        // "Anarchs get −1 intercept DURING THIS ACTION" (Fiendish Tongue)
        // shapes the block window, so it belongs here for the same reason
        // the two clauses below do.
        if (e.kind === "modifyFilteredIntercept") {
          ops.modifyFilteredIntercept(e.amount, spec.name, {
            ...(e.kinds ? { kinds: e.kinds } : {}),
            ...(e.younger ? { younger: true } : {}),
            ...(e.sects ? { sects: e.sects } : {}),
          });
        }
        if (e.kind === "actorCombatRider") {
          const riders: Parameters<EngineOps["grantActorCombatRider"]>[0] = {};
          if (e.prevent) riders.prevent = e.prevent;
          if (e.strength) riders.strength = e.strength;
          if (e.maneuver) riders.maneuver = e.maneuver;
          if (e.press) riders.press = e.press;
          if (e.handStrikesAggravated) riders.handStrikesAggravated = true;
          if (e.combatAggravated) riders.combatAggravated = true;
          ops.grantActorCombatRider(riders);
        }
      }
    },

    resolveCardAction(af, ops) {
      // A multi-Discipline card resolves the SAME combined mode it
      // announced — `modeOf` would find only the first printed clause,
      // which is the trap the next card of this shape (Break the Bonds,
      // whose riders fire on bleed success) would have fallen into.
      const actor = spec.multiDiscipline ? findMinion(ops.state, af.acting) : null;
      const mode = actor
        ? combinedMode(spec, actor)
        : modeOf(spec, af.card?.mode ?? null, af.card?.params["variant"]);
      const bleedOk =
        af.actionKind !== "bleed" || currentBleed(ops.state, af) >= 1;
      for (const e of mode.effects) {
        switch (e.kind) {
          case "becomesVampire": {
            // The token itself entered play through
            // `becomesVampireOnSuccess`, which the engine runs before the
            // effects; this is the second sentence. "You CAN search…" is
            // optional and finding nothing is always legal (p. 14, p. 48),
            // but the frame is NOT `optional`: declining an optional frame
            // never calls `applyChoice`, which would skip the shuffle
            // p. 14 makes mandatory. "Find nothing" is an ordinary answer.
            if (!e.searchDisciplineMaster) break;
            ops.raiseChoice({
              seat: af.actingSeat,
              cardName: spec.name,
              cardId: af.card?.instance.id ?? "",
              key: "searchDiscipline",
              params: { minion: af.card?.instance.id ?? "" },
              optional: false,
            });
            break;
          }
          case "attachSelf":
            // "…and unlock them" (Abbot). The card itself attaches via
            // `attachOnSuccess`; this is the extra clause.
            if (e.unlockActor) {
              const actor = findMinion(ops.state, af.acting);
              if (actor?.locked) ops.emit({ type: "MinionUnlocked", minion: af.acting });
            }
            break;
          case "selfDamageAfterAction":
            // "…this vampire takes 1 unpreventable environmental
            // aggravated damage" (Rutor's Hand). Here — in
            // `resolveCardAction`, which fires only on SUCCESS — because
            // p. 27 is unambiguous that a blocked action's card effects do
            // not happen (docs/action-attachments-design.md §8.2).
            ops.damageAfterAction(
              af.acting,
              e.amount,
              e.aggravated,
              e.optOutBlood !== undefined && af.card
                ? {
                    blood: e.optOutBlood,
                    cardName: spec.name,
                    cardId: af.card.instance.id,
                  }
                : undefined,
            );
            break;
          case "actionStealBlood": {
            // "Steal 1 blood or life": it MOVES, so the victim burns and
            // the actor gains — clamped to what the victim actually has.
            const target = af.card?.params["target"];
            if (!target) throw new Error(`${spec.name}: no steal target`);
            const victim = findMinion(ops.state, target);
            const actor = findMinion(ops.state, af.acting);
            if (!victim || !actor) break;
            const amount = Math.min(e.amount, victim.blood);
            if (amount <= 0) break;
            ops.emit({ type: "BloodBurned", minion: victim.id, amount });
            ops.emit({ type: "BloodGained", minion: actor.id, amount });
            break;
          }
          case "addUncontrolledBlood": {
            const target = af.card?.params["target"];
            if (!target) throw new Error(`${spec.name}: no uncontrolled target`);
            ops.emit({
              type: "UncontrolledBloodAdded",
              seat: af.actingSeat,
              minion: target,
              amount: e.amount,
            });
            break;
          }
          case "actionGainBlood":
            // "This vampire gains N blood" on a successful action
            // (Restoration); excess over capacity drains as usual.
            ops.emit({ type: "BloodGained", minion: af.acting, amount: e.amount });
            break;
          case "playFromHand":
            // "Employ an animal retainer from your hand ignoring
            // requirements" (Biothaumaturgic Experiment) — the choice was
            // fixed at announcement and rides in the action's params.
            applyPlayFromHand(ops, e, af.actingSeat, af.acting, af.card?.params ?? {});
            break;
          case "searchEquip": {
            // p. 48: "You do NOT search your library until the action is
            // successful", and the card is never announced — so this is
            // raised HERE, at resolution, not fixed in the option id like
            // every other target (docs/library-search-design.md §2).
            if (e.deterministic) {
              searchEquipDeterministic(spec, e, af.actingSeat, af.acting, ops);
              break;
            }
            ops.raiseChoice({
              seat: af.actingSeat,
              cardName: spec.name,
              cardId: af.card?.instance.id ?? "",
              key: "searchEquip",
              params: { minion: af.acting },
              // See the note on searchStore: "Find nothing" is the decline,
              // because a plain pass would skip the mandatory shuffle.
              optional: false,
            });
            break;
          }
          case "actionStun": {
            // The target was fixed at announcement; it can have left play
            // or been sent to torpor in between.
            const t = af.targetMinion;
            if (t && findMinion(ops.state, t)) ops.stun(t);
            break;
          }
          case "actionAddBloodToVampire": {
            // "Add N blood to another vampire" — the chosen in-play
            // vampire (Fifth Tradition: Hospitality).
            const target = af.card?.params["target"];
            if (!target) throw new Error(`${spec.name}: no blood target`);
            const t = findMinion(ops.state, target);
            if (!t) break; // it can leave play between announce and resolve
            // "…not to exceed their starting life": the BloodGained clamp
            // covers vampires, but an ally's capacity is a reference and
            // not a cap (p. 11), so the amount is trimmed here instead.
            const amount = e.capped
              ? Math.max(0, Math.min(e.amount, capacityOf(t) - t.blood))
              : e.amount;
            if (amount > 0) {
              ops.emit({ type: "BloodGained", minion: target, amount });
            }
            break;
          }
          case "poolGainOnBleedSuccess":
            // "If the bleed is successful (for 1 or more)".
            if (bleedOk) {
              ops.emit({ type: "PoolGained", seat: af.actingSeat, amount: e.amount });
            }
            break;
          case "actionOnPermanent": {
            const id = af.targetPermanent;
            if (!id) break;
            // It can leave play between announcement and resolution.
            const owner = ops.controllerOfEntry(id);
            if (owner === null) break;
            // Rewilding: "…and burn 2 pool from its controller" — read
            // BEFORE the card leaves play, since burning it may change
            // what `controllerOfEntry` can find.
            if (e.poolFromController) {
              ops.emit({ type: "PoolBurned", seat: owner, amount: e.poolFromController });
            }
            if (e.outcome === "steal") ops.changePermanentControl(id, af.actingSeat);
            else ops.burnPermanent(id);
            break;
          }
          case "actionStealPool": {
            // "Ⓓ Steal N pool from another Methuselah" — it moves, so the
            // target burns exactly what the actor gains.
            const victim = af.target;
            if (victim === null) break;
            const took = Math.min(e.amount, getSeat(ops.state, victim).pool);
            if (took <= 0) break;
            ops.emit({ type: "PoolBurned", seat: victim, amount: took });
            ops.emit({ type: "PoolGained", seat: af.actingSeat, amount: took });
            break;
          }
          case "stealMinionOnSuccess": {
            const target = af.card?.params["target"];
            if (!target) throw new Error(`${spec.name}: no steal target`);
            // It can leave play between announcement and resolution.
            if (!findMinion(ops.state, target)) break;
            ops.changeMinionControl(target, af.actingSeat);
            break;
          }
          case "actionSteal": {
            const target = af.card?.params["target"];
            if (!target) throw new Error(`${spec.name}: no steal target`);
            if (e.what === "retainer") {
              // A retainer is a card in play on a minion: it moves with
              // the attachment op, and its controller changes with it
              // (p. 16). The bearer is looked up rather than trusted —
              // the retainer or its host can be gone by resolution.
              const host = ops.state.seats
                .flatMap((s) => s.minions)
                .find((m) => m.attached.some((p) => p.card.id === target));
              if (!host) break;
              ops.moveAttachment(target, af.acting, af.actingSeat);
              break;
            }
            // An ally IS a minion, and so is a torpid vampire: control of
            // the whole MinionState moves, carrying everything on it.
            if (!findMinion(ops.state, target)) break;
            if (e.untilEndOfTurn) ops.borrowMinion(target, af.actingSeat);
            else ops.changeMinionControl(target, af.actingSeat);
            // "…and this acting vampire can burn N blood to move the
            // stolen vampire to your ready region" — optional and priced,
            // so the choice rides in the option id (§5).
            if (e.thenReady && af.card?.params["ready"] === "1") {
              const actor = findMinion(ops.state, af.acting);
              const stolen = findMinion(ops.state, target);
              if (actor && stolen && actor.blood >= e.thenReady.bloodCost && stolen.inTorpor) {
                if (e.thenReady.bloodCost > 0) {
                  ops.emit({
                    type: "BloodBurned",
                    minion: actor.id,
                    amount: e.thenReady.bloodCost,
                  });
                }
                ops.emit({ type: "LeftTorpor", minion: stolen.id });
              }
            }
            break;
          }
          case "attachToOpponent": {
            const target = af.card?.params["target"];
            if (!target || !af.card) throw new Error(`${spec.name}: no attach target`);
            const bearer = findMinion(ops.state, target);
            if (!bearer) break;
            ops.putPermanentInPlay({
              card: af.card.instance,
              seat: bearer.controller,
              attachTo: bearer.id,
              statics: {},
              tags: [spec.name],
              // p. 16: it stays the acting Methuselah's card even though
              // it sits on somebody else's vampire.
              controller: af.actingSeat,
              // The vampire that PLAYED it — this card feeds and dies
              // with them, not with its bearer (§6).
              linkedMinion: af.acting,
              // "The attached vampire does not unlock as normal" — the
              // persistent form built for Toreador Grand Ball, set at
              // entry because that is where the field is written.
              ...(e.preventsUnlock ? { preventsUnlock: bearer.id } : {}),
            });
            if (e.lockBearer && !bearer.locked) {
              ops.emit({ type: "MinionLocked", minion: bearer.id });
            }
            break;
          }
          case "actionRemoveFromAshHeap": {
            const heapSeat = af.card?.params["heap"];
            if (!heapSeat) throw new Error(`${spec.name}: no ash heap chosen`);
            // Library cards only, matching what was enumerated: a burnt
            // vampire is in the heap and is not one of "N cards".
            const heap = (getSeat(ops.state, heapSeat).ashHeap ?? []).filter((c) => !c.crypt);
            const one = af.card?.params["card"];
            if (one) {
              // "Remove AN ALLY in any Methuselah's ash heap".
              ops.removeFromAshHeap(heapSeat, one);
            } else {
              // "Remove 7 cards in your prey's ash heap" — the cards are
              // not named on the card, so the top N go. Re-read here
              // rather than at announcement: the heap can have changed.
              for (const c of heap.slice(0, e.count)) {
                ops.removeFromAshHeap(heapSeat, c.id);
              }
            }
            if (e.burnPool) {
              ops.emit({ type: "PoolBurned", seat: heapSeat, amount: e.burnPool });
            }
            const payoff = af.card?.params["payoff"];
            const actor = findMinion(ops.state, af.acting);
            if (actor && payoff === "gain" && e.gainBlood) {
              ops.emit({ type: "BloodGained", minion: actor.id, amount: e.gainBlood });
            }
            if (actor && payoff === "unlock" && e.unlockInstead) {
              ops.emit({
                type: "BloodGained",
                minion: actor.id,
                amount: e.unlockInstead.blood,
              });
              ops.emit({ type: "MinionUnlocked", minion: actor.id });
            }
            // "…or to add N life to a zombie ally you control". The
            // recipient was fixed at announcement; re-read it, because it
            // can have left play since (the `findMinion` rule).
            if (payoff === "life" && e.addAllyLife) {
              const to = findMinion(ops.state, af.card?.params["recipient"] ?? "");
              if (to) {
                // `BloodGained` clamps an ally at `capacityOf`, which for
                // an ally is its printed starting life (p. 11) — so "not
                // to exceed" needs no arithmetic here.
                ops.emit({ type: "BloodGained", minion: to.id, amount: e.addAllyLife.amount });
              }
            }
            break;
          }
          case "targetDiscardsOnBleed": {
            if (!bleedOk || af.target === null) break;
            const hand = getSeat(ops.state, af.target).hand;
            if (hand.length === 0 || !af.card) break;
            // "…discards N cards OF THEIR CHOICE" — asked of the TARGET,
            // repeatedly, the Fragment of the Book of Nod shape.
            ops.raiseChoice({
              seat: af.target,
              cardName: spec.name,
              cardId: af.card.instance.id,
              key: "targetDiscard",
              params: { left: String(e.count) },
            });
            break;
          }
          case "discardPhaseUnlockOnBleed": {
            // `bleedOk` above already means "the bleed was for 1 or more",
            // and resolveCardAction runs only on success.
            if (!bleedOk) break;
            const actor = findMinion(ops.state, af.acting);
            if (!actor || actor.clan !== e.clan) break;
            ops.grantDiscardPhaseUnlock(actor.id);
            break;
          }
          case "peekAndDiscard": {
            // "Look at your prey's hand and discard one card of your
            // choice from it" — the choice belongs to the ACTOR, and the
            // prey's seat rides in the params. An empty hand raises
            // nothing (a frame with no answers would hang the settle loop
            // — the fuzz found that with The Rack).
            if (!af.card) break;
            const victim = preyOf(ops.state, af.actingSeat);
            const seen = getSeat(ops.state, victim).hand;
            if (seen.length === 0) break;
            // THE LOOK IS THE EVENT. Recorded here, at the moment the card
            // says "look at your prey's hand", and not in the choice's
            // option list — an option list is a pure read, and the actor
            // has seen the hand whether or not they go on to discard from
            // it. Without this the actor forgot the cards they did not
            // take the instant the frame popped
            // (docs/knowledge-design.md).
            ops.emit({
              type: "CardsRevealed",
              to: af.actingSeat,
              cards: seen.map((c) => c.id),
            });
            ops.raiseChoice({
              seat: af.actingSeat,
              cardName: spec.name,
              cardId: af.card.instance.id,
              key: "peekDiscard",
              params: { victim, left: String(e.count) },
            });
            break;
          }
          case "lockTargetMinionOnBleed": {
            if (!bleedOk || af.target === null) break;
            // "…you CAN lock a minion controlled by the target
            // Methuselah": one legal answer means it is automatic, several
            // raise a choice — the Brujah Debate precedent.
            const seatOf = ops.state.seats.find((s) => s.id === af.target);
            const targets = (seatOf?.minions ?? []).filter((m) => isReady(m) && !m.locked);
            if (targets.length === 0) break;
            if (targets.length === 1) {
              ops.emit({ type: "MinionLocked", minion: targets[0]!.id });
              break;
            }
            if (af.card) {
              ops.raiseChoice({
                seat: af.actingSeat,
                cardName: spec.name,
                cardId: af.card.instance.id,
                key: "lockTarget",
                params: { target: af.target },
                optional: true,
              });
            }
            break;
          }
          case "cryptDrawOnBleedSuccess": {
            if (!bleedOk) break;
            const actor = findMinion(ops.state, af.acting);
            if (!actor || actor.blood < e.bloodCost) break;
            if (getSeat(ops.state, af.actingSeat).crypt.length === 0) break;
            // "…CAN burn N blood to draw": optional, so it is asked.
            if (af.card) {
              ops.raiseChoice({
                seat: af.actingSeat,
                cardName: spec.name,
                cardId: af.card.instance.id,
                key: "cryptDraw",
                params: { minion: af.acting, cost: String(e.bloodCost) },
                optional: true,
              });
            }
            break;
          }
          case "targetLocksOwnMinion": {
            // The choice belongs to the BLEED TARGET, not to the actor.
            if (af.target === null || !af.card) break;
            ops.raiseChoice({
              seat: af.target,
              cardName: spec.name,
              cardId: af.card.instance.id,
              key: "lockOwnMinion",
            });
            break;
          }
          case "bloodOnBleedSuccess": {
            if (!bleedOk) break;
            const target = af.card?.params["target"];
            if (!target) throw new Error(`${spec.name}: no blood target`);
            const controlled = getSeat(ops.state, af.actingSeat).minions.some(
              (m) => m.id === target,
            );
            if (controlled) {
              ops.emit({ type: "BloodGained", minion: target, amount: e.amount });
            } else {
              ops.emit({
                type: "UncontrolledBloodAdded",
                seat: af.actingSeat,
                minion: target,
                amount: e.amount,
              });
            }
            break;
          }
          default:
            break;
        }
      }
    },

    /**
     * Choices raised by an action's own effects. Generic rather than
     * bespoke per card, so any spec using these primitives gets them:
     * `cryptDraw` is the actor's optional "burn N blood to draw", and
     * `lockOwnMinion` belongs to the BLEED TARGET, not the actor.
     * docs/bleed-riders-sweep.md
     */
    choiceOptions(frame, state) {
      if (frame.key === "cryptDraw") {
        const minion = frame.params?.["minion"];
        const cost = frame.params?.["cost"] ?? "0";
        if (!minion) return [];
        return [
          {
            id: `choice:${spec.name}:${frame.cardId}:cryptDraw:yes`,
            kind: "answerChoice" as const,
            label: `${spec.name}: burn ${cost} blood to draw a crypt card`,
            params: { minion, cost },
          },
        ];
      }
      if (frame.key === "lockOwnMinion") {
        return getSeat(state, frame.seat)
          .minions.filter((m) => isReady(m) && !m.locked)
          .map((m) => ({
            id: `choice:${spec.name}:${frame.cardId}:lockOwnMinion:${m.id}`,
            kind: "answerChoice" as const,
            label: `${spec.name}: lock ${m.name}`,
            params: { minion: m.id },
          }));
      }
      return [];
    },
    applyChoice(frame, choice, ops) {
      const minion = choice.params["minion"];
      if (!minion) return;
      if (frame.key === "lockOwnMinion") {
        ops.emit({ type: "MinionLocked", minion });
        return;
      }
      if (frame.key === "cryptDraw") {
        const cost = Number(choice.params["cost"] ?? "0");
        const top = getSeat(ops.state, frame.seat).crypt[0];
        if (!top) return;
        if (cost > 0) ops.emit({ type: "BloodBurned", minion, amount: cost });
        // A crypt card drawn goes to its owner's uncontrolled region (p. 3).
        ops.emit({ type: "CryptCardDrawn", seat: frame.seat, minion: top.id });
      }
    },
  };
  if (hasAttachSelf) {
    handler.attachOnSuccess = (modeLevel) => {
      const mode = modeOf(spec, modeLevel, undefined);
      const eff = mode.effects.find((e) => e.kind === "attachSelf") as
        | Extract<EffectPrimitive, { kind: "attachSelf" }>
        | undefined;
      // The clause can sit on ONE printed version only (Biothaumaturgic
      // Experiment): the other version burns as normal.
      if (!eff) return null;
      // The shorthand fields, then anything the card spells out in full.
      const statics: PermanentStatics = { ...(eff.statics ?? {}) };
      if (eff.bleed) statics.bleed = eff.bleed;
      if (eff.strength) statics.strength = eff.strength;
      if (eff.conditional) statics.conditional = eff.conditional;
      if (eff.maneuverPerCombat) statics.maneuverPerCombat = eff.maneuverPerCombat;
      const r: {
        statics: PermanentStatics;
        tags: string[];
        locked?: boolean;
        bearerFromTarget?: boolean;
      } = { statics, tags: [spec.name] };
      if (eff.locked) r.locked = true;
      // Only a card that names its own bearer reads `params.target` as
      // one; otherwise that param belongs to a different clause (§9).
      if (eff.target !== undefined) r.bearerFromTarget = true;
      return r;
    };
  }
  // "Put this card in play. It becomes a 1-capacity vampire"
  // (docs/token-vampire-design.md §2).
  if (spec.modes.some((m) => m.effects.some((e) => e.kind === "becomesVampire"))) {
    handler.becomesVampireOnSuccess = (modeLevel, actor) => {
      const mode = modeOf(spec, modeLevel, undefined);
      const eff = mode.effects.find((e) => e.kind === "becomesVampire") as
        | Extract<EffectPrimitive, { kind: "becomesVampire" }>
        | undefined;
      if (!eff) return null;
      return {
        capacity: eff.capacity,
        // "…of the same clan as the acting vampire" (Childe) is read ONCE,
        // here; nothing links the two afterwards (§7).
        clan: eff.clanFromActor ? (actor?.clan ?? null) : (eff.clan ?? null),
        sect: eff.sect ?? null,
      };
    };
  }
  if (spec.modes.some((m) => m.effects.some((e) => e.kind === "putInPlayOnSuccess"))) {
    handler.putsInPlayOnSuccess = (modeLevel) => {
      const mode = modeOf(spec, modeLevel, undefined);
      const eff = mode.effects.find((e) => e.kind === "putInPlayOnSuccess") as
        | Extract<EffectPrimitive, { kind: "putInPlayOnSuccess" }>
        | undefined;
      // THE MODE THAT WAS PLAYED DECIDES. The handler is registered when
      // ANY mode puts the card in play, so a card whose superior does and
      // whose basic does not was putting itself in play either way — this
      // returned a default entry for a mode with no such effect at all.
      // Revelations basic ("look at your prey's hand and discard one") was
      // leaving a permanent that opens the prey's hand for the rest of the
      // game, which is the superior's whole text.
      //
      // The same shape as Wall of Filth's aggravated filter: a handler
      // lookup cannot answer a question whose answer differs by mode
      // (docs/combat-attachments-design.md §3).
      if (!eff) return null;
      const r: { counters?: number; tags: string[]; statics?: PermanentStatics } = {
        tags: eff.tags ?? [spec.name, "location"],
      };
      if (eff.counters !== undefined) r.counters = eff.counters;
      // "Your prey plays with an open hand" (Revelations superior) — the
      // card in play carries statics like any other permanent.
      if (spec.permanent?.statics) r.statics = spec.permanent.statics;
      return r;
    };
  }
  return handler;
}

// ---------------------------------------------------------------------------
// Combat cards
// ---------------------------------------------------------------------------

/** The combat window a mode's primitives live in (design doc §2). */
/**
 * Which combatant a frenzy card's mode is used ON — the question
 * "frenzy cards cannot be used on this vampire" (Tranquility Shield) and
 * "cancel a frenzy card as it is played on a Salubri you control"
 * (Meditative Grove, not yet built) both ask.
 *
 * Derived from the mode's own effects rather than from a list of card
 * names, so a new frenzy card classifies itself: a mode that reaches
 * across at the other combatant is used on them; any other frenzy mode
 * (Rage of Apedemak, a self-buff) is used on its player.
 * docs/round-recurring-combat-design.md §6
 */
export function frenzyTargetSide(
  mode: CardMode,
  playerSide: "acting" | "opposing",
): "acting" | "opposing" {
  const other = playerSide === "acting" ? "opposing" : "acting";
  return mode.effects.some(
    (e) => e.kind === "restrictOpponent" || e.kind === "combatCostModOnOpponent",
  )
    ? other
    : playerSide;
}

function combatWindowFor(mode: CardMode): WindowId | null {
  for (const e of mode.effects) {
    switch (e.kind) {
      case "strikeHandBonus":
      case "strikeCombatEnds":
      case "strikeDodge":
      case "strikeDamage":
      case "strikeStealBlood":
      case "strikeAttachToVictim":
      case "strikeIncapacitate":
      case "additionalStrike":
        return "combat.chooseStrike";
      // The only primitive whose window is DATA. One printed mechanic
      // ("put this card on <a combatant>") arrives with two different
      // timings — Wall of Filth before range, Disarm at end of round —
      // and splitting it into two identically-resolving primitives to
      // satisfy this switch is how `modifyVotes`/`restrictVotes` drifted.
      // docs/combat-attachments-design.md §2
      case "attachInCombat":
        return e.when === "endOfRound" ? "combat.endOfRound" : "combat.beforeRange";
      case "setStrength":
      case "addStrength":
      // "Only usable before range is determined. This combat, you get +1
      // hand size" (Rage of Apedemak).
      case "handSizeBonus":
      case "restrictOpponent":
      case "attachSelfWeapon":
      case "combatCredits":
      case "combatCostModOnOpponent":
      // "Only usable before range is determined" — the whole
      // play-from-hand family (docs/play-from-hand-design.md).
      case "playFromHand":
      case "roundCloseManeuver":
      case "burnAttachedToAttach":
      // "Only usable before range is determined" — the whole
      // round-recurring family (docs/round-recurring-combat-design.md).
      case "preventEachRound":
      case "roundDamage":
      case "autoPreventAfterFirst":
      case "frenzyShield":
      case "combatBloodStore":
        return "combat.beforeRange";
      case "handStrikesAggravated":
      // "…strikes with weapons inflict no damage this round" is a rider
      // on a strike card, so it shares that card's window; on its own it
      // belongs beside handStrikesAggravated.
      case "nullifyOpposingWeaponDamage":
      // "Only usable at close range BEFORE STRIKES ARE CHOSEN"
      // (Immortal Grapple, docs/round-end-design.md §2).
      case "handStrikesOnly":
        return "combat.beforeStrikes";
      // "Only usable BEFORE RANGE IS DETERMINED" (Hunger of Marduk).
      case "grantStealBloodStrike":
        return "combat.beforeRange";
      // "Only usable at the END OF A ROUND of combat" (Taste of Vitae).
      case "gainOpposingBloodLost":
        return "combat.endOfRound";
      // A combat card that acts inside ANOTHER card's as-played period,
      // which p. 7 reserves for cancels — and this is one (§4).
      case "cancelStrikeCard":
        return "card.asPlayed";
      case "maneuver":
      case "grantCloseManeuver":
        return "combat.range";
      // "Only usable if combat would end" — the End of Round window,
      // where `willContinue` is already decided (§1).
      case "startNewRound":
        return "combat.endOfRound";
      // "Only usable AS THIS MINION CHOOSES A STRIKE" (Target Vitals, §3).
      case "aimBonus":
        return "combat.chooseStrike";
      case "press":
        return "combat.press";
      case "prevent":
      case "preventAll":
      case "preventForOther":
      case "preventAllThisRound":
        return "combat.damageResolution";
      default:
        break;
    }
  }
  return null;
}

/** Combat cards: playable only by the two combatants; being locked does
 *  not matter in combat (p. 28); no once-per-action limit applies. */
/**
 * Options for one outside-the-combat mode played by vampire `v`.
 *
 * The victim is chosen at play time — "a minion **or retainer** in combat"
 * (Martyr's Resilience) or "that minion", the one the player controls
 * (Touch of Valeren superior) — so it rides in the option id. A variable
 * "burn X blood to prevent X+1" emits one option per affordable X, the
 * shape `bankStealth` established. docs/outside-combat-design.md
 */
function outsidePreventOptions(
  spec: CardSpec,
  card: CardInstance,
  ctx: PlayContext,
  cf: CombatFrame,
  v: MinionState,
  mode: CardMode,
): LegalOption[] {
  const eff = mode.effects.find((e) => e.kind === "preventForOther") as
    | Extract<EffectPrimitive, { kind: "preventForOther" }>
    | undefined;
  if (!eff) return [];
  // Only damage that is actually pending can be prevented — the p. 26
  // "only when needed" instinct, applied to prevention.
  const victims = [...new Set(cf.pendingDamage.map((p) => p.minion))].filter((id) => {
    // Same Discipline filter as the ordinary prevention window, read off
    // the item `preventDamageFor` would actually reduce — the FIRST
    // pending item for that minion (§3).
    const item = cf.pendingDamage.find((p) => p.minion === id);
    if (item && blockedByNoPrevent(mode, item)) return false;
    if (!eff.ownOnly) return true;
    const target = findMinion(ctx.state, id);
    return target?.controller === ctx.seat;
  });
  const out: LegalOption[] = [];
  for (const victim of victims) {
    if (eff.perBlood) {
      const most = Math.min(eff.perBlood.max, v.blood - costOf(spec, ctx, v, mode).blood);
      for (let x = 0; x <= most; x++) {
        out.push(makeOption(spec, card, v, mode, { victim, x: String(x) }));
      }
    } else {
      out.push(makeOption(spec, card, v, mode, { victim }));
    }
  }
  return out;
}

function compileCombatCard(spec: CardSpec): CardHandler {
  const handler: CardHandler = {
    name: spec.name,
    bloodCost: spec.bloodCost,
    // No V5 combat card charges pool, but the two sides must agree: see
    // the note in compileActionCard.
    poolCost: spec.poolCost ?? 0,
    isCombatCard: true,

    options(card, ctx) {
      const cf = ctx.combat;
      if (!cf) return [];

      // "Only usable by a vampire not involved in the combat" (p. 28) —
      // and such a card may come from ANY Methuselah, so this runs before
      // the combatant-seat gate below. The playing vampire must not BE a
      // combatant; its controller may well be one.
      // docs/outside-combat-design.md
      const outside: LegalOption[] = [];
      for (const mode of spec.modes) {
        const needsUnlocked = mode.usable?.includes("byOutsideUnlockedVampire") ?? false;
        const needsReady = mode.usable?.includes("byOutsideVampire") ?? false;
        if (!needsUnlocked && !needsReady) continue;
        if (combatWindowFor(mode) !== ctx.window) continue;
        for (const v of getSeat(ctx.state, ctx.seat).minions) {
          if (v.kind !== "vampire" || !isReady(v)) continue;
          if (v.id === cf.acting || v.id === cf.opposing) continue; // in it
          if (needsUnlocked && v.locked) continue;
          if (v.blood < costOf(spec, ctx, v, mode).blood) continue;
          if (!meetsRequirements(v, spec)) continue;
          if (!canPlayMode(v, mode, spec)) continue;
          outside.push(...outsidePreventOptions(spec, card, ctx, cf, v, mode));
        }
      }

      const side =
        cf.actingSeat === ctx.seat
          ? ("acting" as const)
          : cf.opposingSeat === ctx.seat
            ? ("opposing" as const)
            : null;
      if (!side) return outside;
      // A combatant can leave play mid-combat (a burned ally, Touch of
      // Oblivion) while the frame is still winding down through its End
      // of Round step (p. 32) — it plays no more cards.
      const m = findMinion(ctx.state, side === "acting" ? cf.acting : cf.opposing);
      if (!m) return outside;
      // Affordability is per MODE below — a strike-card surcharge
      // (Ensnare a Beast) applies only to the modes that set a strike.
      // "Requires an Anarch" etc. (Diversion) — the combatant must qualify.
      if (!meetsRequirements(m, spec)) return outside;
      // "A vampire can play only one X each round/combat" (p. 32).
      if (spec.combatLimit === "round" && cf.playedThisRound.includes(spec.name)) {
        return outside;
      }
      if (spec.combatLimit === "combat" && cf.playedThisCombat.includes(spec.name)) {
        return outside;
      }

      const options: LegalOption[] = [...outside];
      for (const mode of spec.modes) {
        if (combatWindowFor(mode) !== ctx.window) continue;
        // An outside-the-combat mode was enumerated above, from a vampire
        // that is NOT in this combat; a combatant may not play it.
        if (
          (mode.usable ?? []).some(
            (u) => u === "byOutsideVampire" || u === "byOutsideUnlockedVampire",
          )
        ) {
          continue;
        }
        if (!canPlayMode(m, mode, spec)) continue;
        // "Frenzy cards cannot be used ON this vampire" (Tranquility
        // Shield). Which vampire a frenzy mode is used on comes from its
        // own effects, not a list of card names — see
        // docs/round-recurring-combat-design.md §6.
        if (spec.frenzy && cf.frenzyImmune[frenzyTargetSide(mode, side)]) continue;
        // "Only one <card> at SUPERIOR each combat" (Terror Frenzy) — a
        // per-mode limit, so the mode is part of the recorded key.
        if (
          mode.usable?.includes("oncePerCombatAtSuperior") &&
          cf.playedThisCombat.includes(`${spec.name}:${mode.level}`)
        ) {
          continue;
        }
        // "…only one at superior each ACTION" (Form of Mist) — the same
        // per-mode limit, scoped to the enclosing action instead.
        if (
          mode.usable?.includes("oncePerActionAtSuperior") &&
          ctx.action?.played.some((p) => p.card === spec.name && p.mode === mode.level)
        ) {
          continue;
        }
        if (m.blood < costOf(spec, ctx, m, mode).blood) continue;
        switch (ctx.window) {
          case "combat.chooseStrike": {
            if (cf.strikes[side] !== null) continue;
            // "Strikes that are NOT HAND STRIKES cannot be used this
            // round (by either combatant)" (Immortal Grapple). A mode
            // that sets a hand strike survives; a weapon strike, a fixed
            // damage strike, a dodge and a combat-ends strike do not.
            // A gate on OPTIONS (docs/round-end-design.md §2).
            if (
              cf.handStrikesOnly &&
              !mode.effects.some((e) => e.kind === "strikeHandBonus")
            ) {
              continue;
            }
            // "Only usable AS THIS MINION CHOOSES A STRIKE" plus "a
            // minion can play only one AIM each strike" — a per-KEYWORD
            // limit, where `combatLimit` counts by card name (§3).
            if (
              (spec.keywords ?? []).includes("aim") &&
              (cf.aimsThisStrike ?? []).includes(m.id)
            ) {
              continue;
            }
            // "Only usable at long range" (No Trace basic).
            if (mode.usable?.includes("onlyAtLongRange") && cf.range !== "long") {
              continue;
            }
            // "Only usable at close range" (Blood Fury, Blood Rage).
            if (mode.usable?.includes("onlyAtCloseRange") && cf.range !== "close") {
              continue;
            }
            // "Not usable during the first round" (Walk of Flame).
            if (mode.usable?.includes("onlyAfterFirstRound") && cf.round <= 1) {
              continue;
            }
            // "Minions in combat with the employer cannot strike: combat
            // ends" (Dog Pack) — a static on the OPPONENT gates this
            // minion's combat-ends strikes.
            if (mode.effects.some((e) => e.kind === "strikeCombatEnds")) {
              const opponent = getMinion(
                ctx.state,
                side === "acting" ? cf.opposing : cf.acting,
              );
              const me = getMinion(ctx.state, side === "acting" ? cf.acting : cf.opposing);
              if (opponent.attached.some((p) => barsCombatEnds(p, me))) continue;
              // The same bar, granted by a rush action for the first round
              // only (Hunter's Mark superior) — keyed by the barred side.
              // docs/rush-outcome-design.md §5
              if (cf.noCombatEndsFirstRound[side] && cf.round === 1) continue;
            }
            const addl = mode.effects.find((e) => e.kind === "additionalStrike");
            if (addl && addl.kind === "additionalStrike") {
              // Additional strikes are granted in the normal strike pair,
              // not during an additional sub-round; the "(limited)" source
              // is spent once per round (p. 32).
              if (cf.strikeRound !== "normal") continue;
              if (addl.limited && cf.usedLimitedAddl[side]) continue;
              if (addl.perBloodX) {
                // "Burn X blood to get X additional strikes" — X beyond the
                // card's own blood cost.
                const maxX = m.blood - costOf(spec, ctx, m, mode).blood;
                for (let x = 1; x <= maxX; x++) {
                  options.push(makeOption(spec, card, m, mode, { x: String(x) }));
                }
                break;
              }
            }
            // "Strike: hand strike OR USE A MELEE WEAPON STRIKE, at +N
            // damage" (Anticipation) — one option per legal weapon
            // alongside the hand strike, the choice in the option id (§4).
            const hb = mode.effects.find((x) => x.kind === "strikeHandBonus");
            if (hb?.kind === "strikeHandBonus" && hb.orMeleeWeapon) {
              for (const p of m.attached) {
                if (!p.tags.includes("weapon") || !p.tags.includes("melee")) continue;
                options.push(
                  makeOption(spec, card, m, mode, { weapon: p.card.id }),
                );
              }
            }
            options.push(makeOption(spec, card, m, mode, {}));
            break;
          }
          case "card.asPlayed": {
            // "Burn N blood to cancel the OPPOSING minion's STRIKE CARD
            // as it is played" (Anticipation superior, §4). `isStrike`
            // is denormalized onto the frame, so no card reads another
            // card's spec.
            const cs = mode.effects.find((x) => x.kind === "cancelStrikeCard");
            if (cs?.kind !== "cancelStrikeCard") continue;
            const pending = ctx.pendingCard;
            const foe = side === "acting" ? cf.opposing : cf.acting;
            if (
              !pending ||
              pending.isStrike !== true ||
              pending.minion !== foe ||
              m.blood < cs.bloodCost
            ) {
              continue;
            }
            options.push(makeOption(spec, card, m, mode, {}));
            break;
          }
          case "combat.range": {
            if (cf.awaiting !== side) continue;
            // "The opposing minion cannot maneuver" (Terror Frenzy).
            if (cf.restrict[side].maneuver) continue;
            // "Maneuver, ONLY USABLE TO GET TO CLOSE RANGE" (Dance with
            // the Devil) — worth nothing once the range is already close,
            // the same gate `closeManeuvers` uses (§4).
            const man = mode.effects.find((e) => e.kind === "maneuver");
            if (man?.kind === "maneuver" && man.onlyToClose && cf.range === "close") {
              continue;
            }
            options.push(makeOption(spec, card, m, mode, {}));
            break;
          }
          case "combat.press": {
            if (cf.awaiting !== side) continue;
            if (cf.restrict[side].press) continue; // "cannot press to continue"
            const press = mode.effects.find((e) => e.kind === "press");
            if (!press || press.kind !== "press") continue;
            if (!cf.willContinue) {
              options.push(makeOption(spec, card, m, mode, { press: "continue" }));
            } else if (!press.continueOnly) {
              // Cancel the standing press to continue (p. 32).
              options.push(makeOption(spec, card, m, mode, { press: "cancel" }));
            }
            break;
          }
          case "combat.beforeRange": {
            // "Only usable during the first round" (Terror Frenzy).
            if (mode.usable?.includes("onlyFirstRound") && cf.round > 1) continue;
            // "Equip this vampire with a melee weapon from your hand" —
            // one option per legal (hand card × version × payment split),
            // all of it in the option id (docs/play-from-hand-design.md).
            const from = mode.effects.find((e) => e.kind === "playFromHand");
            if (from?.kind === "playFromHand") {
              for (const c of playFromHandChoices(ctx, from, m)) {
                options.push(makeOption(spec, card, m, mode, c.params));
              }
              break;
            }
            // "Burn an animal retainer employed by this vampire to put
            // this card on this vampire" (Pack Alpha superior).
            const burn = mode.effects.find((e) => e.kind === "burnAttachedToAttach");
            if (burn?.kind === "burnAttachedToAttach") {
              const key = spec.permanent?.exclusiveKey;
              if (key && m.attached.some((p) => p.tags.includes(key))) break;
              for (const p of m.attached) {
                if (!burn.tags.every((t) => p.tags.includes(t))) continue;
                options.push(makeOption(spec, card, m, mode, { burn: p.card.id }));
              }
              break;
            }
            // "A vampire can have only one Wall of Filth" — own-duplicate
            // prevention by tag, the same gate the action side uses.
            const selfAttach = mode.effects.find((e) => e.kind === "attachInCombat");
            if (
              selfAttach?.kind === "attachInCombat" &&
              selfAttach.to === "self" &&
              m.attached.some((p) => p.tags.includes(spec.name))
            ) {
              break;
            }
            // "Put this card in play and move UP TO N blood from the
            // opposing vampire to this card" (Morbidity) — the amount is
            // the player's choice, one option each (§6).
            const store = mode.effects.find((e) => e.kind === "combatBloodStore");
            if (store?.kind === "combatBloodStore") {
              const foe = findMinion(ctx.state, side === "acting" ? cf.opposing : cf.acting);
              // "…in combat with a VAMPIRE" — an ally holds life, not
              // blood, and there is nothing to move.
              if (!foe || foe.kind !== "vampire") break;
              for (let x = 0; x <= Math.min(store.max, foe.blood); x++) {
                options.push(makeOption(spec, card, m, mode, { x: String(x) }));
              }
              break;
            }
            options.push(makeOption(spec, card, m, mode, {}));
            break;
          }
          case "combat.beforeStrikes":
            options.push(makeOption(spec, card, m, mode, {}));
            break;
          case "combat.endOfRound": {
            // "Only usable at close range at the end of a round during
            // which this vampire successfully inflicted more damage than
            // the opposing vampire. Not usable by a vampire being burned
            // or going to torpor." (Disarm — §4.)
            if (mode.usable?.includes("onlyAtCloseRange") && cf.range !== "close") continue;
            if (mode.usable?.includes("byStillReadyCombatant") && !isReady(m)) continue;
            if (mode.usable?.includes("onlyIfInflictedMoreThisRound")) {
              const mine = cf.damageTakenThisRound[side];
              const theirs = cf.damageTakenThisRound[side === "acting" ? "opposing" : "acting"];
              if (theirs <= mine) continue;
            }
            // "Only usable if COMBAT WOULD END" — a finished fact by the
            // time this window opens, because the press step ran first.
            // A combat that ended PREMATURELY (a combatant left the ready
            // region, p. 30) cannot be restarted, which is why both cards
            // also print "if both combatants are still ready" (§1).
            if (
              mode.usable?.includes("onlyIfCombatWouldEnd") &&
              (cf.willContinue || cf.endedPrematurely)
            ) {
              continue;
            }
            if (mode.usable?.includes("onlyIfBothCombatantsReady")) {
              const a = findMinion(ctx.state, cf.acting);
              const o = findMinion(ctx.state, cf.opposing);
              if (!a || !o || !isReady(a) || !isReady(o)) continue;
            }
            const restart = mode.effects.find((e) => e.kind === "startNewRound");
            if (restart && restart.kind === "startNewRound") {
              if (m.blood < (restart.bloodCost ?? 0)) continue;
              options.push(makeOption(spec, card, m, mode, {}));
              break;
            }
            const attach = mode.effects.find((e) => e.kind === "attachInCombat");
            if (!attach) {
              // Any OTHER end-of-round effect (Taste of Vitae's blood
              // gain) — the branch used to demand an attach, which was
              // fine while attaching was the only thing done here.
              options.push(makeOption(spec, card, m, mode, {}));
              break;
            }
            // A card that attaches to the opposing vampire needs one to
            // attach to: it can have been burned earlier in the round and
            // End of Round still runs (p. 32).
            if (attach.kind === "attachInCombat" && attach.to === "opposing") {
              const foe = findMinion(ctx.state, side === "acting" ? cf.opposing : cf.acting);
              if (!foe) continue;
              // "A vampire can have only one Disarm."
              if (foe.attached.some((p) => p.tags.includes(spec.name))) continue;
            }
            options.push(makeOption(spec, card, m, mode, {}));
            break;
          }
          case "combat.damageResolution": {
            // Only the minion currently taking damage may prevent (p. 31).
            const pd = cf.pendingDamage[0];
            if (!pd || pd.minion !== m.id) continue;
            // "This damage cannot be prevented by cards requiring
            // Fortitude" — a gate on the OPTION, so the card is never
            // offered against damage it cannot touch (§3).
            if (blockedByNoPrevent(mode, pd)) continue;
            // "Prevent ALL damage from the opposing minion's strike"
            // (Touch of Valeren basic combat) and "…all damage from their
            // strikes THIS ROUND" (Rolling with the Punches superior) are
            // prevention too. Only `prevent` used to be enumerated here,
            // which made Touch of Valeren's combat mode unreachable — the
            // Terror Frenzy class of bug: a mode nothing asserts.
            const all = mode.effects.find(
              (e) => e.kind === "preventAll" || e.kind === "preventAllThisRound",
            );
            if (all) {
              // The extra blood some of them charge is on top of the
              // card's own cost, so it gates the option.
              const extra = all.kind === "preventAllThisRound" ? all.bloodCost : 0;
              if (m.blood < costOf(spec, ctx, m, mode).blood + extra) continue;
              options.push(makeOption(spec, card, m, mode, {}));
              break;
            }
            const prevent = mode.effects.find((e) => e.kind === "prevent");
            if (!prevent || prevent.kind !== "prevent") continue;
            // "Prevent N NON-AGGRAVATED damage" (Soak, Wall of Filth
            // basic) — a gate on the option, the `noPreventBy` precedent:
            // never offer a card against damage it provably cannot touch.
            // docs/combat-attachments-design.md §3
            if (prevent.nonAggravated && pd.aggravated) continue;
            if (prevent.perBloodX) {
              const maxX = Math.min(
                m.blood - costOf(spec, ctx, m, mode).blood,
                Math.max(0, pd.amount - prevent.base),
              );
              for (let x = 0; x <= maxX; x++) {
                options.push(makeOption(spec, card, m, mode, { x: String(x) }));
              }
            } else {
              options.push(makeOption(spec, card, m, mode, {}));
            }
            break;
          }
          default:
            break;
        }
      }
      return options;
    },

    resolve(play, ops) {
      const mode = modeOf(spec, play.mode, play.params["variant"]);
      for (const e of mode.effects) {
        switch (e.kind) {
          case "strikeHandBonus":
            ops.chooseCardStrike(play, {
              handBonus: e.bonus,
              ...(e.aggravated ? { aggravated: true } : {}),
              ...(e.undodgeable ? { undodgeable: true } : {}),
              ...(play.params["weapon"] ? { useWeapon: play.params["weapon"] } : {}),
              ...(e.riders?.noPreventBy ? { noPreventBy: e.riders.noPreventBy } : {}),
            });
            if (e.riders?.maneuver) {
              for (let i = 0; i < e.riders.maneuver; i++) ops.grantManeuverCredit(play);
            }
            if (e.riders?.press) {
              for (let i = 0; i < e.riders.press; i++) ops.grantCombatPress(play);
            }
            break;
          case "strikeCombatEnds":
            ops.chooseCardStrike(play, {
              combatEnds: true,
              unlockSelf: e.unlockSelf,
            });
            break;
          case "strikeDodge":
            ops.chooseCardStrike(play, { dodge: true });
            break;
          case "grantStealBloodStrike":
            // A grant, not a strike: offered later in the round, and
            // gone at the round boundary (§3).
            if (play.minion) {
              ops.grantStrikeToMinion(play.minion, {
                kind: "stealBlood",
                amount: e.amount,
                roundOnly: true,
              });
            }
            break;
          case "gainOpposingBloodLost":
            ops.gainOpposingBloodLost(play);
            break;
          case "cancelStrikeCard":
            if (e.bloodCost > 0 && play.minion) {
              ops.emit({ type: "BloodBurned", minion: play.minion, amount: e.bloodCost });
            }
            // "…and its cost is not paid" — the Sudden Reversal wording,
            // which refunds. "The minion chooses a strike again" is the
            // settle loop's own doing: the slot was never filled (§4).
            ops.cancelPendingCard(true);
            break;
          case "nullifyOpposingWeaponDamage":
            ops.nullifyOpposingWeaponDamage(play);
            break;
          case "preventAllThisRound":
            if (e.bloodCost > 0 && play.minion) {
              ops.emit({ type: "BloodBurned", minion: play.minion, amount: e.bloodCost });
            }
            ops.preventAllFromOpponentThisRound(play);
            break;
          case "afterCombatEnds": {
            if (!play.minion) break;
            if (e.damage) {
              ops.addAfterCombatRider({
                kind: "damage",
                source: play.minion,
                amount: e.damage.amount,
                closeRangeOnly: e.damage.closeRangeOnly,
              });
            }
            if (e.stun) {
              ops.addAfterCombatRider({
                kind: "stun",
                source: play.minion,
                closeRangeOnly: e.stun.closeRangeOnly,
              });
            }
            if (e.attachSelf) {
              ops.addAfterCombatRider({
                kind: "attachSelf",
                minion: play.minion,
                seat: play.seat,
                cardId: play.card.id,
                name: play.card.name,
              });
            }
            if (e.continueAction) {
              ops.addAfterCombatRider({
                kind: "continueAction",
                minion: play.minion,
                bloodCost: e.continueAction.bloodCost,
                stealth: e.continueAction.stealth,
              });
            }
            break;
          }
          case "combatCostModOnOpponent":
            ops.addCombatCostModOnOpponent(play, e.mod);
            break;
          case "strikeDamage":
            ops.chooseCardStrike(play, {
              damage: e.amount,
              ranged: e.ranged,
              aggravated: e.aggravated,
              ...(e.riders?.noPreventBy ? { noPreventBy: e.riders.noPreventBy } : {}),
            });
            if (e.riders?.maneuver) {
              for (let i = 0; i < e.riders.maneuver; i++) ops.grantManeuverCredit(play);
            }
            if (e.riders?.press) {
              for (let i = 0; i < e.riders.press; i++) ops.grantCombatPress(play);
            }
            break;
          case "playFromHand":
            applyPlayFromHand(ops, e, play.seat, play.minion, play.params);
            break;
          case "roundCloseManeuver":
            ops.grantCloseManeuver(play);
            break;
          case "burnAttachedToAttach": {
            if (!play.minion) throw new Error(`${spec.name}: no combatant`);
            const victim = play.params["burn"];
            if (!victim) throw new Error(`${spec.name}: nothing chosen to burn`);
            ops.burnPermanent(victim);
            ops.putPermanentInPlay({
              card: play.card,
              seat: play.seat,
              attachTo: play.minion,
              statics: {
                ...(spec.permanent?.statics ?? {}),
                ...(e.strength !== undefined ? { strength: e.strength } : {}),
              },
              tags: [
                ...(spec.permanent?.tags ?? []),
                ...(spec.permanent?.exclusiveKey ? [spec.permanent.exclusiveKey] : []),
              ],
            });
            break;
          }
          case "attachSelfWeapon": {
            // "Put this card with N counters on it on this minion; it
            // becomes a … weapon equipment" (Weighted Walking Stick).
            if (!play.minion) throw new Error(`${spec.name}: no combatant`);
            ops.putPermanentInPlay({
              card: play.card,
              seat: play.seat,
              attachTo: play.minion,
              statics: spec.permanent?.statics ?? {},
              tags: spec.permanent?.tags ?? [],
              counters: e.counters,
            });
            break;
          }
          case "strikeAttachToVictim":
            ops.chooseCardStrike(play, {
              // "…at +1 damage AND put this card on the opposing minion"
              // (Sculpt the Flesh superior): the attach rides on a real
              // hand strike, where Touch of Oblivion's attach IS the
              // strike. docs/combat-attachments-design.md §1
              ...(e.handBonus !== undefined ? { handBonus: e.handBonus } : {}),
              attachToVictim: {
                ...(e.counters !== undefined ? { counters: e.counters } : {}),
                ...(e.counterSink !== undefined ? { counterSink: e.counterSink } : {}),
                ...(e.statics !== undefined ? { statics: e.statics } : {}),
                ...(e.bearerUnlockBurn !== undefined
                  ? { bearerUnlockBurn: e.bearerUnlockBurn }
                  : {}),
              },
            });
            break;
          case "strikeIncapacitate":
            ops.chooseCardStrike(play, { incapacitate: true });
            break;
          case "attachInCombat": {
            // The prevention clause travels ON THE ENTRY, not on the
            // handler: Wall of Filth's two modes differ by exactly the
            // aggravated filter, and a handler-level lookup would find
            // the first mode's (§3).
            const statics: PermanentStatics = { ...(e.statics ?? {}) };
            if (e.burnToPrevent) statics.burnToPrevent = e.burnToPrevent;
            const bearer = ops.attachInCombat(play, e.to, statics, e.tags ?? []);
            // "…and send them to torpor" (Disarm). Ordering matters the
            // way Rewilding's did: the card has to be ON them first, or
            // `onLeaveReady` fires with nothing attached to see.
            if (bearer && e.torporTarget) ops.sendToTorpor(bearer);
            break;
          }
          case "combatBloodStore":
            ops.storeCombatBlood(play, Number(play.params["x"] ?? "0"));
            break;
          case "strikeStealBlood":
            ops.chooseCardStrike(play, { stealBlood: e.amount, ranged: true });
            if (e.riders?.maneuver) {
              for (let i = 0; i < e.riders.maneuver; i++) ops.grantManeuverCredit(play);
            }
            if (e.riders?.press) {
              for (let i = 0; i < e.riders.press; i++) ops.grantCombatPress(play);
            }
            break;
          case "additionalStrike": {
            let count = e.count;
            if (e.perBloodX) {
              const x = Number(play.params["x"] ?? "0");
              if (x > 0 && play.minion) {
                ops.emit({ type: "BloodBurned", minion: play.minion, amount: x });
              }
              count = x;
            }
            ops.grantAdditionalStrike(play, count, e.limited);
            // "…: burn weapon" — the extra strike is specified, offered
            // in the chooseStrike step the way a granted combat-ends
            // strike is (§4).
            if (e.burnEquipment) ops.grantBurnEquipmentStrike(play);
            // "…: dodge" — the extra strike is not a free choice at all.
            if (e.forcedDodge) ops.forceAdditionalStrike(play, "dodge");
            break;
          }
          case "setStrength":
            ops.setCombatStrength(play, e.value);
            break;
          case "addStrength":
            ops.addCombatStrength(play, e.amount);
            break;
          case "handSizeBonus":
            // "YOU get +1 hand size" — the card's player. They draw up
            // now and shed the excess when the combat ends (p. 7).
            ops.addHandSizeBonus({
              seat: play.seat,
              amount: e.amount,
              scope: "combat",
              cardName: spec.name,
              cardId: play.card.id,
            });
            break;
          case "restrictOpponent":
            ops.restrictCombatOpponent(play, {
              maneuver: e.maneuver ?? false,
              press: e.press ?? false,
              equipment: e.equipment ?? false,
            });
            break;
          case "handStrikesAggravated":
            ops.setHandStrikesAggravated(play);
            break;
          case "maneuver":
            ops.applyManeuver(play);
            break;
          case "grantCloseManeuver":
            if (e.bloodCost && play.minion) {
              ops.emit({ type: "BloodBurned", minion: play.minion, amount: e.bloodCost });
            }
            ops.grantCloseManeuver(play);
            break;
          case "press":
            ops.applyPressCard(play, play.params["press"] !== "cancel");
            break;
          case "startNewRound":
            if (e.bloodCost && play.minion) {
              ops.emit({ type: "BloodBurned", minion: play.minion, amount: e.bloodCost });
            }
            ops.startNewRound();
            break;
          case "handStrikesOnly":
            ops.restrictToHandStrikes();
            if (e.skipNextRange) ops.skipNextRangeStep();
            break;
          case "aimBonus":
            ops.addAimBonus(play, e.amount);
            break;
          case "preventAll":
            // "Prevent all damage from the opposing minion's strike" — the
            // op clamps to whatever is actually pending.
            ops.preventDamage(play, Number.MAX_SAFE_INTEGER);
            break;
          case "prevent": {
            const x = Number(play.params["x"] ?? "0");
            if (x > 0 && play.minion) {
              ops.emit({ type: "BloodBurned", minion: play.minion, amount: x });
            }
            ops.preventDamage(play, e.base + x);
            break;
          }
          case "preventForOther": {
            const victim = play.params["victim"];
            if (!victim) throw new Error(`${spec.name} played without a victim`);
            let amount = e.amount;
            if (e.perBlood) {
              const x = Number(play.params["x"] ?? "0");
              if (x > 0 && play.minion) {
                ops.emit({ type: "BloodBurned", minion: play.minion, amount: x });
              }
              amount = x + e.perBlood.plus;
            }
            if (e.all) {
              // "Prevent ALL damage from the opposing minion's strike" —
              // a number large enough that the op clamps to what is there.
              amount = Number.MAX_SAFE_INTEGER;
            }
            ops.preventDamageFor(victim, amount);
            break;
          }
          case "grantPress":
            if (e.combat) ops.grantCombatPress(play);
            else ops.grantPress(play);
            break;
          case "combatCredits": {
            // Credits to spend later in the round, granted from the
            // before-range window (Obedient Flesh superior).
            if (e.strength) ops.addRoundStrength(play, e.strength);
            for (let i = 0; i < (e.maneuver ?? 0); i++) ops.grantManeuverCredit(play);
            for (let i = 0; i < (e.press ?? 0); i++) ops.grantPress(play);
            if (e.prevent) ops.grantPreventCredit(play, e.prevent);
            break;
          }
          case "preventEachRound":
            ops.grantPreventEachRound(play, e.amount);
            break;
          case "roundDamage": {
            // Built field by field, never by spread: an optional field
            // spread in conditionally bypasses excess-property checking
            // and can be silently dropped (the Shadow Cast lesson).
            const rider: Omit<CombatRoundDamageRider, "from" | "startRound"> = {
              amount: e.amount,
              targets: e.targets,
              ranged: e.ranged,
              when: e.when,
            };
            if (e.retainers) rider.retainers = true;
            if (e.unpreventable) rider.unpreventable = true;
            if (e.escalate) rider.escalate = true;
            ops.addRoundDamage(play, rider);
            break;
          }
          case "autoPreventAfterFirst":
            ops.setAutoPreventAfterFirst(play, e.aggravated);
            break;
          case "frenzyShield":
            ops.shieldFromFrenzy(play);
            break;
          default:
            break;
        }
      }
    },
  };
  if (spec.combatLimit) handler.combatLimit = spec.combatLimit;
  if (spec.delayedReplace) handler.delayedReplace = spec.delayedReplace;
  return handler;
}

// ---------------------------------------------------------------------------
// Action modifiers and reactions
// ---------------------------------------------------------------------------

function effectsLegal(
  effects: EffectPrimitive[],
  ctx: PlayContext,
  af: ActionFrame,
  minion: MinionState,
): boolean {
  for (const e of effects) {
    switch (e.kind) {
      case "modifyBleed":
        if (af.actionKind !== "bleed") return false;
        // "+X bleed (limited)" is always an increase, whatever X turns out
        // to be, so a variable bonus is gated the same way a fixed one is.
        if (
          e.limited &&
          (e.amount > 0 || e.xRange !== undefined) &&
          hasLimitedBleedIncrease(ctx.state, af)
        ) {
          return false;
        }
        break;
      case "modifyStealth": {
        // Stealth only "when needed": an ongoing block attempt whose
        // blocker currently has enough intercept (p. 26).
        const ba = ctx.blockAttempt;
        if (!ba) return false;
        if (
          currentIntercept(ctx.state, af.actionId, ba.blocker) <
          currentStealth(ctx.state, af.actionId)
        ) {
          return false;
        }
        break;
      }
      case "modifyIntercept": {
        // Intercept only "when needed", and only by the blocking minion
        // itself (p. 26).
        const ba = ctx.blockAttempt;
        if (!ba || ba.blocker !== minion.id) return false;
        if (
          currentStealth(ctx.state, af.actionId) <=
          currentIntercept(ctx.state, af.actionId, minion.id)
        ) {
          return false;
        }
        break;
      }
      case "wake":
        if (!minion.locked) return false;
        break;
      case "unlockAndAttemptBlock": {
        // Only while blocks may still be declared (state A, no attempt in
        // progress). Whether the vampire must be locked is governed by the
        // mode's `byLockedMinion` (Sense the Savage Way) vs an unlocked
        // reactor (Eagle's Sight). Normal block eligibility applies unless
        // the card ignores it (Eagle's Sight); intercept need not be "yet
        // needed" — the card creates the attempt.
        if (af.step !== "A" || ctx.blockAttempt) return false;
        // "During this action, minions cannot unlock" (The Sleeping Mind)
        // takes the whole unlock-and-block cluster off the table.
        if (af.noUnlock) return false;
        if (!e.ignoreRestrictions && !blockEligibleSeats(ctx.state, af).includes(ctx.seat)) {
          return false;
        }
        break;
      }
      case "unlockMinion":
        // "Unlock this vampire" so it can then block — blocks still
        // declarable (locked-ness comes from the mode's byLockedMinion).
        if (af.step !== "A" || ctx.blockAttempt) return false;
        // "During this action, minions cannot unlock" (The Sleeping Mind).
        if (af.noUnlock) return false;
        // "…burns 1 blood to unlock" (Deep Ecology): a minion that
        // cannot pay is not offered the card (p. 9).
        if (e.bloodCost !== undefined && minion.blood < e.bloodCost) return false;
        break;
      case "blockCost":
      case "modifyAllIntercept":
      case "modifyFilteredIntercept":
        // Both push the block barrier up, so they are only worth playing
        // while blocks can still be declared or attempted.
        if (af.step !== "A" && af.step !== "B") return false;
        break;
      case "corruptFailBlock": {
        // Only during a block attempt whose blocker carries the acting
        // seat's corruption.
        const ba = ctx.blockAttempt;
        if (!ba) return false;
        const blocker = getMinion(ctx.state, ba.blocker);
        if ((blocker.corruption?.[af.actingSeat] ?? 0) < 1) return false;
        break;
      }
      case "failBlockAttempt": {
        // "Only usable if a minion attempts to block" — and the extra
        // blood the mode charges has to be there (p. 9).
        const ba = ctx.blockAttempt;
        if (!ba) return false;
        if (e.bloodCost !== undefined && minion.blood < e.bloodCost) return false;
        break;
      }
      case "endAction": {
        // "Only usable if this minion is blocked, BEFORE BLOCK
        // RESOLUTION" — so there must be an attempt still open. Delaying
        // Tactics ends a referendum instead and has no attempt.
        if (!ctx.blockAttempt) return false;
        break;
      }
      case "lockFailedBlockers":
        // Nothing to lock unless an action is underway.
        if (!ctx.action) return false;
        break;
      case "interposeOnBlocker": {
        // "…if a minion attempts to block" (Hedonism), and the vampire
        // stepping in must not be the blocker it is stepping in front of.
        const ba = ctx.blockAttempt;
        if (!ba) return false;
        if (ba.blocker === minion.id) return false;
        break;
      }
      case "modifyBlockerIntercept": {
        // Pushing the blocker down is only legal while there is a blocker,
        // and only while the block would otherwise succeed — the mirror of
        // the p. 26 "only when needed" rule the blocker plays under.
        const ba = ctx.blockAttempt;
        if (!ba) return false;
        if (
          currentIntercept(ctx.state, af.actionId, ba.blocker) <
          currentStealth(ctx.state, af.actionId)
        ) {
          return false;
        }
        break;
      }
      case "redirectBleed": {
        if (af.actionKind !== "bleed") return false;
        // The target cannot be changed during a block attempt (p. 27 B.2).
        if (ctx.blockAttempt) return false;
        // "Only usable if a YOUNGER vampire is bleeding you"
        // (Redirection basic) — capacity on both sides, so a granted
        // point counts (docs/bleed-answers-design.md §2).
        if (e.youngerOnly) {
          const actor = findMinion(ctx.state, af.acting);
          if (!actor || capacityOf(actor) >= capacityOf(minion)) return false;
        }
        break;
      }
      case "setBleedZero":
        if (af.actionKind !== "bleed") return false;
        // Nothing to reduce.
        if (currentBleed(ctx.state, af) <= 0) return false;
        break;
      default:
        break;
    }
  }
  return true;
}

function compileModifierOrReaction(spec: CardSpec): CardHandler {
  // p. 7 allows wakes in another card's as-played window. Waking somebody
  // ELSE is still a wake, so Shadow Sentinel's superior belongs there too.
  const hasWake = spec.modes.some((m) =>
    m.effects.some((e) => e.kind === "wake" || e.kind === "wakeOther"),
  );

  const handler: CardHandler = {
    name: spec.name,
    bloodCost: spec.bloodCost,
    // As in compileActionCard: enumeration reads the spec, payment reads
    // the handler, and the two must not disagree.
    poolCost: spec.poolCost ?? 0,

    options(card, ctx) {
      // "After block resolution: unlock the vampire that blocked" (Cats'
      // Guidance, Forced Vigilance) — offered in the first window of the
      // combat that a successful block produced, to the locked blocker.
      if (ctx.window === "combat.beforeRange") {
        const cf = ctx.combat;
        const abrMode = spec.modes.find((mo) => mo.usable?.includes("afterBlockResolution"));
        if (!cf || !cf.fromBlock || !abrMode || ctx.seat !== cf.opposingSeat) return [];
        const m = getMinion(ctx.state, cf.opposing);
        if (!m.locked || !canPlayMode(m, abrMode, spec)) return [];
        if (m.blood < costOf(spec, ctx, m, abrMode).blood) return [];
        return [makeOption(spec, card, m, abrMode, {})];
      }
      // Vote-granting cards live in the polling step (p. 28).
      if (ctx.window === "referendum.polling") {
        const ref = ctx.referendum;
        if (!ref) return [];
        // "Non-<sect> vampires cannot cast votes" — a caller-only modifier,
        // playable once, before votes are cast (p. 28).
        const restrictMode = spec.modes.find((m) =>
          m.effects.some((e) => e.kind === "restrictVotes"),
        );
        if (restrictMode) {
          if (ctx.seat !== ref.caller || ref.voteRestriction) return [];
          if (ref.votes.length > 0) return []; // "before votes are cast"
          const cm = ref.callingMinion ? findMinion(ctx.state, ref.callingMinion) : null;
          if (!cm) return [];
          // "Requires a prince/justicar/…": the controller must hold a ready
          // vampire with one of these titles.
          if (!controllerMeetsRequirements(ctx.state, ctx.seat, spec)) return [];
          return [makeOption(spec, card, cm, restrictMode, {})];
        }
        // Everything else that happens during polling: vote grants, and
        // the referendum-interference family (docs/abstain-gate-design.md).
        // `restrictVotes` is excluded — it was handled by its own branch
        // just above and returned early.
        const voteModes = spec.modes.filter((mode) =>
          mode.effects.some(
            (e) => POLLING_ONLY_EFFECTS.has(e.kind) && e.kind !== "restrictVotes",
          ),
        );
        if (voteModes.length === 0) return [];
        const isCaller = ctx.seat === ref.caller;
        const asModifier =
          spec.cardType === "actionModifier" || spec.cardType === "modifierOrReaction";
        const asReaction =
          spec.cardType === "reaction" || spec.cardType === "modifierOrReaction";
        // Action modifiers: the calling vampire. Reactions: another
        // Methuselah's ready unlocked vampires (p. 28).
        let candidates: MinionState[] = [];
        if (isCaller && asModifier && ref.callingMinion) {
          const caller = findMinion(ctx.state, ref.callingMinion);
          if (caller) candidates = [caller];
        } else if (!isCaller && asReaction) {
          candidates = getSeat(ctx.state, ctx.seat).minions.filter(
            (m) => canReact(m) && m.kind === "vampire",
          );
        }
        const voteOptions: LegalOption[] = [];
        for (const m of candidates) {
          if (!meetsRequirements(m, spec)) continue;
          for (const mode of voteModes) {
            if (!canPlayMode(m, mode, spec)) continue;
            if (m.blood < costOf(spec, ctx, m, mode).blood) continue;
            const abstain = mode.effects.find((e) => e.kind === "forceAbstain") as
              | Extract<EffectPrimitive, { kind: "forceAbstain" }>
              | undefined;
            if (abstain) {
              // "Choose a vampire …" — one option per legal target. Scalpel
              // Tongue restricts it to a vampire who HAS CAST votes or
              // ballots; Telepathic Vote Counting says only "a vampire".
              for (const s of ctx.state.seats) {
                for (const t of s.minions) {
                  if (t.kind !== "vampire" || !isReady(t)) continue;
                  if (ref.abstaining?.includes(t.id)) continue;
                  if (abstain.onlyIfVoted && !ref.votes.some((v) => v.source === t.id)) {
                    continue;
                  }
                  // A vampire with no vote source and no cast vote has
                  // nothing to abstain from.
                  if (
                    !abstain.onlyIfVoted &&
                    t.title === null &&
                    !ref.votes.some((v) => v.source === t.id)
                  ) {
                    continue;
                  }
                  voteOptions.push(makeOption(spec, card, m, mode, { target: t.id }));
                }
              }
              continue;
            }
            voteOptions.push(makeOption(spec, card, m, mode, {}));
          }
        }
        return voteOptions;
      }
      // "Only usable after resolution of a political action whose
      // referendum passed" — its own window, and the ACTION frame is long
      // gone by then (a political action pops before its referendum is
      // pushed), so this is handled before the `ctx.action` gate below.
      // docs/referendum-margin-design.md §2
      const wantsRef = (r: UsabilityRule): boolean =>
        spec.usable.includes(r) || spec.modes.some((mo) => mo.usable?.includes(r) ?? false);
      const afterRef = wantsRef("afterReferendumPassed");
      if (ctx.window === "referendum.afterResolution" || afterRef) {
        if (!afterRef || ctx.window !== "referendum.afterResolution") return [];
        const rf = ctx.referendum;
        if (!rf || rf.step !== "afterResolution" || rf.passed !== true) return [];
        // An action modifier is played by the acting minion — here, the
        // vampire that called the referendum.
        if (ctx.seat !== rf.caller || rf.callingMinion === null) return [];
        const caller = findMinion(ctx.state, rf.callingMinion);
        if (!caller) return [];
        const out: LegalOption[] = [];
        for (const mode of spec.modes) {
          if (!mode.usable?.includes("afterReferendumPassed")) continue;
          if (!canPlayMode(caller, mode, spec)) continue;
          if (!meetsRequirements(caller, spec)) continue;
          if (caller.blood < costOf(spec, ctx, caller, mode).blood) continue;
          out.push(...referendumPayoutOptions(spec, card, caller, mode, rf, ctx));
        }
        return out;
      }
      const af = ctx.action;
      if (!af) return [];
      // Modifiers and reactions live in the action's effect windows; wake
      // effects are additionally legal inside the as-played window (p. 44).
      // "Only usable after action resolution" (Freak Drive) lives in its
      // own window and NOWHERE else, so a card that wants it is excluded
      // from the ordinary effect windows and vice versa.
      const wantsAfter = (r: UsabilityRule): boolean =>
        spec.usable.includes(r) || spec.modes.some((mo) => mo.usable?.includes(r) ?? false);
      const afterOnly = wantsAfter("afterResolutionByActor");
      if (ctx.window === "action.afterResolution") {
        if (!afterOnly) return [];
      } else {
        const windowOk =
          ctx.window === "action.effects" ||
          (hasWake && ctx.window === "card.asPlayed");
        if (!windowOk) return [];
      }
      if (!rulesHold(spec.usable, ctx, af)) return [];

      // A dual-typed card can have a MODIFIER mode (played by the acting
      // minion) and a REACTION mode (played by anyone else). Candidates
      // are picked once, before the per-mode loop, so a `modifierOrReaction`
      // card used to be treated as a reaction outright and its modifier
      // half was unreachable — Form of the Bat is the first card with one.
      // Widen if any mode wants it and gate per mode below, the shape
      // `byLockedMinion` and `byOtherVampire` already use.
      // docs/blocker-riders-design.md §5
      const modeRole = (m: CardMode): "modifier" | "reaction" =>
        m.role ?? (spec.cardType === "actionModifier" ? "modifier" : "reaction");
      const actsAsModifier =
        spec.cardType === "actionModifier" ||
        spec.modes.some((m) => m.role === "modifier");
      const actsAsReaction =
        spec.cardType === "reaction" ||
        (spec.cardType === "modifierOrReaction" &&
          spec.modes.some((m) => modeRole(m) === "reaction"));

      let candidates: MinionState[];
      if (actsAsModifier && (!actsAsReaction || ctx.seat === af.actingSeat)) {
        // Only the acting minion plays modifiers; being locked is fine
        // (p. 26; Cloak ruling p. 48).
        if (ctx.seat !== af.actingSeat) return [];
        // Total, not `getMinion`: by the after-resolution window the actor
        // can have been burned (a blocked action's combat killed them), and
        // it can be in TORPOR and still play Freak Drive (p. 48) — which is
        // why nothing here filters on `isReady`.
        const actor = findMinion(ctx.state, af.acting);
        if (!actor) return [];
        candidates = [actor];
        // Exception (p. 12): "some action modifier cards are played by
        // minions OTHER THAN the acting minion. Only minions controlled by
        // the same Methuselah can play those cards." Widen the candidate
        // list if any mode wants it and gate per mode below — the same
        // shape `byLockedMinion` uses for a reaction that mixes modes.
        // docs/other-vampire-modifiers-design.md
        const wantsOther = (r: UsabilityRule): boolean =>
          spec.usable.includes(r) || spec.modes.some((mo) => mo.usable?.includes(r) ?? false);
        const anyReady = wantsOther("byOtherVampire");
        const anyUnlocked = wantsOther("byOtherUnlockedVampire");
        if (anyReady || anyUnlocked) {
          const others = getSeat(ctx.state, ctx.seat).minions.filter(
            (m) =>
              m.id !== af.acting &&
              m.kind === "vampire" && // all four cards say "vampire"
              isReady(m) &&
              (anyUnlocked && !anyReady ? !m.locked : true),
          );
          candidates = [...candidates, ...others];
        }
      } else {
        // Reactions: another Methuselah's ready minions, unlocked or
        // woken — or locked-only for wake cards (p. 12, p. 44). A card may
        // mix modes (Eyes of Argus: an unlocked-blocker intercept mode and
        // a locked-vampire wake mode), so include locked minions whenever
        // any mode is locked-only, and gate per mode below. "Only usable by
        // a … vampire" excludes allies.
        if (ctx.seat === af.actingSeat) return [];
        const anyModeLocked =
          spec.usable.includes("byLockedMinion") ||
          spec.modes.some((mode) => mode.usable?.includes("byLockedMinion"));
        candidates = getSeat(ctx.state, ctx.seat)
          .minions.filter((m) =>
            spec.usable.includes("byLockedMinion")
              ? isReady(m) && m.locked
              : canReact(m) || (anyModeLocked && isReady(m) && m.locked),
          )
          .filter(
            (m) => !spec.usable.includes("byVampire") || m.kind === "vampire",
          )
          // "The chosen minion cannot play reaction cards this action"
          // (Unleashing the Bestial Soul). It bars reaction CARDS only —
          // blocking is enumerated elsewhere and is untouched.
          .filter((m) => !af.noReactionsFrom.includes(m.id));
      }

      const options: LegalOption[] = [];
      for (const m of candidates) {
        // Affordability is checked PER MODE below, not here: a play-cost
        // modifier can key on the Disciplines the chosen mode requires
        // (Libertas), so one mode of a card can be affordable while
        // another is not (docs/play-cost-design.md §3).
        // "Requires an Anarch" / "…a Nosferatu" / "…a prince" — the playing
        // minion must qualify (docs/clan-sect-design.md §3). This was only
        // being checked in the polling branch above, so ten cards were
        // ignoring their requirement line entirely.
        if (!meetsRequirements(m, spec)) continue;
        // Same modifier/reaction card once per action per minion (p. 10).
        if (af.played.some((p) => p.minion === m.id && p.card === spec.name)) {
          continue;
        }
        // "A vampire can have only one Fever Pitch" — the attach half of
        // an after-resolution modifier obeys the same exclusivity a
        // permanent does (docs/after-resolution-design.md §5).
        const exKey = spec.permanent?.exclusiveKey;
        if (exKey !== undefined && m.attached.some((p) => p.tags.includes(exKey))) {
          continue;
        }
        if (
          spec.usable.includes("oncePerUnlockPhase") &&
          m.playedSinceUnlock.includes(spec.name)
        ) {
          continue;
        }
        // "Only one <card> can be played each action" — across EVERY
        // minion, unlike the p. 10 limit just above, which is per minion.
        if (
          spec.usable.includes("oncePerAction") &&
          af.played.some((p) => p.card === spec.name)
        ) {
          continue;
        }
        for (const mode of spec.modes) {
          // Polling-only modes belong to the branch above; offered here
          // they would resolve with no referendum to touch. This list has
          // now been the source of the same bug three times (modifyVotes,
          // then restrictVotes, then the abstain family), so it lives in
          // ONE place — see POLLING_ONLY_EFFECTS.
          if (mode.effects.some((e) => POLLING_ONLY_EFFECTS.has(e.kind))) {
            continue;
          }
          if (!canPlayMode(m, mode, spec)) continue;
          // A dual-typed card's halves go to different minions: a MODIFIER
          // mode only to the acting minion, a REACTION mode only to
          // somebody else (design §5).
          if (spec.cardType === "modifierOrReaction") {
            const wantsActor = modeRole(mode) === "modifier";
            if (wantsActor !== (ctx.seat === af.actingSeat)) continue;
          }
          if (m.blood < costOf(spec, ctx, m, mode).blood) continue;
          // Per-mode "other than the acting minion" gate: such a mode goes
          // ONLY to a non-acting vampire, and a mode without it goes ONLY
          // to the acting minion. Cloak the Gathering carries the rule on
          // its superior mode alone, so one card offers both shapes at
          // once — hence the gate is per mode, not per card.
          if (spec.cardType === "actionModifier") {
            const readyOther =
              spec.usable.includes("byOtherVampire") ||
              (mode.usable?.includes("byOtherVampire") ?? false);
            const unlockedOther =
              spec.usable.includes("byOtherUnlockedVampire") ||
              (mode.usable?.includes("byOtherUnlockedVampire") ?? false);
            if (readyOther || unlockedOther) {
              if (m.id === af.acting) continue;
              if (unlockedOther && m.locked) continue;
            } else if (m.id !== af.acting) {
              continue;
            }
          }
          // Per-mode lock gate (Eyes of Argus): a locked-only mode is for
          // locked minions, a normal mode for those who can react.
          //
          // Keyed on the MODE's role, not the card's type: playing an
          // action modifier does not require being unlocked (p. 26, the
          // Cloak ruling p. 48), and the acting minion is always locked —
          // so applying the reaction gate to a dual-typed card's modifier
          // half ruled it out every time.
          if (modeRole(mode) !== "modifier") {
            const modeLocked =
              spec.usable.includes("byLockedMinion") ||
              (mode.usable?.includes("byLockedMinion") ?? false);
            if (modeLocked && !(isReady(m) && m.locked)) continue;
            if (!modeLocked && !canReact(m)) continue;
          }
          // "Only one <card> can be played at superior each turn" — per
          // seat, per turn, and only the superior mode is limited.
          if (
            (spec.usable.includes("oncePerTurnAtSuperior") ||
              (mode.usable?.includes("oncePerTurnAtSuperior") ?? false)) &&
            mode.level === "superior" &&
            (getSeat(ctx.state, ctx.seat).superiorPlaysThisTurn ?? []).includes(spec.name)
          ) {
            continue;
          }
          if (!rulesHold(mode.usable, ctx, af)) continue;
          // "even if stealth is not yet needed" (Form of the Cobra) skips
          // the p. 26 only-when-needed gate for this mode.
          if (
            !mode.usable?.includes("evenIfNotNeeded") &&
            !effectsLegal(mode.effects, ctx, af, m)
          ) {
            continue;
          }
          if (mode.effects.some((e) => e.kind === "redirectBleed")) {
            // My Enemy's Enemy redirects to a computed seat (no choice);
            // Deflection lets the reactor pick any other Methuselah.
            const toComputed = mode.effects.some(
              (e) => e.kind === "redirectBleed" && e.toPredatorsPredator,
            );
            if (toComputed) {
              options.push(makeOption(spec, card, m, mode, {}));
            } else {
              for (const seat of ctx.state.seats) {
                if (seat.ousted) continue;
                if (seat.id === ctx.seat || seat.id === af.actingSeat) continue;
                options.push(makeOption(spec, card, m, mode, { target: seat.id }));
              }
            }
          } else if (
            mode.effects.some(
              (e) => e.kind === "blockRestriction" && e.who === "chosen",
            )
          ) {
            // "Choose a (younger) vampire; it cannot block this action."
            const eff = mode.effects.find(
              (e) => e.kind === "blockRestriction",
            ) as Extract<EffectPrimitive, { kind: "blockRestriction" }>;
            for (const seat of ctx.state.seats) {
              if (seat.ousted) continue;
              for (const mm of seat.minions) {
                if (mm.kind !== "vampire" || mm.id === m.id) continue;
                if (eff.chosenScope === "younger" && capacityOf(mm) >= capacityOf(m)) {
                  continue;
                }
                // "Choose a locked vampire" (The Sleeping Mind) — the
                // clause only bites on someone who would have to unlock
                // (or wake) to block in the first place.
                if (eff.chosenScope === "locked" && !mm.locked) continue;
                options.push(makeOption(spec, card, m, mode, { target: mm.id }));
              }
            }
          } else if (mode.effects.some((e) => e.kind === "wakeOther")) {
            // "Choose a LOCKED wraith or zombie ally you control. The
            // chosen ally wakes." A woken ally is not unlocked (p. 44), so
            // the target must be locked for the card to do anything.
            for (const mm of getSeat(ctx.state, ctx.seat).minions) {
              if (!mm.locked || !isUndeadAlly(mm)) continue;
              options.push(makeOption(spec, card, m, mode, { target: mm.id }));
            }
          } else if (mode.effects.some((e) => e.kind === "noReactionsFromChosen")) {
            // "Choose a minion" (Unleashing the Bestial Soul) — the same
            // shape as blockRestriction's chosen scope just above, but
            // unqualified: any minion of any Methuselah, including the
            // acting one's own stablemates.
            for (const seat of ctx.state.seats) {
              if (seat.ousted) continue;
              for (const mm of seat.minions) {
                options.push(makeOption(spec, card, m, mode, { target: mm.id }));
              }
            }
          } else if (mode.effects.some((e) => e.kind === "bankStealth")) {
            // "Burn X blood to give the next X actions +1 stealth" — X is
            // chosen now, so one option per affordable X, capped by the
            // spec so a full vampire does not flood the list. X = 0 is
            // offered too: the mode's other clause (+1 stealth on this
            // action) is worth playing on its own.
            const eff = mode.effects.find((e) => e.kind === "bankStealth") as Extract<
              EffectPrimitive,
              { kind: "bankStealth" }
            >;
            const most = Math.min(eff.max, m.blood);
            for (let x = 0; x <= most; x++) {
              options.push(makeOption(spec, card, m, mode, { x: String(x) }));
            }
          } else if (
            mode.effects.some((e) => e.kind === "modifyBleed" && e.xRange !== undefined)
          ) {
            // "+X bleed (limited). X must be 1, 2 or 3" (Monkey Wrench) —
            // X is chosen as the card is played, so one option per legal
            // value with the answer in the option id (§5).
            const eff = mode.effects.find(
              (e) => e.kind === "modifyBleed" && e.xRange !== undefined,
            ) as Extract<EffectPrimitive, { kind: "modifyBleed" }>;
            const r = eff.xRange!;
            for (let x = r.min; x <= r.max; x++) {
              options.push(makeOption(spec, card, m, mode, { x: String(x) }));
            }
          } else {
            options.push(makeOption(spec, card, m, mode, {}));
          }
        }
      }
      return options;
    },

    resolve(play, ops) {
      const mode = modeOf(spec, play.mode, play.params["variant"]);
      // Record the superior play before its effects run, so the limit
      // holds even if an effect below throws the impulse elsewhere.
      if (
        (spec.usable.includes("oncePerTurnAtSuperior") ||
          (mode.usable?.includes("oncePerTurnAtSuperior") ?? false)) &&
        play.mode === "superior"
      ) {
        ops.recordSuperiorPlay(play.seat, spec.name);
      }
      // Referendum interference — like the vote grant below, these resolve
      // during polling, where there is NO action frame (the referendum is
      // pushed after the action pops), so they cannot fall through to the
      // main effect switch. docs/abstain-gate-design.md
      if (
        mode.effects.some(
          (e) =>
            e.kind === "forceAbstain" ||
            e.kind === "cancelReferendum" ||
            e.kind === "burnPoolVotedAgainst",
        )
      ) {
        for (const e of mode.effects) {
          if (e.kind === "forceAbstain") {
            const target = play.params["target"];
            if (!target) throw new Error(`${spec.name} played without a target`);
            // Lock and blood burn BEFORE the abstention, so the log reads
            // in the order the card does.
            if (e.lockTarget) ops.emit({ type: "MinionLocked", minion: target });
            if (e.burnTargetBlood) {
              ops.emit({ type: "BloodBurned", minion: target, amount: e.burnTargetBlood });
            }
            ops.forceAbstain(target);
          } else if (e.kind === "cancelReferendum") {
            // The bar and the caller are read BEFORE the cancel, which
            // drops the frame they live on (Delaying Tactics).
            if (e.barRepeat) ops.barRepeatAction(e.barRepeat);
            const rf0 = ops.state.frames.find((f) => f.kind === "referendum");
            const caller = rf0?.kind === "referendum" ? rf0.callingMinion : null;
            ops.cancelReferendum();
            if (e.unlockCaller && caller) {
              ops.emit({ type: "MinionUnlocked", minion: caller });
            }
          } else if (e.kind === "burnPoolVotedAgainst") {
            ops.addPostTally({ kind: "burnPoolVotedAgainst", amount: e.amount });
          }
        }
        return;
      }
      // Polling-step vote grant — no action underway.
      if (mode.effects.some((e) => e.kind === "modifyVotes")) {
        for (const e of mode.effects) {
          if (e.kind === "modifyVotes") ops.grantVotes(play.seat, e.amount);
        }
        return;
      }
      // Polling-step "vampires who do not follow the Path of X get −1
      // vote" — a modifier on EVERY vampire, not a grant to the player.
      if (mode.effects.some((e) => e.kind === "modifyAllVotes")) {
        for (const e of mode.effects) {
          if (e.kind === "modifyAllVotes") {
            ops.modifyAllReferendumVotes(
              e.amount,
              e.exceptPath === undefined ? undefined : e.exceptPath,
            );
          }
        }
        return;
      }
      // Polling-step "non-<sect> vampires cannot cast votes" restriction.
      if (mode.effects.some((e) => e.kind === "restrictVotes")) {
        for (const e of mode.effects) {
          if (e.kind === "restrictVotes") ops.restrictReferendumVotes(e.sect);
        }
        return;
      }
      // The after-referendum payouts resolve with NO action frame at all —
      // a political action pops before its referendum is pushed
      // (docs/referendum-margin-design.md §2).
      if (mode.usable?.includes("afterReferendumPassed")) {
        for (const e of mode.effects) applyReferendumPayout(e, play, ops);
        return;
      }
      const af = ops.action();
      if (!af) throw new Error(`${spec.name} resolved outside an action`);
      for (const e of mode.effects) {
        switch (e.kind) {
          case "modifyBleed":
            ops.emit({
              type: "BleedAmountModified",
              actionId: af.actionId,
              delta:
                (e.xRange ? Number(play.params["x"] ?? "0") : e.amount) +
                conditionalExtra(e.bonus, play, af, ops),
              source: spec.name,
              limited: e.limited,
            });
            break;
          case "modifyStealth":
            ops.emit({
              type: "StealthModified",
              actionId: af.actionId,
              delta: e.amount,
              source: spec.name,
            });
            break;
          case "modifyIntercept": {
            if (!play.minion) throw new Error(`${spec.name}: no playing minion`);
            ops.emit({
              type: "InterceptModified",
              actionId: af.actionId,
              minion: play.minion,
              delta: e.amount + conditionalExtra(e.bonus, play, af, ops),
              source: spec.name,
            });
            break;
          }
          case "wake": {
            if (!play.minion) throw new Error(`${spec.name}: no playing minion`);
            ops.emit({ type: "MinionWoke", minion: play.minion });
            break;
          }
          case "wakeOther": {
            const target = play.params["target"];
            if (!target) throw new Error(`${spec.name}: no wake target`);
            ops.emit({ type: "MinionWoke", minion: target });
            break;
          }
          case "unlockAfterResolution": {
            if (!play.minion) throw new Error(`${spec.name}: no playing minion`);
            ops.addAfterResolutionUnlock({
              payer: play.minion,
              target: e.target === "self" ? play.minion : af.acting,
              blood: e.blood,
              ...(e.ifSuccessful ? { ifSuccessful: true } : {}),
              cardName: spec.name,
              cardId: play.card.id,
            });
            break;
          }
          case "blockerCombatRider": {
            if (!play.minion) throw new Error(`${spec.name}: no playing minion`);
            const riders: Parameters<EngineOps["grantBlockerCombatRider"]>[1] = {};
            if (e.maneuver) riders.maneuver = e.maneuver;
            if (e.press) riders.press = e.press;
            if (e.noStrikeFirstRound) riders.noStrikeFirstRound = true;
            if (e.prevent) riders.prevent = e.prevent;
            if (e.noEquipment) riders.noEquipment = true;
            if (e.unlockForBlood) riders.unlockForBlood = e.unlockForBlood;
            if (e.combatEndsStrike) riders.combatEndsStrike = true;
            ops.grantBlockerCombatRider(play.minion, riders);
            break;
          }
          case "unlockAndAttemptBlock": {
            if (!play.minion) throw new Error(`${spec.name}: no playing minion`);
            const opts: {
              interceptBonus?: number;
              bloodCost?: number;
              noBlockPenalty?: { kind: "lock" } | { kind: "attach"; cardId: string; cardName: string };
            } = {};
            if (e.interceptBonus) opts.interceptBonus = e.interceptBonus;
            if (e.bloodCost) opts.bloodCost = e.bloodCost;
            if (e.penaltyIfNoBlock === "lock") opts.noBlockPenalty = { kind: "lock" };
            else if (e.penaltyIfNoBlock === "attach") {
              opts.noBlockPenalty = { kind: "attach", cardId: play.card.id, cardName: spec.name };
            }
            ops.unlockAndAttemptBlock(play.minion, opts);
            break;
          }
          case "unlockMinion": {
            if (!play.minion) throw new Error(`${spec.name}: no playing minion`);
            // "This vampire burns 1 blood to unlock" (Deep Ecology).
            if (e.bloodCost) {
              ops.emit({ type: "BloodBurned", minion: play.minion, amount: e.bloodCost });
            }
            ops.unlockReactingMinion(play.minion);
            break;
          }
          case "setBleedZero": {
            // "…to 0. (The acting minion can still increase the bleed
            // amount.)" — `currentBleed` is a fold, so subtracting the
            // current total IS the reduction and later modifiers still
            // add on top (docs/bleed-answers-design.md §3).
            const bleed = currentBleed(ops.state, af);
            if (bleed > 0) {
              ops.emit({
                type: "BleedAmountModified",
                actionId: af.actionId,
                delta: -bleed,
                limited: false,
                source: spec.name,
              });
            }
            // "LOCK this vampire to reduce a bleed…" — the price, paid
            // whether or not there was anything left to reduce.
            if (e.lockSelf && play.minion) {
              ops.emit({ type: "MinionLocked", minion: play.minion });
            }
            break;
          }
          case "grantBurnForIntercept": {
            if (!play.minion) throw new Error(`${spec.name}: no playing minion`);
            ops.grantBurnForIntercept(play.minion);
            break;
          }
          case "attachToActorOnBlock": {
            if (!play.minion) throw new Error(`${spec.name}: no playing minion`);
            ops.attachToActorOnBlock(play.minion, play.card.id, spec.name, play.seat);
            break;
          }
          case "burnIfNotBlocking":
            ops.registerNotBlockPenalty(play, e.amount);
            break;
          case "redirectBleed": {
            // "…to your predator's predator" (My Enemy's Enemy) vs a chosen
            // Methuselah (Deflection).
            const to = e.toPredatorsPredator
              ? predatorOf(ops.state, predatorOf(ops.state, play.seat))
              : play.params["target"];
            if (!to) throw new Error(`${spec.name} played without a target`);
            ops.emit({
              type: "TargetChanged",
              actionId: af.actionId,
              from: play.seat,
              to,
            });
            if (e.lockSelf && play.minion) {
              // Locking the reacting vampire is a no-op if they were
              // already locked under a wake (ruling p. 48).
              ops.emit({ type: "MinionLocked", minion: play.minion });
            }
            break;
          }
          case "blockRestriction": {
            if (e.who === "chosen") {
              const to = play.params["target"];
              if (!to) throw new Error(`${spec.name} played without a target`);
              ops.restrictBlocking("chosen", to);
            } else {
              ops.restrictBlocking(e.who);
            }
            break;
          }
          case "playCostMod":
            ops.addPlayCostMod(e.mod);
            break;
          case "delayReplaceFor":
            ops.delayReplaceFor(e.cardTypes);
            break;
          case "noReactionsFromChosen": {
            const who = play.params["target"];
            if (!who) throw new Error(`${spec.name} played without a target`);
            ops.barReactionsFrom(who);
            break;
          }
          case "blockerCombatCostMod":
            if (play.minion) ops.grantBlockerCombatRider(play.minion, { playCostMod: e.mod });
            break;
          case "corruptFailBlock":
            ops.corruptFailBlock(play.seat);
            break;
          case "failBlockAttempt": {
            // "Burn 1 blood to have that attempt fail" (Stygian Shroud).
            if (e.bloodCost !== undefined && play.minion) {
              ops.emit({ type: "BloodBurned", minion: play.minion, amount: e.bloodCost });
            }
            ops.failBlockAttempt();
            break;
          }
          case "failAction":
            // "Instead, the bleed … is unsuccessful" (Spying Mission).
            // Runs after any attach clause on the same mode, which is why
            // the effect order in the spec matters: the attach reads
            // `af.target` and this does not touch it.
            ops.failAction();
            break;
          case "continueAsUnblocked":
            // "This vampire burns 1 blood to continue the action as if
            // unblocked" (Go-getter superior). The blood is the cost of
            // the effect and is paid here; the continuation itself happens
            // when the after-resolution window closes.
            if (e.bloodCost > 0 && play.minion) {
              ops.emit({ type: "BloodBurned", minion: play.minion, amount: e.bloodCost });
            }
            ops.continueActionAsUnblocked();
            break;
          case "endAction": {
            // The bar goes on FIRST, while the action frame is still
            // there to read its key from (docs/end-action-design.md §4).
            if (e.barRepeat) ops.barRepeatAction(e.barRepeat);
            ops.endAction({
              ...(e.unlockActor ? { unlockActor: true } : {}),
              ...(e.lockBlocker ? { lockBlocker: true } : {}),
            });
            break;
          }
          case "lockFailedBlockers":
            ops.lockFailedBlockers();
            break;
          case "setStealthZero": {
            // "Reduce the acting minion's stealth to 0. (The acting minion
            // can still increase their stealth.)" — `currentStealth` is a
            // fold over the log, so subtracting the current total IS the
            // reduction, and anything played afterwards still adds on top,
            // which is what the parenthetical asks for.
            // docs/blocker-riders-design.md §4
            const cur = currentStealth(ops.state, af.actionId);
            if (cur !== 0) {
              ops.emit({
                type: "StealthModified",
                actionId: af.actionId,
                delta: -cur,
                source: spec.name,
              });
            }
            break;
          }
          case "unlockActor": {
            // "Unlock this vampire" (Freak Drive) — in the after-resolution
            // window, where the actor may be in torpor (p. 48). Unlocking a
            // torpid vampire is legal and simply leaves them in torpor.
            const af2 = ops.action();
            const actor = af2 ? findMinion(ops.state, af2.acting) : null;
            if (actor?.locked) ops.emit({ type: "MinionUnlocked", minion: actor.id });
            break;
          }
          case "afterResolutionAttach": {
            const af3 = ops.action();
            if (!af3 || !play.minion) break;
            ops.putPermanentInPlay({
              card: play.card,
              seat: play.seat,
              attachTo: play.minion,
              statics: e.statics ?? {},
              tags: [spec.name, ...e.tags],
              // "…directed at the SAME Methuselah" (Shadow Cast): the seat
              // is fixed now, from the action that placed the card.
              ...(e.recordTarget && af3.target ? { againstSeat: af3.target } : {}),
            });
            break;
          }
          case "bankStealth": {
            const x = Number(play.params["x"] ?? "0");
            if (x > 0 && play.minion) {
              ops.emit({ type: "BloodBurned", minion: play.minion, amount: x });
              ops.grantStealthCharges(play.seat, x);
            }
            break;
          }
          case "interposeOnBlocker":
            // The blocker is read inside the op: resolve() has no
            // PlayContext, and the engine is where the block-attempt frame
            // lives anyway.
            if (play.minion) ops.interposeOnBlocker(play.minion, e.combat);
            break;
          case "modifyBlockerIntercept":
            ops.modifyBlockerIntercept(e.amount, spec.name);
            break;
          case "blockCost": {
            const cost: {
              amount: number;
              payWith: "blood" | "bloodOrLife";
              exemptDiscipline?: string;
            } = { amount: e.amount, payWith: e.payWith };
            if (e.exemptDiscipline) cost.exemptDiscipline = e.exemptDiscipline;
            ops.imposeBlockCost(cost, spec.name);
            break;
          }
          case "modifyAllIntercept":
            ops.modifyAllIntercept(e.amount, spec.name, e.appliesTo);
            break;
          case "modifyFilteredIntercept":
            // "Allies AND younger vampires" — a UNION of two sets, and
            // "younger" is relative to the ACTING minion
            // (docs/opposing-statics-design.md §1).
            ops.modifyFilteredIntercept(e.amount, spec.name, {
              ...(e.kinds ? { kinds: e.kinds } : {}),
              ...(e.younger ? { younger: true } : {}),
              ...(e.sects ? { sects: e.sects } : {}),
            });
            break;
          case "actorCombatRider": {
            const riders: {
              prevent?: number;
              strength?: number;
              maneuver?: number;
              press?: number;
              handStrikesAggravated?: boolean;
              combatAggravated?: boolean;
              noEquipment?: boolean;
            } = {};
            if (e.prevent) riders.prevent = e.prevent;
            if (e.strength) riders.strength = e.strength;
            if (e.maneuver) riders.maneuver = e.maneuver;
            if (e.press) riders.press = e.press;
            if (e.handStrikesAggravated) riders.handStrikesAggravated = true;
            if (e.noEquipment) riders.noEquipment = true;
            if (e.combatAggravated) riders.combatAggravated = true;
            ops.grantActorCombatRider(riders);
            break;
          }
          case "offerBlockerCancel":
            ops.offerBlockerCancel();
            break;
          case "preventUnlockDuringAction":
            ops.preventUnlockDuringAction();
            break;
          case "selfDamageAfterAction":
            if (!play.minion) throw new Error(`${spec.name}: no playing minion`);
            ops.damageAfterAction(play.minion, e.amount, e.aggravated);
            break;
          case "unlockViaCorruption":
            if (play.minion) ops.registerCorruptionUnlock(play.minion, play.seat);
            break;
          default:
            break;
        }
      }
    },
  };
  if (spec.delayedReplace) handler.delayedReplace = spec.delayedReplace;
  return handler;
}

// ---------------------------------------------------------------------------
// Master cards (one-shots; permanents arrive with the cards-in-play model)
// ---------------------------------------------------------------------------

/** Does this seat already control a copy of the named card in play? A
 *  Methuselah cannot voluntarily contest with themself (p. 17). */
export function seatControlsCopy(
  state: GameState,
  seatId: string,
  name: string,
): boolean {
  const seat = getSeat(state, seatId);
  return (
    seat.permanents.some((p) => p.card.name === name) ||
    seat.minions.some((m) => m.attached.some((p) => p.card.name === name))
  );
}

/** Ready minions a `permanent.attach` master may be put on
 *  (docs/granted-rush-design.md §5), from the playing seat's point of
 *  view. */
export function attachTargets(
  state: GameState,
  seatId: SeatId,
  spec: CardSpec,
): MinionState[] {
  const a = spec.permanent?.attach;
  if (!a) return [];
  const seats =
    a.scope === "own"
      ? [getSeat(state, seatId)]
      : a.scope === "prey"
        ? [getSeat(state, preyOf(state, seatId))]
        : state.seats.filter((s) => !s.ousted);
  const out: MinionState[] = [];
  for (const s of seats) {
    if (s.ousted) continue;
    for (const m of s.minions) {
      if (!isReady(m)) continue;
      if (a.kind !== undefined && m.kind !== a.kind) continue;
      if (a.clan !== undefined && m.clan !== a.clan) continue;
      if (a.sect !== undefined && m.sect !== a.sect) continue;
      // "…on a ready vampire who follows the Path of <x>" (Terrifying
      // Visage) — a printed crypt trait, like the two filters above it.
      if (a.path !== undefined && m.path !== a.path) continue;
      if (a.minCapacity !== undefined && capacityOf(m) < a.minCapacity) continue;
      // "Cannot be put on a vampire with superior Celerity [CEL]" — the
      // Discipline master cards, which raise a level and so have nothing
      // left to give once the vampire is already at superior.
      if (
        a.notSuperiorDiscipline !== undefined &&
        disciplinesOf(m)[a.notSuperiorDiscipline] === "superior"
      ) {
        continue;
      }
      // "A vampire can have only one archetype."
      const key = spec.permanent?.exclusiveKey;
      if (key !== undefined && m.attached.some((p) => p.tags.includes(key))) continue;
      out.push(m);
    }
  }
  return out;
}

function compileMasterCard(spec: CardSpec): CardHandler {
  const handler: CardHandler = {
    name: spec.name,
    bloodCost: 0,
    poolCost: spec.poolCost ?? 0,
    isMasterCard: true,
    isTrifle: spec.trifle === true,

    options(card, ctx) {
      // The engine only surfaces this window while a master phase action
      // remains; requirements beyond cost are card-specific.
      if (ctx.window !== "turn.master") return [];
      const seat = getSeat(ctx.state, ctx.seat);
      // A master's cost can be raised by a card in play (Villein's own
      // "+1 pool to play on this vampire"), so read the live cost.
      const masterMode =
        spec.modes[0] ?? { level: "basic" as const, discipline: null, effects: [] };
      if (seat.pool <= costOf(spec, ctx, null, masterMode).pool) return []; // never oust yourself
      if (spec.unique && seatControlsCopy(ctx.state, ctx.seat, spec.name)) {
        return [];
      }
      // "Requires a ready Anarch" / "…a ready Sabbat vampire" — a
      // condition on the METHUSELAH, not on any acting minion: you must
      // control a ready vampire of that sect/clan to play the card
      // (docs/lock-grant-locations-design.md §6).
      if (!controllerMeetsRequirements(ctx.state, ctx.seat, spec)) return [];
      const options: LegalOption[] = [];
      // "Lock a ready unlocked Anarch you control. That Anarch recruits or
      // employs an ally or retainer from your hand" (Piper) — the chosen
      // Anarch and the chosen card both ride in the option id
      // (docs/play-from-hand-design.md §5).
      const fromHand = masterMode.effects.find((e) => e.kind === "playFromHand");
      if (fromHand?.kind === "playFromHand") {
        for (const c of playFromHandChoices(ctx, fromHand, null)) {
          options.push(makeMasterOption(spec, card, c.params, c.label));
        }
        return options;
      }
      if (spec.permanent?.attachClan) {
        // "Put this card on a [clan] you control" (Sight Beyond Sight).
        for (const m of seat.minions) {
          if (m.kind === "vampire" && m.clan === spec.permanent.attachClan) {
            options.push(makeMasterOption(spec, card, { target: m.id }, `on ${m.name}`));
          }
        }
        return options;
      }
      if (spec.permanent?.attachAnyMinion) {
        // "Put this card on a ready minion" — anyone's (Pentex™
        // Subversion); the card stays controlled by its player (p. 16).
        for (const s of ctx.state.seats) {
          if (s.ousted) continue;
          for (const m of s.minions) {
            if (!isReady(m)) continue;
            options.push(
              makeMasterOption(spec, card, { target: m.id }, `on ${m.name} (${s.id})`),
            );
          }
        }
        return options;
      }
      if (spec.permanent?.attach) {
        // The general "put this card on <a minion>" targeting
        // (docs/granted-rush-design.md §5).
        for (const m of attachTargets(ctx.state, ctx.seat, spec)) {
          // Priced PER TARGET: a card in play can raise the cost of
          // cards aimed at the minion it sits on (Secure Haven), and
          // Villein raises its own price on a vampire already carrying
          // one (design §2).
          const cost = costOf(spec, ctx, null, masterMode, m.id);
          if (seat.pool <= cost.pool) continue;
          const move = spec.permanent.bloodToPool;
          if (move) {
            // "Move 2 to 5 blood from that vampire to your pool"
            // (Villein) — the amount is chosen as the card is played, so
            // one option per legal amount, capped by what they have (§4).
            const most = Math.min(move.max, m.blood);
            for (let x = move.min; x <= most; x++) {
              options.push(
                makeMasterOption(
                  spec,
                  card,
                  { target: m.id, x: String(x) },
                  `on ${m.name} — move ${x} blood to your pool`,
                ),
              );
            }
            continue;
          }
          options.push(
            makeMasterOption(
              spec,
              card,
              { target: m.id },
              `on ${m.name} (${m.controller})`,
            ),
          );
        }
        return options;
      }
      if (spec.permanent) {
        options.push(makeMasterOption(spec, card, {}, "put in play"));
        return options;
      }
      const mode = spec.modes[0];
      if (!mode) return [];
      for (const e of mode.effects) {
        switch (e.kind) {
          case "lockMinion":
            for (const s of ctx.state.seats) {
              if (s.ousted) continue;
              for (const m of s.minions) {
                if (isReady(m) && !m.locked) {
                  options.push(makeMasterOption(spec, card, { target: m.id }, `Lock ${m.name}`));
                }
              }
            }
            return options;
          case "addBloodToReadyVampire":
            // "Add 1 blood to a ready vampire" — vampires only (allies
            // are not vampires, p. 11).
            for (const s of ctx.state.seats) {
              if (s.ousted) continue;
              for (const m of s.minions) {
                if (m.kind === "vampire" && isReady(m)) {
                  options.push(
                    makeMasterOption(spec, card, { target: m.id }, `Blood to ${m.name}`),
                  );
                }
              }
            }
            return options;
          case "bloodToUncontrolledKin":
            // "Move up to N blood from a ready vampire you control to a
            // YOUNGER vampire of the same clan in your uncontrolled
            // region" (Grooming the Protégé). One option per (donor,
            // recipient, amount) — the choice rides in the option id, so
            // the card needs no ChoiceFrame (§3).
            for (const donor of seat.minions) {
              if (donor.kind !== "vampire" || !isReady(donor) || donor.blood < 1) continue;
              for (const u of seat.uncontrolled) {
                if (u.card.clan === null || u.card.clan !== donor.clan) continue;
                // "Younger" compares the RECIPIENT to the DONOR (§3).
                if (capacityOf(u.card) >= capacityOf(donor)) continue;
                const most = Math.min(e.max, donor.blood);
                for (let x = 1; x <= most; x++) {
                  options.push(
                    makeMasterOption(
                      spec,
                      card,
                      { from: donor.id, target: u.card.id, x: String(x) },
                      `${x} blood: ${donor.name} → ${u.card.name}`,
                    ),
                  );
                }
              }
            }
            return options;
          case "addUncontrolledBlood":
            // "Add N blood to a [titled] [clan/sect] vampire in your
            // uncontrolled region" (Unholy Sacrament).
            for (const u of seat.uncontrolled) {
              if (e.clan !== undefined && u.card.clan !== e.clan) continue;
              if (e.sect !== undefined && u.card.sect !== e.sect) continue;
              if (e.titledOnly && u.card.title === null) continue;
              options.push(
                makeMasterOption(spec, card, { target: u.card.id }, `${e.amount} blood to ${u.card.name}`),
              );
            }
            return options;
          case "moveOwnVampireBloodToPool":
            for (const m of seat.minions) {
              if (m.kind !== "vampire") continue;
              for (let x = 1; x <= m.blood; x++) {
                options.push(
                  makeMasterOption(
                    spec,
                    card,
                    { target: m.id, x: String(x) },
                    `Move ${x} from ${m.name}`,
                  ),
                );
              }
            }
            return options;
          default:
            break;
        }
      }
      options.push(makeMasterOption(spec, card, {}, spec.name));
      return options;
    },

    resolve(play, ops) {
      // A master whose whole text is "that minion plays a card from your
      // hand" (Piper) puts no card of its own in play.
      const fromHand = (spec.modes[0]?.effects ?? []).find((e) => e.kind === "playFromHand");
      if (fromHand?.kind === "playFromHand") {
        applyPlayFromHand(ops, fromHand, play.seat, null, play.params);
        return;
      }
      if (spec.permanent) {
        const attaches =
          spec.permanent.attachClan ||
          spec.permanent.attachAnyMinion ||
          spec.permanent.attach !== undefined;
        const tags = [...(spec.permanent.tags ?? [])];
        // "A vampire can have only one archetype" — the exclusivity key
        // rides as a tag so the next copy can see it (§5).
        if (spec.permanent.exclusiveKey) tags.push(spec.permanent.exclusiveKey);
        if (spec.permanent.grantsTitle) tags.push("title");
        const args: Parameters<EngineOps["putPermanentInPlay"]>[0] = {
          card: play.card,
          seat: play.seat,
          // attachClan / attachAnyMinion / attach masters go on the
          // chosen minion.
          attachTo: attaches ? (play.params["target"] ?? null) : null,
          statics: spec.permanent.statics,
          tags,
        };
        if (spec.permanent.aura) args.aura = spec.permanent.aura;
        if (spec.permanent.auras) args.auras = spec.permanent.auras;
        if (spec.permanent.costSource) args.costSource = spec.permanent.costSource;
        // "A master card in play is controlled by the Methuselah who played
        // it, even if it is played on a card controlled by another
        // Methuselah" (p. 16).
        const foreign =
          spec.permanent.attach !== undefined && spec.permanent.attach.scope !== "own";
        if (spec.permanent.attachAnyMinion || foreign) {
          args.controller = play.seat;
        }
        ops.putPermanentInPlay(args);
        // "…to represent the unique Sabbat title of regent" (§7).
        const target = play.params["target"];
        if (spec.permanent.grantsTitle && target) {
          ops.emit({ type: "TitleGranted", minion: target, title: spec.permanent.grantsTitle });
        }
        // "Move N blood from that vampire to your pool" (Villein) — the
        // amount was chosen as the card was played.
        if (spec.permanent.bloodToPool && target) {
          const x = Number(play.params["x"] ?? "0");
          if (x > 0) {
            ops.emit({ type: "BloodBurned", minion: target, amount: x });
            ops.emit({ type: "PoolGained", seat: play.seat, amount: x });
          }
        }
        return;
      }
      const mode = spec.modes[0];
      if (!mode) return;
      for (const e of mode.effects) {
        switch (e.kind) {
          case "lockMinion": {
            const t = play.params["target"];
            if (!t) throw new Error(`${spec.name}: no target`);
            ops.emit({ type: "MinionLocked", minion: t });
            break;
          }
          case "addBloodToReadyVampire": {
            const t = play.params["target"];
            if (!t) throw new Error(`${spec.name}: no target`);
            ops.emit({ type: "BloodGained", minion: t, amount: e.amount });
            break;
          }
          case "addUncontrolledBlood": {
            const t = play.params["target"];
            if (!t) throw new Error(`${spec.name}: no uncontrolled target`);
            ops.emit({ type: "UncontrolledBloodAdded", seat: play.seat, minion: t, amount: e.amount });
            break;
          }
          case "bloodToUncontrolledKin": {
            const from = play.params["from"];
            const to = play.params["target"];
            const x = Number(play.params["x"] ?? "0");
            if (!from || !to || x <= 0) throw new Error(`${spec.name}: bad groom params`);
            // The blood MOVES: burnt from the donor, added to the
            // uncontrolled vampire's counters — which p. 35–36 says
            // "become its blood on taking control", so that pile is the
            // blood, not a separate one (§3).
            ops.emit({ type: "BloodBurned", minion: from, amount: x });
            ops.emit({ type: "UncontrolledBloodAdded", seat: play.seat, minion: to, amount: x });
            break;
          }
          case "moveOwnVampireBloodToPool": {
            const t = play.params["target"];
            const x = Number(play.params["x"] ?? "0");
            if (!t || x <= 0) throw new Error(`${spec.name}: bad move params`);
            ops.emit({ type: "BloodBurned", minion: t, amount: x });
            ops.emit({ type: "PoolGained", seat: play.seat, amount: x });
            break;
          }
          case "autoPassReferendum":
            ops.armAutoPassReferendum(play.seat);
            break;
          default:
            break;
        }
      }
    },
  };
  // Clan/sect-locked location: "Lock to give a [clan/sect] minion you
  // control +N stealth/intercept" (docs/clan-sect-design.md §4).
  const lg = spec.permanent?.lockGrant;
  if (lg) {
    const matches = (m: MinionState): boolean =>
      (lg.clan === undefined || m.clan === lg.clan) &&
      (lg.sect === undefined || m.sect === lg.sect) &&
      // "…each TITLED Camarilla vampire you control" (Elysium).
      (!lg.titled || m.title !== null) &&
      // "…with capacity 5 or more" (Kumpania) reads the DERIVED capacity:
      // a granted +1 capacity really does make a 4 into a 5.
      (lg.minCapacity === undefined || capacityOf(m) >= lg.minCapacity);
    handler.abilityOptions = (entry, owner, ctx) => {
      // Club Illusion is a standing permission, not a lock: being locked
      // (it never is) does not gate it (§2).
      if (entry.locked && !lg.noLock) return [];
      if (lg.grant === "votes") {
        // "Lock this location during the polling step … to get +N votes."
        if (ctx.window !== "referendum.polling" || ctx.seat !== owner.seat) return [];
        if (lg.perClanMinion) {
          // "Give each [clan] you control +N votes" (Power Structure).
          const n = getSeat(ctx.state, owner.seat).minions.filter(
            (m) => m.kind === "vampire" && isReady(m) && matches(m),
          ).length;
          if (n === 0) return [];
          return [
            {
              id: `ability:${spec.name}:${entry.card.id}:votes`,
              kind: "useAbility",
              label: `${spec.name}: lock for +${lg.amount * n} votes`,
              source: entry.card.id,
              params: { grant: "votes", n: String(n) },
            },
          ];
        }
        if (lg.perPoolX) {
          // Oxford: "lock and burn X pool → +2X votes".
          const pool = getSeat(ctx.state, owner.seat).pool;
          const opts: LegalOption[] = [];
          for (let x = 1; x <= pool; x++) {
            opts.push({
              id: `ability:${spec.name}:${entry.card.id}:votes:${x}`,
              kind: "useAbility",
              label: `${spec.name}: burn ${x} pool for +${lg.amount * x} votes`,
              source: entry.card.id,
              params: { grant: "votes", x: String(x) },
            });
          }
          return opts;
        }
        // "ONCE EACH TURN, you can burn 1 pool to get +3 votes"
        // (Ferraille): a fixed price, no lock, one use per turn.
        if (lg.oncePerTurn && entry.usedThisTurn) return [];
        if (lg.poolCost !== undefined && getSeat(ctx.state, owner.seat).pool < lg.poolCost) {
          return [];
        }
        return [
          {
            id: `ability:${spec.name}:${entry.card.id}:votes`,
            kind: "useAbility",
            label:
              lg.poolCost !== undefined
                ? `${spec.name}: burn ${lg.poolCost} pool for +${lg.amount} votes`
                : `${spec.name}: lock for +${lg.amount} votes`,
            source: entry.card.id,
            params: { grant: "votes" },
          },
        ];
      }
      if (lg.grant === "uncontrolledBlood") {
        // "Lock during your influence phase to add N blood to a [clan] in
        // your uncontrolled region" (Arcane Library etc.).
        if (ctx.window !== "turn.influence" || ctx.seat !== owner.seat) return [];
        const seat = getSeat(ctx.state, owner.seat);
        return seat.uncontrolled
          .filter((u) => lg.clan === undefined || u.card.clan === lg.clan)
          .map((u) => ({
            id: `ability:${spec.name}:${entry.card.id}:${u.card.id}`,
            kind: "useAbility" as const,
            label: `${spec.name}: add ${lg.amount} blood to ${u.card.name}`,
            source: entry.card.id,
            params: { grant: "uncontrolledBlood", target: u.card.id },
          }));
      }
      const af = ctx.action;
      if (!af) return [];
      // "…once as they announce" (Club Illusion): once per ACTION, across
      // every use of this card (§4).
      if (lg.oncePerAction && (af.usedInPlayAbilities ?? []).includes(entry.card.id)) {
        return [];
      }
      // "As <someone> ANNOUNCES an action" (Creepshow Casino, Warsaw
      // Station, Club Illusion) — read as state A with no attempt
      // underway, the same way `onlyAsAnnounced` is (§2).
      if (lg.atAnnouncement && (af.step !== "A" || ctx.blockAttempt)) return [];
      if (lg.grant === "stealth" || lg.grant === "bleed" || lg.grant === "unlockOnSuccess") {
        // Boosts the acting minion when it matches the clan/sect and (for
        // "you control" locations) belongs to the location's controller.
        // The acting minion can leave play mid-action (burned by a card
        // played in the same window) while the frame lives on.
        const actor = findMinion(ctx.state, af.acting);
        if (!actor) return [];
        if (ctx.seat !== owner.seat) return [];
        if (lg.ownOnly && actor.controller !== owner.seat) return [];
        if (!matches(actor)) return [];
        if (lg.undirectedOnly && af.directed) return [];
        // "+1 bleed during that action" is only meaningful on a bleed.
        if (lg.grant === "bleed" && af.actionKind !== "bleed") return [];
        // The recipient pays, and so must be able to (§2).
        if (lg.recipientCost && actor.blood < lg.recipientCost.blood) return [];
        if (lg.grant === "stealth") {
          // Stealth is offered "only when needed" (p. 26) unless the card
          // says otherwise in so many words (Creepshow Casino).
          if (!lg.evenIfNotNeeded && !stealthIsNeeded(ctx, af.actionId)) return [];
        }
        const verb = lg.noLock ? "use" : "lock";
        const cost = lg.recipientCost ? ` (${actor.name} burns ${lg.recipientCost.blood} blood)` : "";
        const what =
          lg.grant === "unlockOnSuccess"
            ? `unlock ${actor.name} if the action succeeds`
            : `give ${actor.name} +${lg.amount} ${lg.grant}`;
        return [
          {
            id: `ability:${spec.name}:${entry.card.id}:${lg.grant}`,
            kind: "useAbility",
            label: `${spec.name}: ${verb} to ${what}${cost}`,
            source: entry.card.id,
            params: { grant: lg.grant },
          },
        ];
      }
      // "Lock this card during an action to choose A VAMPIRE; the chosen
      // vampire can burn N blood to get +M intercept" (The Rumor Mill) —
      // any Methuselah's, one option each, and the RECIPIENT pays (§2).
      // It is offered during the action rather than only against a live
      // block attempt, so it comes before the blocker branch below.
      if (lg.anyVampire) {
        if (ctx.seat !== owner.seat) return [];
        const out: LegalOption[] = [];
        for (const s of ctx.state.seats) {
          if (s.ousted) continue;
          for (const m of s.minions) {
            if (m.kind !== "vampire" || !isReady(m)) continue;
            if (!matches(m)) continue;
            if (lg.recipientCost && m.blood < lg.recipientCost.blood) continue;
            out.push({
              id: `ability:${spec.name}:${entry.card.id}:intercept:${m.id}`,
              kind: "useAbility",
              label:
                `${spec.name}: lock — ${m.name} burns ` +
                `${lg.recipientCost?.blood ?? 0} blood for +${lg.amount} intercept`,
              source: entry.card.id,
              params: { grant: "intercept", blocker: m.id },
            });
          }
        }
        return out;
      }
      // grant "intercept": boosts a blocking minion when it matches, only
      // when intercept is needed (p. 26).
      const ba = ctx.blockAttempt;
      if (!ba || ctx.seat !== owner.seat) return [];
      // "During an undirected action" (Wall Street Night).
      if (lg.undirectedOnly && af.directed) return [];
      // "Not usable during the first action in a minion phase"
      // (Channel 10). The counter is incremented at announcement, so
      // during the first action it reads exactly 1.
      if (lg.notFirstMinionAction) {
        const tf = ctx.state.frames.find((f) => f.kind === "turn");
        const taken = tf && tf.kind === "turn" ? (tf.minionActionsThisPhase ?? 0) : 0;
        if (taken <= 1) return [];
      }
      const blocker = findMinion(ctx.state, ba.blocker);
      if (!blocker) return [];
      if (!matches(blocker)) return [];
      if (
        currentStealth(ctx.state, af.actionId) <=
        currentIntercept(ctx.state, af.actionId, ba.blocker)
      ) {
        return [];
      }
      // "…a minion you control" and, separately for KRCG News Radio,
      // "…and burn N pool to give a minion controlled by ANOTHER
      // Methuselah" — the same lock, told apart by whose blocker it is.
      // "Give a minion +N intercept" with no "you control" (WMRH Talk
      // Radio): the same single option whoever the blocker belongs to.
      const own = blocker.controller === owner.seat || !!lg.anyController;
      if (own) {
        return [
          {
            id: `ability:${spec.name}:${entry.card.id}:intercept`,
            kind: "useAbility",
            label: `${spec.name}: lock to give ${blocker.name} +${lg.amount} intercept`,
            source: entry.card.id,
            params: { grant: "intercept", blocker: ba.blocker },
          },
        ];
      }
      const other = lg.otherMethuselah;
      if (!other) return [];
      if (getSeat(ctx.state, owner.seat).pool <= other.poolCost) return [];
      return [
        {
          id: `ability:${spec.name}:${entry.card.id}:intercept:other`,
          kind: "useAbility",
          label:
            `${spec.name}: burn ${other.poolCost} pool to give ` +
            `${blocker.name} (${blocker.controller}) +${lg.amount} intercept`,
          source: entry.card.id,
          params: { grant: "intercept", blocker: ba.blocker, pay: String(other.poolCost) },
        },
      ];
    };
    handler.useAbility = (entry, owner, choice, ops) => {
      if (choice.params["grant"] === "votes") {
        // Ferraille pays in pool and never locks; everything else locks.
        if (!lg.noLock) ops.lockPermanent(entry.card.id);
        if (lg.oncePerTurn) entry.usedThisTurn = true;
        if (lg.poolCost !== undefined && lg.poolCost > 0) {
          ops.emit({ type: "PoolBurned", seat: owner.seat, amount: lg.poolCost });
        }
        if (lg.perClanMinion) {
          const n = Number(choice.params["n"] ?? "0");
          ops.grantVotes(owner.seat, lg.amount * n);
          return;
        }
        const x = lg.perPoolX ? Number(choice.params["x"] ?? "1") : 1;
        if (lg.perPoolX && x > 0) {
          ops.emit({ type: "PoolBurned", seat: owner.seat, amount: x });
        }
        ops.grantVotes(owner.seat, lg.amount * x);
        return;
      }
      if (choice.params["grant"] === "uncontrolledBlood") {
        const target = choice.params["target"];
        if (!target) throw new Error(`${spec.name}: no uncontrolled target`);
        ops.lockPermanent(entry.card.id);
        ops.emit({
          type: "UncontrolledBloodAdded",
          seat: owner.seat,
          minion: target,
          amount: lg.amount,
        });
        return;
      }
      const af = ops.action();
      if (!af) throw new Error(`${spec.name}: no action`);
      // Club Illusion is a standing permission and never locks (§2); it
      // is limited per action instead.
      if (lg.noLock) ops.markInPlayAbilityUsed(entry.card.id);
      else ops.lockPermanent(entry.card.id);
      if (lg.oncePerAction && !lg.noLock) ops.markInPlayAbilityUsed(entry.card.id);
      const grant = choice.params["grant"];
      if (grant === "stealth") {
        // "The chosen vampire CAN BURN N blood": the recipient pays, and
        // pays whether or not the bonus ends up mattering.
        if (lg.recipientCost) {
          ops.emit({ type: "BloodBurned", minion: af.acting, amount: lg.recipientCost.blood });
        }
        ops.emit({
          type: "StealthModified",
          actionId: af.actionId,
          delta: lg.amount,
          source: spec.name,
        });
      } else if (grant === "bleed") {
        if (lg.recipientCost) {
          ops.emit({ type: "BloodBurned", minion: af.acting, amount: lg.recipientCost.blood });
        }
        ops.emit({
          type: "BleedAmountModified",
          actionId: af.actionId,
          delta: lg.amount,
          source: spec.name,
          // Club Illusion does not print "(limited)", and the p. 20 rule
          // is about action MODIFIER cards; this is an ability of a card
          // in play. So it does not consume the limited allowance.
          limited: false,
        });
      } else if (grant === "unlockOnSuccess") {
        ops.registerUnlockOnSuccess(af.acting);
      } else {
        const blocker = choice.params["blocker"];
        if (!blocker) throw new Error(`${spec.name}: no blocker`);
        // The pool for helping another Methuselah's blocker (KRCG News
        // Radio) is burned with the lock, not on a successful block.
        const pay = Number(choice.params["pay"] ?? "0");
        if (pay > 0) ops.emit({ type: "PoolBurned", seat: owner.seat, amount: pay });
        // The Rumor Mill's recipient pays their own blood for it.
        if (lg.recipientCost) {
          ops.emit({ type: "BloodBurned", minion: blocker, amount: lg.recipientCost.blood });
        }
        ops.emit({
          type: "InterceptModified",
          actionId: af.actionId,
          minion: blocker,
          delta: lg.amount,
          source: spec.name,
        });
        // "If that minion does not block the action, burn N pool after
        // action resolution" (WMRH Talk Radio) — a deferred bill on this
        // card's controller (§3).
        if (lg.notBlockPoolPenalty) {
          ops.registerNotBlockPoolPenalty(blocker, lg.notBlockPoolPenalty, owner.seat);
        }
      }
    };
  }

  // Hunting ground: "during your unlock phase, a ready vampire you control
  // can gain N blood; a vampire uses only one hunting ground per turn"
  // (p. 21). Once per turn per location (entry.usedThisPhase, reset each
  // unlock), once per turn per vampire (usedHuntingGroundThisTurn).
  const hg = spec.permanent?.huntingGround;
  if (hg) {
    /** How many grants this location may make this phase: one, or two
     *  while "if you control a ready baron" holds (Carfax Abbey). */
    const allowance = (state: GameState, seat: SeatId): number => {
      if (!hg.extraIfControlsTitle) return 1;
      const has = getSeat(state, seat).minions.some(
        (m) =>
          m.kind === "vampire" &&
          isReady(m) &&
          m.title !== null &&
          hg.extraIfControlsTitle!.includes(m.title),
      );
      return has ? 2 : 1;
    };
    handler.abilityOptions = (entry, owner, ctx) => {
      if (ctx.window !== "turn.unlock" || ctx.seat !== owner.seat) return [];
      // "During YOUR unlock phase" — not every Methuselah's (the window is
      // offered to other seats for Homunculus-style abilities).
      if (ctx.turnSeat !== owner.seat) return [];
      if ((entry.phaseUses ?? 0) >= allowance(ctx.state, owner.seat)) return [];
      const options: LegalOption[] = [];
      for (const m of getSeat(ctx.state, owner.seat).minions) {
        if (m.kind !== "vampire" || !isReady(m)) continue;
        // "…who follows the Path of <x>" (Burial Site Hunting Ground) — a
        // printed crypt trait, filtered like the clan and sect tests
        // below (docs/path-cards-design.md §6).
        if (hg.path !== undefined && m.path !== hg.path) continue;
        // "A vampire can gain blood from only one hunting ground each
        // turn" — which is also what stops Carfax Abbey's second grant
        // going to the same vampire twice (design §8.1).
        if (m.usedHuntingGroundThisTurn) continue;
        // A vampire at capacity gains nothing (p. 6), and the option
        // would spend the location's once-per-phase use for nothing —
        // all thirteen hunting grounds shared this
        // (docs/futile-options-design.md).
        if (!canGainBlood(m)) continue;
        if (hg.clan !== undefined && m.clan !== hg.clan) continue;
        if (hg.sect !== undefined && m.sect !== hg.sect) continue;
        if (hg.title === "any" && m.title === null) continue;
        if (hg.title === "city" && (m.title === null || !CITY_TITLES.includes(m.title))) {
          continue;
        }
        options.push({
          id: `ability:${spec.name}:${entry.card.id}:${m.id}`,
          kind: "useAbility",
          label: `${spec.name}: ${m.name} gains ${hg.amount} blood`,
          source: entry.card.id,
          params: { target: m.id },
        });
      }
      // "…OR a wraith or zombie ally you control can gain 1 LIFE, not to
      // exceed its starting life" (Burial Site Hunting Ground). A separate
      // branch, not another filter: allies hold LIFE, are capped at their
      // printed starting life, and are outside the "a vampire can gain
      // blood from only one hunting ground each turn" limit, which names
      // vampires.
      if (hg.undeadAllyLife !== undefined) {
        for (const m of getSeat(ctx.state, owner.seat).minions) {
          if (!isUndeadAlly(m) || !isReady(m)) continue;
          if (!canGainBlood(m)) continue; // already at its starting life
          options.push({
            id: `ability:${spec.name}:${entry.card.id}:life:${m.id}`,
            kind: "useAbility",
            label: `${spec.name}: ${m.name} gains ${hg.undeadAllyLife} life`,
            source: entry.card.id,
            params: { target: m.id, grant: "life" },
          });
        }
      }
      return options;
    };
    handler.useAbility = (entry, owner, choice, ops) => {
      const target = choice.params["target"];
      if (!target) throw new Error(`${spec.name}: no hunting-ground target`);
      entry.usedThisPhase = true; // this location is spent for the turn
      entry.phaseUses = (entry.phaseUses ?? 0) + 1;
      if (choice.params["grant"] === "life") {
        // An ally's life lives in the same field as a vampire's blood
        // (p. 11), and `BloodGained` is already clamped by `capacityOf`.
        ops.emit({ type: "BloodGained", minion: target, amount: hg.undeadAllyLife! });
        return;
      }
      ops.emit({ type: "BloodGained", minion: target, amount: hg.amount });
      ops.emit({ type: "HuntingGroundUsed", minion: target });
    };
  }
  return handler;
}

/**
 * "Minions can burn this card as a Ⓓ action" (docs/granted-actions-design
 * .md §4.5) — the counter-play clause shared by ~25 cards, compiled from
 * `permanent.vulnerableTo` onto any card in play. The action is offered to
 * every Methuselah's minions (the engine scans all seats' cards in play),
 * is directed at this card's controller — who alone may block — and burns
 * the card on success. One per minion per copy per turn (p. 20).
 */
/**
 * "<who> can enter combat with <target> as a [+N stealth] Ⓓ action"
 * granted by a card in play (docs/granted-rush-design.md §3). Unlike the
 * ally/retainer `rush`, the actor need not be controlled by the card's
 * controller, so this is enumerated for whichever seat is acting.
 */
/**
 * "This vampire can BLEED as a Ⓓ action that costs 1 blood" (Codex of the
 * Edenic Groundskeepers) — the granted-action sibling of `rushGrant`.
 *
 * The only thing that makes it different from every other granted action
 * is `actionKind: "bleed"`, which `announceEntryAction` now takes; the
 * p. 23 bleed rules (one per minion per turn, prey as target, directed)
 * then apply from the one place that owns them.
 * docs/granted-bleed-and-target-costs-design.md §1
 */
/** "…can equip with the first equipment you find in your library as a +N
 *  stealth equip action" (Vast Wealth) — a granted action whose effect is
 *  a deterministic search (docs/library-search-design.md §4). */
export function searchEquipGrant(
  spec: CardSpec,
): Pick<CardHandler, "actionOptions" | "useActionOption" | "resolveGrantedAction"> {
  const g = spec.permanent?.searchEquipGrant;
  return {
    actionOptions(entry, owner, ctx) {
      if (!g || ctx.window !== "turn.minion") return [];
      // "If you control this minion" — the bearer, and only for the
      // Methuselah who controls them right now (p. 16).
      if (owner.minion === null || ctx.seat !== owner.seat) return [];
      const m = findMinion(ctx.state, owner.minion);
      if (!m || !canAct(m)) return [];
      if (
        entry.grantedActionUses?.some(
          (u) => u.minion === m.id && u.key === "searchEquip",
        )
      ) {
        return [];
      }
      return [
        {
          id: `act:${spec.name}:${entry.card.id}:equip:${m.id}`,
          kind: "useEntryAction",
          label: `${m.name}: equip from your library (${spec.name})`,
          source: entry.card.id,
          minion: m.id,
          params: {},
        },
      ];
    },
    useActionOption(entry, _owner, choice, ops) {
      if (!g) return;
      ops.announceEntryAction(entry, choice.minion, {
        effect: { key: "searchEquip" },
        ...(g.stealth ? { stealth: g.stealth } : {}),
      });
    },
    resolveGrantedAction(_entry, af, ops) {
      if (af.grantedEffect?.key !== "searchEquip") return;
      const g2 = spec.permanent?.searchEquipGrant;
      if (!g2) return;
      searchEquipDeterministic(
        spec,
        { kind: "searchEquip", cardTypes: g2.cardTypes, deterministic: true },
        af.actingSeat,
        af.acting,
        ops,
      );
    },
  };
}

/**
 * "<who> can add N counters to this card as a [+M stealth] action" — a
 * granted action whose whole effect is an accumulator (The Gate of
 * Acheron). Pit of Contemplation's identical clause is hand-rolled and
 * deliberately left that way (docs/unlock-tolls-design.md §4); the option
 * id uses the same `:counter:` verb segment so the two spell it alike.
 */
export function permanentCounterGrant(
  spec: CardSpec,
): Pick<CardHandler, "actionOptions" | "useActionOption" | "resolveGrantedAction"> {
  const g = spec.permanent?.counterGrant;
  return {
    actionOptions(entry, owner, ctx) {
      if (!g || ctx.window !== "turn.minion") return [];
      // "<Clan> YOU CONTROL" — the card's controller only.
      const controller = entry.controller ?? owner.seat;
      if (ctx.seat !== controller) return [];
      const out: LegalOption[] = [];
      for (const m of getSeat(ctx.state, controller).minions) {
        if (!canAct(m)) continue;
        if (g.who.kind !== undefined && m.kind !== g.who.kind) continue;
        if (g.who.clan !== undefined && m.clan !== g.who.clan) continue;
        if (g.who.sect !== undefined && m.sect !== g.who.sect) continue;
        if (g.who.minCapacity !== undefined && capacityOf(m) < g.who.minCapacity) continue;
        // Per minion, per action, per copy (p. 20).
        if ((entry.grantedActionUses ?? []).some((u) => u.minion === m.id && u.key === "addCounter")) {
          continue;
        }
        out.push({
          id: `act:${spec.name}:${entry.card.id}:counter:${m.id}`,
          kind: "useEntryAction",
          label: `${m.name}: add a counter to ${spec.name}`,
          source: entry.card.id,
          minion: m.id,
          params: {},
        });
      }
      return out;
    },
    useActionOption(entry, _owner, choice, ops) {
      if (!g) return;
      ops.announceEntryAction(entry, choice.minion, {
        effect: { key: "addCounter" },
        ...(g.stealth ? { stealth: g.stealth } : {}),
      });
    },
    resolveGrantedAction(entry, af, ops) {
      if (!g || af.grantedEffect?.key !== "addCounter") return;
      ops.addCounters(entry.card.id, g.amount);
    },
  };
}

export function permanentBleedGrant(
  spec: CardSpec,
): Pick<CardHandler, "actionOptions" | "useActionOption"> {
  const g = spec.permanent?.bleedGrant;
  return {
    actionOptions(entry, owner, ctx) {
      if (!g || ctx.window !== "turn.minion") return [];
      const pool =
        g.who.scope === "bearer"
          ? owner.minion === null
            ? []
            : [findMinion(ctx.state, owner.minion)].filter((m): m is MinionState => !!m)
          : getSeat(ctx.state, owner.seat).minions;
      const out: LegalOption[] = [];
      for (const m of pool) {
        if (m.controller !== ctx.seat) continue;
        if (m.kind !== "vampire" || !canAct(m)) continue;
        // One bleed per minion per turn (p. 20) — the same gate the
        // built-in bleed option uses.
        if (m.bledThisTurn) continue;
        if (g.who.clan !== undefined && m.clan !== g.who.clan) continue;
        if (g.who.sect !== undefined && m.sect !== g.who.sect) continue;
        if (m.blood < (g.cost?.blood ?? 0)) continue;
        if (getSeat(ctx.state, ctx.seat).pool < (g.cost?.pool ?? 0)) continue;
        // Per minion, per action, per copy (p. 20).
        if ((entry.grantedActionUses ?? []).some((u) => u.minion === m.id && u.key === "bleed")) {
          continue;
        }
        out.push({
          id: `act:${spec.name}:${entry.card.id}:bleed:${m.id}`,
          // Was "useAbility" until 2026-08-31, which routed the option to
          // `handler.useAbility` — a method a granted-action card does not
          // have — so taking the bleed threw. Its test asserted only that
          // the option was OFFERED, which is why nothing caught it.
          kind: "useEntryAction",
          label: `${m.name}: bleed (${spec.name})`,
          source: entry.card.id,
          minion: m.id,
          params: { minion: m.id },
        });
      }
      return out;
    },
    useActionOption(entry, owner, choice, ops) {
      if (!g) return;
      const minion = choice.params["minion"];
      if (!minion) throw new Error(`${spec.name}: no acting minion`);
      ops.announceEntryAction(entry, minion, {
        actionKind: "bleed",
        ...(g.stealth ? { stealth: g.stealth } : {}),
        ...(g.cost ? { cost: g.cost } : {}),
      });
      // "…gets +N bleed if the target Methuselah controls no ready
      // unlocked minions" — evaluated now, at announcement, when the
      // target is fixed (p. 25) and where every other bleed modifier
      // lands (§1).
      const bonus = g.bonusIfTargetHasNoUnlocked;
      const af = ops.action();
      if (bonus && af && af.target !== null) {
        const anyUnlocked = getSeat(ops.state, af.target).minions.some(
          (m) => isReady(m) && !m.locked,
        );
        if (!anyUnlocked) {
          ops.emit({
            type: "BleedAmountModified",
            actionId: af.actionId,
            delta: bonus,
            source: spec.name,
            // Not printed "(limited)", and p. 20's rule is about action
            // modifier CARDS.
            limited: false,
          });
        }
      }
      void owner;
    },
  };
}

export function permanentRushGrant(
  spec: CardSpec,
): Pick<CardHandler, "actionOptions" | "useActionOption"> {
  const g = spec.permanent?.rushGrant;
  const matches = (
    m: MinionState,
    f: { kind?: "vampire" | "ally"; clan?: string; notClan?: string; sect?: Sect },
  ): boolean => {
    if (f.kind !== undefined && m.kind !== f.kind) return false;
    if (f.clan !== undefined && m.clan !== f.clan) return false;
    // "A non-Salubri vampire": an untagged minion is not of that clan.
    if (f.notClan !== undefined && m.clan === f.notClan) return false;
    if (f.sect !== undefined && m.sect !== f.sect) return false;
    return true;
  };
  const actors = (
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    ctx: PlayContext,
  ): MinionState[] => {
    if (!g) return [];
    const acting = getSeat(ctx.state, ctx.seat);
    let pool: MinionState[];
    switch (g.who.scope) {
      case "bearer": {
        const b = owner.minion === null ? null : findMinion(ctx.state, owner.minion);
        pool = b ? [b] : [];
        break;
      }
      case "chosen": {
        const c = entry.chosen ? findMinion(ctx.state, entry.chosen) : null;
        pool = c ? [c] : [];
        break;
      }
      case "controller":
        // "Vampires YOU CONTROL" means the CARD's controller, which is
        // not the seat holding the bearer when the card sits on somebody
        // else's minion (Hunting the Quarry — "you still control this
        // card", p. 16). docs/round-end-design.md §5
        pool = getSeat(ctx.state, entry.controller ?? owner.seat).minions;
        break;
      default:
        pool = ctx.state.seats.flatMap((s) => (s.ousted ? [] : s.minions));
        break;
    }
    // Only the seat being asked can act, whatever the card says.
    return pool.filter(
      (m) => m.controller === acting.id && canAct(m) && matches(m, g.who),
    );
  };
  const targets = (
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    actor: MinionState,
    state: GameState,
  ): MinionState[] => {
    if (!g) return [];
    if (g.target.scope === "bearer") {
      const b = owner.minion === null ? null : findMinion(state, owner.minion);
      return b && b.id !== actor.id && isReady(b) ? [b] : [];
    }
    // "Your prey" is the card controller's prey (§3).
    const seats =
      g.target.scope === "prey"
        ? [getSeat(state, preyOf(state, entry.controller ?? owner.seat))]
        : state.seats.filter((s) => !s.ousted);
    const out: MinionState[] = [];
    for (const s of seats) {
      if (s.ousted) continue;
      for (const m of s.minions) {
        if (m.id === actor.id || !isReady(m)) continue;
        if (!matches(m, g.target)) continue;
        out.push(m);
      }
    }
    return out;
  };
  const stealthFor = (target: MinionState): number => {
    let n = g?.stealth ?? 0;
    for (const r of g?.stealthByTarget ?? []) {
      if (r.clan !== undefined && target.clan !== r.clan) continue;
      if (r.sect !== undefined && target.sect !== r.sect) continue;
      n += r.delta;
    }
    return n;
  };
  return {
    actionOptions(entry, owner, ctx) {
      if (!g) return [];
      if (ctx.window !== "turn.minion") return [];
      const options: LegalOption[] = [];
      for (const actor of actors(entry, owner, ctx)) {
        // One use per minion per copy per turn (p. 20).
        if (
          entry.grantedActionUses?.some(
            (u) => u.minion === actor.id && u.key === "enterCombat",
          )
        ) {
          continue;
        }
        for (const t of targets(entry, owner, actor, ctx.state)) {
          options.push({
            id: `act:${spec.name}:${entry.card.id}:rush:${actor.id}:${t.id}`,
            kind: "useEntryAction",
            label: `${actor.name}: enter combat with ${t.name} (${spec.name})`,
            source: entry.card.id,
            minion: actor.id,
            params: { target: t.id },
          });
        }
      }
      return options;
    },
    useActionOption(entry, _owner, choice, ops) {
      const target = choice.params["target"];
      if (!target) throw new Error(`${spec.name}: no rush target`);
      const args: Parameters<EngineOps["announceEntryAction"]>[2] = {
        targetMinion: target,
      };
      const stealth = stealthFor(getMinion(ops.state, target));
      if (stealth !== 0) args.stealth = stealth;
      ops.announceEntryAction(entry, choice.minion, args);
      // "Vampires you control can BURN THIS CARD to attempt to enter
      // combat with the attached minion" (Hunting the Quarry) — the
      // grant spends the card that offers it, at ANNOUNCEMENT, because
      // the card is the price of trying rather than of succeeding.
      if (g?.burnsCard) ops.burnPermanent(entry.card.id);
    },
  };
}

export function vulnerableGrant(
  spec: CardSpec,
): Pick<CardHandler, "actionOptions" | "useActionOption" | "resolveGrantedAction"> {
  const v = spec.permanent?.vulnerableTo;
  const stealthFor = (m: MinionState): number => {
    let extra = 0;
    for (const r of v?.stealthFor ?? []) {
      if (r.clan !== undefined && m.clan !== r.clan) continue;
      if (r.sect !== undefined && m.sect !== r.sect) continue;
      extra += r.delta;
    }
    return extra;
  };
  const political = v?.via === "politicalAction";
  const eligible = (m: MinionState, ownerSeat: SeatId, bearer: MinionId | null): boolean => {
    const who = v?.who;
    if (!canAct(m)) return false;
    // "Vampires can call a referendum…" — only vampires call political
    // actions (p. 10), one per vampire per turn (p. 24).
    if (political && (m.kind !== "vampire" || m.calledPoliticalThisTurn)) return false;
    if (!who) return true;
    if (who.excludeBearer && m.id === bearer) return false;
    if (who.bearerOnly && m.id !== bearer) return false;
    if (who.kind !== undefined && m.kind !== who.kind) return false;
    if (who.clan !== undefined && m.clan !== who.clan) return false;
    // "Non-Ravnos minions": an untagged minion is not of that clan, so it
    // qualifies (allies have no clan at all).
    if (who.notClan !== undefined && m.clan === who.notClan) return false;
    if (who.sect !== undefined && m.sect !== who.sect) return false;
    if (who.minCapacity !== undefined && capacityOf(m) < who.minCapacity) return false;
    if (who.othersOnly && m.controller === ownerSeat) return false;
    // "CHANGELING allies" — a printed sub-type, carried by the tags of the
    // minion's own card entry. No V5 ally has this tag, so the clause
    // correctly enumerates nothing (docs/politics-locations-design.md §5).
    if (who.tag !== undefined && !m.attached.some((p) => p.tags.includes(who.tag!))) {
      return false;
    }
    return true;
  };
  return {
    actionOptions(entry, owner, ctx) {
      if (!v) return [];
      if (ctx.window !== "turn.minion") return [];
      // Enumerated for the acting seat, whoever controls the card.
      const acting = getSeat(ctx.state, ctx.seat);
      const verb = political
        ? "vote"
        : v.outcome === "steal"
          ? "steal"
          : v.outcome === "shuffleIntoLibrary"
            ? "shuffle"
            : v.outcome === "burnCounters"
              ? "strip"
              : "burn";
      const options: LegalOption[] = [];
      for (const m of acting.minions) {
        if (!eligible(m, owner.seat, owner.minion)) continue;
        if (v.cost?.blood !== undefined && m.blood < v.cost.blood) continue;
        if (v.cost?.pool !== undefined && acting.pool < v.cost.pool) continue;
        if (
          entry.grantedActionUses?.some(
            (u) => u.minion === m.id && u.key === "burnCard",
          )
        ) {
          continue;
        }
        options.push({
          // The verb segment keeps this distinct from a card's other
          // granted actions (Pit of Contemplation grants two).
          id: `act:${spec.name}:${entry.card.id}:${verb}:${m.id}`,
          kind: "useEntryAction",
          label: political
            ? `${m.name}: call a referendum to burn ${spec.name} (${owner.seat}'s)`
            : `${m.name}: ${verb} ${spec.name} (${owner.seat}'s)`,
          source: entry.card.id,
          minion: m.id,
          params: {},
        });
      }
      return options;
    },
    useActionOption(entry, _owner, choice, ops) {
      if (!v) return;
      const actor = getMinion(ops.state, choice.minion);
      const args: Parameters<EngineOps["announceEntryAction"]>[2] = political
        ? {
            // A political action is UNDIRECTED (p. 24) — anyone may block
            // it — so no `targetPermanent`, even though the card it aims
            // at is the one granting the action. The referendum, not the
            // action's success, decides the card's fate.
            effect: { key: "referendumBurn" },
            political: true,
            referendumSource: {
              cardName: spec.name,
              cardInstanceId: entry.card.id,
              fromCardInPlay: true,
            },
          }
        : {
            effect: {
              key:
                v.outcome === "steal"
                  ? "stealCard"
                  : v.outcome === "shuffleIntoLibrary"
                    ? "shuffleCard"
                    : v.outcome === "burnCounters"
                      ? "stripCounters"
                      : "burnCard",
            },
            targetPermanent: entry.card.id,
          };
      const stealth = (v.stealth ?? 0) + stealthFor(actor);
      if (stealth !== 0) args.stealth = stealth;
      if (v.cost) args.cost = v.cost;
      ops.announceEntryAction(entry, choice.minion, args);
    },
    resolveGrantedAction(entry, af, ops) {
      // The political variant burns nothing on success: the referendum it
      // just called is what decides (docs/pool-drain-design.md §6).
      if (af.grantedEffect?.key === "referendumBurn") return;
      if (af.grantedEffect?.key === "stealCard") {
        // Control moves to the acting minion's controller (p. 16); the
        // card stays in play with its counters and lock state.
        ops.changePermanentControl(entry.card.id, af.actingSeat);
        return;
      }
      if (af.grantedEffect?.key === "shuffleCard") {
        ops.shuffleIntoLibrary(entry.card.id);
        return;
      }
      if (af.grantedEffect?.key === "stripCounters") {
        // "Burn ALL THE COUNTERS from this card" (Powerbase: Madrid) — the
        // card survives. Legal against an empty card, and then it does
        // nothing: the printed clause names no precondition (§5).
        ops.removeCounters(entry.card.id, entry.counters ?? 0);
        return;
      }
      if (af.grantedEffect?.key !== "burnCard") return;
      // "…if that action is successful, this Anarch is locked and does
      // not unlock as normal during their next unlock phase" (Stolen
      // Police Cruiser) — read BEFORE the burn, since the bearer is only
      // findable through the entry (the Rewilding ordering lesson).
      const penalty = v?.bearerPenalty;
      if (penalty) {
        const bearer = bearerOf(ops.state, entry.card.id);
        if (bearer) {
          if (penalty.lock && !bearer.locked) {
            ops.emit({ type: "MinionLocked", minion: bearer.id });
          }
          if (penalty.skipNextUnlock) bearer.skipNextUnlock = true;
        }
      }
      ops.burnPermanent(entry.card.id);
    },
  };
}

/**
 * "Once each turn, a Sabbat vampire can call a referendum to have their
 * controller gain 2 pool as a +1 stealth political action" (Black Forest
 * Base) — a granted POLITICAL action with an ordinary payout.
 *
 * Everything the burn version (`vulnerableTo.via: "politicalAction"`)
 * proved out is reused: `announceEntryAction` with `political: true`
 * (undirected, one per vampire per turn, p. 24) and a `referendumSource`
 * carrying `fromCardInPlay`, which is how a card in play tells its own
 * referendums apart. docs/politics-locations-design.md §5
 */
export function politicalGrant(
  spec: CardSpec,
): Pick<CardHandler, "actionOptions" | "useActionOption" | "applyReferendum"> {
  const g = spec.permanent?.politicalGrant;
  return {
    actionOptions(entry, owner, ctx) {
      if (!g) return [];
      if (ctx.window !== "turn.minion") return [];
      if (g.oncePerTurn && entry.usedThisTurn) return [];
      const options: LegalOption[] = [];
      for (const m of getSeat(ctx.state, ctx.seat).minions) {
        // Only vampires call political actions (p. 10), one per vampire
        // per turn (p. 24).
        if (m.kind !== "vampire" || !canAct(m) || m.calledPoliticalThisTurn) continue;
        if (g.who?.clan !== undefined && m.clan !== g.who.clan) continue;
        if (g.who?.sect !== undefined && m.sect !== g.who.sect) continue;
        if (g.who?.minCapacity !== undefined && capacityOf(m) < g.who.minCapacity) continue;
        options.push({
          id: `act:${spec.name}:${entry.card.id}:referendum:${m.id}`,
          kind: "useEntryAction",
          label: `${m.name}: call a referendum (${spec.name})`,
          source: entry.card.id,
          minion: m.id,
          params: {},
        });
      }
      return options;
    },
    useActionOption(entry, _owner, choice, ops) {
      if (!g) return;
      if (g.oncePerTurn) entry.usedThisTurn = true;
      const args: Parameters<EngineOps["announceEntryAction"]>[2] = {
        effect: { key: "politicalGrant" },
        political: true,
        referendumSource: {
          cardName: spec.name,
          cardInstanceId: entry.card.id,
          fromCardInPlay: true,
        },
      };
      if (g.stealth) args.stealth = g.stealth;
      ops.announceEntryAction(entry, choice.minion, args);
    },
    applyReferendum(frame, ops) {
      if (!g) return;
      // "…to have THEIR CONTROLLER gain 2 pool": the Sabbat vampire is the
      // acting minion, so its controller is the calling seat.
      if (g.effect.gainPool > 0) {
        ops.emit({ type: "PoolGained", seat: frame.caller, amount: g.effect.gainPool });
      }
    },
  };
}

function makeMasterOption(
  spec: CardSpec,
  card: CardInstance,
  params: Record<string, string>,
  label: string,
): LegalOption {
  const extras = Object.values(params);
  return {
    id: playOptionId(spec.name, null, ...extras, card.id),
    kind: "playCard",
    label: `${spec.name} — ${label}`,
    card: card.id,
    name: spec.name,
    minion: null,
    mode: null,
    params,
  };
}

/** Equipment: played as an equip action (undirected, +1 stealth, p. 20);
 *  attaches to the acting minion on success, burned if blocked. */
function compileEquipment(spec: CardSpec): CardHandler {
  const w = spec.weapon;
  const handler: CardHandler = {
    name: spec.name,
    bloodCost: spec.bloodCost,
    poolCost: spec.poolCost ?? 0,
    isActionCard: true,
    isEquipment: true,
    permanentStatics: spec.permanent?.statics ?? {},
    // The exclusive key rides in the tags, because that is what the
    // "already has one" test reads (Living Manse).
    permanentTags: [
      ...(spec.permanent?.tags ?? []),
      ...(spec.permanent?.exclusiveKey ? [spec.permanent.exclusiveKey] : []),
    ],

    options(card, ctx) {
      if (ctx.window !== "turn.minion") return [];
      const seat = getSeat(ctx.state, ctx.seat);
      if (spec.unique && seatControlsCopy(ctx.state, ctx.seat, spec.name)) {
        return [];
      }
      const vehicle = (spec.permanent?.tags ?? []).includes("vehicle");
      const options: LegalOption[] = [];
      for (const m of seat.minions) {
        if (!canAct(m)) continue;
        if (m.playedSinceUnlock.includes(spec.name)) continue;
        // "This ally cannot have or use equipment" (Bone Shambler,
        // Gravebound Drone) — a gate on OPTIONS: it is never offered as a
        // bearer, which is both halves of "have or use" at once.
        if (cannotBeEquipped(m, "equipment")) continue;
        // "A minion can have only one vehicle" (Sport Bike).
        if (vehicle && m.attached.some((p) => p.tags.includes("vehicle"))) {
          continue;
        }
        // "Requires a Tzimisce" / "Requires an Anarch". THIS COMPILER NEVER
        // ASKED — the third instance of the `meetsRequirements` bug (after
        // the modifier/reaction loop and `requiresControlledTitle`), and it
        // left the requirement lines on Shilmulo Tarot, Treasured Samadji
        // and Stolen Police Cruiser unenforced. Nothing asserted it, and
        // the fuzz structurally cannot see a too-permissive option list.
        if (!meetsRequirements(m, spec)) continue;
        // "A vampire can have only one Living Manse" — equipment reached
        // play through this branch without ever consulting `exclusiveKey`,
        // which until now no equipment card carried.
        const exKey = spec.permanent?.exclusiveKey;
        if (exKey !== undefined && m.attached.some((p) => p.tags.includes(exKey))) {
          continue;
        }
        const mode = spec.modes[0] ?? { level: "basic" as const, discipline: null, effects: [] };
        // Per minion, because a play-cost modifier can name one of them
        // (docs/play-cost-design.md §3).
        const cost = costOf(spec, ctx, m, mode);
        // "Only a Methuselah with enough pool can play a card with a pool
        // cost" (p. 9); paid at resolution for action cards. Counters on
        // a cost source (Ravnos Cache) count toward affording it.
        for (const split of paymentSplits(ctx, m, cost, "equipment")) {
          if (m.blood < split.blood || seat.pool < split.pool) continue;
          options.push(makeOption(spec, card, m, mode, split.params));
        }
      }
      return options;
    },

    resolve(play, ops) {
      // The equip action: undirected, +1 stealth by default (p. 20).
      ops.announceCardAction(play, {
        actionKind: "cardEffect",
        // "…with an ADDITIONAL +1 stealth" (Unlicensed Taxicab) sits on
        // top of the equip action's own +1.
        inherentStealth: 1 + (spec.permanent?.extraEquipStealth ?? 0),
      });
    },
  };
  // Weapon strikes (docs/weapons-design.md) — mirrors the .44 Magnum
  // bespoke handler, data-driven from spec.weapon.
  if (w) {
    handler.abilityOptions = (entry, owner, ctx) => {
      const cf = ctx.combat;
      if (!cf || owner.minion === null) return [];
      const side =
        cf.acting === owner.minion
          ? ("acting" as const)
          : cf.opposing === owner.minion
            ? ("opposing" as const)
            : null;
      if (!side) return [];
      // "The opposing minion cannot use equipment" (Terror Frenzy).
      if (cf.restrict[side].equipment) return [];
      if (w.maneuverPerCombat && ctx.window === "combat.range") {
        if (cf.awaiting !== side || cf.usedWeaponManeuver[side] !== null) return [];
        return [
          {
            id: `ability:${spec.name}:${entry.card.id}:maneuver`,
            kind: "useAbility",
            label: `${spec.name}: maneuver (commits the weapon's strike)`,
            source: entry.card.id,
            params: { action: "maneuver" },
          },
        ];
      }
      if (ctx.window === "combat.chooseStrike") {
        const chooser = cf.strikes.acting === null ? "acting" : "opposing";
        if (chooser !== side || cf.strikes[side] !== null) return [];
        const committed = cf.committedStrike[side];
        if (committed !== null && committed !== entry.card.id) return [];
        // "Strikes that are not hand strikes cannot be used this round"
        // (Immortal Grapple) — a weapon strike is not one.
        if (cf.handStrikesOnly) return [];
        // "Strike: 2R damage, ONLY USABLE AT LONG RANGE" (Sniper Rifle) —
        // a gate on options (§3).
        if (w.onlyAtLongRange && cf.range !== "long") return [];
        const dmg = w.damage === null ? `strength+${w.handBonus ?? 0}` : `${w.damage}${w.ranged ? "R" : ""}`;
        return [
          {
            id: `ability:${spec.name}:${entry.card.id}:strike`,
            kind: "useAbility",
            label: `${spec.name}: strike (${dmg}${w.aggravated ? " aggravated" : ""})`,
            source: entry.card.id,
            params: { action: "strike" },
          },
        ];
      }
      // "If the bearer BLOCKS, they can, before range is determined, set
      // the range for the first round to long, and their initial strike
      // that round must be with this weapon" (Sniper Rifle, §3).
      if (
        w.blockSetsLongRange &&
        ctx.window === "combat.beforeRange" &&
        cf.fromBlock &&
        cf.round === 1 &&
        cf.range !== "long" &&
        // The BEARER must be the one who blocked — the blocker is the
        // opposing side of an action's combat.
        side === "opposing"
      ) {
        return [
          {
            id: `ability:${spec.name}:${entry.card.id}:snipe`,
            kind: "useAbility",
            label: `${spec.name}: set the range to long (commits this weapon's strike)`,
            source: entry.card.id,
            params: { action: "snipe" },
          },
        ];
      }
      // "Once each combat, burn N blood to cancel a <keyword> card as it
      // is played by the OPPOSING minion" (Sword of the Archangel, §5).
      const ck = w.cancelKeywordCard;
      if (ck && ctx.window === "card.asPlayed") {
        const bearer = findMinion(ctx.state, owner.minion);
        const pending = ctx.pendingCard;
        const foe = side === "acting" ? cf.opposing : cf.acting;
        if (
          bearer &&
          pending &&
          pending.minion === foe &&
          (pending.keywords ?? []).some((k) => ck.keywords.includes(k)) &&
          bearer.blood >= ck.blood &&
          !cf.usedThisCombat.includes(entry.card.id)
        ) {
          return [
            {
              id: `ability:${spec.name}:${entry.card.id}:cancelkw`,
              kind: "useAbility",
              label: `${spec.name}: burn ${ck.blood} blood to cancel ${pending.card.name}`,
              source: entry.card.id,
              params: { action: "cancelKeyword" },
            },
          ];
        }
      }
      return [];
    };
    // The cancel acts inside another card's as-played period, which p. 7
    // otherwise reserves for cancels and wakes — the Meditative Grove
    // opt-in.
    if (w.cancelKeywordCard) handler.abilityInAsPlayed = true;
    // "Once each turn, if the opposing vampire is burned DURING THIS
    // WEAPON'S STRIKE RESOLUTION and the bearer remains ready, the bearer
    // can unlock at the end of combat" (§6). Fired after the pop, so the
    // "remains ready" test is read then — the bearer can die later in the
    // same combat.
    if (w.unlockOnKill) {
      handler.onCombatEnded = (entry, owner, info, ops) => {
        if (!owner.minion || entry.usedThisTurn) return;
        if (!info.burnedByStrike.includes(spec.name)) return;
        const bearer = findMinion(ops.state, owner.minion);
        if (!bearer || !isReady(bearer) || !bearer.locked) return;
        entry.usedThisTurn = true;
        ops.emit({ type: "MinionUnlocked", minion: bearer.id });
      };
    }
    handler.useAbility = (entry, owner, choice, ops) => {
      if (!owner.minion) throw new Error(`${spec.name}: no bearer`);
      const act = choice.params["action"];
      if (act === "maneuver") {
        ops.useWeaponManeuver(owner.minion, entry.card.id);
        return;
      }
      if (act === "snipe") {
        ops.setCombatRange("long");
        // "…and their initial strike that round must be with this
        // weapon" — the .44 ruling's commitment (§3).
        ops.commitStrikeTo(owner.minion, entry.card.id);
        return;
      }
      if (act === "cancelKeyword") {
        ops.emit({
          type: "BloodBurned",
          minion: owner.minion,
          amount: w.cancelKeywordCard!.blood,
        });
        ops.markUsedThisCombat(entry.card.id);
        // "…and its cost is not paid" — the Sudden Reversal wording,
        // which refunds.
        ops.cancelPendingCard(true);
        return;
      }
      ops.chooseWeaponStrike(owner.minion, entry.card.id, {
        name: spec.name,
        damage: w.damage,
        ranged: w.ranged,
        handBonus: w.handBonus ?? 0,
        aggravated: w.aggravated,
      });
      // "After the bearer strikes with this gun, they get 1 optional
      // additional strike (limited), only usable to strike with this
      // gun, this round" (AK-47, §2).
      if (w.additionalStrikeSelf) {
        ops.grantAdditionalStrikeTo(owner.minion, 1, true);
        ops.commitStrikeTo(owner.minion, entry.card.id);
      }
    };
  }
  return handler;
}

/** Shared option enumeration for the three "bring a permanent resource
 *  into play" actions (p. 20): any ready minion that can act, with the
 *  cost in hand and the discipline for the mode, once per turn. */
function permanentActionOptions(
  spec: CardSpec,
  card: CardInstance,
  ctx: PlayContext,
): LegalOption[] {
  if (ctx.window !== "turn.minion") return [];
  const seat = getSeat(ctx.state, ctx.seat);
  if (spec.unique && seatControlsCopy(ctx.state, ctx.seat, spec.name)) {
    return [];
  }
  const myTypes = COST_TYPES_BY_CARD_TYPE[spec.cardType];
  const options: LegalOption[] = [];
  for (const m of seat.minions) {
    if (!canAct(m)) continue;
    if (m.playedSinceUnlock.includes(spec.name)) continue;
    // "…can play NON-ACTION cards … as a vampire" (Spectral Servitor):
    // every card enumerated here is played AS AN ACTION (recruit, employ,
    // equip), so such an ally is simply not a candidate.
    if (playsNonActionOnly(m)) continue;
    // "This vampire cannot recruit allies or employ retainers"
    // (Depravity) — a restriction carried by a card on the actor,
    // matched against this card's printed type
    // (docs/conditional-statics-design.md §4).
    if (
      m.attached.some((p) =>
        (p.statics.cannotPlayCardTypes ?? []).some((t) => myTypes.includes(t)),
      )
    ) {
      continue;
    }
    // "This ally cannot have or use equipment OR RETAINERS" (Bone
    // Shambler). A retainer's bearer IS the minion employing it, so
    // barring the actor is the whole clause.
    if (spec.cardType === "retainer" && cannotBeEquipped(m, "retainer")) continue;
    for (const mode of spec.modes) {
      if (!canPlayMode(m, mode, spec)) continue;
      // "Only a Methuselah with enough pool can play a card with a pool
      // cost" (p. 9); paid at resolution for action cards.
      const cost = costOf(spec, ctx, m, mode);
      if (seat.pool < cost.pool || m.blood < cost.blood) continue;
      options.push(makeOption(spec, card, m, mode, {}));
    }
  }
  return options;
}

/** "Can enter combat with a minion/vampire as a Ⓓ action" granted by a
 *  card in play (rush design §2.5) — to the ally itself (self-entry) or
 *  the employer (Twisted Bloodhound). One use per copy per turn (p. 20). */
function rushGrant(
  spec: CardSpec,
): Pick<CardHandler, "actionOptions" | "useActionOption"> {
  return {
    actionOptions(entry, owner, ctx) {
      const rush = spec.rush;
      if (!rush) return [];
      if (ctx.window !== "turn.minion") return [];
      if (owner.minion === null || ctx.seat !== owner.seat) return [];
      // One rush per minion per copy per turn (p. 20).
      if (
        entry.grantedActionUses?.some(
          (u) => u.minion === owner.minion && u.key === "enterCombat",
        )
      ) {
        return [];
      }
      const actor = getMinion(ctx.state, owner.minion);
      if (!canAct(actor)) return [];
      const options: LegalOption[] = [];
      for (const t of enumerateRushTargets(ctx.state, actor, rush)) {
        const target = getMinion(ctx.state, t);
        options.push({
          id: `act:${spec.name}:${entry.card.id}:${t}`,
          kind: "useEntryAction",
          label: `${actor.name}: enter combat with ${target.name} (${spec.name})`,
          source: entry.card.id,
          minion: actor.id,
          params: { target: t },
        });
      }
      return options;
    },
    useActionOption(entry, _owner, choice, ops) {
      const target = choice.params["target"];
      if (!target) throw new Error(`${spec.name}: no rush target`);
      ops.announceEntryAction(entry, choice.minion, {
        targetMinion: target,
        // "…as a Ⓓ action that costs 1 life" (Rotting Behemoth) — paid at
        // resolution, only on success (p. 27).
        ...(spec.rush?.cost ? { cost: spec.rush.cost } : {}),
      });
    },
  };
}

/** Retainers: played as an employ retainer action (undirected, +1
 *  stealth, p. 22); attaches to the acting minion with its mode's life. */
function compileRetainer(spec: CardSpec): CardHandler {
  return {
    ...rushGrant(spec),
    name: spec.name,
    bloodCost: spec.bloodCost,
    poolCost: spec.poolCost ?? 0,
    isActionCard: true,
    isRetainer: true,
    permanentStatics: spec.permanent?.statics ?? {},
    permanentTags: spec.permanent?.tags ?? [],

    permanentEntry(mode) {
      const m = spec.modes.find((x) => x.level === mode) ?? spec.modes[0];
      const entry: { statics: PermanentStatics; tags: string[]; life?: number } = {
        statics: { ...(spec.permanent?.statics ?? {}), ...(m?.statics ?? {}) },
        tags: spec.permanent?.tags ?? [],
      };
      if (m?.retainerLife !== undefined) entry.life = m.retainerLife;
      return entry;
    },

    options(card, ctx) {
      return permanentActionOptions(spec, card, ctx);
    },

    resolve(play, ops) {
      // The employ retainer action: undirected, +1 stealth (p. 22).
      ops.announceCardAction(play, {
        actionKind: "cardEffect",
        inherentStealth: 1,
      });
    },
  };
}

/**
 * "This ally cannot have or use equipment (or retainers)" (Bone Shambler,
 * Gravebound Drone). Read off the minion's OWN card text — an ally carries
 * it as a self-attached entry — so a piece of equipment already on some
 * other minion can never make this true by accident.
 * docs/wraith-zombie-design.md §4
 */
/** "This ally can play NON-ACTION cards requiring basic \<D\> as a
 *  vampire" (Spectral Servitor) — read off its own card text.
 *  docs/wraith-zombie-design.md §7 */
export function playsNonActionOnly(m: MinionState): boolean {
  return (
    m.attached.find((e) => e.card.id === m.id)?.statics.playsAsVampireNonActionOnly === true
  );
}

function cannotBeEquipped(m: MinionState, kind: "equipment" | "retainer"): boolean {
  const st = m.attached.find((e) => e.card.id === m.id)?.statics.cannotBeEquipped;
  if (!st) return false;
  return kind === "equipment" ? true : st.retainers === true;
}

/** An ally's tags: whatever the spec declares, plus its printed SUB-TYPE
 *  ("Wraith with 1 life"). One source, so a card cannot declare its
 *  sub-type in one place and be filtered in another.
 *  docs/wraith-zombie-design.md §2 */
function allyTags(spec: CardSpec): string[] {
  const tags = [...(spec.permanent?.tags ?? [])];
  const sub = spec.ally?.subtype;
  if (sub && !tags.includes(sub)) tags.push(sub);
  return tags;
}

/** Allies: played as a recruit ally action (undirected, +1 stealth,
 *  p. 22); becomes a minion on success, with its card text riding along
 *  as a self-attached entry. */
function compileAlly(spec: CardSpec): CardHandler {
  return {
    ...rushGrant(spec),
    name: spec.name,
    bloodCost: spec.bloodCost,
    poolCost: spec.poolCost ?? 0,
    isActionCard: true,
    isAlly: true,
    // Omitted until 2026-09-01, so a card filtering by printed sub-type
    // ("a ghoul (ally or retainer)", Fleshforge Chamber) silently skipped
    // every ALLY — War Ghoul is a ghoul and would never have matched.
    // Equipment and retainers had always exposed this.
    permanentTags: allyTags(spec),

    allyEntry(mode) {
      const stats = spec.ally;
      if (!stats) throw new Error(`${spec.name}: ally spec without stats`);
      // The mode chosen at announcement fixes the printed version
      // (Freakish Conglomeration's superior has 4 life).
      const m = spec.modes.find((x) => x.level === mode);
      return {
        life: m?.ally?.life ?? stats.life,
        strength: m?.ally?.strength ?? stats.strength,
        bleed: m?.ally?.bleed ?? stats.bleed,
        // MODE statics merge in, the way a retainer's `permanentEntry`
        // has always done. Without this an ally's superior-only clause is
        // silently inert — which is what happened to Bone Shambler's,
        // Gravebound Drone's and Rotting Behemoth's superiors until it
        // was noticed. docs/wraith-zombie-design.md §4
        statics: { ...(spec.permanent?.statics ?? {}), ...(m?.statics ?? {}) },
        tags: allyTags(spec),
        // "This ally can play cards requiring basic Animalism as a
        // vampire" (p. 11): the whole rule is these levels on the ally.
        ...(stats.playsAsVampire ? { disciplines: stats.playsAsVampire } : {}),
        ...(stats.actsWhenRecruited ? { actsWhenRecruited: true } : {}),
      };
    },

    options(card, ctx) {
      const base = permanentActionOptions(spec, card, ctx);
      const burn = spec.ally?.enterPlayBurn;
      if (!burn) return base;
      // "After this ally enters play, burn an ally or retainer you
      // control" — the victim is chosen at ANNOUNCEMENT and rides in the
      // option id, the shape War Ghoul introduced. `self` is a legal
      // choice: the clause names a set the newcomer belongs to
      // (docs/vozhd-allies-design.md §1).
      const seat = getSeat(ctx.state, ctx.seat);
      const victims: string[] = burn.allowSelf === false ? [] : ["self"];
      for (const m of seat.minions) {
        if (burn.kinds.includes("ally") && m.kind === "ally") victims.push(m.id);
        if (burn.kinds.includes("retainer")) {
          for (const p of m.attached) if (p.life !== undefined) victims.push(p.card.id);
        }
      }
      const out: LegalOption[] = [];
      for (const o of base) {
        if (o.kind !== "playCard") {
          out.push(o);
          continue;
        }
        for (const v of victims) {
          out.push({
            // play:<Name>:<mode>:<minion>:<victim>:<cardId> — the card
            // instance stays LAST, as every trace test assumes.
            id: playOptionId(spec.name, o.mode, o.minion ?? "-", v, card.id),
            kind: "playCard",
            label: `${o.label} → burn ${v}`,
            card: o.card,
            name: o.name,
            minion: o.minion,
            mode: o.mode,
            params: { ...o.params, burn: v },
          });
        }
      }
      return out;
    },

    resolve(play, ops) {
      // The recruit ally action: undirected, +1 stealth (p. 22).
      ops.announceCardAction(play, {
        actionKind: "cardEffect",
        inherentStealth: 1,
      });
    },

    resolveCardAction(af, ops) {
      const burn = spec.ally?.enterPlayBurn;
      if (!burn) return;
      // Runs after the ally entered play (engine order guarantees it), so
      // "self" is a real minion by now.
      const pick = af.card?.params["burn"];
      if (!pick) return;
      const target = pick === "self" ? af.card!.instance.id : pick;
      if (findMinion(ops.state, target)) ops.burnMinion(target);
      else ops.burnPermanent(target);
    },
  };
}

// ---------------------------------------------------------------------------
// Political actions (docs/politics-design.md)
// ---------------------------------------------------------------------------

/** All ways to allocate `points` among ≥ `minTargets` of `seats`, each
 *  chosen seat getting at least 1 (p. 28 card texts: "allocate N points
 *  among two or more Methuselahs"). */
/** The minion this card in play is attached to, if any. */
function bearerOf(state: GameState, cardId: CardInstanceId): MinionState | null {
  for (const s of state.seats) {
    for (const m of s.minions) {
      if (m.attached.some((p) => p.card.id === cardId)) return m;
    }
  }
  return null;
}

/** Is this card still in play anywhere? A location can leave between the
 *  terms being chosen and the tally. */
function entryStillInPlay(state: GameState, cardId: CardInstanceId): boolean {
  return state.seats.some(
    (s) =>
      s.permanents.some((p) => p.card.id === cardId) ||
      s.minions.some((m) => m.attached.some((p) => p.card.id === cardId)),
  );
}

/** Every location in play, whoever controls it — the target list three
 *  referendums range over (docs/referendum-terms-design.md §2). */
function allLocations(state: GameState): PermanentInPlay[] {
  const out: PermanentInPlay[] = [];
  for (const s of state.seats) {
    if (s.ousted) continue;
    for (const p of s.permanents) if (p.tags.includes("location")) out.push(p);
  }
  return out;
}

export function enumerateAllocations(
  seats: string[],
  points: number,
  minTargets: number,
  /** Per-target ceiling, indexed like `seats`. A location or equipment is
   *  BURNED by one point, so a second on it is wasted and is not a
   *  distinct choice — the cap is what keeps a heterogeneous allocation
   *  (Revolutionary Council) finite as well as correct.
   *  docs/last-buildable-design.md §4 */
  caps?: number[],
): Array<Record<string, number>> {
  const results: Array<Record<string, number>> = [];
  const current: number[] = new Array(seats.length).fill(0);
  const recurse = (i: number, left: number): void => {
    if (i === seats.length) {
      if (left !== 0) return;
      const nonZero = current.filter((x) => x > 0).length;
      if (nonZero < minTargets) return;
      const alloc: Record<string, number> = {};
      current.forEach((x, k) => {
        if (x > 0) alloc[seats[k]!] = x;
      });
      results.push(alloc);
      return;
    }
    const most = Math.min(left, caps?.[i] ?? left);
    for (let x = 0; x <= most; x++) {
      current[i] = x;
      recurse(i + 1, left - x);
    }
    current[i] = 0;
  };
  recurse(0, points);
  return results;
}

export function allocToParams(alloc: Record<string, number>): string {
  return Object.entries(alloc)
    .map(([seat, x]) => `${seat}=${x}`)
    .join(",");
}

export function parseAlloc(s: string): Array<[string, number]> {
  return s.split(",").map((part) => {
    const [seat, x] = part.split("=");
    return [seat!, Number(x)];
  });
}

/**
 * Effects that are ONLY legal during a referendum's polling step.
 *
 * A mode carrying one of these is enumerated by the polling branch and
 * must be skipped by the ordinary action-modifier/reaction loop — offered
 * there, it resolves with no referendum to act on and throws.
 *
 * This has caused the same bug three times (`modifyVotes`, then
 * `restrictVotes`, then the abstain family), each time because a new
 * polling effect was added and one of the two sites was not updated. Both
 * sites now read this set, so a fourth cannot drift.
 */
const POLLING_ONLY_EFFECTS: ReadonlySet<EffectPrimitive["kind"]> = new Set([
  "modifyVotes",
  "modifyAllVotes",
  "restrictVotes",
  "forceAbstain",
  "cancelReferendum",
  "burnPoolVotedAgainst",
]);

/** Every minion in play, in seat order — the candidate pool for a
 *  referendum that chooses minions rather than Methuselahs. */
function ops_allMinionIds(state: GameState): MinionId[] {
  return state.seats.filter((s) => !s.ousted).flatMap((s) => s.minions.map((m) => m.id));
}

/** Political action cards: only vampires may play them (p. 10); one
 *  political action per vampire per turn (p. 24); undirected +1 stealth;
 *  success calls the referendum, whose terms and effects come from the
 *  spec's referendum primitive. */
function compilePoliticalAction(spec: CardSpec): CardHandler {
  const primitive = spec.modes[0]?.effects[0] ?? null;

  return {
    name: spec.name,
    bloodCost: spec.bloodCost,
    poolCost: spec.poolCost ?? 0,
    isActionCard: true,
    isPoliticalAction: true,

    options(card, ctx) {
      if (ctx.window !== "turn.minion") return [];
      const seat = getSeat(ctx.state, ctx.seat);
      const options: LegalOption[] = [];
      for (const m of seat.minions) {
        if (m.kind !== "vampire") continue;
        if (!canAct(m)) continue;
        if (m.calledPoliticalThisTurn) continue;
        if (m.playedSinceUnlock.includes(spec.name)) continue;
        // "…cannot perform the same action again this turn" (Change of
        // Target, Obedience, Delaying Tactics) — the action key for a
        // card-announced action is the card name.
        if (!canRepeatAction(ctx.state, m, spec.name)) continue;
        if (!meetsRequirements(m, spec)) continue;
        const mode = spec.modes[0] ?? { level: "basic" as const, discipline: null, effects: [] };
        const cost = costOf(spec, ctx, m, mode);
        if (seat.pool < cost.pool || m.blood < cost.blood) continue;
        options.push(makeOption(spec, card, m, mode, {}));
      }
      return options;
    },

    resolve(play, ops) {
      // The political action: undirected, +1 stealth (p. 24).
      ops.announceCardAction(play, {
        actionKind: "cardEffect",
        inherentStealth: 1,
        political: true,
      });
    },

    referendumTerms(frame, state) {
      if (!primitive) return [];
      const standing = state.seats.filter((s) => !s.ousted).map((s) => s.id);
      const options: LegalOption[] = [];
      if (primitive.kind === "refAllocateBurn") {
        const points =
          primitive.points === "numSeats" ? standing.length : primitive.points;
        // "…among two or more OTHER Methuselahs" (Reckless Agitation).
        const targets = primitive.excludeSelf
          ? standing.filter((id) => id !== frame.caller)
          : standing;
        if (primitive.beneficiary) {
          // "Choose a Methuselah AND allocate N among two or more OTHER
          // Methuselahs" — "other" is measured from the CHOSEN seat (§2).
          for (const chosen of standing) {
            const others = standing.filter((id) => id !== chosen);
            for (const alloc of enumerateAllocations(others, points, primitive.minTargets)) {
              const s = allocToParams(alloc);
              options.push({
                id: `terms:${chosen}:${s}`,
                kind: "chooseTerms",
                label: `${chosen} gains; allocate ${s}`,
                params: { chosen, alloc: s },
              });
            }
          }
          return options;
        }
        for (const alloc of enumerateAllocations(targets, points, primitive.minTargets)) {
          const s = allocToParams(alloc);
          options.push({
            id: `terms:${s}`,
            kind: "chooseTerms",
            label: `Allocate: ${s}`,
            params: { alloc: s },
          });
        }
      } else if (primitive.kind === "refClanBoon") {
        // "You must choose an EXISTING clan, even if no vampires of the
        // chosen clan are in play" (p. 49) — so the terms are the pool's
        // fourteen clans, not the ones on the table (§1).
        for (const clan of CLANS) {
          options.push({
            id: `terms:${clan}`,
            kind: "chooseTerms",
            label: `Choose ${clan}`,
            params: { clan },
          });
        }
      } else if (primitive.kind === "refBurnSeatOrLocation") {
        const locations = allLocations(state);
        const caller = findMinion(state, frame.callingMinion ?? "");
        // The title is read WHEN THE TERMS ARE CHOSEN, which is the only
        // moment the answer is stable (§2).
        const both =
          !!caller && caller.title !== null && primitive.bothIfTitle.includes(caller.title);
        for (const s of standing) {
          options.push({
            id: `terms:${s}`,
            kind: "chooseTerms",
            label: `${s} burns ${primitive.poolBurn} pool`,
            params: { seat: s },
          });
        }
        for (const l of locations) {
          options.push({
            id: `terms:loc:${l.card.id}`,
            kind: "chooseTerms",
            label: `Burn ${l.card.name}`,
            params: { location: l.card.id },
          });
        }
        if (both) {
          for (const s of standing) {
            for (const l of locations) {
              options.push({
                id: `terms:${s}:loc:${l.card.id}`,
                kind: "chooseTerms",
                label: `${s} burns ${primitive.poolBurn} pool AND ${l.card.name} is burned`,
                params: { seat: s, location: l.card.id },
              });
            }
          }
        }
      } else if (primitive.kind === "refAttachToChosen") {
        // "Choose a Camarilla vampire" — any Methuselah's, since the card
        // is normally aimed at somebody else's (§2).
        for (const s of state.seats) {
          if (s.ousted) continue;
          for (const m of s.minions) {
            if (m.kind !== "vampire" || !isReady(m)) continue;
            if (primitive.who.sect !== undefined && m.sect !== primitive.who.sect) continue;
            if (primitive.who.clan !== undefined && m.clan !== primitive.who.clan) continue;
            options.push({
              id: `terms:${m.id}`,
              kind: "chooseTerms",
              label: `Choose ${m.name}`,
              params: { minion: m.id },
            });
          }
        }
      } else if (primitive.kind === "refMoveLocation") {
        for (const l of allLocations(state)) {
          for (const s of standing) {
            options.push({
              id: `terms:${l.card.id}:${s}`,
              kind: "chooseTerms",
              label: `${s} takes control of ${l.card.name}`,
              params: { location: l.card.id, seat: s },
            });
          }
        }
      } else if (primitive.kind === "refChooseSeatsBurn") {
        // Non-empty subsets of standing Methuselahs.
        for (let mask = 1; mask < 1 << standing.length; mask++) {
          const chosen = standing.filter((_, i) => mask & (1 << i));
          options.push({
            id: `terms:${chosen.join(",")}`,
            kind: "chooseTerms",
            label: `Choose: ${chosen.join(", ")}`,
            params: { seats: chosen.join(",") },
          });
        }
      }
      if (primitive.kind === "refExpelMinions") {
        // "Choose up to two minions" — every subset of that size or
        // smaller, the empty one included: "up to" permits none, and the
        // legal-move generator does not get to leave a legal choice out.
        const all = ops_allMinionIds(state);
        const subsets: string[][] = [[]];
        for (let i = 0; i < all.length; i++) {
          subsets.push([all[i]!]);
          for (let j = i + 1; j < all.length; j++) {
            if (primitive.upTo >= 2) subsets.push([all[i]!, all[j]!]);
          }
        }
        for (const chosen of subsets) {
          options.push({
            id: `terms:${chosen.join(",") || "none"}`,
            kind: "chooseTerms",
            label: chosen.length === 0 ? "Choose nobody" : `Expel: ${chosen.join(", ")}`,
            params: { minions: chosen.join(",") },
          });
        }
      }
      if (primitive.kind === "refLockAndAllocate") {
        // "Choose X ready unlocked Anarchs you control and allocate 2X
        // points among one or more Methuselahs, locations, and equipment."
        // Both halves ride in the option id: X is not known until the
        // Anarchs are chosen, so the two cannot be separate decisions (§4).
        const caller = state.seats.find((s) => s.id === frame.caller);
        const pool = (caller?.minions ?? []).filter(
          (m) => isReady(m) && !m.locked && m.sect === primitive.sect,
        );
        // Recipients: every standing Methuselah (uncapped — a point is
        // 1 pool), plus every location and equipment in play (capped at 1
        // — a point BURNS the card, so a second is wasted).
        const cards: string[] = [];
        const capsFor: number[] = standing.map(() => Infinity);
        for (const s of state.seats) {
          if (s.ousted) continue;
          for (const p of s.permanents) {
            if (p.tags.includes("location")) cards.push(`card:${p.card.id}`);
          }
          for (const m of s.minions) {
            for (const p of m.attached) {
              if (p.tags.includes("equipment")) cards.push(`card:${p.card.id}`);
            }
          }
        }
        const targets = [...standing, ...cards];
        const caps = [...capsFor, ...cards.map(() => 1)];
        for (const subset of nonEmptySubsets(pool.map((m) => m.id))) {
          const points = subset.length * primitive.pointsEach;
          for (const alloc of enumerateAllocations(targets, points, 1, caps)) {
            const s = allocToParams(alloc);
            options.push({
              id: `terms:${subset.join(",")}:${s}`,
              kind: "chooseTerms",
              label: `Lock ${subset.join(", ")}; allocate ${s}`,
              params: { minions: subset.join(","), alloc: s },
            });
          }
        }
      }
      return options; // refBurnPerMinion: no terms
    },

    applyReferendum(frame, ops) {
      if (!primitive) return;
      const standing = ops.state.seats.filter((s) => !s.ousted);
      switch (primitive.kind) {
        case "refBurnPerMinion": {
          for (const s of standing) {
            const n = s.minions.filter((m) => !primitive.lockedOnly || m.locked).length;
            if (n > 0) ops.emit({ type: "PoolBurned", seat: s.id, amount: n });
          }
          break;
        }
        case "refAllocateBurn": {
          // Terms may be absent when no legal choice existed (the
          // referendum then passes with no effect).
          const alloc = frame.terms["alloc"];
          if (!alloc) break;
          for (const [seat, x] of parseAlloc(alloc)) {
            ops.emit({ type: "PoolBurned", seat, amount: x });
          }
          // "…and the chosen Methuselah gains 1 pool" (§2).
          const chosen = frame.terms["chosen"];
          if (primitive.beneficiary && chosen) {
            ops.emit({
              type: "PoolGained",
              seat: chosen,
              amount: primitive.beneficiary.gainPool,
            });
          }
          break;
        }
        case "refSectPayout": {
          for (const s of standing) {
            const anarchs = s.minions.filter(
              (m) => m.kind === "vampire" && m.sect === primitive.sect && isReady(m),
            );
            // The two halves count DIFFERENT things: every qualifying
            // vampire gains blood, but the Methuselah gains once (§3).
            for (const m of anarchs) {
              if (primitive.blood > 0) {
                ops.emit({ type: "BloodGained", minion: m.id, amount: primitive.blood });
              }
            }
            if (anarchs.length > 0 && primitive.poolPerController > 0) {
              ops.emit({
                type: "PoolGained",
                seat: s.id,
                amount: primitive.poolPerController,
              });
            }
          }
          break;
        }
        case "refClanBoon": {
          const clan = frame.terms["clan"];
          if (!clan) break;
          for (const s of standing) {
            // "For each VAMPIRE of the chosen clan" — an ally has no clan
            // at all, so it is excluded by construction (§1).
            const n = s.minions.filter((m) => m.kind === "vampire" && m.clan === clan).length;
            if (n > 0) {
              ops.emit({
                type: "PoolGained",
                seat: s.id,
                amount: n * primitive.poolPerVampire,
              });
            }
          }
          break;
        }
        case "refBurnSeatOrLocation": {
          const seat = frame.terms["seat"];
          const location = frame.terms["location"];
          if (seat) ops.emit({ type: "PoolBurned", seat, amount: primitive.poolBurn });
          // The location can have left play between the terms and the
          // tally, so this is a find rather than an assumption.
          if (location && entryStillInPlay(ops.state, location)) ops.burnPermanent(location);
          break;
        }
        case "refAttachToChosen": {
          if (!frame.cardInstanceId) break;
          // The card's own later referendum ("Camarilla vampires can call
          // a referendum to burn this card") is the same instance —
          // `fromCardInPlay` is what tells the two apart, as War of Ages
          // established.
          if (frame.fromCardInPlay) {
            ops.burnPermanent(frame.cardInstanceId);
            break;
          }
          const bearer = frame.terms["minion"];
          if (!bearer || !findMinion(ops.state, bearer)) break;
          ops.putPermanentInPlay({
            card: { id: frame.cardInstanceId, name: spec.name },
            seat: frame.caller,
            attachTo: bearer,
            statics: spec.permanent?.statics ?? {},
            tags: spec.permanent?.tags ?? [],
          });
          break;
        }
        case "refMoveLocation": {
          const location = frame.terms["location"];
          const seat = frame.terms["seat"];
          if (!location || !seat || !entryStillInPlay(ops.state, location)) break;
          ops.changePermanentControl(location, seat);
          break;
        }
        case "refPutInPlay": {
          // "Successful referendum means this card is put in play" (War of
          // Ages). The card was held aside at action resolution rather
          // than burned (`holdsCardForReferendum`), so it is here to place.
          //
          // The same handler also owns the LATER referendum its own
          // `vulnerableTo` grants ("vampires can call a referendum to burn
          // this card"), which is the same card instance — `fromCardInPlay`
          // is what tells the two apart (design §6).
          if (!frame.cardInstanceId) break;
          if (frame.fromCardInPlay) {
            ops.burnPermanent(frame.cardInstanceId);
            break;
          }
          ops.putPermanentInPlay({
            card: { id: frame.cardInstanceId, name: spec.name },
            seat: frame.caller,
            attachTo: null,
            statics: spec.permanent?.statics ?? {},
            tags: spec.permanent?.tags ?? [],
          });
          break;
        }
        case "refExpelMinions": {
          const chosen = frame.terms["minions"];
          if (!chosen) break; // "up to" — the caller may have chosen none
          for (const id of chosen.split(",")) ops.expelMinion(id);
          break;
        }
        case "refLockAndAllocate": {
          const minions = frame.terms["minions"];
          const alloc = frame.terms["alloc"];
          if (!minions || !alloc) break;
          // "…each chosen Anarch is locked" — first, so the log reads in
          // the order the card does.
          for (const id of minions.split(",")) {
            const m = findMinion(ops.state, id);
            if (m && !m.locked) ops.emit({ type: "MinionLocked", minion: id });
          }
          for (const [target, x] of parseAlloc(alloc)) {
            if (target.startsWith("card:")) {
              // "…each location or equipment allocated a point is burned."
              ops.burnPermanent(target.slice("card:".length));
            } else {
              ops.emit({ type: "PoolBurned", seat: target, amount: x });
            }
          }
          break;
        }
        case "refChooseSeatsBurn": {
          const seats = frame.terms["seats"];
          if (!seats) break;
          for (const seatId of seats.split(",")) {
            let amount = primitive.base;
            const bonus = primitive.capBonus;
            if (bonus) {
              const seat = ops.state.seats.find((s) => s.id === seatId);
              const hit = seat?.minions.some(
                (m) =>
                  m.kind === "vampire" &&
                  isReady(m) &&
                  (bonus.atMost === undefined || capacityOf(m) <= bonus.atMost) &&
                  (bonus.atLeast === undefined || capacityOf(m) >= bonus.atLeast),
              );
              if (hit) amount += bonus.extra;
            }
            ops.emit({ type: "PoolBurned", seat: seatId, amount });
          }
          break;
        }
        default:
          break;
      }
    },
  };
}

export function compileSpec(spec: CardSpec): CardHandler {
  const handler = compileByType(spec);
  // Frenzy keyword (p. 32): a hook for frenzy-referencing effects.
  if (spec.frenzy) {
    handler.isFrenzy = true;
    // …and WHICH combatant this mode is used ON, so a cancel/immunity
    // effect never has to read another card's spec. Central here for the
    // same reason as `requiresDisciplines`.
    handler.frenzyTargetsOpponent = (mode, variant) =>
      spec.modes.length > 0 &&
      frenzyTargetSide(modeOf(spec, mode, variant), "acting") === "opposing";
  }
  // "Cards requiring Fortitude / Auspex / …" — added here rather than in
  // each compiler so every spec-compiled card answers the question and no
  // card author has to remember it (docs/discipline-filtered-design.md §2).
  // Total by construction: this runs on EVERY card play, so a spec with
  // no modes must answer "requires nothing" rather than throw.
  handler.requiresDisciplines = (mode, variant) =>
    spec.modes.length === 0 ? [] : modeDisciplines(modeOf(spec, mode, variant));
  // The printed type line, for cancel-as-played effects that name a type.
  // A dual-typed Action Modifier/Reaction really is a reaction card, so it
  // counts as one however this particular play is being made.
  if (spec.cardType === "reaction" || spec.cardType === "modifierOrReaction") {
    handler.isReactionCard = true;
  }
  handler.modeCombatLimit = (mode, variant) =>
    spec.modes.length > 0 &&
    modeOf(spec, mode, variant).usable?.includes("oncePerCombatAtSuperior")
      ? "combat"
      : undefined;
  // "Unique." and "which printed versions could this minion bring into
  // play" — both asked by a DIFFERENT card ("equip this vampire with a
  // non-unique equipment from your hand"), which has no reference to this
  // spec. Central here for the same reason as `costTypes` below.
  // docs/play-from-hand-design.md §7
  if (spec.unique) handler.isUnique = true;
  handler.modesPlayableBy = (m, ignoreRequirements) => {
    if (!ignoreRequirements && !meetsRequirements(m, spec)) return [];
    if (spec.modes.length === 0) return ["basic"];
    return spec.modes
      .filter((mode) => ignoreRequirements || canPlayMode(m, mode, spec))
      .map((mode) => mode.level);
  };
  // The types a play-cost modifier can key on. Central for the same
  // reason as `requiresDisciplines` (docs/play-cost-design.md §2).
  handler.costTypes = (mode, variant) => {
    const types = [...COST_TYPES_BY_CARD_TYPE[spec.cardType]];
    // "Strike cards" is narrower than a type line: a combat card whose
    // CHOSEN mode sets a strike (Ensnare a Beast names these).
    if (spec.modes.length > 0) {
      const m = modeOf(spec, mode, variant);
      if (combatWindowFor(m) === "combat.chooseStrike") types.push("strike");
    }
    return types;
  };
  // "The blocking minion's controller can burn 1 pool to cancel this card
  // as it is played" (True Love's Face). Computed from the STATE, not the
  // option's params: "the blocking minion" is a fact about the live block
  // attempt (docs/cheap-tail-design.md §6).
  if (spec.payToCancel) {
    const ptc = spec.payToCancel;
    handler.payToCancelFor = (state, seat) => {
      const extra = ptc.discardCombatCards
        ? { discardCombatCards: ptc.discardCombatCards }
        : {};
      if (ptc.who === "opposingMinion") {
        // "THEY can discard…" on a combat card is the other combatant's
        // controller — the seat playing the card is the one side, so the
        // payer is whichever combatant is not theirs.
        const cf = state.frames.find((f) => f.kind === "combat");
        if (cf?.kind !== "combat") return null;
        const foe = cf.actingSeat === seat ? cf.opposingSeat : cf.actingSeat;
        return { seat: foe, pool: ptc.pool, ...extra };
      }
      const ba = state.frames.find((f) => f.kind === "blockAttempt");
      if (ba?.kind !== "blockAttempt") return null;
      const blocker = findMinion(state, ba.blocker);
      if (!blocker) return null;
      return { seat: blocker.controller, pool: ptc.pool, ...extra };
    };
  }
  // "Cancel a STRIKE card as it is played" (The Vozhd of Gravesend) — the
  // same question `costTypes` already answers, exposed on its own so it
  // can be stamped onto the card-play frame (docs/vozhd-allies-design.md
  // §5). Per MODE: a dual-mode combat card can have one strike mode and
  // one that is not.
  handler.isStrikeCard = (mode, variant) => {
    if (spec.modes.length === 0) return false;
    return combatWindowFor(modeOf(spec, mode, variant)) === "combat.chooseStrike";
  };
  // Printed keywords ("Grapple.", "Aim."), central for the same reason as
  // the queries above (docs/weapon-riders-design.md §5).
  handler.cardKeywords = () => spec.keywords ?? [];
  // What this card becomes once in play. Two type compilers set these;
  // every other card that carries a `permanent` block — a political
  // action that attaches itself (Archon), an action that puts itself in
  // play — answered `undefined`, which is the silent-default failure
  // `backfillCentralQueries` was written for.
  if (spec.permanent) {
    handler.permanentStatics ??= spec.permanent.statics;
    handler.permanentTags ??= spec.permanent.tags ?? [];
  }
  // The clan half of the "Requires a …" line, central for exactly the same
  // reason ("after a successful action requiring HECATA or [obl]" —
  // Cappadocian Crypt; docs/blood-locations-design.md §5).
  handler.requiresClans = () => spec.requiresClan ?? [];
  // "…one card in your ash heap REQUIRING AN ANARCH" (Garibaldi-Meucci
  // Museum) — the exact sibling of requiresClans and requiresDisciplines,
  // added centrally so every spec answers it. docs/ash-heap-design.md §6
  handler.requiresSects = () => spec.requiresSect ?? [];
  // Recurring pool drains and their removal clauses
  // (docs/pool-drain-design.md). Added centrally, because the six cards
  // that carry them are a Master, two Actions and a Political Action —
  // the mechanism crosses card types, so no one compiler owns it.
  const perm = spec.permanent;
  /**
   * ChoiceFrame hooks, keyed by `frame.key`.
   *
   * Two independent spec clauses now raise choices (a search and a
   * store), and assigning `handler.choiceOptions` from each would mean
   * the second silently clobbered the first on any card carrying both.
   * That is the `POLLING_ONLY_EFFECTS` failure mode — a drift that only
   * shows up when a card finally combines the two — so they register by
   * key and one dispatcher reads the map.
   */
  const choiceByKey: Record<
    string,
    {
      options: (frame: ChoiceFrame, state: GameState, registry: HandlerRegistry) => LegalOption[];
      apply: (
        frame: ChoiceFrame,
        choice: Extract<LegalOption, { kind: "answerChoice" }>,
        ops: EngineOps,
      ) => void;
    }
  > = {};

  // "This vampire can burn N blood to be IMMUNE to this damage" (Rutor's
  // Hand superior). The engine raises this frame from the
  // after-resolution damage loop, INSTEAD of inflicting, because the
  // question has to precede the damage.
  //
  // Registered ONLY for a spec that carries `optOutBlood`. Registering it
  // for every card would make `choiceByKey` non-empty everywhere, and the
  // dispatcher at the end of this function installs on exactly that
  // condition — so every card whose choice handling comes from elsewhere
  // would have it overwritten. That is the wraith/zombie wave's own bug
  // from the other side, and it broke Enthrall and Propaganda the first
  // time this was written (docs/ledger-closeout.md §10).
  if (
    spec.modes.some((m) =>
      m.effects.some((e) => e.kind === "selfDamageAfterAction" && e.optOutBlood !== undefined),
    )
  ) {
    choiceByKey["damageOptOut"] = {
    options: (frame) => {
      const blood = frame.params["blood"] ?? "0";
      const amount = frame.params["amount"] ?? "0";
      return [
        {
          id: `choice:${spec.name}:${frame.cardId}:damageOptOut:pay`,
          kind: "answerChoice" as const,
          label: `${spec.name}: burn ${blood} blood to be immune`,
          params: { pay: "1" },
        },
        {
          id: `choice:${spec.name}:${frame.cardId}:damageOptOut:take`,
          kind: "answerChoice" as const,
          label: `Take ${amount} aggravated damage`,
          params: { pay: "" },
        },
      ];
    },
      apply: (frame, choice, ops) => {
        const minion = frame.params["minion"] ?? "";
        const amount = Number(frame.params["amount"] ?? "0");
        const aggravated = frame.params["aggravated"] === "1";
        if (choice.params["pay"]) {
          const blood = Number(frame.params["blood"] ?? "0");
          if (blood > 0) ops.emit({ type: "BloodBurned", minion, amount: blood });
          return;
        }
        ops.applyEnvironmentalDamage(minion, amount, aggravated);
      },
    };
  }

  // "Search your library for an equipment card and equip this vampire
  // with it" — the choice is raised at RESOLUTION (p. 48), so its options
  // and its answer live here rather than in the option id.
  const searchMode = spec.modes.find((m) =>
    m.effects.some((e) => e.kind === "searchEquip"),
  );
  if (searchMode) {
    const eff = searchMode.effects.find((e) => e.kind === "searchEquip") as Extract<
      EffectPrimitive,
      { kind: "searchEquip" }
    >;
    choiceByKey["searchEquip"] = {
      options: (frame, state, registry) => {
      const seat = getSeat(state, frame.seat);
      const bearer = findMinion(state, frame.params["minion"] ?? "");
      const out: LegalOption[] = [];
      for (const c of seat.library) {
        if (!searchMatches(c, registry, eff.cardTypes, false)) continue;
        const h = registry[c.name]!;
        // "Requirements and cost apply as normal": a card this vampire
        // could not equip with is not a legal find.
        if (!bearer || (h.modesPlayableBy?.(bearer) ?? []).length === 0) continue;
        const cost = playCostFor(
          state,
          {
            name: h.name,
            bloodCost: h.bloodCost,
            poolCost: h.poolCost ?? 0,
            types: h.costTypes?.(null, undefined) ?? [],
            requires: h.requiresDisciplines?.(null, undefined) ?? [],
          },
          bearer,
          null,
          null,
          bearer.id,
          frame.seat,
        );
        if (bearer.blood < cost.blood || seat.pool <= cost.pool) continue;
        out.push({
          id: `choice:${spec.name}:${frame.cardId}:searchEquip:${c.id}`,
          kind: "answerChoice",
          label: `Equip with ${c.name}`,
          params: { pick: c.id },
        });
      }
      // "You are free not to find any" — always legal, even when matches
      // exist (p. 48). Never auto-taken.
      out.push({
        id: `choice:${spec.name}:${frame.cardId}:searchEquip:none`,
        kind: "answerChoice",
        label: "Find nothing",
        params: { pick: "none" },
      });
      return out;
      },
      apply: (frame, choice, ops) => {
      const pick = choice.params["pick"] ?? "none";
      const minion = frame.params["minion"];
      if (pick !== "none" && minion) {
        const card = getSeat(ops.state, frame.seat).library.find((c) => c.id === pick);
        const bearer = findMinion(ops.state, minion);
        if (card && bearer) {
          const mode = (ops.registry[card.name]?.modesPlayableBy?.(bearer) ?? [null])[0] ?? null;
          ops.playCardFromHand({
            cardId: pick,
            seat: frame.seat,
            minion,
            mode,
            from: { zone: "library" },
          });
        }
      }
      // "…you still shuffle the library" (p. 48), found or not.
      ops.shuffleLibrary(frame.seat);
      },
    };
  }
  // "At the end of that combat, if <who is standing>, <payoff>" — the two
  // payoffs that ask a question (docs/rush-outcome-design.md §4). The
  // rider was installed at announcement and the question is raised once
  // the combat frame has popped, so the answer lands here.
  const outcomeMode = spec.modes.find((m) =>
    m.effects.some((e) => e.kind === "actionEnterCombat" && e.outcome),
  );
  if (outcomeMode) {
    const rush = outcomeMode.effects.find(
      (e) => e.kind === "actionEnterCombat" && e.outcome,
    ) as Extract<EffectPrimitive, { kind: "actionEnterCombat" }>;
    const eff = rush.outcome!.effect;
    if (eff.kind === "attachToActor") {
      choiceByKey["attachOutcome"] = {
        options: (frame) => {
          const minion = frame.params["minion"];
          if (!minion) return [];
          return [
            {
              id: `choice:${spec.name}:${frame.cardId}:attachOutcome:yes`,
              kind: "answerChoice",
              label: `Put ${spec.name} on the acting vampire`,
              params: { minion, take: "yes" },
            },
            // "You CAN": declining is a real answer, not a pass — a pass
            // would pop the frame without calling apply, and the card
            // (held back from the ash heap at resolution) would vanish.
            {
              id: `choice:${spec.name}:${frame.cardId}:attachOutcome:no`,
              kind: "answerChoice",
              label: `Decline (burn ${spec.name})`,
              params: { minion, take: "no" },
            },
          ];
        },
        apply: (frame, choice, ops) => {
          const minion = choice.params["minion"];
          if (choice.params["take"] === "yes" && minion && findMinion(ops.state, minion)) {
            ops.putPermanentInPlay({
              card: { id: frame.cardId, name: spec.name },
              seat: frame.seat,
              attachTo: minion,
              statics: eff.statics,
              tags: eff.tags ?? [spec.name],
            });
            return;
          }
          ops.emit({ type: "CardBurned", cardId: frame.cardId, name: spec.name });
        },
      };
    }
    if (eff.kind === "bloodToUncontrolled") {
      choiceByKey["bloodToUncontrolled"] = {
        options: (frame, state) => {
          const amount = Number(frame.params["amount"] ?? "0");
          const clan = frame.params["clan"];
          return getSeat(state, frame.seat)
            .uncontrolled.filter((u) => clan === undefined || u.card.clan === clan)
            .map((u) => ({
              id: `choice:${spec.name}:${frame.cardId}:bloodToUncontrolled:${u.card.id}`,
              kind: "answerChoice" as const,
              label: `Add ${amount} blood to ${u.card.name}`,
              params: { pick: u.card.id },
            }));
        },
        apply: (frame, choice, ops) => {
          const pick = choice.params["pick"];
          if (!pick) return;
          ops.emit({
            type: "UncontrolledBloodAdded",
            seat: frame.seat,
            minion: pick,
            amount: Number(frame.params["amount"] ?? "0"),
          });
        },
      };
    }
  }
  // "…the target Methuselah discards N cards of their choice" (Shroud of
  // Decay). Repeated, non-optional: the target picks WHICH cards go, not
  // whether. docs/ash-heap-design.md §6
  if (spec.modes.some((m) => m.effects.some((e) => e.kind === "targetDiscardsOnBleed"))) {
    choiceByKey["targetDiscard"] = {
      options: (frame, state) =>
        getSeat(state, frame.seat).hand.map((c) => ({
          id: `choice:${spec.name}:${frame.cardId}:targetDiscard:${c.id}`,
          kind: "answerChoice" as const,
          label: `Discard ${c.name}`,
          params: { pick: c.id, left: frame.params["left"] ?? "1" },
        })),
      apply: (frame, choice, ops) => {
        const pick = choice.params["pick"];
        if (!pick) return;
        // REPLACED. p. 7 is categorical: "whenever an effect changes your
        // hand size or adds or removes cards from your hand, immediately
        // discard down to or draw up to match your hand size." Only a card
        // that says otherwise (Mirror Walk) leaves the hand short, and this
        // one does not. It passed `false` until 2026-09-02.
        ops.discardFromHand(frame.seat, pick, true);
        const left = Number(choice.params["left"] ?? "1") - 1;
        // Ask again until the count is met or the hand runs out — the
        // repeated-frame shape, re-raised rather than looped, so each
        // answer is its own decision in the command log.
        if (left > 0 && getSeat(ops.state, frame.seat).hand.length > 0) {
          ops.raiseChoice({
            seat: frame.seat,
            cardName: spec.name,
            cardId: frame.cardId,
            key: "targetDiscard",
            params: { left: String(left) },
          });
        }
      },
    };
  }
  // "Look at your prey's hand and discard one card of your choice from it"
  // (Revelations basic) — the frame is addressed to the ACTOR and its
  // options name another seat's cards, which is the whole point of the
  // card. docs/last-buildable-design.md §2
  if (spec.modes.some((m) => m.effects.some((e) => e.kind === "peekAndDiscard"))) {
    choiceByKey["peekDiscard"] = {
      options: (frame, state) => {
        const victim = frame.params["victim"];
        if (!victim) return [];
        return getSeat(state, victim).hand.map((c) => ({
          id: `choice:${spec.name}:${frame.cardId}:peekDiscard:${c.id}`,
          kind: "answerChoice" as const,
          label: `Discard ${c.name} from ${victim}'s hand`,
          params: { pick: c.id, victim, left: frame.params["left"] ?? "1" },
        }));
      },
      apply: (frame, choice, ops) => {
        const pick = choice.params["pick"];
        const victim = choice.params["victim"];
        if (!pick || !victim) return;
        // Replaced, p. 7: a card leaving a hand is drawn back up whatever
        // took it out.
        ops.discardFromHand(victim, pick, true);
        const left = Number(choice.params["left"] ?? "1") - 1;
        if (left > 0 && getSeat(ops.state, victim).hand.length > 0) {
          ops.raiseChoice({
            seat: frame.seat,
            cardName: spec.name,
            cardId: frame.cardId,
            key: "peekDiscard",
            params: { victim, left: String(left) },
          });
        }
      },
    };
  }
  // "If the bleed is successful, you can lock a minion controlled by the
  // target Methuselah" (Break the Bonds) — raised only when several are
  // legal; one is automatic, none does nothing (the Brujah Debate
  // precedent). docs/taking-actions-design.md §7
  if (spec.modes.some((m) => m.effects.some((e) => e.kind === "lockTargetMinionOnBleed"))) {
    choiceByKey["lockTarget"] = {
      options: (frame, state) => {
        const out: LegalOption[] = [];
        for (const s of state.seats) {
          if (s.ousted) continue;
          for (const m of s.minions) {
            if (!isReady(m) || m.locked) continue;
            // The frame's seat is the ACTOR's; the lockable minions
            // belong to the bleed target, recorded when it was raised.
            if (s.id !== frame.params["target"]) continue;
            out.push({
              id: `choice:${spec.name}:${frame.cardId}:lockTarget:${m.id}`,
              kind: "answerChoice" as const,
              label: `Lock ${m.name}`,
              params: { pick: m.id },
            });
          }
        }
        return out;
      },
      apply: (_frame, choice, ops) => {
        const pick = choice.params["pick"];
        if (pick && findMinion(ops.state, pick)) {
          ops.emit({ type: "MinionLocked", minion: pick });
        }
      },
    };
  }
  // "…then move the same number of cards from your hand to the bottom of
  // your library" (Heart of Nizchetus). Repeated and non-optional: the
  // player picks WHICH cards go, not whether — the bury is the price of
  // the draw, one sentence and one ability (docs/cheap-tail-design.md §5).
  if (perm?.unlockDrawBury) {
    choiceByKey["bury"] = {
      options: (frame, state) =>
        getSeat(state, frame.seat).hand.map((c) => ({
          id: `choice:${spec.name}:${frame.cardId}:bury:${c.id}`,
          kind: "answerChoice" as const,
          label: `Bury ${c.name}`,
          params: { pick: c.id, left: frame.params["left"] ?? "1" },
        })),
      apply: (frame, choice, ops) => {
        const pick = choice.params["pick"];
        if (!pick) return;
        ops.buryInLibrary(frame.seat, pick);
        const left = Number(choice.params["left"] ?? "1") - 1;
        if (left > 0 && getSeat(ops.state, frame.seat).hand.length > 0) {
          ops.raiseChoice({
            seat: frame.seat,
            cardName: spec.name,
            cardId: frame.cardId,
            key: "bury",
            params: { left: String(left) },
          });
        }
      },
    };
  }
  // "For each counter on this card, that Methuselah burns 1 pool or
  // <something else>" — one unit at a time, asked of the payer
  // (docs/unlock-tolls-design.md §2). The rulebook rules Smiling Jack by
  // name: the units "mix between multiple vampires and the pool", so this
  // is a repeated one-unit question, not a split chosen up front.
  if (perm?.unlockToll) {
    const toll = perm.unlockToll;
    choiceByKey["unlockToll"] = {
      options: (frame, state) => {
        const seat = getSeat(state, frame.seat);
        const left = frame.params["left"] ?? "1";
        const of = ` (${left} left)`;
        // Pool is always payable. A Methuselah who cannot afford it is a
        // Methuselah being ousted, which is the ordinary path, not an
        // illegal option.
        const out: LegalOption[] = [
          {
            id: `choice:${spec.name}:${frame.cardId}:unlockToll:pool`,
            kind: "answerChoice" as const,
            label: `Burn 1 pool${of}`,
            params: { pay: "pool", left },
          },
        ];
        if (toll.alternative === "blood") {
          for (const m of seat.minions) {
            // "…or a VAMPIRE blood", and "failing to burn 1 blood from an
            // empty vampire will not lessen the obligation" (p. 50) — so
            // an empty vampire is not a way to pay at all.
            if (m.kind !== "vampire" || !isReady(m) || m.blood < 1) continue;
            out.push({
              id: `choice:${spec.name}:${frame.cardId}:unlockToll:blood:${m.id}`,
              kind: "answerChoice" as const,
              label: `Burn 1 blood from ${m.name}${of}`,
              params: { pay: "blood", pick: m.id, left },
            });
          }
        } else if (toll.alternative === "randomDiscard" && seat.hand.length > 0) {
          out.push({
            id: `choice:${spec.name}:${frame.cardId}:unlockToll:hand`,
            kind: "answerChoice" as const,
            label: `Burn a card at random from your hand${of}`,
            params: { pay: "hand", left },
          });
        } else if (
          toll.alternative === "removeAshHeapCard" &&
          // "a LIBRARY card at random in their ash heap" (The Gate of
          // Acheron) — a burnt vampire is in the heap too and is not one.
          (seat.ashHeap ?? []).some((c) => !c.crypt)
        ) {
          out.push({
            id: `choice:${spec.name}:${frame.cardId}:unlockToll:ash`,
            kind: "answerChoice" as const,
            label: `Remove a card at random from your ash heap${of}`,
            params: { pay: "ash", left },
          });
        }
        return out;
      },
      apply: (frame, choice, ops) => {
        const seat = getSeat(ops.state, frame.seat);
        switch (choice.params["pay"]) {
          case "blood": {
            const pick = choice.params["pick"];
            if (pick && findMinion(ops.state, pick)) {
              ops.emit({ type: "BloodBurned", minion: pick, amount: 1 });
            }
            break;
          }
          case "hand": {
            if (seat.hand.length > 0) {
              const card = seat.hand[ops.randomIndex(seat.hand.length)]!;
              // Replaced: "whenever an effect … removes cards from your
              // hand, immediately … draw up to match your hand size"
              // (p. 7). Unlike a discard-DOWN, which is a hand-size cut.
              ops.discardFromHand(frame.seat, card.id, true);
            }
            break;
          }
          case "ash": {
            const heap = (seat.ashHeap ?? []).filter((x) => !x.crypt);
            if (heap.length > 0) {
              ops.removeFromAshHeap(frame.seat, heap[ops.randomIndex(heap.length)]!.id);
            }
            break;
          }
          default:
            ops.emit({ type: "PoolBurned", seat: frame.seat, amount: 1 });
        }
        const left = Number(choice.params["left"] ?? "1") - 1;
        // The repeated-frame shape (Shroud of Decay's targetDiscard): one
        // frame at a time, so every option list is computed against the
        // board the previous answer left behind.
        if (left > 0 && !getSeat(ops.state, frame.seat).ousted) {
          ops.raiseChoice({
            seat: frame.seat,
            cardName: spec.name,
            cardId: frame.cardId,
            key: "unlockToll",
            params: { left: String(left) },
          });
        }
      },
    };
  }
  // Out-of-play stores on a card in play (docs/library-search-design.md
  // §5–§7). Central, because the three cards that carry one are two
  // Masters and an Equipment.
  if (perm?.store) {
    const st = perm.store;
    if (st.fillOnEntry) {
      const fill = st.fillOnEntry;
      handler.onEnterPlay = (entry, owner, ops) => {
        if (fill.from === "libraryTop") {
          for (let i = 0; i < fill.count; i++) {
            ops.storeCard({ holder: entry.card.id, from: "library", faceUp: st.faceUp });
          }
          return;
        }
        // "Search your library for up to three …" — a real search, so it
        // is asked, may find nothing, and shuffles either way (p. 14).
        ops.raiseChoice({
          seat: entry.controller ?? owner.seat,
          cardName: spec.name,
          cardId: entry.card.id,
          key: "searchStore",
          // NOT optional: declining an optional ChoiceFrame pops it without
          // calling applyChoice, which would skip the shuffle p. 14 makes
          // mandatory. "Find nothing" is the decline, and it shuffles.
          optional: false,
        });
      };
    }
    if (st.redirectsDraw) {
      handler.canRedirectDraw = (entry, owner, state) => {
        if (!st.requiresReadyBearer) return true;
        // "While this Ravnos is ready" — the equipment's bearer.
        const m = owner.minion === null ? null : findMinion(state, owner.minion);
        return m !== null && isReady(m);
      };
    }
    // "During your unlock phase, you can move the top card of your library
    // to this equipment"; "during your master phase, you can put a ghoul
    // from your hand on this location."
    if (st.addTopInUnlockPhase || st.addFromHandInMasterPhase || st.playableFrom) {
      handler.abilityOptions = (entry, owner, ctx) => {
        const controller = entry.controller ?? owner.seat;
        if (ctx.seat !== controller) return [];
        const seat = getSeat(ctx.state, controller);
        const out: LegalOption[] = [];
        if (
          st.addTopInUnlockPhase &&
          ctx.window === "turn.unlock" &&
          ctx.turnSeat === controller &&
          seat.library.length > 0
        ) {
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:addTop`,
            kind: "useAbility",
            label: `${spec.name}: move the top library card onto it`,
            source: entry.card.id,
            params: { act: "addTop" },
          });
        }
        const add = st.addFromHandInMasterPhase;
        if (add && ctx.window === "turn.master" && ctx.turnSeat === controller) {
          for (const c of seat.hand) {
            const h = ctx.registry[c.name];
            if (!h) continue;
            const types = h.costTypes?.(null, undefined) ?? [];
            if (add.cardTypes && !add.cardTypes.some((t) => types.includes(t))) continue;
            if ((add.tags ?? []).some((t) => !(h.permanentTags ?? []).includes(t))) continue;
            out.push({
              id: `ability:${spec.name}:${entry.card.id}:store:${c.id}`,
              kind: "useAbility",
              label: `${spec.name}: put ${c.name} on it`,
              source: entry.card.id,
              params: { act: "store", card: c.id },
            });
          }
        }
        // "…can play cards from this location as if from your hand": the
        // play-from-hand machinery with the source pile swapped (§7).
        const pf = st.playableFrom;
        if (pf && ctx.window === "turn.minion" && (entry.stored ?? []).length > 0) {
          for (const m of seat.minions) {
            if (pf.clan !== undefined && m.clan !== pf.clan) continue;
            if (!canAct(m)) continue;
            for (const c of entry.stored ?? []) {
              const h = ctx.registry[c.name];
              if (!h) continue;
              for (const mode of h.modesPlayableBy?.(m) ?? []) {
                const cost = playCostFor(
                  ctx.state,
                  {
                    name: h.name,
                    bloodCost: h.bloodCost,
                    poolCost: h.poolCost ?? 0,
                    types: h.costTypes?.(mode, undefined) ?? [],
                    requires: h.requiresDisciplines?.(mode, undefined) ?? [],
                  },
                  m,
                  ctx.action,
                  ctx.combat,
                  m.id,
                  ctx.seat,
                );
                if (m.blood < cost.blood || seat.pool <= cost.pool) continue;
                out.push({
                  id: `ability:${spec.name}:${entry.card.id}:play:${m.id}:${c.id}:${mode ?? "-"}`,
                  kind: "useAbility",
                  label: `${m.name}: play ${c.name} from ${spec.name}`,
                  source: entry.card.id,
                  params: { act: "play", minion: m.id, card: c.id, fmode: mode ?? "-" },
                });
              }
            }
          }
        }
        return out;
      };
      handler.useAbility = (entry, owner, choice, ops) => {
        const controller = entry.controller ?? owner.seat;
        const act = choice.params["act"];
        if (act === "addTop") {
          ops.storeCard({ holder: entry.card.id, from: "library", faceUp: st.faceUp });
          return;
        }
        if (act === "store") {
          ops.storeCard({
            holder: entry.card.id,
            from: "hand",
            cardId: choice.params["card"]!,
            faceUp: st.faceUp,
          });
          return;
        }
        if (act === "play") {
          const mode = choice.params["fmode"];
          ops.playCardFromHand({
            cardId: choice.params["card"]!,
            seat: controller,
            minion: choice.params["minion"]!,
            mode: mode === "-" || mode === undefined ? null : (mode as "basic" | "superior"),
            from: { zone: "store", holder: entry.card.id },
          });
          if (st.burnWhenEmpty && (entry.stored ?? []).length === 0) {
            ops.burnPermanent(entry.card.id);
          }
        }
      };
    }
    // The store's search and its draw redirect are two ChoiceFrames on
    // the same card, so they register under their own keys.
    choiceByKey["drawFrom"] = {
      options: (frame, state) => {
        const entry = allPermanents(state).find((p) => p.card.id === frame.cardId);
        const out: LegalOption[] = (entry?.stored ?? []).map((c) => ({
          id: `choice:${spec.name}:${frame.cardId}:drawFrom:${c.id}`,
          kind: "answerChoice" as const,
          label: `Draw ${c.name} from ${spec.name}`,
          params: { pick: c.id },
        }));
        out.push({
          id: `choice:${spec.name}:${frame.cardId}:drawFrom:library`,
          kind: "answerChoice",
          label: "Draw from your library as normal",
          params: { pick: "library" },
        });
        return out;
      },
      apply: (frame, choice, ops) => {
        if (choice.params["pick"] === "library") {
          // Straight to the library draw, NOT back through the ordinary
          // one, which would re-raise this very choice (§6).
          ops.drawFromLibrary(frame.seat);
          return;
        }
        ops.emit({
          type: "StoredCardDrawn",
          seat: frame.seat,
          holder: frame.cardId,
          cardId: choice.params["pick"]!,
        });
        burnEmptyStore(st, frame.cardId, ops);
      },
    };
    choiceByKey["searchStore"] = {
      options: (frame, state, registry) => {
        const fill = st.fillOnEntry;
        if (!fill) return [];
        // "Up to three" — every subset up to that size, plus "find
        // nothing", which p. 14 always allows.
        const eligible = getSeat(state, frame.seat).library.filter((c) =>
          searchMatches(c, registry, fill.cardTypes, fill.nonUniqueOnly),
        );
        const sets: string[][] = [[]];
        for (let n = 1; n <= Math.min(fill.count, eligible.length); n++) {
          for (const set of combinations(eligible.map((c) => c.id), n)) sets.push(set);
        }
        return sets.map((set) => ({
          id: `choice:${spec.name}:${frame.cardId}:searchStore:${set.join(",") || "none"}`,
          kind: "answerChoice" as const,
          label: set.length === 0 ? "Find nothing" : `Take ${set.length} card(s)`,
          params: { pick: set.join(",") || "none" },
        }));
      },
      apply: (frame, choice, ops) => {
        const pick = choice.params["pick"] ?? "none";
        if (pick !== "none") {
          for (const id of pick.split(",").filter(Boolean)) {
            ops.storeCard({
              holder: frame.cardId,
              from: "library",
              cardId: id,
              faceUp: st.faceUp,
            });
          }
        }
        // "…you still shuffle the library" even when nothing was found
        // (p. 48).
        ops.shuffleLibrary(frame.seat);
        burnEmptyStore(st, frame.cardId, ops);
      },
    };
  }
  // "Search your library (shuffle afterward), hand, and/or ash heap for a
  // Discipline master card and put it on this new vampire" — three zones
  // at once, which no earlier search reads. The Discipline masters carry
  // `tags: ["discipline"]`, so this is a tag test rather than a list of
  // six card names that could rot. docs/token-vampire-design.md §6
  if (spec.modes.some((m) => m.effects.some((e) => e.kind === "becomesVampire"))) {
    const zones: Array<"library" | "hand" | "ashHeap"> = ["library", "hand", "ashHeap"];
    const pileOf = (state: GameState, seat: SeatId, zone: (typeof zones)[number]) => {
      const s = getSeat(state, seat);
      return zone === "hand" ? s.hand : zone === "library" ? s.library : (s.ashHeap ?? []);
    };
    choiceByKey["searchDiscipline"] = {
      options: (frame, state, registry) => {
        const out: LegalOption[] = [];
        for (const zone of zones) {
          for (const c of pileOf(state, frame.seat, zone)) {
            if (!(registry[c.name]?.permanentTags ?? []).includes("discipline")) continue;
            out.push({
              id: `choice:${spec.name}:${frame.cardId}:searchDiscipline:${zone}:${c.id}`,
              kind: "answerChoice" as const,
              label: `Put ${c.name} (${zone}) on the new vampire`,
              params: { card: c.id, zone },
            });
          }
        }
        // "You are free not to find any" (p. 48) — and the shuffle still
        // happens, which is why this is an answer and not a decline.
        out.push({
          id: `choice:${spec.name}:${frame.cardId}:searchDiscipline:none`,
          kind: "answerChoice" as const,
          label: "Find nothing",
          params: { card: "none" },
        });
        return out;
      },
      apply: (frame, choice, ops) => {
        const card = choice.params["card"];
        const zone = choice.params["zone"] as "library" | "hand" | "ashHeap" | undefined;
        const minion = frame.params["minion"];
        if (card && card !== "none" && zone && minion && findMinion(ops.state, minion)) {
          ops.attachFromZone({ seat: frame.seat, cardId: card, zone, attachTo: minion });
        }
        // "If you search your library … you must shuffle it afterwards"
        // (p. 14) — either way, because the searcher looked at it.
        ops.shuffleLibrary(frame.seat);
      },
    };
  }
  // "…can burn N blood to unlock after action resolution": an OPTIONAL
  // question, so declining is a plain `pass` — which is correct here
  // precisely because declining does nothing at all (the library-search
  // lesson: an optional frame's decline never calls applyChoice).
  const unlockAfter = spec.modes
    .flatMap((m) => m.effects)
    .find((e) => e.kind === "unlockAfterResolution") as
    | Extract<EffectPrimitive, { kind: "unlockAfterResolution" }>
    | undefined;
  if (unlockAfter) {
    choiceByKey["unlockAfterResolution"] = {
      options: (frame, state) => {
        const target = findMinion(state, frame.params["target"] ?? "");
        if (!target) return [];
        return [
          {
            id: `choice:${spec.name}:${frame.cardId}:unlockAfterResolution:yes`,
            kind: "answerChoice" as const,
            label: `${spec.name}: burn ${unlockAfter.blood} blood to unlock ${target.name}`,
            params: {},
          },
        ];
      },
      apply: (frame, _choice, ops) => {
        const payer = frame.params["payer"];
        const target = frame.params["target"];
        if (!payer || !target) return;
        ops.emit({ type: "BloodBurned", minion: payer, amount: unlockAfter.blood });
        ops.emit({ type: "MinionUnlocked", minion: target });
      },
    };
  }
  // "Successful referendum means this card is put in play" — the card is
  // held aside at action resolution instead of being burned, and the
  // referendum decides (the same treatment title grants get).
  if (
    spec.modes.some((m) =>
      m.effects.some((e) => e.kind === "refPutInPlay" || e.kind === "refAttachToChosen"),
    )
  ) {
    handler.holdsCardForReferendum = true;
  }
  // A card in play whose removal clause is a referendum needs to know what
  // a passed one means. A political action CARD already has its own
  // `applyReferendum` (War of Ages handles both of its referendums there),
  // so this only fills the gap for everything else — Anarch Revolt is a
  // Master. docs/pool-drain-design.md §6
  if (perm?.vulnerableTo?.via === "politicalAction" && !handler.applyReferendum) {
    handler.applyReferendum = (frame, ops) => {
      if (frame.cardInstanceId) ops.burnPermanent(frame.cardInstanceId);
    };
  }
  if (perm?.unlockDrain || perm?.selfBurn?.whenPreyHasNoTorpor) {
    handler.onAnyUnlock = (entry, owner, unlockingSeat, ops) => {
      const controller = entry.controller ?? owner.seat;
      const prey = preyOf(ops.state, controller);
      const d = perm.unlockDrain;
      if (d) {
        const applies =
          (d.whose === "any" || unlockingSeat === prey) &&
          drainConditionHolds(ops.state, d.when, unlockingSeat, owner.minion);
        if (applies) {
          const seat = getSeat(ops.state, unlockingSeat);
          // "…for EACH vampire in torpor they control" (Augury of Doom).
          const times = d.perTorporVampire
            ? seat.minions.filter((m) => m.kind === "vampire" && m.inTorpor).length
            : 1;
          const amount = d.amount * times;
          if (amount > 0 && !seat.ousted) {
            ops.emit({ type: "PoolBurned", seat: unlockingSeat, amount });
          }
        }
      }
      // "If your prey controls no vampires in torpor … burn this card" —
      // read at the same moment, and off the same board state, as the
      // count above (design §5).
      if (perm.selfBurn?.whenPreyHasNoTorpor && unlockingSeat === prey) {
        const none = !getSeat(ops.state, prey).minions.some(
          (m) => m.kind === "vampire" && m.inTorpor,
        );
        if (none) ops.burnPermanent(entry.card.id);
      }
    };
  }
  if (perm?.unlockToll) {
    const toll = perm.unlockToll;
    // Composed rather than assigned: `unlockDrain` above owns the same
    // hook, and a card carrying both would silently lose one of them —
    // the `choiceByKey` failure mode one layer up.
    const prior = handler.onAnyUnlock;
    handler.onAnyUnlock = (entry, owner, unlockingSeat, ops) => {
      prior?.(entry, owner, unlockingSeat, ops);
      const controller = entry.controller ?? owner.seat;
      // "Each OTHER Methuselah" / "your prey" — never the controller.
      if (unlockingSeat === controller) return;
      if (toll.whose === "prey" && unlockingSeat !== preyOf(ops.state, controller)) return;
      const seat = getSeat(ops.state, unlockingSeat);
      if (seat.ousted) return;
      const units = entry.counters ?? 0;
      if (units <= 0) return;
      ops.raiseChoice({
        seat: unlockingSeat,
        cardName: spec.name,
        cardId: entry.card.id,
        key: "unlockToll",
        params: { left: String(units) },
      });
    };
  }
  if (perm?.unlockCounter) {
    const acc = perm.unlockCounter;
    const prior = handler.onControllerUnlock;
    handler.onControllerUnlock = (entry, owner, ops) => {
      prior?.(entry, owner, ops);
      const controller = entry.controller ?? owner.seat;
      if (getSeat(ops.state, controller).ousted) return;
      // "You HAVE TO move 1 pool to the card EVEN IF IT OUSTS YOU" (p. 50)
      // — so no affordability guard. That guard was there until 2026-09-02
      // and quietly stopped the card on its controller's last pool.
      if (acc.fromPool) {
        ops.emit({ type: "PoolBurned", seat: controller, amount: acc.amount });
      }
      ops.addCounters(entry.card.id, acc.amount);
    };
  }
  if (perm?.leaveReadyDrain) {
    const d = perm.leaveReadyDrain;
    handler.onLeaveReady = (entry, owner, info, ops) => {
      if (d.how !== undefined && info.how !== d.how) return;
      if (d.bearerOnly && info.minion !== owner.minion) return;
      if (getSeat(ops.state, info.controller).ousted) return;
      // The leaver's controller is read from `info`, which the engine
      // captures BEFORE the minion leaves — the reason this hook fires
      // ahead of the event (design §4).
      ops.emit({ type: "PoolBurned", seat: info.controller, amount: d.amount });
    };
  }
  if (perm?.selfBurn?.onPreyOusted) {
    const s = perm.selfBurn.onPreyOusted;
    handler.onSeatOusted = (entry, owner, oustedSeat, ops) => {
      const controller = entry.controller ?? owner.seat;
      if (preyOf(ops.state, controller) !== oustedSeat) return;
      if (s.gainPool) {
        ops.emit({ type: "PoolGained", seat: controller, amount: s.gainPool });
      }
      ops.burnPermanent(entry.card.id);
    };
  }
  // --- The wraith/zombie counter locations (docs/wraith-zombie-design.md).
  //     Wired here rather than in one type compiler, because the two cards
  //     are a Master and an Action — the pool-drain precedent.
  // "After a vampire who follows the Path of <x> you control bleeds, if the
  // bleed is successful (for 1 or more), add 1 counter to this card;
  // otherwise, burn 1 counter" + "after such a vampire performs an action,
  // you can burn 2 counters to unlock them" (Forward Momentum).
  //
  // Both clauses hang off `onActionResolved`, which fires from the single
  // `ActionResolved` emit — win or lose — with the frame still on the
  // stack, so the bleed amount is still readable.
  // docs/path-cards-design.md §5
  if (perm?.pathBleedCounters) {
    const pbc = perm.pathBleedCounters;
    const prior = handler.onActionResolved?.bind(handler);
    handler.onActionResolved = (entry, owner, info, ops) => {
      prior?.(entry, owner, info, ops);
      if (info.actionKind !== "bleed") return;
      if (info.actingSeat !== owner.seat) return;
      const actor = findMinion(ops.state, info.acting);
      if (!actor || actor.kind !== "vampire" || actor.path !== pbc.path) return;
      const af = ops.action();
      // ONE definition of "successful (for 1 or more)", used by both
      // directions — the whole reason this is a single hook. A blocked
      // bleed never transfers pool, and one reduced to 0 resolves without
      // succeeding; both burn a counter.
      const landed = info.success && af !== null && currentBleed(ops.state, af) >= 1;
      if (landed) {
        ops.addCounters(entry.card.id, pbc.amount);
      } else if ((entry.counters ?? 0) > 0) {
        // Clamped: the card names no penalty for being empty, and nothing
        // on it burns the card at zero.
        ops.addCounters(entry.card.id, -Math.min(pbc.amount, entry.counters ?? 0));
      }
    };
  }
  if (perm?.pathUnlockForCounters) {
    const puc = perm.pathUnlockForCounters;
    const priorOptions = handler.abilityOptions?.bind(handler);
    handler.abilityOptions = (entry, owner, ctx) => {
      const out: LegalOption[] = [...(priorOptions?.(entry, owner, ctx) ?? [])];
      // The window immediately before the action frame pops, so the actor
      // and what they did are both still readable.
      if (ctx.window !== "action.afterResolution" || ctx.seat !== owner.seat) return out;
      if ((entry.counters ?? 0) < puc.counters) return out;
      const af = ctx.action;
      if (!af || af.actingSeat !== owner.seat) return out;
      const actor = findMinion(ctx.state, af.acting);
      // "Performs an action" is not "performs a SUCCESSFUL action": a
      // vampire whose action was blocked has still performed one, which is
      // exactly the case the card exists for.
      if (!actor || actor.kind !== "vampire" || actor.path !== puc.path) return out;
      if (!actor.locked) return out;
      out.push({
        id: `ability:${spec.name}:${entry.card.id}:unlock`,
        kind: "useAbility",
        label: `${spec.name}: burn ${puc.counters} counters to unlock ${actor.name}`,
        source: entry.card.id,
        params: { do: "pathUnlock" },
      });
      return out;
    };
    const priorUse = handler.useAbility?.bind(handler);
    handler.useAbility = (entry, owner, choice, ops) => {
      if (choice.params["do"] !== "pathUnlock") {
        priorUse?.(entry, owner, choice, ops);
        return;
      }
      const af = ops.action();
      if (!af) return;
      ops.addCounters(entry.card.id, -puc.counters);
      ops.emit({ type: "MinionUnlocked", minion: af.acting });
    };
  }
  if (perm?.afterReferendumBurn) {
    const arb = perm.afterReferendumBurn;
    const priorOptions = handler.abilityOptions?.bind(handler);
    handler.abilityOptions = (entry, owner, ctx) => {
      const out: LegalOption[] = [...(priorOptions?.(entry, owner, ctx) ?? [])];
      // The window opens only on a PASS, so "after a referendum … passes"
      // needs no test of its own (docs/referendum-margin-design.md §2).
      if (ctx.window !== "referendum.afterResolution" || ctx.seat !== owner.seat) return out;
      if (entry.locked) return out;
      const rf = ctx.referendum;
      if (!rf || rf.callingMinion === null) return out;
      // "Called by a vampire YOU CONTROL."
      const caller = findMinion(ctx.state, rf.callingMinion);
      if (!caller || caller.controller !== owner.seat) return out;
      out.push({
        id: `ability:${spec.name}:${entry.card.id}:drain`,
        kind: "useAbility",
        label: `${spec.name}: lock to burn ${arb.amount} pool from your prey`,
        source: entry.card.id,
        params: { do: "afterRefBurn" },
      });
      return out;
    };
    const priorUse = handler.useAbility?.bind(handler);
    handler.useAbility = (entry, owner, choice, ops) => {
      if (choice.params["do"] !== "afterRefBurn") {
        priorUse?.(entry, owner, choice, ops);
        return;
      }
      ops.lockPermanent(entry.card.id);
      // "Your prey" is derived on every read: an oust rewrites the seating,
      // so who that is can change under a card that has sat in play for
      // turns (the rule docs/retainer-wave-design.md §1 states).
      ops.emit({
        type: "PoolBurned",
        seat: preyOf(ops.state, owner.seat),
        amount: arb.amount,
      });
    };
  }
  if (perm?.counterOnUndeadBurned) {
    const c = perm.counterOnUndeadBurned;
    // An ALLY is a minion: it leaves the ready region.
    const priorLeaveReady = handler.onLeaveReady?.bind(handler);
    handler.onLeaveReady = (entry, owner, info, ops) => {
      priorLeaveReady?.(entry, owner, info, ops);
      if (info.how !== "burned") return;
      const m = info.minion ? findMinion(ops.state, info.minion) : null;
      // The minion is on its way out, so it can still be read.
      if (!m || m.controller !== owner.seat || !minionHasTag(m, c.tag)) return;
      ops.addCounters(entry.card.id, c.amount);
    };
    // The printed clause says "(ally OR RETAINER)", and the retainer half
    // is deliberately not wired: `onLeavePlay` is a SELF-notification (the
    // card leaving play is the one told), so observing another card's burn
    // would need a new broadcast — and **the V5 pool contains no wraith or
    // zombie retainers at all**, so the branch would enumerate nothing.
    // The Wall Street Night precedent: written where it can be seen, built
    // when a card needs it. docs/wraith-zombie-design.md §6
  }
  // "Unlock this vampire if this is their FIRST successful recruit ally
  // action this turn" (Spectral Servitor). Counted from the event log
  // rather than stored: the log already records every announcement with
  // the announcing card's printed types (§7).
  if (spec.ally?.unlockRecruiterOnFirst) {
    const priorEnter = handler.onEnterPlay?.bind(handler);
    handler.onEnterPlay = (entry, owner, ops) => {
      priorEnter?.(entry, owner, ops);
      const af = ops.action();
      if (!af) return;
      const recruiter = findMinion(ops.state, af.acting);
      if (!recruiter) return;
      // Everything since this turn began.
      const log = ops.state.eventLog;
      let from = 0;
      for (let i = log.length - 1; i >= 0; i--) {
        if (log[i]!.type === "TurnBegan") {
          from = i;
          break;
        }
      }
      const earlier = log.slice(from).some(
        (e) =>
          e.type === "ActionAnnounced" &&
          e.acting === recruiter.id &&
          e.actionId !== af.actionId &&
          (e.cardTypes ?? []).includes("ally") &&
          log.some((r) => r.type === "ActionResolved" && r.actionId === e.actionId && r.success),
      );
      if (!earlier) ops.emit({ type: "MinionUnlocked", minion: recruiter.id });
    };
  }
  // "During your unlock phase, burn this ally" — and, at superior, "you
  // can burn 1 pool instead" (Spectral Servitor). Per-mode, so it is read
  // off the ENTRY's statics rather than the spec.
  if (
    [spec.permanent?.statics, ...spec.modes.map((m) => m.statics)].some((s) => s?.unlockSelfBurn)
  ) {
    const priorUnlock = handler.onControllerUnlock?.bind(handler);
    handler.onControllerUnlock = (entry, owner, ops) => {
      priorUnlock?.(entry, owner, ops);
      const up = entry.statics.unlockSelfBurn;
      if (!up || owner.minion === null) return;
      const pool = up.payPoolInstead;
      // "You CAN burn N pool INSTEAD": a real choice, but only when it can
      // be paid — otherwise the ally simply burns.
      if (pool !== undefined && getSeat(ops.state, owner.seat).pool > pool) {
        ops.raiseChoice({
          seat: owner.seat,
          cardName: spec.name,
          cardId: entry.card.id,
          key: "unlockUpkeep",
          params: { minion: owner.minion },
          optional: false,
        });
        return;
      }
      ops.burnMinion(owner.minion);
    };
    choiceByKey["unlockUpkeep"] = {
      options: (frame, state) => {
        const up = spec.modes
          .map((m) => m.statics?.unlockSelfBurn)
          .find((u) => u?.payPoolInstead !== undefined);
        const pool = up?.payPoolInstead ?? 1;
        const minion = findMinion(state, frame.params["minion"] ?? "");
        return [
          {
            id: `choice:${spec.name}:${frame.cardId}:unlockUpkeep:pool`,
            kind: "answerChoice" as const,
            label: `Burn ${pool} pool to keep ${minion?.name ?? spec.name}`,
            params: { pay: "pool" },
          },
          {
            id: `choice:${spec.name}:${frame.cardId}:unlockUpkeep:burn`,
            kind: "answerChoice" as const,
            label: `Burn ${minion?.name ?? spec.name}`,
            params: { pay: "burn" },
          },
        ];
      },
      apply: (frame, choice, ops) => {
        const minion = frame.params["minion"];
        if (choice.params["pay"] === "pool") {
          const up = spec.modes
            .map((m) => m.statics?.unlockSelfBurn)
            .find((u) => u?.payPoolInstead !== undefined);
          ops.emit({ type: "PoolBurned", seat: frame.seat, amount: up?.payPoolInstead ?? 1 });
          return;
        }
        if (minion && findMinion(ops.state, minion)) ops.burnMinion(minion);
      },
    };
  }
  // "After this ally enters play, burn it unless you remove an ally or
  // vampire in your ash heap from the game" (Rotting Behemoth).
  const ashCost = spec.ally?.enterPlayAshCost;
  if (ashCost) {
    const candidates = (state: GameState, seat: SeatId, registry: HandlerRegistry) =>
      (getSeat(state, seat).ashHeap ?? []).filter((c) => {
        // "…an ally OR VAMPIRE": a burnt vampire's card carries no handler
        // and so answers no printed type — it is admitted by the flag.
        if (c.crypt) return ashCost.includeCrypt === true;
        return (registry[c.name]?.costTypes?.(null, undefined) ?? []).some((t) =>
          ashCost.cardTypes.includes(t),
        );
      });
    const priorEnter = handler.onEnterPlay?.bind(handler);
    handler.onEnterPlay = (entry, owner, ops) => {
      priorEnter?.(entry, owner, ops);
      if (owner.minion === null) return;
      if (candidates(ops.state, owner.seat, ops.registry).length === 0) {
        // Nothing to pay with: the "unless" cannot be satisfied.
        ops.burnMinion(owner.minion);
        return;
      }
      ops.raiseChoice({
        seat: owner.seat,
        cardName: spec.name,
        cardId: entry.card.id,
        key: "ashCost",
        params: { minion: owner.minion },
        // NOT optional: declining an optional frame never calls
        // applyChoice, and the ally would then quietly survive unpaid.
        // "Let it burn" is an ordinary answer instead.
        optional: false,
      });
    };
    choiceByKey["ashCost"] = {
      options: (frame, state, registry) => [
        ...candidates(state, frame.seat, registry).map((c) => ({
          id: `choice:${spec.name}:${frame.cardId}:ashCost:${c.id}`,
          kind: "answerChoice" as const,
          label: `Remove ${c.name} from the game to keep ${spec.name}`,
          params: { card: c.id },
        })),
        {
          id: `choice:${spec.name}:${frame.cardId}:ashCost:none`,
          kind: "answerChoice" as const,
          label: `Let ${spec.name} burn`,
          params: { card: "none" },
        },
      ],
      apply: (frame, choice, ops) => {
        const card = choice.params["card"];
        const minion = frame.params["minion"];
        if (card && card !== "none") {
          ops.removeFromAshHeap(frame.seat, card);
          return;
        }
        if (minion && findMinion(ops.state, minion)) ops.burnMinion(minion);
      },
    };
  }
  if (perm?.unlockCountdown) {
    const uc = perm.unlockCountdown;
    const priorOptions = handler.abilityOptions?.bind(handler);
    handler.abilityOptions = (entry, owner, ctx) => {
      const out: LegalOption[] = [...(priorOptions?.(entry, owner, ctx) ?? [])];
      if (ctx.window !== "turn.unlock" || ctx.seat !== owner.seat) return out;
      if (ctx.turnSeat !== owner.seat) return out; // "during YOUR unlock phase"
      if ((entry.counters ?? 0) <= 0 || entry.usedThisPhase) return out;
      // "You can burn counters from no more than N <card>s each unlock
      // phase" — a limit across COPIES, counted over the seat's own cards
      // in play rather than stored anywhere.
      const ticked = getSeat(ctx.state, owner.seat).permanents.filter(
        (p) => p.card.name === spec.name && p.usedThisPhase,
      ).length;
      if (ticked >= uc.maxCardsPerPhase) return out;
      out.push({
        id: `ability:${spec.name}:${entry.card.id}:tick`,
        kind: "useAbility",
        label: `${spec.name}: burn a counter (${entry.counters} left)`,
        source: entry.card.id,
        params: { do: "tick" },
      });
      return out;
    };
    const priorUse = handler.useAbility?.bind(handler);
    handler.useAbility = (entry, owner, choice, ops) => {
      if (choice.params["do"] !== "tick") {
        priorUse?.(entry, owner, choice, ops);
        return;
      }
      entry.usedThisPhase = true;
      ops.addCounters(entry.card.id, -1);
      if ((entry.counters ?? 0) > 0) return;
      // "If this card has no counters, burn it and move a wraith or zombie
      // ally from your ash heap to your ready region."
      ops.burnPermanent(entry.card.id);
      const candidates = (getSeat(ops.state, owner.seat).ashHeap ?? []).filter((c) => {
        const h = ops.registry[c.name];
        return h?.isAlly === true && (h.permanentTags ?? []).some((t) => t === "wraith" || t === "zombie");
      });
      if (candidates.length === 0) return;
      ops.raiseChoice({
        seat: owner.seat,
        cardName: spec.name,
        cardId: entry.card.id,
        key: "returnAlly",
        optional: false,
      });
    };
    choiceByKey["returnAlly"] = {
      options: (frame, state, registry) =>
        (getSeat(state, frame.seat).ashHeap ?? [])
          .filter((c) => {
            const h = registry[c.name];
            return (
              h?.isAlly === true &&
              (h.permanentTags ?? []).some((t) => t === "wraith" || t === "zombie")
            );
          })
          .map((c) => ({
            id: `choice:${spec.name}:${frame.cardId}:returnAlly:${c.id}`,
            kind: "answerChoice" as const,
            label: `Return ${c.name} to your ready region`,
            params: { card: c.id },
          })),
      apply: (frame, choice, ops) => {
        const card = choice.params["card"];
        if (card) ops.returnAllyFromAshHeap(frame.seat, card);
      },
    };
  }
  if (perm?.bleedForCounter || perm?.combatGrantForCounter) {
    const bfc = perm.bleedForCounter;
    const cgc = perm.combatGrantForCounter;
    const priorOptions = handler.abilityOptions?.bind(handler);
    handler.abilityOptions = (entry, owner, ctx) => {
      const out: LegalOption[] = [...(priorOptions?.(entry, owner, ctx) ?? [])];
      if (ctx.seat !== owner.seat || (entry.counters ?? 0) <= 0) return out;

      // "During a bleed action, burn 1 counter to give a <tagged> ally you
      // control +1 bleed." The bleed amount only ever belongs to the
      // acting minion, so that is who it must be.
      if (bfc && ctx.action?.actionKind === "bleed") {
        const actor = findMinion(ctx.state, ctx.action.acting);
        if (actor && actor.controller === owner.seat && minionHasTag(actor, bfc.tag)) {
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:bleedcounter`,
            kind: "useAbility",
            label: `${spec.name}: burn a counter for +${bfc.amount} bleed`,
            source: entry.card.id,
            params: { do: "bleedcounter" },
          });
        }
      }

      // "Once each combat, burn 1 counter to give a wraith or zombie ally
      // you control 1 maneuver or press."
      if (cgc && ctx.window === "combat.beforeRange" && ctx.combat) {
        const cf = ctx.combat;
        if (!cf.usedThisCombat.includes(entry.card.id)) {
          for (const id of [cf.acting, cf.opposing]) {
            const m = findMinion(ctx.state, id);
            if (!m || m.controller !== owner.seat || !isUndeadAlly(m)) continue;
            for (const grant of cgc.grants) {
              out.push({
                id: `ability:${spec.name}:${entry.card.id}:combatgrant:${grant}:${m.id}`,
                kind: "useAbility",
                label: `${spec.name}: burn a counter to give ${m.name} 1 ${grant}`,
                source: entry.card.id,
                params: { do: "combatgrant", grant, target: m.id },
              });
            }
          }
        }
      }
      return out;
    };

    const priorUse = handler.useAbility?.bind(handler);
    handler.useAbility = (entry, owner, choice, ops) => {
      const what = choice.params["do"];
      if (what === "bleedcounter") {
        const af = ops.action();
        if (!af) return;
        ops.addCounters(entry.card.id, -1);
        ops.emit({
          type: "BleedAmountModified",
          actionId: af.actionId,
          delta: bfc!.amount,
          source: spec.name,
          limited: false,
        });
        return;
      }
      if (what === "combatgrant") {
        ops.addCounters(entry.card.id, -1);
        ops.markUsedThisCombat(entry.card.id);
        const target = choice.params["target"]!;
        if (choice.params["grant"] === "maneuver") ops.grantManeuverCreditTo(target);
        else ops.grantCombatPressToMinion(target);
        // "If this card has no counters, burn it."
        if (cgc?.burnWhenEmpty && (entry.counters ?? 0) <= 0) {
          ops.burnPermanent(entry.card.id);
        }
        return;
      }
      priorUse?.(entry, owner, choice, ops);
    };
  }
  if (perm?.masterPhaseBurn) {
    const mb = perm.masterPhaseBurn;
    // "Methuselahs can …" — every seat, not just the controller.
    handler.abilityAnySeat = true;
    handler.abilityOptions = (entry, owner, ctx) => {
      // "…during their master phase": their OWN, so the window's seat must
      // be the seat whose turn it is.
      if (ctx.window !== "turn.master" || ctx.seat !== ctx.turnSeat) return [];
      const seat = getSeat(ctx.state, ctx.seat);
      const tf = ctx.state.frames.find((f) => f.kind === "turn");
      if (mb.usesMasterAction && (tf?.kind !== "turn" || tf.masterActionsLeft <= 0)) {
        return [];
      }
      // An ability nobody can pay for is never offered. The specific
      // cards to spend ride in the option id, one option per way of
      // paying — the `paymentSplits` shape.
      const discardSets =
        mb.discardMasters === undefined
          ? [[]]
          : combinations(
              seat.hand
                .filter((c) => ctx.registry[c.name]?.isMasterCard === true)
                .map((c) => c.id),
              mb.discardMasters,
            );
      if (discardSets.length === 0) return [];
      const victims = mb.burnOwnMinion
        ? seat.minions.filter(
            (m) =>
              (mb.burnOwnMinion?.kind === undefined || m.kind === mb.burnOwnMinion.kind) &&
              (mb.burnOwnMinion?.notSect === undefined || m.sect !== mb.burnOwnMinion.notSect),
          )
        : [];
      if (mb.burnOwnMinion && victims.length === 0) return [];
      const base = `ability:${spec.name}:${entry.card.id}:razeMaster`;
      const out: LegalOption[] = [];
      for (const set of discardSets) {
        const discard = set.join(",");
        const push = (victim: MinionState | null): void => {
          const parts = [victim?.id ?? "-", discard || "-"];
          out.push({
            id: `${base}:${parts.join(":")}`,
            kind: "useAbility",
            label:
              `Burn ${spec.name} (${owner.seat}'s)` +
              (victim ? ` — burning ${victim.name}` : "") +
              (discard ? ` — discarding ${set.length} master cards` : ""),
            source: entry.card.id,
            params: {
              seat: ctx.seat,
              ...(victim ? { victim: victim.id } : {}),
              ...(discard ? { discard } : {}),
            },
          });
        };
        if (mb.burnOwnMinion) for (const m of victims) push(m);
        else push(null);
      }
      return out;
    };
    handler.useAbility = (entry, owner, choice, ops) => {
      const seatId = choice.params["seat"] ?? owner.seat;
      if (mb.usesMasterAction) ops.spendMasterAction();
      // "Discard two master cards" is a COST, not a play — but p. 7 does
      // not care why a card left the hand: "whenever an effect … removes
      // cards from your hand, immediately … draw up to match your hand
      // size." So it IS replaced; only a card that prints otherwise leaves
      // the hand short. Passed `false` until 2026-09-02.
      for (const id of (choice.params["discard"] ?? "").split(",").filter(Boolean)) {
        ops.discardFromHand(seatId, id, true);
      }
      const victim = choice.params["victim"];
      if (victim) ops.burnMinion(victim);
      ops.burnPermanent(entry.card.id);
    };
  }
  // Actions this card grants once in play, from independent spec clauses:
  // "minions can burn this card" (§4.5) and "<who> can enter combat with
  // <target>" (docs/granted-rush-design.md). A card can have both (Haven
  // Uncovered), so the providers are merged rather than overwritten:
  // options concatenate and the two dispatch hooks go to whichever
  // provider produced the option (docs/granted-rush-design.md §4).
  const providers: GrantedActionProvider[] = [];
  if (spec.permanent?.vulnerableTo) {
    providers.push({
      // act:<Name>:<cardId>:<burn|steal|shuffle|strip>:<actor>
      owns: (id) => /:(burn|steal|shuffle|strip|vote):/.test(id),
      ...vulnerableGrant(spec),
    });
  }
  if (spec.permanent?.rushGrant) {
    // act:<Name>:<cardId>:rush:<actor>:<target>
    providers.push({ owns: (id) => id.includes(":rush:"), ...permanentRushGrant(spec) });
  }
  if (spec.permanent?.bleedGrant) {
    // act:<Name>:<cardId>:bleed:<actor>
    providers.push({ owns: (id) => id.includes(":bleed:"), ...permanentBleedGrant(spec) });
  }
  if (spec.permanent?.counterGrant) {
    // act:<Name>:<cardId>:counter:<actor>
    providers.push({ owns: (id) => id.includes(":counter:"), ...permanentCounterGrant(spec) });
  }
  if (spec.permanent?.searchEquipGrant) {
    // act:<Name>:<cardId>:equip:<actor>
    providers.push({ owns: (id) => id.includes(":equip:"), ...searchEquipGrant(spec) });
  }
  if (spec.permanent?.politicalGrant) {
    // act:<Name>:<cardId>:referendum:<actor>
    const pg = politicalGrant(spec);
    providers.push({
      owns: (id) => id.includes(":referendum:"),
      actionOptions: pg.actionOptions!,
      useActionOption: pg.useActionOption!,
    });
    // A passed referendum's payout is not a granted-action provider — it
    // is keyed by the referendum's card NAME, so it goes on the handler.
    handler.applyReferendum = pg.applyReferendum!;
  }
  if (providers.length > 0) {
    if (handler.actionOptions) {
      // The ally/retainer `rush` field and bespoke handlers own their own
      // ids; they take everything the grafted clauses do not claim.
      const own: GrantedActionProvider = { owns: () => true };
      if (handler.actionOptions) own.actionOptions = handler.actionOptions.bind(handler);
      if (handler.useActionOption) own.useActionOption = handler.useActionOption.bind(handler);
      if (handler.resolveGrantedAction) {
        own.resolveGrantedAction = handler.resolveGrantedAction.bind(handler);
      }
      providers.push(own);
    }
    Object.assign(handler, mergeGrantedActions(providers));
  }
  // One dispatcher over every registered choice key, so two independent
  // clauses on the same card cannot overwrite each other's hooks.
  //
  // INSTALLED LAST, after every clause has had its chance to register:
  // it used to sit mid-function, so a clause registering a key BELOW it
  // (Split the Veil's) found no dispatcher installed at all and its
  // question was silently never asked. docs/wraith-zombie-design.md §5
  addCryptAbilities(spec, handler, choiceByKey);
  if (Object.keys(choiceByKey).length > 0) {
    handler.choiceOptions = (frame, state, registry) =>
      choiceByKey[frame.key]?.options(frame, state, registry) ?? [];
    handler.applyChoice = (frame, choice, ops) => {
      choiceByKey[frame.key]?.apply(frame, choice, ops);
    };
  }
  addLocationAbilities(spec, handler);
  addAttachedCardBehaviour(spec, handler);
  addCombatAttachBehaviour(spec, handler);
  addOpponentAttachBehaviour(spec, handler);
  addAllyAbilities(spec, handler);
  addRetainerAbilities(spec, handler);
  addEquipmentAbilities(spec, handler);
  addDeclinedBleedBonus(spec, handler);
  addOptionCost(spec, handler);
  return handler;
}

/**
 * The crypt clauses that are not plain statics (docs/crypt-wave-2.md).
 *
 * Grafted rather than assigned over, for the reason `addLocationAbilities`
 * records: a vampire can carry several of these at once, and assigning
 * `abilityOptions` is how the `choiceByKey` family of bugs starts.
 */
/** The noun for a `discardFor` payoff, for the option label. */
function saleGrantNoun(grant: string): string {
  return grant === "combatStrength" ? "strength" : grant;
}

/**
 * Does this card on the OPPOSING minion bar `me` from striking "combat
 * ends"? Unconditional for Dog Pack; Faruq's form asks whether the card's
 * controller has corrupted the striker.
 *
 * "YOUR corruption counters" is the CARD's controller, which is not
 * always the bearer's (p. 16 — the `controllerOfEntry` reading).
 * docs/crypt-wave-5.md §3
 */
function barsCombatEnds(entry: PermanentInPlay, me: MinionState): boolean {
  const bar = entry.statics.opposingCannotCombatEnds;
  if (bar === undefined || bar === false) return false;
  if (bar === true) return true;
  const owner = entry.controller;
  if (owner === undefined) return false;
  return (me.corruption?.[owner] ?? 0) > 0;
}

function addCryptAbilities(
  spec: CardSpec,
  handler: CardHandler,
  choiceByKey: Record<
    string,
    {
      options: (frame: ChoiceFrame, state: GameState, registry: HandlerRegistry) => LegalOption[];
      apply: (
        frame: ChoiceFrame,
        choice: Extract<LegalOption, { kind: "answerChoice" }>,
        ops: EngineOps,
      ) => void;
    }
  >,
): void {
  const perm = spec.permanent;
  const ua = perm?.unlockAfterAction;
  const edge = perm?.unlockForEdge;
  const afterRef = perm?.unlockAfterOwnReferendum;
  const search = perm?.searchToHand;

  // "…can unlock after performing a successful action" and its family.
  if (ua) {
    const prior = handler.onActionResolved?.bind(handler);
    handler.onActionResolved = (entry, owner, info, ops) => {
      prior?.(entry, owner, info, ops);
      const bearer = owner.minion === null ? null : findMinion(ops.state, owner.minion);
      if (!bearer || !info.success) return;
      // Nothing to do for a bearer who is not locked — unless the clause
      // unlocks somebody ELSE.
      const controller = entry.controller ?? owner.seat;
      if (ua.ownTurnOnly) {
        const tf = ops.state.frames.find((f) => f.kind === "turn");
        if (tf?.kind !== "turn" || tf.seat !== controller) return;
      }
      if (ua.oncePerTurn && entry.usedThisTurn) return;

      const actor = findMinion(ops.state, info.acting);
      if (!actor) return;
      // Whose action was it?
      if (ua.whose === "self") {
        if (actor.id !== bearer.id) return;
      } else {
        if (actor.id === bearer.id) return;
        if (actor.controller !== controller) return;
        if (ua.otherSect !== undefined && actor.sect !== ua.otherSect) return;
        if (ua.otherClan !== undefined && actor.clan !== ua.otherClan) return;
      }
      if (ua.actionKinds && !ua.actionKinds.includes(info.actionKind)) return;

      // "…an action REQUIRING <x>" is a property of the CARD played, so
      // a built-in action (a plain bleed) requires nothing and never
      // matches. Answered by the central queries, never by reading
      // another card's spec.
      const af = ops.action();
      const card = af?.card;
      if (ua.actionCardTypes || ua.requiresClan || ua.requiresDiscipline || ua.requiresPath) {
        if (!card) return;
        const h = ops.registry[card.instance.name];
        // The chosen mode, for the queries that vary by it.
        const mode = (card.params["mode"] ?? null) as "basic" | "superior" | null;
        const variant = card.params["variant"];
        if (ua.actionCardTypes) {
          const types = h?.costTypes?.(mode, variant) ?? [];
          if (!ua.actionCardTypes.some((t) => types.includes(t))) return;
        }
        if (ua.requiresClan) {
          const clans = h?.requiresClans?.() ?? [];
          if (!ua.requiresClan.some((c) => clans.includes(c))) return;
        }
        if (ua.requiresDiscipline) {
          const disc = h?.requiresDisciplines?.(mode, variant) ?? [];
          if (!ua.requiresDiscipline.some((d) => disc.includes(d))) return;
        }
        // Paths are printed on the CRYPT card, so "an action requiring
        // the Path of …" is a property of the acting vampire, not of the
        // card (docs/path-cards-design.md §0).
        if (ua.requiresPath !== undefined && actor.path !== ua.requiresPath) return;
      }

      const target = ua.unlocks === "actor" ? actor : bearer;
      if (!target.locked) return;
      if (ua.bloodCost && bearer.blood < ua.bloodCost) return;

      // The offer is registered rather than taken: every one of these
      // prints "can", and several cost blood. `addAfterResolutionUnlock`
      // raises it the instant the action is over, which is exactly "after
      // action resolution" (docs/wraith-zombie-design.md §4).
      ops.addAfterResolutionUnlock({
        payer: bearer.id,
        target: target.id,
        blood: ua.bloodCost ?? 0,
        cardName: spec.name,
        cardId: entry.card.id,
      });
      if (ua.oncePerTurn) entry.usedThisTurn = true;
    };

    // The op RAISES the question; somebody has to ANSWER it. The
    // `unlockAfterResolution` key is registered by the card effect of the
    // same name (Gifts From Hereafter), which these cards do not use — so
    // without this the frame would be raised, find no options, and pop
    // harmlessly. A question nobody answers is silence, not an error
    // (docs/crypt-wave-2.md §2).
    choiceByKey["unlockAfterResolution"] = {
      options: (frame, state) => {
        const target = findMinion(state, frame.params["target"] ?? "");
        if (!target) return [];
        const cost = ua.bloodCost ?? 0;
        return [
          {
            id: `choice:${spec.name}:${frame.cardId}:unlockAfterResolution:yes`,
            kind: "answerChoice" as const,
            label: cost > 0
              ? `${spec.name}: burn ${cost} blood to unlock ${target.name}`
              : `${spec.name}: unlock ${target.name}`,
            params: {},
          },
        ];
      },
      apply: (frame, _choice, ops) => {
        const payer = frame.params["payer"];
        const target = frame.params["target"];
        if (!payer || !target) return;
        const cost = ua.bloodCost ?? 0;
        if (cost > 0) ops.emit({ type: "BloodBurned", minion: payer, amount: cost });
        ops.emit({ type: "MinionUnlocked", minion: target });
      },
    };
  }

  // "…can search your library for a <type> card, reveal it and move it to
  // your hand as a +N stealth action." A granted action, so it announces
  // like any other and the SEARCH happens at resolution — p. 48 is
  // explicit that you do not search until the action succeeds, which is
  // also why finding nothing has to stay legal (docs/crypt-wave-2.md §3).
  if (search) {
    const priorActions = handler.actionOptions?.bind(handler);
    handler.actionOptions = (entry, owner, ctx) => {
      const out: LegalOption[] = [...(priorActions?.(entry, owner, ctx) ?? [])];
      if (ctx.window !== "turn.minion" || owner.minion === null) return out;
      if (ctx.seat !== (entry.controller ?? owner.seat)) return out;
      const actor = findMinion(ctx.state, owner.minion);
      if (!actor || !canAct(actor)) return out;
      out.push({
        id: `act:${spec.name}:${entry.card.id}:search:${actor.id}`,
        kind: "useEntryAction",
        label: `${actor.name}: search your library (${spec.name})`,
        source: entry.card.id,
        minion: actor.id,
        params: { act: "search" },
      });
      return out;
    };
    const priorUseAction = handler.useActionOption?.bind(handler);
    handler.useActionOption = (entry, owner, choice, ops) => {
      if (choice.params?.["act"] !== "search") {
        priorUseAction?.(entry, owner, choice, ops);
        return;
      }
      ops.announceEntryAction(entry, choice.minion, {
        // The effect KEY is what routes resolution back to
        // `resolveGrantedAction`. Without one, `announceEntryAction`
        // defaults to "enterCombat" and the action resolves as a no-op —
        // the search would simply never happen
        // (docs/crypt-wave-2.md §3).
        effect: { key: "searchToHand" },
        stealth: search.stealth,
      });
    };
    const priorGranted = handler.resolveGrantedAction?.bind(handler);
    handler.resolveGrantedAction = (entry, af, ops) => {
      priorGranted?.(entry, af, ops);
      ops.raiseChoice({
        seat: af.actingSeat,
        cardName: spec.name,
        cardId: entry.card.id,
        key: "searchToHand",
        // NOT optional: declining an optional frame never calls
        // `applyChoice`, and the mandatory shuffle would be skipped —
        // the library-search gate's own lesson.
        optional: false,
      });
    };
    choiceByKey["searchToHand"] = {
      options: (frame, state, registry) => {
        const out: LegalOption[] = [];
        for (const c of getSeat(state, frame.seat).library) {
          if (search.cardTypes && !searchMatches(c, registry, search.cardTypes, false)) continue;
          if (search.tag && !(registry[c.name]?.permanentTags ?? []).includes(search.tag)) {
            continue;
          }
          out.push({
            id: `choice:${spec.name}:${frame.cardId}:searchToHand:${c.id}`,
            kind: "answerChoice" as const,
            label: `Take ${c.name}`,
            params: { pick: c.id },
          });
        }
        // "You are free not to find any … you still shuffle the library"
        // (p. 48). An ordinary answer, not a decline.
        out.push({
          id: `choice:${spec.name}:${frame.cardId}:searchToHand:none`,
          kind: "answerChoice" as const,
          label: "Find nothing",
          params: { pick: "none" },
        });
        return out;
      },
      apply: (frame, choice, ops) => {
        const pick = choice.params["pick"];
        if (pick && pick !== "none") {
          const card = getSeat(ops.state, frame.seat).library.find((c) => c.id === pick);
          if (card) {
            ops.emit({
              type: "CardSearchedToHand",
              seat: frame.seat,
              cardId: card.id,
              name: card.name,
            });
          }
        }
        // "If you search your library … you must shuffle it afterwards"
        // (p. 14) — whether or not anything was found.
        ops.shuffleLibrary(frame.seat);
      },
    };
  }

  // "<This vampire> can <do Y> as a [+N stealth] [Ⓓ] action [that costs 1
  // blood]" — six crypt cards, one clause (docs/crypt-wave-5.md §1).
  const ga = perm?.grantedAction;
  if (ga) {
    /** Every legal answer to this action, each carrying its own params.
     *  Enumerated at ANNOUNCEMENT (p. 25), so a blocked action has
     *  already fixed what it would have done. */
    const answers = (
      state: GameState,
      seat: SeatId,
      actor: MinionState,
      registry: HandlerRegistry,
    ): Array<{
      key: string;
      label: string;
      params: Record<string, string>;
      targetMinion?: MinionId;
      targetPermanent?: CardInstanceId;
    }> => {
      const out: Array<{
        key: string;
        label: string;
        params: Record<string, string>;
        targetMinion?: MinionId;
        targetPermanent?: CardInstanceId;
      }> = [];
      switch (ga.do) {
        case "addBlood": {
          for (const m of getSeat(state, seat).minions) {
            if (!isReady(m)) continue;
            // An option whose WHOLE content is "gain N blood" does
            // nothing for a minion already at capacity, and taking it
            // spends a real action (docs/futile-options-design.md).
            if (!canGainBlood(m)) continue;
            out.push({
              key: `blood:${m.id}`,
              label: `add ${ga.amount ?? 1} to ${m.name}`,
              params: { target: m.id },
              targetMinion: m.id,
            });
          }
          break;
        }
        case "stealEquipment": {
          for (const s of state.seats) {
            for (const m of s.minions) {
              for (const p of m.attached) {
                if (!p.tags.includes("equipment")) continue;
                out.push({
                  key: `equip:${p.card.id}`,
                  label: `steal ${p.card.name} from ${m.name}`,
                  params: { card: p.card.id },
                  targetPermanent: p.card.id,
                });
              }
            }
          }
          break;
        }
        case "ashExchange": {
          // One option per (hand card, ash-heap card) pair: the card's
          // own text makes it a single decision (the Garibaldi shape).
          for (const give of getSeat(state, seat).hand) {
            for (const take of getSeat(state, seat).ashHeap ?? []) {
              // "A LIBRARY card in your ash heap" — burnt vampires are in
              // there too, and a vampire card has no handler.
              if (take.crypt) continue;
              out.push({
                key: `swap:${give.id}:${take.id}`,
                label: `swap ${give.name} for ${take.name}`,
                params: { give: give.id, take: take.id },
              });
            }
          }
          break;
        }
        case "reviveAlly": {
          for (const c of getSeat(state, seat).ashHeap ?? []) {
            if (c.crypt) continue;
            const h = registry[c.name];
            if (!h?.allyEntry) continue;
            // "Requiring Hecata OR Oblivion" — a UNION, the English-"and"
            // reading (docs/opposing-statics-design.md).
            const clanOk =
              ga.requiresClan !== undefined &&
              (h.requiresClans?.() ?? []).some((x) => ga.requiresClan!.includes(x));
            const discOk =
              ga.requiresDiscipline !== undefined &&
              (h.requiresDisciplines?.(null) ?? []).some((x) =>
                ga.requiresDiscipline!.includes(x),
              );
            if (ga.requiresClan || ga.requiresDiscipline) {
              if (!clanOk && !discOk) continue;
            }
            out.push({ key: `ally:${c.id}`, label: `return ${c.name}`, params: { card: c.id } });
          }
          break;
        }
        case "reorderTop": {
          if (getSeat(state, seat).library.length === 0) break;
          out.push({ key: "reorder", label: "look at your library", params: {} });
          break;
        }
        case "stripMinion": {
          for (const s of state.seats) {
            for (const m of s.minions) {
              // "From ANOTHER ready minion" — never the actor.
              if (m.id === actor.id || !isReady(m)) continue;
              if ((m.corruption?.[seat] ?? 0) > 0) {
                out.push({
                  key: `corrupt:${m.id}`,
                  label: `burn a corruption counter on ${m.name}`,
                  params: { target: m.id, what: "corruption" },
                  targetMinion: m.id,
                });
              }
              for (const p of m.attached) {
                // "A card REQUIRING A DISCIPLINE" — off the central
                // query, so a card that requires none is not a target.
                // A minion's own self-attached card requires nothing, so
                // it falls out rather than needing a rule.
                const req = registry[p.card.name]?.requiresDisciplines?.(null) ?? [];
                if (req.length === 0) continue;
                out.push({
                  key: `card:${p.card.id}`,
                  label: `burn ${p.card.name} on ${m.name}`,
                  params: { target: m.id, what: "card", card: p.card.id },
                  targetMinion: m.id,
                });
              }
            }
          }
          break;
        }
      }
      return out;
    };

    const priorGaActions = handler.actionOptions?.bind(handler);
    handler.actionOptions = (entry, owner, ctx) => {
      const out: LegalOption[] = [...(priorGaActions?.(entry, owner, ctx) ?? [])];
      if (ctx.window !== "turn.minion" || owner.minion === null) return out;
      const controller = entry.controller ?? owner.seat;
      if (ctx.seat !== controller) return out;
      const actor = findMinion(ctx.state, owner.minion);
      if (!actor || !canAct(actor)) return out;
      // The cost gates the OPTION as well as being paid: a price the
      // actor cannot meet is not a choice. Paid at RESOLUTION (p. 27),
      // so a blocked action spends nothing.
      if (ga.bloodCost !== undefined && actor.blood < ga.bloodCost) return out;
      for (const a of answers(ctx.state, controller, actor, ctx.registry)) {
        out.push({
          id: `act:${spec.name}:${entry.card.id}:granted:${actor.id}:${a.key}`,
          kind: "useEntryAction",
          label: `${actor.name}: ${a.label} (${spec.name})`,
          source: entry.card.id,
          minion: actor.id,
          params: { act: "granted", ...a.params },
        });
      }
      return out;
    };

    const priorGaUse = handler.useActionOption?.bind(handler);
    handler.useActionOption = (entry, owner, choice, ops) => {
      if (choice.params?.["act"] !== "granted") {
        priorGaUse?.(entry, owner, choice, ops);
        return;
      }
      const params = { ...choice.params };
      const target = params["target"];
      const card = params["card"];
      ops.announceEntryAction(entry, choice.minion, {
        // The effect KEY is what routes resolution; without one,
        // `announceEntryAction` defaults to "enterCombat" and the action
        // resolves as a silent no-op (docs/crypt-wave-2.md §3).
        effect: { key: "cryptGrantedAction", params },
        ...(ga.stealth !== undefined ? { stealth: ga.stealth } : {}),
        ...(ga.bloodCost !== undefined ? { cost: { blood: ga.bloodCost } } : {}),
        // Ⓓ: directed at the target's controller, who alone may block.
        ...(ga.directed && target ? { targetMinion: target } : {}),
        ...(ga.directed && card && ga.do === "stealEquipment"
          ? { targetPermanent: card }
          : {}),
        // No `noCombat` needed: the combat-on-success gate already fires
        // only for a granted effect whose key is "enterCombat", so a
        // named key opts out by construction (engine.ts `rushLike`).
      });
    };

    const priorGaResolve = handler.resolveGrantedAction?.bind(handler);
    handler.resolveGrantedAction = (entry, af, ops) => {
      priorGaResolve?.(entry, af, ops);
      if (af.grantedEffect?.key !== "cryptGrantedAction") return;
      const p = af.grantedEffect.params;
      const seat = af.actingSeat;
      switch (ga.do) {
        case "addBlood": {
          const m = p["target"] ? findMinion(ops.state, p["target"]) : null;
          if (!m) return;
          let amount = ga.amount ?? 1;
          if (ga.capped) {
            // An ally's `capacity` already holds its printed starting
            // life, so `capacityOf` is the ceiling for both kinds of
            // minion (docs/outside-combat-design.md).
            amount = Math.min(amount, Math.max(0, capacityOf(m) - m.blood));
          }
          if (amount > 0) ops.emit({ type: "BloodGained", minion: m.id, amount });
          return;
        }
        case "stealEquipment": {
          const cardId = p["card"];
          const actor = findMinion(ops.state, af.acting);
          // Both can have left play between announcement and resolution.
          if (!cardId || !actor) return;
          ops.moveAttachment(cardId, actor.id, seat);
          return;
        }
        case "ashExchange": {
          // An EXCHANGE, so no replacement draw either way.
          if (p["give"]) ops.discardFromHand(seat, p["give"], false);
          if (p["take"]) ops.takeFromAshHeap(seat, p["take"]);
          return;
        }
        case "reviveAlly": {
          if (!p["card"]) return;
          ops.returnAllyFromAshHeap(seat, p["card"]);
          // "…LOCKED": `returnAllyFromAshHeap` puts an ally into the
          // ready region unlocked (Split the Veil says nothing), so the
          // lock is this card's own clause.
          ops.emit({ type: "MinionLocked", minion: p["card"] });
          return;
        }
        case "reorderTop": {
          if (ga.unlockActor) ops.emit({ type: "MinionUnlocked", minion: af.acting });
          ops.raiseChoice({
            seat,
            cardName: spec.name,
            cardId: entry.card.id,
            key: "reorderTop",
            // Repeated and NOT optional, the `unlockToll` shape: one card
            // placed at a time and the frame re-raised, because each
            // answer changes the list the next one is chosen from.
            optional: false,
          });
          return;
        }
        case "stripMinion": {
          const m = p["target"] ? findMinion(ops.state, p["target"]) : null;
          if (!m) return;
          if (p["what"] === "corruption") ops.removeCorruption(m.id, seat, 1);
          else if (p["card"]) ops.burnPermanent(p["card"]);
          return;
        }
      }
    };

    if (ga.do === "reorderTop") {
      // "Look at and REORDER the top N cards": the player names which card
      // goes on top next, and the frame is re-raised until the window is
      // ordered. One frame at a time rather than one option per permutation
      // — 5 cards is 120 orderings, which is a decision nobody can read.
      const window = ga.amount ?? 5;
      choiceByKey["reorderTop"] = {
        options: (frame, state) => {
          const lib = getSeat(state, frame.seat).library;
          const placed = Number(frame.params?.["placed"] ?? "0");
          const n = Math.min(window, lib.length);
          if (placed >= n - 1) return [];
          return lib.slice(placed, n).map((c) => ({
            id: `choice:${spec.name}:${frame.cardId}:reorderTop:${c.id}`,
            kind: "answerChoice" as const,
            label: `Put ${c.name} at position ${placed + 1}`,
            params: { pick: c.id, placed: String(placed) },
          }));
        },
        apply: (frame, choice, ops) => {
          const placed = Number(choice.params["placed"] ?? "0");
          ops.moveLibraryCardTo(frame.seat, choice.params["pick"]!, placed);
          const lib = getSeat(ops.state, frame.seat).library;
          const n = Math.min(window, lib.length);
          if (placed + 1 < n - 1) {
            ops.raiseChoice({
              seat: frame.seat,
              cardName: spec.name,
              cardId: frame.cardId,
              key: "reorderTop",
              optional: false,
              params: { placed: String(placed + 1) },
            });
          }
        },
      };
    }
  }

  // "After a minion in combat with <this vampire> leaves the ready
  // region, their controller burns N pool" (Egidia Arrú).
  const leaveDrain = perm?.combatLeaveDrain;
  if (leaveDrain !== undefined) {
    const priorLeave = handler.onCombatLeave?.bind(handler);
    handler.onCombatLeave = (entry, owner, info, ops) => {
      priorLeave?.(entry, owner, info, ops);
      // `other` is the survivor: this fires only when the vampire this
      // card sits on is the one still standing.
      if (info.other !== owner.minion) return;
      const leaver = findMinion(ops.state, info.leaver);
      // The minion is on its way out, so its controller still reads.
      if (!leaver) return;
      ops.emit({ type: "PoolBurned", seat: leaver.controller, amount: leaveDrain });
    };
  }

  // "If <this vampire> is unlocked during your discard phase, lock them"
  // (Roy). Automatic — the card says "lock him", not "you can".
  if (perm?.lockAtDiscardPhase) {
    const priorDiscard = handler.onDiscardPhase?.bind(handler);
    handler.onDiscardPhase = (entry, owner, seatId, ops) => {
      priorDiscard?.(entry, owner, seatId, ops);
      if (seatId !== (entry.controller ?? owner.seat)) return;
      const bearer = owner.minion === null ? null : findMinion(ops.state, owner.minion);
      if (bearer && !bearer.locked) ops.emit({ type: "MinionLocked", minion: bearer.id });
    };
  }

  const aggro = perm?.aggravatedForBlood;
  const preventOther = perm?.preventForOther;
  if (aggro || preventOther) {
    const priorOpts = handler.abilityOptions?.bind(handler);
    handler.abilityOptions = (entry, owner, ctx) => {
      const out: LegalOption[] = [...(priorOpts?.(entry, owner, ctx) ?? [])];
      const bearer = owner.minion === null ? null : findMinion(ctx.state, owner.minion);
      const cf = ctx.combat;
      if (!bearer || ctx.seat !== (entry.controller ?? owner.seat)) return out;

      // "Once each ROUND of combat … make the damage from their hand
      // strikes aggravated that round" (Crossbreaker). Before strikes,
      // because that is when the flag has to be set to matter.
      if (aggro && cf && ctx.window === "combat.beforeStrikes") {
        const side = cf.acting === bearer.id ? "acting" : cf.opposing === bearer.id ? "opposing" : null;
        if (side && bearer.blood >= aggro.blood && !cf.handStrikesAggravated[side]) {
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:aggravated`,
            kind: "useAbility",
            label: `${spec.name}: burn ${aggro.blood} blood — hand strikes aggravated this round`,
            source: entry.card.id,
            params: { act: "aggravated" },
          });
        }
      }

      // "Once each combat involving a minion you control, burn N blood to
      // prevent up to M damage to that minion." The bystander prevention
      // Martyr's Resilience built — the bearer need not be in the combat
      // (docs/outside-combat-design.md).
      if (
        preventOther &&
        cf &&
        ctx.window === "combat.damageResolution" &&
        bearer.blood >= preventOther.blood &&
        !cf.usedThisCombat.includes(entry.card.id)
      ) {
        const pd = cf.pendingDamage[0];
        const victim = pd ? findMinion(ctx.state, pd.minion) : null;
        const ok =
          pd &&
          victim &&
          victim.controller === ctx.seat &&
          victim.id !== bearer.id &&
          (preventOther.kind !== "vampire" || victim.kind === "vampire") &&
          // "…up to 2 NON-AGGRAVATED damage" (Opikun): a gate on OPTIONS,
          // the `noPreventBy` precedent — a card that provably cannot
          // prevent this damage is not offered.
          (!preventOther.nonAggravated || !pd.aggravated);
        if (ok) {
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:preventOther`,
            kind: "useAbility",
            label: `${spec.name}: burn ${preventOther.blood} blood to prevent ${preventOther.amount} damage to ${victim.name}`,
            source: entry.card.id,
            params: { act: "preventOther", target: victim.id },
          });
        }
      }
      return out;
    };

    const priorUse2 = handler.useAbility?.bind(handler);
    handler.useAbility = (entry, owner, choice, ops) => {
      const act = choice.params["act"];
      if (act === "aggravated" && aggro) {
        if (owner.minion) {
          ops.emit({ type: "BloodBurned", minion: owner.minion, amount: aggro.blood });
          ops.setHandStrikesAggravatedFor(owner.minion);
        }
        return;
      }
      if (act === "preventOther" && preventOther) {
        const target = choice.params["target"];
        if (owner.minion && target) {
          ops.emit({ type: "BloodBurned", minion: owner.minion, amount: preventOther.blood });
          ops.preventDamageFor(target, preventOther.amount);
          ops.markUsedThisCombat(entry.card.id);
        }
        return;
      }
      if (!priorUse2) throw new Error(`${spec.name} has no ability`);
      priorUse2(entry, owner, choice, ops);
    };
  }

  // "If <this vampire> is ready during your discard phase, you can <do
  // Y>" (Mora, Luciano) — a phase hook that asks its controller.
  const dpc = perm?.discardPhaseChoice;
  if (dpc) {
    const priorDpc = handler.onDiscardPhase?.bind(handler);
    handler.onDiscardPhase = (entry, owner, turnSeat, ops) => {
      priorDpc?.(entry, owner, turnSeat, ops);
      const controller = entry.controller ?? owner.seat;
      if (turnSeat !== controller) return;
      const bearer = owner.minion === null ? null : findMinion(ops.state, owner.minion);
      if (!bearer || !isReady(bearer)) return;
      ops.raiseChoice({
        seat: controller,
        cardName: spec.name,
        cardId: entry.card.id,
        key: "discardPhaseChoice",
        // "You CAN" — declining does nothing, which is exactly when an
        // optional frame is right (the library-search lesson: it is
        // wrong when a decline would skip something mandatory).
        optional: true,
      });
    };
    choiceByKey["discardPhaseChoice"] = {
      options: (frame, state, registry) => {
        const out: LegalOption[] = [];
        if (dpc.do === "ashToLibraryBottom") {
          for (const c of getSeat(state, frame.seat).ashHeap ?? []) {
            // "A LIBRARY card in your ash heap" — burnt vampires are in
            // there too since the ledger closeout.
            if (c.crypt) continue;
            out.push({
              id: `choice:${spec.name}:${frame.cardId}:discardPhaseChoice:${c.id}`,
              kind: "answerChoice" as const,
              label: `Put ${c.name} on the bottom of your library`,
              params: { card: c.id },
            });
          }
        } else {
          // "Move an animal retainer FROM a vampire you control TO
          // ANOTHER vampire you control" — one option per (card, new
          // bearer) pair, the choice made in one decision.
          const mine = getSeat(state, frame.seat).minions.filter(
            (m) => m.kind === "vampire" && isReady(m),
          );
          for (const from of mine) {
            for (const p of from.attached) {
              if (dpc.tag && !p.tags.includes(dpc.tag)) continue;
              if (!(registry[p.card.name]?.isRetainer ?? false)) continue;
              for (const to of mine) {
                if (to.id === from.id) continue;
                out.push({
                  id: `choice:${spec.name}:${frame.cardId}:discardPhaseChoice:${p.card.id}:${to.id}`,
                  kind: "answerChoice" as const,
                  label: `Move ${p.card.name} to ${to.name}`,
                  params: { card: p.card.id, to: to.id },
                });
              }
            }
          }
        }
        return out;
      },
      apply: (frame, choice, ops) => {
        const card = choice.params["card"];
        if (!card) return;
        if (dpc.do === "ashToLibraryBottom") {
          // The library is drawn from the FRONT, so "the bottom" is the
          // end — `takeFromAshHeap` would put it in the HAND instead.
          ops.ashHeapToLibraryBottom(frame.seat, card);
        } else if (choice.params["to"]) {
          ops.moveAttachment(card, choice.params["to"]);
        }
      },
    };
  }

  // "As a minion ANNOUNCES an action directed at <this vampire>, flip a
  // coin; if it is tails, the action fails" (Evan Klein). Automatic — the
  // card says "flip", not "you can flip".
  const coin = perm?.coinFlipOnDirected;
  if (coin) {
    const priorAnn = handler.onActionAnnounced?.bind(handler);
    handler.onActionAnnounced = (entry, owner, info, ops) => {
      priorAnn?.(entry, owner, info, ops);
      // "…directed at HIM" is a MINION target, which is narrower than
      // "directed at you": a bleed targets a SEAT and so never qualifies
      // (the Szlachta Bodyguard reading).
      if (owner.minion === null || info.targetMinion !== owner.minion) return;
      // Rolled here, at the moment the card acts — never during
      // enumeration, which is a pure read.
      const tails = ops.randomIndex(2) === 0;
      // Recorded EITHER WAY: the flip happened, and a log that only shows
      // the tails is a log in which a heads is indistinguishable from the
      // card never having fired.
      ops.emit({ type: "CoinFlipped", minion: owner.minion, tails });
      if (tails) ops.failAction();
    };
  }

  // "After playing a master card during your master phase, you can add N
  // blood to a ready <clan> you control" (Nonu Dis).
  const amp = perm?.afterMasterPlayed;
  if (amp) {
    const priorAmpOptions = handler.abilityOptions?.bind(handler);
    handler.abilityOptions = (entry, owner, ctx) => {
      const out: LegalOption[] = [...(priorAmpOptions?.(entry, owner, ctx) ?? [])];
      const controller = entry.controller ?? owner.seat;
      if (ctx.window !== "turn.master" || ctx.seat !== controller) return out;
      if (ctx.turnSeat !== controller) return out;
      const bearer = owner.minion === null ? null : findMinion(ctx.state, owner.minion);
      if (!bearer || !isReady(bearer) || entry.usedThisPhase) return out;
      // "AFTER PLAYING a master card" needs no bookkeeping: the event log
      // is the record of everything ever played (the Week of Nightmares
      // lesson). Only this turn's plays count, so the scan starts at the
      // last TurnBegan.
      const from = ctx.state.eventLog.map((e) => e.type).lastIndexOf("TurnBegan");
      const played = ctx.state.eventLog
        .slice(from < 0 ? 0 : from)
        .some(
          (e) =>
            e.type === "CardPlayed" &&
            e.seat === controller &&
            (ctx.registry[e.name]?.costTypes?.(null) ?? []).includes("master"),
        );
      if (!played) return out;
      for (const m of getSeat(ctx.state, controller).minions) {
        if (!isReady(m) || m.clan !== amp.clan) continue;
        // An option whose whole content is "gain blood" does nothing for
        // a minion at capacity (docs/futile-options-design.md).
        if (!canGainBlood(m)) continue;
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:masterblood:${m.id}`,
          kind: "useAbility",
          label: `${spec.name}: add ${amp.blood} blood to ${m.name}`,
          source: entry.card.id,
          params: { act: "masterBlood", target: m.id },
        });
      }
      return out;
    };
    const priorAmpUse = handler.useAbility?.bind(handler);
    handler.useAbility = (entry, owner, choice, ops) => {
      if (choice.params["act"] !== "masterBlood") {
        if (!priorAmpUse) throw new Error(`${spec.name} has no ability`);
        priorAmpUse(entry, owner, choice, ops);
        return;
      }
      const target = choice.params["target"];
      if (target) ops.emit({ type: "BloodGained", minion: target, amount: amp.blood });
      entry.usedThisPhase = true;
    };
  }

  // "During an action <this vampire> performs, you can reveal the top card
  // of your library. If it is a master card, he burns 1 blood; otherwise,
  // he gets +1 stealth" (Gathii).
  const reveal = perm?.revealTopCard;
  if (reveal) {
    const priorRevOptions = handler.abilityOptions?.bind(handler);
    handler.abilityOptions = (entry, owner, ctx) => {
      const out: LegalOption[] = [...(priorRevOptions?.(entry, owner, ctx) ?? [])];
      const controller = entry.controller ?? owner.seat;
      if (ctx.seat !== controller || owner.minion === null) return out;
      const af = ctx.action;
      // "an action HE performs" — his own, not any of yours.
      if (!af || af.acting !== owner.minion) return out;
      const bearer = findMinion(ctx.state, owner.minion);
      if (!bearer) return out;
      const top = getSeat(ctx.state, controller).library[0];
      // Nothing to reveal, and the gamble cannot be taken. Note the
      // OPTION deliberately does not say what the card is: knowing would
      // make it a choice rather than a gamble, and the top of your own
      // library is not something you may read (p. 14).
      if (!top) return out;
      // He must be able to pay the penalty if it lands.
      if (bearer.blood < reveal.thenBurnBlood) return out;
      out.push({
        id: `ability:${spec.name}:${entry.card.id}:reveal`,
        kind: "useAbility",
        label: `${spec.name}: reveal the top card of your library`,
        source: entry.card.id,
        params: { act: "revealTop" },
      });
      return out;
    };
    const priorRevUse = handler.useAbility?.bind(handler);
    handler.useAbility = (entry, owner, choice, ops) => {
      if (choice.params["act"] !== "revealTop") {
        if (!priorRevUse) throw new Error(`${spec.name} has no ability`);
        priorRevUse(entry, owner, choice, ops);
        return;
      }
      const controller = entry.controller ?? owner.seat;
      const top = getSeat(ops.state, controller).library[0];
      const af = ops.action();
      if (!top || !af || owner.minion === null) return;
      const types = ops.registry[top.name]?.costTypes?.(null) ?? [];
      const hit = types.some((t) => reveal.ifTypes.includes(t));
      // REVEALED, so the card is named to the whole table — unlike a
      // reorder, which names nothing. It stays on top of the library.
      ops.emit({ type: "LibraryTopRevealed", seat: controller, name: top.name });
      if (hit) {
        ops.emit({ type: "BloodBurned", minion: owner.minion, amount: reveal.thenBurnBlood });
      } else {
        ops.emit({
          type: "StealthModified",
          actionId: af.actionId,
          delta: reveal.elseStealth,
          source: spec.name,
        });
      }
    };
  }

  // "Once each turn, if <this vampire> is ready after a successful bleed
  // AGAINST YOU, she can look at the acting minion's controller's hand,
  // then she can discard 1 card at random from it" (Ilonka).
  if (perm?.peekAndRandomDiscard) {
    const priorPeek = handler.onBleedSuccess?.bind(handler);
    handler.onBleedSuccess = (entry, owner, info, ops) => {
      priorPeek?.(entry, owner, info, ops);
      const controller = entry.controller ?? owner.seat;
      // "AGAINST YOU": the bleed's target is her controller, and it was
      // not her controller's own minion doing the bleeding.
      if (info.target !== controller || info.actingSeat === controller) return;
      if (entry.usedThisTurn) return;
      const bearer = owner.minion === null ? null : findMinion(ops.state, owner.minion);
      if (!bearer || !isReady(bearer)) return;
      if (getSeat(ops.state, info.actingSeat).hand.length === 0) return;
      entry.usedThisTurn = true;
      ops.raiseChoice({
        seat: controller,
        cardName: spec.name,
        cardId: entry.card.id,
        key: "peekAndDiscard",
        params: { from: info.actingSeat },
        // "she CAN look … then she CAN discard": declining does nothing,
        // which is when an optional frame is right.
        optional: true,
      });
    };
    choiceByKey["peekAndDiscard"] = {
      options: (frame, state) => {
        const from = frame.params?.["from"];
        if (!from) return [];
        const hand = getSeat(state, from).hand;
        if (hand.length === 0) return [];
        // ONE option, naming no card: the discard is at random, so
        // offering a choice would be a lie about what the card does. The
        // hand itself is the "look", and it reaches only this seat —
        // a ChoiceFrame is addressed to one Methuselah (Revelations).
        return [
          {
            id: `choice:${spec.name}:${frame.cardId}:peekAndDiscard:go`,
            kind: "answerChoice" as const,
            label: `Look at their hand (${hand.map((c) => c.name).join(", ")}), then discard 1 at random`,
            params: { from },
          },
        ];
      },
      apply: (frame, choice, ops) => {
        const from = choice.params["from"];
        if (!from) return;
        const hand = getSeat(ops.state, from).hand;
        if (hand.length === 0) return;
        // Rolled at USE, never at enumeration.
        const card = hand[ops.randomIndex(hand.length)];
        // Replaced: p. 7 does not care why a card left the hand.
        if (card) ops.discardFromHand(from, card.id, true);
      },
    };
  }

  // "If the referendum of a political action called by <this vampire> is
  // canceled or fails, he goes to torpor after resolution" (Cedrick).
  if (perm?.torporOnReferendumLoss) {
    const priorLost = handler.onReferendumLost?.bind(handler);
    handler.onReferendumLost = (entry, owner, info, ops) => {
      priorLost?.(entry, owner, info, ops);
      // "…called by HIM": the calling minion must be the bearer, so a
      // referendum somebody else lost costs him nothing.
      if (owner.minion === null || info.callingMinion !== owner.minion) return;
      // He can have left play during the referendum — a card can burn a
      // minion mid-poll, and a torpor for a vampire who is gone would
      // throw rather than do nothing.
      if (!findMinion(ops.state, owner.minion)) return;
      ops.sendToTorpor(owner.minion);
    };
  }

  // "If <this vampire> is ready during YOUR unlock phase, your prey
  // chooses a ready minion they control; that minion takes N
  // unpreventable damage" (Aemilius).
  const upd = perm?.unlockPhaseDamage;
  if (upd) {
    const priorUpd = handler.onAnyUnlock?.bind(handler);
    handler.onAnyUnlock = (entry, owner, unlockingSeat, ops) => {
      priorUpd?.(entry, owner, unlockingSeat, ops);
      const controller = entry.controller ?? owner.seat;
      // "YOUR unlock phase" — the window is offered on every seat's
      // unlock, which is the 2026-08-02 bug this gate exists for.
      if (unlockingSeat !== controller) return;
      const bearer = owner.minion === null ? null : findMinion(ops.state, owner.minion);
      if (!bearer || !isReady(bearer)) return;
      const prey = preyOf(ops.state, controller);
      if (!getSeat(ops.state, prey).minions.some((m) => isReady(m))) return;
      ops.raiseChoice({
        seat: prey,
        cardName: spec.name,
        cardId: entry.card.id,
        key: "unlockPhaseDamage",
        // "Your prey CHOOSES" — not "can choose". Mandatory, so the
        // decline that an optional frame allows would be wrong.
        optional: false,
      });
    };
    choiceByKey["unlockPhaseDamage"] = {
      options: (frame, state) =>
        getSeat(state, frame.seat)
          .minions.filter((m) => isReady(m))
          .map((m) => ({
            id: `choice:${spec.name}:${frame.cardId}:unlockPhaseDamage:${m.id}`,
            kind: "answerChoice" as const,
            label: `${m.name} takes ${upd.amount} damage`,
            params: { minion: m.id },
          })),
      apply: (frame, choice, ops) => {
        const m = choice.params["minion"];
        // "UNPREVENTABLE" needs no modelling: prevention lives in
        // combat's damage window and there is none here
        // (docs/block-tax-design.md — Daring the Dawn's reading).
        if (m) ops.applyEnvironmentalDamage(m, upd.amount, upd.aggravated ?? false);
      },
    };
  }

  // "If <this vampire> is ready at the start of your discard phase, you
  // get +N discard phase actions" (Sreelekha). p. 37's default is set
  // just before this hook fires, so the bonus adds to it.
  const dpa = perm?.discardPhaseActions;
  if (dpa) {
    const priorDp = handler.onDiscardPhase?.bind(handler);
    handler.onDiscardPhase = (entry, owner, turnSeat, ops) => {
      priorDp?.(entry, owner, turnSeat, ops);
      const controller = entry.controller ?? owner.seat;
      if (turnSeat !== controller) return;
      const bearer = owner.minion === null ? null : findMinion(ops.state, owner.minion);
      // "READY" is the ready REGION — a LOCKED vampire is still ready
      // (p. 16, the cheap-tail reading); torpor is what takes them out.
      if (!bearer || !isReady(bearer)) return;
      ops.addDiscardPhaseActions(dpa);
    };
  }

  // "Once each turn, after resolution of an action performed by <this
  // vampire> during which your prey burned 1 or more pool, you can gain
  // N pool" (Věnceslava).
  const apg = perm?.actionPoolGain;
  if (apg) {
    const priorApg = handler.onActionResolved?.bind(handler);
    handler.onActionResolved = (entry, owner, info, ops) => {
      priorApg?.(entry, owner, info, ops);
      if (owner.minion === null || info.acting !== owner.minion) return;
      if (apg.oncePerTurn && entry.usedThisTurn) return;
      const controller = entry.controller ?? owner.seat;
      if (apg.preyBurnedPool) {
        // "DURING WHICH your prey burned pool" — read off the event log
        // for this action id. The record already exists, so there is
        // nothing to bookkeep (the Week of Nightmares lesson).
        const prey = preyOf(ops.state, controller);
        const start = ops.state.eventLog.findIndex(
          (e) => e.type === "ActionAnnounced" && e.actionId === info.actionId,
        );
        if (start < 0) return;
        const burned = ops.state.eventLog
          .slice(start)
          .some((e) => e.type === "PoolBurned" && e.seat === prey && e.amount >= 1);
        if (!burned) return;
      }
      ops.emit({ type: "PoolGained", seat: controller, amount: apg.amount });
      if (apg.oncePerTurn) entry.usedThisTurn = true;
    };
  }

  // "After <this vampire> successfully bleeds, you get +N hand size until
  // your next discard phase" (Fotini).
  const bleedHand = perm?.bleedSuccessHandSize;
  if (bleedHand) {
    const priorBh = handler.onBleedSuccess?.bind(handler);
    handler.onBleedSuccess = (entry, owner, info, ops) => {
      priorBh?.(entry, owner, info, ops);
      if (owner.minion === null || info.actingMinion !== owner.minion) return;
      if (info.amount < 1) return;
      const controller = entry.controller ?? owner.seat;
      if (bleedHand.preyOnly && info.target !== preyOf(ops.state, controller)) return;
      ops.addHandSizeBonus({
        seat: controller,
        amount: bleedHand.amount,
        scope: "turn",
        cardName: spec.name,
        cardId: entry.card.id,
        until: "discardPhase",
      });
    };
  }

  // "After <this vampire> successfully bleeds your prey, he can gain N
  // blood" (Gostoso) — automatic, for the reason the spec records.
  const bleedBlood = perm?.bleedSuccessBlood;
  if (bleedBlood) {
    const priorBleed = handler.onBleedSuccess?.bind(handler);
    handler.onBleedSuccess = (entry, owner, info, ops) => {
      priorBleed?.(entry, owner, info, ops);
      if (owner.minion === null || info.actingMinion !== owner.minion) return;
      if (info.amount < 1) return;
      // "YOUR prey" is the card's controller's prey, which is not always
      // the bearer's — the Tier of Souls reading of p. 16.
      const controller = entry.controller ?? owner.seat;
      if (bleedBlood.preyOnly && info.target !== preyOf(ops.state, controller)) return;
      ops.emit({ type: "BloodGained", minion: owner.minion, amount: bleedBlood.amount });
    };
  }

  // "<This vampire> can DISCARD a card requiring <Discipline> to get
  // <bonus>" — seven crypt cards, one clause (docs/crypt-wave-4.md §1).
  const sale = perm?.discardFor;
  if (sale) {
    const priorSaleOptions = handler.abilityOptions?.bind(handler);
    handler.abilityOptions = (entry, owner, ctx) => {
      const out: LegalOption[] = [...(priorSaleOptions?.(entry, owner, ctx) ?? [])];
      const controller = entry.controller ?? owner.seat;
      const bearer = owner.minion === null ? null : findMinion(ctx.state, owner.minion);
      if (!bearer || ctx.seat !== controller) return out;
      if (sale.oncePerTurn && entry.usedThisTurn) return out;
      if (sale.oncePerCombat && ctx.combat?.usedThisCombat.includes(entry.card.id)) return out;

      // Which minion the bonus lands on, and whether the window is open.
      // Each arm answers both, because for two of them the recipient is
      // not the bearer.
      const af = ctx.action;
      const cf = ctx.combat;
      const targets: Array<{ id: MinionId; name: string; extra: string }> = [];
      let open = false;
      switch (sale.when) {
        case "polling":
          open = ctx.window === "referendum.polling" && ctx.referendum !== null;
          break;
        case "bleedAction":
          // "During a bleed action, <bearer> can discard … to get +1
          // BLEED" — the bonus is the bearer's own, so the bearer has to
          // be the one bleeding. Checking only "is this a bleed" offered
          // it on a stablemate's bleed, where the discard bought nothing:
          // `modifyBleed` is action-scoped, so it would have raised
          // ANOTHER vampire's bleed. Owner-reported, 2026-09-06.
          open = af !== null && af.actionKind === "bleed" && af.acting === bearer.id;
          break;
        case "anyAction":
          open = af !== null;
          break;
        case "beforeRange":
          open =
            ctx.window === "combat.beforeRange" &&
            cf !== null &&
            (cf.acting === bearer.id || cf.opposing === bearer.id);
          break;
        case "chooseStrike":
          open =
            ctx.window === "combat.chooseStrike" &&
            cf !== null &&
            (cf.acting === bearer.id || cf.opposing === bearer.id);
          break;
        case "ownMinionCombat": {
          // "If <bearer> is READY during a combat involving a minion you
          // control" — the bearer need not be in the fight, so the
          // recipient is enumerated rather than assumed. A LOCKED minion
          // is still ready (p. 16, the cheap-tail reading); torpor is
          // what takes them out.
          if (ctx.window !== "combat.beforeRange" || !cf || !isReady(bearer)) break;
          for (const id of [cf.acting, cf.opposing]) {
            const m = findMinion(ctx.state, id);
            if (m && m.controller === controller) {
              targets.push({ id: m.id, name: m.name, extra: `:${m.id}` });
            }
          }
          open = targets.length > 0;
          break;
        }
      }
      if (!open) return out;

      // Which bonuses are actually usable. Stealth and intercept are
      // offered ONLY WHEN NEEDED (p. 26) and from opposite ends of the
      // block, so each is gated separately; the rest always apply.
      const grants: Array<{ key: string; label: string }> = [];
      if (sale.grant === "interceptOrStealth") {
        if (af && bearer.id === af.acting && stealthIsNeeded(ctx, af.actionId)) {
          grants.push({ key: "stealth", label: `+${sale.amount} stealth` });
        }
        if (
          af &&
          ctx.blockAttempt?.blocker === bearer.id &&
          currentIntercept(ctx.state, af.actionId, bearer.id) < currentStealth(ctx.state, af.actionId)
        ) {
          grants.push({ key: "intercept", label: `+${sale.amount} intercept` });
        }
      } else if (targets.length > 0) {
        for (const t of targets) {
          grants.push({ key: `${sale.grant}${t.extra}`, label: `1 maneuver to ${t.name}` });
        }
      } else {
        const label =
          sale.grant === "dodge" ? "strike: dodge" : `+${sale.amount} ${saleGrantNoun(sale.grant)}`;
        grants.push({ key: sale.grant, label });
      }
      if (grants.length === 0) return out;

      // Which cards can pay. A RANDOM discard is one option with no card
      // named — the player is not choosing, and offering them the choice
      // would be a lie about what the card does.
      const hand = getSeat(ctx.state, controller).hand;
      const payers: Array<{ id: string; label: string }> = [];
      if (sale.fromAshHeap !== undefined) {
        // Paid from the ASH HEAP, not the hand — the same trade with a
        // different currency. The player does not pick which cards go,
        // any more than Phaibun picks which card is discarded.
        const heap = getSeat(ctx.state, controller).ashHeap ?? [];
        if (heap.length >= sale.fromAshHeap) {
          payers.push({ id: "ashheap", label: `${sale.fromAshHeap} cards from your ash heap` });
        }
      } else if (sale.random) {
        if (hand.length > 0) payers.push({ id: "random", label: "a card at random" });
      } else {
        for (const c of hand) {
          const h = ctx.registry[c.name];
          if (sale.requiresDiscipline) {
            // "A card REQUIRING Animalism" is a property of the CARD, not
            // of a mode being chosen — and this card is being discarded,
            // never played, so there is no chosen mode to read. The
            // central query falls back to the FIRST mode when asked for
            // none, so the union is taken explicitly: a card whose
            // superior alone requires the Discipline still qualifies.
            const req = new Set([
              ...(h?.requiresDisciplines?.(null) ?? []),
              ...(h?.requiresDisciplines?.("basic") ?? []),
              ...(h?.requiresDisciplines?.("superior") ?? []),
            ]);
            if (!req.has(sale.requiresDiscipline)) continue;
          }
          if (sale.cardTypes) {
            const types = h?.costTypes?.(null) ?? [];
            if (!types.some((t) => sale.cardTypes!.includes(t))) continue;
          }
          payers.push({ id: c.id, label: c.name });
        }
      }

      for (const p of payers) {
        for (const g of grants) {
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:discardFor:${g.key}:${p.id}`,
            kind: "useAbility",
            label: `${spec.name}: discard ${p.label} for ${g.label}`,
            source: entry.card.id,
            params: { act: "discardFor", grant: g.key, card: p.id },
          });
        }
      }
      return out;
    };

    const priorSaleUse = handler.useAbility?.bind(handler);
    handler.useAbility = (entry, owner, choice, ops) => {
      if (choice.params["act"] !== "discardFor") {
        if (!priorSaleUse) throw new Error(`${spec.name} has no ability`);
        priorSaleUse(entry, owner, choice, ops);
        return;
      }
      const controller = entry.controller ?? owner.seat;
      const named = choice.params["card"]!;
      if (named === "ashheap") {
        // REMOVED from the game, not discarded: p. 16 gives such a card
        // no zone at all, so `CardLeftZone` with nowhere to go IS the
        // removal, and nothing can retrieve it.
        const heap = [...(getSeat(ops.state, controller).ashHeap ?? [])];
        for (const c of heap.slice(0, sale.fromAshHeap ?? 0)) {
          ops.emit({
            type: "CardLeftZone",
            seat: controller,
            cardId: c.id,
            name: c.name,
            zone: "ashHeap",
          });
        }
      } else {
        const hand = getSeat(ops.state, controller).hand;
        // The random discard is rolled HERE, at use, not at enumeration —
        // an option list is a pure read, and rolling in it would consume
        // the RNG every time the engine asked what was legal.
        const card =
          named === "random" ? hand[ops.randomIndex(hand.length)] : hand.find((c) => c.id === named);
        if (!card) return;
        // Replaced: p. 7 does not care why a card left the hand, and a
        // cost is still a removal (the unlock-tolls reading).
        ops.discardFromHand(controller, card.id, true);
      }

      const [grant, targetId] = (choice.params["grant"] ?? "").split(":");
      const af = ops.action();
      switch (grant) {
        case "votes":
          ops.grantVotes(controller, sale.amount);
          break;
        case "bleed":
          if (af) {
            ops.emit({
              type: "BleedAmountModified",
              actionId: af.actionId,
              delta: sale.amount,
              source: spec.name,
              // An ability of a card in play, not an action MODIFIER
              // card — the Club Illusion reading of p. 20.
              limited: false,
            });
          }
          break;
        case "stealth":
          if (af) {
            ops.emit({
              type: "StealthModified",
              actionId: af.actionId,
              delta: sale.amount,
              source: spec.name,
            });
          }
          break;
        case "intercept":
          if (af && owner.minion) {
            ops.emit({
              type: "InterceptModified",
              actionId: af.actionId,
              minion: owner.minion,
              delta: sale.amount,
              source: spec.name,
            });
          }
          break;
        case "combatStrength":
          ops.addCombatStrengthTo(owner.minion, sale.amount);
          break;
        case "dodge":
          if (owner.minion) ops.grantStrikeToMinion(owner.minion, { kind: "dodge" });
          break;
        case "maneuverToCombatant":
          if (targetId) ops.grantManeuverCreditTo(targetId);
          break;
      }
      if (sale.oncePerTurn) entry.usedThisTurn = true;
      if (sale.oncePerCombat) ops.markUsedThisCombat(entry.card.id);
    };
  }

  // "During an action, <this vampire> can burn N blood to give an ally or
  // younger vampire you control +M stealth" (Abderrahim). The recipient
  // is the ACTING minion, so the p. 26 gate is the ordinary one.
  const sg = perm?.stealthGrant;
  if (sg) {
    const priorSgOptions = handler.abilityOptions?.bind(handler);
    handler.abilityOptions = (entry, owner, ctx) => {
      const out: LegalOption[] = [...(priorSgOptions?.(entry, owner, ctx) ?? [])];
      const controller = entry.controller ?? owner.seat;
      const bearer = owner.minion === null ? null : findMinion(ctx.state, owner.minion);
      const af = ctx.action;
      if (!bearer || ctx.seat !== controller || !af) return out;
      if (bearer.blood < sg.blood) return out;
      const actor = findMinion(ctx.state, af.acting);
      if (!actor || actor.controller !== controller) return out;
      // "An ally OR younger vampire" is a UNION of two groups — the
      // reading recorded in docs/opposing-statics-design.md, where the
      // intersection would make the clause nearly inert (an ally has no
      // capacity to be younger *than*).
      const eligible =
        (sg.who.allies === true && actor.kind === "ally") ||
        (sg.who.younger === true &&
          actor.kind === "vampire" &&
          capacityOf(actor) < capacityOf(bearer));
      if (!eligible) return out;
      if (!stealthIsNeeded(ctx, af.actionId)) return out;
      out.push({
        id: `ability:${spec.name}:${entry.card.id}:stealthGrant:${actor.id}`,
        kind: "useAbility",
        label: `${spec.name}: burn ${sg.blood} blood for +${sg.amount} stealth on ${actor.name}`,
        source: entry.card.id,
        params: { act: "stealthGrant" },
      });
      return out;
    };

    const priorSgUse = handler.useAbility?.bind(handler);
    handler.useAbility = (entry, owner, choice, ops) => {
      if (choice.params["act"] !== "stealthGrant") {
        if (!priorSgUse) throw new Error(`${spec.name} has no ability`);
        priorSgUse(entry, owner, choice, ops);
        return;
      }
      const af = ops.action();
      if (!af || owner.minion === null) return;
      ops.emit({ type: "BloodBurned", minion: owner.minion, amount: sg.blood });
      // `modifyStealth` is ACTION-scoped: "the acting minion gets +N
      // stealth", played by somebody else, is the same primitive — only
      // the question of who may grant it moved
      // (docs/other-vampire-modifiers-design.md).
      ops.emit({
        type: "StealthModified",
        actionId: af.actionId,
        delta: sg.amount,
        source: spec.name,
      });
    };
  }

  if (!edge && !afterRef) return;

  const priorOptions = handler.abilityOptions?.bind(handler);
  handler.abilityOptions = (entry, owner, ctx) => {
    const out: LegalOption[] = [...(priorOptions?.(entry, owner, ctx) ?? [])];
    const bearer = owner.minion === null ? null : findMinion(ctx.state, owner.minion);
    if (!bearer || ctx.seat !== (entry.controller ?? owner.seat)) return out;

    // "During your turn, you can burn the Edge to unlock <them>."
    if (edge && bearer.locked && ctx.state.edge === ctx.seat && ctx.turnSeat === ctx.seat) {
      out.push({
        id: `ability:${spec.name}:${entry.card.id}:edgeUnlock`,
        kind: "useAbility",
        label: `${spec.name}: burn the Edge to unlock ${bearer.name}`,
        source: entry.card.id,
        params: { act: "edgeUnlock" },
      });
    }

    // "You can unlock <them> after a referendum called by them passes."
    // The window opens only on a pass, so "passes" needs no test here
    // (docs/referendum-margin-design.md §2).
    if (afterRef && ctx.window === "referendum.afterResolution" && bearer.locked) {
      const rf = ctx.referendum;
      if (rf && rf.callingMinion === bearer.id) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:refUnlock`,
          kind: "useAbility",
          label: `${spec.name}: unlock ${bearer.name}`,
          source: entry.card.id,
          params: { act: "refUnlock" },
        });
      }
    }
    return out;
  };

  const priorUse = handler.useAbility?.bind(handler);
  handler.useAbility = (entry, owner, choice, ops) => {
    const act = choice.params["act"];
    if (act === "edgeUnlock") {
      ops.emit({ type: "EdgeBurned", seat: owner.seat });
      if (owner.minion) ops.emit({ type: "MinionUnlocked", minion: owner.minion });
      return;
    }
    if (act === "refUnlock") {
      if (owner.minion) ops.emit({ type: "MinionUnlocked", minion: owner.minion });
      return;
    }
    if (!priorUse) throw new Error(`${spec.name} has no ability`);
    priorUse(entry, owner, choice, ops);
  };
}

/**
 * Report what each `playCard` option COSTS (docs/richer-options-design.md).
 *
 * Every enumerator already priced the play — that is how it decided the
 * card was affordable — and then dropped the number, so the UI could not
 * put a price on the button and an agent could not weigh one play against
 * another. Both would otherwise have to re-derive it, and the AI's
 * version would be a second, drifting model of `cards.ts`.
 *
 * Done ONCE here rather than at the forty `makeOption` call sites: those
 * are forty chances to forget, and a cost that appears on some cards and
 * not others is worse than none. The live cost is used, not the printed
 * one — a play-cost modifier in force now is the one that applies
 * (docs/play-cost-design.md).
 */
function addOptionCost(spec: CardSpec, handler: CardHandler): void {
  const inner = handler.options?.bind(handler);
  if (!inner) return;
  handler.options = (card, ctx) =>
    inner(card, ctx).map((o) => {
      if (o.kind !== "playCard" || o.cost !== undefined) return o;
      const minion = o.minion === null ? null : findMinion(ctx.state, o.minion);
      // A spec with no modes prices off the card alone; `modeOf` throws
      // on one, so it is asked only when there is a mode to find.
      const mode = spec.modes.length > 0 ? modeOf(spec, o.mode, o.params["variant"]) : undefined;
      const target = o.params["target"] ?? null;
      const cost = costOf(spec, ctx, minion, mode, target);
      return { ...o, cost };
    });
}

/**
 * What an EQUIPMENT card's own text lets its bearer do (§§2–4).
 *
 * Composed onto whatever `compileEquipment` already built for
 * `spec.weapon`, the way `addAllyAbilities` composes: a card can be both
 * a weapon and something else, and assigning over `abilityOptions` is how
 * the `choiceByKey` family of bugs starts.
 */
function addEquipmentAbilities(spec: CardSpec, handler: CardHandler): void {
  const eq = spec.permanent?.equipmentAbilities;
  if (!eq) return;

  const priorOptions = handler.abilityOptions?.bind(handler);
  handler.abilityOptions = (entry, owner, ctx) => {
    const out: LegalOption[] = [...(priorOptions?.(entry, owner, ctx) ?? [])];
    if (owner.minion === null || ctx.seat !== (entry.controller ?? owner.seat)) return out;
    const bearer = findMinion(ctx.state, owner.minion);
    if (!bearer) return out;

    // "The bearer with superior Auspex can burn 1 blood DURING AN ACTION
    // to get an additional +1 intercept" — offered only while the bearer
    // is the minion attempting the block and their intercept still falls
    // short, which is p. 26's only-when-needed rule and also the reason
    // the card needs no printed use limit (§2).
    const ifb = eq.interceptForBlood;
    if (ifb && ctx.action && ctx.blockAttempt) {
      const have = disciplinesOf(bearer)[ifb.requiresDiscipline];
      const levelOk = ifb.level === "superior" ? have === "superior" : have !== undefined;
      if (
        levelOk &&
        bearer.blood >= ifb.blood &&
        ctx.blockAttempt.blocker === bearer.id &&
        currentIntercept(ctx.state, ctx.action.actionId, bearer.id) <
          currentStealth(ctx.state, ctx.action.actionId)
      ) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:intercept`,
          kind: "useAbility",
          label: `${spec.name}: burn ${ifb.blood} blood for +${ifb.amount} intercept`,
          source: entry.card.id,
          params: { do: "intercept" },
        });
      }
    }

    // "…burn 1 blood and this card AS THEY ANNOUNCE AN ACTION to make
    // that action unblockable by vampires" (§3).
    const au = eq.announceUnblockable;
    if (au && ctx.window === "action.announce" && ctx.action) {
      if (ctx.action.acting === bearer.id && bearer.blood >= au.blood) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:unblockable`,
          kind: "useAbility",
          label: `${spec.name}: burn ${au.blood} blood and this card — unblockable by ${au.who}`,
          source: entry.card.id,
          params: { do: "unblockable" },
        });
      }
    }

    // "They can burn this card before range is determined to end combat."
    if (eq.burnToEndCombat && ctx.window === "combat.beforeRange" && ctx.combat) {
      const cf = ctx.combat;
      if (cf.acting === bearer.id || cf.opposing === bearer.id) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:endcombat`,
          kind: "useAbility",
          label: `${spec.name}: burn it to end combat`,
          source: entry.card.id,
          params: { do: "endcombat" },
        });
      }
    }
    return out;
  };

  const priorUse = handler.useAbility?.bind(handler);
  handler.useAbility = (entry, owner, choice, ops) => {
    const act = choice.params["do"];
    if (act === "intercept" && eq.interceptForBlood && owner.minion) {
      const af = ops.action();
      if (!af) return;
      ops.emit({
        type: "BloodBurned",
        minion: owner.minion,
        amount: eq.interceptForBlood.blood,
      });
      ops.emit({
        type: "InterceptModified",
        actionId: af.actionId,
        minion: owner.minion,
        delta: eq.interceptForBlood.amount,
        source: spec.name,
      });
      return;
    }
    if (act === "unblockable" && eq.announceUnblockable && owner.minion) {
      ops.emit({
        type: "BloodBurned",
        minion: owner.minion,
        amount: eq.announceUnblockable.blood,
      });
      ops.burnPermanent(entry.card.id);
      ops.restrictBlocking(eq.announceUnblockable.who);
      return;
    }
    if (act === "endcombat" && eq.burnToEndCombat) {
      ops.burnPermanent(entry.card.id);
      ops.endCombatFromOutside();
      return;
    }
    priorUse?.(entry, owner, choice, ops);
  };
}

/**
 * "The next time this vampire is about to successfully bleed the same
 * Methuselah, burn this card and this vampire gets +N bleed" (Spying
 * Mission, §6). Mandatory, so it fires from the hook with nothing asked —
 * the Rebel precedent.
 */
function addDeclinedBleedBonus(spec: CardSpec, handler: CardHandler): void {
  const d = spec.permanent?.declinedBleedBonus;
  if (!d) return;
  const prior = handler.onBlocksDeclined?.bind(handler);
  handler.onBlocksDeclined = (entry, owner, info, ops) => {
    prior?.(entry, owner, info, ops);
    if (info.actionKind !== "bleed") return;
    if (owner.minion === null || info.acting !== owner.minion) return;
    if (d.sameSeat && entry.againstSeat !== undefined && info.target !== entry.againstSeat) {
      return;
    }
    if (d.burnSelf !== false) ops.burnPermanent(entry.card.id);
    ops.emit({
      type: "BleedAmountModified",
      actionId: info.actionId,
      delta: d.amount,
      source: spec.name,
      // NOT "(limited)": by now this is an ability of a card in play, and
      // p. 20's one-limited-bonus rule is about action modifier CARDS —
      // the Club Illusion precedent (§6).
      limited: false,
    });
  };
}

/**
 * What a RETAINER's card text gives its employer once it is in play
 * (docs/retainer-wave-design.md). Grafted, never assigned over, for the
 * reason `addLocationAbilities` records.
 */
function addRetainerAbilities(spec: CardSpec, handler: CardHandler): void {
  const ra = spec.permanent?.retainerAbilities;
  if (!ra) return;

  // "If the action to employ this retainer is successful, unlock this
  // vampire" — at one of two moments, and the basic's delay is a real
  // drawback rather than flavour (§3).
  if (ra.unlockEmployer) {
    // WHEN is a mode static, since that is the only difference between
    // Feral Hound's two modes and mode statics merge into the entry (§3).
    handler.onEnterPlay = (entry, owner, ops) => {
      if (!owner.minion) return;
      if (entry.statics.unlockEmployerAt === "afterResolution") {
        ops.registerUnlockOnSuccess(owner.minion);
      } else {
        entry.chosen = owner.minion; // remembered for the discard phase
      }
    };
    handler.onDiscardPhase = (entry, owner, seat, ops) => {
      if (entry.statics.unlockEmployerAt !== "discardPhase") return;
      if (seat !== (entry.controller ?? owner.seat)) return;
      const m = entry.chosen ? findMinion(ops.state, entry.chosen) : null;
      if (!m || !m.locked || !isReady(m)) return;
      delete entry.chosen;
      ops.emit({ type: "MinionUnlocked", minion: m.id });
    };
  }

  const priorOptions = handler.abilityOptions?.bind(handler);
  handler.abilityOptions = (entry, owner, ctx) => {
    const out: LegalOption[] = [...(priorOptions?.(entry, owner, ctx) ?? [])];
    if (owner.minion === null || ctx.seat !== (entry.controller ?? owner.seat)) return out;
    const bearer = findMinion(ctx.state, owner.minion);
    if (!bearer) return out;
    const life = entry.life ?? 0;

    // "If this vampire is BLOCKED, burn N life from this retainer BEFORE
    // BLOCK RESOLUTION to lock the blocking minion and continue the
    // action as if unblocked" (§2).
    if (ra.breakBlock && life >= ra.breakBlock.life) {
      const af = ctx.action;
      const ba = ctx.blockAttempt;
      if (af && ba && af.acting === bearer.id) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:breakblock`,
          kind: "useAbility",
          label: `${spec.name}: burn ${ra.breakBlock.life} life — lock the blocker and continue`,
          source: entry.card.id,
          params: { act: "breakBlock" },
        });
      }
    }

    // "You can lock this retainer to give the employer +N intercept."
    if (ra.lockForIntercept && !entry.locked && ctx.action) {
      const af = ctx.action;
      const ba = ctx.blockAttempt;
      // Intercept is worth something only while this minion is the one
      // attempting the block (p. 26's only-when-needed, from the other
      // side).
      if (ba && ba.blocker === bearer.id) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:intercept`,
          kind: "useAbility",
          label: `${spec.name}: lock for +${ra.lockForIntercept} intercept`,
          source: entry.card.id,
          params: { act: "retainerIntercept", action: af.actionId },
        });
      }
    }

    // "The employer can lock this retainer to prevent N damage in combat."
    if (ra.lockToPrevent && !entry.locked && ctx.window === "combat.damageResolution") {
      const cf = ctx.combat;
      const pd = cf?.pendingDamage[0];
      if (pd && pd.minion === bearer.id) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:prevent`,
          kind: "useAbility",
          label: `${spec.name}: lock to prevent ${ra.lockToPrevent} damage`,
          source: entry.card.id,
          params: { act: "retainerPrevent" },
        });
      }
    }

    // "You can burn this retainer to have an action directed at A MINION
    // YOU CONTROL fail" — narrower than "directed at you": a bleed is
    // directed at a SEAT and does not qualify (§5).
    if (ra.burnToFailAction) {
      const af = ctx.action;
      const aimed = af?.targetMinion ? findMinion(ctx.state, af.targetMinion) : null;
      if (af && aimed && aimed.controller === ctx.seat) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:failaction`,
          kind: "useAbility",
          label: `${spec.name}: burn it to make this action fail`,
          source: entry.card.id,
          params: { act: "retainerFailAction" },
        });
      }
    }

    // "Burn this retainer to reduce the cost of <a card> they play."
    if (ra.burnForDiscount && ctx.window === "turn.minion" && ctx.seat === ctx.turnSeat) {
      out.push({
        id: `ability:${spec.name}:${entry.card.id}:discount`,
        kind: "useAbility",
        label: `${spec.name}: burn it for a ${-ra.burnForDiscount.amount} cost reduction`,
        source: entry.card.id,
        params: { act: "retainerDiscount" },
      });
    }
    return out;
  };

  const priorUse = handler.useAbility?.bind(handler);
  handler.useAbility = (entry, owner, choice, ops) => {
    const act = choice.params["act"];
    const me = owner.minion;
    switch (act) {
      case "breakBlock":
        ops.burnRetainerLife(entry.card.id, ra.breakBlock!.life);
        // p. 49: Mirror Walk "explicitly locks the blocking minion" where
        // Change of Target does not — this card locks. "Continue the
        // action as if unblocked" is what a FAILED attempt already does.
        {
          const ba = ops.state.frames.find((f) => f.kind === "blockAttempt");
          if (ba?.kind === "blockAttempt") {
            ops.emit({ type: "MinionLocked", minion: ba.blocker });
          }
        }
        ops.failBlockAttempt();
        return;
      case "retainerIntercept": {
        const af = ops.action();
        const ba = ops.state.frames.find((f) => f.kind === "blockAttempt");
        if (!af || ba?.kind !== "blockAttempt") return;
        ops.emit({ type: "PermanentLocked", cardId: entry.card.id });
        ops.emit({
          type: "InterceptModified",
          actionId: af.actionId,
          minion: ba.blocker,
          delta: ra.lockForIntercept!,
          source: spec.name,
        });
        return;
      }
      case "retainerPrevent":
        if (!me) return;
        ops.emit({ type: "PermanentLocked", cardId: entry.card.id });
        ops.preventDamageFor(me, ra.lockToPrevent!);
        return;
      case "retainerFailAction":
        ops.burnPermanent(entry.card.id);
        ops.failAction();
        return;
      case "retainerDiscount":
        ops.burnPermanent(entry.card.id);
        ops.addSeatPlayCostMod(entry.controller ?? owner.seat, ra.burnForDiscount!.mod);
        return;
      default:
        priorUse?.(entry, owner, choice, ops);
    }
  };
}

/**
 * What an ALLY's own card text gives it once it is a minion in play
 * (docs/vozhd-allies-design.md §2 and §4). Every clause hangs off the
 * ally's SELF-ATTACHED entry, which is why the permanent machinery
 * reaches it at all.
 *
 * Grafted rather than assigned over, for the reason `addLocationAbilities`
 * records: several clauses want the same two hooks.
 */
/**
 * "Stealth is only offered when NEEDED" (p. 26): there must be a live
 * block attempt whose blocker's intercept has caught up with the action's
 * stealth. Shared by `permanent.lockGrant`'s locations and by an ally's
 * own `lockForStealth`, so the two cannot drift on the rule.
 */
function stealthIsNeeded(ctx: PlayContext, actionId: string): boolean {
  const ba = ctx.blockAttempt;
  if (!ba) return false;
  return currentIntercept(ctx.state, actionId, ba.blocker) >= currentStealth(ctx.state, actionId);
}

function addAllyAbilities(spec: CardSpec, handler: CardHandler): void {
  const strike = spec.ally?.strike;
  const ab = spec.permanent?.allyAbilities;
  // Some ally abilities are carried as STATICS rather than in the
  // `allyAbilities` block, because they differ by MODE and mode statics
  // already merge into the entry (the Feral Hound shape). Without them in
  // this guard the block returns early and those cards are silently
  // inert — the failure this project keeps finding.
  const statics = [spec.permanent?.statics, ...spec.modes.map((m) => m.statics)];
  const usesStatics = statics.some(
    (s) => s?.bleedFromCopy ?? s?.bleedFromClanBlood ?? s?.preventForCopy ?? s?.pressForLife,
  );
  if (!strike && !ab && !usesStatics) return;

  // "Cancel a strike card as it is played" acts inside another card's
  // as-played period, which p. 7 otherwise reserves for cancels and
  // wakes — so the handler opts in, the Meditative Grove shape.
  if (ab?.cancelOpposingStrikeCard) handler.abilityInAsPlayed = true;

  const priorOptions = handler.abilityOptions?.bind(handler);
  handler.abilityOptions = (entry, owner, ctx) => {
    const out: LegalOption[] = [...(priorOptions?.(entry, owner, ctx) ?? [])];
    if (owner.minion === null) return out;
    const me = findMinion(ctx.state, owner.minion);
    if (!me) return out;
    const cf = ctx.combat;
    const side =
      cf && cf.acting === me.id
        ? ("acting" as const)
        : cf && cf.opposing === me.id
          ? ("opposing" as const)
          : null;

    // "It can strike: 3R damage" — the ally's own attack. Deliberately
    // NOT gated on `cf.restrict[side].equipment`: a body is not equipment.
    if (strike && cf && side && ctx.window === "combat.chooseStrike" && !cf.handStrikesOnly) {
      const chooser = cf.strikes.acting === null ? "acting" : "opposing";
      const committed = cf.committedStrike[side];
      if (
        chooser === side &&
        cf.strikes[side] === null &&
        (committed === null || committed === entry.card.id)
      ) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:strike`,
          kind: "useAbility",
          label: `${spec.name}: strike (${strike.damage}${strike.ranged ? "R" : ""}${
            strike.aggravated ? " aggravated" : ""
          })`,
          source: entry.card.id,
          params: { do: "strike" },
        });
      }
    }
    // --- "another copy of this ally you control" (§3). The record already
    //     exists: a minion knows its own name, so this is a lookup.
    const st = entry.statics;
    if (st.bleedFromCopy && ctx.action?.actionKind === "bleed" && ctx.seat === owner.seat) {
      const bfc = st.bleedFromCopy;
      // The bleed amount belongs to the acting minion, so this ally must
      // be the one bleeding.
      if (ctx.action.acting === me.id) {
        for (const copy of otherCopies(ctx.state, me)) {
          const payable =
            bfc.cost === "lockCopy" ? !copy.locked && isReady(copy) : copy.blood >= 1;
          if (!payable) continue;
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:copybleed:${copy.id}`,
            kind: "useAbility",
            label:
              bfc.cost === "lockCopy"
                ? `${spec.name}: lock another copy for +${bfc.amount} bleed`
                : `${spec.name}: burn 1 life from another copy for +${bfc.amount} bleed`,
            source: entry.card.id,
            params: { do: "copybleed", target: copy.id },
          });
        }
      }
    }
    if (st.bleedFromClanBlood && ctx.action?.actionKind === "bleed" && ctx.seat === owner.seat) {
      const b = st.bleedFromClanBlood;
      if (ctx.action.acting === me.id) {
        for (const v of getSeat(ctx.state, owner.seat).minions) {
          if (v.kind !== "vampire" || v.clan !== b.clan || v.blood < b.blood) continue;
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:clanbleed:${v.id}`,
            kind: "useAbility",
            label: `${spec.name}: ${v.name} burns ${b.blood} blood for +${b.amount} bleed`,
            source: entry.card.id,
            params: { do: "clanbleed", target: v.id },
          });
        }
      }
    }
    // "Burn N life to prevent M damage to ANOTHER COPY of this ally you
    // control in combat" — the preventer is a bystander, not the victim.
    if (st.preventForCopy && ctx.window === "combat.damageResolution" && ctx.seat === owner.seat) {
      const p = st.preventForCopy;
      const cf = ctx.combat;
      const pending = cf?.pendingDamage[0];
      if (cf && pending && me.blood >= p.life && !pending.unpreventable) {
        const victim = findMinion(ctx.state, pending.minion);
        if (victim && victim.id !== me.id && otherCopies(ctx.state, me).some((c) => c.id === victim.id)) {
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:copyprevent`,
            kind: "useAbility",
            label: `${spec.name}: burn ${p.life} life to prevent ${p.amount} damage to ${victim.name}`,
            source: entry.card.id,
            params: { do: "copyprevent", target: victim.id },
          });
        }
      }
    }

    if (!ab) return out;

    if (ctx.seat === owner.seat && cf && side && ctx.window === "combat.damageResolution") {
      const pd = cf.pendingDamage[0];
      const mine = pd && pd.minion === me.id;
      // "Prevent 1 damage each round of combat" — War Ghoul's ability.
      if (ab?.preventPerRound && mine && !cf.usedThisRound.includes(entry.card.id)) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:prevent`,
          kind: "useAbility",
          label: `${spec.name}: prevent ${ab?.preventPerRound} damage (once per round)`,
          source: entry.card.id,
          params: { do: "prevent" },
        });
      }
      // "Once each COMBAT, discard a card requiring Protean to prevent 2."
      const byDiscard = ab?.preventByDiscard;
      if (byDiscard && mine && !cf.usedThisCombat.includes(entry.card.id)) {
        for (const c of getSeat(ctx.state, owner.seat).hand) {
          const h = ctx.registry?.[c.name];
          const req = h?.requiresDisciplines?.(null) ?? [];
          if (!req.some((d) => byDiscard.requiresDiscipline.includes(d))) continue;
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:preventdiscard:${c.id}`,
            kind: "useAbility",
            label: `${spec.name}: discard ${c.name} to prevent ${byDiscard.amount} damage`,
            source: entry.card.id,
            params: { do: "preventdiscard", card: c.id },
          });
        }
      }
    }

    // "During your unlock phase, …" — the controller's OWN, which the
    // 2026-08-02 bug taught has to read `turnSeat`, not just `seat`.
    if (ctx.window === "turn.unlock" && ctx.seat === owner.seat && ctx.turnSeat === owner.seat) {
      const gain = ab?.unlockDiscardForLife;
      if (gain && !entry.usedThisPhase) {
        for (const c of getSeat(ctx.state, owner.seat).hand) {
          const types = ctx.registry?.[c.name]?.costTypes?.(null) ?? [];
          if (!types.some((t) => gain.cardTypes.includes(t))) continue;
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:life:${c.id}`,
            kind: "useAbility",
            label: `${spec.name}: discard ${c.name} for ${gain.life} life`,
            source: entry.card.id,
            params: { do: "life", card: c.id },
          });
        }
      }
      const siphon = ab?.unlockSiphon;
      if (siphon && !entry.usedThisPhase) {
        // "…not to exceed its starting life": an ally's `capacity` field
        // holds exactly that (p. 11's "a reference, not a cap").
        const room = siphon.capped ? capacityOf(me) - me.blood : Infinity;
        for (const donor of getSeat(ctx.state, owner.seat).minions) {
          if (donor.kind !== "vampire" || donor.clan !== siphon.clan) continue;
          const most = Math.min(donor.blood, room);
          // "ANY amount" — one option per amount, the paymentSplits shape.
          for (let x = 1; x <= most; x++) {
            out.push({
              id: `ability:${spec.name}:${entry.card.id}:siphon:${donor.id}:${x}`,
              kind: "useAbility",
              label: `${spec.name}: take ${x} blood from ${donor.name}`,
              source: entry.card.id,
              params: { do: "siphon", target: donor.id, x: String(x) },
            });
          }
        }
      }
    }

    // "During any OTHER Methuselah's minion phase, a <clan> you control
    // can burn 1 blood to unlock this ally."
    //
    // `turn.minion` is the TURN SEAT's own window — nobody else is asked
    // in it — so the moments another Methuselah actually gets an impulse
    // inside that phase are the action windows. That is also when the
    // ability is worth anything: it exists to unlock the ally in time to
    // block. docs/vozhd-allies-design.md §4
    const foreign = ab?.foreignPhaseUnlock;
    const turn = ctx.state.frames.find((f) => f.kind === "turn");
    const inForeignMinionPhase =
      turn?.kind === "turn" && turn.phase === "minion" && ctx.turnSeat !== owner.seat;
    if (
      foreign &&
      inForeignMinionPhase &&
      (ctx.window === "action.announce" || ctx.window === "action.effects") &&
      ctx.seat === owner.seat &&
      me.locked
    ) {
      for (const payer of getSeat(ctx.state, owner.seat).minions) {
        if (payer.kind !== "vampire" || payer.clan !== foreign.clan) continue;
        if (!isReady(payer) || payer.blood < foreign.blood) continue;
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:unlock:${payer.id}`,
          kind: "useAbility",
          label: `${spec.name}: ${payer.name} burns ${foreign.blood} blood to unlock it`,
          source: entry.card.id,
          params: { do: "unlock", target: payer.id },
        });
      }
    }

    // "Lock to add 1 life to an ally you control who has fewer life than
    // its STARTING LIFE" — which is `capacityOf` for an ally (p. 11).
    const heal = ab?.lockToHealAlly;
    if (heal && ctx.seat === owner.seat && !me.locked && !ctx.combat) {
      for (const t of getSeat(ctx.state, owner.seat).minions) {
        if (t.kind !== "ally" || !isReady(t) || !canGainBlood(t)) continue;
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:heal:${t.id}`,
          kind: "useAbility",
          label: `${spec.name}: lock to add ${heal.life} life to ${t.name}`,
          source: entry.card.id,
          params: { do: "heal", target: t.id },
        });
      }
    }

    // "Burn 1 life to give a minion you control 1 press." One
    // implementation, two places it can be DECLARED: `allyAbilities` is
    // card-level (Underbridge Stray), per-mode statics belong to one mode
    // (Rotting Behemoth's superior). Writing it twice is how
    // `modifyVotes`/`restrictVotes` drifted.
    const press = entry.statics.pressForLife ?? ab?.burnLifeForPress;
    if (
      press &&
      ctx.seat === owner.seat &&
      cf &&
      me.blood >= press.life &&
      // "During the FIRST ROUND of each combat" (Rotting Behemoth
      // superior) — Underbridge Stray's has no such limit.
      (!press.firstRoundOnly || cf.round === 1)
    ) {
      for (const t of [cf.acting, cf.opposing]) {
        const target = findMinion(ctx.state, t);
        if (!target || target.controller !== owner.seat) continue;
        // "…THIS ALLY can burn 1 life to get 1 press": the press is for
        // itself, not for any minion you control (Underbridge Stray's is).
        if (press.selfOnly && target.id !== me.id) continue;
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:press:${target.id}`,
          kind: "useAbility",
          label: `${spec.name}: burn ${press.life} life to give ${target.name} a press`,
          source: entry.card.id,
          params: { do: "press", target: target.id },
        });
      }
    }

    // "During an action directed at you (or a card you control), you can
    // burn this ally IF IT IS NOT BLOCKING to unlock a ready minion you
    // control." An action aimed at a card in play is already directed at
    // that card's controller (p. 25), which is what `af.target` records —
    // so the parenthetical needs no second condition (§3).
    if (ab?.burnToUnlock && ctx.seat === owner.seat) {
      const af = ctx.action;
      const blocking = ctx.blockAttempt?.blocker === me.id;
      if (af && af.directed && af.target === owner.seat && !blocking && isReady(me)) {
        for (const t of getSeat(ctx.state, owner.seat).minions) {
          if (t.id === me.id || !isReady(t) || !t.locked) continue;
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:burnunlock:${t.id}`,
            kind: "useAbility",
            label: `${spec.name}: burn it to unlock ${t.name}`,
            source: entry.card.id,
            params: { do: "burnunlock", target: t.id },
          });
        }
      }
    }

    // "This ally can lock to give a <clan> you control +1 stealth."
    const lfs = ab?.lockForStealth;
    if (lfs && ctx.seat === owner.seat && !me.locked && ctx.action) {
      const af = ctx.action;
      const actor = findMinion(ctx.state, af.acting);
      if (
        actor &&
        actor.controller === owner.seat &&
        (lfs.clan === undefined || actor.clan === lfs.clan) &&
        (lfs.sect === undefined || actor.sect === lfs.sect) &&
        stealthIsNeeded(ctx, af.actionId)
      ) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:stealth`,
          kind: "useAbility",
          label: `${spec.name}: lock to give ${actor.name} +${lfs.amount} stealth`,
          source: entry.card.id,
          params: { do: "stealth" },
        });
      }
    }

    // "Burn this ally to give a minion controlled by your PREDATOR OR
    // PREY −1 stealth." Offered only while it can matter: there must be a
    // live block attempt whose blocker's intercept is short by no more
    // than the penalty, which is the mirror of p. 26's only-when-needed
    // rule that `modifyBlockerIntercept` already takes.
    const bsp = ab.burnForStealthPenalty;
    if (bsp && ctx.seat === owner.seat && ctx.action) {
      const af = ctx.action;
      const actor = findMinion(ctx.state, af.acting);
      const neighbours = [predatorOf(ctx.state, owner.seat), preyOf(ctx.state, owner.seat)];
      const ba = ctx.blockAttempt;
      if (actor && neighbours.includes(actor.controller) && ba) {
        const short =
          currentStealth(ctx.state, af.actionId) -
          currentIntercept(ctx.state, af.actionId, ba.blocker);
        if (short > 0 && short <= bsp.amount) {
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:stealthpenalty`,
            kind: "useAbility",
            label: `${spec.name}: burn it to give ${actor.name} −${bsp.amount} stealth`,
            source: entry.card.id,
            params: { do: "stealthpenalty" },
          });
        }
      }
    }

    // "Burn this ally as an action directed at an ALLY you control is
    // announced to have it fail." The action FAILS — it is not blocked —
    // so no combat follows.
    const bfa = ab.burnToFailAction;
    if (bfa && ctx.seat === owner.seat && ctx.action) {
      const af = ctx.action;
      const aimed = af.targetMinion ? findMinion(ctx.state, af.targetMinion) : null;
      const kindOk = bfa.targetKind === "minion" || aimed?.kind === "ally";
      // "As it is ANNOUNCED": state A, before any block attempt (the
      // fail-block cluster's reading of the phrase).
      if (aimed && aimed.controller === owner.seat && kindOk && af.step === "A" && !ctx.blockAttempt) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:failaction`,
          kind: "useAbility",
          label: `${spec.name}: burn it to make this action fail`,
          source: entry.card.id,
          params: { do: "failaction" },
        });
      }
    }

    // "Fiorella can lock to give ANOTHER wraith or zombie ally you
    // control +1 stealth or +1 intercept" — `lockForStealth` with two
    // grants and a sub-type filter. Each grant is only offered when it
    // can matter: stealth by p. 26's rule, intercept by its mirror (the
    // recipient must actually be attempting the block).
    const lfg = ab.lockForGrant;
    if (lfg && ctx.seat === owner.seat && !me.locked && ctx.action) {
      const af = ctx.action;
      for (const target of getSeat(ctx.state, owner.seat).minions) {
        // "ANOTHER wraith or zombie ally": never itself.
        if (target.id === me.id || !isUndeadAlly(target)) continue;
        for (const grant of lfg.grants) {
          const usable =
            grant === "stealth"
              ? target.id === af.acting && stealthIsNeeded(ctx, af.actionId)
              : ctx.blockAttempt?.blocker === target.id &&
                currentIntercept(ctx.state, af.actionId, target.id) <
                  currentStealth(ctx.state, af.actionId);
          if (!usable) continue;
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:grant:${grant}:${target.id}`,
            kind: "useAbility",
            label: `${spec.name}: lock to give ${target.name} +${lfg.amount} ${grant}`,
            source: entry.card.id,
            params: { do: "grant", grant, target: target.id },
          });
        }
      }
    }

    // "Burn 1 life to cancel a STRIKE card as it is played by the
    // OPPOSING minion" (§5).
    const cancel = ab.cancelOpposingStrikeCard;
    if (cancel && ctx.window === "card.asPlayed" && ctx.seat === owner.seat && cf && side) {
      const pending = ctx.pendingCard;
      const foe = side === "acting" ? cf.opposing : cf.acting;
      if (
        pending &&
        pending.isStrike === true &&
        pending.minion === foe &&
        me.blood >= cancel.life
      ) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:cancelstrike`,
          kind: "useAbility",
          label: `${spec.name}: burn ${cancel.life} life to cancel ${pending.card.name}`,
          source: entry.card.id,
          params: { do: "cancelstrike" },
        });
      }
    }
    return out;
  };

  const priorUse = handler.useAbility?.bind(handler);
  handler.useAbility = (entry, owner, choice, ops) => {
    const what = choice.params["do"];
    if (!what) {
      priorUse?.(entry, owner, choice, ops);
      return;
    }
    const me = owner.minion;
    if (!me) throw new Error(`${spec.name}: ability with no bearer`);
    switch (what) {
      case "strike":
        ops.chooseWeaponStrike(me, entry.card.id, {
          name: spec.name,
          damage: strike!.damage,
          ranged: strike!.ranged,
          ...(strike!.aggravated ? { aggravated: true } : {}),
        });
        return;
      case "prevent":
        ops.preventDamageAbility(me, entry.card.id, ab!.preventPerRound!, "round");
        return;
      case "preventdiscard":
        ops.discardFromHand(owner.seat, choice.params["card"]!, true);
        ops.preventDamageAbility(me, entry.card.id, ab!.preventByDiscard!.amount, "combat");
        return;
      case "life": {
        entry.usedThisPhase = true;
        // Replaced, like every other card that leaves a hand (p. 7).
        ops.discardFromHand(owner.seat, choice.params["card"]!, true);
        ops.emit({ type: "BloodGained", minion: me, amount: ab!.unlockDiscardForLife!.life });
        return;
      }
      case "siphon": {
        entry.usedThisPhase = true;
        const x = Number(choice.params["x"] ?? "0");
        // The blood MOVES and becomes life (p. 11).
        ops.emit({ type: "BloodBurned", minion: choice.params["target"]!, amount: x });
        ops.emit({ type: "BloodGained", minion: me, amount: x });
        return;
      }
      case "unlock":
        ops.emit({
          type: "BloodBurned",
          minion: choice.params["target"]!,
          amount: ab!.foreignPhaseUnlock!.blood,
        });
        ops.emit({ type: "MinionUnlocked", minion: me });
        return;
      case "heal":
        // An ally IS a minion, so "lock this ally" locks the minion —
        // not the self-attached entry carrying its card text.
        ops.emit({ type: "MinionLocked", minion: me });
        ops.emit({
          type: "BloodGained",
          minion: choice.params["target"]!,
          amount: ab!.lockToHealAlly!.life,
        });
        return;
      case "press":
        ops.emit({ type: "BloodBurned", minion: me, amount: ab!.burnLifeForPress!.life });
        ops.grantCombatPressToMinion(choice.params["target"]!);
        return;
      case "burnunlock":
        ops.emit({ type: "MinionUnlocked", minion: choice.params["target"]! });
        ops.burnMinion(me);
        return;
      case "stealth": {
        const af = ops.action();
        if (!af) return;
        // Locks the ALLY (a minion), not its self-attached card entry.
        ops.emit({ type: "MinionLocked", minion: me });
        ops.emit({
          type: "StealthModified",
          actionId: af.actionId,
          delta: ab!.lockForStealth!.amount,
          source: spec.name,
        });
        return;
      }
      case "copybleed": {
        const af = ops.action();
        if (!af) return;
        const copy = choice.params["target"]!;
        const bfc = entry.statics.bleedFromCopy!;
        if (bfc.cost === "lockCopy") ops.emit({ type: "MinionLocked", minion: copy });
        else ops.emit({ type: "BloodBurned", minion: copy, amount: 1 });
        ops.emit({
          type: "BleedAmountModified",
          actionId: af.actionId,
          delta: bfc.amount,
          source: spec.name,
          limited: false,
        });
        return;
      }
      case "clanbleed": {
        const af = ops.action();
        if (!af) return;
        const b = entry.statics.bleedFromClanBlood!;
        ops.emit({ type: "BloodBurned", minion: choice.params["target"]!, amount: b.blood });
        ops.emit({
          type: "BleedAmountModified",
          actionId: af.actionId,
          delta: b.amount,
          source: spec.name,
          limited: false,
        });
        return;
      }
      case "copyprevent": {
        const p = entry.statics.preventForCopy!;
        ops.emit({ type: "BloodBurned", minion: me, amount: p.life });
        ops.preventDamageFor(choice.params["target"]!, p.amount);
        return;
      }
      case "stealthpenalty": {
        const af = ops.action();
        if (!af) return;
        // Stealth is a FOLD over the event log, so a negative modifier is
        // the whole implementation and later increases still land.
        ops.emit({
          type: "StealthModified",
          actionId: af.actionId,
          delta: -ab!.burnForStealthPenalty!.amount,
          source: spec.name,
        });
        ops.burnMinion(me);
        return;
      }
      case "failaction":
        ops.failAction();
        ops.burnMinion(me);
        return;
      case "grant": {
        const af = ops.action();
        if (!af) return;
        // Locks the ALLY (a minion), not its self-attached card entry.
        ops.emit({ type: "MinionLocked", minion: me });
        const amount = ab!.lockForGrant!.amount;
        if (choice.params["grant"] === "stealth") {
          ops.emit({
            type: "StealthModified",
            actionId: af.actionId,
            delta: amount,
            source: spec.name,
          });
        } else {
          ops.emit({
            type: "InterceptModified",
            actionId: af.actionId,
            minion: choice.params["target"]!,
            delta: amount,
            source: spec.name,
          });
        }
        return;
      }
      case "cancelstrike":
        ops.emit({ type: "BloodBurned", minion: me, amount: ab!.cancelOpposingStrikeCard!.life });
        // "…and its cost is not paid" — the Sudden Reversal wording, which
        // refunds. The cancelled play never sets `cf.strikes[side]`, so
        // "the minion chooses a strike again" is the settle loop's own
        // behaviour and needs no code (§5).
        ops.cancelPendingCard(true);
        return;
      default:
        priorUse?.(entry, owner, choice, ops);
    }
  };
}

/**
 * What an `attachToOpponent` card does once it is sitting on somebody
 * else's vampire (docs/taking-actions-design.md §6).
 *
 * The two cards in the family are Puppet Master (freeze them, then cash
 * the card in to borrow them) and Slaughtering the Herd (siphon a blood
 * every time they act). Grafted rather than assigned over, for the reason
 * `addLocationAbilities` records.
 */
function addOpponentAttachBehaviour(spec: CardSpec, handler: CardHandler): void {
  const eff = spec.modes
    .flatMap((m) => m.effects)
    .find((e) => e.kind === "attachToOpponent") as
    | Extract<EffectPrimitive, { kind: "attachToOpponent" }>
    | undefined;
  if (!eff) return;

  if (eff.siphonOnAnnounce) {
    const amount = eff.siphonOnAnnounce;
    handler.onActionAnnounced = (entry, owner, info, ops) => {
      // "Each time THE ATTACHED VAMPIRE announces an action…"
      if (!owner.minion || info.minion !== owner.minion) return;
      const bearer = findMinion(ops.state, owner.minion);
      const to = entry.linkedMinion ? findMinion(ops.state, entry.linkedMinion) : null;
      if (!bearer || !to) return;
      // The blood MOVES: burnt from one, gained by the other, clamped by
      // the receiver's capacity like every other gain (p. 11).
      const moved = Math.min(amount, bearer.blood);
      if (moved <= 0) return;
      ops.emit({ type: "BloodBurned", minion: bearer.id, amount: moved });
      ops.emit({ type: "BloodGained", minion: to.id, amount: moved });
    };
  }

  if (eff.burnWhenActorLeavesReady) {
    // "Burn this card after THIS ACTING VAMPIRE leaves the ready region"
    // — the player's vampire, not the bearer, which is the whole reason
    // the entry records `linkedMinion`.
    handler.onLeaveReady = (entry, _owner, info, ops) => {
      if (entry.linkedMinion && info.minion === entry.linkedMinion) {
        ops.burnPermanent(entry.card.id);
      }
    };
  }

  const cashIn = eff.cashIn;
  if (!cashIn) return;
  // The entry sits on ANOTHER Methuselah's vampire, so `abilityOptionsFor`
  // scans it under THEIR seat — and skips foreign handlers that do not opt
  // in. The ability belongs to the card's controller, who is exactly the
  // "foreign" seat here, so this is the opt-in the flag exists for; the
  // `ctx.seat === controller` gate below does the real work.
  //
  // The mirror of Disarm's buy-off, which belongs to the seat holding the
  // minion and therefore needs no flag. Which seat an ability belongs to
  // is a per-card question, and getting it backwards silently offers the
  // card to nobody. docs/taking-actions-design.md §3
  handler.abilityAnySeat = true;
  const baseOptions = handler.abilityOptions?.bind(handler);
  const baseUse = handler.useAbility?.bind(handler);

  handler.abilityOptions = (entry, owner, ctx) => {
    const out: LegalOption[] = baseOptions ? [...baseOptions(entry, owner, ctx)] : [];
    const controller = entry.controller ?? owner.seat;
    // "During YOUR next minion phase" — the card's controller, on their
    // own turn (the 2026-08-02 `turnSeat` bug).
    if (ctx.window !== "turn.minion") return out;
    if (ctx.seat !== controller || ctx.turnSeat !== controller) return out;
    const bearer = owner.minion === null ? null : findMinion(ctx.state, owner.minion);
    if (!bearer) return out;
    out.push({
      id: `ability:${spec.name}:${entry.card.id}:cashin`,
      kind: "useAbility",
      label: `${spec.name}: burn it to take control of ${bearer.name} this turn`,
      source: entry.card.id,
      params: { act: "cashIn" },
    });
    return out;
  };

  handler.useAbility = (entry, owner, choice, ops) => {
    if (choice.params["act"] === "cashIn") {
      const controller = entry.controller ?? owner.seat;
      const bearerId = owner.minion;
      // Burn the card FIRST: it is what was freezing the bearer, and
      // `preventsUnlock` is read off the entry.
      ops.burnPermanent(entry.card.id);
      if (!bearerId || !findMinion(ops.state, bearerId)) return;
      if (cashIn.unlockBearer) ops.emit({ type: "MinionUnlocked", minion: bearerId });
      if (cashIn.borrowUntilEndOfTurn) ops.borrowMinion(bearerId, controller);
      return;
    }
    if (!baseUse) throw new Error(`${spec.name} has no ability`);
    baseUse(entry, owner, choice, ops);
  };
}

/**
 * What a COMBAT card does once it has put itself into play
 * (docs/combat-attachments-design.md). The sibling of
 * `addAttachedCardBehaviour`, kept separate because the clauses are
 * different ones, and grafted onto whatever the type compiler produced
 * for the same reason: a card can carry more than one.
 *
 * Three clauses, from three cards:
 *   - `attachInCombat.burnToPrevent` — Wall of Filth;
 *   - `attachSelf.combatLockGrant`  — Monstrous Form superior;
 *   - `permanent.bearerCanBurn`     — Disarm;
 * plus `strikeAttachToVictim.bearerUnlockBurn` — Sculpt the Flesh.
 */
function addCombatAttachBehaviour(spec: CardSpec, handler: CardHandler): void {
  const effects = spec.modes.flatMap((m) => m.effects);
  const attach = effects.find((e) => e.kind === "attachInCombat") as
    | Extract<EffectPrimitive, { kind: "attachInCombat" }>
    | undefined;
  const selfAttach = effects.find((e) => e.kind === "attachSelf") as
    | Extract<EffectPrimitive, { kind: "attachSelf" }>
    | undefined;
  const victimAttach = effects.find((e) => e.kind === "strikeAttachToVictim") as
    | Extract<EffectPrimitive, { kind: "strikeAttachToVictim" }>
    | undefined;
  // Whether the card CAN prevent is a spec question; the amount and the
  // filter are read off the entry, which knows which mode created it.
  const canPrevent = attach?.burnToPrevent !== undefined;
  const lockGrant = selfAttach?.combatLockGrant;
  const buyOff = spec.permanent?.bearerCanBurn;
  const unlockBurn = victimAttach?.bearerUnlockBurn;

  if (unlockBurn) {
    // "During their unlock phase, the attached minion burns 1 blood or
    // life." `owner.seat` on this hook is the seat whose unlock phase it
    // is, so it already means "their". Allies hold life, not blood
    // (p. 22) — the block-tax wave's distinction.
    const priorUnlock = handler.onControllerUnlock;
    handler.onControllerUnlock = (entry, owner, ops) => {
      priorUnlock?.(entry, owner, ops);
      if (!owner.minion) return;
      const bearer = findMinion(ops.state, owner.minion);
      if (!bearer) return;
      // An ally's life lives in the same `blood` field behind the `kind`
      // discriminant (docs/allies-retainers-design.md), so "1 blood or
      // life" is one emit; the depletion sweep burns an ally that hits 0.
      const amount = Math.min(unlockBurn, bearer.blood);
      if (amount <= 0) return;
      ops.emit({ type: "BloodBurned", minion: bearer.id, amount });
      void entry;
    };
  }

  if (!canPrevent && !lockGrant && !buyOff) return;

  const baseOptions = handler.abilityOptions?.bind(handler);
  const baseUse = handler.useAbility?.bind(handler);

  handler.abilityOptions = (entry, owner, ctx) => {
    const out: LegalOption[] = baseOptions ? [...baseOptions(entry, owner, ctx)] : [];
    const bearer = owner.minion === null ? null : findMinion(ctx.state, owner.minion);
    if (!bearer) return out;
    const controller = entry.controller ?? owner.seat;

    // "This vampire can burn this card to prevent N damage in combat"
    // (Wall of Filth) — the bearer's own card, so its controller asks.
    const prevent = entry.statics.burnToPrevent;
    if (prevent && ctx.window === "combat.damageResolution" && ctx.seat === controller) {
      const cf = ctx.combat;
      const pd = cf?.pendingDamage[0];
      if (cf && pd && pd.minion === bearer.id) {
        // "…prevent N NON-AGGRAVATED damage" — a gate on the option, so
        // the card is never offered against damage it cannot touch (§3).
        if (!(prevent.nonAggravated && pd.aggravated)) {
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:prevent`,
            kind: "useAbility",
            label: `${spec.name}: burn it to prevent ${prevent.amount} damage`,
            source: entry.card.id,
            params: { act: "burnToPrevent" },
          });
        }
      }
    }

    // "During combat, you can lock this card to give this vampire +1
    // strength this round, or 1 maneuver or press" (Monstrous Form).
    if (lockGrant && ctx.seat === controller && !entry.locked && ctx.combat) {
      const cf = ctx.combat;
      const side =
        bearer.id === cf.acting ? "acting" : bearer.id === cf.opposing ? "opposing" : null;
      if (side) {
        if (lockGrant.strengthRound && ctx.window === "combat.beforeStrikes") {
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:strength`,
            kind: "useAbility",
            label: `${spec.name}: lock it for +${lockGrant.strengthRound} strength this round`,
            source: entry.card.id,
            params: { act: "combatStrength" },
          });
        }
        // A maneuver and a press each belong in the step that spends
        // them, so the card is offered exactly where it is usable.
        if (lockGrant.maneuver && ctx.window === "combat.beforeRange") {
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:maneuver`,
            kind: "useAbility",
            label: `${spec.name}: lock it for 1 maneuver`,
            source: entry.card.id,
            params: { act: "combatManeuver" },
          });
        }
        if (lockGrant.press && ctx.window === "combat.beforeRange") {
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:press`,
            kind: "useAbility",
            label: `${spec.name}: lock it for 1 press`,
            source: entry.card.id,
            params: { act: "combatPress" },
          });
        }
      }
    }

    // "They can burn N blood to burn this card" (Disarm) — the BEARER'S
    // controller, not the card's, and with NO timing restriction, because
    // the card prints none (§5). Gating it to `turn.*` was the first
    // attempt and made it unreachable in exactly the case it exists for:
    // a vampire put in torpor by Disarm at End of Round is stuck there
    // until their controller's next turn comes round.
    // `abilityOptionsFor` scans the seat's own cards in play, and a card
    // attached to their minion is one.
    //
    // The seat to compare is the BEARER'S controller, read off the
    // minion. `owner.seat` is `entry.controller ?? holder`, i.e. the
    // card's own controller — which for Disarm is the player who PLAYED
    // it, and offering them the buy-off would be exactly backwards.
    if (buyOff && ctx.seat === bearer.controller) {
      if (bearer.kind === "vampire" && bearer.blood >= buyOff.blood) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:buyoff`,
          kind: "useAbility",
          label: `${bearer.name}: burn ${buyOff.blood} blood to burn ${spec.name}`,
          source: entry.card.id,
          params: { act: "bearerBurn", bearer: bearer.id },
        });
      }
    }
    return out;
  };

  handler.useAbility = (entry, owner, choice, ops) => {
    const act = choice.params["act"];
    if (act === "burnToPrevent" && owner.minion) {
      const p = entry.statics.burnToPrevent;
      if (!p) throw new Error(`${spec.name}: no prevention on this card`);
      ops.preventDamageFor(owner.minion, p.amount);
      ops.burnPermanent(entry.card.id);
      return;
    }
    if (act === "combatStrength" && lockGrant?.strengthRound && owner.minion) {
      ops.emit({ type: "PermanentLocked", cardId: entry.card.id });
      ops.addRoundStrengthTo(owner.minion, lockGrant.strengthRound);
      return;
    }
    if (act === "combatManeuver" && owner.minion) {
      ops.emit({ type: "PermanentLocked", cardId: entry.card.id });
      ops.grantManeuverCreditTo(owner.minion);
      return;
    }
    if (act === "combatPress" && owner.minion) {
      ops.emit({ type: "PermanentLocked", cardId: entry.card.id });
      ops.grantCombatPressToMinion(owner.minion);
      return;
    }
    if (act === "bearerBurn" && buyOff) {
      const on = choice.params["bearer"];
      if (!on) throw new Error(`${spec.name}: no bearer`);
      ops.emit({ type: "BloodBurned", minion: on, amount: buyOff.blood });
      ops.burnPermanent(entry.card.id);
      return;
    }
    if (!baseUse) throw new Error(`${spec.name} has no ability`);
    baseUse(entry, owner, choice, ops);
  };
}

/**
 * What an action card DOES once it has attached itself to a minion
 * (docs/action-attachments-design.md). The static half is
 * `attachOnSuccess`; this is everything after it lands — the hooks that
 * burn it, the payout when the prey is ousted, and the two abilities it
 * offers its bearer.
 *
 * Grafted onto whatever the type compiler produced, never assigned over
 * it, for the reason `addLocationAbilities` records: a card can carry more
 * than one of these clauses.
 */
function addAttachedCardBehaviour(spec: CardSpec, handler: CardHandler): void {
  const eff = spec.modes
    .flatMap((m) => m.effects)
    .find((e) => e.kind === "attachSelf") as
    | Extract<EffectPrimitive, { kind: "attachSelf" }>
    | undefined;
  const unlockAbility = spec.modes
    .flatMap((m) => m.effects)
    .some((e) => e.kind === "lockCardToUnlockBearer");
  if (!eff && !unlockAbility) return;

  if (eff?.burnWhenBearerLeavesReady) {
    // "Burn this card if this vampire is in torpor" (Heroic Might) — the
    // hook already distinguishes torpor from being burned.
    handler.onLeaveReady = (entry, owner, info, ops) => {
      if (info.minion !== owner.minion) return;
      ops.burnPermanent(entry.card.id);
    };
  }
  if (eff?.burnAtControllerUnlock) {
    // "Burn this card during your unlock phase" (Khabar: Glory).
    const priorUnlock = handler.onControllerUnlock;
    handler.onControllerUnlock = (entry, owner, ops) => {
      priorUnlock?.(entry, owner, ops);
      ops.burnPermanent(entry.card.id);
    };
  }
  if (eff?.poolWhenPreyOusted) {
    const gain = eff.poolWhenPreyOusted;
    // Fired BEFORE the Ousted event, which is the only moment
    // `preyOf(controller)` still names the seat going out
    // (docs/pool-drain-design.md).
    handler.onSeatOusted = (entry, owner, ousted, ops) => {
      const controller = entry.controller ?? owner.seat;
      if (preyOf(ops.state, controller) !== ousted) return;
      ops.emit({ type: "PoolGained", seat: controller, amount: gain });
    };
  }

  const baseOptions = handler.abilityOptions?.bind(handler);
  const baseUse = handler.useAbility?.bind(handler);
  if (
    !eff?.grantsBurnEquipmentStrike &&
    eff?.grantsRangedDamageStrike === undefined &&
    !unlockAbility
  ) {
    return;
  }

  handler.abilityOptions = (entry, owner, ctx) => {
    const out: LegalOption[] = baseOptions ? [...baseOptions(entry, owner, ctx)] : [];
    const bearer = owner.minion === null ? null : findMinion(ctx.state, owner.minion);
    if (!bearer) return out;
    if (unlockAbility && ctx.window === "turn.minion") {
      // "During your minion phase, this vampire can lock this card to
      // unlock" (Rutor's Hand).
      if (ctx.seat === (entry.controller ?? owner.seat) && !entry.locked && bearer.locked) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:unlock`,
          kind: "useAbility",
          label: `${spec.name}: lock it to unlock ${bearer.name}`,
          source: entry.card.id,
          params: { act: "unlockBearer" },
        });
      }
    }
    if (
      (eff?.grantsBurnEquipmentStrike || eff?.grantsRangedDamageStrike !== undefined) &&
      ctx.window === "combat.chooseStrike"
    ) {
      const cf = ctx.combat;
      if (!cf) return out;
      const side = bearer.id === cf.acting ? "acting" : bearer.id === cf.opposing ? "opposing" : null;
      if (!side) return out;
      const chooser = cf.strikes.acting === null ? "acting" : "opposing";
      if (chooser !== side || cf.strikes[side] !== null) return out;
      // "Strikes that are not hand strikes cannot be used this round"
      // (Immortal Grapple) — a granted strike is not a hand strike.
      if (cf.handStrikesOnly) return out;
      // "…strike: 2R damage" (Heroic Might superior) — the second granted
      // strike on the same card. Both live in this one block and are told
      // apart by the verb in the option id.
      if (eff.grantsRangedDamageStrike !== undefined) {
        const dmg = eff.grantsRangedDamageStrike;
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:rangedstrike`,
          kind: "useAbility",
          label: `${spec.name}: strike — ${dmg}R damage`,
          source: entry.card.id,
          params: { act: "rangedDamageStrike" },
        });
      }
      const victim = findMinion(ctx.state, side === "acting" ? cf.opposing : cf.acting);
      // "…strike: burn equipment" with nothing to burn is not offered:
      // a strike that provably does nothing is not worth the round's
      // strike (docs/action-attachments-design.md §8.1).
      for (const p of victim?.attached ?? []) {
        if (!p.tags.includes("equipment")) continue;
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:strike:${p.card.id}`,
          kind: "useAbility",
          label: `${spec.name}: strike — burn ${p.card.name}`,
          source: entry.card.id,
          params: { act: "burnEquipmentStrike", equipment: p.card.id },
        });
      }
    }
    return out;
  };

  handler.useAbility = (entry, owner, choice, ops) => {
    const act = choice.params["act"];
    if (act === "unlockBearer") {
      ops.emit({ type: "PermanentLocked", cardId: entry.card.id });
      if (owner.minion) ops.emit({ type: "MinionUnlocked", minion: owner.minion });
      return;
    }
    if (act === "burnEquipmentStrike") {
      const equipment = choice.params["equipment"];
      if (!owner.minion || !equipment) throw new Error(`${spec.name}: bad strike`);
      ops.chooseBurnEquipmentStrike(owner.minion, spec.name, equipment);
      return;
    }
    if (act === "rangedDamageStrike") {
      if (!owner.minion || eff?.grantsRangedDamageStrike === undefined) {
        throw new Error(`${spec.name}: bad strike`);
      }
      // A fixed-damage ranged strike from a card in play — the same op the
      // weapons use, which carries no equipment assumption of its own.
      ops.chooseWeaponStrike(owner.minion, entry.card.id, {
        name: spec.name,
        damage: eff.grantsRangedDamageStrike,
        ranged: true,
      });
      return;
    }
    if (!baseUse) throw new Error(`${spec.name} has no ability`);
    baseUse(entry, owner, choice, ops);
  };
}

/**
 * The two location abilities that fire in windows no other `lockGrant`
 * uses — Cappadocian Crypt's post-action blood and Meditative Grove's
 * frenzy cancel (docs/blood-locations-design.md §5–§6).
 *
 * Grafted onto whatever `abilityOptions`/`useAbility` the type compiler
 * already produced rather than assigning over them: Meditative Grove is
 * ALSO a hunting ground, and clobbering would have silently removed its
 * blood grant. That is the `choiceByKey` lesson, applied before it bit —
 * each clause claims its options by an `act` param and one dispatcher
 * reads the map.
 */
function addLocationAbilities(spec: CardSpec, handler: CardHandler): void {
  const perm = spec.permanent;
  const afterBlood = perm?.afterActionBlood;
  const frenzy = perm?.frenzyCancel;
  const exchange = perm?.ashExchange;
  const combatEnd = perm?.combatEndGrant;
  const drawBury = perm?.unlockDrawBury;
  const strikeGrant = perm?.grantsStrikePerCombat;
  const vest = perm?.preventByStrikeSource;
  const bleedSale = perm?.discardForBleed;
  const rescue = perm?.torporRescue;
  const transfers = perm?.transferAbilities;
  const peek = perm?.cryptPeek;
  const ambush = perm?.preReferendumAmbush;
  if (
    !afterBlood &&
    !frenzy &&
    !exchange &&
    !combatEnd &&
    !drawBury &&
    !strikeGrant &&
    !vest &&
    !bleedSale &&
    !rescue &&
    !transfers &&
    !peek &&
    !ambush
  ) {
    return;
  }

  const baseOptions = handler.abilityOptions?.bind(handler);
  const baseUse = handler.useAbility?.bind(handler);
  const extraUse: Record<
    string,
    (
      entry: PermanentInPlay,
      owner: { seat: SeatId; minion: MinionId | null },
      choice: Extract<LegalOption, { kind: "useAbility" }>,
      ops: EngineOps,
    ) => void
  > = {};

  if (frenzy) handler.abilityInAsPlayed = true;

  handler.abilityOptions = (entry, owner, ctx) => {
    const out: LegalOption[] = baseOptions ? [...baseOptions(entry, owner, ctx)] : [];
    const controller = entry.controller ?? owner.seat;
    if (ctx.seat !== controller) return out;
    if (afterBlood && ctx.window === "action.afterResolution" && !entry.locked) {
      const af = ctx.action;
      const card = af?.card;
      const ok =
        af !== null &&
        card !== null &&
        card !== undefined &&
        (!afterBlood.successOnly || af.resolvedSuccess === true) &&
        (() => {
          const h = ctx.registry[card.instance.name];
          if (!h) return false;
          // "requiring Hecata OR Oblivion [obl]" — either list matching is
          // enough, which is what the card says.
          const clans = h.requiresClans?.() ?? [];
          const disc = h.requiresDisciplines?.(card.mode, card.params["variant"]) ?? [];
          return (
            (afterBlood.requiresClan ?? []).some((c) => clans.includes(c)) ||
            (afterBlood.requiresDiscipline ?? []).some((d) => disc.includes(d))
          );
        })();
      if (ok) {
        for (const m of getSeat(ctx.state, controller).minions) {
          if (m.kind !== "vampire" || !isReady(m)) continue;
          // A full vampire gains nothing, and this ability locks the card
          // to use (docs/futile-options-design.md).
          if (!canGainBlood(m)) continue;
          if (afterBlood.clan !== undefined && m.clan !== afterBlood.clan) continue;
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:blood:${m.id}`,
            kind: "useAbility",
            label: `${spec.name}: ${m.name} gains ${afterBlood.amount} blood`,
            source: entry.card.id,
            params: { act: "afterActionBlood", target: m.id },
          });
        }
      }
    }
    // "Lock this location and burn N pool during your unlock phase to
    // exchange one card from your hand for one card in your ash heap
    // requiring an Anarch" — one option per PAIR: the card's own text
    // makes it a single decision (docs/cheap-tail-design.md §1).
    if (
      exchange &&
      ctx.window === "turn.unlock" &&
      ctx.turnSeat === controller &&
      !entry.locked &&
      getSeat(ctx.state, controller).pool >= exchange.poolCost
    ) {
      const seat = getSeat(ctx.state, controller);
      for (const back of seat.ashHeap ?? []) {
        const sects = ctx.registry[back.name]?.requiresSects?.() ?? [];
        const want: string[] = exchange.requiresSect ?? [];
        if (want.length > 0 && !sects.some((s) => want.includes(s))) continue;
        for (const out2 of seat.hand) {
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:exchange:${out2.id}:${back.id}`,
            kind: "useAbility",
            label: `${spec.name}: swap ${out2.name} for ${back.name}`,
            source: entry.card.id,
            params: { act: "ashExchange", give: out2.id, take: back.id },
          });
        }
      }
    }
    // "Lock this location before range is determined to end a combat
    // involving an <X> you control and ANOTHER <X>" — both combatants
    // must qualify, and one must be the controller's (§1).
    if (combatEnd && ctx.window === "combat.beforeRange" && !entry.locked) {
      const cf = ctx.combat;
      const a = cf ? findMinion(ctx.state, cf.acting) : null;
      const b = cf ? findMinion(ctx.state, cf.opposing) : null;
      const bearer = owner.minion ? findMinion(ctx.state, owner.minion) : null;
      // Garibaldi: BOTH combatants of the named sect, one of them yours.
      const bySect =
        combatEnd.sect !== undefined &&
        a?.sect === combatEnd.sect &&
        b?.sect === combatEnd.sect &&
        (a.controller === controller || b.controller === controller);
      // Tommaso: one combatant is a TAGGED minion you control; the other
      // side is unconstrained, because the card names only the ally.
      const byTag =
        combatEnd.ownMinionTags !== undefined &&
        [a, b].some(
          (m) =>
            m !== null &&
            m.controller === controller &&
            combatEnd.ownMinionTags!.some((t) => minionHasTag(m, t)),
        );
      const affordable =
        combatEnd.bloodCost === undefined ||
        (bearer !== null && bearer.blood >= combatEnd.bloodCost);
      const readyOk =
        !combatEnd.requiresBearerReady || (bearer !== null && isReady(bearer));
      if (
        (bySect || byTag) &&
        affordable &&
        readyOk &&
        !(combatEnd.oncePerTurn && entry.usedThisTurn)
      ) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:endcombat`,
          kind: "useAbility",
          label:
            combatEnd.bloodCost !== undefined
              ? `${spec.name}: burn ${combatEnd.bloodCost} blood to end this combat`
              : `${spec.name}: lock to end this combat`,
          source: entry.card.id,
          params: { act: "endCombat" },
        });
      }
    }
    // "If the bearer is ready during your unlock phase, you can draw up to
    // N cards without discarding…" — one option per count (§5).
    if (drawBury && ctx.window === "turn.unlock" && ctx.turnSeat === controller) {
      const bearer = owner.minion ? findMinion(ctx.state, owner.minion) : null;
      const seat = getSeat(ctx.state, controller);
      if (bearer && isReady(bearer) && !entry.usedThisPhase) {
        const most = Math.min(drawBury.max, seat.library.length);
        for (let x = 1; x <= most; x++) {
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:drawbury:${x}`,
            kind: "useAbility",
            label: `${spec.name}: draw ${x}, then bury ${x}`,
            source: entry.card.id,
            params: { act: "drawBury", x: String(x) },
          });
        }
      }
    }
    // "Once each combat, this Ravnos can strike: dodge" (Treasured
    // Samadji) — equipment granting a SPECIFIED strike (§7).
    if (
      strikeGrant &&
      ctx.window === "combat.chooseStrike" &&
      owner.minion &&
      !ctx.combat?.handStrikesOnly // Immortal Grapple bars a dodge too
    ) {
      const cf = ctx.combat;
      const bearer = findMinion(ctx.state, owner.minion);
      const side =
        cf && cf.acting === owner.minion
          ? ("acting" as const)
          : cf && cf.opposing === owner.minion
            ? ("opposing" as const)
            : null;
      const chooser = cf && cf.strikes.acting === null ? "acting" : "opposing";
      if (
        cf &&
        side &&
        bearer &&
        chooser === side &&
        cf.strikes[side] === null &&
        (strikeGrant.clan === undefined || bearer.clan === strikeGrant.clan) &&
        // A price the bearer cannot pay is not an option (Agnieszka).
        bearer.blood >= (strikeGrant.bloodCost ?? 0) &&
        !cf.usedThisCombat.includes(entry.card.id) &&
        !(cf.grantedStrikes?.[side] ?? []).some((g) => g.kind === strikeGrant.kind)
      ) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:grantstrike`,
          kind: "useAbility",
          label: `${spec.name}: strike ${strikeGrant.kind}`,
          source: entry.card.id,
          params: { act: "grantStrike" },
        });
      }
    }
    // "Lock this card and burn 1 pool OR 1 blood from a ready <clan> you
    // control during your master phase to move a <clan> from torpor to
    // THEIR CONTROLLER's ready region" (Chantry, §4).
    if (
      rescue &&
      ctx.window === "turn.master" &&
      ctx.turnSeat === controller &&
      !entry.locked
    ) {
      // The payment is a CHOICE: the pool, or any one ready clansman with
      // blood — one option per way of paying (the paymentSplits shape).
      const payers: string[] = [];
      if (getSeat(ctx.state, controller).pool >= 1) payers.push("pool");
      for (const m of getSeat(ctx.state, controller).minions) {
        if (m.kind === "vampire" && m.clan === rescue.clan && isReady(m) && m.blood >= 1) {
          payers.push(m.id);
        }
      }
      // "A <clan>" — ANY Methuselah's, which is what makes the card
      // interesting; filtering to your own would silently narrow it.
      for (const s of ctx.state.seats) {
        if (s.ousted) continue;
        for (const t of s.minions) {
          if (t.kind !== "vampire" || !t.inTorpor || t.clan !== rescue.clan) continue;
          for (const pay of payers) {
            out.push({
              id: `ability:${spec.name}:${entry.card.id}:rescue:${t.id}:${pay}`,
              kind: "useAbility",
              label: `${spec.name}: free ${t.name} (pay ${pay === "pool" ? "1 pool" : `1 blood from ${pay}`})`,
              source: entry.card.id,
              params: { act: "torporRescue", target: t.id, pay },
            });
          }
        }
      }
    }

    // "You can use N transfers to …" — both clauses are influence-phase
    // abilities, because transfers are (§2).
    if (transfers && ctx.window === "turn.influence" && ctx.turnSeat === controller) {
      const tf = ctx.state.frames[0];
      const left = tf?.kind === "turn" ? tf.transfersLeft : 0;
      const seat = getSeat(ctx.state, controller);
      const draw = transfers.cryptDraw;
      // "Draw 1 card from your crypt AND THEN remove a crypt card in your
      // uncontrolled region" is ONE clause with one cost, so it is
      // offered only when both halves can happen.
      if (draw && left >= draw.transfers && seat.crypt.length > 0) {
        for (const u of seat.uncontrolled) {
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:cryptdraw:${u.card.id}`,
            kind: "useAbility",
            label: `${spec.name}: draw from your crypt, removing ${u.card.name} (${draw.transfers} transfer)`,
            source: entry.card.id,
            params: { act: "cryptDraw", target: u.card.id },
          });
        }
      }
      const cash = transfers.cashOut;
      if (cash && left >= cash.transfers) {
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:cashout`,
          kind: "useAbility",
          label: `${spec.name}: burn it for ${cash.gainPool} pool (${cash.transfers} transfers)`,
          source: entry.card.id,
          params: { act: "cashOut" },
        });
      }
    }

    // "If a political action is successful, BEFORE THE REFERENDUM, you
    // can lock this location and a ready unlocked <sect> vampire you
    // control to have that vampire enter combat with the acting vampire"
    // (Yawp Court, §5).
    if (
      ambush &&
      ctx.window === "action.afterResolution" &&
      ctx.seat === controller &&
      !entry.locked
    ) {
      const af = ctx.action;
      const target = af ? findMinion(ctx.state, af.acting) : null;
      // "If a POLITICAL ACTION is successful" — a referendum is pending
      // either because a card in play granted the action
      // (`referendumSource`) or because the card played from hand is a
      // political action, which is what `finishAction` itself asks. The
      // first gate written here checked only the former and so never
      // fired for the ordinary case.
      // Truthiness, not `!== null`: the frame spread OMITS the field when
      // there is no source, so it is `undefined` — and `undefined !== null`
      // is true, which made this gate pass for every action including a
      // plain bleed. Caught by the negative test.
      const referendumPending =
        !!af &&
        (!!af.referendumSource ||
          (!!af.card && !!ctx.registry[af.card.instance.name]?.isPoliticalAction));
      if (af && af.resolvedSuccess === true && referendumPending && target) {
        for (const m of getSeat(ctx.state, controller).minions) {
          if (m.kind !== "vampire" || m.sect !== ambush.sect) continue;
          if (!isReady(m) || m.locked || m.id === target.id) continue;
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:ambush:${m.id}`,
            kind: "useAbility",
            label: `${spec.name}: ${m.name} ambushes ${target.name} before the referendum`,
            source: entry.card.id,
            params: { act: "ambush", minion: m.id },
          });
        }
      }
    }

    // "During a bleed action, a <clan> you control can discard a combat
    // card to get +1 bleed" (Haqim's Law: Retribution, §4).
    if (bleedSale && ctx.action) {
      const af = ctx.action;
      const actor = findMinion(ctx.state, af.acting);
      if (
        af.actionKind === "bleed" &&
        actor &&
        actor.controller === controller &&
        (bleedSale.clan === undefined || actor.clan === bleedSale.clan)
      ) {
        for (const c of getSeat(ctx.state, controller).hand) {
          const types = ctx.registry[c.name]?.costTypes?.(null) ?? [];
          if (!types.some((t) => bleedSale.cardTypes.includes(t))) continue;
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:bleedsale:${c.id}`,
            kind: "useAbility",
            label: `${spec.name}: discard ${c.name} for +${bleedSale.amount} bleed`,
            source: entry.card.id,
            params: { act: "bleedSale", card: c.id },
          });
        }
      }
    }
    // "Once each combat, the bearer can prevent N damage from GUN
    // strikes or M from any other source" (Kevlar Vest, §5).
    if (vest && ctx.window === "combat.damageResolution" && owner.minion) {
      const cf = ctx.combat;
      const pd = cf?.pendingDamage[0];
      if (cf && pd && pd.minion === owner.minion && !cf.usedThisCombat.includes(entry.card.id)) {
        const amount = pd.fromGun ? vest.fromGun : vest.otherwise;
        out.push({
          id: `ability:${spec.name}:${entry.card.id}:vest`,
          kind: "useAbility",
          label: `${spec.name}: prevent ${amount} damage`,
          source: entry.card.id,
          params: { act: "vest", amount: String(amount) },
        });
      }
    }
    if (frenzy && ctx.window === "card.asPlayed" && !entry.locked) {
      const play = ctx.pendingCard;
      const cf = ctx.combat;
      if (play && play.isFrenzy && cf) {
        // Which combatant the frenzy card is used ON, derived from its
        // own mode's effects — the query the round-recurring wave built
        // for Tranquility Shield's immunity (§6).
        const playerSide = play.minion === cf.acting ? "acting" : "opposing";
        const other = playerSide === "acting" ? "opposing" : "acting";
        const target = play.frenzyOnOpponent ? other : playerSide;
        const victim = target === "acting" ? cf.acting : cf.opposing;
        const m = findMinion(ctx.state, victim);
        if (
          m &&
          m.controller === controller &&
          (frenzy.clan === undefined || m.clan === frenzy.clan)
        ) {
          out.push({
            id: `ability:${spec.name}:${entry.card.id}:cancel`,
            kind: "useAbility",
            label: `${spec.name}: cancel ${play.card.name}`,
            source: entry.card.id,
            params: { act: "frenzyCancel" },
          });
        }
      }
    }
    return out;
  };

  if (afterBlood) {
    extraUse["afterActionBlood"] = (entry, _owner, choice, ops) => {
      const target = choice.params["target"];
      if (!target) throw new Error(`${spec.name}: no blood target`);
      ops.emit({ type: "PermanentLocked", cardId: entry.card.id });
      ops.emit({ type: "BloodGained", minion: target, amount: afterBlood.amount });
    };
  }
  if (frenzy) {
    extraUse["frenzyCancel"] = (entry, _owner, _choice, ops) => {
      ops.emit({ type: "PermanentLocked", cardId: entry.card.id });
      // "(cost is still paid)" — no refund, the flag Sudden Reversal
      // already distinguishes.
      ops.cancelPendingCard(false);
    };
  }
  if (exchange) {
    extraUse["ashExchange"] = (entry, owner, choice, ops) => {
      const controller = entry.controller ?? owner.seat;
      ops.emit({ type: "PermanentLocked", cardId: entry.card.id });
      ops.emit({ type: "PoolBurned", seat: controller, amount: exchange.poolCost });
      // The hand card goes to the ash heap and the ash-heap card comes
      // back: an EXCHANGE, so no replacement draw either way.
      ops.discardFromHand(controller, choice.params["give"]!, false);
      ops.takeFromAshHeap(controller, choice.params["take"]!);
    };
  }
  if (rescue) {
    extraUse["torporRescue"] = (entry, owner, choice, ops) => {
      const controller = entry.controller ?? owner.seat;
      const pay = choice.params["pay"];
      ops.emit({ type: "PermanentLocked", cardId: entry.card.id });
      if (pay === "pool") ops.emit({ type: "PoolBurned", seat: controller, amount: 1 });
      else if (pay) ops.emit({ type: "BloodBurned", minion: pay, amount: 1 });
      // `LeftTorpor` returns the minion to THEIR OWN controller's ready
      // region, which is what the card says (§4).
      ops.emit({ type: "LeftTorpor", minion: choice.params["target"]! });
    };
  }
  if (transfers) {
    extraUse["cryptDraw"] = (entry, owner, choice, ops) => {
      const controller = entry.controller ?? owner.seat;
      ops.spendTransfers(transfers.cryptDraw!.transfers);
      ops.drawFromCrypt(controller);
      // REMOVAL, not burning (p. 16) — the two are different fates, and
      // the target is in the UNCONTROLLED region, not in play.
      ops.removeUncontrolledFromGame(controller, choice.params["target"]!);
    };
    extraUse["cashOut"] = (entry, owner, _choice, ops) => {
      const controller = entry.controller ?? owner.seat;
      ops.spendTransfers(transfers.cashOut!.transfers);
      ops.emit({ type: "PoolGained", seat: controller, amount: transfers.cashOut!.gainPool });
      ops.burnPermanent(entry.card.id);
    };
  }
  if (ambush) {
    extraUse["ambush"] = (entry, owner, choice, ops) => {
      const af = ops.action();
      const mine = choice.params["minion"];
      if (!af || !mine) return;
      ops.emit({ type: "PermanentLocked", cardId: entry.card.id });
      ops.emit({ type: "MinionLocked", minion: mine });
      // `queuedCombats` is flushed by `finishAction`, which then pushes
      // the referendum — so the combat happens BEFORE the vote with no
      // sequencing change at all (§5).
      ops.queueCombat(mine, af.acting, {
        kind: "outcome",
        actor: mine,
        seat: entry.controller ?? owner.seat,
        cardId: entry.card.id,
        name: spec.name,
        // "If the acting vampire is STILL READY at the end of combat" —
        // the ambush did not work, and the damage is the price of trying.
        when: "opposingStillReady",
        effect: { kind: "selfDamage", amount: ambush.damageIfTargetReady },
      });
    };
  }
  if (peek) {
    // "Reveal the top card of your crypt…" — an instruction with no "you
    // can", so it resolves without asking (the Rebel precedent, §1).
    handler.onEnterPlay = (entry, owner, ops) => {
      const controller = entry.controller ?? owner.seat;
      const top = getSeat(ops.state, controller).crypt[0];
      if (!top) return;
      if (top.clan === peek.clan) {
        ops.drawFromCrypt(controller);
        ops.emit({
          type: "UncontrolledBloodAdded",
          seat: controller,
          minion: top.id,
          amount: peek.blood,
        });
      } else {
        ops.buryInCrypt(controller, top.id);
      }
    };
  }
  if (bleedSale) {
    extraUse["bleedSale"] = (entry, owner, choice, ops) => {
      const af = ops.action();
      if (!af) return;
      ops.discardFromHand(entry.controller ?? owner.seat, choice.params["card"]!, true);
      ops.emit({
        type: "BleedAmountModified",
        actionId: af.actionId,
        delta: bleedSale.amount,
        source: spec.name,
        // Not printed "(limited)", and p. 20's rule is about action
        // MODIFIER cards; this is an ability of a card in play — the
        // Club Illusion reading.
        limited: false,
      });
    };
  }
  if (vest) {
    extraUse["vest"] = (entry, owner, choice, ops) => {
      if (!owner.minion) return;
      ops.preventDamageAbility(
        owner.minion,
        entry.card.id,
        Number(choice.params["amount"] ?? "0"),
        "combat",
      );
    };
  }
  if (strikeGrant) {
    extraUse["grantStrike"] = (entry, owner, _choice, ops) => {
      if (!owner.minion) return;
      ops.markUsedThisCombat(entry.card.id);
      // "…can BURN 1 BLOOD to strike: combat ends" (Agnieszka). Paid when
      // the strike is taken; the option is not offered without it.
      if (strikeGrant.bloodCost) {
        ops.emit({ type: "BloodBurned", minion: owner.minion, amount: strikeGrant.bloodCost });
      }
      ops.grantStrikeToMinion(owner.minion, { kind: strikeGrant.kind });
    };
  }
  if (combatEnd) {
    extraUse["endCombat"] = (entry, owner, _choice, ops) => {
      // Blood INSTEAD of locking (Tommaso), not as well: the card names
      // one price, and locking a vampire is not something his own text
      // asks for.
      if (combatEnd.bloodCost !== undefined) {
        if (owner.minion) {
          ops.emit({ type: "BloodBurned", minion: owner.minion, amount: combatEnd.bloodCost });
        }
      } else {
        ops.emit({ type: "PermanentLocked", cardId: entry.card.id });
      }
      if (combatEnd.oncePerTurn) entry.usedThisTurn = true;
      ops.endCombatFromOutside();
    };
  }
  if (drawBury) {
    extraUse["drawBury"] = (entry, owner, choice, ops) => {
      const controller = entry.controller ?? owner.seat;
      const x = Number(choice.params["x"] ?? "0");
      entry.usedThisPhase = true;
      ops.drawCards(controller, x);
      // "…and THEN move the same number to the bottom": N successive
      // choices, re-raised one at a time so each list is computed against
      // the hand the previous answer left (the targetDiscard shape).
      ops.raiseChoice({
        seat: controller,
        cardName: spec.name,
        cardId: entry.card.id,
        key: "bury",
        params: { left: String(x) },
      });
    };
  }

  handler.useAbility = (entry, owner, choice, ops) => {
    const act = choice.params["act"];
    const fn = act ? extraUse[act] : undefined;
    if (fn) {
      fn(entry, owner, choice, ops);
      return;
    }
    if (!baseUse) throw new Error(`${spec.name} has no ability`);
    baseUse(entry, owner, choice, ops);
  };
}


type GrantedActionProvider = Pick<
  CardHandler,
  "actionOptions" | "useActionOption" | "resolveGrantedAction"
> & {
  /** Does this provider own the given option id? Checked in order, so the
   *  card's own catch-all provider goes last. */
  owns: (id: string) => boolean;
};

/** Concatenate several granted-action providers into one: options
 *  concatenate, `useActionOption` goes to the provider that owns the
 *  chosen id, and `resolveGrantedAction` is offered to all of them (each
 *  ignores effect keys it did not raise). */
function mergeGrantedActions(
  providers: GrantedActionProvider[],
): Pick<CardHandler, "actionOptions" | "useActionOption" | "resolveGrantedAction"> {
  return {
    actionOptions(entry, owner, ctx) {
      return providers.flatMap((p) => p.actionOptions?.(entry, owner, ctx) ?? []);
    },
    useActionOption(entry, owner, choice, ops) {
      const p = providers.find((x) => x.owns(choice.id));
      if (!p) throw new Error(`no granted-action provider owns ${choice.id}`);
      p.useActionOption?.(entry, owner, choice, ops);
    },
    resolveGrantedAction(entry, af, ops) {
      for (const p of providers) p.resolveGrantedAction?.(entry, af, ops);
    },
  };
}

/**
 * Cards printed as both an action modifier and a combat card (Swallowed
 * by the Night, Rapid Change, Swift Cover, Resist Earth's Grasp): each
 * *mode* is one or the other, so the spec is split by mode and each half
 * compiled by the compiler that already knows its rules. Options come
 * from both halves — the windows never overlap — and a play resolves
 * through whichever half owns the chosen mode.
 */
function compileModifierOrCombat(spec: CardSpec): CardHandler {
  const isCombatMode = (m: CardMode): boolean => combatWindowFor(m) !== null;
  const combatModes = spec.modes.filter(isCombatMode);
  const modifierModes = spec.modes.filter((m) => !isCombatMode(m));
  const combat = compileCombatCard({ ...spec, cardType: "combat", modes: combatModes });
  const modifier = compileModifierOrReaction({
    ...spec,
    cardType: "actionModifier",
    modes: modifierModes,
  });
  return {
    ...modifier,
    isCombatCard: true,
    options(card, ctx) {
      return [
        ...(combatModes.length > 0 ? (combat.options?.(card, ctx) ?? []) : []),
        ...(modifierModes.length > 0 ? (modifier.options?.(card, ctx) ?? []) : []),
      ];
    },
    resolve(play, ops) {
      const mode = modeOf(spec, play.mode, play.params["variant"]);
      (isCombatMode(mode) ? combat : modifier).resolve(play, ops);
    },
  };
}

/**
 * Action/Combat cards (Touch of Valeren) — the same split
 * `compileModifierOrCombat` uses: a mode is a COMBAT mode iff
 * `combatWindowFor` gives it a window, and each half goes to the compiler
 * that already owns its law. The action half must also keep
 * `resolveCardAction`, which is where an action's effects land.
 */
function compileActionOrCombat(spec: CardSpec): CardHandler {
  const isCombatMode = (m: CardMode): boolean => combatWindowFor(m) !== null;
  const combatModes = spec.modes.filter(isCombatMode);
  const actionModes = spec.modes.filter((m) => !isCombatMode(m));
  const combat = compileCombatCard({ ...spec, cardType: "combat", modes: combatModes });
  const action = compileActionCard({ ...spec, cardType: "action", modes: actionModes });
  return {
    ...action,
    isCombatCard: true,
    options(card, ctx) {
      return [
        ...(combatModes.length > 0 ? (combat.options?.(card, ctx) ?? []) : []),
        ...(actionModes.length > 0 ? (action.options?.(card, ctx) ?? []) : []),
      ];
    },
    resolve(play, ops) {
      const mode = modeOf(spec, play.mode, play.params["variant"]);
      (isCombatMode(mode) ? combat : action).resolve(play, ops);
    },
  };
}

/**
 * A CRYPT card. It is never played — a vampire reaches the table by being
 * influenced out — so this handler has no `options` and no `resolve`. All
 * it has to answer is what the vampire's own card puts on them, and the
 * clause compilers `compileSpec` runs afterwards then hang every hook and
 * ability off it exactly as they do for an ally (docs/crypt-plan.md §2).
 */
function compileCrypt(spec: CardSpec): CardHandler {
  return {
    name: spec.name,
    bloodCost: 0,
    poolCost: 0,
    isCryptCard: true,
    permanentStatics: spec.permanent?.statics ?? {},
    permanentTags: spec.permanent?.tags ?? [],
    // A vampire is never played from hand — it is influenced out of the
    // uncontrolled region — so there is no window that could offer it and
    // nothing to resolve. Both are required by `CardHandler`; making them
    // optional would ripple through every call site for one card type.
    options: () => [],
    resolve: () => {
      throw new Error(`${spec.name} is a crypt card and cannot be played`);
    },
    cryptEntry() {
      return {
        statics: spec.permanent?.statics ?? {},
        tags: spec.permanent?.tags ?? [],
      };
    },
    // "\<This vampire\> can enter combat with a minion as a Ⓓ action"
    // (Theo Bell and friends). The SAME clause an ally's card prints, and
    // the same compiler — a crypt card's text rides on a self-attached
    // entry exactly as an ally's does, so the rush needed nothing new
    // (docs/crypt-wave-2.md §1).
    ...rushGrant(spec),
  };
}

function compileByType(spec: CardSpec): CardHandler {
  if (spec.cardType === "crypt") return compileCrypt(spec);
  if (spec.cardType === "actionOrCombat") return compileActionOrCombat(spec);
  if (spec.cardType === "modifierOrCombat") return compileModifierOrCombat(spec);
  if (spec.cardType === "action") return compileActionCard(spec);
  if (spec.cardType === "combat") return compileCombatCard(spec);
  if (spec.cardType === "master") return compileMasterCard(spec);
  if (spec.cardType === "equipment") return compileEquipment(spec);
  if (spec.cardType === "retainer") return compileRetainer(spec);
  if (spec.cardType === "ally") return compileAlly(spec);
  if (spec.cardType === "politicalAction") return compilePoliticalAction(spec);
  return compileModifierOrReaction(spec);
}
