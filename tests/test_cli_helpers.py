from __future__ import annotations

from fast_sub.cli.helpers import echo_json


def test_echo_json_writes_non_ascii_as_utf8(capfd) -> None:
    echo_json({"message": "中文 � ok"})

    out, err = capfd.readouterr()
    assert err == ""
    assert '"message": "中文 � ok"' in out
