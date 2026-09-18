# The burn option icon

Built 2026-09-14 (v0.10.35) for **Sight Beyond Sight** (101745), the only
card in the pool that prints it. Found by the library audit of the same
day, which otherwise cleared the pool.

## §1 The rule

Rulebook p. 17, *Advanced rules*: "Some cards have a burn option icon.
This icon means that a Methuselah who does not control a minion who meets
the requirements of this card or who is a legal target for it, may discard
it during ANY Methuselah's unlock phase and replace it. Each Methuselah is
limited to one such discard each unlock phase."

Three things in it: a **hand** card (every other unlock-phase option in the
engine is a card in play); a window that is open to **every** seat, not
only the turn's; and a **per-Methuselah, per-unlock-phase** limit.

## §2 The build

- `CardSpec.burnOption: true` compiles to
  `CardHandler.burnOptionDiscardable(state, seat)`, which reads the spec's
  own `requires*` fields and its attach filter over every minion the seat
  controls. A Salubri in torpor is still "a minion who meets the
  requirements", so readiness is not asked; `permanent.attach` targets
  (which are ready-only by construction) are asked through
  `attachTargets`. Nothing about Sight Beyond Sight is written into the
  engine — any card that sets the flag gets the rule.
- `engine.unlockWindowOptions(seat)` is the one helper every unlock-window
  site now asks (the turn seat's decision, the "next other seat" probe and
  the pass path all read it; before this they each called
  `abilityOptionsFor(seat, "turn.unlock")` separately — three sites for
  one question, the drift shape). It appends `burnOption:<cardId>` for each
  qualifying hand card unless the seat is in `TurnFrame.burnOptionUsed`.
- Applying it is `discardFromHand(seat, card, true)` — the discard-phase
  path, replacement included (p. 7) — and the seat joins `burnOptionUsed`.
  The field is optional so saves and fixtures written before it load.

## §3 Reading taken

"Meets the requirements … or is a legal target" is read as: the card
could be played on/by a minion this seat controls, ignoring cost and
timing. Cost is not a requirement (p. 10 lists them separately), and a
Methuselah too poor to play the card today still controls a minion who
meets it.
