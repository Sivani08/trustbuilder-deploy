import { z } from "zod";
import { detectUseCase as detectProviderUseCase, probeUseCase as probeProviderUseCase, generateConversation as generateProviderConversation } from "./provider.mjs";

const turnSchema = z.object({
  message: z.string().min(1).max(600),
  nextQuestion: z.string().nullable().optional(),
  extractedFacts: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  relationships: z.array(z.string()).default([]),
  completionState: z.enum(["in_progress", "ready_for_review", "complete"]).default("in_progress"),
  provider: z.string().default("fallback"),
  model: z.string().default("trustbuilder-fallback"),
  requestId: z.string().min(1)
});

export async function runUseCaseAgent({ context, message, requestId }) {
  try {
    const detected = await detectProviderUseCase({ text: message || context?.summary || "" });
    const probe = await probeProviderUseCase({ context, message, requestId, detected });
    const result = {
      message: probe?.message || "I need one clarifying fact to keep the use case grounded.",
      nextQuestion: probe?.message || null,
      extractedFacts: detected?.description ? [detected.description] : [],
      assumptions: [],
      risks: [],
      dependencies: [],
      openQuestions: [],
      relationships: [],
      completionState: probe?.complete ? "ready_for_review" : "in_progress",
      provider: probe?.provider || "fallback",
      model: probe?.model || "trustbuilder-fallback",
      requestId
    };
    return turnSchema.parse(result);
  } catch (error) {
    return turnSchema.parse({
      message: "I need one fact at a time so the discovery remains grounded and safe.",
      nextQuestion: "What is the decision this use case should help the reviewer make?",
      extractedFacts: [],
      assumptions: [],
      risks: [],
      dependencies: [],
      openQuestions: ["What decision should this use case help the reviewer make?"],
      relationships: [],
      completionState: "in_progress",
      provider: "fallback",
      model: "trustbuilder-fallback",
      requestId
    });
  }
}

export async function generateConversationTurn(context) {
  return generateProviderConversation(context);
}
