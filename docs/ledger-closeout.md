# The ledger closeout — 2026-09-03

**Owner instruction: "I want every single clause on every single library
card fully functional. Nothing should be skipped or cut."**

Done. `docs/partial-support.md`'s "clauses that need engine work" table is
**empty**, there are no `// PARTIAL:` markers left in `cards.ts`, and the
cut and blocked lists were already empty.

Ten rows were open. Two of them turned out to be **notes that had gone
stale rather than work that was missing**, and two entries on the ledger
are not clause gaps at all — they are recorded at the end.

| # | Card | What was missing |
|---|---|---|
| 1 | Preternatural Strength | "cannot play cards named /Torn Signpost/" |
| 2 | Wind Dance | the additional strike was a free choice, not a forced dodge |
| 3 | Putrescent Sustenance | "or add 2 (sup: 3) life to a zombie ally" |
| 4 | Dead Pool | *(already correct — stale note)* |
| 5 | .44 Magnum | did not honour "cannot use equipment" |
| 6 | Melange | the attached card outlived its bearer |
| 7 | Heroic Might | `[POT]`'s second granted strike, "2R damage" |
| 8 | Rotting Behemoth | "an ally **or vampire** in your ash heap" |
| 9 | Rutor's Hand | `[THA]`'s "burn 3 blood to be immune" |
| 10 | Go-getter | `[OBF]` "continue the action as if unblocked" |

---

## 1. The shape most of these had in common

Six of the ten needed **no new mechanism** — the machinery existed and the
card simply was not wired to it, usually because the card shipped before
the machinery did and nobody went back. `cannotGainLife`, `undodgeable`,
`Strike` opt-outs and the burn-equipment strike were all built for later
cards. That is the same rot the audit found on Aggressive Corpse
(`docs/library-audit.md` §2), and it is why the ledger is worth keeping
*and* worth re-checking against the code.

---

## 2. Preternatural Strength (101483) — a bar by NAME

> They cannot play cards named /Torn Signpost/.

`PermanentStatics.cannotPlayCardNames`. The existing sibling
`cannotPlayCardTypes` (Depravity) is checked at the two recruit/employ
sites, and that is not enough here: **Torn Signpost is a COMBAT card**, so
the bar has to reach every window a minion can play in.

So the check went into **`canPlayMode`**, a new wrapper around
`disciplineOk` that all **eleven** per-minion play gates now call. One
function, one rule. Patching the eleven sites individually is how
`modifyVotes`/`restrictVotes` drifted apart, and this project has hit that
shape four times.

**The clause really can bite**: Torn Signpost (101993) is in the pool and
supported.

---

## 3. Wind Dance (102185) — a FORCED strike, not an offered one

> `[THA]` As above, with 1 additional strike: dodge (limited).

`CombatFrame.forcedAdditionalStrike` (per side), read in
`combat.chooseStrike` when `strikeRound === "additional"`: that strike is
offered and nothing else.

**This is deliberately not `grantedStrikes`.** That list ADDS an option to
an ordinary choice ("can strike: dodge", Treasured Samadji). This one
REPLACES the choice — the card does not say the vampire *may* dodge, it
says the additional strike *is* a dodge. The old model let Wind Dance deal
hand-strike damage it does not print.

The forced strike is spent with the additional strike it came with, so a
second extra strike from another source is a free choice again.

**The existing test asserted the deviation** (it played `strike:hand` in
the sub-round) and now asserts the card text, with the negative pinned:
`strike:hand` is *not* offered.

---

## 4. Putrescent Sustenance (102335) — the zombie half

`actionRemoveFromAshHeap.addAllyLife`. The payoff names a RECIPIENT, so it
is one option per eligible ally rather than one payoff — the ally is
chosen at announcement like every other target (p. 25).

