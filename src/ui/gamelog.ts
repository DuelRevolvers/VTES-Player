/**
 * Per-playthrough log files (docs/game-log-design.md).
 *
 * One plain-text file per game, recording every decision made — by a
 * human, by an AI, or by the transport's own auto-pass — every event the
 * engine emitted, and any error. Written so a session can be handed to
 * Claude Code and read without the game in front of you.
 *
 * TWO PROPERTIES MAKE IT WORTH KEEPING:
 *
 *  1. It is a pure OBSERVER over `(commandLog, eventLog)`. Nothing calls
 *     into it from the engine loop and nothing it does can change a game;
 *     it is handed the state after each change and writes down what is new
 *     since last time. So it cannot miss an AI move, an auto-pass or an
 *     undo, and it cannot cause one either.
 *  2. The header carries the SETUP, and every decision line carries its
 *     option id — which together are exactly `SavedGame`. So the log is
 *     not just a description of the game, it is a REPLAY of it: paste the
 *     ids back and the same game happens (architecture principle 2).
 *
 * The log is UNREDACTED, deliberately. It is a debugging artefact written
 * to the owner's own disk, and a log that hid the hands would be useless
 * for exactly the bugs it exists to catch. It never travels to a peer.
 */

import type { CommandLogEntry, GameState } from "../engine/index.ts";
import type { GameSetup } from "./decks.ts";
import { narrate } from "./narrate.ts";

/** Where the lines end up. Fails soft: logging must never break a game. */
export interface LogSink {
  append(text: string): void;
  /** A name for the file this sink is writing, for the UI to show. */
  readonly name: string;
}

/** A sink that keeps everything in memory — the fallback, and the one the
 *  tests use. `text` is the whole file so far. */
export class MemorySink implements LogSink {
  text = "";
  constructor(readonly name = "memory") {}
  append(text: string): void {
    this.text += text;
  }
}

const pad = (n: number, w: number): string => String(n).padStart(w, " ");

/**
 * A file name that sorts by time and says which game it was:
 * `2026-09-04T14-31-02-vtes-a3f1.log`.
 */
export function logFileName(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const tag = Math.random().toString(36).slice(2, 6);
  return `${stamp}-vtes-${tag}.log`;
}

export class GameLog {
  /** How much of each log we have already written down. */
  private commands = 0;
  private events = 0;
  private closed = false;

  constructor(
    private readonly sink: LogSink,
    setup: GameSetup,
    now = new Date(),
  ) {
    this.write(
      [
        "VTES playthrough log",
        `started   ${now.toISOString()}`,
        `seed      ${setup.seed}`,
        `maxTurns  ${setup.maxTurns ?? "none"}`,
        `seats     ${setup.decks.map((d) => d.seat).join(", ")}`,
        "",
        "The setup below plus the option ids in the DECISION lines are a",
        "complete replay of this game — see docs/game-log-design.md.",
        "",
        `SETUP ${JSON.stringify(setup)}`,
        "",
        "-".repeat(72),
        "",
      ].join("\n"),
    );
  }

  /**
   * Write down everything that has happened since the last call. Safe to
   * call as often as you like — it is keyed on how far it has already got,
   * not on being called once per change.
   */
  observe(state: GameState): void {
    if (this.closed) return;

    // An UNDO replays a shorter command log into a fresh engine, so both
    // logs get shorter. Say so and re-sync rather than trying to work out
    // what was taken back: the lines above are still a true record of what
    // happened, and the ones below will be a true record of what happens
    // next. Without this the counters would sit ahead of the game forever
    // and the log would silently stop.
    if (state.commandLog.length < this.commands || state.eventLog.length < this.events) {
      this.write(`\n  ~~ rewound to decision ${state.commandLog.length} ~~\n\n`);
      this.commands = state.commandLog.length;
      this.events = state.eventLog.length;
      return;
    }

    for (; this.commands < state.commandLog.length; this.commands++) {
      const cmd = state.commandLog[this.commands]!;
      this.write(`${this.decisionLine(cmd, this.commands)}\n`);
    }
    for (; this.events < state.eventLog.length; this.events++) {
      const ev = state.eventLog[this.events]!;
      const line = narrate(ev, state);
      // An event with no sentence still gets a line: a log that quietly
      // drops what it cannot phrase is a log you cannot trust.
      this.write(`        . ${line ? line.text : `[${ev.type}] ${JSON.stringify(ev)}`}\n`);
    }
  }

  private decisionLine(cmd: CommandLogEntry, index: number): string {
    return `\n#${pad(index, 4)}  ${cmd.seat}\n        > ${cmd.option}`;
  }

  /** Something went wrong. The whole point of the file. */
  error(what: string, detail?: unknown): void {
    const extra =
      detail instanceof Error
        ? `\n${detail.stack ?? detail.message}`
        : detail === undefined
          ? ""
          : `\n${String(detail)}`;
    this.write(`\n!! ERROR  ${what}${extra}\n\n`);
  }

  /** A note that is neither a decision nor an error — a seat handed to an
   *  AI, a game loaded, the pace changed. */
  note(text: string): void {
    this.write(`\n-- ${text}\n`);
  }

  /** Final tally. Further observations are ignored, so a stray repaint
   *  after the game ends cannot append to a closed file. */
  finish(state: GameState): void {
    if (this.closed) return;
    this.observe(state);
    this.closed = true;
    const seats = state.seats
      .map((s) => `  ${s.id}: ${s.victoryPoints} VP, ${s.pool} pool${s.ousted ? ", ousted" : ""}`)
      .join("\n");
    this.write(
      `\n${"-".repeat(72)}\nGAME OVER after ${state.commandLog.length} decisions\n${seats}\n`,
    );
  }

  get fileName(): string {
    return this.sink.name;
  }

  /** Never let logging break a game: a failed write is dropped, loudly in
   *  the console and silently on the table. */
  private write(text: string): void {
    try {
      this.sink.append(text);
    } catch (err) {
      console.warn("[vtes] could not write the game log", err);
    }
  }
}

/**
 * The sink that actually reaches disk: POST to the dev server, which
 * appends to `logs/<name>` in the repo (see vite.config.ts). That is the
 * whole point — the owner plays through `Play VTES.bat`, which runs the
 * dev server, and the file is then sitting in the repo for Claude Code to
 * read without anyone having to export anything.
 *
 * Writes are FIRE AND FORGET and queued in order. A built site served from
 * GitHub Pages has no such endpoint; the POST fails, the failure is
 * reported once, and the log lives on in memory for `download()`.
 */
export class DevServerSink implements LogSink {
  private queue: Promise<void> = Promise.resolve();
  private warned = false;
  /** Kept regardless, so the log can be downloaded when there is no server
   *  to write to — a player on the published site still gets their file. */
  text = "";

  constructor(readonly name = logFileName()) {}

  append(text: string): void {
    this.text += text;
    this.queue = this.queue.then(async () => {
      try {
        const res = await fetch(`/__vtes_log/${encodeURIComponent(this.name)}`, {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: text,
        });
        if (!res.ok) throw new Error(`${res.status}`);
      } catch (err) {
        if (!this.warned) {
          this.warned = true;
          console.warn(
            `[vtes] no log server; keeping ${this.name} in memory only ` +
              "(this is expected on the published site)",
            err,
          );
        }
      }
    });
  }

  /** Hand the player the file when there was nowhere to write it. */
  download(): void {
    const url = URL.createObjectURL(new Blob([this.text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = this.name;
    a.click();
    URL.revokeObjectURL(url);
  }
}
