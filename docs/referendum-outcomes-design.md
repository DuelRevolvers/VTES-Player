# Referendum outcomes (wave 110)

Five cards that act on HOW A REFERENDUM ENDS: two charge someone when it
passes, one charges someone when it fails, one makes it fail, and one grows
with every referendum its vampire wins and sends that vampire to torpor when
one is lost. They share one question the engine could not answer before —
*what happened after the tally, and when exactly* — which is what the
negative-space tests tell apart.

| Card | Type | When played | Effect |
|---|---|---|---|
| Treachery (102014) | Reaction, [pre] | polling, before any vote | basic: on a pass, the caller's controller burns 1 pool after the effects; superior: also, on a pass, every other Methuselah who voted for it burns 1 pool at the tally |
| Poison Pill (101406) | Reaction | polling, before any vote | on a pass, the acting Methuselah loses the pool the effect cost you |
| Political Backlash (101413) | Reaction | when a referendum fails | the acting Methuselah burns 2 pool |
| Aura of Invincibility (100112) | Action modifier, 1 blood | polling, before any vote | on a pass, the card goes onto the acting vampire with a counter; +1 vote per counter on referendums it calls; +1 counter per pass; a fail burns it and sends the vampire to torpor |
| Vox Domini (102132) | Master, out-of-turn, 1 pool | polling of a political action | the referendum fails; one per Methuselah per game |

Treachery, Poison Pill, Aura and Vox Domini carry *"cannot be used during a
referendum that is automatically passing"* [PIB 20150105] [LSJ 19980107]
(Vox Domini prints it).

## 1. Owner rulings (2026-10-24)

1. **Treachery's superior burn happens only on a pass.** "As above" carries
   the inferior's "if the referendum passes". The burn is at the tally,
   before the effects [RTR 20010710].
2. **Vox Domini stops polling at once.** The referendum fails immediately;
   votes already cast stay in the record, and no more are asked for. This is
   not Yoruba Shrine's forced failure, which lets polling finish.
3. **Aura of Invincibility enters with ONE counter.** The referendum that
   puts it in play does not also trigger "add a counter when a referendum
   called by this vampire passes".
4. **Poison Pill counts only the referendum's own effect.** Pool lost to a
   post-tally rider (Treachery, Scorn of Adonis) is not "the effect of the
   referendum".

## 2. Readings taken

- **None of the five is offered during a blood hunt.** A blood hunt has no
  acting vampire for Treachery, Poison Pill, Political Backlash or Aura to
  name, and Vox Domini names "the referendum of a political action".
- **Treachery's "other Methuselahs" means other than the caller's
  controller**, so it can include the Methuselah who played Treachery. Per
  SEAT, once, however many votes they cast — read off `v.seat`, the Scorn of
  Adonis treatment, so a vampire someone else controls is charged to its
  controller.
- **A cancelled referendum is not a failure; a forced one is.** Telepathic
  Vote Counting's cancellation never resolves (§3 of
  `auctions-design.md`), so Political Backlash is not offered and an Aura is
  not burned. Vox Domini's and Yoruba Shrine's failures DO count.
- **Aura has no effect if the card left the ash heap or the vampire left
  play** before the pass [ANK 20220805]. A vampire in torpor is still in
  play, so the card still goes on it.
- **Aura's first referendum failing does nothing** — the card stays in the
  ash heap and the vampire is not sent to torpor [LSJ 20040730].
- **Aura cannot be played by a vampire that already has one**, including to
  cycle it [LSJ 20040730-2].
- **Poison Pill measures pool actually LOST.** A Methuselah on 3 pool whom
  the effect tells to burn 5 has lost 3; the mirror is 3. Gains are never
  netted against losses [ANK 20180813], and paying counts as losing
  [ANK 20180719-2] (a Jericho Founding ransom paid to keep a card is a loss
  the effect caused).
- **Each Poison Pill pays separately.** Two copies played by two of your
  vampires mirror the loss twice. The same vampire cannot play it twice in
  one referendum (`notPlayedTwice`, `vote-changing-design.md` §3.2).
- **Poison Pill still fires if the effect ousts you.** The card names the
  acting Methuselah as the payer; your being ousted does not stop it. It
  does nothing if the acting Methuselah is ousted.
- **Vox Domini is never playable on your own turn** — the out-of-turn
  budget of p. 9, through the existing `outOfTurnOpen` gate. It is not
  offered when paying its 1 pool would oust you (the Archon Investigation
  guard).
- **Political Backlash is a reaction (p. 24)**: played by a ready, unlocked
  vampire of a Methuselah other than the caller.

