# Walkthrough: from a request to `maintained`

This is the whole loop, using only the CLI. The project is a placeholder; the
commands are the point.

```bash
PROJECT_PROTOCOL="node /path/to/trellis/bin/trellis.mjs"
DEMO=/tmp/pp-demo

# 1. Create the artifact set. Nothing is approved yet.
$PROJECT_PROTOCOL init "$DEMO"

# 2. Read the state. The stage is intake; G0 is pending.
$PROJECT_PROTOCOL status --dir "$DEMO"

# 3. Fill .trellis/PROJECT.md, then check the structure.
$PROJECT_PROTOCOL check --dir "$DEMO" --stage intake

# 4. A human approves the scope. An executor cannot.
$PROJECT_PROTOCOL gate G0 --approve --by human:alice --dir "$DEMO"

# 5. Research, architecture and plan are the same loop.
$PROJECT_PROTOCOL gate G1 --approve --by architect:bob --dir "$DEMO"
$PROJECT_PROTOCOL gate G2 --approve --by architect:bob --dir "$DEMO"
$PROJECT_PROTOCOL gate G3 --approve --by human:alice --dir "$DEMO"

# 6. G4 checks the task graph: acyclic, scoped, no concurrent overlap.
$PROJECT_PROTOCOL gate G4 --approve --by coordinator:bot --dir "$DEMO"

# 7. Ask what to do next, then claim the task.
$PROJECT_PROTOCOL next --role executor --dir "$DEMO"
$PROJECT_PROTOCOL task claim T-001 --by executor:worker-1 --dir "$DEMO"

# 8. Do the work, then attach evidence. A claim without evidence is refused.
echo "tests passed" > "$DEMO/test.log"
$PROJECT_PROTOCOL evidence add --task T-001 --kind test --uri test.log \
  --verdict pass --by verifier:ci --dir "$DEMO"
$PROJECT_PROTOCOL task report T-001 --state done --dir "$DEMO"

# 9. Review, integrate, release.
$PROJECT_PROTOCOL gate G5 --task T-001 --approve --by reviewer:alice --dir "$DEMO"
$PROJECT_PROTOCOL gate G6 --approve --by verifier:ci --dir "$DEMO"
$PROJECT_PROTOCOL gate G7 --approve --by human:alice --dir "$DEMO"

# 10. The stage is now maintained.
$PROJECT_PROTOCOL status --dir "$DEMO"
```

## What the guard adds

Before committing, the executor can ask whether its staged paths are inside its
lease:

```bash
$PROJECT_PROTOCOL guard commit --task T-001 --staged --dir "$DEMO"
# exit 0: every staged path is in T-001's scope and no other task holds it
# exit 3: a path is out of scope or leased by another task

$PROJECT_PROTOCOL guard commit --task T-001 --staged --observe --dir "$DEMO"
# exit 0, but prints WOULD-BLOCK lines; use this before enforcing the guard
```

## What is not automatic

The protocol does not write the architecture, choose the product scope or accept
the result. It makes those steps explicit, checkable and reviewable. A person
still approves G0, G3, G6 and G7.
