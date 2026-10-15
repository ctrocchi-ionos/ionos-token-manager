/** Parse ?page=&limit= safely: page >= 1, 1 <= limit <= maxLimit. */
export function parsePaging(query: Record<string, unknown>, maxLimit = 500): { page: number; limit: number } {
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(String(query.limit ?? '50'), 10) || 50));
  return { page, limit };
}
