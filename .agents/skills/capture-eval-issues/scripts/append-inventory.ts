// .agents/skills/capture-eval-issues/scripts/append-inventory.ts
import { readFileSync, writeFileSync, existsSync } from "fs";
import { parse as parsePath, resolve } from "path";
import { parse, stringify } from "yaml";

interface InventoryIssue {
  id: string;
  file: string;
  line_range: [number, number];
  description: string;
  code_snippet: string;
  category: "bug" | "security" | "performance";
  difficulty: "easy" | "medium" | "hard";
  priority: "critical" | "high" | "medium" | "low";
  source: string;
}

interface InventoryFile {
  issues: InventoryIssue[];
}

export function appendToInventory(
  inventoryPath: string,
  newYaml: string
): { added: number } {
  const parsed = parse(newYaml);
  const candidate = Array.isArray(parsed)
    ? parsed
    : parsed && Array.isArray(parsed.issues)
      ? parsed.issues
      : [];
  const newIssues = candidate.map(validateInventoryIssue);

  if (newIssues.length === 0) {
    return { added: 0 };
  }

  let inventory: InventoryFile;
  if (existsSync(inventoryPath)) {
    const raw = readFileSync(inventoryPath, "utf-8");
    inventory = parse(raw) ?? { issues: [] };
    if (!Array.isArray(inventory.issues)) {
      inventory.issues = [];
    }
  } else {
    inventory = { issues: [] };
  }

  inventory.issues.push(...newIssues);
  writeFileSync(inventoryPath, stringify(inventory, { lineWidth: 100 }), "utf-8");

  return { added: newIssues.length };
}

function validateInventoryIssue(value: unknown): InventoryIssue {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid inventory issue: expected object");
  }
  const issue = value as Partial<InventoryIssue>;
  const requiredStrings = [
    "id",
    "file",
    "description",
    "code_snippet",
    "source",
  ] as const;
  for (const key of requiredStrings) {
    if (typeof issue[key] !== "string") {
      throw new Error(`Invalid inventory issue: ${key} must be a string`);
    }
  }
  const lineRange = issue.line_range;
  if (
    !Array.isArray(lineRange) ||
    lineRange.length !== 2 ||
    !Number.isInteger(lineRange[0]) ||
    !Number.isInteger(lineRange[1]) ||
    lineRange[0] < 1 ||
    lineRange[1] < lineRange[0]
  ) {
    throw new Error(
      "Invalid inventory issue: line_range must be [start >= 1, end >= start]",
    );
  }
  if (!["bug", "security", "performance"].includes(String(issue.category))) {
    throw new Error("Invalid inventory issue: category is not supported");
  }
  if (!["easy", "medium", "hard"].includes(String(issue.difficulty))) {
    throw new Error("Invalid inventory issue: difficulty is not supported");
  }
  if (!["critical", "high", "medium", "low"].includes(String(issue.priority))) {
    throw new Error("Invalid inventory issue: priority is not supported");
  }
  return issue as InventoryIssue;
}

async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  const input = Buffer.concat(chunks).toString("utf-8").trim();

  if (!input) {
    console.log("No input provided on stdin.");
    process.exit(0);
  }

  let dir = resolve(import.meta.dir);
  const rootDir = parsePath(dir).root;
  while (dir !== rootDir && !existsSync(resolve(dir, "package.json"))) {
    dir = resolve(dir, "..");
  }
  if (!existsSync(resolve(dir, "package.json"))) {
    throw new Error("Could not locate repository root (package.json not found)");
  }
  const inventoryPath = resolve(dir, "evals", "inventory.yml");

  const result = appendToInventory(inventoryPath, input);
  console.log(`Appended ${result.added} issue(s) to ${inventoryPath}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
