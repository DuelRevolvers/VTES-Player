/**
 * Saved games and default bot names (docs/saved-games-design.md).
 *
 * Both are LOCAL and both wrap browser storage, so the tests sit on the
 * pure halves — the slot store's rules, the bot-name fallback — and drive
 * storage through the same stub the deck library's tests use.
 *
 * The load path is exercised for real: a save is taken from a live
 * transport mid-game and replayed, because "it round-trips" is the only
 * claim about a save worth making and the only one that would notice if
 * `botSeats` stopped being written.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import playtestDecks from "../../config/playtest-decks.json";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import type { DeckDef, GameSetup } from "../../src/ui/decks.ts";
import { isSavedGame, readSaveFile, toSave } from "../../src/ui/history.ts";
import type { SavedGame } from "../../src/ui/history.ts";
import { botNameFor, DEFAULT_SETTINGS, loadSettings, MAX_BOT_NAMES, saveSettings } from "../../src/ui/settings.ts";
import type { UiSettings } from "../../src/ui/settings.ts";
import { defaultTable, MAX_SEATS, uniqueSeatName } from "../../src/ui/newgame.ts";
import {
  AUTO_ID,
  AUTO_NAME,
  autoSave,
  botSeatsFor,
  clearSaves,
  deleteSave,
  findSave,
  keepAuto,
  loadSaves,
  MAX_SAVES,
  renameSave,
  saveAs,
  saveNameProblem,
} from "../../src/ui/savedgames.ts";
import { LocalTransport } from "../../src/ui/transport.ts";

/** A localStorage that behaves. */
function fakeStorage(): Map<string, string> {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

const config = playtestDecks as unknown as {
  seed: number;
  maxTurns: number | null;
  decks: DeckDef[];
};
const setup: GameSetup = { decks: config.decks, seed: config.seed, maxTurns: 60 };
const seats = config.decks.map((d) => d.seat);

/** A save with nothing in its log — enough for every rule about slots. */
function emptySave(botSeats?: string[]): SavedGame {
  return toSave(setup, [], botSeats);
}

const label = { turn: 3, seats };

describe("save names", () => {
  beforeEach(() => fakeStorage());

  it("refuses what breaks something, and allows the rest", () => {
    expect(saveNameProblem("")).toMatch(/needed/);
    expect(saveNameProblem("   ")).toMatch(/needed/);
    expect(saveNameProblem("x".repeat(200))).toMatch(/at most/);
    expect(saveNameProblem("badname")).toMatch(/control characters/);
    // Accents, punctuation and other scripts are somebody's real words.
    expect(saveNameProblem("Bea's révanche — 吸血鬼")).toBeNull();
  });

  it("keeps the automatic slot's name for the automatic slot", () => {
    expect(saveNameProblem(AUTO_NAME)).toMatch(/automatic/);
    // Case is not a way around it: a row called "last game" that the next
    // autosave does NOT eat is exactly the confusion this prevents.
    expect(saveNameProblem("last game")).toMatch(/automatic/);
  });

  it("refuses a name already in the store, whatever its case", () => {
    saveAs("Prince gambit", emptySave(), label);
    expect(saveNameProblem("prince GAMBIT", loadSaves())).toMatch(/already have/);
    expect(saveNameProblem("Prince gambit II", loadSaves())).toBeNull();
  });
});

describe("the slot store", () => {
  beforeEach(() => fakeStorage());

  it("starts empty, and that is not an error", () => {
    expect(loadSaves()).toEqual([]);
  });

  it("keeps one automatic slot, replaced rather than appended", () => {
    autoSave(emptySave(), { turn: 1, seats });
    autoSave(emptySave(), { turn: 2, seats });
    autoSave(emptySave(), { turn: 3, seats });
    const saves = loadSaves();
    expect(saves.filter((s) => s.auto)).toHaveLength(1);
    expect(saves[0]?.id).toBe(AUTO_ID);
    expect(saves[0]?.turn).toBe(3);
  });

  it("shows the automatic slot first, then the named ones newest first", async () => {
    saveAs("older", emptySave(), label);
    // Two saves in the same millisecond would sort arbitrarily, and the
    // claim here is about ORDER, so the clock has to have moved.
    await new Promise((r) => setTimeout(r, 2));
    saveAs("newer", emptySave(), label);
    autoSave(emptySave(), label);
    expect(loadSaves().map((s) => s.name)).toEqual([AUTO_NAME, "newer", "older"]);
  });

  it("an autosave does not disturb the named slots", () => {
    saveAs("keep me", emptySave(), label);
    autoSave(emptySave(), { turn: 9, seats });
    expect(loadSaves().map((s) => s.name)).toContain("keep me");
    expect(loadSaves()).toHaveLength(2);
  });

  it("caps the NAMED slots, and the automatic one does not count", () => {
    for (let i = 0; i < MAX_SAVES; i++) {
      expect(saveAs(`game ${i}`, emptySave(), label)).toBeNull();
    }
    expect(saveAs("one too many", emptySave(), label)).toMatch(/delete one/);
    // The cap is on what a person chose to keep; the automatic slot is
    // the app's own and must never be squeezed out by a full store.
    autoSave(emptySave(), label);
    expect(loadSaves().find((s) => s.auto)).toBeDefined();
    expect(loadSaves()).toHaveLength(MAX_SAVES + 1);
  });

  it("keeps the automatic slot under a new name, and LEAVES it in place", () => {
    autoSave(emptySave(), { turn: 4, seats });
    expect(keepAuto("before the vote")).toBeNull();
    const saves = loadSaves();
    // Keep is a copy. Taking the auto slot away would mean the button
    // removed the row it was pressed on, and the next autosave is exactly
    // what the player was protecting the position from.
    expect(saves.find((s) => s.auto)).toBeDefined();
    const kept = saves.find((s) => s.name === "before the vote");
    expect(kept?.auto).toBe(false);
    expect(kept?.turn).toBe(4);
  });

  it("will not keep an automatic slot that is not there", () => {
    expect(keepAuto("nothing")).toMatch(/no automatic save/);
  });

  it("renames a named slot but not the automatic one", () => {
    autoSave(emptySave(), label);
    saveAs("first try", emptySave(), label);
    const named = loadSaves().find((s) => !s.auto);
    expect(renameSave(named?.id ?? "", "second try")).toBeNull();
    expect(loadSaves().map((s) => s.name)).toContain("second try");
    expect(renameSave(AUTO_ID, "mine now")).toMatch(/keeping it/);
    expect(renameSave("no-such-id", "x")).toMatch(/no longer there/);
  });

  it("a rename may not collide with another save, but may keep its own name", () => {
    saveAs("alpha", emptySave(), label);
    saveAs("beta", emptySave(), label);
    const beta = loadSaves().find((s) => s.name === "beta");
    expect(renameSave(beta?.id ?? "", "alpha")).toMatch(/already have/);
    // Renaming a save to what it is already called is a no-op, NOT a
    // clash with itself — the row it would collide with is excluded.
    expect(renameSave(beta?.id ?? "", "beta")).toBeNull();
  });

  it("deletes by id, so two saves cannot be confused by name", () => {
    saveAs("one", emptySave(), label);
    saveAs("two", emptySave(), label);
    const one = loadSaves().find((s) => s.name === "one");
    deleteSave(one?.id ?? "");
    expect(loadSaves().map((s) => s.name)).toEqual(["two"]);
    expect(findSave(one?.id ?? "")).toBeNull();
  });

  it("survives a store that has been corrupted, without losing the good rows", () => {
    const map = fakeStorage();
    saveAs("good", emptySave(), label);
    const rows: unknown[] = JSON.parse(map.get("vtes-saves") ?? "[]");
    // A row from an older version, a hand edit, half a write — one bad
    // row must not take the library with it.
    rows.push({ id: "junk", name: "junk" }, null, 7);
    map.set("vtes-saves", JSON.stringify(rows));
    expect(loadSaves().map((s) => s.name)).toEqual(["good"]);
  });

  it("reads back nothing at all rather than throwing when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("site data blocked");
      },
      setItem: () => {
        throw new Error("site data blocked");
      },
      removeItem: () => undefined,
    });
    expect(loadSaves()).toEqual([]);
    // An autosave is a courtesy and stays silent; a save somebody ASKED
    // for says it could not be done.
    expect(() => autoSave(emptySave(), label)).not.toThrow();
    expect(saveAs("nope", emptySave(), label)).toMatch(/would not store/);
  });

  it("adopts the single slot the table used to write, once", () => {
    const map = fakeStorage();
    map.set("vtes-debug-game", JSON.stringify(emptySave()));
    const saves = loadSaves();
    expect(saves).toHaveLength(1);
    expect(saves[0]?.auto).toBe(true);
    // The seats are recoverable from the decks even though no label was
    // ever stored for it; the turn is not, and says so by being 0.
    expect(saves[0]?.seats).toEqual(seats);
    expect(saves[0]?.turn).toBe(0);
    // Taken over, not mirrored: the old key is gone, so the same game
    // cannot sit in two places with nothing keeping them in step.
    expect(map.get("vtes-debug-game")).toBeUndefined();
    // And it does not come back after being deleted, which is what would
    // happen if the old key were read on every load.
    deleteSave(AUTO_ID);
    expect(loadSaves()).toEqual([]);
  });

  it("does not adopt anything once the store has been written", () => {
    const map = fakeStorage();
    saveAs("mine", emptySave(), label);
    map.set("vtes-debug-game", JSON.stringify(emptySave()));
    expect(loadSaves().map((s) => s.name)).toEqual(["mine"]);
  });

  it("clears everything", () => {
    autoSave(emptySave(), label);
    saveAs("a", emptySave(), label);
    clearSaves();
    expect(loadSaves()).toEqual([]);
  });
});

