---
id: OPERATIONS
project: {{PROJECT_NAME}}
stage: releasing
status: draft
owners: [operator]
version: 1
created: {{DATE}}
---

# Operations

## Deploy

- Environments, prerequisites, command, expected duration, who may run it.
- What is checked before and after the deploy.

## Rollback

- The exact command or procedure.
- What data or migrations make a rollback unsafe.
- Who decides to roll back.

## Monitoring

- The signals that say the system is healthy.
- The signals that say it is failing, and where they are read.

## Runbook

- Symptom -> check -> action.
- Escalation path and contact.
