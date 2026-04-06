import chalk from 'chalk';

const MODELS = {
  SONNET: 'claude-sonnet-4.6',
  GPT_CODEX: 'gpt-5.3-codex',
} as const;

export type ReviewEntry = {
  name: string;
  builtin: string;
  cli_preference?: string[];
  model?: string;
};

export type ReviewConfig = {
  type: 'primary' | 'secondary' | 'fallback';
  reviews: ReviewEntry[];
};

export function selectReviewConfig(reviewCLINames: string[]): ReviewConfig {
  if (reviewCLINames.includes('github-copilot')) {
    return {
      type: 'primary',
      reviews: [
        {
          name: 'code-quality',
          builtin: 'code-quality',
          cli_preference: ['github-copilot'],
          model: MODELS.SONNET,
        },
        {
          name: 'security-and-errors',
          builtin: 'security-and-errors',
          cli_preference: ['github-copilot'],
          model: MODELS.GPT_CODEX,
        },
      ],
    };
  }
  if (reviewCLINames.includes('codex')) {
    return {
      type: 'secondary',
      reviews: [
        {
          name: 'all-reviewers',
          builtin: 'all-reviewers',
          model: MODELS.GPT_CODEX,
        },
      ],
    };
  }
  return {
    type: 'fallback',
    reviews: [{ name: 'all-reviewers', builtin: 'all-reviewers' }],
  };
}

export function printReviewConfigExplanation(config: ReviewConfig): void {
  console.log();
  switch (config.type) {
    case 'primary':
      console.log(
        chalk.bold(
          'Configured two-pass hybrid reviews: code-quality via Sonnet, security + error-handling via GPT (GitHub Copilot detected).',
        ),
      );
      break;
    case 'secondary':
      console.log(
        chalk.bold('Configured combined all-reviewers pass via Codex.'),
      );
      break;
    case 'fallback':
      console.log(
        chalk.bold('Configured combined all-reviewers review prompt.'),
      );
      break;
  }
}
