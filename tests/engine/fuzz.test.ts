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
    "Vengeful Spirit",
    "Zombie",
    "Resplendent Protector",
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
    // Ammo (docs/ammo-design.md) — the before-resolution window. Dealt in
    // beside the guns above, which are what they need to do anything.
    "Manstopper Rounds",
    "Glaser Rounds",
    "Scattershot",
    "Dragon's Breath Rounds",
    "Caseless Rounds",
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
    "Target Hand",
    "Target Head",
    "Target Leg",
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
    "Elder Kindred Network",
    "Bribes",
    "Malkavian Rider Clause",
    "Cryptic Rider",
    "Ancilla Empowerment",
    "Domain Challenge",
    "Conservative Agitation",
    "Neonate Breach",
    "Parity Shift",
    "Banishment",
    // Second sweep.
    "Glancing Blow",
    "Soak",
    "Dodge",
    "Fake Out",
    "Boxed In",
    "Dead-End Alley",
    "Open Grate",
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
    // Blood-bank actions (docs/blood-bank-actions-design.md). The fixture
    // seats carry Sabbat, Ravnos and Banu Haqim vampires, so all four are
    // reachable: the sweep, the split and the uncontrolled-region feed.
    "Blood Feast",
    "Patshiv",
    "Esbat",
    "Khabar: Loyalty",
    // The Powerbases that BANK BLOOD
    // (docs/blood-banking-locations-design.md). All five: the store, the
    // mandatory drip that burns the card, the pool-matched investment, the
    // master-phase purchase, and the raid that empties one.
    "Powerbase: Barranquilla",
    "Powerbase: Chicago",
    "Powerbase: Mexico City",
    "Powerbase: New York",
    "Powerbase: Washington, D.C.",
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
    // Armed mid-combat (docs/armed-mid-combat-design.md) — two more cards
    // that BECOME weapons, and one that pulls one out of the hand. Dealt
    // in beside the guns and ammo above, which is what Zip Gun's "ammo
    // cards cannot be used with this gun" needs to be a live question.
    "Concealed Weapon",
    "Zip Gun",
    "Molotov Cocktail",
    // The delayed-replacement cards whose second clause is a CANCEL
    // (docs/cancel-in-combat-design.md). Dealt in beside Immortal
    // Grapple, which is the pool's only grapple card and the only thing
    // Disengage's cancel half can name.
    "Backstep",
    "Disengage",
    "Groundfighting",
    // The Edge as a currency (docs/the-edge-design.md) — one card that
    // gains the token, one that spends it, one gated on where it sits
    // and one that moves it by vote.
    "Esteem",
    "Leverage",
    "Instability",
    "Regaining the Upper Hand",
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
    "Auspex",
    "Presence",
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
    // The six clan Justicars added in wave 60
    // (docs/justicars-design.md). The fixture crypts carry all six clans,
    // and the pair of Nosferatu Justicars is the card contest the wave
    // turned on.
    // Table-wide pool swings (docs/table-pool-swings-design.md). All four
    // move every seat's pool at once, so the fuzz's pool-conservation
    // replay is the interesting guard here, not the option list.
    "Treaty of Tyre Enforced",
    "Political Stranglehold",
    "Can't Take it with You",
    "Mark of the Damned",
    // Stores you play out of (docs/store-plays-design.md, wave 62). These
    // two put cards into a pile the ORDINARY play enumerator reads, so the
    // fuzz is checking that a card in no zone is still offered exactly
    // once, and that nothing draws a replacement for it.
    "Gift of Proteus",
    "Storage Annex",
    // Transfers as a currency (docs/transfer-currency-design.md, wave 63).
    // Three of these four change the influence phase for EVERY seat — the
    // transfer ban, the unlock surcharge and the any-Methuselah burn — so
    // what the fuzz is guarding is that the phase still ends: a currency
    // that can go up as well as down is a loop if a gate is wrong.
    "Ennoia's Theater",
    "King's Rising",
    "Whispers of the Nictuku",
    "Inconnu Tutelage",
    "Banu Haqim Justicar",
    "Brujah Justicar",
    "Lasombra Justicar",
    "Nosferatu Justicar",
    "Tremere Justicar",
    "Ventrue Justicar",
    "Protected District",
    "Party Out Of Bounds",
    // Legacy weapons (docs/pool-widening-design.md §6, tranche 3 wave 1).
    // The once-each-combat and once-each-round latches are the new thing
    // here, and a latch that never clears is exactly the kind of bug the
    // fuzz sees: it makes an option list shrink and never grow back.
    "Chainsaw",
    "Combat Shotgun",
    "Mark V",
    "Brass Knuckles",
    "Sengir Dagger",
    "Submachine Gun",
    // Legacy locations (tranche 3 wave 2). The Mausoleum's conditional
    // reads whether /Ventrue Headquarters/ is in play, and that card is
    // already in this list — so both branches get dealt.
    "The Mausoleum, Venice",
    "London Evening Star, Tabloid Newspaper",
    "Monastery of Shadows",
    "Morgue Hunting Ground",
    "Port Hunting Ground",
    // Legacy equipment statics (tranche 3 wave 3). The two block bars are
    // the interesting ones here: they SHRINK the blocker list, and an
    // over-broad bar shows up as a table where nothing can ever block.
    "The Signet of King Saul",
    "Cloak of the Abalone",
    "Aaron's Feeding Razor",
    "Laptop Computer",
    "IR Goggles",
    // Legacy retainers and allies (tranche 3 wave 4).
    "J. S. Simmons, Esq.",
    "Jackie Therman",
    "Loyal Street Gang",
    "The Knights",
    // Legacy referendums (tranche 3 wave 6). Four filters over one
    // primitive: a filter that is too broad pays for minions the card
    // never named, which shows up here as pool conservation drifting.
    "Autarkis Persecution",
    "Perpetual Care",
    "Exclusion Principle",
    "Rabble Razing",
    // Legacy political actions (tranche 1 wave 13). Two of these MOVE
    // pool between seats rather than creating or destroying it, which is
    // exactly what the conservation invariant is shaped to catch if a
    // steal's two halves ever disagree. The Final Nights is also the only
    // card here that does something when its referendum FAILS, and the
    // fuzz votes badly often enough to reach that path.
    "Transfer of Power",
    "Tithings",
    "Diversity",
    "The Final Nights",
    "Consanguineous Condemnation",
    // Legacy political removals (tranche 1 wave 14). These take minions
    // OFF the table mid-referendum, which is where a stale reference to a
    // minion that no longer exists surfaces — and Permanent Vacation
    // removes rather than burns, so the blood it was holding leaves the
    // game and the conservation invariant has to account for it.
    "Command of the Harpies",
    "Excommunication",
    "Sacrifice",
    "Permanent Vacation",
    "Screw the Masquerade!",
    // The pay-to-keep sweeps (tranche 1 wave 15). These raise one CHOICE
    // FRAME PER CARD across every seat, which is the largest fan-out of
    // frames any card in the pool produces — and the random walker will
    // answer them in every combination, including paying itself to 0.
    "Jericho Founding",
    "Kindred Segregation",
    "Peace Treaty",
    // Legacy one-shot masters (tranche 3 wave 7). Ascendance and Tribute
    // move pool, so pool conservation over the event log covers them; the
    // two burns take cards off the table, which is where a stale
    // reference to a burned card shows up.
    "Ascendance",
    "Tribute to the Master",
    "Vulnerability",
    "Unnatural Disaster",
    "Effective Management",
    "Letter from Vienna",
    // Legacy cost-modifier masters (tranche 3 wave 8). These change what
    // OTHER cards cost, so a mis-scoped modifier shows up as pool
    // conservation drifting rather than as an error.
    "Therbold Realty",
    "Centralized Background Check",
    "Bureaucratic Overload",
    "The Path of Night",
    "The Path of Typhon",
    // Legacy action modifiers (tranche 3 wave 9). Mantle of the Moon
    // empties the blocker list outright, which is the shape most likely
    // to strand the option enumerator.
    "Mantle of the Moon",
    "Stiff Contempt",
    "Spoils of War",
    "Acheron Vortex",
    // Legacy referendum reactions (tranche 3 wave 10).
    "Surprise Influence",
    "Conflict of Interests",
    "Irregular Protocol",
    // Legacy action cards (tranche 3 wave 11). Bleeds and pool payouts,
    // which pool conservation over the event log covers directly.
    "Computer Hacking",
    "Vermin Channel",
    "Art Scam",
    "Dark Mirror of the Mind",
    "Kindred Intelligence",
    "Forgery",
    // Legacy rush and burn actions (tranche 3 wave 12). Ambush's locked
    // target is re-read at resolution, so a fizzled rush is a path the
    // fuzz can now reach.
    "Arson",
    "Bum's Rush",
    "Ambush",
    "Entrenching",
    // Legacy one-shot weapons (tranche 3 wave 23). A weapon that BURNS
    // ITSELF at strike resolution is the first equipment to leave play
    // from inside the damage path, so every later read of the bearer's
    // attachments is now a read of a card that may have gone.
    "Grenade",
    "White Phosphorus Grenade",
    "Smoke Grenade",
    "Waxen Poetica",
    // Legacy reactions that read the ACTING minion (tranche 3 wave 24).
    // Each one makes an option list depend on who is acting, which is the
    // shape the fuzz is best at: a gate that is too tight shows up as a
    // card nobody can ever play, and one too loose as a bleed that goes
    // negative.
    "Banner of Neutrality",
    "Keep it Simple",
    "Nest of Eagles",
    "Venetian Conference",
    // Legacy destroyer allies (tranche 3 wave 25). A Ⓓ action whose
    // target is a CARD IN PLAY that can be gone by resolution — the shape
    // that has produced a throw in the past every time a read was not
    // total.
    "The Bruisers",
    "Arcanum Investigator",
    'Felix "Fix" Hessian',
    // Legacy priced retainers (tranche 3 wave 26). Corpse Minion is the
    // first REPEATABLE in-window price in the pool: no latch, so an
    // option that reappears every time it is taken is exactly the shape
    // that can loop if the cost is ever not charged.
    "Corpse Minion",
    "Malajit Chandramouli",
    "Omael Kuman",
    // Gehenna: the recurring event (tranche 3 wave 32). These fire in
    // EVERY seat's phase from one seat's play area, so they put a cost on
    // phases the fuzz used to walk through untouched — and Dragonbound
    // can oust a Methuselah outside their own turn, which is the shape
    // that breaks a loop that assumes seats only leave on their own.
    "Dragonbound",
    "Thirst",
    "Conquest of Humanity",
    // Gehenna taxes (tranche 3 wave 33). The Rising drops a PoolGained
    // event on the floor, so it is the first card that can make the
    // conservation invariant's two sides disagree if the drop is ever done
    // at apply time instead of at emit; Torpid Blood changes the price of
    // an action the fuzz takes freely.
    "Torpid Blood",
    "The Slow Withering",
    "The Rising",
    // Gehenna: the unlock-phase trio (tranche 1 wave 50). These three fire
    // a CHOICE frame in every seat's unlock phase, which no other event
    // does — Recalled to the Founder can burn a minion there, and
    // Becoming of Ennoia can kill one with damage, both at a moment the
    // turn frame is mid-sweep.
    "The New Inquisition",
    "Becoming of Ennoia",
    "Recalled to the Founder",
    // Fee Stake (tranche 1 wave 51). A TITLE taken by an action rather
    // than by a referendum — so a fuzz seat can become a baron without
    // ever calling a vote, and two seats taking the same city is the
    // contest path from a direction nothing else in the decks reaches.
    "Fee Stake: Boston",
    "Fee Stake: New York",
    "Fee Stake: Seattle",
    // Referendums that become a table rule (tranche 1 wave 52). Camarilla
    // Threat and Masquerade Enforcement put a PRICE on two phases the
    // fuzz walks every turn — the discard and the influence out — so a
    // gate and its payment drifting apart shows up as an unpayable
    // option rather than as nothing at all.
    "Beyond Reproach",
    "Camarilla Threat",
    "Masquerade Enforcement",
    // Before-range attachments (tranche 1 wave 53). The guns and the five
    // ammo cards are already in these decks, so Magazine is dealt beside
    // what it needs; Nosferatu Putrescence is played from OUTSIDE a
    // combat, which few cards in the decks do.
    "Focus the Blood",
    "Magazine",
    "Nosferatu Putrescence",
    // The ash heap as a resource (tranche 1 wave 54). These are the first
    // cards that MOVE things out of an ash heap, which every other card
    // treats as write-only — and Redeem reads a burnt vampire's recorded
    // capacity, so it exercises the ash entry's new field.
    "Redeem the Lost Soul",
    "Waste Management Operation",
    "Maabara",
    "The Erciyes Fragments",
    // Events that are one table-wide rule (tranche 3 wave 34). Port
    // Authority redirects a replacement draw that every seat takes every
    // turn, and NRA PAC unlocks a minion at a moment nothing else in the
    // pool acts on.
    "Port Authority",
    "NRA PAC",
    "Urban Jungle",
    // Events that keep a counter (tranche 3 wave 35). Dr. Marisa Fletcher
    // can remove the ACTING minion from inside a successful block, which
    // is the shape that threw before this wave; FBI queues damage that
    // lands after a combat has already been popped.
    "Dr. Marisa Fletcher, CDC",
    "FBI Special Affairs Division",
    "Fueled by Heart's Blood",
    // Buying a block (tranche 3 wave 36). Legwork's gate reads a DERIVED
    // value of the reacting minion, and Pack Tactics/Elder Intervention are
    // the pool's first pair of cards that bar each other per vampire per
    // action — both are option lists that must shrink and grow back.
    "Legwork",
    "Pack Tactics",
    "Eluding the Arms of Morpheus",
    // The lock as currency (tranche 3 wave 37). Minor Irritation UNDOES a
    // lock the engine has already applied, and Fillip hands a wake to a
    // minion other than the one playing the card.
    "Minor Irritation",
    "Lost in Translation",
    "Fillip",
    // Blood at the referendum (tranche 3 wave 38). These are the pool's
    // first REPEATABLE vote purchases: an option that reappears every time
    // it is taken is exactly the shape that can loop if the blood is not
    // charged, and the fuzz votes constantly.
    "Mob Rule",
    "Rant!",
    "Cheval de Bataille",
    // Conditional weapons (tranche 3 wave 39). The first weapon in the
    // pool with TWO maneuvers, and the first whose strike is barred in a
    // whole round — both are option lists that must shrink and grow back
    // as a combat runs.
    "Deer Rifle",
    "Blade of Bellona",
    "RPG Launcher",
    // Discipline-granting equipment (tranche 3 wave 40). These change a
    // vampire's DERIVED Disciplines while in play, so every card the fuzz
    // deals is re-priced and re-gated against a set that moves when the
    // equipment does — and the last of the three offers its action to
    // every seat at the table, not only the bearer's.
    "Changeling Skin Mask",
    "Drum of Xipe Totec",
    "Veneficorum Artum Sanguis",
    // Burn the equipment (tranche 3 wave 41). Two of the three offer their
    // ability in EVERY window their controller is asked in — the first
    // cards in the pool with no printed timing at all — so they are the
    // option lists most likely to expose a window the enumerator should
    // not have reached.
    "Blood Tears of Kephran",
    "Mummy's Tongue",
    "Vial of Elder Vitae",
    // Vehicles and havens (tranche 3 wave 42). The pool's first exclusivity
    // CLASS shared across card names, plus the first equipment that enters
    // play locked — both are option lists that must close and stay closed.
    "Helicopter",
    "Delivery Truck",
    "Body Bag",
    // Retainer upkeep (tranche 3 wave 43). The first cards to fire on the
    // minion phase OPENING, and the first recurring card that can burn
    // ITSELF on a phase boundary — which is the shape a per-phase latch
    // gets wrong.
    "Faithful Servant",
    "Fortune Teller",
    "Robert Carter",
    // One each round (tranche 3 wave 44). Death Seeker acts inside ANOTHER
    // card's as-played window, which is the one window the fuzz could
    // previously only ever reach with a strike card.
    "Death Seeker",
    "Leathery Hide",
    "High Ground",
    // Waves 27-31, added late (2026-09-14). Step 5 of the wave ritual was
    // missed for five waves running, so these sixteen cards had never been
    // dealt into a random game. Each one is a shape the fuzz is built for:
    //
    //  - the second-minion modifiers (27) are paid for by a minion that is
    //    NOT the actor, so a mis-scoped payer shows up as blood drifting;
    //  - the strike sources (28) put a strike's damage on ANOTHER card, and
    //    Lucky Blow defers its own replacement to after combat;
    //  - the first-strike cards (29) split a round in two, and Haymaker
    //    bars itself for the NEXT round — a latch that must clear;
    //  - the no-combat cards (30) cancel a combat that has already been set
    //    up, which is where a stale frame reference surfaces;
    //  - the events (31) are the only cards played in the DISCARD phase,
    //    once each game, and The Bitter and Sweet Story changes every
    //    seat's hand size from one seat's play area.
    "Stealth Ritus",
    "Suppressing Fire",
    "Zapaderin",
    "Backflip",
    "Channeling the Beast",
    "Lucky Blow",
    "Up Yours!",
    "Quick Jab",
    "Haymaker",
    "Forearm Block",
    "Blood Brother Ambush",
    "Clan Loyalty",
    "Ghoul Escort",
    "Hunger Moon",
    "The Bitter and Sweet Story",
    "Narrow Minds",
    // Plain allies (tranche 1 wave 45). Procurer's action is the first
    // repeatable blood-from-the-bank grant an ALLY carries, and the Hunter
    // rushes with first strike on every hand strike. The Slashers, Outcast
    // Mage and the Hunter print Brujah / Tremere / Malkavian icons, which
    // no fixture vampire here carries — they are dealt, never recruited;
    // their gates are proven in tests/cards/plain-allies.test.ts.
    "The Slashers",
    "Outcast Mage",
    "Rafastio Ghoul",
    "Procurer",
    "Muddled Vampire Hunter",
    // Plain allies II (tranche 1 wave 46). Thadius Zho's Ⓓ action burns
    // blood from another seat's vampire and the ECTU Operative's burns a
    // vampire in TORPOR — both targets fixed at announcement and readable
    // as gone at resolution. Rom Gypsy is the first ALLY carrying a
    // location-style lockGrant. Tremere / Ravnos icons: dealt, not
    // recruited, by this fixture.
    "Thadius Zho",
    "ECTU Operative",
    "Rom Gypsy",
    // Allies with two Ⓓ actions (tranche 1 wave 47). Gregory Winter is the
    // pool's first card carrying TWO granted actions, so a resolver that
    // answers for the wrong grant shows up here as blood conservation
    // drifting; Amam LEAVES PLAY into the library rather than the ash
    // heap, and Young Bloods pays its killer — both are counters moving
    // on a path the replay invariant has to account for.
    "Young Bloods",
    "Gregory Winter",
    "Amam the Devourer",
    // The mummies (tranche 1 wave 48). Qetu adds a THIRD press credit pool
    // to the combat frame, which is the shape that strands a credit if the
    // spend order is wrong; Saatet-ta's one lock now offers three options.
    // All three leave play into the library, which the replay invariant
    // has to account for.
    "Qetu the Evil Doer",
    "Saatet-ta",
    "Nephren-Ka",
    // The mummies closed out (tranche 1 wave 49). `burnSelfAndBurnMinion`
    // takes TWO minions off the table in one resolution — the actor among
    // them — which is the shape that strands a frame reading its own
    // acting minion; Tutu unlocks himself on a phase boundary.
    "Akhenaten, The Sun Pharaoh",
    "Kherebutu",
    "Tutu the Doubly Evil One",
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
          // Mirrors `a`'s sect, so an even seat controls TWO ready Sabbat
          // vampires. Stealth Ritus needs a ready Sabbat to play it and
          // ANOTHER ready Sabbat to burn the blood, so with one per seat it
          // would be dealt and never be playable — a card in the decks that
          // is never played teaches the fuzz nothing.
          sect: i % 2 === 0 ? ("sabbat" as const) : ("anarch" as const),
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
      throw new Error(`[seed ${seed}] step ${steps}: no legal options offered (seat ${dp.seat}, window ${dp.window}, frames ${state.frames.map((f) => f.kind).join(">")})`);
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
      // The STACK, not just the message: a bare "no permanent in play:
      // B-card-72" says nothing about which of ~460 cards asked for it.
      throw new Error(`[seed ${seed}] on option ${choice.id}: ${String(e)}\n${(e as Error).stack}`);
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
      let knownCap = capacities.has(m.id);
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
        // A TOKEN vampire (Waters of Duat, the Path cards) has its own
        // entry event and never appears in the setup snapshot, so the
        // fold had no ceiling for it at all — `cap` stayed Infinity and
        // every gain went in unclamped. It read as a conservation
        // failure against an engine that was clamping correctly. A token
        // starts at 0 blood and carries its printed capacity.
        if (ev.type === "VampireTokenEnteredPlay" && ev.minion === m.id) {
          blood = 0;
          cap = ev.capacity;
          knownCap = true;
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
      if (m.kind === "vampire" && knownCap) {
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

