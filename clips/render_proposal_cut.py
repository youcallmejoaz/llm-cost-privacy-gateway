"""Renders clips/proposal_cut.mp4 from the Phase 3 clips and a local TTS voiceover.

    KOKORO_DIR=/path/with/kokoro-v1.0.onnx+voices-v1.0.bin python clips/render_proposal_cut.py

Voice: Kokoro (open weights, Apache 2.0), voice am_michael (fallback am_adam), speed 1.0.
If Kokoro is not installed, it tries Piper (en_US-ryan-high, fallback en_US-lessac-medium, PIPER_DIR).
If no voice can be generated, the cut is rendered silent. Paid TTS is never used.
No captions or subtitles are ever drawn. ffmpeg only.
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = HERE / "raw" / "cut"
OUT = HERE / "proposal_cut.mp4"
FPS = 30

# (scene, [(clip file, in point seconds, share of the scene)], narration)
SCENES = [
    (1, [("K01_problem.mp4", 0.0, 1.0)], "If your company uses AI in several places, the bills grow every month, and personal data is going out to more than one vendor."),
    (2, [("C01_client_burst.mp4", 0.6, 0.45), ("C02_dashboard_spend.mp4", 0.8, 0.55)], "This gateway sits between your apps and the AI providers. Your apps change one setting, and every request now goes through it."),
    (3, [("C03_CLOSE_routed_small_saving.mp4", 0.2, 0.45), ("C04_cache_hit.mp4", 2.2, 0.55)], "Simple jobs go to cheaper models, repeated questions come from cache, and you can see the savings per team."),
    (4, [("C05_redaction_view.mp4", 2.0, 1.0)], "Personal details like card numbers and emails are removed before anything leaves, and put back in the answer."),
    (5, [("C06_budget_429.mp4", 0.6, 1.0)], "Each team gets a budget, and it is enforced before money is spent."),
    (6, [("C07_provider_outage.mp4", 3.0, 1.0)], "And if a provider goes down, requests switch to another one, so your apps keep working."),
    (7, [("K04_pilot.mp4", 0.0, 1.0)], "If you want control over your AI spend and data, reply to this proposal, and we can map it to your setup."),
]
CROSSFADE = 0.3  # card to UI, scene 1 into scene 2 only
PAD = 0.5
MAX_BREATHE = 1.5


def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def tts_kokoro(texts):
    from kokoro_onnx import Kokoro
    import soundfile as sf

    d = Path(os.environ.get("KOKORO_DIR", HERE / ".tts"))
    k = Kokoro(str(d / "kokoro-v1.0.onnx"), str(d / "voices-v1.0.bin"))
    voices = k.get_voices() if hasattr(k, "get_voices") else ["am_michael", "am_adam"]
    voice = "am_michael" if "am_michael" in voices else "am_adam"
    paths = []
    for i, text in enumerate(texts, 1):
        samples, sr = k.create(text, voice=voice, speed=1.0, lang="en-us")
        p = WORK / f"vo_{i}.wav"
        sf.write(str(p), samples, sr)
        paths.append(p)
    return f"Kokoro TTS ({voice}, speed 1.0)", paths


def tts_piper(texts):
    d = Path(os.environ.get("PIPER_DIR", HERE / ".tts"))
    model = next((d / f"{m}.onnx" for m in ["en_US-ryan-high", "en_US-lessac-medium"] if (d / f"{m}.onnx").exists()), None)
    if not model or not shutil.which("piper"):
        raise RuntimeError("piper not available")
    paths = []
    for i, text in enumerate(texts, 1):
        p = WORK / f"vo_{i}.wav"
        subprocess.run(["piper", "--model", str(model), "--output_file", str(p)], input=text, text=True, check=True, capture_output=True)
        paths.append(p)
    return f"Piper TTS ({model.stem})", paths


def make_voice(texts):
    for engine in (tts_kokoro, tts_piper):
        try:
            return engine(texts)
        except Exception as err:  # fall through to the next free engine
            print(f"{engine.__name__} failed: {err}", file=sys.stderr)
    return None, None


def segment(clip, start, length, out, push_in):
    """Trim a clip (or hold its last frame) to an exact length. Never speeds footage up."""
    src = HERE / clip
    avail = max(0.0, duration(src) - start)
    vf = [f"trim=start={start:.3f}", "setpts=PTS-STARTPTS"]
    if avail < length:
        vf.append(f"tpad=stop_mode=clone:stop_duration={length - avail + 0.1:.3f}")
    vf.append(f"trim=duration={length:.3f}")
    if push_in:
        frames = int(round(length * FPS))
        # 5 percent slow push in, rendered from a 2x upscale so the motion stays smooth.
        vf += ["scale=3840:2160:flags=lanczos", f"zoompan=z='1+0.05*on/{frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps={FPS}"]
    vf += [f"fps={FPS}", "format=yuv420p"]
    run("ffmpeg", "-y", "-i", str(src), "-vf", ",".join(vf), "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", str(FPS), str(out))


def main():
    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True)
    texts = [s[2] for s in SCENES]
    engine, wavs = make_voice(texts)

    if wavs:
        slots = [duration(w) + PAD for w in wavs]
    else:
        engine = "silent (no free voice engine available)"
        slots = [len(t.split()) / 2.4 + PAD for t in texts]  # calm reading pace

    # Let the UI shots breathe if the cut would be under 60 seconds.
    total = sum(slots)
    if total < 60:
        extra = min(MAX_BREATHE, (60.5 - total) / 5)
        for i in range(1, 6):
            slots[i] += extra
    total = sum(slots)

    # Video segments. Scene 1 is 0.3 s longer so the crossfade does not shift the audio.
    seg_paths = []
    for idx, (scene, clips, _) in enumerate(SCENES):
        slot = slots[idx] + (CROSSFADE if idx == 0 else 0)
        for j, (clip, start, share) in enumerate(clips):
            length = slot * share
            out = WORK / f"seg_{scene}_{j}.mp4"
            segment(clip, start, length, out, push_in=length > 8)
            seg_paths.append(out)

    # Scene 1 -> 2 crossfade, hard cuts everywhere else.
    inputs = []
    for p in seg_paths:
        inputs += ["-i", str(p)]
    first = duration(seg_paths[0])
    chain = f"[0:v][1:v]xfade=transition=fade:duration={CROSSFADE}:offset={first - CROSSFADE:.3f}[x0]"
    labels = "[x0]" + "".join(f"[{i}:v]" for i in range(2, len(seg_paths)))
    chain += f";{labels}concat=n={len(seg_paths) - 1}:v=1:a=0[v]"
    video = WORK / "video.mp4"
    run("ffmpeg", "-y", *inputs, "-filter_complex", chain, "-map", "[v]", "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-pix_fmt", "yuv420p", "-r", str(FPS), str(video))

    if wavs:
        # Each narration line padded with silence to its scene length, then joined and normalised.
        parts = []
        for i, (w, slot) in enumerate(zip(wavs, slots)):
            p = WORK / f"vo_pad_{i}.wav"
            run("ffmpeg", "-y", "-i", str(w), "-af", f"aresample=48000,apad=whole_dur={slot:.3f}", "-ac", "1", str(p))
            parts.append(p)
        lst = WORK / "vo.txt"
        lst.write_text("".join(f"file '{p}'\n" for p in parts))
        voice = WORK / "voice.wav"
        run("ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-af", "highpass=f=70,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", str(voice))
        run("ffmpeg", "-y", "-i", str(video), "-i", str(voice), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(OUT))
    else:
        run("ffmpeg", "-y", "-i", str(video), "-c:v", "copy", "-an", "-movflags", "+faststart", str(OUT))

    report = {"engine": engine, "duration": round(duration(OUT), 2), "scenes": [round(s, 2) for s in slots]}
    (HERE / "raw" / "cut_report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == "__main__":
    main()
