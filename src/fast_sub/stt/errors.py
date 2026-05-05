from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fast_sub.contracts.errors import SubGenError


@dataclass(frozen=True)
class TranscribeFailure:
    stage: str
    code: str
    message: str
    action_hint: str | None = None

    def as_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "stage": self.stage,
            "code": self.code,
            "message": self.message,
        }
        if self.action_hint:
            payload["action_hint"] = self.action_hint
        return payload


class TranscribeError(SubGenError):
    """Structured transcribe failure suitable for CLI JSON and auto orchestration."""

    def __init__(
        self,
        message: str,
        *,
        stage: str,
        code: str,
        action_hint: str | None = None,
    ) -> None:
        super().__init__(message)
        self.failure = TranscribeFailure(
            stage=stage,
            code=code,
            message=message,
            action_hint=action_hint,
        )

    @property
    def stage(self) -> str:
        return self.failure.stage

    @property
    def code(self) -> str:
        return self.failure.code

    @property
    def action_hint(self) -> str | None:
        return self.failure.action_hint

    def as_dict(self) -> dict[str, Any]:
        return self.failure.as_dict()


__all__ = ["TranscribeError", "TranscribeFailure"]
