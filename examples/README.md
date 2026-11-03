# Examples

- [`walkthrough.md`](walkthrough.md) — the full CLI loop from `init` to
  `maintained`.
- [`agent-brief.md`](agent-brief.md) — the shape of the per-stage brief an agent
  receives.

Run the tests first:

```bash
npm test
```

Create a throwaway project:

```bash
node ../bin/project-protocol.mjs init /tmp/pp-demo
node ../bin/project-protocol.mjs status --dir /tmp/pp-demo
```
