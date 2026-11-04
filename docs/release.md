# Release and distribution

The npm registry is not available to this project's maintainer yet, so the
canonical distribution channel is the GitHub Release tarball. This page is the
checklist for a release.

## 1. Cut the version

```bash
# package.json + src/core/constants.mjs (PROTOCOL_VERSION)
npm test
node scripts/coverage-gate.mjs
```

Update `CHANGELOG.md`: move `Unreleased` entries into the new version.

## 2. Build the tarball

```bash
node scripts/release-tarball.mjs
```

It writes `dist/amsonix-trellis-<version>.tgz`, prints the commit, the sha256
and warns unless `HEAD` is tagged exactly `v<version>`. A tarball built from an
untagged commit is a development build and must not be attached to an existing
release. The file set comes from the `files` list in `package.json`, so the
tarball and the npm package can never disagree.

## 3. Tag and publish the Release

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

Pushing the tag runs `.github/workflows/release.yml`: it tests, builds the
tarball, creates the Release when missing, and uploads `dist/*.tgz`. The job
needs the repository's default `GITHUB_TOKEN` with `contents: write`, which the
workflow requests explicitly.

If the workflow cannot run (tags pushed before it existed, or Actions disabled),
create the Release by hand and attach the tarball from `dist/`. Record the
sha256 in the release notes either way.

## 4. Install without a registry

```bash
npm install -g https://github.com/amsonix/trellis/releases/download/vX.Y.Z/amsonix-trellis-X.Y.Z.tgz
trellis --version
trellis-mcp --help
```

Verify the checksum first if you downloaded the file by hand:

```bash
shasum -a 256 amsonix-trellis-X.Y.Z.tgz
```

## Why not npm?

The unscoped name `trellis` is taken and npm account registration was not
possible at release time. `npm install github:amsonix/trellis` works today and
tracks `main`; the tarball is the pinned alternative. If a registry becomes
available, publish the same tarball with `npm publish` — nothing else changes.
