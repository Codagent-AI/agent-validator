import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { appendToInventory } from "../../.claude/skills/capture-eval-issues/scripts/append-inventory.ts";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { stringify } from "yaml";

describe("appendToInventory", () => {
  let tmpDir: string;
  let inventoryPath: string;

  beforeEach(() => {
    tmpDir = resolve(tmpdir(), `inventory-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    inventoryPath = resolve(tmpDir, "inventory.yml");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates inventory file when it does not exist", () => {
    const yaml = stringify([
      {
        id: "test-issue",
        file: "src/foo.ts",
        line_range: [10, 12],
        description: "A test issue",
        category: "bug",
        difficulty: "medium",
        priority: "high",
        source: "2026-02-16 test",
      },
    ]);

    const result = appendToInventory(inventoryPath, yaml);
    expect(result.added).toBe(1);
    expect(existsSync(inventoryPath)).toBe(true);

    const contents = readFileSync(inventoryPath, "utf-8");
    expect(contents).toContain("test-issue");
  });

  it("appends to existing inventory file", () => {
    writeFileSync(
      inventoryPath,
      stringify({
        issues: [
          {
            id: "existing-issue",
            file: "src/bar.ts",
            line_range: [1, 1],
            description: "Already here",
            category: "security",
            difficulty: "easy",
            priority: "critical",
            source: "2026-02-15 test",
          },
        ],
      }),
      "utf-8"
    );

    const yaml = stringify([
      {
        id: "new-issue",
        file: "src/baz.ts",
        line_range: [5, 7],
        description: "A new issue",
        category: "performance",
        difficulty: "hard",
        priority: "high",
        source: "2026-02-16 test",
      },
    ]);

    const result = appendToInventory(inventoryPath, yaml);
    expect(result.added).toBe(1);

    const contents = readFileSync(inventoryPath, "utf-8");
    expect(contents).toContain("existing-issue");
    expect(contents).toContain("new-issue");
  });

  it("accepts {issues: [...]} wrapped format", () => {
    const yaml = stringify({
      issues: [
        {
          id: "wrapped-issue",
          file: "src/wrap.ts",
          line_range: [1, 1],
          description: "Wrapped format test",
          category: "bug",
          difficulty: "easy",
          priority: "high",
          source: "2026-02-16 test",
        },
      ],
    });

    const result = appendToInventory(inventoryPath, yaml);
    expect(result.added).toBe(1);

    const contents = readFileSync(inventoryPath, "utf-8");
    expect(contents).toContain("wrapped-issue");
  });

  it("returns 0 when input has no issues", () => {
    const result = appendToInventory(inventoryPath, "");
    expect(result.added).toBe(0);
    expect(existsSync(inventoryPath)).toBe(false);
  });
});
