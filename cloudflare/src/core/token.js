const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export function isOpaqueToken(value) {
  return TOKEN_PATTERN.test(value);
}

export async function hashOpaqueToken(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
