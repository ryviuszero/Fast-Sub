from __future__ import annotations

import json
import os
import subprocess
import sys

from fast_sub.clients.errors import WebTranslationClientError

_SUBPROCESS_TRANSLATE_SCRIPT = """
import json
import os
import sys

os.environ.setdefault("translators_default_region", "EN")

try:
    import translators as ts
except ImportError as exc:
    print(
        json.dumps(
            {
                "ok": False,
                "code": "missing_dependency",
                "message": "Web translation requires the GPL-3.0 `translators` package. "
                "The packaged optional extra is disabled because its dependency chain includes "
                "vulnerable js2py releases.",
            },
            ensure_ascii=False,
        )
    )
    raise SystemExit(0) from exc

payload = json.loads(sys.stdin.read())

try:
    translated = ts.translate_text(
        payload["text"],
        translator=payload["translator"],
        from_language=payload["from_language"],
        to_language=payload["to_language"],
    )
except Exception as exc:
    print(
        json.dumps(
            {
                "ok": False,
                "code": "provider_failed",
                "message": str(exc),
            },
            ensure_ascii=False,
        )
    )
    raise SystemExit(0) from exc

print(json.dumps({"ok": True, "text": str(translated)}, ensure_ascii=False))
""".strip()


def translate_text(
    *,
    text: str,
    translator: str,
    from_language: str,
    to_language: str,
    timeout: float | None = None,
) -> str:
    """Translate text through the third-party web translator package."""
    os.environ.setdefault("translators_default_region", "EN")
    if timeout is None or timeout <= 0:
        try:
            import translators as ts  # type: ignore[import-not-found]
        except ImportError as exc:
            raise WebTranslationClientError(
                "Web translation requires the GPL-3.0 `translators` package. "
                "The packaged optional extra is disabled because its dependency chain includes "
                "vulnerable js2py releases.",
                code="missing_dependency",
            ) from exc
        try:
            return str(
                ts.translate_text(
                    text,
                    translator=translator,
                    from_language=from_language,
                    to_language=to_language,
                )
            )
        except Exception as exc:
            raise WebTranslationClientError(str(exc), code="provider_failed") from exc

    payload = json.dumps(
        {
            "text": text,
            "translator": translator,
            "from_language": from_language,
            "to_language": to_language,
        },
        ensure_ascii=False,
    )
    try:
        completed = subprocess.run(
            [sys.executable, "-c", _SUBPROCESS_TRANSLATE_SCRIPT],
            input=payload,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise WebTranslationClientError(
            f"{translator} web translation timed out after {timeout:.1f}s.",
            code="provider_timeout",
        ) from exc
    except OSError as exc:
        raise WebTranslationClientError(
            f"Web translation subprocess could not start: {exc}",
            code="provider_failed",
        ) from exc

    stdout = completed.stdout.strip()
    if not stdout:
        stderr = completed.stderr.strip()
        raise WebTranslationClientError(
            stderr or "Web translation subprocess returned empty output.",
            code="provider_failed",
        )
    try:
        response = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise WebTranslationClientError(
            stdout,
            code="provider_failed",
        ) from exc
    if not response.get("ok"):
        raise WebTranslationClientError(
            str(response.get("message") or "Web translation failed."),
            code=str(response.get("code") or "provider_failed"),
        )
    return str(response.get("text") or "")


__all__ = ["translate_text"]
