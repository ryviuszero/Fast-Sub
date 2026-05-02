from __future__ import annotations

import hashlib
import json
import shutil
import uuid
from pathlib import Path

import pytest
from typer.testing import CliRunner

import fast_sub.cli as cli
from fast_sub.model_manager import (
    ModelManagerError,
    ModelStatus,
    install_model,
    model_path,
    verify_model,
)
from fast_sub.model_manifest import ModelManifestEntry, ModelManifestFile, list_models

runner = CliRunner()


def test_verify_model_reports_missing_file() -> None:
    work_dir = _make_work_dir()
    try:
        model = _model(b"expected")

        status = verify_model(model, work_dir)

        assert not status.installed
        assert status.status == "missing"
    finally:
        shutil.rmtree(work_dir)


def test_verify_model_reports_hash_mismatch() -> None:
    work_dir = _make_work_dir()
    try:
        model = _model(b"expected")
        path = model_path(model, work_dir)
        path.parent.mkdir(parents=True)
        path.write_bytes(b"wrong")

        status = verify_model(model, work_dir)

        assert not status.installed
        assert status.status == "hash_mismatch"
        assert status.sha256 == hashlib.sha256(b"wrong").hexdigest()
    finally:
        shutil.rmtree(work_dir)


def test_verify_directory_model_requires_all_manifest_files() -> None:
    work_dir = _make_work_dir()
    try:
        model = _directory_model(
            {
                "config.json": b"config",
                "tokenizer.json": b"tokenizer",
                "vocabulary.txt": b"vocabulary",
                "model.bin": b"model",
            }
        )
        path = model_path(model, work_dir)
        path.mkdir(parents=True)
        (path / "model.bin").write_bytes(b"model")

        status = verify_model(model, work_dir)

        assert not status.installed
        assert status.status == "missing"
        assert status.path == path / "config.json"
        assert status.manifest_type == "directory"
    finally:
        shutil.rmtree(work_dir)


def test_verify_directory_model_checks_required_file_hashes() -> None:
    work_dir = _make_work_dir()
    try:
        model = _directory_model(
            {
                "config.json": b"config",
                "tokenizer.json": b"tokenizer",
                "vocabulary.txt": b"vocabulary",
                "model.bin": b"model",
            }
        )
        path = model_path(model, work_dir)
        path.mkdir(parents=True)
        (path / "config.json").write_bytes(b"wrong")
        (path / "tokenizer.json").write_bytes(b"tokenizer")
        (path / "vocabulary.txt").write_bytes(b"vocabulary")
        (path / "model.bin").write_bytes(b"model")

        status = verify_model(model, work_dir)

        assert not status.installed
        assert status.status == "hash_mismatch"
        assert status.path == path / "config.json"
        assert status.sha256 == hashlib.sha256(b"wrong").hexdigest()
    finally:
        shutil.rmtree(work_dir)


