/**
 * Random-playout fuzzing with seeded RNG (CLAUDE.md testing rules).
 * Four seats play random legal moves to game end. Checked throughout:
 *
 *  - the engine always offers at least one option, with unique ids;
 *  - during any action the acting minion is locked (lock-state legality);
 *  - blood stays within [0, capacity] for every minion;
 *  - games terminate (decision cap + engine turn-limit safeguard);
 *  - counter conservation: replaying the event log over the initial
 *    pools/blood reproduces the final state exactly (event-sourcing
 *    integrity).
 *
 * Failures report the seed that produced them.
 */

import { describe, expect, it } from "vitest";
import type { CardInstance, GameState } from "../../src/engine/index.ts";
import { capacityOf, rngInt, VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, testRegistry } from "./fixtures.ts";

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const DECISION_CAP = 100_000;

class RandomAgent {
  private readonly rng: { rngState: number };
  constructor(seed: number) {
    this.rng = { rngState: seed >>> 0 || 1 };
  }
  pick(n: number): number {
    return rngInt(this.rng, n);
  }
}

function fourSeatGame(seed: number): GameState {
  const rng = { rngState: seed >>> 0 || 1 };
  const deckNames = [
    "Conditioning",
    "Deflection",
    "On the Qui Vive",
    "Enhanced Senses",
    "Lost in Crowds",
    "Govern the Unaligned",
    "Intimidation",
    "Enchant Kindred",
    "Roundhouse",
    "Majesty",
    "Torn Signpost",
    "Hidden Strength",
    "Apportation",
    "Bonding",
    "Threats",
    "Earth Control",
    "Subversion",
    "Wake with Evening's Freshness",
    "Forced Awakening",
    "Telepathic Misdirection",
    "Elder Intervention",
    "Scouting Mission",
    "Social Charm",
    "Public Trust",
    "Feast of the Soul's Secrets",
    "Earth Meld",
    "Indomitability",
    "Flash",
    "Forgotten Labyrinth",
    "Misdirection",
    "Life in the City",
    "Minion Tap",
    "Sudden Reversal",
    "Elder Library",
    "Information Highway",
    "The Barrens",
    "Blood Doll",
    "Vessel",
    "Sport Bike",
    ".44 Magnum",
    // Allies/retainers gate.
    "Political Ally",
    "Double Deuce",
    "47th Street Royals",
    "Revenant",
    "Mr. Winthrop",
    "Raven Spy",
    "Murder of Crows",
    "Dread Mastiff",
    "Dog Pack",
    "Homunculus",
    // Rush gate.
    "Umbrous Clutch",
    "Fleetness",
    "Twisted Bloodhound",
    "Aggressive Corpse",
    "Freakish Conglomeration",
    "War Ghoul",
    // Ally's own wave (docs/vozhd-allies-design.md).
    "The Vozhd of Sofia",
    "The Vozhd of Gravesend",
    "The Vozhd of Juiz de Fora",
    "The Vozhd of Szczecin",
    "City Star Taxi",
    // The cheap tail (docs/cheap-tail-design.md).
    "Garibaldi-Meucci Museum",
    "Vagabond Mystic",
    "Underbridge Stray",
    "Voracious Vermin",
    "Heart of Nizchetus",
    "True Love's Face",
    // Weapon riders (docs/weapon-riders-design.md).
    "AK-47",
    "Sniper Rifle",
    "Righteous Blade",
    "Sword of the Archangel",
    "Treasured Samadji",
    // Retainers (docs/retainer-wave-design.md).
    "Crypt's Sons",
    "Owl Companion",
    "Raptor",
    "Feral Hound",
    "Szlachta Assistant",
    "Szlachta Bodyguard",
    // The end of the round (docs/round-end-design.md).
    "Hunting the Quarry",
    "Telepathic Tracking",
    "Immortal Grapple",
    "Target Vitals",
    "Dance with the Devil",
    // Referendum terms (docs/referendum-terms-design.md).
    "Anarch Salon",
    "Consanguineous Boon",
    "Cold War",
    "Disputed Territory",
    "Camarilla's Iron Fist",
    // Opposing statics (docs/opposing-statics-design.md).
    "Perfect Paragon",
    "Stolen Police Cruiser",
    "Archon",
    "Raising the Portcullis",
    "Haqim's Law: Retribution",
    // The crypt and the uncontrolled region.
    "Chantry",
    "Grooming the Protégé",
    "Wider View",
    "Family Gathering",
    "Yawp Court",
    // The last combat cards (docs/last-combat-design.md).
    "Dust Up",
    "Taste of Vitae",
    "Hunger of Marduk",
    "Anticipation",
    "Kevlar Vest",
    // The last equipment and the last modifiers
    // (docs/last-equipment-modifiers-design.md).
    "Bowl of Convergence",
    "Flaming Candle",
    "Living Manse",
    "Monkey Wrench",
    "Spying Mission",
    "Go-getter",
    // The last buildable four (docs/last-buildable-design.md).
    "Fiendish Tongue",
    "Revelations",
    "Deep Song",
    "Revolutionary Council",
    // Politics gate.
    "Kine Resources Contested",
    "Anarchist Uprising",
    "Ancilla Empowerment",
    "Domain Challenge",
    "Conservative Agitation",
    "Neonate Breach",
    "Parity Shift",
    "Banishment",
    // Second sweep.
    "Glancing Blow",
    "Soak",
    "Rego Motum",
    "Telepathic Counter",
    "Restoration",
    "Fourth Tradition: The Accounting",
    // Third sweep.
    "Form of the Wolf",
    "Fifth Tradition: Hospitality",
    "Dummy Corporation",
    // Combat gate: dodge & additional strikes.
    "Blur",
    "Lightning Reflexes",
    "Pursuit",
    "Quickness",
    "Side Strike",
    "Wind Dance",
    "Shadow Shift",
    "Arms of Ahriman",
    // Clan/sect gate.
    "Backways",
    "Market Square",
    "Anarch Railroad",
    "Empires Fall",
    "Reckless Agitation",
    // Lock-to-grant locations.
    "Channel 10",
    "KRCG News Radio",
    "Kumpania",
    "The Anarch Free Press",
    "The Black Throne",
    // Archetypes.
    "Dabbler",
    "Monster",
    "Perfectionist",
    "Rebel",
    // Fourth sweep.
    "Arcane Library",
    "Sight Beyond Sight",
    "No Trace",
    // Votes-during-polling gate.
    "Bewitching Oration",
    "Old Friends",
    "Ominous Chorus",
    "Ventrue Headquarters",
    "Oxford University, England",
    // Strike-effects gate.
    "Body Flare",
    "Walk of Flame",
    "Theft of Vitae",
    "Aid from Bats",
    // Weapons gate.
    "Flamethrower",
    "Ivory Bow",
    "Femur of Toomler",
    // Block-restrictions gate.
    "Visions of Gehenna",
    "Seduction",
    // On-vampire statics gate.
    "Heart of the City",
    "Preternatural Strength",
    // Politics follow-ups gate.
    "Toreador Justicar",
    "Power Structure",
    // Ballots gate.
    "Closed Session",
    "Private Audience",
    // Frenzy gate.
    "Rage of Apedemak",
    "Terror Frenzy",
    // Counter one-offs.
    "Dreams of the Sphinx",
    "Powerbase: Madrid",
    "Under Siege",
    "Alamut",
    "Dead Pool",
    "Constant Revolution",
    "Smiling Jack, The Anarch",
    "Wasserschloss Anif, Austria",
    "The Platinum Protocol",
    "Enchanting Gaze",
    "Revelation of the Serpent",
    "Pit of Contemplation",
    // Unlock-phase tolls (docs/unlock-tolls-design.md).
    "The Gate of Acheron",
    // "Minions can burn this card as a Ⓓ action" family.
    "Creeping Sabotage",
    "Army of Rats",
    // Control change (docs/control-change-design.md).
    "Powerbase: Montreal",
    "Cave of Apples",
    // Auras + attach-to-any-minion masters.
    "Gangrel Revel",
    "The Khabar: Community",
    "Pentex™ Subversion",
    // Choice frames (docs/choice-frames-design.md).
    "The Rack",
    "Fragment of the Book of Nod",
    "Powerbase: Los Angeles",
    "Brujah Debate",
    "Mob Connections",
    "Powerbase: Munich",
    "Toreador Grand Ball",
    "Aranthebes, The Immortal",
    // Granted rush actions (docs/granted-rush-design.md).
    "Haven Uncovered",
    "Regent",
    "Saulot's Avenging Fist",
    "Frontal Assault",
    "Priority Contract",
    // Cost sources (docs/cost-sources-design.md).
    "Ravnos Carnival",
    "Ravnos Cache",
    // Counter sinks (docs/counter-sinks-design.md).
    "Visit from the Capuchin",
    "Touch of Oblivion",
    "Weighted Walking Stick",
    // Bespoke economies + the last investment card.
    "Carver's Meat Packing and Storage",
    "Wall Street Night, Financial Newspaper",
    "Week of Nightmares",
    // Dual-purpose action modifier / combat cards.
    "Swallowed by the Night",
    "Rapid Change",
    "Swift Cover",
    "Resist Earth's Grasp",
    "Form of the Cobra",
    // "That block attempt fails" cluster.
    "Elder Impersonation",
    "Relentlessness",
    "Forced Confessional",
    "Stygian Shroud",
    "Dominant Personality",
    // The block tax (docs/block-tax-design.md).
    "Where the Veil Thins",
    "Seeds of Terror",
    "Unthinkable Humiliation",
    "The Sleeping Mind",
    "Daring the Dawn",
    // Actor-side combat riders (docs/actor-riders-design.md).
    "Beast Meld",
    "Invigorate",
    "Dawn Operation",
    "Cloak the Gathering",
    "Veil the Legions",
    "Hedonism",
    "Scalpel Tongue",
    "Telepathic Vote Counting",
    "Scorn of Adonis",
    "Expulsion",
    "Yoruba Shrine",
    "Martyr's Resilience",
    "Saulot's Guiding Wisdom",
    "Touch of Valeren",
    "Show of Force",
    "Propaganda",
    "Line Brawl",
    "Entrancement",
    "Enthrall",
    "Conceal",
    "Rewilding",
    "Dominate Kine",
    "Open War",
    "Saulot's Healing Touch",
    "Obedient Flesh",
    // Discipline master cards (docs/derived-traits-design.md).
    "Celerity",
    "Dominate",
    "Obfuscate",
    "Potence",
    "Protean",
    "Oblivion",
    // Hunting grounds (one-off sweep).
    "Academic Hunting Ground",
    "Park Hunting Ground",
    // Conditional-bonus modifiers (one-off sweep).
    "Aire of Elation",
    "Protection Racket",
    // Aggravated hand strikes (one-off sweep).
    "Claws of the Dead",
    "Wolf Claws",
    // Misc one-off sweep.
    "Thing",
    "Diversion",
    "Unholy Sacrament",
    "Slam",
    "Foreshadowing Destruction",
    // Intercept-reaction cluster (one-off sweep).
    "The Warrens",
    "Eyes of Argus",
    "Spirit's Touch",
    // Unlock-and-attempt-to-block cluster.
    "Sense the Savage Way",
    "Sentry Signal",
    "Second Tradition: Domain",
    "Eagle's Sight",
    "Guard Dogs",
    "Rat's Warning",
    // Wave 2.
    "One With the Land",
    "My Enemy's Enemy",
    "Dogged Pursuit",
    "Cats' Guidance",
    "Forced Vigilance",
    "Eyes of the Wild",
    "Organized Resistance",
    "Melange",
    // Discipline-filtered effects (docs/discipline-filtered-design.md).
    // These matter to the fuzz specifically because they interact with
    // the prevention cards already in this list (Soak, Rego Motum,
    // Glancing Blow) and with the .44 Magnum's weapon strike.
    "Blood Fury",
    "Blood Rage",
    "Soul Burn",
    "Soulgrinder",
    "Hide the Mind",
    // The play-cost gate (docs/play-cost-design.md). These are the first
    // cards that make another card's cost move, so they exercise the
    // enumeration/payment agreement against everything else in this list.
    "Charisma",
    "Libertas",
    "Consign to Oblivion",
    "Unleashing the Bestial Soul",
    "Ensnare a Beast",
    // Action-time locations (docs/action-time-locations-design.md).
    "Creepshow Casino",
    "WMRH Talk Radio",
    "The Rumor Mill, Tabloid Newspaper",
    "Club Illusion",
    "Warsaw Station",
    // Conditional statics (docs/conditional-statics-design.md).
    "Depravity",
    "Guardian Angel",
    "Abbot",
    "Unlicensed Taxicab",
    // Granted bleeds + target-priced costs.
    "Codex of the Edenic Groundskeepers",
    "Villein",
    "Secure Haven",
    // After combat ends (docs/after-combat-ends-design.md).
    "Catatonic Fear",
    "Pass Through Shadow",
    "Form of Mist",
    "Rolling with the Punches",
    // Playing a card from hand outside its own action
    // (docs/play-from-hand-design.md) — and the permanents they reach for.
    "Angel's Gift",
    "Contraband",
    "Pack Alpha",
    "Piper",
    "Biothaumaturgic Experiment",
    "Kali's Fang",
    "Raven Spy",
    // Stun (docs/stun-design.md) — the unlock sweep's new suppressor.
    "Kiss of Cathari",
    "Mind Numb",
    // Recurring pool drains (docs/pool-drain-design.md).
    "Anarch Revolt",
    "Judgment: Camarilla Segregation",
    "Augury of Doom",
    "War of Ages",
    "Fame",
    "Tension in the Ranks",
    // Searching the library, and out-of-play stores
    // (docs/library-search-design.md).
    "Magic of the Smith",
    "Vast Wealth",
    "Black Market Cache",
    "Shilmulo Tarot",
    "Fleshforge Chamber",
    // Ending an action early (docs/end-action-design.md).
    "Change of Target",
    "Mirror Walk",
    "Obedience",
    "Delaying Tactics",
    "Faceless Night",
    // The after-action-resolution window (docs/after-resolution-design.md).
    "Freak Drive",
    "Shadow Cast",
    "Shadow Cloak",
    "Fever Pitch",
    // The after-referendum window (docs/referendum-margin-design.md).
    "Voter Captivation",
    "Amici Noctis",
    "Magnetic Authority",
    // Intercept reactions and their combat riders
    // (docs/blocker-riders-design.md).
    "Instinctive Reaction",
    "Precognition",
    "Truth in Darkness",
    "Form of the Bat",
    "Night Terrors",
    // Answering a bleed (docs/bleed-answers-design.md).
    "Redirection",
    "Bait and Switch",
    "Deep Ecology",
    "Visions of Zapathasura",
    // Combat effects that recur every round
    // (docs/round-recurring-combat-design.md).
    "Bear's Skin",
    "Carrion Crows",
    "Flesh of Marble",
    "Weather Control",
    "Tranquility Shield",
    // Rush actions and what happens after the combat
    // (docs/rush-outcome-design.md).
    "Abuse of Power",
    "Pillars Fall",
    "Hunting the Beast",
    "Hunter's Mark",
    "Make the Misere",
    // Hunting grounds and the other blood locations
    // (docs/blood-locations-design.md).
    "Carfax Abbey",
    "Papillon",
    "Meditative Grove",
    "Cappadocian Crypt",
    "The Hungry Coyote",
    // Locations that buy votes (docs/politics-locations-design.md).
    "Elysium: The Palace of Versailles",
    "Ferraille",
    "New Carthage",
    "Día de los Muertos",
    "Black Forest Base",
    // Actions that become permanents
    // (docs/action-attachments-design.md).
    "Heroic Might",
    "Khabar: Glory",
    "Rutor's Hand",
    "Tier of Souls",
    "Phantasmagoria",
    // Combat cards that become permanents
    // (docs/combat-attachments-design.md).
    "Wall of Filth",
    "Sculpt the Flesh",
    "Disarm",
    "Morbidity",
    "Monstrous Form",
    // Masters that reach across the table
    // (docs/cross-table-masters-design.md).
    "Giant's Blood",
    "Golconda: Inner Peace",
    "Archon Investigation",
    "Anarch Troublemaker",
    "The Coven",
    // Actions that take what belongs to another Methuselah
    // (docs/taking-actions-design.md).
    "Far Mastery",
    "Graverobbing",
    "Puppet Master",
    "Slaughtering the Herd",
    "Break the Bonds",
    // The ash heap (docs/ash-heap-design.md).
    "Shroud of Decay",
    "Psychophagia",
    "Putrescent Sustenance",
    // The wraith/zombie gate (docs/wraith-zombie-design.md) — all 14.
    "Screamer",
    "Bone Shambler",
    "Shadow Sentinel",
    "Spectral Servitor",
    "Split the Veil",
    "Paths in Two Worlds",
    "Rotting Behemoth",
    "Burial Site Hunting Ground",
    "Cursed Abattoir",
    "Dance of the Dead",
    "Fiorella, Empty One",
    "Gifts From Hereafter",
    "Gravebound Drone",
    "Heartrender",
    // The token-vampire gate (docs/token-vampire-design.md).
    "Waters of Duat",
    "Childe of the Revolution",
    // The Path cards (docs/path-cards-design.md) — all four, now that a
    // Path is known to be a printed CRYPT trait. The minions below carry
    // one each, or none of these would ever be dealt a legal player.
    "Absolute Tyranny",
    "Terrifying Visage",
    "Privileged Position",
    "Forward Momentum",
    // The library audit (docs/library-audit.md §3) found these reaching
    // "supported" on a SIBLING's scenario test — eleven hunting grounds
    // and six lockGrant locations that are pure data variants of one
    // mechanic, plus two cards with no sibling at all. Defensible, but
    // nothing was exercising the actual data, so a wrong clan or sect
    // filter on any of them would have been invisible. In the decks now,
    // and `tests/cards/library-audit.test.ts` keeps it that way.
    "Asylum Hunting Ground",
    "Library Hunting Ground",
    "Political Hunting Ground",
    "Slum Hunting Ground",
    "Society Hunting Ground",
    "Temple Hunting Ground",
    "Underworld Hunting Ground",
    "Uptown Hunting Ground",
    "Warzone Hunting Ground",
    "Zoo Hunting Ground",
    "Biotech Company Hunting Ground",
    "Art Museum",
    "Ecoterrorists",
    "Elysian Fields",
    "Fortune Teller Shop",
    "The Labyrinth",
    "Opium Den",
    "Iron Glare",
    "Malkavian Justicar",
    "Protected District",
    "Party Out Of Bounds",
  ];
  const seats = ["A", "B", "C", "D"].map((id, i) => {
    const cards: CardInstance[] = [];
    for (let k = 0; k < deckNames.length; k++) {
      cards.push({ id: `${id}-card-${k}`, name: deckNames[k % deckNames.length]! });
    }
    // Seeded shuffle (Fisher–Yates).
    for (let k = cards.length - 1; k > 0; k--) {
      const j = rngInt(rng, k + 1);
      const a = cards[k]!;
      cards[k] = cards[j]!;
      cards[j] = a;
    }
    return {
      id,
      pool: 8,
      minions: [
        makeMinion(`${id}a`, id, {
          disciplines: {
            dom: i % 2 === 0 ? ("basic" as const) : ("superior" as const),
            obf: "basic" as const,
            pot: i % 2 === 0 ? ("superior" as const) : ("basic" as const),
            pro: i % 2 === 0 ? ("basic" as const) : ("superior" as const),
            ani: i % 2 === 0 ? ("basic" as const) : ("superior" as const),
          },
          blood: 3,
          capacity: 4,
          // Titles feed the referendum vote machinery (prince satisfies
          // Parity Shift's requirement, too).
          title: i % 2 === 0 ? ("prince" as const) : ("primogen" as const),
          // Clan/sect feed the "Requires a …" gating and clan-lock
          // locations (Gangrel → Backways; Sabbat/Anarch → politicals).
          clan: i % 2 === 0 ? ("Gangrel" as const) : ("Banu Haqim" as const),
          sect: i % 2 === 0 ? ("sabbat" as const) : ("anarch" as const),
          // Paths are a printed crypt trait (docs/path-cards-design.md).
          // This one plus `b` gives every seat the TWO ready Path of Power
          // vampires Privileged Position requires.
          path: "Power and the Inner Voice" as const,
        }),
        makeMinion(`${id}b`, id, {
          disciplines: {
            aus: i % 2 === 0 ? ("superior" as const) : ("basic" as const),
            pre: i % 2 === 0 ? ("basic" as const) : ("superior" as const),
            for: "basic" as const,
            tha: i % 2 === 0 ? ("basic" as const) : ("superior" as const),
            cel: i % 2 === 0 ? ("basic" as const) : ("superior" as const),
            obl: i % 2 === 0 ? ("superior" as const) : ("basic" as const),
          },
          blood: 2,
          capacity: 3,
          // Clan-gated granted actions: Hecata drives Pit of
          // Contemplation, Ministry drives Cave of Apples.
          clan: i % 2 === 0 ? ("Hecata" as const) : ("Ministry" as const),
          path: "Power and the Inner Voice" as const,
        }),
        // The clans the play-from-hand family is gated on: Angel's Gift
        // requires a Salubri, Contraband a Ravnos, and neither would ever
        // be dealt a legal player otherwise.
        makeMinion(`${id}d`, id, {
          disciplines: {
            obf: i % 2 === 0 ? ("basic" as const) : ("superior" as const),
            ani: "basic" as const,
            tha: "basic" as const,
            // Tranquility Shield is [for] AND "Requires a Salubri", so it
            // is unplayable by anyone else in this fixture; Hunting the
            // Beast is [aus] with the same clan requirement.
            for: i % 2 === 0 ? ("superior" as const) : ("basic" as const),
            aus: i % 2 === 0 ? ("superior" as const) : ("basic" as const),
          },
          blood: 3,
          capacity: 4,
          clan: i % 2 === 0 ? ("Salubri" as const) : ("Ravnos" as const),
          sect: "anarch" as const,
          // Terrifying Visage attaches only to a Cathari, and Forward
          // Momentum only counts a Cathari's bleeds.
          path: "Cathari" as const,
        }),
        // The token-vampire gate: Waters of Duat requires a Ministry with
        // capacity 5 or more, Childe of the Revolution a baron. One
        // minion satisfies both, and neither card would ever be dealt a
        // legal player otherwise.
        makeMinion(`${id}e`, id, {
          blood: 3,
          capacity: 5,
          clan: "Ministry" as const,
          sect: "anarch" as const,
          title: "baron" as const,
          // Burial Site Hunting Ground's vampire branch, live since the
          // Path filter stopped being a dead `continue`.
          path: "Death and the Soul" as const,
        }),
        // A vampire already in torpor, so diablerise/rescue and the
        // blood-hunt referendum are exercised from the first turn.
        makeMinion(`${id}t`, id, { inTorpor: true, blood: 1, capacity: 2 }),
      ],
      // One vampire mid-influence and one still in the crypt, so random
      // play exercises transfers, crypt draws, and influencing out.
      uncontrolled: [
        { card: makeMinion(`${id}u`, id, { blood: 0, capacity: 2 }), counters: 1 },
      ],
      crypt: [makeMinion(`${id}k`, id, { blood: 0, capacity: 3 })],
      hand: cards.slice(0, 7),
      library: cards.slice(7),
      ousted: false,
      victoryPoints: 0,
      delayedDraws: 0,
      outOfTurnMasterUsed: false,
      permanents: [],
      autoPassWhenOnlyPass: false,
    };
  });
  return {
    seats,
    edge: null,
    frames: [
      {
        kind: "turn",
        seat: "A",
        phase: "unlock",
        turnNumber: 1,
        unlockDone: false,
        edgeDone: false,
        unlockAbilitiesDone: false,
        unlockOthersDone: [],
        transfersLeft: 0,
        masterActionsLeft: 0,
        trifleGained: false,
      },
    ],
    eventLog: [],
    commandLog: [],
    decisionSeq: 0,
    rngState: seed,
    maxTurns: 60,
  };
}

