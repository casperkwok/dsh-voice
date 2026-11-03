"""Run the browser smoke turn N times and report latency percentiles.

Run: python3 spikes/phase0/browser-bench.py [runs]
"""
import json
import re
import statistics
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
WAV = HERE / "test-input-long.wav"
URL = "http://127.0.0.1:7799/"


def percentile(values, p):
    values = sorted(values)
    index = min(len(values) - 1, max(0, round((len(values) - 1) * p)))
    return values[index]


def main() -> int:
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    rows = []
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
        for i in range(runs):
            context = browser.new_context(permissions=["microphone"])
            page = context.new_page()
            page.goto(URL, wait_until="load")
            page.click("#start")
            deadline = time.time() + 30
            log_text = ""
            while time.time() < deadline:
                log_text = page.inner_text("#log")
                if "metrics" in log_text:
                    break
                page.wait_for_timeout(200)
            match = re.search(r"metrics (\{.*\})", log_text)
            if not match:
                print(f"run {i + 1}: no metrics")
                context.close()
                continue
            metrics = json.loads(match.group(1))
            rows.append(metrics)
            print(
                f"run {i + 1}: tts={metrics['ttsFirstChunkMs']}ms "
                f"perceived={metrics['lastSpeechToFirstChunkMs']}ms "
                f"vad={metrics['vadEndpointDelayMs']}ms"
            )
            context.close()
        browser.close()

    if not rows:
        return 1

    for key in ("ttsFirstChunkMs", "lastSpeechToFirstChunkMs", "vadEndpointDelayMs"):
        values = [row[key] for row in rows if row.get(key) is not None]
        print(
            f"{key}: n={len(values)} median={statistics.median(values):.0f}ms "
            f"p90={percentile(values, 0.9)}ms max={max(values)}ms"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
