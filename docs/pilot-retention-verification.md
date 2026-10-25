# Local pilot retention verification

**Date:** 2026-10-25

**Branch:** `test/pilot-retention-check`, based on `feat/pilot-integrated-preview` at `f0c015a`

**Scope:** Local Supabase project `drop` only. This does not verify the hosted Free project or its schedule.

## Provenance and safety checks

- `supabase/config.toml` identifies `project_id = "drop"`; read-only `supabase status -o env` returned API host `127.0.0.1`, port `54321`. Key values were captured only in memory and never printed.
- Docker metadata identified `supabase_db_drop`, `supabase_kong_drop`, and `supabase_edge_runtime_drop` as Supabase CLI project `drop`, on `supabase_network_drop`.
- The host port `54321` was owned by an SSH process, so the test did not use that host route. It called `http://kong:8000` from inside `supabase_db_drop`, directly on the project’s Docker network. A deliberately wrong cleanup secret returned `401 {"error":"Unauthorized."}` before the worker could create a client or run cleanup.
- A read-only database preflight confirmed both staged-retention RPCs exist, the pending-media queue and final-media queue are empty, there are no existing aged unlinked candidates in `drop-media`, and the staged-media scan cursor is null.
- `.env.local` was not read. No hosted credentials or project were used. The test did not touch port 4004, `/letter`, or migrations.

## Test and result

Two random Storage objects tagged with the `image/png` content type were uploaded through the local Storage API to `drop-media`, using valid staging paths shaped as `{sender-uuid}/pending/pilot-{draft-uuid}/{upload-uuid}`. One exact `storage.objects` metadata row was set to `created_at = now() - 31 days`; the other kept its upload timestamp. The test only updated that exact age field and never deleted from `storage.objects` with SQL.

The worker endpoint was invoked from the local Docker network:

```text
POST http://kong:8000/functions/v1/cleanup-expired-drop-media
```

The authorized worker response was:

```json
{"reconciled":0,"processed":0,"removed":0,"retried":0,"stagedScanned":1,"stagedRemoved":1,"stagedRetried":0,"stagedFinishFailures":0}
```

After the worker ran, a Storage API read confirmed the 31-day fixture was not found (HTTP 400/404), while the recent fixture still returned HTTP 200. The worker removed the aged object through the Storage API.

Cleanup deleted both exact object paths through the Storage API. The test removed only the tombstone row created for its aged path and restored the scan cursor to its initial null value. The final exact check returned `0|0|t`: zero fixture objects, zero fixture tombstones, and a null scan cursor. No unrelated cleanup work was present or processed.

## Remaining verification

This demonstrates local behavior for the current Drop schema, Storage API, and Edge Function. Hosted worker deployment, the hosted hourly schedule/Vault configuration, Free-project behavior, and physical deletion on a hosted project remain unverified.
