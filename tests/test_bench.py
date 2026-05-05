from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest

from fast_sub.benchmark.errors import BenchError
from fast_sub.benchmark.models import BenchOptions, BenchProfile
from fast_sub.benchmark.transcription import (
    detect_hardware,
    load_sample_metadata,
    render_markdown_report,
    run_bench,
    summarize_runs,
)
from fast_sub.contracts.errors import SubGenError
from fast_sub.stt.service import TranscribeResult

TEST_WORKDIR_ROOT = Path(".test-work") / "bench"


def _work_dir() -> Path:
    path = TEST_WORKDIR_ROOT / uuid.uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_run_bench_records_profiles_repeat_and_summary() -> None:
    work_dir = _work_dir()
    input_file = work_dir / "sample.wav"
    input_file.write_bytes(b"fake wav")
    markdown_path = work_dir / "report.md"
    calls = []

    def fake_hardware() -> dict[str, object]:
        return {
            "os": "Windows",
            "platform": "Windows-test",
            "python": "3.13.5",
            "cpu": "Test CPU",
            "gpu": None,
            "cuda_available": False,
            "cuda_device_count": 0,
            "driver_version": None,
            "vram_total_mb": None,
        }

    def fake_transcribe(path: Path, options) -> TranscribeResult:  # noqa: ANN001
        calls.append(options)
        run_index = len(calls)
        elapsed = 10.0 if run_index == 1 else 8.0
        return TranscribeResult(
            srt_path=work_dir / f"out-{run_index}.srt",
            provider="local-faster-whisper",
            model=options.model,
            device=options.device,
            compute_type=options.compute_type,
            language_detected="en",
            duration_sec=40.0,
            elapsed_sec=elapsed,
            worker_elapsed_sec=elapsed - 1.0,
            rtfx=40.0 / elapsed,
            segments_count=3,
            gpu_load=options.gpu_load,
            batch_size=options.batch_size or 4,
            warnings=["mock warning"] if run_index == 2 else [],
            actual_device="cpu",
            actual_compute_type="int8",
        )

    report = run_bench(
        input_file,
        BenchOptions(
            repeat=2,
            markdown=markdown_path,
            command=["bench", "sample.wav", "--repeat", "2"],
        ),
        hardware_detector=fake_hardware,
        transcriber=fake_transcribe,
    )

    assert report["measurement_scope"] == "transcribe_media_v1"
    assert report["includes_audio_prepare"] is True
    assert report["excludes_refine"] is True
    assert report["input_basename"] == "sample.wav"
    assert report["input_path_redacted"] is True
    assert report["hardware"]["cpu"] == "Test CPU"
    assert [profile["name"] for profile in report["profiles"]] == ["cpu-int8", "auto"]
    cpu_profile = report["profiles"][0]
    assert cpu_profile["requested_device"] == "cpu"
    assert cpu_profile["requested_compute_type"] == "int8"
    assert cpu_profile["runs"][0]["requested_device"] == "cpu"
    assert cpu_profile["runs"][0]["actual_device"] == "cpu"
    assert cpu_profile["runs"][0]["rtfx_e2e"] == 4.0
    assert cpu_profile["runs"][0]["worker_rtfx"] == pytest.approx(4.444, abs=0.001)
    assert cpu_profile["runs"][0]["quality"] == {
        "reference_available": False,
        "wer": None,
        "cer": None,
        "reference_chars": None,
        "prediction_chars": 0,
    }
    assert cpu_profile["summary"]["first_run_elapsed_sec"] == 10.0
    assert cpu_profile["summary"]["steady_state_elapsed_sec_avg"] == 8.0
    assert cpu_profile["summary"]["worker_elapsed_sec_avg"] == 8.0
    assert cpu_profile["summary"]["overhead_sec_avg"] == 1.0
    assert cpu_profile["summary"]["rtfx_e2e_avg"] == 4.5
    assert calls[0].device == "cpu"
    assert calls[0].compute_type == "int8"
    assert calls[0].output is not None
    assert calls[0].output != input_file.with_suffix(".srt")
    assert calls[0].output.name == "cpu-int8-run-1.srt"
    assert calls[2].device == "auto"
    assert calls[2].compute_type == "auto"
    markdown = markdown_path.read_text(encoding="utf-8")
    assert "Fast Sub Benchmark Report" in markdown
    assert "## Machine" in markdown
    assert "Metric Guide" in markdown
    assert "RTFx: higher is faster" in markdown
    assert "sample.wav" in markdown
    assert str(work_dir) not in markdown
    assert "Run Details" in markdown