def test_verify_directory_model_reports_inaccessible_root(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        model = _directory_model({"config.json": b"config"})
        path = model_path(model, work_dir)
        original_exists = Path.exists

        def fake_exists(self: Path) -> bool:
            if self == path:
                raise PermissionError("denied")
            return original_exists(self)

        monkeypatch.setattr(Path, "exists", fake_exists)

        status = verify_model(model, work_dir)

        assert not status.installed
        assert status.status == "inaccessible"
        assert status.path == path
        assert status.manifest_type == "directory"
        assert str(path) in status.message
        assert "denied" in status.message
    finally:
        shutil.rmtree(work_dir)


def test_verify_directory_model_reports_inaccessible_file_is_file(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        model = _directory_model({"config.json": b"config"})
        path = model_path(model, work_dir)
        path.mkdir(parents=True)
        file_path = path / "config.json"
        file_path.write_bytes(b"config")
        original_is_file = Path.is_file

        def fake_is_file(self: Path) -> bool:
            if self == file_path:
                raise OSError("busy")
            return original_is_file(self)

        monkeypatch.setattr(Path, "is_file", fake_is_file)

        status = verify_model(model, work_dir)

        assert not status.installed
        assert status.status == "inaccessible"
        assert status.path == file_path
        assert status.manifest_type == "directory"
        assert "busy" in status.message
    finally:
        shutil.rmtree(work_dir)


def test_verify_directory_model_reports_inaccessible_file_stat(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        model = _directory_model({"config.json": b"config"})
        path = model_path(model, work_dir)
        path.mkdir(parents=True)
        file_path = path / "config.json"
        file_path.write_bytes(b"config")
        original_stat = Path.stat

        def fake_stat(self: Path, *args, **kwargs):
            if self == file_path:
                raise PermissionError("cannot stat")
            return original_stat(self, *args, **kwargs)

        monkeypatch.setattr(Path, "stat", fake_stat)

        status = verify_model(model, work_dir)

        assert not status.installed
        assert status.status == "inaccessible"
        assert status.path == file_path
        assert status.manifest_type == "directory"
        assert "cannot stat" in status.message
    finally:
        shutil.rmtree(work_dir)


def test_verify_directory_model_reports_inaccessible_file_open(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        model = _directory_model({"config.json": b"config"})
        path = model_path(model, work_dir)
        path.mkdir(parents=True)
        file_path = path / "config.json"
        file_path.write_bytes(b"config")

        def fake_sha256_file(path: Path) -> str:
            if path == file_path:
                raise PermissionError("cannot open")
            return ""

        monkeypatch.setattr("fast_sub.model_manager.sha256_file", fake_sha256_file)

        status = verify_model(model, work_dir)

        assert not status.installed
        assert status.status == "inaccessible"
        assert status.path == file_path
        assert status.manifest_type == "directory"
        assert "cannot open" in status.message
    finally:
        shutil.rmtree(work_dir)


def test_install_model_writes_part_file_then_verifies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        payload = b"model bytes"
        model = _model(payload)

        def fake_download(
            url: str,
            part_path: Path,
            *,
            timeout: float,
            downloader: str,
            aria2_connections: int,
            aria2_split: int,
            progress,
            label: str,
        ) -> None:
            assert url == str(model.url)
            assert timeout == 60
            assert downloader == "httpx"
            assert aria2_connections == 8
            assert aria2_split == 8
            assert label == model.id
            assert progress is None
            part_path.write_bytes(payload)

        monkeypatch.setattr("fast_sub.model_manager._download", fake_download)

        status = install_model(model, work_dir, downloader="httpx")

        assert status.installed
        assert status.status == "installed"
        assert model_path(model, work_dir).read_bytes() == payload
        assert not model_path(model, work_dir).with_suffix(".bin.part").exists()
    finally:
        shutil.rmtree(work_dir)


def test_install_model_deletes_bad_part_and_succeeds_with_mirror(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        payload = b"good model bytes"
        model = ModelManifestEntry(
            id="tiny",
            name="Tiny",
            type="asr",
            backend="test",
            size_bytes=len(payload),
            license="MIT",
            url="https://example.com/bad.bin",
            mirrors=["https://mirror.example.com/good.bin"],
            sha256=hashlib.sha256(payload).hexdigest(),
            recommended_for="tests",
            filename="tiny.bin",
        )

        def fake_download(
            url: str,
            part_path: Path,
            *,
            timeout: float,
            downloader: str,
            aria2_connections: int,
            aria2_split: int,
            progress,
            label: str,
        ) -> None:
            if url == "https://example.com/bad.bin":
                part_path.write_bytes(b"bad model bytes")
                return
            assert url == "https://mirror.example.com/good.bin"
            assert not part_path.exists()
            part_path.write_bytes(payload)

        monkeypatch.setattr("fast_sub.model_manager._download", fake_download)

        status = install_model(model, work_dir)

        assert status.installed
        assert model_path(model, work_dir).read_bytes() == payload
        assert not model_path(model, work_dir).with_suffix(".bin.part").exists()
    finally:
        shutil.rmtree(work_dir)


def test_install_model_refuses_to_overwrite_hash_mismatch() -> None:
    work_dir = _make_work_dir()
    try:
        model = _model(b"expected")
        path = model_path(model, work_dir)
        path.parent.mkdir(parents=True)
        path.write_bytes(b"keep me")

        with pytest.raises(ModelManagerError, match="Refusing to overwrite"):
            install_model(model, work_dir)

        assert path.read_bytes() == b"keep me"
    finally:
        shutil.rmtree(work_dir)


def test_install_model_reports_download_progress(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        payload = b"model bytes"
        model = _model(payload)
        events = []

        def fake_download(
            url: str,
            part_path: Path,
            *,
            timeout: float,
            downloader: str,
            aria2_connections: int,
            aria2_split: int,
            progress,
            label: str,
        ) -> None:
            progress(label, len(payload), len(payload))
            part_path.write_bytes(payload)

        monkeypatch.setattr("fast_sub.model_manager._download", fake_download)

        status = install_model(
            model,
            work_dir,
            downloader="httpx",
            progress=lambda label, downloaded, total: events.append(
                (label, downloaded, total)
            ),
        )

        assert status.installed
        assert events == [(model.id, len(payload), len(payload))]
    finally:
        shutil.rmtree(work_dir)


def test_install_directory_model_skips_verified_existing_files(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        files = {"config.json": b"config", "model.bin": b"model"}
        model = _directory_model(files)
        path = model_path(model, work_dir)
        path.mkdir(parents=True)
        (path / "config.json").write_bytes(b"config")
        downloads = []

        def fake_download(
            url: str,
            part_path: Path,
            *,
            timeout: float,
            downloader: str,
            aria2_connections: int,
            aria2_split: int,
            progress,
            label: str,
        ) -> None:
            downloads.append(label)
            part_path.write_bytes(b"model")

        monkeypatch.setattr("fast_sub.model_manager._download", fake_download)

        status = install_model(model, work_dir, downloader="httpx")

        assert status.installed
        assert downloads == ["tiny-dir/model.bin"]
    finally:
        shutil.rmtree(work_dir)


def test_install_model_uses_aria2_backend_when_requested(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        payload = b"model bytes"
        model = _model(payload)
        calls = []

        monkeypatch.setattr(
            "fast_sub.model_manager._aria2_executable",
            lambda: Path("aria2c"),
        )

        def fake_aria2(
            url: str,
            part_path: Path,
            *,
            timeout: float,
            connections: int,
            split: int,
        ) -> None:
            calls.append((url, connections, split))
            part_path.write_bytes(payload)

        monkeypatch.setattr("fast_sub.model_manager._download_aria2", fake_aria2)

        status = install_model(
            model,
            work_dir,
            downloader="aria2",
            aria2_connections=4,
            aria2_split=6,
        )

        assert status.installed
        assert calls == [(str(model.url), 4, 6)]
    finally:
        shutil.rmtree(work_dir)


def test_models_list_json_includes_initial_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        monkeypatch.setattr(
            cli,
            "verify_model",
            lambda model: ModelStatus(
                id=model.id,
                path=work_dir / model.id / "model.bin",
                installed=False,
                status="missing",
                message="missing",
            ),
        )
        monkeypatch.setattr(
            cli,
            "model_path",
            lambda model: work_dir / model.id / "model.bin",
        )

        result = runner.invoke(cli.app, ["models", "list", "--json"])

        assert result.exit_code == 0
        rows = json.loads(result.stdout)
        ids = {row["id"] for row in rows}
        assert {"whisper-base", "whisper-small", "whisper-large-v3-turbo"} <= ids
        assert all("installed" in row for row in rows)
        assert all(row["manifest_type"] == "directory" for row in rows)
        assert all(row["required_files"] >= 1 for row in rows)
    finally:
        shutil.rmtree(work_dir)


def test_builtin_model_urls_are_pinned_to_huggingface_revisions() -> None:
    for model in list_models():
        assert model.url is not None
        assert "/resolve/main/" not in str(model.url)


def test_models_verify_missing_exits_nonzero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        model = _model(b"expected")
        monkeypatch.setattr(cli, "get_model", lambda model_id: model)
        monkeypatch.setattr(
            cli,
            "verify_model",
            lambda model: ModelStatus(
                id=model.id,
                path=work_dir / model.id / "tiny.bin",
                installed=False,
                status="missing",
                message="missing",
            ),
        )

        result = runner.invoke(cli.app, ["models", "verify", "tiny", "--json"])

        assert result.exit_code == 1
        body = json.loads(result.stdout)
        assert body["status"] == "missing"
    finally:
        shutil.rmtree(work_dir)


def test_models_install_passes_downloader_options(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        model = _model(b"expected")
        calls = []
        monkeypatch.setattr(cli, "get_model", lambda model_id: model)

        class NullProgress:
            def __enter__(self):  # noqa: ANN204
                return lambda label, downloaded, total: None

            def __exit__(self, exc_type, exc, tb):  # noqa: ANN001, ANN204
                return False

        monkeypatch.setattr(cli, "_model_download_progress", lambda: NullProgress())

        def fake_install_model(model, **kwargs):  # noqa: ANN001
            calls.append(kwargs)
            return ModelStatus(
                id=model.id,
                path=work_dir / model.id,
                installed=True,
                status="installed",
                message="ok",
                checked_files=1,
            )

        monkeypatch.setattr(cli, "install_model", fake_install_model)

        result = runner.invoke(
            cli.app,
            [
                "models",
                "install",
                "tiny",
                "--downloader",
                "aria2",
                "--aria2-connections",
                "4",
                "--aria2-split",
                "6",
            ],
        )

        assert result.exit_code == 0
        assert calls[0]["downloader"] == "aria2"
        assert calls[0]["aria2_connections"] == 4
        assert calls[0]["aria2_split"] == 6
        assert calls[0]["progress"] is not None
    finally:
        shutil.rmtree(work_dir)


def test_cli_dispatches_models_to_command_app() -> None:
    assert cli._should_use_command_app(["models", "list"])


def _model(payload: bytes) -> ModelManifestEntry:
    return ModelManifestEntry(
        id="tiny",
        name="Tiny",
        type="asr",
        backend="test",
        size_bytes=len(payload),
        license="MIT",
        url="https://example.com/tiny.bin",
        mirrors=[],
        sha256=hashlib.sha256(payload).hexdigest(),
        recommended_for="tests",
        filename="tiny.bin",
    )


def _directory_model(files: dict[str, bytes]) -> ModelManifestEntry:
    return ModelManifestEntry(
        id="tiny-dir",
        name="Tiny Directory",
        type="asr",
        backend="faster-whisper",
        size_bytes=sum(len(payload) for payload in files.values()),
        license="MIT",
        url="https://example.com/tiny-dir/",
        mirrors=[],
        recommended_for="tests",
        files=[
            ModelManifestFile(
                path=path,
                size_bytes=len(payload),
                sha256=hashlib.sha256(payload).hexdigest(),
            )
            for path, payload in files.items()
        ],
    )


def _make_work_dir() -> Path:
    work_dir = Path(".test-work") / uuid.uuid4().hex
    work_dir.mkdir(parents=True)
    return work_dir
