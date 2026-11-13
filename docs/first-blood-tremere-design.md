# First Blood Tremere (wave 118) — DESIGN, awaiting owner review

The owner approved this wave on November 13, 2026, including opening
Tremere groups 4–5. The readings in section 1 and the questions in
section 3 need review before kernel code.

Target: the First Blood Tremere precon, 87% before this wave. It is
missing six Tremere vampires from groups 4–5 and one library card.

| Card | Cap | Text (KRCG) | Rulings |
|---|---|---|---|
| Aidan Lyle (200025) | 7 | Camarilla. Aidan gets 1 optional press each combat. | none |
| Claus Wegener (200280) | 5 | Camarilla. (no ability) | — |
| Muhsin Samir (201020) | 6 | Camarilla. (no ability) | — |
| Rutor (201213) | 7 | Camarilla. Tzimisce get -1 intercept against Rutor. | none |
| Troius (201388) | 8 | Prince of Geneva. Troius cannot cast votes or ballots against blood hunt referendums. +1 strength. | none |
| Zane (201501) | 5 | Primogen. If Zane is not a prince, he can call a referendum to receive (and contest) the title held by a prince as a +1 stealth political action. | [LSJ 20100129] [ANK 20191228]: can't be used if the terms have no legal choice |
| Charnas the Imp (100335) | retainer, 1 blood, Tremere | Unique demon with 1 life. Put Charnas on a minion (this is a +1 stealth Ⓓ action if the target minion is controlled by another Methuselah). Charnas inflicts 1 damage on the employer during their unlock phase. Charnas is immune to damage from the employer. If the employer is about to be burned, their controller can put Charnas on another minion. | see section 1, item 6 |

Claus and Muhsin print no ability and enter free when the groups open.

## 0. The torpor ruling (owner, November 13, 2026)

> A vampire's abilities work only while the vampire is ready, unless the
> card says the ability works while the vampire is elsewhere.

The rulebook doesn't say this itself. Page 34 lists what a vampire in
torpor can't do: perform actions other than leaving torpor, block, play
reactions, and cast votes or ballots. It doesn't switch off card text. So
this ruling is a house rule that goes further than the printed rules, and
it is recorded in `CLAUDE.md` under "Owner decisions on record".

**It changes nothing in this wave.** Every ability here is already
limited to a ready vampire by the rules that use it:

- **Aidan and Troius's strength:** a vampire in torpor can't enter combat
  (p. 23).
- **Rutor and Zane:** they apply only while the vampire acts.
- **Troius's vote bar:** a vampire in torpor can't vote at all (p. 34).

**It is not yet enforced engine-wide.** The engine has no central gate.
Each clause checks `isReady` itself, or doesn't. Enforcing the ruling
across the 245 crypt cards in the pool is an audit of its own, proposed
as a separate piece of work in section 3.

## 1. Readings proposed

1. **Aidan** is `flatCrypt` with `pressPerCombat: 1`, the shape Abaddon
   already uses. Nothing new.
2. **Rutor** extends the existing static `opposingInterceptPenalty`
   (Stolen Police Cruiser) with a `clans` arm. `blockerMatchesFilter`
   gains the matching arm, a fourth set in the same union. **The clause
   is inert today:** the pool has no Tzimisce vampire (the V5 crypt has
   no Vicissitude). It is whole, and the test builds a Tzimisce blocker
   in the fixture to prove the penalty lands. Rutor's own `vic` is
   printed data and needs no work.
3. **Troius's vote bar** is a new static, `cannotVoteAgainstBloodHunt`.
   It removes only the AGAINST direction, and only when the referendum's
   `variant` is `"bloodHunt"`. Two places offer a vampire's votes: the
   `both` helper in `pollingOptions` and the blood-vote offers (Mob Rule,
   Rant!). Both call one new helper, `vampireMayVoteThatWay(rf, m,
   inFavor)`, beside `vampireMayVote`, so the two can't drift. A ballot is
   part of the vampire's vote group (p. 28), so the same bar covers it.
   Troius can still vote FOR a blood hunt and can vote either way on any
   other referendum. His +1 strength is the third argument of `condCrypt`.
