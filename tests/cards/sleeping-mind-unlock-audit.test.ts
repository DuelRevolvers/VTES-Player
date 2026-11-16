import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function setup(superior: boolean, hunt = false) {
  const state = threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, { disciplines: { dom: "superior", for: "basic", obl: "superior" }, blood: 5 });
  state.seats[1]!.minions[0]!.locked = true;
  state.seats[0]!.hand.push({ id: "sm", name: "The Sleeping Mind" }, { id: "fd", name: "Freak Drive" }, { id: "ct", name: "Change of Target" }, { id: "sc", name: "Shadow Cloak" });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [["Alice", hunt ? "hunt:V1" : "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", superior ? "play:The Sleeping Mind:superior:V1:sm" : "play:The Sleeping Mind:basic:V1:W:sm"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
  return { state, engine };
}

describe("Sleeping Mind superior unlock prohibition", () => {
  it("still permits wake cards that act as if unlocked", () => {
    const { state, engine } = setup(true);
    state.seats[1]!.hand.push({ id: "qv", name: "On the Qui Vive" });
    runTrace(engine, [["Alice", "pass"]]);
    expect(engine.decision()!.seat).toBe("Bob");
    expect(engine.decision()!.options.some(o => o.id.startsWith("play:On the Qui Vive"))).toBe(true);
  });
  it("retains the prohibition across a save and restore", () => {
    const { state } = setup(true);
    const copy = JSON.parse(JSON.stringify(state));
    const engine = new VtesEngine(copy, testRegistry);
    for (let i = 0; i < 20 && engine.decision()?.window !== "action.afterResolution"; i++) engine.choose("pass");
    expect(engine.decision()!.window).toBe("action.afterResolution");
    expect(engine.decision()!.options.some(o => o.id.startsWith("play:Freak Drive"))).toBe(false);
  });
  for (const superior of [true, false]) {
    it(`${superior ? "blocks" : "allows"} Freak Drive in the after-resolution impulse`, () => {
      const { state, engine } = setup(superior);
      for (let i = 0; i < 20 && engine.decision()?.window !== "action.afterResolution"; i++) engine.choose("pass");
      const dp = engine.decision()!;
      expect(dp.window).toBe("action.afterResolution");
      expect(dp.options.some(o => o.id.startsWith("play:Shadow Cloak:superior"))).toBe(true);
      expect(dp.options.some(o => o.id.startsWith("play:Freak Drive:basic"))).toBe(!superior);
      expect(state.seats[0]!.minions[0]!.locked).toBe(true);
    });
    it(`${superior ? "blocks" : "allows"} Change of Target before block resolution`, () => {
      const { engine } = setup(superior);
      runTrace(engine, [["Alice", "pass"], ["Bob", "block:M"]]);
      expect(engine.decision()!.options.some(o => o.id.startsWith("play:Change of Target"))).toBe(!superior);
    });
  }
});

describe("Sleeping Mind and other unlock effects", () => {
  it("suppresses Warsaw Station's promised unlock on successful hunt", () => {
    const state = threeSeatGame();
    const actor = state.seats[0]!.minions[0]!;
    Object.assign(actor, { clan: "Nosferatu", blood: 3, disciplines: { dom: "superior" } });
    state.seats[0]!.hand.push({ id: "sm", name: "The Sleeping Mind" });
    state.seats[0]!.permanents.push({ card: { id: "ws", name: "Warsaw Station" },
      locked: false, usedThisPhase: false, tags: ["location"], statics: {} });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "hunt:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "ability:Warsaw Station:ws:unlockOnSuccess"],
      ["Alice", "play:The Sleeping Mind:superior:V1:sm"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    for (let i = 0; i < 20 && state.frames.some(f => f.kind === "action"); i++) engine.choose("pass");
    expect(actor.locked).toBe(true);
    expect(state.eventLog.some(e => e.type === "ActionResolved" && e.success)).toBe(true);
  });
  it("allows Dabbler's blood gain but not its unlock after the action", () => {
    const state = threeSeatGame();
    const actor = state.seats[0]!.minions[0]!;
    Object.assign(actor, { blood: 5, disciplines: { dom: "superior", ani: "superior", pro: "superior" } });
    actor.attached.push({ card: { id: "dab", name: "Dabbler" }, locked: false,
      usedThisPhase: false, tags: ["archetype"], statics: {} });
    state.seats[0]!.hand.push({ id: "sm", name: "The Sleeping Mind" }, { id: "bm", name: "Beast Meld" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "play:The Sleeping Mind:superior:V1:sm"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "play:Beast Meld"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    for (let i = 0; i < 20 && engine.decision()?.window !== "choice"; i++) engine.choose("pass");
    const dp = engine.decision()!;
    expect(dp.window).toBe("choice");
    expect(dp.options.some(o => o.id.endsWith(":gain"))).toBe(true);
    expect(dp.options.some(o => o.id.endsWith(":unlock"))).toBe(false);
    engine.choose("choice:Dabbler:dab:dabble:gain");
    expect(actor.locked).toBe(true);
  });
  it("does not offer Forward Momentum's unlock in the after-resolution window", () => {
    const { state, engine } = setup(true);
    state.seats[0]!.minions[0]!.path = "Cathari";
    state.seats[0]!.permanents.push({ card: { id: "fm", name: "Forward Momentum" },
      locked: false, usedThisPhase: false, tags: [], statics: {}, counters: 2 });
    for (let i = 0; i < 20 && engine.decision()?.window !== "action.afterResolution"; i++) engine.choose("pass");
    const dp = engine.decision()!;
    expect(dp.window).toBe("action.afterResolution");
    expect(dp.options.some(o => o.id === "ability:Forward Momentum:fm:unlock")).toBe(false);
  });
});

describe("Sleeping Mind during the resulting combat", () => {
  for (const side of ["actor", "blocker"] as const) for (const superior of [true, false]) {
    it(`${superior ? "bars" : "allows"} ${side}'s superior Majesty, while basic remains legal`, () => {
      const { state, engine } = setup(superior);
      const actor = state.seats[0]!.minions[0]!;
      const blocker = state.seats[1]!.minions.find(m => m.id === "M")!;
      if (side === "actor") {
        actor.disciplines.pre = "superior";
        state.seats[0]!.hand.push({ id: "majesty", name: "Majesty" });
      } else {
        blocker.disciplines.pre = "superior"; blocker.blood = 3;
        state.seats[1]!.hand.push({ id: "majesty", name: "Majesty" });
      }
      runTrace(engine, [["Alice", "pass"], ["Bob", "block:M"],
        ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
      let played = false;
      for (let i = 0; i < 100; i++) {
        const dp = engine.decision()!;
        if (played && !state.frames.some(f => f.kind === "combat")) break;
        const basic = dp.options.find(o => o.id.startsWith("play:Majesty:basic"));
        if (basic) {
          const enhanced = dp.options.find(o => o.id.startsWith("play:Majesty:superior"));
          expect(Boolean(enhanced)).toBe(!superior);
          engine.choose((enhanced ?? basic).id); played = true; continue;
        }
        const next = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
        if (!next) throw new Error(`cannot continue ${dp.window}`);
        engine.choose(next.id);
      }
      expect(played).toBe(true);
      expect(side === "actor" ? actor.locked : blocker.locked).toBe(superior);
      expect(state.eventLog.some(e => e.type === "MinionUnlocked" && e.minion === (side === "actor" ? actor.id : blocker.id))).toBe(!superior);
      expect(state.eventLog.some(e => e.type === "CombatEnded")).toBe(true);
    });
  }
  it("does not offer a paid unlock granted by Truth in Darkness during combat", () => {
    const { state, engine } = setup(true, true);
    const blocker = state.seats[1]!.minions.find(m => m.id === "M")!;
    Object.assign(blocker, { blood: 3, disciplines: { obl: "superior" } });
    state.seats[1]!.hand.push({ id: "truth", name: "Truth in Darkness" });
    runTrace(engine, [["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "play:Truth in Darkness:superior:M:truth"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    const cf = state.frames.find(f => f.kind === "combat");
    if (!cf || cf.kind !== "combat") throw new Error("no combat");
    expect(cf.unlockForBlood.opposing).toBe(1);
    engine.choose("pass");
    expect(engine.decision()!.seat).toBe("Bob");
    expect(engine.decision()!.options.some(o => o.id === "unlock:blood:opposing")).toBe(false);
    expect(blocker.blood).toBe(3);
    expect(blocker.locked).toBe(true);
  });
});

describe("Sleeping Mind and Eagle's Sight", () => {
  it.each([false, true])("allows Eagle's Sight without unlocking (wake=%s)", (wake) => {
    const { state, engine } = setup(true);
    const m = state.seats[1]!.minions.find(m => m.id === "M")!;
    Object.assign(m, { disciplines: { aus: "superior" }, locked: wake, awake: wake });
    state.seats[1]!.hand.push({ id: "eagle", name: "Eagle's Sight" });
    engine.choose("pass");
    const id = engine.decision()!.options.find(o => o.id.startsWith("play:Eagle's Sight:superior:M"))?.id;
    expect(id).toBeDefined();
    engine.choose(id!);
    for (let i = 0; i < 25 && !state.frames.some(f => f.kind === "blockAttempt"); i++) {
      const dp = engine.decision()!;
      const pass = dp.options.find(o => o.id === "pass");
      if (!pass) throw new Error(`no pass in ${dp.window}`);
      engine.choose(pass.id);
    }
    expect(state.frames.some(f => f.kind === "blockAttempt" && f.blocker === "M")).toBe(true);
    expect(m.locked).toBe(wake);
    expect(state.eventLog.some(e => e.type === "MinionUnlocked" && e.minion === "M")).toBe(false);
  });
});

it("a real On the Qui Vive wake lets a locked minion use Eagle's Sight without unlocking", () => {
  const { state, engine } = setup(true);
  const m = state.seats[1]!.minions.find(m => m.id === "M")!;
  Object.assign(m, { disciplines: { aus: "superior" }, locked: true });
  state.seats[1]!.hand.push({ id: "qv", name: "On the Qui Vive" }, { id: "eagle", name: "Eagle's Sight" });
  runTrace(engine, [["Alice", "pass"], ["Bob", "play:On the Qui Vive:basic:M:qv"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"]]);
  expect(m.awake && m.locked).toBe(true);
  const eagle = engine.decision()!.options.find(o => o.id.startsWith("play:Eagle's Sight:superior:M"));
  expect(eagle).toBeDefined();
  engine.choose(eagle!.id);
  for (let i = 0; i < 25 && !state.frames.some(f => f.kind === "blockAttempt"); i++) {
    const dp = engine.decision()!;
    const pass = dp.options.find(o => o.id === "pass");
    if (!pass) throw new Error(`no pass in ${dp.window}`);
    engine.choose(pass.id);
  }
  expect(state.frames.some(f => f.kind === "blockAttempt" && f.blocker === "M")).toBe(true);
  expect(m.locked).toBe(true);
  expect(state.eventLog.some(e => e.type === "MinionUnlocked" && e.minion === "M")).toBe(false);
});

describe("Sleeping Mind and other block-unlock abilities", () => {
  it.each([true, false])("%s superior: Organized Resistance cannot unlock a locked anarch", (superior) => {
    const { state, engine } = setup(superior);
    const baron = state.seats[1]!.minions.find(m => m.id === "W")!;
    const m = state.seats[1]!.minions.find(m => m.id === "M")!;
    Object.assign(baron, { title: "baron", sect: "anarch" });
    Object.assign(m, { sect: "anarch", locked: true });
    state.seats[1]!.hand.push({ id: "or", name: "Organized Resistance" });
    engine.choose("pass");
    const id = "play:Organized Resistance:basic:W:unlock:M:or";
    expect(engine.decision()!.options.some(o => o.id === id)).toBe(!superior);
    expect(m.locked).toBe(true);
  });

  it("still permits the Organized Resistance intercept mode during a block", () => {
    const { state, engine } = setup(true);
    const baron = state.seats[1]!.minions.find(m => m.id === "W")!;
    const m = state.seats[1]!.minions.find(m => m.id === "M")!;
    Object.assign(baron, { title: "baron", sect: "anarch" });
    Object.assign(m, { sect: "anarch" });
    state.seats[0]!.minions[0]!.disciplines.obf = "basic";
    state.seats[0]!.hand.push({ id: "lic", name: "Lost in Crowds" });
    state.seats[1]!.hand.push({ id: "or", name: "Organized Resistance" });
    runTrace(engine, [["Alice", "pass"], ["Bob", "block:M"], ["Alice", "play:Lost in Crowds:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"]]);
    expect(engine.decision()!.options.some(o => o.id === "play:Organized Resistance:basic:W:intercept:M:or")).toBe(true);
  });

  it.each([true, false])("%s superior: Under Siege does not unlock a locked vampire", (superior) => {
    const { state, engine } = setup(superior);
    const w = state.seats[1]!.minions.find(m => m.id === "W")!;
    const m = state.seats[1]!.minions.find(m => m.id === "M")!;
    Object.assign(w, { sect: "sabbat", locked: true });
    Object.assign(m, { sect: "sabbat", locked: false });
    state.seats[1]!.permanents.push({ card: { id: "us", name: "Under Siege" }, locked: false,
      usedThisPhase: false, statics: {}, tags: [], counters: 2 });
    engine.choose("pass");
    const opts = engine.decision()!.options.map(o => o.id);
    expect(opts.includes("ability:Under Siege:us:W")).toBe(!superior);
    expect(opts).toContain("ability:Under Siege:us:M");
    expect(state.seats[1]!.permanents.find(p => p.card.id === "us")!.counters).toBe(2);
  });

  it.each([true, false])("%s superior: Eternal Vigilance cannot buy an unlock", (superior) => {
    const { state, engine } = setup(superior);
    const w = state.seats[1]!.minions.find(m => m.id === "W")!;
    w.attached.push({ card: { id: "ev", name: "Eternal Vigilance" }, locked: false,
      usedThisPhase: false, statics: {}, tags: ["Eternal Vigilance"] });
    engine.choose("pass");
    expect(engine.decision()!.options.some(o => o.id === "ability:Eternal Vigilance:ev:payunlock:W")).toBe(!superior);
  });
});

describe("Sleeping Mind and Special Report", () => {
  it.each([true, false])("%s superior: a locked target is barred, an unlocked target can still attempt", (superior) => {
    const { state, engine } = setup(superior);
    const w = state.seats[1]!.minions[0]!;
    state.seats[1]!.minions.push({ ...w, id: "locked-other", name: "locked-other", attached: [], disciplines: {}, locked: true });
    state.seats[1]!.hand.push({ id: "sr", name: "Special Report" });
    engine.choose("pass");
    expect(engine.decision()!.seat).toBe("Bob");
    const ids = engine.decision()!.options.map(o => o.id);
    expect(ids.includes("play:Special Report:-:locked-other:sr")).toBe(!superior);
    expect(ids).toContain("play:Special Report:-:M:sr");
    if (superior) {
      engine.choose("play:Special Report:-:M:sr");
      for (let i = 0; i < 25 && !state.frames.some(f => f.kind === "blockAttempt"); i++) {
        const dp = engine.decision()!;
        const pass = dp.options.find(o => o.id === "pass");
        if (!pass) throw new Error(`no pass in ${dp.window}`);
        engine.choose(pass.id);
      }
      expect(state.frames.some(f => f.kind === "blockAttempt" && f.blocker === "M")).toBe(true);
      expect(state.eventLog.some(e => e.type === "MinionUnlocked" && e.minion === "M")).toBe(false);
    }
  });
  it("still allows Special Report for a vampire already attempting a block", () => {
    const { state, engine } = setup(true);
    state.seats[1]!.hand.push({ id: "sr", name: "Special Report" });
    runTrace(engine, [["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"]]);
    expect(engine.decision()!.options.some(o => o.id === "play:Special Report:-:M:sr")).toBe(true);
  });
});

describe("Sleeping Mind and Helicopter", () => {
  for (const superior of [true, false]) {
    it(`${superior ? "bars" : "allows"} Helicopter after a successful bleed`, () => {
      const { state, engine } = setup(superior);
      const actor = state.seats[0]!.minions[0]!;
      actor.attached.push({ card: { id: "heli", name: "Helicopter" }, locked: false,
        usedThisPhase: false, tags: ["equipment", "vehicle"], statics: {} });
      for (let i = 0; i < 30 && engine.decision()?.window !== "action.afterResolution"; i++) engine.choose("pass");
      const option = engine.decision()!.options.find(o => o.id === "ability:Helicopter:heli:unlockme");
      expect(!!option).toBe(!superior);
      if (option) {
        engine.choose(option.id);
        expect(actor.locked).toBe(false);
        expect(actor.attached.find(p => p.card.id === "heli")!.locked).toBe(true);
      } else {
        expect(actor.locked).toBe(true);
        expect(actor.attached.find(p => p.card.id === "heli")!.locked).toBe(false);
      }
    });
  }
  it("does not offer Helicopter after an unsuccessful blocked action", () => {
    const { state, engine } = setup(false);
    const actor = state.seats[0]!.minions[0]!;
    actor.disciplines.for = "superior"; // Freak Drive opens the blocked-action aftermath.
    state.seats[1]!.minions.find(m => m.id === "M")!.strength = 0;
    actor.attached.push({ card: { id: "heli", name: "Helicopter" }, locked: false,
      usedThisPhase: false, tags: ["equipment", "vehicle"], statics: {} });
    runTrace(engine, [["Alice", "pass"], ["Bob", "block:M"]]);
    let reached = false;
    for (let i = 0; i < 100 && state.frames.some(f => f.kind === "action"); i++) {
      const dp = engine.decision()!;
      if (dp.window === "action.afterResolution" && dp.seat === "Alice") {
        reached = true;
        expect(dp.options.some(o => o.id === "ability:Helicopter:heli:unlockme")).toBe(false);
        break;
      }
      const pick = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
      if (!pick) throw new Error(`no option in ${dp.window}`);
      engine.choose(pick.id);
    }
    expect(reached).toBe(true);
  });
});

describe("Sleeping Mind and the blocked-action window", () => {
  for (const superior of [true, false]) {
    it(`${superior ? "bars" : "allows"} Horrific Countenance's unlock`, () => {
      const { state, engine } = setup(superior);
      const actor = state.seats[0]!.minions[0]!;
      actor.disciplines.pro = "superior";
      state.seats[0]!.hand.push({ id: "hc", name: "Horrific Countenance" });
      runTrace(engine, [["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
      expect(engine.decision()!.window).toBe("combat.beforeRange");
      expect(engine.decision()!.options.some(o => o.id.startsWith("play:Horrific Countenance"))).toBe(!superior);
    });
  }
  it.each(["Cats' Guidance", "Forced Vigilance"])("does not offer %s's unlock under superior", (name) => {
    const { state, engine } = setup(true);
    const blocker = state.seats[1]!.minions.find(m => m.id === "M")!;
    Object.assign(blocker, { disciplines: { ani: "superior", for: "superior" }, blood: 4 });
    state.seats[1]!.hand.push({ id: "reaction", name });
    runTrace(engine, [["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"]]);
    expect(engine.decision()!.window).toBe("combat.beforeRange");
    expect(engine.decision()!.seat).toBe("Bob");
    expect(engine.decision()!.options.some(o => o.id.startsWith(`play:${name}:basic`))).toBe(false);
  });
});

describe("Sleeping Mind on an action that already promises an unlock", () => {
  for (const superior of [true, false]) {
    it(`Abbot still attaches, ${superior ? "without" : "with"} unlocking`, () => {
      const state = threeSeatGame();
      const actor = state.seats[0]!.minions[0]!;
      Object.assign(actor, { sect: "sabbat", blood: 4, disciplines: { dom: "superior" } });
      state.seats[1]!.minions[0]!.locked = true;
      state.seats[0]!.hand.push({ id: "ab", name: "Abbot" }, { id: "sm", name: "The Sleeping Mind" });
      const engine = new VtesEngine(state, testRegistry);
      runTrace(engine, [["Alice", "play:Abbot:basic:V1:ab"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
        ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
        ["Alice", superior ? "play:The Sleeping Mind:superior:V1:sm" : "play:The Sleeping Mind:basic:V1:W:sm"],
        ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
      for (let i = 0; i < 30 && state.frames.some(f => f.kind === "action"); i++) engine.choose("pass");
      expect(actor.attached.some(p => p.card.id === "ab")).toBe(true);
      expect(actor.locked).toBe(superior);
    });
  }
});
