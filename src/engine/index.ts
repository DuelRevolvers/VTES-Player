/**
 * Public surface of the headless engine (design docs/impulse-design.md).
 * No DOM, no networking, no rendering — safe for Node tests and batch AI
 * simulation (architecture principle 1).
 */

export * from "./state.ts";
export * from "./options.ts";
export * from "./handlers.ts";
export * from "./derived.ts";
export * from "./engine.ts";
export * from "./agent.ts";
export * from "./rng.ts";
