// .claude/skills/capture-eval-issues/scripts/append-inventory.ts
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parse, stringify } from "yaml";

interface InventoryIssue {
  id: string;
  file: string;
  line_range: [number, number];
  description: string;
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
  const newIssues: InventoryIssue[] = Array.isArray(parsed) ? parsed : parsed?.issues ?? [];

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
  while (dir !== "/" && !existsSync(resolve(dir, "package.json"))) {
    dir = resolve(dir, "..");
  }
  const inventoryPath = resolve(dir, "evals", "inventory.yml");

  const result = appendToInventory(inventoryPath, input);
  console.log(`Appended ${result.added} issue(s) to ${inventoryPath}`);
}

if (import.meta.main) {
  main();
}
