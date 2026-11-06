import subprocess
import wave

import numpy as np

from editor import audio, bleep


def test_words_and_masks():
    for w in ["fuck", "Fucking,", "motherfucker", "shit.", "bullshit", "bitches", "asshole", "WTF"]:
        assert bleep.is_swear(w), w
    for w in ["damn", "hell", "crap", "shitake", "Dick", "class", "assess", "Scunthorpe"]:
        assert not bleep.is_swear(w), w
    assert bleep.mask("Fucking,") == "F******," and bleep.mask("“shit!”") == "“s***!”"
    words = [{"id": "w0", "text": "this", "start": 0.0, "end": 0.3}, {"id": "w1", "text": "fucking", "start": 0.4, "end": 0.8},
             {"id": "w2", "text": "rocks", "start": 0.9, "end": 1.2}]
    assert [tuple(round(v, 3) for v in s) for s in bleep.spans(words, True)] == [(0.37, 0.83)]
    assert [w["id"] for w in bleep.chosen(words, ["w2"])] == ["w2"]
    assert bleep.spans(words, None) == [] and bleep.spans(words, False) == []


def _band(x, sr, f):
    sp = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    fr = np.fft.rfftfreq(len(x), 1 / sr)
    return sp[(fr > f - 40) & (fr < f + 40)].sum() / (sp.sum() + 1e-9)


def test_master_bleeps_the_span(tmp_path):
    src = tmp_path / "v.wav"      # a steady 300 Hz "voice" for 3 s
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=300:d=3:sample_rate=48000", src], check=True)
    out = audio.master(src, tmp_path / "o.wav", preset="clean", bleeps=[(1.0, 1.6)])
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(out), "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.int16).astype(float) / 32768
    sr = 16000
    mid, before = x[int(1.15 * sr):int(1.45 * sr)], x[int(0.3 * sr):int(0.7 * sr)]
    assert _band(mid, sr, 1000) > 0.6 and _band(mid, sr, 300) < 0.1        # the tone, the voice muted
    assert _band(before, sr, 300) > 0.6 and _band(before, sr, 1000) < 0.05   # untouched elsewhere


def test_pacing_mentions_unbleeped_strong_language():
    from editor.review import pacing
    words = [{"id": "w0", "text": "this", "start": 0.0, "end": 0.3}, {"id": "w1", "text": "fucking", "start": 0.4, "end": 0.8},
             {"id": "w2", "text": "rocks.", "start": 0.9, "end": 1.2}]
    assert "f****** at 0.4s" in pacing({"broll": []}, words, 1.5)["strong_language"]
    assert pacing({"broll": [], "bleep": True}, words, 1.5)["strong_language"] is None
