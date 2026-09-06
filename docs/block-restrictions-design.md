# Block Restrictions — Gate 3 (IMPLEMENTED)

Status: APPROVED — implementing (doc-per-gate; owner makes the scope calls).

## What this covers

Action modifiers that remove blockers from an action: "allies cannot
block this action", "the chosen vampire cannot block this action", and
(infrastructure) "titled/vampires cannot block". This is a filter on the
**block-eligibility generator**, not a new window — the restriction is set
while the acting minion plays its modifiers (which resolve *before* the
block window opens in the impulse cycle), then consulted when each
non-acting seat is offered `block:<minion>` options.

## Mechanic

- `ActionFrame.blockRestrictions = { noAllies, noVampires, noTitled,
  cannotBlock: MinionId[] }` (new; initialized empty at every ActionFrame
  construction site).
- `blockOptions` skips a minion `m` when: `noAllies && m.kind==="ally"`,
  `noVampires && m.kind==="vampire"`, `noTitled && m` is a titled vampire,
  or `cannotBlock.includes(m.id)`.
- Op `restrictBlocking(who, chosen?)` sets the field on the current action.
- Primitive `blockRestriction { who: "allies"|"vampires"|"titled"|
  "chosen"; chosenScope?: "younger"|"any" }`. For `who:"chosen"` the
  compiler enumerates one option per eligible in-play vampire (all seats,
  excluding the acting minion; `younger` filters to capacity < the acting
  minion's), carrying the pick as the `target` param — same pattern as
  `redirectBleed`.

## Cards shipped

- **Visions of Gehenna** (102264, `[pre]` action modifier): basic — allies
  cannot block; superior — only during a bleed, as above +2 bleed
  (limited).
- **Seduction** (101712, `[dom]` action modifier): basic — choose a
  younger vampire, it cannot block; superior — choose any vampire.

## Deviations / notes

- Seduction's "Only usable as the action is announced" is not modeled as a
  distinct timing gate: action modifiers already resolve in the acting
  seat's pre-block window, so the restriction is always in place before any
  block is declared. The clause only matters against effects that would
  let a modifier be replayed after blocks, which we do not have.
- `noVampires`/`noTitled` are built now but only reachable once a shipping
  card uses them (e.g. Propaganda's titled-cannot-block, deferred for its
  lock rider). They cost nothing and keep the gate complete.
- Cards that pair a block restriction with an unmodeled rider (Slaughtering
  the Herd's attach, Propaganda's lock, Beast Meld, Daring the Dawn,
  Libertas, The Sleeping Mind, Invigorate, Dominant Personality, Seeds of
  Terror) are left for their respective gates / one-off phase.
