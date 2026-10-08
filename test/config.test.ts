import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRejudgeConfig, resolveRejudgeConfig } from "../src/config.ts";

// Real-input tests: write an actual .rejudge/config.json and load it. No mocks.
function projectWith(content: string | null): string {
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-cfg-"));
  if (content !== null) {
    mkdirSync(join(cwd, ".rejudge"), { recursive: true });
    writeFileSync(join(cwd, ".rejudge", "config.json"), content);
  }
  return cwd;
}

// Point the global-config fallback (XDG_CONFIG_HOME) at a temp dir for the duration of fn.
function withGlobalConfig(content: string | null, fn: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), "rejudge-global-"));
  if (content !== null) {
    mkdirSync(join(dir, "rejudge"), { recursive: true });
    writeFileSync(join(dir, "rejudge", "config.json"), content);
  }
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
  }
}

const PROJECT_CFG = JSON.stringify({ reviewers: ["a/1@high", "b/2@high", "c/3@high"], judge: "d/4@medium" });
const OUTER_CFG = JSON.stringify({ reviewers: ["o/1@high", "o/2@high"], judge: "o/3@high" });
const GLOBAL_CFG = JSON.stringify({ reviewers: ["g/1@high", "g/2@high", "g/3@high"], judge: "g/4@medium" });

test("valid config parses each model's id and @level, defaulting debugLog", () => {
  const cwd = projectWith(JSON.stringify({ reviewers: ["a/1@xhigh", "b/2@high", "c/3@low"], judge: "d/4@medium" }));
  expect(loadRejudgeConfig(cwd)).toEqual({
    reviewers: [
      { id: "a/1", level: "xhigh" },
      { id: "b/2", level: "high" },
      { id: "c/3", level: "low" },
    ],
    judge: { id: "d/4", level: "medium" },
    debugLog: false,
  });
});

test("debugLog is read when set, and rejected when not a boolean", () => {
  const on = projectWith(
    JSON.stringify({ reviewers: ["a/1@high", "b/2@high"], judge: "d/4@medium", debugLog: true }),
  );
  expect(loadRejudgeConfig(on).debugLog).toBe(true);
  const bad = projectWith(
    JSON.stringify({ reviewers: ["a/1@high", "b/2@high"], judge: "d/4@medium", debugLog: "yes" }),
  );
  expect(() => loadRejudgeConfig(bad)).toThrow(/debugLog/);
});

test("a model id without an @level suffix is rejected for reviewers and judge", () => {
  const noReviewer = projectWith(JSON.stringify({ reviewers: ["a/1", "b/2@high"], judge: "d/4@medium" }));
  expect(() => loadRejudgeConfig(noReviewer)).toThrow(/reviewers\[0\].*reasoning level/i);
  const noJudge = projectWith(JSON.stringify({ reviewers: ["a/1@high", "b/2@high"], judge: "d/4" }));
  expect(() => loadRejudgeConfig(noJudge)).toThrow(/judge.*reasoning level/i);
});

test("an invalid reasoning level is rejected (unknown, wrong case, and 'off')", () => {
  const ultra = projectWith(JSON.stringify({ reviewers: ["a/1@ultra", "b/2@high"], judge: "d/4@medium" }));
  expect(() => loadRejudgeConfig(ultra)).toThrow(/invalid reasoning level/i);
  const upper = projectWith(JSON.stringify({ reviewers: ["a/1@high", "b/2@high"], judge: "d/4@MEDIUM" }));
  expect(() => loadRejudgeConfig(upper)).toThrow(/invalid reasoning level/i);
  const off = projectWith(JSON.stringify({ reviewers: ["a/1@off", "b/2@high"], judge: "d/4@medium" }));
  expect(() => loadRejudgeConfig(off)).toThrow(/invalid reasoning level/i);
});

test("an empty model id before the @level suffix is rejected", () => {
  const cwd = projectWith(JSON.stringify({ reviewers: ["@high", "b/2@high"], judge: "d/4@medium" }));
  expect(() => loadRejudgeConfig(cwd)).toThrow(/empty model id/i);
});

test("a malformed provider/model is rejected at config load", () => {
  const cwd = projectWith(JSON.stringify({ reviewers: ["noslash@high", "b/2@high"], judge: "d/4@medium" }));
  expect(() => loadRejudgeConfig(cwd)).toThrow(/malformed model id/i);
});

test("a leftover thinking block is rejected with a migration hint", () => {
  const cwd = projectWith(
    JSON.stringify({
      reviewers: ["a/1@high", "b/2@high"],
      judge: "d/4@medium",
      thinking: { reviewers: "xhigh", judge: "medium" },
    }),
  );
  expect(() => loadRejudgeConfig(cwd)).toThrow(/thinking.*no longer supported/i);
});

test("legacy panel and synth keys are rejected instead of accepted as aliases", () => {
  const cwd = projectWith(JSON.stringify({ panel: ["a/1@high", "b/2@high"], synth: "d/4@medium" }));
  expect(() => loadRejudgeConfig(cwd)).toThrow(/panel.*synth.*reviewers.*judge/i);
});

test("missing config file is rejected", () => {
  expect(() => loadRejudgeConfig(projectWith(null))).toThrow();
});

test("fewer than two reviewers are rejected", () => {
  const one = projectWith(JSON.stringify({ reviewers: ["a/1@high"], judge: "d/4@medium" }));
  expect(() => loadRejudgeConfig(one)).toThrow(/reviewers/);
  const none = projectWith(JSON.stringify({ reviewers: [], judge: "d/4@medium" }));
  expect(() => loadRejudgeConfig(none)).toThrow(/reviewers/);
});

