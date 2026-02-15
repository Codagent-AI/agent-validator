import { Glob } from 'bun';

const patterns = [
  "openspec/changes/archive",
  "**/design.md"
];

const files = [
  "openspec/changes/improve-review-tracking/design.md",
  "openspec/changes/improve-review-tracking/proposal.md",
  "openspec/changes/improve-review-tracking/specs/agent-command/spec.md",
  "openspec/changes/improve-review-tracking/specs/log-management/spec.md"
];

const globs: Glob[] = [];
const prefixes: string[] = [];

for (const pattern of patterns) {
  if (pattern.match(/[*?[{]/)) {
    globs.push(new Glob(pattern));
  } else {
    prefixes.push(pattern);
  }
}

console.log('Prefixes:', prefixes);
console.log('Globs:', globs.map(g => g.pattern));

for (const file of files) {
  const prefixMatch = prefixes.some((p) => file === p || file.startsWith(`${p}/`));
  const globMatch = globs.some((g) => g.match(file));
  const isExcluded = prefixMatch || globMatch;
  console.log(`${file}: prefix=${prefixMatch}, glob=${globMatch}, excluded=${isExcluded}`);
}