describe("what a save records", () => {
  beforeEach(() => fakeStorage());

  it("recognises a save, and refuses what is not one", () => {
    expect(isSavedGame(emptySave())).toBe(true);
    expect(isSavedGame(null)).toBe(false);
    expect(isSavedGame({ version: 2, setup, commands: [] })).toBe(false);
    expect(isSavedGame({ version: 1, commands: [] })).toBe(false);
    expect(isSavedGame({ version: 1, setup, commands: "no" })).toBe(false);
    // botSeats is optional, but if it is there it is a list of names.
    expect(isSavedGame({ version: 1, setup, commands: [], botSeats: ["a"] })).toBe(true);
    expect(isSavedGame({ version: 1, setup, commands: [], botSeats: [3] })).toBe(false);
  });

  it("carries the bot seats out of a live game and back in", async () => {
    const bots = seats.slice(1);
    const transport = new LocalTransport({ setup });
    for (const seat of bots) transport.setAgent(seat, new HeuristicAgent({ seed: 5 }));
    const save = transport.history.snapshot();
    expect(new Set(save.botSeats)).toEqual(new Set(bots));

    // The claim that matters: the save says who the bots were, so nobody
    // has to guess. `assumed` is the flag the UI puts a question behind.
    const restored = botSeatsFor(save, seats[0] ?? null);
    expect(new Set(restored.seats)).toEqual(new Set(bots));
    expect(restored.assumed).toBe(false);
  });

  it("replays a mid-game save into the same position", async () => {
    // One human seat, so the game STOPS mid-way and there is a real
    // position to save. With an agent on every seat it would run to the
    // end, and a finished game round-trips for less interesting reasons.
    const transport = new LocalTransport({ setup });
    for (const seat of seats.slice(1)) {
      transport.setAgent(seat, new HeuristicAgent({ seed: 11 }));
    }
    // PASS, THEN END, then whatever is left: a walker that takes
    // options[0] plays the board and would make this a test about the
    // first option's label rather than about saving.
    for (let i = 0; i < 60; i++) {
      const dp = transport.decision();
      if (!dp) break;
      const ids = dp.options.map((o) => o.id);
      const pick = ids.find((o) => o === "pass") ?? ids.find((o) => o === "end") ?? ids[0];
      if (!pick) break;
      await transport.choose(pick);
    }
    const save = transport.history.snapshot();
    const before = transport.view();
    // The fixture has to have got somewhere, or this asserts nothing.
    expect(save.commands.length).toBeGreaterThan(0);
    expect(transport.decision(), "the game ended — nothing mid-game to save").not.toBeNull();

    const reloaded = new LocalTransport({ setup: save.setup, commands: save.commands });
    const after = reloaded.view();
    // A save is a setup plus a command log, replayed — architecture
    // principle 2. If this ever stops holding, undo is broken too.
    expect(after.seats.map((s) => s.pool)).toEqual(before.seats.map((s) => s.pool));
    expect(after.commandLog.length).toBe(before.commandLog.length);
    expect(after.frames.map((f) => f.kind)).toEqual(before.frames.map((f) => f.kind));
    // And the same seat is being asked the same thing.
    expect(reloaded.decision()?.seat).toBe(transport.decision()?.seat);
  });

  it("guesses the bots for a save from before they were recorded, and SAYS it guessed", () => {
    const old = emptySave();
    expect(old.botSeats).toBeUndefined();
    const guessed = botSeatsFor(old, seats[0] ?? null);
    // Every seat but yours — right for a private table, and a guess.
    expect(guessed.seats).toEqual(seats.slice(1));
    expect(guessed.assumed).toBe(true);
  });

  it("hands out no bots when the guess has nobody to exclude", () => {
    // A save whose seats do not include this player's name: the guess is
    // "everyone else", and everyone else is everyone. The flag is what
    // stops that being acted on silently.
    const guessed = botSeatsFor(emptySave(), "somebody who was not there");
    expect(guessed.seats).toEqual(seats);
    expect(guessed.assumed).toBe(true);
  });

  it("an EMPTY recorded list is a real answer, not a missing one", () => {
    // The distinction the optional field exists for: a hotseat game with
    // no bots at all records [], and must not be re-guessed into three.
    const hotseat = emptySave([]);
    const read = botSeatsFor(hotseat, seats[0] ?? null);
    expect(read.seats).toEqual([]);
    expect(read.assumed).toBe(false);
  });

  it("refuses a file that is not a saved game", async () => {
    const file = (text: string): File =>
      ({ text: () => Promise.resolve(text) }) as unknown as File;
    await expect(readSaveFile(file("not json at all"))).rejects.toThrow(/not a saved game/);
    await expect(readSaveFile(file('{"version":9}'))).rejects.toThrow(/not a saved game/);
    await expect(readSaveFile(file(JSON.stringify(emptySave())))).resolves.toBeTruthy();
  });
});

