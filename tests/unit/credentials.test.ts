import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskUsername } from "@/lib/security/credentials";

const originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

afterEach(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
});

describe("credential encryption", () => {
  it("round-trips encrypted secrets without storing plaintext", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = "test-key-with-at-least-thirty-two-characters";

    const encrypted = encryptSecret("senha-super-secreta");

    expect(encrypted.encryptedValue).not.toContain("senha");
    expect(decryptSecret(encrypted)).toBe("senha-super-secreta");
  });

  it("masks usernames for API responses", () => {
    expect(maskUsername("usuario@example.com")).toBe("us***om");
    expect(maskUsername("ab")).toBe("***");
  });
});
