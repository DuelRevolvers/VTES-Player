# AI v2 — a search agent (2026-09-06)

`docs/richer-options-design.md` §8 ended with a measured claim:
weight-tweaking is exhausted, because a policy is an argmax over one option
list and a plan is about the position a move leads to. This is the attempt
at the other thing.

**Verdict up front, so nobody reads the design as a recommendation: the
infrastructure works and is proven; the LOOKAHEAD does not yet beat the
tuned policy, and at full strength it loses by 1.08 VP.** `SearchAgent`
ships as opt-in, is not wired into the game's bots, and the open problem is
named in §5.

---

## 1. The blocker that was not there

`docs/ai-v1-design.md` §8 recorded the prerequisite as follows: an agent
cannot legitimately have a state, because `Agent.decide` is handed a
`PlayerView` and never a `GameState`; and `PlayerView` **carries no frame
stack**, so a state rebuilt from it could not be handed back to the engine
to apply a move at all.

Every sentence of that is true and the conclusion was still wrong, because
it assumed the only masked object available was `PlayerView`. It is not.
**`redactFor(state, seat)` returns a real `GameState`** — the full frame
stack, the impulse cycle, the combat, everything — with every card the seat
may not see already blanked. It is the object `viewFor` is *defined in
terms of*, and it is what `LocalTransport.stateFor` already sends to a
remote player.

*A deferral is a claim about the code as it was.* That is the sixth time in
this project (Touch of Valeren, New Carthage, Break the Bonds, Hunting the
Quarry, Spying Mission, this), and the first in the AI.

## 2. Why searching on it is not cheating

The owner's ruling of 2026-09-06 is the constraint:

> "The AI should work like a player and only work off of the information a
> normal player would possibly know or can see/read from the table."

Three things make `redactFor` the right side of that line:

1. **It is what a remote human already receives.** Multiplayer sends this
   exact object to a peer, so everything readable in it is readable by a
   person playing that seat from another machine. If it leaked, that would
   be a live multiplayer bug, not an AI one.
2. **It is produced by THE masking rule.** There is no second set of rules
   here to get wrong — the property this project has protected since
   `viewFor` was first written in terms of `redactFor`.
3. **It is guarded.** `tests/ai/information-boundary.test.ts` now checks
   the masked state as well as the view, per card instance, over whole
   games, with a positive control.

`Agent.decide` gained an optional fourth argument rather than a second
interface, so humans and AI still implement one contract (principle 5) and
every existing agent, test and fixture is untouched.

## 3. THE CRUX EXPERIMENT, run before any of it was designed

Can the engine actually run forward on a clone of a masked state? Hidden
cards are blanked, so a simulation might reach for one and fail.

Measured over 6 dealt games, every option at every decision with a real
choice — **7312 simulations**:

| | |
| --- | --- |
| succeeded | **7312 (100.0%)** |
| the option was not offered on the masked state | **0** |
| threw | **0** |
| cost | **0.84 ms** per option |

Nothing had to be determinized for one ply. A blanked card is a
`CardInstance` whose name resolves to no handler, and the enumerators
already skip what they cannot look up — the totality this codebase has been
fixing card by card for months paid out here in one line.

## 4. What it does

For each candidate option: clone the masked state, apply the move, run on
until the action in flight has resolved (every seat passing), value the
resulting position, keep the best.

Two things are deliberate and both were forced by measurement:

- **The score is a BLEND**, `policy + lookahead x (value_after -
  value_before)`, not a replacement. The policy is four measured rounds
  deep; a hand-made value function has no claim to override it outright.
- **The policy's own pick is the incumbent.** The search must *strictly
  beat* it to change it. Without that the two disagree on every tie — the
  policy breaks ties on its seeded stream, the search would break them by
  candidate order — and then `lookahead: 0` is not the policy, which is
  the control everything else rests on. **Its own test caught exactly
  that**, on a contested-card choice.

"Every seat passes" is a stated approximation, not a model of the
opponents. It is also the only branch this agent may legitimately explore:
it cannot see their hands, so it cannot know what they would answer with.

## 5. THE MEASUREMENT