test("two or more reviewers are accepted", () => {
  const two = projectWith(JSON.stringify({ reviewers: ["a/1@high", "b/2@high"], judge: "d/4@medium" }));
  expect(loadRejudgeConfig(two).reviewers).toEqual([
    { id: "a/1", level: "high" },
    { id: "b/2", level: "high" },
  ]);
  const four = projectWith(
    JSON.stringify({ reviewers: ["a/1@high", "b/2@high", "c/3@high", "e/5@high"], judge: "d/4@medium" }),
  );
  expect(loadRejudgeConfig(four).reviewers.map((model) => model.id)).toEqual(["a/1", "b/2", "c/3", "e/5"]);
});

test("missing judge is rejected", () => {
  const cwd = projectWith(JSON.stringify({ reviewers: ["a/1@high", "b/2@high", "c/3@high"] }));
  expect(() => loadRejudgeConfig(cwd)).toThrow(/judge/);
});

test("malformed JSON is rejected", () => {
  expect(() => loadRejudgeConfig(projectWith("{ not json"))).toThrow();
});

test("resolveRejudgeConfig: project config wins over global config", () => {
  const cwd = projectWith(PROJECT_CFG);
  withGlobalConfig(GLOBAL_CFG, () => {
    const result = resolveRejudgeConfig(cwd);
    expect(result.path).toBe(join(cwd, ".rejudge", "config.json"));
    expect(result.config.judge.id).toBe("d/4");
  });
});

test("resolveRejudgeConfig: falls back to the global config", () => {
  const cwd = projectWith(null);
  withGlobalConfig(GLOBAL_CFG, () => {
    const result = resolveRejudgeConfig(cwd);
    expect(result.path).toBe(join(process.env.XDG_CONFIG_HOME as string, "rejudge", "config.json"));
    expect(result.config.judge.id).toBe("g/4");
  });
});

test("resolveRejudgeConfig: old project path is not a compatibility alias", () => {
  const cwd = projectWith(null);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "fusion-agents.json"), PROJECT_CFG);
  withGlobalConfig(null, () => {
    expect(() => resolveRejudgeConfig(cwd)).toThrow(/no config found/);
  });
});

test("resolveRejudgeConfig: throws when neither a project nor a global config exists", () => {
  const cwd = projectWith(null);
  withGlobalConfig(null, () => {
    expect(() => resolveRejudgeConfig(cwd)).toThrow(/no config found/);
  });
});

// Parent-folder lookup (CFG-088): the nearest .rejudge/config.json up the tree wins.
function nestedFolder(root: string, ...parts: string[]): string {
  const dir = join(root, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("resolveRejudgeConfig: finds the config in a parent folder from a nested subfolder", () => {
  const root = projectWith(PROJECT_CFG);
  const sub = nestedFolder(root, "packages", "app");
  withGlobalConfig(GLOBAL_CFG, () => {
    const result = resolveRejudgeConfig(sub);
    expect(result.path).toBe(join(root, ".rejudge", "config.json"));
    expect(result.config.judge.id).toBe("d/4");
    expect(result.logRoot).toBe(root);
  });
});

test("resolveRejudgeConfig: the nearest config wins over a higher one", () => {
  const root = projectWith(OUTER_CFG);
  const middle = nestedFolder(root, "workspace");
  mkdirSync(join(middle, ".rejudge"), { recursive: true });
  writeFileSync(join(middle, ".rejudge", "config.json"), PROJECT_CFG);
  const sub = nestedFolder(middle, "app", "src");
  withGlobalConfig(GLOBAL_CFG, () => {
    const result = resolveRejudgeConfig(sub);
    expect(result.path).toBe(join(middle, ".rejudge", "config.json"));
    expect(result.config.judge.id).toBe("d/4");
    expect(result.logRoot).toBe(middle);
  });
});

test("resolveRejudgeConfig: a global fallback keeps logs in the current folder", () => {
  const sub = nestedFolder(projectWith(null), "app");
  withGlobalConfig(GLOBAL_CFG, () => {
    const result = resolveRejudgeConfig(sub);
    expect(result.path).toBe(join(process.env.XDG_CONFIG_HOME as string, "rejudge", "config.json"));
    expect(result.logRoot).toBe(sub);
  });
});

test("resolveRejudgeConfig: an invalid nearest config is an error, not a skip to a higher one", () => {
  const root = projectWith(PROJECT_CFG);
  const sub = nestedFolder(root, "app");
  mkdirSync(join(sub, ".rejudge"), { recursive: true });
  writeFileSync(join(sub, ".rejudge", "config.json"), "{ not json");
  withGlobalConfig(GLOBAL_CFG, () => {
    expect(() => resolveRejudgeConfig(sub)).toThrow(/not valid JSON/);
  });
});

test("resolveRejudgeConfig: the missing-config error says where Rejudge looked", () => {
  const sub = nestedFolder(projectWith(null), "app");
  withGlobalConfig(null, () => {
    const globalPath = join(process.env.XDG_CONFIG_HOME as string, "rejudge", "config.json");
    expect(() => resolveRejudgeConfig(sub)).toThrow(sub);
    expect(() => resolveRejudgeConfig(sub)).toThrow(/every parent folder/);
    expect(() => resolveRejudgeConfig(sub)).toThrow(globalPath);
  });
});
