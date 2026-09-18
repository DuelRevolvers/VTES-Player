# First strike

An engine mechanic, not a card wave. Built 2026-09-12 (v0.10.14) after
wave 28 found that **first strike was not modelled at all** — nothing in
the engine sequenced one side's strike ahead of the other, and 23 cards
(17 library, 6 crypt) print it.

No supported card printed it, so nothing in the pool was wrong; the
mechanic was simply missing, and every card that needs it was blocked.

## The rule (p. 33)

Read from the rulebook PDF. The extractor drops some italic runs, so the
bracketed words below are the gaps — the surviving text is verbatim:

> **First Strike:** […] *resolved before a* ***normal strike***. Thus, if
> the opposing minion is burned or sent to torpor […] will not be
> resolved at all. If the opposing minion was striking with a weapon that
> is stolen […] the oppos-ing minion simply loses their strike
> altogether. […] strikes are resolved simultaneously. A strike […]
> before a ***combat ends*** effect (which always […] ***dodge*** still
> works against […]

Four operative clauses, all built:

1. A first strike resolves **before** a normal one.
2. If its victim is **burned or sent to torpor**, the victim's strike is
   not resolved at all.
3. If **both** sides have it, the strikes resolve **simultaneously** —
   the same code path as neither having it.
4. A **dodge** still works against one.

**One clause is NOT resolved and needs the owner's eye.** The sentence
about combat-ends ordering is exactly where the extraction lost words:
"A strike […] before a **combat ends** effect (which always […]". It
could read "…is still resolved *after* a combat ends effect (which always
resolves first)" or the reverse. The engine already resolves combat-ends
strikes first of all, with a comment citing the same page, and **that
behaviour is unchanged here** — the first-strike split is skipped
entirely when either strike ends combat. If the printed sentence turns
out to say the opposite, it is a one-line change at that guard.

## §1 — Three sources, one question

`hasFirstStrike(cf, side)` folds:

- **the strike declaration** (`Strike.firstStrike`) — "Strike: hand strike
  with first strike" (Quick Jab);
- **a static on the striking minion** (`PermanentStatics.firstStrike`) —
  "strikes with first strike" (Muddled Vampire Hunter);
- **a round-scoped grant** (`CombatFrame.firstStrikeRound`) — "that
  minion's initial strike this round gets first strike" (Haymaker,
  Forearm Block's next-round clause), set by `ops.grantFirstStrike(side)`
  and cleared with the round's other riders.

Folded in one place for the reason `strikesUndodgeable` already is: a
minion strikes by hand, by weapon, or by a granted strike, and a flag
that every construction site has to remember is one a new site forgets.
The static is read with `findMinion` — a combatant can leave play between
choosing a strike and resolving it.

## §2 — Splitting the round in two

`resolveStrikes` gained a `phase`:

| phase | what resolves | the round's tail |
|---|---|---|
| `"both"` | both sides (also when both have first strike) | yes |
| `"first"` | the first-striking side only | **no** |
| `"second"` | the other side | yes |

"The tail" is the additional-strike bookkeeping, retainer output and
"each round" damage. It is deliberately skipped in `"first"`: every one
of those is *each round*, not *each strike*, and the round is not over.

The second half is picked up in the **damage-resolution drain**, when the
first strike's damage has finished and `pendingDamage` is empty. That is
the earliest moment the engine can answer clause 2 — whether the second
striker is still there. `combatantReady` decides; if they are not, the
strike is simply lost and the checks already sitting below end the round
exactly as they do for any combatant who is no longer ready (p. 30).

The other side's `Strike` stays on the frame throughout, so `inflict`
still reads it — which is how clause 4 works for free: a dodge declared
by the victim cancels the first strike's effects on them.

## §3 — What is not built

**"If the opposing minion was striking with a weapon that is stolen [or
destroyed], they simply lose their strike altogether."** The ordering is
right — a steal or destroy-equipment first strike resolves before the
victim's strike — but the victim currently strikes anyway, with a weapon
they no longer hold. Nothing in the pool can reach it today: it needs a
strike that steals or burns equipment *and* first strike on the same
minion. Recorded here rather than silently left out.

## Tests

`tests/engine/first-strike.test.ts`, 5 tests, and the second one is the
control that makes the rest mean anything: the same fixture with no first
strike trades blows, so the first test is a test of ordering and not of a
minion with 1 blood. Both-sides and dodge each get a case, and the
round-scoped grant is exercised separately from the static so a single
source cannot carry all three.

## What this unblocks

17 library cards and 6 crypt cards, among them **Quick Jab, Haymaker and
Forearm Block** (deferred by wave 28) and **Muddled Vampire Hunter**.
Quick Jab additionally wants a damage cap ("ignore the excess"); Haymaker
wants its own "not usable if this minion played a Haymaker last round".
They are a card wave, not this.
