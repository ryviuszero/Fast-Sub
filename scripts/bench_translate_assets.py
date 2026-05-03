from __future__ import annotations

import argparse
import gzip
import hashlib
import html
import io
import json
import random
import re
import tarfile
import textwrap
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

SCHEMA_VERSION = 1
SCRIPT_VERSION = 1
DEFAULT_ROOT = Path("local_tests") / "bench_translate"
DEFAULT_SEED = 20260503
CORE_DIRECTIONS = ("en-zh", "ja-zh", "ko-zh", "zh-en", "ja-en", "ko-en")
PROFILE_COUNTS = {"light": 50, "standard": 300}
PROFILE_SOURCES = {"light": "tatoeba", "standard": "iwslt_ted"}
TATOEBA_LANG_ALIASES = {
    "en": ("eng",),
    "zh": ("zho", "cmn_Hans"),
    "ja": ("jpn",),
    "ko": ("kor",),
}
IWSLT_LANG_FILES = {
    "en": "ted_en-20150530.zip",
    "zh": "ted_zh-cn-20150530.zip",
    "ja": "ted_ja-20150530.zip",
    "ko": "ted_ko-20150530.zip",
}
PROVIDERS_EXAMPLE = (
    {"id": "local-nllb-ct2", "model": "nllb-200-distilled-600m-ct2-int8"},
    {"id": "web-bing"},
)


@dataclass(frozen=True)
class ParallelItem:
    source: str
    reference: str
    source_id: str
    source_dataset: str
    license: str
    redistributable: bool
    raw_member: str


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepare local Fast Sub translation benchmark SRT/TXT samples.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("inspect", "prepare", "verify"):
        command = subparsers.add_parser(name)
        command.add_argument("--root", type=Path, default=DEFAULT_ROOT)
        command.add_argument("--profile", choices=["light", "standard", "all"], default="all")
        command.add_argument("--count", type=int, default=None)
        command.add_argument("--seed", type=int, default=DEFAULT_SEED)
        command.add_argument("--overwrite", action="store_true")
        command.add_argument("--json", action="store_true", dest="json_output")
    args = parser.parse_args()

    if args.command == "inspect":
        payload = inspect_raw(args.root)
    elif args.command == "prepare":
        payload = prepare_profiles(
            args.root,
            profile=args.profile,
            count=args.count,
            seed=args.seed,
            overwrite=args.overwrite,
        )
    else:
        payload = verify_profiles(args.root, profile=args.profile)

    if args.json_output:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_human(payload)
    if not payload.get("ok", False):
        raise SystemExit(1)


def inspect_raw(root: Path) -> dict[str, Any]:
    raw = root / "raw"
    tatoeba = raw / "tatoeba" / "test.tar"
    iwslt = raw / "iwslt_ted" / "XML_releases.tgz"
    payload: dict[str, Any] = {
        "ok": True,
        "schema_version": SCHEMA_VERSION,
        "command": "inspect",
        "root": root.as_posix(),
        "raw": {
            "tatoeba": _file_info(tatoeba),
            "iwslt_ted": _file_info(iwslt),
        },
        "directions": {},
        "warnings": [],
    }
    for direction in CORE_DIRECTIONS:
        source, target = direction.split("-")
        payload["directions"][direction] = {
            "tatoeba_available": bool(_find_tatoeba_member(tatoeba, source, target))
            if tatoeba.exists()
            else False,
            "iwslt_ted_available": _iwslt_language_available(iwslt, source)
            and _iwslt_language_available(iwslt, target)
            if iwslt.exists()
            else False,
        }
    if not tatoeba.exists() and not iwslt.exists():
        payload["ok"] = False
        payload["warnings"].append("No raw translation benchmark archives found.")
    return payload


