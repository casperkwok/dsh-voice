"""Phase 0 browser barge-in test with a fake microphone.

The fake audio has a second utterance starting at 8.88s, while the first reply
is still playing. The page log must contain "检测到打断".

Run: python3 spikes/phase0/browser-barge.py
"""
import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
WAV = HERE / "test-input-barge.wav"
URL = "http://127.0.0.1:7799/"


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome",
            headless=True,
            args=[
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                f"--use-file-for-fake-audio-capture={WAV}",
                "--autoplay-policy=no-user-gesture-required",
            ],
        )
        context = browser.new_context(permissions=["microphone"])
        page = context.new_page()
        console = []
        page.on("console", lambda msg: console.append(f"{msg.type}: {msg.text}"))
        page.on("pageerror", lambda err: console.append(f"pageerror: {err}"))

        page.goto(URL, wait_until="load")
        page.click("#start")

        deadline = time.time() + 35
        barge_detected = False
        while time.time() < deadline:
            if "检测到打断" in page.inner_text("#log"):
                barge_detected = True
                break
            page.wait_for_timeout(200)

        log_text = page.inner_text("#log")
        match = re.search(r"开口到停止 (\d+)ms", log_text)
        stop_latency = int(match.group(1)) if match else None
        result = {
            "barge_detected": barge_detected,
            "barge_stop_ms_from_speech_start": stop_latency,
            "status": page.inner_text("#status"),
            "final": page.inner_text("#final"),
            "log": log_text,
            "console": console[-40:],
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        browser.close()
        ok = barge_detected and stop_latency is not None and stop_latency <= 300
        print("[summary]", "PASS" if ok else "FAIL", f"stop={stop_latency}ms")
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