describe("default bot names", () => {
  beforeEach(() => fakeStorage());

  const withNames = (botNames: string[]): UiSettings => ({
    ...DEFAULT_SETTINGS,
    autoPass: {},
    aiSeats: {},
    botNames,
  });

  it("has a name for every bot seat a table can hold", () => {
    // `settings.ts` cannot import `newgame.ts` — that would be a cycle,
    // since newgame reads the settings — so the two constants are pinned
    // to each other here instead. Widen the table and this fails, which
    // is the point: the sixth seat would silently be "Bot 5" forever.
    expect(MAX_BOT_NAMES).toBe(MAX_SEATS - 1);
  });

  it("falls back to Bot N for a name that was never set", () => {
    const s = withNames([]);
    expect(botNameFor(s, 1)).toBe("Bot 1");
    expect(botNameFor(s, 3)).toBe("Bot 3");
  });

  it("uses a configured name, positionally", () => {
    const s = withNames(["Bea", "Cato", "Dax"]);
    expect(botNameFor(s, 1)).toBe("Bea");
    expect(botNameFor(s, 2)).toBe("Cato");
    expect(botNameFor(s, 3)).toBe("Dax");
  });

  it("a BLANK entry holds its place rather than shifting the rest up", () => {
    // The bug this prevents: dropping the empty second entry would make
    // bot 2 "Dax" and lose the third name entirely.
    const s = withNames(["Bea", "", "Dax"]);
    expect(botNameFor(s, 1)).toBe("Bea");
    expect(botNameFor(s, 2)).toBe("Bot 2");
    expect(botNameFor(s, 3)).toBe("Dax");
  });

  it("treats whitespace as unset", () => {
    expect(botNameFor(withNames(["   "]), 1)).toBe("Bot 1");
  });

  it("round-trips through storage, and drops a stored name that would be refused", () => {
    const settings = loadSettings();
    // A name a person could not have typed — a hand edit, or an older
    // version. It becomes blank, which is the same as never set.
    settings.botNames = ["Bea", "x".repeat(300), "badname", "Dax"];
    saveSettings(settings);
    const read = loadSettings();
    expect(read.botNames).toEqual(["Bea", "", "", "Dax"]);
    expect(botNameFor(read, 2)).toBe("Bot 2");
    expect(botNameFor(read, 4)).toBe("Dax");
  });

  it("stores no more names than a table has bot seats", () => {
    const settings = loadSettings();
    settings.botNames = Array.from({ length: 40 }, (_, i) => `Bot number ${i}`);
    saveSettings(settings);
    expect(loadSettings().botNames).toHaveLength(MAX_BOT_NAMES);
  });

  it("never hands the same array back twice", () => {
    // DEFAULT_SETTINGS holds its own array; a caller that mutated what it
    // was given would change everybody else's defaults.
    const a = loadSettings();
    a.botNames.push("mine");
    expect(loadSettings().botNames).toEqual([]);
  });

  it("names a fresh table's bot seats", () => {
    const settings = withNames(["Bea", "Cato", "Dax"]);
    const table = defaultTable("Aaron", (i) => botNameFor(settings, i));
    expect(table.seats.map((s) => s.name)).toEqual(["Aaron", "Bea", "Cato", "Dax"]);
    // The player's own seat is never renamed by this.
    expect(table.seats[0]?.kind).toBe("you");
  });

  it("still numbers them when nothing is configured", () => {
    const table = defaultTable("Aaron");
    expect(table.seats.map((s) => s.name)).toEqual(["Aaron", "Bot 1", "Bot 2", "Bot 3"]);
  });
});

describe("a seat name the app chooses", () => {
  it("is the base when nothing has taken it", () => {
    expect(uniqueSeatName("Bea", ["Aaron", "Cato"])).toBe("Bea");
  });

  it("steps past a collision rather than making an undealable table", () => {
    // Seat names are the engine's seat ids, so a duplicate is a table
    // that will not deal. When the APP picked the name, that is not the
    // player's mistake to be shown.
    expect(uniqueSeatName("Bea", ["Aaron", "Bea"])).toBe("Bea 2");
    expect(uniqueSeatName("Bea", ["Bea", "Bea 2", "Bea 3"])).toBe("Bea 4");
  });

  it("ignores the whitespace around a taken name", () => {
    expect(uniqueSeatName("Bea", ["  Bea  "])).toBe("Bea 2");
  });
});
