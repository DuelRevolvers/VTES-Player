# Blood-bank actions — feeding from the bank (wave 59)

*2026-09-17, platform v0.10.50. Library 702 → 706.*

**Cards:** Blood Feast (100200), Patshiv (101376), Esbat (100660),
Khabar: Loyalty (101045).

## §1 The family

Four actions whose entire effect is **blood arriving from the blood
bank** — not moved off a vampire, not off a card in play, but conjured
from the unbounded pool of counters (p. 5). What differs between them is
only **who gets fed**, which is what makes them one wave and what makes
the negatives worth writing:

| | who | how much | where |
|---|---|---|---|
| **Blood Feast** | each ready Sabbat vampire **you control** | 1 each | in play |
| **Patshiv** | each ready **unlocked** Ravnos, **anyone's** | 1 each | in play |
| **Esbat** | unlocked Sabbat vampires, **anyone's** | 2 to one, **or** 1 to each of two | in play |
| **Khabar: Loyalty** | a **younger** Banu Haqim | 2 | **uncontrolled region** |

Khabar: Loyalty needed no new engine work at all —
`addUncontrolledBlood` has carried `amount`, `youngerOnly` and `clan`
since the Thing wave. It is in this wave because it is the same sentence
aimed at the crypt instead of the table, and because of §5.

## §2 `bankBloodSweep` and one shared filter

```ts
| { kind: "bankBloodSweep"; amount: number; who: BankBloodFilter }
| { kind: "bankBloodSplit"; who: BankBloodFilter;
    splits: Array<{ amount: number; targets: number }> }
```

`BankBloodFilter` is `{ clan?, sect?, unlockedOnly?, ownOnly? }`, and
`bankBloodRecipients()` is the **one place** that answers it. Two
primitives sharing one filter rather than two copies of four `if`s: the
sweep and the split ask exactly the same question and differ only in
whether anybody chooses the answer, which is precisely the shape that
gets written twice and drifts on the third card.

**`ownOnly` is the field that exists to be left OFF.** Blood Feast says
"each ready Sabbat vampire **you control**"; Patshiv says "each ready
unlocked Ravnos" and names no controller at all, so it feeds a
predator's Ravnos too, and Esbat's "an unlocked Sabbat vampire" is any of
them. Defaulting to "yours" would have read naturally, compiled,
typechecked and passed every single-seat test. The tests seat a Ravnos
and a Sabbat vampire at **another** Methuselah's table for exactly this
reason.

A vampire already at capacity is filtered out: p. 6 drains the excess
straight back to the bank, so feeding it is worth nothing — and for the
split it would waste one of the card's two recipients
(`docs/futile-options-design.md`).

## §3 Two recipients on a one-target rider

Esbat chooses **the split and the vampires**, both at announcement (the
Fifth Tradition: Hospitality precedent — a card's targets are fixed when
it is announced).

The engine's action machinery carries exactly one announced `target`
param per card: `targetRider()` finds the single effect that needs one
and `enumerateActionTargets()` returns a list of strings. Rather than
widen that for one card, Esbat's recipients ride in the target **joined
by `|`** — `play:Esbat:basic:V1:V2|W:<instance>` — and the apply splits
them back out. One card shape, no new plumbing, and the option id still
reads correctly in a trace test.

The split is identified at resolution by **how many** recipients the
chosen option names, because both of Esbat's splits feed a different
number. A card printing two splits that fed the same count would need the
split index in the option id instead; the apply says so in a comment
rather than leaving it to be rediscovered.

## §4 What it found: the actor is offered a card it cannot satisfy

Esbat's two-recipient split was offered as `V1|V2` — **including the
acting vampire itself**.

The action's requirement is "an **unlocked** Sabbat vampire", and options
are enumerated **before** the actor locks at announcement (p. 25). So the
actor still looks unlocked when the option list is built, is offered as a
recipient of its own card, and by the time the blood moves it is locked
and no longer qualifies. Either the engine pays it anyway (wrong) or it
silently pays nobody for that half (also wrong, and invisible).

The engine already knew this. `actionStun`'s enumerator carries the note
in full — *"The actor is excluded: it locks at announcement (p. 25), so it
can never satisfy the card's own condition when the effect resolves"* —
and nothing about that reasoning is specific to stunning. It is a general
fact about **any card whose filter says "unlocked"**, written down once
as a fact about one card.

`bankBloodRecipients` now takes the actor and drops it whenever
`unlockedOnly` is set. The argument is only needed at **enumeration**: by
resolution `m.locked` answers the same question on its own, which is why
the sweep (Patshiv) was already correct — it re-derives at resolution and
had never seen the bug.

**The lesson:** *a filter that reads a state the ANNOUNCEMENT changes
must be evaluated twice, and the two evaluations do not agree.* Lock,
blood and "ready" are all such states. The tell is a card whose printed
condition names something the act of playing it alters.

The second half of the same fix: the split's apply **re-derives** the
recipient set at resolution and pays only those still qualifying, rather
than trusting the ids chosen at announcement. A recipient can be burned,
locked or filled up in between — the "chosen in one window, resolved in
another" family again.

## §5 The clan the card does not call itself

Khabar: Loyalty prints *"a younger **Assamite**"*. The registry's clan is
**Banu Haqim**. A filter spelled from the card's own text compiles,
typechecks, matches nothing and offers the card to **nobody, silently** —
the exact failure `clan-vocabulary.test.ts` was written for, and one this
project has already paid for once.

Patshiv's icon is Ravnos and Khabar: Loyalty's is Banu Haqim, so both
carry `requiresClan` (p. 10 — the clan icon on a minion card is a
requirement, and KRCG's text does not repeat it; wave 45's lesson at
scale).

## §6 Tests

`tests/cards/blood-bank-actions.test.ts`, 6 cases. The load-bearing ones
are negative:

- Blood Feast does **not** feed Bob's Sabbat vampire, and does not feed
  Alice's camarilla one.
- Blood Feast is **not offered** to an untitled vampire.
- Patshiv **does** feed Bob's Ravnos, does **not** feed his locked one,
  and does **not** feed Carol's Brujah.
- Esbat with only one other qualifying vampire offers **no** `|` option,
  and never offers the actor as a recipient of its own card (§4).
- Khabar: Loyalty offers the younger Banu Haqim and **not** the older one
  or the Ventrue.

## §7 Left behind

Same sentence, wrong pool: **Reunion Kamut** (Black Hand), **Little
Mountain Cemetery** (Samedi), **Recruiting Party** (Ventrue antitribu),
**Belonging Grants Protection** (Laibon) and **Khabar: Honor**'s
relatives all print a filter naming a clan, sect or Path the pool does not
contain. They are inert by §0 and cost nothing the day §7 opens their
clans — and every one of them is `bankBloodSweep` or
`addUncontrolledBlood` with a different word in the filter.