def test_run_bench_profile_option_selects_auto_only() -> None:
    work_dir = _work_dir()
    input_file = work_dir / "sample.wav"
    input_file.write_bytes(b"fake wav")
    calls = []

    def fake_transcribe(path: Path, options) -> TranscribeResult:  # noqa: ANN001
        calls.append(options)
        return TranscribeResult(
            srt_path=work_dir / "out.srt",
            provider="local-faster-whisper",
            model=options.model,
            device=options.device,
            compute_type=options.compute_type,
            language_detected="en",
            duration_sec=5.0,
            elapsed_sec=1.0,
            worker_elapsed_sec=0.5,
            rtfx=5.0,
            segments_count=1,
            gpu_load=options.gpu_load,
            batch_size=4,
            warnings=[],
            actual_device="cuda",
            actual_compute_type="float16",
        )

    report = run_bench(
        input_file,
        BenchOptions(profile="auto"),
        hardware_detector=lambda: {"os": "test"},
        transcriber=fake_transcribe,
    )

    assert [profile["name"] for profile in report["profiles"]] == ["auto"]
    assert len(calls) == 1
    assert calls[0].device == "auto"


def test_run_bench_rejects_unknown_profile() -> None:
    work_dir = _work_dir()
    input_file = work_dir / "sample.wav"
    input_file.write_bytes(b"fake wav")

    with pytest.raises(BenchError, match="--profile"):
        run_bench(input_file, BenchOptions(profile="gpu"))


def test_run_bench_does_not_write_next_to_input() -> None:
    work_dir = _work_dir()
    input_file = work_dir / "sample.wav"
    input_file.write_bytes(b"fake wav")
    sibling_srt = input_file.with_suffix(".srt")
    sibling_srt.write_text("keep me", encoding="utf-8")

    def fake_transcribe(path: Path, options) -> TranscribeResult:  # noqa: ANN001
        assert options.output is not None
        options.output.write_text("bench output", encoding="utf-8")
        return TranscribeResult(
            srt_path=options.output,
            provider="local-faster-whisper",
            model=options.model,
            device=options.device,
            compute_type=options.compute_type,
            language_detected="en",
            duration_sec=5.0,
            elapsed_sec=1.0,
            worker_elapsed_sec=0.5,
            rtfx=5.0,
            segments_count=1,
            gpu_load=options.gpu_load,
            batch_size=4,
            warnings=[],
        )

    report = run_bench(
        input_file,
        BenchOptions(repeat=1),
        hardware_detector=lambda: {"os": "test"},
        transcriber=fake_transcribe,
        profiles=(BenchProfile(name="cpu-int8", device="cpu", compute_type="int8"),),
    )

    assert sibling_srt.read_text(encoding="utf-8") == "keep me"
    run = report["profiles"][0]["runs"][0]
    assert run["srt_path"].endswith("cpu-int8-run-1.srt")
    assert Path(run["srt_path"]) != sibling_srt


