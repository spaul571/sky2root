"""Render demo/video.html to the 30-second demo video, with a voice-over and English captions.

    uv run --with playwright --with imageio-ffmpeg --with kokoro-onnx --with soundfile python demo/tools/render_video.py
    ... render_video.py --recordings path/to/folder   # a teammate's own voice: one file per line, see below
    ... render_video.py --voice bf_alice              # another Kokoro voice
    ... render_video.py --cut local                   # the 240-second local judging video (Bangladesh)

Each scene is fitted to its spoken line. The 30-second cut stays under 30 seconds, as Space Apps requires; the local
cut takes its natural length and must stay under 240 seconds, as the Bangladesh Local Events require.

Without --recordings the voice is Kokoro, an open-weight text-to-speech model (Apache-2.0) run on this computer.
That is SI-generated audio, which Space Apps asks to be stated in text and metadata: the MP4 metadata says so, and
so must the YouTube description. With --recordings the folder holds one recording per line, named after the scene
(intro, problem, title, ask, replay, result; any format ffmpeg reads, such as .m4a from a phone).

The team scene uses the portraits in presentation/assets/team/, which stay off GitHub.

Writes, in demo/video/ (not in git: upload the MP4 to YouTube). The captions are burned into the picture.
    Sky2Root-demo-30s.mp4         the demo, with voice and captions
    Sky2Root-demo-30s-silent.mp4  the same without sound
    Sky2Root-local-240s*.mp4      the same two for --cut local
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

import imageio_ffmpeg
import numpy as np
import soundfile as sf
from playwright.sync_api import sync_playwright

DEMO = Path(__file__).resolve().parents[1]
OUT = DEMO / "video"
NAME = "Sky2Root-demo-30s"
MODEL_DIRS = [DEMO.parent / "presentation" / ".cache" / "kokoro", DEMO / ".cache" / "kokoro"]  # reuse the pitch's copy
RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
MODEL_FILES = ["kokoro-v1.0.onnx", "voices-v1.0.bin"]
SPEED, MAX_SPEED, RATE = 1.1, 1.25, 24_000
LEAD, TAIL, FPS = 0.35, 0.3, 30  # seconds before and after each line
CUTS = {"short": ("Sky2Root-demo-30s", 29.5, "30-second demo"), "local": ("Sky2Root-local-240s", 235, "240-second local judging video")}
LIMIT = 29.5  # set from the cut in main()
CREDIT = "Made with help from an SI assistant (Claude Code). Screens are from the working Sky2Root app; satellite pictures are NASA HLS through NASA GIBS."


def ffmpeg() -> str:
    return shutil.which("ffmpeg") or imageio_ffmpeg.get_ffmpeg_exe()


def tidy(samples: np.ndarray) -> np.ndarray:
    """Even out the level, drop the silence around the line and soften its ends."""
    samples = np.asarray(samples, dtype=np.float32)
    samples = samples * (0.9 / (float(np.max(np.abs(samples))) or 1))
    loud = np.flatnonzero(np.abs(samples) > 0.015)
    if loud.size:
        samples = samples[max(0, loud[0] - int(0.06 * RATE)): loud[-1] + int(0.12 * RATE)]
    n = min(len(samples) // 2, int(0.015 * RATE))
    if n:
        ramp = np.linspace(0, 1, n, dtype=np.float32)
        samples[:n] *= ramp
        samples[-n:] *= ramp[::-1]
    return samples


def tts():
    from kokoro_onnx import Kokoro

    folder = next((d for d in MODEL_DIRS if all((d / f).exists() for f in MODEL_FILES)), MODEL_DIRS[-1])
    folder.mkdir(parents=True, exist_ok=True)
    for name in MODEL_FILES:
        if not (folder / name).exists():
            print(f"Downloading {name} (once) ...", flush=True)
            urllib.request.urlretrieve(RELEASE + name, folder / (name + ".part"))
            (folder / (name + ".part")).replace(folder / name)
    return Kokoro(str(folder / MODEL_FILES[0]), str(folder / MODEL_FILES[1]))


def speak(model, text: str, voice: str, speed: float) -> np.ndarray:
    samples, rate = model.create(text, voice=voice, speed=speed, lang="en-us")
    if rate != RATE:
        sys.exit(f"Unexpected sample rate {rate}")
    return tidy(samples)


def recorded(folder: Path, scene: str) -> np.ndarray:
    files = sorted(folder.glob(f"{scene}.*"))
    if not files:
        sys.exit(f"No recording for '{scene}' in {folder} (expected {scene}.m4a, .wav, .mp3, .mp4 ...)")
    # Clean only: cut rumble below 70 Hz and reduce steady background noise. Speed and pitch stay as recorded.
    clean = ["-af", "highpass=f=70,afftdn=nf=-70:nr=10:tn=1"]
    raw = subprocess.run([ffmpeg(), "-v", "error", "-i", str(files[0]), "-map", "0:a:0", *clean, "-f", "f32le", "-ac", "1", "-ar", str(RATE), "-"], capture_output=True, check=True).stdout
    return tidy(np.frombuffer(raw, dtype=np.float32))


def needs(clips: list, scenes: list[dict]) -> list[float]:
    return [max(LEAD + len(c) / RATE + TAIL, s.get("min", 0)) + s.get("extra", 0) if c is not None else float(s.get("hold", 2)) for c, s in zip(clips, scenes)]


def voice_over(scenes: list[dict], voice: str, recordings: Path | None) -> tuple[list, list[float], str]:
    """One clip per spoken scene, the time each scene needs, and a line saying where the voice came from."""
    if recordings:
        clips = [recorded(recordings, s["id"]) if s["speak"] else None for s in scenes]
        need = needs(clips, scenes)
        spare = sum(s.get("extra", 0) for s in scenes)
        if sum(need) > LIMIT and spare:  # never speed up a person's voice: shorten the pauses between lines instead
            keep = max(0.0, 1 - (sum(need) - LIMIT) / spare)
            for s in scenes:
                s["extra"] = s.get("extra", 0) * keep
            need = needs(clips, scenes)
            print(f"Pauses after lines cut to {keep:.0%} to fit")
        if sum(need) > LIMIT:
            report = ", ".join(f"{s['id']} {len(c) / RATE:.1f}s" for s, c in zip(scenes, clips) if c is not None)
            sys.exit(f"The recordings need {sum(need):.1f} s, over the {LIMIT} s limit. Lines: {report}. Shorten or re-record the longest ones.")
        return clips, need, "Voice: recorded by Team Groot."
    model, speed = tts(), SPEED
    while True:
        clips = [speak(model, s["speak"], voice, speed) if s["speak"] else None for s in scenes]
        need = needs(clips, scenes)
        if sum(need) <= LIMIT:
            print(f"Voice {voice} at speed {speed}")
            return clips, need, f"Voice: AI text-to-speech (Kokoro, voice {voice})."
        if speed >= MAX_SPEED:
            sys.exit(f"The lines need {sum(need):.1f} s even at speed {speed}: shorten them in video.html")
        speed = round(speed + 0.05, 2)


def render(page, duration: float, path: Path) -> None:
    command = [ffmpeg(), "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg", "-i", "-",
               "-vf", "scale=in_range=full:out_range=tv,format=yuv420p", "-color_range", "tv",
               "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-movflags", "+faststart", str(path)]
    encoder = subprocess.Popen(command, stdin=subprocess.PIPE)
    frames = int(duration * FPS)  # rounded down, so the video never runs over
    for i in range(frames):
        page.evaluate("t => { DEMO.seek(t); return new Promise(r => requestAnimationFrame(() => r())); }", i / FPS)
        encoder.stdin.write(page.screenshot(type="jpeg", quality=92))
    encoder.stdin.close()
    if encoder.wait():
        sys.exit("ffmpeg could not write the video")


def stamp(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--voice", default="af_heart", help="Kokoro voice (default af_heart)")
    parser.add_argument("--recordings", type=Path, help="folder with one recording per line, named after the scene")
    parser.add_argument("--cut", choices=list(CUTS), default="short", help="short: the 30-second demo; local: the 240-second local judging video")
    args = parser.parse_args()
    global NAME, LIMIT
    NAME, LIMIT, title = CUTS[args.cut]
    OUT.mkdir(exist_ok=True)
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", args=["--force-device-scale-factor=1"])
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("requestfailed", lambda r: errors.append(f"missing {r.url}"))
        page.goto((DEMO / "video.html").as_uri() + f"?cut={args.cut}")
        page.wait_for_function("window.DEMO && DEMO.ready === true", timeout=60_000)
        if errors:
            sys.exit("\n".join(errors))
        scenes = page.evaluate("DEMO.scenes")
        clips, need, source = voice_over(scenes, args.voice, args.recordings)
        spare, talk = LIMIT - sum(need), sum(n for n, c in zip(need, clips) if c is not None)
        if args.cut == "local":
            spare = 0  # the long cut keeps its natural pace
        durations = [round(n + (spare * n / talk if c is not None else 0), 3) for n, c in zip(need, clips)]
        print("Scenes: " + ", ".join(f"{s['id']} {d:.1f}s" for s, d in zip(scenes, durations)))
        page.evaluate("([d, s]) => DEMO.setDurations(d, s)", [durations, [len(c) / RATE if c is not None else 0 for c in clips]])
        total = page.evaluate("DEMO.duration")
        silent = OUT / f"{NAME}-silent.mp4"
        render(page, total, silent)
        browser.close()

    starts = np.cumsum([0.0] + durations[:-1])
    track = np.zeros(int(total * RATE), dtype=np.float32)
    captions = []
    for start, clip, scene in zip(starts, clips, scenes):
        if clip is None:
            continue
        begin = int((start + LEAD) * RATE)
        track[begin: begin + len(clip)] += clip[: len(track) - begin]
        parts = scene["say"].split("|")  # chunks, timed by their share of the letters, as on screen
        total, said = len("".join(parts)) or 1, 0
        for part in parts:
            a = start + LEAD + len(clip) / RATE * said / total
            said += len(part)
            b = start + LEAD + len(clip) / RATE * said / total
            captions.append((a - 0.05, b + 0.2, part))
    wav = OUT / f"{NAME}-voice.wav"
    sf.write(wav, track * (0.89 / (float(np.max(np.abs(track))) or 1)), RATE)

    meta = f"{source} {CREDIT}"
    video = OUT / f"{NAME}.mp4"
    subprocess.run([ffmpeg(), "-y", "-loglevel", "error", "-i", str(silent), "-i", str(wav), "-map", "0:v:0", "-map", "1:a:0",
                    "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k",
                    "-shortest", "-movflags", "+faststart", "-metadata", f"title=Sky2Root: {title}",
                    "-metadata", "artist=Team Groot", "-metadata", f"comment={meta}", "-metadata", f"description={meta}", str(video)],
                   check=True)
    wav.unlink()

    seconds = imageio_ffmpeg.count_frames_and_secs(str(video))[1]
    if seconds > LIMIT + 0.5:
        sys.exit(f"{video.name} lasts {seconds:.2f} s; the limit is {LIMIT + 0.5:.0f} s")
    print(f"Wrote {video.relative_to(DEMO.parent)} ({seconds:.2f} s) and the silent copy. {source}")


if __name__ == "__main__":
    main()
