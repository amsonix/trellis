# Contributing to Trellis

Thanks for taking the time to open an issue or a pull request.

## Before you start

- Read [`SPEC.md`](SPEC.md). It is the normative description of the protocol; a
  change in behaviour is a change to the spec, not only to the code.
- Read [`AGENTS.md`](AGENTS.md). It is the contract this repository is built on.

## The one rule

**A rule that cannot fail is not a rule.** Every blocking check in `src/core/`
needs a negative control in `test/`: a fixture that makes it fail. A pull
request that adds a check without a test that goes red when the check is removed
will be asked to add one.

## Working locally

```bash
git clone https://github.com/amsonix/trellis.git
cd trellis
npm test            # node --test; there is nothing to install
node bin/trellis.mjs --help
```

There is no build step and no runtime dependency. Do not add one without a
written reason in the pull request.

## Pull request checklist

- [ ] `npm test` passes.
- [ ] New behaviour has a test; new blocking behaviour has a negative control.
- [ ] `README.md` and `SPEC.md` are updated when the public surface changes.
- [ ] `CHANGELOG.md` has an entry when the change is user-visible.

## Commits

Short, imperative, scoped: `feat: ...`, `fix: ...`, `test: ...`, `docs: ...`,
`refactor: ...`, `chore: ...`.

## License

By contributing, you agree that your contribution is licensed under the MIT
license in [`LICENSE`](LICENSE).
