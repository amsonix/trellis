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

It writes `dist/@amsonix-trellis-<version>.tgz` and prints the sha256. The file
set comes from the `files` list in `package.json`, so the tarball and the npm
package can never disagree.

## 3. Tag and publish the Release

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

Create the GitHub Release from the tag and attach the tarball from `dist/`.
Record the sha256 in the release notes.

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