## 3. What the engine has to learn

### 3.1 "After the effects" is not a point in `resolveReferendum`

Treachery's inferior burns "after the referendum effects are applied,
including any oust and pool gained from it" [LSJ 20090115-2], and Poison
Pill needs the whole effect to have happened before it can measure it. Both
look like "the line after `applyReferendum`" — and they are not, because
**Ancient Influence and Reins of Power pay out only when the LAST seat
answers its `tableVampireChoice`**. `applyReferendum` raises the choices and
returns; the payout happens decisions later. A rider placed after
`applyReferendum` would charge Treachery's burn before the table is paid and
measure Poison Pill's loss as zero.

The same gap already exists for the `onReferendumPassed` sweep (Guru gains
its blood "after the referendum effects are applied", the same ruling). It
is unobservable for Guru today — blood cannot change a pool payout — which
is why nothing noticed. It becomes observable the moment a hook moves pool.

### 3.2 The fail side has no window

The after-resolution impulse opens only on a pass
(`referendum-margin-design.md` §2). Political Backlash needs its mirror.

### 3.3 The auto-pass guard is spelled three ways — and cannot fire in polling

`compile.ts` (`forceAbstain`), `beforeVotesCaller` and Distant Friend each
test `ref.autoPass` inside the polling window. `settle` skips polling when
`autoPass` is set, so as far as the loop shows, no polling option is ever
enumerated on an auto-passing referendum: the rulings are honoured
STRUCTURALLY. The guards stay (they are defensive and correct), but the new
cards should not add a fourth spelling — one helper, and a test per card
that proves the referendum resolved with no polling decision rather than
asserting an empty list.

## 4. Engine

1. **The referendum effect scope.** On a pass, before `applyReferendum`,
   `resolveReferendum` opens `state.referendumEffect = { actionId,
   callerSeat, depth, lost, riders }` (plain data, so it serializes). `depth`
   is the frame-stack length after the referendum pops. `emit` adds each
   `PoolBurned`'s ACTUAL decrease (pool before minus pool after) to
   `lost[seat]` while the scope is open. `settle` closes it at the top of
   its loop once the stack is back to `depth` — immediately for a
   synchronous effect, after the last choice for Ancient Influence. At
   close, in this order:
   1. the existing `onReferendumPassed` sweep (moved here from
      `resolveReferendum`; same order as today for every synchronous
      effect);
   2. the riders, in the order they were played: `mirrorPoolLoss` (Poison
      Pill), `burnCallerPool` (Treachery), `attachFromAshHeap` (Aura).

   Running the sweep BEFORE the Aura rider is what gives ruling 3: an Aura
   that is not on the vampire yet cannot count the pass that puts it there.
   A test pins the order.
2. **Riders travel on the frame.** A new `rf.afterEffects` list beside
   `rf.postTally`, copied into the scope when it opens. Not `postTally`:
   that list runs at the tally, before the effect, which is right for
   Treachery's superior and wrong for everything in item 1.
3. **One new `postTally` kind**: `burnVotedForOnPass { amount, exceptSeat }`
   (Treachery superior) — per seat, once, skipping the caller's seat and
   ousted seats, only if `passed`.
4. **The fail window.** The after-resolution step opens on a fail as well
   as a pass, still only when some seat can use it; the window id stays
   `referendum.afterResolution`. A new `UsabilityRule`,
   `whenReferendumFails`, sits beside `afterReferendumPassed`, and each
   rule checks its OWN outcome (the existing branch already refuses
   `passed !== true`). Before building, I'll re-check every handler and
   ability that opts into this window for the same guard — the "re-read
   the siblings" lesson.
5. **Polling that ends early.** `rf.pollingEnded` — `settle` resolves the
   referendum when the cycle is quiescent OR polling has ended. Vox Domini
   sets it together with the existing `failReferendum()`, so the tally
   still runs (with the votes already cast) and comes out failed. A
   title-granting card still burns, as for Yoruba Shrine (p. 27).
6. **Aura's votes.** `votesWhenCalling` gains `perCounter`, read where
   `vampireVotes` already adds caller-only votes — the one vote count, so
   abstain gates and the AI see it for free.
7. **Aura's life cycle.** Its handler uses three existing hooks:
   `onReferendumPassed` (+1 counter when its bearer called it),
   `onReferendumLost` with `how === "failed"` (burn the card, send the
   bearer to torpor), and the play gate (no Aura already attached). The
   move from the ash heap reuses `CardTakenFromAshHeap` and the existing
   attach path.
