"""editor safezone: captions under the platforms' own UI are found from the captions file itself."""
import subprocess

from editor import safezone

ASS = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,90,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,0,2,40,40,{margin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.50,Default,,0,0,0,,{text}
"""


def test_captions_low_on_the_frame_are_flagged_and_centred_ones_are_not(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    out = tmp_path / "out"
    out.mkdir()
    video = out / "reel.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=gray:s=1080x1920:d=2:r=10",
                    "-pix_fmt", "yuv420p", str(video)], check=True)
    (work / "captions.ass").write_text(ASS.format(margin=40, text="LOW CAPTION HERE"))            # bottom 2%: under every platform's caption UI
    rep = safezone.check(video, work)
    assert {h["platform"] for h in rep["hits"]} == {"reels", "tiktok", "shorts"}
    assert all("caption" in h["zone"] or "username" in h["zone"] or "channel" in h["zone"] for h in rep["hits"])
    assert all(h["to"] <= 1.75 for h in rep["hits"])                      # only while the caption is up
    (work / "captions.ass").write_text(ASS.format(margin=820, text="TWO WORDS"))      # the middle of the frame
    assert safezone.check(video, work)["hits"] == []
    (work / "captions.ass").write_text(ASS.format(margin=820, text="LOW CAPTION HERE"))   # reaches the buttons
    assert [h["zone"] for h in safezone.check(video, work, "tiktok")["hits"]] == ["like / comment / share buttons"]
    for s in rep["sheets"].values():
        assert (tmp_path / "out" / s.split("/")[-1]).exists()
