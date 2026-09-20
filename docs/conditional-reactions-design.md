# Conditional reactions

Wave 84 (2026-09-20). Steadfastness (101864), Sonar (101824),
Dread Gaze (100586).

Three **reactions**, each conditioned on *what* is being answered: two on an
action directed at you, one on a referendum. Every primitive already existed —
`modifyIntercept`, a negative `modifyBleed`, `modifyVotes`, and the
`actionDirectedAtYou` gate — so the cards cost almost nothing and the wave's
content is the fixtures, one new deferral, and an engine defect the fuzz found.

---

## §1 — What each card is

| Card | Basic | Superior |
| --- | --- | --- |
| Steadfastness | +1 intercept, **directed action only** | reduce a bleed against you by 1 |
| Sonar | +1 intercept, **directed only** | +1 intercept, any action |
| Dread Gaze | reacting vampire gains **2 votes** | 4 votes |

**Five of the nine candidate reactions are INERT** and stayed out: Covincraft
needs a Kiasyd, Truth in Ink and Watch Commander a Black Hand vampire,
Their Master's Voice a Gargoyle, Mistaken Identity a Ventrue antitribu. The pool
has none of those — checked against the crypt rather than assumed.

The gate already existed under the name `actionDirectedAtYou` (The Warrens, Eyes
of Argus). Inventing `onlyDirectedAtYou` and then finding the real one is the
cheap version of the standing lesson: **grep for the existing name before adding
a synonym.**

## §2 — Two answers to the same question

Steadfastness and Sonar both put +1 intercept on a directed action, and the pair
is what makes each testable:

- **Sonar's superior drops the directed gate**, so a HUNT — undirected (p. 25),
  and carrying +1 inherent stealth so intercept is genuinely needed — separates
  the two conditions cleanly. On that board Sonar's superior is offered and its
  basic is not.
- **Steadfastness's superior is not an intercept card at all.** It reduces the
  bleed instead, which is why the negative for "no intercept needed" has to name
  `play:Steadfastness:basic` and not the card: the superior is legitimately on
  the table there, and a card-wide negative passed for the wrong reason until it
  was narrowed.

## §3 — A deferral with a new clock

> "Do not replace until after the current turn." (Sonar)

Every existing deferral hangs off a frame the player owns or an event
(`unlock`, `discard`, `afterCombat`, `afterAction`, `whileInPlay`). A **reaction
is played on somebody else's turn**, so "the current turn" is *that* turn — not
the reacting seat's own discard phase, which `delayedDrawsDiscard` waits for and
which is a whole round later.

So `delayedReplace: "turn"` holds the debt on the running turn frame and it is
paid where the turn ends, beside the hand-size expiry. Asserted both ways: still
owed while the turn runs, paid once it ends.

## §4 — The fixtures were the work

Intercept is only offered **when needed** (p. 26) and stealth is only offered
**during a live block attempt** — both gated on the same thing. So the only way
to make an intercept card offerable on a *directed* action is the real
back-and-forth: bleed, block declared, stealth added, and *then* the blocker may
answer. A bare bleed is 0 stealth against 0 intercept and the card correctly
never appears.

Six of nine assertions failed first time, all from counting impulses. Everything
is now driven by a **walker** that passes until the option appears:

```ts
function offeredTo(engine, prefix, limit = 24): string | null
```

That is wave 83's lesson applied before it had to be relearned: the number of
impulses between a block attempt and the blocker's own window is not a constant,
and a counted trace one step short reports "not offered" for a card that is.

## §5 — What the fuzz found: two blood-vote offers collide

Adding the three cards to the fuzz decks turned seed 6 red with a **duplicate
option id**: `vote:blood:Ae:for`, twice, in `referendum.polling`.

The enumerator loops `for (const offer of rf.bloodVoteOffers)` and, inside,
every qualifying minion. **Two cards can each install an offer** (Mob Rule and
Rant!), and a vampire qualifying under both was enumerated twice under one id.
Nothing before this wave dealt both cards to the same table.

The fix puts the offer's **index in the option id** and deliberately leaves
`source` as `blood:<minion>`, because `source` is the bookkeeping key that
`bloodVotesBought` and each offer's `maxBloodPerMinion` are counted against —
widening it would have made those caps silently stop matching, which is the
"a field that exists at two levels needs its READER checked" lesson.

**A rules question left for the owner rather than decided here:** with two
offers in play, may a vampire buy votes under *both* (two blood, two lots of
votes), or is the permission shared? The fix offers both options, which is the
conservative reading — it does not collapse two separate permissions into one —
but `maxBloodPerMinion` is tracked per minion, so a per-offer cap is shared
today. Worth a ruling before a card makes the difference matter.
