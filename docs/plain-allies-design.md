# Plain allies — and the clan icon that was never a gate

Tranche 1 wave 45, 2026-09-14. The Slashers (101799), Outcast Mage
(101337), Rafastio Ghoul (101537), Procurer (101491), Muddled Vampire
Hunter (101250). Library 651 → 656.

## §0 The finding: a clan symbol on a minion card is a REQUIREMENT

Rulebook p. 10: *"In many cases, a minion card will have a Discipline
symbol, a clan symbol and/or a blood cost; in these cases, the card can
only be played by a vampire who meets the requirements."* And p. 5:
*"Some library cards require a member of a particular vampire clan to
play."*

The engine had `requiresClan` on 29 of the 86 supported minion-type
library cards that print a clan icon — the ones whose TEXT also says
"Requires a …" or "Only usable by a …" (Zapaderin). The other **57** —
Dog Pack, Political Ally, War Ghoul, Zombie, every Vozhd, Psychophagia,
Night Terrors, Kali's Fang, Femur of Toomler, Scorn of Adonis, Rewilding,
Thing, Kindred Intelligence … — were playable by any minion at all. KRCG's
`card_text` does not repeat the icon, and each wave read the text.

That was the fifth time a clan gate went missing, and the first time at
scale. The audit (`scripts/` has no script for it; the one-off is in the
session log) is one sentence: *every supported library card of a minion
type whose registry `clans` is non-empty must compile with
`requiresClans()` non-empty.* Masters are exempt — a master with a clan
requirement prints it in text ("Requires a ready Ventrue"), and the icon
on a hunting ground is decorative (pool-widening wave 2).

**Fourteen of the 57 print a clan no V5 vampire has** (Brujah antitribu,
Giovanni, Harbinger of Skulls, Samedi, Salubri/Gangrel/Toreador/Nosferatu
antitribu): Acheron Vortex, Art Scam, Blade of Bellona, Blood Brother
Ambush, The Bruisers, Death Seeker, Felix "Fix" Hessian, Leathery Hide,
Spoils of War, Stiff Contempt, Venetian Conference, Vengeful Spirit,
Vermin Channel, Zombie. With the gate on they are whole and inert until
§7 opens those clans — the Tradition Upheld situation, fourteen times.
They stay in the pool for now: pulling them means pulling fourteen specs
and their tests, and `supported.test.ts` pins `supported.json` to
`implementedIds` exactly. **That is the owner's call, flagged in the
report; nothing here decided it.**

Sixty-eight scenario tests went red when the gate landed and every one
was a fixture minion with no clan playing a card that prints one. Where a
helper takes the card name, the fixture now reads the clan off the
handler: `testRegistry[card]?.requiresClans?.()?.[0] ?? null`. Three
negative-space tests had been using a clan-icon card as their "requires
nothing" fixture (Screamer for Hel-Blá, War Ghoul for Szlachta Assistant,
Political Ally for Paths in Two Worlds) and now use a card that prints no
icon. Angel's Gift's melee weapon is Sengir Dagger, since "requirements …
apply as normal" and Kali's Fang is a Banu Haqim card.

## §1 The five cards

All five are `ally` specs; three needed one field each.

- **The Slashers** — `ally.strike` 1R, `requiresClan: ["Brujah"]`.
- **Outcast Mage** — strike 2R, and "one optional maneuver each combat"
  is the `maneuverPerCombat` static a gun already carries, on the ally's
  own self-attached entry (`engine.ts` sums it over `attached`).
  `requiresClan: ["Tremere"]`.
- **Rafastio Ghoul** — `playsAsVampire: { tha: "basic" }`, no icon.
- **Procurer** — Seraphina's `addBlood` grant, +2 stealth, undirected.
- **Muddled Vampire Hunter** — `statics.firstStrike` (the permanent
  static `firstStrikeFor` already reads, docs/first-strike-design.md) and
  War Ghoul's `rush`. `requiresClan: ["Malkavian"]`.

## §2 Two narrowings

**`grantedAction.vampiresOnly`.** Seraphina's arm says "a minion you
control" and offers allies; Procurer says "a ready VAMPIRE you control".
A flag on the grant, read in the enumerator, so an ally short of its life
is not a legal target.

**`rush.othersOnly`.** War Ghoul "can enter combat with a vampire" and
`enumerateRushTargets` reaches its own controller's vampires (its test
pins V1 among the targets). The Hunter says "controlled by another
Methuselah". A flag on the rush, read in the enumerator.

