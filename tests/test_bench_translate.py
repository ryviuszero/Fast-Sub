from __future__ import annotations

import json
import shutil
import sys
import uuid
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace

import pytest

from fast_sub.benchmark.errors import BenchTranslateError
from fast_sub.benchmark.models import BenchTranslateOptions
from fast_sub.benchmark.translation import (
    _metric_info,
    run_bench_translate,
    score_translation_quality,
)
from fast_sub.translation.errors import TranslationProviderError
from fast_sub.translation.service import TranslateSrtResult


@pytest.fixture
def work_dir() -> Iterator[Path]:
    path = (Path(".test-work") / "bench-translate" / uuid.uuid4().hex).resolve()
    path.mkdir(parents=True)
    try:
        yield path
    finally:
        shutil.rmtree(path)


def test_bench_translate_success_srt_reference_aligned(work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path / "input.srt", ["Hello", "World"])
    reference = _write_srt(tmp_path / "ref.zh.srt", ["你好", "世界"])
    output_dir = tmp_path / "bench-out"

    def fake_translate(_input, options):  # noqa: ANN001
        options.output.write_text(
            _srt_text(["你好", "世界"]),
            encoding="utf-8",
        )
        return TranslateSrtResult(
            srt_path=options.output,
            provider=options.provider,
            source_language="en",
            target_language="zh",
            mode="translated",
            cues_count=2,
            translated_count=2,
            failed_count=0,
            checkpoint_path=Path(str(options.output) + ".translate-progress.json"),
            warnings=[],
        )

    report = run_bench_translate(
        input_file,
        BenchTranslateOptions(
            reference=reference,
            provider="web-bing",
            source_language="en",
            target_language="zh",
            output_dir=output_dir,
        ),
        translator=fake_translate,
    )

    run = report["runs"][0]
    assert report["measurement_scope"] == "translate_srt_v1"
    assert report["provider_privacy_class"] == "remote-web"
    assert report["uploads_text"] is True
    assert run["resume_used"] is False
    assert run["quality"]["reference_alignment_status"] == "aligned"
    assert run["quality"]["prediction_units"] == 2
    assert run["quality"]["reference_units"] == 2
    assert run["quality"]["metric_input_unit"] == "text_sequence_v1"
    assert run["quality"]["exact_match_rate"] == 1.0
    assert run["quality"]["bleu"] is not None
    assert run["quality"]["chrf"] is not None
    assert run["quality"]["case"] is not None
    assert run["quality"]["smooth"] is not None
    assert (output_dir / "report.json").exists()
    payload = json.loads((output_dir / "report.json").read_text(encoding="utf-8"))
    assert "你好" not in json.dumps(payload, ensure_ascii=False)


def test_bench_translate_txt_reference_lines_align_by_cue_count(work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path / "input.srt", ["Hello", "World"])
    reference = tmp_path / "ref.zh.txt"
    reference.write_text("你好\n世界\n", encoding="utf-8")

    quality = score_translation_quality(
        prediction_texts=["你好", "世界"],
        reference={"reference_type": "txt", "texts": ["你好", "世界"]},
        source_cue_count=2,
    )

    assert quality["reference_alignment_status"] == "aligned"
    assert quality["exact_match_rate"] == 1.0
    assert input_file.exists()
    assert reference.exists()


def test_bench_translate_sacrebleu_scores_are_canonicalized(monkeypatch) -> None:
    fake_sacrebleu = SimpleNamespace(
        corpus_bleu=lambda predictions, references, **kwargs: SimpleNamespace(score=42.0),
        corpus_chrf=lambda predictions, references: SimpleNamespace(score=55.5),
    )
    monkeypatch.setitem(sys.modules, "sacrebleu", fake_sacrebleu)

    quality = score_translation_quality(
        prediction_texts=["你好"],
        reference={"reference_type": "srt", "texts": ["你好"]},
        source_cue_count=1,
        metric_info={
            "metric_implementation": "sacrebleu",
            "metric_version": "fake",
            "metric_signature": "fake-signature",
            "tokenizer": "13a",
            "case": "mixed",
            "smooth": "exp",
        },
    )

    assert quality["bleu"] == 0.42
    assert quality["bleu_raw_score"] == 42.0
    assert quality["bleu_raw_scale"] == "0-100"
    assert quality["chrf"] == 0.555
    assert quality["chrf_raw_score"] == 55.5
    assert quality["chrf_raw_scale"] == "0-100"


