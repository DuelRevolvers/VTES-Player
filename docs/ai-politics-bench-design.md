# A table where politics happens (2026-09-18)

**Status: designed, not built. Owner review before kernel code.**

Depends on nothing. **Everything in the politics stack depends on this**,
and so does `ai-combat-range-design.md` §5. Build it first.

## 1. The problem, and it is not the AI

`config/playtest-decks.json` — the table `npm run simulate` plays and the
one every AI measurement in this project has used — holds **three
political action cards across three decks, all in Alice's**:

```
Alice | political: Kine Resources Contested, Parity Shift, Malkavian Justicar
Bob   | political: NONE
Carol | political: NONE
```

That is why `castVote` is 2.4% of real choices and `chooseTerms` is 0.4%
(`ai-decision-profile-2026-09-18.md`). **Those numbers describe the
fixture, not the game.**

Measure a vote scorer here and the bench will report a dead heat. It will
be a true statement about this table and a meaningless one about VTES —
the "empty for the wrong reason" lesson in its deck form, and the reason
the project already knows that *"a card in the fuzz decks is not a card
the fuzz can PLAY"*.

## 2. THE GOOD NEWS: the deck already exists

No deck-building is needed. Counting political actions in every shipped
precon:

| political / library | precon |
| --- | --- |
| **17 / 77** | **Fifth Edition / Toreador** — Kine Resources Contested x8, Consanguineous Boon x4, Parity Shift x4, Toreador Justicar x1 |
| 15 / 77 | Sabbat V5 / Path of Power and the Inner Voice — Kine Resources Contested x5, Empires Fall x3, Banishment x2, Cold War x2, War of Ages x2, Cardinal Benediction x1 |
| 13 / 77 | Fifth Edition / Ventrue — Kine Resources Contested x7, Parity Shift x5, Ancilla Empowerment x1 |
| 10 / 77 | Fifth Edition / Lasombra |
| 9 / 49 | New Blood / Malkavian |
| 8 / 49 | New Blood / Toreador |

**21 of the 32 precons contain no political action at all**, which is
itself worth knowing: politics is concentrated, and a bench that picks a
precon at random will usually pick a deck that never votes.

`npm run bench` is already a **mirror match on a named precon** and
already takes `--seats`:

```
npm run bench -- --precon "Toreador" --seats 5
```

So the measurement instrument for the whole politics stack is one
command that works today. **That is the finding of this doc** — the work
is smaller than it looked.

## 3. What still needs building

**(a) A politics playtest table.** `npm run simulate` is the soak test
and the decision profiler, and it should contain politics so that
profiles taken from it are not misleading. Add a second config —
`config/playtest-decks-politics.json`, or a `--decks` flag on
`scripts/simulate.mts` — with Toreador, Ventrue and a non-political deck
in the third seat. **Not all three political:** a table where everyone
calls referendums measures a different game than one where two seats have
to react to a politician, and the second is the common case.

The existing config must stay untouched and default, or every number in
`richer-options-design.md` becomes uncomparable.

**(b) The Path of Power deck is the interesting one and may be a trap.**
It has 15 political cards including Cardinal Benediction, whose sentence
restricts who may vote at all — "non-`<sect>` vampires cannot cast votes
or ballots this referendum" (`voteRestriction` on the frame). That is
exactly the kind of card a naive vote scorer gets wrong, and exactly the
kind a bench run would not tell you about. **It belongs in a trace test,
not in the bench deck**, at least at first.

**(c) A gun deck, for `ai-combat-range-design.md`.** 4 `useManeuver`
decisions in 20 games says the same thing about ranged combat that the
political counts say about politics. Same fix, same file.

**(d) Politics in the fuzz decks.** `tests/engine/fuzz.test.ts` is the
invariant guard, not a strength measure, but the widening lesson applies:
**tally what is actually OFFERED after a deck change**, and expect a green
fuzz before and a red one after to be a latent engine bug being dealt in
rather than a new one. If adding referendums to the fuzz turns something
red, read it as a report about the ENGINE first.

## 4. The controls, which are not optional

`ai-bench-design.md` already builds the two that matter and they must be
re-run on the new table, not assumed to carry over:

- **The negative control:** the same policy against itself must come out
  a dead heat. If Toreador-mirror A-vs-A is not a dead heat, the table is
  measuring itself and no result from it means anything.
- **The positive control:** a deliberately crippled policy must lose. A
  vote scorer inverted — vote against everything that helps me — is the
  natural one here, and it doubles as a test that the scorer is wired in
  at all.

Without both, "no difference" means nothing. That is the project's own
rule and it has been paid for.

## 5. Seat count

The bench takes `--seats 5`. Politics is different at five seats than at
three: more vote sources, more cross-table, and the flattened
cross-table relation in `ai-seat-relationships-design.md` §6 only becomes
questionable there.

**Recommendation: measure at both 3 and 5**, and treat a result that
appears at one and not the other as a reason to look rather than a reason
to pick the flattering number.

## 6. Tests

- `validateDecks` passes on the new config — the existing guard in
  `simulate.mts` refuses to measure an illegal table and it should keep
  refusing.
- A test that the new config **actually produces referendums**: run a
  handful of seeded games and assert `castVote` decisions occur above some
  floor. This is the test that stops this doc's whole purpose from
  regressing silently, and it is the one that would have caught the
  current situation years ago.
- Precon counts are **derived, never written down**: if a future wave
  changes what is in a precon, the table in §2 is stale. Regenerate it
  rather than trusting it, the same way every card count in this project
  is re-derived from `data/registry-report.txt`.

