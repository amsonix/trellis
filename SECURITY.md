# Security policy

Trellis is a local, file-based protocol. It is not a sandbox: the write guard is
a commit-time check, and a writer can still edit files by hand. See the
"Known boundaries" section of [`SPEC.md`](SPEC.md).

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/amsonix/trellis/security/advisories/new)
instead of opening a public issue.

Include the version, the Node.js version, a minimal reproducer and what an
attacker gains. You can expect an acknowledgement within seven days.