def test_bench_translate_sacrebleu_uses_zh_tokenizer_for_chinese(monkeypatch) -> None:
    calls = []
    fake_sacrebleu = SimpleNamespace(
        corpus_bleu=lambda predictions, references, **kwargs: (
            calls.append(kwargs) or SimpleNamespace(score=70.0)
        ),
        corpus_chrf=lambda predictions, references: SimpleNamespace(score=80.0),
    )
    monkeypatch.setitem(sys.modules, "sacrebleu", fake_sacrebleu)

    quality = score_translation_quality(
        prediction_texts=["那些是汤姆的狗吗？", "你害怕虫子吗？"],
        reference={"reference_type": "srt", "texts": ["那是汤姆的狗吗？", "你怕虫子吗？"]},
        source_cue_count=2,
        metric_info=_metric_info("zh"),
    )

    assert quality["metric_implementation"] == "sacrebleu"
    assert quality["tokenizer"] == "zh"
    assert quality["bleu"] == 0.7
    assert calls == [{"tokenize": "zh"}]


def test_bench_translate_alignment_uses_prediction_units_not_source_count(work_dir: Path) -> None:
    tmp_path = work_dir
    reference = tmp_path / "ref.zh.txt"
    reference.write_text("你好\n世界\n", encoding="utf-8")

    quality = score_translation_quality(
        prediction_texts=["你好", "世界"],
        reference={"reference_type": "txt", "texts": ["你好", "世界"]},
        source_cue_count=99,
    )

    assert quality["reference_alignment_status"] == "aligned"
    assert quality["prediction_units"] == 2
    assert quality["reference_units"] == 2
    assert quality["exact_match_rate"] == 1.0


def test_bench_translate_txt_reference_ignores_blank_lines(work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path / "input.srt", ["Hello", "World"])
    reference = tmp_path / "ref.zh.txt"
    reference.write_text("\n你好\n\n世界\n", encoding="utf-8")
    output_dir = tmp_path / "bench-out"

    def fake_translate(_input, options):  # noqa: ANN001
        options.output.write_text(_srt_text(["你好", "世界"]), encoding="utf-8")
        return TranslateSrtResult(
            srt_path=options.output,
            provider=options.provider,
            source_language="en",
            target_language="zh",
            mode="translated",
            cues_count=2,
            translated_count=2,
            failed_count=0,
        )

    report = run_bench_translate(
        input_file,
        BenchTranslateOptions(
            reference=reference,
            provider="web-bing",
            source_language="en",
            target_language="zh",
            output_dir=output_dir,
        ),
        translator=fake_translate,
    )

    quality = report["runs"][0]["quality"]
    assert quality["reference_type"] == "txt"
    assert quality["reference_alignment_status"] == "aligned"
    assert quality["reference_units"] == 2
    assert quality["exact_match_rate"] == 1.0


def test_bench_translate_txt_reference_count_mismatch_is_corpus_only(work_dir: Path) -> None:
    tmp_path = work_dir
    reference = tmp_path / "ref.zh.txt"
    reference.write_text("你好\n", encoding="utf-8")

    quality = score_translation_quality(
        prediction_texts=["你好", "世界"],
        reference={"reference_type": "txt", "texts": ["你好"]},
        source_cue_count=2,
    )

    assert quality["reference_alignment_status"] == "corpus_only"
    assert quality["exact_match_rate"] is None
    assert quality["bleu"] is not None
    assert quality["chrf"] is not None


