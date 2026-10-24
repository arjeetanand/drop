export async function fetchAllPages<T>(readPage: (from: number, to: number) => Promise<T[] | null>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await readPage(from, from + 999);
    if (!page) return null;
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

export async function fetchInBatches<TInput, TOutput>(
  inputs: readonly TInput[],
  readBatch: (batch: TInput[]) => Promise<TOutput[] | null>,
  batchSize = 100,
) {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError('Batch size must be a positive integer.');
  }

  const rows: TOutput[] = [];
  for (let offset = 0; offset < inputs.length; offset += batchSize) {
    const batch = await readBatch(inputs.slice(offset, offset + batchSize));
    if (!batch) return null;
    rows.push(...batch);
  }

  return rows;
}

export async function fetchPagedMailbox<TLetter extends { id: string }, TReaction>(
  readLetterPage: (from: number, to: number) => Promise<TLetter[] | null>,
  readReactionBatch: (letterIds: string[]) => Promise<TReaction[] | null>,
  reactionBatchSize = 100,
): Promise<{ letters: TLetter[]; reactions: TReaction[] | null } | null> {
  let letters: TLetter[] | null;
  try {
    letters = await fetchAllPages(readLetterPage);
  } catch {
    return null;
  }
  if (letters === null) return null;

  try {
    const reactions = await fetchInBatches(letters.map((letter) => letter.id), readReactionBatch, reactionBatchSize);
    return {
      letters,
      reactions,
    };
  } catch {
    return {
      letters,
      reactions: null,
    };
  }
}
