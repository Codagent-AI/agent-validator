import { checkbox, confirm, number, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { getBuiltInReviewNames } from '../built-in-reviews/index.js';

export async function promptDevCLIs(
  detectedNames: string[],
  skipPrompts: boolean,
): Promise<string[]> {
  if (skipPrompts) return detectedNames;

  console.log();
  console.log(
    chalk.bold(
      'Select your development CLI(s). These are the main tools you work in.',
    ),
  );
  const selected = await checkbox({
    message: 'Development CLIs:',
    choices: detectedNames.map((name) => ({ name, value: name })),
    required: true,
  });
  return selected;
}

export async function promptReviewCLIs(
  detectedNames: string[],
  skipPrompts: boolean,
): Promise<string[]> {
  if (skipPrompts) return detectedNames;

  console.log();
  console.log(
    chalk.bold(
      'Select your reviewer CLI(s). These are the CLIs that will be used for AI code reviews.',
    ),
  );
  const selected = await checkbox({
    message: 'Review CLIs:',
    choices: detectedNames.map((name) => ({ name, value: name })),
    required: true,
  });
  return selected;
}

export async function promptInstallScope(
  skipPrompts: boolean,
): Promise<'user' | 'project'> {
  if (skipPrompts) return 'project';

  console.log();
  return select({
    message: 'Install scope for Claude plugin and Codex skills:',
    choices: [
      { name: 'Local (project)', value: 'project' as const },
      { name: 'Global (user)', value: 'user' as const },
    ],
  });
}

export async function promptNumReviews(
  reviewCliCount: number,
  skipPrompts: boolean,
): Promise<number> {
  if (reviewCliCount === 1) return 1;
  if (skipPrompts) return reviewCliCount;

  const result = await number({
    message: 'How many of these CLIs would you like to run on every review?',
    min: 1,
    max: reviewCliCount,
    default: 1,
  });
  return result ?? 1;
}

export type OverwriteChoice = 'yes' | 'no' | 'all';

export async function promptFileOverwrite(
  name: string,
  skipPrompts: boolean,
): Promise<OverwriteChoice> {
  if (skipPrompts) return 'yes';

  return select({
    message: `Skill \`${name}\` has changed, update it?`,
    choices: [
      { name: 'Yes', value: 'yes' as const },
      { name: 'No', value: 'no' as const },
      { name: 'Yes to all remaining', value: 'all' as const },
    ],
  });
}

export async function promptBuiltInReviews(
  skipPrompts: boolean,
): Promise<string[]> {
  const allNames = getBuiltInReviewNames();
  if (skipPrompts) return allNames;

  console.log();
  console.log(
    chalk.bold(
      'Select the built-in review prompts to enable. These run as independent AI code review passes.',
    ),
  );

  let selected: string[] = [];
  let confirmed = false;

  while (!confirmed) {
    selected = await checkbox({
      message: 'Built-in reviews:',
      choices: allNames.map((name) => ({ name, value: name, checked: true })),
    });

    if (selected.length === 0) {
      confirmed = await confirm({
        message:
          'No reviews selected. Are you sure you want to continue without any built-in reviews?',
        default: false,
      });
    } else {
      confirmed = true;
    }
  }

  return selected;
}

export async function promptHookOverwrite(
  hookFile: string,
  skipPrompts: boolean,
): Promise<boolean> {
  if (skipPrompts) return true;

  return confirm({
    message: `Hook configuration in ${hookFile} has changed, update it?`,
    default: true,
  });
}
