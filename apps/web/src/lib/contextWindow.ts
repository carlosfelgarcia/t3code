export function formatContextWindowTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "0";
  }
  if (value < 1_000) {
    return `${Math.round(value)}`;
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (value < 999_500) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

// Quality drops well before most windows run out, so usage is shown against this ceiling.
const CONTEXT_BUDGET_TOKENS = 200_000;

export function contextBudget(usage: {
  readonly usedTokens: number;
  readonly maxTokens: number | null;
}) {
  const windowTokens = usage.maxTokens !== null && usage.maxTokens > 0 ? usage.maxTokens : null;
  const budgetTokens =
    windowTokens !== null ? Math.min(CONTEXT_BUDGET_TOKENS, windowTokens) : CONTEXT_BUDGET_TOKENS;
  const modelWindowTokens = windowTokens !== budgetTokens ? windowTokens : null;
  const usedPercentage = Math.min(100, (Math.max(0, usage.usedTokens) / budgetTokens) * 100);
  const tone = usedPercentage >= 80 ? "error" : usedPercentage >= 50 ? "warning" : "success";
  return { budgetTokens, modelWindowTokens, usedPercentage, tone } as const;
}
