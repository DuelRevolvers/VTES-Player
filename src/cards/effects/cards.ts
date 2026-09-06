/**
 * Implemented V5 cards, as data (docs/card-primitives.md §6). Each spec's
 * krcgId/name/cost/discipline are cross-checked against the generated
 * registry by tests/cards/supported.test.ts, and each card has a
 * deterministic scenario test — both are required before an id is flipped
 * in config/supported.json (CLAUDE.md registry rules).
 */

import type { CardHandler, ConditionalStatic, EngineOps, GameState, HandlerRegistry, LegalOption, MinionState, PermanentInPlay, PermanentStatics, PlayCostCardType, SeatId, VampireTitle } from "../../engine/index.ts";
import { blockEligibleSeats, canAct, canGainBlood, capacityOf, CITY_TITLES, disciplinesOf, handSizeOf, minionHasTag, currentBleed, currentIntercept, currentStealth, findMinion, getMinion, getSeat, isReady, playOptionId, predatorOf, preyOf } from "../../engine/index.ts";
import {
  allocToParams,
  compileSpec,
  enumerateAllocations,
  parseAlloc,
  seatControlsCopy,
  vulnerableGrant,
} from "./compile.ts";
import type { CardSpec } from "./spec.ts";

/**
 * The six Discipline master cards (docs/derived-traits-design.md). One
 * printed text, one spec shape:
 *
 *   "Discipline. Put this card on a vampire. This vampire gets +1 level of
 *    <D> and +1 capacity. Cannot be put on a vampire with superior <D>."
 *
 * Both bonuses are derived at read time (`disciplinesOf`, `capacityOf`),
 * never written onto the minion — so they vanish correctly if the card
 * leaves play, with no bookkeeping.
 *
 * Reading on record: the text says "a vampire", not "a vampire you
 * control". Scoped to `own`, since handing an opponent's vampire a
 * Discipline level and a point of capacity is never a play anyone makes,
 * and it keeps the AI from generating one.
 */
function disciplineCards(): CardSpec[] {
  const all: Array<[number, string, string]> = [
    [100312, "Celerity", "cel"],
    [100572, "Dominate", "dom"],
    [101310, "Obfuscate", "obf"],
    [101424, "Potence", "pot"],
    [101498, "Protean", "pro"],
    [102277, "Oblivion", "obl"],
  ];
  return all.map(([krcgId, name, code]) => ({
    krcgId,
    name,
    cardType: "master" as const,
    bloodCost: 0,
    poolCost: 0,
    permanent: {
      where: "bearer" as const,
      statics: { disciplineBoost: code, capacityBonus: 1 },
      tags: ["discipline"],
      // NOT `exclusiveKey`: a vampire may legally hold two different
      // Discipline cards, and even two of the SAME one (none → basic →
      // superior). The superior gate below is what stops a third.
      attach: {
        scope: "own" as const,
        kind: "vampire" as const,
        notSuperiorDiscipline: code,
      },
    },
    usable: [],
    modes: [{ level: "basic" as const, discipline: null, effects: [] }],
  }));
}

/** The generic single-blood hunting ground (docs/one-off-sweep.md): a
 *  unique location letting one ready vampire gain 1 blood each unlock
 *  phase, once per vampire per turn. ~13 cards share this exact text. */
function huntingGround(krcgId: number, name: string): CardSpec {
  return {
    krcgId,
    name,
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location", "huntingGround"],
      huntingGround: { amount: 1 },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  };
}

const HUNTING_GROUNDS: CardSpec[] = (
  [
    [100015, "Academic Hunting Ground"],
    [100108, "Asylum Hunting Ground"],
    [101102, "Library Hunting Ground"],
    [101354, "Park Hunting Ground"],
    [101415, "Political Hunting Ground"],
    [101808, "Slum Hunting Ground"],
    [101821, "Society Hunting Ground"],
    [101953, "Temple Hunting Ground"],
    [102066, "Underworld Hunting Ground"],
    [102084, "Uptown Hunting Ground"],
    [102150, "Warzone Hunting Ground"],
    [102212, "Zoo Hunting Ground"],
    [102287, "Biotech Company Hunting Ground"],
  ] as Array<[number, string]>
).map(([id, name]) => huntingGround(id, name));

export const cardSpecs: CardSpec[] = [
  ...HUNTING_GROUNDS,
  // --- Weapons gate (docs/weapons-design.md) ---
  {
    krcgId: 100107,
    name: "Assault Rifle",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 5,
    weapon: { damage: 4, ranged: true, aggravated: false, maneuverPerCombat: true },
    permanent: { where: "bearer", statics: {}, tags: ["weapon", "gun"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  // --- The last four combat cards, and a vest
  //     (docs/last-combat-design.md). Combat finishes at 0.
  {
    // "Requires an Anarch. [ani] Strike: hand strike at +1 damage. This
    // strike cannot be dodged. [cel] Strike: dodge, with 1 additional
    // strike (limited). [pot] Strike: hand strike at +2 damage."
    krcgId: 100597,
    name: "Dust Up",
    cardType: "combat",
    bloodCost: 0,
    requiresSect: ["anarch"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "ani",
        variant: "ani",
        effects: [{ kind: "strikeHandBonus", bonus: 1, undodgeable: true }],
      },
      {
        level: "basic",
        discipline: "cel",
        variant: "cel",
        effects: [
          { kind: "strikeDodge" },
          { kind: "additionalStrike", count: 1, limited: true },
        ],
      },
      {
        level: "basic",
        discipline: "pot",
        variant: "pot",
        effects: [{ kind: "strikeHandBonus", bonus: 2 }],
      },
    ],
  },
  {
    // "Only usable at the end of a round of combat. Not usable by a
    // vampire being burned or going to torpor. A vampire can play only
    // one Taste of Vitae each round. This vampire gains blood equal to
    // the amount of blood lost by the opposing vampire to damage this
    // round."
    krcgId: 101945,
    name: "Taste of Vitae",
    cardType: "combat",
    bloodCost: 0,
    combatLimit: "round",
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        // "Not usable by a vampire being burned or going to torpor" —
        // the rule Disarm already needed (§2).
        usable: ["byStillReadyCombatant"],
        effects: [{ kind: "gainOpposingBloodLost" }],
      },
    ],
  },
  {
    // "Only usable before range is determined. [tha] This round, this
    // vampire can strike, ranged: steal 1 blood or life (becoming
    // blood). [THA] As above, but for 2 blood or life."
    krcgId: 102227,
    name: "Hunger of Marduk",
    cardType: "combat",
    bloodCost: 0,
    requiresClan: ["Banu Haqim"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "tha",
        effects: [{ kind: "grantStealBloodStrike", amount: 1 }],
      },
      {
        level: "superior",
        discipline: "tha",
        effects: [{ kind: "grantStealBloodStrike", amount: 2 }],
      },
    ],
  },
  {
    // "[aus] Strike: hand strike or use a melee weapon strike. This
    // strike is at +2 damage. [AUS] Burn 1 blood to cancel the opposing
    // minion's strike card as it is played, and its cost is not paid
    // (the minion chooses a strike again)."
    krcgId: 102350,
    name: "Anticipation",
    cardType: "combat",
    bloodCost: 0,
    requiresClan: ["Salubri"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "aus",
        effects: [{ kind: "strikeHandBonus", bonus: 2, orMeleeWeapon: true }],
      },
      {
        level: "superior",
        discipline: "aus",
        // The Vozhd of Gravesend's clause with a different payer: a card
        // played from hand needs no `abilityInAsPlayed`, which guards
        // abilities of cards IN PLAY (§4).
        effects: [{ kind: "cancelStrikeCard", bloodCost: 1 }],
      },
    ],
  },
  {
    // "Once each combat, the bearer can prevent 2 damage from gun strikes
    // or 1 damage from any other source. A minion can have only one
    // Kevlar Vest."
    krcgId: 101040,
    name: "Kevlar Vest",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 1,
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["Kevlar Vest"],
      preventByStrikeSource: { fromGun: 2, otherwise: 1 },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  // --- The end of the round, and what reopens it
  //     (docs/round-end-design.md).
  {
    // "Only usable if both combatants are still ready. A vampire can play
    // only one Hunting the Quarry each combat. [cel] or [tha] Only usable
    // if combat is about to end. Put this card on the opposing minion.
    // You still control this card. Vampires you control can burn this
    // card to attempt to enter combat with the attached minion as a +1
    // stealth Ⓓ action. [CEL] or [THA] Only usable if combat would end.
    // Instead, this vampire burns 1 blood to start a new round."
    //
    // The queue called this a new combat SUB-STEP for three waves. It is
    // not: `combat.endOfRound` runs AFTER the press step, so
    // `willContinue` is already decided when the window opens (§0).
    krcgId: 102329,
    name: "Hunting the Quarry",
    cardType: "combat",
    bloodCost: 0,
    combatLimit: "combat",
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["Hunting the Quarry"],
      rushGrant: {
        who: { scope: "controller", kind: "vampire" },
        target: { scope: "bearer" },
        stealth: 1,
        burnsCard: true,
      },
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: ["cel", "tha"],
        usable: ["onlyIfCombatWouldEnd", "onlyIfBothCombatantsReady"],
        effects: [
          {
            kind: "attachInCombat",
            to: "opposing",
            when: "endOfRound",
            tags: ["Hunting the Quarry"],
          },
        ],
      },
      {
        level: "superior",
        discipline: ["cel", "tha"],
        usable: ["onlyIfCombatWouldEnd", "onlyIfBothCombatantsReady"],
        effects: [{ kind: "startNewRound", bloodCost: 1 }],
      },
    ],
  },
  {
    // "[aus] Press, only usable to continue combat. If another round of
    // combat occurs, this vampire gets 1 optional maneuver that round.
    // [AUS] Only usable if both combatants are still ready and combat
    // would end. Instead, start a new round."
    krcgId: 101950,
    name: "Telepathic Tracking",
    cardType: "combat",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "aus",
        effects: [
          { kind: "press", continueOnly: true },
          { kind: "combatCredits", maneuver: 1 },
        ],
      },
      {
        level: "superior",
        discipline: "aus",
        usable: ["onlyIfCombatWouldEnd", "onlyIfBothCombatantsReady"],
        effects: [{ kind: "startNewRound" }],
      },
    ],
  },
  {
    // "Grapple. Only usable at close range before strikes are chosen. A
    // vampire can play only one Immortal Grapple each round. [pot]
    // Strikes that are not hand strikes cannot be used this round (by
    // either combatant). [POT] As above, with 1 optional press. If
    // another round of combat occurs, that round is at close range (skip
    // the determine range step for that round)."
    krcgId: 100959,
    name: "Immortal Grapple",
    cardType: "combat",
    bloodCost: 0,
    combatLimit: "round",
    // The keyword machinery was built for Sword of the Archangel, which
    // cancels "a grapple or aim card" and has been enumerating nothing.
    keywords: ["grapple"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "pot",
        usable: ["onlyAtCloseRange"],
        effects: [{ kind: "handStrikesOnly" }],
      },
      {
        level: "superior",
        discipline: "pot",
        usable: ["onlyAtCloseRange"],
        effects: [
          { kind: "handStrikesOnly", skipNextRange: true },
          { kind: "grantPress" },
        ],
      },
    ],
  },
  {
    // "Aim. Only usable as this minion chooses a strike. A minion can
    // play only one aim each strike. If any damage from this strike is
    // successfully inflicted on the opposing minion, they take +2 damage
    // from this strike, and they cannot press this round. They can
    // discard two combat cards to cancel this card as it is played."
    krcgId: 101942,
    name: "Target Vitals",
    cardType: "combat",
    bloodCost: 0,
    keywords: ["aim"],
    payToCancel: { pool: 0, who: "opposingMinion", discardCombatCards: 2 },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [{ kind: "aimBonus", amount: 2 }] }],
  },
  {
    // "[obf] or [tha] Maneuver, only usable to get to close range. [OBF]
    // or [THA] As above, and once this round, this vampire can burn 1
    // blood to get 1 additional maneuver, only usable to get to close
    // range."
    krcgId: 102315,
    name: "Dance with the Devil",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: ["obf", "tha"],
        effects: [{ kind: "maneuver", onlyToClose: true }],
      },
      {
        level: "superior",
        discipline: ["obf", "tha"],
        // "Once this round" — the per-MODE limit, so the basic stays free.
        effects: [
          { kind: "maneuver", onlyToClose: true },
          { kind: "grantCloseManeuver", bloodCost: 1 },
        ],
      },
    ],
  },
  // --- Weapon riders (docs/weapon-riders-design.md): the five weapons the
  //     `spec.weapon` block stopped one field short of.
  {
    // "Weapon: gun. Strike: 2R damage, with 1 optional maneuver each
    // combat. After the bearer strikes with this gun, they get 1 optional
    // additional strike (limited), only usable to strike with this gun,
    // this round."
    krcgId: 100032,
    name: "AK-47",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 5,
    weapon: {
      damage: 2,
      ranged: true,
      aggravated: false,
      maneuverPerCombat: true,
      additionalStrikeSelf: true,
    },
    permanent: { where: "bearer", statics: {}, tags: ["weapon", "gun"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Weapon: gun. Strike: 2R damage, only usable at long range. If the
    // bearer blocks, they can, before range is determined, set the range
    // for the first round of the resulting combat to long, and their
    // initial strike that round must be with this weapon."
    krcgId: 101816,
    name: "Sniper Rifle",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 2,
    weapon: {
      damage: 2,
      ranged: true,
      aggravated: false,
      onlyAtLongRange: true,
      blockSetsLongRange: true,
    },
    permanent: { where: "bearer", statics: {}, tags: ["weapon", "gun"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Melee weapon. Strike: strength+1 damage, with 1 optional press,
    // only usable to continue combat, each combat."
    krcgId: 102359,
    name: "Righteous Blade",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 0,
    requiresClan: ["Salubri"],
    weapon: { damage: null, handBonus: 1, ranged: false, aggravated: false },
    permanent: {
      where: "bearer",
      statics: { continuePressPerCombat: 1 },
      tags: ["weapon", "melee"],
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique melee weapon. Strike: strength+1 aggravated damage. Once
    // each combat, this Salubri can burn 1 blood to cancel a grapple or
    // aim card as it is played by the opposing minion, and its cost is
    // not paid. Once each turn, if the opposing vampire is burned during
    // this weapon's strike resolution and the bearer remains ready, the
    // bearer can unlock at the end of combat."
    krcgId: 102261,
    name: "Sword of the Archangel",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    requiresClan: ["Salubri"],
    weapon: {
      damage: null,
      handBonus: 1,
      ranged: false,
      aggravated: true,
      // The V5 pool's only two keyword cards (Immortal Grapple, Target
      // Vitals) are unsupported, so this correctly matches nothing today
      // — the Wall Street Night precedent (§5).
      cancelKeywordCard: { blood: 1, keywords: ["grapple", "aim"] },
      unlockOnKill: true,
    },
    permanent: { where: "bearer", statics: {}, tags: ["weapon", "melee"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique. The bearer with Auspex [aus] gets +1 intercept. The bearer
    // with superior Auspex [AUS] can burn 1 blood during an action to get
    // an additional +1 intercept."
    //
    // The static's condition is the BEARER, not the action — the fourth
    // ConditionalStatic condition and the first of its kind — and it reads
    // `disciplinesOf`, so a Discipline master switches the card on and off
    // (docs/last-equipment-modifiers-design.md §2).
    krcgId: 100243,
    name: "Bowl of Convergence",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "bearer",
      statics: {
        conditional: [{ intercept: 1, bearerDiscipline: { discipline: "aus" } }],
      },
      equipmentAbilities: {
        // No printed limit, so it is repeatable — and harmless, because
        // p. 26's only-when-needed gate makes the option vanish the moment
        // intercept catches up. It can close a gap, never build a lead.
        interceptForBlood: {
          blood: 1,
          amount: 1,
          requiresDiscipline: "aus",
          level: "superior",
        },
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Only one Flaming Candle can be played or equipped in a game.
    //  This vampire can burn 1 blood and the Flaming Candle as they
    //  announce an action to make that action unblockable by vampires."
    //
    // Game-wide uniqueness needs no new state: the event log is the record
    // of everything ever played (the Week of Nightmares / Open War shape),
    // and is correctly stricter than "in play" for a card that burns
    // itself. The overlay is below.
    krcgId: 100743,
    name: "Flaming Candle",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 0,
    permanent: {
      where: "bearer",
      statics: {},
      equipmentAbilities: { announceUnblockable: { blood: 1, who: "vampires" } },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Location. While in play, this card does not count as equipment.
    //  This vampire gets +1 bleed. They can burn this card before range is
    //  determined to end combat. A vampire can have only one Living Manse."
    //
    // `notEquipment` is the printed opt-out from the central "every
    // equipment card is tagged `equipment`" rule (§1), and this card is the
    // only thing in the pool that asks for it.
    krcgId: 101114,
    name: "Living Manse",
    cardType: "equipment",
    bloodCost: 1,
    poolCost: 0,
    // An Equipment card is played BY a vampire, so its clan tag is a
    // requirement — the Shilmulo Tarot precedent, not Ravnos Carnival's.
    requiresClan: ["Tzimisce"],
    permanent: {
      where: "bearer",
      statics: { bleed: 1 },
      tags: ["location", "notEquipment"],
      notEquipment: true,
      exclusiveKey: "Living Manse",
      equipmentAbilities: { burnToEndCombat: true },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Requires an Anarch. Only usable during a bleed action.
    //  +X bleed (limited). X must be 1, 2 or 3."
    krcgId: 101239,
    name: "Monkey Wrench",
    cardType: "actionModifier",
    bloodCost: 0,
    poolCost: 0,
    requiresSect: ["anarch"],
    usable: ["onlyDuringBleed"],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "modifyBleed", amount: 0, limited: true, xRange: { min: 1, max: 3 } },
        ],
      },
    ],
  },
  {
    // "[obf] +1 stealth.
    //  [OBF] Only usable if a bleed would be successful. Instead, the
    //  bleed burns no pool, is unsuccessful, and this card is put on this
    //  vampire. The next time this vampire is about to successfully bleed
    //  the same Methuselah, burn this card and this vampire gets +2 bleed."
    //
    // "If a bleed would be successful" is p. 27 A.4's state C, and both
    // halves live there: the play, and the payout from the card in play
    // (docs/last-equipment-modifiers-design.md §6).
    krcgId: 101857,
    name: "Spying Mission",
    cardType: "actionModifier",
    bloodCost: 0,
    poolCost: 0,
    permanent: {
      where: "bearer",
      statics: {},
      declinedBleedBonus: { amount: 2, sameSeat: true, burnSelf: true },
    },
    usable: [],
    modes: [
      { level: "basic", discipline: "obf", effects: [{ kind: "modifyStealth", amount: 1 }] },
      {
        level: "superior",
        discipline: "obf",
        usable: ["onlyDuringBleed", "ifActionWouldSucceed"],
        // Order matters: the attach reads `af.target` to record "the same
        // Methuselah", and failing the action must not come first.
        effects: [
          { kind: "afterResolutionAttach", tags: ["spyingMission"], recordTarget: true },
          { kind: "failAction" },
        ],
      },
    ],
  },
  {
    // "Not usable during a bleed action. [obf] +1 stealth.
    //  [OBF] Only usable after resolution of a blocked action. This vampire
    //  burns 1 blood to continue the action as if unblocked."
    //
    // WHOLE as of 2026-09-03. p. 27 puts the block's combat INSIDE action
    // resolution, so "after resolution of a blocked action" really is the
    // `action.afterResolution` window — by which point the card is burned,
    // `ActionResolved` is emitted and the block penalties are paid.
    //
    // Continuing therefore runs the action's SUCCESS EFFECTS ONLY. That is
    // now a function with two callers (`applySuccessEffects`) rather than a
    // re-entry into resolution, which is what makes the "tail already run"
    // guard unnecessary: the tail is simply not in the function being
    // called twice. A distinct `ActionContinued` event keeps the log
    // honest — one resolution happened and failed
    // (docs/ledger-closeout.md §11).
    krcgId: 102355,
    name: "Go-getter",
    cardType: "actionModifier",
    bloodCost: 0,
    poolCost: 0,
    requiresClan: ["Ravnos"],
    usable: ["notDuringBleed"],
    modes: [
      { level: "basic", discipline: "obf", effects: [{ kind: "modifyStealth", amount: 1 }] },
      {
        level: "superior",
        discipline: "obf",
        usable: ["afterResolutionByActor", "ifActionBlocked"],
        effects: [{ kind: "continueAsUnblocked", bloodCost: 1 }],
      },
    ],
  },
  {
    // "Unique. This Ravnos gets +1 bleed. Once each combat, this Ravnos
    // can strike: dodge." Equipment that is NOT a weapon (§7).
    krcgId: 102015,
    name: "Treasured Samadji",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    requiresClan: ["Ravnos"],
    permanent: {
      where: "bearer",
      statics: { bleed: 1 },
      tags: ["equipment"],
      grantsStrikePerCombat: { kind: "dodge", clan: "Ravnos" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 100742,
    name: "Flamethrower",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 4,
    weapon: { damage: 2, ranged: true, aggravated: true },
    permanent: { where: "bearer", statics: {}, tags: ["weapon", "gun"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 101014,
    name: "Ivory Bow",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    weapon: { damage: 1, ranged: true, aggravated: true },
    permanent: { where: "bearer", statics: {}, tags: ["weapon"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 100720,
    name: "Femur of Toomler",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    weapon: { damage: null, handBonus: 1, ranged: false, aggravated: true },
    permanent: { where: "bearer", statics: {}, tags: ["weapon", "melee"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 101032,
    name: "Kali's Fang",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    weapon: { damage: null, handBonus: 1, ranged: false, aggravated: true },
    permanent: { where: "bearer", statics: {}, tags: ["weapon", "melee"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  // --- Strike-effects gate (docs/strike-effects-design.md) ---
  {
    krcgId: 100230,
    name: "Body Flare",
    cardType: "combat",
    bloodCost: 2,
    usable: [],
    modes: [
      { level: "basic", discipline: "pro", effects: [{ kind: "strikeDamage", amount: 2, ranged: false, aggravated: true }] },
      { level: "superior", discipline: "pro", effects: [{ kind: "strikeDamage", amount: 2, ranged: true, aggravated: true }] },
    ],
  },
  {
    krcgId: 102139,
    name: "Walk of Flame",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "tha",
        usable: ["onlyAfterFirstRound"],
        effects: [{ kind: "strikeDamage", amount: 1, ranged: true, aggravated: true }],
      },
      {
        level: "superior",
        discipline: "tha",
        usable: ["onlyAfterFirstRound"],
        effects: [{ kind: "strikeDamage", amount: 2, ranged: true, aggravated: true }],
      },
    ],
  },
  {
    // "Unique location. During an undirected action, you can lock this
    // location to give a minion you control +1 intercept. A minion you
    // control can lock this location to attempt to move 1 counter from an
    // investment card to your pool as a +1 stealth Ⓓ action."
    krcgId: 102142,
    name: "Wall Street Night, Financial Newspaper",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: { grant: "intercept", amount: 1, ownOnly: true, undirectedOnly: true },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Only usable before range is determined during the first round. Put
    // this card with 5 counters on it on this minion; it becomes a melee
    // weapon equipment that can strike: strength+1 damage. For each damage
    // inflicted by this strike (even if prevented), burn 1 counter from
    // this card. Burn this card if it has no counters. A minion can have
    // only one Weighted Walking Stick." (docs/counter-sinks-design.md)
    krcgId: 102169,
    name: "Weighted Walking Stick",
    cardType: "combat",
    bloodCost: 0,
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["weapon", "melee", "Weighted Walking Stick"],
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        usable: ["onlyFirstRound"],
        effects: [{ kind: "attachSelfWeapon", counters: 5 }],
      },
    ],
  },
  {
    // "[obl] Strike: put this card on the opposing minion with 2 counters.
    // The attached minion burns 1 counter from this card instead of
    // unlocking as normal. If this card has no counters, burn it.
    // [OBL] Strike: send the opposing vampire to torpor or burn the
    // opposing ally." (docs/counter-sinks-design.md)
    krcgId: 102283,
    name: "Touch of Oblivion",
    cardType: "combat",
    bloodCost: 2,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "obl",
        effects: [
          {
            kind: "strikeAttachToVictim",
            counters: 2,
            counterSink: { instead: "unlock", burnWhenEmpty: true },
          },
        ],
      },
      { level: "superior", discipline: "obl", effects: [{ kind: "strikeIncapacitate" }] },
    ],
  },
  // ---------------------------------------------------------------------
  // "That block attempt fails" — the acting minion breaking a block that
  // is already underway (docs/fail-block-design.md).
  // ---------------------------------------------------------------------
  {
    // "[obf] +1 stealth. [OBF] Only usable if a minion attempts to block.
    // That attempt fails and the blocking minion cannot attempt to block
    // this action again."
    krcgId: 100617,
    name: "Elder Impersonation",
    cardType: "actionModifier",
    bloodCost: 1,
    usable: [],
    modes: [
      { level: "basic", discipline: "obf", effects: [{ kind: "modifyStealth", amount: 1 }] },
      { level: "superior", discipline: "obf", effects: [{ kind: "failBlockAttempt" }] },
    ],
  },
  {
    // "[cel] or [for] +1 stealth. [CEL] or [FOR] Only usable if a minion
    // attempts to block. That attempt fails and the blocking minion
    // cannot attempt to block this action again."
    krcgId: 102337,
    name: "Relentlessness",
    cardType: "actionModifier",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: ["cel", "for"],
        effects: [{ kind: "modifyStealth", amount: 1 }],
      },
      {
        level: "superior",
        discipline: ["cel", "for"],
        effects: [{ kind: "failBlockAttempt" }],
      },
    ],
  },
  {
    // "Only usable if a minion attempts to block. [dom] The blocking
    // minion gets -1 intercept. [DOM] That attempt fails and the blocking
    // minion cannot attempt to block this action again."
    krcgId: 102250,
    name: "Forced Confessional",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "dom",
        effects: [{ kind: "modifyBlockerIntercept", amount: -1 }],
      },
      { level: "superior", discipline: "dom", effects: [{ kind: "failBlockAttempt" }] },
    ],
  },
  {
    // "Only usable if a minion attempts to block. [obl] The blocking
    // minion gets -1 intercept. [OBL] Burn 1 blood to have that attempt
    // fail; the blocking minion cannot attempt to block this action
    // again."
    krcgId: 102282,
    name: "Stygian Shroud",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "obl",
        effects: [{ kind: "modifyBlockerIntercept", amount: -1 }],
      },
      {
        level: "superior",
        discipline: "obl",
        effects: [{ kind: "failBlockAttempt", bloodCost: 1 }],
      },
    ],
  },
  {
    // "[pot] or [pre] Only usable if a minion attempts to block. The
    // blocking minion gets -1 intercept. [POT] or [PRE] Only usable as the
    // action is announced. Choose a vampire. The chosen vampire cannot
    // block this action."
    krcgId: 102316,
    name: "Dominant Personality",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: ["pot", "pre"],
        effects: [{ kind: "modifyBlockerIntercept", amount: -1 }],
      },
      {
        level: "superior",
        discipline: ["pot", "pre"],
        usable: ["onlyAsAnnounced"],
        effects: [{ kind: "blockRestriction", who: "chosen", chosenScope: "any" }],
      },
    ],
  },
  // ---------------------------------------------------------------------
  // The block tax — who may attempt to block at all, and what the attempt
  // costs them (docs/block-tax-design.md).
  // ---------------------------------------------------------------------
  {
    // "[obl] +1 stealth. [OBL] As above, and minions without Oblivion
    // [obl] must burn 1 blood to attempt to block (allies cannot burn
    // blood)."
    krcgId: 102285,
    name: "Where the Veil Thins",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "obl", effects: [{ kind: "modifyStealth", amount: 1 }] },
      {
        level: "superior",
        discipline: "obl",
        // The stealth half is "when needed" (p. 26) but the toll is not,
        // so the mode carries the exemption that lets it be played on its
        // own merits.
        usable: ["evenIfNotNeeded"],
        effects: [
          { kind: "modifyStealth", amount: 1 },
          // "(allies cannot burn blood)" is the general rule spelled out:
          // payWith "blood" already keeps allies from paying, and so from
          // attempting at all.
          { kind: "blockCost", amount: 1, payWith: "blood", exemptDiscipline: "obl" },
        ],
      },
    ],
  },
  {
    // "Only usable as the action is announced. [obf] or [pre] Minions must
    // burn 1 blood to attempt to block this action. [OBF] or [PRE] As
    // above, and choose a vampire. The chosen vampire cannot block this
    // action."
    krcgId: 102338,
    name: "Seeds of Terror",
    cardType: "actionModifier",
    bloodCost: 1,
    usable: ["onlyAsAnnounced"],
    modes: [
      {
        level: "basic",
        discipline: ["obf", "pre"],
        effects: [{ kind: "blockCost", amount: 1, payWith: "blood" }],
      },
      {
        level: "superior",
        discipline: ["obf", "pre"],
        effects: [
          { kind: "blockCost", amount: 1, payWith: "blood" },
          { kind: "blockRestriction", who: "chosen", chosenScope: "any" },
        ],
      },
    ],
  },
  {
    // "[pot] or [pre] Minions must burn 1 blood or life to attempt to
    // block this action. [POT] or [PRE] As above, and minions get -1
    // intercept."
    krcgId: 102346,
    name: "Unthinkable Humiliation",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: ["pot", "pre"],
        effects: [{ kind: "blockCost", amount: 1, payWith: "bloodOrLife" }],
      },
      {
        level: "superior",
        discipline: ["pot", "pre"],
        effects: [
          { kind: "blockCost", amount: 1, payWith: "bloodOrLife" },
          { kind: "modifyAllIntercept", amount: -1 },
        ],
      },
    ],
  },
  {
    // "Only usable as the action is announced. [dom] Choose a locked
    // vampire. The chosen vampire cannot block this action. [DOM] During
    // this action, minions cannot unlock."
    krcgId: 101805,
    name: "The Sleeping Mind",
    cardType: "actionModifier",
    bloodCost: 1,
    usable: ["onlyAsAnnounced"],
    modes: [
      {
        level: "basic",
        discipline: "dom",
        effects: [{ kind: "blockRestriction", who: "chosen", chosenScope: "locked" }],
      },
      {
        level: "superior",
        discipline: "dom",
        effects: [
          { kind: "blockRestriction", who: "chosen", chosenScope: "locked" },
          { kind: "preventUnlockDuringAction" },
        ],
      },
    ],
  },
  {
    // "[for] Vampires cannot block this action. This vampire takes 2
    // unpreventable environmental aggravated damage after action
    // resolution. [FOR] As above, but this vampire takes 1."
    krcgId: 100492,
    name: "Daring the Dawn",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "for",
        effects: [
          { kind: "blockRestriction", who: "vampires" },
          { kind: "selfDamageAfterAction", amount: 2, aggravated: true },
        ],
      },
      {
        level: "superior",
        discipline: "for",
        effects: [
          { kind: "blockRestriction", who: "vampires" },
          { kind: "selfDamageAfterAction", amount: 1, aggravated: true },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------
  // Discipline master cards (docs/derived-traits-design.md) — six cards,
  // one shape: "Put this card on a vampire. This vampire gets +1 level of
  // <D> and +1 capacity. Cannot be put on a vampire with superior <D>."
  // Both effects are DERIVED (capacityOf / disciplinesOf), never written
  // onto the minion.
  // ---------------------------------------------------------------------
  ...disciplineCards(),
  // ---------------------------------------------------------------------
  // Actor-side combat riders — "if this action is blocked, the ACTING
  // minion gets X in the resulting combat" (docs/actor-riders-design.md),
  // the mirror of the blockerCombatRider cluster.
  // ---------------------------------------------------------------------
  {
    // "[ani][pro] +1 stealth. If this vampire is blocked, they can prevent
    // 1 damage during the resulting combat. [ANI][PRO] Only usable as a
    // non-bleed action is announced. Vampires cannot block this action."
    krcgId: 100146,
    name: "Beast Meld",
    cardType: "actionModifier",
    bloodCost: 2,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: { all: ["ani", "pro"] },
        // The stealth half is "when needed" (p. 26) but the prevention
        // rider is worth buying on its own, so the mode opts out.
        usable: ["evenIfNotNeeded"],
        effects: [
          { kind: "modifyStealth", amount: 1 },
          { kind: "actorCombatRider", prevent: 1 },
        ],
      },
      {
        level: "superior",
        discipline: { all: ["ani", "pro"] },
        usable: ["notDuringBleed", "onlyAsAnnounced"],
        effects: [{ kind: "blockRestriction", who: "vampires" }],
      },
    ],
  },
  {
    // "+1 stealth action. Requires a baron. Only one Open War can be
    //  played in a game.
    //  Put this card in play. Anarchs can enter combat with a minion as a
    //  Ⓓ action. Anarchs can burn a location as a Ⓓ action that costs 2
    //  pool. Methuselahs can use a master phase action to move 1 counter
    //  from their pool to this card. If this card has 4 counters, burn it
    //  and gain 4 pool."
    //
    // Four clauses, three of them offered to EVERY Methuselah. The rush
    // grant and the "put in play" are spec; the location-burn action, the
    // Methuselah-level master-phase action and the payout are in the
    // bespoke handler. OWNER RULING (2026-08-30): the 4 pool goes to the
    // card's CONTROLLER, not to whoever places the fourth counter.
    // docs/permanent-target-actions-design.md
    krcgId: 101324,
    name: "Open War",
    cardType: "action",
    bloodCost: 0,
    requiresTitle: ["baron"],
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Open War"],
      rushGrant: {
        who: { scope: "any", sect: "anarch" },
        // "…with a minion": no `kind` filter means any minion.
        target: { scope: "any" },
      },
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "putInPlayOnSuccess" },
        ],
      },
    ],
  },
  {
    // "[obf] Ⓓ Burn an equipment.
    //  [OBF] Ⓓ Burn a location."
    // docs/permanent-target-actions-design.md
    krcgId: 100391,
    name: "Conceal",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "obf",
        effects: [{ kind: "actionOnPermanent", what: "equipment", outcome: "burn" }],
      },
      {
        level: "superior",
        discipline: "obf",
        effects: [{ kind: "actionOnPermanent", what: "location", outcome: "burn" }],
      },
    ],
  },
  {
    // "Ⓓ Burn a location and burn 2 pool from its controller."
    //
    // The controller is read BEFORE the burn — once the card is gone
    // there is nobody to charge.
    krcgId: 101632,
    name: "Rewilding",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionOnPermanent", what: "location", outcome: "burn", poolFromController: 2 },
        ],
      },
    ],
  },
  {
    // "[dom] +1 stealth action. Ⓓ Bleed with +1 bleed.
    //  [DOM] Ⓓ Steal a location."
    krcgId: 100573,
    name: "Dominate Kine",
    cardType: "action",
    bloodCost: 2,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "dom",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "actionBleed", bonus: 1 },
        ],
      },
      {
        level: "superior",
        discipline: "dom",
        effects: [{ kind: "actionOnPermanent", what: "location", outcome: "steal" }],
      },
    ],
  },
  {
    // "[pot][pre] Ⓓ Bleed with +1 bleed. If this action is blocked, before
    //  range is determined during the first round of the resulting combat,
    //  this vampire can gain +1 strength that combat.
    //  [POT][PRE] As above, but at +2 bleed and +2 strength."
    //
    // Pure data — `actorCombatRider.strength` is combat-scoped, which is
    // what "that combat" means. RECORDED READING: the card says "can
    // gain" and the rider applies it unconditionally; a costless, purely
    // beneficial bonus is auto-taken. docs/bleed-riders-sweep.md §2
    krcgId: 101772,
    name: "Show of Force",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: { all: ["pot", "pre"] },
        effects: [
          { kind: "actionBleed", bonus: 1 },
          { kind: "actorCombatRider", strength: 1 },
        ],
      },
      {
        level: "superior",
        discipline: { all: ["pot", "pre"] },
        effects: [
          { kind: "actionBleed", bonus: 2 },
          { kind: "actorCombatRider", strength: 2 },
        ],
      },
    ],
  },
  {
    // "[pre] Ⓓ Bleed with +1 bleed. Titled vampires cannot block this
    //  action.
    //  [PRE] As above, and the target Methuselah locks a ready unlocked
    //  minion they control."
    //
    // The lock is the TARGET's choice, not the actor's — a ChoiceFrame
    // raised to that seat. docs/bleed-riders-sweep.md §3
    krcgId: 101495,
    name: "Propaganda",
    cardType: "action",
    bloodCost: 2,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "pre",
        effects: [
          { kind: "actionBleed", bonus: 1 },
          { kind: "blockRestriction", who: "titled" },
        ],
      },
      {
        level: "superior",
        discipline: "pre",
        effects: [
          { kind: "actionBleed", bonus: 1 },
          { kind: "blockRestriction", who: "titled" },
          { kind: "targetLocksOwnMinion" },
        ],
      },
    ],
  },
  {
    // "Requires an Anarch.
    //  [cel] Ⓓ Steal 1 pool from another Methuselah.
    //  [pot] Ⓓ Enter combat with a minion.
    //  [pre] Ⓓ Bleed with +1 bleed."
    //
    // Three inferior modes told apart by discipline, like Invigorate.
    krcgId: 102229,
    name: "Line Brawl",
    cardType: "action",
    bloodCost: 0,
    requiresSect: ["anarch"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "cel",
        variant: "steal",
        effects: [{ kind: "actionStealPool", amount: 1 }],
      },
      {
        level: "basic",
        discipline: "pot",
        variant: "combat",
        effects: [{ kind: "actionEnterCombat", targets: "minion" }],
      },
      {
        level: "basic",
        discipline: "pre",
        variant: "bleed",
        effects: [{ kind: "actionBleed", bonus: 1 }],
      },
    ],
  },
  {
    // "[pre] Ⓓ Bleed with +1 bleed.
    //  [PRE] +1 stealth action. Ⓓ Steal an ally controlled by another
    //  Methuselah."
    //
    // The steal is a control change (docs/control-change-design.md); the
    // ally is chosen at announcement like any action target (p. 25).
    krcgId: 100652,
    name: "Entrancement",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "pre",
        effects: [{ kind: "actionBleed", bonus: 1 }],
      },
      {
        level: "superior",
        discipline: "pre",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "stealMinionOnSuccess", kindFilter: "ally" },
        ],
      },
    ],
  },
  {
    // "[obf] or [pre] Ⓓ Bleed with +1 bleed.
    //  [OBF] or [PRE] As above, and if the bleed is successful (for 1 or
    //  more), this vampire can burn 1 blood to draw 1 card from your
    //  crypt."
    //
    // A crypt card drawn goes to the uncontrolled region (p. 3). "Can
    // burn" is optional, so it is asked rather than taken.
    krcgId: 102320,
    name: "Enthrall",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: ["obf", "pre"],
        effects: [{ kind: "actionBleed", bonus: 1 }],
      },
      {
        level: "superior",
        discipline: ["obf", "pre"],
        effects: [
          { kind: "actionBleed", bonus: 1 },
          { kind: "cryptDrawOnBleedSuccess", bloodCost: 1 },
        ],
      },
    ],
  },
  {
    // "Unique archetype.
    //  Put this card on a Salubri you control. Rescuing a non-Tremere
    //  vampire from torpor costs this Salubri -2 blood, and if the action
    //  is successful, the rescued vampire gains 1 blood. This Salubri can
    //  add 1 blood or life to another ready minion, not to exceed
    //  starting life, as a +1 stealth action. A vampire can have only one
    //  archetype."
    //
    // The rescue discount is a static read at BOTH the option site and
    // the payment site (an actor who could not otherwise afford a split
    // must still be offered it); the granted heal is in the bespoke
    // handler. docs/minion-target-actions-design.md
    krcgId: 102259,
    name: "Saulot's Healing Touch",
    cardType: "master",
    bloodCost: 0,
    unique: true,
    permanent: {
      where: "bearer",
      statics: { rescueDiscount: { amount: 2, notClan: "Tremere", bonusBlood: 1 } },
      tags: ["Saulot's Healing Touch"],
      attach: { scope: "own", kind: "vampire", clan: "Salubri" },
      exclusiveKey: "archetype",
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "[for] [ACTION] +1 stealth action. Add 3 blood or life to a minion,
    //  not to exceed their starting life.
    //  [for] [COMBAT] Prevent all damage from the opposing minion's strike.
    //  [FOR] [COMBAT] Only usable by a ready vampire not involved in the
    //  combat involving another minion you control. Prevent all damage to
    //  that minion from the opposing minion's strike."
    //
    // Action/Combat: the modes split by window, exactly as
    // `modifierOrCombat` already did. "Not to exceed their starting life"
    // is `capacityOf` for BOTH kinds of minion — an ally's capacity field
    // already stores its printed starting life.
    // docs/outside-combat-design.md
    krcgId: 102262,
    name: "Touch of Valeren",
    cardType: "actionOrCombat",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "for",
        variant: "action",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "actionAddBloodToVampire", amount: 3, allies: true, self: true, capped: true },
        ],
      },
      {
        level: "basic",
        discipline: "for",
        variant: "combat",
        effects: [{ kind: "preventAll" }],
      },
      {
        level: "superior",
        discipline: "for",
        variant: "combat",
        usable: ["byOutsideVampire"],
        // "…to THAT minion": the one this vampire's controller owns.
        effects: [{ kind: "preventForOther", amount: 0, all: true, ownOnly: true }],
      },
    ],
  },
  {
    // "Unique archetype. Title.
    //  Put this card on an Independent Salubri you control to represent a
    //  unique Independent title worth 2 votes. This Salubri can lock
    //  during any referendum to force a vampire to abstain. Once each
    //  turn, this Salubri can lock before range is determined to end a
    //  combat involving another minion you control. A vampire can have
    //  only one archetype."
    //
    // The votes come from `statics.votes`, not from a VampireTitle: the
    // eleven printed titles are a fixed map and "a unique Independent
    // title" is none of them. The two lock abilities are in the bespoke
    // handler. docs/outside-combat-design.md §4
    krcgId: 102258,
    name: "Saulot's Guiding Wisdom",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    permanent: {
      where: "bearer",
      statics: { votes: 2 },
      tags: ["Saulot's Guiding Wisdom"],
      attach: { scope: "own", kind: "vampire", clan: "Salubri", sect: "independent" },
      exclusiveKey: "archetype",
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Only usable by an unlocked vampire not involved in the combat.
    //  [aus][for] Prevent 1 damage to a minion or retainer in combat.
    //  [AUS][FOR] Burn X blood to prevent X+1 damage to a minion or
    //  retainer in combat."
    //
    // The purest case of the gate, and the one that pins the p. 28
    // reading: minions controlled by ANY Methuselah may play a card that
    // says "not involved in the current combat", so a third seat can save
    // either combatant. docs/outside-combat-design.md
    krcgId: 101175,
    name: "Martyr's Resilience",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: { all: ["aus", "for"] },
        usable: ["byOutsideUnlockedVampire"],
        effects: [{ kind: "preventForOther", amount: 1 }],
      },
      {
        level: "superior",
        discipline: { all: ["aus", "for"] },
        usable: ["byOutsideUnlockedVampire"],
        // X chosen at play time; X=0 still prevents 1.
        effects: [
          { kind: "preventForOther", amount: 1, perBlood: { max: 3, plus: 1 } },
        ],
      },
    ],
  },
  {
    // "Unique location. If a ready Assamite you control is the target of a
    //  directed action or is chosen by the acting Methuselah in the terms
    //  of a referendum, you can lock this location to unlock the acting
    //  minion and have the action or referendum fail. Only usable as the
    //  directed action is announced or during the polling step of the
    //  referendum before votes and ballots are cast."
    //
    // "Assamite" is the LEGACY clan name — the engine and the importer use
    // the registry's "Banu Haqim". The behaviour is in the bespoke
    // handler; this spec supplies the cost and the location tag.
    krcgId: 102201,
    name: "Yoruba Shrine",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Requires a primogen or prince.
    //  Choose up to two minions. Successful referendum means the chosen
    //  minions cannot play reaction cards, block or cast votes or ballots
    //  this turn."
    //
    // The terms are chosen only on success (p. 25), which the existing
    // term machinery already handles. docs/abstain-gate-design.md §5
    krcgId: 102276,
    name: "Expulsion",
    cardType: "politicalAction",
    bloodCost: 0,
    usable: [],
    requiresControlledTitle: ["primogen", "prince"],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "refExpelMinions", upTo: 2 }],
      },
    ],
  },
  {
    // "Only usable during the polling step of a political action.
    //  [cel][pre] Choose a vampire who has cast votes or ballots in this
    //  referendum. The chosen vampire is locked and abstains (this cancels
    //  the chosen vampire's votes and ballots).
    //  [CEL][PRE] As above, and the chosen vampire burns 1 blood."
    //
    // The card that names the gate: the first effect to UN-cast a vote.
    // docs/abstain-gate-design.md
    krcgId: 101686,
    name: "Scalpel Tongue",
    cardType: "modifierOrReaction",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: { all: ["cel", "pre"] },
        effects: [{ kind: "forceAbstain", onlyIfVoted: true, lockTarget: true }],
      },
      {
        level: "superior",
        discipline: { all: ["cel", "pre"] },
        effects: [
          { kind: "forceAbstain", onlyIfVoted: true, lockTarget: true, burnTargetBlood: 1 },
        ],
      },
    ],
  },
  {
    // "Only usable during the polling step of a political action.
    //  [aus] Cancel the referendum. If you played a political action card
    //  to call this referendum, return it to its owner's hand (discard
    //  down afterward).
    //  [AUS] Force a vampire to abstain (this can cancel their votes and
    //  ballots)."
    //
    // Played by the CALLING vampire (p. 28: a modifier during polling is
    // the acting minion's), which reads oddly until you notice the
    // inferior is a rescue — pull your own doomed referendum and get the
    // card back. docs/abstain-gate-design.md §3.
    krcgId: 101951,
    name: "Telepathic Vote Counting",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "aus",
        effects: [{ kind: "cancelReferendum" }],
      },
      {
        level: "superior",
        discipline: "aus",
        // No lock, and no "who has cast" restriction — unlike Scalpel
        // Tongue, this one can silence a vampire pre-emptively.
        effects: [{ kind: "forceAbstain" }],
      },
    ],
  },
  {
    // "Only usable during the polling step of a political action.
    //  Methuselahs casting (including controlling a minion casting) votes
    //  or ballots against the referendum burn 1 pool once results are
    //  tallied."
    //
    // The first effect that outlives the tally. No discipline, no mode
    // split. docs/abstain-gate-design.md §4.
    krcgId: 101692,
    name: "Scorn of Adonis",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "burnPoolVotedAgainst", amount: 1 }],
      },
    ],
  },
  {
    // "Only usable by a ready unlocked vampire other than the acting
    //  minion. Only one Veil the Legions can be played each action.
    //  [obf] The acting minion gets +1 stealth.
    //  [OBF] As above, and this vampire can burn X blood to give the next
    //  X actions minions you control perform this turn +1 stealth. Only
    //  one Veil the Legions can be played at superior each turn."
    //
    // Three limits on one card, all different: per action across every
    // minion (`oncePerAction`), per minion per action (the p. 10 rule the
    // compiler already applies), and per seat per turn for the superior
    // mode alone. docs/other-vampire-modifiers-design.md
    krcgId: 102097,
    name: "Veil the Legions",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: ["byOtherUnlockedVampire", "oncePerAction", "oncePerTurnAtSuperior"],
    modes: [
      {
        level: "basic",
        discipline: "obf",
        effects: [{ kind: "modifyStealth", amount: 1 }],
      },
      {
        level: "superior",
        discipline: "obf",
        // X is optional ("CAN burn X blood"), so x = 0 is a legal choice
        // and the mode is still worth playing for its +1.
        effects: [
          { kind: "modifyStealth", amount: 1 },
          { kind: "bankStealth", max: 3 },
        ],
      },
    ],
  },
  {
    // "Only usable by a ready unlocked vampire other than the acting
    //  minion if a minion attempts to block.
    //  [for] or [pre] That attempt fails and the blocking minion cannot
    //  attempt to block this action again. Lock this vampire and the
    //  blocking minion, and queue a combat between them.
    //  [FOR] or [PRE] As above, but queue no combat."
    //
    // One of YOUR other vampires shoulders the blocker aside. The combat
    // it queues is between two minions neither of which is acting — a
    // first — and it is queued, not entered: the action must finish.
    // docs/other-vampire-modifiers-design.md
    krcgId: 102328,
    name: "Hedonism",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: ["byOtherUnlockedVampire"],
    modes: [
      {
        level: "basic",
        discipline: ["for", "pre"],
        effects: [{ kind: "interposeOnBlocker", combat: true }],
      },
      {
        level: "superior",
        discipline: ["for", "pre"],
        effects: [{ kind: "interposeOnBlocker", combat: false }],
      },
    ],
  },
  {
    // "[obf] +1 stealth.
    //  [OBF] Only usable by a ready vampire other than the acting minion.
    //  The acting minion gets +1 stealth." (Cloak the Gathering)
    //
    // The card that names this gate: the INFERIOR mode is an ordinary
    // modifier from the acting minion, the SUPERIOR comes from one of your
    // other vampires. Both grant the same +1, because `modifyStealth` is
    // action-scoped — who played it never entered the effect.
    // "Ready", not "ready unlocked": a vampire who already acted may cloak.
    // docs/other-vampire-modifiers-design.md
    krcgId: 100362,
    name: "Cloak the Gathering",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "obf",
        effects: [{ kind: "modifyStealth", amount: 1 }],
      },
      {
        level: "superior",
        discipline: "obf",
        usable: ["byOtherVampire"],
        effects: [{ kind: "modifyStealth", amount: 1 }],
      },
    ],
  },
  {
    // "[for] If this action is blocked, all damage inflicted on vampires
    // during the resulting combat is aggravated. If a vampire is currently
    // attempting to block, they can cancel their block attempt.
    // [FOR] As above, but without the option to cancel their block attempt."
    //
    // Note which way round the modes run: the INFERIOR mode is weaker
    // because it hands the blocker a way out. Both modes threaten the
    // acting vampire too — "all damage on vampires" is symmetric, and
    // Fortitude is the discipline that can afford it.
    // docs/dawn-operation-design.md
    krcgId: 100501,
    name: "Dawn Operation",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "for",
        effects: [
          { kind: "actorCombatRider", combatAggravated: true },
          { kind: "offerBlockerCancel" },
        ],
      },
      {
        level: "superior",
        discipline: "for",
        effects: [{ kind: "actorCombatRider", combatAggravated: true }],
      },
    ],
  },
  {
    // "Requires an Anarch. [ani] This Anarch gets +1 strength this action.
    // [dom] This Anarch cannot be blocked by allies this action. [pro]
    // This Anarch's hand strikes are aggravated this action."
    // Three inferior modes, told apart by discipline rather than level.
    krcgId: 102251,
    name: "Invigorate",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    requiresSect: ["anarch"],
    modes: [
      {
        level: "basic",
        discipline: "ani",
        variant: "strength",
        usable: ["evenIfNotNeeded"],
        effects: [{ kind: "actorCombatRider", strength: 1 }],
      },
      {
        level: "basic",
        discipline: "dom",
        variant: "noallies",
        effects: [{ kind: "blockRestriction", who: "allies" }],
      },
      {
        level: "basic",
        discipline: "pro",
        variant: "aggravated",
        usable: ["evenIfNotNeeded"],
        effects: [{ kind: "actorCombatRider", handStrikesAggravated: true }],
      },
    ],
  },
  // ---------------------------------------------------------------------
  // Dual-purpose action modifier / combat cards (one mode of each). The
  // modes split by their effects; see compileModifierOrCombat.
  // ---------------------------------------------------------------------
  {
    // "[dom][pro] [ACTION MODIFIER] +1 stealth. Allies get -1 intercept.
    // [DOM][PRO] [COMBAT] Only usable before range is determined. This
    // round, this vampire gets +1 strength and 1 optional maneuver, and can
    // prevent 1 damage. A vampire can play only one Obedient Flesh each
    // round."
    krcgId: 102255,
    name: "Obedient Flesh",
    cardType: "modifierOrCombat",
    bloodCost: 1,
    combatLimit: "round",
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: { all: ["dom", "pro"] },
        usable: ["evenIfNotNeeded"],
        effects: [
          { kind: "modifyStealth", amount: 1 },
          { kind: "modifyAllIntercept", amount: -1, appliesTo: "ally" },
        ],
      },
      {
        level: "superior",
        discipline: { all: ["dom", "pro"] },
        // All three are CREDITS granted before range, not actions taken —
        // otherwise one mode would have to span three combat windows.
        effects: [{ kind: "combatCredits", strength: 1, maneuver: 1, prevent: 1 }],
      },
    ],
  },
  {
    // "[obf] [ACTION MODIFIER] +1 stealth. [OBF] [COMBAT] Maneuver."
    krcgId: 101913,
    name: "Swallowed by the Night",
    cardType: "modifierOrCombat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "obf", effects: [{ kind: "modifyStealth", amount: 1 }] },
      { level: "superior", discipline: "obf", effects: [{ kind: "maneuver" }] },
    ],
  },
  {
    // "[pro] [ACTION MODIFIER] +1 stealth. [PRO] [COMBAT] Strike: combat
    // ends."
    krcgId: 101542,
    name: "Rapid Change",
    cardType: "modifierOrCombat",
    bloodCost: 1,
    usable: [],
    modes: [
      { level: "basic", discipline: "pro", effects: [{ kind: "modifyStealth", amount: 1 }] },
      {
        level: "superior",
        discipline: "pro",
        effects: [{ kind: "strikeCombatEnds", unlockSelf: false }],
      },
    ],
  },
  {
    // "[cel] or [obf] Strike: dodge. [CEL] or [OBF] +1 stealth."
    krcgId: 102342,
    name: "Swift Cover",
    cardType: "modifierOrCombat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: ["cel", "obf"], effects: [{ kind: "strikeDodge" }] },
      {
        level: "superior",
        discipline: ["cel", "obf"],
        effects: [{ kind: "modifyStealth", amount: 1 }],
      },
    ],
  },
  {
    // "[cel] [COMBAT] Press, or maneuver with 1 optional press.
    // [CEL] [ACTION MODIFIER] +1 stealth."
    krcgId: 101610,
    name: "Resist Earth's Grasp",
    cardType: "modifierOrCombat",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "cel",
        variant: "press",
        effects: [{ kind: "press", continueOnly: false }],
      },
      {
        level: "basic",
        discipline: "cel",
        variant: "maneuver",
        effects: [{ kind: "maneuver" }, { kind: "grantPress" }],
      },
      { level: "superior", discipline: "cel", effects: [{ kind: "modifyStealth", amount: 1 }] },
    ],
  },
  {
    // "[pro] [COMBAT] Strike: steal 1 blood or life (becoming blood).
    // [PRO] [ACTION MODIFIER] Only usable as the action is announced.
    // +1 stealth, even if stealth is not yet needed."
    krcgId: 102224,
    name: "Form of the Cobra",
    cardType: "modifierOrCombat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "pro", effects: [{ kind: "strikeStealBlood", amount: 1 }] },
      {
        level: "superior",
        discipline: "pro",
        usable: ["evenIfNotNeeded"],
        effects: [{ kind: "modifyStealth", amount: 1 }],
      },
    ],
  },
  {
    krcgId: 101966,
    name: "Theft of Vitae",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "tha", effects: [{ kind: "strikeStealBlood", amount: 1 }] },
      { level: "superior", discipline: "tha", effects: [{ kind: "strikeStealBlood", amount: 2 }] },
    ],
  },
  {
    krcgId: 100029,
    name: "Aid from Bats",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "ani",
        effects: [{ kind: "strikeDamage", amount: 1, ranged: true, aggravated: false, riders: { maneuver: 1 } }],
      },
      {
        level: "superior",
        discipline: "ani",
        effects: [{ kind: "strikeDamage", amount: 1, ranged: true, aggravated: false, riders: { press: 1 } }],
      },
    ],
  },
  // --- Frenzy gate (docs/frenzy-design.md) ---
  {
    // "Frenzy. Only usable before range is determined. This combat, you
    // get +1 hand size and this vampire's hand strikes inflict +1 (sup:
    // +2) damage." The damage is +strength (the only thing that feeds
    // hand-strike damage); the hand size is a grant on the combat frame,
    // so the player draws 1 now and discards 1 when the combat ends —
    // p. 7, docs/temporary-hand-size-design.md.
    krcgId: 102336,
    name: "Rage of Apedemak",
    cardType: "combat",
    bloodCost: 0,
    frenzy: true,
    combatLimit: "combat", // "only one Rage of Apedemak each combat"
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: ["ani", "pot"],
        effects: [
          { kind: "addStrength", amount: 1 },
          { kind: "handSizeBonus", amount: 1 },
        ],
      },
      {
        level: "superior",
        discipline: ["ani", "pot"],
        effects: [
          { kind: "addStrength", amount: 2 },
          { kind: "handSizeBonus", amount: 1 },
        ],
      },
    ],
  },
  {
    // "Frenzy. First round only: this combat, the opposing minion cannot
    // maneuver to close, press to continue, or use equipment." The
    // superior (combat cards cost the opposing vampire +1 blood) was
    // deferred in docs/frenzy-design.md and is implemented below — the
    // play-cost gate supplied the opposing-cost modifier.
    krcgId: 101960,
    name: "Terror Frenzy",
    cardType: "combat",
    bloodCost: 1,
    frenzy: true,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "ani",
        usable: ["onlyFirstRound"],
        effects: [{ kind: "restrictOpponent", maneuver: true, press: true, equipment: true }],
      },
      {
        // "[ANI] This combat, combat cards cost the opposing vampire +1
        // blood. A vampire can play only one Terror Frenzy at superior
        // each combat." Deferred in docs/frenzy-design.md for want of an
        // opposing-cost modifier; the play-cost gate supplies it.
        level: "superior",
        discipline: "ani",
        usable: ["oncePerCombatAtSuperior"],
        effects: [
          {
            kind: "combatCostModOnOpponent",
            mod: { amount: 1, pays: "blood", cardTypes: ["combat"] },
          },
        ],
      },
    ],
  },
  {
    // "+1 stealth action. Requires an Anarch. Unique. Put this card in play
    // with 1 counter. During your unlock phase, add 1 counter to this card.
    // During each other Methuselah's unlock phase, that Methuselah burns X
    // pool and/or cards at random from their hand, where X is the number of
    // counters on this card. Vampires can burn this card as a Ⓓ action that
    // costs 1 pool." The alternative and the Ⓓ-burn were deviations until
    // 2026-09-02; both are data now (docs/unlock-tolls-design.md).
    krcgId: 100416,
    name: "Constant Revolution",
    cardType: "action",
    bloodCost: 0,
    requiresSect: ["anarch"],
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Constant Revolution"],
      unlockCounter: { amount: 1 },
      // "and/or": the mix is chosen a unit at a time, which is exactly
      // what p. 50's Smiling Jack ruling describes for the sibling card.
      unlockToll: { whose: "others", alternative: "randomDiscard" },
      vulnerableTo: { who: { kind: "vampire" }, cost: { pool: 1 } },
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "putInPlayOnSuccess", counters: 1, tags: ["Constant Revolution"] },
        ],
      },
    ],
  },
  {
    // "Unique. Put this card in play. During your unlock phase, move 1
    // counter from your pool to this card. During each other Methuselah's
    // unlock phase, for each counter on this card, that Methuselah burns 1
    // pool or burns 1 blood from a vampire they control. Vampires can burn
    // this card as a Ⓓ action." p. 50 rules the accumulator mandatory
    // "even if it ousts you" and the toll mixable a unit at a time.
    krcgId: 101811,
    name: "Smiling Jack, The Anarch",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Smiling Jack, The Anarch"],
      unlockCounter: { amount: 1, fromPool: true },
      unlockToll: { whose: "others", alternative: "blood" },
      vulnerableTo: { who: { kind: "vampire" } },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. You can lock this location and burn 1 pool during
    // your unlock phase to exchange one card from your hand for one card
    // in your ash heap requiring an Anarch. You can lock this location
    // before range is determined to end a combat involving an Anarch you
    // control and another Anarch." Unblocked by the ash-heap wave; every
    // piece it needs was already built (docs/cheap-tail-design.md §1).
    krcgId: 100809,
    name: "Garibaldi-Meucci Museum",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      ashExchange: { poolCost: 1, requiresSect: ["anarch"] },
      combatEndGrant: { sect: "anarch" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "[ani] Strike: dodge. [ANI] As above, with 1 additional ranged
    // strike: burn weapon." The extra strike is SPECIFIED, not free —
    // see docs/cheap-tail-design.md §4 for why that matters.
    krcgId: 102266,
    name: "Voracious Vermin",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "ani", effects: [{ kind: "strikeDodge" }] },
      {
        level: "superior",
        discipline: "ani",
        effects: [
          { kind: "strikeDodge" },
          { kind: "additionalStrike", count: 1, limited: false, burnEquipment: true },
        ],
      },
    ],
  },
  {
    // "Unique. [1 pool] If the bearer is ready during your unlock phase,
    // you can draw up to 3 cards without discarding and then move the same
    // number of cards from your hand to the bottom of your library."
    krcgId: 100903,
    name: "Heart of Nizchetus",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["equipment"],
      unlockDrawBury: { max: 3 },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "[obf][pre] Only usable during a bleed action. +1 bleed (limited).
    // [OBF][PRE] Only usable if a minion attempts to block. That attempt
    // fails and the blocking minion cannot attempt to block this action
    // again. The blocking minion's controller can burn 1 pool to cancel
    // this card as it is played." The pay-to-cancel gate was built for
    // Golconda: Inner Peace (docs/cheap-tail-design.md §6).
    krcgId: 102041,
    name: "True Love's Face",
    cardType: "actionModifier",
    bloodCost: 0,
    payToCancel: { pool: 1, who: "blocker" },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: { all: ["obf", "pre"] },
        usable: ["onlyDuringBleed"],
        effects: [{ kind: "modifyBleed", amount: 1, limited: true }],
      },
      {
        level: "superior",
        discipline: { all: ["obf", "pre"] },
        effects: [{ kind: "failBlockAttempt" }],
      },
    ],
  },
  {
    // "Unique location. As this location is played or its controller
    // changes, its controller chooses a ready vampire they control. During
    // this location's controller's unlock phase, the chosen vampire can
    // gain 2 blood. Vampires controlled by another Methuselah can steal
    // this location as a Ⓓ action."
    krcgId: 101536,
    name: "The Rack",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      vulnerableTo: {
        who: { kind: "vampire", othersOnly: true },
        outcome: "steal",
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "+1 stealth action. Unique. Put this card in play. You can lock
    // Aranthebes to give a minion controlled by your predator -1 stealth.
    // While Aranthebes is unlocked, vampires with capacity 4 or less get
    // -1 bleed against you. Vampires with capacity 5 or more can shuffle
    // Aranthebes into your library as a Ⓓ action."
    krcgId: 100079,
    name: "Aranthebes, The Immortal",
    cardType: "action",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Aranthebes, The Immortal"],
      aura: {
        scope: "global",
        maxCapacity: 4,
        bleedAgainstController: -1,
        requiresUnlocked: true,
      },
      vulnerableTo: {
        who: { kind: "vampire", minCapacity: 5 },
        outcome: "shuffleIntoLibrary",
      },
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          {
            kind: "putInPlayOnSuccess",
            tags: ["Aranthebes, The Immortal"],
          },
        ],
      },
    ],
  },
  {
    // "Choose two ready Toreador you control, put this card in play, and
    // lock one of the two. The locked Toreador does not unlock as normal.
    // The other Toreador's non-bleed actions cannot be blocked. Minions can
    // burn this card as a Ⓓ action; Nosferatu get -1 stealth during that
    // action."
    krcgId: 101989,
    name: "Toreador Grand Ball",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    permanent: {
      where: "seat",
      statics: {},
      tags: [],
      vulnerableTo: { stealthFor: [{ clan: "Nosferatu", delta: -1 }] },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Put this card on a ready vampire. Minions can enter combat with this
    // vampire as a +1 stealth Ⓓ action. This vampire can burn this card as
    // a +1 stealth Ⓓ action." (docs/granted-rush-design.md)
    krcgId: 100897,
    name: "Haven Uncovered",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["Haven Uncovered"],
      // "A ready vampire" — anyone's; it stays controlled by its player
      // (p. 16), so the rush it grants is directed at that player.
      attach: { scope: "any", kind: "vampire" },
      rushGrant: { who: { scope: "any" }, target: { scope: "bearer" }, stealth: 1 },
      vulnerableTo: { who: { bearerOnly: true }, stealth: 1 },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Title. Put this card on a Sabbat vampire you control with capacity 8
    // or more to represent the unique Sabbat title of regent. Sabbat
    // vampires can enter combat with this vampire as a Ⓓ action. If a
    // Sabbat vampire diablerizes this vampire, move this card to the
    // diablerist (before the blood hunt is called)."
    krcgId: 101587,
    name: "Regent",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["Regent"],
      attach: { scope: "own", kind: "vampire", sect: "sabbat", minCapacity: 8 },
      grantsTitle: "regent", // 4 votes (p. 28)
      rushGrant: {
        who: { scope: "any", kind: "vampire", sect: "sabbat" },
        target: { scope: "bearer" },
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique archetype. Put this card on a Salubri you control. This
    // Salubri gets +1 strength. This Salubri can enter combat with a
    // non-Salubri vampire as a Ⓓ action; if that vampire is Tremere, this
    // is a +1 stealth action. A vampire can have only one archetype."
    krcgId: 102257,
    name: "Saulot's Avenging Fist",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    permanent: {
      where: "bearer",
      statics: { strength: 1 },
      tags: ["Saulot's Avenging Fist"],
      attach: { scope: "own", kind: "vampire", clan: "Salubri" },
      exclusiveKey: "archetype",
      rushGrant: {
        who: { scope: "bearer" },
        target: { scope: "any", kind: "vampire", notClan: "Salubri" },
        stealthByTarget: [{ clan: "Tremere", delta: 1 }],
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Put this card in play. Each ready minion you control can enter combat
    // with a minion controlled by your prey as a Ⓓ action. You gain 1 pool
    // after a ready minion controlled by your prey is burned or sent to
    // torpor. During your influence phase, burn this card and burn 1 pool
    // for each ready minion controlled by your prey."
    krcgId: 100794,
    name: "Frontal Assault",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Frontal Assault"],
      rushGrant: { who: { scope: "controller" }, target: { scope: "prey" } },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique contract. Trifle. Choose a ready Assamite you control and put
    // this card on a minion controlled by your prey. The chosen Assamite can
    // enter combat with the attached minion as a +1 stealth Ⓓ action. If the
    // attached minion is about to leave the ready region, you can burn this
    // card to gain 3 pool."
    krcgId: 101487,
    name: "Priority Contract",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    trifle: true,
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["Priority Contract", "contract"],
      attach: { scope: "prey" },
      rushGrant: {
        who: { scope: "chosen" },
        target: { scope: "bearer" },
        stealth: 1,
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Put this card in play. During each Methuselah's master phase, that
    // Methuselah locks one of the oldest Brujah they control (if any).
    // Brujah get +1 strength and 1 optional maneuver each combat.
    // Non-Ventrue minions can burn this card as a Ⓓ action."
    krcgId: 100260,
    name: "Brujah Debate",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    permanent: {
      where: "seat",
      statics: {},
      tags: [],
      // Unqualified "Brujah" — every Methuselah's, not just the
      // controller's, and it cuts both ways.
      aura: { scope: "global", clan: "Brujah", strength: 1, maneuverPerCombat: 1 },
      vulnerableTo: { who: { notClan: "Ventrue" } },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique. Put this card in play. You can lock this card to give a
    // minion you control 1 press, only usable to continue combat. Minions
    // can burn this card as a Ⓓ action."
    krcgId: 101229,
    name: "Mob Connections",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: [],
      vulnerableTo: {},
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. During your master phase, you can lock this
    // location to move 1 blood from a vampire with Oblivion [obl] you
    // control to your pool or from your pool to a ready vampire with
    // Oblivion [obl] you control. Independent vampires can burn this
    // location as a Ⓓ action that costs 1 blood."
    krcgId: 102301,
    name: "Powerbase: Munich",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      vulnerableTo: {
        who: { kind: "vampire", sect: "independent" },
        cost: { blood: 1 },
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. During your discard phase, you can lock this
    // location to get +1 discard phase action. If you use that discard
    // phase action to discard a card requiring an Anarch or making a
    // vampire Anarch, you can unlock a ready Anarch. Anarchs controlled by
    // other Methuselahs can steal this location as a Ⓓ action."
    krcgId: 101435,
    name: "Powerbase: Los Angeles",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      vulnerableTo: {
        who: { kind: "vampire", sect: "anarch", othersOnly: true },
        outcome: "steal",
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique Nod fragment. Put this card in play. You can lock this card
    // to draw 2 cards (discard down afterward). Vampires can steal this
    // card as a Ⓓ action."
    krcgId: 100785,
    name: "Fragment of the Book of Nod",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Nod fragment"],
      vulnerableTo: { who: { kind: "vampire" }, outcome: "steal" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique. Put this card in play. Gangrel you control get +1 strength.
    // Non-Ravnos minions can burn this card as a Ⓓ action."
    krcgId: 100807,
    name: "Gangrel Revel",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: [],
      aura: { scope: "controller", clan: "Gangrel", strength: 1 },
      vulnerableTo: { who: { notClan: "Ravnos" } },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique. Put this card in play. Assamites get +1 stealth when
    // bleeding. Minions can burn this card as a Ⓓ action; Tremere get +1
    // stealth during that action." The V5 clan name for Assamite is Banu
    // Haqim, which is what crypt import produces.
    krcgId: 101042,
    name: "The Khabar: Community",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: [],
      // Unqualified "Assamites" — every Methuselah's, not just yours.
      aura: { scope: "global", clan: "Banu Haqim", bleedStealth: 1 },
      vulnerableTo: { stealthFor: [{ clan: "Tremere", delta: 1 }] },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique. Put this card on a ready minion. This minion cannot block.
    // Other minions can burn this card as a Ⓓ action."
    krcgId: 101384,
    name: "Pentex™ Subversion",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    permanent: {
      where: "bearer",
      statics: { cannotBlock: true },
      tags: ["Pentex™ Subversion"],
      attachAnyMinion: true,
      // "OTHER minions": the subverted minion cannot burn it itself.
      vulnerableTo: { who: { excludeBearer: true } },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. During your influence phase, you can add 1 blood to
    // a vampire in your uncontrolled region. Vampires can steal this
    // location as a Ⓓ action."
    krcgId: 101439,
    name: "Powerbase: Montreal",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      vulnerableTo: { who: { kind: "vampire" }, outcome: "steal" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. Followers of Set you control can put 1 corruption
    // counter on an ally or younger vampire controlled by your prey as a Ⓓ
    // action. If the action is successful and the number of your corruption
    // counters on the minion equals or exceeds their capacity or cost, you
    // can burn those counters to steal that minion."
    krcgId: 100311,
    name: "Cave of Apples",
    cardType: "master",
    bloodCost: 0,
    poolCost: 3,
    unique: true,
    permanent: { where: "seat", statics: {}, tags: ["location"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "+1 stealth action. X is the number of copies of this card you
    // control. Put this card in play. During your unlock phase, your prey
    // burns 1 pool. Minions can burn this card as a Ⓓ action." (The X
    // clause is vestigial — no other sentence on the card uses X.)
    krcgId: 102213,
    name: "Creeping Sabotage",
    cardType: "action",
    bloodCost: 0,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Creeping Sabotage"],
      vulnerableTo: {}, // "Minions can burn this card as a Ⓓ action"
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "putInPlayOnSuccess", tags: ["Creeping Sabotage"] },
        ],
      },
    ],
  },
  {
    // "+1 stealth action. [ani] Put this card in play. During your unlock
    // phase, your prey burns 1 pool. You can burn only 1 pool each turn
    // with Army of Rats cards. Minions can burn this card as a Ⓓ action."
    krcgId: 100093,
    name: "Army of Rats",
    cardType: "action",
    bloodCost: 0,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Army of Rats"],
      vulnerableTo: {},
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "ani",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "putInPlayOnSuccess", tags: ["Army of Rats"] },
        ],
      },
    ],
  },
  {
    // "+1 stealth action. Unique. Put this card in play with 1 counter."
    // The Hecata counter action, the unlock-phase burn, and the opponents'
    // "Vampires can burn this card as a Ⓓ action" clause are bespoke
    // (docs/granted-actions-design.md §5).
    krcgId: 102291,
    name: "Pit of Contemplation",
    cardType: "action",
    bloodCost: 0,
    unique: true,
    requiresClan: ["Hecata"],
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Pit of Contemplation", "location"],
      // "Vampires can burn this card as a Ⓓ action."
      vulnerableTo: { who: { kind: "vampire" } },
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "putInPlayOnSuccess", counters: 1 },
        ],
      },
    ],
  },
  {
    // "+1 stealth action. Unique. Put this card in play with 1 counter.
    // During your unlock phase, add 1 counter to this card. During your
    // prey's unlock phase, for each counter on this card, they burn 1 pool
    // or remove a library card at random in their ash heap from the game.
    // Hecata you control with capacity 4 or more can add 1 counter to this
    // card as a +1 stealth action. Vampires can burn this card as a Ⓓ
    // action." Every clause is data (docs/unlock-tolls-design.md §6).
    krcgId: 102290,
    name: "The Gate of Acheron",
    cardType: "action",
    bloodCost: 0,
    unique: true,
    requiresClan: ["Hecata"],
    permanent: {
      where: "seat",
      statics: {},
      // NOT a location: the card prints "Unique.", not "Unique location.",
      // so a location-burner (Conceal, Rewilding) must not reach it.
      tags: ["The Gate of Acheron"],
      unlockCounter: { amount: 1 },
      unlockToll: { whose: "prey", alternative: "removeAshHeapCard" },
      counterGrant: {
        who: { kind: "vampire", clan: "Hecata", minCapacity: 4 },
        amount: 1,
        stealth: 1,
      },
      vulnerableTo: { who: { kind: "vampire" } },
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "putInPlayOnSuccess", counters: 1, tags: ["The Gate of Acheron"] },
        ],
      },
    ],
  },
  {
    // "+1 stealth action. Requires a titled Sabbat vampire. Put this card in
    // play with 3 counters." The burn-counter-to-unlock-and-block ability is
    // a bespoke overlay.
    krcgId: 102063,
    name: "Under Siege",
    cardType: "action",
    bloodCost: 0,
    // Printed 1 pool. Missing until 2026-08-31 — and even a correct spec
    // charged nothing, because compileActionCard dropped `poolCost`.
    poolCost: 1,
    unique: true,
    requiresTitle: ["bishop", "archbishop", "priscus", "cardinal", "regent"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "putInPlayOnSuccess", counters: 3 },
        ],
      },
    ],
  },
  {
    // "+1 stealth action. Add 2 blood to a Gangrel in your uncontrolled
    // region."
    krcgId: 101972,
    name: "Thing",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "addUncontrolledBlood", amount: 2, youngerOnly: false, clan: "Gangrel" },
        ],
      },
    ],
  },
  {
    // "Requires an Anarch. [cel] Additional strike (limited). [for]
    // Prevent 2 damage. [tha] Strike, ranged: steal 1 blood, with 1
    // optional maneuver." Three per-discipline modes.
    krcgId: 100563,
    name: "Diversion",
    cardType: "combat",
    bloodCost: 0,
    requiresSect: ["anarch"],
    usable: [],
    modes: [
      { level: "basic", variant: "cel", discipline: "cel", effects: [{ kind: "additionalStrike", count: 1, limited: true }] },
      { level: "basic", variant: "for", discipline: "for", effects: [{ kind: "prevent", base: 2, perBloodX: false }] },
      { level: "basic", variant: "tha", discipline: "tha", effects: [{ kind: "strikeStealBlood", amount: 1, riders: { maneuver: 1 } }] },
    ],
  },
  {
    // "[pot] Strike: hand strike at +2 damage. [POT] As above, with 1
    // optional maneuver (modeled as a general maneuver credit; the printed
    // 'only to get to close range' restriction is not enforced)."
    krcgId: 101798,
    name: "Slam",
    cardType: "combat",
    bloodCost: 1,
    usable: [],
    modes: [
      { level: "basic", discipline: "pot", effects: [{ kind: "strikeHandBonus", bonus: 2 }] },
      { level: "superior", discipline: "pot", effects: [{ kind: "strikeHandBonus", bonus: 2, riders: { maneuver: 1 } }] },
    ],
  },
  // --- After combat ends (docs/after-combat-ends-design.md) ---
  {
    // "[pre] Strike: combat ends. [PRE] As above, and after combat ends,
    // if the range is close, this vampire inflicts 1 unpreventable damage
    // on the opposing minion."
    krcgId: 100307,
    name: "Catatonic Fear",
    cardType: "combat",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "pre",
        effects: [{ kind: "strikeCombatEnds", unlockSelf: false }],
      },
      {
        level: "superior",
        discipline: "pre",
        effects: [
          { kind: "strikeCombatEnds", unlockSelf: false },
          { kind: "afterCombatEnds", damage: { amount: 1, closeRangeOnly: true } },
        ],
      },
    ],
  },
  {
    // "[obl] Strike: combat ends. [OBL] Strike: combat ends. After combat
    // ends, put this card on this vampire. This vampire can burn this
    // card to get +1 stealth."
    krcgId: 102279,
    name: "Pass Through Shadow",
    cardType: "combat",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "obl",
        effects: [{ kind: "strikeCombatEnds", unlockSelf: false }],
      },
      {
        level: "superior",
        discipline: "obl",
        effects: [
          { kind: "strikeCombatEnds", unlockSelf: false },
          { kind: "afterCombatEnds", attachSelf: true },
        ],
      },
    ],
  },
  {
    // "[pro] Strike: dodge. [PRO] Strike: combat ends. After combat ends,
    // if this vampire was blocked, they can burn 1 blood to continue the
    // action with +1 stealth as if unblocked, even if stealth is not yet
    // needed. A vampire can play only one Form of Mist at superior each
    // action."
    krcgId: 100771,
    name: "Form of Mist",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "pro", effects: [{ kind: "strikeDodge" }] },
      {
        level: "superior",
        discipline: "pro",
        usable: ["oncePerActionAtSuperior"],
        effects: [
          { kind: "strikeCombatEnds", unlockSelf: false },
          {
            kind: "afterCombatEnds",
            continueAction: { bloodCost: 1, stealth: 1 },
          },
        ],
      },
    ],
  },
  {
    // "[for] Prevent 1 damage. [FOR] Burn 1 blood to prevent all damage
    // from the opposing minion's strikes this round."
    krcgId: 101649,
    name: "Rolling with the Punches",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "for",
        effects: [{ kind: "prevent", base: 1, perBloodX: false }],
      },
      {
        level: "superior",
        discipline: "for",
        effects: [{ kind: "preventAllThisRound", bloodCost: 1 }],
      },
    ],
  },
  // --- Granted bleeds + target-priced costs
  //     (docs/granted-bleed-and-target-costs-design.md) ---
  {
    // "Unique. The bearer gets -2 stealth during bleed actions. This
    // vampire can bleed as a Ⓓ action that costs 1 blood; this action
    // gets +3 bleed if the target Methuselah controls no ready unlocked
    // minions."
    //
    // The -2 applies to EVERY bleed the bearer makes, the granted one
    // included — the card taxes bleeding and nothing exempts its own.
    krcgId: 100374,
    name: "Codex of the Edenic Groundskeepers",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    permanent: {
      where: "bearer",
      statics: { conditional: [{ stealth: -2, actionKinds: ["bleed"] }] },
      tags: ["Codex of the Edenic Groundskeepers"],
      bleedGrant: {
        who: { scope: "bearer" },
        cost: { blood: 1 },
        bonusIfTargetHasNoUnlocked: 3,
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Trifle. Put this card on a vampire you control who has any amount
    // of blood and move 2 to 5 blood from that vampire to your pool.
    // Cards named /Minion Tap/ cost you +1 pool to play. Villein costs +1
    // pool to play on this vampire."
    //
    // Two cost modifiers with different scopes: one keyed to a card NAME
    // and to this Methuselah alone, one keyed to the TARGET of the play.
    krcgId: 102121,
    name: "Villein",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    trifle: true,
    permanent: {
      where: "bearer",
      statics: {
        playCostMod: {
          amount: 1,
          pays: "pool",
          cardName: "Minion Tap",
          controllerOnly: true,
        },
      },
      tags: ["Villein"],
      attach: { scope: "own", kind: "vampire" },
      bloodToPool: { min: 2, max: 5 },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. Haven. Put this card on a minion you control.
    // This minion cannot be the target of other Methuselahs' actions.
    // Master cards targeting this minion cost 1 additional pool. Burn
    // this card after this minion goes to torpor. A minion can have only
    // one haven." (The torpor burn is the bespoke overlay below.)
    krcgId: 101711,
    name: "Secure Haven",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    permanent: {
      where: "bearer",
      statics: {
        untargetableByOthers: true,
        playCostMod: {
          amount: 1,
          pays: "pool",
          cardTypes: ["master"],
          onTarget: true,
        },
      },
      tags: ["Secure Haven", "location"],
      attach: { scope: "own" },
      exclusiveKey: "haven",
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  // --- Conditional statics (docs/conditional-statics-design.md) ---
  {
    // "Unique. Put this card on a ready vampire you control. This vampire
    // gets +1 strength. This vampire gets +1 stealth during diablerie
    // actions. This vampire cannot recruit allies or employ retainers."
    krcgId: 100526,
    name: "Depravity",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    permanent: {
      where: "bearer",
      statics: {
        strength: 1,
        conditional: [{ stealth: 1, actionKinds: ["diablerize"] }],
        cannotPlayCardTypes: ["ally", "retainer"],
      },
      tags: ["Depravity"],
      attach: { scope: "own", kind: "vampire" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Put this card on a ready vampire you control. This vampire gets +1
    // intercept during bleed actions directed at you. This vampire can
    // prevent 1 damage each combat. If this vampire is in torpor, burn
    // this card." (The prevention and the torpor burn are the bespoke
    // overlay in this file.)
    krcgId: 100866,
    name: "Guardian Angel",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    permanent: {
      where: "bearer",
      statics: {
        conditional: [
          { intercept: 1, actionKinds: ["bleed"], directedAtController: true },
        ],
      },
      tags: ["Guardian Angel"],
      attach: { scope: "own", kind: "vampire" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "+1 stealth action. Requires a Sabbat vampire. Put this card on this
    // Sabbat vampire and unlock them. This Sabbat vampire gets +1
    // intercept during actions directed at their controller. A vampire
    // can have only one Abbot."
    krcgId: 100006,
    name: "Abbot",
    cardType: "action",
    bloodCost: 0,
    requiresSect: ["sabbat"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          {
            kind: "attachSelf",
            unlockActor: true,
            conditional: [{ intercept: 1, directedAtController: true }],
          },
        ],
      },
    ],
  },
  {
    // "Vehicle. The action to equip with this vehicle is with an
    // additional +1 stealth. This minion gets +1 stealth during hunt,
    // recruit and employ actions. If this minion is blocked by a prince
    // or an archbishop (during any action), burn this vehicle. A minion
    // can have only one vehicle."
    //
    // TWO conditional entries, which is why `conditional` is a list:
    // "hunt" is an ActionKind, but "recruit" and "employ" are ally and
    // retainer CARDS played as actions and are `cardEffect` like every
    // other action card (docs/conditional-statics-design.md §2).
    krcgId: 102078,
    name: "Unlicensed Taxicab",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 0,
    permanent: {
      where: "bearer",
      statics: {
        conditional: [
          { stealth: 1, actionKinds: ["hunt"] },
          { stealth: 1, actionCardTypes: ["ally", "retainer"] },
        ],
      },
      tags: ["vehicle"],
      extraEquipStealth: 1,
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  // --- Action-time locations (docs/action-time-locations-design.md) ---
  {
    // "Unique location. You can lock this card as a vampire you control
    // announces an undirected action to give that vampire +1 stealth,
    // even if stealth is not yet needed."
    krcgId: 100444,
    name: "Creepshow Casino",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: {
        grant: "stealth",
        amount: 1,
        ownOnly: true,
        undirectedOnly: true,
        atAnnouncement: true,
        evenIfNotNeeded: true,
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. You can lock this card to give a minion +1
    // intercept. If that minion does not block the action, burn 1 pool
    // after action resolution." No "you control": any Methuselah's minion.
    krcgId: 102189,
    name: "WMRH Talk Radio",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: {
        grant: "intercept",
        amount: 1,
        anyController: true,
        notBlockPoolPenalty: 1,
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. You can lock this card during an action to choose
    // a vampire; the chosen vampire can burn 1 blood to get +1 intercept
    // during that action."
    krcgId: 101662,
    name: "The Rumor Mill, Tabloid Newspaper",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: {
        grant: "intercept",
        amount: 1,
        anyVampire: true,
        recipientCost: { blood: 1 },
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. An Anarch can burn 1 blood once as they announce
    // a bleed action to get +1 bleed during that action." Never locks —
    // a standing permission, limited once per action instead.
    krcgId: 100366,
    name: "Club Illusion",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: {
        grant: "bleed",
        amount: 1,
        sect: "anarch",
        ownOnly: true,
        atAnnouncement: true,
        noLock: true,
        oncePerAction: true,
        recipientCost: { blood: 1 },
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. You can lock this card as a Nosferatu announces an
    // undirected action; after action resolution, if that action was
    // successful, unlock the acting Nosferatu." (The second clause — burn
    // this card even if locked to bring a Nosferatu out of torpor — is
    // handled by the bespoke overlay in this file.)
    krcgId: 102149,
    name: "Warsaw Station",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: {
        grant: "unlockOnSuccess",
        amount: 0,
        clan: "Nosferatu",
        ownOnly: true,
        undirectedOnly: true,
        atAnnouncement: true,
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  // --- Play-cost modifiers (docs/play-cost-design.md) ---
  {
    // "Unique. Put this card on a ready vampire. Recruit ally actions cost
    // this vampire -1 blood or pool."
    krcgId: 100332,
    name: "Charisma",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "bearer",
      statics: {
        playCostMod: {
          amount: -1,
          pays: "bloodOrPool",
          cardTypes: ["ally"],
          minions: "bearer",
        },
      },
      tags: ["Charisma"],
      attach: { scope: "own", kind: "vampire" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Requires an Anarch. Put this card on an Anarch. Allies cannot block
    // this Anarch. Cards requiring Dominate [dom] or Presence [pre] cost
    // other minions +1 blood while this Anarch is acting, attempting to
    // block or in combat."
    //
    // `requiresDiscipline` is the query built for
    // docs/discipline-filtered-design.md, reused verbatim — this card is
    // data because of that wave.
    krcgId: 101100,
    name: "Libertas",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    requiresControlledSect: ["anarch"],
    permanent: {
      where: "bearer",
      statics: {
        alliesCannotBlock: true,
        playCostMod: {
          amount: 1,
          pays: "blood",
          requiresDiscipline: ["dom", "pre"],
          minions: "others",
          whileBearerEngaged: true,
        },
      },
      tags: ["Libertas"],
      attach: { scope: "own", kind: "vampire", sect: "anarch" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Only usable as the action is announced.
    //  [obl] Reaction cards cost +1 blood or life.
    //  [OBL] As above, and those cards are not replaced until the end of
    //  the action."
    krcgId: 102288,
    name: "Consign to Oblivion",
    cardType: "actionModifier",
    bloodCost: 1,
    usable: ["onlyAsAnnounced"],
    modes: [
      {
        level: "basic",
        discipline: "obl",
        effects: [
          {
            kind: "playCostMod",
            mod: { amount: 1, pays: "bloodOrLife", cardTypes: ["reaction"] },
          },
        ],
      },
      {
        level: "superior",
        discipline: "obl",
        effects: [
          {
            kind: "playCostMod",
            mod: { amount: 1, pays: "bloodOrLife", cardTypes: ["reaction"] },
          },
          { kind: "delayReplaceFor", cardTypes: ["reaction"] },
        ],
      },
    ],
  },
  {
    // "Only usable as the action is announced.
    //  [dom] Choose a minion. The chosen minion cannot play reaction cards
    //  this action.
    //  [DOM] As above, and the next reaction card played this action costs
    //  +1 blood or life."
    krcgId: 102263,
    name: "Unleashing the Bestial Soul",
    cardType: "actionModifier",
    bloodCost: 1,
    usable: ["onlyAsAnnounced"],
    modes: [
      {
        level: "basic",
        discipline: "dom",
        effects: [{ kind: "noReactionsFromChosen" }],
      },
      {
        level: "superior",
        discipline: "dom",
        effects: [
          { kind: "noReactionsFromChosen" },
          // "The NEXT reaction card" — one charge, spent at payment.
          {
            kind: "playCostMod",
            mod: {
              amount: 1,
              pays: "bloodOrLife",
              cardTypes: ["reaction"],
              once: true,
            },
          },
        ],
      },
    ],
  },
  {
    // "[ani] or [cel] +1 intercept.
    //  [ANI] or [CEL] As above, and strike cards cost the acting minion +1
    //  blood or life during the resulting combat if this vampire blocks."
    krcgId: 102319,
    name: "Ensnare a Beast",
    cardType: "reaction",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: ["ani", "cel"],
        effects: [{ kind: "modifyIntercept", amount: 1 }],
      },
      {
        level: "superior",
        discipline: ["ani", "cel"],
        effects: [
          { kind: "modifyIntercept", amount: 1 },
          {
            kind: "blockerCombatCostMod",
            mod: { amount: 1, pays: "bloodOrLife", cardTypes: ["strike"] },
          },
        ],
      },
    ],
  },
  // --- Discipline-filtered damage (docs/discipline-filtered-design.md) ---
  // The shared Thaumaturgy shape: a strike whose damage Fortitude cannot
  // prevent, plus "the opposing vampire's strikes with weapons inflict no
  // damage this round". The strike primitive comes FIRST in each mode, so
  // `combatWindowFor` reads the strike window and the nullify clause rides
  // along as part of the same play.
  {
    // "Only usable at close range. [tha] Strike: hand strike at +1 damage.
    // Damage from this strike cannot be prevented by cards requiring
    // Fortitude [for]. The opposing vampire's strikes with weapons inflict
    // no damage this round. [THA] As above, but at +2 damage."
    krcgId: 100201,
    name: "Blood Fury",
    cardType: "combat",
    bloodCost: 1,
    usable: ["onlyAtCloseRange"],
    modes: [
      {
        level: "basic",
        discipline: "tha",
        effects: [
          { kind: "strikeHandBonus", bonus: 1, riders: { noPreventBy: ["for"] } },
          { kind: "nullifyOpposingWeaponDamage" },
        ],
      },
      {
        level: "superior",
        discipline: "tha",
        effects: [
          { kind: "strikeHandBonus", bonus: 2, riders: { noPreventBy: ["for"] } },
          { kind: "nullifyOpposingWeaponDamage" },
        ],
      },
    ],
  },
  {
    // "Only usable at close range. [tha] Strike: hand strike. Damage from
    // this strike cannot be prevented by cards requiring Fortitude [for].
    // The opposing vampire's strikes with weapons inflict no damage this
    // round. [THA] As above, and this hand strike is at +1 damage."
    krcgId: 100208,
    name: "Blood Rage",
    cardType: "combat",
    bloodCost: 0,
    usable: ["onlyAtCloseRange"],
    modes: [
      {
        level: "basic",
        discipline: "tha",
        effects: [
          { kind: "strikeHandBonus", bonus: 0, riders: { noPreventBy: ["for"] } },
          { kind: "nullifyOpposingWeaponDamage" },
        ],
      },
      {
        level: "superior",
        discipline: "tha",
        effects: [
          { kind: "strikeHandBonus", bonus: 1, riders: { noPreventBy: ["for"] } },
          { kind: "nullifyOpposingWeaponDamage" },
        ],
      },
    ],
  },
  {
    // "[tha] Strike: 1R damage. This damage cannot be prevented by cards
    // requiring Fortitude [for]. The opposing vampire's strikes with
    // weapons inflict no damage this round. [THA] As above, but for 2R
    // damage." (Ranged, so no close-range clause — unlike Blood Fury.)
    krcgId: 101829,
    name: "Soul Burn",
    cardType: "combat",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "tha",
        effects: [
          {
            kind: "strikeDamage",
            amount: 1,
            ranged: true,
            aggravated: false,
            riders: { noPreventBy: ["for"] },
          },
          { kind: "nullifyOpposingWeaponDamage" },
        ],
      },
      {
        level: "superior",
        discipline: "tha",
        effects: [
          {
            kind: "strikeDamage",
            amount: 2,
            ranged: true,
            aggravated: false,
            riders: { noPreventBy: ["for"] },
          },
          { kind: "nullifyOpposingWeaponDamage" },
        ],
      },
    ],
  },
  {
    // "[pot] or [tha] Strike: hand strike at +2 damage. [POT] or [THA] As
    // above, and damage from this strike cannot be prevented by cards
    // requiring Fortitude [for]." (No weapon clause on this one.)
    krcgId: 102340,
    name: "Soulgrinder",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: ["pot", "tha"],
        effects: [{ kind: "strikeHandBonus", bonus: 2 }],
      },
      {
        level: "superior",
        discipline: ["pot", "tha"],
        effects: [
          { kind: "strikeHandBonus", bonus: 2, riders: { noPreventBy: ["for"] } },
        ],
      },
    ],
  },
  // --- Aggravated hand strikes (one-off sweep) ---
  {
    // "[pro] Damage from this vampire's hand strikes is aggravated this
    // round. [PRO] Maneuver." (Separate modes — pick one.)
    krcgId: 100356,
    name: "Claws of the Dead",
    cardType: "combat",
    bloodCost: 1,
    usable: [],
    modes: [
      { level: "basic", discipline: "pro", effects: [{ kind: "handStrikesAggravated" }] },
      { level: "superior", discipline: "pro", effects: [{ kind: "maneuver" }] },
    ],
  },
  {
    // "[pro] Damage from this vampire's hand strikes is aggravated this
    // round. [PRO] Press."
    krcgId: 102190,
    name: "Wolf Claws",
    cardType: "combat",
    bloodCost: 1,
    usable: [],
    modes: [
      { level: "basic", discipline: "pro", effects: [{ kind: "handStrikesAggravated" }] },
      { level: "superior", discipline: "pro", effects: [{ kind: "press", continueOnly: true }] },
    ],
  },
  // --- Votes-during-polling gate (docs/polling-votes-design.md) ---
  {
    krcgId: 100157,
    name: "Bewitching Oration",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "pre", effects: [{ kind: "modifyVotes", amount: 2 }] },
      { level: "superior", discipline: "pre", effects: [{ kind: "modifyVotes", amount: 4 }] },
    ],
  },
  {
    krcgId: 101008,
    name: "Iron Glare",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      // "[pot][pre]" requires both disciplines.
      { level: "basic", discipline: { all: ["pot", "pre"] }, effects: [{ kind: "modifyVotes", amount: 2 }] },
      {
        level: "superior",
        discipline: { all: ["pot", "pre"] },
        usable: ["onlyDuringBleed"],
        effects: [{ kind: "modifyBleed", amount: 2, limited: true }],
      },
    ],
  },
  {
    // "Allies cannot block this action" (p. 26). Superior adds +2 bleed
    // and restricts the card to bleed actions.
    krcgId: 102264,
    name: "Visions of Gehenna",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "pre",
        effects: [{ kind: "blockRestriction", who: "allies" }],
      },
      {
        level: "superior",
        discipline: "pre",
        usable: ["onlyDuringBleed"],
        effects: [
          { kind: "blockRestriction", who: "allies" },
          { kind: "modifyBleed", amount: 2, limited: true },
        ],
      },
    ],
  },
  {
    // "Choose a younger vampire; it cannot block this action." Superior:
    // any vampire. ("Only usable as the action is announced" is naturally
    // satisfied — action modifiers resolve before the block window.)
    krcgId: 101712,
    name: "Seduction",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "dom",
        effects: [{ kind: "blockRestriction", who: "chosen", chosenScope: "younger" }],
      },
      {
        level: "superior",
        discipline: "dom",
        effects: [{ kind: "blockRestriction", who: "chosen", chosenScope: "any" }],
      },
    ],
  },
  {
    // "+1 stealth action. Put this card on this vampire; it gets +1 (sup:
    // +2) bleed." One per vampire (own-duplicate prevention).
    krcgId: 100904,
    name: "Heart of the City",
    cardType: "action",
    bloodCost: 2,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "pre",
        effects: [{ kind: "actionStealth", amount: 1 }, { kind: "attachSelf", bleed: 1 }],
      },
      {
        level: "superior",
        discipline: "pre",
        effects: [{ kind: "actionStealth", amount: 1 }, { kind: "attachSelf", bleed: 2 }],
      },
    ],
  },
  {
    // "+2 stealth action. Put this card on this vampire; it gets +1 (sup:
    // +2) strength." (The "cannot play Torn Signpost" rider is unmodeled.)
    // "+2 stealth action. [pot] Put this card on this vampire. This
    //  vampire gets +1 strength. They cannot play cards named /Torn
    //  Signpost/. A vampire can have only one Preternatural Strength.
    //  [POT] As above, but this vampire gets +2 strength."
    //
    // The Torn Signpost clause CAN bite: that card (101993) is in the pool
    // and supported. It is barred by NAME rather than by type, and it is a
    // COMBAT card, so the check lives in `canPlayMode` — the per-minion
    // gate every compiler funnels through — and not beside
    // `cannotPlayCardTypes`, which only guards recruit/employ.
    krcgId: 101483,
    name: "Preternatural Strength",
    cardType: "action",
    bloodCost: 1,
    permanent: { where: "bearer", statics: {}, tags: [], exclusiveKey: "Preternatural Strength" },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "pot",
        effects: [
          { kind: "actionStealth", amount: 2 },
          {
            kind: "attachSelf",
            strength: 1,
            statics: { cannotPlayCardNames: ["Torn Signpost"] },
          },
        ],
      },
      {
        level: "superior",
        discipline: "pot",
        effects: [
          { kind: "actionStealth", amount: 2 },
          {
            kind: "attachSelf",
            strength: 2,
            statics: { cannotPlayCardNames: ["Torn Signpost"] },
          },
        ],
      },
    ],
  },
  {
    // "Only during a bleed. [pre][pro] +1 bleed (limited), or +1 stealth
    // and +1 bleed (limited). [PRE][PRO] As above, and on a successful
    // bleed, burn 2 of your corruption from a minion of the target to
    // unlock."
    krcgId: 102233,
    name: "Revelation of the Serpent",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: ["onlyDuringBleed"],
    modes: [
      { level: "basic", variant: "bleed", discipline: { all: ["pre", "pro"] }, effects: [{ kind: "modifyBleed", amount: 1, limited: true }] },
      { level: "basic", variant: "sb", discipline: { all: ["pre", "pro"] }, effects: [{ kind: "modifyStealth", amount: 1 }, { kind: "modifyBleed", amount: 1, limited: true }] },
      { level: "superior", variant: "bleed", discipline: { all: ["pre", "pro"] }, effects: [{ kind: "modifyBleed", amount: 1, limited: true }, { kind: "unlockViaCorruption" }] },
      { level: "superior", variant: "sb", discipline: { all: ["pre", "pro"] }, effects: [{ kind: "modifyStealth", amount: 1 }, { kind: "modifyBleed", amount: 1, limited: true }, { kind: "unlockViaCorruption" }] },
    ],
  },
  {
    // "[pre][pro] +1 stealth. [PRE][PRO] As above, and once this action,
    // burn 1 of your corruption counters from a blocking minion to fail
    // their block (they cannot block this action again)."
    krcgId: 102221,
    name: "Enchanting Gaze",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: { all: ["pre", "pro"] }, effects: [{ kind: "modifyStealth", amount: 1 }] },
      {
        level: "superior",
        discipline: { all: ["pre", "pro"] },
        effects: [{ kind: "modifyStealth", amount: 1 }, { kind: "corruptFailBlock" }],
      },
    ],
  },
  {
    // "Non-Camarilla vampires cannot cast votes or ballots this referendum."
    // Requires the controller to hold a prince/justicar/Inner Circle member.
    krcgId: 100364,
    name: "Closed Session",
    cardType: "actionModifier",
    bloodCost: 0,
    requiresControlledTitle: ["prince", "justicar", "innerCircle"],
    usable: [],
    modes: [
      { level: "basic", discipline: null, effects: [{ kind: "restrictVotes", sect: "camarilla" }] },
    ],
  },
  {
    // "Non-Sabbat vampires cannot cast votes or ballots this referendum."
    krcgId: 101490,
    name: "Private Audience",
    cardType: "actionModifier",
    bloodCost: 0,
    requiresControlledTitle: ["archbishop", "priscus", "cardinal", "regent"],
    usable: [],
    modes: [
      { level: "basic", discipline: null, effects: [{ kind: "restrictVotes", sect: "sabbat" }] },
    ],
  },
  {
    // "+1/+2 bleed, with an additional +1 bleed if this vampire is
    // Toreador (limited)." Only during a bleed action.
    krcgId: 100031,
    name: "Aire of Elation",
    cardType: "actionModifier",
    bloodCost: 1,
    usable: ["onlyDuringBleed"],
    modes: [
      {
        level: "basic",
        discipline: "pre",
        effects: [{ kind: "modifyBleed", amount: 1, limited: true, bonus: { extra: 1, when: { kind: "selfClan", clan: "Toreador" } } }],
      },
      {
        level: "superior",
        discipline: "pre",
        effects: [{ kind: "modifyBleed", amount: 2, limited: true, bonus: { extra: 1, when: { kind: "selfClan", clan: "Toreador" } } }],
      },
    ],
  },
  {
    // "Only usable during a bleed action. [dom] +1 bleed (limited). [DOM]
    // +3 bleed if the target Methuselah has 9 or fewer pool (limited)."
    krcgId: 100765,
    name: "Foreshadowing Destruction",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: ["onlyDuringBleed"],
    modes: [
      {
        level: "basic",
        discipline: "dom",
        effects: [{ kind: "modifyBleed", amount: 1, limited: true }],
      },
      {
        level: "superior",
        discipline: "dom",
        effects: [{ kind: "modifyBleed", amount: 0, limited: true, bonus: { extra: 3, when: { kind: "targetPoolAtMost", value: 9 } } }],
      },
    ],
  },
  {
    // "Requires an Anarch. +1 intercept, with an additional +1 intercept if
    // the acting minion is titled."
    krcgId: 101501,
    name: "Protection Racket",
    cardType: "reaction",
    bloodCost: 0,
    requiresSect: ["anarch"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "modifyIntercept", amount: 1, bonus: { extra: 1, when: { kind: "actingTitled" } } }],
      },
    ],
  },
  {
    // "Only usable during an action directed at you. +2 intercept, +1 more
    // if this Nosferatu is titled."
    krcgId: 102216,
    name: "The Warrens",
    cardType: "reaction",
    bloodCost: 1,
    requiresClan: ["Nosferatu"],
    usable: ["actionDirectedAtYou"],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "modifyIntercept", amount: 2, bonus: { extra: 1, when: { kind: "selfTitled" } } }],
      },
    ],
  },
  {
    // "[aus] Directed at you: +2 intercept. [AUS] Locked vampire: wakes."
    krcgId: 100680,
    name: "Eyes of Argus",
    cardType: "reaction",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "aus",
        usable: ["actionDirectedAtYou"],
        effects: [{ kind: "modifyIntercept", amount: 2 }],
      },
      {
        level: "superior",
        discipline: "aus",
        usable: ["byLockedMinion"],
        effects: [{ kind: "wake" }],
      },
    ],
  },
  {
    // "[aus] +1 intercept. [AUS] As above, and if this vampire blocks, put
    // this card on the acting minion (you still control it); later, during
    // a bleed against that minion's controller, burn it for +1 bleed."
    krcgId: 101195,
    name: "Melange",
    cardType: "reaction",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "aus", effects: [{ kind: "modifyIntercept", amount: 1 }] },
      {
        level: "superior",
        discipline: "aus",
        effects: [{ kind: "modifyIntercept", amount: 1 }, { kind: "attachToActorOnBlock" }],
      },
    ],
  },
  {
    // "[aus] +1 intercept. [AUS] As above, with 1 optional maneuver during
    // the resulting combat if this vampire blocks."
    krcgId: 101850,
    name: "Spirit's Touch",
    cardType: "reaction",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "aus", effects: [{ kind: "modifyIntercept", amount: 1 }] },
      {
        level: "superior",
        discipline: "aus",
        effects: [{ kind: "modifyIntercept", amount: 1 }, { kind: "blockerCombatRider", maneuver: 1 }],
      },
    ],
  },
  {
    // "Directed at you: [pro] +2 intercept. [PRO] Locked vampire: unlocks
    // and attempts to block; if it blocks, neither combatant can strike the
    // first round of the resulting combat."
    krcgId: 102256,
    name: "One With the Land",
    cardType: "reaction",
    bloodCost: 0,
    usable: ["actionDirectedAtYou"],
    modes: [
      { level: "basic", discipline: "pro", effects: [{ kind: "modifyIntercept", amount: 2 }] },
      {
        level: "superior",
        discipline: "pro",
        usable: ["byLockedMinion"],
        effects: [
          { kind: "unlockAndAttemptBlock" },
          { kind: "blockerCombatRider", noStrikeFirstRound: true },
        ],
      },
    ],
  },
  {
    // "[aus] +1 intercept. [AUS] If your predator's minion is bleeding you
    // (after blocks declined, 3+ Methuselahs): lock this vampire and
    // redirect the bleed to your predator's predator."
    krcgId: 101259,
    name: "My Enemy's Enemy",
    cardType: "reaction",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "aus", effects: [{ kind: "modifyIntercept", amount: 1 }] },
      {
        level: "superior",
        discipline: "aus",
        usable: ["predatorBleedingYou", "afterBlocksDeclined"],
        effects: [{ kind: "redirectBleed", lockSelf: true, toPredatorsPredator: true }],
      },
    ],
  },
  {
    // "[ani] Locked vampire who has blocked, after block resolution: unlock
    // it. [ANI] +1 intercept."
    krcgId: 100308,
    name: "Cats' Guidance",
    cardType: "reaction",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "ani", usable: ["afterBlockResolution"], effects: [{ kind: "unlockMinion" }] },
      { level: "superior", discipline: "ani", effects: [{ kind: "modifyIntercept", amount: 1 }] },
    ],
  },
  {
    // "[for] Locked vampire who has blocked, after block resolution: unlock
    // it. [FOR] Locked vampire during an action directed at you: unlock it."
    krcgId: 100762,
    name: "Forced Vigilance",
    cardType: "reaction",
    bloodCost: 1,
    usable: [],
    modes: [
      { level: "basic", discipline: "for", usable: ["afterBlockResolution"], effects: [{ kind: "unlockMinion" }] },
      {
        level: "superior",
        discipline: "for",
        usable: ["byLockedMinion", "actionDirectedAtYou"],
        effects: [{ kind: "unlockMinion" }],
      },
    ],
  },
  // --- Unlock-and-attempt-to-block (docs/unlock-and-block-design.md) ---
  {
    // "[ani] +1 intercept. [ANI] Locked vampire: unlocks and attempts to
    // block." Requires capacity 7+.
    krcgId: 101717,
    name: "Sense the Savage Way",
    cardType: "reaction",
    bloodCost: 0,
    requiresCapacity: 7,
    usable: [],
    modes: [
      { level: "basic", discipline: "ani", effects: [{ kind: "modifyIntercept", amount: 1 }] },
      {
        level: "superior",
        discipline: "ani",
        usable: ["byLockedMinion"],
        effects: [{ kind: "unlockAndAttemptBlock" }],
      },
    ],
  },
  {
    // "[ani]/[tha] Locked vampire: unlocks and attempts to block. [ANI]/[THA]
    // Reduce a bleed against you by 3."
    krcgId: 102339,
    name: "Sentry Signal",
    cardType: "reaction",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: ["ani", "tha"],
        usable: ["byLockedMinion"],
        effects: [{ kind: "unlockAndAttemptBlock" }],
      },
      {
        level: "superior",
        discipline: ["ani", "tha"],
        usable: ["bleedTargetsYou"],
        effects: [{ kind: "modifyBleed", amount: -3, limited: false }],
      },
    ],
  },
  {
    // "Requires a prince or justicar. +2 intercept. Or: locked prince/
    // justicar burns 1 blood to unlock and attempt to block with +2
    // intercept, even if not yet needed."
    krcgId: 101706,
    name: "Second Tradition: Domain",
    cardType: "reaction",
    bloodCost: 0,
    requiresTitle: ["prince", "justicar"],
    usable: [],
    modes: [
      { level: "basic", variant: "intercept", discipline: null, effects: [{ kind: "modifyIntercept", amount: 2 }] },
      {
        level: "basic",
        variant: "block",
        discipline: null,
        usable: ["byLockedMinion"],
        effects: [{ kind: "unlockAndAttemptBlock", interceptBonus: 2, bloodCost: 1 }],
      },
    ],
  },
  {
    // "[aus] +1 intercept. [AUS] Attempt to block, ignoring the normal
    // prey/predator/target restrictions."
    krcgId: 100598,
    name: "Eagle's Sight",
    cardType: "reaction",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "aus", effects: [{ kind: "modifyIntercept", amount: 1 }] },
      {
        level: "superior",
        discipline: "aus",
        effects: [{ kind: "unlockAndAttemptBlock", ignoreRestrictions: true }],
      },
    ],
  },
  {
    // "Locked vampire during a bleed directed at you. [ani] Unlock this
    // vampire. [ANI] As above, +1 maneuver in the resulting combat if it
    // blocks."
    krcgId: 100863,
    name: "Guard Dogs",
    cardType: "reaction",
    bloodCost: 0,
    usable: ["byLockedMinion", "onlyDuringBleed", "bleedTargetsYou"],
    modes: [
      { level: "basic", discipline: "ani", effects: [{ kind: "unlockMinion" }] },
      {
        level: "superior",
        discipline: "ani",
        effects: [{ kind: "unlockMinion" }, { kind: "blockerCombatRider", maneuver: 1 }],
      },
    ],
  },
  {
    // "Locked Gangrel unlocks and attempts to block. During this action it
    // can burn 1 blood for +1 intercept (repeatable). Lock it after
    // resolution if it did not block."
    krcgId: 102222,
    name: "Eyes of the Wild",
    cardType: "reaction",
    bloodCost: 0,
    requiresClan: ["Gangrel"],
    usable: ["byLockedMinion"],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "unlockAndAttemptBlock", penaltyIfNoBlock: "lock" },
          { kind: "grantBurnForIntercept" },
        ],
      },
    ],
  },
  {
    // "Locked vampire unlocks and attempts to block. If it does not block:
    // [ani] lock it after action resolution; [ANI] attach this card (burn
    // for +1 intercept)." Bespoke overlay adds the attached ability.
    krcgId: 102353,
    name: "Dogged Pursuit",
    cardType: "reaction",
    bloodCost: 0,
    usable: ["byLockedMinion"],
    modes: [
      {
        level: "basic",
        discipline: "ani",
        effects: [{ kind: "unlockAndAttemptBlock", penaltyIfNoBlock: "lock" }],
      },
      {
        level: "superior",
        discipline: "ani",
        effects: [{ kind: "unlockAndAttemptBlock", penaltyIfNoBlock: "attach" }],
      },
    ],
  },
  {
    // "Locked vampire during a bleed against you. [ani] Unlock this vampire.
    // [ANI] As above, +1 press in the resulting combat if it blocks."
    krcgId: 101547,
    name: "Rat's Warning",
    cardType: "reaction",
    bloodCost: 0,
    usable: ["byLockedMinion", "onlyDuringBleed", "bleedTargetsYou"],
    modes: [
      { level: "basic", discipline: "ani", effects: [{ kind: "unlockMinion" }] },
      {
        level: "superior",
        discipline: "ani",
        effects: [{ kind: "unlockMinion" }, { kind: "blockerCombatRider", press: 1 }],
      },
    ],
  },
  {
    krcgId: 101318,
    name: "Old Friends",
    cardType: "actionModifier",
    bloodCost: 1,
    delayedReplace: "unlock",
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "obf",
        usable: ["onlyDuringBleed"],
        effects: [{ kind: "modifyBleed", amount: 1, limited: true }],
      },
      { level: "superior", discipline: "obf", effects: [{ kind: "modifyVotes", amount: 2 }] },
    ],
  },
  {
    krcgId: 102278,
    name: "Ominous Chorus",
    cardType: "modifierOrReaction",
    bloodCost: 0,
    requiresClan: ["Lasombra"],
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [{ kind: "modifyVotes", amount: 3 }] }],
  },
  {
    krcgId: 102231,
    name: "Party Out Of Bounds",
    cardType: "reaction",
    bloodCost: 0,
    requiresSect: ["anarch"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "obf",
        variant: "reduce",
        usable: ["bleedTargetsYou"],
        effects: [{ kind: "modifyBleed", amount: -2, limited: false }],
      },
      { level: "basic", discipline: "pre", variant: "votes", effects: [{ kind: "modifyVotes", amount: 2 }] },
      { level: "basic", discipline: "pro", variant: "intercept", effects: [{ kind: "modifyIntercept", amount: 1 }] },
    ],
  },
  {
    krcgId: 102214,
    name: "Protected District",
    cardType: "reaction",
    bloodCost: 0,
    requiresTitle: ["primogen"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        variant: "reduce",
        usable: ["bleedTargetsYou"],
        effects: [{ kind: "modifyBleed", amount: -3, limited: false }],
      },
      // "+3 votes against" — modeled as a flexible grant (owner-approved).
      { level: "basic", discipline: null, variant: "votes", effects: [{ kind: "modifyVotes", amount: 3 }] },
    ],
  },
  {
    krcgId: 102109,
    name: "Ventrue Headquarters",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: { grant: "votes", amount: 3 },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 101341,
    name: "Oxford University, England",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: { grant: "votes", amount: 2, perPoolX: true },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "During polling, lock to give each Lasombra you control +1 vote."
    krcgId: 101430,
    name: "Power Structure",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: [],
      lockGrant: { grant: "votes", amount: 1, clan: "Lasombra", ownOnly: true, perClanMinion: true },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  // --- Sweep: clan uncontrolled-blood locations + misc ---
  {
    krcgId: 100081,
    name: "Arcane Library",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: { grant: "uncontrolledBlood", amount: 1, clan: "Tremere" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 100095,
    name: "Art Museum",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: { grant: "uncontrolledBlood", amount: 1, clan: "Toreador" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 100609,
    name: "Ecoterrorists",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: { grant: "uncontrolledBlood", amount: 1, clan: "Gangrel" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 101780,
    name: "Sight Beyond Sight",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: { where: "bearer", statics: { intercept: 1 }, tags: [], attachClan: "Salubri" },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 101292,
    name: "No Trace",
    cardType: "combat",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "obf",
        usable: ["onlyAtLongRange"],
        effects: [{ kind: "strikeCombatEnds", unlockSelf: false }],
      },
      {
        level: "superior",
        discipline: "obf",
        effects: [{ kind: "strikeCombatEnds", unlockSelf: false }],
      },
    ],
  },
  // --- Clan/sect gate (docs/clan-sect-design.md) ---
  // Clan-locked stealth locations.
  {
    krcgId: 100126,
    name: "Backways",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: { grant: "stealth", amount: 1, clan: "Gangrel", ownOnly: true },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 100629,
    name: "Elysian Fields",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: { grant: "stealth", amount: 1, clan: "Lasombra", ownOnly: true },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 100777,
    name: "Fortune Teller Shop",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: { grant: "stealth", amount: 1, clan: "Ravnos" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 101070,
    name: "The Labyrinth",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: { grant: "stealth", amount: 1, clan: "Nosferatu", ownOnly: true },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 101326,
    name: "Opium Den",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    // "Follower of Set" is the V5 Ministry clan.
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: { grant: "stealth", amount: 1, clan: "Ministry", ownOnly: true },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 101171,
    name: "Market Square",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    // "Assamite" is the V5 Banu Haqim clan.
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: { grant: "intercept", amount: 1, clan: "Banu Haqim", ownOnly: true },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  // Archetypes (docs/archetypes-design.md). All four share this skeleton —
  // put on a vampire you control, at most one archetype per vampire — and
  // differ only in the once-per-turn trigger, which is bespoke.
  {
    krcgId: 100485,
    name: "Dabbler",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    trifle: true,
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["archetype"],
      attach: { scope: "own", kind: "vampire" },
      exclusiveKey: "archetype",
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 101242,
    name: "Monster",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["archetype"],
      attach: { scope: "own", kind: "vampire" },
      exclusiveKey: "archetype",
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 101388,
    name: "Perfectionist",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["archetype"],
      attach: { scope: "own", kind: "vampire" },
      exclusiveKey: "archetype",
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 101564,
    name: "Rebel",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    trifle: true,
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["archetype"],
      attach: { scope: "own", kind: "vampire" },
      exclusiveKey: "archetype",
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  // Lock-to-grant locations (docs/lock-grant-locations-design.md).
  {
    krcgId: 100052,
    name: "The Anarch Free Press",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    // "Requires a ready Anarch" — a condition on the Methuselah playing
    // it, not on any acting minion. The hunt clause is bespoke.
    requiresControlledSect: ["anarch"],
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: { grant: "intercept", amount: 1, sect: "anarch", ownOnly: true },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 100172,
    name: "The Black Throne",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    // "+2 votes during the polling step of ANY referendum" — not only
    // your own. The contract-payout clause is bespoke.
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: { grant: "votes", amount: 2 },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 100327,
    name: "Channel 10",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    // "Lock to give a minion you control +2 intercept. Not usable during
    // the first action in a minion phase." No clan or sect filter — any
    // minion, ally included.
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: {
        grant: "intercept",
        amount: 2,
        ownOnly: true,
        notFirstMinionAction: true,
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 101067,
    name: "KRCG News Radio",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    // Two clauses over one lock: +1 intercept to your own blocker free,
    // or to another Methuselah's blocker for 1 pool.
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: {
        grant: "intercept",
        amount: 1,
        ownOnly: true,
        otherMethuselah: { poolCost: 1 },
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 101068,
    name: "Kumpania",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    // "…a Ravnos with capacity 5 or more you control": minCapacity reads
    // the DERIVED capacity, so a granted +1 counts.
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: {
        grant: "intercept",
        amount: 1,
        clan: "Ravnos",
        ownOnly: true,
        minCapacity: 5,
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 100054,
    name: "Anarch Railroad",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    // "give an Anarch +1 stealth" — any Anarch actor (owner-approved).
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: { grant: "stealth", amount: 1, sect: "anarch" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  // Sect-gated political actions.
  {
    krcgId: 102318,
    name: "Empires Fall",
    cardType: "politicalAction",
    bloodCost: 0,
    requiresSect: ["sabbat"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "refChooseSeatsBurn", base: 1, capBonus: { atLeast: 8, extra: 3 } }],
      },
    ],
  },
  {
    krcgId: 101567,
    name: "Reckless Agitation",
    cardType: "politicalAction",
    bloodCost: 2,
    requiresSect: ["anarch", "independent"],
    requiresCapacity: 5,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "refAllocateBurn", points: 6, minTargets: 2, excludeSelf: true }],
      },
    ],
  },
  // --- Combat gate: dodge & additional strikes
  //     (docs/dodge-additional-strikes-design.md) ---
  {
    krcgId: 100227,
    name: "Blur",
    cardType: "combat",
    bloodCost: 1,
    usable: [],
    modes: [
      { level: "basic", discipline: "cel", effects: [{ kind: "additionalStrike", count: 1, limited: true }] },
      { level: "superior", discipline: "cel", effects: [{ kind: "additionalStrike", count: 2, limited: true }] },
    ],
  },
  {
    krcgId: 101107,
    name: "Lightning Reflexes",
    cardType: "combat",
    bloodCost: 1,
    usable: [],
    modes: [
      { level: "basic", discipline: "cel", effects: [{ kind: "additionalStrike", count: 1, limited: true }] },
      {
        level: "superior",
        discipline: "cel",
        effects: [{ kind: "additionalStrike", count: 0, limited: true, perBloodX: true }],
      },
    ],
  },
  {
    krcgId: 101523,
    name: "Pursuit",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "cel", effects: [{ kind: "maneuver" }] },
      { level: "superior", discipline: "cel", effects: [{ kind: "additionalStrike", count: 1, limited: true }] },
    ],
  },
  {
    krcgId: 101532,
    name: "Quickness",
    cardType: "combat",
    bloodCost: 0,
    // "A vampire can play only one Quickness each round."
    combatLimit: "round",
    usable: [],
    modes: [
      { level: "basic", discipline: "cel", effects: [{ kind: "additionalStrike", count: 1, limited: true }] },
      {
        level: "superior",
        discipline: "cel",
        // "…that does not count against the limit" → not a limited source.
        effects: [{ kind: "additionalStrike", count: 1, limited: false }],
      },
    ],
  },
  {
    krcgId: 101778,
    name: "Side Strike",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "cel", effects: [{ kind: "strikeDodge" }] },
      { level: "superior", discipline: "cel", effects: [{ kind: "additionalStrike", count: 1, limited: true }] },
    ],
  },
  {
    krcgId: 102185,
    name: "Wind Dance",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "tha", effects: [{ kind: "strikeDodge" }] },
      {
        level: "superior",
        discipline: "tha",
        // "As above, with 1 ADDITIONAL STRIKE: DODGE (limited)." The extra
        // sub-round's strike is the one the card names — `forcedDodge`
        // offers it alone rather than leaving a free choice, which is what
        // the old deviation did (docs/ledger-closeout.md §3).
        effects: [
          { kind: "strikeDodge" },
          { kind: "additionalStrike", count: 1, limited: true, forcedDodge: true },
        ],
      },
    ],
  },
  {
    krcgId: 102305,
    name: "Shadow Shift",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "obl", effects: [{ kind: "additionalStrike", count: 1, limited: true }] },
      { level: "superior", discipline: "obl", effects: [{ kind: "maneuver" }] },
    ],
  },
  {
    krcgId: 102275,
    name: "Arms of Ahriman",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "obl", effects: [{ kind: "additionalStrike", count: 1, limited: true }] },
      {
        level: "superior",
        discipline: "obl",
        effects: [{ kind: "strikeDodge" }, { kind: "additionalStrike", count: 1, limited: true }],
      },
    ],
  },
  // --- Sweep: vocabulary-fit defensive/utility cards ---
  {
    krcgId: 100834,
    name: "Glancing Blow",
    cardType: "combat",
    bloodCost: 0,
    delayedReplace: "unlock",
    usable: [],
    modes: [
      { level: "basic", discipline: null, effects: [{ kind: "prevent", base: 1, perBloodX: false }] },
    ],
  },
  {
    krcgId: 101817,
    name: "Soak",
    cardType: "combat",
    bloodCost: 0,
    // "A vampire can play only one Soak each round. [for] Prevent 2
    // NON-AGGRAVATED damage. [FOR] Prevent 4 non-aggravated damage."
    // That filter had no representation until the combat-attachments
    // wave, so Soak was preventing aggravated damage it cannot touch —
    // a live rules bug on a supported card, not a deferral.
    // docs/combat-attachments-design.md §3
    combatLimit: "round",
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "for",
        effects: [{ kind: "prevent", base: 2, perBloodX: false, nonAggravated: true }],
      },
      {
        level: "superior",
        discipline: "for",
        effects: [{ kind: "prevent", base: 4, perBloodX: false, nonAggravated: true }],
      },
    ],
  },
  {
    krcgId: 101588,
    name: "Rego Motum",
    cardType: "combat",
    bloodCost: 1,
    combatLimit: "round",
    usable: [],
    modes: [
      { level: "basic", discipline: "tha", effects: [{ kind: "prevent", base: 2, perBloodX: false }] },
      { level: "superior", discipline: "tha", effects: [{ kind: "prevent", base: 4, perBloodX: false }] },
    ],
  },
  {
    krcgId: 101948,
    name: "Telepathic Counter",
    cardType: "reaction",
    bloodCost: 0,
    // "Reduce a bleed against you" — a negative bleed modifier played as
    // a reaction by the bleed target.
    usable: ["bleedTargetsYou"],
    modes: [
      { level: "basic", discipline: "aus", effects: [{ kind: "modifyBleed", amount: -1, limited: false }] },
      { level: "superior", discipline: "aus", effects: [{ kind: "modifyBleed", amount: -2, limited: false }] },
    ],
  },
  {
    krcgId: 101613,
    name: "Restoration",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "for",
        effects: [{ kind: "actionStealth", amount: 1 }, { kind: "actionGainBlood", amount: 2 }],
      },
      {
        level: "superior",
        discipline: "for",
        effects: [{ kind: "actionStealth", amount: 1 }, { kind: "actionGainBlood", amount: 3 }],
      },
    ],
  },
  {
    krcgId: 100782,
    name: "Fourth Tradition: The Accounting",
    cardType: "action",
    bloodCost: 1,
    requiresTitle: ["prince", "justicar"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "addUncontrolledBlood", amount: 3, youngerOnly: true },
        ],
      },
    ],
  },
  {
    krcgId: 100727,
    name: "Fifth Tradition: Hospitality",
    cardType: "action",
    bloodCost: 1,
    requiresTitle: ["prince", "justicar"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "actionAddBloodToVampire", amount: 4 },
        ],
      },
    ],
  },
  {
    krcgId: 102225,
    name: "Form of the Wolf",
    cardType: "combat",
    bloodCost: 0,
    combatLimit: "combat",
    usable: [],
    modes: [
      { level: "basic", discipline: "pro", effects: [{ kind: "addStrength", amount: 1 }] },
      {
        level: "superior",
        discipline: "pro",
        effects: [{ kind: "addStrength", amount: 1 }, { kind: "grantPress", combat: true }],
      },
    ],
  },
  {
    krcgId: 102215,
    name: "Roundhouse",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "pot", effects: [{ kind: "strikeHandBonus", bonus: 2 }] },
      { level: "superior", discipline: "pot", effects: [{ kind: "strikeHandBonus", bonus: 3 }] },
    ],
  },
  {
    krcgId: 101144,
    name: "Majesty",
    cardType: "combat",
    bloodCost: 1,
    usable: [],
    modes: [
      { level: "basic", discipline: "pre", effects: [{ kind: "strikeCombatEnds", unlockSelf: false }] },
      { level: "superior", discipline: "pre", effects: [{ kind: "strikeCombatEnds", unlockSelf: true }] },
    ],
  },
  {
    krcgId: 101993,
    name: "Torn Signpost",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "pot", effects: [{ kind: "setStrength", value: 2 }] },
      { level: "superior", discipline: "pot", effects: [{ kind: "setStrength", value: 3 }] },
    ],
  },
  {
    krcgId: 100918,
    name: "Hidden Strength",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "for", effects: [{ kind: "prevent", base: 1, perBloodX: true }] },
      {
        level: "superior",
        discipline: "for",
        effects: [
          { kind: "prevent", base: 1, perBloodX: true },
          { kind: "grantPress" },
        ],
      },
    ],
  },
  {
    krcgId: 100077,
    name: "Apportation",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "tha", effects: [{ kind: "press", continueOnly: true }] },
      { level: "superior", discipline: "tha", effects: [{ kind: "maneuver" }] },
    ],
  },
  // --- Sweep: vocabulary-fit cards (docs/card-primitives.md §6) ---
  {
    krcgId: 100236,
    name: "Bonding",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: ["onlyDuringBleed"],
    modes: [
      { level: "basic", discipline: "dom", effects: [{ kind: "modifyBleed", amount: 1, limited: true }] },
      {
        level: "superior",
        discipline: "dom",
        effects: [
          { kind: "modifyStealth", amount: 1 },
          { kind: "modifyBleed", amount: 1, limited: true },
        ],
      },
    ],
  },
  {
    krcgId: 100600,
    name: "Earth Control",
    cardType: "actionModifier",
    bloodCost: 1,
    usable: [],
    modes: [
      { level: "basic", discipline: "pro", effects: [{ kind: "modifyStealth", amount: 1 }] },
      { level: "superior", discipline: "pro", effects: [{ kind: "modifyStealth", amount: 2 }] },
    ],
  },
  {
    krcgId: 100769,
    name: "Forgotten Labyrinth",
    cardType: "actionModifier",
    bloodCost: 1,
    usable: ["notDuringBleed"],
    modes: [
      { level: "basic", discipline: "obf", effects: [{ kind: "modifyStealth", amount: 2 }] },
      { level: "superior", discipline: "obf", effects: [{ kind: "modifyStealth", amount: 3 }] },
    ],
  },
  {
    krcgId: 101978,
    name: "Threats",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: ["onlyDuringBleed"],
    modes: [
      { level: "basic", discipline: "dom", effects: [{ kind: "modifyBleed", amount: 1, limited: true }] },
      { level: "superior", discipline: "dom", effects: [{ kind: "modifyBleed", amount: 2, limited: true }] },
    ],
  },
  {
    krcgId: 102341,
    name: "Subversion",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: ["cel", "pre"], effects: [{ kind: "modifyStealth", amount: 1 }] },
      {
        level: "superior",
        discipline: ["cel", "pre"],
        variant: "bleed",
        effects: [{ kind: "modifyBleed", amount: 1, limited: true }],
      },
      {
        level: "superior",
        discipline: ["cel", "pre"],
        variant: "stealth-bleed",
        effects: [
          { kind: "modifyStealth", amount: 1 },
          { kind: "modifyBleed", amount: 1, limited: true },
        ],
      },
    ],
  },
  {
    krcgId: 102137,
    name: "Wake with Evening's Freshness",
    cardType: "reaction",
    bloodCost: 0,
    usable: ["byLockedMinion", "byVampire"],
    delayedReplace: "unlock",
    modes: [{ level: "basic", discipline: null, effects: [{ kind: "wake" }] }],
  },
  {
    krcgId: 100760,
    name: "Forced Awakening",
    cardType: "reaction",
    bloodCost: 0,
    usable: ["byLockedMinion", "byVampire"],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "wake" }, { kind: "burnIfNotBlocking", amount: 1 }],
      },
    ],
  },
  {
    krcgId: 101949,
    name: "Telepathic Misdirection",
    cardType: "reaction",
    bloodCost: 1,
    usable: [],
    modes: [
      { level: "basic", discipline: "aus", effects: [{ kind: "modifyIntercept", amount: 1 }] },
      {
        level: "superior",
        discipline: "aus",
        usable: ["bleedTargetsYou", "afterBlocksDeclined"],
        effects: [{ kind: "redirectBleed", lockSelf: true }],
      },
    ],
  },
  {
    krcgId: 100618,
    name: "Elder Intervention",
    cardType: "reaction",
    bloodCost: 1,
    // Pack Tactics clause is moot: that card is not in the V5 pool.
    usable: ["bleedTargetsYou"],
    delayedReplace: "afterAction",
    modes: [
      { level: "basic", discipline: null, effects: [{ kind: "modifyIntercept", amount: 2 }] },
    ],
  },
  {
    krcgId: 101698,
    name: "Scouting Mission",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "dom", effects: [{ kind: "actionBleed", bonus: 1 }] },
      {
        level: "superior",
        discipline: "dom",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "addUncontrolledBlood", amount: 2, youngerOnly: true },
        ],
      },
    ],
  },
  {
    krcgId: 101819,
    name: "Social Charm",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "pre", effects: [{ kind: "actionBleed", bonus: 1 }] },
      {
        level: "superior",
        discipline: "pre",
        effects: [
          { kind: "actionBleed", bonus: 1 },
          { kind: "poolGainOnBleedSuccess", amount: 1 },
        ],
      },
    ],
  },
  {
    krcgId: 101513,
    name: "Public Trust",
    cardType: "action",
    bloodCost: 1,
    usable: [],
    modes: [
      { level: "basic", discipline: "pre", effects: [{ kind: "actionBleed", bonus: 2 }] },
      {
        level: "superior",
        discipline: "pre",
        effects: [
          { kind: "actionBleed", bonus: 2 },
          { kind: "bloodOnBleedSuccess", amount: 1, scope: "uncontrolled", youngerOnly: false },
        ],
      },
    ],
  },
  {
    krcgId: 102248,
    name: "Feast of the Soul's Secrets",
    cardType: "action",
    bloodCost: 1,
    usable: [],
    modes: [
      { level: "basic", discipline: "dom", effects: [{ kind: "actionBleed", bonus: 2 }] },
      {
        level: "superior",
        discipline: "dom",
        effects: [
          { kind: "actionBleed", bonus: 2 },
          { kind: "bloodOnBleedSuccess", amount: 2, scope: "anywhere", youngerOnly: true },
        ],
      },
    ],
  },
  {
    krcgId: 100601,
    name: "Earth Meld",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "pro", effects: [{ kind: "strikeCombatEnds", unlockSelf: false }] },
      { level: "superior", discipline: "pro", effects: [{ kind: "strikeCombatEnds", unlockSelf: true }] },
    ],
  },
  {
    krcgId: 100973,
    name: "Indomitability",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "for", effects: [{ kind: "prevent", base: 1, perBloodX: false }] },
      {
        level: "superior",
        discipline: "for",
        variant: "press",
        effects: [{ kind: "press", continueOnly: false }],
      },
      {
        level: "superior",
        discipline: "for",
        variant: "prevent-press",
        effects: [
          { kind: "prevent", base: 1, perBloodX: false },
          { kind: "grantPress" },
        ],
      },
    ],
  },
  {
    krcgId: 100744,
    name: "Flash",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "cel", variant: "maneuver", effects: [{ kind: "maneuver" }] },
      {
        level: "basic",
        discipline: "cel",
        variant: "press",
        effects: [{ kind: "press", continueOnly: false }],
      },
      {
        level: "superior",
        discipline: "cel",
        effects: [{ kind: "maneuver" }, { kind: "grantPress" }],
      },
    ],
  },
  {
    krcgId: 100845,
    name: "Govern the Unaligned",
    cardType: "action",
    bloodCost: 1,
    usable: [],
    modes: [
      { level: "basic", discipline: "dom", effects: [{ kind: "actionBleed", bonus: 2 }] },
      {
        level: "superior",
        discipline: "dom",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "addUncontrolledBlood", amount: 3, youngerOnly: true },
        ],
      },
    ],
  },
  {
    krcgId: 100999,
    name: "Intimidation",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "pre", effects: [{ kind: "actionBleed", bonus: 1 }] },
      { level: "superior", discipline: "pre", effects: [{ kind: "actionBleed", bonus: 2 }] },
    ],
  },
  {
    krcgId: 100640,
    name: "Enchant Kindred",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "pre", effects: [{ kind: "actionBleed", bonus: 1 }] },
      {
        level: "superior",
        discipline: "pre",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "addUncontrolledBlood", amount: 2, youngerOnly: true },
        ],
      },
    ],
  },
  {
    krcgId: 100401,
    name: "Conditioning",
    cardType: "actionModifier",
    bloodCost: 1,
    usable: ["onlyDuringBleed"],
    modes: [
      { level: "basic", discipline: "dom", effects: [{ kind: "modifyBleed", amount: 2, limited: true }] },
      { level: "superior", discipline: "dom", effects: [{ kind: "modifyBleed", amount: 3, limited: true }] },
    ],
  },
  {
    krcgId: 100518,
    name: "Deflection",
    cardType: "reaction",
    bloodCost: 1,
    usable: ["bleedTargetsYou", "afterBlocksDeclined"],
    modes: [
      { level: "basic", discipline: "dom", effects: [{ kind: "redirectBleed", lockSelf: true }] },
      { level: "superior", discipline: "dom", effects: [{ kind: "redirectBleed", lockSelf: false }] },
    ],
  },
  {
    krcgId: 101321,
    name: "On the Qui Vive",
    cardType: "reaction",
    bloodCost: 0,
    // "Only usable by a locked minion" — allies may play it, and pay for
    // it: "if this minion is an ally, they do not unlock as normal during
    // their next unlock phase" (the one-shot half of that mechanism —
    // MinionState.skipNextUnlock; the bespoke rider is below).
    usable: ["byLockedMinion", "oncePerUnlockPhase"],
    modes: [{ level: "basic", discipline: null, effects: [{ kind: "wake" }] }],
  },
  {
    krcgId: 100644,
    name: "Enhanced Senses",
    cardType: "reaction",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "aus", effects: [{ kind: "modifyIntercept", amount: 1 }] },
      { level: "superior", discipline: "aus", effects: [{ kind: "modifyIntercept", amount: 2 }] },
    ],
  },
  {
    krcgId: 101125,
    name: "Lost in Crowds",
    cardType: "actionModifier",
    bloodCost: 0,
    // Into Thin Air clause is moot: that card is not in the V5 pool.
    usable: [],
    modes: [
      { level: "basic", discipline: "obf", effects: [{ kind: "modifyStealth", amount: 1 }] },
      { level: "superior", discipline: "obf", effects: [{ kind: "modifyStealth", amount: 2 }] },
    ],
  },
  // --- One-shot masters (masters gate) ---
  {
    krcgId: 101225,
    name: "Misdirection",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [{ kind: "lockMinion" }] }],
  },
  {
    krcgId: 101104,
    name: "Life in the City",
    cardType: "master",
    bloodCost: 0,
    trifle: true,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        // Any ready vampire, even another Methuselah's (ruling p. 48).
        effects: [{ kind: "addBloodToReadyVampire", amount: 1 }],
      },
    ],
  },
  {
    // "Add 3 blood to a titled Sabbat vampire in your uncontrolled region."
    krcgId: 102345,
    name: "Unholy Sacrament",
    cardType: "master",
    bloodCost: 0,
    poolCost: 3,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "addUncontrolledBlood", amount: 3, youngerOnly: false, sect: "sabbat", titledOnly: true }],
      },
    ],
  },
  {
    krcgId: 101217,
    name: "Minion Tap",
    cardType: "master",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: null, effects: [{ kind: "moveOwnVampireBloodToPool" }] },
    ],
  },
  // --- Permanents (spec-shaped: pure statics) ---
  {
    krcgId: 100620,
    name: "Elder Library",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    permanent: { where: "seat", statics: { handSize: 1 }, tags: ["location"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 100984,
    name: "Information Highway",
    cardType: "master",
    bloodCost: 0,
    unique: true,
    permanent: { where: "seat", statics: { transfers: 2 }, tags: ["location"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 101856,
    name: "Sport Bike",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 1,
    permanent: { where: "bearer", statics: { intercept: 1 }, tags: ["vehicle"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  // --- Retainers (allies/retainers gate, docs/allies-retainers-design.md;
  //     the per-card tail is docs/retainer-wave-design.md) ---
  {
    // "Unique mortal with 3 life. Requires an Anarch. If this Anarch is
    // blocked, they can burn 1 life from this retainer before block
    // resolution to lock the blocking minion and continue the action as
    // if unblocked. This retainer inflicts 1R damage on the opposing
    // minion each round of combat during normal strike resolution."
    krcgId: 100476,
    name: "Crypt's Sons",
    cardType: "retainer",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    requiresSect: ["anarch"],
    permanent: {
      where: "bearer",
      statics: { combatRoundDamage: { amount: 1, ranged: true } },
      tags: ["mortal"],
      retainerAbilities: { breakBlock: { life: 1 } },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, retainerLife: 3, effects: [] }],
  },
  {
    // "Animal with 1 life. [ani] While the employer is in combat, the
    // opposing minion's controller plays with an open hand. [ANI] As
    // above, but Owl Companion has 2 life."
    krcgId: 101340,
    name: "Owl Companion",
    cardType: "retainer",
    bloodCost: 0,
    permanent: {
      where: "bearer",
      statics: { revealsOpposingHand: true },
      tags: ["animal"],
    },
    usable: [],
    modes: [
      { level: "basic", discipline: "ani", retainerLife: 1, effects: [] },
      { level: "superior", discipline: "ani", retainerLife: 2, effects: [] },
    ],
  },
  {
    // "Animal with 1 life. [ani] The employer gets +1 intercept. [ANI] As
    // above, and while the employer is in combat, the opposing minion's
    // controller gets -1 hand size."
    krcgId: 101545,
    name: "Raptor",
    cardType: "retainer",
    bloodCost: 2,
    permanent: { where: "bearer", statics: { intercept: 1 }, tags: ["animal"] },
    usable: [],
    modes: [
      { level: "basic", discipline: "ani", retainerLife: 1, effects: [] },
      {
        level: "superior",
        discipline: "ani",
        retainerLife: 1,
        statics: { intercept: 1, opposingHandSizePenalty: 1 },
        effects: [],
      },
    ],
  },
  {
    // "Animal with 1 life. [ani] If the action to employ this retainer is
    // successful, unlock this vampire during the next discard phase. You
    // can lock this retainer to give the employer +1 intercept. [ANI] As
    // above, but unlock this vampire after resolution of this action
    // instead."
    krcgId: 102249,
    name: "Feral Hound",
    cardType: "retainer",
    bloodCost: 0,
    requiresClan: ["Ravnos"],
    permanent: {
      where: "bearer",
      statics: { unlockEmployerAt: "discardPhase" },
      tags: ["animal"],
      retainerAbilities: { lockForIntercept: 1, unlockEmployer: true },
    },
    usable: [],
    modes: [
      { level: "basic", discipline: "ani", retainerLife: 1, effects: [] },
      {
        level: "superior",
        discipline: "ani",
        retainerLife: 1,
        // The superior's unlock is IMMEDIATE; the basic's delay to the
        // discard phase is a real drawback, not flavour (§3).
        statics: { unlockEmployerAt: "afterResolution" },
        effects: [],
      },
    ],
  },
  {
    // "Ghoul with 2 life. The employer can burn this retainer to reduce
    // the cost of a ghoul ally requiring a Tzimisce they recruit by 2
    // blood or pool."
    krcgId: 102360,
    name: "Szlachta Assistant",
    cardType: "retainer",
    bloodCost: 0,
    requiresClan: ["Tzimisce"],
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["ghoul"],
      retainerAbilities: {
        burnForDiscount: {
          amount: -2,
          mod: {
            amount: -2,
            pays: "bloodOrPool",
            cardTypes: ["ally"],
            requiresClan: ["Tzimisce"],
            tags: ["ghoul"],
            once: true,
            controllerOnly: true,
          },
        },
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, retainerLife: 2, effects: [] }],
  },
  {
    // "Ghoul with 2 life. The employer can lock this retainer to prevent
    // 1 damage in combat. You can burn this retainer to have an action
    // directed at a minion you control fail."
    krcgId: 102361,
    name: "Szlachta Bodyguard",
    cardType: "retainer",
    bloodCost: 1,
    requiresClan: ["Tzimisce"],
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["ghoul"],
      retainerAbilities: { lockToPrevent: 1, burnToFailAction: true },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, retainerLife: 2, effects: [] }],
  },
  {
    krcgId: 101628,
    name: "Revenant",
    cardType: "retainer",
    bloodCost: 1,
    permanent: { where: "bearer", statics: { intercept: 1 }, tags: ["ghoul"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, retainerLife: 2, effects: [] }],
  },
  {
    krcgId: 101249,
    name: "Mr. Winthrop",
    cardType: "retainer",
    bloodCost: 0,
    unique: true,
    permanent: { where: "bearer", statics: { intercept: 1 }, tags: ["mortal"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, retainerLife: 1, effects: [] }],
  },
  {
    krcgId: 101550,
    name: "Raven Spy",
    cardType: "retainer",
    bloodCost: 1,
    permanent: { where: "bearer", statics: { intercept: 1 }, tags: ["animal"] },
    usable: [],
    modes: [
      { level: "basic", discipline: "ani", retainerLife: 1, effects: [] },
      { level: "superior", discipline: "ani", retainerLife: 2, effects: [] },
    ],
  },
  {
    krcgId: 101254,
    name: "Murder of Crows",
    cardType: "retainer",
    bloodCost: 1,
    // "1R damage each round during normal strike resolution" —
    // environmental, works at any range (p. 31).
    permanent: {
      where: "bearer",
      statics: { combatRoundDamage: { amount: 1, ranged: true } },
      tags: ["animal"],
    },
    usable: [],
    modes: [
      { level: "basic", discipline: "ani", retainerLife: 1, effects: [] },
      { level: "superior", discipline: "ani", retainerLife: 2, effects: [] },
    ],
  },
  {
    krcgId: 102317,
    name: "Dread Mastiff",
    cardType: "retainer",
    bloodCost: 1,
    // Close range only (no "R" in its damage text).
    permanent: {
      where: "bearer",
      statics: { combatRoundDamage: { amount: 1, ranged: false } },
      tags: ["animal"],
    },
    usable: [],
    modes: [
      { level: "basic", discipline: "ani", retainerLife: 2, effects: [] },
      {
        level: "superior",
        discipline: "ani",
        retainerLife: 2,
        statics: { pressPerCombat: 1 },
        effects: [],
      },
    ],
  },
  {
    krcgId: 100568,
    name: "Dog Pack",
    cardType: "retainer",
    bloodCost: 0,
    poolCost: 2,
    permanent: {
      where: "bearer",
      statics: { opposingCannotCombatEnds: true },
      tags: ["animal"],
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, retainerLife: 1, effects: [] }],
  },
  // --- Allies ---
  {
    krcgId: 101411,
    name: "Political Ally",
    cardType: "ally",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    ally: { life: 1, strength: 0, bleed: 3 },
    permanent: { where: "bearer", statics: {}, tags: ["mortal"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 102220,
    name: "Double Deuce",
    cardType: "ally",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    ally: { life: 3, strength: 1, bleed: 1 },
    // "+1 stealth" is a static on his own actions; the unlock-phase life
    // regen is a bespoke hook (see doubleDeuce below).
    permanent: { where: "bearer", statics: { stealth: 1 }, tags: ["werewolf"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 102217,
    name: "47th Street Royals",
    cardType: "ally",
    bloodCost: 0,
    unique: true,
    ally: { life: 2, strength: 1, bleed: 0 },
    permanent: { where: "bearer", statics: {}, tags: ["mortal"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 100932,
    name: "Homunculus",
    cardType: "retainer",
    bloodCost: 0,
    permanent: { where: "bearer", statics: {}, tags: [] },
    usable: [],
    modes: [
      { level: "basic", discipline: "pro", retainerLife: 1, effects: [] },
      { level: "superior", discipline: "pro", retainerLife: 2, effects: [] },
    ],
  },
  // --- Rush actions (docs/rush-actions-design.md) ---
  {
    krcgId: 102306,
    name: "Umbrous Clutch",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "obl",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "actionEnterCombat", targets: "minion" },
        ],
      },
      {
        level: "superior",
        discipline: "obl",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "actionEnterCombat", targets: "minion", riders: { maneuver: 1 } },
        ],
      },
    ],
  },
  {
    krcgId: 100747,
    name: "Fleetness",
    cardType: "action",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "cel",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "actionBleed", bonus: 0 },
        ],
      },
      {
        level: "superior",
        discipline: "cel",
        effects: [
          { kind: "actionStealth", amount: 1 },
          {
            kind: "actionEnterCombat",
            targets: "minion",
            lockedOnly: true,
            riders: { maneuver: 1 },
          },
        ],
      },
    ],
  },
  {
    krcgId: 102344,
    name: "Twisted Bloodhound",
    cardType: "retainer",
    bloodCost: 0,
    poolCost: 1,
    rush: { targets: "minion" },
    permanent: { where: "bearer", statics: {}, tags: ["ghoul"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, retainerLife: 3, effects: [] }],
  },
  {
    krcgId: 102286,
    name: "Aggressive Corpse",
    cardType: "ally",
    bloodCost: 2,
    ally: { life: 3, strength: 2, bleed: 0 },
    rush: { targets: "minion" },
    // All four clauses are live as of 2026-09-03. The three below were
    // written off as "moot for now" when this card shipped — and the note
    // went stale without anyone re-reading it, which is precisely the rot
    // docs/partial-support.md exists to prevent. The audit found it:
    //   - "cannot be the target of directed actions requiring [dom]/[pre]"
    //     was REACHABLE — Entrancement superior ([PRE]) steals an ally,
    //     and this is an ally, so it could be stolen by a card that says
    //     it cannot be;
    //   - `undodgeable` has existed since the last-combat wave (Dust Up);
    //   - `cannotGainLife` has existed since the wraith/zombie wave and
    //     Rotting Behemoth already uses it.
    // docs/library-audit.md §2
    permanent: {
      where: "bearer",
      statics: {
        untargetableByDisciplines: ["dom", "pre"],
        strikesUndodgeable: true,
        cannotGainLife: true,
      },
      tags: ["zombie"],
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    krcgId: 102324,
    name: "Freakish Conglomeration",
    cardType: "ally",
    bloodCost: 2,
    ally: { life: 3, strength: 3, bleed: 1 },
    rush: { targets: "minion" },
    permanent: { where: "bearer", statics: {}, tags: ["zombie"] },
    usable: [],
    modes: [
      { level: "basic", discipline: ["obl", "tha"], effects: [] },
      { level: "superior", discipline: ["obl", "tha"], ally: { life: 4 }, effects: [] },
    ],
  },
  {
    krcgId: 102144,
    name: "War Ghoul",
    cardType: "ally",
    bloodCost: 0,
    poolCost: 3,
    ally: { life: 5, strength: 4, bleed: 0 },
    rush: { targets: "vampire" },
    permanent: { where: "bearer", statics: {}, tags: ["ghoul"] },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  // --- The Vozhd (docs/vozhd-allies-design.md). Four printings of one
  //     card: a unique 5-life Tzimisce ghoul that eats one of your own
  //     minions on arrival, rushes as a Ⓓ action, and has one clause of
  //     its own.
  {
    // "Unique ghoul with 5 life. 3 strength, 0 bleed. After this ally
    // enters play, burn an ally or retainer you control. It can strike: 3R
    // damage. It can enter combat with a minion as a Ⓓ action. During your
    // unlock phase, you can discard an ally or retainer card to add 2 life
    // to this ally."
    krcgId: 102267,
    name: "The Vozhd of Sofia",
    cardType: "ally",
    bloodCost: 0,
    poolCost: 3,
    unique: true,
    ally: {
      life: 5,
      strength: 3,
      bleed: 0,
      enterPlayBurn: { kinds: ["ally", "retainer"] },
      strike: { damage: 3, ranged: true },
    },
    rush: { targets: "minion" },
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["ghoul"],
      allyAbilities: {
        unlockDiscardForLife: { life: 2, cardTypes: ["ally", "retainer"] },
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique ghoul with 5 life. 4 strength, 0 bleed. After this ally
    // enters play, burn an ally or retainer you control. This ally can
    // enter combat with a vampire as a Ⓓ action. This ally can prevent 1
    // damage each round of combat. During combat, this ally can burn 1
    // life to cancel a strike card as it is played by the opposing minion,
    // and its cost is not paid (the minion chooses a strike again)."
    krcgId: 102363,
    name: "The Vozhd of Gravesend",
    cardType: "ally",
    bloodCost: 0,
    poolCost: 4,
    unique: true,
    ally: { life: 5, strength: 4, bleed: 0, enterPlayBurn: { kinds: ["ally", "retainer"] } },
    rush: { targets: "vampire" },
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["ghoul"],
      allyAbilities: {
        preventPerRound: 1,
        cancelOpposingStrikeCard: { life: 1 },
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "…This ally can play cards requiring basic Animalism [ani] as a
    // vampire with capacity 5. During your unlock phase, this ally can
    // steal any amount of blood (becoming life) from a Tzimisce you
    // control, not to exceed its starting life."
    //
    // The "as a vampire" half is p. 11's Advanced Rules, and closes the
    // deferral CLAUDE.md carried since the allies/retainers wave: the
    // enumerators pick their player with `disciplinesOf`, never `kind`.
    // Its "capacity 5" coincides with its starting life, which is the
    // number `capacityOf` already returns (docs/vozhd-allies-design.md §3).
    krcgId: 102364,
    name: "The Vozhd of Juiz de Fora",
    cardType: "ally",
    bloodCost: 0,
    poolCost: 3,
    unique: true,
    ally: {
      life: 5,
      strength: 4,
      bleed: 0,
      enterPlayBurn: { kinds: ["ally", "retainer"] },
      playsAsVampire: { ani: "basic" },
    },
    rush: { targets: "vampire" },
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["ghoul"],
      allyAbilities: { unlockSiphon: { clan: "Tzimisce", capped: true } },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "…Once each combat, this ally can discard a card requiring Protean
    // [pro] to prevent 2 damage. During any other Methuselah's minion
    // phase, a Tzimisce you control can burn 1 blood to unlock this ally."
    krcgId: 102365,
    name: "The Vozhd of Szczecin",
    cardType: "ally",
    bloodCost: 0,
    poolCost: 4,
    unique: true,
    ally: { life: 5, strength: 4, bleed: 0, enterPlayBurn: { kinds: ["ally", "retainer"] } },
    rush: { targets: "vampire" },
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["ghoul"],
      allyAbilities: {
        preventByDiscard: { amount: 2, requiresDiscipline: ["pro"] },
        foreignPhaseUnlock: { clan: "Tzimisce", blood: 1 },
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique mortal with 2 life. 0 strength, 0 bleed. Vagabond Mystic can
    // lock to add 1 life to an ally you control who has fewer life than
    // its starting life. Vagabond Mystic cannot block vampires."
    krcgId: 102087,
    name: "Vagabond Mystic",
    cardType: "ally",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    ally: { life: 2, strength: 0, bleed: 0 },
    permanent: {
      where: "bearer",
      // One direction only: it may still block an ALLY, and may still be
      // blocked by anything (docs/cheap-tail-design.md §2).
      statics: { cannotBlockKind: "vampire" },
      tags: ["mortal"],
      allyAbilities: { lockToHealAlly: { life: 1 } },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Animal with 1 life. 0 strength, 0 bleed. [ani] This ally can burn 1
    // life to give a minion you control 1 press. During an action directed
    // at you (or a card you control), you can burn this ally if it is not
    // blocking to unlock a ready minion you control. [ANI] As above, but
    // this ally has 2 life and 1 strength."
    krcgId: 102065,
    name: "Underbridge Stray",
    cardType: "ally",
    bloodCost: 1,
    poolCost: 0,
    ally: { life: 1, strength: 0, bleed: 0 },
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["animal"],
      allyAbilities: { burnLifeForPress: { life: 1 }, burnToUnlock: true },
    },
    usable: [],
    modes: [
      { level: "basic", discipline: "ani", effects: [] },
      { level: "superior", discipline: "ani", ally: { life: 2, strength: 1 }, effects: [] },
    ],
  },
  {
    // "Mortal with 2 life. 0 strength, 0 bleed. This ally can strike: 1R
    // damage. This ally gets 1 optional maneuver each combat. This ally can
    // lock to give a Ravnos you control +1 stealth."
    krcgId: 102234,
    name: "City Star Taxi",
    cardType: "ally",
    bloodCost: 0,
    poolCost: 3,
    ally: { life: 2, strength: 0, bleed: 0, strike: { damage: 1, ranged: true } },
    permanent: {
      where: "bearer",
      statics: { maneuverPerCombat: 1 },
      tags: ["mortal"],
      // "Lock to give a Ravnos you control +1 stealth" — `lockGrant`'s
      // clause, but that one is compiled inside the MASTER compiler and
      // never reaches an ally (docs/vozhd-allies-design.md §4).
      allyAbilities: { lockForStealth: { amount: 1, clan: "Ravnos" } },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  // --- The crypt and the uncontrolled region
  //     (docs/crypt-and-uncontrolled-design.md). The last five buildable
  //     Masters; the other five are Path- or zombie-BLOCKED.
  {
    // "Unique location. You can lock this card and burn 1 pool or 1 blood
    // from a ready Tremere you control during your master phase to move a
    // Tremere from torpor to their controller's ready region."
    krcgId: 100329,
    name: "Chantry",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      torporRescue: { clan: "Tremere" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Move up to 3 blood from a ready vampire you control to a younger
    // vampire of the same clan in your uncontrolled region."
    //
    // A ONE-SHOT master with no `permanent` block: it does its work as it
    // resolves and goes to the ash heap. Giving it a card in play to hang
    // an ability off would over-serve it — the effect would recur every
    // master phase (§3).
    krcgId: 100860,
    name: "Grooming the Protégé",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "bloodToUncontrolledKin", max: 3 }],
      },
    ],
  },
  {
    // "Trifle. Put this card in play. You can use 1 transfer to draw 1
    // card from your crypt and then remove a crypt card in your
    // uncontrolled region from the game. You can use 4 transfers to burn
    // this card and gain 2 pool."
    krcgId: 102180,
    name: "Wider View",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    trifle: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Wider View"],
      transferAbilities: {
        cryptDraw: { transfers: 1 },
        cashOut: { transfers: 4, gainPool: 2 },
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Trifle. Reveal the top card of your crypt. If it is a Hecata, draw
    // it and add 1 blood to it; otherwise, move it to the bottom of your
    // crypt." An instruction, not a choice (§1).
    krcgId: 102289,
    name: "Family Gathering",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    trifle: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Family Gathering"],
      cryptPeek: { clan: "Hecata", blood: 1 },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. Requires a ready Sabbat vampire. If a political
    // action is successful, before the referendum, you can lock this
    // location and a ready unlocked Sabbat vampire you control to have
    // that vampire enter combat with the acting vampire. If the acting
    // vampire is still ready at the end of combat, the Sabbat vampire
    // takes 2 environmental damage and the referendum is conducted as
    // normal."
    krcgId: 102199,
    name: "Yawp Court",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    requiresControlledSect: ["sabbat"],
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      preReferendumAmbush: { sect: "sabbat", damageIfTargetReady: 2 },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  // --- Cards in play that change what OTHERS may do to you
  //     (docs/opposing-statics-design.md).
  {
    // "Vehicle. This Anarch gets +1 bleed. Allies and younger vampires
    // get -1 intercept against this Anarch. Vampires can burn this card
    // as a Ⓓ action that costs 1 pool; if that action is successful, this
    // Anarch is locked and does not unlock as normal during their next
    // unlock phase. A minion can have only one vehicle."
    //
    // Its middle clause was the ledger's named blocker for two waves;
    // Perfect Paragon prints the same sentence action-scoped, and both
    // now read one filter (§1).
    krcgId: 101872,
    name: "Stolen Police Cruiser",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 0,
    requiresSect: ["anarch"],
    permanent: {
      where: "bearer",
      statics: {
        bleed: 1,
        opposingInterceptPenalty: { amount: 1, kinds: ["ally"], younger: true },
      },
      tags: ["vehicle"],
      vulnerableTo: {
        who: { kind: "vampire" },
        cost: { pool: 1 },
        bearerPenalty: { lock: true, skipNextUnlock: true },
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "[pre] Only usable during the polling step of a political action.
    // This vampire gets +3 votes. [PRE] Allies and younger vampires get
    // -1 intercept."
    //
    // The superior does NOT say "as above": it is a different effect in a
    // different window, which is exactly the POLLING_ONLY_EFFECTS split.
    krcgId: 101387,
    name: "Perfect Paragon",
    cardType: "actionModifier",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "pre",
        effects: [{ kind: "modifyVotes", amount: 3 }],
      },
      {
        level: "superior",
        discipline: "pre",
        effects: [
          { kind: "modifyFilteredIntercept", amount: -1, kinds: ["ally"], younger: true },
        ],
      },
    ],
  },
  {
    // "Put this card in play. During a bleed action, an Assamite you
    // control can discard a combat card to get +1 bleed."
    //
    // "Assamite" is the LEGACY name: the registry and the phase-7 crypt
    // importer both say Banu Haqim, and filtering on the printed word
    // would match nothing (the Priority Contract trap).
    krcgId: 102226,
    name: "Haqim's Law: Retribution",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Haqim's Law: Retribution"],
      discardForBleed: { amount: 1, clan: "Banu Haqim", cardTypes: ["combat"] },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Requires a prince or justicar. Choose a Camarilla vampire.
    // Successful referendum means this card is put on the chosen vampire.
    // The attached vampire can enter combat with a vampire as a +1
    // stealth Ⓓ action. Vampires attempting to block the attached vampire
    // burn 1 blood. Blood hunts cannot be called on the attached vampire.
    // Camarilla vampires can call a referendum to burn this card as a +1
    // stealth political action."
    krcgId: 100084,
    name: "Archon",
    cardType: "politicalAction",
    bloodCost: 0,
    requiresTitle: ["prince", "justicar"],
    permanent: {
      where: "bearer",
      statics: {
        blockToll: { amount: 1, payWith: "blood" },
        noBloodHunt: true,
      },
      tags: ["Archon"],
      rushGrant: {
        who: { scope: "bearer" },
        target: { scope: "any", kind: "vampire" },
        stealth: 1,
      },
      vulnerableTo: {
        who: { kind: "vampire", sect: "camarilla" },
        stealth: 1,
        via: "politicalAction",
      },
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "refAttachToChosen", who: { sect: "camarilla" } }],
      },
    ],
  },
  {
    // "Successful referendum means this card is put in play. While your
    // prey controls a vampire in torpor, vampires you control get +1
    // bleed. Vampires can call a referendum to burn this card as a +1
    // stealth political action. A Methuselah can have only one Raising
    // the Portcullis."
    krcgId: 102303,
    name: "Raising the Portcullis",
    cardType: "politicalAction",
    bloodCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Raising the Portcullis"],
      aura: { scope: "controller", bleed: 1, whilePreyHasTorporVampire: true },
      vulnerableTo: { who: { kind: "vampire" }, stealth: 1, via: "politicalAction" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [{ kind: "refPutInPlay" }] }],
  },
  // --- Political actions (docs/politics-design.md); the per-card tail is
  //     docs/referendum-terms-design.md ---
  {
    // "Requires an Anarch. Successful referendum means each ready Anarch
    // gains 1 blood and each Methuselah controlling an Anarch gains 1
    // pool." No terms — and the two halves count different things.
    krcgId: 100056,
    name: "Anarch Salon",
    cardType: "politicalAction",
    bloodCost: 0,
    requiresSect: ["anarch"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "refSectPayout", sect: "anarch", blood: 1, poolPerController: 1 },
        ],
      },
    ],
  },
  {
    // "Boon. Choose a clan. Successful referendum means each Methuselah
    // gains 1 pool for each vampire of the chosen clan they control."
    // p. 49: "You must choose an EXISTING clan, even if no vampires of
    // the chosen clan are in play" — so the terms are the pool's clans.
    krcgId: 100410,
    name: "Consanguineous Boon",
    cardType: "politicalAction",
    bloodCost: 0,
    keywords: ["boon"],
    usable: [],
    modes: [
      { level: "basic", discipline: null, effects: [{ kind: "refClanBoon", poolPerVampire: 1 }] },
    ],
  },
  {
    // "Requires a titled Sabbat vampire. Choose a Methuselah or a
    // location. If this acting vampire is a cardinal or regent, you can
    // choose both instead. Successful referendum means the chosen
    // Methuselah burns 3 pool and the chosen location is burned."
    krcgId: 102312,
    name: "Cold War",
    cardType: "politicalAction",
    bloodCost: 0,
    requiresSect: ["sabbat"],
    requiresTitled: true,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          {
            kind: "refBurnSeatOrLocation",
            poolBurn: 3,
            bothIfTitle: ["cardinal", "regent"],
          },
        ],
      },
    ],
  },
  {
    // "Choose a location and a Methuselah. Successful referendum means
    // the chosen Methuselah takes control of the chosen location."
    krcgId: 100557,
    name: "Disputed Territory",
    cardType: "politicalAction",
    bloodCost: 0,
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [{ kind: "refMoveLocation" }] }],
  },
  {
    // "Requires a titled Camarilla vampire. Choose a Methuselah and
    // allocate 5 points among two or more other Methuselahs. Successful
    // referendum means each Methuselah burns 1 pool for each point
    // allocated and the chosen Methuselah gains 1 pool."
    krcgId: 102270,
    name: "Camarilla's Iron Fist",
    cardType: "politicalAction",
    bloodCost: 1,
    requiresSect: ["camarilla"],
    requiresTitled: true,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          {
            kind: "refAllocateBurn",
            points: 5,
            minTargets: 2,
            beneficiary: { gainPool: 1 },
          },
        ],
      },
    ],
  },
  {
    krcgId: 101056,
    name: "Kine Resources Contested",
    cardType: "politicalAction",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "refAllocateBurn", points: 4, minTargets: 2 }],
      },
    ],
  },
  {
    krcgId: 100414,
    name: "Conservative Agitation",
    cardType: "politicalAction",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "refAllocateBurn", points: "numSeats", minTargets: 2 }],
      },
    ],
  },
  {
    krcgId: 100059,
    name: "Anarchist Uprising",
    cardType: "politicalAction",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "refBurnPerMinion", lockedOnly: false }],
      },
    ],
  },
  {
    krcgId: 100065,
    name: "Ancilla Empowerment",
    cardType: "politicalAction",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "refBurnPerMinion", lockedOnly: false }],
      },
    ],
  },
  {
    krcgId: 100570,
    name: "Domain Challenge",
    cardType: "politicalAction",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "refBurnPerMinion", lockedOnly: true }],
      },
    ],
  },
  {
    krcgId: 101271,
    name: "Neonate Breach",
    cardType: "politicalAction",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "refChooseSeatsBurn", base: 1, capBonus: { atMost: 4, extra: 3 } },
        ],
      },
    ],
  },
  {
    krcgId: 101353,
    name: "Parity Shift",
    cardType: "politicalAction",
    bloodCost: 0,
    requiresTitle: ["prince", "justicar"],
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }], // bespoke terms
  },
  {
    krcgId: 100131,
    name: "Banishment",
    cardType: "politicalAction",
    bloodCost: 0,
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }], // bespoke terms
  },
  {
    krcgId: 101154,
    name: "Malkavian Justicar",
    cardType: "politicalAction",
    bloodCost: 0,
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }], // bespoke title grant
  },
  {
    krcgId: 101990,
    name: "Toreador Justicar",
    cardType: "politicalAction",
    bloodCost: 0,
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }], // bespoke title grant
  },
  {
    krcgId: 100294,
    name: "Cardinal Benediction",
    cardType: "politicalAction",
    bloodCost: 0,
    requiresSect: ["sabbat"],
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }], // bespoke title grant
  },

  // --- Answering a bleed: redirect it, or shrink it ---
  // docs/bleed-answers-design.md
  {
    // "[dom] Only usable if a younger vampire is bleeding you, after
    //  blocks are declined. Lock this reacting vampire. Change the target
    //  of the bleed to another Methuselah other than the acting vampire's
    //  controller (that Methuselah can attempt to block).
    //  [DOM] As above, but the acting vampire can be the same age or
    //  older."
    krcgId: 101578,
    name: "Redirection",
    cardType: "reaction",
    bloodCost: 0,
    usable: ["bleedTargetsYou", "afterBlocksDeclined"],
    modes: [
      {
        level: "basic",
        discipline: "dom",
        effects: [{ kind: "redirectBleed", lockSelf: true, youngerOnly: true }],
      },
      {
        level: "superior",
        discipline: "dom",
        effects: [{ kind: "redirectBleed", lockSelf: true }],
      },
    ],
  },
  {
    // "Requires a baron. Only usable if a minion is bleeding you, after
    //  blocks are declined. Lock this reacting vampire. Change the target
    //  of the bleed to another Methuselah other than the acting minion's
    //  controller (that Methuselah can attempt to block)."
    krcgId: 102218,
    name: "Bait and Switch",
    cardType: "reaction",
    bloodCost: 0,
    requiresTitle: ["baron"],
    usable: ["bleedTargetsYou", "afterBlocksDeclined"],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "redirectBleed", lockSelf: true }],
      },
    ],
  },
  {
    // "Requires an Anarch.
    //  [ani] Only usable during an action directed at you (or a card you
    //  control). +2 intercept.
    //  [for] Reduce a bleed against you by 2.
    //  [pro] Only usable by a locked vampire. This vampire burns 1 blood
    //  to unlock."
    krcgId: 102219,
    name: "Deep Ecology",
    cardType: "reaction",
    bloodCost: 0,
    requiresSect: ["anarch"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "ani",
        variant: "intercept",
        usable: ["actionDirectedAtYou"],
        effects: [{ kind: "modifyIntercept", amount: 2 }],
      },
      {
        level: "basic",
        discipline: "for",
        variant: "reduce",
        usable: ["bleedTargetsYou"],
        // A reduction, not a bonus: not "(limited)" (design §3).
        effects: [{ kind: "modifyBleed", amount: -2, limited: false }],
      },
      {
        level: "basic",
        discipline: "pro",
        variant: "unlock",
        usable: ["byLockedMinion"],
        effects: [{ kind: "unlockMinion", bloodCost: 1 }],
      },
    ],
  },
  {
    // "[obf][pre] Reduce a bleed against you by 3.
    //  [OBF][PRE] Lock this vampire to reduce a bleed against you to 0.
    //  (The acting minion can still increase the bleed amount.)"
    krcgId: 102265,
    name: "Visions of Zapathasura",
    cardType: "reaction",
    bloodCost: 1,
    usable: ["bleedTargetsYou"],
    modes: [
      {
        level: "basic",
        discipline: { all: ["obf", "pre"] },
        effects: [{ kind: "modifyBleed", amount: -3, limited: false }],
      },
      {
        level: "superior",
        discipline: { all: ["obf", "pre"] },
        effects: [{ kind: "setBleedZero", lockSelf: true }],
      },
    ],
  },

  // --- "Ⓓ Put this card on a minion": actions that become permanents ---
  // docs/action-attachments-design.md
  {
    // "+3 stealth action.
    //  [pot] Put this card on this vampire. This vampire gets +1 strength.
    //  This vampire can strike: burn equipment. Burn this card if this
    //  vampire is in torpor. A vampire can have only one Heroic Might.
    //  [POT] As above, with an additional +1 strength, and this vampire
    //  can strike: 2R damage."
    // WHOLE as of 2026-09-03. The [POT] "strike: 2R damage" is a SECOND
    // granted strike on one card, which is why it waited: the grant was a
    // boolean. Both now live in the same `combat.chooseStrike` ability
    // block and are told apart by the verb in the option id — the
    // granted-action merge shape (docs/ledger-closeout.md §8).
    krcgId: 100913,
    name: "Heroic Might",
    cardType: "action",
    bloodCost: 3,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "pot",
        effects: [
          { kind: "actionStealth", amount: 3 },
          {
            kind: "attachSelf",
            strength: 1,
            burnWhenBearerLeavesReady: true,
            grantsBurnEquipmentStrike: true,
          },
        ],
      },
      {
        level: "superior",
        discipline: "pot",
        effects: [
          { kind: "actionStealth", amount: 3 },
          {
            kind: "attachSelf",
            strength: 2,
            burnWhenBearerLeavesReady: true,
            grantsBurnEquipmentStrike: true,
            grantsRangedDamageStrike: 2,
          },
        ],
      },
    ],
  },
  {
    // "+1 stealth action. Unique. Not usable if any non-mandatory actions
    //  have been performed this turn. Put this card on this Assamite and
    //  unlock them. This Assamite gets +1 bleed. If your prey is ousted,
    //  you gain 4 additional pool. Burn this card during your unlock
    //  phase."
    krcgId: 101043,
    name: "Khabar: Glory",
    cardType: "action",
    bloodCost: 0,
    unique: true,
    // The card PRINTS "Assamite"; the registry clan is Banu Haqim, which
    // is what an imported vampire carries (the Priority Contract trap).
    requiresClan: ["Banu Haqim"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          {
            kind: "attachSelf",
            bleed: 1,
            unlockActor: true,
            burnAtControllerUnlock: true,
            poolWhenPreyOusted: 4,
          },
        ],
      },
    ],
  },
  {
    // "+1 stealth action.
    //  [tha] Put this card on this vampire, locked; this vampire takes 1
    //  unpreventable environmental aggravated damage. During your minion
    //  phase, this vampire can lock this card to unlock. A vampire can
    //  have only one Rutor's Hand.
    //  [THA] As above, and this vampire can burn 3 blood to be immune to
    //  this aggravated damage."
    // WHOLE as of 2026-09-03. The superior's opt-out waited because the
    // damage is queued on the action frame and applied after resolution,
    // while a ChoiceFrame raised during resolution only QUEUES — so the
    // obvious build asked the question after the damage had already
    // landed. The offer now rides ON the damage item, and the engine's
    // damage loop raises the frame INSTEAD of inflicting
    // (docs/ledger-closeout.md §10).
    krcgId: 101664,
    name: "Rutor's Hand",
    cardType: "action",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "tha",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "attachSelf", locked: true },
          { kind: "lockCardToUnlockBearer" },
          { kind: "selfDamageAfterAction", amount: 1, aggravated: true },
        ],
      },
      {
        level: "superior",
        discipline: "tha",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "attachSelf", locked: true },
          { kind: "lockCardToUnlockBearer" },
          { kind: "selfDamageAfterAction", amount: 1, aggravated: true, optOutBlood: 3 },
        ],
      },
    ],
  },
  {
    // "[ani] Ⓓ Steal 1 blood or life from a minion controlled by your
    //  prey.
    //  [ANI] As above, and put this card on this vampire. This vampire
    //  gets +1 bleed against your prey. Minions can burn this card as a Ⓓ
    //  action. A vampire can have only one Tier of Souls."
    krcgId: 101984,
    name: "Tier of Souls",
    cardType: "action",
    bloodCost: 0,
    permanent: {
      // The entry's real statics come from `attachSelf`; this block exists
      // for the counter-play clause alone (design §5).
      where: "bearer",
      statics: {},
      tags: [],
      vulnerableTo: { stealth: 0 },
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "ani",
        effects: [{ kind: "actionStealBlood", amount: 1, from: "prey" }],
      },
      {
        level: "superior",
        discipline: "ani",
        effects: [
          { kind: "actionStealBlood", amount: 1, from: "prey" },
          { kind: "attachSelf", statics: { bleedAgainstPrey: 1 } },
        ],
      },
    ],
  },
  {
    // "+1 stealth action.
    //  [pre] Ⓓ Put this card on a minion; you still control this card. The
    //  attached minion gets -1 stealth. Minions can burn this card as a Ⓓ
    //  action.
    //  [PRE] As above, and if the attached minion is blocked, they burn 1
    //  blood or life before block resolution."
    krcgId: 102358,
    name: "Phantasmagoria",
    cardType: "action",
    bloodCost: 1,
    requiresClan: ["Ravnos"],
    permanent: {
      where: "bearer",
      statics: {},
      tags: [],
      vulnerableTo: { stealth: 0 },
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "pre",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "attachSelf", target: "anyMinion", statics: { stealth: -1 } },
        ],
      },
      {
        level: "superior",
        discipline: "pre",
        effects: [
          { kind: "actionStealth", amount: 1 },
          {
            kind: "attachSelf",
            target: "anyMinion",
            statics: {
              stealth: -1,
              blockedToll: { amount: 1, payWith: "bloodOrLife" },
            },
          },
        ],
      },
    ],
  },

  // --- Locations that buy votes ---
  // docs/politics-locations-design.md
  {
    // "Unique location. You can lock this location during the polling step
    //  of a political action to give each titled Camarilla vampire you
    //  control +1 vote."
    krcgId: 100632,
    name: "Elysium: The Palace of Versailles",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      lockGrant: {
        grant: "votes",
        amount: 1,
        sect: "camarilla",
        titled: true,
        ownOnly: true,
        perClanMinion: true,
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique. Put this card in play. Once each turn, you can burn 1 pool
    //  to get +3 votes during the polling step of any referendum."
    // The Ministry clan tag is thematic, not a requirement — the Ravnos
    // Carnival precedent: a Master has no acting minion to gate.
    krcgId: 100722,
    name: "Ferraille",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: [],
      lockGrant: {
        grant: "votes",
        amount: 3,
        poolCost: 1,
        oncePerTurn: true,
        noLock: true, // it burns pool, it does not lock
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. Titled Brujah get +1 bleed and +1 vote. Ventrue
    //  get -1 vote."
    // Neither clause says "you control", so both are GLOBAL. Two aura
    // clauses with different filters, which is why `auras` exists.
    krcgId: 101277,
    name: "New Carthage",
    cardType: "master",
    bloodCost: 0,
    poolCost: 3,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      auras: [
        { scope: "global", clan: "Brujah", titledOnly: true, bleed: 1, votes: 1 },
        { scope: "global", clan: "Ventrue", votes: -1 },
      ],
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Only one Día de los Muertos can be played in a game. The first
    //  referendum a Sabbat vampire you control calls on this turn passes
    //  automatically (skip the polling step)."
    // The uniqueness clause is a bespoke overlay (the Open War shape);
    // the effect is the primitive below.
    krcgId: 100541,
    name: "Día de los Muertos",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [{ kind: "autoPassReferendum" }] }],
  },
  {
    // "Unique location. Requires a ready Sabbat vampire. Once each turn, a
    //  Sabbat vampire can call a referendum to have their controller gain
    //  2 pool as a +1 stealth political action. Changeling allies can burn
    //  this location as a +1 stealth Ⓓ action."
    // The changeling clause is written and correctly enumerates nothing:
    // no V5 ally carries that tag (the Wall Street Night precedent).
    krcgId: 100165,
    name: "Black Forest Base",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    requiresControlledSect: ["sabbat"],
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      politicalGrant: {
        who: { sect: "sabbat" },
        stealth: 1,
        oncePerTurn: true,
        effect: { gainPool: 2 },
      },
      vulnerableTo: { who: { kind: "ally", tag: "changeling" }, stealth: 1 },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },

  // --- Hunting grounds and the other locations that feed blood ---
  // docs/blood-locations-design.md
  {
    // "Requires a ready Anarch. Unique location. Hunting ground. During
    //  your unlock phase, a ready Anarch you control can gain 1 blood,
    //  and, if you control a ready baron, another ready Anarch you control
    //  can gain 1 blood as well. A vampire can gain blood from only one
    //  hunting ground each turn."
    krcgId: 100297,
    name: "Carfax Abbey",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    requiresControlledSect: ["anarch"],
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location", "huntingGround"],
      huntingGround: {
        amount: 1,
        sect: "anarch",
        // The second grant necessarily goes to a different vampire: the
        // per-vampire hunting-ground limit is what enforces "another".
        extraIfControlsTitle: ["baron"],
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. Hunting ground. Requires a ready vampire with a
    //  city title. During your unlock phase, a ready titled vampire you
    //  control can gain 2 blood."
    // Two different tests: the requirement wants a CITY title, the grant
    // takes ANY title (design §8.2).
    krcgId: 101350,
    name: "Papillon",
    cardType: "master",
    bloodCost: 0,
    poolCost: 3,
    unique: true,
    requiresControlledTitle: CITY_TITLES,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location", "huntingGround"],
      huntingGround: { amount: 2, title: "any" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. Hunting ground. During your unlock phase, a ready
    //  Salubri you control can gain 1 blood. You can lock this card to
    //  cancel a frenzy card as it is played on a Salubri you control (cost
    //  is still paid)."
    // Closes the last half of the frenzy gate's deferral.
    krcgId: 102252,
    name: "Meditative Grove",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location", "huntingGround"],
      huntingGround: { amount: 1, clan: "Salubri" },
      frenzyCancel: { clan: "Salubri" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. You can lock this location after resolution of a
    //  successful action requiring Hecata or Oblivion [obl] to add 1 blood
    //  to a Hecata you control."
    krcgId: 102298,
    name: "Cappadocian Crypt",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      afterActionBlood: {
        amount: 1,
        clan: "Hecata",
        requiresClan: ["Hecata"],
        requiresDiscipline: ["obl"],
        successOnly: true,
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. Sabbat vampires you control get +1 hunt."
    // An aura: a trait of the minion, so it applies to every hunt they
    // make (design §8.3).
    krcgId: 100945,
    name: "The Hungry Coyote",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      aura: { scope: "controller", sect: "sabbat", hunt: 1 },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },

  // --- Rush actions and what happens after the combat ---
  // docs/rush-outcome-design.md
  {
    // "+1 stealth action. Ⓓ Enter combat with a minion. At the end of that
    //  combat, if only one combatant is ready, the controller of the
    //  opposing minion burns 1 pool."
    // Read literally: EITHER combatant being the last one standing
    // satisfies it (design §3).
    krcgId: 102309,
    name: "Abuse of Power",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          {
            kind: "actionEnterCombat",
            targets: "minion",
            outcome: {
              when: "oneCombatantReady",
              effect: { kind: "burnOpposingControllerPool", amount: 1 },
            },
          },
        ],
      },
    ],
  },
  {
    // "Ⓓ Enter combat with a vampire; at the end of that combat, if the
    //  opposing vampire is not ready, you can put this card on this acting
    //  vampire. This vampire gets +1 bleed. A vampire can have only one
    //  Pillars Fall."
    krcgId: 102333,
    name: "Pillars Fall",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          {
            kind: "actionEnterCombat",
            targets: "vampire",
            outcome: {
              when: "opposingNotReady",
              effect: { kind: "attachToActor", statics: { bleed: 1 } },
            },
          },
        ],
      },
    ],
  },
  {
    // "+1 stealth action.
    //  [aus] Ⓓ Enter combat with a vampire.
    //  [AUS] As above, and at the end of that combat, if this vampire is
    //  ready and the opposing vampire is not, add 2 blood to a Salubri in
    //  your uncontrolled region."
    krcgId: 102356,
    name: "Hunting the Beast",
    cardType: "action",
    bloodCost: 0,
    requiresClan: ["Salubri"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "aus",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "actionEnterCombat", targets: "vampire" },
        ],
      },
      {
        level: "superior",
        discipline: "aus",
        effects: [
          { kind: "actionStealth", amount: 1 },
          {
            kind: "actionEnterCombat",
            targets: "vampire",
            outcome: {
              when: "actorReadyOpposingNot",
              effect: { kind: "bloodToUncontrolled", amount: 2, clan: "Salubri" },
            },
          },
        ],
      },
    ],
  },
  {
    // "Requires a Sabbat vampire. Ⓓ Bleed with +1 bleed. Anarchs get -1
    //  intercept during this action. If this vampire is Tzimisce and the
    //  bleed is successful, this Tzimisce can burn 1 blood during your
    //  next discard phase to unlock."
    //
    // The intercept clause is registered at ANNOUNCEMENT, with the block
    // restrictions — an effect that shapes the block window and is
    // registered at resolution never applies in the case it is written
    // for. docs/last-buildable-design.md §1
    krcgId: 100726,
    name: "Fiendish Tongue",
    cardType: "action",
    bloodCost: 0,
    poolCost: 0,
    requiresSect: ["sabbat"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionBleed", bonus: 1 },
          { kind: "modifyFilteredIntercept", amount: -1, sects: ["anarch"] },
          { kind: "discardPhaseUnlockOnBleed", clan: "Tzimisce", bloodCost: 1 },
        ],
      },
    ],
  },
  {
    // "+1 stealth action.
    //  [aus] Ⓓ Look at your prey's hand and discard one card of your
    //  choice from it.
    //  [AUS] Put this card in play. Your prey plays with an open hand.
    //  Any minion can burn this card as a Ⓓ action."
    //
    // THE FIRST CARD IN THE POOL THAT REVEALS HIDDEN INFORMATION. The
    // basic's look is a ChoiceFrame addressed to the actor and the log
    // records only the discard; the superior is structural and continuous,
    // which is what masking is good at. docs/last-buildable-design.md §2
    krcgId: 101627,
    name: "Revelations",
    cardType: "action",
    bloodCost: 1,
    poolCost: 0,
    permanent: {
      where: "seat",
      statics: { opensPreyHand: true },
      tags: ["Revelations"],
      // "ANY minion can burn this card as a Ⓓ action" — the default scope
      // (any minion, any Methuselah), so `who` is deliberately absent.
      vulnerableTo: {},
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "aus",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "peekAndDiscard", whose: "prey", count: 1 },
        ],
      },
      {
        level: "superior",
        discipline: "aus",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "putInPlayOnSuccess", tags: ["Revelations"] },
        ],
      },
    ],
  },
  {
    // "[ani] Ⓓ Bleed with +1 bleed.
    //  [ANI] Frenzy. Ⓓ Enter combat with and lock a vampire. The target
    //  vampire is considered the acting minion during that combat."
    //
    // The inversion is the two arguments to `pushCombat` in the other
    // order — the ledger carried it as a blocker for five waves.
    // docs/last-buildable-design.md §3
    krcgId: 100515,
    name: "Deep Song",
    cardType: "action",
    bloodCost: 0,
    poolCost: 0,
    frenzy: true,
    usable: [],
    modes: [
      { level: "basic", discipline: "ani", effects: [{ kind: "actionBleed", bonus: 1 }] },
      {
        level: "superior",
        discipline: "ani",
        effects: [
          {
            kind: "actionEnterCombat",
            targets: "vampire",
            lockTarget: true,
            invertRoles: true,
          },
        ],
      },
    ],
  },
  {
    // "Requires a baron. Choose X ready unlocked Anarchs you control and
    //  allocate 2X points among one or more Methuselahs, locations, and
    //  equipment. Successful referendum means each chosen Anarch is
    //  locked, each Methuselah burns 1 pool for each point allocated, and
    //  each location or equipment allocated a point is burned."
    krcgId: 101631,
    name: "Revolutionary Council",
    cardType: "politicalAction",
    bloodCost: 0,
    poolCost: 0,
    requiresTitle: ["baron"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "refLockAndAllocate", sect: "anarch", pointsEach: 2 }],
      },
    ],
  },
  {
    // "[cel][tha] Ⓓ Enter combat with a minion. This acting vampire gets 1
    //  optional press during that combat.
    //  [CEL][THA] As above, and the opposing minion cannot strike: combat
    //  ends during the first round of that combat."
    krcgId: 102228,
    name: "Hunter's Mark",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: { all: ["cel", "tha"] },
        effects: [
          { kind: "actionEnterCombat", targets: "minion", riders: { press: 1 } },
        ],
      },
      {
        level: "superior",
        discipline: { all: ["cel", "tha"] },
        effects: [
          {
            kind: "actionEnterCombat",
            targets: "minion",
            riders: { press: 1, noCombatEndsFirstRound: true },
          },
        ],
      },
    ],
  },
  {
    // "Requires an Anarch. More than one Discipline can be used to play
    //  this card. Ⓓ Enter combat with a locked minion.
    //  [cel] This Anarch gets 1 optional maneuver during that combat.
    //  [obf] This is a +1 stealth action.
    //  [pot] This Anarch gets +1 strength during that combat."
    // The ADDITIVE mode shape (design §6): every rider the actor's
    // Disciplines allow applies, and there is nothing for the player to
    // choose between — so no mode segment is offered.
    krcgId: 101147,
    name: "Make the Misere",
    cardType: "action",
    bloodCost: 0,
    multiDiscipline: true,
    requiresSect: ["anarch"],
    usable: [],
    modes: [
      {
        // The unconditional clause: the rush itself.
        level: "basic",
        discipline: null,
        effects: [{ kind: "actionEnterCombat", targets: "minion", lockedOnly: true }],
      },
      // The three conditional clauses. Each is a RIDER on the rush above,
      // never a second `actionEnterCombat`: the combined mode holds every
      // applicable clause at once, and two rushes would mean two targets.
      {
        level: "basic",
        discipline: "cel",
        variant: "cel",
        effects: [{ kind: "rushRiders", maneuver: 1 }],
      },
      {
        level: "basic",
        discipline: "obf",
        variant: "obf",
        effects: [{ kind: "actionStealth", amount: 1 }],
      },
      {
        level: "basic",
        discipline: "pot",
        variant: "pot",
        effects: [{ kind: "rushRiders", strength: 1 }],
      },
    ],
  },

  // --- Combat effects that recur every round ---
  // docs/round-recurring-combat-design.md
  {
    // "Only usable before range is determined. A vampire can play only one
    //  Bear's Skin each combat.
    //  [ani][pro] This round, this vampire gets +1 strength and can
    //  prevent 1 damage.
    //  [ANI][PRO] This combat, this vampire gets +1 strength and can
    //  prevent 1 damage each round."
    // The inferior is the existing round-scoped `combatCredits`; only the
    // superior's recurring rate is new.
    krcgId: 100145,
    name: "Bear's Skin",
    cardType: "combat",
    bloodCost: 0,
    combatLimit: "combat",
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: { all: ["ani", "pro"] },
        effects: [{ kind: "combatCredits", strength: 1, prevent: 1 }],
      },
      {
        level: "superior",
        discipline: { all: ["ani", "pro"] },
        effects: [
          { kind: "addStrength", amount: 1 },
          { kind: "preventEachRound", amount: 1 },
        ],
      },
    ],
  },
  {
    // "Only usable before range is determined. A vampire can play only one
    //  Carrion Crows each combat.
    //  [ani] This combat, the opposing minion takes 1R environmental
    //  damage each round during normal strike resolution.
    //  [ANI] As above, but for 2R environmental damage."
    // The combat-card form of the retainer static `combatRoundDamage`, and
    // it lands at the same moment.
    krcgId: 100301,
    name: "Carrion Crows",
    cardType: "combat",
    bloodCost: 0,
    combatLimit: "combat",
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "ani",
        effects: [
          {
            kind: "roundDamage",
            amount: 1,
            targets: "opposing",
            ranged: true,
            when: "strikeResolution",
          },
        ],
      },
      {
        level: "superior",
        discipline: "ani",
        effects: [
          {
            kind: "roundDamage",
            amount: 2,
            targets: "opposing",
            ranged: true,
            when: "strikeResolution",
          },
        ],
      },
    ],
  },
  {
    // "Only usable before range is determined.
    //  [pro] This combat, if a damage is successfully inflicted on this
    //  vampire in a given round, any additional damage inflicted on this
    //  vampire in the same round is automatically prevented. Aggravated
    //  damage cannot be prevented this way.
    //  [PRO] As above, but aggravated damage is prevented this way as
    //  well."
    krcgId: 100749,
    name: "Flesh of Marble",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "pro",
        effects: [{ kind: "autoPreventAfterFirst", aggravated: false }],
      },
      {
        level: "superior",
        discipline: "pro",
        effects: [{ kind: "autoPreventAfterFirst", aggravated: true }],
      },
    ],
  },
  {
    // "Only usable before range is determined during the first round. A
    //  vampire can play only one Weather Control each combat.
    //  [tha] Both combatants and each retainer on them take 1
    //  unpreventable environmental damage before range is determined each
    //  round this combat.
    //  [THA] As above, but the amount of damage inflicted is increased by
    //  1 in each subsequent round."
    // It hits its own player too: "both combatants" names no exemption.
    krcgId: 102164,
    name: "Weather Control",
    cardType: "combat",
    bloodCost: 0,
    combatLimit: "combat",
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "tha",
        usable: ["onlyFirstRound"],
        effects: [
          {
            kind: "roundDamage",
            amount: 1,
            targets: "both",
            ranged: true,
            when: "beforeRange",
            retainers: true,
            unpreventable: true,
          },
        ],
      },
      {
        level: "superior",
        discipline: "tha",
        usable: ["onlyFirstRound"],
        effects: [
          {
            kind: "roundDamage",
            amount: 1,
            targets: "both",
            ranged: true,
            when: "beforeRange",
            retainers: true,
            unpreventable: true,
            escalate: true,
          },
        ],
      },
    ],
  },
  {
    // "Only usable before range is determined during the first round.
    //  [for] This combat, this vampire can prevent 1 damage each round.
    //  This combat, frenzy cards cannot be used on this vampire; cancel
    //  the effects of frenzy cards that have already been used on this
    //  vampire this combat.
    //  [FOR] As above, but this vampire can prevent 2 damage each round."
    // Closes the Tranquility Shield deferral in docs/frenzy-design.md.
    krcgId: 102362,
    name: "Tranquility Shield",
    cardType: "combat",
    bloodCost: 1,
    requiresClan: ["Salubri"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "for",
        usable: ["onlyFirstRound"],
        effects: [{ kind: "preventEachRound", amount: 1 }, { kind: "frenzyShield" }],
      },
      {
        level: "superior",
        discipline: "for",
        usable: ["onlyFirstRound"],
        effects: [{ kind: "preventEachRound", amount: 2 }, { kind: "frenzyShield" }],
      },
    ],
  },

  // --- Intercept reactions and what they carry into the combat ---
  // docs/blocker-riders-design.md
  {
    // "Only usable if a minion controlled by your predator is acting.
    //  [ani] +1 intercept.
    //  [ANI] As above, with 1 optional maneuver during the resulting
    //  combat if this vampire blocks."
    krcgId: 100995,
    name: "Instinctive Reaction",
    cardType: "reaction",
    bloodCost: 0,
    usable: ["predatorIsActing"],
    modes: [
      { level: "basic", discipline: "ani", effects: [{ kind: "modifyIntercept", amount: 1 }] },
      {
        level: "superior",
        discipline: "ani",
        effects: [
          { kind: "modifyIntercept", amount: 1 },
          { kind: "blockerCombatRider", maneuver: 1 },
        ],
      },
    ],
  },
  {
    // "[aus] +1 intercept.
    //  [AUS] As above, and this vampire can prevent 1 damage during the
    //  first round of the resulting combat if they block."
    krcgId: 101475,
    name: "Precognition",
    cardType: "reaction",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "aus", effects: [{ kind: "modifyIntercept", amount: 1 }] },
      {
        level: "superior",
        discipline: "aus",
        effects: [
          { kind: "modifyIntercept", amount: 1 },
          { kind: "blockerCombatRider", prevent: 1 },
        ],
      },
    ],
  },
  {
    // "[obl] +1 intercept.
    //  [OBL] As above, and if this vampire blocks, they can burn 1 blood
    //  to unlock after block resolution."
    krcgId: 102284,
    name: "Truth in Darkness",
    cardType: "reaction",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "obl", effects: [{ kind: "modifyIntercept", amount: 1 }] },
      {
        level: "superior",
        discipline: "obl",
        effects: [
          { kind: "modifyIntercept", amount: 1 },
          { kind: "blockerCombatRider", unlockForBlood: 1 },
        ],
      },
    ],
  },
  {
    // "[pro] [ACTION MODIFIER] Only usable if a minion attempts to block.
    //  The blocking minion gets -1 intercept. If this action is blocked,
    //  this vampire gets 1 optional maneuver and cannot use equipment
    //  during the resulting combat.
    //  [PRO] [REACTION] +1 intercept. If this vampire blocks, they get 1
    //  optional maneuver and cannot use equipment during the resulting
    //  combat."
    //
    // The first card whose modifier half is played by the ACTING minion
    // on a dual-typed card — see the design doc §5.
    krcgId: 102223,
    name: "Form of the Bat",
    cardType: "modifierOrReaction",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "pro",
        role: "modifier",
        effects: [
          { kind: "modifyBlockerIntercept", amount: -1 },
          { kind: "actorCombatRider", maneuver: 1, noEquipment: true },
        ],
      },
      {
        level: "superior",
        discipline: "pro",
        role: "reaction",
        effects: [
          { kind: "modifyIntercept", amount: 1 },
          { kind: "blockerCombatRider", maneuver: 1, noEquipment: true },
        ],
      },
    ],
  },
  {
    // "[obf][pre] Reduce the acting minion's stealth to 0. (The acting
    //  minion can still increase their stealth.)
    //  [OBF][PRE] As above, and if this vampire blocks, they can strike:
    //  combat ends during the first round of the resulting combat."
    krcgId: 102254,
    name: "Night Terrors",
    cardType: "reaction",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: { all: ["obf", "pre"] },
        effects: [{ kind: "setStealthZero" }],
      },
      {
        level: "superior",
        discipline: { all: ["obf", "pre"] },
        effects: [
          { kind: "setStealthZero" },
          { kind: "blockerCombatRider", combatEndsStrike: true },
        ],
      },
    ],
  },

  // --- The after-referendum window and the margin ---
  // docs/referendum-margin-design.md
  {
    // "Only usable after resolution of a political action whose referendum
    //  passed.
    //  [pre] This vampire gains 1 blood for each vote by which the
    //  referendum passed.
    //  [PRE] As above, but move up to 2 of those blood to your pool
    //  instead of this vampire."
    krcgId: 102131,
    name: "Voter Captivation",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "pre",
        usable: ["afterReferendumPassed"],
        effects: [{ kind: "bloodPerVoteMargin" }],
      },
      {
        level: "superior",
        discipline: "pre",
        usable: ["afterReferendumPassed"],
        effects: [{ kind: "bloodPerVoteMargin", toPool: 2 }],
      },
    ],
  },
  {
    // "Only usable after resolution of a political action whose referendum
    //  passed. For each vote by which the referendum passed, distribute 1
    //  blood from the blood bank among the ready Lasombra you control and
    //  your pool. A vampire cannot gain more than 1 blood this way. You
    //  cannot gain more than 1 pool this way or more than 2 pool this way
    //  if this acting Lasombra is titled."
    krcgId: 102274,
    name: "Amici Noctis",
    cardType: "actionModifier",
    bloodCost: 0,
    requiresClan: ["Lasombra"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        usable: ["afterReferendumPassed"],
        effects: [
          {
            kind: "distributePerVoteMargin",
            clan: "Lasombra",
            poolCap: 1,
            poolCapIfTitled: 2,
          },
        ],
      },
    ],
  },
  {
    // "Only usable after resolution of a political action whose referendum
    //  passed.
    //  [dom] or [pot] Add 2 blood to a Sabbat vampire in your uncontrolled
    //  region.
    //  [DOM] or [POT] Add 1 blood to each Sabbat vampire in your
    //  uncontrolled region."
    krcgId: 102331,
    name: "Magnetic Authority",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: ["dom", "pot"],
        usable: ["afterReferendumPassed"],
        effects: [{ kind: "uncontrolledSectBlood", amount: 2, sect: "sabbat" }],
      },
      {
        level: "superior",
        discipline: ["dom", "pot"],
        usable: ["afterReferendumPassed"],
        effects: [{ kind: "uncontrolledSectBlood", amount: 1, sect: "sabbat", each: true }],
      },
    ],
  },

  // --- The after-action-resolution window ---
  // docs/after-resolution-design.md
  {
    // "Only usable after action resolution.
    //  [for] Only usable if the action was successful. Unlock this vampire.
    //  [FOR] Only usable if the action was blocked. Unlock this vampire."
    krcgId: 100788,
    name: "Freak Drive",
    cardType: "actionModifier",
    bloodCost: 1,
    usable: ["afterResolutionByActor"],
    modes: [
      {
        level: "basic",
        discipline: "for",
        usable: ["ifActionSucceeded"],
        effects: [{ kind: "unlockActor" }],
      },
      {
        level: "superior",
        discipline: "for",
        usable: ["ifActionBlocked"],
        effects: [{ kind: "unlockActor" }],
      },
    ],
  },
  {
    // "[obl] +1 stealth.
    //  [OBL] Only usable after resolution of a successful directed action.
    //  Put this card on this vampire. During an action directed at the
    //  same Methuselah or same set of Methuselahs, this vampire can burn
    //  this card to get +1 stealth."
    krcgId: 102280,
    name: "Shadow Cast",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "obl", effects: [{ kind: "modifyStealth", amount: 1 }] },
      {
        level: "superior",
        discipline: "obl",
        usable: ["afterResolutionByActor", "ifActionSucceeded", "ifActionDirected"],
        effects: [
          {
            kind: "afterResolutionAttach",
            tags: ["shadowCast"],
            recordTarget: true,
          },
        ],
      },
    ],
  },
  {
    // "[obl] +1 stealth.
    //  [OBL] Only usable after resolution of a successful action. Put this
    //  card on this vampire. Minions without Auspex [aus] cannot perform
    //  actions directed at this vampire. During your unlock phase, burn
    //  this card."
    krcgId: 102281,
    name: "Shadow Cloak",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "obl", effects: [{ kind: "modifyStealth", amount: 1 }] },
      {
        level: "superior",
        discipline: "obl",
        usable: ["afterResolutionByActor", "ifActionSucceeded"],
        effects: [
          {
            kind: "afterResolutionAttach",
            tags: ["shadowCloak"],
            statics: { untargetableExceptDiscipline: "aus" },
            burnInUnlockPhase: true,
          },
        ],
      },
    ],
  },
  {
    // "[for] or [pre] +1 bleed (limited).
    //  [FOR] or [PRE] As above, and if the bleed is successful (for 1 or
    //  more), you can put this card on this vampire after action
    //  resolution. This vampire can burn this card during a bleed action
    //  they perform to have a block attempt fail; the blocking minion
    //  cannot attempt to block this action again. A vampire can have only
    //  one Fever Pitch."
    krcgId: 102321,
    name: "Fever Pitch",
    cardType: "actionModifier",
    bloodCost: 1,
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["Fever Pitch"],
      exclusiveKey: "Fever Pitch",
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: ["for", "pre"],
        usable: ["onlyDuringBleed"],
        effects: [{ kind: "modifyBleed", amount: 1, limited: true }],
      },
      {
        // The bleed bonus is applied when the card is played, in the
        // ordinary window; the attach half is a SEPARATE mode played
        // after resolution, because the two happen at different times.
        level: "superior",
        discipline: ["for", "pre"],
        variant: "attach",
        usable: ["afterResolutionByActor", "ifBleedSucceeded"],
        effects: [{ kind: "afterResolutionAttach", tags: ["feverPitch"] }],
      },
      {
        level: "superior",
        discipline: ["for", "pre"],
        variant: "bleed",
        usable: ["onlyDuringBleed"],
        effects: [{ kind: "modifyBleed", amount: 1, limited: true }],
      },
    ],
  },

  // --- Ending an action early (docs/end-action-design.md) ---
  {
    // "Only usable if this minion is blocked, before block resolution.
    //  Unlock this minion. The action ends (unsuccessfully). This minion
    //  cannot perform the same action again this turn."
    krcgId: 100323,
    name: "Change of Target",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "endAction", unlockActor: true, barRepeat: "minion" }],
      },
    ],
  },
  {
    // "Do not replace until your next discard phase.
    //  [tha] +1 stealth.
    //  [THA] As above, and if this action is blocked, lock the blocking
    //  minion and end the action before block resolution."
    krcgId: 101223,
    name: "Mirror Walk",
    cardType: "actionModifier",
    bloodCost: 0,
    delayedReplace: "discard",
    usable: [],
    modes: [
      { level: "basic", discipline: "tha", effects: [{ kind: "modifyStealth", amount: 1 }] },
      {
        level: "superior",
        discipline: "tha",
        // p. 49: "Contrary to Change of Target, Mirror Walk explicitly
        // locks the blocking minion" — and does NOT unlock the actor.
        effects: [
          { kind: "modifyStealth", amount: 1 },
          { kind: "endAction", lockBlocker: true },
        ],
      },
    ],
  },
  {
    // "Only usable if this vampire is about to enter combat with an
    //  acting younger vampire.
    //  [dom] Unlock the acting vampire and end the action. (Do not lock
    //  this vampire if they are blocking.) The acting vampire cannot
    //  perform the same action this turn.
    //  [DOM] As above, but do not unlock the acting vampire."
    krcgId: 101309,
    name: "Obedience",
    cardType: "reaction",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "dom",
        effects: [{ kind: "endAction", unlockActor: true, barRepeat: "minion" }],
      },
      {
        level: "superior",
        discipline: "dom",
        effects: [{ kind: "endAction", barRepeat: "minion" }],
      },
    ],
  },
  {
    // "Only usable during the polling step of a political action. Cancel
    //  the referendum. Unlock the acting vampire. If a political action
    //  card was played to call this referendum, return it to its owner's
    //  hand (discard down afterward). Minions controlled by the acting
    //  Methuselah cannot perform the same political action again this
    //  turn."
    krcgId: 100519,
    name: "Delaying Tactics",
    cardType: "reaction",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [{ kind: "cancelReferendum", unlockCaller: true, barRepeat: "seat" }],
      },
    ],
  },
  {
    // "[obf] +1 stealth.
    //  [OBF] As above, and minions who attempt to block this action and
    //  fail become locked before action resolution."
    krcgId: 100687,
    name: "Faceless Night",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: [],
    modes: [
      { level: "basic", discipline: "obf", effects: [{ kind: "modifyStealth", amount: 1 }] },
      {
        level: "superior",
        discipline: "obf",
        effects: [
          { kind: "modifyStealth", amount: 1 },
          { kind: "lockFailedBlockers" },
        ],
      },
    ],
  },

  // --- Searching the library, and out-of-play stores ---
  // docs/library-search-design.md
  {
    // "+1 stealth action. [tha] Search your library for an equipment card
    //  and equip this vampire with it (requirements and cost apply as
    //  normal; shuffle afterward). [THA] As above, but this is a +3
    //  stealth action."
    krcgId: 101143,
    name: "Magic of the Smith",
    cardType: "action",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "tha",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "searchEquip", cardTypes: ["equipment"] },
        ],
      },
      {
        level: "superior",
        discipline: "tha",
        effects: [
          { kind: "actionStealth", amount: 3 },
          { kind: "searchEquip", cardTypes: ["equipment"] },
        ],
      },
    ],
  },
  {
    // "Put this card on a ready minion you control. If you control this
    //  minion, they can equip with the first equipment you find in your
    //  library as a +1 stealth equip action (working down from the top;
    //  requirements and cost apply as normal; shuffle afterward)."
    krcgId: 102092,
    name: "Vast Wealth",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["Vast Wealth"],
      attach: { scope: "own" },
      searchEquipGrant: { stealth: 1, cardTypes: ["equipment"] },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. Search your library (shuffle afterward) for up to
    //  three non-unique equipment cards and put them on this location,
    //  face up and out of play. If you would draw a card from your
    //  library, you can draw one of those cards instead. If this location
    //  has no cards on it, burn it."
    krcgId: 102351,
    name: "Black Market Cache",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Black Market Cache", "location"],
      store: {
        faceUp: true,
        fillOnEntry: {
          from: "search",
          count: 3,
          cardTypes: ["equipment"],
          nonUniqueOnly: true,
        },
        redirectsDraw: true,
        burnWhenEmpty: true,
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique. Move the top 2 cards of your library to this equipment,
    //  face down and out of play (you can look at the cards at any time).
    //  While this Ravnos is ready, if you would draw a card from your
    //  library, you can draw one of these cards instead. During your
    //  unlock phase, you can move the top card of your library to this
    //  equipment."
    krcgId: 101767,
    name: "Shilmulo Tarot",
    cardType: "equipment",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    // An equipment is played BY a vampire, so its clan tag gates who may
    // equip it — unlike a Master's, which has no acting minion to gate
    // (the Ravnos Carnival precedent).
    requiresClan: ["Ravnos"],
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["Shilmulo Tarot"],
      store: {
        faceUp: false,
        fillOnEntry: { from: "libraryTop", count: 2 },
        redirectsDraw: true,
        requiresReadyBearer: true,
        addTopInUnlockPhase: true,
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique location. During your master phase, you can put a ghoul
    //  (ally or retainer) from your hand on this location, face up and
    //  out of play. Tzimisce you control can play cards from this
    //  location as if from your hand (requirements and cost apply as
    //  normal)."
    krcgId: 102354,
    name: "Fleshforge Chamber",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Fleshforge Chamber", "location"],
      store: {
        faceUp: true,
        addFromHandInMasterPhase: { cardTypes: ["ally", "retainer"], tags: ["ghoul"] },
        playableFrom: { clan: "Tzimisce" },
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },

  // --- Recurring pool drains (docs/pool-drain-design.md) ---
  {
    // "Put this card in play. A Methuselah not controlling a ready Anarch
    //  burns 1 pool during their unlock phase. Vampires can call a
    //  referendum to burn this card as a +1 stealth political action."
    krcgId: 100055,
    name: "Anarch Revolt",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Anarch Revolt"],
      unlockDrain: { whose: "any", amount: 1, when: { kind: "noReadySect", sect: "anarch" } },
      vulnerableTo: { via: "politicalAction", stealth: 1 },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "+1 stealth action. Requires a prince or justicar. | Put this card
    //  in play. Each Methuselah controlling a non-Camarilla vampire burns
    //  1 pool during their unlock phase. Methuselahs can burn a
    //  non-Camarilla vampire they control during their master phase to
    //  burn this card."
    krcgId: 101028,
    name: "Judgment: Camarilla Segregation",
    cardType: "action",
    bloodCost: 1,
    requiresTitle: ["prince", "justicar"],
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Judgment: Camarilla Segregation"],
      unlockDrain: {
        whose: "any",
        amount: 1,
        when: { kind: "controlsNonSect", sect: "camarilla" },
      },
      // No "master phase ACTION" in the text — only the sacrifice.
      masterPhaseBurn: { burnOwnMinion: { kind: "vampire", notSect: "camarilla" } },
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "putInPlayOnSuccess", tags: ["Judgment: Camarilla Segregation"] },
        ],
      },
    ],
  },
  {
    // "+1 stealth action. Put this card in play. During your prey's unlock
    //  phase, for each vampire in torpor they control, they burn 1 pool.
    //  If your prey controls no vampires in torpor or after they are
    //  ousted, burn this card. A Methuselah can have only one Augury of
    //  Doom."
    krcgId: 102310,
    name: "Augury of Doom",
    cardType: "action",
    bloodCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Augury of Doom"],
      unlockDrain: { whose: "prey", amount: 1, perTorporVampire: true },
      selfBurn: { whenPreyHasNoTorpor: true, onPreyOusted: {} },
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "putInPlayOnSuccess", tags: ["Augury of Doom"] },
        ],
      },
    ],
  },
  {
    // "Unique. Requires a titled Sabbat vampire. | Successful referendum
    //  means this card is put in play. During your prey's unlock phase,
    //  they burn 1 pool. After your prey is ousted, burn this card and
    //  gain 3 additional pool. Vampires can call a referendum to burn this
    //  card as a +1 stealth political action that costs 1 pool."
    krcgId: 102348,
    name: "War of Ages",
    cardType: "politicalAction",
    bloodCost: 0,
    unique: true,
    requiresSect: ["sabbat"],
    requiresTitle: ["bishop", "archbishop", "priscus", "cardinal"],
    permanent: {
      where: "seat",
      statics: {},
      tags: ["War of Ages"],
      unlockDrain: { whose: "prey", amount: 1 },
      selfBurn: { onPreyOusted: { gainPool: 3 } },
      vulnerableTo: { via: "politicalAction", stealth: 1, cost: { pool: 1 } },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [{ kind: "refPutInPlay" }] }],
  },
  {
    // "Unique. | Put this card on a ready vampire. After this vampire goes
    //  to torpor, their controller burns 3 pool. During each Methuselah's
    //  unlock phase, if this vampire is in torpor, that Methuselah burns 1
    //  pool."
    krcgId: 100698,
    name: "Fame",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "bearer",
      statics: {},
      tags: ["Fame"],
      // "a ready vampire" — anyone's; the card stays controlled by the
      // Methuselah who played it (p. 16).
      attach: { scope: "any", kind: "vampire" },
      leaveReadyDrain: { amount: 3, how: "torpor", bearerOnly: true },
      // "…that Methuselah burns 1 pool": EVERY Methuselah, the card's own
      // controller included (design §3).
      unlockDrain: { whose: "any", amount: 1, when: { kind: "bearerInTorpor" } },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique. | Put this card in play. After a ready minion is burned or
    //  sent to torpor, their controller burns 1 pool. Methuselahs can use
    //  a master phase action and discard two master cards to burn this
    //  card."
    krcgId: 101958,
    name: "Tension in the Ranks",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["Tension in the Ranks"],
      leaveReadyDrain: { amount: 1 },
      masterPhaseBurn: { usesMasterAction: true, discardMasters: 2 },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },

  // --- Stun (owner ruling 2026-08-31, docs/stun-design.md) ---
  {
    // "[obf] or [pre] Strike: combat ends.
    //  [OBF] or [PRE] As above, and after combat ends, if the range is
    //  close, stun the opposing minion."
    krcgId: 102330,
    name: "Kiss of Cathari",
    cardType: "combat",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: ["obf", "pre"],
        effects: [{ kind: "strikeCombatEnds", unlockSelf: false }],
      },
      {
        level: "superior",
        discipline: ["obf", "pre"],
        effects: [
          { kind: "strikeCombatEnds", unlockSelf: false },
          { kind: "afterCombatEnds", stun: { closeRangeOnly: true } },
        ],
      },
    ],
  },
  {
    // "[pre] Ⓓ Stun an unlocked vampire.
    //  [PRE] As above, and this is a +1 stealth action."
    krcgId: 101211,
    name: "Mind Numb",
    cardType: "action",
    bloodCost: 1,
    usable: [],
    modes: [
      { level: "basic", discipline: "pre", effects: [{ kind: "actionStun" }] },
      {
        level: "superior",
        discipline: "pre",
        effects: [{ kind: "actionStun" }, { kind: "actionStealth", amount: 1 }],
      },
    ],
  },

  // --- Playing a card from hand outside its own action ---
  // docs/play-from-hand-design.md
  {
    krcgId: 102349,
    name: "Angel's Gift",
    cardType: "combat",
    bloodCost: 0,
    requiresClan: ["Salubri"],
    // "A vampire can play only one Angel's Gift each round."
    combatLimit: "round",
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        variant: "equip",
        // "Equip this vampire with a melee weapon from your hand
        // (requirements and cost apply as normal)."
        effects: [{ kind: "playFromHand", types: ["equipment"], tags: ["melee"] }],
      },
      {
        level: "basic",
        discipline: null,
        variant: "close",
        // "This round, this vampire gets 1 optional maneuver, only
        // usable to get to close range."
        effects: [{ kind: "roundCloseManeuver" }],
      },
    ],
  },
  {
    krcgId: 102352,
    name: "Contraband",
    cardType: "combat",
    bloodCost: 0,
    requiresClan: ["Ravnos"],
    // "A vampire can play only one Contraband each combat."
    combatLimit: "combat",
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "obf",
        effects: [{ kind: "playFromHand", types: ["equipment"], nonUniqueOnly: true }],
      },
      {
        level: "superior",
        discipline: "obf",
        // "…and this vampire can pay up to half the cost rounded down of
        // that equipment with their blood."
        effects: [
          {
            kind: "playFromHand",
            types: ["equipment"],
            nonUniqueOnly: true,
            halfCostInBlood: true,
          },
        ],
      },
    ],
  },
  {
    krcgId: 101342,
    name: "Pack Alpha",
    cardType: "combat",
    bloodCost: 0,
    // "A vampire can play only one Pack Alpha each round."
    combatLimit: "round",
    // "A minion can have only one Pack Alpha."
    permanent: { where: "bearer", statics: {}, tags: [], exclusiveKey: "Pack Alpha" },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "ani",
        effects: [{ kind: "playFromHand", types: ["retainer"], tags: ["animal"] }],
      },
      {
        level: "superior",
        discipline: "ani",
        // "Burn an animal retainer employed by this vampire to put this
        // card on this vampire. This minion gets +1 strength."
        effects: [{ kind: "burnAttachedToAttach", tags: ["animal"], strength: 1 }],
      },
    ],
  },
  {
    krcgId: 101401,
    name: "Piper",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    // "Requires a ready Anarch."
    requiresControlledSect: ["anarch"],
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        // "Lock a ready unlocked Anarch you control. That Anarch recruits
        // or employs an ally or retainer from your hand (requirements and
        // cost apply as normal). This is not an action and cannot be
        // blocked."
        effects: [
          {
            kind: "playFromHand",
            types: ["ally", "retainer"],
            actor: { sect: "anarch", unlockedOnly: true, lock: true },
          },
        ],
      },
    ],
  },
  {
    krcgId: 100162,
    name: "Biothaumaturgic Experiment",
    cardType: "action",
    bloodCost: 0,
    poolCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "tha",
        // "Employ an animal retainer from your hand ignoring requirements
        // (pay cost as normal)."
        effects: [
          {
            kind: "playFromHand",
            types: ["retainer"],
            tags: ["animal"],
            ignoreRequirements: true,
          },
        ],
      },
      {
        level: "superior",
        discipline: "tha",
        // "Put this card on a minion you control. The attached minion
        // gets 1 optional maneuver each combat and +1 strength."
        effects: [
          { kind: "attachSelf", strength: 1, maneuverPerCombat: 1, target: "ownMinion" },
        ],
      },
    ],
  },
  // --- Combat cards that become permanents ---
  // docs/combat-attachments-design.md
  {
    // "Only usable before range is determined.
    //  [pro] or [tha] Put this card on this vampire. This vampire can burn
    //  this card to prevent 2 non-aggravated damage in combat. A vampire
    //  can have only one Wall of Filth.
    //  [PRO] or [THA] As above, but to prevent 2 damage in combat."
    // The two modes differ by EXACTLY the aggravated filter, which makes
    // this the sharpest test of the `prevent.nonAggravated` gate (§3).
    krcgId: 102347,
    name: "Wall of Filth",
    cardType: "combat",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: ["pro", "tha"],
        effects: [
          {
            kind: "attachInCombat",
            to: "self",
            when: "beforeRange",
            burnToPrevent: { amount: 2, nonAggravated: true },
          },
        ],
      },
      {
        level: "superior",
        discipline: ["pro", "tha"],
        effects: [
          {
            kind: "attachInCombat",
            to: "self",
            when: "beforeRange",
            burnToPrevent: { amount: 2 },
          },
        ],
      },
    ],
  },
  {
    // "[pro] Strike: hand strike, aggravated.
    //  [PRO] Strike: hand strike at +1 damage and put this card on the
    //  opposing minion. During their unlock phase, the attached minion
    //  burns 1 blood or life. Minions can burn this card as a +1 stealth
    //  action."
    krcgId: 102260,
    name: "Sculpt the Flesh",
    cardType: "combat",
    bloodCost: 0,
    permanent: {
      // The entry's real behaviour comes from `strikeAttachToVictim`;
      // this block exists for the counter-play clause alone, the same
      // wart Tier of Souls records.
      where: "bearer",
      statics: {},
      tags: [],
      vulnerableTo: { stealth: 1 },
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "pro",
        effects: [{ kind: "strikeHandBonus", bonus: 0, aggravated: true }],
      },
      {
        level: "superior",
        discipline: "pro",
        effects: [{ kind: "strikeAttachToVictim", handBonus: 1, bearerUnlockBurn: 1 }],
      },
    ],
  },
  {
    // "Only usable at close range at the end of a round during which this
    //  vampire successfully inflicted more damage than the opposing
    //  vampire. Not usable by a vampire being burned or going to torpor.
    //  [pot] Put this card on the opposing vampire and send them to
    //  torpor. The attached vampire gets -1 strength. They can burn 3
    //  blood to burn this card. A vampire can have only one Disarm.
    //  [POT] As above, but the attached vampire gets -2 strength."
    krcgId: 100549,
    name: "Disarm",
    cardType: "combat",
    bloodCost: 0,
    permanent: {
      where: "bearer",
      statics: {},
      tags: [],
      // "They can burn 3 blood to burn this card" — the BEARER buying it
      // off, which is not the `vulnerableTo` Ⓓ action (§5).
      bearerCanBurn: { blood: 3 },
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "pot",
        usable: ["onlyAtCloseRange", "onlyIfInflictedMoreThisRound", "byStillReadyCombatant"],
        effects: [
          {
            kind: "attachInCombat",
            to: "opposing",
            when: "endOfRound",
            torporTarget: true,
            statics: { strength: -1 },
          },
        ],
      },
      {
        level: "superior",
        discipline: "pot",
        usable: ["onlyAtCloseRange", "onlyIfInflictedMoreThisRound", "byStillReadyCombatant"],
        effects: [
          {
            kind: "attachInCombat",
            to: "opposing",
            when: "endOfRound",
            torporTarget: true,
            statics: { strength: -2 },
          },
        ],
      },
    ],
  },
  {
    // "Only usable before range is determined in combat with a vampire. A
    //  vampire can play only one Morbidity each round.
    //  [obl] or [tha] Put this card in play and move up to 2 blood from
    //  the opposing vampire to this card. After combat ends, move all the
    //  blood from this card to the opposing vampire and burn this card.
    //  [OBL] or [THA] As above, and combat cards cost the opposing
    //  vampire +1 blood."
    krcgId: 102332,
    name: "Morbidity",
    cardType: "combat",
    bloodCost: 0,
    combatLimit: "round",
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: ["obl", "tha"],
        effects: [{ kind: "combatBloodStore", max: 2 }],
      },
      {
        level: "superior",
        discipline: ["obl", "tha"],
        effects: [
          { kind: "combatBloodStore", max: 2 },
          // Built for Terror Frenzy superior in the play-cost wave and
          // reused verbatim (§6).
          {
            kind: "combatCostModOnOpponent",
            mod: { amount: 1, pays: "blood", cardTypes: ["combat"] },
          },
        ],
      },
    ],
  },
  {
    // "[dom][pro] Only usable before range is determined. This vampire
    //  gets +1 strength this combat. A vampire can play only one
    //  Monstrous Form each round.
    //  [DOM][PRO] +1 stealth action. Put this card on this vampire.
    //  During combat, you can lock this card to give this vampire +1
    //  strength this round, or 1 maneuver or press."
    krcgId: 102253,
    name: "Monstrous Form",
    cardType: "actionOrCombat",
    bloodCost: 0,
    combatLimit: "round",
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: { all: ["dom", "pro"] },
        effects: [{ kind: "addStrength", amount: 1 }],
      },
      {
        level: "superior",
        discipline: { all: ["dom", "pro"] },
        effects: [
          { kind: "actionStealth", amount: 1 },
          {
            kind: "attachSelf",
            combatLockGrant: { strengthRound: 1, maneuver: true, press: true },
          },
        ],
      },
    ],
  },
  // --- Masters that reach across the table ---
  // docs/cross-table-masters-design.md. Each of these five carries a
  // bespoke overlay below; the spec is here so `supported.test.ts` still
  // cross-checks name, cost and disciplines against the registry — the
  // check that caught Aranthebes and Under Siege.
  {
    // "Only one Giant's Blood can be played in a game. Choose a vampire.
    //  The chosen vampire gains enough blood to reach full capacity."
    krcgId: 100824,
    name: "Giant's Blood",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Remove a vampire with capacity 8 or more from the game. Their
    //  controller gains pool equal to the vampire's capacity. Their
    //  controller can burn 2 pool to cancel this card as it is played."
    krcgId: 100842,
    name: "Golconda: Inner Peace",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Out-of-turn. Only usable if a minion is bleeding you and the bleed
    //  amount is 4 or more, after blocks are declined. Burn the acting
    //  minion. (The action is not successful.)"
    krcgId: 100085,
    name: "Archon Investigation",
    cardType: "master",
    bloodCost: 0,
    poolCost: 3,
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique. Put this card in play. During your unlock phase, you can
    //  give your prey control of the Anarch Troublemaker and either lock
    //  up to two vampires they control or burn an equipment on one of
    //  their minions."
    krcgId: 100058,
    name: "Anarch Troublemaker",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique. Trifle. Put this card in play. You can lock this card to
    //  add 2 blood to a ready vampire you control. During your discard
    //  phase, your predator takes control of The Coven."
    krcgId: 100435,
    name: "The Coven",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    trifle: true,
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  // --- Actions that take what belongs to another Methuselah ---
  // docs/taking-actions-design.md
  {
    // "+1 stealth action.
    //  [dom] Ⓓ Steal a retainer controlled by another vampire.
    //  [DOM] Ⓓ Steal an ally controlled by another Methuselah."
    // The two modes differ in ZONE as well as scope: a retainer is a card
    // in play, an ally is a minion (§4).
    krcgId: 100703,
    name: "Far Mastery",
    cardType: "action",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "dom",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "actionSteal", what: "retainer", from: "otherVampire" },
        ],
      },
      {
        level: "superior",
        discipline: "dom",
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "actionSteal", what: "ally", from: "otherMethuselah" },
        ],
      },
    ],
  },
  {
    // "[dom] Ⓓ Steal a vampire in torpor controlled by another
    //  Methuselah.
    //  [DOM] As above, and this acting vampire can burn 2 blood to move
    //  the stolen vampire to your ready region."
    krcgId: 100852,
    name: "Graverobbing",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "dom",
        effects: [{ kind: "actionSteal", what: "torporVampire", from: "otherMethuselah" }],
      },
      {
        level: "superior",
        discipline: "dom",
        effects: [
          {
            kind: "actionSteal",
            what: "torporVampire",
            from: "otherMethuselah",
            thenReady: { bloodCost: 2 },
          },
        ],
      },
    ],
  },
  {
    // "[dom] Ⓓ Bleed with +2 bleed.
    //  [DOM] Ⓓ Put this card on a younger vampire and lock them; you
    //  still control this card. The attached vampire does not unlock as
    //  normal. During your next minion phase, burn this card to unlock
    //  the attached vampire and take control of them until the end of
    //  your turn."
    krcgId: 101215,
    name: "Puppet Master",
    cardType: "action",
    bloodCost: 2,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "dom",
        effects: [{ kind: "actionBleed", bonus: 2 }],
      },
      {
        level: "superior",
        discipline: "dom",
        effects: [
          {
            kind: "attachToOpponent",
            whose: "younger",
            lockBearer: true,
            preventsUnlock: true,
            cashIn: { unlockBearer: true, borrowUntilEndOfTurn: true },
          },
        ],
      },
    ],
  },
  {
    // "[dom] Ⓓ Bleed with +2 bleed. Allies cannot block this action.
    //  [DOM] Ⓓ Put this card on a vampire controlled by your predator.
    //  Each time the attached vampire announces an action, they move 1
    //  blood from themselves to this acting vampire. The attached vampire
    //  can burn 4 blood during their minion phase to burn this card. Burn
    //  this card after this acting vampire leaves the ready region."
    krcgId: 101801,
    name: "Slaughtering the Herd",
    cardType: "action",
    bloodCost: 2,
    permanent: {
      where: "bearer",
      statics: {},
      tags: [],
      // Built last wave for Disarm; this is its second user, which is
      // what a primitive wants (§6).
      bearerCanBurn: { blood: 4 },
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "dom",
        effects: [
          { kind: "actionBleed", bonus: 2 },
          { kind: "blockRestriction", who: "allies" },
        ],
      },
      {
        level: "superior",
        discipline: "dom",
        effects: [
          {
            kind: "attachToOpponent",
            whose: "predator",
            siphonOnAnnounce: 1,
            burnWhenActorLeavesReady: true,
          },
        ],
      },
    ],
  },
  {
    // "Requires an Anarch. More than one Discipline can be used to play
    //  this card. Ⓓ Bleed.
    //  [ani] The bleed is with +1 bleed.
    //  [obf] If the bleed is successful, you can lock a minion controlled
    //  by the target Methuselah.
    //  [pre] If the bleed is successful, add 1 blood to a vampire in your
    //  uncontrolled region."
    // The third and last `multiDiscipline` card: the clauses are ADDITIVE,
    // so they collapse into one synthetic combined mode (§7).
    krcgId: 102247,
    name: "Break the Bonds",
    cardType: "action",
    bloodCost: 0,
    requiresSect: ["anarch"],
    multiDiscipline: true,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "ani",
        effects: [{ kind: "actionBleed", bonus: 1 }],
      },
      {
        level: "basic",
        discipline: "obf",
        variant: "obf",
        effects: [{ kind: "actionBleed", bonus: 0 }, { kind: "lockTargetMinionOnBleed" }],
      },
      {
        level: "basic",
        discipline: "pre",
        variant: "pre",
        effects: [
          { kind: "actionBleed", bonus: 0 },
          { kind: "bloodOnBleedSuccess", amount: 1, scope: "uncontrolled", youngerOnly: false },
        ],
      },
    ],
  },
  // --- The ash heap (docs/ash-heap-design.md) ---
  {
    // "[obl] Ⓓ Bleed with +1 bleed. If the bleed is successful (for 1 or
    //  more), the target Methuselah discards 2 cards of their choice.
    //  [OBL] Ⓓ Remove 7 cards in your prey's ash heap from the game to
    //  burn 3 of their pool."
    // The superior is UNDIRECTED even though it reaches into the prey's
    // ash heap — "an action that targets an ash heap is always considered
    // to be undirected" (glossary), which is why it carries no target.
    krcgId: 102295,
    name: "Shroud of Decay",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: "obl",
        effects: [
          { kind: "actionBleed", bonus: 1 },
          { kind: "targetDiscardsOnBleed", count: 2 },
        ],
      },
      {
        level: "superior",
        discipline: "obl",
        effects: [
          { kind: "actionRemoveFromAshHeap", whose: "prey", count: 7, burnPool: 3 },
        ],
      },
    ],
  },
  {
    // "+1 stealth HUNT action. Remove an ally in any Methuselah's ash heap
    //  from the game to gain 3 blood or to gain 2 blood and unlock."
    // A hunt, not a cardEffect — the action kind is printed and matters.
    krcgId: 102302,
    name: "Psychophagia",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          {
            kind: "actionRemoveFromAshHeap",
            whose: "any",
            count: 1,
            cardTypes: ["ally"],
            gainBlood: 3,
            unlockInstead: { blood: 2 },
          },
        ],
      },
    ],
  },
  {
    // "+1 stealth action.
    //  [obl] or [tha] Remove an ally in an ash heap from the game to gain
    //  2 blood or to add 2 life to a zombie ally you control.
    //  [OBL] or [THA] As above, but for 3 blood or life."
    // WHOLE as of 2026-09-03. The zombie half was blocked when this
    // shipped and stopped being blocked when the wraith/zombie gate
    // landed. `addAllyLife` enumerates one option per eligible recipient,
    // so the ally is chosen at announcement like any other target (p. 25),
    // and an ally already at its printed starting life is not offered —
    // the cap is `capacityOf` (docs/ledger-closeout.md §4).
    krcgId: 102335,
    name: "Putrescent Sustenance",
    cardType: "action",
    bloodCost: 0,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: ["obl", "tha"],
        effects: [
          { kind: "actionStealth", amount: 1 },
          {
            kind: "actionRemoveFromAshHeap",
            whose: "any",
            count: 1,
            cardTypes: ["ally"],
            gainBlood: 2,
            addAllyLife: { amount: 2, tag: "zombie" },
          },
        ],
      },
      {
        level: "superior",
        discipline: ["obl", "tha"],
        effects: [
          { kind: "actionStealth", amount: 1 },
          {
            kind: "actionRemoveFromAshHeap",
            whose: "any",
            count: 1,
            cardTypes: ["ally"],
            gainBlood: 3,
            addAllyLife: { amount: 3, tag: "zombie" },
          },
        ],
      },
    ],
  },
  {
    // "Only usable during the polling step of a political action.
    //  [pot][pre] This vampire gets +3 votes.
    //  [POT][PRE] Vampires who do not follow the Path of Power and the
    //  Inner Voice get -1 vote."
    //
    // The superior's filter is NEGATIVE, which is what made this the one
    // Path card that worked even while `MinionState.path` was empty: a
    // positive Path filter matched nothing, this matched everything
    // (docs/path-cards-design.md §2). With the crypt importer supplying
    // real Paths it now does what it prints — the 12 Path of Power
    // vampires are exempt and everyone else, the caster's own included,
    // loses a vote.
    //
    // The superior REPLACES the basic: it does not print "As above,
    // and…", so +3 and the −1 are alternatives.
    krcgId: 102308,
    name: "Absolute Tyranny",
    cardType: "modifierOrReaction",
    bloodCost: 1,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: { all: ["pot", "pre"] },
        effects: [{ kind: "modifyVotes", amount: 3 }],
      },
      {
        level: "superior",
        discipline: { all: ["pot", "pre"] },
        effects: [
          { kind: "modifyAllVotes", amount: -1, exceptPath: "Power and the Inner Voice" },
        ],
      },
    ],
  },
  {
    // "Put this card on a ready vampire who follows the Path of Cathari.
    //  If this vampire is blocked, the blocking minion's controller burns
    //  1 pool before block resolution. A vampire can have only one
    //  Terrifying Visage."
    //
    // Three clauses, three existing pieces plus one new static. The attach
    // filter is `attach.path` (a printed crypt trait, filtered like clan
    // and sect); "only one" is `exclusiveKey`, already enforced inside
    // `attachTargets`; and the toll is `blockedPoolToll` — NOT the
    // `blockedToll` Phantasmagoria uses, which charges the BEARER blood.
    // Same moment, other payer, other currency (docs/path-cards-design.md
    // §3). Paid on a successful block only: a failed attempt does not
    // block them.
    krcgId: 102343,
    name: "Terrifying Visage",
    cardType: "master",
    bloodCost: 0,
    poolCost: 1,
    permanent: {
      where: "bearer",
      statics: { blockedPoolToll: { amount: 1 } },
      tags: [],
      attach: { scope: "own", kind: "vampire", path: "Cathari" },
      exclusiveKey: "Terrifying Visage",
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique. Requires 2 or more ready vampires who follow the Path of
    //  Power and the Inner Voice. Put this card in play. After a
    //  referendum called by a vampire you control passes, you can lock
    //  this card to burn 1 pool from your prey."
    //
    // The requirement COUNTS, which is new: its three siblings ask whether
    // some ready vampire matches. The payout lives in
    // `referendum.afterResolution`, a window built for Voter Captivation
    // and friends that already opens only on a PASS and already offers
    // abilities of cards in play — so "passes" needs no test of its own
    // (docs/path-cards-design.md §4).
    krcgId: 102334,
    name: "Privileged Position",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    requiresControlledPath: { path: "Power and the Inner Voice", count: 2 },
    permanent: {
      where: "seat",
      statics: {},
      tags: [],
      afterReferendumBurn: { amount: 1, target: "prey" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Unique. Put this card in play. After a vampire who follows the Path
    //  of Cathari you control bleeds, if the bleed is successful (for 1 or
    //  more), add 1 counter to this card; otherwise, burn 1 counter from
    //  this card. After a vampire who follows the Path of Cathari you
    //  control performs an action, you can burn 2 counters from this card
    //  to unlock them."
    //
    // Both clauses hang off `onActionResolved`. Clause 1 is ONE hook
    // covering both directions on purpose: split across `onBleedSuccess`
    // and `onActionResolved` it would carry two definitions of "successful
    // (for 1 or more)" in two files, and a drift between them would make
    // the card add AND burn on the same bleed (docs/path-cards-design.md
    // §5). Clause 2 says "performs", not "successfully performs".
    krcgId: 102323,
    name: "Forward Momentum",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: [],
      pathBleedCounters: { path: "Cathari", amount: 1 },
      pathUnlockForCounters: { path: "Cathari", counters: 2 },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  // --- The token-vampire gate (docs/token-vampire-design.md). Unblocked
  //     by the owner 2026-09-03. Two cards, and they are the same card
  //     twice: a LIBRARY card that becomes a 1-capacity vampire, which is
  //     the ally machinery with `kind: "vampire"`. The token enters with 0
  //     blood, so "must hunt this turn" is p. 21's mandatory hunt and
  //     needs no code at all.
  {
    // "+1 stealth action. Requires a non-sterile Follower of Set with
    // capacity 5 or more. Put this card in play. It becomes a 1-capacity
    // (non-unique) Follower of Set and must hunt this turn. You can search
    // your library (shuffle afterward), hand, and/or ash heap for a
    // Discipline master card and put it on this new vampire."
    //
    // "Follower of Set" is the MINISTRY — the fifth card in the pool to
    // print a legacy clan name, and the reason
    // tests/cards/clan-vocabulary.test.ts exists. Both the requirement and
    // the created vampire read Ministry.
    krcgId: 102159,
    name: "Waters of Duat",
    cardType: "action",
    bloodCost: 1,
    requiresClan: ["Ministry"],
    requiresCapacity: 5,
    requiresNonSterile: true,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          {
            kind: "becomesVampire",
            capacity: 1,
            clan: "Ministry",
            searchDisciplineMaster: true,
          },
        ],
      },
    ],
  },
  {
    // "+1 stealth action. Requires a non-sterile baron. Put this card in
    // play. It becomes a 1-capacity (non-unique) Anarch vampire of the
    // same clan as the acting vampire and must hunt this turn. You can
    // search your library (shuffle afterward), hand and/or ash heap for a
    // Discipline master card and put it on this new vampire."
    krcgId: 102246,
    name: "Childe of the Revolution",
    cardType: "action",
    bloodCost: 1,
    requiresTitle: ["baron"],
    requiresNonSterile: true,
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          {
            kind: "becomesVampire",
            capacity: 1,
            clanFromActor: true,
            sect: "anarch",
            searchDisciplineMaster: true,
          },
        ],
      },
    ],
  },
  // --- The wraith/zombie gate (docs/wraith-zombie-design.md). Unblocked
  //     by the owner 2026-09-02; 14 cards, every remaining ally and the
  //     last reaction in the pool. "Wraith" and "zombie" appear NOWHERE in
  //     the rulebook — like "ghoul" they are printed words other cards
  //     filter on, so the sub-type is `ally.subtype` and carries no rules.
  {
    // "Unique wraith with 1 life. 1 strength, 1 bleed. Fiorella can lock
    // to give another wraith or zombie ally you control +1 stealth or +1
    // intercept."
    krcgId: 102322,
    name: "Fiorella, Empty One",
    cardType: "ally",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    ally: { life: 1, strength: 1, bleed: 1, subtype: "wraith" },
    permanent: {
      where: "bearer",
      statics: {},
      tags: [],
      // `permanent.lockGrant` is compiled inside the MASTER compiler and
      // never reaches an ally (the recorded structural limit), so this is
      // City Star Taxi's `lockForStealth` generalized to two grants and a
      // sub-type filter rather than a third spelling of the clause.
      allyAbilities: {
        lockForGrant: { amount: 1, grants: ["stealth", "intercept"], to: "undeadAlly" },
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "A vampire can play only one Shadow Sentinel between their unlock
    // phases.
    //  [obl] Only usable by a locked vampire. This vampire wakes.
    //  [OBL] Usable by a locked vampire. Choose a locked wraith or zombie
    //  ally you control. The chosen ally wakes."
    //
    // The superior drops the word "ONLY", which is the whole difference:
    // it may be played by an unlocked vampire, because the vampire is not
    // the one waking. So `byLockedMinion` sits on the basic mode alone —
    // the "widen the candidates if any mode wants it, then gate per mode"
    // shape the reaction compiler already uses.
    krcgId: 102294,
    name: "Shadow Sentinel",
    cardType: "reaction",
    bloodCost: 0,
    usable: ["oncePerUnlockPhase", "byVampire"],
    modes: [
      {
        level: "basic",
        discipline: "obl",
        usable: ["byLockedMinion"],
        effects: [{ kind: "wake" }],
      },
      {
        level: "superior",
        discipline: "obl",
        effects: [{ kind: "wakeOther", who: "undeadAlly" }],
      },
    ],
  },
  {
    // "Wraith with 1 life. 1 strength, 1 bleed.
    //  [obl] This ally can perform actions the turn it is recruited.
    //  Unlock this vampire if this is their first successful recruit ally
    //  action this turn. This ally can play non-action cards requiring
    //  basic Oblivion [obl] as a vampire. During your unlock phase, burn
    //  this ally.
    //  [OBL] As above, but during your unlock phase, you can burn 1 pool
    //  instead of burning this ally."
    //
    // A ghost that will not stay: it acts at once and is gone by your next
    // unlock phase unless the superior's pool is paid. "Non-action cards"
    // narrows p. 11's play-as-a-vampire rule, and is one gate where action
    // cards are enumerated rather than a second mechanism.
    krcgId: 102296,
    name: "Spectral Servitor",
    cardType: "ally",
    bloodCost: 1,
    poolCost: 0,
    ally: {
      life: 1,
      strength: 1,
      bleed: 1,
      subtype: "wraith",
      actsWhenRecruited: true,
      unlockRecruiterOnFirst: true,
      playsAsVampire: { obl: "basic" },
    },
    permanent: {
      where: "bearer",
      statics: { playsAsVampireNonActionOnly: true, unlockSelfBurn: {} },
      tags: [],
    },
    usable: [],
    modes: [
      { level: "basic", discipline: "obl", effects: [] },
      {
        level: "superior",
        discipline: "obl",
        statics: {
          playsAsVampireNonActionOnly: true,
          unlockSelfBurn: { payPoolInstead: 1 },
        },
        effects: [],
      },
    ],
  },
  {
    // "Zombie with 6 life. 3 strength, 0 bleed.
    //  [obl] After this ally enters play, burn it unless you remove an
    //  ally or vampire in your ash heap from the game. This ally cannot
    //  gain life. This ally can enter combat with a minion as a Ⓓ action
    //  that costs 1 life.
    //  [OBL] As above, and during the first round of each combat, this
    //  ally can burn 1 life to get 1 press."
    //
    // WHOLE as of 2026-09-03: burnt VAMPIRES now go to their owner's ash
    // heap (p. 34), so "an ally OR VAMPIRE in your ash heap" matches both
    // halves. A vampire's card carries no handler, so it answers no
    // printed type and is admitted by `includeCrypt` rather than by the
    // type filter (docs/ledger-closeout.md §9). An ally's life IS its
    // blood field (p. 11), so the rush's "costs 1 life" is an ordinary
    // blood cost.
    krcgId: 102304,
    name: "Rotting Behemoth",
    cardType: "ally",
    bloodCost: 3,
    poolCost: 0,
    ally: {
      life: 6,
      strength: 3,
      bleed: 0,
      subtype: "zombie",
      enterPlayAshCost: { cardTypes: ["ally"], includeCrypt: true },
    },
    rush: { targets: "minion", cost: { blood: 1 } },
    permanent: {
      where: "bearer",
      statics: { cannotGainLife: true },
      tags: [],
    },
    usable: [],
    modes: [
      { level: "basic", discipline: "obl", effects: [] },
      {
        // The press belongs to the SUPERIOR alone, so it rides in mode
        // statics rather than the card-level `allyAbilities` block.
        level: "superior",
        discipline: "obl",
        statics: {
          cannotGainLife: true,
          pressForLife: { life: 1, firstRoundOnly: true, selfOnly: true },
        },
        effects: [],
      },
    ],
  },
  {
    // "+1 stealth action. Put this card in play with 2 counters. During
    // your unlock phase, you can burn 1 counter from this card. You can
    // burn counters from no more than two Split the Veil cards each unlock
    // phase. If this card has no counters, burn it and move a wraith or
    // zombie ally from your ash heap to your ready region with life equal
    // to its starting life."
    //
    // The payoff is the first effect in the pool that puts a MINION back
    // into play (§5). It is a MOVE, not a recruit, so the ally can act at
    // once — p. 22's "cannot act the turn it is recruited" names an action
    // that did not happen here.
    krcgId: 102297,
    name: "Split the Veil",
    cardType: "action",
    bloodCost: 0,
    permanent: {
      where: "seat",
      statics: {},
      tags: [],
      unlockCountdown: { maxCardsPerPhase: 2, payoff: "returnUndeadAllyFromAshHeap" },
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "putInPlayOnSuccess", counters: 2 },
        ],
      },
    ],
  },
  {
    // "Unique wraith with 1 life. 1 strength, 1 bleed. The Heartrender can
    // remove itself from the game to burn a non-wraith non-zombie ally or
    // retainer as a +1 stealth Ⓓ action."
    //
    // The action itself is a bespoke overlay below (the Warsaw Station
    // shape): it targets either a MINION (an ally) or a CARD IN PLAY (a
    // retainer), which no single existing grant clause covers.
    krcgId: 102327,
    name: "Heartrender",
    cardType: "ally",
    bloodCost: 0,
    poolCost: 1,
    unique: true,
    ally: { life: 1, strength: 1, bleed: 1, subtype: "wraith" },
    permanent: { where: "bearer", statics: {}, tags: [] },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Zombie with 1 life. 1 strength, 1 bleed.
    //  [obl] This ally cannot have or use equipment or retainers. During a
    //  bleed action, you can lock another copy of this ally you control to
    //  give this ally +1 bleed.
    //  [OBL] As above, and during a bleed action, a Hecata you control can
    //  burn 1 blood to give this ally +1 bleed."
    //
    // "Another copy" is a query over minions with the same name, not
    // stored state. The superior's extra clause rides in MODE statics,
    // which already merge into the ally's entry (the Feral Hound shape).
    krcgId: 102293,
    name: "Bone Shambler",
    cardType: "ally",
    bloodCost: 1,
    poolCost: 0,
    ally: { life: 1, strength: 1, bleed: 1, subtype: "zombie" },
    permanent: {
      where: "bearer",
      statics: {
        cannotBeEquipped: { retainers: true },
        bleedFromCopy: { cost: "lockCopy", amount: 1 },
      },
      tags: [],
    },
    usable: [],
    modes: [
      { level: "basic", discipline: "obl", effects: [] },
      {
        level: "superior",
        discipline: "obl",
        statics: {
          cannotBeEquipped: { retainers: true },
          bleedFromCopy: { cost: "lockCopy", amount: 1 },
          bleedFromClanBlood: { clan: "Hecata", blood: 1, amount: 1 },
        },
        effects: [],
      },
    ],
  },
  {
    // "Zombie with 2 life. 1 strength, 1 bleed.
    //  [obl] This ally can burn 1 life to prevent 1 damage to another copy
    //  of this ally you control in combat. This ally cannot have or use
    //  equipment.
    //  [OBL] As above, and during a bleed action, this ally can burn 1
    //  life from another copy of this ally you control to get +1 bleed."
    //
    // The prevention is for a minion that is NOT the preventer, which is
    // exactly what `preventDamageFor` was built for (Martyr's Resilience).
    krcgId: 102326,
    name: "Gravebound Drone",
    cardType: "ally",
    bloodCost: 2,
    poolCost: 0,
    ally: { life: 2, strength: 1, bleed: 1, subtype: "zombie" },
    permanent: {
      where: "bearer",
      statics: {
        cannotBeEquipped: {},
        preventForCopy: { life: 1, amount: 1 },
      },
      tags: [],
    },
    usable: [],
    modes: [
      { level: "basic", discipline: "obl", effects: [] },
      {
        level: "superior",
        discipline: "obl",
        statics: {
          cannotBeEquipped: {},
          preventForCopy: { life: 1, amount: 1 },
          bleedFromCopy: { cost: "burnCopyLife", amount: 1 },
        },
        effects: [],
      },
    ],
  },
  {
    // "Unique location. After a zombie (ally or retainer) you control is
    // burned, you can add 1 counter to this location. During a bleed
    // action, you can burn 1 counter from this location to give a zombie
    // ally you control +1 bleed."
    //
    // The counter is taken automatically: it is costless, purely
    // beneficial, and this card has no clause that punishes holding them
    // (the Show of Force reading). The retainer half of "(ally or
    // retainer)" enumerates nothing — the pool has no undead retainers.
    krcgId: 102313,
    name: "Cursed Abattoir",
    cardType: "master",
    bloodCost: 0,
    poolCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location"],
      counterOnUndeadBurned: { tag: "zombie", amount: 1 },
      bleedForCounter: { amount: 1, tag: "zombie" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "+1 stealth action. Unique. Put this card in play with 4 counters.
    // Once each combat, you can burn 1 counter from this card to give a
    // wraith or zombie ally you control 1 maneuver or press. If this card
    // has no counters, burn it."
    krcgId: 102314,
    name: "Dance of the Dead",
    cardType: "action",
    bloodCost: 0,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: [],
      combatGrantForCounter: { grants: ["maneuver", "press"], burnWhenEmpty: true },
    },
    usable: [],
    modes: [
      {
        level: "basic",
        discipline: null,
        effects: [
          { kind: "actionStealth", amount: 1 },
          { kind: "putInPlayOnSuccess", counters: 4 },
        ],
      },
    ],
  },
  {
    // "Unique location. Hunting ground. During your unlock phase, a ready
    // vampire you control who follows the Path of Death and the Soul can
    // gain 1 blood, OR a wraith or zombie ally you control can gain 1
    // life, not to exceed its starting life. A vampire can gain blood from
    // only one hunting ground each turn."
    //
    // WHOLE as of 2026-09-03. This card sat on BOTH blocked lists; the
    // wraith/zombie gate closed its ally branch, and the Path branch
    // closed when a Path turned out to be a printed CRYPT trait rather
    // than something a card grants (docs/path-cards-design.md §0). The
    // vampire branch filters on `huntingGround.path`, the ally branch on
    // `undeadAllyLife`. docs/wraith-zombie-design.md §6
    krcgId: 102311,
    name: "Burial Site Hunting Ground",
    cardType: "master",
    bloodCost: 0,
    poolCost: 2,
    unique: true,
    permanent: {
      where: "seat",
      statics: {},
      tags: ["location", "hunting ground"],
      // `clan`/`sect`/`title` would be the vampire filter; the Path one has
      // no field because the engine models no Paths. Setting `amount: 0`
      // would be a lie, so the vampire branch simply has no filter it can
      // pass: `path` is unmodelled, and the ally branch is what plays.
      huntingGround: { amount: 1, undeadAllyLife: 1, path: "Death and the Soul" },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Wraith with 1 life. 1 strength, 1 bleed. You can burn this ally to
    // give a minion controlled by your predator or prey -1 stealth. You
    // can burn this ally as an action directed at an ally you control is
    // announced to have it fail."
    //
    // Two burn-self abilities with different windows: the first is a
    // stealth effect and lives where stealth is read; the second is the
    // Szlachta Bodyguard clause — the action FAILS rather than being
    // blocked, so no combat follows.
    krcgId: 102292,
    name: "Screamer",
    cardType: "ally",
    bloodCost: 0,
    poolCost: 1,
    ally: { life: 1, strength: 1, bleed: 1, subtype: "wraith" },
    permanent: {
      where: "bearer",
      statics: {},
      tags: [],
      allyAbilities: {
        burnForStealthPenalty: { amount: 1, whose: "predatorOrPrey" },
        burnToFailAction: { targetKind: "ally" },
      },
    },
    usable: [],
    modes: [{ level: "basic", discipline: null, effects: [] }],
  },
  {
    // "Only usable as an action to recruit or employ a wraith or zombie is
    //  announced.
    //  [obl] +1 stealth, even if stealth is not yet needed.
    //  [OBL] As above, and if the action is successful, this vampire can
    //  burn 1 blood to unlock after action resolution."
    krcgId: 102300,
    name: "Paths in Two Worlds",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: ["asUndeadRecruit"],
    modes: [
      {
        level: "basic",
        discipline: "obl",
        usable: ["evenIfNotNeeded"],
        effects: [{ kind: "modifyStealth", amount: 1 }],
      },
      {
        level: "superior",
        discipline: "obl",
        usable: ["evenIfNotNeeded"],
        effects: [
          { kind: "modifyStealth", amount: 1 },
          { kind: "unlockAfterResolution", blood: 1, target: "self", ifSuccessful: true },
        ],
      },
    ],
  },
  {
    // "Only usable by a ready unlocked vampire other than the acting
    //  wraith or zombie ally.
    //  [dom] or [obl] The acting ally gets +1 bleed (limited).
    //  [DOM] or [OBL] As above, and after action resolution, this vampire
    //  can burn 1 blood to unlock the acting ally."
    //
    // p. 12: an action modifier played by a minion OTHER than the acting
    // one is still the acting Methuselah's card. Deferred when the
    // other-vampire gate was built, for want of the wraith/zombie half.
    krcgId: 102325,
    name: "Gifts From Hereafter",
    cardType: "actionModifier",
    bloodCost: 0,
    usable: ["byOtherUnlockedVampire", "actingIsUndeadAlly"],
    modes: [
      {
        level: "basic",
        discipline: ["dom", "obl"],
        effects: [{ kind: "modifyBleed", amount: 1, limited: true }],
      },
      {
        level: "superior",
        discipline: ["dom", "obl"],
        effects: [
          { kind: "modifyBleed", amount: 1, limited: true },
          { kind: "unlockAfterResolution", blood: 1, target: "actingMinion" },
        ],
      },
    ],
  },
];

/**
 * THE CRYPT (docs/crypt-plan.md, docs/crypt-wave-1.md).
 *
 * A crypt card is never played — a vampire is influenced out — so these
 * specs carry no cost, no modes and no play window. Their whole content
 * is a `permanent` block, which rides onto the vampire as a
 * SELF-ATTACHED ENTRY exactly as an ally's card text does. That is what
 * lets the entire `permanent` vocabulary reach crypt abilities without a
 * second set of rules.
 *
 * **118 of the 217 crypt cards need no spec at all** — their text is a
 * bare sect/title line, which the importer already reads. Only a card
 * with real ability text appears here.
 *
 * Wave 1 is the STATICS: flat traits, and traits conditioned on the
 * action, the acting minion, or the board. Nothing here needs a hook.
 */
export const cryptSpecs: CardSpec[] = [
  // --- Flat traits. The whole ability is one printed line. ---
  flatCrypt(201540, "Catalina Vega (G6)", { bleed: 1 }),
  flatCrypt(201555, "Lenny Burkhead (G6)", { bleed: 1 }),
  flatCrypt(201597, "Kamile Paukstys (G6)", { bleed: 1 }),
  flatCrypt(201602, "Massimiliano (G6)", { strength: 1 }),
  flatCrypt(201614, "Valeriya Zinovieva (G6)", { strength: 1 }),
  flatCrypt(201715, "Rinaldo Albizzi (G6)", { intercept: 1 }),
  flatCrypt(201739, "Anousha, The Maniac (G6)", { strength: 1 }),
  flatCrypt(201783, "Hafthor Thorsteinsson (G7)", { intercept: 1 }),

  // --- Conditioned on the ACTION being performed. ---
  condCrypt(200132, "Ariane (G5)", [{ stealth: -1, actionDirected: false }]),
  condCrypt(201545, "The Dowager (G6)", [{ intercept: 1, actionDirected: true }]),
  condCrypt(201601, "Martina Srnankova (G6)", [{ intercept: 1, actionKinds: ["bleed"] }]),
  condCrypt(201656, "Oluwafunmilayo (G6)", [
    // A political action announces as `cardEffect`; what tells it apart is
    // the printed type of the announcing card (the Depravity precedent).
    { intercept: 1, actionCardTypes: ["politicalAction"] },
  ]),
  condCrypt(201668, "Castellan (G7)", [
    { intercept: 1, actionDirected: true },
    { intercept: -1, actionDirected: false },
  ]),
  condCrypt(201777, "Verrix, Naughty Boy (G6)", [{ stealth: 1, actionKinds: ["bleed"] }]),
  condCrypt(201752, "Frau Schädel (G6)", [
    { stealth: 1, actionCardTypes: ["ally", "retainer"] },
  ]),
  condCrypt(201759, "Kalyani, Agent of Doom (G6)", [
    { stealth: -1, actionKinds: ["hunt"] },
  ], { strength: 1 }),

  // --- Conditioned on the ACTING MINION (who is coming at you). ---
  condCrypt(201538, "Bret Stryker (G6)", [
    { intercept: -1, actingMinion: { titled: true } },
  ]),
  condCrypt(201710, "Azucena (G6)", [
    // "Younger"/"older" are relative to Azucena's own derived capacity.
    { intercept: 1, actingMinion: { clan: "Lasombra", younger: true } },
    { intercept: -1, actingMinion: { clan: "Lasombra", older: true } },
  ]),
  condCrypt(201767, "Osvaldo Kühnemann (G6)", [
    {
      bleed: 1,
      actionKinds: ["bleed"],
      controller: { targetControlsClan: ["Toreador", "Ventrue"] },
    },
  ]),

  // --- Conditioned on the BOARD. Every one derived on each read. ---
  condCrypt(201667, "Branimira (G6)", [{ intercept: 1, controller: { poolAtMost: 9 } }]),
  condCrypt(201748, "Devorah (G6)", [{ stealth: 1, controller: { poolAtMost: 5 } }]),
  condCrypt(201740, "Anxo Vilela (G6)", [{ strength: 1, controller: { hasEdge: true } }]),
  condCrypt(201747, "Damian (G6)", [
    { bleed: 1, controller: { controlsReadyTitle: ["cardinal"] } },
  ]),
  condCrypt(201625, "Carmelita Neillson (G7)", [{ handSize: 1 }]),
  condCrypt(201760, "Khin Aye (G6)", [
    { handSize: 1, controller: { predatorHasMoreReadyMinions: true } },
  ]),
  condCrypt(201678, "Neserian (G6)", [
    { bleed: -1, controller: { locations: "none" } },
    { votes: 1, controller: { locations: "some" } },
  ]),
  condCrypt(201775, "Üresség (G6)", [
    { votes: 1, controller: { preyPoolAtMost: 10 } },
    { bleed: 1, controller: { preyPoolAtMost: 10 } },
  ]),

  // --- Combat statics the engine already grants from a card in play. ---
  flatCrypt(201658, "Saku Pihlajamäki (G6)", { maneuverPerCombat: 1 }),
  flatCrypt(201772, "Serhat Gunde, Combat Junkie (G6)", { pressPerCombat: 1 }),
  flatCrypt(201663, "Abaddon (G7)", { maneuverPerCombat: 1, pressPerCombat: 1 }),

  // --- Blocking. All three statics already exist; one was built the day
  //     before this wave for a library card that prints Aelswith's line. ---
  flatCrypt(201758, "Jürgen, The Libertine (G6)", {
    // "Minions must burn 1 blood OR LIFE to attempt to block" — the
    // or-life half is what lets an ALLY pay at all (p. 22).
    blockToll: { amount: 1, payWith: "bloodOrLife" },
  }),
  flatCrypt(201735, "Aelswith, The Irresistible (G6)", {
    // Word for word Terrifying Visage's clause (docs/path-cards-design.md
    // §3), which is why this card cost nothing to add.
    blockedPoolToll: { amount: 1 },
  }),
  // --- WAVE 2: granted actions and unlock riders
  //     (docs/crypt-wave-2.md). Every one of these runs on machinery the
  //     library waves already built; the crypt card is data.

  // "Can enter combat with a minion as a Ⓓ action" — the ally rush
  // clause, word for word, on a vampire.
  rushCrypt(201613, "Theo Bell (G6)", { targets: "minion" }, { strength: 1 }),
  rushCrypt(201781, "Barachiel (G7)", { targets: "minion" }),
  rushCrypt(201729, "Dafina Hanganu (G6)", { targets: "minion" }),
  // "…with a LOCKED vampire": `enumerateRushTargets` has always
  // understood this filter; nothing had asked for it.
  rushCrypt(201632, "Nathaniel Bordruff (G6)", { targets: "vampire", lockedOnly: true }),

  // Unlock riders. "Can unlock after performing a successful action" is
  // the largest single shape in the crypt.
  cryptPerm(201733, "Aaradhya, The Callous Tyrant (G6)", {
    // "…after performing a successful POLITICAL action (even if the
    // referendum failed)". The parenthetical is not a special case here:
    // a political action's own success is whether it was blocked, which
    // is independent of the referendum's outcome (p. 27).
    statics: { bleed: 1 },
    unlockAfterAction: {
      whose: "self",
      unlocks: "self",
      actionCardTypes: ["politicalAction"],
    },
  }),
  cryptPerm(201659, "Keegan (G6)", {
    // "Once each turn … a successful action REQUIRING A GANGREL" — a
    // property of the card played, read through `requiresClans`.
    unlockAfterAction: {
      whose: "self",
      unlocks: "self",
      oncePerTurn: true,
      requiresClan: ["Gangrel"],
    },
  }),
  cryptPerm(201576, "Aline Gädeke (G6)", {
    // "…after ANOTHER ANARCH YOU CONTROL performs a successful action."
    unlockAfterAction: {
      whose: "other",
      otherSect: "anarch",
      unlocks: "self",
      bloodCost: 1,
      oncePerTurn: true,
    },
  }),
  cryptPerm(201725, '"Mother" Anja Giovanni (G6)', {
    // The one that unlocks somebody ELSE: "…after another Hecata you
    // control performs a successful action requiring Hecata or Oblivion
    // [obl] to unlock THAT HECATA."
    unlockAfterAction: {
      whose: "other",
      otherClan: "Hecata",
      unlocks: "actor",
      bloodCost: 1,
      oncePerTurn: true,
      requiresClan: ["Hecata"],
      requiresDiscipline: ["obl"],
    },
  }),
  cryptPerm(201771, "Sakura, The Merciless (G6)", {
    // "During your turn … a successful action requiring the Path of Death
    // and the Soul." A Path is printed on the CRYPT card, so the
    // requirement is a property of the acting vampire
    // (docs/path-cards-design.md §0).
    unlockAfterAction: {
      whose: "self",
      unlocks: "self",
      bloodCost: 1,
      ownTurnOnly: true,
      requiresPath: "Death and the Soul",
    },
  }),
  cryptPerm(201570, "Sybren van Oosten (G6)", {
    // "After a referendum called by him passes" — the
    // `referendum.afterResolution` window, which opens only on a pass.
    unlockAfterOwnReferendum: true,
  }),
  cryptPerm(201596, "Kalinda (G6)", {
    // "During your turn, you can burn the Edge to unlock Kalinda."
    unlockForEdge: true,
  }),

  // Library searches. The gate's rules carry over unchanged: you need not
  // announce what you seek, finding nothing is always legal, and the
  // library is shuffled either way (p. 14, p. 48).
  cryptPerm(201671, "Dominica (G7)", {
    // "…a master ARCHETYPE card" — a printed sub-type, matched on the
    // card's own tag rather than on a list of names that could rot.
    searchToHand: { cardTypes: ["master"], tag: "archetype", stealth: 1 },
  }),
  cryptPerm(201685, "Sakhar (G7)", {
    searchToHand: { cardTypes: ["equipment"], stealth: 1 },
  }),

  // "Rescuing a vampire from torpor costs Doc Martina −1 blood" — the
  // static built for Saulot's Healing Touch, read at BOTH the enumeration
  // and the payment site (docs/minion-target-actions-design.md).
  flatCrypt(201670, "Doc Martina (G7)", { rescueDiscount: { amount: 1 } }),

  // --- WAVE 3: combat and blocking (docs/crypt-wave-3.md).

  // "If <this vampire> is blocked, they burn 1 blood before block
  // resolution" — Phantasmagoria's `blockedToll`, word for word.
  flatCrypt(201677, "Marialena (G6)", {
    blockedToll: { amount: 1, payWith: "blood" },
  }),

  // Granted strikes. Flávio prints Treasured Samadji's clause exactly;
  // Agnieszka is the same shape with a price and a different strike.
  cryptPerm(201547, "Flávio Gonçalves (G6)", {
    grantsStrikePerCombat: { kind: "dodge" },
  }),
  cryptPerm(201736, "Agnieszka, Tempter of Legions (G6)", {
    statics: { bleed: 1 },
    grantsStrikePerCombat: { kind: "combatEnds", bloodCost: 1 },
  }),

  // Strength conditioned on WHO you are fighting — read off the live
  // combat frame, so it needs no cleanup when the fight ends.
  condCrypt(201629, "Kevin Jackson (G7)", [
    { strength: 1, inCombatWith: { clan: "Brujah" } },
  ], {
    // "Brujah get +1 strength in combat with him" — the mirror half, a
    // bonus he hands to whoever is fighting him.
    opposingStrengthBonus: { amount: 1, clan: "Brujah" },
  }),
  condCrypt(201660, "Ragnar Nordstrom (G6)", [
    // "…an ally OR younger vampire": the English "and/or" of two groups,
    // so two entries rather than one intersection (the union reading,
    // docs/opposing-statics-design.md).
    { strength: 1, inCombatWith: { kind: "ally" } },
    { strength: 1, inCombatWith: { kind: "vampire", younger: true } },
  ], {
    // "Cards requiring Protean [pro] cost Ragnar −1 blood."
    playCostMod: {
      amount: -1,
      pays: "blood",
      requiresDiscipline: ["pro"],
      minions: "bearer",
    },
  }),
  cryptPerm(201684, "Roy (G7)", {
    statics: { conditional: [{ strength: 1, inCombatWith: { titled: true } }] },
    // "If Roy is unlocked during your discard phase, lock him" — the
    // price of the strength, and automatic: the card says "lock him",
    // not "you can" (the Rebel precedent).
    lockAtDiscardPhase: true,
  }),

  // "After a minion in combat with Egidia leaves the ready region, their
  // controller burns 1 pool" — the `onCombatLeave` hook, built for Dead
  // Pool.
  cryptPerm(201730, "Egidia Arrú (G6)", {
    statics: { strength: 1 },
    combatLeaveDrain: 1,
  }),

  // "Once each round of combat, can burn 1 blood to make the damage from
  // his hand strikes aggravated that round."
  cryptPerm(201745, "Crossbreaker (G6)", {
    aggravatedForBlood: { blood: 1 },
  }),

  // Prevention for somebody ELSE — the bystander prevention Martyr's
  // Resilience built, as an ability of a card in play.
  cryptPerm(201680, "Opikun (G7)", {
    preventForOther: { blood: 1, amount: 2, nonAggravated: true, kind: "vampire" },
  }),
  cryptPerm(201757, "Huldu, The Desecrator (G6)", {
    statics: { bleed: 1 },
    preventForOther: { blood: 1, amount: 1 },
  }),

  // "1 press (mandatory) each combat, only usable to continue combat" —
  // `continuePressPerCombat`, built for Righteous Blade.
  flatCrypt(201664, "Adrino Manauara (G6)", { continuePressPerCombat: 1 }),

  // "Inflicts +1 damage with ranged strikes (even at close range)."
  flatCrypt(201785, "Noluthando (G7)", { rangedDamageBonus: 1 }),

  flatCrypt(201770, 'Rexton "Savage" Abernathy (G6)', {
    // "Allies AND vampires with capacity 3 or less cannot block" — the
    // English "and" is a UNION of two groups, the reading recorded in
    // docs/opposing-statics-design.md.
    cannotBeBlockedBy: { kinds: ["ally"], maxCapacity: 3 },
  }),

  // ---- Wave 4: the discard-for-a-bonus family (docs/crypt-wave-4.md §1)
  // Seven cards, one clause. Cost and payoff are independent, so each
  // card is data: which card leaves the hand, what is bought, and in
  // which window the trade is offered.

  // "During the polling step of ANY referendum, <they> can discard a card
  // requiring <Discipline> to get +1 vote." Any referendum, not only
  // their own — the window is `referendum.polling`, which already cycles
  // every seat.
  cryptPerm(201529, "Alexa Draper (G6)", {
    discardFor: { requiresDiscipline: "dom", when: "polling", grant: "votes", amount: 1 },
  }),
  cryptPerm(201716, "Yewon Ong (G6)", {
    discardFor: { requiresDiscipline: "obl", when: "polling", grant: "votes", amount: 1 },
  }),

  // "During a bleed action, Larissa can discard a card requiring
  // Animalism to get +1 bleed." Not "(limited)": an ability of a card in
  // play, not an action MODIFIER card (the Club Illusion reading).
  cryptPerm(201553, "Larissa Moreira (G6)", {
    discardFor: { requiresDiscipline: "ani", when: "bleedAction", grant: "bleed", amount: 1 },
  }),

  // "During an action, Abraham can discard a card requiring Blood
  // Sorcery to get +1 intercept OR +1 stealth" — the two ends of a
  // block, each gated by p. 26's only-when-needed rule separately.
  cryptPerm(201623, "Abraham DuSable (G6)", {
    discardFor: {
      requiresDiscipline: "tha",
      when: "anyAction",
      grant: "interceptOrStealth",
      amount: 1,
    },
  }),

  // "Once each combat, Kasim can discard a POLITICAL ACTION card before
  // range is determined to get +2 strength THAT COMBAT. +1 bleed."
  // Combat-long, so `addCombatStrengthTo`, not the round-scoped sibling.
  cryptPerm(201598, "Kasim Bayar (G6)", {
    statics: { bleed: 1 },
    discardFor: {
      cardTypes: ["politicalAction"],
      when: "beforeRange",
      grant: "combatStrength",
      amount: 2,
      oncePerCombat: true,
    },
  }),

  // "Once each combat, Phaibun can discard a card AT RANDOM to strike:
  // dodge." The randomness is the whole cost — one option with no card
  // named, rolled at use rather than at enumeration.
  cryptPerm(201681, "Phaibun (G7)", {
    discardFor: {
      random: true,
      when: "chooseStrike",
      grant: "dodge",
      amount: 1,
      oncePerCombat: true,
    },
  }),

  // "Cards requiring Hecata AND/OR Oblivion cost Roger −1 blood. Once
  // each turn, if Roger is READY during a combat involving a minion you
  // control, he can discard a card requiring Oblivion to give that minion
  // 1 maneuver." Two clauses: the cost union (§2) and the family above,
  // with the recipient enumerated because Roger need not be in the fight.
  cryptPerm(201732, "Roger de Camden (G6)", {
    statics: {
      playCostMod: {
        amount: -1,
        pays: "blood",
        requiresClan: ["Hecata"],
        requiresDiscipline: ["obl"],
        clanOrDiscipline: true,
        minions: "bearer",
      },
    },
    discardFor: {
      requiresDiscipline: "obl",
      when: "ownMinionCombat",
      grant: "maneuverToCombatant",
      amount: 1,
      oncePerTurn: true,
    },
  }),

  // ---- Wave 4: play-cost modifiers that were already data (§2)

  // "Animals (allies and retainers) cost Kuyén −1 blood or pool."
  // "Animal" is a printed sub-type, already in the tag vocabulary.
  flatCrypt(201574, "Kuyén (G6)", {
    playCostMod: { amount: -1, pays: "bloodOrPool", tags: ["animal"], minions: "bearer" },
  }),

  // "Allies and retainers requiring a Tzimisce cost Máddji −1 blood or
  // pool" — the clan half off the `requiresClans` central query.
  flatCrypt(201784, "Máddji, Mistress of Szlachtas (G6)", {
    playCostMod: {
      amount: -1,
      pays: "bloodOrPool",
      cardTypes: ["ally", "retainer"],
      requiresClan: ["Tzimisce"],
      minions: "bearer",
    },
  }),

  // "Hesha gets +1 bleed for each UNIQUE equipment attached to him" — a
  // count over his own attachments, uniqueness carried as a tag (§3).
  flatCrypt(201591, "Hesha Ruhadze (G6)", {
    bleedPerAttached: { tags: ["equipment", "unique"], amount: 1 },
  }),

  // "After Gostoso successfully bleeds YOUR PREY (for 1 or more), he can
  // gain 1 blood." Costless, purely beneficial and unpunished by anything
  // on the card, so it is taken automatically (the Cursed Abattoir
  // reading); `BloodGained` clamps at capacity, so it can never hurt.
  cryptPerm(201754, "Gostoso (G6)", {
    bleedSuccessBlood: { amount: 1, preyOnly: true },
  }),

  // "During a bleed action, Liliana can REMOVE SEVEN CARDS IN YOUR ASH
  // HEAP FROM THE GAME to get an additional +1 bleed. +1 bleed." The
  // discard-for-a-bonus clause with a different currency, which is what
  // splitting cost from payoff was for (§1).
  cryptPerm(201722, "Marchesa Liliana (G6)", {
    statics: { bleed: 1 },
    discardFor: { fromAshHeap: 7, when: "bleedAction", grant: "bleed", amount: 1 },
  }),

  // "If Sreelekha is ready at the start of your discard phase, you get +1
  // discard phase action. +1 bleed."
  cryptPerm(201687, "Sreelekha (G7)", {
    statics: { bleed: 1 },
    discardPhaseActions: 1,
  }),

  // "During an action, Abderrahim can burn 1 blood to give an ally or
  // younger vampire you control +1 stealth. +1 strength."
  cryptPerm(201734, "Abderrahim, Death's Hand (G6)", {
    statics: { strength: 1 },
    stealthGrant: { blood: 1, amount: 1, who: { allies: true, younger: true } },
  }),

  // "Once each turn, after resolution of an action performed by
  // Věnceslava during which your prey burned 1 or more pool, you can gain
  // 1 pool."
  cryptPerm(201776, "Věnceslava, The Implacable (G6)", {
    actionPoolGain: { amount: 1, preyBurnedPool: true, oncePerTurn: true },
  }),

  // ---- Wave 5: granted actions with a cost (docs/crypt-wave-5.md §1)
  // Six cards, one clause. Every effect was an op that already existed;
  // what the clause supplies is the shared shape — one option per legal
  // answer, fixed at announcement, paid at resolution.

  // "Seraphina can add 2 blood or life to a minion you control as a +1
  // stealth action, NOT TO EXCEED STARTING LIFE." Undirected: the target
  // is her own controller's minion, so nobody else is being acted upon.
  cryptPerm(201686, "Seraphina (G7)", {
    grantedAction: { do: "addBlood", stealth: 1, amount: 2, capped: true },
  }),

  // "Saankaláxt can steal an equipment as a Ⓓ action that costs 1 blood."
  cryptPerm(201786, "Saankaláxt (G6)", {
    grantedAction: { do: "stealEquipment", bloodCost: 1, directed: true },
  }),

  // "Lenelle can exchange a card from your hand for a LIBRARY card in
  // your ash heap as a +1 stealth action that costs 1 blood."
  cryptPerm(201721, "Lenelle, Mambo of Birmingham (G6)", {
    grantedAction: { do: "ashExchange", stealth: 1, bloodCost: 1 },
  }),

  // "Hel-Blá can move an ally requiring Hecata OR Oblivion from your ash
  // heap to your ready region, LOCKED, with life equal to its starting
  // life, as a +1 stealth action that costs 1 blood."
  cryptPerm(201731, "Hel-Blá (G6)", {
    grantedAction: {
      do: "reviveAlly",
      stealth: 1,
      bloodCost: 1,
      requiresClan: ["Hecata"],
      requiresDiscipline: ["obl"],
    },
  }),

  // "Eulogio can look at and reorder the top 5 cards of your library, AND
  // UNLOCK, as a +1 stealth action that costs 1 blood." The unlock is a
  // real effect: he locked at announcement (p. 25).
  cryptPerm(201750, "Eulogio Sánchez de los Reyes (G6)", {
    grantedAction: { do: "reorderTop", stealth: 1, bloodCost: 1, amount: 5, unlockActor: true },
  }),

  // "Aniel can burn 1 corruption counter OR a card requiring a Discipline
  // from ANOTHER ready minion as a +1 stealth Ⓓ action that costs 1
  // blood."
  cryptPerm(201666, "Aniel (G7)", {
    grantedAction: { do: "stripMinion", stealth: 1, bloodCost: 1, directed: true },
  }),

  // ---- Wave 5: filters on the minion opposite you (§3–§4)

  // "In combat, strike cards cost the opposing minion +1 blood or life.
  // +1 stealth." `bloodOrLife` is load-bearing: p. 22 gives allies life,
  // so a cost printed in blood alone would exempt them entirely.
  flatCrypt(201782, "Djeneba (G7)", {
    stealth: 1,
    playCostMod: {
      amount: 1,
      pays: "bloodOrLife",
      cardTypes: ["strike"],
      opposingBearer: {},
    },
  }),

  // "Strike cards cost opposing YOUNGER vampires +1 blood." Blood, not
  // blood-or-life — and "younger vampires" excludes allies twice over.
  flatCrypt(201738, "Algirdas, The Solar Prophet (G6)", {
    playCostMod: {
      amount: 1,
      pays: "blood",
      cardTypes: ["strike"],
      opposingBearer: { youngerOnly: true },
    },
  }),

  // "Minions with any of your corruption counters in combat with Faruq
  // cannot strike: combat ends. +1 strength."
  flatCrypt(201588, "Faruq Abd al-Qadir (G6)", {
    strength: 1,
    opposingCannotCombatEnds: { yourCorruption: true },
  }),

  // "Minions with 1 or more of your corruption counters must burn 1 blood
  // or life to attempt to block Sergio."
  flatCrypt(201662, "Sergio Bueno (G6)", {
    blockToll: { amount: 1, payWith: "bloodOrLife", yourCorruption: true },
  }),

  // ---- Wave 5: phase hooks that ask a question (§5)

  // "If Mora is ready during your discard phase, you can move a LIBRARY
  // card from your ash heap to the BOTTOM of your library. +1 bleed."
  cryptPerm(201724, "Mora, the Death Seer (G6)", {
    statics: { bleed: 1 },
    discardPhaseChoice: { do: "ashToLibraryBottom" },
  }),

  // "During your discard phase, you can move an ANIMAL retainer from a
  // vampire you control to another vampire you control."
  cryptPerm(201675, "Luciano Carvalho (G7)", {
    discardPhaseChoice: { do: "moveAnimalRetainer", tag: "animal" },
  }),

  // "If Aemilius is ready during your unlock phase, YOUR PREY chooses a
  // ready minion they control; the chosen minion takes 1 unpreventable
  // damage." The choice belongs to the prey, and it is mandatory.
  cryptPerm(201712, "Gnaeus Aemilius Augustinus (G6)", {
    unlockPhaseDamage: { amount: 1 },
  }),

  // ---- Wave 6: the referendum tail (docs/crypt-wave-6.md)

  // "Jason gets +2 votes when casting votes AGAINST BLOOD HUNT
  // referendums. +1 bleed." The only vote static that depends on which
  // way the vote is being cast.
  flatCrypt(201628, 'Jason "Son" Newberry (G6)', {
    bleed: 1,
    voteBonus: { amount: 2, direction: "against", variant: "bloodHunt" },
  }),

  // "Vampires must burn 1 blood to cast votes and ballots against
  // referendums called by Alexander." Carried by the CALLING minion and
  // paid by each voter — the block-tax shape one frame over.
  flatCrypt(201530, "Alexander Silverson (G6)", {
    voteTollAgainst: { blood: 1 },
  }),

  // "If the referendum of a political action called by Cedrick is
  // CANCELED OR FAILS, he goes to torpor after resolution."
  cryptPerm(201626, "Cedrick Calhoun (G6)", {
    torporOnReferendumLoss: true,
  }),

  // "While Ashur-uballit is ready, ZOMBIES (allies and retainers) you
  // recruit or employ get +1 starting life. +1 bleed." Read at the entry
  // path, and it raises `capacity` too — for an ally that field IS the
  // printed starting life (p. 11).
  flatCrypt(201741, "Ashur-uballit, Son of the Abyss (G6)", {
    bleed: 1,
    recruitLifeBonus: { amount: 1, tag: "zombie" },
  }),

  // "After Fotini successfully bleeds (for 1 or more), you get +1 hand
  // size UNTIL YOUR NEXT DISCARD PHASE." Note: any bleed, not only one
  // against the prey — the card names no target.
  cryptPerm(201751, "Fotini Katsikaris (G6)", {
    bleedSuccessHandSize: { amount: 1 },
  }),

  // ---- Wave 7: the last seven (docs/crypt-wave-7.md)

  // "As a minion announces an action DIRECTED AT EVAN, flip a coin; if it
  // is tails, the action fails." Automatic — "flip", not "you can flip".
  cryptPerm(201627, "Evan Klein (G6)", {
    coinFlipOnDirected: { failOn: "tails" },
  }),

  // "If you control a LOCKED MINION, Elen must bleed with +1 bleed as a Ⓓ
  // action unless she must hunt." A STATIC, not a `permanent` clause: it
  // is read straight off the entry by `minionPhaseOptions` and
  // `currentBleed`, neither of which consults a card's spec.
  flatCrypt(201585, "Elen Kamjian (G6)", {
    mustBleed: { bonus: 1, whileControlsLocked: true },
  }),

  // "If Nonu Dis is ready during your master phase, you can add 1 blood
  // to a ready Follower of Set you control AFTER PLAYING A MASTER CARD.
  // +1 bleed." "Follower of Set" is the MINISTRY — the sixth card in the
  // pool to print a legacy clan name.
  cryptPerm(201608, "Nonu Dis (G6)", {
    statics: { bleed: 1 },
    afterMasterPlayed: { blood: 1, clan: "Ministry" },
  }),

  // "During an action Gathii performs, you can reveal the top card of
  // your library. If it is a master card, he burns 1 blood; otherwise, he
  // gets +1 stealth." A gamble: the option deliberately does not say what
  // the card is.
  cryptPerm(201672, "Gathii (G7)", {
    revealTopCard: { ifTypes: ["master"], thenBurnBlood: 1, elseStealth: 1 },
  }),

  // "Once each turn, if Ilonka is ready AFTER A SUCCESSFUL BLEED AGAINST
  // YOU, she can look at the acting minion's controller's hand, then she
  // can discard 1 card at random from it."
  cryptPerm(201673, "Ilonka (G7)", {
    peekAndRandomDiscard: true,
  }),

  // "While Parijat is ready, minions must BURN THE TOP CARD OF THEIR
  // LIBRARY to attempt to block wraith or zombie allies."
  flatCrypt(201726, "Parijat, the Dark Oracle (G6)", {
    globalBlockToll: { payWith: "libraryCard", actorTags: ["wraith", "zombie"] },
  }),

  // "Once each turn, if he is ready, Tommaso can burn 1 blood before
  // range is determined in a combat involving a wraith or zombie ally you
  // control to end that combat." He need not be in the combat himself.
  cryptPerm(201728, "Tommaso Sforza (G6)", {
    combatEndGrant: {
      ownMinionTags: ["wraith", "zombie"],
      bloodCost: 1,
      oncePerTurn: true,
      requiresBearerReady: true,
    },
  }),
];

/** A crypt card whose whole ability is unconditional statics. */
function flatCrypt(krcgId: number, name: string, statics: PermanentStatics): CardSpec {
  return {
    krcgId,
    name,
    cardType: "crypt",
    bloodCost: 0,
    poolCost: 0,
    permanent: { where: "bearer", statics, tags: [] },
    usable: [],
    modes: [],
  };
}

/** A crypt card whose ability is a Ⓓ rush, plus any flat statics. */
function rushCrypt(
  krcgId: number,
  name: string,
  rush: NonNullable<CardSpec["rush"]>,
  statics: PermanentStatics = {},
): CardSpec {
  return {
    krcgId,
    name,
    cardType: "crypt",
    bloodCost: 0,
    poolCost: 0,
    rush,
    permanent: { where: "bearer", statics, tags: [] },
    usable: [],
    modes: [],
  };
}

/** A crypt card carrying one of the richer `permanent` clauses — an
 *  unlock rider, a search, an Edge cost. `statics` rides along for the
 *  cards that print a flat trait as well ("+1 bleed"). */
function cryptPerm(
  krcgId: number,
  name: string,
  perm: Partial<NonNullable<CardSpec["permanent"]>>,
): CardSpec {
  return {
    krcgId,
    name,
    cardType: "crypt",
    bloodCost: 0,
    poolCost: 0,
    permanent: { where: "bearer", statics: {}, tags: [], ...perm },
    usable: [],
    modes: [],
  };
}

/** A crypt card with conditional statics, and optionally flat ones too
 *  ("Kalyani gets −1 stealth when hunting. +1 strength."). */
function condCrypt(
  krcgId: number,
  name: string,
  conditional: ConditionalStatic[],
  flat: PermanentStatics = {},
): CardSpec {
  return {
    krcgId,
    name,
    cardType: "crypt",
    bloodCost: 0,
    poolCost: 0,
    permanent: { where: "bearer", statics: { ...flat, conditional }, tags: [] },
    usable: [],
    modes: [],
  };
}

/**
 * Sudden Reversal (101896) — the bespoke tail (docs/card-primitives.md
 * §4): an out-of-turn master that cancels another Methuselah's master
 * card as it is played, refunding its cost. Hand-rolled because its
 * window (inside another card's as-played period) fits no spec shape.
 */
// ---------------------------------------------------------------------------
// Masters that reach across the table (docs/cross-table-masters-design.md)
// ---------------------------------------------------------------------------

/**
 * Flaming Candle (100743) — "Only one Flaming Candle can be played or
 * equipped in a game."
 *
 * The compiled equipment card, with the equip action withdrawn once any
 * copy has been played. Game-wide uniqueness off the event log: no new
 * state, and correctly stricter than "in play" for a card whose whole use
 * burns it (the Giant's Blood / Open War precedent).
 */
const flamingCandleBase = compileSpec(specByName("Flaming Candle"));
const flamingCandle: CardHandler = {
  ...flamingCandleBase,
  options(card, ctx) {
    if (
      ctx.state.eventLog.some(
        (ev) => ev.type === "CardPlayed" && ev.name === "Flaming Candle",
      )
    ) {
      return [];
    }
    return flamingCandleBase.options?.(card, ctx) ?? [];
  },
};

/**
 * Giant's Blood (100824) — "Only one Giant's Blood can be played in a
 * game. Choose a vampire. The chosen vampire gains enough blood to reach
 * full capacity."
 *
 * Game-wide uniqueness needs no new state: the event log is the record of
 * everything ever played (the Week of Nightmares / Open War precedent),
 * and it is correctly STRICTER than "in play" — a second copy stays
 * unplayable after the first is burnt.
 *
 * "A vampire" is any Methuselah's, and one already at capacity is not
 * offered: the option would do nothing.
 */
const giantsBlood: CardHandler = {
  ...compileSpec(specByName("Giant's Blood")),
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    if (
      ctx.state.eventLog.some(
        (ev) => ev.type === "CardPlayed" && ev.name === "Giant's Blood",
      )
    ) {
      return [];
    }
    const out: LegalOption[] = [];
    for (const s of ctx.state.seats) {
      if (s.ousted) continue;
      for (const m of s.minions) {
        if (m.kind !== "vampire") continue;
        if (m.blood >= capacityOf(m)) continue;
        out.push({
          id: playOptionId(this.name, null, m.id, card.id),
          kind: "playCard",
          label: `Giant's Blood — fill ${m.name} to capacity`,
          card: card.id,
          name: this.name,
          minion: null,
          mode: null,
          params: { target: m.id },
        });
      }
    }
    return out;
  },
  resolve(play, ops) {
    const id = play.params["target"];
    if (!id) throw new Error("Giant's Blood: no target");
    const m = findMinion(ops.state, id);
    if (!m) return; // burnt during the as-played window
    const gain = capacityOf(m) - m.blood;
    if (gain > 0) ops.emit({ type: "BloodGained", minion: m.id, amount: gain });
  },
};

/**
 * Golconda: Inner Peace (100842) — "Remove a vampire with capacity 8 or
 * more from the game. Their controller gains pool equal to the vampire's
 * capacity. Their controller can burn 2 pool to cancel this card as it is
 * played."
 *
 * The pay-to-cancel gate (design §2): `payToCancelFor` is answered at push
 * time and stamped on the frame, because WHO may pay depends on which
 * vampire this play targets. True Love's Face superior wants the same
 * mechanic with a different payer.
 */
const golcondaInnerPeace: CardHandler = {
  ...compileSpec(specByName("Golconda: Inner Peace")),
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    const out: LegalOption[] = [];
    for (const s of ctx.state.seats) {
      if (s.ousted) continue;
      for (const m of s.minions) {
        // "…with capacity 8 or more" — `capacityOf`, so a granted point
        // counts, consistent with every capacity read since the
        // derived-traits wave.
        if (m.kind !== "vampire" || capacityOf(m) < 8) continue;
        out.push({
          id: playOptionId(this.name, null, m.id, card.id),
          kind: "playCard",
          label: `Golconda: Inner Peace — remove ${m.name} from the game`,
          card: card.id,
          name: this.name,
          minion: null,
          mode: null,
          params: { target: m.id },
        });
      }
    }
    return out;
  },
  payToCancelFor(state, _seat, params) {
    const id = params["target"];
    const m = id ? findMinion(state, id) : null;
    return m ? { seat: m.controller, pool: 2 } : null;
  },
  resolve(play, ops) {
    const id = play.params["target"];
    if (!id) throw new Error("Golconda: no target");
    const m = findMinion(ops.state, id);
    if (!m) return;
    const gain = capacityOf(m);
    const controller = m.controller;
    // The controller is read BEFORE the removal — the Rewilding ordering
    // trap: once the minion is gone there is nobody to credit.
    ops.removeMinionFromGame(m.id);
    ops.emit({ type: "PoolGained", seat: controller, amount: gain });
  },
};

/**
 * Archon Investigation (100085) — "Out-of-turn. Only usable if a minion is
 * bleeding you and the bleed amount is 4 or more, after blocks are
 * declined. Burn the acting minion. (The action is not successful.)"
 *
 * Every piece already existed: `isOutOfTurnMaster` and the
 * `outOfTurnMasterUsed` debt (Sudden Reversal), `currentBleed` for the
 * amount, and `failAction()` — built for Expulsion, which is exactly
 * "(the action is not successful)".
 *
 * The amount is read WHEN THE CARD IS PLAYED, not at announcement:
 * `currentBleed` is a fold over the event log, so it already includes
 * every modifier played since, which is what makes "after blocks are
 * declined" the right window for a card that cares about the final
 * number.
 */
const archonInvestigation: CardHandler = {
  ...compileSpec(specByName("Archon Investigation")),
  isOutOfTurnMaster: true,
  options(card, ctx) {
    if (ctx.window !== "action.effects") return [];
    const af = ctx.action;
    if (!af || af.actionKind !== "bleed") return [];
    // "…bleeding YOU".
    if (af.target !== ctx.seat) return [];
    // "…after blocks are declined": state C, no attempt underway.
    if (af.step !== "C") return [];
    if (currentBleed(ctx.state, af) < 4) return [];
    const seat = getSeat(ctx.state, ctx.seat);
    if (seat.outOfTurnMasterUsed) return [];
    if (seat.pool <= 3) return []; // never oust yourself
    // Out-of-turn: only during another Methuselah's turn (p. 8).
    const turn = ctx.state.frames[0];
    if (turn && turn.kind === "turn" && turn.seat === ctx.seat) return [];
    const actor = findMinion(ctx.state, af.acting);
    return [
      {
        id: playOptionId(this.name, null, card.id),
        kind: "playCard",
        label: `Archon Investigation — burn ${actor?.name ?? af.acting}`,
        card: card.id,
        name: this.name,
        minion: null,
        mode: null,
        params: {},
      },
    ];
  },
  resolve(_play, ops) {
    const af = ops.action();
    if (!af) return;
    // The actor can already be gone; the action still fails.
    if (findMinion(ops.state, af.acting)) ops.burnMinion(af.acting);
    ops.failAction();
  },
};

/**
 * Anarch Troublemaker (100058) — "Unique. Put this card in play. During
 * your unlock phase, you can give your prey control of the Anarch
 * Troublemaker and either lock up to two vampires they control or burn an
 * equipment on one of their minions."
 *
 * The handover is the PRICE of the parting shot, not a separate choice —
 * "give … and either …" — so one option per legal payoff, with the choice
 * in the option id. `changePermanentControl` was built for the
 * control-change gate and does the rest.
 */
const anarchTroublemaker: CardHandler = {
  ...compileSpec(specByName("Anarch Troublemaker")),
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    if (seatControlsCopy(ctx.state, ctx.seat, this.name)) return [];
    return [
      {
        id: playOptionId(this.name, null, card.id),
        kind: "playCard",
        label: this.name,
        card: card.id,
        name: this.name,
        minion: null,
        mode: null,
        params: {},
      },
    ];
  },
  resolve(play, ops) {
    ops.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: null,
      statics: {},
      tags: [play.card.name],
    });
  },
  abilityOptions(entry, owner, ctx) {
    const controller = entry.controller ?? owner.seat;
    // "During YOUR unlock phase" — `turnSeat`, not just `seat`: the
    // unlock window is offered to every Methuselah (the 2026-08-02 bug).
    if (ctx.window !== "turn.unlock") return [];
    if (ctx.seat !== controller || ctx.turnSeat !== controller) return [];
    if (entry.usedThisPhase) return [];
    const prey = getSeat(ctx.state, preyOf(ctx.state, controller));
    const out: LegalOption[] = [];
    // "…lock up to two vampires they control": one option per unordered
    // choice of 1 or 2, the `combinations` shape.
    const lockable = prey.minions.filter((m) => m.kind === "vampire" && !m.locked && isReady(m));
    for (const m of lockable) {
      out.push({
        id: `ability:${this.name}:${entry.card.id}:lock:${m.id}`,
        kind: "useAbility",
        label: `${this.name}: give it to ${prey.id} and lock ${m.name}`,
        source: entry.card.id,
        params: { act: "lock", targets: m.id },
      });
    }
    for (let i = 0; i < lockable.length; i++) {
      for (let j = i + 1; j < lockable.length; j++) {
        const a = lockable[i]!;
        const b = lockable[j]!;
        out.push({
          id: `ability:${this.name}:${entry.card.id}:lock:${a.id}:${b.id}`,
          kind: "useAbility",
          label: `${this.name}: give it to ${prey.id} and lock ${a.name} + ${b.name}`,
          source: entry.card.id,
          params: { act: "lock", targets: `${a.id},${b.id}` },
        });
      }
    }
    // "…or burn an equipment on one of their minions."
    for (const m of prey.minions) {
      for (const p of m.attached) {
        if (!p.tags.includes("equipment")) continue;
        out.push({
          id: `ability:${this.name}:${entry.card.id}:burn:${p.card.id}`,
          kind: "useAbility",
          label: `${this.name}: give it to ${prey.id} and burn ${p.card.name}`,
          source: entry.card.id,
          params: { act: "burn", equipment: p.card.id },
        });
      }
    }
    return out;
  },
  useAbility(entry, owner, choice, ops) {
    const controller = entry.controller ?? owner.seat;
    if (choice.params["act"] === "lock") {
      for (const id of (choice.params["targets"] ?? "").split(",")) {
        if (id && findMinion(ops.state, id)) {
          ops.emit({ type: "MinionLocked", minion: id });
        }
      }
    } else {
      const eq = choice.params["equipment"];
      if (eq) {
        const found = ops.state.seats
          .flatMap((s) => s.minions)
          .flatMap((m) => m.attached)
          .find((p) => p.card.id === eq);
        if (found) ops.burnPermanent(eq);
      }
    }
    entry.usedThisPhase = true;
    // The handover is the price, paid whichever payoff was taken.
    ops.changePermanentControl(entry.card.id, preyOf(ops.state, controller));
  },
};

/**
 * The Coven (100435) — "Unique. Trifle. Put this card in play. You can
 * lock this card to add 2 blood to a ready vampire you control. During
 * your discard phase, your predator takes control of The Coven."
 *
 * The handover is NOT optional — "your predator takes control", with no
 * "you can" — so it fires from `onDiscardPhase` with nothing asked. That
 * is the Rebel precedent ("gains", not "can gain").
 */
const theCoven: CardHandler = {
  ...compileSpec(specByName("The Coven")),
  isTrifle: true,
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    if (seatControlsCopy(ctx.state, ctx.seat, this.name)) return [];
    return [
      {
        id: playOptionId(this.name, null, card.id),
        kind: "playCard",
        label: this.name,
        card: card.id,
        name: this.name,
        minion: null,
        mode: null,
        params: {},
      },
    ];
  },
  resolve(play, ops) {
    ops.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: null,
      statics: {},
      tags: [play.card.name],
    });
  },
  abilityOptions(entry, owner, ctx) {
    const controller = entry.controller ?? owner.seat;
    if (ctx.seat !== controller || entry.locked) return [];
    if (!ctx.window.startsWith("turn.")) return [];
    const out: LegalOption[] = [];
    for (const m of getSeat(ctx.state, controller).minions) {
      if (m.kind !== "vampire" || !isReady(m)) continue;
      // p. 11: a vampire cannot be given more blood than its capacity, so
      // one already full is not offered.
      if (m.blood >= capacityOf(m)) continue;
      out.push({
        id: `ability:${this.name}:${entry.card.id}:blood:${m.id}`,
        kind: "useAbility",
        label: `${this.name}: lock it to add 2 blood to ${m.name}`,
        source: entry.card.id,
        params: { target: m.id },
      });
    }
    return out;
  },
  useAbility(entry, _owner, choice, ops) {
    const id = choice.params["target"];
    if (!id) throw new Error("The Coven: no target");
    const m = findMinion(ops.state, id);
    ops.emit({ type: "PermanentLocked", cardId: entry.card.id });
    if (!m) return;
    // The BloodGained applier clamps at capacity (p. 11).
    ops.emit({ type: "BloodGained", minion: m.id, amount: 2 });
  },
  onDiscardPhase(entry, owner, turnSeat, ops) {
    const controller = entry.controller ?? owner.seat;
    // "During YOUR discard phase" — every card in play sees every discard
    // phase, so this must be the controller's own.
    if (turnSeat !== controller) return;
    ops.changePermanentControl(entry.card.id, predatorOf(ops.state, controller));
  },
};

const suddenReversal: CardHandler = {
  name: "Sudden Reversal",
  bloodCost: 0,
  isMasterCard: true,
  isOutOfTurnMaster: true,
  options(card, ctx) {
    if (ctx.window !== "card.asPlayed") return [];
    const pending = ctx.pendingCard;
    // "Cancel a master card as it is played by another Methuselah."
    if (!pending || !pending.isMaster || pending.canceled) return [];
    if (pending.seat === ctx.seat) return [];
    if (getSeat(ctx.state, ctx.seat).outOfTurnMasterUsed) return [];
    // Out-of-turn: only during another Methuselah's turn (p. 8).
    const turn = ctx.state.frames[0];
    if (turn && turn.kind === "turn" && turn.seat === ctx.seat) return [];
    return [
      {
        id: playOptionId(this.name, null, card.id),
        kind: "playCard",
        label: `Sudden Reversal — cancel ${pending.card.name}`,
        card: card.id,
        name: this.name,
        minion: null,
        mode: null,
        params: {},
      },
    ];
  },
  resolve(_play, ops) {
    ops.cancelPendingCard(true); // "its cost is not paid"
  },
};

/**
 * Hide the Mind (100921) — bespoke, for the same reason Sudden Reversal
 * is: its window is inside another card's as-played period, which fits no
 * spec shape (docs/discipline-filtered-design.md §5).
 *
 *   [obf]  [COMBAT]          Cancel a combat card requiring Auspex [aus]
 *                            as it is played, and its cost is not paid.
 *   [OBF]  [ACTION MODIFIER] Cancel a reaction card requiring Auspex as
 *                            it is played, and its cost is not paid.
 *
 * Note this is NOT `modifierOrCombat`: that split asks which WINDOW a mode
 * acts in, and both of these act in `card.asPlayed`. What differs is the
 * printed type of the card each mode may cancel — hence the bracketed
 * tags, which also fix who may play each mode (a combatant for the basic,
 * the acting minion for the superior).
 */
const hideTheMind: CardHandler = {
  name: "Hide the Mind",
  bloodCost: 0,
  // Printed "Action Modifier / Combat" — stated here because this handler
  // is hand-rolled, and a card that answers no type is invisible to every
  // play-cost modifier and every card that filters by type.
  costTypes: () => ["actionModifier", "combat"],
  options(card, ctx) {
    if (ctx.window !== "card.asPlayed") return [];
    const pending = ctx.pendingCard;
    if (!pending || pending.canceled) return [];
    // "…requiring Auspex" — the enabling query, cached on the frame.
    if (!pending.requires.includes("aus")) return [];
    // Never cancel your own card, and never cancel a Hide the Mind that
    // is itself mid-play.
    if (pending.card.id === card.id) return [];

    const out: LegalOption[] = [];
    const seat = getSeat(ctx.state, ctx.seat);
    for (const m of seat.minions) {
      if (m.kind !== "vampire" || !isReady(m)) continue;
      const obf = disciplinesOf(m)["obf"];
      if (!obf) continue;
      // Basic [obf]: a combat card, cancelled by a vampire in the combat.
      const cf = ctx.combat;
      if (
        pending.isCombat &&
        cf &&
        (cf.acting === m.id || cf.opposing === m.id)
      ) {
        out.push({
          id: playOptionId(this.name, "basic", m.id, card.id),
          kind: "playCard",
          label: `Hide the Mind — cancel ${pending.card.name}`,
          card: card.id,
          name: this.name,
          minion: m.id,
          mode: "basic",
          params: {},
        });
      }
      // Superior [OBF]: a reaction card, cancelled by the acting minion —
      // the card is printed as an ACTION MODIFIER, and p. 12 makes those
      // the acting minion's to play.
      if (
        obf === "superior" &&
        pending.isReaction &&
        ctx.action &&
        ctx.action.acting === m.id
      ) {
        out.push({
          id: playOptionId(this.name, "superior", m.id, card.id),
          kind: "playCard",
          label: `Hide the Mind — cancel ${pending.card.name}`,
          card: card.id,
          name: this.name,
          minion: m.id,
          mode: "superior",
          params: {},
        });
      }
    }
    return out;
  },
  resolve(_play, ops) {
    ops.cancelPendingCard(true); // "and its cost is not paid"
  },
};

/**
 * The Barrens (100135) — bespoke: a unique location with a lock-to-use
 * ability usable at any time the controller holds the impulse
 * (ruling p. 47: "any time, including in combat").
 */
const theBarrens: CardHandler = {
  name: "The Barrens",
  bloodCost: 0,
  poolCost: 0,
  isMasterCard: true,
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    if (seatControlsCopy(ctx.state, ctx.seat, this.name)) return [];
    return [
      {
        id: playOptionId(this.name, null, card.id),
        kind: "playCard",
        label: "The Barrens — put in play",
        card: card.id,
        name: this.name,
        minion: null,
        mode: null,
        params: {},
      },
    ];
  },
  resolve(play, ops) {
    ops.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: null,
      statics: {},
      tags: ["location"],
    });
  },
  abilityOptions(entry, owner, ctx) {
    if (entry.locked) return [];
    const windows = [
      "turn.master",
      "turn.minion",
      "turn.influence",
      "turn.discard",
      "action.effects",
      "combat.beforeRange",
      "combat.beforeStrikes",
      "combat.endOfRound",
    ];
    if (!windows.includes(ctx.window)) return [];
    return getSeat(ctx.state, owner.seat).hand.map(
      (c): LegalOption => ({
        id: `ability:The Barrens:${entry.card.id}:${c.id}`,
        kind: "useAbility",
        label: `The Barrens: discard ${c.name} and draw`,
        source: entry.card.id,
        params: { discard: c.id },
      }),
    );
  },
  useAbility(entry, owner, choice, ops) {
    ops.lockPermanent(entry.card.id);
    const target = choice.params["discard"];
    if (!target) throw new Error("The Barrens: no discard chosen");
    ops.discardFromHand(owner.seat, target);
  },
};

/** Shared move-blood ability for Blood Doll (master phase) and Vessel
 *  (unlock phase): "During their X phase, this vampire's controller can
 *  move 1 blood from this vampire to their pool or from their pool to
 *  this vampire" — once per phase (p. 16 "During X, do Y"). */
function bloodMoverAbility(
  cardName: string,
  window: "turn.master" | "turn.unlock",
): Pick<CardHandler, "abilityOptions" | "useAbility"> {
  return {
    abilityOptions(entry, owner, ctx) {
      if (ctx.window !== window || entry.usedThisPhase) return [];
      if (owner.minion === null) return [];
      // "Their" phase: the bearer's controller's own phase — `turn.unlock`
      // is also offered to seats other than the turn's (Homunculus), so
      // both the deciding seat and the turn must be the controller's.
      if (ctx.seat !== owner.seat || ctx.turnSeat !== owner.seat) return [];
      const seat = getSeat(ctx.state, owner.seat);
      const bearer = seat.minions.find((m) => m.id === owner.minion);
      if (!bearer) return [];
      const options: LegalOption[] = [];
      if (bearer.blood >= 1) {
        options.push({
          id: `ability:${cardName}:${entry.card.id}:toPool`,
          kind: "useAbility",
          label: `${cardName}: move 1 blood from ${bearer.name} to pool`,
          source: entry.card.id,
          params: { dir: "toPool" },
        });
      }
      // Not onto a FULL vampire: the blood would drain straight back to
      // the blood bank (p. 6), so the option would spend a pool counter
      // and the card's once-per-phase use for nothing. Found in an owner
      // playtest (docs/futile-options-design.md).
      if (seat.pool >= 1 && canGainBlood(bearer)) {
        options.push({
          id: `ability:${cardName}:${entry.card.id}:toVampire`,
          kind: "useAbility",
          label: `${cardName}: move 1 pool to ${bearer.name}`,
          source: entry.card.id,
          params: { dir: "toVampire" },
        });
      }
      return options;
    },
    useAbility(entry, owner, choice, ops) {
      if (!owner.minion) throw new Error(`${cardName}: no bearer`);
      entry.usedThisPhase = true;
      if (choice.params["dir"] === "toPool") {
        ops.emit({ type: "BloodBurned", minion: owner.minion, amount: 1 });
        ops.emit({ type: "PoolGained", seat: owner.seat, amount: 1 });
      } else {
        ops.emit({ type: "PoolBurned", seat: owner.seat, amount: 1 });
        ops.emit({ type: "BloodGained", minion: owner.minion, amount: 1 });
      }
    },
  };
}

/** Blood Doll (100199) — bespoke: attach to an own vampire; master-phase
 *  blood mover (usable the turn it is played, ruling p. 47). */
const bloodDoll: CardHandler = {
  name: "Blood Doll",
  bloodCost: 0,
  poolCost: 0,
  isMasterCard: true,
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    return getSeat(ctx.state, ctx.seat).minions.map(
      (m): LegalOption => ({
        id: playOptionId(this.name, null, m.id, card.id),
        kind: "playCard",
        label: `Blood Doll on ${m.name}`,
        card: card.id,
        name: this.name,
        minion: null,
        mode: null,
        params: { target: m.id },
      }),
    );
  },
  resolve(play, ops) {
    const target = play.params["target"];
    if (!target) throw new Error("Blood Doll: no target");
    ops.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: target,
      statics: {},
      tags: [],
    });
  },
  ...bloodMoverAbility("Blood Doll", "turn.master"),
};

/** Vessel (102113) — bespoke: trifle; attach to any controlled vampire,
 *  optionally burning a Blood Doll in play; unlock-phase blood mover
 *  (NOT usable the turn it is played — its phase has passed). */
const vessel: CardHandler = {
  name: "Vessel",
  bloodCost: 0,
  poolCost: 1,
  isMasterCard: true,
  isTrifle: true,
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    if (getSeat(ctx.state, ctx.seat).pool <= 1) return [];
    const bloodDolls: string[] = [];
    for (const s of ctx.state.seats) {
      for (const m of s.minions) {
        for (const p of m.attached) {
          if (p.card.name === "Blood Doll") bloodDolls.push(p.card.id);
        }
      }
    }
    const options: LegalOption[] = [];
    for (const s of ctx.state.seats) {
      if (s.ousted) continue;
      for (const m of s.minions) {
        for (const bd of ["none", ...bloodDolls]) {
          options.push({
            id: playOptionId(this.name, null, m.id, bd, card.id),
            kind: "playCard",
            label: `Vessel on ${m.name}${bd === "none" ? "" : " (burn Blood Doll)"}`,
            card: card.id,
            name: this.name,
            minion: null,
            mode: null,
            params: { target: m.id, bd },
          });
        }
      }
    }
    return options;
  },
  resolve(play, ops) {
    const target = play.params["target"];
    if (!target) throw new Error("Vessel: no target");
    ops.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: target,
      statics: {},
      tags: [],
    });
    const bd = play.params["bd"];
    if (bd && bd !== "none") ops.burnPermanent(bd);
  },
  ...bloodMoverAbility("Vessel", "turn.unlock"),
};

/** .44 Magnum (100001) — bespoke equipment: "Strike: 2R damage, with 1
 *  optional maneuver each combat." Using the gun's maneuver commits its
 *  strike for the round (ruling p. 47). */
const magnum44: CardHandler = {
  name: ".44 Magnum",
  bloodCost: 0,
  poolCost: 2,
  isActionCard: true,
  isEquipment: true,
  permanentStatics: {},
  permanentTags: ["weapon", "gun"],
  options(card, ctx) {
    if (ctx.window !== "turn.minion") return [];
    const seat = getSeat(ctx.state, ctx.seat);
    if (seat.pool < 2) return [];
    const options: LegalOption[] = [];
    for (const m of seat.minions) {
      if (m.inTorpor || m.locked) continue;
      if (m.playedSinceUnlock.includes(this.name)) continue;
      options.push({
        id: playOptionId(this.name, null, m.id, card.id),
        kind: "playCard",
        label: `${m.name}: equip .44 Magnum`,
        card: card.id,
        name: this.name,
        minion: m.id,
        mode: null,
        params: {},
      });
    }
    return options;
  },
  resolve(play, ops) {
    ops.announceCardAction(play, { actionKind: "cardEffect", inherentStealth: 1 });
  },
  abilityOptions(entry, owner, ctx) {
    const cf = ctx.combat;
    if (!cf || owner.minion === null) return [];
    const side =
      cf.acting === owner.minion
        ? ("acting" as const)
        : cf.opposing === owner.minion
          ? ("opposing" as const)
          : null;
    if (!side) return [];
    // "The opposing minion cannot USE EQUIPMENT" (Terror Frenzy). The
    // spec-compiled weapons get this from the compiler, which checks it
    // once before splitting on the window; this hand-rolled one had it
    // nowhere, so a disarmed bearer could still fire the gun AND take its
    // maneuver. Placed at the same point for the same reason: both the
    // maneuver and the strike are uses of the equipment
    // (docs/ledger-closeout.md §6).
    if (cf.restrict[side].equipment) return [];
    if (ctx.window === "combat.range") {
      if (cf.awaiting !== side) return [];
      if (cf.usedWeaponManeuver[side] !== null) return [];
      return [
        {
          id: `ability:.44 Magnum:${entry.card.id}:maneuver`,
          kind: "useAbility",
          label: ".44 Magnum: maneuver (commits the gun's strike)",
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
      // (Immortal Grapple). The spec-compiled weapons get this from the
      // compiler; this hand-rolled one has to say it.
      if (cf.handStrikesOnly) return [];
      return [
        {
          id: `ability:.44 Magnum:${entry.card.id}:strike`,
          kind: "useAbility",
          label: ".44 Magnum: strike (2R damage)",
          source: entry.card.id,
          params: { action: "strike" },
        },
      ];
    }
    return [];
  },
  useAbility(entry, owner, choice, ops) {
    if (!owner.minion) throw new Error(".44 Magnum: no bearer");
    if (choice.params["action"] === "maneuver") {
      ops.useWeaponManeuver(owner.minion, entry.card.id);
    } else {
      ops.chooseWeaponStrike(owner.minion, entry.card.id, {
        name: ".44 Magnum",
        damage: 2,
        ranged: true,
      });
    }
  },
};

function specByName(name: string): CardSpec {
  const spec = cardSpecs.find((s) => s.name === name);
  if (!spec) throw new Error(`no spec named ${name}`);
  return spec;
}

/**
 * Pass Through Shadow (102279) — the compiled combat card plus what the
 * copy it leaves behind can do:
 *
 *   "After combat ends, put this card on this vampire. This vampire can
 *    BURN THIS CARD to get +1 stealth."
 *
 * The attach half is the generic `afterCombatEnds` rider; this overlay is
 * the ability the attached card then carries. Offered under the ordinary
 * p. 26 gate — stealth only when it is needed.
 */
/**
 * Shadow Cast (102280) — the compiled modifier plus what the copy it
 * leaves on the vampire can do:
 *
 *   "During an action directed at the SAME Methuselah or same set of
 *    Methuselahs, this vampire can burn this card to get +1 stealth."
 *
 * `entry.againstSeat` is the seat the placing action was directed at,
 * recorded when the card attached (docs/after-resolution-design.md §5) —
 * without it this would be a free +1 stealth on any action at all.
 */
const shadowCast: CardHandler = {
  ...compileSpec(specByName("Shadow Cast")),
  abilityOptions(entry, owner, ctx) {
    if (!entry.tags.includes("shadowCast")) return [];
    if (owner.minion === null || ctx.seat !== owner.seat) return [];
    const af = ctx.action;
    const ba = ctx.blockAttempt;
    if (!af || !ba || af.acting !== owner.minion) return [];
    // "…directed at the same Methuselah".
    if (!af.directed || af.target === null || af.target !== entry.againstSeat) return [];
    // p. 26: stealth only when it is needed.
    if (
      currentIntercept(ctx.state, af.actionId, ba.blocker) <
      currentStealth(ctx.state, af.actionId)
    ) {
      return [];
    }
    return [
      {
        id: `ability:Shadow Cast:${entry.card.id}:stealth`,
        kind: "useAbility",
        label: "Shadow Cast: burn it for +1 stealth",
        source: entry.card.id,
        params: {},
      },
    ];
  },
  useAbility(entry, _owner, _choice, ops) {
    const af = ops.action();
    if (!af) return;
    ops.emit({
      type: "StealthModified",
      actionId: af.actionId,
      delta: 1,
      source: "Shadow Cast",
    });
    ops.burnPermanent(entry.card.id);
  },
};

/**
 * Shadow Cloak (102281) — the protection is a static on the attached
 * card (`untargetableExceptDiscipline`); this overlay is only the other
 * half: "during your unlock phase, burn this card."
 */
const shadowCloak: CardHandler = {
  ...compileSpec(specByName("Shadow Cloak")),
  onControllerUnlock(entry, _owner, ops) {
    if (entry.tags.includes("shadowCloak")) ops.burnPermanent(entry.card.id);
  },
};

/**
 * Fever Pitch (102321) — the copy it leaves on the vampire:
 *
 *   "This vampire can burn this card during a bleed action they perform
 *    to have a block attempt fail; the blocking minion cannot attempt to
 *    block this action again."
 *
 * The same mechanic the fail-block cluster is built on
 * (docs/fail-block-design.md), bought with the card instead of a
 * discipline.
 */
const feverPitch: CardHandler = {
  ...compileSpec(specByName("Fever Pitch")),
  abilityOptions(entry, owner, ctx) {
    if (!entry.tags.includes("feverPitch")) return [];
    if (owner.minion === null || ctx.seat !== owner.seat) return [];
    const af = ctx.action;
    const ba = ctx.blockAttempt;
    if (!af || !ba || af.acting !== owner.minion) return [];
    // "…during a bleed action THEY perform".
    if (af.actionKind !== "bleed") return [];
    return [
      {
        id: `ability:Fever Pitch:${entry.card.id}:failblock`,
        kind: "useAbility",
        label: "Fever Pitch: burn it to make that block attempt fail",
        source: entry.card.id,
        params: {},
      },
    ];
  },
  useAbility(entry, _owner, _choice, ops) {
    ops.failBlockAttempt();
    ops.burnPermanent(entry.card.id);
  },
};

const passThroughShadow: CardHandler = {
  ...compileSpec(specByName("Pass Through Shadow")),
  abilityOptions(entry, owner, ctx) {
    if (!entry.tags.includes("burnForStealth")) return [];
    if (owner.minion === null || ctx.seat !== owner.seat) return [];
    const af = ctx.action;
    const ba = ctx.blockAttempt;
    if (!af || !ba || af.acting !== owner.minion) return [];
    // p. 26: only when needed — the blocker would otherwise get through.
    if (
      currentIntercept(ctx.state, af.actionId, ba.blocker) <
      currentStealth(ctx.state, af.actionId)
    ) {
      return [];
    }
    return [
      {
        id: `ability:Pass Through Shadow:${entry.card.id}:stealth`,
        kind: "useAbility",
        label: "Pass Through Shadow: burn it for +1 stealth",
        source: entry.card.id,
        params: {},
      },
    ];
  },
  useAbility(entry, _owner, _choice, ops) {
    const af = ops.action();
    if (!af) return;
    ops.emit({
      type: "StealthModified",
      actionId: af.actionId,
      delta: 1,
      source: "Pass Through Shadow",
    });
    ops.burnPermanent(entry.card.id);
  },
};

/** Secure Haven (101711) — the compiled statics plus "burn this card
 *  after this minion goes to torpor", the same `onLeaveReady` clause
 *  Guardian Angel carries. */
const secureHaven: CardHandler = {
  ...compileSpec(specByName("Secure Haven")),
  onLeaveReady(entry, owner, info, ops) {
    if (info.minion === owner.minion && info.how === "torpor") {
      ops.burnPermanent(entry.card.id);
    }
  },
};

/**
 * Unlicensed Taxicab (102078) — the compiled vehicle (its conditional
 * stealth and the extra equip stealth) plus the clause that ends it:
 *
 *   "If this minion is blocked by a prince or an archbishop (DURING ANY
 *    ACTION), burn this vehicle."
 *
 * The parenthetical matters: the burn is not limited to the hunt/recruit/
 * employ actions its stealth bonus covers.
 */
const unlicensedTaxicab: CardHandler = {
  ...compileSpec(specByName("Unlicensed Taxicab")),
  onBlockDeclared(entry, owner, info, ops) {
    if (owner.minion === null || info.acting !== owner.minion) return;
    const blocker = findMinion(ops.state, info.blocker);
    if (!blocker || blocker.kind !== "vampire") return;
    if (blocker.title !== "prince" && blocker.title !== "archbishop") return;
    ops.burnPermanent(entry.card.id);
  },
};

/**
 * Guardian Angel (100866) — the compiled conditional static ("+1 intercept
 * during bleed actions directed at you") plus its two other clauses:
 *
 *   "This vampire can prevent 1 damage EACH COMBAT."
 *   "If this vampire is in torpor, burn this card."
 *
 * The prevention is War Ghoul's ability with a wider scope: War Ghoul's
 * recharges every round, this one once per combat, which is what
 * `CombatFrame.usedThisCombat` is for.
 */
const guardianAngel: CardHandler = {
  ...compileSpec(specByName("Guardian Angel")),
  abilityOptions(entry, owner, ctx) {
    if (owner.minion === null || ctx.seat !== owner.seat) return [];
    if (ctx.window !== "combat.damageResolution") return [];
    const cf = ctx.combat;
    if (!cf) return [];
    if (cf.usedThisCombat.includes(entry.card.id)) return [];
    const pd = cf.pendingDamage[0];
    if (!pd || pd.minion !== owner.minion) return [];
    return [
      {
        id: `ability:Guardian Angel:${entry.card.id}:prevent`,
        kind: "useAbility",
        label: "Guardian Angel: prevent 1 damage (once per combat)",
        source: entry.card.id,
        params: {},
      },
    ];
  },
  useAbility(entry, owner, _choice, ops) {
    if (!owner.minion) throw new Error("Guardian Angel: no bearer");
    ops.preventDamageAbility(owner.minion, entry.card.id, 1, "combat");
  },
  onLeaveReady(entry, owner, info, ops) {
    // "If this vampire is in torpor, burn this card." Fired before the
    // event, so the bearer is still where the hook can see them.
    if (info.minion === owner.minion && info.how === "torpor") {
      ops.burnPermanent(entry.card.id);
    }
  },
};

/**
 * Warsaw Station (102149) — the compiled `lockGrant` (its first clause,
 * docs/action-time-locations-design.md) plus the second:
 *
 *   "You can burn this card (EVEN IF IT IS LOCKED) to move a Nosferatu in
 *    torpor to the ready region."
 *
 * The parenthetical is the whole point of the overlay: every other
 * burn-self ability in the pool is gated on the card being unlocked, and
 * this clause exists precisely to let you cash in a location you already
 * spent this turn. It is offered in the master phase, the window a
 * Methuselah-level ability normally takes.
 */
const warsawStation: CardHandler = {
  ...compileSpec(specByName("Warsaw Station")),
  abilityOptions(entry, owner, ctx) {
    const base = compileSpec(specByName("Warsaw Station")).abilityOptions?.(entry, owner, ctx) ?? [];
    if (ctx.window !== "turn.master" || ctx.seat !== owner.seat) return base;
    const rescuable = getSeat(ctx.state, ctx.seat).minions.filter(
      (m) => m.kind === "vampire" && m.inTorpor && m.clan === "Nosferatu",
    );
    return [
      ...base,
      ...rescuable.map((m) => ({
        id: `ability:Warsaw Station:${entry.card.id}:rescue:${m.id}`,
        kind: "useAbility" as const,
        label: `Warsaw Station: burn it to bring ${m.name} out of torpor`,
        source: entry.card.id,
        params: { rescue: m.id },
      })),
    ];
  },
  useAbility(entry, owner, choice, ops) {
    const target = choice.params["rescue"];
    if (!target) {
      compileSpec(specByName("Warsaw Station")).useAbility?.(entry, owner, choice, ops);
      return;
    }
    // Burned "even if it is locked" — no unlocked check anywhere here.
    ops.emit({ type: "LeftTorpor", minion: target });
    ops.burnPermanent(entry.card.id);
  },
};

/** Double Deuce (102220) — compiled ally spec plus automatic card text:
 *  "If Double Deuce has 2 or fewer life during your unlock phase, he
 *  gains 1 life" (mandatory, no decision). */
const doubleDeuce: CardHandler = {
  ...compileSpec(specByName("Double Deuce")),
  onControllerUnlock(entry, owner, ops) {
    if (!owner.minion) return;
    const m = getMinion(ops.state, owner.minion);
    if (m.blood <= 2) {
      ops.emit({ type: "BloodGained", minion: m.id, amount: 1 });
    }
  },
};

/** 47th Street Royals (102217) — compiled ally spec plus the Methuselah
 *  ability: "You can burn 47th Street Royals to reduce a bleed against
 *  you by 3" (any time during a bleed action targeting you). */
const streetRoyals47: CardHandler = {
  ...compileSpec(specByName("47th Street Royals")),
  abilityOptions(entry, owner, ctx) {
    if (ctx.window !== "action.effects") return [];
    const af = ctx.action;
    if (!af || af.actionKind !== "bleed") return [];
    if (af.target !== owner.seat || ctx.seat !== owner.seat) return [];
    if (owner.minion === null) return [];
    return [
      {
        id: `ability:47th Street Royals:${entry.card.id}:reduce`,
        kind: "useAbility",
        label: "47th Street Royals: burn to reduce the bleed by 3",
        source: entry.card.id,
        params: {},
      },
    ];
  },
  useAbility(entry, owner, _choice, ops) {
    const af = ops.action();
    if (!af) throw new Error("47th Street Royals used outside an action");
    if (!owner.minion) throw new Error("47th Street Royals: no ally");
    ops.emit({
      type: "BleedAmountModified",
      actionId: af.actionId,
      delta: -3,
      source: "47th Street Royals",
      limited: false,
    });
    // "Burn 47th Street Royals": the ally itself leaves play.
    ops.burnMinion(owner.minion);
  },
};

/** Homunculus (100932) — compiled retainer spec plus the ability:
 *  "During any Methuselah's unlock phase, the employer can burn 1 blood
 *  to unlock" — once per unlock phase (p. 16). */
const homunculus: CardHandler = {
  ...compileSpec(specByName("Homunculus")),
  abilityOptions(entry, owner, ctx) {
    if (ctx.window !== "turn.unlock" || entry.usedThisPhase) return [];
    if (ctx.seat !== owner.seat || owner.minion === null) return [];
    const employer = getMinion(ctx.state, owner.minion);
    if (!employer.locked || employer.inTorpor || employer.blood < 1) return [];
    return [
      {
        id: `ability:Homunculus:${entry.card.id}:unlock`,
        kind: "useAbility",
        label: `Homunculus: ${employer.name} burns 1 blood to unlock`,
        source: entry.card.id,
        params: {},
      },
    ];
  },
  useAbility(entry, owner, _choice, ops) {
    if (!owner.minion) throw new Error("Homunculus: no employer");
    entry.usedThisPhase = true;
    ops.emit({ type: "BloodBurned", minion: owner.minion, amount: 1 });
    ops.emit({ type: "MinionUnlocked", minion: owner.minion });
  },
};

/** Freakish Conglomeration (102324) — compiled ally spec plus mandatory
 *  card text: "During your unlock phase, this ally burns 1 life." At 0
 *  the settle sweep burns it. */
const freakishConglomeration: CardHandler = {
  ...compileSpec(specByName("Freakish Conglomeration")),
  onControllerUnlock(entry, owner, ops) {
    if (!owner.minion) return;
    ops.emit({ type: "BloodBurned", minion: owner.minion, amount: 1 });
  },
};

/** War Ghoul (102144) — compiled ally spec (rush on vampires) plus:
 *  - "After this ally enters play, burn an ally or retainer you
 *    control." The victim is chosen at announcement (p. 25: all details
 *    fixed then); the entering War Ghoul itself is offered as "self" —
 *    it is an ally you control once in play. ASSUMPTION flagged to the
 *    owner: whether the Ghoul may eat itself when alternatives exist.
 *  - "It can prevent 1 damage each round of combat" (ability).
 *  - "It can lock and burn itself to burn a location, except during
 *    combat" (ability). */
const warGhoul: CardHandler = {
  ...compileSpec(specByName("War Ghoul")),

  options(card, ctx) {
    if (ctx.window !== "turn.minion") return [];
    const seat = getSeat(ctx.state, ctx.seat);
    if (seat.pool < 3) return [];
    const options: LegalOption[] = [];
    // Burn candidates: own allies and retainers in play, plus the
    // entering Ghoul itself ("self").
    const burnTargets: string[] = ["self"];
    for (const m of seat.minions) {
      if (m.kind === "ally") burnTargets.push(m.id);
      for (const p of m.attached) {
        if (p.life !== undefined) burnTargets.push(p.card.id);
      }
    }
    for (const m of seat.minions) {
      if (!canAct(m)) continue;
      if (m.playedSinceUnlock.includes("War Ghoul")) continue;
      for (const burn of burnTargets) {
        options.push({
          id: playOptionId("War Ghoul", "basic", m.id, burn, card.id),
          kind: "playCard",
          label: `War Ghoul (basic) — ${m.name} → burn ${burn}`,
          card: card.id,
          name: "War Ghoul",
          minion: m.id,
          mode: "basic",
          params: { burn },
        });
      }
    }
    return options;
  },

  resolveCardAction(af, ops) {
    // Runs after the ally entered play (engine order guarantees it).
    const burn = af.card?.params["burn"];
    if (!burn) throw new Error("War Ghoul: no burn target");
    const target = burn === "self" ? af.card!.instance.id : burn;
    if (findMinion(ops.state, target)) {
      ops.burnMinion(target); // an ally
    } else {
      ops.burnPermanent(target); // a retainer entry
    }
  },

  abilityOptions(entry, owner, ctx) {
    if (owner.minion === null || ctx.seat !== owner.seat) return [];
    if (ctx.window === "combat.damageResolution") {
      const cf = ctx.combat;
      if (!cf) return [];
      if (cf.usedThisRound.includes(entry.card.id)) return [];
      const pd = cf.pendingDamage[0];
      if (!pd || pd.minion !== owner.minion) return [];
      return [
        {
          id: `ability:War Ghoul:${entry.card.id}:prevent`,
          kind: "useAbility",
          label: "War Ghoul: prevent 1 damage (once per round)",
          source: entry.card.id,
          params: { action: "prevent" },
        },
      ];
    }
    const outsideCombat = ["turn.master", "turn.minion", "turn.influence", "turn.discard", "action.effects"];
    if (!outsideCombat.includes(ctx.window) || ctx.combat) return [];
    const ghoul = getMinion(ctx.state, owner.minion);
    if (ghoul.locked || ghoul.inTorpor) return [];
    const options: LegalOption[] = [];
    for (const s of ctx.state.seats) {
      for (const p of s.permanents) {
        if (!p.tags.includes("location")) continue;
        options.push({
          id: `ability:War Ghoul:${entry.card.id}:burnloc:${p.card.id}`,
          kind: "useAbility",
          label: `War Ghoul: lock and burn itself to burn ${p.card.name}`,
          source: entry.card.id,
          params: { action: "burnloc", location: p.card.id },
        });
      }
    }
    return options;
  },

  useAbility(entry, owner, choice, ops) {
    if (!owner.minion) throw new Error("War Ghoul: no ally");
    if (choice.params["action"] === "prevent") {
      ops.preventDamageAbility(owner.minion, entry.card.id, 1);
      return;
    }
    const loc = choice.params["location"];
    if (!loc) throw new Error("War Ghoul: no location");
    // Costs first (lock and burn itself), then the location burns.
    ops.emit({ type: "MinionLocked", minion: owner.minion });
    ops.burnMinion(owner.minion);
    ops.burnPermanent(loc);
  },
};

/** Parity Shift (101353) — compiled political action (prince/justicar
 *  required) plus bespoke terms: choose a Methuselah with more pool than
 *  you and allocate 3 of their pool among one or more OTHER Methuselahs
 *  (including you). */
const parityShiftBase = compileSpec(specByName("Parity Shift"));
const parityShift: CardHandler = {
  ...parityShiftBase,
  /**
   * Not offered when NO Methuselah has more pool than you.
   *
   * Owner-reported 2026-09-06: "it didn't give me a choice to allocate the
   * pool". The engine was right and silent — the card's whole content is
   * "choose a Methuselah who has MORE POOL THAN YOU DO and allocate 3 of
   * their pool", so with nobody richer there is no legal term, the terms
   * step is skipped, and the referendum passes doing nothing. Playing it
   * still costs a card, an action and the caller's lock.
   *
   * That is exactly the futile-options reading (docs/futile-options-design
   * .md): an option whose whole content cannot happen is not offered, and
   * `canGainBlood` set the precedent. It is card-specific on purpose —
   * a general "no legal terms" gate would change every terms card at once
   * and wants its own pass.
   */
  options(card, ctx) {
    const me = getSeat(ctx.state, ctx.seat);
    const richer = ctx.state.seats.some((s) => !s.ousted && s.id !== ctx.seat && s.pool > me.pool);
    if (!richer) return [];
    return parityShiftBase.options?.(card, ctx) ?? [];
  },
  referendumTerms(frame, state) {
    const standing = state.seats.filter((s) => !s.ousted);
    const caller = standing.find((s) => s.id === frame.caller);
    if (!caller) return [];
    const options: LegalOption[] = [];
    for (const victim of standing) {
      if (victim.id === frame.caller) continue;
      if (victim.pool <= caller.pool) continue;
      const recipients = standing.filter((s) => s.id !== victim.id).map((s) => s.id);
      for (const alloc of enumerateAllocations(recipients, 3, 1)) {
        const s = allocToParams(alloc);
        options.push({
          id: `terms:${victim.id}:${s}`,
          kind: "chooseTerms",
          label: `Take 3 pool from ${victim.id}: ${s}`,
          params: { victim: victim.id, alloc: s },
        });
      }
    }
    return options;
  },
  applyReferendum(frame, ops) {
    // Terms may be absent when nobody had more pool than the caller.
    const victim = frame.terms["victim"];
    const alloc = frame.terms["alloc"];
    if (!victim || !alloc) return;
    ops.emit({ type: "PoolBurned", seat: victim, amount: 3 });
    for (const [seat, x] of parseAlloc(alloc)) {
      ops.emit({ type: "PoolGained", seat, amount: x });
    }
  },
};

/** Banishment (100131) — compiled political action plus bespoke terms:
 *  choose a ready vampire younger than the acting vampire; on a pass it
 *  moves to its controller's uncontrolled region, cards and counters
 *  staying with it (blood becomes counters). */
const banishment: CardHandler = {
  ...compileSpec(specByName("Banishment")),
  referendumTerms(frame, state) {
    const announced = state.eventLog.find(
      (ev) => ev.type === "ActionAnnounced" && ev.actionId === frame.actionId,
    );
    if (!announced || announced.type !== "ActionAnnounced") return [];
    const actor = findMinion(state, announced.acting);
    if (!actor) return [];
    const options: LegalOption[] = [];
    for (const s of state.seats) {
      if (s.ousted) continue;
      for (const m of s.minions) {
        if (m.kind !== "vampire" || !isReady(m)) continue;
        if (m.capacity >= actor.capacity) continue; // "younger"
        options.push({
          id: `terms:${m.id}`,
          kind: "chooseTerms",
          label: `Banish ${m.name} (${s.id})`,
          params: { target: m.id },
        });
      }
    }
    return options;
  },
  applyReferendum(frame, ops) {
    // Terms may be absent when no younger vampire was in play.
    const target = frame.terms["target"];
    if (!target) return;
    const m = findMinion(ops.state, target);
    if (!m || !isReady(m)) return; // left play or torpored mid-referendum
    ops.emit({ type: "MovedToUncontrolled", seat: m.controller, minion: m.id });
  },
};

/**
 * Title-granting political actions (docs/politics-followups-design.md):
 * "Choose a <eligible> vampire. Successful referendum means this card is
 * put on the chosen vampire to represent the title of <title>." The card
 * is held aside until the referendum resolves (isTitleGrant) — attached +
 * title set on a pass, burned on a fail. `voteBonusClan` implements the
 * in-referendum "each <clan> gets +1 vote" rider by seeding voteGrants.
 */
function titleGrant(opts: {
  name: string;
  title: VampireTitle;
  eligible: (m: MinionState) => boolean;
  voteBonusClan?: string;
  restrictSect?: "camarilla" | "anarch" | "sabbat" | "independent";
}): CardHandler {
  return {
    ...compileSpec(specByName(opts.name)),
    isTitleGrant: true,
    referendumTerms(frame, state) {
      const options: LegalOption[] = [];
      for (const s of state.seats) {
        if (s.ousted) continue;
        for (const m of s.minions) {
          if (m.kind !== "vampire" || !opts.eligible(m)) continue;
          options.push({
            id: `terms:${m.id}`,
            kind: "chooseTerms",
            label: `Grant ${opts.title} to ${m.name} (${s.id})`,
            params: { target: m.id },
          });
        }
      }
      return options;
    },
    referendumSetup(frame, state) {
      // "During this referendum, non-<sect> vampires cannot cast votes."
      if (opts.restrictSect) frame.voteRestriction = { sect: opts.restrictSect };
      if (!opts.voteBonusClan) return;
      // "Each <clan> gets +1 vote" — one extra castable vote per matching
      // ready vampire, credited to its controller (p. 28).
      for (const s of state.seats) {
        if (s.ousted) continue;
        const n = s.minions.filter(
          (m) => m.kind === "vampire" && isReady(m) && m.clan === opts.voteBonusClan,
        ).length;
        if (n > 0) frame.voteGrants[s.id] = (frame.voteGrants[s.id] ?? 0) + n;
      }
    },
    applyReferendum(frame, ops) {
      const target = frame.terms["target"];
      const cardId = frame.cardInstanceId;
      const m = target ? findMinion(ops.state, target) : null;
      if (!m || !isReady(m) || !cardId) {
        // No valid target (none chosen, or it left play): burn the held card.
        if (cardId) ops.emit({ type: "CardBurned", cardId, name: opts.name });
        return;
      }
      ops.emit({
        type: "PermanentEnteredPlay",
        seat: m.controller,
        cardId,
        name: opts.name,
        attachedTo: m.id,
        statics: {},
        tags: [opts.name, "title"],
      });
      ops.emit({ type: "TitleGranted", minion: m.id, title: opts.title });
    },
  };
}

const malkavianJusticar = titleGrant({
  name: "Malkavian Justicar",
  title: "justicar",
  eligible: (m) => isReady(m) && m.clan === "Malkavian" && m.sect === "camarilla",
  voteBonusClan: "Malkavian",
});

const toreadorJusticar = titleGrant({
  name: "Toreador Justicar",
  title: "justicar",
  eligible: (m) => isReady(m) && m.clan === "Toreador",
  voteBonusClan: "Toreador",
});

const cardinalBenediction = titleGrant({
  name: "Cardinal Benediction",
  title: "cardinal",
  eligible: (m) => isReady(m) && m.sect === "sabbat" && m.capacity >= 7,
  restrictSect: "sabbat", // "non-Sabbat vampires cannot cast votes or ballots"
});

/**
 * Dreams of the Sphinx (100588) — the first counter one-off on the Gate 8
 * substrate (docs/counters-design.md). A unique seat card: each lock adds
 * 1 counter and the card burns at 3 counters. All three lock abilities
 * are modeled — "gain 1 pool if you have the Edge" (unlock phase), "add 1
 * blood to a vampire in your uncontrolled region" (master phase), and
 * "+2 hand size until the end of the turn".
 *
 * The hand size is a grant on the TURN frame, so it lapses when the frame
 * is replaced and p. 7's discard-down runs then — which puts it after the
 * discard phase, exactly as the card's own ruling requires: "you first
 * have the option of using a discard phase action to discard a card (and
 * replace it) before decreasing your hand size back to normal by
 * discarding 2 cards" (p. 50). The card prints no timing restriction, so
 * the ability is offered wherever its controller has an impulse — their
 * own turn phases, and the action windows on anyone else's turn (the only
 * windows a non-turn seat is asked in).
 * docs/temporary-hand-size-design.md
 */
const dreamsOfTheSphinx: CardHandler = {
  name: "Dreams of the Sphinx",
  bloodCost: 0,
  poolCost: 1,
  isMasterCard: true,
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    if (seatControlsCopy(ctx.state, ctx.seat, this.name)) return [];
    return [
      {
        id: playOptionId(this.name, null, card.id),
        kind: "playCard",
        label: "Dreams of the Sphinx — put in play",
        card: card.id,
        name: this.name,
        minion: null,
        mode: null,
        params: {},
      },
    ];
  },
  resolve(play, ops) {
    ops.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: null,
      statics: {},
      tags: ["location"],
      counters: 0,
    });
  },
  abilityOptions(entry, owner, ctx) {
    if (entry.locked || ctx.seat !== owner.seat) return [];
    const opts: LegalOption[] = [];
    // "Lock during your unlock phase to gain 1 pool if you have the Edge."
    if (
      ctx.window === "turn.unlock" &&
      ctx.turnSeat === owner.seat &&
      ctx.state.edge === owner.seat
    ) {
      opts.push({
        id: `ability:Dreams of the Sphinx:${entry.card.id}:pool`,
        kind: "useAbility",
        label: "Dreams of the Sphinx: lock to gain 1 pool (Edge)",
        source: entry.card.id,
        params: { do: "pool" },
      });
    }
    // "Lock to add 1 blood to a vampire in your uncontrolled region."
    if (ctx.window === "turn.master") {
      for (const u of getSeat(ctx.state, owner.seat).uncontrolled) {
        opts.push({
          id: `ability:Dreams of the Sphinx:${entry.card.id}:blood:${u.card.id}`,
          kind: "useAbility",
          label: `Dreams of the Sphinx: lock to add 1 blood to ${u.card.name}`,
          source: entry.card.id,
          params: { do: "blood", target: u.card.id },
        });
      }
    }
    // "Lock to get +2 hand size until the end of the turn." No printed
    // timing restriction, so it is offered in every window this seat has
    // an impulse in: their own turn phases, plus the action windows,
    // which are the only ones a NON-turn seat is asked in (the Szczecin
    // lesson) — locking it during a predator's turn to dig for a reaction
    // is a real play.
    if (
      ctx.window === "turn.master" ||
      ctx.window === "turn.minion" ||
      ctx.window === "turn.discard" ||
      ctx.window === "action.announce" ||
      ctx.window === "action.effects"
    ) {
      opts.push({
        id: `ability:Dreams of the Sphinx:${entry.card.id}:hand`,
        kind: "useAbility",
        label: "Dreams of the Sphinx: lock for +2 hand size until end of turn",
        source: entry.card.id,
        params: { do: "hand" },
      });
    }
    return opts;
  },
  useAbility(entry, owner, choice, ops) {
    ops.lockPermanent(entry.card.id);
    if (choice.params["do"] === "pool") {
      ops.emit({ type: "PoolGained", seat: owner.seat, amount: 1 });
    } else if (choice.params["do"] === "hand") {
      ops.addHandSizeBonus({
        seat: owner.seat,
        amount: 2,
        scope: "turn",
        cardName: "Dreams of the Sphinx",
        cardId: entry.card.id,
      });
    } else {
      const target = choice.params["target"];
      if (!target) throw new Error("Dreams of the Sphinx: no uncontrolled target");
      ops.emit({ type: "UncontrolledBloodAdded", seat: owner.seat, minion: target, amount: 1 });
    }
    // "Add 1 counter each time you lock it. Burn this card if it has 3."
    ops.addCounters(entry.card.id, 1);
    if ((entry.counters ?? 0) >= 3) ops.burnPermanent(entry.card.id);
  },
};

/** Dogged Pursuit (102353) — compiled reaction plus the attached-card
 *  ability from its superior: once attached (the vampire did not block),
 *  "this vampire can burn this card to get +1 intercept" during a later
 *  block attempt where it is the blocker and intercept is needed. */
const doggedPursuit: CardHandler = {
  ...compileSpec(specByName("Dogged Pursuit")),
  abilityOptions(entry, owner, ctx) {
    if (ctx.window !== "action.effects" || owner.minion === null) return [];
    const ba = ctx.blockAttempt;
    const af = ctx.action;
    if (!ba || !af || ba.blocker !== owner.minion || ctx.seat !== owner.seat) return [];
    // "when needed": the block would otherwise fall short of the stealth.
    if (
      currentIntercept(ctx.state, af.actionId, ba.blocker) >=
      currentStealth(ctx.state, af.actionId)
    ) {
      return [];
    }
    return [
      {
        id: `ability:Dogged Pursuit:${entry.card.id}:intercept`,
        kind: "useAbility",
        label: "Dogged Pursuit: burn for +1 intercept",
        source: entry.card.id,
        params: {},
      },
    ];
  },
  useAbility(entry, owner, _choice, ops) {
    const af = ops.action();
    if (!af || owner.minion === null) return;
    ops.emit({
      type: "InterceptModified",
      actionId: af.actionId,
      minion: owner.minion,
      delta: 1,
      source: "Dogged Pursuit",
    });
    ops.burnPermanent(entry.card.id);
  },
};

/**
 * Organized Resistance (102230) — bespoke: a locked baron's reaction whose
 * effect targets a *different* Anarch you control. Two uses: give the
 * currently-blocking Anarch +1 intercept (when needed), or unlock a locked
 * Anarch you control so it force-blocks with +1 intercept.
 */
const organizedResistance: CardHandler = {
  name: "Organized Resistance",
  bloodCost: 0,
  // Printed Reaction; hand-rolled, so it must say so itself. This also
  // makes "reaction cards cost +1" (Unleashing the Bestial Soul) reach it.
  isReactionCard: true,
  options(card, ctx) {
    const af = ctx.action;
    if (ctx.window !== "action.effects" || !af || ctx.seat === af.actingSeat) return [];
    const seat = getSeat(ctx.state, ctx.seat);
    // "Usable by a locked baron" — the baron reacts while locked.
    const baron = seat.minions.find(
      (m) => m.kind === "vampire" && m.title === "baron" && isReady(m) && m.locked,
    );
    if (!baron) return [];
    if (af.played.some((p) => p.minion === baron.id && p.card === "Organized Resistance")) {
      return [];
    }
    const mk = (params: Record<string, string>, label: string): LegalOption => ({
      id: playOptionId("Organized Resistance", "basic", baron.id, ...Object.values(params), card.id),
      kind: "playCard",
      label: `Organized Resistance — ${label}`,
      card: card.id,
      name: "Organized Resistance",
      minion: baron.id,
      mode: "basic",
      params,
    });
    const opts: LegalOption[] = [];
    // Use 1: +1 intercept to the currently-blocking Anarch you control.
    const ba = ctx.blockAttempt;
    if (ba && ba.blockerSeat === ctx.seat) {
      const blocker = getMinion(ctx.state, ba.blocker);
      if (
        blocker.sect === "anarch" &&
        currentIntercept(ctx.state, af.actionId, ba.blocker) <
          currentStealth(ctx.state, af.actionId)
      ) {
        opts.push(mk({ use: "intercept", target: ba.blocker }, `+1 intercept to ${blocker.name}`));
      }
    }
    // Use 2: unlock a locked Anarch you control → force-block with +1.
    if (af.step === "A" && !ba && blockEligibleSeats(ctx.state, af).includes(ctx.seat)) {
      for (const m of seat.minions) {
        if (m.kind === "vampire" && m.sect === "anarch" && isReady(m) && m.locked) {
          opts.push(mk({ use: "unlock", target: m.id }, `unlock ${m.name} to block (+1 intercept)`));
        }
      }
    }
    return opts;
  },
  resolve(play, ops) {
    const af = ops.action();
    if (!af) return;
    const target = play.params["target"];
    if (!target) return;
    if (play.params["use"] === "intercept") {
      ops.emit({
        type: "InterceptModified",
        actionId: af.actionId,
        minion: target,
        delta: 1,
        source: "Organized Resistance",
      });
    } else {
      ops.unlockAndAttemptBlock(target, { interceptBonus: 1 });
    }
  },
};

/** Melange (101195) — compiled reaction plus the attached-card ability:
 *  once attached (on a successful block) as a seat-level permanent of the
 *  Melange controller tagged with the acting minion, "during a bleed
 *  against the controller of the attached minion, burn this card for +1
 *  bleed".
 *
 *  Modelled seat-level rather than on the opponent's minion so that "you
 *  still control this card" holds (p. 16). The cost of that trick was
 *  that the card outlived its bearer — p. 16 is explicit that when a
 *  minion leaves play "any counters or other cards on it are burned", and
 *  a seat-level permanent is in nobody's `attached` array to be swept.
 *  `onLeaveReady` closes it: the hook is broadcast to EVERY seat's cards,
 *  which is what lets a card held by one Methuselah watch another's
 *  minion (docs/ledger-closeout.md §7).
 *
 *  TORPOR is deliberately not a trigger. A vampire in torpor has not left
 *  play — equipment and attachments stay with them (p. 34) — so only
 *  "burned" and "removed" take the card. */
const melange: CardHandler = {
  ...compileSpec(specByName("Melange")),
  onLeaveReady(entry, _owner, info, ops) {
    if (info.how === "torpor") return;
    const tag = entry.tags.find((t) => t.startsWith("melangeOn:"));
    if (!tag || tag.slice("melangeOn:".length) !== info.minion) return;
    ops.burnPermanent(entry.card.id);
  },
  abilityOptions(entry, owner, ctx) {
    if (ctx.window !== "action.effects" || ctx.seat !== owner.seat) return [];
    const af = ctx.action;
    if (!af || af.actionKind !== "bleed") return [];
    const tag = entry.tags.find((t) => t.startsWith("melangeOn:"));
    if (!tag) return [];
    const on = findMinion(ctx.state, tag.slice("melangeOn:".length));
    if (!on || af.target !== on.controller) return [];
    return [
      {
        id: `ability:Melange:${entry.card.id}:bleed`,
        kind: "useAbility",
        label: "Melange: burn for +1 bleed",
        source: entry.card.id,
        params: {},
      },
    ];
  },
  useAbility(entry, _owner, _choice, ops) {
    const af = ops.action();
    if (!af) return;
    ops.emit({
      type: "BleedAmountModified",
      actionId: af.actionId,
      delta: 1,
      source: "Melange",
      limited: false,
    });
    ops.burnPermanent(entry.card.id);
  },
};

/**
 * Powerbase: Madrid (101437) — bespoke counter location. Accumulate: once
 * per unlock phase, if it has 3 or fewer counters, add 1. Spend: lock it
 * during any referendum's polling step to grant your seat +1 vote per
 * counter (needs a titled Sabbat vampire you control as the recipient).
 *
 * "Vampires controlled by other Methuselahs can burn all the counters from
 * this card as a Ⓓ action" was a recorded deviation until 2026-09-02. It is
 * `vulnerableTo` with the new `burnCounters` outcome — the card survives,
 * its counters do not — grafted from a LOCAL spec clause rather than by
 * rewriting a working card onto a full spec (docs/unlock-tolls-design.md §5).
 */
const madridVulnerable = vulnerableGrant({
  krcgId: 101437,
  name: "Powerbase: Madrid",
  cardType: "master",
  bloodCost: 0,
  poolCost: 1,
  usable: [],
  modes: [],
  permanent: {
    where: "seat",
    statics: {},
    vulnerableTo: {
      who: { kind: "vampire", othersOnly: true },
      outcome: "burnCounters",
    },
  },
});

const powerbaseMadrid: CardHandler = {
  ...madridVulnerable,
  name: "Powerbase: Madrid",
  bloodCost: 0,
  poolCost: 1,
  isMasterCard: true,
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    if (seatControlsCopy(ctx.state, ctx.seat, this.name)) return [];
    if (getSeat(ctx.state, ctx.seat).pool <= 1) return [];
    return [
      {
        id: playOptionId(this.name, null, card.id),
        kind: "playCard",
        label: "Powerbase: Madrid — put in play",
        card: card.id,
        name: this.name,
        minion: null,
        mode: null,
        params: {},
      },
    ];
  },
  resolve(play, ops) {
    ops.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: null,
      statics: {},
      tags: ["location"],
      counters: 0,
    });
  },
  abilityOptions(entry, owner, ctx) {
    if (ctx.seat !== owner.seat) return [];
    const counters = entry.counters ?? 0;
    const opts: LegalOption[] = [];
    // "If 3 or fewer counters during your unlock phase, you can add 1."
    if (
      ctx.window === "turn.unlock" &&
      ctx.turnSeat === owner.seat &&
      !entry.usedThisPhase &&
      counters <= 3
    ) {
      opts.push({
        id: `ability:Powerbase: Madrid:${entry.card.id}:add`,
        kind: "useAbility",
        label: "Powerbase: Madrid: add 1 counter",
        source: entry.card.id,
        params: { do: "add" },
      });
    }
    // "Lock during polling to give a titled Sabbat +1 vote per counter."
    if (ctx.window === "referendum.polling" && !entry.locked && counters > 0) {
      const hasTitledSabbat = getSeat(ctx.state, owner.seat).minions.some(
        (m) => m.kind === "vampire" && m.sect === "sabbat" && m.title !== null && isReady(m),
      );
      if (hasTitledSabbat) {
        opts.push({
          id: `ability:Powerbase: Madrid:${entry.card.id}:votes`,
          kind: "useAbility",
          label: `Powerbase: Madrid: lock for +${counters} votes`,
          source: entry.card.id,
          params: { do: "votes" },
        });
      }
    }
    return opts;
  },
  useAbility(entry, owner, choice, ops) {
    if (choice.params["do"] === "add") {
      entry.usedThisPhase = true;
      ops.addCounters(entry.card.id, 1);
    } else {
      ops.lockPermanent(entry.card.id);
      ops.grantVotes(owner.seat, entry.counters ?? 0);
    }
  },
};

/**
 * On the Qui Vive (101321) — the compiled wake, plus the ally rider that
 * was a standing deviation until "does not unlock as normal" existed: "if
 * this minion is an ally, they do not unlock as normal during their next
 * unlock phase" (the one-shot form, MinionState.skipNextUnlock).
 */
const onTheQuiVive: CardHandler = {
  ...compileSpec(specByName("On the Qui Vive")),
  resolve(play, ops) {
    compileSpec(specByName("On the Qui Vive")).resolve(play, ops);
    if (!play.minion) return;
    const m = findMinion(ops.state, play.minion);
    if (m?.kind === "ally") m.skipNextUnlock = true;
  },
};

/**
 * Aranthebes, The Immortal (100079) — three clauses over pieces built for
 * it: "you can lock Aranthebes to give a minion controlled by your
 * predator -1 stealth" (a lock ability inside the action, only when
 * stealth is what matters — p. 26's "only when needed"); "while Aranthebes
 * is unlocked, vampires with capacity 4 or less get -1 bleed against you"
 * (an aura with `requiresUnlocked` + `maxCapacity` +
 * `bleedAgainstController`); and the shuffle-into-library outcome on its
 * burn clause.
 */
const aranthebes: CardHandler = {
  ...compileSpec(specByName("Aranthebes, The Immortal")),
  abilityOptions(entry, owner, ctx) {
    if (ctx.window !== "action.effects" || ctx.seat !== owner.seat) return [];
    if (entry.locked) return [];
    const af = ctx.action;
    if (!af || af.step !== "A") return [];
    // "A minion controlled by your predator" — the acting minion has to be
    // one of them.
    const actor = findMinion(ctx.state, af.acting);
    if (!actor || actor.controller !== predatorOf(ctx.state, owner.seat)) return [];
    return [
      {
        id: `ability:Aranthebes, The Immortal:${entry.card.id}:stealth`,
        kind: "useAbility",
        label: `Aranthebes: lock to give ${actor.name} -1 stealth`,
        source: entry.card.id,
        params: {},
      },
    ];
  },
  useAbility(entry, _owner, _choice, ops) {
    const af = ops.action();
    if (!af) return;
    ops.lockPermanent(entry.card.id);
    ops.emit({
      type: "StealthModified",
      actionId: af.actionId,
      delta: -1,
      source: "Aranthebes, The Immortal",
    });
  },
};

/**
 * Toreador Grand Ball (101989) — "choose two ready Toreador you control,
 * put this card in play, and lock one of the two. The locked Toreador does
 * not unlock as normal. The other Toreador's non-bleed actions cannot be
 * blocked." Both clauses ride mechanisms built for the pair:
 * `entry.preventsUnlock` (the persistent half of "does not unlock as
 * normal" — the one-shot half is `MinionState.skipNextUnlock`, for Stolen
 * Police Cruiser and On the Qui Vive) and `entry.unblockable`. The two
 * Toreador are picked at play, as ordered pairs (which one gets locked is
 * part of the choice).
 */
const toreadorGrandBall: CardHandler = {
  ...compileSpec(specByName("Toreador Grand Ball")),
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    const seat = getSeat(ctx.state, ctx.seat);
    if (seat.pool <= 1) return [];
    const toreador = seat.minions.filter(
      (m) => m.kind === "vampire" && m.clan === "Toreador" && isReady(m),
    );
    const opts: LegalOption[] = [];
    for (const locked of toreador) {
      for (const other of toreador) {
        if (locked.id === other.id) continue;
        opts.push({
          id: playOptionId("Toreador Grand Ball", null, locked.id, other.id, card.id),
          kind: "playCard",
          label: `Toreador Grand Ball — lock ${locked.name}, free ${other.name}`,
          card: card.id,
          name: "Toreador Grand Ball",
          minion: null,
          mode: null,
          params: { locked: locked.id, other: other.id },
        });
      }
    }
    return opts;
  },
  resolve(play, ops) {
    const locked = play.params["locked"];
    const other = play.params["other"];
    if (!locked || !other) throw new Error("Toreador Grand Ball: no pair chosen");
    ops.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: null,
      statics: {},
      tags: [],
      preventsUnlock: locked,
      unblockable: { minion: other, exceptBleed: true },
    });
    ops.emit({ type: "MinionLocked", minion: locked });
  },
};

/**
 * Brujah Debate (100260) — a global aura ("Brujah get +1 strength and 1
 * optional maneuver each combat", any Methuselah's Brujah, so it cuts both
 * ways) plus the automatic clause "during each Methuselah's master phase,
 * that Methuselah locks one of the oldest Brujah they control (if any)".
 * The lock is automatic when the oldest is unique and a ChoiceFrame when
 * several tie, since the card lets that Methuselah pick which.
 */
/**
 * Telepathic Vote Counting's inferior returns the calling card to its
 * owner's hand, which puts that hand one over its size. "(Discard down
 * afterward)" is p. 7's standing rule spelled out on the card, and the
 * choice belongs to the OWNER — who is the referendum's caller, not
 * necessarily the Methuselah who played the cancel.
 *
 * `replace: false`: a forced discard-down is not a play, so nothing is
 * drawn back (p. 7).
 */
const telepathicVoteCounting: CardHandler = {
  ...compileSpec(specByName("Telepathic Vote Counting")),
  choiceOptions(frame, state) {
    if (frame.key !== "discardDown") return [];
    return getSeat(state, frame.seat).hand.map((c) => ({
      id: `choice:Telepathic Vote Counting:${frame.cardId}:discardDown:${c.id}`,
      kind: "answerChoice" as const,
      label: `Discard down: ${c.name}`,
      params: { card: c.id },
    }));
  },
  applyChoice(frame, choice, ops) {
    const card = choice.params["card"];
    if (card) ops.discardFromHand(frame.seat, card, false);
  },
};

/**
 * Yoruba Shrine (102201) — "Unique location. If a ready Assamite you
 * control is the target of a directed action or is chosen by the acting
 * Methuselah in the terms of a referendum, you can lock this location to
 * unlock the acting minion and have the action or referendum fail. Only
 * usable as the directed action is announced or during the polling step of
 * the referendum before votes and ballots are cast."
 *
 * **"Assamite" is not a clan the engine knows.** `MinionState.clan` holds
 * REGISTRY names, so this is **Banu Haqim** — the exact bug that hit
 * Priority Contract, which filtered the legacy name and so matched no
 * imported vampire. `tests/cards/clan-vocabulary.test.ts` guards it.
 *
 * Note the card unlocks the ACTING minion: it undoes the lock the
 * announcement imposed, so the thwarted actor is free to act again.
 * docs/abstain-gate-design.md §6
 */
const yorubaShrine: CardHandler = {
  ...compileSpec(specByName("Yoruba Shrine")),
  abilityOptions(entry, owner, ctx) {
    if (entry.locked) return [];
    const mine = getSeat(ctx.state, owner.seat).minions.filter(
      (m) => m.kind === "vampire" && m.clan === "Banu Haqim" && isReady(m),
    );
    if (mine.length === 0) return [];
    const opt = (label: string): LegalOption[] => [
      {
        id: `ability:Yoruba Shrine:${entry.card.id}:cancel`,
        kind: "useAbility",
        label: `Yoruba Shrine: ${label}`,
        source: entry.card.id,
        params: {},
      },
    ];

    // "…during the polling step of the referendum before votes and
    // ballots are cast."
    if (ctx.window === "referendum.polling") {
      const ref = ctx.referendum;
      if (!ref || ref.votes.length > 0) return [];
      // "…chosen by the acting Methuselah in the terms". Terms are stored
      // as strings; a minion-choosing referendum (Expulsion) lists ids.
      const chosen = Object.values(ref.terms).flatMap((v) => v.split(","));
      if (!mine.some((m) => chosen.includes(m.id))) return [];
      return opt("fail the referendum");
    }

    // "Only usable as the directed action is announced" — read the way
    // `onlyAsAnnounced` is: state A, with no block attempt underway.
    if (ctx.window !== "action.effects") return [];
    const af = ctx.action;
    if (!af || af.step !== "A" || ctx.inBlockAttempt) return [];
    if (!af.directed || !af.targetMinion) return [];
    if (!mine.some((m) => m.id === af.targetMinion)) return [];
    return opt("fail the action");
  },
  useAbility(entry, _owner, _choice, ops) {
    ops.lockPermanent(entry.card.id);
    const af = ops.state.frames.find((f) => f.kind === "action");
    if (af && af.kind === "action") {
      // "…unlock the acting minion": the announcement's lock is undone.
      if (findMinion(ops.state, af.acting)) {
        ops.emit({ type: "MinionUnlocked", minion: af.acting });
      }
      ops.failAction();
    }
    ops.failReferendum();
  },
};

/**
 * Saulot's Guiding Wisdom's two lock abilities. The 2 votes come from
 * `statics.votes` on the spec; these are the parts that need code.
 *
 * Both lock the SALUBRI, not the card — "this Salubri can lock" — so
 * using one spends the vampire, and it cannot then do the other.
 * docs/outside-combat-design.md §4
 */
/**
 * Saulot's Healing Touch's granted action: "this Salubri can add 1 blood
 * or life to another ready minion, not to exceed starting life, as a +1
 * stealth action."
 *
 * The rescue discount is data (`statics.rescueDiscount`); only this action
 * needs code. It is undirected — it helps rather than attacks — and takes
 * no `targetMinion`, so nothing enters combat.
 * docs/minion-target-actions-design.md
 */
/**
 * Open War (101324) — the three clauses the spec cannot carry.
 *
 * 1. "Only one Open War can be played in a game": the event log IS the
 *    record of everything ever played, so this needs no new state — the
 *    Week of Nightmares precedent. Stricter than "in play": a second copy
 *    stays unplayable after the first burns.
 * 2. "Anarchs can burn a location as a Ⓓ action that costs 2 pool" — a
 *    granted action, from ANY Methuselah's Anarchs, targeting a card in
 *    play that is not this one.
 * 3. "Methuselahs can use a master phase action to move 1 counter from
 *    their pool to this card. If this card has 4 counters, burn it and
 *    gain 4 pool." — a Methuselah-level ability offered to every seat
 *    (`abilityAnySeat`), and the payout.
 *
 * OWNER RULING (2026-08-30): the 4 pool goes to the card's CONTROLLER.
 * The card does not name a beneficiary and the other reading — whoever
 * places the fourth counter — was put to the owner and rejected.
 * docs/permanent-target-actions-design.md
 */
/**
 * Día de los Muertos (100541) — "Only one Día de los Muertos can be played
 * in a game." Game-wide uniqueness needs no new state: the event log is
 * the record of everything ever played, and it is STRICTER than "in play"
 * — which is the right reading here, since this card never enters play at
 * all. The Open War / Week of Nightmares shape.
 * docs/politics-locations-design.md §4
 */
const diaDeLosMuertos: CardHandler = {
  ...compileSpec(specByName("Día de los Muertos")),
  options(card, ctx) {
    const everPlayed = ctx.state.eventLog.some(
      (ev) => ev.type === "CardPlayed" && ev.name === "Día de los Muertos",
    );
    if (everPlayed) return [];
    return compileSpec(specByName("Día de los Muertos")).options?.(card, ctx) ?? [];
  },
};

const openWar: CardHandler = {
  ...compileSpec(specByName("Open War")),
  options(card, ctx) {
    // "Only one Open War can be played in a game" (clause 1).
    const everPlayed = ctx.state.eventLog.some(
      (ev) => ev.type === "CardPlayed" && ev.name === "Open War",
    );
    if (everPlayed) return [];
    return compileSpec(specByName("Open War")).options?.(card, ctx) ?? [];
  },

  // Clause 3 is offered to EVERY Methuselah, not just the controller.
  abilityAnySeat: true,
  abilityOptions(entry, _owner, ctx) {
    if (ctx.window !== "turn.master" || ctx.seat !== ctx.turnSeat) return [];
    if (getSeat(ctx.state, ctx.seat).pool < 1) return [];
    return [
      {
        id: `ability:Open War:${entry.card.id}:fund:${ctx.seat}`,
        kind: "useAbility",
        label: "Open War: move 1 pool onto this card",
        source: entry.card.id,
        params: { seat: ctx.seat },
      },
    ];
  },
  useAbility(entry, owner, choice, ops) {
    const seat = choice.params["seat"];
    if (!seat) return;
    ops.emit({ type: "PoolBurned", seat, amount: 1 });
    ops.addCounters(entry.card.id, 1);
    // "If this card has 4 counters, burn it and gain 4 pool" — the
    // CONTROLLER gains, whoever paid the counters in (owner ruling).
    const self = findEntryById(ops.state, entry.card.id);
    if ((self?.counters ?? 0) >= 4) {
      ops.emit({ type: "PoolGained", seat: entry.controller ?? owner.seat, amount: 4 });
      ops.burnPermanent(entry.card.id);
    }
  },

  // Clause 2: the granted location-burn. The spec's rushGrant supplies
  // the other granted action; both are merged by the compiler, which
  // dispatches on the verb segment of the option id.
  actionOptions(entry, _owner, ctx) {
    if (ctx.window !== "turn.minion") return [];
    const opts: LegalOption[] = [];
    if (getSeat(ctx.state, ctx.seat).pool < 2) return opts; // "costs 2 pool"
    for (const actor of getSeat(ctx.state, ctx.seat).minions) {
      if (actor.kind !== "vampire" || actor.sect !== "anarch" || !canAct(actor)) continue;
      if (
        entry.grantedActionUses?.some((u) => u.minion === actor.id && u.key === "raze")
      ) {
        continue;
      }
      for (const s of ctx.state.seats) {
        if (s.ousted) continue;
        for (const p of s.permanents) {
          if (!p.tags.includes("location")) continue;
          opts.push({
            id: `act:Open War:${entry.card.id}:raze:${actor.id}:${p.card.id}`,
            kind: "useEntryAction",
            label: `${actor.name}: burn ${p.card.name} (Ⓓ, 2 pool)`,
            source: entry.card.id,
            minion: actor.id,
            params: { permanent: p.card.id },
          });
        }
      }
    }
    return opts;
  },
  useActionOption(entry, _owner, choice, ops) {
    const permanent = choice.params["permanent"];
    if (!permanent) throw new Error("Open War: no location chosen");
    ops.announceEntryAction(entry, choice.minion, {
      effect: { key: "raze", params: { permanent } },
      targetPermanent: permanent,
      cost: { pool: 2 },
    });
  },
  resolveGrantedAction(_entry, af, ops) {
    if (af.grantedEffect?.key !== "raze") return;
    const id = af.grantedEffect.params["permanent"];
    // It can leave play between announcement and resolution.
    if (id && ops.controllerOfEntry(id) !== null) ops.burnPermanent(id);
  },
};

const saulotsHealingTouch: CardHandler = {
  ...compileSpec(specByName("Saulot's Healing Touch")),
  actionOptions(entry, owner, ctx) {
    if (ctx.window !== "turn.minion" || ctx.seat !== owner.seat) return [];
    const bearer = owner.minion ? findMinion(ctx.state, owner.minion) : null;
    if (!bearer || !canAct(bearer)) return [];
    const opts: LegalOption[] = [];
    for (const s of ctx.state.seats) {
      if (s.ousted) continue;
      for (const t of s.minions) {
        // "another READY minion" — not the Salubri itself, and one that
        // is already at its starting life has nothing to gain.
        if (t.id === bearer.id || !isReady(t)) continue;
        if (t.blood >= capacityOf(t)) continue;
        opts.push({
          id: `act:Saulot's Healing Touch:${entry.card.id}:heal:${bearer.id}:${t.id}`,
          kind: "useEntryAction",
          label: `${bearer.name}: add 1 blood/life to ${t.name} (+1 stealth)`,
          source: entry.card.id,
          minion: bearer.id,
          params: { target: t.id },
        });
      }
    }
    return opts;
  },
  useActionOption(entry, _owner, choice, ops) {
    const target = choice.params["target"];
    if (!target) throw new Error("Saulot's Healing Touch: no target");
    ops.announceEntryAction(entry, choice.minion, {
      effect: { key: "heal", params: { target } },
      stealth: 1,
    });
  },
  resolveGrantedAction(_entry, af, ops) {
    if (af.grantedEffect?.key !== "heal") return;
    const target = af.grantedEffect.params["target"];
    if (!target) return;
    const t = findMinion(ops.state, target);
    if (!t) return; // it can leave play between announce and resolve
    // "…not to exceed starting life" — capacityOf covers vampires and
    // allies alike (an ally's capacity IS its printed starting life).
    const amount = Math.min(1, capacityOf(t) - t.blood);
    if (amount > 0) ops.emit({ type: "BloodGained", minion: target, amount });
  },
};

const saulotsGuidingWisdom: CardHandler = {
  ...compileSpec(specByName("Saulot's Guiding Wisdom")),
  abilityOptions(entry, owner, ctx) {
    const bearer = owner.minion ? findMinion(ctx.state, owner.minion) : null;
    if (!bearer || !isReady(bearer) || bearer.locked) return [];

    // "…can lock during ANY referendum to force a vampire to abstain."
    if (ctx.window === "referendum.polling") {
      const ref = ctx.referendum;
      if (!ref) return [];
      const out: LegalOption[] = [];
      for (const s of ctx.state.seats) {
        for (const t of s.minions) {
          if (t.kind !== "vampire" || !isReady(t)) continue;
          if (ref.abstaining?.includes(t.id)) continue;
          // Nothing to take away from a vampire with no vote source and
          // no vote cast.
          const votes =
            (t.title === null ? 0 : 1) +
            t.attached.reduce((n, p) => n + (p.statics.votes ?? 0), 0);
          if (votes <= 0 && !ref.votes.some((v) => v.source === t.id)) continue;
          out.push({
            id: `ability:Saulot's Guiding Wisdom:${entry.card.id}:abstain:${t.id}`,
            kind: "useAbility",
            label: `Saulot's Guiding Wisdom: ${t.name} abstains`,
            source: entry.card.id,
            params: { target: t.id },
          });
        }
      }
      return out;
    }

    // "Once each turn, … can lock before range is determined to end a
    // combat involving ANOTHER minion you control."
    if (ctx.window !== "combat.beforeRange" || entry.usedThisTurn) return [];
    const cf = ctx.combat;
    if (!cf) return [];
    const involved = [cf.acting, cf.opposing]
      .map((id) => findMinion(ctx.state, id))
      .filter((m) => m && m.controller === owner.seat && m.id !== bearer.id);
    if (involved.length === 0) return [];
    return [
      {
        id: `ability:Saulot's Guiding Wisdom:${entry.card.id}:endcombat`,
        kind: "useAbility",
        label: "Saulot's Guiding Wisdom: end this combat",
        source: entry.card.id,
        params: {},
      },
    ];
  },
  useAbility(entry, owner, choice, ops) {
    if (owner.minion) ops.emit({ type: "MinionLocked", minion: owner.minion });
    const target = choice.params["target"];
    if (target) {
      ops.forceAbstain(target);
      return;
    }
    const self = findEntryById(ops.state, entry.card.id);
    if (self) self.usedThisTurn = true; // "once each turn"
    ops.endCombatFromOutside();
  },
};

const brujahDebate: CardHandler = {
  ...compileSpec(specByName("Brujah Debate")),
  onMasterPhase(entry, _owner, turnSeat, ops) {
    const candidates = oldestBrujah(ops.state, turnSeat);
    if (candidates.length === 0) return;
    if (candidates.length === 1) {
      ops.emit({ type: "MinionLocked", minion: candidates[0]!.id });
      return;
    }
    ops.raiseChoice({
      seat: turnSeat,
      cardName: "Brujah Debate",
      cardId: entry.card.id,
      key: "lockBrujah",
    });
  },
  choiceOptions(frame, state) {
    return oldestBrujah(state, frame.seat).map((m) => ({
      id: `choice:Brujah Debate:${frame.cardId}:lockBrujah:${m.id}`,
      kind: "answerChoice" as const,
      label: `Brujah Debate: lock ${m.name}`,
      params: { minion: m.id },
    }));
  },
  applyChoice(_frame, choice, ops) {
    const minion = choice.params["minion"];
    if (minion) ops.emit({ type: "MinionLocked", minion });
  },
};

/** The unlocked ready Brujah of highest capacity a seat controls — the
 *  candidates for Brujah Debate's forced lock ("one of the oldest"). */
function oldestBrujah(state: GameState, seat: SeatId): MinionState[] {
  const brujah = getSeat(state, seat).minions.filter(
    (m) => m.kind === "vampire" && m.clan === "Brujah" && isReady(m) && !m.locked,
  );
  if (brujah.length === 0) return [];
  const oldest = Math.max(...brujah.map((m) => m.capacity));
  return brujah.filter((m) => m.capacity === oldest);
}

/**
 * Mob Connections (101229) — "you can lock this card to give a minion you
 * control 1 press, only usable to continue combat". Offered in the press
 * step of a combat involving one of the controller's minions; the credit
 * lands in the combat's per-combat press pool, which is already
 * continue-only (p. 32).
 */
const mobConnections: CardHandler = {
  ...compileSpec(specByName("Mob Connections")),
  abilityOptions(entry, owner, ctx) {
    if (ctx.seat !== owner.seat || entry.locked) return [];
    const cf = ctx.combat;
    if (!cf || ctx.window !== "combat.press") return [];
    const side =
      cf.actingSeat === owner.seat
        ? ("acting" as const)
        : cf.opposingSeat === owner.seat
          ? ("opposing" as const)
          : null;
    if (!side) return [];
    return [
      {
        id: `ability:Mob Connections:${entry.card.id}:press`,
        kind: "useAbility",
        label: "Mob Connections: lock for 1 press (to continue combat)",
        source: entry.card.id,
        params: { side },
      },
    ];
  },
  useAbility(entry, _owner, choice, ops) {
    const side = choice.params["side"];
    if (side !== "acting" && side !== "opposing") return;
    ops.lockPermanent(entry.card.id);
    ops.grantCombatPressTo(side);
  },
};

/**
 * Powerbase: Munich (102301) — "during your master phase, you can lock
 * this location to move 1 blood from a vampire with Oblivion you control
 * to your pool, or from your pool to a ready vampire with Oblivion you
 * control". Its burn clause is the first granted action with a *cost*
 * ("as a Ⓓ action that costs 1 blood", paid at resolution, p. 27).
 */
const powerbaseMunich: CardHandler = {
  ...compileSpec(specByName("Powerbase: Munich")),
  abilityOptions(entry, owner, ctx) {
    if (ctx.window !== "turn.master" || ctx.seat !== owner.seat) return [];
    if (ctx.turnSeat !== owner.seat || entry.locked) return [];
    const seat = getSeat(ctx.state, owner.seat);
    const oblivion = seat.minions.filter(
      (m) => m.kind === "vampire" && m.disciplines["obl"] !== undefined,
    );
    const opts: LegalOption[] = [];
    for (const m of oblivion) {
      if (m.blood >= 1) {
        opts.push({
          id: `ability:Powerbase: Munich:${entry.card.id}:toPool:${m.id}`,
          kind: "useAbility",
          label: `Powerbase: Munich: move 1 blood from ${m.name} to your pool`,
          source: entry.card.id,
          params: { dir: "toPool", target: m.id },
        });
      }
      // "…to a READY vampire with Oblivion you control".
      if (seat.pool >= 1 && isReady(m)) {
        opts.push({
          id: `ability:Powerbase: Munich:${entry.card.id}:toVampire:${m.id}`,
          kind: "useAbility",
          label: `Powerbase: Munich: move 1 pool to ${m.name}`,
          source: entry.card.id,
          params: { dir: "toVampire", target: m.id },
        });
      }
    }
    return opts;
  },
  useAbility(entry, owner, choice, ops) {
    const target = choice.params["target"];
    if (!target) return;
    ops.lockPermanent(entry.card.id);
    if (choice.params["dir"] === "toPool") {
      ops.emit({ type: "BloodBurned", minion: target, amount: 1 });
      ops.emit({ type: "PoolGained", seat: owner.seat, amount: 1 });
    } else {
      ops.emit({ type: "PoolBurned", seat: owner.seat, amount: 1 });
      ops.emit({ type: "BloodGained", minion: target, amount: 1 });
    }
  },
};

/**
 * Powerbase: Los Angeles (101435) — "during your discard phase, you can
 * lock this location to get +1 discard phase action" (the p. 37 discard
 * phase action is a real counter now — `TurnFrame.discardActionsLeft`).
 * "If you use that discard phase action to discard a card requiring an
 * Anarch or making a vampire Anarch, you can unlock a ready Anarch" — an
 * optional choice (docs/choice-frames-design.md) raised by the `onDiscard`
 * hook. Two readings noted: "that discard phase action" is taken to mean
 * any discard made this phase after the location was locked (the card does
 * not say which of your two actions is "that" one), and "making a vampire
 * Anarch" needs a sect-change vocabulary the pool does not have yet, so
 * only "requiring an Anarch" is detected.
 */
const powerbaseLosAngeles: CardHandler = {
  ...compileSpec(specByName("Powerbase: Los Angeles")),
  abilityOptions(entry, owner, ctx) {
    if (ctx.window !== "turn.discard" || ctx.seat !== owner.seat) return [];
    if (ctx.turnSeat !== owner.seat || entry.locked) return [];
    return [
      {
        id: `ability:Powerbase: Los Angeles:${entry.card.id}:action`,
        kind: "useAbility",
        label: "Powerbase: Los Angeles: lock for +1 discard phase action",
        source: entry.card.id,
        params: {},
      },
    ];
  },
  useAbility(entry, _owner, _choice, ops) {
    ops.lockPermanent(entry.card.id);
    const tf = ops.state.frames[0];
    if (tf && tf.kind === "turn") {
      tf.discardActionsLeft = (tf.discardActionsLeft ?? 1) + 1;
    }
  },
  onDiscard(entry, owner, info, ops) {
    // Only while this location is locked for its grant, and only for its
    // controller's own discards.
    if (!entry.locked || info.seat !== owner.seat) return;
    const spec = cardSpecs.find((s) => s.name === info.cardName);
    if (!spec?.requiresSect?.includes("anarch")) return;
    const hasAnarch = getSeat(ops.state, owner.seat).minions.some(
      (m) => m.kind === "vampire" && m.sect === "anarch" && isReady(m) && m.locked,
    );
    if (!hasAnarch) return;
    ops.raiseChoice({
      seat: owner.seat,
      cardName: "Powerbase: Los Angeles",
      cardId: entry.card.id,
      key: "unlockAnarch",
      optional: true,
    });
  },
  choiceOptions(frame, state) {
    return getSeat(state, frame.seat)
      .minions.filter(
        (m) => m.kind === "vampire" && m.sect === "anarch" && isReady(m) && m.locked,
      )
      .map((m) => ({
        id: `choice:Powerbase: Los Angeles:${frame.cardId}:unlockAnarch:${m.id}`,
        kind: "answerChoice" as const,
        label: `Powerbase: Los Angeles: unlock ${m.name}`,
        params: { minion: m.id },
      }));
  },
  applyChoice(_frame, choice, ops) {
    const minion = choice.params["minion"];
    if (minion) ops.emit({ type: "MinionUnlocked", minion });
  },
};

/**
 * The Rack (101536) — the first card whose text asks a question twice:
 * "as this location is played **or its controller changes**, its
 * controller chooses a ready vampire they control" (both raise a
 * ChoiceFrame, docs/choice-frames-design.md), and the answer, stored in
 * `entry.chosen`, is read back by a later clause: "during this location's
 * controller's unlock phase, the chosen vampire can gain 2 blood".
 * Stealable by another Methuselah's vampire, which is what makes the
 * control-change branch reachable.
 */
const theRack: CardHandler = {
  ...compileSpec(specByName("The Rack")),
  resolve(play, ops) {
    ops.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: null,
      statics: {},
      tags: ["location"],
    });
    ops.raiseChoice({
      seat: play.seat,
      cardName: "The Rack",
      cardId: play.card.id,
      key: "chooseVampire",
    });
  },
  onControlChanged(entry, to, ops) {
    ops.raiseChoice({
      seat: to,
      cardName: "The Rack",
      cardId: entry.card.id,
      key: "chooseVampire",
    });
  },
  choiceOptions(frame, state) {
    return getSeat(state, frame.seat)
      .minions.filter((m) => m.kind === "vampire" && isReady(m))
      .map((m) => ({
        id: `choice:The Rack:${frame.cardId}:chooseVampire:${m.id}`,
        kind: "answerChoice" as const,
        label: `The Rack: choose ${m.name}`,
        params: { minion: m.id },
      }));
  },
  applyChoice(frame, choice, ops) {
    const picked = choice.params["minion"];
    if (!picked) return;
    const entry = ops.state.seats
      .flatMap((s) => s.permanents)
      .find((p) => p.card.id === frame.cardId);
    if (entry) entry.chosen = picked;
  },
  abilityOptions(entry, owner, ctx) {
    if (ctx.window !== "turn.unlock" || ctx.seat !== owner.seat) return [];
    if (ctx.turnSeat !== owner.seat || entry.usedThisPhase) return [];
    const chosen = entry.chosen ? findMinion(ctx.state, entry.chosen) : null;
    // Only the chosen vampire, and only while it is still this seat's and
    // in the ready region.
    if (!chosen || chosen.controller !== owner.seat || !isReady(chosen)) return [];
    return [
      {
        id: `ability:The Rack:${entry.card.id}:${chosen.id}`,
        kind: "useAbility",
        label: `The Rack: ${chosen.name} gains 2 blood`,
        source: entry.card.id,
        params: { target: chosen.id },
      },
    ];
  },
  useAbility(entry, _owner, choice, ops) {
    const target = choice.params["target"];
    if (!target) return;
    entry.usedThisPhase = true;
    ops.emit({ type: "BloodGained", minion: target, amount: 2 });
  },
};

/**
 * Fragment of the Book of Nod (100785) — "you can lock this card to draw 2
 * cards (discard down afterward)". The discard-down is a *repeated*
 * non-optional ChoiceFrame: the seat picks which cards go, but cannot stop
 * above hand size. Discards here draw no replacement (they are not plays,
 * p. 7). Deviation: the lock ability is offered only during its
 * controller's own turn phases; the card prints no timing restriction, so
 * "any time" would be more faithful.
 */
const nodFragment: CardHandler = {
  ...compileSpec(specByName("Fragment of the Book of Nod")),
  abilityOptions(entry, owner, ctx) {
    if (ctx.seat !== owner.seat || ctx.turnSeat !== owner.seat) return [];
    if (entry.locked || !ctx.window.startsWith("turn.")) return [];
    return [
      {
        id: `ability:Fragment of the Book of Nod:${entry.card.id}:draw`,
        kind: "useAbility",
        label: "Fragment of the Book of Nod: lock to draw 2 cards",
        source: entry.card.id,
        params: {},
      },
    ];
  },
  useAbility(entry, owner, _choice, ops) {
    ops.lockPermanent(entry.card.id);
    ops.drawCards(owner.seat, 2);
    raiseDiscardDown(ops, owner.seat, entry.card.id);
  },
  choiceOptions(frame, state) {
    return getSeat(state, frame.seat).hand.map((c) => ({
      id: `choice:Fragment of the Book of Nod:${frame.cardId}:discardDown:${c.id}`,
      kind: "answerChoice" as const,
      label: `Discard ${c.name}`,
      params: { card: c.id },
    }));
  },
  applyChoice(frame, choice, ops) {
    const cardId = choice.params["card"];
    if (!cardId) return;
    // A forced discard-down is not a play: no replacement draw (p. 7).
    ops.discardFromHand(frame.seat, cardId, false);
    raiseDiscardDown(ops, frame.seat, frame.cardId);
  },
};

/** Re-raise the discard-down question while the hand is over its size. */
function raiseDiscardDown(ops: EngineOps, seat: SeatId, cardId: string): void {
  if (getSeat(ops.state, seat).hand.length <= handSizeOf(ops.state, seat)) return;
  ops.raiseChoice({
    seat,
    cardName: "Fragment of the Book of Nod",
    cardId,
    key: "discardDown",
  });
}

/**
 * Powerbase: Montreal (101439) — unique location, the first *stealable*
 * card in play (docs/control-change-design.md). "During your influence
 * phase, you can add 1 blood to a vampire in your uncontrolled region"
 * (once per phase, p. 16 "During X, do Y"); "Vampires can steal this
 * location as a Ⓓ action" rides the shared `vulnerableTo` clause with
 * `outcome: "steal"`, so control — and with it the influence-phase
 * ability — passes to the thief.
 */
const powerbaseMontreal: CardHandler = {
  ...compileSpec(specByName("Powerbase: Montreal")),
  abilityOptions(entry, owner, ctx) {
    if (ctx.window !== "turn.influence" || ctx.seat !== owner.seat) return [];
    if (ctx.turnSeat !== owner.seat || entry.usedThisPhase) return [];
    return getSeat(ctx.state, owner.seat).uncontrolled.map((u) => ({
      id: `ability:Powerbase: Montreal:${entry.card.id}:${u.card.id}`,
      kind: "useAbility" as const,
      label: `Powerbase: Montreal: add 1 blood to ${u.card.name}`,
      source: entry.card.id,
      params: { target: u.card.id },
    }));
  },
  useAbility(entry, owner, choice, ops) {
    const target = choice.params["target"];
    if (!target) throw new Error("Powerbase: Montreal: no target");
    entry.usedThisPhase = true;
    ops.emit({
      type: "UncontrolledBloodAdded",
      seat: owner.seat,
      minion: target,
      amount: 1,
    });
  },
};

/**
 * Cave of Apples (100311) — unique Ministry location, the first effect
 * that steals a *minion* (docs/control-change-design.md §5). "Followers of
 * Set you control can put 1 corruption counter on an ally or younger
 * vampire controlled by your prey as a Ⓓ action" — a granted action that
 * targets a minion without entering combat. "If the action is successful
 * and the number of your corruption counters on the minion equals or
 * exceeds their capacity or cost, you can burn those counters to steal
 * that minion": a real optional choice since choice frames landed
 * (docs/choice-frames-design.md) — the controller may decline.
 */
/**
 * Heartrender (102327) — "The Heartrender can remove itself from the game
 * to burn a non-wraith non-zombie ally or retainer as a +1 stealth Ⓓ
 * action" (docs/wraith-zombie-design.md §7).
 *
 * A bespoke overlay on the ordinary ally spec, because the action targets
 * either a MINION (an ally) or a CARD IN PLAY (a retainer) and no single
 * grant clause covers both. Two readings on record:
 *
 * - **The removal is a cost, so it happens at RESOLUTION**, not at
 *   announcement — a blocked action removes nothing. That is how every
 *   other `grantedCost` behaves (p. 27), and announcing an action with an
 *   actor that has already left play is not expressible anyway.
 * - **"Non-wraith non-zombie" excludes its own kind**, so the Heartrender
 *   cannot burn another wraith. The filter reads the victim's printed
 *   sub-type, which for a retainer sits directly on the card in play and
 *   for an ally sits on its self-attached entry.
 */
const heartrender: CardHandler = {
  ...compileSpec(specByName("Heartrender")),
  actionOptions(entry, owner, ctx) {
    if (ctx.window !== "turn.minion" || ctx.seat !== owner.seat) return [];
    // The actor IS the Heartrender: `owner.minion` is the ally its card
    // text is attached to.
    const me = owner.minion === null ? null : findMinion(ctx.state, owner.minion);
    if (!me || !canAct(me)) return [];
    const opts: LegalOption[] = [];
    for (const s of ctx.state.seats) {
      if (s.ousted) continue;
      for (const victim of s.minions) {
        if (victim.kind !== "ally" || victim.id === me.id) continue;
        if (minionHasTag(victim, "wraith", "zombie")) continue;
        opts.push({
          id: `act:Heartrender:${entry.card.id}:rend:${me.id}:${victim.id}`,
          kind: "useEntryAction",
          label: `${me.name}: burn ${victim.name} (+1 stealth Ⓓ)`,
          source: entry.card.id,
          minion: me.id,
          params: { victim: victim.id, kind: "minion" },
        });
      }
      for (const bearer of s.minions) {
        for (const p of bearer.attached) {
          // Retainers only, and never the bearer's own card text.
          if (p.card.id === bearer.id) continue;
          if (!p.tags.includes("retainer")) continue;
          if (p.tags.includes("wraith") || p.tags.includes("zombie")) continue;
          opts.push({
            id: `act:Heartrender:${entry.card.id}:rend:${me.id}:${p.card.id}`,
            kind: "useEntryAction",
            label: `${me.name}: burn ${p.card.name} (+1 stealth Ⓓ)`,
            source: entry.card.id,
            minion: me.id,
            params: { victim: p.card.id, kind: "permanent" },
          });
        }
      }
    }
    return opts;
  },
  useActionOption(entry, _owner, choice, ops) {
    const victim = choice.params["victim"];
    if (!victim) throw new Error("Heartrender: no victim");
    const isMinion = choice.params["kind"] === "minion";
    ops.announceEntryAction(entry, choice.minion, {
      effect: { key: "rend", params: { victim, kind: choice.params["kind"] ?? "minion" } },
      stealth: 1,
      ...(isMinion ? { targetMinion: victim } : { targetPermanent: victim }),
    });
  },
  resolveGrantedAction(entry, af, ops) {
    const victim = af.grantedEffect?.params["victim"];
    if (!victim) return;
    if (af.grantedEffect?.params["kind"] === "minion") {
      // It can have left play during the action.
      if (findMinion(ops.state, victim)) ops.burnMinion(victim);
    } else {
      ops.burnPermanent(victim);
    }
    // "…can REMOVE ITSELF FROM THE GAME to…": the cost, paid at
    // resolution like every other granted cost (p. 27).
    if (findMinion(ops.state, af.acting)) ops.removeMinionFromGame(af.acting);
  },
};

const caveOfApples: CardHandler = {
  ...compileSpec(specByName("Cave of Apples")),
  actionOptions(entry, owner, ctx) {
    if (ctx.window !== "turn.minion" || ctx.seat !== owner.seat) return [];
    const prey = preyOf(ctx.state, owner.seat);
    if (prey === owner.seat) return [];
    const opts: LegalOption[] = [];
    for (const actor of getSeat(ctx.state, owner.seat).minions) {
      if (actor.kind !== "vampire" || actor.clan !== "Ministry" || !canAct(actor)) continue;
      if (
        entry.grantedActionUses?.some(
          (u) => u.minion === actor.id && u.key === "corrupt",
        )
      ) {
        continue;
      }
      for (const victim of getSeat(ctx.state, prey).minions) {
        // "an ally or younger vampire": younger = lower capacity.
        if (victim.kind === "vampire" && victim.capacity >= actor.capacity) continue;
        opts.push({
          id: `act:Cave of Apples:${entry.card.id}:corrupt:${actor.id}:${victim.id}`,
          kind: "useEntryAction",
          label: `${actor.name}: put a corruption counter on ${victim.name} (Ⓓ)`,
          source: entry.card.id,
          minion: actor.id,
          params: { victim: victim.id },
        });
      }
    }
    return opts;
  },
  useActionOption(entry, _owner, choice, ops) {
    const victim = choice.params["victim"];
    if (!victim) throw new Error("Cave of Apples: no victim");
    ops.announceEntryAction(entry, choice.minion, {
      effect: { key: "corrupt", params: { victim } },
      targetMinion: victim,
    });
  },
  resolveGrantedAction(entry, af, ops) {
    const victimId = af.grantedEffect?.params["victim"];
    if (!victimId) return;
    const victim = findMinion(ops.state, victimId);
    if (!victim) return; // left play during the action
    const seat = entry.controller ?? af.actingSeat;
    ops.addCorruption(victim.id, seat, 1);
    // "…equals or exceeds their capacity or cost": vampires are measured
    // by capacity, allies by their printed pool cost.
    const threshold = victim.kind === "ally" ? (victim.cost ?? 0) : victim.capacity;
    const counters = victim.corruption?.[seat] ?? 0;
    if (counters >= threshold) {
      // "You CAN burn those counters to steal that minion" — the
      // controller's call.
      ops.raiseChoice({
        seat,
        cardName: "Cave of Apples",
        cardId: entry.card.id,
        key: "steal",
        params: { victim: victim.id },
        optional: true,
      });
    }
  },
  choiceOptions(frame, state) {
    const victim = frame.params["victim"];
    if (!victim) return [];
    const m = findMinion(state, victim);
    if (!m) return [];
    return [
      {
        id: `choice:Cave of Apples:${frame.cardId}:steal:${victim}`,
        kind: "answerChoice" as const,
        label: `Cave of Apples: burn your corruption counters to steal ${m.name}`,
        params: { victim },
      },
    ];
  },
  applyChoice(frame, choice, ops) {
    const victimId = choice.params["victim"];
    if (!victimId) return;
    const victim = findMinion(ops.state, victimId);
    if (!victim) return;
    const counters = victim.corruption?.[frame.seat] ?? 0;
    ops.removeCorruption(victim.id, frame.seat, counters);
    ops.changeMinionControl(victim.id, frame.seat);
  },
};

/**
 * Creeping Sabotage (102213) and Army of Rats (100093) — the first two
 * cards of the "Minions can burn this card as a Ⓓ action" family
 * (docs/granted-actions-design.md §4.5; the burn clause itself compiles
 * from `permanent.vulnerableTo`). Both put themselves in play with a +1
 * stealth action and drip 1 pool off the prey each unlock phase.
 */
const creepingSabotage: CardHandler = {
  ...compileSpec(specByName("Creeping Sabotage")),
  onControllerUnlock(_entry, owner, ops) {
    ops.emit({ type: "PoolBurned", seat: preyOf(ops.state, owner.seat), amount: 1 });
  },
};

const armyOfRats: CardHandler = {
  ...compileSpec(specByName("Army of Rats")),
  onControllerUnlock(entry, owner, ops) {
    // "You can burn only 1 pool each turn with Army of Rats cards" — the
    // cap is across copies, so the first copy to fire spends the latch on
    // all of them (latches reset at the start of every unlock phase).
    if (entry.usedThisPhase) return;
    for (const p of getSeat(ops.state, owner.seat).permanents) {
      if (p.card.name === "Army of Rats") p.usedThisPhase = true;
    }
    ops.emit({ type: "PoolBurned", seat: preyOf(ops.state, owner.seat), amount: 1 });
  },
};

/**
 * Pit of Contemplation (102291) — compiled action (puts itself in play
 * with 1 counter) plus two bespoke clauses
 * (docs/granted-actions-design.md §5):
 *   - "Hecata you control can add 1 counter to this card as a +1 stealth
 *     action" — the first *granted* action whose effect is not entering
 *     combat: undirected, no target, resolved by `resolveGrantedAction`.
 *     One use per Hecata per turn (p. 20).
 *   - "During your unlock phase, you can burn this card to move a vampire
 *     controlled by your predator or prey with capacity less than X to
 *     their owner's uncontrolled region, where X is the number of counters
 *     on this card" — reuses Banishment's `MovedToUncontrolled`.
 * Its third clause, "Vampires can burn this card as a Ⓓ action", is the
 * shared `vulnerableTo` grant — so this card carries *two* granted
 * actions, distinguished by the option id's segment and by the effect key.
 */
const pitVulnerable = vulnerableGrant(specByName("Pit of Contemplation"));

const pitOfContemplation: CardHandler = {
  ...compileSpec(specByName("Pit of Contemplation")),
  actionOptions(entry, owner, ctx) {
    // Clause 3 ("Vampires can burn this card"), open to every Methuselah.
    const opts: LegalOption[] = [...(pitVulnerable.actionOptions?.(entry, owner, ctx) ?? [])];
    // Clause 2 ("Hecata you control can add 1 counter"), controller only.
    if (ctx.window !== "turn.minion" || ctx.seat !== owner.seat) return opts;
    for (const m of getSeat(ctx.state, owner.seat).minions) {
      if (m.kind !== "vampire" || m.clan !== "Hecata" || !canAct(m)) continue;
      // One use of this action per minion per copy per turn (p. 20).
      if (
        entry.grantedActionUses?.some(
          (u) => u.minion === m.id && u.key === "addCounter",
        )
      ) {
        continue;
      }
      opts.push({
        id: `act:Pit of Contemplation:${entry.card.id}:counter:${m.id}`,
        kind: "useEntryAction",
        label: `${m.name}: add a counter to Pit of Contemplation (+1 stealth action)`,
        source: entry.card.id,
        minion: m.id,
        params: {},
      });
    }
    return opts;
  },
  useActionOption(entry, owner, choice, ops) {
    if (choice.id.includes(`:${entry.card.id}:burn:`)) {
      pitVulnerable.useActionOption?.(entry, owner, choice, ops);
      return;
    }
    ops.announceEntryAction(entry, choice.minion, {
      effect: { key: "addCounter" },
      stealth: 1,
    });
  },
  resolveGrantedAction(entry, af, ops) {
    if (af.grantedEffect?.key === "burnCard") {
      ops.burnPermanent(entry.card.id);
      return;
    }
    ops.addCounters(entry.card.id, 1);
  },
  abilityOptions(entry, owner, ctx) {
    // "During your unlock phase" — the controller's own (§4 of the design;
    // the window is offered to other seats too).
    if (ctx.window !== "turn.unlock" || ctx.seat !== owner.seat) return [];
    if (ctx.turnSeat !== owner.seat) return [];
    const x = entry.counters ?? 0;
    const neighbours = [preyOf(ctx.state, owner.seat), predatorOf(ctx.state, owner.seat)];
    const opts: LegalOption[] = [];
    for (const seatId of new Set(neighbours)) {
      if (seatId === owner.seat) continue;
      for (const m of getSeat(ctx.state, seatId).minions) {
        if (m.kind !== "vampire" || m.capacity >= x) continue;
        opts.push({
          id: `ability:Pit of Contemplation:${entry.card.id}:${m.id}`,
          kind: "useAbility",
          label: `Pit of Contemplation: burn it to move ${m.name} (${seatId}) to the uncontrolled region`,
          source: entry.card.id,
          params: { target: m.id },
        });
      }
    }
    return opts;
  },
  useAbility(entry, _owner, choice, ops) {
    const target = choice.params["target"];
    if (!target) throw new Error("Pit of Contemplation: no target");
    const m = findMinion(ops.state, target);
    if (!m) return;
    // "Their owner's uncontrolled region" — owner and controller coincide
    // until control-change lands (design §6.2).
    ops.emit({ type: "MovedToUncontrolled", seat: m.controller, minion: m.id });
    ops.burnPermanent(entry.card.id);
  },
};

/** Under Siege (102063) — compiled action (puts itself in play with 3
 *  counters) plus the in-play ability: once each action, a Sabbat vampire
 *  you control burns 1 counter to unlock and attempt to block with +1
 *  intercept (reusing the unlock-and-block machinery). Burn at 0 counters. */
const underSiege: CardHandler = {
  ...compileSpec(specByName("Under Siege")),
  abilityOptions(entry, owner, ctx) {
    if (ctx.window !== "action.effects" || ctx.seat !== owner.seat) return [];
    const af = ctx.action;
    if (!af || af.step !== "A" || ctx.blockAttempt) return [];
    if ((entry.counters ?? 0) <= 0 || af.usedInPlayAbilities.includes(entry.card.id)) return [];
    if (!blockEligibleSeats(ctx.state, af).includes(ctx.seat)) return [];
    const opts: LegalOption[] = [];
    for (const m of getSeat(ctx.state, owner.seat).minions) {
      if (m.kind === "vampire" && m.sect === "sabbat" && isReady(m)) {
        opts.push({
          id: `ability:Under Siege:${entry.card.id}:${m.id}`,
          kind: "useAbility",
          label: `Under Siege: ${m.name} burns a counter to unlock and block (+1 intercept)`,
          source: entry.card.id,
          params: { target: m.id },
        });
      }
    }
    return opts;
  },
  useAbility(entry, _owner, choice, ops) {
    const target = choice.params["target"];
    if (!target) return;
    ops.removeCounters(entry.card.id, 1);
    ops.markInPlayAbilityUsed(entry.card.id);
    ops.unlockAndAttemptBlock(target, { interceptBonus: 1 });
    if ((entry.counters ?? 0) <= 0) ops.burnPermanent(entry.card.id);
  },
};

/** Alamut (100037) — bespoke counter location. Accumulate: after a Banu
 *  Haqim (Assamite) you control successfully bleeds a Methuselah, add the
 *  pool lost as counters. Spend: during polling, burn X counters to give a
 *  vampire you control +X votes. */
const alamut: CardHandler = {
  name: "Alamut",
  bloodCost: 0,
  poolCost: 1,
  isMasterCard: true,
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    if (seatControlsCopy(ctx.state, ctx.seat, this.name)) return [];
    if (getSeat(ctx.state, ctx.seat).pool <= 1) return [];
    return [
      {
        id: playOptionId(this.name, null, card.id),
        kind: "playCard",
        label: "Alamut — put in play",
        card: card.id,
        name: this.name,
        minion: null,
        mode: null,
        params: {},
      },
    ];
  },
  resolve(play, ops) {
    ops.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: null,
      statics: {},
      tags: ["location"],
      counters: 0,
    });
  },
  onBleedSuccess(entry, owner, info, ops) {
    const m = findMinion(ops.state, info.actingMinion);
    if (m && m.controller === owner.seat && m.clan === "Banu Haqim") {
      ops.addCounters(entry.card.id, info.amount);
    }
  },
  abilityOptions(entry, owner, ctx) {
    if (ctx.window !== "referendum.polling" || ctx.seat !== owner.seat) return [];
    const counters = entry.counters ?? 0;
    if (counters <= 0) return [];
    const hasVampire = getSeat(ctx.state, owner.seat).minions.some(
      (m) => m.kind === "vampire" && isReady(m),
    );
    if (!hasVampire) return [];
    const opts: LegalOption[] = [];
    for (let x = 1; x <= counters; x++) {
      opts.push({
        id: `ability:Alamut:${entry.card.id}:votes:${x}`,
        kind: "useAbility",
        label: `Alamut: burn ${x} counter(s) for +${x} votes`,
        source: entry.card.id,
        params: { x: String(x) },
      });
    }
    return opts;
  },
  useAbility(entry, owner, choice, ops) {
    const x = Number(choice.params["x"] ?? "0");
    if (x <= 0) return;
    ops.removeCounters(entry.card.id, x);
    ops.grantVotes(owner.seat, x);
  },
};

/** Dead Pool (102299) — bespoke counter card. Accumulate: after a vampire
 *  in combat with a Lasombra you control leaves the ready region, you can
 *  add 1 counter. Spend: a Lasombra you control burns 1 counter during
 *  its bleed for +2 bleed, or during polling for +2 votes.
 *
 *  The "you can" is a real ChoiceFrame and has been since choice frames
 *  landed (docs/choice-frames-design.md). This comment claimed it was
 *  auto-taken for several waves after that stopped being true, and the
 *  ledger row copied the claim — the same stale-comment rot the audit
 *  found on Aggressive Corpse (docs/ledger-closeout.md §5). */
const deadPool: CardHandler = {
  name: "Dead Pool",
  bloodCost: 0,
  poolCost: 0,
  isMasterCard: true,
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    if (seatControlsCopy(ctx.state, ctx.seat, this.name)) return [];
    return [
      {
        id: playOptionId(this.name, null, card.id),
        kind: "playCard",
        label: "Dead Pool — put in play",
        card: card.id,
        name: this.name,
        minion: null,
        mode: null,
        params: {},
      },
    ];
  },
  resolve(play, ops) {
    ops.putPermanentInPlay({ card: play.card, seat: play.seat, attachTo: null, statics: {}, tags: [], counters: 0 });
  },
  onCombatLeave(entry, owner, info, ops) {
    const other = findMinion(ops.state, info.other);
    const leaver = findMinion(ops.state, info.leaver);
    if (other && other.controller === owner.seat && other.clan === "Lasombra" && leaver && leaver.kind === "vampire") {
      // "You CAN add a counter" — an optional choice since choice frames
      // landed (docs/choice-frames-design.md); previously auto-taken.
      ops.raiseChoice({
        seat: owner.seat,
        cardName: "Dead Pool",
        cardId: entry.card.id,
        key: "addCounter",
        optional: true,
      });
    }
  },
  choiceOptions(frame) {
    return [
      {
        id: `choice:Dead Pool:${frame.cardId}:addCounter:yes`,
        kind: "answerChoice" as const,
        label: "Dead Pool: add a counter",
        params: {},
      },
    ];
  },
  applyChoice(frame, _choice, ops) {
    ops.addCounters(frame.cardId, 1);
  },
  abilityOptions(entry, owner, ctx) {
    if (ctx.seat !== owner.seat || (entry.counters ?? 0) <= 0) return [];
    // During your Lasombra's bleed: +2 bleed.
    if (ctx.window === "action.effects" && ctx.action?.actionKind === "bleed") {
      const actor = findMinion(ctx.state, ctx.action.acting);
      if (actor && actor.controller === owner.seat && actor.clan === "Lasombra") {
        return [{ id: `ability:Dead Pool:${entry.card.id}:bleed`, kind: "useAbility", label: "Dead Pool: burn a counter for +2 bleed", source: entry.card.id, params: { do: "bleed" } }];
      }
    }
    // During polling: +2 votes (you control a Lasombra).
    if (ctx.window === "referendum.polling") {
      const hasLasombra = getSeat(ctx.state, owner.seat).minions.some(
        (m) => m.kind === "vampire" && m.clan === "Lasombra" && isReady(m),
      );
      if (hasLasombra) {
        return [{ id: `ability:Dead Pool:${entry.card.id}:votes`, kind: "useAbility", label: "Dead Pool: burn a counter for +2 votes", source: entry.card.id, params: { do: "votes" } }];
      }
    }
    return [];
  },
  useAbility(entry, owner, choice, ops) {
    ops.removeCounters(entry.card.id, 1);
    const af = ops.action();
    if (choice.params["do"] === "bleed" && af) {
      ops.emit({ type: "BleedAmountModified", actionId: af.actionId, delta: 2, source: "Dead Pool", limited: false });
    } else {
      ops.grantVotes(owner.seat, 2);
    }
  },
};

/** Constant Revolution (100416) — fully compiled since 2026-09-02: the
 *  accumulator is `permanent.unlockCounter`, the punish is
 *  `permanent.unlockToll` (which asks the payer how to split it, retiring
 *  the "and/or cards at random" deviation) and the counter-play is
 *  `permanent.vulnerableTo`. docs/unlock-tolls-design.md */
const constantRevolution: CardHandler = compileSpec(specByName("Constant Revolution"));

/** Smiling Jack, The Anarch (101811) — hand-rolled until 2026-09-02, now
 *  fully compiled: the pool-bought accumulator is
 *  `permanent.unlockCounter.fromPool`, the "1 pool or a vampire blood"
 *  toll is `permanent.unlockToll` and the counter-play is
 *  `permanent.vulnerableTo`. p. 50 rules all three
 *  (docs/unlock-tolls-design.md §1). */
const smilingJack: CardHandler = compileSpec(specByName("Smiling Jack, The Anarch"));

/**
 * Wasserschloss Anif, Austria (102152) — bespoke counter location. Master
 * phase: a Tremere you control moves 1 blood to a counter. Influence
 * phase: lock to move all counters to a Tremere in your uncontrolled
 * region (as blood).
 *
 * "Any minion can burn this card as a Ⓓ action; Malkavians get +1 stealth
 * during that action" was a recorded deviation until 2026-09-02 — it is
 * `vulnerableTo` with `stealthFor`, grafted from a local spec clause.
 *
 * p. 51 also rules: "Wasserschloss Anif can only receive blood from ONE
 * Tremere on any given turn." The master-phase offer was unlatched, so
 * every Tremere could feed it in the same phase; it now spends
 * `usedThisPhase`.
 */
const wasserschlossVulnerable = vulnerableGrant({
  krcgId: 102152,
  name: "Wasserschloss Anif, Austria",
  cardType: "master",
  bloodCost: 0,
  poolCost: 0,
  usable: [],
  modes: [],
  permanent: {
    where: "seat",
    statics: {},
    // "ANY minion" — no `who` filter at all, unlike its three siblings.
    vulnerableTo: { stealthFor: [{ clan: "Malkavian", delta: 1 }] },
  },
});

const wasserschloss: CardHandler = {
  ...wasserschlossVulnerable,
  name: "Wasserschloss Anif, Austria",
  bloodCost: 0,
  poolCost: 0,
  isMasterCard: true,
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    if (seatControlsCopy(ctx.state, ctx.seat, this.name)) return [];
    return [
      {
        id: playOptionId(this.name, null, card.id),
        kind: "playCard",
        label: "Wasserschloss Anif — put in play",
        card: card.id,
        name: this.name,
        minion: null,
        mode: null,
        params: {},
      },
    ];
  },
  resolve(play, ops) {
    ops.putPermanentInPlay({ card: play.card, seat: play.seat, attachTo: null, statics: {}, tags: ["location"], counters: 0 });
  },
  abilityOptions(entry, owner, ctx) {
    if (ctx.seat !== owner.seat) return [];
    const opts: LegalOption[] = [];
    // "Wasserschloss Anif can only receive blood from ONE Tremere on any
    // given turn" (p. 51). The offer was unlatched until 2026-09-02.
    if (ctx.window === "turn.master" && !entry.usedThisPhase) {
      for (const m of getSeat(ctx.state, owner.seat).minions) {
        if (m.kind === "vampire" && m.clan === "Tremere" && isReady(m) && m.blood >= 1) {
          opts.push({
            id: `ability:Wasserschloss Anif, Austria:${entry.card.id}:feed:${m.id}`,
            kind: "useAbility",
            label: `Wasserschloss: ${m.name} moves 1 blood to a counter`,
            source: entry.card.id,
            params: { do: "feed", target: m.id },
          });
        }
      }
    }
    if (ctx.window === "turn.influence" && !entry.locked && (entry.counters ?? 0) > 0) {
      for (const u of getSeat(ctx.state, owner.seat).uncontrolled) {
        if (u.card.clan === "Tremere") {
          opts.push({
            id: `ability:Wasserschloss Anif, Austria:${entry.card.id}:move:${u.card.id}`,
            kind: "useAbility",
            label: `Wasserschloss: move counters to ${u.card.name}`,
            source: entry.card.id,
            params: { do: "move", target: u.card.id },
          });
        }
      }
    }
    return opts;
  },
  useAbility(entry, owner, choice, ops) {
    const target = choice.params["target"];
    if (!target) return;
    if (choice.params["do"] === "feed") {
      entry.usedThisPhase = true; // one Tremere per turn (p. 51)
      ops.emit({ type: "BloodBurned", minion: target, amount: 1 });
      ops.addCounters(entry.card.id, 1);
    } else {
      const c = entry.counters ?? 0;
      ops.lockPermanent(entry.card.id);
      ops.emit({ type: "UncontrolledBloodAdded", seat: owner.seat, minion: target, amount: c });
      ops.removeCounters(entry.card.id, c);
    }
  },
};

/** The Platinum Protocol (102232) — bespoke Anarch bleed action; "more than
 *  one Discipline can be used", so the acting vampire applies each rider it
 *  has: [obf] +1 stealth, [pre] +1 bleed, [pro] on a successful bleed put a
 *  corruption counter on a chosen minion of the target. */
const platinumProtocol: CardHandler = {
  name: "The Platinum Protocol",
  bloodCost: 0,
  isActionCard: true,
  options(card, ctx) {
    if (ctx.window !== "turn.minion") return [];
    const seat = getSeat(ctx.state, ctx.seat);
    const prey = getSeat(ctx.state, preyOf(ctx.state, ctx.seat));
    const opts: LegalOption[] = [];
    for (const m of seat.minions) {
      if (m.kind !== "vampire" || !canAct(m) || m.bledThisTurn || m.sect !== "anarch") continue;
      const mk = (params: Record<string, string>): LegalOption => ({
        id: playOptionId("The Platinum Protocol", "basic", m.id, ...Object.values(params), card.id),
        kind: "playCard",
        label: `The Platinum Protocol — ${m.name}${params["target"] ? ` (corrupt ${params["target"]})` : ""}`,
        card: card.id,
        name: "The Platinum Protocol",
        minion: m.id,
        mode: "basic",
        params,
      });
      if (m.disciplines["pro"] && prey.minions.length > 0) {
        for (const pm of prey.minions) opts.push(mk({ target: pm.id }));
      } else {
        opts.push(mk({}));
      }
    }
    return opts;
  },
  resolve(play, ops) {
    if (!play.minion) return;
    const m = getMinion(ops.state, play.minion);
    const params: { actionKind: "bleed"; bleedBonus?: number; inherentStealth?: number } = { actionKind: "bleed" };
    if (m.disciplines["obf"]) params.inherentStealth = 1;
    if (m.disciplines["pre"]) params.bleedBonus = 1;
    ops.announceCardAction(play, params);
  },
  resolveCardAction(af, ops) {
    const m = findMinion(ops.state, af.acting);
    const target = af.card?.params["target"];
    if (m && m.disciplines["pro"] && target && currentBleed(ops.state, af) >= 1) {
      ops.addCorruption(target, m.controller, 1);
    }
  },
};

/** Dummy Corporation (100594) — bespoke: a unique seat location that
 *  burns itself to reduce a bleed against its controller by 2 (any time
 *  the controller holds the impulse during such a bleed). */
const dummyCorporation: CardHandler = {
  name: "Dummy Corporation",
  bloodCost: 0,
  poolCost: 0,
  isMasterCard: true,
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    if (seatControlsCopy(ctx.state, ctx.seat, this.name)) return [];
    return [
      {
        id: playOptionId(this.name, null, card.id),
        kind: "playCard",
        label: "Dummy Corporation — put in play",
        card: card.id,
        name: this.name,
        minion: null,
        mode: null,
        params: {},
      },
    ];
  },
  resolve(play, ops) {
    ops.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: null,
      statics: {},
      tags: ["location"],
    });
  },
  abilityOptions(entry, owner, ctx) {
    if (ctx.window !== "action.effects") return [];
    const af = ctx.action;
    // "If a minion is bleeding you" — a bleed action targeting this seat.
    if (!af || af.actionKind !== "bleed" || af.target !== owner.seat) return [];
    if (ctx.seat !== owner.seat) return [];
    return [
      {
        id: `ability:Dummy Corporation:${entry.card.id}:reduce`,
        kind: "useAbility",
        label: "Dummy Corporation: burn to reduce the bleed by 2",
        source: entry.card.id,
        params: {},
      },
    ];
  },
  useAbility(entry, _owner, _choice, ops) {
    const af = ops.action();
    if (!af) throw new Error("Dummy Corporation used outside an action");
    ops.emit({
      type: "BleedAmountModified",
      actionId: af.actionId,
      delta: -2,
      source: "Dummy Corporation",
      limited: false,
    });
    ops.burnPermanent(entry.card.id); // "burn this card"
  },
};

/**
 * Frontal Assault (100794) — the rush grant compiles from the spec
 * (docs/granted-rush-design.md); the two clauses around it ride the new
 * hooks. "You gain 1 pool after a ready minion controlled by your prey is
 * burned or sent to torpor" fires on every such departure, however it was
 * caused. "During your influence phase, burn this card and burn 1 pool
 * for each ready minion controlled by your prey" is mandatory, so the
 * card lasts exactly one turn cycle and its cost is decided by how well
 * the prey's minions survived.
 */
const frontalAssault: CardHandler = {
  ...compileSpec(specByName("Frontal Assault")),
  onLeaveReady(entry, owner, info, ops) {
    const controller = entry.controller ?? owner.seat;
    if (info.controller !== preyOf(ops.state, controller)) return;
    ops.emit({ type: "PoolGained", seat: controller, amount: 1 });
  },
  onInfluencePhase(entry, owner, turnSeat, ops) {
    const controller = entry.controller ?? owner.seat;
    if (turnSeat !== controller) return; // "during YOUR influence phase"
    const prey = getSeat(ops.state, preyOf(ops.state, controller));
    const amount = prey.minions.filter((m) => isReady(m)).length;
    ops.burnPermanent(entry.card.id);
    if (amount > 0) ops.emit({ type: "PoolBurned", seat: controller, amount });
  },
};

/**
 * Priority Contract (101487) — two picks at play time, so its options
 * enumerate (chosen Assamite × prey minion) pairs rather than the single
 * target `attach` produces; the Assamite lands in `entry.chosen`, which
 * the compiled rush grant reads back. "If the attached minion is about to
 * leave the ready region, you can burn this card to gain 3 pool" is a
 * ChoiceFrame on the new onLeaveReady hook — asked before the departure,
 * which is what "about to" buys you: the pool arrives even though the
 * card would be lost with a burned bearer.
 */
const priorityContract: CardHandler = {
  ...compileSpec(specByName("Priority Contract")),
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    const seat = getSeat(ctx.state, ctx.seat);
    if (seatControlsCopy(ctx.state, ctx.seat, "Priority Contract")) return [];
    const assamites = seat.minions.filter(
      // "Assamite" is the V5 Banu Haqim clan — the name the registry and
      // the phase-7 crypt importer use. Filtering on the legacy name
      // matched no imported vampire (docs/lock-grant-locations-design.md §7).
      (m) => m.kind === "vampire" && m.clan === "Banu Haqim" && isReady(m),
    );
    if (assamites.length === 0) return [];
    const prey = getSeat(ctx.state, preyOf(ctx.state, ctx.seat));
    const options: LegalOption[] = [];
    for (const a of assamites) {
      for (const t of prey.minions) {
        if (!isReady(t)) continue;
        options.push({
          id: `play:Priority Contract:-:-:${a.id}:${t.id}:${card.id}`,
          kind: "playCard",
          label: `Priority Contract: ${a.name} contracted to hunt ${t.name}`,
          card: card.id,
          name: "Priority Contract",
          minion: null,
          mode: null,
          params: { chosen: a.id, target: t.id },
        });
      }
    }
    return options;
  },
  resolve(play, ops) {
    const target = play.params["target"];
    const chosen = play.params["chosen"];
    if (!target || !chosen) throw new Error("Priority Contract: no pair chosen");
    ops.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: target,
      statics: {},
      tags: ["Priority Contract", "contract"],
      // On a prey minion, but it answers to the Methuselah who played it
      // (p. 16) — including the rush it grants.
      controller: play.seat,
    });
    const entry = findEntryById(ops.state, play.card.id);
    if (entry) entry.chosen = chosen;
  },
  onLeaveReady(entry, owner, info, ops) {
    if (info.minion !== owner.minion) return; // only its own bearer
    ops.raiseChoice({
      seat: entry.controller ?? owner.seat,
      cardName: "Priority Contract",
      cardId: entry.card.id,
      key: "cashOut",
      optional: true,
    });
  },
  choiceOptions(frame) {
    return [
      {
        id: `choice:Priority Contract:${frame.cardId}:cashOut:yes`,
        kind: "answerChoice" as const,
        label: "Priority Contract: burn it to gain 3 pool",
        params: {},
      },
    ];
  },
  applyChoice(frame, _choice, ops) {
    // A burned bearer takes its attached cards with it (p. 11) while the
    // question is still open, so the card may already be gone — the 3
    // pool is the point of asking before the departure either way.
    if (findEntryById(ops.state, frame.cardId)) ops.burnPermanent(frame.cardId);
    ops.emit({ type: "PoolGained", seat: frame.seat, amount: 3 });
  },
};

// --- Archetypes (docs/archetypes-design.md) -------------------------------

/**
 * The Disciplines a card required to play it, resolved against the vampire
 * that played it (docs/archetypes-design.md §3).
 *
 * A mode's requirement is one code, `{ all: [...] }` ("requires both"), or
 * a plain array meaning "any one of these". Only the third is ambiguous —
 * the engine never records which one was used, because nothing until
 * Dabbler needed to know. `already` is the set counted so far, so an
 * "any one of" contributes an uncounted Discipline where it can.
 */
function disciplinesUsedBy(
  cardName: string,
  actor: MinionState,
  already: Set<string>,
): string[] {
  const spec = cardSpecs.find((s) => s.name === cardName);
  if (!spec) return [];
  const has = (d: string): boolean => disciplinesOf(actor)[d] !== undefined;
  const out: string[] = [];
  for (const mode of spec.modes) {
    const req = mode.discipline;
    if (req === null) continue;
    if (typeof req === "string") {
      out.push(req);
    } else if (Array.isArray(req)) {
      // "Any one of these": exactly one was used. Prefer one not counted
      // yet, and never one the vampire does not actually have.
      const owned = req.filter(has);
      const fresh = owned.find((d) => !already.has(d));
      const chosen = fresh ?? owned[0];
      if (chosen !== undefined) out.push(chosen);
    } else {
      out.push(...req.all); // "requires all" — all of them were used
    }
  }
  return out;
}

/**
 * Dabbler (100485) — "Once each turn, after an action (successful or not)
 * is resolved during which this vampire used 3 or more Disciplines to play
 * cards, this vampire can either burn 1 blood to unlock or gain 1 blood."
 *
 * No new engine state: `ActionFrame.played` already records every card a
 * minion played during the action, and the specs are in this module, so
 * the Disciplines are a lookup rather than something the kernel has to
 * carry.
 */
const dabbler: CardHandler = {
  ...compileSpec(specByName("Dabbler")),
  onActionResolved(entry, owner, info, ops) {
    if (entry.usedThisTurn || owner.minion === null) return;
    const bearer = findMinion(ops.state, owner.minion);
    if (!bearer) return;
    const af = ops.action();
    if (!af || af.actionId !== info.actionId) return;
    const used = new Set<string>();
    for (const p of af.played) {
      if (p.minion !== bearer.id) continue;
      for (const d of disciplinesUsedBy(p.card, bearer, used)) used.add(d);
    }
    if (used.size < 3) return;
    ops.raiseChoice({
      seat: entry.controller ?? owner.seat,
      cardName: "Dabbler",
      cardId: entry.card.id,
      key: "dabble",
      params: { minion: bearer.id },
      optional: true,
    });
  },
  choiceOptions(frame, state) {
    const bearer = findMinion(state, frame.params["minion"] ?? "");
    if (!bearer) return [];
    const options: LegalOption[] = [];
    // "Burn 1 blood to unlock" is only a thing for a locked vampire that
    // has the blood; an unlocked Dabbler simply takes the gain.
    if (bearer.locked && bearer.blood >= 1) {
      options.push({
        id: `choice:Dabbler:${frame.cardId}:dabble:unlock`,
        kind: "answerChoice" as const,
        label: `Dabbler: ${bearer.name} burns 1 blood to unlock`,
        params: { how: "unlock" },
      });
    }
    options.push({
      id: `choice:Dabbler:${frame.cardId}:dabble:gain`,
      kind: "answerChoice" as const,
      label: `Dabbler: ${bearer.name} gains 1 blood`,
      params: { how: "gain" },
    });
    return options;
  },
  applyChoice(frame, choice, ops) {
    const minion = frame.params["minion"];
    if (!minion) throw new Error("Dabbler: no bearer");
    const entry = findEntryById(ops.state, frame.cardId);
    if (entry) entry.usedThisTurn = true;
    if (choice.params["how"] === "unlock") {
      ops.emit({ type: "BloodBurned", minion, amount: 1 });
      ops.emit({ type: "MinionUnlocked", minion });
      return;
    }
    ops.emit({ type: "BloodGained", minion, amount: 1 });
  },
};

/**
 * Monster (101242) — "Once each turn after a combat involving this vampire
 * ends, this vampire can burn 1 blood to unlock if the opposing minion is
 * not ready."
 *
 * "The opposing minion" is whichever combatant is not the bearer, and "not
 * ready" covers both torpor and having been burned outright — a minion
 * that has left play is certainly not ready, so `findMinion` returning
 * nothing satisfies the condition rather than aborting it.
 */
const monster: CardHandler = {
  ...compileSpec(specByName("Monster")),
  onCombatEnded(entry, owner, info, ops) {
    if (entry.usedThisTurn || owner.minion === null) return;
    const bearer = findMinion(ops.state, owner.minion);
    if (!bearer || !bearer.locked || bearer.blood < 1) return;
    const otherId =
      info.acting === bearer.id ? info.opposing : info.opposing === bearer.id ? info.acting : null;
    if (otherId === null) return; // this combat did not involve the bearer
    const other = findMinion(ops.state, otherId);
    // Burned or in torpor — either way it is not ready.
    if (other && !other.inTorpor) return;
    ops.raiseChoice({
      seat: entry.controller ?? owner.seat,
      cardName: "Monster",
      cardId: entry.card.id,
      key: "prowl",
      params: { minion: bearer.id },
      optional: true,
    });
  },
  choiceOptions(frame, state) {
    const bearer = findMinion(state, frame.params["minion"] ?? "");
    if (!bearer || !bearer.locked || bearer.blood < 1) return [];
    return [
      {
        id: `choice:Monster:${frame.cardId}:prowl:yes`,
        kind: "answerChoice" as const,
        label: `Monster: ${bearer.name} burns 1 blood to unlock`,
        params: {},
      },
    ];
  },
  applyChoice(frame, _choice, ops) {
    const minion = frame.params["minion"];
    if (!minion) throw new Error("Monster: no bearer");
    const entry = findEntryById(ops.state, frame.cardId);
    if (entry) entry.usedThisTurn = true;
    ops.emit({ type: "BloodBurned", minion, amount: 1 });
    ops.emit({ type: "MinionUnlocked", minion });
  },
};

/**
 * Perfectionist (101388) — "Once each turn, this vampire can gain 1 blood
 * after performing a successful action during which no reaction cards were
 * played."
 *
 * "No reaction cards were played" is unqualified — by ANYONE, not just by
 * the acting Methuselah — so it reads the whole of `ActionFrame.played`
 * rather than filtering to the bearer. A reaction is always played by a
 * minion, so it is always recorded there.
 */
const perfectionist: CardHandler = {
  ...compileSpec(specByName("Perfectionist")),
  onActionResolved(entry, owner, info, ops) {
    if (entry.usedThisTurn || owner.minion === null) return;
    if (!info.success || info.acting !== owner.minion) return;
    const af = ops.action();
    if (!af || af.actionId !== info.actionId) return;
    const anyReaction = af.played.some((p) => {
      const spec = cardSpecs.find((s) => s.name === p.card);
      return spec?.cardType === "reaction" || spec?.cardType === "modifierOrReaction";
    });
    if (anyReaction) return;
    ops.raiseChoice({
      seat: entry.controller ?? owner.seat,
      cardName: "Perfectionist",
      cardId: entry.card.id,
      key: "flawless",
      params: { minion: owner.minion },
      optional: true,
    });
  },
  choiceOptions(frame, state) {
    const bearer = findMinion(state, frame.params["minion"] ?? "");
    if (!bearer) return [];
    return [
      {
        id: `choice:Perfectionist:${frame.cardId}:flawless:yes`,
        kind: "answerChoice" as const,
        label: `Perfectionist: ${bearer.name} gains 1 blood`,
        params: {},
      },
    ];
  },
  applyChoice(frame, _choice, ops) {
    const minion = frame.params["minion"];
    if (!minion) throw new Error("Perfectionist: no bearer");
    const entry = findEntryById(ops.state, frame.cardId);
    if (entry) entry.usedThisTurn = true;
    ops.emit({ type: "BloodGained", minion, amount: 1 });
  },
};

/**
 * Rebel (101564) — "Once each turn, if they block a titled vampire or a
 * political action, this vampire gains 1 blood before block resolution."
 *
 * The only one of the four that is NOT a choice: it says "gains", not "can
 * gain", so it fires from the hook with nothing asked. Raising a choice
 * frame for a mandatory effect would be a decision point with one answer.
 *
 * "Before block resolution" is why it hangs off `onBlockDeclared` — the
 * blood arrives whether the block goes on to succeed or fail.
 */
const rebel: CardHandler = {
  ...compileSpec(specByName("Rebel")),
  onBlockDeclared(entry, owner, info, ops) {
    if (entry.usedThisTurn || owner.minion === null) return;
    if (info.blocker !== owner.minion) return;
    const acting = findMinion(ops.state, info.acting);
    const af = ops.action();
    const cardName = af?.card?.instance.name;
    const isPolitical =
      cardName !== undefined &&
      cardSpecs.find((s) => s.name === cardName)?.cardType === "politicalAction";
    const isTitled = acting !== null && acting.kind === "vampire" && acting.title !== null;
    if (!isPolitical && !isTitled) return;
    entry.usedThisTurn = true;
    ops.emit({ type: "BloodGained", minion: owner.minion, amount: 1 });
  },
};

/**
 * The Anarch Free Press (100052) — the intercept clause compiles from the
 * spec; the hunt clause is the bespoke half.
 *
 * "You can lock this card after an Anarch successfully hunts to add 1
 * blood to that Anarch." `onHuntSuccess` is the mirror of onBleedSuccess
 * and fires from the hunt branch of action resolution, which a blocked
 * hunt never reaches — so arriving there IS the success, with no condition
 * to test. "You *can*" makes it an optional ChoiceFrame rather than an
 * automatic trigger, and `raiseChoice` queues it until the action frame
 * has popped (docs/choice-frames-design.md §3).
 *
 * "An Anarch" is unqualified — any Methuselah's, not only this one's,
 * following the Anarch Railroad precedent.
 */
const anarchFreePress: CardHandler = {
  ...compileSpec(specByName("The Anarch Free Press")),
  onHuntSuccess(entry, owner, info, ops) {
    if (entry.locked) return; // it has to be lockable to be locked
    const hunter = findMinion(ops.state, info.actingMinion);
    if (!hunter || hunter.kind !== "vampire" || hunter.sect !== "anarch") return;
    ops.raiseChoice({
      seat: entry.controller ?? owner.seat,
      cardName: "The Anarch Free Press",
      cardId: entry.card.id,
      key: "huntBlood",
      params: { minion: info.actingMinion },
      optional: true,
    });
  },
  choiceOptions(frame, state) {
    const hunter = findMinion(state, frame.params["minion"] ?? "");
    if (!hunter) return []; // burned between the hunt and the question
    return [
      {
        id: `choice:The Anarch Free Press:${frame.cardId}:huntBlood:yes`,
        kind: "answerChoice" as const,
        label: `The Anarch Free Press: lock to add 1 blood to ${hunter.name}`,
        params: {},
      },
    ];
  },
  applyChoice(frame, _choice, ops) {
    const minion = frame.params["minion"];
    if (!minion) throw new Error("The Anarch Free Press: no hunter");
    ops.lockPermanent(frame.cardId);
    ops.emit({ type: "BloodGained", minion, amount: 1 });
  },
};

/**
 * The Black Throne (100172) — the +2 votes clause compiles from the spec;
 * the contract payout is bespoke.
 *
 * "You can lock this card after a minion with a contract for which an
 * Assamite you control is chosen leaves the ready region to gain 1 pool."
 * Every piece already existed: the `contract` tag (Priority Contract
 * carries it), `PermanentInPlay.chosen` (the vampire the contract names),
 * and `onLeaveReady`, which fires BEFORE the departure so the card and its
 * bearer are both still readable.
 *
 * Written against the tag, not against Priority Contract by name — it is
 * the pool's only contract today, but the clause is about contracts.
 * "Assamite" is the V5 Banu Haqim clan.
 */
const blackThrone: CardHandler = {
  ...compileSpec(specByName("The Black Throne")),
  onLeaveReady(entry, owner, info, ops) {
    if (entry.locked) return;
    const seat = entry.controller ?? owner.seat;
    const leaver = findMinion(ops.state, info.minion);
    if (!leaver) return;
    const contracted = leaver.attached.some((p) => {
      if (!p.tags.includes("contract") || !p.chosen) return false;
      const chosen = findMinion(ops.state, p.chosen);
      if (!chosen) return false;
      return (
        chosen.kind === "vampire" && chosen.clan === "Banu Haqim" && chosen.controller === seat
      );
    });
    if (!contracted) return;
    ops.raiseChoice({
      seat,
      cardName: "The Black Throne",
      cardId: entry.card.id,
      key: "contractPayout",
      optional: true,
    });
  },
  choiceOptions(frame) {
    return [
      {
        id: `choice:The Black Throne:${frame.cardId}:contractPayout:yes`,
        kind: "answerChoice" as const,
        label: "The Black Throne: lock to gain 1 pool",
        params: {},
      },
    ];
  },
  applyChoice(frame, _choice, ops) {
    ops.lockPermanent(frame.cardId);
    ops.emit({ type: "PoolGained", seat: frame.seat, amount: 1 });
  },
};

/**
 * Regent (101587) — the attach, the title and the rush all compile from
 * the spec; the diablerie clause is the bespoke part. "If a Sabbat
 * vampire diablerizes this vampire, move this card to the diablerist
 * (before the blood hunt is called)": the onDiablerie hook fires inside
 * commitDiablerie with the victim still in play, so the card moves off
 * before it would burn with its bearer. A non-Sabbat diablerist gets
 * nothing and the title burns with the victim.
 */
const regent: CardHandler = {
  ...compileSpec(specByName("Regent")),
  onDiablerie(entry, owner, info, ops) {
    if (info.bearer === null || info.victim !== info.bearer) return;
    const diablerist = findMinion(ops.state, info.diablerist);
    if (!diablerist || diablerist.sect !== "sabbat") return;
    ops.moveAttachment(entry.card.id, diablerist.id, diablerist.controller);
    // The title is the card; it goes where the card goes (p. 28).
    ops.emit({ type: "TitleLost", minion: owner.minion ?? info.victim });
    ops.emit({ type: "TitleGranted", minion: diablerist.id, title: "regent" });
  },
};

/** Find any card in play by instance id — seat-level or attached. */
function findEntryById(state: GameState, cardId: string): PermanentInPlay | null {
  for (const s of state.seats) {
    const own = s.permanents.find((p) => p.card.id === cardId);
    if (own) return own;
    for (const m of s.minions) {
      const att = m.attached.find((p) => p.card.id === cardId);
      if (att) return att;
    }
  }
  return null;
}

/**
 * Ravnos Carnival (101553) — the first cost source
 * (docs/cost-sources-design.md). "This location comes into play with 1
 * counter for each Ravnos you control. Ravnos you control can use those
 * counters to pay some or all of the blood cost of action cards they
 * play. If this location has no counters, burn it." The paying half is
 * declarative (`costSource` on the card in play, read by the option
 * enumeration and by the payment at resolution); what is bespoke is the
 * headcount at entry — and the fact that a player controlling no Ravnos
 * puts it into play with nothing on it and burns it on arrival, which is
 * what the card says.
 */
const ravnosCarnival: CardHandler = {
  name: "Ravnos Carnival",
  bloodCost: 0,
  poolCost: 1,
  isMasterCard: true,
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    const seat = getSeat(ctx.state, ctx.seat);
    if (seat.pool <= 1) return []; // never oust yourself on a master (p. 9)
    if (seatControlsCopy(ctx.state, ctx.seat, this.name)) return [];
    return [
      {
        id: playOptionId(this.name, null, card.id),
        kind: "playCard",
        label: "Ravnos Carnival — put in play",
        card: card.id,
        name: this.name,
        minion: null,
        mode: null,
        params: {},
      },
    ];
  },
  resolve(play, ops) {
    const ravnos = getSeat(ops.state, play.seat).minions.filter(
      (m) => m.kind === "vampire" && m.clan === "Ravnos",
    ).length;
    ops.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: null,
      statics: {},
      tags: ["location", "Ravnos Carnival"],
      counters: ravnos,
      costSource: {
        pays: ["blood"],
        for: "action",
        clan: "Ravnos",
        burnWhenEmpty: true,
      },
    });
    // "If this location has no counters, burn it" — true the instant it
    // arrives when its player controls no Ravnos.
    if (ravnos === 0) ops.burnPermanent(play.card.id);
  },
};

/**
 * Ravnos Cache (101552) — the other half of the cost-source mechanic:
 * pays blood *or* pool, for equipment, and locking it is the price of
 * using the counters. "During your master phase, you can move 1 counter
 * from your pool to this location and add 1 counter (from the blood
 * bank) to it" — 1 pool for 2 counters, once per phase via the p. 16
 * `usedThisPhase` latch, gated on `turnSeat` so an out-of-turn master
 * window during someone else's turn does not trigger it.
 */
const ravnosCache: CardHandler = {
  name: "Ravnos Cache",
  bloodCost: 0,
  poolCost: 0,
  isMasterCard: true,
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    if (seatControlsCopy(ctx.state, ctx.seat, this.name)) return [];
    return [
      {
        id: playOptionId(this.name, null, card.id),
        kind: "playCard",
        label: "Ravnos Cache — put in play",
        card: card.id,
        name: this.name,
        minion: null,
        mode: null,
        params: {},
      },
    ];
  },
  resolve(play, ops) {
    ops.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: null,
      statics: {},
      tags: ["location", "Ravnos Cache"],
      counters: 0,
      costSource: { pays: ["blood", "pool"], for: "equipment", locks: true },
    });
  },
  abilityOptions(entry, owner, ctx) {
    if (ctx.window !== "turn.master") return [];
    if (ctx.seat !== owner.seat || ctx.turnSeat !== owner.seat) return [];
    if (entry.usedThisPhase) return [];
    // The pool counter has to come from somewhere (p. 9).
    if (getSeat(ctx.state, owner.seat).pool <= 1) return [];
    return [
      {
        id: `ability:Ravnos Cache:${entry.card.id}:stock`,
        kind: "useAbility",
        label: "Ravnos Cache: move 1 pool here, and add 1 from the blood bank",
        source: entry.card.id,
        params: {},
      },
    ];
  },
  useAbility(entry, owner, _choice, ops) {
    entry.usedThisPhase = true; // "During your master phase, you can…" (p. 16)
    ops.emit({ type: "PoolBurned", seat: owner.seat, amount: 1 });
    // One counter moved from the pool, one from the blood bank.
    ops.addCounters(entry.card.id, 2);
  },
};

/**
 * Visit from the Capuchin (102126) — the first counter sink
 * (docs/counter-sinks-design.md). "Put this card in play with 4 counters.
 * You get +1 hand size for each counter on this card. Each time you would
 * replace a card other than this card, instead burn 1 counter from this
 * card. Burn this card if it has no counters." Four cards now, four
 * replacements later: the hand size and the hand fall together by one on
 * every intercepted replacement, so nothing ever has to be discarded down.
 */
const visitFromTheCapuchin: CardHandler = {
  name: "Visit from the Capuchin",
  bloodCost: 0,
  poolCost: 0,
  isMasterCard: true,
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    if (seatControlsCopy(ctx.state, ctx.seat, this.name)) return [];
    return [
      {
        id: playOptionId(this.name, null, card.id),
        kind: "playCard",
        label: "Visit from the Capuchin — put in play with 4 counters",
        card: card.id,
        name: this.name,
        minion: null,
        mode: null,
        params: {},
      },
    ];
  },
  resolve(play, ops) {
    ops.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: null,
      statics: { handSizePerCounter: true },
      tags: ["Visit from the Capuchin"],
      counters: 4,
      counterSink: { instead: "replacement", burnWhenEmpty: true },
    });
  },
};

/**
 * Weighted Walking Stick (102169) — a combat card that *becomes* a weapon
 * mid-combat (docs/counter-sinks-design.md). The play and the attachment
 * compile from `attachSelfWeapon`; what is bespoke is the weapon strike it
 * offers once in play, which no other card shape provides (the weapon
 * ability normally comes from an equipment card), and its counter
 * depletion: "for each damage inflicted by this strike (even if
 * prevented), burn 1 counter", spent at infliction so prevention never
 * hands them back.
 */
const weightedWalkingStick: CardHandler = (() => {
  const base = compileSpec(specByName("Weighted Walking Stick"));
  return {
    ...base,
    options(card, ctx) {
      // "A minion can have only one Weighted Walking Stick."
      return (base.options?.(card, ctx) ?? []).filter((o) => {
        if (o.kind !== "playCard" || !o.minion) return true;
        const m = findMinion(ctx.state, o.minion);
        return !m?.attached.some((p) => p.tags.includes("Weighted Walking Stick"));
      });
    },
    abilityOptions(entry, owner, ctx) {
      const cf = ctx.combat;
      if (!cf || owner.minion === null) return [];
      if (ctx.window !== "combat.chooseStrike") return [];
      const side =
        cf.acting === owner.minion
          ? ("acting" as const)
          : cf.opposing === owner.minion
            ? ("opposing" as const)
            : null;
      if (!side) return [];
      // "The opposing minion cannot use equipment" (Terror Frenzy).
      if (cf.restrict[side].equipment) return [];
      const chooser = cf.strikes.acting === null ? "acting" : "opposing";
      if (chooser !== side || cf.strikes[side] !== null) return [];
      const committed = cf.committedStrike[side];
      if (committed !== null && committed !== entry.card.id) return [];
      return [
        {
          id: `ability:Weighted Walking Stick:${entry.card.id}:strike`,
          kind: "useAbility",
          label: `Weighted Walking Stick: strike (strength+1, ${entry.counters ?? 0} left)`,
          source: entry.card.id,
          params: {},
        },
      ];
    },
    useAbility(entry, owner, _choice, ops) {
      if (!owner.minion) throw new Error("Weighted Walking Stick: no bearer");
      ops.chooseWeaponStrike(owner.minion, entry.card.id, {
        name: "Weighted Walking Stick",
        damage: null,
        ranged: false,
        handBonus: 1,
        depletes: true,
      });
    },
  } satisfies CardHandler;
})();

/**
 * Wall Street Night, Financial Newspaper (102142) — "During an undirected
 * action, you can lock this location to give a minion you control +1
 * intercept. A minion you control can lock this location to attempt to
 * move 1 counter from an investment card to your pool as a +1 stealth Ⓓ
 * action."
 *
 * The first clause is the ordinary `lockGrant` intercept location with a
 * new `undirectedOnly` gate. The second is a granted action directed at
 * the investment card's controller — and **the V5 pool contains no
 * investment cards at all** (this card is the only one that mentions
 * them), so it correctly enumerates nothing today. The enumeration keys
 * off an "investment" tag, so it starts working the day one exists.
 */
const wallStreetNight: CardHandler = {
  ...compileSpec(specByName("Wall Street Night, Financial Newspaper")),
  actionOptions(entry, owner, ctx) {
    if (ctx.window !== "turn.minion" || ctx.seat !== owner.seat) return [];
    if (entry.locked) return [];
    const options: LegalOption[] = [];
    for (const m of getSeat(ctx.state, owner.seat).minions) {
      if (!canAct(m)) continue;
      if (
        entry.grantedActionUses?.some(
          (u) => u.minion === m.id && u.key === "takeInvestment",
        )
      ) {
        continue;
      }
      for (const s of ctx.state.seats) {
        if (s.ousted) continue;
        for (const p of s.permanents) {
          if (!p.tags.includes("investment") || (p.counters ?? 0) <= 0) continue;
          options.push({
            id: `act:Wall Street Night:${entry.card.id}:invest:${m.id}:${p.card.id}`,
            kind: "useEntryAction",
            label: `${m.name}: take 1 counter from ${p.card.name}`,
            source: entry.card.id,
            minion: m.id,
            params: { target: p.card.id },
          });
        }
      }
    }
    return options;
  },
  useActionOption(entry, _owner, choice, ops) {
    const target = choice.params["target"];
    if (!target) throw new Error("Wall Street Night: no investment card");
    ops.lockPermanent(entry.card.id); // "lock this location to attempt"
    ops.announceEntryAction(entry, choice.minion, {
      effect: { key: "takeInvestment", params: { target } },
      targetPermanent: target,
      stealth: 1,
    });
  },
  resolveGrantedAction(_entry, af, ops) {
    if (af.grantedEffect?.key !== "takeInvestment") return;
    const target = af.grantedEffect.params["target"];
    if (!target) return;
    ops.removeCounters(target, 1);
    ops.emit({ type: "PoolGained", seat: af.actingSeat, amount: 1 });
  },
};

/** Every vampire in the game carrying at least one hostage counter. */
function hostages(state: GameState): MinionState[] {
  return state.seats
    .flatMap((s) => s.minions)
    .filter((m) => (m.counters?.["hostage"] ?? 0) > 0);
}

/**
 * Carver's Meat Packing and Storage (100303) — the hostage-counter card.
 * "After a vampire with capacity 3 or less goes to torpor, put 1 hostage
 * counter on them. Vampires with any hostage counters cannot be moved to
 * the ready region or be diablerized. Lock during your master phase to
 * add X blood to a ready vampire you control, where X is the number of
 * vampires with any hostage counters. During any unlock phase, any ready
 * vampire can burn 2 blood to burn any vampire's hostage counters. After
 * this card leaves play, burn all the hostage counters."
 *
 * The counters live on `MinionState.counters["hostage"]`; the restriction
 * they impose is asked at the kernel's leave-torpor, rescue and diablerie
 * option sites via `heldHostage`. The placement rides the `onLeaveReady`
 * hook built for the granted-rush family, and the cleanup rides the new
 * `onLeavePlay`.
 */
const carversMeatPacking: CardHandler = {
  name: "Carver's Meat Packing and Storage",
  bloodCost: 0,
  poolCost: 1,
  isMasterCard: true,
  // "…ANY ready vampire can burn 2 blood to burn any vampire's hostage
  // counters": this card answers to every Methuselah, not just its owner.
  abilityAnySeat: true,
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    if (getSeat(ctx.state, ctx.seat).pool <= 1) return [];
    if (seatControlsCopy(ctx.state, ctx.seat, this.name)) return [];
    return [
      {
        id: playOptionId(this.name, null, card.id),
        kind: "playCard",
        label: "Carver's Meat Packing and Storage — put in play",
        card: card.id,
        name: this.name,
        minion: null,
        mode: null,
        params: {},
      },
    ];
  },
  resolve(play, ops) {
    ops.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: null,
      statics: {},
      tags: ["location", "Carver's Meat Packing and Storage"],
    });
  },
  onLeaveReady(_entry, _owner, info, ops) {
    // "After a vampire with capacity 3 or less goes to torpor, put 1
    // hostage counter on them" — torpor only; a burned vampire is gone.
    if (info.how !== "torpor") return;
    const m = findMinion(ops.state, info.minion);
    if (!m || m.kind !== "vampire" || m.capacity > 3) return;
    ops.addMinionCounters(info.minion, "hostage", 1);
  },
  abilityOptions(entry, owner, ctx) {
    const options: LegalOption[] = [];
    if (ctx.window === "turn.master") {
      // "Lock during your master phase to add X blood to a ready vampire
      // you control" — X counted across the whole game.
      if (ctx.seat !== owner.seat || ctx.turnSeat !== owner.seat) return [];
      if (entry.locked) return [];
      const x = hostages(ctx.state).length;
      if (x === 0) return [];
      for (const m of getSeat(ctx.state, owner.seat).minions) {
        if (m.kind !== "vampire" || !isReady(m)) continue;
        options.push({
          id: `ability:Carver's Meat Packing and Storage:${entry.card.id}:feed:${m.id}`,
          kind: "useAbility",
          label: `Carver's: lock to add ${x} blood to ${m.name}`,
          source: entry.card.id,
          params: { do: "feed", target: m.id, x: String(x) },
        });
      }
      return options;
    }
    if (ctx.window === "turn.unlock") {
      // "During ANY unlock phase, ANY ready vampire can burn 2 blood to
      // burn any vampire's hostage counters" — every seat, every phase,
      // and it does not lock the card.
      for (const actor of getSeat(ctx.state, ctx.seat).minions) {
        if (actor.kind !== "vampire" || !isReady(actor) || actor.blood < 2) continue;
        for (const victim of hostages(ctx.state)) {
          options.push({
            id: `ability:Carver's Meat Packing and Storage:${entry.card.id}:free:${actor.id}:${victim.id}`,
            kind: "useAbility",
            label: `Carver's: ${actor.name} burns 2 blood to free ${victim.name}`,
            source: entry.card.id,
            params: { do: "free", actor: actor.id, target: victim.id },
          });
        }
      }
      return options;
    }
    return [];
  },
  useAbility(entry, _owner, choice, ops) {
    const target = choice.params["target"];
    if (!target) return;
    if (choice.params["do"] === "feed") {
      ops.lockPermanent(entry.card.id);
      ops.emit({
        type: "BloodGained",
        minion: target,
        amount: Number(choice.params["x"] ?? "0"),
      });
      return;
    }
    const actor = choice.params["actor"];
    if (!actor) return;
    ops.emit({ type: "BloodBurned", minion: actor, amount: 2 });
    const victim = findMinion(ops.state, target);
    ops.addMinionCounters(target, "hostage", -(victim?.counters?.["hostage"] ?? 0));
  },
  onLeavePlay(_entry, _owner, ops) {
    // "After this card leaves play, burn all the hostage counters."
    for (const m of hostages(ops.state)) {
      ops.addMinionCounters(m.id, "hostage", -(m.counters?.["hostage"] ?? 0));
    }
  },
};

/** Every Ravnos vampire in the game. */
function allRavnos(state: GameState): MinionState[] {
  return state.seats
    .flatMap((s) => s.minions)
    .filter((m) => m.kind === "vampire" && m.clan === "Ravnos");
}

/**
 * Week of Nightmares (102166) — the last of the bespoke economies.
 * "Only one Week of Nightmares can be played in a game. Put this card in
 * play with 10 nightmare counters. Ravnos get +1 bleed and +1 strength and
 * do not hunt as normal. Any Ravnos can steal 1 blood from another Ravnos
 * as a +1 stealth hunt action. During each Methuselah's unlock phase, that
 * Methuselah can move 1 nightmare counter from this card to a Ravnos. If
 * this card has no counters, each Ravnos burns 1 blood for each nightmare
 * counter on them or is burned, then burn this card and the nightmare
 * counters."
 *
 * **Game-wide uniqueness** is the new piece, and the first of its kind:
 * the event log is the record of what has been played, so the play option
 * asks it whether this card has ever been played by anyone. (Open War
 * wants the same test.) The clan buffs are one global `aura`; "do not hunt
 * as normal" is a new `aura.cannotHunt` read at the hunt option site.
 */
const weekOfNightmares: CardHandler = {
  name: "Week of Nightmares",
  bloodCost: 0,
  poolCost: 0,
  isMasterCard: true,
  abilityAnySeat: true, // "during EACH Methuselah's unlock phase"
  options(card, ctx) {
    if (ctx.window !== "turn.master") return [];
    // "Only one Week of Nightmares can be played in a game" — game-wide,
    // not per-Methuselah, so the event log is the authority.
    const everPlayed = ctx.state.eventLog.some(
      (ev) => ev.type === "CardPlayed" && ev.name === "Week of Nightmares",
    );
    if (everPlayed) return [];
    return [
      {
        id: playOptionId(this.name, null, card.id),
        kind: "playCard",
        label: "Week of Nightmares — put in play with 10 nightmare counters",
        card: card.id,
        name: this.name,
        minion: null,
        mode: null,
        params: {},
      },
    ];
  },
  resolve(play, ops) {
    ops.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: null,
      statics: {},
      tags: ["Week of Nightmares"],
      counters: 10,
      // Unqualified "Ravnos": every Methuselah's, and it cuts both ways.
      aura: {
        scope: "global",
        clan: "Ravnos",
        bleed: 1,
        strength: 1,
        cannotHunt: true,
      },
    });
  },
  abilityOptions(entry, owner, ctx) {
    // "During each Methuselah's unlock phase, THAT Methuselah can move 1
    // nightmare counter from this card to a Ravnos."
    if (ctx.window !== "turn.unlock") return [];
    if (ctx.seat !== ctx.turnSeat) return [];
    if ((entry.counters ?? 0) <= 0) return [];
    if (entry.usedThisPhase) return [];
    void owner;
    return allRavnos(ctx.state).map((m) => ({
      id: `ability:Week of Nightmares:${entry.card.id}:nightmare:${m.id}`,
      kind: "useAbility" as const,
      label: `Week of Nightmares: put a nightmare counter on ${m.name}`,
      source: entry.card.id,
      params: { target: m.id },
    }));
  },
  useAbility(entry, _owner, choice, ops) {
    const target = choice.params["target"];
    if (!target) return;
    entry.usedThisPhase = true;
    ops.addCounters(entry.card.id, -1);
    ops.addMinionCounters(target, "nightmare", 1);
    if ((entry.counters ?? 0) > 0) return;
    // "If this card has no counters, each Ravnos burns 1 blood for each
    // nightmare counter on them or is burned" — the blood is not optional;
    // a Ravnos who cannot pay is burned.
    for (const m of allRavnos(ops.state)) {
      const n = m.counters?.["nightmare"] ?? 0;
      if (n === 0) continue;
      if (m.blood >= n) {
        ops.emit({ type: "BloodBurned", minion: m.id, amount: n });
      } else {
        ops.burnMinion(m.id);
        continue;
      }
      ops.addMinionCounters(m.id, "nightmare", -n);
    }
    // "…then burn this card and the nightmare counters."
    ops.burnPermanent(entry.card.id);
  },
  actionOptions(entry, _owner, ctx) {
    // "Any Ravnos can steal 1 blood from another Ravnos as a +1 stealth
    // hunt action" — offered to whichever seat is acting.
    if (ctx.window !== "turn.minion") return [];
    const options: LegalOption[] = [];
    for (const actor of getSeat(ctx.state, ctx.seat).minions) {
      if (actor.clan !== "Ravnos" || !canAct(actor)) continue;
      if (
        entry.grantedActionUses?.some(
          (u) => u.minion === actor.id && u.key === "stealRavnosBlood",
        )
      ) {
        continue;
      }
      for (const victim of allRavnos(ctx.state)) {
        if (victim.id === actor.id || victim.blood < 1) continue;
        options.push({
          id: `act:Week of Nightmares:${entry.card.id}:steal:${actor.id}:${victim.id}`,
          kind: "useEntryAction",
          label: `${actor.name}: steal 1 blood from ${victim.name}`,
          source: entry.card.id,
          minion: actor.id,
          params: { target: victim.id },
        });
      }
    }
    return options;
  },
  useActionOption(entry, _owner, choice, ops) {
    const target = choice.params["target"];
    if (!target) throw new Error("Week of Nightmares: no victim");
    ops.announceEntryAction(entry, choice.minion, {
      effect: { key: "stealRavnosBlood", params: { target } },
      stealth: 1,
    });
  },
  resolveGrantedAction(_entry, af, ops) {
    if (af.grantedEffect?.key !== "stealRavnosBlood") return;
    const target = af.grantedEffect.params["target"];
    const victim = target ? findMinion(ops.state, target) : null;
    if (!victim || victim.blood < 1) return;
    ops.emit({ type: "BloodBurned", minion: victim.id, amount: 1 });
    ops.emit({ type: "BloodGained", minion: af.acting, amount: 1 });
  },
};

/** name → handler, for the engine constructor. */
/**
 * The queries `compileSpec` answers centrally for every spec-compiled
 * card — "what printed types is this?", "what does it require?", "which
 * printed versions could this minion play?" — filled in for the handful
 * of handlers written entirely by hand, off the flags they already set.
 *
 * Without this a hand-rolled card is INVISIBLE to every card that reasons
 * about OTHER cards, and silently so: a play-cost modifier keyed on
 * "master cards" (Secure Haven) skipped Blood Doll and Vessel, and "equip
 * with an equipment from your hand" skipped .44 Magnum. Nothing asserted
 * any of it, because an option list that is empty for the wrong reason
 * looks exactly like one empty for the right reason.
 *
 * A hand-rolled card with a real requirement or a "Unique." line still
 * has to say so itself; `tests/cards/central-queries.test.ts` pins that
 * every registered handler at least answers with a type.
 */
function backfillCentralQueries(h: CardHandler): void {
  if (!h.costTypes) {
    const types: PlayCostCardType[] = [];
    if (h.isEquipment) types.push("equipment");
    else if (h.isRetainer) types.push("retainer");
    else if (h.isAlly) types.push("ally");
    else if (h.isMasterCard) types.push("master");
    else if (h.isCombatCard) types.push("combat");
    else if (h.isReactionCard) types.push("reaction");
    else if (h.isActionCard) types.push("action");
    h.costTypes = () => types;
  }
  // EVERY equipment card in play must carry the "equipment" tag, because
  // that tag is what "burn an equipment" enumerates on — `actionOnPermanent`
  // (Conceal, Rewilding), `Strike.burnEquipment`, the granted
  // burn-equipment strike, and Anarch Troublemaker's parting shot all test
  // it. Only 2 of the 17 equipment cards tagged themselves, so those four
  // enumerators had been looking at a nearly empty table — a filter empty
  // for the wrong reason, which the fuzz cannot see. Central, so a
  // hand-rolled handler (.44 Magnum) cannot forget it either.
  // "notEquipment" is the printed opt-out ("While in play, this card does
  // not count as equipment" — Living Manse).
  // docs/last-equipment-modifiers-design.md §1
  if (h.isEquipment) {
    const tags = h.permanentTags ?? [];
    if (!tags.includes("equipment") && !tags.includes("notEquipment")) {
      h.permanentTags = [...tags, "equipment"];
    }
    // "+1 bleed for each UNIQUE equipment attached to him" (Hesha
    // Ruhadze) — uniqueness is a printed property of the card, and
    // `currentBleed` reads entries, not the registry. So it is
    // denormalized into the same tag vocabulary that already answers
    // "location / vehicle / ghoul / animal", and centrally, for the
    // reason the "equipment" tag above is: a hand-rolled handler would
    // otherwise be silently missing from the count.
    // docs/crypt-wave-4.md §3
    const tagged = h.permanentTags ?? [];
    if (h.isUnique && !tagged.includes("unique")) {
      h.permanentTags = [...tagged, "unique"];
    }
  }
  if (!h.requiresDisciplines) h.requiresDisciplines = () => [];
  if (!h.requiresClans) h.requiresClans = () => [];
  // EVERY `playCard` option must report what it costs
  // (docs/richer-options-design.md §2). `compileSpec` fills in the LIVE
  // cost for a spec-compiled card; a hand-rolled handler builds its own
  // options and would report none — which is the same silent gap that
  // made `costTypes` skip Blood Doll and .44 Magnum above, and it showed
  // up immediately as an AI happily spending its last pool.
  //
  // The fallback is the handler's own declared cost: the printed price,
  // which for a bespoke card is right in the absence of a modifier. A
  // cost that appears on some cards and not others is worse than none, so
  // this exists to make sure the field is ALWAYS there.
  const inner = h.options?.bind(h);
  if (inner) {
    h.options = (card, ctx) =>
      inner(card, ctx).map((o) =>
        o.kind === "playCard" && o.cost === undefined
          ? { ...o, cost: { blood: h.bloodCost ?? 0, pool: h.poolCost ?? 0 } }
          : o,
      );
  }
  if (!h.requiresSects) h.requiresSects = () => [];
  // A title-granting political action holds its card until the referendum
  // resolves; that is all `isTitleGrant` ever meant at the two engine
  // sites that read it (docs/pool-drain-design.md §6).
  if (h.isTitleGrant) h.holdsCardForReferendum = true;
  // One printed version, no discipline gate — which is what a hand-rolled
  // handler with no modes means.
  if (!h.modesPlayableBy) h.modesPlayableBy = () => [null];
}

export function buildHandlerRegistry(): HandlerRegistry {
  const registry: HandlerRegistry = {};
  for (const spec of cardSpecs) {
    registry[spec.name] = compileSpec(spec);
  }
  // The crypt. Keyed by name like every other handler — verified to have
  // no duplicate crypt names and no collisions with library card names
  // (docs/crypt-plan.md §3), so this needs no namespacing.
  for (const spec of cryptSpecs) {
    registry[spec.name] = compileSpec(spec);
  }
  // Bespoke handlers and spec-plus-bespoke overlays override compiled specs.
  for (const bespoke of [
    flamingCandle,
    giantsBlood,
    golcondaInnerPeace,
    archonInvestigation,
    anarchTroublemaker,
    theCoven,
    suddenReversal,
    hideTheMind,
    warsawStation,
    guardianAngel,
    unlicensedTaxicab,
    secureHaven,
    passThroughShadow,
    shadowCast,
    shadowCloak,
    feverPitch,
    theBarrens,
    bloodDoll,
    vessel,
    magnum44,
    doubleDeuce,
    streetRoyals47,
    homunculus,
    freakishConglomeration,
    warGhoul,
    parityShift,
    banishment,
    telepathicVoteCounting,
    yorubaShrine,
    saulotsGuidingWisdom,
    saulotsHealingTouch,
    openWar,
    diaDeLosMuertos,
    malkavianJusticar,
    toreadorJusticar,
    cardinalBenediction,
    dreamsOfTheSphinx,
    doggedPursuit,
    organizedResistance,
    melange,
    powerbaseMadrid,
    underSiege,
    pitOfContemplation,
    theRack,
    nodFragment,
    powerbaseLosAngeles,
    onTheQuiVive,
    aranthebes,
    toreadorGrandBall,
    brujahDebate,
    mobConnections,
    powerbaseMunich,
    creepingSabotage,
    armyOfRats,
    powerbaseMontreal,
    caveOfApples,
    heartrender,
    alamut,
    deadPool,
    constantRevolution,
    smilingJack,
    wasserschloss,
    platinumProtocol,
    dummyCorporation,
    frontalAssault,
    priorityContract,
    regent,
    ravnosCarnival,
    ravnosCache,
    visitFromTheCapuchin,
    weightedWalkingStick,
    wallStreetNight,
    carversMeatPacking,
    weekOfNightmares,
    anarchFreePress,
    blackThrone,
    dabbler,
    monster,
    perfectionist,
    rebel,
  ]) {
    registry[bespoke.name] = bespoke;
  }
  for (const h of Object.values(registry)) backfillCentralQueries(h);
  return registry;
}

/** All implemented ids (specs + bespoke handlers) for the support test. */
export const implementedIds: number[] = [
  ...cardSpecs.map((s) => s.krcgId),
  ...cryptSpecs.map((s) => s.krcgId),
  101896, // Sudden Reversal (bespoke)
  100135, // The Barrens (bespoke)
  100199, // Blood Doll (bespoke)
  102113, // Vessel (bespoke)
  100001, // .44 Magnum (bespoke)
  100594, // Dummy Corporation (bespoke)
  100588, // Dreams of the Sphinx (bespoke — counters one-off)
  102230, // Organized Resistance (bespoke — target-another-Anarch)
  101437, // Powerbase: Madrid (bespoke — counter location)
  100037, // Alamut (bespoke — counter location, bleed-success accumulate)
  102299, // Dead Pool (bespoke — counter card, combat-leave accumulate)
  102152, // Wasserschloss Anif, Austria (bespoke — counter location)
  102232, // The Platinum Protocol (bespoke — corruption placer)
  101553, // Ravnos Carnival (bespoke — cost source)
  101552, // Ravnos Cache (bespoke — cost source)
  102126, // Visit from the Capuchin (bespoke — replacement counter sink)
  100303, // Carver's Meat Packing and Storage (bespoke — hostage counters)
  102166, // Week of Nightmares (bespoke — game-wide unique, nightmare counters)
  100921, // Hide the Mind (bespoke — cancel by required discipline)
];
