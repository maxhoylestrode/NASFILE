import argon2 from 'argon2';

// argon2id is the OWASP-recommended variant: resistant to both GPU
// cracking (like argon2i) and side-channel attacks (like argon2d).
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // ~19 MiB, OWASP minimum recommendation
  timeCost: 2,
  parallelism: 1,
};

// Minimum password strength for the MVP: length-based only (no
// composition rules — those push users toward predictable patterns).
// NIST 800-63B recommends length over complexity.
const MIN_PASSWORD_LENGTH = 10;

export function isPasswordStrongEnough(password: string): boolean {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // Malformed hash, etc. — treat as verification failure, not a crash.
    return false;
  }
}

export { MIN_PASSWORD_LENGTH };