## 7. BUILT, 2026-09-18 (platform 0.10.66)

Item 0 of `ai-improvements-roadmap-2026-09-18.md`. What shipped:

- **`config/playtest-decks-politics.json`** — Toreador (Alice), Ventrue
  (Bob), Nosferatu (Carol), per §7.1 below. **Generated from the shipped
  precons** via `preconDeck`, as `DeckList` entries rather than snapshot
  decks, so the table cannot drift from the card pool and no card list
  was hand-copied.
- **`--decks <path>` on `scripts/simulate.mts`**, plus
  **`npm run simulate:politics`**. The default table is untouched and
  stays the default, so every number in `richer-options-design.md`
  remains comparable. The run now prints which table it used.
- **`tests/ai/politics-table.test.ts`** — four assertions: political
  actions in more than one seat, the table is legal, referendums are
  actually polled in real games, and the table carries more politics than
  the default one (a comparison, not a magic number).

**Measured at the time: 79 vote decisions and 10 terms decisions in 10
games**, against 70 and 13 in *twenty* games on the default table — about
4.5× the referendum density, which is what item 0 existed to buy.

**Re-measured 2026-09-19 (0.10.77), after the §7.3 augmentation and
after items 3–9 changed how the bots play**, 20 games per table:

| | default | politics |
| --- | --- | --- |
| vote decisions | 69 | **131** |
| terms decisions | 13 | **15** |

Still the reason this table exists — roughly **twice** the vote decisions
of the default table over the same number of games. It is below the
original 4.5× because that figure compared 10 politics games against 20
default ones; per game the gap is about 1.9×.

### 7.1 The deck choice, decided

Toreador + Ventrue + Nosferatu. Two callers and one seat that has to
answer them, per §3(a): a table where everyone calls referendums measures
a different game from the common case. Nosferatu is the third seat
because it holds no political actions at all and is reaction-heavy, so it
is the seat that would *block* and *vote against* if the AI could.

### 7.2 WHAT IT FOUND IMMEDIATELY

The first run of the new test failed, and the failure was a doc claim
rather than a bug: `ai-vote-scoring-design.md` §2 asserted that **every**
vote decision offers both directions, measured 70 of 70. On this table it
is **30 of 31** — a directed vote grant (`grantAgainst`, 3 votes on a
Parity Shift) offers one direction only, because that is all the card
permits.

**The default table had been flattering the claim**, having no directed
grant ever reach play. That is this doc's own §1 argument arriving from
the other direction: a fixture with no politics in it cannot be trusted
to characterise politics, *including* when it appears to support you.
Correction recorded in `ai-vote-scoring-design.md` §2.1.

## 7.3 THE TWO FOLLOW-UPS, done 2026-09-19 (platform 0.10.77)

Items 5 and 7 each shipped a rule that was correct, tested, and
**unreachable in a real game** because no deck contained the cards that
produce the situation. Both are now in the politics table:

| card | what it makes reachable |
| --- | --- |
| **Alexander Silverson (G6)** ×3, caller's crypt | a vote TOLL — "burn 1 blood to cast votes against referendums called by Alexander" |
| **Oluwafunmilayo (G6)** ×3, answerer's crypt | +1 intercept **against political actions**, the only thing in the pool that answers an undirected action's +1 stealth on the turn it matters |
| **Revenant ×8, Raven Spy ×4**, answerer's library | general +1 intercept, no discipline needed for Revenant |

The table is therefore **generated from the precons and then augmented**,
and its `_comment` says so. The augmentation is asserted statically by
`tests/ai/politics-table.test.ts` — the cards being PRESENT is a fact and
must not regress; how often they reach play is a frequency and is not
asserted.

### The toll: from impossible to measurable

| | 40 games |
| --- | --- |
| before | **0** tolled vote decisions |
| one copy of Silverson | 5 |
| three copies | **22** |

Silverson is on the table in 17% of sampled decisions. One copy of a
13-card crypt reached play about once in forty games, which is why the
count went up rather than the fixture being redesigned. **Item 5's cost
rule is now exercised by real games.**

### The block: reachable, still rare, and the reason is the AI

| | 40 games |
| --- | --- |
| before | 45 political block decisions, **0** viable |
| after | 41 decisions, **2 viable, 2 blocked** |

Not one of 45 became two of 41. Two things are worth separating:

- **`blockPolitical` works.** Both times a block was viable, the bot took
  it — which is exactly what item 7 built and could not previously
  demonstrate.
- **The intercept does not reach the table.** `wouldSucceed` is
  `intercept >= stealth`, so a single +1 retainer is enough; the
  retainers are simply never in play. Employing one is an ACTION scored
  at `playCard` (2) against a bleed at `bleedPrey` (12+), so **the policy
  bleeds instead, essentially always.**

**That is a finding about the AI, not about the deck**, and adding more
retainer copies will not fix it: a deck that cannot defend because the
bot never plays its defensive permanents is a policy problem. It is
written down here rather than acted on, because it is a new item and not
part of either follow-up.

## 8. Still open

**Nothing blocking.** §3(b) (Path of Power as a trace test, not a bench
deck), §3(c) (a gun deck for `ai-combat-range-design.md`) and §3(d)
(politics in the fuzz decks) are all still to do, and each belongs with
the item that needs it rather than here.

The original open question, recorded because the reasoning may want
revisiting: **should `npm run simulate` be a table or a mirror?** The
answer taken is a table — `simulate` is the soak test and the profiler,
and a profile taken on a mirror would say what a politics deck does
against itself. The *bench* is the mirror, and it already is one —
`npm run bench -- --precon "Toreador" --seats 5` needed no work at all.
