# Clan & Sect Tagging — Design

Status: **IMPLEMENTED** (2026-07-19; owner sign-off: clan/sect as
MinionState fields set by fixtures now / crypt-import in phase 7; full
9-card wave; Anarch Railroad boosts any Anarch actor). Implementation
notes: requirements are checked by a shared `meetsRequirements(minion,
spec)` helper (`requiresTitle`/`requiresSect`/`requiresClan`/
`requiresCapacity`); the clan-lock location is a generic overlay on
`compileMasterCard` (when `permanent.lockGrant` is set) reusing the
lock-to-use + `abilityOptions`/`useAbility` machinery and the existing
stealth/intercept "only when needed" derived checks; `refChooseSeatsBurn`
capBonus gained an `atLeast` direction and `refAllocateBurn` an
`excludeSelf`.

The cheapest mechanic that widens the most gates: tagging minions with a
**clan** and **sect**, plus the gating (`Requires an Anarch`, clan-locked
locations) that reads them. No new game flow — clan/sect are static facts
about a minion, like `title` already is. This gate ships the tagging
infrastructure and a wave of **~9 cards** whose only blocker was clan/sect.

---

## 1. Rulebook / data facts

- **Clan** is a proper field on every crypt card (`card.clan`) — 14 V5
  clans (Brujah, Gangrel, Ventrue, Malkavian, Nosferatu, Tremere,
  Toreador, Ministry, Banu Haqim, Salubri, Tzimisce, Ravnos, Lasombra,
  Hecata). Card text uses legacy names the crypt field renames:
  **Follower of Set → Ministry**, **Assamite → Banu Haqim**.
- **Sect** (Camarilla / Anarch / Sabbat / Independent) and **title** live
  only in crypt *card text* ("Anarch.", "Camarilla Prince of Melbourne:")
  — parsing them is a deck-import concern (phase 7), exactly like titles.
- Sects/clans are **static** — a minion's clan/sect does not change in the
  supported pool (clan-change and sect-change cards are out of scope).
  Contested-title and Path mechanics remain out of scope.

## 2. Kernel: state

```ts
export type Sect = "camarilla" | "anarch" | "sabbat" | "independent";

// MinionState gains (mirrors `title`):
clan: string | null;   // e.g. "Gangrel"; null for allies and untagged
sect: Sect | null;
```

Set by fixtures/tests now; parsed from crypt text at deck import (phase 7).
Allies have `clan: null, sect: null`. Both default to null in
`makeMinion`, so existing fixtures are unaffected beyond the field add.

## 3. Kernel: requirement gating

Spec-level requirement fields, checked wherever a card's playing minion is
chosen (compileActionCard / compilePoliticalAction / compileModifierOrReaction
/ compileCombatCard — a shared `meetsRequirements(minion, spec)` helper):

```ts
// CardSpec gains:
requiresSect?: Sect[];        // "Requires an Anarch" → ["anarch"]
requiresClan?: string[];      // rare on "Requires" clauses
requiresCapacity?: number;    // "…with capacity 5 or more"
```

