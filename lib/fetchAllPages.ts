export async function fetchAllPages<T>(readPage: (from: number, to: number) => Promise<T[] | null>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await readPage(from, from + 999);
    if (!page) return null;
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}
