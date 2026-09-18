# Reactions that read the ACTING minion

Tranche 3, wave 24. Four reactions gated on who is acting against you.

| Card | KRCG | Printed |
|---|---:|---|
| Banner of Neutrality | 100132 | Requires an Independent or Anarch vampire. Only usable if a **Camarilla or Sabbat** vampire is bleeding you. Reduce the bleed by 1. |
| Keep it Simple | 101038 | Reduce a bleed against you by 1 **for each point of stealth** the acting minion has when this card is played. |
| Nest of Eagles | 101274 | **Not usable** if the acting minion is an Assamite or wraith or has flight. Reduce a bleed by 1 — **by 3 instead** if the acting minion is an ally or a vampire with capacity 5 or less. |
| Venetian Conference | 102105 | Only usable if a **Camarilla** vampire is acting. +2 intercept. |

## §1 — A question the spec could not ask

`CardSpec` had eight `requires*` fields and every one of them asks about
the vampire **playing** the card: its sect, clan, capacity, title, path.
Nothing asked about the minion being played **against** — and that is the
whole of these four cards.

`UsabilityRule` was the near-miss. It already carries acting-side clauses
(`predatorIsActing`, `actingIsUndeadAlly`), but it is a **string union**,
so it can express "the acting minion is an undead ally" and can never
express "…is Camarilla or Sabbat". Widening it would have meant a member
per sect combination.

So `requiresActing` is a record beside `spec.usable`, checked in the one
place `rulesHold` is called for a card play. Fields are ANDed, lists
inside a field are ORed, which is how the cards read:

```ts
requiresActing: { vampire: true, sects: ["camarilla", "sabbat"] }
requiresActing: { notClans: ["Banu Haqim"], notUndeadAlly: true, notTags: ["flight"] }
```

The read is **total** — `findMinion`, not `getMinion`. An acting ally can
pay a cost with the life that is its blood and leave play mid-action, and
a condition that throws surfaces as a table nobody can answer rather than
an error somebody can act on. A card whose condition cannot be evaluated
is simply not offered.

### "Assamite" is Banu Haqim

The card prints Assamite; the pool calls that clan **Banu Haqim**. This
project has already shipped a clan filter naming "Assamite" that
therefore matched nothing — it is in the CLAUDE.md lessons. Here the
consequence would have been silent and backwards: the card is a
*negative* filter, so the wrong name does not make it unplayable, it makes
it playable against exactly the minions it says it cannot answer. The
test that pins it is the one worth keeping.

### Flight

No minion in the pool has flight, and flight is not a modelled trait, so
`notTags: ["flight"]` excludes nobody today. It is built anyway: the
clause is printed, a clause that is not built is not built, and this is a
*negative* condition — the card is complete and useful with it, unlike an
inert positive filter, which §0 keeps out.

## §2 — An amount read off the action

"Reduce by 1 **for each point of stealth** the acting minion has **when
this card is played**" is the first bleed modifier whose size is not on
the card. `perActingStealth` reads `currentStealth` at resolution and
emits `−stealth`.

A snapshot, not a subscription, which is what the printed clause says:
stealth played afterwards does not grow the reduction. That works only
because the bleed amount is a **fold** over `BleedAmountModified` — the
same property `setBleedZero` leans on — so one delta emitted once stands
on its own and later modifiers still land on top of it.

**At zero stealth the card is not offered.** It costs a blood and would
reduce nothing; a futile option is not a choice
(`docs/futile-options-design.md`). This is a gate in `effectsLegal`, so it
is the *option* that disappears, not the effect that fizzles.

## §3 — "…by 3 instead"

Nest of Eagles' second clause is the existing `bonus: { extra, when }`
machinery with a **negative** extra: base −1, extra −2, total −3. Writing
it as −2 rather than −3 is the difference between "instead" and "as
well", and it is the only thing about the card worth a comment.

The condition itself is new — `actingSmall`, "an ally **or** a vampire
with capacity N or less". One condition rather than a capacity test with
an ally special case, because an ally qualifies whatever its stats and an
ally has no capacity to test. Capacity is read with `capacityOf`, so a
granted capacity counts, matching `redirectBleed.youngerOnly`.

## What the wave found

Nothing broken — the first wave in a while that did not turn up an engine
defect. What it did turn up is a **shape**: every conditional on a card
had been expressed either as a parameterless string in `UsabilityRule` or
as a `requires*` about the player, and the acting minion had no home in
either. Expect the next card that asks about the acting minion's title,
capacity or clan to extend `requiresActing` rather than add a field.

One card-face correction: **Venetian Conference costs 1 blood**, which
the printed text does not say and `supported.test.ts` caught by
cross-checking the spec against the registry — the metadata test earning
its keep for the third wave running.

## Tests

`tests/cards/acting-minion-reactions.test.ts`, 8 tests, five of them
negative space: the anarch bleed Banner does not answer, the Camarilla
reactor who cannot play it, the Banu Haqim actor Nest of Eagles excludes,
the stealthless bleed Keep it Simple is not offered against, and the
Sabbat actor Venetian Conference ignores. Each has a positive control in
the same file, so "not offered" cannot be passing because nothing was
offered at all.
