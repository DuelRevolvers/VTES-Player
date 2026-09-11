/**
 * The How to Play reference — the rules of VTES as shown in the client.
 *
 * Every line here is a summary of the official V5 rulebook (the PDF one
 * folder above the repo), with the page it came from cited beside it, so a
 * player can check the source and a future editor can tell a summary from
 * an invention. Nothing here is derived from the engine: this is what the
 * PRINTED rules say, which is the point — it is the reference a player
 * checks when the table surprises them.
 *
 * Static data only. No DOM, no engine imports; `render.ts` wraps it.
 */

export interface RuleSection {
  /** Stable id, used for the <details> element. */
  id: string;
  title: string;
  /** Rulebook pages this section summarises, shown beside the title. */
  pages: string;
  /** Body markup. Authored here, so it needs no escaping. */
  body: string;
}

/**
 * A section's text with the markup taken out, for searching.
 *
 * Searching the raw body would match tag names and attributes — typing
 * "b" would hit every bold run, "p" every paragraph. Stripping first
 * means a search matches what the player can actually read.
 */
export function ruleText(s: RuleSection): string {
  return `${s.title} ${s.pages} ${s.body}`
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The sections matching a query, in the order they are written.
 *
 * Case-insensitive, and every whitespace-separated term must appear —
 * so "block stealth" finds the section that covers both, rather than
 * everything mentioning either. An empty query matches everything, which
 * is what makes the panel behave normally until somebody types.
 */
export function searchRules(query: string): RuleSection[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return RULE_SECTIONS;
  return RULE_SECTIONS.filter((s) => {
    const hay = ruleText(s).toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export const RULE_SECTIONS: RuleSection[] = [
  {
    id: "object",
    title: "Object of the game",
    pages: "p. 2",
    body: `
      <p>You are a <b>Methuselah</b> — an ancient vampire moving younger
      vampires around like pieces. Your goal is to <b>accumulate the most
      victory points by destroying the influence held by rival
      Methuselahs</b>.</p>
      <p>Influence is <b>pool</b>, the main currency of the game. You start
      with 30. You spend pool to bring vampires under your control, and
      those vampires act to reduce your rivals' pool. <b>A Methuselah who
      runs out of pool is ousted</b> from the game.</p>
      <p>You do not attack everyone. Seating is a food chain:</p>
      <ul>
        <li>The Methuselah <b>to your left is your prey</b> — the one you
        are trying to oust.</li>
        <li>The Methuselah <b>to your right is your predator</b> — the one
        trying to oust you.</li>
      </ul>
      <p>When your prey is ousted, the next Methuselah to their left
      becomes your new prey.</p>`,
  },
  {
    id: "table",
    title: "The table and setup",
    pages: "p. 14–16",
    body: `
      <p>Each Methuselah has two decks and several regions:</p>
      <ul>
        <li><b>Crypt</b> — the vampires you hope to control.</li>
        <li><b>Library</b> — 60–90 cards of everything else. You draw a
        hand of <b>seven</b>, and refill to seven immediately whenever a
        card leaves your hand.</li>
        <li><b>Uncontrolled region</b> — four crypt cards are dealt here
        <b>face down</b> at setup. Only you may look at them. Vampires wait
        here while you pay for them.</li>
        <li><b>Ready region</b> — your minions in play, face up, able to act
        and block.</li>
        <li><b>Torpor region</b> — vampires who took wounds they could not
        mend.</li>
        <li><b>Pool</b> — your 30 starting counters. Counters are called
        <i>pool</i> in your pool, <i>blood</i> on a vampire and <i>life</i>
        on an ally, but they are the same counters.</li>
      </ul>
      <p><b>The Edge</b> starts uncontrolled in the middle of the table. It
      passes to whoever makes a successful bleed, and its holder may gain
      1 pool in their unlock phase.</p>
      <p><b>Locking:</b> using a card turns it sideways 90°. Only
      <b>unlocked</b> minions can take actions or block. Unlocking happens
      at the start of your turn.</p>`,
  },
  {
    id: "turn",
    title: "The turn — five phases",
    pages: "p. 4, 17–37",
    body: `
      <p>Turns go clockwise. Every turn has the same five phases, in
      order:</p>
      <ol>
        <li><b>Unlock phase.</b> Unlock all your cards, then resolve
        anything that happens "during your unlock phase" in the order you
        choose. If you hold the Edge you may gain 1 pool. (p. 17)</li>
        <li><b>Master phase.</b> You get <b>one master phase action</b> by
        default — normally used to play one master card. Unused master
        phase actions are lost; they cannot be saved. A <b>trifle</b> gives
        you an extra one (only one per phase). (p. 18)</li>
        <li><b>Minion phase.</b> The long one. Your ready unlocked minions
        take actions; taking an action <b>locks</b> the acting minion. Each
        action must fully resolve before the next is taken. (p. 18)</li>
        <li><b>Influence phase.</b> You get <b>4 transfers</b> (only 1, 2
        and 3 on the first three turns of the game, to balance going
        first). (p. 35)
          <ul>
            <li>1 transfer: move 1 pool onto a vampire in your uncontrolled
            region.</li>
            <li>2 transfers: move 1 counter back off an uncontrolled
            vampire into your pool.</li>
            <li>4 transfers and 1 pool: move a vampire from your crypt to
            your uncontrolled region.</li>
          </ul>
          When an uncontrolled vampire has <b>counters equal to their
          capacity</b>, move them face up to your ready region, unlocked —
          the counters stay on them as blood.
        </li>
        <li><b>Discard phase.</b> One discard phase action: discard a card
        from hand and draw a replacement. Not saveable. (p. 36)</li>
      </ol>`,
  },
  {
    id: "actions",
    title: "Taking an action",
    pages: "p. 19–24",
    body: `
      <p>Any <b>ready unlocked</b> minion you control may act. A vampire's
      two basic actions need no card:</p>
      <ul>
        <li><b>Bleed</b> — directed at your prey, 0 stealth, no cost. If it
        succeeds, the target burns pool equal to the bleed amount
        (1 by default) and <b>you take the Edge</b>. A minion may bleed
        only once per turn, even if they unlock again. Allies may bleed
        too.</li>
        <li><b>Hunt</b> — undirected, <b>+1 stealth</b>, gain 1 blood. A
        ready unlocked vampire with <b>no blood must hunt</b>; that is a
        mandatory action, and none of your other minions may take a
        non-mandatory action while it is pending.</li>
      </ul>
      <p>Instead of a basic action a minion may play an <b>action card</b>,
      or use an action granted by a card in play. Other action types:
      <b>equip</b> (+1 stealth), <b>employ retainer</b>, <b>recruit
      ally</b>, <b>political action</b> (calls a referendum — always
      undirected, vampires only), <b>rescue from torpor</b> and
      <b>diablerise</b> (also spelt <i>diablerize</i> — drinking a torpid
      vampire dry, which calls a blood hunt on the diablerist).</p>
      <p><b>The course of an action</b> (p. 24):</p>
      <ol>
        <li><b>Announce.</b> Everything is fixed now — target, cost,
        effects — and the acting minion locks. The card is set aside, not
        yet resolved.</li>
        <li><b>Block attempts.</b> See the next section.</li>
        <li><b>Resolve.</b> If no block succeeded, <b>the cost is paid
        now</b> and the effect happens. A blocked action costs nothing.</li>
      </ol>
      <p>Throughout, the acting Methuselah always gets the first chance to
      play cards, then the others in order. Only the <b>acting minion</b>
      may play action modifiers; only <b>other</b> Methuselahs' ready
      unlocked minions may play reactions. The same minion cannot play the
      same modifier or reaction twice in one action.</p>`,
  },
  {
    id: "blocking",
    title: "Blocking, stealth and intercept",
    pages: "p. 25–26",
    body: `
      <p>Who may attempt a block depends on the action:</p>
      <ul>
        <li><b>Directed</b> (it targets another Methuselah or something
        they control): only the targeted Methuselahs may try.</li>
        <li><b>Undirected</b>: the acting Methuselah's <b>prey and
        predator</b> may try, prey first.</li>
      </ul>
      <p>A block succeeds if the blocker's <b>intercept is equal to or
      greater than</b> the acting minion's <b>stealth</b>. Both are 0 by
      default, so a block normally succeeds unless the action has inherent
      stealth (hunting, equipping) or someone plays a card.</p>
      <p>A failed attempt may be followed by another, as often as the
      blocking Methuselah likes — but once they decline further attempts,
      <b>that decision is final</b>. A successful block <b>locks the
      blocker</b> and combat begins.</p>
      <p class="rulenote"><b>Only when needed.</b> Stealth may be added
      only while the action is actually being blocked by a minion with
      enough intercept to stop it; intercept may be added only while the
      acting minion's stealth exceeds the blocker's. This is why a stealth
      card is not offered against an unopposed action — it is a rule, not a
      bug.</p>`,
  },
  {
    id: "combat",
    title: "Combat",
    pages: "p. 28–32",
    body: `
      <p>Combat happens in rounds. The two minions are <b>combatants</b>.
      Only <b>combat cards</b> may be played during combat, and the acting
      minion always gets the first opportunity at every step. Locked
      minions fight exactly the same as unlocked ones.</p>
      <p>Each round has <b>seven steps</b>:</p>
      <ol>
        <li><b>Before range</b> — cards that must be played before range is
        chosen.</li>
        <li><b>Determine range.</b> Close by default. A <b>maneuver</b>
        moves the range to long, or back to close. A minion has no
        maneuvers by default and cannot play two in a row.</li>
        <li><b>Before strikes</b> — after range is set, before strikes are
        chosen.</li>
        <li><b>Strike.</b> Each minion chooses a strike — a combat card, a
        weapon, or their hand strike — acting minion first, then both
        resolve <b>simultaneously</b>. Dodges are strikes too. Most strikes
        only work at close range; ranged strikes and "R" damage work at
        either.</li>
        <li><b>Damage resolution.</b> Prevent, then mend (below).</li>
        <li><b>Press</b> — continue into another round, or end combat.</li>
        <li><b>End of round.</b></li>
      </ol>
      <p>If a combatant is no longer ready at any point — burned or sent to
      torpor — <b>the round and the combat end immediately</b>.</p>
      <p><b>Weapons</b> are equipment that grant a strike, and their printed
      sub-type is what other cards filter on. A <b>melee weapon</b> strikes
      at <b>close</b> range only; a <b>gun</b> is a ranged weapon and works
      at <b>long range</b> too. A minion may carry several, but chooses only
      one strike per round.</p>`,
  },
  {
    id: "damage",
    title: "Damage, torpor and diablerie",
    pages: "p. 31–34",
    body: `
      <p>The minion taking damage may first play <b>prevention</b> cards,
      one at a time. Whatever is left is inflicted.</p>
      <p>A vampire <b>burns 1 blood to mend each point</b> of normal damage.
      Burning all their blood is harmless in itself. Damage they cannot
      mend leaves them <b>wounded</b>, and a wounded vampire <b>goes to
      torpor</b> once the rest of the damage is handled. An ally or retainer
      burns 1 <b>life</b> per point instead, and is burned when their last
      life goes.</p>
      <p><b>Aggravated damage</b> cannot be mended: the vampire goes
      straight to torpor. Against a vampire who is <b>already wounded</b>,
      each point of aggravated damage must be paid off with 1 blood or the
      vampire is <b>burned outright</b>. When both kinds land at once,
      normal damage is handled first.</p>
      <p><b>Torpor.</b> A vampire in torpor keeps everything on them. They
      can take no action but <b>leave torpor</b>, cannot block, cannot play
      reactions and must abstain from votes. They still unlock normally, and
      they may still play action modifiers during their own actions.</p>
      <p><b>Diablerie</b> is drinking a torpid vampire dry: the diablerist
      takes their blood and the victim is burned. It is resolved as a single
      indivisible unit — nothing interrupts it. Because vampiric society
      condemns it, a <b>blood hunt referendum is called automatically and
      immediately</b>; if it passes, the diablerist is burned. That
      referendum is not an action, so it cannot be blocked.</p>`,
  },
  {
    id: "cards",
    title: "Card types and common terms",
    pages: "p. 8–16",
    body: `
      <p><b>Master cards</b> are played by you, the Methuselah, with a
      master phase action. <b>Locations</b> stay in play and can be used
      repeatedly, even the turn they arrive. <b>Trifles</b> refund a master
      phase action. An <b>out-of-turn</b> master may be played on another
      Methuselah's turn, and costs you a master phase action next turn even
      if it is cancelled.</p>
      <p><b>Minion cards</b> are played by your vampires and allies:</p>
      <ul>
        <li><b>Action</b> — one per action, and never used to modify
        another action.</li>
        <li><b>Action modifier</b> — played by the acting minion, any time
        before resolution.</li>
        <li><b>Reaction</b> — played by another Methuselah's ready unlocked
        minion in response to an action. <b>A reaction does not lock the
        minion playing it.</b></li>
        <li><b>Combat</b> — playable only in combat.</li>
        <li><b>Equipment</b> — goes on the acting minion; burned when the
        bearer is. No limit on how many.</li>
        <li><b>Retainer</b> — goes on the acting minion with starting life;
        cannot be moved.</li>
        <li><b>Ally</b> — an independent non-vampire minion, with life.</li>
        <li><b>Political action</b> — calls a referendum, or can be burned
        during one for a vote. Vampires only.</li>
      </ul>
      <p>Terms worth knowing:</p>
      <ul>
        <li><b>Burn</b> — the card goes to its owner's <b>ash heap</b>
        (discard pile), which anyone may examine. Counters and cards on a
        burned card are burned with it.</li>
        <li><b>Control vs ownership</b> — you always <b>own</b> the cards
        you started with, even while a rival <b>controls</b> them. A master
        card in play is controlled by whoever played it, even when it sits
        on someone else's minion.</li>
        <li><b>"During X, do Y"</b> — only one Y per X, per card.</li>
        <li><b>"Lock X to do Y"</b> — needs an unlocked minion.</li>
        <li><b>Cancelled</b> — the card has no effect but still counts as
        played. A cancelled <i>action</i> card does not lock the minion and
        may be played again.</li>
      </ul>
      <p class="rulenote"><b>The Golden Rule:</b> whenever a card
      contradicts these rules, <b>the card takes precedence</b>.
      (p. 16)</p>`,
  },
  {
    id: "vampires",
    title: "Vampires: clan, sect, group, Disciplines",
    pages: "p. 5, 39–40",
    body: `
      <p>Every crypt card carries the same handful of traits, and most card
      requirements are written against one of them. A library card whose
      text begins <b>"Requires a …"</b> can only be played by a minion who
      matches — "Requires an Anarch", "Requires a prince or justicar",
      "Requires a vampire with capacity 7 or more". Some name the
      <b>Methuselah's board</b> instead ("Requires a <i>ready</i> Anarch"),
      which asks whether you control one, not who is playing the card.</p>
      <ul>
        <li><b>Capacity</b> — how much blood the vampire can hold, and what
        you pay to bring them out. A vampire with a larger capacity is
        <b>older</b>, a smaller one <b>younger</b>. A vampire can never hold
        more blood than their capacity; excess goes straight to the blood
        bank.</li>
        <li><b>Clan</b> — Brujah, Malkavian, Nosferatu, Toreador and the
        rest. Changing sect does not change clan.</li>
        <li><b>Sect</b> — <b>Camarilla</b>, <b>Sabbat</b>, <b>Anarch</b>,
        <b>Laibon</b>, or <b>Independent</b> for anyone unaligned. A vampire
        belongs to exactly one sect at a time. Being in a sect does nothing
        by itself — it only matters where a card says so.</li>
        <li><b>Group</b> — a number above the text box. A crypt must be
        built from a single group or <b>two consecutive</b> groups. Stealing
        a vampire in play ignores this.</li>
        <li><b>Disciplines</b> — the symbols along the bottom. They decide
        which library cards the vampire can play at all.</li>
      </ul>
      <p><b>Basic and superior.</b> A Discipline symbol in a <b>square</b> is
      the <b>basic</b> level: the vampire may use only the plain-text effect
      of a card requiring it. A symbol in a <b>diamond</b> is <b>superior</b>:
      they may use the plain text <i>or</i> the bold text — <b>not
      both</b>. (Players usually call the basic level the <b>inferior</b>;
      the rulebook only ever says <i>basic</i>.)</p>`,
  },
  {
    id: "titles",
    title: "Titles, votes and ballots",
    pages: "p. 28, 39–40",
    body: `
      <p>A referendum is decided by votes, and most votes come from
      <b>titled</b> vampires. A vampire has <b>at most one title</b>; gaining
      a second means losing the first, even if the new one is a demotion. A
      title needs the matching sect, and a vampire who leaves that sect loses
      the benefit until they return to it.</p>
      <p>Votes per <b>ready</b> titled vampire:</p>
      <ul>
        <li><b>Camarilla</b> — 1 primogen, 2 prince, 3 justicar, 4 Inner
        Circle.</li>
        <li><b>Sabbat</b> — 1 bishop, 2 archbishop, 3 cardinal, 4 regent.
        The <b>prisci</b> vote as a block worth 3.</li>
        <li><b>Anarch</b> — 2 baron.</li>
        <li><b>Laibon</b> — kholo and magaji.</li>
        <li>An <b>Independent</b> may carry votes printed on their own card,
        which count as a title of their own tied to no sect.</li>
      </ul>
      <p class="rulenote"><b>Locked vampires still vote.</b> Votes need the
      vampire to be <b>ready</b> — in the ready region — and being locked
      makes no difference at all. (p. 28)</p>
      <p><b>Ballots</b> are votes by another name, used by some cards; a
      minion must cast all their votes and ballots the same way. The
      <b>Edge</b> can be burned for 1 vote, and a political action card can
      be burned from hand for 1 — at most one card vote per Methuselah per
      referendum.</p>
      <p><b>City titles</b> — prince, baron and archbishop are tied to a
      named city, and two vampires claiming the same city contest it.
      Primogen, bishop, cardinal and priscus are not unique.</p>`,
  },
  {
    id: "terms",
    title: "More terms from the rulebook",
    pages: "p. 3, 16, 41–44",
    body: `
      <ul>
        <li><b>Blood bank</b> — the shared supply counters come from and
        return to. It is not anybody's pool: blood burnt from a vampire, or
        drained as excess over capacity, goes <b>here</b>, not to a
        Methuselah. (p. 3)</li>
        <li><b>Hand size</b> — seven by default. Whenever an effect changes
        your hand size, <b>or adds or removes cards from your hand</b>, you
        immediately draw up or discard down to match. That applies however
        the card left: a play, a cost, a forced discard. An empty library
        simply draws nothing. (p. 7)</li>
        <li><b>(limited)</b> — printed on cards whose bonus will not stack.
        Only one limited bleed bonus per bleed, and a minion may use only
        one source of additional strikes per round. (p. 43)</li>
        <li><b>Unique</b> — only one copy may be in play at a time. Vampires
        are unique by default. (p. 44)</li>
        <li><b>Contested</b> — if two Methuselahs bring the same unique card
        (or the same vampire) into play, every copy is turned <b>face down
        and out of play</b>, and each holder pays <b>1 pool in every one of
        their unlock phases</b> to keep contesting. Instead of paying you
        may <b>yield</b>, which <b>burns</b> your copy along with anything
        stacked on it; when everyone else has yielded, the survivor's copy
        comes back unlocked at their next unlock phase. A <b>contested
        title</b> works the same way but costs the <b>vampire 1 blood</b>,
        they count as having <b>no title</b> meanwhile, and a vampire in
        torpor or with no blood must yield — for good. (p. 17–18)</li>
        <li><b>Search</b> — you need not announce what you are looking for,
        and searching <b>may find nothing</b>. If you search your library or
        crypt you <b>must shuffle it afterwards</b>, whether or not you took
        anything. (p. 16)</li>
        <li><b>Removed from the game</b> — stronger than burning: such a
        card goes to no zone and cannot be retrieved or affected in any way.
        Counters and cards on it are burned. (p. 16)</li>
        <li><b>Wake</b> — a vampire who <b>wakes</b> during an action may
        block it and play reaction cards as though unlocked, for that action.
        A card that merely unlocks a vampire is <b>not</b> a wake effect.
        (p. 44)</li>
        <li><b>Sterile</b> — a sterile vampire cannot perform actions that
        put new vampires into play. (p. 41)</li>
      </ul>`,
  },
  {
    id: "cardwords",
    title: "Words that come from cards, not the rulebook",
    pages: "—",
    body: `
      <p>Every other section here summarises the printed rulebook. <b>These
      do not appear in it at all</b> — they are printed on cards, and a card
      always beats the rulebook (the Golden Rule). They are listed because
      they look like rules terms and a player will reasonably go looking for
      them.</p>
      <ul>
        <li><b>Printed sub-types</b> — a card's second line often narrows
        what it is, and other cards filter on exactly that word:
        <b>location</b>, <b>hunting ground</b>, <b>archetype</b> (a vampire
        may have only one), <b>ghoul</b>, <b>animal</b>, <b>vehicle</b>
        (a minion may have only one), <b>electronic</b>, <b>wraith</b>,
        <b>zombie</b> and <b>Nod fragment</b>. A "wraith" is an ordinary
        ally with that word printed on it — nothing in the rules treats it
        specially, and the same goes for "electronic": it is a label other
        cards name, not a rule of its own.</li>
        <li><b>Keywords</b> — a single word on its own line above the card
        text. This set has four: <b>Grapple</b>, <b>Aim</b>, <b>Boon</b>
        and <b>Ammo</b>. Only one aim may be played per strike.</li>
        <li><b>Ammo</b> — loaded into a <b>gun</b> after strikes have been
        declared but before they resolve, and it changes what that gun's
        strikes do <b>for the rest of the combat</b>. Only one ammo card
        per gun per combat, and only onto a gun your own minion is
        striking with — never an opponent's weapon.</li>
        <li><b>Frenzy</b> — cards that force a vampire into a rage. What
        frenzy does is written on each card; the rulebook does not define
        it.</li>
        <li><b>Corruption counters</b> — placed on a minion and tracked
        <b>per Methuselah</b>: they are yours, and only your cards read
        them.</li>
        <li><b>Stun</b> — used by two cards and defined by neither. This
        client rules it as: <b>lock the minion and put a stun counter on
        them; a minion with stun counters does not unlock as normal, and
        during that unlock phase all the stun counters they had at the
        start of the turn are burned.</b></li>
        <li><b>Paths</b> — a printed trait on some Sabbat crypt cards, like
        clan or sect: <b>Cathari</b>, <b>Death and the Soul</b>, <b>Power
        and the Inner Voice</b>, and <b>Caine</b>. Nothing puts a vampire on
        a Path or takes them off one; cards only ask which one they were
        printed with.</li>
        <li><b>A library card that becomes a vampire</b> — two cards say
        "put this card in play; it becomes a 1-capacity (non-unique)
        vampire". Players call these <b>tokens</b>. They are vampires in
        every respect, and they arrive with no blood, so p. 21's
        mandatory hunt is what makes them hunt at once.</li>
      </ul>`,
  },
  {
    id: "winning",
    title: "Ousting and victory points",
    pages: "p. 37",
    body: `
      <p>A Methuselah reduced to 0 pool is <b>ousted</b> and leaves the
      game, taking every card they control with them. The game continues
      until one Methuselah is left.</p>
      <p>You gain <b>1 victory point and 6 pool</b> whenever <b>your
      prey</b> is ousted — no matter who actually did it. (If you are
      ousted at the same moment as your prey, you get the victory point but
      not the pool.) The last Methuselah standing gets <b>one additional
      victory point</b>.</p>
      <p>The winner is whoever has the most victory points at the end —
      <b>even if they were ousted</b>. A tie means nobody wins.</p>`,
  },
  {
    id: "client",
    title: "Playing in this client",
    pages: "",
    body: `
      <p>This is the debug/playtest table, so a few things are worth
      knowing:</p>
      <ul>
        <li><b>Your hand is the interface.</b> A card you can legally play
        is lit and lifts when you hover it. Click it: one legal play
        resolves straight away, several open a chooser on the card
        itself.</li>
        <li><b>Drag a hand card</b> onto a minion or mat to play it — only
        that card's legal targets light up. Drag it onto <b>another hand
        card</b> to sort your hand instead. Sorting is cosmetic and is never
        undone by Undo.</li>
        <li><b>A locked card is turned 90°</b>, as on a real table, and
        makes room for itself so it does not cover its neighbours.</li>
        <li><b>Hover any card</b> for a full-size scan and its rules
        text.</li>
        <li><b>Hidden information is masked</b> — cards you may not see show
        as card backs. ⚙ Settings has a debug switch that reveals
        everything, plus per-seat <b>auto-pass</b> for seats with nothing to
        decide.</li>
        <li><b>Undo, Save and Load</b> replay the game from its command log,
        so a loaded game is the same game, not a snapshot.</li>
        <li>The <b>game log</b> on the right narrates every event in plain
        English and can be filtered.</li>
      </ul>`,
  },
];

/**
 * The Dark Pack notice. This project is a non-commercial fan work, and the
 * card data and scans are KRCG's; the How to Play panel is the natural
 * place for both to be stated.
 */
export const CREDITS = `
  <p>Rules summarised from the official <i>Vampire: The Eternal Struggle</i>
  Fifth Edition rulebook; page citations point back to it. Card text and
  scans come from <b>KRCG</b> (static.krcg.org), the official VEKN data,
  used with permission.</p>
  <p>Portions of the materials are the copyrights and trademarks of Paradox
  Interactive AB, and are used with permission. All rights reserved. For
  more information please visit
  <b>worldofdarkness.com</b>. This is a non-commercial fan project under the
  Dark Pack agreement.</p>`;
