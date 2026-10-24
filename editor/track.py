"""Face tracking for smart 9:16 reframing.

Samples the cut at a few fps, finds the main face with OpenCV (YuNet DNN when a
model file is available, Haar cascade otherwise) and writes normalised face
centres to track.json. render.py interpolates and smooths them per cut segment.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

from .util import EditorError, log, probe, save_json

ANALYSIS_WIDTH = 640


def track(src: str | Path, out: str | Path, sample_fps: float = 5.0, yunet_model: str | None = None) -> Path:
    try:
        import cv2
    except ImportError as e:
        raise EditorError("opencv is not installed. Run: pip install -r requirements.txt") from e
    info = probe(src)
    v = info["video"]
    aw = ANALYSIS_WIDTH
    ah = int(round(v["height"] * aw / v["width"] / 2) * 2)
    detector = _make_detector(cv2, aw, ah, yunet_model)
    proc = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(src), "-vf",
                             f"fps={sample_fps},scale={aw}:{ah}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                            stdout=subprocess.PIPE)
    frame_bytes = aw * ah * 3
    samples, prev, i = [], None, 0
    while True:
        buf = proc.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        frame = np.frombuffer(buf, np.uint8).reshape(ah, aw, 3)
        faces = detector(frame)
        if faces:
            # prefer the face closest to the previous one (stable subject), then the biggest
            if prev is not None:
                faces.sort(key=lambda f: (abs(f[0] - prev[0]) + abs(f[1] - prev[1])) - f[2] * 0.5)
            else:
                faces.sort(key=lambda f: -f[2])
            cx, cy, fw = faces[0]
            prev = (cx, cy)
            samples.append({"t": round(i / sample_fps, 3), "cx": round(cx, 4), "cy": round(cy, 4), "fw": round(fw, 4)})
        i += 1
    proc.wait()
    found = len(samples)
    save_json(out, {"source": str(src), "sample_fps": sample_fps, "frames_sampled": i, "samples": samples})
    log(f"track: face found in {found}/{i} sampled frames -> {out}")
    if i and found / i < 0.3:
        log("track: few faces found; reframing will fall back to centre crop where no face is seen")
    return Path(out)


def _make_detector(cv2, w, h, yunet_model):
    if yunet_model and Path(yunet_model).exists():
        det = cv2.FaceDetectorYN.create(yunet_model, "", (w, h), 0.7)

        def yunet(frame):
            _, faces = det.detect(frame)
            if faces is None:
                return []
            return [((f[0] + f[2] / 2) / w, (f[1] + f[3] / 2) / h, f[2] / w) for f in faces]
        return yunet

    if not hasattr(cv2, "CascadeClassifier"):
        raise EditorError("this OpenCV build has no Haar cascades (OpenCV 5 moved them out). Install "
                          "'opencv-python-headless<5' or pass --yunet-model face_detection_yunet_2023mar.onnx")
    # alt2 is markedly more robust than the default cascade (tested: 100% vs 23% hit rate on the
    # face fixture at strict settings); default + profile catch turned heads it misses
    cascades = [cv2.CascadeClassifier(cv2.data.haarcascades + name) for name in
                ("haarcascade_frontalface_alt2.xml", "haarcascade_frontalface_default.xml",
                 "haarcascade_profileface.xml")]
    min_size = (int(w * 0.06), int(w * 0.06))

    def haar(frame):
        gray = cv2.equalizeHist(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        found = []
        for cascade in cascades:
            found = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=min_size)
            if len(found):
                break
        return [((x + fw / 2) / w, (y + fh / 2) / h, fw / w) for (x, y, fw, fh) in found]
    return haar
