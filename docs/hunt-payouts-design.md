# The hunt payout — design (wave 88)

Four legacy cards that all put **one more blood on a successful hunt**. The
payout is the same; everything around it differs, which is what makes them one
wave rather than four one-offs.

| Card | KRCG | Cost | Text |
| --- | --- | --- | --- |
| Hospital Food | 100938 | — | Master: unique location. Requires a ready anarch. Lock when an anarch announces a hunting action. If that action is successful, the anarch gains an additional blood. |
| Inbase Discotek, Frankfurt | 100968 | 2 pool | Master: unique location. Lock to give a vampire who successfully hunts an additional blood from the blood bank. (Ignore excess blood.) |
| Festivo dello Estinto | 100723 | 1 pool | Only one Festivo dello Estinto can be played in a game. Put this card in play. Sabbat vampires get −1 stealth during hunt actions. Sabbat vampires successfully hunting gain enough blood from the blood bank to reach full capacity. During your unlock phase, burn this card. |
| Harvest Rites | 100889 | 1 blood | +1 stealth action. Requires a Sabbat vampire. Put this card on this vampire. Once each turn, when this vampire successfully hunts, they gain 1 additional blood. A vampire can have only one Harvest Rites. |

Printed text read from `data/vtes-raw.json`.

**The hunt is the one built-in action nothing in the pool had bent.** The engine
already had `huntAmountFor`, an `onHuntSuccess` hook, hunting grounds and a
`cannotHunt` aura — all of it written for cards that feed a vampire *outside* an
action. These four reach into the action itself, and that is where the gaps were.

## 1. Why these four

They differ along axes a scenario test can assert against each other:

- **When the payer commits.** Hospital Food locks *at announcement*, before
  anyone has decided whether to block. Inbase Discotek locks *after the hunt has
  succeeded*. Same blood, same lock — one is a bet, the other a certainty, and
  that is exactly what the 2 pool buys.
- **Whose hunt.** Both locations say "a vampire" / "an anarch", never "you
  control": they feed any seat's hunter. Festivo is a **global** aura and feeds
  every Sabbat vampire at the table, the controller's own included.
- **How much.** One blood, except Festivo, which fills to capacity.
- **What it costs the beneficiary.** Festivo's other clause takes −1 stealth off
  every Sabbat hunt, so it makes the hunts it pays for easier to block.

## 2. One clause, two windows

`permanent.huntBlood` carries `{ amount, when: "announce" | "success", sect? }`
and compiles into the location-ability enumerator twice:

- `when: "success"` → offered in `action.afterResolution` when
  `af.actionKind === "hunt"` and `af.resolvedSuccess === true`. The window opens
  on its own: the after-resolution probe asks `abilityOptionsFor`, so a new
  location clause needs no engine change to be seen.
- `when: "announce"` → offered in `action.announce`, and the payout is
  *registered* on the action frame (`ActionFrame.huntBonusBlood`, via
  `addHuntBonusBlood`) rather than paid. The hunt branch collects it. A blocked
  hunt therefore spends the lock and pays nothing, which is the card's price.

`when` is a named value, not a boolean, because the difference is not "earlier or
later" — it is what the lock buys.

**`resolvedSuccess` is optional, not nullable.** It is *absent* until the action
resolves, so the first draft's `=== null` test for "not yet resolved" was false
at every moment of the action's life and the announce option never appeared. A
field that can be `undefined` and a field that can be `null` read identically at
a glance and behave as opposites.

**"(Ignore excess blood.)" asks for nothing.** Excess always drains to the blood
bank (p. 6) — the parenthetical describes the rule rather than changing it, the
fifth time a wave has met one of those. What it *does* justify is withholding the
option from a vampire already at capacity (`docs/futile-options-design.md`).

## 3. Festivo dello Estinto: two auras and a fuse

- **−1 stealth on hunts** is a new `huntStealth`, written directly beside
  `bleedStealth` in the one place action stealth is summed. Signed, and the first
  aura in the pool that makes an action *easier* to block.
- **Fill to capacity** is `huntFill`, folded inside `huntAmountFor` rather than
  bolted onto the payout, so every reader of the hunt amount — the option label,
  `huntGain`, the AI — gets the right number without knowing this card exists. A
  fill and a "+N hunt" are two effects both saying "gains blood", so the larger
  wins.
