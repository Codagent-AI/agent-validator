/**
 * API list prices used to estimate an API-equivalent cost for adapters that
 * report tokens but no dollars (e.g. Codex). These are standard-tier API
 * rates, not what a subscription plan (ChatGPT, Copilot, ...) actually bills.
 *
 * Prices are USD per 1M tokens. Update `PRICES_AS_OF` whenever rates change.
 */
export const PRICES_AS_OF = "2026-09-29";

export interface ModelPrice {
	/** Uncached input, USD per 1M tokens. */
	input: number;
	/** Cached (cache-read) input, USD per 1M tokens. */
	cachedInput: number;
	/** Output (including reasoning), USD per 1M tokens. */
	output: number;
}

/** OpenAI standard tier. Unknown models are deliberately absent, never zero. */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
	"gpt-6-astra": { input: 10, cachedInput: 1, output: 50 },
	"gpt-6-sol": { input: 2, cachedInput: 0.2, output: 10 },
	"gpt-5.5": { input: 5, cachedInput: 0.5, output: 30 },
};

export interface PricedTokens {
	/** All input tokens, including cached ones. */
	inputTotal: number;
	/** Cache-read tokens; a subset of `inputTotal`. */
	cachedInput: number;
	/** Output tokens, including any reasoning tokens. */
	output: number;
}

const PROVIDER_PREFIX = /^(?:openai|azure)\//;

function normalizeModel(model: string): string {
	return model.trim().toLowerCase().replace(PROVIDER_PREFIX, "");
}

export function lookupModelPrice(
	model: string | null | undefined,
): ModelPrice | undefined {
	if (!model) return undefined;
	return MODEL_PRICES[normalizeModel(model)];
}

/** `(input - cached) * in + cached * cachedIn + output * out`, in USD. */
export function listPriceCost(price: ModelPrice, tokens: PricedTokens): number {
	const uncached = Math.max(0, tokens.inputTotal - tokens.cachedInput);
	return (
		(uncached * price.input +
			tokens.cachedInput * price.cachedInput +
			tokens.output * price.output) /
		1_000_000
	);
}
