# Positional combat

Wave 71 (2026-09-19). Fade from View (100688), Gleam of Red Eyes (100838),
Form of the Ghost (100772), Nimble Feet (101288), Quick Exit (101528),
Read Intentions (101558), Movement of the Mind (101246), Dissolution (100558).

**Eight cards and no new primitive.** Every one of them is a press, a
maneuver, a dodge or an additional strike at two levels — vocabulary waves
1–70 already built. This wave exists to prove that point: when a bucket's
primitives are finished, a wave stops being "one mechanic for four cards" and
becomes "no mechanic for eight". That is twice the pool per wave for the same
gate, and it is the shape the rest of the Combat bucket should take.

---

## §1 — What each card is

| Card | Basic | Superior |
| --- | --- | --- |
| Fade from View [obf] | press | dodge |
| Gleam of Red Eyes [pro] | press | maneuver |
| Form of the Ghost [pro] | maneuver | press |
| Nimble Feet [cel] | press | +1 additional strike (limited) |
| Quick Exit [obf] | press, **only to end** | dodge |
| Read Intentions [aus] | press, **only to end** | dodge |
| Movement of the Mind [tha] | press, **only to end** | maneuver |
| Dissolution [pro] | maneuver **or** press | maneuver **with** an optional press |

Gleam of Red Eyes and Form of the Ghost are the same two effects at
**opposite levels**. They are in one wave deliberately: a card with its modes
transposed passes every single-card test, because each mode does something
real and the test only ever asks one of them. The mirror-pair assertion is
the only thing that sees it.

## §2 — Which window a mode belongs to

`windowFor` derives the window from the mode's own effects, so nothing here
needed a hand-placed window:

- a **press** → `combat.press`
- a **maneuver** → `combat.range`
- a **dodge** or an **additional strike** → `combat.chooseStrike`

The reading worth writing down: **"play before range is determined" on these
cards names the range STEP, not the window before it.** `combat.beforeRange`
is a separate window that a card has to ask for by name (Set Range Long
does). A maneuver card that went there would be offered one step early and
would move a range nobody had contested yet.

## §3 — "Only usable to end combat"

Three of the eight print a press that may only END the combat. That is
`press.endOnly`, and the gate already existed for Qetu:

```ts
if (!cf.willContinue) {
  if (press.endOnly) continue;   // nothing standing to end
  …offer it as "continue"
} else if (!press.continueOnly) {
  …offer it as "cancel"
}
```

So the card is **not offered at all** until somebody has pressed to continue,
and then it is offered as the cancel. Both halves are asserted, and the
negative half is the one that matters: an end-only press offered against a
quiet press step would end a combat that was already ending.

## §4 — Dissolution: "or" is variants, "with" is two effects

`[pro] Maneuver OR press. [PRO] Maneuver, with an optional press.`

- The **or** is two `variant`s of the basic mode (the Indomitability shape),
  not a choice frame. Each variant is offered **in its own window** — the
  maneuver at the range step, the press at the press step — which means the
  player never sees the two side by side and never has to be asked. The
  option list is the choice.
- The **with** is two effects in one mode: `maneuver` then `grantPress`. The
  grant is a per-round credit (`cf.presses`), which is right: it is spendable
  at this round's press step, and the round it was granted in is the round the
  card names.

## §5 — What the wave found

**A duplicate card-instance id is invisible to an "is it offered" test.**
The fixture pushed the card into Alice's hand as `{ id: "c1" }`, and
`threeSeatGame` already deals her a Conditioning with that id. The option
enumerator walks the hand, so `play:Dissolution:superior:V1:c1` was offered
under the right name — and `choose` resolved the FIRST `c1` it found, which
was Conditioning. Twelve of the seventeen assertions passed anyway, because
they only ask whether the option appears.

The tell was in the event log, not in the failure: `BleedAmountModified` and
`CardToAshHeap` naming a card the test had never heard of. What made it
findable at all is that three assertions went on to *use* the card — the
end-only presses had to end a combat, and Dissolution's superior had to hand
over a press credit. **An assertion that plays the card catches what an
assertion that merely finds it cannot**, and in a table-driven wave the
playing assertions are the few hand-written rows at the bottom.

This is the same family as the lesson about empty-for-the-wrong-reason: the
fixture handed the test a name and the test never checked that the name
pointed at the card.

Two smaller readings:

- **A plain combat hands nobody a press credit**, so a test about answering a
  press has to grant one (`cf.pressesCombat.opposing += 1`). Without it the
  "not offered" half passes for the wrong reason and the "offered" half never
  fires — the guard-clause-as-silent-skip shape, one level up.
- **A test walker that only knows `pass` stops dead at `combat.chooseStrike`,**
  which offers none. Half of this wave lives past that step, so the helper
  prefers `pass`, then `strike:hand`, then any strike — still never
  `options[0]`.
