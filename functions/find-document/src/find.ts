// The pure core of find_document. It never returns names, dates or digits, and never
// says which detail failed to match (FD-5).

import { z } from 'zod';
import { namesMatch } from '../../validate-fields/src/rules/names';

export const FindInput = z.object({
  full_name: z.string().trim().min(2).max(100),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  id_last4: z.string().regex(/^\d{4}$/),
});
export type FindInput = z.infer<typeof FindInput>;

const EXPECTED: Record<keyof FindInput, string> = {
  full_name: 'the full name, 2 to 100 characters',
  date_of_birth: 'a date in YYYY-MM-DD form',
  id_last4: 'exactly 4 digits',
};

export interface StoredRecord {
  status?: string;
  name_normalized?: string;
  id_last4?: Set<string> | string[];
  reference?: string;
  collection_point?: string;
}

export type FindResult =
  | { status: 'HELD'; collection_point: string; references: string[] }
  | { status: 'NOT_FOUND' }
  | { status: 'INVALID_INPUT'; field: string; expected: string };

export function parseInput(raw: unknown): { ok: true; input: FindInput } | { ok: false; result: FindResult } {
  const parsed = FindInput.safeParse(raw);
  if (parsed.success) return { ok: true, input: parsed.data };
  const field = (parsed.error.issues[0]?.path[0] as keyof FindInput | undefined) ?? 'full_name';
  return { ok: false, result: { status: 'INVALID_INPUT', field, expected: EXPECTED[field] ?? 'a valid value' } };
}

export function matchRecords(input: FindInput, records: StoredRecord[]): FindResult {
  const matches = records.filter((r) => {
    const last4 = r.id_last4 instanceof Set ? [...r.id_last4] : r.id_last4 ?? [];
    return r.status === 'HELD' && last4.includes(input.id_last4) && namesMatch(input.full_name, r.name_normalized ?? '');
  });
  if (matches.length === 0) return { status: 'NOT_FOUND' };
  return {
    status: 'HELD',
    collection_point: matches[0].collection_point ?? '',
    references: matches.map((m) => m.reference ?? '').filter(Boolean),
  };
}
