# A vampire's votes are one group — design (wave 108)

**Status: BUILT in 0.11.48.** Approved on October 24, 2026. The owner took
the recommendation on all four questions in §7. Tests:
`tests/cards/vampire-votes.test.ts`.

This wave makes the engine record which vampire owns and casts each vote.
That fixes a live p. 28 deviation that touches 39 implemented cards, plus 5
more if Q3 is approved. It also lets four library cards in: Traditionalist,
Tribunal Judgment, Emissary and Disarming Presence.

It reverses `polling-votes-design.md` §3 and its §7 Q1, which pooled
card-granted votes per seat. That question was asked as accounting ("the
tally is identical"), which is the trap the CLAUDE.md lesson describes. The
tally is identical. Who may cast the votes, and which way, isn't.

## 1. Rulebook facts

The rules below are paraphrased. Read the PDF for the exact wording.

- **p. 28, Gaining Votes:** a Methuselah may cast some votes for and some
  against, but every vote and ballot from one vampire, or from one other
  source, is cast the same way as a group. A cast vote can't be changed.
  Nobody has to cast anything.
- **p. 28, Titled Vampires:** a minion's votes and ballots can be used only
  while that minion is ready.
- **p. 46, FAQ:** the vote from burning a political action card is the
  Methuselah's, not the acting vampire's. The Edge's vote works the same way.
- **p. 47, Bewitching Oration:** the votes the card gives are the vampire's.
  They are cast when you cast that vampire's votes, together with its own.
  The ruling gives avoiding a Scalpel Tongue as a reason to wait, so a
  vampire forced to abstain loses its gained votes too.

## 2. What the engine does today

`pollingOptions` (`engine.ts`) offers these vote sources:

| Source | Whose | Notes |
| --- | --- | --- |
| `<minion>` | The vampire | Title, attached-card votes, statics, riders |
| `blood:<minion>` | The vampire | Mob Rule and Rant!: each purchase casts on the spot |
| `grant`, `grantFor`, `grantAgainst` | The seat | Every card-granted vote, pooled |
| `edge`, `caller`, `card:<id>` | The seat | Correct today (p. 46) |

Every card-granted vote lands in the seat's bucket. That has five
consequences, all of them rules errors:

1. **A seat can split one vampire's votes.** A prince can cast its 2 title
   votes for and its Bewitching Oration votes against (p. 28).
2. **Granted votes outlive the vampire's readiness.** A vampire that goes to
   torpor during polling still has its Dread Gaze votes cast (p. 28).
3. **Granted votes ignore every bar on the vampire.** These bars all skip the
   seat bucket: forced abstention (Scalpel Tongue, Telepathic Vote Counting),
   Detection, Expulsion, The Hunt Club, Closed Session's sect restriction and
   Investiture's sect ban. `ballots-design.md` and a comment in
   `pollingOptions` call granted votes "Methuselah sources". For these cards
   they are not.
4. **Mob Rule's bought votes go either way.** They're cast apart from the same
   vampire's title votes, and abstaining doesn't un-cast them, because
   `forceAbstain` matches `source === minion`.
5. **Methuselah sources are over-pooled.** Ventrue Headquarters and The Black
   Throne share the one `grant:<seat>` bucket, so they must be cast together.
   p. 28 makes each card its own source.

Beneath all five sits a missing reader: **nothing records which vampire
cast a vote.** That is why Traditionalist was left out of wave 107
(`archetypes-design.md` §7.3).

## 3. Which cards change

This list comes from each card's text in `data/vtes-raw.json`.

**The vampire's votes.** These cards move from the seat bucket into the
vampire's group:

| Kind | Cards | Whose votes |
| --- | --- | --- |
| Action modifier | Bewitching Oration, Iron Glare, Old Friends (superior), Ominous Chorus, Party Out Of Bounds (votes mode), Perfect Paragon, Absolute Tyranny (basic clause) | The acting vampire |
| Reaction | Dread Gaze, Surprise Influence, Protected District (against only) | The reacting vampire |
| Crypt ability | Alexa Draper (G6), Yewon Ong (G6) | That vampire |
| In play, one vampire | Alamut (a vampire you control), Dead Pool (a Lasombra you control), Powerbase: Madrid (a titled Sabbat vampire) | The chosen vampire |
| In play, many vampires | Elysium: The Palace of Versailles (each titled Camarilla vampire you control), Power Structure (each Lasombra you control) | Each one |
| Referendum rider | The 8 Justicars and the 11 Praxis Seizures with a clan rider (each vampire of that clan), Investiture (each cardinal) | Each one |
| Blood for votes | Mob Rule, Rant! | The buying vampire |

**The Methuselah's votes.** These stay seat sources, keyed by card (Q3):
Ferraille, Oxford University, England, Ventrue Headquarters, The Black
Throne and The Mausoleum, Venice. The Edge, the calling card and a burned
political action card don't change.

**A defect found while classifying.** Powerbase: Madrid gives its votes to
"a titled Sabbat vampire", with no "you control". The handler only checks
that you control one, and then credits your seat. It now chooses the
vampire, which may be a rival's. The votes then belong to that vampire and
its controller casts them. Card text wins (p. 16).

## 4. Kernel shape

### 4.1 Grants carry an owner

`grantVotes(seat, amount, direction, minion?)` keeps its signature and gains
an optional `minion`:

- **With a `minion`:** it credits `rf.minionVoteGrants[minion]`, an
  `{ any, for, against }` record like the seat one.
- **Without a `minion`:** it credits a seat source keyed by the granting
  card (Q3).

The `modifyVotes` compile site passes `play.minion`. The five in-play cards
choose their vampire, so each one is offered as its own option. Elysium and
Power Structure credit each vampire 1 vote, instead of crediting the seat
`n`.

### 4.2 Riders become per-vampire filters

The each-clan and each-cardinal riders stop seeding `voteGrants` when the
frame is pushed. Instead, `extraVotes` gains `clan?` and `title?` filters,
and each rider adds one entry. That entry is read when votes are counted,
so a vampire that goes to torpor in polling loses the vote. This is the
path Cloak of Blood already takes (`torpor-prey-design.md` §4).

### 4.3 One count per vampire

`pollingOptions` adds the vampire's `any` grants into its total. It adds the
directed grants through the existing per-direction `bonus`, the path Jason
Newberry uses. Every bar already in that loop then applies to granted
votes too. For example, a vampire with 2 title votes and Protected District
is offered 2 for or 5 against. A Sabbat vampire with Dread Gaze casts
nothing under Closed Session.

### 4.4 Each vote records its vampire

Each `rf.votes` entry and the `VoteCast` event gain `minion: MinionId |
null`:

- **Set to the vampire:** title, granted and bought votes.
- **Null:** the Edge, the calling card, a burned card and seat grants.

`forceAbstain` un-casts by `minion` instead of by `source`, so it takes
bought votes as well (§2, item 4).

### 4.5 The group binds once it casts

A vampire's direction is the direction of its first entry in `rf.votes`.
After that first cast, the following rules apply:

- The vampire's remaining votes are its current total minus what it has
  already cast, clamped at zero. They're offered in that direction only,
  under the same `vote:<minion>:<dir>` id (Q1).
- Mob Rule purchases are offered in that direction only (Q2).
- This replaces `usedSources.includes(m.id)` for vampires. A per-referendum
  vote modifier still reaches only uncast votes, as
  `path-cards-design.md` §4 requires.

### 4.6 A referendum leaves a record

At the tally, `GameState.lastReferendum` becomes `{ turnNumber,
votesByMinion }`. Tribunal Judgment reads it. Each seat also keeps the turn
number its previous turn began, so "since your last turn" can be checked
[LSJ 20020429]. Whether a cancelled referendum leaves a record is Q4.

### 4.7 Two new readers

- **`votedAgainst`:** the `onReferendumLost` info gains `votedAgainst:
  MinionId[]`, derived from `rf.votes`.
- **`rf.lockOnVote`:** an optional `{ exceptSeat?: SeatId }`, applied where a
  vote with a `minion` is cast.

## 5. The wave (4 cards)

| Card | Type | Tranche | What it needs |
| --- | --- | --- | --- |
| Traditionalist (102005) | Master: archetype, trifle | T1 | `votedAgainst` |
| Tribunal Judgment (102022) | Political action, requires a Sabbat vampire | T1 | `lastReferendum` |
| Emissary (100638) | Action modifier, requires a ready baron | T1 | A vampire grant and the abstain path |
| Disarming Presence (100550) | Action modifier, Presence | T2 | `lockOnVote` |

- **Traditionalist:** it pays 1 blood, once per turn, when its vampire is in
  `votedAgainst` and the referendum fails. A forced fail (Yoruba Shrine)
  counts. A cancelled referendum doesn't, because it never resolves
  (`crypt-wave-6.md` §3).
- **Tribunal Judgment:** the terms choose a vampire with an entry in
  `lastReferendum`, recorded since the caller's previous turn. The card
  can't be played when no vampire qualifies [LSJ 20100129]. On a pass, that
  vampire takes X damage through the outside-combat damage path, where X is
  its recorded count.
- **Emissary:** the requirement reads as "you control a ready baron", the
  `requiresControlledTitle` reading from `ballots-design.md`. The card
  counts as requiring an anarch [LSJ 20080603]. It's playable only before
  votes are cast, and never in a referendum that passes automatically
  [PIB 20150105]. It locks a ready unlocked anarch you control and gives that
  anarch 3 votes. Then any ready unlocked Camarilla vampire older than the
  anarch, under any controller, can lock to cancel the anarch's votes.
  "Cancel its votes and ballots" is the abstain cards' own phrase, so it
  takes the `forceAbstain` reading: un-cast and barred
  (`abstain-gate-design.md`).
- **Disarming Presence:** it's playable only before votes are cast, and never
  in a referendum that passes automatically. At basic, every vampire that
  casts a vote is locked as it casts [RTR 19970425]. At superior, your own
  vampires are exempt. Locking is a side effect, so a locked vampire can
  still vote [RTR 19941109].

### 5.1 Deferred

- **Kindred Coercion and Distant Friend:** both change a vampire's cast
  votes to the other direction. **Built in wave 109** with Pulling Strings
  and Under the Skin (`vote-changing-design.md`).
- **Confusion of the Eye:** still deferred. Its basic level reduces a bleed
  and shares no mechanic with the abstain cards.
- **Knotted Cord:** it requires an infernal vampire, and the V5 crypt has
  none. It would be inert (§0).

## 6. Tests

- **Existing tests:** expect churn wherever a test casts `vote:grant:*` for
  a vampire card. Each one moves to `vote:<minion>:*`. This is the reversal
  doing its job, not a regression.
- **Negative space, p. 28:** after a vampire casts for, it isn't offered
  against for any later grant or purchase.
- **Negative space, readiness:** a vampire sent to torpor in polling offers
  no granted votes.
- **Negative space, bars:** Closed Session, Detection and forced abstention
  each stop a vampire's granted votes.
- **Abstain:** Scalpel Tongue un-casts a vampire's bought and granted votes.
- **Each new card:** a positive case and its negative pair, such as
  Traditionalist on a failed referendum, a passed one and a cancelled one.
- **Fuzz:** add the four cards to the fuzz decks, plus Mob Rule if it isn't
  there, so the group rule is exercised.

## 7. Questions for the owner

**ANSWERED 2026-10-24: the recommendation, on all four.**

1. **Votes a vampire gains after it casts.** Alice's prince calls a
   referendum and casts its 2 votes for. Alice then plays Iron Glare on it,
   which gives it +2 votes. **Recommendation:** the 2 new votes can be
   cast, for only. They join a group that has already gone for, and nobody
   has to cast them (p. 28). The alternative is that they're lost.
2. **Mob Rule and Rant! votes.** Bob's vampire buys 2 votes against with
   Mob Rule, then wants to cast its 1 primogen vote for. Today the engine
   allows that split. **Recommendation:** refuse it. They're all that
   vampire's votes, so its title vote is offered against only (p. 28).
3. **Methuselah sources.** Should Ventrue Headquarters and The Black Throne
   become separate sources that can be cast different ways? p. 28 names
   "other source" alongside "vampire". **Recommendation:** yes, keyed by the
   granting card.
4. **Tribunal Judgment and a cancelled referendum.** Telepathic Vote
   Counting can cancel a referendum after votes have been cast. Is that the
   "most recent referendum"? **Recommendation:** no. Only a referendum that
   reaches its tally leaves a record, because X counts the votes cast and a
   cancelled referendum is never tallied.