4. **Zane** is a granted political action, the shape Benjamin Rose
   already uses:
   - **Offered when:** Zane is ready and unlocked, his title isn't
     prince, and at least one other vampire in play holds the prince
     title uncontested [LSJ 20100129]. That vampire can belong to any
     Methuselah, including Zane's controller.
   - **Terms:** the caller chooses one prince. The choice is re-checked
     at resolution.
   - **If it passes:** Zane gets `TitleGranted` with `prince` and the
     chosen prince's city. Page 39 says a vampire can't hold more than one
     title, so Zane loses primogen. Both vampires now claim the same city,
     so the engine's existing state check starts the title contest
     (p. 18). No new contest code is needed.
   - **If the chosen prince is gone or no longer holds the title at
     resolution:** the referendum passes with no effect.
   - **Polarity:** the action declares `referendumEffect` as moving no
     pool, as `referendumPolarity` requires.
5. **Charnas, employing.** This is the wave's new mechanic. Every
   retainer today goes on the acting minion (`compileRetainer` and
   `permanentActionOptions`). Charnas is a new retainer option, an
   `employOn: "anyMinion"` spec field:
   - The acting minion must be a ready Tremere vampire. The Tremere icon
     on a retainer is a requirement (p. 10).
   - The target is any minion in play: the actor, another of your own
     minions, or a minion of another Methuselah.
   - On your own minion, the action is the normal undirected +1 stealth
     employ action (p. 22). On another Methuselah's minion, it is a +1
     stealth action directed at that Methuselah. Either way, it is still
     an employ action [ANK 20230408] [LSJ 20050313].
   - The target is re-checked at resolution. If it has left play, the
     action fizzles and Charnas is burned.
   - Charnas stays under the control of the Methuselah who played it.
   - Charnas is unique. Uniqueness is checked across the table, and the
     existing contested-card code covers a second copy.
   - A copy put in play by any other effect goes on the playing minion
     [LSJ 20090824] [LSJ 20051121].
6. **Charnas, in play:**
   - **Unlock damage:** during the unlock phase of the employer's
     controller, Charnas inflicts 1 damage on the employer. The damage is
     normal and preventable. It is retainer damage, not environmental
     damage.
   - **Immunity:** Charnas is immune to damage whose source is the
     employer. Immune means the damage isn't inflicted, even if it can't
     be prevented [LSJ 20010627]. The employer can still use effects that
     would damage Charnas; Charnas just takes none of the damage
     [RTR 19941109].
   - **Moving:** when the employer is about to be burned, the employer's
     controller is offered a choice: move Charnas to any other minion in
     play, or let it burn. Declining is `pass`. The Spanish and French
     printings say "any minion", so the target isn't limited to the
     controller's own minions. The choice is raised before the burn
     resolves.
   - **Ousting:** if the controller of the minion Charnas is on is
     ousted, Charnas is removed from the game, not burned [ANK 20180408].

## 2. Tests planned

One file, `tests/cards/first-blood-tremere.test.ts`, with the
`asVampire` and `walk` helpers. Each card gets positive and negative
cases:

- **Aidan:** an optional press is offered once per combat. Use the
  existing `pressPerCombat` assertions.
- **Rutor:** a Tzimisce blocker built in the fixture has -1 intercept. A
  non-Tzimisce blocker doesn't.
- **Troius:**
  - Against a blood hunt: he gets no AGAINST option, either from his
    title votes or from a blood-vote offer.
  - On the same blood hunt: he gets a FOR option.
  - On a normal referendum: he gets both options.
  - In combat: +1 strength.
- **Zane:**
  - The action isn't offered with no prince in play, or while Zane is a
    prince.
  - If it passes: the title moves to Zane, primogen is gone, and the
    contest starts.
  - If the chosen prince is gone before resolution: no effect.
- **Charnas:**
  - Employing on your own minion is undirected. Employing on a rival's
    minion is directed, and only that rival's minions can block.
  - A non-Tremere vampire isn't offered the card.
  - Unlock damage hits the employer in the right seat's unlock phase.
  - Damage from the employer doesn't reach Charnas.
  - The move is offered when the employer is about to burn, and `pass`
    lets Charnas burn.
  - When the host's controller is ousted, Charnas is removed from the
    game.

All seven cards join the fuzz decks.

## 3. Questions for the owner

1. **Charnas's move clause.** Is "any other minion in play, at any seat"
   right? It follows the Spanish and French text. The other reading is
   your own minions only.
2. **Enforcing the torpor ruling engine-wide.** Should a separate audit
   run after this wave? It would sweep every crypt ability in the pool
   for clauses that still work while the vampire is in torpor or
   elsewhere, and add one central readiness gate with an opt-out for
   cards that say they work elsewhere. It needs its own design doc first.