def prepare_profiles(
    root: Path,
    *,
    profile: str,
    count: int | None,
    seed: int,
    overwrite: bool,
) -> dict[str, Any]:
    profiles = ("light", "standard") if profile == "all" else (profile,)
    items = []
    warnings = []
    for profile_name in profiles:
        profile_count = count or PROFILE_COUNTS[profile_name]
        for direction in CORE_DIRECTIONS:
            source, target = direction.split("-")
            try:
                item = prepare_direction(
                    root,
                    profile=profile_name,
                    source_lang=source,
                    target_lang=target,
                    count=profile_count,
                    seed=seed,
                    overwrite=overwrite,
                )
                items.append(item)
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"{profile_name}/{direction}: {exc}")
    return {
        "ok": not warnings,
        "schema_version": SCHEMA_VERSION,
        "command": "prepare",
        "root": root.as_posix(),
        "items": items,
        "warnings": warnings,
    }


def prepare_direction(
    root: Path,
    *,
    profile: str,
    source_lang: str,
    target_lang: str,
    count: int,
    seed: int,
    overwrite: bool,
) -> dict[str, Any]:
    pairs = load_pairs_for_profile(
        root,
        profile=profile,
        source_lang=source_lang,
        target_lang=target_lang,
    )
    filtered = filter_pairs(pairs)
    selected = stable_sample(
        filtered,
        count=count,
        seed=seed,
        key=f"{profile}:{source_lang}-{target_lang}",
    )
    if not selected:
        raise RuntimeError("No usable sentence pairs found.")

    out_dir = root / "datasets" / profile
    manifest_dir = root / "manifests"
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_dir.mkdir(parents=True, exist_ok=True)
    prefix = f"{source_lang}-{target_lang}.sample-{len(selected)}"
    source_srt = out_dir / f"{prefix}.source.srt"
    reference_srt = out_dir / f"{prefix}.reference.srt"
    reference_txt = out_dir / f"{prefix}.reference.txt"
    metadata_path = out_dir / f"{prefix}.metadata.json"
    for path in (source_srt, reference_srt, reference_txt, metadata_path):
        if path.exists() and not overwrite:
            raise RuntimeError(f"Output exists; pass --overwrite: {path}")

    source_srt.write_text(
        render_srt([item.source for item in selected]),
        encoding="utf-8",
        newline="\n",
    )
    reference_srt.write_text(
        render_srt([item.reference for item in selected]),
        encoding="utf-8",
        newline="\n",
    )
    reference_txt.write_text(
        "\n".join(item.reference for item in selected) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    source_ids = [item.source_id for item in selected]
    raw_members = sorted({item.raw_member for item in selected})
    metadata = {
        "schema_version": SCHEMA_VERSION,
        "script_version": SCRIPT_VERSION,
        "profile": profile,
        "direction": f"{source_lang}-{target_lang}",
        "count": len(selected),
        "sample_seed": seed,
        "sample_ids": source_ids,
        "sample_hash": hashlib.sha256("\n".join(source_ids).encode("utf-8")).hexdigest(),
        "source_dataset": selected[0].source_dataset,
        "license": selected[0].license,
        "redistributable": selected[0].redistributable,
        "synthetic_timing": True,
        "cue_duration_sec": 3,
        "raw_members": raw_members,
        "created_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    sample_entry = {
        "id": f"{source_lang}-{target_lang}-{profile}-sample-{len(selected)}",
        "source_subtitle_path": source_srt.as_posix(),
        "reference_translation_path": reference_srt.as_posix(),
        "reference_translation_txt_path": reference_txt.as_posix(),
        "source_language": source_lang,
        "target_language": target_lang,
        "profile": profile,
        "domain": "talks" if selected[0].source_dataset.startswith("IWSLT") else "sentences",
        "source_dataset": selected[0].source_dataset,
        "license": selected[0].license,
        "redistributable": selected[0].redistributable,
        "synthetic_timing": True,
        "sample_seed": seed,
        "sample_hash": metadata["sample_hash"],
        "source_sha256": sha256_file(source_srt),
        "reference_sha256": sha256_file(reference_srt),
        "reference_txt_sha256": sha256_file(reference_txt),
        "metadata_path": metadata_path.as_posix(),
        "target_metrics": ["bleu", "chrf", "exact_match_rate", "elapsed_sec"],
    }
    update_manifest(root, profile=profile, sample_entry=sample_entry)
    return sample_entry


def load_pairs_for_profile(
    root: Path,
    *,
    profile: str,
    source_lang: str,
    target_lang: str,
) -> list[ParallelItem]:
    source = PROFILE_SOURCES[profile]
    if source == "iwslt_ted":
        try:
            pairs = load_iwslt_pairs(root, source_lang=source_lang, target_lang=target_lang)
            if len(pairs) >= PROFILE_COUNTS["light"]:
                return pairs
        except Exception:
            pass
    return load_tatoeba_pairs(root, source_lang=source_lang, target_lang=target_lang)


def load_tatoeba_pairs(root: Path, *, source_lang: str, target_lang: str) -> list[ParallelItem]:
    archive_path = root / "raw" / "tatoeba" / "test.tar"
    found = _find_tatoeba_member(archive_path, source_lang, target_lang)
    if found is None:
        raise RuntimeError(f"Tatoeba pair unavailable: {source_lang}-{target_lang}")
    member_name, _left_lang, _right_lang = found
    items: list[ParallelItem] = []
    with tarfile.open(archive_path, "r:*") as archive:
        member = archive.getmember(member_name)
        stream = archive.extractfile(member)
        if stream is None:
            raise RuntimeError(f"Could not read {member_name}")
        text = gzip.decompress(stream.read()).decode("utf-8", errors="replace")
    for index, line in enumerate(text.splitlines(), start=1):
        parts = line.split("\t")
        if len(parts) < 4:
            continue
        lang_a, lang_b, text_a, text_b = parts[:4]
        if _lang_matches(lang_a, source_lang) and _lang_matches(lang_b, target_lang):
            source, reference = text_a, text_b
        elif _lang_matches(lang_a, target_lang) and _lang_matches(lang_b, source_lang):
            source, reference = text_b, text_a
        else:
            continue
        items.append(
            ParallelItem(
                source=clean_text(source),
                reference=clean_text(reference),
                source_id=f"{member_name}:{index}",
                source_dataset="Tatoeba Challenge test",
                license="CC BY 2.0 / see upstream Tatoeba Challenge metadata",
                redistributable=True,
                raw_member=member_name,
            )
        )
    return items


def load_iwslt_pairs(root: Path, *, source_lang: str, target_lang: str) -> list[ParallelItem]:
    archive_path = root / "raw" / "iwslt_ted" / "XML_releases.tgz"
    source_docs = load_iwslt_language_docs(archive_path, source_lang)
    target_docs = load_iwslt_language_docs(archive_path, target_lang)
    items: list[ParallelItem] = []
    for talk_id in sorted(set(source_docs) & set(target_docs)):
        source_lines = source_docs[talk_id]
        target_lines = target_docs[talk_id]
        paired_lines = zip(source_lines, target_lines, strict=False)
        for index, (source, reference) in enumerate(paired_lines, start=1):
            items.append(
                ParallelItem(
                    source=clean_text(source),
                    reference=clean_text(reference),
                    source_id=f"iwslt:{talk_id}:{index}",
                    source_dataset="IWSLT/TED XML releases",
                    license="CC BY-NC-ND / see TED and IWSLT upstream terms",
                    redistributable=False,
                    raw_member=f"{IWSLT_LANG_FILES[source_lang]}+{IWSLT_LANG_FILES[target_lang]}",
                )
            )
    return items


def load_iwslt_language_docs(archive_path: Path, language: str) -> dict[str, list[str]]:
    zip_suffix = IWSLT_LANG_FILES[language]
    with tarfile.open(archive_path, "r:*") as archive:
        members = [
            member
            for member in archive.getmembers()
            if member.isfile() and member.name.endswith(zip_suffix) and "/._" not in member.name
        ]
        if not members:
            raise RuntimeError(f"IWSLT language archive missing: {language}")
        stream = archive.extractfile(members[0])
        if stream is None:
            raise RuntimeError(f"Could not read {members[0].name}")
        zip_bytes = stream.read()
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        xml_name = next(name for name in zf.namelist() if name.endswith(".xml"))
        root = ElementTree.fromstring(zf.read(xml_name))
    docs: dict[str, list[str]] = {}
    for file_node in root.findall("file"):
        head = file_node.find("head")
        talk_id_node = head.find("talkid") if head is not None else None
        content_node = file_node.find("content")
        if talk_id_node is None or content_node is None or not content_node.text:
            continue
        talk_id = clean_text(talk_id_node.text)
        lines = [clean_text(line) for line in content_node.text.splitlines()]
        lines = [line for line in lines if line]
        if lines:
            docs[talk_id] = lines
    return docs


def filter_pairs(items: list[ParallelItem]) -> list[ParallelItem]:
    seen: set[tuple[str, str]] = set()
    filtered: list[ParallelItem] = []
    for item in items:
        source = clean_text(item.source)
        reference = clean_text(item.reference)
        if not source or not reference:
            continue
        if len(source) < 3 or len(reference) < 2:
            continue
        if len(source) > 260 or len(reference) > 260:
            continue
        key = (source, reference)
        if key in seen:
            continue
        seen.add(key)
        filtered.append(
            ParallelItem(
                source=source,
                reference=reference,
                source_id=item.source_id,
                source_dataset=item.source_dataset,
                license=item.license,
                redistributable=item.redistributable,
                raw_member=item.raw_member,
            )
        )
    return filtered


def stable_sample(
    items: list[ParallelItem],
    *,
    count: int,
    seed: int,
    key: str,
) -> list[ParallelItem]:
    rng = random.Random(f"{seed}:{key}")
    shuffled = list(items)
    rng.shuffle(shuffled)
    selected = shuffled[: min(count, len(shuffled))]
    return sorted(selected, key=lambda item: item.source_id)


def render_srt(texts: list[str]) -> str:
    blocks = []
    for index, text in enumerate(texts, start=1):
        start_sec = (index - 1) * 3
        end_sec = index * 3
        blocks.append(
            "\n".join(
                [
                    str(index),
                    f"{_srt_timestamp(start_sec)} --> {_srt_timestamp(end_sec)}",
                    wrap_subtitle_text(text),
                ]
            )
        )
    return "\n\n".join(blocks) + "\n"


def wrap_subtitle_text(text: str) -> str:
    has_cjk = any(
        "\u4e00" <= char <= "\u9fff" or "\u3040" <= char <= "\u30ff" or "\uac00" <= char <= "\ud7af"
        for char in text
    )
    if has_cjk:
        return text
    return "\n".join(textwrap.wrap(text, width=60, break_long_words=False)) or text


def update_manifest(root: Path, *, profile: str, sample_entry: dict[str, Any]) -> None:
    path = root / "manifests" / f"{profile}.json"
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
    else:
        payload = {
            "schema_version": SCHEMA_VERSION,
            "kind": "fast_sub_bench_translate_manifest",
            "script_version": SCRIPT_VERSION,
            "profile": profile,
            "providers": list(PROVIDERS_EXAMPLE),
            "samples": [],
            "notes": [
                "Generated from local raw archives only; no network access.",
                "Do not commit generated samples, references, manifests, or reports.",
            ],
        }
    samples = [item for item in payload.get("samples", []) if item.get("id") != sample_entry["id"]]
    samples.append(sample_entry)
    payload["samples"] = sorted(samples, key=lambda item: item["id"])
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def verify_profiles(root: Path, *, profile: str) -> dict[str, Any]:
    profiles = ("light", "standard") if profile == "all" else (profile,)
    items = []
    ok = True
    for profile_name in profiles:
        manifest_path = root / "manifests" / f"{profile_name}.json"
        if not manifest_path.exists():
            ok = False
            items.append({"profile": profile_name, "status": "missing_manifest"})
            continue
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        for sample in payload.get("samples", []):
            status = verify_sample(sample)
            ok = ok and status["status"] == "ready"
            items.append(status)
    return {
        "ok": ok,
        "schema_version": SCHEMA_VERSION,
        "command": "verify",
        "items": items,
        "warnings": [],
    }


def verify_sample(sample: dict[str, Any]) -> dict[str, Any]:
    paths = [
        Path(sample["source_subtitle_path"]),
        Path(sample["reference_translation_path"]),
        Path(sample["reference_translation_txt_path"]),
        Path(sample["metadata_path"]),
    ]
    missing = [path.as_posix() for path in paths if not path.exists()]
    if missing:
        return {"id": sample["id"], "status": "missing", "missing": missing}
    mismatches = []
    if sha256_file(paths[0]) != sample.get("source_sha256"):
        mismatches.append(paths[0].as_posix())
    if sha256_file(paths[1]) != sample.get("reference_sha256"):
        mismatches.append(paths[1].as_posix())
    if sha256_file(paths[2]) != sample.get("reference_txt_sha256"):
        mismatches.append(paths[2].as_posix())
    if mismatches:
        return {"id": sample["id"], "status": "checksum_mismatch", "mismatches": mismatches}
    source_cues = count_srt_cues(paths[0])
    reference_cues = count_srt_cues(paths[1])
    if source_cues != reference_cues:
        return {
            "id": sample["id"],
            "status": "cue_count_mismatch",
            "source_cues": source_cues,
            "reference_cues": reference_cues,
        }
    return {
        "id": sample["id"],
        "status": "ready",
        "source_cues": source_cues,
        "reference_cues": reference_cues,
        "sample_hash": sample.get("sample_hash"),
    }


def _find_tatoeba_member(
    archive_path: Path,
    source_lang: str,
    target_lang: str,
) -> tuple[str, str, str] | None:
    if not archive_path.exists():
        return None
    candidates = []
    with tarfile.open(archive_path, "r:*") as archive:
        for member in archive.getmembers():
            if not member.isfile() or not member.name.endswith(".txt.gz"):
                continue
            match = re.search(r"tatoeba-test-(v[0-9-]+)\.([^.]+)-([^.]+)\.txt\.gz$", member.name)
            if not match:
                continue
            version, left, right = match.groups()
            if (_lang_matches(left, source_lang) and _lang_matches(right, target_lang)) or (
                _lang_matches(left, target_lang) and _lang_matches(right, source_lang)
            ):
                candidates.append((version, member.name, left, right))
    if not candidates:
        return None
    _, name, left, right = sorted(candidates, reverse=True)[0]
    return name, left, right


def count_srt_cues(path: Path) -> int:
    count = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip().isdigit():
            count += 1
    return count


def _iwslt_language_available(archive_path: Path, language: str) -> bool:
    if not archive_path.exists():
        return False
    suffix = IWSLT_LANG_FILES[language]
    with tarfile.open(archive_path, "r:*") as archive:
        return any(
            member.isfile() and member.name.endswith(suffix) and "/._" not in member.name
            for member in archive.getmembers()
        )


def _lang_matches(tatoeba_lang: str, target: str) -> bool:
    return any(
        tatoeba_lang == alias or tatoeba_lang.startswith(f"{alias}_")
        for alias in TATOEBA_LANG_ALIASES[target]
    )


def clean_text(text: str) -> str:
    text = html.unescape(text or "")
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("\\N", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _srt_timestamp(seconds: int) -> str:
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    sec = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{sec:02d},000"


def _file_info(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"exists": False, "path": path.as_posix()}
    return {
        "exists": True,
        "path": path.as_posix(),
        "size_bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def print_human(payload: dict[str, Any]) -> None:
    print(f"{payload.get('command')}: {'ok' if payload.get('ok') else 'failed'}")
    for warning in payload.get("warnings", []):
        print(f"warning: {warning}")
    for item in payload.get("items", []):
        if "id" in item:
            print(f"{item['id']}\t{item.get('status', 'prepared')}")
        elif "source_subtitle_path" in item:
            print(item["source_subtitle_path"])
    if payload.get("directions"):
        for direction, status in payload["directions"].items():
            print(
                f"{direction}\ttatoeba={status['tatoeba_available']}\tiwslt={status['iwslt_ted_available']}"
            )


if __name__ == "__main__":
    main()
