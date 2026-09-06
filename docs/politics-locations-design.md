# Locations that buy votes

*Elysium: The Palace of Versailles (100632), Ferraille (100722), New
Carthage (101277), Día de los Muertos (100541), Black Forest Base
(100165).*

## 1. The cluster

Master is joint-largest of the unsupported families, and the group inside
it with a shape is the one that reaches into a referendum. Four of the
five put votes on the table; the fifth skips the vote entirely.

| Card | What it does to a referendum |
|---|---|
| Elysium: The Palace of Versailles | lock during polling → **each titled Camarilla you control** gets +1 vote |
| Ferraille | once each turn, **burn 1 pool → +3 votes** during polling of **any** referendum |
| New Carthage | a passive, **global** vote static: titled Brujah +1, Ventrue −1 |
| Día de los Muertos | the first referendum a Sabbat you control calls this turn **passes automatically** |
| Black Forest Base | grants a **political action** whose referendum pays its caller 2 pool |

## 2. New Carthage retires a deferral that had already expired

`docs/politics-followups-design.md` deferred it because it "modifies the
vote value of vampires regardless of controller, a global-tally hook not
yet present", and `docs/polling-votes-design.md` listed it under
"per-minion vote counting; follow-up". Both were written when granted
votes were pooled **per seat**.

They are not any more. `pollingOptions` walks each ready minion and offers
`TITLE_VOTES[title] + Σ attached statics.votes` as one vote source — a
per-minion count, built for Saulot's Guiding Wisdom. So a global vote
static is one term added to that sum:

```ts
const auraVotes = auraBonus(state, m, "votes");
const votes = Math.max(0, titleVotes + cardVotes + auraVotes);
```

**A deferral is a claim about the code as it was.** This is the Touch of
Valeren lesson again — that queue entry said the card needed
"minion-targeted action cards from hand", plumbing that already existed.
Check a deferral against the code before designing against it.

Two details the card forces:

- **`PermanentAura.titledOnly`** — "**Titled** Brujah get +1 bleed and +1
  vote", so the aura must not turn an untitled Brujah into a vote source.
- **Clamped at zero.** "Ventrue get −1 vote" takes a primogen to 0, and a
  minion with no votes is not a vote source; it must never become a
  *negative* one, which would let an opponent's Ventrue subtract from a
  tally they never joined.

**`PermanentInPlay.auras`** is new, and only because New Carthage prints
**two** aura clauses with different clan filters and `entry.aura` is a
single object. `auraBonus` reads the singular field and the list, so every
existing card is untouched; migrating `aura` to `auras` outright would
have rewritten an event, an applier and a dozen specs to serve one card.

## 3. Two more knobs on `lockGrant`, both small

- **`titled`** — Elysium's "each **titled** Camarilla vampire you
  control", filtered beside the existing `clan`/`sect`/`minCapacity`. The
  `perClanMinion` counting Power Structure introduced does the rest.
- **`poolCost` + `oncePerTurn` + the existing `noLock`** — Ferraille says
  "Once each turn, you can **burn 1 pool** to get +3 votes", which is not
  Oxford University's `perPoolX` (burn X for 2X) but a fixed price, and it
  never locks. `oncePerTurn` reads `PermanentInPlay.usedThisTurn`, already
  cleared on `TurnBegan` for the archetypes.

Ferraille's votes are for **any** referendum, which needs no flag: the
`grant: "votes"` branch never asked who called it.

**Precedent applied, not re-litigated:** Ferraille carries a Ministry clan
tag and takes **no** `requiresClan`. A clan tag on a Master is thematic —
it has no acting minion to gate — which is the reading Ravnos Carnival,
Black Market Cache and Fleshforge Chamber already settled.

## 4. Día de los Muertos: a referendum that skips its own polling step

> "Only one Día de los Muertos can be played in a game. The first
> referendum a Sabbat vampire you control calls on this turn passes
> automatically (skip the polling step)."

Three separate clauses, and each has a precedent:

- **Game-wide uniqueness needs no state** — `eventLog.some(ev => ev.type
  === "CardPlayed" && ev.name === …)`, the Week of Nightmares/Open War
  reading. Stricter than "one in play", which is right: this card never
  enters play at all.
- **"On this turn"** is `SeatState.autoPassReferendum`, cleared on
  `TurnBegan` beside `stealthCharges` and `superiorPlaysThisTurn`.
- **"The FIRST referendum"** is consumed where the frame is built, so a
  second referendum the same turn polls normally.

**`ReferendumFrame.autoPass`** is set at push time — only when the caller
holds the flag **and the calling minion is Sabbat** — and read in
`settle`: terms are still chosen (the card says "skip the **polling**
step", not "skip the terms"), and then the tally is written directly
(0 for, 0 against, margin 0, passed) and `resolveReferendum` runs.

**Reading on record: the margin is 0.** No votes were cast, so "each vote
by which the referendum passed" (Voter Captivation, Amici Noctis) is
nothing. Those cards still get their after-referendum window, because it
opens on a pass and this is a pass; they simply have nothing to
distribute. Writing a fictional margin would be inventing votes the card
never mentions.

## 5. Black Forest Base: a granted political action that is not a burn

The `vulnerableTo.via: "politicalAction"` path built in
`docs/pool-drain-design.md` is specifically "vampires can call a
referendum **to burn this card**". Black Forest Base grants a political
action with an ordinary payout — "a Sabbat vampire can call a referendum
to have their controller gain 2 pool as a +1 stealth political action" —
so it gets its own clause, `permanent.politicalGrant`, which reuses every
piece the burn version proved out: `announceEntryAction` with
`political: true` (one per vampire per turn, p. 24, undirected so anyone
may block) and `referendumSource` with `fromCardInPlay`, which is how a
card in play tells its own referendums apart.

"Their controller" is `rf.caller`: the Sabbat vampire is the acting
minion, so its controller is the acting seat.

**The changeling clause enumerates nothing, and that is correct.**
"Changeling allies can burn this location as a +1 stealth Ⓓ action" is an
ordinary `vulnerableTo`, filtered by a new `who.tag` matched against the
minion's own attached card tags — and **the V5 pool contains no changeling
allies**: a survey found Black Forest Base is the only card in all 661
that says the word. This is the Wall Street Night precedent (its
investment clause names a card type the pool does not contain): the clause
is written, it is honest, and it offers nothing today.

## 6. Rulebook citations

- p. 10 — only vampires call political actions.
- p. 24 — a political action is undirected and +1 stealth; one per vampire
  per turn.
- p. 27–28 — the referendum: terms, then polling, then the tally; more for
  than against passes, ties fail.
- p. 28 — vote sources: titles, the Edge, the calling card, one burned
  political action card per Methuselah.

## 7. Readings on record

1. **An auto-passed referendum has margin 0** (§4).
2. **A negative vote static clamps at zero**, never below (§2) — the card
   subtracts a Ventrue's votes, it does not hand their opponents any.
3. **Terms are still chosen for an auto-passed referendum.** The card says
   "skip the polling step" and names nothing else; the terms are what the
   referendum *does*, and a referendum that passed with no terms chosen
   would do nothing at all.
