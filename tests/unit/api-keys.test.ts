import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, isApiKeyShape } from "@/lib/api-keys";

describe("api keys", () => {
  it("generates a key with the hapi_ prefix and matching hash", () => {
    const generated = generateApiKey();
    expect(generated.secret.startsWith("hapi_")).toBe(true);
    expect(generated.secret.length).toBeGreaterThan(20);
    expect(generated.prefix.length).toBe("hapi_".length + 8);
    expect(generated.secret.startsWith(generated.prefix)).toBe(true);
    expect(generated.hashedKey).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.hashedKey).toBe(hashApiKey(generated.secret));
  });

  it("hashApiKey is deterministic for the same input", () => {
    expect(hashApiKey("hapi_xxx")).toBe(hashApiKey("hapi_xxx"));
    expect(hashApiKey("hapi_xxx")).not.toBe(hashApiKey("hapi_yyy"));
  });

  it("rejects malformed shapes", () => {
    expect(isApiKeyShape("Bearer hapi_xxx")).toBe(false);
    expect(isApiKeyShape("hapi_")).toBe(false);
    expect(isApiKeyShape("token-without-prefix")).toBe(false);
    const generated = generateApiKey();
    expect(isApiKeyShape(generated.secret)).toBe(true);
  });
});
