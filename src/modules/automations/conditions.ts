import type { Condition, DomainEvent } from './types';

const get = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), obj);

function test(c: Condition, actual: unknown): boolean {
  const v = c.value;
  switch (c.operator) {
    case 'exists': return actual !== undefined && actual !== null;
    case 'eq': return actual === v || String(actual) === String(v);
    case 'neq': return !(actual === v || String(actual) === String(v));
    case 'gt': return Number(actual) > Number(v);
    case 'gte': return Number(actual) >= Number(v);
    case 'lt': return Number(actual) < Number(v);
    case 'lte': return Number(actual) <= Number(v);
    case 'in': return Array.isArray(v) && v.map(String).includes(String(actual));
    case 'not_in': return Array.isArray(v) && !v.map(String).includes(String(actual));
    case 'contains': return Array.isArray(actual) ? actual.map(String).includes(String(v)) : String(actual ?? '').includes(String(v));
  }
}

/** Conditions in the same group are AND'ed; groups are OR'ed. No conditions = match. */
export function matches(conditions: Condition[], event: DomainEvent): boolean {
  if (!conditions.length) return true;
  const groups = new Map<number, Condition[]>();
  for (const c of conditions) groups.set(c.group_key, [...(groups.get(c.group_key) ?? []), c]);
  return [...groups.values()].some((group) => group.every((c) => test(c, get(event, c.field))));
}