## §4 Wave 46 — Thadius Zho, ECTU Operative, Rom Gypsy (2026-09-14)

Library 656 → 659. Two new `grantedAction` arms and one compiler
finding.

- **`burnBlood`** — "can burn 1 blood from a vampire as a +1 stealth Ⓓ
  action" (Thadius Zho). Ⓓ makes it another Methuselah's vampire (the
  `burnPermanent` convention); ready, with blood to burn, or the action
  would do nothing. `steal: true` moves the blood to the actor as life —
  Gregory Winter's sentence, unbuilt because he needs TWO grants and
  `permanent.grantedAction` is one object.
- **`burnTorporVampire`** — "can burn a vampire in torpor as a Ⓓ action"
  (ECTU Operative). `gainLife` is for Gregory and Amam, both waiting on the
  second grant. "Operation Antigen" is a printed keyword no card in the
  pool reads; it rides in the tags.
- **`lockGrant` on an ally.** Rom Gypsy's "Lock to give a Ravnos you
  control +1 stealth" is Channel 10's sentence, and `permanent.lockGrant`
  compiled only inside `compileMasterCard` — so on an ally it compiled to
  nothing, and nothing on the table showed it. Now `addLockGrant(spec,
  handler)`, called from the master compiler and from the shared tail for
  every other type. The "wired in some compilers and not another" shape
  (`delayedReplace`, wave 33), found by the scenario test's positive
  space rather than its negative.

Both targets are re-read at resolution with `findMinion`: a vampire
rescued from torpor, or burned in the action's own windows, is an action
with nothing left to do.

## §5 Wave 47 — the deferrals, built (2026-09-14)

Library 659 → 662. Young Bloods, Gregory Winter, Amam the Devourer — the
three cards wave 46 deferred, and the four mechanics they were waiting on.

**A card may grant SEVERAL actions.** `permanent.grantedAction` is one
object, so Gregory ("steal 1 blood … as a +1 stealth Ⓓ action. He can burn
a vampire in torpor to gain 2 life as a Ⓓ action") could not be written.
The compiler's granted-action block is now a `forEach` over
`[grantedAction, ...grantedActions]`, each turn chaining onto the handlers
the previous one installed. **Every option, use and resolution carries the
grant's INDEX**, because all of them route through the single
`cryptGrantedAction` effect key: without it, the first grant's resolver
answers for the second's action, which is silent and wrong rather than a
crash. `grantedAction` stays the first grant, so no existing card moved.

**Three ally clauses about leaving**, all on `onLeaveReady`, which fires
*before* `burnMinion` walks the attachments:

- `burnBounty` (Young Bloods) — "if a vampire controlled by another
  Methuselah burns this ally **in combat or as an action**, he or she
  gains 2 blood". The burner is **derived**, not plumbed: the other
  combatant if this ally is in a combat, else the acting minion of an
  action aimed at it. That phrase names exactly those two frames, so a
  burn from anywhere else pays nothing — which is the sentence, not a
  simplification.
- `shuffleIntoLibraryOnBurn` (Amam) — the card goes home to the library
  instead of the ash heap.
- `opposingBurnedGainLife` (Amam) — "if a minion opposing Amam in combat
  is burned, Amam can gain 1 life", capped at starting life.

Plus `statics.unlockBurnLife` (Gregory) — the softer sibling of
`unlockSelfBurn`: an ally's life IS its blood (p. 11), so at 1 life the
two are the same thing and the engine's ordinary "an ally at 0 leaves
play" needs no help.

### What it found

**`PermanentShuffledIntoLibrary` searched `seat.permanents` alone.** An
ally carries its own card as a SELF-ATTACHED entry, so shuffling Amam home
would have left the entry in play *and* put a copy in the library — a
minion on the table whose card is also in the deck. The
`onMasterPhase` / `onAnyUnlock` / `onBleedSuccess` family bug (CLAUDE.md),
this time in an **apply** rather than a hook, which is why no amount of
re-reading the hook siblings would have found it. Fixed to search attached
entries too.

Two allies remain deferred and are named here so the next wave does not
re-derive them: **Impundulu** (needs flight granted to an ALLY) and
**Arcane Appraiser** (a move-equipment-from-torpor grant).

## §3 Fuzz

All five are in the decks. The Slashers, Outcast Mage and the Hunter print
Brujah / Tremere / Malkavian, which no fixture vampire carries, so they
are dealt and never recruited; the gate is proven by the scenario test
both ways.