An ally already at its printed starting life **is not offered**: the cap
is `capacityOf` (an ally's capacity holds its starting life, p. 11), and a
recipient who could gain nothing is not a choice.

---

## 5. Dead Pool (102299) — the note was stale, the code was right

Its optional "you can add 1 counter" has been a real `ChoiceFrame` since
choice frames landed. The handler's own header comment still said
"always taken — deviation", and the ledger row copied that claim.

**No code changed.** Recorded because it is the third instance this week
of a comment outliving the thing it described.

---

## 6. .44 Magnum (100001) — the hand-rolled weapon rejoins the rules

The spec-compiled weapons check `cf.restrict[side].equipment` once, before
splitting on the window. The bespoke `.44` checked it nowhere, so a
vampire told they "cannot use equipment" (Terror Frenzy) could still fire
the gun *and* take its maneuver. The check now sits at the same point, for
the same reason: both the maneuver and the strike are uses of the weapon.

---

## 7. Melange (101195) — a card that outlived its bearer

Melange attaches to the **acting minion** while staying under its player's
control, so it is modelled as a seat-level permanent tagged
`melangeOn:<minion>`. The cost of that trick was that nothing swept it:
p. 16 says that when a minion leaves play "any counters or other cards on
it are burned", and a seat-level permanent is in nobody's `attached`
array.

`onLeaveReady` closes it — the hook is broadcast to **every** seat's
cards, which is exactly what lets a card held by one Methuselah watch
another's minion.

**Reading on record: torpor is not a trigger.** A vampire in torpor has
not left play and keeps what is on them (p. 34); only "burned" and
"removed" take the card. Pinned in both directions.

---

## 8. Heroic Might (100913) — two granted strikes on one card

`attachSelf.grantsRangedDamageStrike`. The grant was a *boolean*
(`grantsBurnEquipmentStrike`), which is why a second strike had nowhere to
go. Both now live in the same `combat.chooseStrike` ability block and are
told apart by the verb in the option id — the granted-action merge shape
this engine already uses when one card grants several actions.

The fixed-damage ranged strike goes through `chooseWeaponStrike`, which
carries no equipment assumption of its own, and the block now honours
`handStrikesOnly` (Immortal Grapple) — a granted strike is not a hand
strike.

---

## 9. Rotting Behemoth (102304) — burnt VAMPIRES reach the ash heap

> …burn it unless you remove an ally **or vampire** in your ash heap from
> the game.

p. 34 puts a burned vampire in its owner's ash heap. The engine did not
model that (`docs/ash-heap-design.md` recorded the omission deliberately:
a `MinionState` is not a `CardInstance`, and no card needed it). This card
needs it.

`MinionBurned` now files the vampire's card. **Allies are untouched** —
an ally's card rides into play as a self-attached entry, so
`PermanentBurned` already files it, and filing again would duplicate it.
**A minion REMOVED from the game is still not filed** (p. 16: it "cannot
be retrieved or affected in any way").

**`CardInstance.crypt` is the discriminator, and it was the whole risk of
this change.** A vampire card has no handler, so every filter that asks
the registry ("is it an ally?", "what does it cost?") already skips it.
The filters that do NOT ask had to be found and fixed:

- "a **library** card at random in their ash heap" (The Gate of Acheron) —
  both the offer and the random pick;
- plain-count removals ("remove 7 cards in your prey's ash heap") — both
  where they are enumerated and where they resolve.

`enterPlayAshCost.includeCrypt` is how Rotting Behemoth admits what the
type filter cannot.

---

## 10. Rutor's Hand (101664) — asking before the damage lands

> `[THA]` …and this vampire can burn 3 blood to be immune to this
> aggravated damage.

The blocker was **ordering**, not machinery. The damage is queued on the
action frame (`afterResolutionDamage`) and applied after resolution, while
a `ChoiceFrame` raised *during* resolution is only queued and flushes
afterwards — so the obvious build asked the question after the damage had
already landed.

The offer now rides **on the damage item** (`optOut`), and the engine's
damage loop **raises the frame instead of inflicting**. The answer either
burns the blood or calls `applyEnvironmentalDamage`, a small extraction so
a card that defers this damage lands it exactly as the engine would.

**Offered only when the price can be paid** — an unaffordable offer is not
a choice. The basic mode never asks, which is now the only difference
between the two modes and is pinned as such.

**A bug this caused and the rule it re-taught:** the choice handler was
first registered for *every* spec-compiled card. That made `choiceByKey`
non-empty everywhere, and `compileSpec` installs its dispatcher on exactly
that condition — so every card whose choice handling comes from elsewhere
had it overwritten. Enthrall and Propaganda broke immediately. **It is
registered only for a spec that carries `optOutBlood`.** This is the
wraith/zombie wave's dispatcher bug from the other side.

---

## 11. Go-getter (102355) — continuing a blocked action

> `[OBF]` Only usable after resolution of a blocked action. This vampire
> burns 1 blood to continue the action as if unblocked.

This was costed as a kernel change needing a "tail already run" guard on
four things. **The guard turned out to be unnecessary, because the right
move was a refactor rather than a re-entry.**

`resolveActionInner` was `if (success) { …everything a success does… }`
followed by an unconditional tail. That success block is now
**`applySuccessEffects(af)`** — one function, two callers. Continuing runs
*only* that function. The tail is not in it, so it cannot repeat: the card
is not burned twice, the block penalties are not paid twice, the
replacement draws do not happen twice.

Three decisions on record:

- **A distinct `ActionContinued` event, not a second `ActionResolved`.**
  One resolution genuinely happened and failed; every fold that counts
  resolutions would double-count. Pinned by a test asserting exactly one
  `ActionResolved`, with `success: false`.
- **The flag is consumed where the window CLOSES, which is in `settle`,
  not in `resolveActionInner`.** The first build put the check in
  `resolveActionInner` — which only *opens* the window — so it never ran.
  A window is closed by whoever notices the impulse cycle is quiescent.
- **The flag is cleared before it is acted on**, so a second Go-getter
  played into any re-opened window cannot loop.

---

## 12. What is left on the ledger, and why it is not skipped work

**Two entries are not unimplemented clauses:**

- **Revelations (101627)** — every clause works. What is missing is a
  property of `PlayerView`: an actor who looks at a hand and takes one
  card has no way to *remember* the cards they left. A human remembers; a
  phase-5 AI seat will not. That is a phase-5/6 modelling gap, and it is
  in the ledger so the AI work has a card to point at.
- **War Ghoul (102144)** — settled as a *reading* in the Vozhd wave, not a
  deviation. The row records the reading.

**Two clauses correctly match nothing, and cannot be "made functional":**
Wall Street Night's investment half and Black Forest Base's changeling
filter. Each filter is written and correct; the pool contains no card
either could ever match. Implementing them harder would mean inventing
cards. If the pool widens (phase 8) they begin matching with no code
change.

**The retrofit list is untouched and is not skipped work either** — four
cards that are supported, green and correct but still hand-rolled where a
later flag would express them, plus the structural note that
`permanent.lockGrant` lives inside `compileMaster` and cannot reach
another card type. Rewriting a working card is a separate, checkable
change (the Platinum Protocol precedent).
