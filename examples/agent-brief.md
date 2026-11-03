# Example agent brief

The protocol is agent-facing: at each stage a runtime can hand the agent a
short, checkable brief instead of a long methodology document. This is the shape
of the brief for the architecture stage.

```md
# Role: Architect
Project: demo
Stage: architecture
Gate: G2 (Architecture)

## Read
- PROJECT.md
- docs/RESEARCH.md
- docs/GLOSSARY.md

## Write
- docs/ARCHITECTURE.md
- docs/adr/*.md
- docs/GLOSSARY.md (terms only)

## Do not
- write product code
- edit docs/ROADMAP.md or docs/TASKS.md (that is the Plan stage)
- approve G2 yourself

## Checklist
- [ ] Context names the boundary and every external actor
- [ ] Containers has Container / Responsibility / Interface for each container
- [ ] Data model names the source of truth and its invariants
- [ ] Failure modes say what the user sees and what is retried
- [ ] Security names trust boundaries, authentication and secrets
- [ ] Deployment says how it is built, configured and rolled back
- [ ] Observability names logs, metrics, traces and alerts
- [ ] Every open question has an owner
- [ ] At least one ADR records a key decision

## Done
- run `project-protocol check --stage architecture`
- when it has no fail, run `project-protocol gate G2 --approve --by architect:<you>`
- if blocked, run `project-protocol task report ... --state blocked` with one
  concrete question; do not write a long status essay
```

The brief is generated from the profile, the stage and the role. The tools are
the enforcement: `project-protocol check` and `project-protocol gate` decide
whether the artifacts are structurally complete; a human decides whether the
content is right.
