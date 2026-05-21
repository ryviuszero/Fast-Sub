# Fast Sub Third Party Notices

This file is the Round 13 release-readiness inventory for components that are bundled with the desktop app, downloaded by the app, or required for local provider smoke. It is not a legal opinion. Every component must keep one release policy status before it can enter a release package:

| Status | Meaning |
| --- | --- |
| `bundle-ok` | May be included in the app package when the license text/notice is shipped. |
| `download-only` | Do not bundle in the installer; the app may download or guide installation at runtime with notice/source/license handling. |
| `manual-user-install` | User installs separately; not copied into the app package. |
| `blocked` | Must not enter the release package or runtime download path. |
| `needs-review` | Do not ship until license/source/version details are reviewed. |

## Release Package Components

| Component | Source / version source | License summary | Round 13 policy | Notes |
| --- | --- | --- | --- | --- |
| Fast Sub Electron app code | `desktop/` | First-party project code | `bundle-ok` | Production app code stays under `desktop/`; packaged apps ship `LICENSE` and `THIRD_PARTY_NOTICES.md` as extra resources. |
| Fast Sub Go daemon | `cmd/fast-sub-go`, `internal/` | First-party project code plus Go runtime/stdlib notices | `bundle-ok` | Must be built per platform and copied outside ASAR. |
| Go toolchain runtime/stdlib | Go build output | BSD-style Go license | `bundle-ok` | Ship Go license notice with daemon binary artifacts. |
| Electron runtime | `desktop/package-lock.json` | MIT plus bundled Chromium/Node notices | `bundle-ok` | Must include Electron/Chromium/Node notices in final package. |
| Runtime npm dependencies | `desktop/package-lock.json`; generated report `desktop-tests/licenses/npm-licenses.json` | Mixed permissive licenses, exact transitive list from lockfile | `bundle-ok` | Generated inventory currently has no `needs-review` or `blocked` runtime npm package. |
| Build/test npm dependencies | `desktop/package-lock.json` | Mixed permissive licenses, build-time only | `manual-user-install` | Not copied as app runtime resources. |
| App private Python runtime | uv managed CPython 3.11.15 prepared by `desktop/scripts/prepare-python-runtime.mjs` | CPython PSF plus bundled runtime license file | `bundle-ok` | Runtime is copied to `resources/python/<platform>-<arch>/` outside ASAR; packaged Windows resources include Python license files. |
| Fast Sub Python package | `src/fast_sub`, `src/fast_sub_workers` | First-party project code | `bundle-ok` | Must be installed into the app private Python runtime, not require global `fast-sub`. |
| Python base dependencies | Packaged `*.dist-info/METADATA`; generated report `desktop-tests/licenses/python-licenses.json` | Permissive package licenses in generated inventory | `bundle-ok` | Generated inventory currently has no `needs-review` or `blocked` Python package. |
| `faster-whisper` local ASR extra | Packaged Python site-packages report | Permissive package licenses; model licenses handled separately | `bundle-ok` | Required for default local ASR smoke. |
| `ctranslate2` and `sentencepiece` local translation extra | Packaged Python site-packages report | Permissive package licenses; `sentencepiece` license verified as Apache-2.0 from upstream | `bundle-ok` | Required for local NLLB smoke; NLLB model license is handled separately below. |
| `translators` web translation extra | Packaged Python site-packages report | Permissive package licenses in generated inventory | `bundle-ok` | Web provider external smoke is not a default local release blocker. |

## Generated License Reports

Round 13 generated inventories live under `desktop-tests/licenses/`:

| Report | Source | Result |
| --- | --- | --- |
| `npm-licenses.json` | `desktop/package-lock.json` | 571 packages; 0 `needs-review`; 0 `blocked`. Runtime packages are `bundle-ok`; build/test-only packages are `manual-user-install`. |
| `python-licenses.json` | Packaged app private Python `*.dist-info/METADATA` | 47 packages; 0 `needs-review`; 0 `blocked`. `sentencepiece` uses an upstream Apache-2.0 evidence override because its wheel metadata does not expose a license field. |
| `go-licenses.md` | `go.mod` | No external Go modules; Go standard library only. |
| `license-summary.json` | Aggregated generated reports | 618 total records; 51 `bundle-ok`; 567 `manual-user-install`; 0 `needs-review`; 0 `blocked`. |

The generated summary counts bundled npm, Python, and Go dependency records only. Runtime downloads, native binary download policies, and model artifact policies are tracked in the sections below and are not included in the generated `download_only` count.

Round 13 package content scan of `desktop/dist-release/win-unpacked/resources` found only `bin`, `python`, `app.asar`, `elevate.exe`, and this notice file at the top level. No model store, userData, `local_tests`, `test-results`, `.env`, or daemon ready token file was found in the package. A filename match on `win32comext/authorization/authorization.pyd` is a packaged pywin32 system library, not an API key, token, or credential file.

## Native Binaries And Runtime Downloads

| Component | Source / current resolver | License summary | Round 13 policy | Notes |
| --- | --- | --- | --- | --- |
| FFmpeg / FFprobe | Runtime download from `https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip` on Windows | LGPL/GPL build variant must be verified from source package | `download-only` | Current app downloads to `userData/native-binaries/ffmpeg/bin`; do not bundle until variant, source offer, and notice are reviewed. |
| aria2 | Runtime download from `github.com/aria2/aria2` Windows release | GPL-2.0-or-later | `download-only` | Current app uses it only as a downloader accelerator and falls back to HTTPS. Do not bundle in installer without GPL obligations review. |
| whisper.cpp native binary | Runtime download from `github.com/ggml-org/whisper.cpp` Windows release | MIT | `download-only` | Current app downloads Windows x64 binary to `userData/native-binaries/whisper-cpp/bin`; macOS runtime path still needs implementation. |
| System package managers | Scoop, Winget, Chocolatey commands | External package manager terms | `manual-user-install` | App only offers explicit fixed commands for FFmpeg fallback. |

## Models

Models are not bundled in Round 13 release artifacts. The app installs models into the user model store after explicit user action.

| Component | Source | License summary | Round 13 policy | Notes |
| --- | --- | --- | --- | --- |
| `whisper-base` / `whisper-small` / `whisper-large-v3-turbo` CTranslate2 models | Hugging Face entries in `internal/models/manifest.go` | MIT per manifest | `download-only` | Default ASR smoke should use a small ASR model; model files must not enter installer or portable zip. |
| `whispercpp-*` GGML models | Hugging Face entries in `internal/models/manifest.go` | MIT per manifest | `download-only` | Only downloaded when native provider/model is selected. |
| `nllb-200-distilled-600m-ct2-int8` | Hugging Face entry in `internal/models/manifest.go` | CC-BY-NC-4.0 per manifest | `download-only` / `needs-review` | Non-commercial restriction must be surfaced before release use; never bundle in installer. |

Commercial or organizational use of the default NLLB model requires separate license review. Fast Sub's MIT project license does not relicense third-party model weights.

## Blocked Components

| Component | Policy | Reason |
| --- | --- | --- |
| Real user media, subtitles, task outputs, benchmark reports | `blocked` | User data must not enter release package. |
| API keys, Authorization headers, daemon ready tokens, `secret_ref` values, signed URLs, proxy credentials | `blocked` | Secrets must not enter package, logs, docs examples, or smoke records. |
| Model files inside installer/portable/dmg | `blocked` | Round 13 decision says models are runtime-installed, not bundled. |
| Native executable inside ASAR | `blocked` | Executables must live outside ASAR so Electron main can spawn them directly. |
