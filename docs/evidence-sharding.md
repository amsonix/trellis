# Evidence sharding: design and migration

Status: implemented in 0.9.0 (schema 3).

## Why

`evidence.jsonl` is append-only and parsed per read. The per-task fast path skips
unrelated `add` lines, but it still reads the whole file. On a 100k-event,
20 MB log a task read costs ~0.22 s and a full read ~1 s. Sharding by task makes
a task read proportional to that task's evidence, not the project's history.

## Layout

```text
.trellis/evidence/
  T-001.jsonl          # add/retract events for T-001, append-only
  T-002.jsonl
  archive/
    T-001.jsonl        # compacted-away retracted records (optional)
```

Event format is unchanged (`{"type":"add",...}` / `{"type":"retract",...}`).
The task id is encoded in the file name, not in an index.

## Reads

| Operation | Implementation |
|---|---|
| `listEvidence(root, taskId)` | read `evidence/<taskId>.jsonl` only |
| `listEvidence(root)` | read every shard, ordered by task id |
| `verify(task)` | the task shard |
| `retract(id)` | scan shards for the `add` with that id, then append the retract to that shard |

`retract` scans shards, not lines: with 1,000 tasks it opens 1,000 small files,
which is still cheaper than parsing a 20 MB log. Retraction is rare.

## Writes

- `add`: append one line to `evidence/<taskId>.jsonl`; create the directory.
- `retract`: locate the shard, append one line.
- `compact`: fold each shard to one `add` per record (retraction state folded
  in) and rewrite it through a temp file + rename; optionally move old retracted
  records to `archive/`.
- All writes stay under the existing project lock.

## Migration

Triggered lazily on the first evidence read, like the 0.2 `evidence.json`
migration:

1. If `.trellis/evidence.jsonl` does not exist, nothing to do.
2. Read the legacy log; fold it in memory to `id → record` and `id → taskId`.
3. Group records by task; write each `evidence/<taskId>.jsonl` through a temp
   file and rename (atomic per shard).
4. Verify: every legacy record id exists in exactly one shard.
5. Rename `evidence.jsonl` to `evidence.jsonl.migrated`.

Crash safety: steps 3–4 are idempotent (rewrite from the legacy file), and the
legacy file is only renamed at the end. A crash leaves the legacy log in place;
the next run rewrites the shards.

## Compatibility

- Ledger format changes, so `SCHEMA_VERSION` goes from 2 to 3. Older builds
  refuse schema 3 instead of silently missing evidence.
- A legacy project upgrades on the next write; read-only commands do not write.
- The legacy `.migrated` file is kept for rollback and manual inspection.

## Performance target

| Case | Today | After |
|---|---|---|
| 1k tasks / 100k events, read one task | ~0.22 s | ~1–5 ms |
| full read | ~1 s | ~1 s (all shards) |
| retract | ~1 s | ~1 s worst case (scan shards) |

## Test plan

1. Migration: legacy log with adds + retracts → identical folded state per task.
2. Migration is idempotent; a crash before rename leaves the legacy intact.
3. `listEvidence(task)` reads only that shard (assert other shards are untouched).
4. `retract` finds the record in another shard and appends there.
5. `compact` folds a shard and archives retracted records; a dry run writes
   nothing.
6. Concurrent adds for different tasks do not lose events.
7. Schema 2 state upgrades to 3 on the next write; an old build refuses 3.
8. Windows rename retries still apply.

## Rollback

Ship with the legacy file untouched until the end of migration. If a bug is
found, restore `evidence.jsonl.migrated` to `evidence.jsonl` and delete
`.trellis/evidence/`; the old code reads the legacy path again.

## Non-goals

- A sidecar `id → task` index: it can drift; scanning small shards is enough.
- SQLite: revisit only above ~1M events or multi-host.
