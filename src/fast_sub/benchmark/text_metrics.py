from __future__ import annotations

import math
import re
import statistics
from collections import Counter


def normalize_subtitle_text(text: str) -> str:
    normalized = text.replace("\\N", "\n").replace("\r\n", "\n").replace("\r", "\n")
    normalized = re.sub(r"<[^>]+>", "", normalized)
    return "\n".join(line.strip() for line in normalized.splitlines() if line.strip())


def normalize_for_cer(text: str) -> str:
    normalized = normalize_subtitle_text(text).casefold()
    return "".join(char for char in normalized if char.isalnum())


def normalize_for_wer(text: str) -> list[str]:
    normalized = normalize_subtitle_text(text).casefold()
    normalized = re.sub(r"[^\w\s]", " ", normalized, flags=re.UNICODE)
    return [word for word in normalized.split() if word]


def error_rate(reference: list[str], prediction: list[str]) -> float | None:
    if not reference:
        return None
    return round(edit_distance(reference, prediction) / len(reference), 3)


def edit_distance(reference: list[str], prediction: list[str]) -> int:
    previous = list(range(len(prediction) + 1))
    for ref_index, ref_item in enumerate(reference, start=1):
        current = [ref_index]
        for pred_index, pred_item in enumerate(prediction, start=1):
            cost = 0 if ref_item == pred_item else 1
            current.append(
                min(
                    current[pred_index - 1] + 1,
                    previous[pred_index] + 1,
                    previous[pred_index - 1] + cost,
                )
            )
        previous = current
    return previous[-1]


def normalize_quality_text(text: str) -> str:
    normalized = normalize_subtitle_text(text).casefold()
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def quality_tokens(text: str) -> list[str]:
    normalized = normalize_quality_text(text)
    if any(is_cjk(char) for char in normalized):
        return [char for char in normalized if not char.isspace()]
    return normalized.split()


def ngram_counts(tokens: list[str], n: int) -> Counter[tuple[str, ...]]:
    return Counter(tuple(tokens[index : index + n]) for index in range(0, len(tokens) - n + 1))


def lightweight_bleu_corpus(predictions: list[str], references: list[str]) -> float | None:
    return lightweight_bleu("\n".join(predictions), "\n".join(references))


def lightweight_chrf_corpus(predictions: list[str], references: list[str]) -> float | None:
    return lightweight_chrf("\n".join(predictions), "\n".join(references))


def lightweight_bleu(prediction: str, reference: str) -> float | None:
    pred_tokens = quality_tokens(prediction)
    ref_tokens = quality_tokens(reference)
    if not ref_tokens:
        return None
    if not pred_tokens:
        return 0.0
    precisions: list[float] = []
    for n in range(1, 5):
        pred_counts = ngram_counts(pred_tokens, n)
        ref_counts = ngram_counts(ref_tokens, n)
        if not pred_counts:
            precisions.append(0.0)
            continue
        clipped = sum(min(count, ref_counts.get(ngram, 0)) for ngram, count in pred_counts.items())
        precisions.append(clipped / sum(pred_counts.values()))
    smooth = 1e-9
    log_precision = sum(math.log(max(value, smooth)) for value in precisions) / 4
    brevity_penalty = 1.0
    if len(pred_tokens) <= len(ref_tokens):
        brevity_penalty = math.exp(1 - len(ref_tokens) / len(pred_tokens))
    return round(brevity_penalty * math.exp(log_precision), 6)


def lightweight_chrf(
    prediction: str,
    reference: str,
    *,
    n: int = 6,
    beta: float = 2.0,
) -> float | None:
    pred = normalize_quality_text(prediction).replace(" ", "")
    ref = normalize_quality_text(reference).replace(" ", "")
    if not ref:
        return None
    if not pred:
        return 0.0
    scores = []
    for size in range(1, n + 1):
        pred_counts = ngram_counts(list(pred), size)
        ref_counts = ngram_counts(list(ref), size)
        if not pred_counts or not ref_counts:
            continue
        overlap = sum(min(count, ref_counts.get(ngram, 0)) for ngram, count in pred_counts.items())
        precision = overlap / sum(pred_counts.values())
        recall = overlap / sum(ref_counts.values())
        denom = beta * beta * precision + recall
        scores.append(((1 + beta * beta) * precision * recall / denom) if denom else 0.0)
    return round(statistics.fmean(scores), 6) if scores else 0.0


def is_cjk(char: str) -> bool:
    return (
        "\u4e00" <= char <= "\u9fff" or "\u3040" <= char <= "\u30ff" or "\uac00" <= char <= "\ud7af"
    )
