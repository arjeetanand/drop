<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Drop learning log

- Keep `LEARNINGS.md` as an append-only journal for each completed code-change or issue-resolution slice, including small bug fixes. Add the entry before handing the work back.
- For each entry, record the user-visible issue, its cause, what changed, how it was verified, the code commit and branch when available, and any important follow-up or verification gap. Base it on the actual Git diff and test output.
- Append new dated entries at the end; do not rewrite older lessons. If a past entry needs correction, add a dated correction instead.
- Never copy credentials, tokens, private message content, or other secrets into the log.
