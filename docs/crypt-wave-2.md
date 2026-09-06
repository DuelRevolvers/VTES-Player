# Crypt wave 2 — granted actions and unlock riders

2026-09-03. **Crypt 47/217 supported. Counting the 118 that need no
implementation, 165 of 217 crypt cards now play correctly; 52 ability
cards remain.**

14 cards, and the wave's finding is that **almost none of it was new
mechanics** — the library waves had built every piece.

---

## 1. The rushes — the ally clause, on a vampire

Theo Bell, Barachiel, Dafina Hanganu, Nathaniel Bordruff.

"\<This vampire\> can enter combat with a minion as a Ⓓ action" is the
**same sentence** an ally's card prints, so it is the same clause
(`spec.rush`) and the same compiler (`rushGrant`). `compileCrypt` spreads
it in; nothing else changed.

**Nathaniel needed one word.** "…with a LOCKED vampire" is
`enumerateRushTargets`' `lockedOnly`, which that function has understood
since the rush gate was built — no card had ever asked for it. One
optional field on `spec.rush`.

That is the crypt being cheap again, and for the recorded reason: a crypt
card's text rides on a self-attached entry exactly as an ally's does
(`docs/crypt-plan.md` §2).

---

## 2. Unlock riders — the largest shape in the crypt

Aaradhya, Keegan, Aline, Anja, Sakura, plus Sybren and Kalinda, whose
unlocks are not action riders.

`permanent.unlockAfterAction` is one clause with a field per printed
phrase: *whose* action triggers it (`self` / `other`, with a sect or clan
filter), *who* ends up unlocked (`self` / `actor` — Anja unlocks the
other Hecata), a blood cost, `oncePerTurn`, `ownTurnOnly`, and the
requirement filters.

**"An action REQUIRING a Gangrel" is a property of the CARD played**, not
of the actor, and it is answered by `requiresClans` /
`requiresDisciplines` — the central queries built for the
discipline-filtered wave. A built-in action (a plain bleed) plays no card
and so requires nothing, which is why Keegan does not wake from an
ordinary bleed. Pinned by a test.

**Sakura is the exception, and the Path wave explains it**: a Path is
printed on the CRYPT card, so "an action requiring the Path of Death and
the Soul" is read off the acting vampire, not off the card
(`docs/path-cards-design.md` §0).

**The offer is registered, not taken.** Every one of these prints "can",
and most cost blood, so they go through `addAfterResolutionUnlock` — the
op built for Gifts From Hereafter, which raises the question the instant
the action is over.

### 2.1 The bug this caused: a question nobody answers is SILENCE

The op RAISES the question; something has to ANSWER it. The
`unlockAfterResolution` choice key was registered only inside the block
for the card effect of the same name, which these crypt cards do not use.

So the frame was raised, found no options, and **popped harmlessly** — no
error, no warning, no unlock. Every one of the five riders was inert, and
three of them looked fine because the *trigger* half worked.

Registering the key alongside the trigger fixes it. **This is the
`choiceByKey` family of bugs again**: the map made two clauses safe to
coexist, but nothing checks that a raised key has a registered answer.

### 2.2 An ordering trap, in the code that warns about it

`addCryptAbilities` registers a choice key, so it has to run **before**
the `choiceByKey` dispatcher is installed — and the dispatcher installs
only `if (Object.keys(choiceByKey).length > 0)`. Calling it after (which
is where it naturally went, at the end of `compileSpec`) meant a card
whose ONLY choice was a crypt one got no dispatcher at all.

That is exactly the bug `docs/wraith-zombie-design.md` §5 records, and the
comment warning about it is four lines above the call.

---

## 3. Library searches

Dominica ("a master archetype card") and Sakhar ("an equipment card"),
both "reveal it and move it to your hand as a +1 stealth action".

`permanent.searchToHand` is a granted action, so it announces like any
other and the **search happens at resolution** — p. 48 is explicit that
you do not search until the action succeeds. The gate's other rules carry
over unchanged: you need not announce what you seek, **finding nothing is
always legal**, and **the library is shuffled either way** (p. 14). "Find
nothing" is an ordinary answer rather than a decline, because an optional
frame's decline never calls `applyChoice` and would skip the shuffle.

New: **`CardSearchedToHand`**, distinct from a draw because the card is
NAMED — it is revealed to the table, where a draw is private.

Dominica's "master ARCHETYPE card" is matched on the card's own **tag**,
not a list of names that could rot.

### 3.1 The other bug: an effect key is what routes resolution

`announceEntryAction` defaults its effect key to `"enterCombat"`. Without
an explicit `effect: { key }`, the search action announced, resolved, and
did **nothing** — `resolveGrantedAction` is dispatched by that key.

Same shape as §2.1: the action was offered, was legal, was taken, and
accomplished nothing, with no error anywhere.

---

## 4. Doc Martina, for free

"Rescuing a vampire from torpor costs Doc Martina −1 blood" is
`PermanentStatics.rescueDiscount`, built for Saulot's Healing Touch and
already read at **both** the enumeration and the payment site — the
lesson that wave recorded. One field, no code.

---

## 5. The playtest decks may now use ability vampires

`validateDecks().inertAbilities` reported **every** vampire with ability
text, because when it was written no crypt card had an implementation.
That is now wrong: a supported vampire carries its ability for real.

The check reads the registry's `supported` flag, so 47 vampires are
eligible today and the number rises with each wave.

**The decks themselves are unchanged.** Swapping a vampire changes its
clan and Disciplines, which is what makes the library half of a deck
playable — that is a play-balance decision for the owner, not a
side effect of a card wave. Two clean swaps exist if wanted (same clan,
same capacity): Berenguela → Lenny Burkhead (Nosferatu 6), Casey Snyder →
Martina Srnankova (Gangrel 6).

---

## 6. What is left

**52 ability cards.** The next natural groups:

- **C3 — combat and blocking**: Adrino's mandatory press, Kevin Jackson's
  mutual clan bonus, Noluthando's ranged damage, Opikun and Huldu's
  prevention for another minion, Faruq, Sergio, Egidia, Crossbreaker,
  Agnieszka, Flávio, Phaibun.
- **C4 — payoffs and the new primitives**: the discard-for-bonus family
  (6 cards, one primitive), the ash-heap movers (Lenelle, Hel-Blá, Mora),
  the discard-phase clauses (Luciano, Sreelekha), Gathii's reveal, Evan
  Klein's coin flip, Hesha's counting static, Djeneba's cost modifier.
