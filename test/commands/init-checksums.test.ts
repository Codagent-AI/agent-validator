import { afterAll, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  computeExpectedSkillChecksum,
  computeHookChecksum,
  computeSkillChecksum,
  isGauntletHookEntry,
} from "../../src/commands/init-checksums.js";

const TEST_DIR = path.join(process.cwd(), `test-checksums-${Date.now()}`);

describe("computeSkillChecksum", () => {
  it("should compute checksum of single SKILL.md file", async () => {
    const dir = path.join(TEST_DIR, "single-skill");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), "# My Skill");

    const checksum = await computeSkillChecksum(dir);
    expect(typeof checksum).toBe("string");
    expect(checksum.length).toBe(64); // SHA-256 hex
  });

  it("should compute deterministic checksum regardless of read order", async () => {
    const dir = path.join(TEST_DIR, "multi-skill");
    await fs.mkdir(path.join(dir, "references"), { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), "# Skill");
    await fs.writeFile(path.join(dir, "references", "b.md"), "B content");
    await fs.writeFile(path.join(dir, "references", "a.md"), "A content");

    const c1 = await computeSkillChecksum(dir);
    const c2 = await computeSkillChecksum(dir);
    expect(c1).toBe(c2);
  });

  it("should detect content changes", async () => {
    const dir = path.join(TEST_DIR, "change-skill");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), "# Original");
    const c1 = await computeSkillChecksum(dir);

    await fs.writeFile(path.join(dir, "SKILL.md"), "# Modified");
    const c2 = await computeSkillChecksum(dir);
    expect(c1).not.toBe(c2);
  });
});

describe("computeExpectedSkillChecksum", () => {
  it("should compute checksum from content and references", () => {
    const checksum = computeExpectedSkillChecksum("# Skill", { "a.md": "A" });
    expect(typeof checksum).toBe("string");
    expect(checksum.length).toBe(64);
  });

  it("should match disk checksum for identical content", async () => {
    const dir = path.join(TEST_DIR, "expected-match");
    await fs.mkdir(path.join(dir, "references"), { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), "# Skill");
    await fs.writeFile(path.join(dir, "references", "ref.md"), "Ref content");

    const diskChecksum = await computeSkillChecksum(dir);
    const expectedChecksum = computeExpectedSkillChecksum("# Skill", { "ref.md": "Ref content" });
    expect(diskChecksum).toBe(expectedChecksum);
  });
});

describe("computeHookChecksum", () => {
  it("should compute checksum over gauntlet entries only", () => {
    const entries = [
      { hooks: [{ type: "command", command: "agent-gauntlet stop-hook", timeout: 300 }] },
      { type: "command", command: "echo hello" },
    ];
    const c1 = computeHookChecksum(entries);

    const entries2 = [
      { hooks: [{ type: "command", command: "agent-gauntlet stop-hook", timeout: 300 }] },
      { type: "command", command: "echo world" },
    ];
    const c2 = computeHookChecksum(entries2);
    expect(c1).toBe(c2);
  });

  it("should detect changes in gauntlet entries", () => {
    const entries1 = [
      { hooks: [{ type: "command", command: "agent-gauntlet stop-hook", timeout: 300 }] },
    ];
    const entries2 = [
      { hooks: [{ type: "command", command: "agent-gauntlet stop-hook", timeout: 600 }] },
    ];
    expect(computeHookChecksum(entries1)).not.toBe(computeHookChecksum(entries2));
  });

  it("should handle flat entries (Cursor format)", () => {
    const entries = [
      { command: "agent-gauntlet stop-hook", loop_limit: 10 },
    ];
    const checksum = computeHookChecksum(entries);
    expect(typeof checksum).toBe("string");
    expect(checksum.length).toBe(64);
  });
});

describe("isGauntletHookEntry", () => {
  it("should identify wrapped gauntlet entries", () => {
    expect(isGauntletHookEntry({ hooks: [{ command: "agent-gauntlet stop-hook" }] })).toBe(true);
  });

  it("should identify flat gauntlet entries", () => {
    expect(isGauntletHookEntry({ command: "agent-gauntlet start-hook" })).toBe(true);
  });

  it("should reject non-gauntlet entries", () => {
    expect(isGauntletHookEntry({ command: "echo hello" })).toBe(false);
  });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});
