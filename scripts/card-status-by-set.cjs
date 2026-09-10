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
