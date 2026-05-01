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
from fast_sub.model_manifest import ModelManifestEntry

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


def test_install_model_writes_part_file_then_verifies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        payload = b"model bytes"
        model = _model(payload)

        def fake_download(url: str, part_path: Path, *, timeout: float) -> None:
            assert url == str(model.url)
            assert timeout == 60
            part_path.write_bytes(payload)

        monkeypatch.setattr("fast_sub.model_manager._download", fake_download)

        status = install_model(model, work_dir)

        assert status.installed
        assert status.status == "installed"
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
    finally:
        shutil.rmtree(work_dir)


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


def _make_work_dir() -> Path:
    work_dir = Path(".test-work") / uuid.uuid4().hex
    work_dir.mkdir(parents=True)
    return work_dir