- Reading a *boolean* aura with the sect filter meant the private helper called
  `auraBlocks` had its first positive caller, so it is now `auraFlag` with two
  named wrappers. What it answers was never "does something block" but "does a
  filtered aura set this flag for this minion".

## 4. Harvest Rites is the attached one

It is the only card of the four that lives on a vampire, and therefore the only
one that could not work at all (§5). `attachSelf.huntBonusBlood` compiles into
`onHuntSuccess`, checks the bearer *is* the hunter, latches `usedThisTurn` for
"once each turn", and reads the hunter through `findMinion` — a minion can be
gone by the time a hook fires. "A vampire can have only one Harvest Rites" is the
existing `exclusiveKey`.

## 5. What the wave found — three defects, none of them about hunting

**(a) `onHuntSuccess` was dispatched over seat permanents only.** One line below
it, `onBleedSuccess` iterates `allEntries()`. The two hooks are siblings written
at different times, and the hunt one never reached an attached card — so every
attached hunt trigger, including any crypt ability, was silently dead. This is
the `seat.permanents` lesson for the fourth time, and the tell was the same: the
loop spells out `for (const s of this.state.seats)` where its sibling calls the
helper.

**(b) Shadow Cloak has never burned itself.** `afterResolutionAttach` declares
`burnInUnlockPhase` and **nothing in `compile.ts` read it** — a spec field with
no reader. The card's printed "during your unlock phase, burn this card" simply
did not happen, so a vampire wearing it was untargetable by non-Auspex minions
for the rest of the game. That is a **partial card in the pool**, which the
binding rule forbids, and `no-partial-cards.test.ts` cannot see it: nothing fails
when a field is merely ignored. Meanwhile `attachSelf.burnAtControllerUnlock`
spells the same rule and *is* honoured. Both now call one
`burnAtControllerUnlock(handler)` helper, which is also what Festivo uses from
the seat side — three spellings, one implementation.

**(c) A location clause has to be added in TWO places.** `addLocationAbilities`
destructures every clause and then guards installation behind a long negated
list of them all. `huntBlood` was in the first list and not the second, so the
enumerator was never installed: the card compiled, typechecked, entered play,
and offered nothing. Same shape as wave 87's `targetRider` find — a second
hand-written list of the same vocabulary, where reading the first tells you
nothing about the second.

## 6. Tests

`tests/cards/hunt-payouts.test.ts` — 14 cases.

The fixture gives Alice an **anarch** and a **Sabbat** vampire, because the two
filters name different sects and one vampire could not tell a working filter from
a missing one. Both start below capacity: a full vampire is correctly offered
nothing, which looks exactly like a broken card.

Pinned: each payout, and the negative space around it — Hospital Food not offered
for a non-anarch hunter nor on a bleed; Inbase Discotek not offered at
announcement (the control for Hospital Food's timing) and offered for *Bob's*
hunter; Festivo's fill against the anarch control that still gains exactly 1; the
stealth pair (Sabbat 0, anarch 1) on the same board; the self-burn; and Harvest
Rites refused to the anarch and to a second copy. Two cases assert the pool
contains an anarch and a Sabbat vampire at all, so none of this is inert.

**Two fixture lessons worth keeping.** A hunt is inherently +1 stealth (p. 21),
so a bare blocker only *attempts* and fails — the "blocked hunt" case needed real
intercept on the blocker or it was quietly testing a successful hunt. And the
after-resolution window cannot be reached by a fixed trace: the number of
decisions before it depends on how many seats can block, and one pass too many
passes the window away, which is how the first draft "proved" an option was never
offered.

Mutation-checked, one at a time, each failing exactly one case and nothing else:
the `allEntries()` dispatch, `huntFill`, `huntStealth`, and the seat-permanent
self-burn.

Fuzz: all four added to the decks — a blocked hunt after the lock was spent, a
vampire filled to capacity (so the blood-conservation replay has to agree about
excess draining to the bank), and an aura that makes hunts blockable.

## 7. Counts

Library 821 / crypt 217 / total 1038; supported 920 / 1038.
