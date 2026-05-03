from pathlib import Path

from fast_sub.models import Mode
from fast_sub.output.paths import default_output_path, model_cache_dir


def test_default_output_path_for_bilingual() -> None:
    path = default_output_path(Path("video.mp4"), Mode.BILINGUAL, "en", "zh")

    assert path == Path("video.en-zh.bilingual.srt")


def test_default_output_path_for_translated() -> None:
    path = default_output_path(Path("video.mp4"), Mode.TRANSLATED, "en", "zh")

    assert path == Path("video.zh.srt")


def test_default_output_path_for_audio_input() -> None:
    path = default_output_path(Path("speech.wav"), Mode.ORIGINAL, "en", "zh")

    assert path == Path("speech.en.srt")


def test_default_output_path_for_windows_unc_path() -> None:
    path = Path(r"\\NAS\data\others\资料\others\sample-user\1\video.mp4")

    assert default_output_path(path, Mode.ORIGINAL, "auto", "zh") == (
        path.parent / "video.auto.srt"
    )


def test_model_cache_dir_uses_single_app_directory(monkeypatch) -> None:
    calls = []

    def fake_user_data_dir(appname, appauthor=None):
        calls.append((appname, appauthor))
        assert appauthor is False
        return str(Path("AppData") / "Local" / appname)

    monkeypatch.setattr(
        "fast_sub.output.paths.user_data_dir",
        fake_user_data_dir,
    )

    assert model_cache_dir() == Path("AppData") / "Local" / "FastSub" / "models"
    assert calls == [("FastSub", False)]
