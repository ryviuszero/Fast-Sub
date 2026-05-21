# Round 13 Release Checklist

Status date: 2026-05-21

## Release Scope

- Product: Fast Sub Desktop
- Version: `0.13.0`
- Branch: `codex/fast-sub-round13-release-readiness`
- Baseline commit: `dc10f2e docs: plan round 13 release readiness`
- Release platforms in scope: Windows x64 installer, Windows x64 portable zip, macOS arm64 dmg
- Windows artifacts built: `desktop/dist-release/FastSub-Desktop-0.13.0-windows-x64.exe`, `desktop/dist-release/FastSub-Desktop-0.13.0-windows-x64.zip`
- macOS artifact built: `desktop/dist-release/FastSub-Desktop-0.13.0-macos-arm64.dmg`
- macOS artifact status: preview build passed packaged runtime checks on macOS arm64; app is ad-hoc signed, not notarized, and Gatekeeper assessment is not passed. Release notes must document manual `xattr` + local ad-hoc `codesign` install steps.

## Automated Validation

| Check | Status | Notes |
| --- | --- | --- |
| `go test ./...` | PASS | 2026-05-19 final baseline passed with workspace-local Go cache. |
| `go test ./...` macOS | PASS | 2026-05-21 macOS arm64 pass with workspace-local `GOCACHE=.gocache`; sandbox run failed on local port binding, elevated rerun passed. |
| `cd desktop && npm run typecheck` | PASS | 2026-05-21 macOS arm64 pass after macOS packaging and native dependency installer updates. |
| `cd desktop && npm test` | PASS | 2026-05-19 full Vitest suite passed: 4 files / 77 tests. Includes Provider API key save/replace/delete and raw secret non-display coverage. |
| `cd desktop && npm run build` | PASS | 2026-05-19 final electron-vite build passed with escalation due Windows sandbox/esbuild config access. |
| `cd desktop && npm run smoke` | PASS | 2026-05-19 renderer/preload/CSP smoke passed with escalation due Windows sandbox Electron cache/GPU restrictions. |
| `cd desktop && npm run package:dir` | PASS | Windows `win-unpacked` smoke layer passed earlier; final `npm run package` also regenerated latest `win-unpacked` with icon/version resource. |
| `cd desktop && npm run package` | PASS | Windows installer and portable zip regenerated 2026-05-19 as latest RC artifacts after API key deletion and translation model failure smoke additions. |
| `cd desktop && npm run smoke:packaged` | PASS | Latest `win-unpacked` passed packaged app, daemon, Python runtime, daemon repair, SSE disconnect, and `events_lost` smoke. Latest portable zip extraction also passed with `FAST_SUB_PACKAGED_ROOT`. |
| `cd desktop && npm run smoke:translation-model-failure` | PASS | Latest packaged daemon with isolated empty model store returns `missing_model` for local NLLB translation job; no real network/model/API used. |
| macOS release script readiness | PASS | 2026-05-21 on macOS arm64: `prepare-python-runtime`, `package:dir`, `smoke:packaged`, `smoke:translation-model-failure`, and `package` passed after macOS symlink materialization fix. |
| `cd desktop && npm run smoke:native-deps` | PASS | Manual release smoke with real network downloads: Windows FFmpeg + aria2 and HTTPS fallback passed; macOS FFmpeg/FFprobe app-private first install passed from GitHub gz binaries, and bundled whisper.cpp runtime was detected from the app bundle without Homebrew. |
| `cd desktop && npm run smoke:native-deps -- whisper-cpp` | PASS | Windows download fallback passed earlier; macOS final package uses bundled `Contents/Resources/bin/darwin-arm64/whisper-cpp`. |

## Manual Smoke Summary