def test_summarize_runs_ignores_failed_and_skipped_for_timing() -> None:
    summary = summarize_runs(
        [
            {"index": 1, "status": "failed", "reason": "boom"},
            {
                "index": 2,
                "status": "ok",
                "elapsed_sec": 3.0,
                "rtfx_e2e": 10.0,
                "worker_rtfx": 12.0,
                "segments_count": 2,
                "actual_device": "cpu",
                "actual_compute_type": "int8",
            },
            {"index": 3, "status": "skipped", "reason": "cuda unavailable"},
            {
                "index": 4,
                "status": "ok",
                "elapsed_sec": 2.0,
                "rtfx_e2e": 15.0,
                "worker_rtfx": 18.0,
                "segments_count": 2,
                "actual_device": "cpu",
                "actual_compute_type": "int8",
            },
        ]
    )

    assert summary["runs"] == 4
    assert summary["ok_runs"] == 2
    assert summary["failed_runs"] == 1
    assert summary["skipped_runs"] == 1
    assert summary["first_run_elapsed_sec"] == 3.0
    assert summary["steady_state_elapsed_sec_avg"] == 2.0
    assert summary["elapsed_sec_avg"] == 2.5
    assert summary["rtfx_e2e_best"] == 15.0


def test_run_bench_keeps_unknown_actual_device_when_worker_does_not_report() -> None:
    work_dir = _work_dir()
    input_file = work_dir / "sample.wav"
    input_file.write_bytes(b"fake wav")

    def fake_transcribe(path: Path, options) -> TranscribeResult:  # noqa: ANN001
        return TranscribeResult(
            srt_path=work_dir / "out.srt",
            provider="local-faster-whisper",
            model=options.model,
            device=options.device,
            compute_type=options.compute_type,
            language_detected="en",
            duration_sec=5.0,
            elapsed_sec=1.0,
            worker_elapsed_sec=0.5,
            rtfx=5.0,
            segments_count=1,
            gpu_load=options.gpu_load,
            batch_size=4,
            warnings=[],
        )

    report = run_bench(
        input_file,
        BenchOptions(repeat=1),
        hardware_detector=lambda: {"os": "test"},
        transcriber=fake_transcribe,
        profiles=(BenchProfile(name="auto", device="auto", compute_type="auto"),),
    )

    run = report["profiles"][0]["runs"][0]
    assert run["requested_device"] == "auto"
    assert run["requested_compute_type"] == "auto"
    assert run["actual_device"] == "unknown"
    assert run["actual_compute_type"] == "unknown"


def test_run_bench_reports_failures_and_exits_when_all_profiles_fail() -> None:
    work_dir = _work_dir()
    input_file = work_dir / "sample.wav"
    input_file.write_bytes(b"fake wav")

    def fake_transcribe(path: Path, options) -> TranscribeResult:  # noqa: ANN001
        raise SubGenError("missing model")

    with pytest.raises(BenchError) as exc_info:
        run_bench(
            input_file,
            BenchOptions(repeat=1),
            hardware_detector=lambda: {"os": "test"},
            transcriber=fake_transcribe,
            profiles=(BenchProfile(name="cpu-int8", device="cpu", compute_type="int8"),),
        )

    report = exc_info.value.report
    assert report is not None
    run = report["profiles"][0]["runs"][0]
    assert run["status"] == "failed"
    assert run["reason"] == "missing model"
    assert report["profiles"][0]["summary"]["ok_runs"] == 0


