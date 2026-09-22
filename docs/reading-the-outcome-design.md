# Reading the outcome

Wave 85 (2026-09-21). Innocent Bystander (100987), Burnt Offerings (100272),
Zephyr (102205).

Three cards played **after an action resolves**, each gating on how it went: a
bleed that succeeded (read from *both* sides of the table) and an action that
failed. The window existed; what each card adds is the condition — and two of
them found machinery that only worked for one seat.

---

## §1 — What each card is

| Card | Condition | Payoff |
| --- | --- | --- |
| Innocent Bystander | its own bleed **succeeded** | remove the top card of the bled Methuselah's **crypt** from the game |
| Burnt Offerings (1 blood) | +1 intercept / your **predator's** bleed on you succeeded | the predator burns 1 pool |
| Zephyr | the action **failed** | unlock the actor at end of turn / now |

## §2 — Two rules that were welded to one card each

**The after-resolution window could only be opened by the ACTING seat.**
`afterResolutionByActor` was the only rule that opened it, and the enumerator's
gate read exactly that rule — so a reaction the *victim* plays after resolution
could not be offered at all. Burnt Offerings is the first such card, and it
needed `afterResolutionByTarget`: the same window, gated on `af.target` being
the reacting seat.

**`predatorBleedingYou` had "and three or more Methuselahs remain" inside it**,
because My Enemy's Enemy — the only card using it — prints both clauses. Burnt
Offerings prints the predator clause and *not* the count, so the two had to stop
being one rule. The count is now `threeMethuselahsRemain` and My Enemy's Enemy
names both.

That is the standing lesson twice in one wave: **a rule welded to a card is not
shared, it is merely nearby.** Neither was wrong while one card used it; both
were wrong the moment a second card wanted half of it. The split is asserted
directly — Burnt Offerings still works with a seat ousted and only two
Methuselahs left.

The pool burn reads `af.actingSeat` rather than walking the ring for the
predator a second time. The card's own gate has already established that seat
*is* the predator, and two derivations of one fact are two facts that will
disagree.

## §3 — Removing a card from the crypt

The pool's first effect to touch a **crypt**. "Remove the top card of that
Methuselah's crypt from the game" names the seat the bleed was aimed at, not the
card's player, and `CardRemovedFromGame` already existed with no zone to move to
— p. 16 says a removed card "cannot be retrieved or affected in any way", so
having nowhere to put it is the correct model.

"Cannot be played when the target crypt is **empty**" [RTR 20000501] is a gate
on the option rather than a no-op at resolution, which is the difference between
a card that is not offered and a card that is offered and does nothing.

## §4 — The same payoff on two clocks

Zephyr's two modes unlock the actor **at the end of the turn** and **now**. The
basic is the interesting one: the vampire stays locked for the rest of the turn,
so it cannot act or block again — the debt is owed on the turn frame and paid
where the turn ends, beside Sonar's deferred draw from wave 84.

"Unsuccessful" is read off the engine's own `resolvedSuccess`, and that gets a
ruling right for free: **a FIZZLE** — unblocked at resolution but unable to do
anything — **resolves, so it is recorded as successful**, and Zephyr is
correctly not offered on one [ANK 20220218]. Nothing had to be built for that;
it is worth writing down precisely because it looks like it would need a second
flag.

## §5 — The mutation check earned its keep

All nine assertions passed on the first run, so per wave 79 all four new pieces
were broken on purpose. **Three failed and one did not**: deleting the
end-of-turn unlock debt entirely changed nothing.

The reason is worth remembering. The test walked 60 steps to "end the turn",
which sailed on into Alice's **next** turn — whose unlock phase unlocks her
vampires for free. So "V1 is unlocked" held whether or not the card had done
anything. The walker is now **bounded to Alice's turn**, and there is a control
showing V1 still locked at that boundary without the card. Re-mutated
afterwards: the failure appears.

This is the "empty for the wrong reason" family pointed at a walker's *distance*
rather than at an option list — and the only thing that caught it was mutating a
piece whose test was already green.

One smaller repeat: the crypt holds whole `MinionState`s, not `{id, name}`
stubs. vitest accepted the literal happily and `npm run typecheck` did not —
the same division of labour that caught wave 75's readonly array.
