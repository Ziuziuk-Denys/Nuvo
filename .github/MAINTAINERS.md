# Maintainer notes

Short notes for the repository owner. User and developer documentation lives on https://nuvo.quest/docs; building from source is in `PACKAGING.md`.

## Cut a release

1. On `main`, make sure CI is green.
2. If dependencies changed, run `node scripts/third-party-notices.mjs` and commit the new `THIRD-PARTY-NOTICES`.
3. Bump `version` in `package.json`. The tag is `v` plus this version; the workflow stops if they differ. `core/Cargo.toml` has its own version, which the release does not read.
4. Add a `## <version>` section at the top of `CHANGELOG.md`. `release.yml` stops without one and uses it as the release notes, so write it for listeners.
5. Add a `<release>` entry to `build/linux/quest.nuvo.Nuvo.metainfo.xml`.
6. Merge through a pull request, then tag the merge commit: `git tag -s v0.3.0 -m "Nuvo 0.3.0"` and `git push origin v0.3.0`.
7. `release.yml` builds every target, writes checksums and SBOMs, attests the build and creates a draft. Download one Linux build, run it, check the notes and that the `latest*.yml` files are attached (auto-update reads them), then publish.
8. If a job failed: fix it on `main`, `gh release delete v0.3.0 --cleanup-tag`, tag again. Try a risky release as `v0.x.0-rc.1` first.

Versions: `0.MINOR.0` for features or any change to stored data, `0.MINOR.PATCH` for fixes. A tag with `-` is published as a pre-release. Linux is supported; the Windows and macOS jobs are `experimental: true` in `release.yml` until they pass.

## Secrets

All optional. Without them the workflows still run and ship unsigned files.

- macOS signing: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` (Apple Developer Program, 99 USD per year).
- Windows signing, Azure Trusted Signing: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SIGN_ENDPOINT`, `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE`. Or a classic certificate: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`.
- Linux needs none: checksums and the build attestation cover integrity.
- Telegram: `telegram-upload.yml` sends each published release's files to https://t.me/NuvoAppBot. It needs all six of `BOT_TOKEN`, `TG_API_ID`, `TG_API_HASH`, `ADMIN_ID`, `UPLOAD_SECRET`, `WORKER_URL` (and optionally the variable `ADMIN_LANG`) and skips itself when any is missing. It can be run by hand for an older tag.

## Repository settings

- Protect `main`: required checks `check`, `audit` and `cargo-deny` from `ci.yml`, linear history, squash merges only, no force pushes. Protect tags `v*` with a ruleset.
- Turn on Discussions, private vulnerability reporting, secret scanning with push protection, Dependabot alerts and code scanning (`codeql.yml` and `scorecard.yml` upload to it).
- Upload `.github/readme/social.png` as the social preview (Settings, General).
- Labels used by the templates: `bug`, `enhancement`, `needs-triage`, `needs-info`, plus `platform: *` and `area: *`.

## README and pages

`README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `DESIGN-NOTES.md`, `.github/SUPPORT.md` and the issue templates are rendered from `.github/readme/` by `python3 .github/readme/build.py`; edit the template, the pages or the JSON there, not the output. `python3 .github/readme/test_build.py` rebuilds them and checks the result. The builder needs Pillow and Chrome. New captures of the app: name them in `media.json` and run `python3 .github/readme/build.py --media <folder>`.

## Benchmarks

`node scripts/bench/suite.mjs --exe <packaged nuvo>` writes its results to `bench-results/`, which git ignores. Copy the numbers you want into `.github/readme/bench.json`.

## Donation link

Three places: the `support` link in `.github/readme/data.json` (the README button), the `custom:` key in `.github/FUNDING.yml`, and `DONATE_URL` in `src/ui/screens/settings/donate.ts` (the Settings link stays hidden until it is set).

## Download counter

The site shows a total from a Cloudflare Worker with D1 that keeps a high-water mark of `download_count` per release asset, so deleting a release never lowers the total. It lives with the website, not in this repository.
