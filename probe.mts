import { VtesEngine } from "./src/engine/index.ts";
import { viewFor } from "./src/engine/agent.ts";
import { openHandsFor } from "./src/engine/derived.ts";
import { testRegistry, threeSeatGame, runTrace } from "./tests/engine/fixtures.ts";
const state = threeSeatGame();
const v1 = state.seats[0]!.minions[0]!;
Object.assign(v1, { disciplines: { aus: "basic" }, blood: 4 });
state.seats[0]!.hand = [{ id: "rv", name: "Revelations" }];
state.seats[1]!.hand = [{ id: "b1", name: "Conditioning" }, { id: "b2", name: "Deflection" }];
const e = new VtesEngine(state, testRegistry);
runTrace(e, [["Alice", "play:Revelations:basic"]]);
for (let i=0;i<30;i++){ const dp=e.decision(); if(!dp) break; if(dp.options.some(o=>o.id.startsWith("choice:Revelations"))) break; e.choose((dp.options.find(o=>o.kind==="pass")??dp.options[0]!).id); }
e.choose("choice:Revelations:rv:peekDiscard:b1");
console.log("knowledge:", JSON.stringify(e.state.knowledge));
console.log("openHands Alice:", openHandsFor(e.state, "Alice"));
console.log("Alice perms:", e.state.seats[0]!.permanents.map(p=>p.card.name));
console.log("Bob hand:", e.state.seats[1]!.hand);
const v = viewFor(e.state, "Alice");
console.log("Alice's view of Bob hand:", JSON.stringify(v.seats.find(s=>s.id==="Bob")!.hand));
