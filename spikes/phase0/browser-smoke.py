"""Phase 0 browser smoke test with a fake microphone.

Uses the installed Google Chrome, not Playwright's bundled Chromium. The fake
audio file has 1 second of silence, the test utterance, then 20 seconds of
silence, so the turn ends before the file loops.

Run: python3 spikes/phase0/browser-smoke.py
"""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
WAV = HERE / "test-input-long.wav"
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

        deadline = time.time() + 30
        final_text = "—"
        while time.time() < deadline:
            final_text = page.inner_text("#final")
            if final_text not in ("", "—"):
                break
            page.wait_for_timeout(200)

        page.wait_for_timeout(2000)
        result = {
            "final": final_text,
            "partial": page.inner_text("#partial"),
            "status": page.inner_text("#status"),
            "first": page.inner_text("#m-first"),
            "endpoint": page.inner_text("#m-end"),
            "turn": page.inner_text("#m-turn"),
            "log": page.inner_text("#log"),
            "console": console[-40:],
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        browser.close()

        ok = final_text not in ("", "—") and result["first"] not in ("", "—")
        print("[summary]", "PASS" if ok else "FAIL")
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
