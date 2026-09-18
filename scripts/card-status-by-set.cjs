const fs=require("fs");
const raw=JSON.parse(fs.readFileSync("data/vtes-raw.json","utf8"));
const cards=Array.isArray(raw)?raw:(raw.cards??Object.values(raw));
const reg=JSON.parse(fs.readFileSync("src/cards/registry.json","utf8")).entries;
const v5=new Set(JSON.parse(fs.readFileSync("config/v5-sets.json","utf8")));
const isCrypt=c=>c.types.includes("Vampire")||c.types.includes("Imbued");
// pool disciplines = those printed on V5 crypt cards
const poolDisc=new Set();
for(const c of cards) if(isCrypt(c)&&Object.keys(c.sets).some(s=>v5.has(s))) (c.disciplines||[]).forEach(d=>poolDisc.add(d.toLowerCase()));
const cat=c=>{const e=reg[c.id];
  if(e) return e.supported?"built":"whole";
  if(c.types.includes("Imbued")) return "imb";
  if(isCrypt(c)){const t=(c.card_text||"").trim().replace(/^Advanced,\s*/i,"");return /^[^.:]*\.\s*$/.test(t)?"c7w":"c7a";}
  const d=(c.disciplines||[]).map(x=>x.toLowerCase());
  if(d.length===0) return "t1";
  return d.every(x=>poolDisc.has(x))?"t2":"t3";};
const sets={};const rel={};
for(const c of cards){const k=cat(c);
  for(const [s,ps] of Object.entries(c.sets)){
    (sets[s]??={n:0,built:0,whole:0,t1:0,t2:0,t3:0,c7w:0,c7a:0,imb:0});sets[s].n++;sets[s][k]++;
    const d=ps.find(p=>p.release_date)?.release_date;if(d&&(!rel[s]||d<rel[s]))rel[s]=d;}}
