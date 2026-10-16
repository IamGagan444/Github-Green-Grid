import { describe, expect, it } from "vitest";

import { completeOrSkip, noAiKeyError, resolveAiSource, type AiPort } from "@/lib/ai/port";
import { AppError } from "@/lib/errors";

const user = { baseUrl: "https://api.groq.com/openai/v1", apiKey: "gsk_user", model: "llama" };
const platform = { baseUrl: "https://integrate.api.nvidia.com/v1", apiKey: "nvapi-platform", model: "nemotron" };

describe("bring-your-own-key resolution", () => {
  it("prefers the user's own key everywhere", () => {
    expect(resolveAiSource({ userEndpoint: user, platformEndpoint: platform, production: true })).toEqual({ kind: "user", endpoint: user });
  });

  it("never falls back to the platform key in production", () => {
    expect(resolveAiSource({ userEndpoint: null, platformEndpoint: platform, production: true })).toEqual({ kind: "none" });
  });

  it("uses the platform key outside production for convenience", () => {
    expect(resolveAiSource({ userEndpoint: null, platformEndpoint: platform, production: false })).toEqual({
      kind: "platform",
      endpoint: platform,
    });
  });
});

describe("AI steps without a key", () => {
  it("are skipped, not failed", async () => {
    const port: AiPort = {
      complete: async () => {
        throw noAiKeyError();
      },
    };
    await expect(completeOrSkip(port, { system: "s", user: "u" })).resolves.toBeNull();
    expect(noAiKeyError().userMessage).toContain("Settings → Connections");
  });

  it("other AI errors still propagate (so they are retried)", async () => {
    const port: AiPort = {
      complete: async () => {
        throw new AppError("AI_PROVIDER_FAILED", "503");
      },
    };
    await expect(completeOrSkip(port, { system: "s", user: "u" })).rejects.toMatchObject({ code: "AI_PROVIDER_FAILED" });
  });

  it("returns the completion when a key is configured", async () => {
    const port: AiPort = { complete: async () => ({ content: "summary", model: "m" }) };
    await expect(completeOrSkip(port, { system: "s", user: "u" })).resolves.toEqual({ content: "summary", model: "m" });
  });
});
