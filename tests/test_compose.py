"""editor compose: original music + SFX synthesis (short renders, so the whole file runs in seconds).

Run: python3 -m pytest -q tests/test_compose.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
import scipy.signal as ss

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from editor import compose, library, sfx  # noqa: E402
from editor.compose import fx, music  # noqa: E402
from editor.util import probe  # noqa: E402

SR = 48000


def read(path) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2)


def dbfs(v: float) -> float:
    return 20 * np.log10(max(v, 1e-12))


def check_file(path, length: float, max_peak_db: float = -1.0) -> np.ndarray:
    a = probe(path)["audio"]
    assert a["sample_rate"] == SR and a["channels"] == 2 and a["codec"] == "pcm_s24le"
    x = read(path)
    assert abs(len(x) / SR - length) < 2 / SR
    assert dbfs(np.abs(x).max()) <= max_peak_db
    assert dbfs(np.sqrt(np.mean(x ** 2))) > -45          # not silent
    side = json.loads(Path(str(path) + ".json").read_text())
    assert side["generator"] == "editor compose" and side["original"] is True
    assert side["licence"] == "original work, royalty-free" and side["measured"]["sample_rate"] == SR
    return x


def envelope(x: np.ndarray, hop: int, highpass: float | None = None) -> np.ndarray:
    y = x.mean(1).astype(float)
    if highpass:
        y = ss.sosfilt(ss.butter(4, highpass, "high", fs=SR, output="sos"), y)
    return np.sqrt(np.mean(y[: len(y) // hop * hop].reshape(-1, hop) ** 2, axis=1))


def onset(x: np.ndarray, lo: float, hi: float) -> float:
    """Time of the sharpest transient (biggest rise of the > 3 kHz energy, 5 ms frames) between lo and hi."""
    hop = SR // 200
    d = np.diff(envelope(x, hop, 3000))
    a, b = int(lo * 200), int(hi * 200)
    return (a + int(np.argmax(d[a:b])) + 1) * hop / SR


def test_bed_short_render(tmp_path):
    out = tmp_path / "bed.wav"
    info = compose.bed(6.0, out=out)
    x = check_file(out, 6.0)
    assert abs(info["measured"]["lufs"] - -16.0) < 0.6 and info["measured"]["true_peak"] <= -1.5
    tail = x[int(info["silent_from"] * SR) + 1:]
    assert len(tail) > 0 and np.abs(tail).max() < 1e-4          # silent at the very end
    assert np.abs(x[-int(0.05 * SR):]).max() < 1e-4


def test_end_chord_lands_where_asked(tmp_path):
    out = tmp_path / "bed.wav"
    info = compose.bed(8.0, bpm=120, end_chord_at=6.3, out=out, seed=3)
    assert info["end_chord_at"] == pytest.approx(6.3)
    x = read(out)
    assert abs(onset(x, 6.0, 6.6) - 6.3) <= 0.02
    secs = info["sections"]
    assert secs[-1]["end"] == pytest.approx(6.3)
    bar, off = info["bar"], info["grid_offset"]
    for s in secs[1:]:          # every section after the first starts on a downbeat of the chord's grid
        k = (s["at"] - off) / bar
        assert abs(k - round(k)) < 1e-6


@pytest.mark.parametrize("length,end", [(20.0, None), (61.0, 55.2), (156.0, 150.0), (156.0, 150.7)])
def test_auto_sections_on_bar_grid(length, end):
    P = music.plan(length, 100, "warm", end_chord_at=end)
    secs, bar, off = P["sections"], P["bar"], P["grid_offset"]
    assert secs[0]["at"] == 0 and secs[-1]["end"] == pytest.approx(P["end_chord_at"])
    assert [s["at"] for s in secs] == sorted(s["at"] for s in secs)
    for s in secs[1:]:
        k = (s["at"] - off) / bar
        assert abs(k - round(k)) < 1e-6
    names = [s["name"] for s in secs]
    assert names[-1] == "resolve" and (length < 20 or "peak" in names)
    if end is None:
        assert P["ring"] == pytest.approx(min(6.0, max(1.5, 0.25 * length)))


def test_explicit_sections_snap_to_bars():
    given = music.parse_sections("intro@0,A@10.9,build@94.0,peak@103.8,brk@116.5,res@128.4")
    P = music.plan(156, 100, "warm", given, end_chord_at=150)
    assert [s["name"] for s in P["sections"]] == ["intro", "groove", "build", "peak", "breakdown", "resolve"]
    assert [s["at"] for s in P["sections"]] == [0.0, 10.8, 94.8, 104.4, 116.4, 128.4]   # grid = 1.2 + k * 2.4
    beat = music.plan(156, 100, "warm", given, end_chord_at=150, snap="beat")
    assert beat["sections"][1]["at"] == pytest.approx(10.8) and beat["sections"][2]["at"] == pytest.approx(94.2)
    with pytest.raises(Exception):
        music.plan(20, 100, "warm", [{"at": 0, "name": "chorus-ish"}])


def test_keys_and_modes():
    assert music.parse_key("Am") == (9, "minor")
    assert music.parse_key("F#") == (6, "")
    H = music.Harmony(38, "D", "minor")
    assert H([47, 54, 57, 62]) == [46, 53, 57, 62]               # Bm7 -> Bbmaj7 in D minor
    assert music.Harmony(38, "E", "major")([50]) == [52]          # transposed up a tone


def test_lofi_and_riser(tmp_path):
    info = compose.lofi(2.0, out=tmp_path / "lofi.wav")
    check_file(tmp_path / "lofi.wav", 2.0)
    assert abs(info["measured"]["lufs"] - -16.0) < 0.6
    info = compose.riser(2.0, out=tmp_path / "riser.wav")
    x = check_file(tmp_path / "riser.wav", 2.0)
    assert info["hit_at"] == pytest.approx(1.8)
    e = envelope(x, SR // 100)
    assert 1.6 <= np.argmax(e) / 100 <= 1.86                     # loudest at the hit
    assert e[-2:].max() < 0.15 * e.max()                          # faded by the end


@pytest.mark.parametrize("name", list(fx.SFX))
def test_each_sfx(tmp_path, name):
    out = tmp_path / f"{name}.wav"
    compose.sfx(name, out)
    natural = len(fx.render_sfx(name)) / SR
    check_file(out, natural)


@pytest.mark.parametrize("kind", list(fx.AMBIENCES))
def test_ambiences(tmp_path, kind):
    out = tmp_path / f"{kind}.wav"
    compose.ambience(kind, 3.0, out=out)
    x = check_file(out, 3.0, max_peak_db=fx.AMBIENCES[kind][1] + 0.1)
    assert np.abs(x[:10]).max() < 1e-3                             # faded in


def test_sfx_registry_uses_composed_types():
    for kind in sorted(sfx.COMPOSED):
        y = sfx.synth(kind)
        assert y.ndim == 1 and 0.85 < np.abs(y).max() < 0.9
        env = np.convolve(np.abs(y), np.ones(480) / 480, mode="same")
        assert abs(np.argmax(env) / sfx.SR - sfx.TYPES[kind][0]) < 0.13


def test_cli_and_library(tmp_path, monkeypatch, capsys):
    assert compose.main(["bed", "--length", "30", "--end-chord-at", "26", "--plan"]) == 0
    assert "final chord at 26.0" in capsys.readouterr().out
    monkeypatch.setattr(library, "ROOT", tmp_path / "lib")
    out = tmp_path / "loop.wav"
    assert compose.main(["lofi", "--length", "1.5", "-o", str(out), "--library", "cool-fun"]) == 0
    track = json.loads((tmp_path / "lib" / "music" / "library.json").read_text())["tracks"][0]
    assert track["mood"] == "cool-fun" and "original" in track["tags"]
    assert (tmp_path / "lib" / (track["file"] + ".json")).exists()
    assert compose.main(["sfx", "pop", "-o", str(tmp_path / "p.wav"), "--key", "C"]) == 0
    assert compose.main(["bed", "--length", "5"]) == 1               # no -o
