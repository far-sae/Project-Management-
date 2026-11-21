/**
 * Reads every row of a list, one request after another.
 *
 * The database hands out at most 1,000 rows per request. A list that asks once
 * is cut short there and nothing says so: the 1,001st lead is simply not on
 * the page, the duplicate check does not see it, and a count is wrong.
 */

/** Rows asked for per request: the most the database gives in one. */
export const PAGE_ROWS = 1000;
/** Where reading stops whatever happens, so a mistake can never read without end. */
export const MAX_ROWS = 20000;

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/**
 * `page(from, to)` returns the query for rows `from` to `to` (both counted).
 * It must build the query anew each time, and sort by something that never
 * ties (add the id last), or rows can swap places between two requests.
 */
export async function allRows<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_ROWS) {
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) throw error;
    const got = data ?? [];
    rows.push(...got);
    if (got.length < PAGE_ROWS) break;
  }
  return rows;
}
