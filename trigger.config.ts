import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // From the trigger.dev dashboard: Project settings -> Project ref.
  // Not a secret (it identifies the project, it doesn't grant access), so
  // it is checked in rather than read from the environment.
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_oakygyvwhvgflmpyebxk",

  dirs: ["./trigger"],

  // Matches the Node version CI runs on (.github/workflows/ci.yml).
  runtime: "node-22",

  // Seconds of CPU time. The daily job makes several network round-trips
  // (Hevy, Gmail, Azure OpenAI) but those are waits, not CPU, so this is
  // generous. Without it a task has no timeout at all.
  maxDuration: 300,

  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
});
