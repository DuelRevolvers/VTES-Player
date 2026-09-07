/**
 * The platform version (owner request 2026-09-07).
 *
 * A build number people can point at in a bug report, shown at the foot
 * of the main menu. The standing rule — bump it by 0.0.1 with every change
 * — is recorded in CLAUDE.md; what THIS pins is the things a rule cannot:
 * that there is only one number, that it is well formed, and that it
 * actually reaches the screen.
 */

import { describe, expect, it } from "vitest";
import pkg from "../../package.json";
import { PLATFORM_VERSION, PLATFORM_VERSION_LABEL } from "../../src/version.ts";

describe("the platform version", () => {
  it("is three dot-separated numbers", () => {
    // Not a regex for its own sake: "0.7" or "v0.7.0" would both render
    // as something that reads like a version and breaks the +0.0.1 rule
    // the moment somebody tries to apply it.
    expect(PLATFORM_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is written on screen as 'platform vX.Y.Z'", () => {
    expect(PLATFORM_VERSION_LABEL).toBe(`platform v${PLATFORM_VERSION}`);
    expect(PLATFORM_VERSION_LABEL).toMatch(/^platform v\d+\.\d+\.\d+$/);
  });

  it("agrees with package.json", () => {
    // TWO NUMBERS KEPT IN STEP BY HAND ARE TWO NUMBERS THAT WILL DISAGREE.
    // `src/version.ts` is the one on screen and therefore the one that
    // matters; this is what stops the manifest quietly drifting away from
    // it, the way it had already drifted to 0.1.0 before this existed.
    expect((pkg as { version: string }).version).toBe(PLATFORM_VERSION);
  });
});
