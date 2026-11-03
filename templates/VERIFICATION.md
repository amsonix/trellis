---
id: VERIFICATION
project: {{PROJECT_NAME}}
stage: plan
status: draft
owners: [verifier]
version: 1
created: {{DATE}}
---

# Verification

## Strategy

- What is checked at which level: unit, integration, end to end, manual review.
- What is deliberately not checked, and why.

## Oracle

- What is the source of truth for a correct result?
- Which failures can the oracle not see?

## Fixtures

- Inputs, golden outputs, seeds, environment, and how they are refreshed.
- What makes a fixture a no-op, and how that is rejected.

## Evidence

- Each acceptance criterion maps to an evidence kind: `test`, `benchmark`,
  `review`, `approval`, `log`, `screenshot` or `doc`.
- Evidence is stored with a commit or a file hash; a changed tree invalidates it.
- `inconclusive` is not a pass.