def test_bench_translate_srt_count_mismatch_keeps_corpus_metrics(work_dir: Path) -> None:
    tmp_path = work_dir
    reference = _write_srt(tmp_path / "ref.zh.srt", ["你好"])

    quality = score_translation_quality(
        prediction_texts=["你好", "世界"],
        reference={"reference_type": "srt", "texts": ["你好"]},
        source_cue_count=2,
    )

    assert reference.exists()
    assert quality["reference_alignment_status"] == "count_mismatch"
    assert quality["exact_match_rate"] is None
    assert quality["bleu"] is not None
    assert quality["chrf"] is not None


def test_bench_translate_partial_failure_exits_ok_with_errors_path(work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path / "input.srt", ["Hello", "World"])
    reference = _write_srt(tmp_path / "ref.zh.srt", ["你好", "世界"])
    errors_path = tmp_path / "bench-out" / "run-1.zh.errors.json"

    def fake_translate(_input, options):  # noqa: ANN001
        options.output.write_text(_srt_text(["你好", "World"]), encoding="utf-8")
        errors_path.write_text('{"errors":[]}', encoding="utf-8")
        return TranslateSrtResult(
            srt_path=options.output,
            provider=options.provider,
            source_language="en",
            target_language="zh",
            mode="translated",
            cues_count=2,
            translated_count=1,
            failed_count=1,
            errors_path=errors_path,
            warnings=["one cue failed"],
        )

    report = run_bench_translate(
        input_file,
        BenchTranslateOptions(
            reference=reference,
            provider="web-bing",
            source_language="en",
            target_language="zh",
            output_dir=tmp_path / "bench-out",
        ),
        translator=fake_translate,
    )

    assert report["runs"][0]["failed_count"] == 1
    assert report["runs"][0]["errors_path"] == "run-1.zh.errors.json"
    assert report["summary"]["ok_runs"] == 1


def test_bench_translate_all_failure_writes_failed_report(work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path / "input.srt", ["Hello"])
    reference = _write_srt(tmp_path / "ref.zh.srt", ["你好"])
    output_dir = tmp_path / "bench-out"

    def fake_translate(_input, _options):  # noqa: ANN001
        raise TranslationProviderError("provider_failed", "all failed sk-secret123456")

    with pytest.raises(BenchTranslateError) as raised:
        run_bench_translate(
            input_file,
            BenchTranslateOptions(
                reference=reference,
                provider="web-bing",
                source_language="en",
                target_language="zh",
                output_dir=output_dir,
            ),
            translator=fake_translate,
        )

    assert raised.value.report is not None
    assert raised.value.report["runs"][0]["status"] == "failed"
    assert raised.value.report["runs"][0]["quality"]["bleu"] is None
    report_text = (output_dir / "report.json").read_text(encoding="utf-8")
    assert "sk-secret123456" not in report_text


def test_bench_translate_redacts_openai_api_key_env(monkeypatch, work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path / "input.srt", ["Hello"])
    reference = _write_srt(tmp_path / "ref.zh.srt", ["你好"])
    output_dir = tmp_path / "bench-out"
    monkeypatch.setenv("OPENAI_API_KEY", "lm-studio")

    def fake_translate(_input, _options):  # noqa: ANN001
        raise TranslationProviderError("provider_failed", "provider rejected token lm-studio")

    with pytest.raises(BenchTranslateError) as raised:
        run_bench_translate(
            input_file,
            BenchTranslateOptions(
                reference=reference,
                provider="api-openai-chat",
                source_language="en",
                target_language="zh",
                output_dir=output_dir,
                model="qwen3-4b",
                api_key="lm-studio",
            ),
            translator=fake_translate,
        )

    assert raised.value.report is not None
    report_text = (output_dir / "report.json").read_text(encoding="utf-8")
    assert "lm-studio" not in report_text
    assert "[redacted]" in report_text


