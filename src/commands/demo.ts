import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';

export function registerDemoCommand(program: Command): void {
  program
    .command('demo')
    .description('Scaffold a demo project in a temp directory')
    .action(async () => {
      await runDemo();
    });
}

async function runDemo(): Promise<void> {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-validator-demo-'),
  );

  try {
    console.log(chalk.cyan('Scaffolding demo project...'));
    await writeProjectFiles(tmpDir);
    await installDependencies(tmpDir);
    await setupGit(tmpDir);
    printSuccess(tmpDir);
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

// ---------------------------------------------------------------------------
// File templates
// ---------------------------------------------------------------------------

const PACKAGE_JSON = `{
  "name": "agent-validator-demo",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "devDependencies": {
    "eslint": "^9.0.0",
    "@eslint/js": "^9.0.0"
  }
}
`;

const ESLINT_CONFIG = `import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    rules: {
      complexity: ["error", { max: 5 }],
    },
  },
];
`;

const JSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "checkJs": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
`;

const GITIGNORE = `node_modules/
validator_logs/
dist/
`;

const VALIDATOR_CONFIG = `base_branch: main
log_dir: validator_logs
cli:
  default_preference:
    - claude
entry_points:
  - path: "."
    checks:
      - lint
    reviews:
      - code-quality
`;

const LINT_CHECK = `command: npx eslint --max-warnings 0 src/
timeout: 60
`;

const CODE_QUALITY_REVIEW = `builtin: code-quality
num_reviews: 1
`;

const CLEAN_UTILS = `/**
 * Formats a user's display name from their profile data.
 * @param {string} firstName
 * @param {string} lastName
 * @param {string} [nickname]
 * @returns {string}
 */
export function formatDisplayName(firstName, lastName, nickname) {
  if (nickname) {
    return nickname;
  }
  return \`\${firstName} \${lastName}\`;
}

/**
 * Calculates the total price for a list of items with optional discount.
 * @param {number[]} prices
 * @param {number} discountPercent
 * @returns {number}
 */
export function calculateTotal(prices, discountPercent = 0) {
  const subtotal = prices.reduce((sum, price) => sum + price, 0);
  const discount = subtotal * (discountPercent / 100);
  return subtotal - discount;
}
`;

const BUGGY_UTILS = `/**
 * Formats a user's display name from their profile data.
 * @param {string} firstName
 * @param {string} lastName
 * @param {string} [nickname]
 * @returns {string}
 */
export function formatDisplayName(firstName, lastName, nickname) {
  if (nickname) {
    return nickname;
  }
  return \`\${firstName} \${lastName}\`;
}

/**
 * Calculates the total price for a list of items with optional discount.
 * @param {number[]} prices
 * @param {number} discountPercent
 * @returns {number}
 */
export function calculateTotal(prices, discountPercent = 0) {
  const subtotal = prices.reduce((sum, price) => sum + price, 0);
  const discount = subtotal * (discountPercent / 100);
  return subtotal - discount;
}

// Cache shipping calculations to avoid redundant computation.
const shippingCache = new Map();

/**
 * Determines the shipping cost based on order properties.
 * Results are memoized for 60 seconds.
 * @param {number} weight
 * @param {number} distance
 * @param {boolean} isPriority
 * @param {string} customerTier
 * @param {number} itemCount
 * @param {boolean} isFragile
 * @returns {number}
 */
export function calculateShipping(
  weight,
  distance,
  isPriority,
  customerTier,
  itemCount,
  isFragile,
) {
  const cacheKey = \`\${weight}-\${distance}-\${isPriority}-\${customerTier}-\${itemCount}-\${isFragile}\`;
  const cached = shippingCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < 60000) {
    return cached.cost;
  }

  let cost = 0;

  if (weight < 1) {
    cost = 5;
  } else if (weight < 5) {
    cost = 10;
  } else if (weight < 20) {
    cost = 25;
  } else if (weight < 50) {
    cost = 45;
  } else {
    cost = 80;
  }

  if (distance < 100) {
    cost += 0;
  } else if (distance < 500) {
    cost += 10;
  } else if (distance < 1000) {
    cost += 25;
  } else {
    cost += 50;
  }

  if (isPriority) {
    cost *= 1.5;
  }

  if (customerTier === "gold") {
    cost *= 0.8;
  } else if (customerTier === "silver") {
    cost *= 0.9;
  } else if (customerTier === "platinum") {
    cost *= 0.7;
  }

  if (isFragile) {
    cost += 15;
  }

  if (itemCount > 10) {
    cost *= 0.95;
  }

  shippingCache.set(cacheKey, { cost, cachedAt: Date.now() });
  return cost;
}
`;

// ---------------------------------------------------------------------------
// Scaffolding helpers
// ---------------------------------------------------------------------------

async function writeProjectFiles(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.mkdir(path.join(dir, '.validator', 'checks'), { recursive: true });
  await fs.mkdir(path.join(dir, '.validator', 'reviews'), { recursive: true });

  await Promise.all([
    fs.writeFile(path.join(dir, 'package.json'), PACKAGE_JSON),
    fs.writeFile(path.join(dir, 'eslint.config.mjs'), ESLINT_CONFIG),
    fs.writeFile(path.join(dir, 'jsconfig.json'), JSCONFIG),
    fs.writeFile(path.join(dir, '.gitignore'), GITIGNORE),
    fs.writeFile(path.join(dir, 'src', 'utils.js'), CLEAN_UTILS),
    fs.writeFile(path.join(dir, '.validator', 'config.yml'), VALIDATOR_CONFIG),
    fs.writeFile(
      path.join(dir, '.validator', 'checks', 'lint.yml'),
      LINT_CHECK,
    ),
    fs.writeFile(
      path.join(dir, '.validator', 'reviews', 'code-quality.yml'),
      CODE_QUALITY_REVIEW,
    ),
  ]);
}

function gitSync(args: string[], cwd: string): void {
  execFileSync('git', args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function installDependencies(dir: string): Promise<void> {
  console.log(chalk.dim('Installing dependencies...'));
  try {
    execFileSync('bun', ['install'], {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    try {
      execFileSync('npm', ['install'], {
        cwd: dir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      console.log(
        chalk.yellow(
          'Could not install dependencies automatically. Run "npm install" manually.',
        ),
      );
    }
  }
}

async function setupGit(dir: string): Promise<void> {
  console.log(chalk.dim('Setting up git...'));

  // Initial commit on main with clean code
  gitSync(['init'], dir);
  gitSync(['checkout', '-b', 'main'], dir);
  gitSync(['config', 'user.email', 'demo@agent-validator.dev'], dir);
  gitSync(['config', 'user.name', 'Demo User'], dir);
  gitSync(['add', '-A'], dir);
  gitSync(['commit', '-m', 'Initial commit: clean project'], dir);

  // Working branch with buggy code
  gitSync(['checkout', '-b', 'demo/add-features'], dir);
  await fs.writeFile(path.join(dir, 'src', 'utils.js'), BUGGY_UTILS);
  gitSync(['add', '-A'], dir);
  gitSync(
    ['commit', '-m', 'feat: add shipping cost calculator with caching'],
    dir,
  );
}

function printSuccess(dir: string): void {
  console.log();
  console.log(chalk.green('Demo project created at:'));
  console.log(chalk.bold(`  ${dir}`));
  console.log();
  console.log('Branches:');
  console.log(
    `  ${chalk.dim('main')}                       Clean code (all checks pass)`,
  );
  console.log(
    `  ${chalk.dim('demo/add-features')}          Code with issues (current branch)`,
  );
  console.log();
  console.log('The working branch introduces a shipping calculator that has:');
  console.log('  1. High cyclomatic complexity (triggers the linter)');
  console.log('  2. An unbounded memoization cache (reviewer should catch)');
  console.log();
  console.log('To try it:');
  console.log(chalk.bold(`  cd ${dir}`));
  console.log(chalk.bold('  agent-validate check'));
  console.log(chalk.bold('  agent-validate run'));
  console.log();
  console.log(
    `Or use the ${chalk.bold('/validator-run')} skill in your AI coding agent.`,
  );
}