function playFuzzGame(seed: number): void {
  const state = fourSeatGame(seed);
  const initialPools = new Map(state.seats.map((s) => [s.id, s.pool]));
  const initialBlood = new Map(
    state.seats.flatMap((s) => s.minions.map((m) => [m.id, m.blood] as const)),
  );
  const capacities = new Map(
    state.seats.flatMap((s) => [
      ...s.minions.map((m) => [m.id, m.capacity] as const),
      ...s.uncontrolled.map((u) => [u.card.id, u.card.capacity] as const),
      ...s.crypt.map((m) => [m.id, m.capacity] as const),
    ]),
  );
  const engine = new VtesEngine(state, testRegistry);
  const agent = new RandomAgent(seed * 7919 + 17);

  let steps = 0;
  for (; steps < DECISION_CAP; steps++) {
    const dp = engine.decision();
    if (!dp) break;

    if (dp.options.length === 0) {
      throw new Error(`[seed ${seed}] step ${steps}: no legal options offered`);
    }
    const ids = new Set(dp.options.map((o) => o.id));
    if (ids.size !== dp.options.length) {
      throw new Error(
        `[seed ${seed}] step ${steps}: duplicate option ids: ${[...ids].join(", ")}`,
      );
    }
    // NOTE: "the acting minion stays locked" is NOT an invariant — cards
    // like superior Majesty unlock a combatant mid-action. The real rule
    // (locked AT announcement) is checked over the event log after the
    // game (see below).
    for (const seat of state.seats) {
      for (const m of seat.minions) {
        // Ally life may exceed its printed starting life (p. 11) — only
        // vampires are capped at capacity, and capacity is DERIVED (the
        // Discipline master cards add +1), so the printed field is the
        // wrong ceiling.
        const cap = capacityOf(m);
        if (m.blood < 0 || (m.kind === "vampire" && m.blood > cap)) {
          throw new Error(
            `[seed ${seed}] step ${steps}: ${m.id} blood ${m.blood} outside [0, ${cap}]`,
          );
        }
      }
    }

    const choice = dp.options[agent.pick(dp.options.length)]!;
    try {
      engine.choose(choice.id);
    } catch (e) {
      throw new Error(`[seed ${seed}] on option ${choice.id}: ${String(e)}`);
    }
  }
  if (steps >= DECISION_CAP) {
    throw new Error(`[seed ${seed}] game did not terminate within ${DECISION_CAP} decisions`);
  }

  // The game announced its own end.
  expect(
    state.eventLog.at(-1)?.type,
    `[seed ${seed}] last event should be GameEnded`,
  ).toBe("GameEnded");

  // Lock-state legality: every action announcement is immediately
  // preceded by the lock of its acting minion (p. 19, p. 25).
  state.eventLog.forEach((ev, i) => {
    if (ev.type === "ActionAnnounced") {
      const prev = state.eventLog[i - 1];
      if (!prev || prev.type !== "MinionLocked" || prev.minion !== ev.acting) {
        throw new Error(
          `[seed ${seed}] ActionAnnounced for ${ev.acting} not preceded by its lock`,
        );
      }
    }
  });

  // Counter conservation: fold the event log over the initial values and
  // compare with the final state.
  for (const seat of state.seats) {
    let pool = initialPools.get(seat.id)!;
    for (const ev of state.eventLog) {
      if (ev.type === "PoolBurned" && ev.seat === seat.id) pool -= ev.amount;
      if (ev.type === "PoolGained" && ev.seat === seat.id) pool += ev.amount;
      if (ev.type === "PoolMovedToUncontrolled" && ev.seat === seat.id) pool -= 1;
      if (ev.type === "CounterMovedToPool" && ev.seat === seat.id) pool += 1;
    }
    expect(pool, `[seed ${seed}] pool conservation for seat ${seat.id}`).toBe(seat.pool);
  }
  for (const seat of state.seats) {
    for (const m of seat.minions) {
      // Minions that entered play mid-game get their baseline from the
      // VampireEnteredPlay/AllyEnteredPlay event; starting minions from
      // the setup snapshot. Ally life gains are uncapped (p. 11).
      let blood = initialBlood.get(m.id) ?? 0;
      let isAlly = false;
      // Capacity is DERIVED and it MOVES: a Discipline master card raises
      // its bearer's capacity while it is in play and lowers it again when
      // it leaves. The gain clamp has to use the capacity as of that
      // event, so the ceiling is folded alongside the blood rather than
      // taken once — a single ceiling for the whole game silently
      // mis-clamps every gain before or after the card was there.
      let cap = capacities.get(m.id) ?? Number.POSITIVE_INFINITY;
      const bonusOnMe = new Map<string, number>();
      for (const ev of state.eventLog) {
        if (ev.type === "PermanentEnteredPlay") {
          const bonus = ev.statics.capacityBonus ?? 0;
          if (bonus !== 0 && ev.attachedTo === m.id) {
            bonusOnMe.set(ev.cardId, bonus);
            cap += bonus;
          }
        }
        if (ev.type === "PermanentMoved") {
          const bonus = bonusOnMe.get(ev.cardId);
          if (bonus !== undefined && ev.to !== m.id) {
            bonusOnMe.delete(ev.cardId);
            cap -= bonus;
          }
        }
        if (ev.type === "PermanentBurned") {
          const bonus = bonusOnMe.get(ev.cardId);
          if (bonus !== undefined) {
            bonusOnMe.delete(ev.cardId);
            cap -= bonus;
          }
        }
        if (ev.type === "VampireEnteredPlay" && ev.minion === m.id) {
          blood = ev.blood;
        }
        if (ev.type === "AllyEnteredPlay" && ev.minion === m.id) {
          blood = ev.life;
          isAlly = true;
        }
        if (ev.type === "BloodBurned" && ev.minion === m.id) {
          blood = Math.max(0, blood - ev.amount);
        }
        if (ev.type === "BloodGained" && ev.minion === m.id) {
          blood = isAlly ? blood + ev.amount : Math.min(cap, blood + ev.amount);
        }
      }
      // The fold and the live value must agree on the ceiling too.
      if (m.kind === "vampire" && capacities.has(m.id)) {
        expect(cap, `[seed ${seed}] capacity fold for ${m.id}`).toBe(capacityOf(m));
      }
      expect(blood, `[seed ${seed}] blood conservation for ${m.id}`).toBe(m.blood);
    }
  }
}

describe("random-playout fuzzing (seeded)", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: random legal play reaches game end with invariants intact`, () => {
      playFuzzGame(seed);
    });
  }
});