8. **Vox Domini** is a bespoke handler beside Archon Investigation:
   `isOutOfTurnMaster`, `outOfTurnOpen`, the `referendum.polling` window,
   not a blood hunt, and once per game PER SEAT — an event-log query like
   `oncePerGameByName` filtered to the seat, so there is nothing to latch or
   serialize.
9. **One "before any votes" helper** for the polling gate, used by the new
   cards and by the three existing sites (§3.3).

## 5. Tests

Each card asserts its positive case and the cases that tell it apart from
its neighbours:

- **Treachery:** basic burns the caller 1 on a pass and nothing on a fail;
  with Ancient Influence the burn lands AFTER the last choice (event order);
  superior burns each other yes-voting seat once, BEFORE the effect, and
  nothing on a fail (ruling 1); the reactor's own seat burns if it voted
  for; not offered once a vote is cast, to the caller's seat, or in a blood
  hunt.
- **Poison Pill:** mirrors a plain burn; with Ancient Influence mirrors the
  5 burned, not the net (ANK 20180813); mirrors only what was actually lost
  when the burn ousts you; mirrors nothing on a fail, on a gain-only effect,
  or for Treachery's burn (ruling 4); two copies pay twice.
- **Political Backlash:** offered on a fail, never on a pass; offered after
  Vox Domini and Yoruba Shrine; not after a cancellation, to the caller, or
  in a blood hunt.
- **Aura of Invincibility:** a pass attaches it with exactly 1 counter
  (ruling 3); +1 vote per counter on a referendum its bearer calls and none
  on another's; a later pass adds a counter; a later fail burns it and
  sends the bearer to torpor; a cancellation does neither; the first
  referendum failing leaves it in the ash heap; taken from the ash heap
  before the pass, it does nothing; not offered to a vampire that has one.
- **Vox Domini:** fails at once, keeps the cast votes, asks for no more
  (ruling 2); burns a title card; one per seat per game, while another seat
  can still play theirs; not on your own turn, in a blood hunt, or at 1
  pool.
- **Auto-pass:** for each of the four, a referendum that passes
  automatically resolves with no polling decision at all, with the card in
  hand and a legal player on the table.

Then the fuzz decks, `npm run simulate`, and `npm run simulate:politics`.

## 6. As built (0.11.50)

The owner approved §4 and the six open points as written. What differs
from the plan, or was found while building:

- **The scope is `state.referendumAftermath`**, not `referendumEffect`: that
  name is already a `CardSpec` field (which way a referendum moves pool).
- **The close processes ousts first.** Ousts are otherwise processed only
  when the turn frame surfaces, which is after the close, and the Treachery
  ruling says "including any oust".
- **The close runs after settle's sweeps** (depleted allies, capacity,
  contests, the torpor window), so a window one of them opens counts as part
  of the effect.
- **`pollingEnded` only short-circuits the POLLING step.** Without that
  guard, a Vox Domini failure that opened the fail window would have skipped
  that window's own impulse.
- **Defect: the before-votes rule was missing on three cards.** Elder
  Kindred Network, Bribes and Malkavian Rider Clause were offered after a
  vote. The spec rule `beforeVotesCast` now covers them, through
  `referendumOpenToPlay`.
- **Two pass-side abilities needed their own `passed` test** once the
  window opened on a fail: Privileged Position (`afterReferendumBurn`) and
  the archetype "unlock after a referendum called by them passes". The
  cards' own play rule (`afterReferendumPassed`), Absolution of the
  Diabolist and Lay Low already checked it.
- **The caller riders are refused when there is no calling vampire**
  (`NEEDS_CALLING_VAMPIRE`). Before that, Treachery's superior half was
  playable in a blood hunt and would have burned yes-voters on a pass.
- **The blood-hunt and Yoruba Shrine cases were tested in 0.11.51, and the
  Shrine test found two defects.** The blood hunt was fine: none of the
  four caller riders is offered, with a political-action control offering
  all of them from the same hands. Yoruba Shrine was not:
  - **An ability used in polling did not hand the impulse back (p. 8).**
    `useAbility` rewound the cycle for actions, block attempts, card plays
    and some combat steps, but not for a referendum, oust or torpor frame.
    So a caller who had passed stayed passed, and polling ended without
    their vote. All three now rewind. The Black Throne's test had pinned the
    old order and was corrected.
  - **The Shrine never unlocked the calling vampire.** Its `useAbility`
    looked only for an action frame, and the political action has left the
    stack before polling begins. In polling, "the acting minion" is
    `callingMinion` now.
