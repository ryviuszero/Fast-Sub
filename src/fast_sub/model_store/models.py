"""Data models for model installation and verification status."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

DownloadProgress = Callable[[str, int, int | None], None]


@dataclass(frozen=True)
class ModelStatus:
    """Verification state for an installed or missing model artifact."""

    id: str
    path: Path
    installed: bool
    status: str
    message: str
    sha256: str | None = None
    size_bytes: int | None = None
    checked_files: int = 0
    manifest_type: str = "file"

    def as_dict(self) -> dict[str, object]:
        """Return a JSON-friendly representation of the model status."""
        return {
            "id": self.id,
            "path": str(self.path),
            "installed": self.installed,
            "status": self.status,
            "message": self.message,
            "sha256": self.sha256,
            "size_bytes": self.size_bytes,
            "checked_files": self.checked_files,
            "manifest_type": self.manifest_type,
        }


__all__ = ["DownloadProgress", "ModelStatus"]
