import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => ({
  AzureOpenAI: vi.fn().mockImplementation(function MockAzureOpenAI() {
    return {
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    };
  }),
}));

import { generateAssessment, type AssessmentInput } from "./llm-client";

const VALID_ENV = {
  AZURE_OPENAI_ENDPOINT: "https://example-resource.azure.openai.com/",
  AZURE_OPENAI_API_KEY: "test-api-key",
  AZURE_OPENAI_DEPLOYMENT: "gpt-4o-test-deployment",
  AZURE_OPENAI_API_VERSION: "2024-10-21",
};

const validInput: AssessmentInput = {
  weight_lbs_current: 210,
  weight_lbs_goal: 195,
  days_tracked: 30,
  avg_calories_last_7d: 2100,
  avg_protein_g_last_7d: 165,
  workout_count_last_7d: 4,
};

beforeEach(() => {
  for (const [key, value] of Object.entries(VALID_ENV)) {
    vi.stubEnv(key, value);
  }
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: "mocked assessment text" } }],
    usage: { prompt_tokens: 150, completion_tokens: 80 },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("generateAssessment", () => {
  it("returns the model's content and normalized usage stats", async () => {
    const result = await generateAssessment(validInput);

    expect(result.content).toBe("mocked assessment text");
    expect(result.usage.input_tokens).toBe(150);
    expect(result.usage.output_tokens).toBe(80);
    expect(result.model).toBe(VALID_ENV.AZURE_OPENAI_DEPLOYMENT);
  });

  it("rejects with an error naming the missing env var", async () => {
    vi.stubEnv("AZURE_OPENAI_API_KEY", "");

    await expect(generateAssessment(validInput)).rejects.toThrow(
      "AZURE_OPENAI_API_KEY",
    );
  });
});