| Area | Status | Notes |
| --- | --- | --- |
| Windows installer install/uninstall | PASS | Latest RC installer silent install, installed app daemon repair smoke, and silent uninstall passed under `desktop/test-results/round13-installer-latest`. |
| Windows portable zip | PASS | Latest RC zip extracted under `desktop/test-results/round13-portable-latest` and passed packaged smoke. |
| App exit cleanup during local ASR | PASS | New package leaves no Fast Sub daemon/worker/Python/native child process after exit. |
| Default packaged ASR | PASS | `local-faster-whisper` + `whisper-small` CPU generated SRT from small media. |
| Native ASR | PASS | `local-whisper-cpp` + installed whisper.cpp model generated SRT. |
| Local NLLB translation | PASS | SRT and TXT translation passed. |
| Bilingual subtitle | PASS | Single daemon `transcribe` job completed ASR plus local translation. |
| Burn-in | PASS | App private FFmpeg produced burned MP4. |
| Unicode and space paths | PASS | Chinese/Japanese/Korean/space path generated SRT without path corruption. |
| Local OpenAI-compatible STT/chat | PASS | Loopback mock endpoint, no API key, no external network. |
| Clean first-start model install | PASS | Isolated `FAST_SUB_MODEL_STORE_DIR=desktop/test-results/round13-clean-model-store-20260519`; installed and verified `whisper-small` and `nllb-200-distilled-600m-ct2-int8` from empty store. |
| Real OpenAI/Bing/Google external record | DEFER | User confirmed this external record is not needed for this Round 13 pass; local loopback OpenAI-compatible STT/chat blocker passed. |
| GPU long-task cancel | PASS | Windows installed package GPU ASR cancel released packaged Python worker and NVIDIA compute process. Covered both app-exit/cancel cleanup and in-app cancel while app/daemon remain running; immediate and 8-second follow-up checks had no packaged worker/GPU compute residue. |
| Translation batching | PASS | Round 13 blocker fix: local NLLB defaults to batch size 32, OpenAI-compatible chat defaults to 16, web translation stays 1; explicit batch overrides are respected and NLLB failed batches split down instead of failing a whole large batch. |
| Translation model failure downgrade | PASS | Original ASR remains covered by default ASR smoke; local NLLB translation path fails fast with `missing_model` when the translation model store is empty. |
| Secret storage CRUD | PASS | Provider API key save, replace, and delete are covered; renderer test confirms raw entered secrets do not remain visible after save/replace. |
| Screenshot baseline | PASS | 10 GUI screenshots captured under `desktop-tests/pics/round13/`; manifest statuses updated to PASS. |
| macOS packaged runtime smoke | PASS | 2026-05-21: final rebuilt `dist-release/mac-arm64/Fast Sub.app` passed packaged app, daemon, Python runtime, daemon repair, SSE disconnect, and `events_lost` smoke. |
| macOS native dependency smoke | PASS | 2026-05-21: final rebuilt app downloaded `ffmpeg-darwin-arm64.gz` and `ffprobe-darwin-arm64.gz` into isolated app-private userData; bundled whisper.cpp runtime was available from `Contents/Resources/bin/darwin-arm64/whisper-cpp`. |
| macOS translation model failure smoke | PASS | 2026-05-21: final packaged daemon returned expected `missing_model` for local NLLB translation with isolated empty model store. |
| macOS DMG mount check | PASS | 2026-05-21: generated dmg mounted read-only at `/private/tmp/fast-sub-dmg-check`, contained `Fast Sub.app` and `/Applications` link, then detached cleanly. |

## Privacy And Security

- Default local providers do not upload media or subtitles.
- Remote/web/API providers require explicit selection and confirmation before upload.
- Renderer does not receive raw daemon ready token or raw provider secret.
- Config stores API key aliases and provider settings, not raw API keys.
- Daemon `secret_ref` is transient and one-time.
- Diagnostics and transport logs must redact API keys, Authorization, daemon tokens, signed URLs, proxy credentials, and raw secrets.

## Distribution Notes

- Go daemon and app private Python runtime are outside ASAR.
- Python CLI bridge uses app-private Python module entry: Windows `python.exe -m fast_sub.app`, macOS `python -m fast_sub.app`.
- Faster Whisper worker uses app-private Python module entry: Windows `python.exe -m fast_sub_workers.faster_whisper`, macOS `python -m fast_sub_workers.faster_whisper`.
- Models are not bundled; model downloads are user/model-store managed.
- FFmpeg/FFprobe are app private userData downloads, not bundled. On Windows FFmpeg downloads from gyan.dev; on macOS FFmpeg/FFprobe downloads from GitHub `ffmpeg-static` gz assets when no complete app-private or system Homebrew/local install is available. macOS and other non-Windows platforms only reuse a system `aria2c`; if absent they fall back to ordinary HTTPS download.
- whisper.cpp native runtime is bundled with release resources. Windows retains the existing GitHub download fallback for older/missing packages; macOS release builds now include `whisper-cli` and dylibs under `Contents/Resources/bin/darwin-arm64/whisper-cpp`, so end users do not need Homebrew or build tools.
- Current Windows package is intentionally unsigned; this is the selected Round 13 Windows distribution form. `Get-AuthenticodeSignature` reports `NotSigned` for both `dist-release/win-unpacked/Fast Sub.exe` and `dist-release/FastSub-Desktop-0.13.0-windows-x64.exe`. Windows executable resource editing remains enabled so icon and version metadata are embedded. Current version resource: ProductName/FileDescription/CompanyName `Fast Sub`, FileVersion `0.13.0`, ProductVersion `0.13.0.0`.
- App icon source is `desktop/build/icon.png`; Windows package icon is `desktop/build/icon.ico`.
- macOS arm64 dmg was built and smoke-tested on a macOS arm64 machine. It is ad-hoc signed and not notarized; `codesign --verify --deep --strict --verbose=2` passed, while `spctl --assess --type execute --verbose` returned `internal error in Code Signing subsystem`.
- macOS release machine expected commands are documented in `dev-docs/release/macos.md`.
- Third-party license reports are generated under `desktop-tests/licenses/`; current aggregate is 618 records, 0 `needs-review`, 0 `blocked`.

## Cleanup Notes

- Uninstalling the app does not remove userData by default.
- User data may include config, safe-storage encrypted key records, job logs, native-binaries, and UI state.
- Model store lives outside the app package and should be removed separately only on explicit user action.
- Do not delete user model store or job logs during normal uninstall unless a future uninstaller option explicitly asks the user.

## Release Blockers Before macOS Distribution

- macOS signing/notarization/Gatekeeper must be completed before any external distribution.

## Known Distribution Risks

- Windows artifacts are unsigned by current decision. Users may see Windows SmartScreen or antivirus reputation prompts until a future signed release exists.
- macOS artifact is ad-hoc signed and not notarized. Treat it as a preview build only; users may see Gatekeeper blocking or quarantine warnings.
- macOS preview distribution follows the unsigned open-source app pattern: explicitly document Gatekeeper risk and manual install commands, and do not describe the artifact as notarized or stable.
