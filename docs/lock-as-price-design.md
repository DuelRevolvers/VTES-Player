# The lock as a price

Wave 67 (2026-09-18). Elysium: Sforzesco Castle (100630), Elysium: The
Arboretum (100631), Powerbase: Savannah (101442), Atonement (100109).

Two things in VTES cost a lock: **blocking** (p. 25 — the blocker locks) and
**ending a combat from outside it** (a location locks itself). These four
cards move that price around — onto a card, onto *another* card, or off the
table.

| Card | The price |
| --- | --- |
| Elysium: Sforzesco Castle | the card locks instead of the blocker |
| Elysium: The Arboretum | the card locks, to end a Camarilla-vs-Camarilla combat |
| Powerbase: Savannah | ANOTHER unique location locks, to end your actor's combat |
| Atonement | nothing locks: no lock for blocking a vampire the same age or younger |

---

## §1 — Half of it already existed

`combatEndGrant { sect }` was written for Garibaldi's location and is
Elysium: The Arboretum's whole clause: both combatants of the named sect,
one of them yours, the card locks. `vulnerableTo` covers all three
counter-plays (a referendum for the Arboretum, a steal for Savannah, a Ⓓ
action for Atonement). Checking the tree first is what turns a four-card
wave into two new fields.

## §2 — Sforzesco Castle: the lock is traded back, not skipped

"When a vampire you control blocks a Camarilla vampire, you may lock this
card **instead of** locking the blocking vampire."

"You may" is a decision, and **block resolution is not a decision point** —
the engine resolves the attempt, locks the blocker and pushes the combat in
one synchronous run. A ChoiceFrame raised there would be answered *after*
the combat had begun, because the combat frame lands on top of it.

So the card is an **ability in the combat's first window**, offered to the
blocker's controller, which unlocks the blocker and locks the card. The end
state is what the card describes; the log says "blocked, then the Castle
locked instead", which is honest about the order. The alternative — deciding
for the player, since locking a location with no other ability is almost
always right — was rejected: "you may" is the player's.

## §3 — Atonement, and the second site that locks a blocker

"Does not lock for blocking a vampire the same age or younger" is an
exemption, not a substitution, so it belongs where the lock is emitted. The
engine emitted it in **two** places:

- block resolution (a successful block),
- `endAction({ lockBlocker })` — the cards that end an action but lock the
  blocker anyway (Mirror Walk, p. 49).

Both now go through `lockBlockerForBlocking`. An exemption honoured in one
and not the other is a card that works or not depending on which card ended
the action — and the test pins the Mirror Walk path for exactly that reason.

"Age" is capacity, and an ally has none: an ally blocker can never satisfy
"the same age or younger", which is what the card says and what the test
asserts.

## §4 — Savannah: the price is a different card

"You may lock **any other unique location you control**" — so the option is
one per candidate (unlocked, unique, a location, not itself), the chosen
card rides in the option id, and Savannah itself stays unlocked and can do
it again next combat. The gate is also new: `ownActing`, "a combat involving
an **acting vampire you control**" — the third form of "which combat", after
Garibaldi's both-combatants-of-a-sect and Tommaso's tagged-ally. The test
pins that the seat whose vampire merely **blocked** is offered nothing.

## §5 — What the wave found

**A failed block attempt could be repeated for ever.** The dealt-game test
(`tests/ui/fresh-game.test.ts`, whose walker deliberately plays the board)
ran 20,000 steps of `block → fail → block → fail`. The engine's own comment
said the quiet part out loud — "a failed attempt does not lock the blocker;
back to state A; the same Methuselah may attempt again" — and nothing
consumed anything, so the action never left state A.

Stealth persists for the whole action, so a second attempt by the same
minion faces the same numbers. The failed blocker is now added to
`cannotBlock`, which is the bookkeeping the `forceFail` path beside it
(Enchanting Gaze) already did. **Recorded reading for the owner:** the
alternative is that one minion may re-attempt within an action, which only
matters if their intercept has risen since — and then the first attempt was
spent for nothing. One line either way, and it is flagged rather than
buried.

Worth noting how it surfaced: my four cards are not in a precon, but the
dealt game builds its decks **by name order over the whole supported pool**,
so every wave reshuffles that test's decks and can expose a latent standoff.
**A green fuzz before and a red one after a deck change is usually a latent
bug being dealt in** — the lesson, on a different test.

**And `undefined === undefined` suppressed every clanless minion's unlock.**
Wave 66's `clanDoesNotUnlock` was compared straight against the minion's
clan; a card without the field and a minion without a clan are both
`undefined`, so `unlockSuppressed` returned true for allies and clanless
vampires and the game stalled. Found by the same dealt-game test in the same
run, and fixed by testing the field's presence before comparing it. An
equality between two optionals is a claim that both are set.

## §6 — Metadata, again

Atonement costs **2 blood**, which the first draft of the spec had as 0 —
the same slip wave 66 made with Eternal Vigilance, caught by the same
`supported.test.ts` cross-check. Two waves running, so it is worth saying
plainly: **read the cost line off the raw snapshot, not off the card's
sentence.**
