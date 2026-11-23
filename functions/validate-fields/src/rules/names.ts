// Name normalization and matching, shared by ValidateFields (name_normalized) and
// find_document (matching what the visitor typed). See docs/requirements.md, FD-4.

/**
 * NFKC, upper case, every character that is not a letter, combining mark or space
 * becomes a space, then spaces are collapsed. Combining marks are kept so that names
 * in Sinhala or Tamil script survive.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^\p{L}\p{M} ]/gu, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

function tokens(name: string): string[] {
  const normalized = normalizeName(name);
  return normalized ? normalized.split(' ') : [];
}

const letterCount = (token: string) => [...token].length;

/**
 * True when both conditions hold:
 *  - at least one visitor token of 3 or more letters is one of the stored tokens, and
 *  - every visitor token is a stored token, or an initial matching a stored token.
 * "K. A. PERERA" matches "KAMAL ANURA PERERA"; "K. A." alone does not.
 */
export function namesMatch(visitorName: string, storedName: string): boolean {
  const visitor = tokens(visitorName);
  const stored = tokens(storedName);
  if (visitor.length === 0 || stored.length === 0) return false;

  const hasRealName = visitor.some((t) => letterCount(t) >= 3 && stored.includes(t));
  const allAccountedFor = visitor.every(
    (t) => stored.includes(t) || (letterCount(t) === 1 && stored.some((s) => [...s][0] === t)),
  );
  return hasRealName && allAccountedFor;
}