Hecata mirror, 120 games per row (the search is ~1 game/sec against the
policy's ~13, so the margins are wider than elsewhere in this project):

| lookahead | result vs the tuned policy |
| --- | --- |
| **0** (control) | +0.150 VP, inside ±0.294 — **a dead heat, as it must be** |
| 0.3 | +0.008 VP, inside ±0.302 |
| 1 | **−1.083 VP**, margin ±0.244 |

The control is what makes the rest readable: with the lookahead off the
agent reproduces the policy exactly, so the damage at `lookahead: 1` is the
**value function** and not the candidate ordering, the option cap, or the
simulation.

Two things were tried and neither rescued it:

- **Counting committed influence.** A transfer moves 1 pool onto a card
  that will not reach play for turns, so a lookahead saw a pure loss and
  the agent would never influence — and influence is 39.6% of real choices.
  Pricing an uncontrolled counter near `pool` fixes that in principle, and
  changed the result not at all.
- **Evaluating after RESOLUTION rather than after the choice.** Almost
  nothing in VTES pays off at the moment it is chosen: announcing a bleed
  transfers no pool and locks the actor. Running the simulation on to the
  end of the action was the obvious fix, and moved the number by 0.03.

## 6. What is actually unsolved

**The value function.** A linear sum of pool, board, blood, hand and
victory points is not a good estimate of a VTES position, and a search is
only as good as the thing it maximises. Specific known holes:

- **Tempo is invisible.** A locked vampire and an unlocked one score the
  same, so the search cannot see that acting costs the ability to block.
- **Position is invisible.** Being between a strong predator and a weak
  prey is worth a great deal and appears nowhere.
- **One ply is not enough to see a trade.** Bleeding into an open blocker
  and bleeding into a tapped-out table look identical, because the
  opponent's reply is exactly what this agent may not model.

That last one is the honest ceiling. Deeper search needs
**determinization** — sampling plausible hidden cards.

**§9 supersedes what this paragraph originally said.** It read that a real
player knows their own decklist, that `PlayerView` did not say so, and that
adding it was the first thing to do. The owner ruled on it the same day and
it is now built: a seat carries its own deck list and the search fills its
own library from it. What remains unsolved is the half that cannot be
fixed by more information — **an opponent's hand is a guess, not a
deduction**, because deck lists are private in VTES.

## 7. How to run it

```
npm run bench -- --search 1 --deals 30 --precon Hecata
npm run bench -- --search lookahead=0 --deals 30     # the control
npm run bench -- --search pool=4,preyPool=-3 --deals 30
```

`--search` puts the search agent in the challenger seat; its value weights
are named the same way `--weights` names the policy's.

## 8. What ships

- `src/ai/search.ts` — the agent, opt-in, **not used by the game's bots**.
- `Agent.decide` takes an optional masked state; `batch.ts` and
  `LocalTransport` supply it. A policy agent ignores it.
- `HeuristicAgent.score` is public, so the search can blend and order.
- `tests/ai/search.test.ts` — plays a whole game legally, never disturbs
  the state it searches, falls back without a masked state, reproduces the
  policy at `lookahead: 0`, and cannot see a hidden card.
- The boundary test covers the masked state as well as the view.

Nothing about the AI the owner plays against has changed. What has changed
is that the route the ruling left open is now built, measured, and
honestly reported as not yet better — and the next person does not have to
re-derive whether the engine can run on a masked state, because it can, at
0.84 ms a move, with a hundred-per-cent success rate.

---

## 9. Knowing your own deck (owner ruling, 2026-09-06)

> "The AI should know what cards they have in their deck, their hand, and
> whatever is out on the table and is face-up."

Two of the three were already true — the hand and the face-up table have
been in `PlayerView` since phase 5. The third was the piece §6 named as
the first thing to add, and it is a real gap in the model rather than a
convenience: **masking could say what you may not SEE, and had no way to
say what you already KNOW.** A player built their deck. They know what is
in it.

### Composition, never order

`SeatState.deckList` is one entry per copy, fixed at the deal and never
changed. `redactFor` keeps it for its owner and **strips the key entirely**
for everybody else — deck lists are private in VTES, which is the whole
reason a search agent must guess at an opponent's hand rather than deduce
it.

**The library stays face down for everyone, including its owner** (p. 14:
you may not read your own deck). So what the owner gains is the
composition and never the order — and the arithmetic that follows
(deck, minus what I have drawn and played, is what remains) is exactly what
a player at a table does in their head. Two tests pin the two halves: one
that the deck list is present and private, one that the library is still
entirely face down to its owner.

**The key is genuinely ABSENT rather than present-and-undefined**, which
`exactOptionalPropertyTypes` insists on and which matters for the same
reason `FACE_DOWN` blanks a name instead of deleting the card: anything
walking the object would otherwise still be told the seat has a deck list.

### What it bought the search: correctness, not strength

A simulated replacement draw used to hand the agent a blank card. Now
`determinize()` fills the agent's OWN library with the cards it knows are
in there — the deck minus everything it can see has left it (hand, ash
heap, cards in play) — shuffled on the agent's seeded stream, **once per
decision** rather than once per option, because every candidate must be
judged against the same deck or the comparison measures the shuffle.

**Measured: it changed the result by nothing at all** — `lookahead: 1`
stays at −1.083 VP and `lookahead: 0.3` at +0.008, to three decimals.

That is not a surprise once stated: the value function counts hand SIZE
and not hand CONTENTS, so which card is drawn cannot reach the score. It
is a correctness fix on the road to a deeper search, not an improvement
today.

**Three decimals of "no change" is also how something looks when it is not
running at all**, which is this project's oldest failure shape, so
`determinize` is public and asserted directly: every card in the agent's
own library has a real name, every name is really in its deck, no name
appears more often than the deck holds it once the hand and ash heap are
counted, and **nobody else's library is touched**.

### What it does not do

It determinizes only the agent's own library. An opponent's hand and deck
remain exactly as opaque as they are to a player, which is the ruling
working as intended — and it is why this agent still searches one ply and
cannot model a reply. Sampling opponents' hidden cards is the next step,
and it will always be a guess rather than a deduction.
