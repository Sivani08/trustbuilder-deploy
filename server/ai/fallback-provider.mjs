import { z } from "zod";

const messageSchema = z.object({
  message: z.string().min(1).max(600),
  decision: z.enum(["FOLLOW_UP", "CLARIFY", "CHALLENGE", "ACKNOWLEDGE_AND_CONTINUE", "FINAL_QUESTION", "COMPLETE"]),
  conversationGoal: z.string().min(1).max(200),
  shouldContinue: z.boolean(),
  phase: z.number().int().min(4).max(5),
  rationaleCode: z.string().min(1).max(80),
  provider: z.string().default("fallback"),
  model: z.string().default("trustbuilder-fallback"),
  promptVersion: z.string().default("trustbuilder-fallback-v1")
});

export async function generateConversation(context) {
  const fallback = {
    message: context?.scenario?.openingSituation || "I need to understand the real operating constraint before I can respond responsibly.",
    decision: "FOLLOW_UP",
    conversationGoal: context?.scenario?.objective || "Clarify the customer context and next action.",
    shouldContinue: true,
    phase: 4,
    rationaleCode: "SAFE_FALLBACK",
    provider: "fallback",
    model: "trustbuilder-fallback",
    promptVersion: "trustbuilder-fallback-v1"
  };
  return messageSchema.parse(fallback);
}

export async function detectUseCase() {
  return { detected: false, confidence: 0.25, name: "", description: "Fallback detection is unavailable without an AI provider.", reason: "No AI provider configured." };
}

export async function probeUseCase() {
  return { message: "What decision should this use case help the reviewer make?", decision: "PROBE", targetField: "desiredOutcome", questionReason: "We need the decision this use case should support before moving into evidence and constraints.", complete: false, rationaleCode: "SAFE_FALLBACK", useCaseUpdate: { field: "none", scalarValue: "", listValues: [], confidence: 0 }, relationshipObservations: [], provider: "fallback", model: "trustbuilder-fallback", promptVersion: "trustbuilder-fallback-v1" };
}