def test_loads_sample_manifest_metadata() -> None:
    work_dir = _work_dir()
    input_file = work_dir / "zh-interview-10m.mp4"
    input_file.write_bytes(b"fake mp4")
    manifest = work_dir / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "samples": [
                    {
                        "id": "zh-interview-10m",
                        "prepared_media_path": "local_tests/media/zh-interview-10m.mp4",
                        "source_dataset": "AISHELL-1",
                        "source_accessed_at": "2026-05-01",
                        "license": "Apache-2.0",
                        "prepared_media_checksum_sha256": "abc",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    def fake_transcribe(path: Path, options) -> TranscribeResult:  # noqa: ANN001
        return TranscribeResult(
            srt_path=work_dir / "out.srt",
            provider="local-faster-whisper",
            model=options.model,
            device=options.device,
            compute_type=options.compute_type,
            language_detected="zh",
            duration_sec=10.0,
            elapsed_sec=2.0,
            worker_elapsed_sec=1.0,
            rtfx=5.0,
            segments_count=1,
            gpu_load=options.gpu_load,
            batch_size=4,
            warnings=[],
            actual_device="cpu",
            actual_compute_type="int8",
        )

    report = run_bench(
        input_file,
        BenchOptions(sample_manifest=manifest, sample_id="zh-interview-10m"),
        hardware_detector=lambda: {"os": "test"},
        transcriber=fake_transcribe,
        profiles=(BenchProfile(name="cpu-int8", device="cpu", compute_type="int8"),),
    )

    assert report["sample"]["source_dataset"] == "AISHELL-1"
    assert report["sample"]["source_accessed_at"] == "2026-05-01"
    assert report["input_sha256"] == "abc"


def test_detect_hardware_tolerates_missing_gpu(monkeypatch) -> None:
    def fail_run(*args, **kwargs):  # noqa: ANN002, ANN003
        raise OSError("nvidia-smi missing")

    monkeypatch.setattr("fast_sub.benchmark.transcription.subprocess.run", fail_run)
    hardware = detect_hardware()

    assert hardware["gpu"] is None
    assert hardware["vram_total_mb"] is None
    assert "ram_total_mb" in hardware
    assert "ram_available_mb" in hardware
    assert "python" in hardware


def test_render_markdown_does_not_include_absolute_input_path() -> None:
    markdown = render_markdown_report(
        {
            "generated_at": "2026-05-02T00:00:00Z",
            "measurement_scope": "transcribe_media_v1",
            "input": "C:/Users/name/local_tests/media/sample.wav",
            "input_basename": "sample.wav",
            "sample": {"id": "sample", "license": "CC0", "redistributable": False},
            "hardware": {"os": "Windows", "platform": "Windows-test", "python": "3.13"},
            "profiles": [],
        }
    )

    assert "sample.wav" in markdown
    assert "C:/Users/name" not in markdown


def test_run_bench_redacts_absolute_paths_from_markdown_command() -> None:
    work_dir = _work_dir()
    input_file = work_dir / "sample.wav"
    input_file.write_bytes(b"fake wav")
    markdown = work_dir / "report.md"
    manifest = work_dir / "manifest.json"
    manifest.write_text(json.dumps({"schema_version": 1, "samples": []}), encoding="utf-8")

    def fake_transcribe(path: Path, options) -> TranscribeResult:  # noqa: ANN001
        return TranscribeResult(
            srt_path=options.output or work_dir / "out.srt",
            provider="local-faster-whisper",
            model=options.model,
            device=options.device,
            compute_type=options.compute_type,
            language_detected="en",
            duration_sec=5.0,
            elapsed_sec=1.0,
            worker_elapsed_sec=0.5,
            rtfx=5.0,
            segments_count=1,
            gpu_load=options.gpu_load,
            batch_size=4,
            warnings=[],
        )

    report = run_bench(
        input_file,
        BenchOptions(
            repeat=1,
            markdown=markdown,
            sample_manifest=manifest,
            command=[
                "bench",
                str(input_file),
                "--markdown-path",
                str(markdown),
                "--sample-manifest",
                str(manifest),
            ],
        ),
        hardware_detector=lambda: {"os": "test"},
        transcriber=fake_transcribe,
        profiles=(BenchProfile(name="cpu-int8", device="cpu", compute_type="int8"),),
    )

    assert report["command"] == (
        "bench sample.wav --markdown-path report.md --sample-manifest manifest.json"
    )
    markdown_text = markdown.read_text(encoding="utf-8")
    assert str(work_dir) not in markdown_text
    assert "sample.wav" in markdown_text


def test_run_bench_does_not_treat_markdown_flag_as_path_for_redaction() -> None:
    work_dir = _work_dir()
    input_file = work_dir / "sample.wav"
    input_file.write_bytes(b"fake wav")
    markdown = work_dir / "report.md"
    manifest = work_dir / "manifest.json"
    manifest.write_text(json.dumps({"schema_version": 1, "samples": []}), encoding="utf-8")

    def fake_transcribe(path: Path, options) -> TranscribeResult:  # noqa: ANN001
        return TranscribeResult(
            srt_path=options.output or work_dir / "out.srt",
            provider="local-faster-whisper",
            model=options.model,
            device=options.device,
            compute_type=options.compute_type,
            language_detected="en",
            duration_sec=5.0,
            elapsed_sec=1.0,
            worker_elapsed_sec=0.5,
            rtfx=5.0,
            segments_count=1,
            gpu_load=options.gpu_load,
            batch_size=4,
            warnings=[],
        )

    report = run_bench(
        input_file,
        BenchOptions(
            repeat=1,
            markdown=markdown,
            sample_manifest=manifest,
            command=[
                "bench",
                str(input_file),
                "--markdown",
                "--sample-manifest",
                str(manifest),
            ],
        ),
        hardware_detector=lambda: {"os": "test"},
        transcriber=fake_transcribe,
        profiles=(BenchProfile(name="cpu-int8", device="cpu", compute_type="int8"),),
    )

    assert report["command"] == "bench sample.wav --markdown --sample-manifest manifest.json"
    markdown_text = markdown.read_text(encoding="utf-8")
    assert str(work_dir) not in markdown_text


def test_example_sample_manifest_uses_consumed_schema() -> None:
    input_file = Path("local_tests/audio/zh-interview-10m.16k.mono.wav")

    sample = load_sample_metadata(
        Path("tests/fixtures/manifest.example.json"),
        sample_id=None,
        input_file=input_file,
    )

    assert sample["id"] == "zh-interview-10m"
    assert sample["reference_transcript_path"] == "local_tests/references/zh-interview-10m.txt"
    assert sample["source_dataset"] == "AISHELL-1 or authorized local interview"


def test_run_bench_scores_cer_from_sample_reference() -> None:
    work_dir = _work_dir()
    input_file = work_dir / "zh-interview-10m.wav"
    input_file.write_bytes(b"fake wav")
    reference = work_dir / "zh-interview-10m.txt"
    reference.write_text("你好世界\n", encoding="utf-8")
    manifest = work_dir / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "samples": [
                    {
                        "id": "zh-interview-10m",
                        "source_dataset": "AISHELL-1",
                        "language": "zh",
                        "prepared_media_path": str(input_file),
                        "prepared_media_checksum_sha256": "sha",
                        "reference_transcript_path": str(reference),
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    def fake_transcribe(path: Path, options) -> TranscribeResult:  # noqa: ANN001
        assert options.output is not None
        _write_srt(options.output, "你好世")
        return _transcribe_result(options.output, options, language="zh")

    report = run_bench(
        input_file,
        BenchOptions(sample_manifest=manifest, sample_id="zh-interview-10m"),
        hardware_detector=lambda: {"os": "test"},
        transcriber=fake_transcribe,
        profiles=(BenchProfile(name="cpu-int8", device="cpu", compute_type="int8"),),
    )

    run = report["profiles"][0]["runs"][0]
    assert report["input_sha256"] == "sha"
    assert run["quality"]["reference_available"] is True
    assert run["quality"]["cer"] == 0.25
    assert run["quality"]["reference_chars"] == 4
    assert run["prediction_chars"] == 3
    assert report["profiles"][0]["summary"]["cer_avg"] == 0.25


def test_run_bench_scores_wer_and_cer_for_english_reference() -> None:
    work_dir = _work_dir()
    input_file = work_dir / "sample.wav"
    input_file.write_bytes(b"fake wav")
    reference = work_dir / "sample.txt"
    reference.write_text("hello world again\n", encoding="utf-8")
    manifest = _sample_manifest(work_dir, input_file, reference, language="en")

    def fake_transcribe(path: Path, options) -> TranscribeResult:  # noqa: ANN001
        assert options.output is not None
        _write_srt(options.output, "hello world")
        return _transcribe_result(options.output, options, language="en")

    report = run_bench(
        input_file,
        BenchOptions(sample_manifest=manifest, sample_id="sample-1"),
        hardware_detector=lambda: {"os": "test"},
        transcriber=fake_transcribe,
        profiles=(BenchProfile(name="cpu-int8", device="cpu", compute_type="int8"),),
    )

    quality = report["profiles"][0]["runs"][0]["quality"]
    assert quality["wer"] == pytest.approx(0.333, abs=0.001)
    assert quality["cer"] == pytest.approx(0.333, abs=0.001)
    assert report["profiles"][0]["summary"]["wer_avg"] == pytest.approx(0.333, abs=0.001)


def test_run_bench_reports_empty_output_and_invalid_segments() -> None:
    work_dir = _work_dir()
    input_file = work_dir / "sample.wav"
    input_file.write_bytes(b"fake wav")
    reference = work_dir / "sample.txt"
    reference.write_text("hello\n", encoding="utf-8")
    manifest = _sample_manifest(work_dir, input_file, reference, language="en")

    def fake_transcribe(path: Path, options) -> TranscribeResult:  # noqa: ANN001
        assert options.output is not None
        options.output.write_text("", encoding="utf-8")
        return _transcribe_result(options.output, options, language="en", segments_count=0)

    report = run_bench(
        input_file,
        BenchOptions(sample_manifest=manifest, sample_id="sample-1"),
        hardware_detector=lambda: {"os": "test"},
        transcriber=fake_transcribe,
        profiles=(BenchProfile(name="cpu-int8", device="cpu", compute_type="int8"),),
    )

    run = report["profiles"][0]["runs"][0]
    assert run["empty_output"] is True
    assert run["invalid_segments_count"] == 0
    assert run["quality"]["wer"] == 1.0
    assert report["profiles"][0]["summary"]["empty_output_any"] is True


def test_run_bench_counts_invalid_srt_timeline() -> None:
    work_dir = _work_dir()
    input_file = work_dir / "sample.wav"
    input_file.write_bytes(b"fake wav")

    def fake_transcribe(path: Path, options) -> TranscribeResult:  # noqa: ANN001
        assert options.output is not None
        options.output.write_text(
            "1\n00:00:03,000 --> 00:00:02,000\nbad\n",
            encoding="utf-8",
        )
        return _transcribe_result(options.output, options, language="en")

    report = run_bench(
        input_file,
        BenchOptions(),
        hardware_detector=lambda: {"os": "test"},
        transcriber=fake_transcribe,
        profiles=(BenchProfile(name="cpu-int8", device="cpu", compute_type="int8"),),
    )

    run = report["profiles"][0]["runs"][0]
    assert run["invalid_segments_count"] == 1
    assert run["empty_output"] is False


def test_render_brief_and_markdown_include_quality_without_paths() -> None:
    from fast_sub.benchmark.transcription import render_brief_report

    report = {
        "generated_at": "2026-05-02T00:00:00Z",
        "measurement_scope": "transcribe_media_v1",
        "input": "C:/Users/name/local_tests/media/sample.wav",
        "input_basename": "sample.wav",
        "sample": {"id": "sample", "license": "CC0", "redistributable": False},
        "hardware": {
            "os": "Windows",
            "platform": "Windows-test",
            "python": "3.13",
            "cpu": "Test CPU",
            "gpu": None,
            "ram_total_mb": 32768,
            "ram_available_mb": 16384,
        },
        "profiles": [
            {
                "name": "cpu-int8",
                "requested_device": "cpu",
                "requested_compute_type": "int8",
                "runs": [
                    {
                        "index": 1,
                        "status": "ok",
                        "elapsed_sec": 2.0,
                        "rtfx_e2e": 5.0,
                        "worker_rtfx": 6.0,
                        "prediction_chars": 10,
                        "reference_chars": 12,
                        "invalid_segments_count": 1,
                        "empty_output": False,
                        "quality": {"cer": 0.1, "wer": 0.2},
                    }
                ],
                "summary": {
                    "runs": 1,
                    "ok_runs": 1,
                    "actual_device": "cpu",
                    "actual_compute_type": "int8",
                    "elapsed_sec_avg": 2.0,
                    "rtfx_e2e_avg": 5.0,
                    "cer_avg": 0.1,
                    "wer_avg": 0.2,
                    "invalid_segments_count_avg": 1.0,
                    "empty_output_any": False,
                },
            }
        ],
    }

    brief = render_brief_report(report)
    markdown = render_markdown_report(report)

    assert "Fast Sub Benchmark Summary" in brief
    assert (
        "| profile | actual | elapsed | overhead approx | avg RTFx | CER | WER | "
        "quality | subtitle health | status |"
    ) in brief
    assert "0.100" in brief
    assert "invalid segments" in brief
    assert "Run Details" in markdown
    assert "Metric Guide" in markdown
    assert "prediction chars" in markdown
    assert "C:/Users/name" not in brief
    assert "C:/Users/name" not in markdown


def test_render_brief_hides_quality_columns_without_reference() -> None:
    from fast_sub.benchmark.transcription import render_brief_report

    report = {
        "input_basename": "sample.wav",
        "sample": {"id": "sample"},
        "hardware": {
            "cpu": "Test CPU",
            "gpu": "Test GPU",
            "ram_total_mb": 16384,
            "ram_available_mb": 8192,
        },
        "profiles": [
            {
                "name": "auto",
                "requested_device": "auto",
                "requested_compute_type": "auto",
                "runs": [
                    {
                        "index": 1,
                        "status": "ok",
                        "elapsed_sec": 2.0,
                        "rtfx_e2e": 5.0,
                        "worker_rtfx": 6.0,
                        "prediction_chars": 10,
                        "reference_chars": None,
                        "invalid_segments_count": 0,
                        "empty_output": False,
                        "quality": {"reference_available": False, "cer": None, "wer": None},
                    }
                ],
                "summary": {
                    "runs": 1,
                    "ok_runs": 1,
                    "actual_device": "cuda",
                    "actual_compute_type": "float16",
                    "elapsed_sec_avg": 2.0,
                    "overhead_sec_avg": 1.0,
                    "rtfx_e2e_avg": 5.0,
                    "cer_avg": None,
                    "wer_avg": None,
                    "invalid_segments_count_avg": 0.0,
                    "empty_output_any": False,
                },
            }
        ],
    }

    brief = render_brief_report(report)
    table_header = next(line for line in brief.splitlines() if line.startswith("| profile |"))

    assert "CER" not in table_header
    assert "WER" not in table_header
    assert "subtitle health" in brief
    assert "| auto | cuda/float16 | 2.000s | 1.000s | 5.000 | ok | ok |" in brief
    assert "Quality: CER/WER not shown" in brief


def _write_srt(path: Path, text: str) -> None:
    path.write_text(
        f"1\n00:00:00,000 --> 00:00:01,000\n{text}\n",
        encoding="utf-8",
    )


def _sample_manifest(work_dir: Path, input_file: Path, reference: Path, *, language: str) -> Path:
    manifest = work_dir / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "samples": [
                    {
                        "id": "sample-1",
                        "language": language,
                        "prepared_media_path": str(input_file),
                        "reference_transcript_path": str(reference),
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    return manifest


def _transcribe_result(
    srt_path: Path,
    options,  # noqa: ANN001
    *,
    language: str,
    segments_count: int = 1,
) -> TranscribeResult:
    return TranscribeResult(
        srt_path=srt_path,
        provider="local-faster-whisper",
        model=options.model,
        device=options.device,
        compute_type=options.compute_type,
        language_detected=language,
        duration_sec=10.0,
        elapsed_sec=2.0,
        worker_elapsed_sec=1.0,
        rtfx=5.0,
        segments_count=segments_count,
        gpu_load=options.gpu_load,
        batch_size=4,
        warnings=[],
        actual_device="cpu",
        actual_compute_type="int8",
    )