def test_bench_translate_redacts_equals_form_command_paths(work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path / "input.srt", ["Hello"])
    reference = _write_srt(tmp_path / "ref.zh.srt", ["你好"])
    output_dir = tmp_path / "bench-out"
    markdown_path = tmp_path / "reports" / "report.md"
    model_path = tmp_path / "models" / "nllb"

    def fake_translate(_input, options):  # noqa: ANN001
        options.output.write_text(_srt_text(["你好"]), encoding="utf-8")
        return TranslateSrtResult(
            srt_path=options.output,
            provider=options.provider,
            source_language="en",
            target_language="zh",
            mode="translated",
            cues_count=1,
            translated_count=1,
            failed_count=0,
        )

    report = run_bench_translate(
        input_file,
        BenchTranslateOptions(
            reference=reference,
            provider="local-nllb-ct2",
            source_language="en",
            target_language="zh",
            output_dir=output_dir,
            markdown_path=markdown_path,
            model_path=model_path,
            api_key="sk-testsecret123456",
            command=[
                "bench-translate",
                str(input_file),
                f"--reference={reference}",
                f"--output-dir={output_dir}",
                f"--markdown-path={markdown_path}",
                f"--model-path={model_path}",
                "--api-key=sk-testsecret123456",
            ],
        ),
        translator=fake_translate,
    )

    assert str(tmp_path) not in report["command"]
    assert report["command"] == (
        "bench-translate input.srt --reference=ref.zh.srt --output-dir=bench-out "
        "--markdown-path=report.md --model-path=nllb --api-key=[redacted]"
    )
    markdown_text = markdown_path.read_text(encoding="utf-8")
    assert str(tmp_path) not in markdown_text
    assert "sk-testsecret123456" not in markdown_text


def test_bench_translate_repeat_summary_stats(work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path / "input.srt", ["Hello"])
    reference = _write_srt(tmp_path / "ref.zh.srt", ["你好"])

    def fake_translate(_input, options):  # noqa: ANN001
        options.output.write_text(_srt_text(["你好"]), encoding="utf-8")
        return TranslateSrtResult(
            srt_path=options.output,
            provider=options.provider,
            source_language="en",
            target_language="zh",
            mode="translated",
            cues_count=1,
            translated_count=1,
            failed_count=0,
        )

    report = run_bench_translate(
        input_file,
        BenchTranslateOptions(
            reference=reference,
            provider="local-nllb-ct2",
            source_language="en",
            target_language="zh",
            output_dir=tmp_path / "bench-out",
            repeat=2,
        ),
        translator=fake_translate,
    )

    assert report["provider_privacy_class"] == "local"
    assert report["summary"]["runs"] == 2
    assert report["summary"]["elapsed_sec_avg"] is not None
    assert report["summary"]["elapsed_sec_min"] is not None
    assert report["summary"]["elapsed_sec_max"] is not None
    assert report["summary"]["elapsed_sec_stddev"] is not None


def test_bench_translate_invalid_reference_does_not_create_report(work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path / "input.srt", ["Hello"])
    output_dir = tmp_path / "bench-out"

    with pytest.raises(BenchTranslateError):
        run_bench_translate(
            input_file,
            BenchTranslateOptions(
                reference=tmp_path / "missing.srt",
                provider="web-bing",
                source_language="en",
                target_language="zh",
                output_dir=output_dir,
            ),
        )

    assert not output_dir.exists()


def _write_srt(path: Path, texts: list[str]) -> Path:
    path.write_text(_srt_text(texts), encoding="utf-8")
    return path


def _srt_text(texts: list[str]) -> str:
    blocks = []
    for index, text in enumerate(texts, start=1):
        blocks.append(f"{index}\n00:00:{index - 1:02d},000 --> 00:00:{index:02d},000\n{text}\n")
    return "\n".join(blocks)