`requiresTitle` already exists. "Requires an Independent or Anarch vampire
with capacity 5 or more" (Reckless Agitation) = `requiresSect:
["independent","anarch"]` + `requiresCapacity: 5`.

## 4. Kernel: clan/sect-locked locations (the main wave)

A generic **location-with-a-lock-grant** shape — "Unique location. Lock to
give a [clan/sect] minion you control +1 stealth/intercept." One compiler
path serves the whole family:

```ts
// CardSpec.permanent gains an optional:
lockGrant?: {
  grant: "stealth" | "intercept";
  amount: number;
  clan?: string;       // "Gangrel"
  sect?: Sect;         // "anarch"
  ownOnly?: boolean;   // "a Gangrel you control" vs "an Anarch"
};
```

Behavior (reuses the existing lock-to-use + `abilityOptions`/`useAbility`
machinery and the derived stealth/intercept "only when needed" rules):

- **grant "stealth"**: offered to the location's controller in the
  `action.effects` window when the **acting** minion is theirs (or any,
  if not `ownOnly`), matches the clan/sect, the location is unlocked, and
  stealth is *needed* (a block attempt whose blocker's intercept ≥ current
  stealth — the same test `modifyStealth` uses). Using it locks the
  location and emits `StealthModified +amount` on the action.
- **grant "intercept"**: offered to the location's controller during a
  block attempt when **their blocking** minion matches the clan/sect,
  intercept is *needed* (stealth > current intercept), and the location is
  unlocked. Using it locks the location and emits `InterceptModified
  +amount` on the blocker.

Locked until the controller's next unlock phase → the "once per turn"
cadence falls out of the existing permanent unlock reset.

## 5. Referendum-primitive tweaks (two sect-gated politicals)

Small extensions to existing primitives:
- `refChooseSeatsBurn.capBonus` gains a direction: `atLeast` as well as the
  current `atMost` — **Empires Fall** ("+3 if they control a ready vampire
  capacity 8 **or more**") vs Neonate Breach's "4 or less".
- `refAllocateBurn` gains `excludeSelf?: boolean` — **Reckless Agitation**
  ("among two or more **other** Methuselahs").

## 6. The wave (~9 cards)

**Clan-locked stealth locations** (`lockGrant` stealth, ownOnly):
| Card | Clan |
| --- | --- |
| **Backways** | Gangrel |
| **Elysian Fields** | Lasombra |
| **Fortune Teller Shop** | Ravnos |
| **The Labyrinth** | Nosferatu |
| **Opium Den** | Ministry |

**Intercept location** (`lockGrant` intercept, ownOnly):
| **Market Square** | Banu Haqim |

**Sect-locked location**: **Anarch Railroad** (Anarch, stealth, not ownOnly).

**Sect-gated political actions** (existing referendum vocab + §5 tweaks):
| **Empires Fall** (Sabbat) | `refChooseSeatsBurn` base 1, `atLeast 8` +3 |
| **Reckless Agitation** (Anarch/Independent, cap 5+) | `refAllocateBurn` 6, `excludeSelf` |

## 7. Deferred (out of this gate)

- Locations with a **second** ability (KRCG News Radio, WMRH Talk Radio,
  Wall Street Night, The Anarch Free Press, Carfax Abbey) — multi-ability
  bespoke, later.
- Clan-**conditional effects** ("+1 bleed if Toreador", Anarch Salon's
  per-Anarch payout, Invigorate's per-discipline riders) — each is a
  bespoke effect, swept individually later.
- Complex sect politicals (Cold War, War of Ages, Cardinal Benediction) —
  location-burn / permanent / title-granting referendums.
- Clan-change / sect-change / Path mechanics — out of scope.
- On-vampire clan permanents (Abbot, Libertas, Sight Beyond Sight) — the
  attach-with-a-static-and-restriction shape is its own follow-up.

## 8. Tests (once approved)

Kernel: a clan/sect requirement gates the play option (offered only to a
matching minion); a clan-lock location's stealth ability appears only
during that clan's action and only when stealth is needed; the intercept
ability appears only when that clan blocks and intercept is needed; the
location locks on use and recharges at unlock. Cards: one scenario per
wave card, negative space asserted (wrong-clan minion → no boost; Empires
Fall's +3 only vs a cap-8 controller). Fuzz: tag the fuzz vampires with a
clan/sect and add the wave; existing invariants hold.

## 9. Open questions for the owner

1. **Tagging model** — `clan`/`sect` as `MinionState` fields set by
   fixtures now, parsed from crypt text at import (phase 7), like `title`
   (recommended)? Or model sect/clan as attached title-style cards?
2. **Wave** — the ~9 above, or start with just the clan-lock stealth
   locations (the cleanest 5) and add intercept/sect/political after?
3. **"Give an Anarch +1 stealth"** (Anarch Railroad, no "you control") —
   treat as boosting the acting minion when it is Anarch regardless of
   controller (recommended; only ever useful on your own action), or
   restrict to own minions like the "you control" locations?
