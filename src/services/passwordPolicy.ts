import { createHash } from 'node:crypto';

/**
 * Password policy for every place a password is set (signup, reset, change).
 * Requirements (founder request 2026-07-13, Week 8):
 *   - at least 12 characters
 *   - at least 3 of 4 character classes (lower / upper / digit / symbol)
 *   - not a known-common password
 *   - not in the HaveIBeenPwned breach corpus (k-anonymity range API — only
 *     the first 5 chars of the SHA-1 ever leave our server; fails OPEN so an
 *     HIBP outage can never block signups)
 */

// Common bases people pad out to 12+ chars ("password1234!", "iloveyou2026…").
// The candidate is lowercased and stripped of digits/symbols before comparing.
const COMMON_BASES = new Set([
  'password', 'passwort', 'contrasena', 'qwerty', 'qwertyuiop', 'asdfghjkl',
  'letmein', 'welcome', 'iloveyou', 'sunshine', 'princess', 'dragon', 'monkey',
  'football', 'baseball', 'superman', 'batman', 'trustno', 'whatever',
  'admin', 'administrator', 'root', 'login', 'starwars', 'pokemon',
  'abcdefghijkl', 'petpro', 'petproconnect',
]);

/** Returns a human-readable problem, or null when the password passes. */
export async function validatePasswordStrength(password: string): Promise<string | null> {
  if (password.length < 12) {
    return 'Password must be at least 12 characters.';
  }
  // Supabase Auth hashes with bcrypt, which only reads the first 72 bytes.
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return 'Password must be at most 72 characters.';
  }

  const classes =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/[0-9]/.test(password)) +
    Number(/[^a-zA-Z0-9]/.test(password));
  if (classes < 3) {
    return 'Password must mix at least 3 of: lowercase, uppercase, numbers, symbols.';
  }

  const base = password.toLowerCase().replace(/[^a-z]/g, '');
  if (COMMON_BASES.has(base)) {
    return 'That password is too common — pick something less guessable.';
  }
  if (/^(.)\1+$/.test(password)) {
    return 'That password is too repetitive — pick something less guessable.';
  }

  if (await isBreached(password)) {
    return 'That password has appeared in a known data breach — pick a different one.';
  }
  return null;
}

async function isBreached(password: string): Promise<boolean> {
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: AbortSignal.timeout(3000),
      headers: { 'Add-Padding': 'true' },
    });
    if (!res.ok) return false; // fail open
    const body = await res.text();
    return body.split('\n').some((line) => {
      const [hashSuffix, count] = line.trim().split(':');
      return hashSuffix === suffix && Number(count) > 0;
    });
  } catch {
    return false; // fail open — never let an HIBP outage block account creation
  }
}
