export function getProviderName() {
  return (process.env.AI_PROVIDER || "openrouter").toLowerCase();
}

export function isAiConfigured() {
  return getProviderName() === "fallback" ? false : Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY);
}
