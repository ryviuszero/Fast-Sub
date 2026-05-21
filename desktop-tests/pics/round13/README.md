# Round 13 Screenshot Baseline

This folder is the public-safe release screenshot baseline for Round 13.

The committed PNG files are sanitized public screenshots generated from sample data.
They are suitable for README and GitHub Pages display, but they are not raw private
local smoke captures.

Do not commit screenshots that contain API keys, Authorization headers, daemon ready tokens, secret refs, signed URLs, proxy credentials, full private local paths, real customer media names, or real task outputs.

| ID | Status | File | View | Required Check |
| --- | --- | --- | --- | --- |
| R13-PIC-001 | PASS | `01-setup-check.png` | First startup / environment check | No raw daemon token, command line, or secret path. |
| R13-PIC-002 | PASS | `02-main-empty.png` | Main empty state | No mock-only sample task or raw JSON envelope. |
| R13-PIC-003 | PASS | `03-main-file-selected.png` | Main with selected sample media | Path display is readable and does not expose unnecessary full private path. |
| R13-PIC-004 | PASS | `04-job-running.png` | Real job running | No worker protocol, daemon token, SSE id, or raw command. |
| R13-PIC-005 | PASS | `05-job-complete.png` | Completed job | Output action labels are readable; no stale mock fallback filename. |
| R13-PIC-006 | PASS | `06-job-failed.png` | Failed job details | Structured user action and redacted diagnostic are visible. |
| R13-PIC-007 | PASS | `07-models.png` | Model management | Install/remove/default model actions are visible; model install jobs are not shown in the subtitle queue. |
| R13-PIC-008 | PASS | `08-providers.png` | Provider settings | Remote upload warnings and API key storage note are visible; raw key is not displayed by default. |
| R13-PIC-009 | PASS | `09-diagnostics.png` | Diagnostics | Shows runtime summary and redacted log tail, not sample credentials. |
| R13-PIC-010 | PASS | `10-english-ui.png` | English UI smoke | Primary navigation, queue, provider, and diagnostics labels are English. |

Current Round 13 note: Windows x64 functional smoke has been exercised and the manual GUI screenshot baseline has been captured. Keep this manifest in sync with `desktop-tests/round13-release-smoke.md`.
