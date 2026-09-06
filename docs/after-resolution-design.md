# The after-action-resolution window

*Freak Drive (100788), Shadow Cast (102280), Shadow Cloak (102281),
Fever Pitch (102321).*

## 1. Why this is a gate

A pool survey of the 137 unsupported library cards found **13** that say
"only usable after (action | block) resolution" — the largest remaining
family, and the engine has nowhere to put them. An `ActionFrame` resolves
and pops in one step; there is no impulse between the two.

This wave builds the window and the four cards that are cleanly inside it.
The rest are deferred with reasons (§6).

## 2. Where the window sits

`resolveActionInner` does its work, emits `ActionResolved`, runs the
existing riders — and then pops. The window goes **immediately before that
pop**, so the frame is still on the stack and a card can still read what
the action was, who acted, whether it succeeded and who blocked.

Everything that currently happens *after* the pop (queued combats, a
political action's referendum, a successful rush's combat) is extracted
into `finishAction()` and runs when the window closes, not before. The
ordering is unchanged for every card that does not use the window.

`ActionFrame.step` gains `"afterResolution"`, and
**`ActionFrame.resolvedSuccess`** records the outcome so a card can gate
on "only usable if the action was successful" / "…was blocked" after the
fact.

## 3. RECORDED DEVIATION: the window opens only if someone can use it

An unconditional impulse cycle after **every** action would be a decision
per seat per action for the whole game, and would rewrite every existing
trace test. So the window opens only when some seat actually has a
playable card — `handlerOptions(seat, "action.afterResolution")` is
non-empty for at least one of them.

This is the same call already recorded for `combat.damageResolution`
(CLAUDE.md: cycling every seat "broke 54 existing tests purely on added
passes; option-gating broke none and changes no outcome for a seat that
could act"), and it is made here for the same reason. Say the word and it
becomes unconditional.

## 4. Freak Drive, and the two things its ruling changes

p. 48:

> If the vampire has been blocked, **Freak Drive is played after combat**.
> You can even play it **if the vampire is in torpor**, provided they have
> blood to pay for it.

Both halves fall to this window rather than needing rules of their own:

- **"after combat"** is automatic. A blocked action pushes its combat, the
  combat resolves, and only then does settle come back to the action with
  `step: "blocked"` and resolve it. The window is after that, so it is
  after the combat by construction.
- **"even if the vampire is in torpor"** is not automatic. The modifier
  compiler requires the acting minion to be a legal player of the card,
  and a torpid vampire is not ready. So the usable rule
  **`afterResolutionByActor`** relaxes exactly that: in this window the
  actor need only still exist and be able to pay. It is a narrow
  exception, printed on the card, and it is the only card in the pool that
  needs it — but it is the *reason* the window has a rule of its own
  rather than reusing the state-A one.

Freak Drive's two modes split on the outcome: `[for]` on success, `[FOR]`
on blocked. Both unlock the vampire.

## 5. "Put this card on this vampire, cash it in later"

Three of the four share a shape: on a successful action, the modifier
**attaches itself** to the acting vampire and is burned later for a
benefit. `attachSelf` already exists for action cards; this is the
action-MODIFIER version of it, in the new window
(`afterResolutionAttach`).

| Card | Attaches when | Cashed in for |
|---|---|---|
| Shadow Cast | after a successful **directed** action | +1 stealth, but only during an action directed at the same Methuselah |
| Shadow Cloak | after any successful action | nothing — it is a standing protection, and burns itself in your unlock phase |
| Fever Pitch | after a successful **bleed** | a block attempt fails (the `failBlockAttempt` mechanic) |

Two small pieces of state come with them:

- **`PermanentInPlay.againstSeat`** — Shadow Cast's "the same Methuselah",
  recorded from the action's target when the card attaches. Without it the
  card would be a free +1 stealth on any action, which is not what it
  says.
- **`PermanentStatics.untargetableExceptDiscipline`** — Shadow Cloak's
  "minions without Auspex cannot perform actions directed at this
  vampire". The unconditional `untargetableByOthers` (Secure Haven)
  already existed; this is the same check with a discipline escape hatch,
  read through `disciplinesOf` so a granted level counts.

## 6. Deferred, with reasons

- **Voter Captivation** (102131), **Amici Noctis** (102274), **Magnetic
  Authority** (102331) — "after resolution of a political action whose
  referendum PASSED". Their window is after the *referendum*, not the
  action, and all three need the **margin** by which it passed, which the
  `ReferendumFrame` does not record. That is its own small gate.
- **Go-getter** (102355) superior — "after resolution of a blocked
  action … continue the action as if unblocked". The action has already
  resolved and its card is burned, so re-opening it would emit a second
  `ActionResolved`. Form of Mist does the same thing from *before*
  resolution, where it is clean. Wants a deliberate decision about whether
  an action can un-resolve.
- **Spying Mission** (101857) — its window is "if a bleed WOULD be
  successful", before the pool is lost, and it must remember which
  Methuselah for later. A different window and a different memory.
- **Paths in Two Worlds** (102300), **Gifts From Hereafter** (102325) —
  both conditioned on wraith/zombie allies, which are on the BLOCKED list.
- **Feral Hound** (102249), **Cappadocian Crypt** (102298), **Truth in
  Darkness** (102284) — "after resolution" as an ability of a card in play
  or a reaction rider, not a card played in this window.

## 7. Rulebook citations

- p. 25 — the acting minion locks at announcement; action states A/B/C.
- p. 27 — a blocked action does not resolve successfully; its cost is not
  paid.
- p. 34 — a vampire in torpor (the state Freak Drive may still be played
  from).
- p. 44 — wake effects last "for the duration of the action", which is why
  they are cleared as the frame finishes rather than at the window.
- p. 48 — the Freak Drive ruling quoted in §4.
