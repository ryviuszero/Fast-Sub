from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", default="success")
    parser.add_argument("--request", required=True)
    parser.add_argument("--response", required=True)
    args = parser.parse_args()

    request = json.loads(Path(args.request).read_text(encoding="utf-8"))
    response_path = Path(args.response)

    if args.mode == "success":
        print('{"not": "a response channel"}')
        print("worker completed with utf-8 text: 完成", file=sys.stderr)
        response_path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "provider": "fake-stt",
                    "language": "en",
                    "elapsed_sec": 0.25,
                    "segments": [
                        {
                            "start_sec": 0.0,
                            "end_sec": 1.5,
                            "text": f"job {request['job_id']}",
                            "confidence": None,
                            "words": [],
                        }
                    ],
                    "warnings": [],
                }
            ),
            encoding="utf-8",
        )
        return 0

    if args.mode == "error-response":
        print("model path missing", file=sys.stderr)
        response_path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "error": {
                        "code": "MODEL_NOT_FOUND",
                        "message": "Model path does not exist.",
                        "retryable": False,
                        "details": {"model_path": request["model_path"]},
                        "stderr_tail": "",
                    },
                }
            ),
            encoding="utf-8",
        )
        return 2

    if args.mode == "exit-only":
        print("plain failure", file=sys.stderr)
        return 3

    if args.mode == "missing-response":
        print("no response today", file=sys.stderr)
        return 0

    if args.mode == "invalid-json":
        response_path.write_text("{not valid json", encoding="utf-8")
        return 0

    if args.mode == "invalid-schema":
        response_path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "provider": "fake-stt",
                    "segments": [{"start_sec": 0.0, "end_sec": 1.0, "text": "missing language"}],
                }
            ),
            encoding="utf-8",
        )
        return 0

    if args.mode == "timeout":
        print("starting slow work", file=sys.stderr)
        time.sleep(10)
        return 0

    raise SystemExit(f"unknown mode: {args.mode}")


if __name__ == "__main__":
    raise SystemExit(main())
