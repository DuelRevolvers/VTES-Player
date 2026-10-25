# Changing a vampire's votes (wave 109)

Four cards that act on a vampire's vote GROUP — the one-group rule of
`vampire-votes-design.md` §4.5. Two make it abstain, two change which way it
went, and each filters its target by age a different way, which is what the
negative-space tests tell apart.

| Card | Type | Target | Effect |
|---|---|---|---|
| Pulling Strings (101516) | Reaction, [dom] | basic: younger than the reactor; superior: any age | abstain |
| Under the Skin (102064) | Action modifier, [aus]+[pre] combo | younger than the acting vampire | abstain; superior also locks it at the end of the action if the referendum passes |
| Kindred Coercion (101049) | Reaction, [dom], X blood | X vampires, none older than the reactor | basic: abstain; superior: each may instead have its votes changed |
| Distant Friend (100559) | +1 stealth Ⓓ action, [dom]+[pre] combo | a vampire chosen at announcement | puts itself in play; burn it during a referendum to change that vampire's votes; superior can also force it to cast |

Every card carries *"cannot be used during a referendum that is automatically
passing"* [PIB 20150105] [LSJ 19980107], the existing `notWhenAutoPassing`.

## 1. Owner rulings (2026-10-24)

1. **"Votes and ballots of your choice" moves the whole group one way.** The
   card says "the votes", not "any of the votes", and §4.5 already made a
   vampire's votes one group.
2. **What moves is the vampire's own group**: title votes, votes a card gave
   that vampire (`minionVoteGrants`), and votes it bought (Mob Rule). A
   Methuselah's own card votes (`grant:<cardId>`) are separate sources
   (§4.1) and do not move.
3. **Distant Friend sits in its controller's region** and records the chosen
   vampire on the entry (`chosenMinion`). If that vampire leaves play the card
   stays, and burning it is not offered, because it would do nothing.

## 2. Readings taken

- **Changing votes also fixes the direction of votes not yet cast.**
  Kindred Coercion's ruling: superior "playable on an abstaining vampire: it
  does not force them to vote, but restricts their choice if they do"
  [RTR 19991001] [LSJ 20030828]. Distant Friend prints the same sentence, so
  it gets the same primitive; its superior's "force the vampire to cast" is
  what turns the restriction into a cast. Recorded as
  `rf.votesChangedTo[minion]`, which `voteGroup` reads before the first cast,
  so every vote source of the vampire — title, granted, bought — obeys it
  without being told.
- **Kindred Coercion's X vampires are chosen as it is played**, as
  unordered combinations (the shape Anarch Troublemaker uses), with X = the
  number chosen.
  A canceled non-action card still pays its cost (p. 16), so X blood is paid
  at the play, through a generic `xBlood` play param, not at resolution.
  What happens to each target at superior is the card's EFFECT and is asked
  at resolution, one choice frame per target: abstain, for, or against.
- **A forced cast goes through the ordinary cast path** (`castVoteInto`), so a
  vote toll (Alexander Silverson) is paid and a lock-on-vote (Disarming
  Presence) fires. It casts the vampire's group (title + granted votes), not
  bought votes — buying is a cost its controller chooses. A forced cast the
  vampire cannot pay for casts nothing.
- **Age is capacity** (p. 6), the existing reading: "younger" is strictly
  smaller; "cannot be older" is smaller or equal, so the reactor qualifies.
- **Under the Skin's "end of the action"** is the referendum's `postTally`,
  which runs after `ReferendumResolved` — the political action ended when its
  referendum did. A new `lockOnPass` rider.
- **A target with no voice is futile** and is not offered — except to Under
  the Skin superior, whose lock lands whether or not the vampire could vote.

## 3. Defects found

### 3.1 "Does this vampire have a vote?" was asked three ways

The abstain enumerator in `compile.ts` asked `title`, `minionVoteGrants` and
cast votes; Saulot's Guiding Wisdom asked `title` and `statics.votes`;
`pollingOptions` counted everything. So a titleless vampire with a referendum
rider (Cloak of Blood), an aura vote (New Carthage), a conditional static
(Neserian) or a Mob Rule offer had votes it could cast and could not be made
to abstain. One count now: `vampireVotes` in `derived.ts`, read by all three
and by the forced cast. `hasVoice` adds the cast votes and the blood offers
(`bloodVoteOfferFor`, also shared with `pollingOptions`).

### 3.2 The same reaction twice in one referendum

"A minion cannot play the same reaction card more than once during a single
action" (p. 24), and the same for action modifiers (p. 13). The record is
`af.played` on the ACTION frame, which has popped by the time its referendum
polls, so nothing was recorded or checked during polling: one vampire could
play Conflict of Interests twice. The referendum frame now carries `played`,
seeded from the action's at push and written by every play made inside the
referendum. The engine's `notPlayedTwice` filters the card options of both
referendum windows against it, so bespoke handlers (Disarming Presence,
Emissary) are covered without each remembering it.

## 4. Engine

- `derived.ts`: `vampireVotes`, `bloodVoteOfferFor`, `hasVoice`.
- `ReferendumFrame`: `votesChangedTo`, `played`; `postTally` gains
  `lockOnPass`.
- `EngineOps.changeVotes(minion, inFavor, forceCast)` and event
  `VotesChanged`. `castVoteInto` is the `castVote` apply without the impulse
  rewind.
- `putsInPlayOnSuccess(mode, params)` may return `chosenMinion`, which rides
  on `PermanentEnteredPlay` onto the entry.
- `forceAbstain` knobs: `age`, `beforeVotesCast`, `lockOnPass`,
  `xTargets`, `changeInstead`. `putInPlayOnSuccess.chooseVampire`.

## 5. Tests

`tests/cards/vote-changing.test.ts`. Each card has a positive and the
negatives its filter implies: an older vampire not offered to Pulling Strings
basic and offered at superior; a same-age vampire offered to Kindred Coercion
and not to Pulling Strings; Under the Skin not offered once a vote is cast;
no card offered during an auto-passing referendum; a changed vampire's later
cast offered one way only; the forced cast paying a toll; the same reaction
not offered twice to one vampire; and a titleless vampire with a rider vote
now abstainable.