const tot={n:0,built:0,whole:0,t1:0,t2:0,t3:0,c7w:0,c7a:0,imb:0};
for(const c of cards){tot.n++;tot[cat(c)]++;}
const pct=(a,b)=>b?Math.round(100*a/b)+"%":"–";
// --- Precon decks -----------------------------------------------------------
// The deck-legality numbers and the crypt-group rule are src/ui/decks.ts's
// (MIN_CRYPT / MIN_LIBRARY / MAX_LIBRARY / cryptGroupProblem) and the verdict
// is src/ui/deckimport.ts's `summarisePrecon`. Restated here because this is a
// .cjs report script that cannot import the TypeScript UI — if those move,
// move these. `tests/ui/deckimport.test.ts` pins the verdict itself.
const MIN_CRYPT=12,MIN_LIBRARY=60,MAX_LIBRARY=90;
let legacyIllegal=0;
const precons=JSON.parse(fs.readFileSync("src/cards/registry.json","utf8")).precons;
let playableCount=0,fullyImplemented=0;
const preconRows=precons.map(p=>{
  let crypt=0,lib=0,copies=0,built=0;const groups=new Set();const unbuilt=new Set();
  for(const {id,copies:n} of p.cards){
    const e=reg[id];copies+=n;
    // A card the registry does not carry is not in the pool at all — it can
    // never be built, so it counts against the deck rather than being skipped.
    if(!e) {unbuilt.add(String(id));continue;}
    if(e.card.kind==="crypt"){crypt+=n;groups.add(e.card.group);built+=n;}
    else{lib+=n;if(e.supported)built+=n;else unbuilt.add(e.card.name);}
  }
  const g=[...new Set([...groups].map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);
  const why=[];
  if(crypt<MIN_CRYPT) why.push(`crypt ${crypt} < ${MIN_CRYPT}`);
  if(lib<MIN_LIBRARY) why.push(`library ${lib} < ${MIN_LIBRARY}`);
  if(lib>MAX_LIBRARY) why.push(`library ${lib} > ${MAX_LIBRARY}`);
  if(g.length>1&&g[g.length-1]-g[0]>1) why.push(`crypt groups ${g.join(", ")}`);
  if(unbuilt.size>0) why.push(`${unbuilt.size} not implemented`);
  if(why.length===0) playableCount++;
  if(built===copies) fullyImplemented++;
  return `| ${p.name} | ${p.set} | ${crypt} | ${lib} | **${pct(built,copies)}** | ${why.length===0?"yes":"no"} | ${why.join("; ")||"—"} |`;
});
// --- Precon decks OUTSIDE V5 ------------------------------------------------
// The registry's `precons` are V5-only BY CONSTRUCTION (build-registry.mts
// hands `collectPrecons` the V5 pool, so a widened card cannot drag its
// legacy set's precons in half-built). These decks are therefore NOT in the
// registry and are read straight out of the KRCG snapshot — they are a
// REPORT on how far the pool is from playing them, and admit nothing.
//
// Two filters, both the owner's (2026-09-15):
//
// 1. NOT A DECK. Several `precon` entries in the snapshot are bundles, tins
//    or print-on-demand singles lists rather than preconstructed decks —
//    Tenth Anniversary's tins are 100 distinct cards at one copy each, and
//    Print on Demand is 943. A deck list with one copy of everything is not
//    a deck list.
// 2. ORIGINALS OF RE-RELEASES. Where the same clan deck exists as an
//    original and as a later re-release, the RE-RELEASE is listed and the
//    original dropped. Only two products qualify, confirmed by release date
//    rather than by memory: Camarilla Edition (2002) → First Blood (2019),
//    and Final Nights (2001) → Lords of the Night (2007). Camarilla
//    Edition's Brujah has no First Blood counterpart, so it is not the
//    original OF anything and stays.
const NOT_DECKS = new Set([
  "2018 Humble Bundle",
  "Anthology",
  "Heirs to the Blood Reprint",
  "Keepers of Tradition Reprint",
  "Print on Demand",
  "Tenth Anniversary",
  "The Unaligned",
]);
// set -> the set that re-released it; a deck is dropped only when a deck of
// the SAME NAME exists there.
const RERELEASED_BY = { "Camarilla Edition": "First Blood", "Final Nights": "Lords of the Night" };
const legacyDecks = new Map();
for (const c of cards) {
  for (const [set, printings] of Object.entries(c.sets ?? {})) {
    if (v5.has(set) || NOT_DECKS.has(set)) continue;
    for (const p of printings) {
      if (typeof p.precon !== "string" || !p.precon || typeof p.copies !== "number") continue;
      const key = `${set} :: ${p.precon}`;
      let d = legacyDecks.get(key);
      if (!d) {
        d = { set, name: p.precon, crypt: 0, lib: 0, copies: 0, built: 0, groups: new Set() };
        legacyDecks.set(key, d);
      }
      d.copies += p.copies;
      if (isCrypt(c)) { d.crypt += p.copies; d.groups.add(c.group); }
      else d.lib += p.copies;
      // Implemented reads the SAME rule as the V5 table: a crypt card in the
      // registry is whole by definition, a library card must be `supported`.
      const e = reg[c.id];
      if (e && (e.card.kind === "crypt" || e.supported)) d.built += p.copies;
    }
  }
}
for (const [key, d] of [...legacyDecks]) {
  const newer = RERELEASED_BY[d.set];
  if (newer && legacyDecks.has(`${newer} :: ${d.name}`)) legacyDecks.delete(key);
}
const legacyRows = [...legacyDecks.values()]
  .sort((a, b) => (rel[a.set] ?? "9999").localeCompare(rel[b.set] ?? "9999")
    || a.set.localeCompare(b.set) || a.name.localeCompare(b.name))
  .map((d) => {
    const g = [...d.groups].map(Number).filter(Number.isFinite).sort((x, y) => x - y);
    const why = [];
    if (d.crypt < MIN_CRYPT) why.push(`crypt ${d.crypt} < ${MIN_CRYPT}`);
    if (d.lib < MIN_LIBRARY) why.push(`library ${d.lib} < ${MIN_LIBRARY}`);
    if (d.lib > MAX_LIBRARY) why.push(`library ${d.lib} > ${MAX_LIBRARY}`);
    if (g.length > 1 && g[g.length - 1] - g[0] > 1) why.push(`crypt groups ${g.join(", ")}`);
    const legal = why.length === 0;
    if (!legal) legacyIllegal++;
    // NOT called "playable as printed": the V5 table's verdict also requires
    // nothing unimplemented, and by that rule every deck here would read
    // "no" and the column would carry no information. This one is deck
    // LEGALITY alone — the size and group rules — with implementation in the
    // column beside it. Two questions, two names, so they cannot be read as
    // one (CLAUDE.md: one question asked in two places will drift).
    return `| ${d.name} | ${d.set} | ${(rel[d.set] ?? "").slice(0, 4)} | ${d.crypt} | ${d.lib} | **${pct(d.built, d.copies)}** | ${legal ? "yes" : "no"} | ${why.join("; ") || "—"} |`;
  });
const row=(name,s)=>`| ${name} | ${s.n} | ${s.built} | **${pct(s.built,s.n)}** | ${s.whole} | ${pct(s.built+s.whole,s.n)} | ${s.t1} | ${s.t2} | ${s.t3} | ${s.c7w} | ${s.c7a} | ${s.imb} |`;
const order=Object.keys(sets).sort((a,b)=>(rel[a]??"9999").localeCompare(rel[b]??"9999")||a.localeCompare(b));
let out=`# Card status by set

> **Generated ${new Date().toISOString().slice(0,10)} from \`data/vtes-raw.json\` and \`src/cards/registry.json\`** by
> the script in this doc's footer. Re-run it rather than editing the numbers.
> A card printed in several sets is counted in each of them; the totals row
> counts unique cards.

## States

- **Built** — in the registry and \`supported\`: it does everything it prints
  (\`tests/cards/no-partial-cards.test.ts\`). Playable now.
- **Whole, no build** — a V5 crypt card printing no ability. In the pool and
  whole; there is nothing to build. "In pool %" is Built + this column.
- **Planned** — not in the pool yet. Which wave of \`docs/pool-widening-design.md\`
  will take it:
  - **T1** — library, no discipline (§6 tranche 1, in progress, ~1,100 left).
  - **T2** — library, only disciplines the V5 crypt already has (§6 tranche 2).
  - **T3** — library needing a legacy discipline (§6 tranche 3).
  - **§7 gate** — legacy vampire printing no ability. Already whole; enters
    the pool the moment the owner opens its group in
    \`config/crypt-groups.json\` (the crypt stays V5-only until then).
  - **§7 build** — legacy vampire printing an ability with no
    implementation. Clan-by-clan waves after the library.
- **Imbued** — a different card type (life, conviction, powers) the engine
  has no model for. Out of scope; no wave is planned.
- The **V5 product line** (\`config/v5-sets.json\`) is marked ★ — 100% in pool.

## By set

| Set | Cards | Built | Built % | Whole, no build | In pool % | T1 | T2 | T3 | §7 gate | §7 build | Imbued |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
`;
for(const s of order) out+=row((v5.has(s)?"★ ":"")+s+(rel[s]?` (${rel[s].slice(0,4)})`:""),sets[s])+"\n";
out+=row("**All unique cards**",tot)+"\n";
out+=`
## Totals

| | Cards | % |
|---|---:|---:|
| Built | ${tot.built} | ${pct(tot.built,tot.n)} |
| Whole, no build (V5 crypt) | ${tot.whole} | ${pct(tot.whole,tot.n)} |
| Planned T1 (library, no discipline) | ${tot.t1} | ${pct(tot.t1,tot.n)} |
| Planned T2 (library, pool disciplines) | ${tot.t2} | ${pct(tot.t2,tot.n)} |
| Planned T3 (library, legacy discipline) | ${tot.t3} | ${pct(tot.t3,tot.n)} |
| Planned §7 gate (legacy vampire, whole) | ${tot.c7w} | ${pct(tot.c7w,tot.n)} |
| Planned §7 build (legacy vampire, ability) | ${tot.c7a} | ${pct(tot.c7a,tot.n)} |
| Imbued (out of scope) | ${tot.imb} | ${pct(tot.imb,tot.n)} |
| **Total** | **${tot.n}** | 100% |

Nothing is cut or blocked: every card not yet built is in one of the five
planned buckets, except the Imbued. No date is attached to a bucket — waves land on the owner's
"onto the next", in the order T1 → T2 → T3 → §7.

## Precon decks

The ${precons.length} preconstructed decks the registry derives from the KRCG
snapshot. **Implemented %** counts CARD COPIES whose card is in the pool and
built. **Playable as printed** is the deck importer's own verdict: a crypt of
${MIN_CRYPT}+, a library of ${MIN_LIBRARY}–${MAX_LIBRARY}, one crypt group or two
consecutive (p. 4, p. 14), and nothing unimplemented.

**They are different questions.** A deck can be 100% implemented and still not
be a legal deck on its own — which is exactly what the New Blood starters are:
half decks, sold in pairs, and not a defect in the pool.

| Deck | Set | Crypt | Library | Implemented % | Playable as printed | Why not |
|---|---|---:|---:|---:|---|---|
${preconRows.join("\n")}

**${playableCount} of ${precons.length} playable as printed**, and **${fullyImplemented} of
${precons.length} at 100% implemented**. Every card in every precon is a V5 card, so this
table moves only if the V5 pool does — the library waves of §6 widen the pool
AROUND these decks, not inside them.

## Precon decks outside V5

The ${legacyRows.length} preconstructed decks the rest of the KRCG snapshot ships.
**None of these are in the pool**: \`build-registry.mts\` hands \`collectPrecons\`
the V5 sets alone, deliberately, so a widened card can never drag its legacy
set's precons in half-built. This table is a REPORT — it admits nothing and
changes no config. It is here to answer one question the V5 table cannot:
**how far is the pool from dealing a real legacy deck?**

**Implemented %** is the same rule as above — card copies whose card is in the
registry and built — so it rises only as the §6 library waves land. A deck at
40% is 40% of its CARD COPIES, not of its distinct cards; the commonest cards
in VTES are the ones already built.

**"Legal shape" is NOT the V5 table's "playable as printed".** That verdict
also requires nothing unimplemented, and by that rule every row here would
read "no" and the column would say nothing. This one asks the deck-legality
question ALONE — a crypt of ${MIN_CRYPT}+, a library of ${MIN_LIBRARY}–${MAX_LIBRARY}, one crypt group or
two consecutive (p. 4, p. 14) — and leaves implementation to the column beside
it. A deck needs BOTH columns before it can be dealt.

Two decks are left out on purpose, at the owner's word (2026-09-15):

- **Not decks.** Several \`precon\` entries in the snapshot are bundles, tins or
  print-on-demand singles lists rather than preconstructed decks —
  ${[...NOT_DECKS].join(", ")}. Tenth Anniversary's tins are 100 distinct cards
  at one copy each and Print on Demand is 943: a list with one copy of
  everything is not a deck list.
- **Originals of re-releases.** Where the same clan deck exists as an original
  and as a later re-release, the **re-release is listed and the original
  dropped**. Only two products qualify, confirmed by release date rather than
  by memory: **Camarilla Edition (2002) → First Blood (2019)** and
  **Final Nights (2001) → Lords of the Night (2007)**. Camarilla Edition's
  *Brujah* has no First Blood counterpart, so it is not the original OF
  anything and stays.

| Deck | Set | Year | Crypt | Library | Implemented % | Legal shape | Why not |
|---|---|---:|---:|---:|---:|---|---|
${legacyRows.join("\n")}

**${legacyRows.length - legacyIllegal} of ${legacyRows.length} are a legal deck shape.** The ${legacyIllegal} that are not are half decks
by design, exactly as the New Blood starters are: First Blood's five are
6 crypt / 49 library and Third Edition's four Starter Kits are smaller again.
That is a fact about the product, not a defect in the pool.

## Regenerating

\`\`\`
node scripts/card-status-by-set.cjs > docs/card-status-by-set.md
\`\`\`
`;
// Pad every table so its columns line up in the source, not only when rendered.
const align=lines=>{const rows=lines.map(l=>l.slice(1,-1).split("|").map(c=>c.trim()));
  const w=rows[0].map((_,i)=>Math.max(...rows.map(r=>(r[i]??"").length)));
  return rows.map(r=>"| "+r.map((c,i)=>/^:?-+:?$/.test(c)
    ?(c.endsWith(":")?"-".repeat(w[i]-1)+":":"-".repeat(w[i]))
    :(rows[1][i].endsWith(":")?c.padStart(w[i]):c.padEnd(w[i]))).join(" | ")+" |");};
const lines=out.split("\n");const fixed=[];
for(let i=0;i<lines.length;){if(!lines[i].startsWith("|")){fixed.push(lines[i++]);continue;}
  let j=i;while(j<lines.length&&lines[j].startsWith("|"))j++;
  fixed.push(...align(lines.slice(i,j)));i=j;}
process.stdout.write(fixed.join("\n"));
