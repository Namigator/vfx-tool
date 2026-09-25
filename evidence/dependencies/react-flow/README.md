# React Flow dependency decision

User authorizes package installation after an inspector vets it (2026-09-25). Claude Opus5.5 LOW inspector reviewed the20 exact versions in manifest.json. Static PASS with limits: inspector.md.

Manager independently hashed all20 downloaded archives and verified their npm registry ECDSA signatures using the official registry key endpoint. The pnpm lockfile adds exactly those20 packages, preserving all77 previous package versions and integrity values. verification.json records the result. New versions are pinned through pnpm.overrides; install uses frozen lockfile and ignore-scripts.

The use-sync-external-store1.7.0 attestation references the React repository and runtime_release_from_ci.yml workflow. Registry signatures and content hashes were verified; the separate Sigstore provenance certificate chain was NOT independently verified. Full source and npm metadata retained locally in work/package-vetting (ignored download cache).

Existing module layout reported pnpm11.19.0 but installed Corepack only had pnpm10.15.1/9.0.0. The existing pnpm10.15.1 was used with lockfileVersion9 and a project-local store to reinstall approved locked packages; no package manager was downloaded. No package code install hooks ran. Type/build/browser acceptance is recorded separately; source vetting does not establish feature correctness.
