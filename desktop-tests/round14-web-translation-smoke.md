# Round 14 Web Translation Packaged Smoke

This record tracks the Round 14 packaged desktop web translation smoke. The default automated test suite must not require real network access; real Bing/Google checks are manual release smoke.

## Windows x64

| ID | Status | Command | Scope | Result |
| --- | --- | --- | --- | --- |
| R14-WEB-001 | PASS | `cd desktop && npm run package:dir` | Rebuilt Windows `win-unpacked` after refreshing app-private Python runtime and ASAR-outside web helper resources. | Package generated at `desktop/dist-release/win-unpacked`; helper copied to `resources/web-translate-helper`. |
| R14-WEB-002 | PASS | `cd desktop && npm run smoke:packaged` | Packaged app/daemon/runtime baseline. | Packaged runtime smoke passed. |
| R14-WEB-003 | PASS | `cd desktop && npm run smoke:web-translation` | Real short SRT smoke for `web-bing` and `web-google`, `en -> zh`, no API key. | Both providers succeeded; summary written to `desktop/test-results/round14-web-translation-smoke/summary.json`. |
| R14-WEB-004 | PASS | `rg -n 'js2py\|ai-cloudscraper\|Requires-Dist: translators\|Provides-Extra: web-translate\|dependency_module="translators"\|Install web translation support' uv.lock desktop\dist-release\win-unpacked\resources\python\win32-x64 desktop\dist-release\win-unpacked\resources\web-translate-helper` | Lockfile and packaged runtime dependency scan. | No matches. |
| R14-WEB-005 | PASS | `cd desktop && npm run smoke:packaged`; zip entry inspection | Packaged helper dependency self-containment regression guard. | Added after `web-google` passed in dev but failed in installer: final `resources/web-translate-helper` previously lacked `node_modules`, while repo-local unpacked execution could resolve from parent `desktop/node_modules`. Smoke now asserts packaged `bing-translate-api` and `@vitalets/google-translate-api` directories exist; rebuilt installer/zip include those entries. |

Smoke summary:

```json
{
  "providers": ["web-bing", "web-google"],
  "language_pair": "en->zh",
  "status": "succeeded",
  "api_key_required": false,
  "helper_outside_asar": true,
  "uses_packaged_electron_as_node": true,
  "redaction": "pass",
  "dependency_scan": "pass"
}
```

## macOS arm64

| ID | Status | Command | Scope | Result |
| --- | --- | --- | --- | --- |
| R14-WEB-101 | TODO | `cd desktop && npm run package:dir && npm run smoke:packaged && npm run smoke:web-translation` | macOS arm64 packaged short SRT smoke for `web-bing` and `web-google`. | Must be executed on a macOS arm64 release machine. |

## Notes

- The web providers are experimental, best-effort third-party web providers. They can fail because of rate limits, regional access, network failures, or upstream page changes.
- The smoke input is a public short SRT sample and does not include private media names, API keys, ready tokens, signed URLs, or Authorization headers.
- The packaged helper is invoked with the packaged Electron executable and `ELECTRON_RUN_AS_NODE=1`; it does not depend on system Node.
- Packaged helper validation must check the final artifact resource tree, not only `desktop/resources` staging. Repo-local `win-unpacked` can mask missing helper dependencies by resolving packages from parent workspace `node_modules`; installer/portable validation must prove the helper is self-contained under `resources/web-translate-helper`.
