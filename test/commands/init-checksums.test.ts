import { afterAll, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { computeSkillChecksum } from "../../src/commands/init-checksums.js";

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

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});
