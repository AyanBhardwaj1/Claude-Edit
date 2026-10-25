"""Word-synced animated captions (ASS, burned in by libass) plus an SRT sidecar.

Styles
  bold     Hormozi-style: 1-3 UPPERCASE words, heavy font, thick outline,
           active word turns yellow and pops. Default for reels.
  beast    2 huge words, active word green, punchier pop.
  clean    sentence case, up to ~6 words, soft shadow, subtle active colour.
  white    bold white 2-3 word groups, no highlight colour: the classic creator look.
  minimal  lowercase, small, no highlight. For aesthetic / vlog content.

Chapters ("1: The hook") render as black rounded pills at the top of frame.

Words flagged `emph` in cut_words.json (or listed in the EDL "emphasis" array)
always render in the emphasis colour and slightly larger.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from .util import load_json, log

FONTS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"

STYLES = {
    "bold": dict(fonts=["Montserrat Black", "Montserrat ExtraBold", "Inter Black", "Inter ExtraBold", "Arial Black"],
                 size=0.085, upper=True, max_words=3, max_chars=14, primary="#FFFFFF", active="#FFE600",
                 emph="#FF3B30", outline=0.0075, shadow=0.003, pop=1.12, width_k=0.70),
    "beast": dict(fonts=["Montserrat Black", "Inter Black", "Arial Black"], size=0.11, upper=True, max_words=2,
                  max_chars=11, primary="#FFFFFF", active="#22FF6E", emph="#FFE600", outline=0.009, shadow=0.004,
                  pop=1.18, width_k=0.72),
    "clean": dict(fonts=["Montserrat Bold", "Inter SemiBold", "Inter", "Helvetica Neue", "Arial"], size=0.058,
                  upper=False, max_words=6, max_chars=30, primary="#FFFFFF", active="#FFF2A8", emph="#FFD60A",
                  outline=0.0025, shadow=0.004, pop=1.0, width_k=0.55),
    "white": dict(fonts=["Montserrat ExtraBold", "Inter ExtraBold", "Inter Black", "Arial Black"], size=0.07,
                  upper=False, max_words=3, max_chars=18, primary="#FFFFFF", active=None, emph="#FFFFFF",
                  outline=0.0035, shadow=0.004, pop=1.0, width_k=0.60),
    "minimal": dict(fonts=["Inter Medium", "Montserrat Medium", "Helvetica Neue", "Arial"], size=0.048,
                    upper=False, lower=True, max_words=4, max_chars=26, primary="#FFFFFF", active=None,
                    emph="#FFFFFF", outline=0.0, shadow=0.003, pop=1.0, width_k=0.52),
}
MIN_CUE = 0.35  # seconds; a caption cue shorter than this reads as a flicker
POSITIONS = {"low": (0.73, 0.86), "middle": (0.50, 0.50), "high": (0.30, 0.16)}  # (vertical, landscape)


def ass_color(hex_color: str, alpha: int = 0) -> str:
    h = hex_color.lstrip("#")
    return f"&H{alpha:02X}{h[4:6]}{h[2:4]}{h[0:2]}".upper()


def ass_time(t: float) -> str:
    t = max(t, 0.0)
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def resolve_font(candidates: list[str]) -> str:
    bundled = {p.stem.replace("-", " ") for p in FONTS_DIR.glob("*.[ot]tf")} if FONTS_DIR.exists() else set()
    if shutil.which("fc-list"):
        listing = subprocess.run(["fc-list", ":", "family", "fullname"], capture_output=True, text=True).stdout
        available = {n.strip() for line in listing.splitlines() for part in line.split(":") for n in part.split(",")}
    else:
        available = set()
    for name in candidates:
        if name in bundled or name in available:
            return name
    return candidates[-1]


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")")


def _groups(words: list[dict], max_words: int, max_chars: int) -> list[list[dict]]:
    groups: list[list[dict]] = []
    for w in words:
        g = groups[-1] if groups else None
        if g is not None:
            chars = sum(len(x["text"]) + 1 for x in g) + len(w["text"])
            gap = w["start"] - g[-1]["end"]
            boundary = (g[-1]["text"].rstrip().endswith((".", "?", "!", ",", ":", ";")) or gap > 0.45
                        or (w.get("segment") != g[-1].get("segment") and gap > 0.15))
            short = w["start"] - g[0]["start"] < MIN_CUE and gap < 0.3  # would flash: let it grow
            if (len(g) < max_words or (short and len(g) <= max_words)) and chars <= max_chars + 4 * short \
                    and not boundary:
                g.append(w)
                continue
        groups.append([w])
    return groups


def build(words_path: str | Path, out: str | Path, width: int = 1080, height: int = 1920, style: str = "bold",
          position: str = "low", title: str | None = None, title_dur: float = 3.0,
          emphasis: list[str] | None = None, srt: bool = True, chapters: list[dict] | None = None,
          duration: float | None = None) -> Path:
    st = STYLES[style]
    words = [dict(w) for w in load_json(words_path)["words"]]
    extra = {e.lower() for e in (emphasis or [])}
    for w in words:
        bare = "".join(ch for ch in w["text"].lower() if ch.isalnum() or ch == "'")
        w["emph"] = w.get("emph", False) or bare in extra
        w["text"] = w["text"].strip()
        if st.get("upper"):
            w["text"] = w["text"].upper()
        elif st.get("lower"):
            w["text"] = w["text"].lower()

    vertical = height >= width
    base = min(width, height) * (1.0 if vertical else 0.75)
    fs = round(st["size"] * base)
    outline = round(st["outline"] * base, 1)
    shadow = round(st["shadow"] * base, 1)
    font = resolve_font(st["fonts"])
    title_font = resolve_font(STYLES["bold"]["fonts"])
    y = POSITIONS[position][0 if vertical else 1] * height
    x = width / 2

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{font},{fs},{ass_color(st['primary'])},{ass_color(st['primary'])},{ass_color('#000000')},{ass_color('#000000', 0x80)},-1,0,0,0,100,100,0,0,1,{outline},{shadow},5,40,40,40,1
Style: Chap,{title_font},{round(0.044 * base)},{ass_color('#FFFFFF')},{ass_color('#FFFFFF')},{ass_color('#000000')},{ass_color('#000000')},-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1
Style: Title,{title_font},{round(0.06 * base)},{ass_color('#111111')},{ass_color('#111111')},{ass_color('#FFFFFF')},{ass_color('#000000', 0x60)},-1,0,0,0,100,100,0,0,3,{round(0.018 * base)},0,8,60,60,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    groups = _groups(words, st["max_words"], st["max_chars"])
    for gi, g in enumerate(groups):
        g_start = g[0]["start"]
        g_end = g[-1]["end"]
        if gi + 1 < len(groups):
            nxt = groups[gi + 1][0]["start"]
            g_end = nxt if nxt - g_end < 0.35 else g_end
            g_end = min(max(g_end, g_start + 0.25), nxt)
        else:
            g_end = max(g_end, g_start + 0.4)
        line_break = _break_index(g, fs * st["width_k"], width * 0.86)
        n = len(g) if st["active"] else 1
        for j in range(n):
            ev_start = g_start if j == 0 else g[j]["start"]
            ev_end = g[j + 1]["start"] if (st["active"] and j + 1 < len(g)) else g_end
            if ev_end <= ev_start:
                continue
            parts = []
            for k, w in enumerate(g):
                txt = _escape(w["text"])
                tags = ""
                if w["emph"]:
                    tags += f"\\c{ass_color(st['emph'])}\\fscx110\\fscy110"
                if st["active"] and k == j:
                    if not w["emph"]:
                        tags += f"\\c{ass_color(st['active'])}"
                    if st["pop"] > 1.0:
                        p = round(st["pop"] * (110 if w["emph"] else 100))
                        rest = 110 if w["emph"] else 100
                        tags += f"\\t(0,70,\\fscx{p}\\fscy{p})\\t(70,150,\\fscx{rest}\\fscy{rest})"
                parts.append(f"{{{tags}}}{txt}{{\\r}}" if tags else txt)
                if line_break and k == line_break - 1:
                    parts.append("\\N")
            text = " ".join(parts).replace(" \\N ", "\\N")
            intro = "\\fscx92\\fscy92\\t(0,80,\\fscx100\\fscy100)" if j == 0 and st["pop"] > 1.0 else ""
            fade = "\\fad(60,0)" if j == 0 else ""
            events.append(f"Dialogue: 1,{ass_time(ev_start)},{ass_time(ev_end)},Cap,,0,0,0,,"
                          f"{{\\an5\\pos({x:.0f},{y:.0f}){intro}{fade}}}{text}")
    if title:
        ty = 0.12 * height if vertical else 0.08 * height
        events.append(f"Dialogue: 2,{ass_time(0)},{ass_time(title_dur)},Title,,0,0,0,,"
                      f"{{\\an8\\pos({x:.0f},{ty:.0f})\\fad(120,200)}}{_escape(title)}")

    if chapters:
        end_of_video = duration or (max(w["end"] for w in words) + 0.5 if words else 0)
        cfs = round(0.044 * base)
        cy = (0.085 if vertical else 0.07) * height
        ordered = sorted(chapters, key=lambda c: float(c["start"]))
        for k, ch in enumerate(ordered):
            c_start = float(ch["start"])
            c_end = float(ch.get("end") or (ordered[k + 1]["start"] if k + 1 < len(ordered) else end_of_video))
            if c_end <= c_start:
                continue
            ph = round(cfs * 1.9)
            pw = round(len(ch["text"]) * cfs * 0.58 + cfs * 1.6)
            events.append(f"Dialogue: 3,{ass_time(c_start)},{ass_time(c_end)},Chap,,0,0,0,,"
                          f"{{\\an7\\pos({x - pw / 2:.0f},{cy - ph / 2:.0f})\\p1\\1c&H000000&\\1a&H08&\\bord0\\shad0"
                          f"\\fad(120,120)}}{_pill(pw, ph)}{{\\p0}}")
            events.append(f"Dialogue: 4,{ass_time(c_start)},{ass_time(c_end)},Chap,,0,0,0,,"
                          f"{{\\an5\\pos({x:.0f},{cy:.0f})\\fad(120,120)}}{_escape(ch['text'])}")

    out = Path(out)
    out.write_text(header + "\n".join(events) + "\n", encoding="utf-8")
    if srt:
        _write_srt(groups, out.with_suffix(".srt"))
    log(f"captions: {len(groups)} groups, style={style}, font={font} -> {out}")
    return out


def _pill(w: float, h: float) -> str:
    """ASS vector drawing of a fully rounded rectangle (pill) w x h, origin top-left."""
    r = h / 2
    k = r * 0.448  # bezier handle length for a quarter circle
    pts = (f"m {r:.0f} 0 l {w - r:.0f} 0 b {w - r + k:.0f} 0 {w:.0f} {r - k:.0f} {w:.0f} {r:.0f} "
           f"b {w:.0f} {r + k:.0f} {w - r + k:.0f} {h:.0f} {w - r:.0f} {h:.0f} l {r:.0f} {h:.0f} "
           f"b {r - k:.0f} {h:.0f} 0 {r + k:.0f} 0 {r:.0f} b 0 {r - k:.0f} {r - k:.0f} 0 {r:.0f} 0")
    return pts


def _break_index(group: list[dict], char_w: float, max_w: float) -> int | None:
    total = sum(len(w["text"]) for w in group) + len(group) - 1
    if total * char_w <= max_w or len(group) < 2:
        return None
    best, best_diff, run_len = None, float("inf"), 0
    for k in range(1, len(group)):
        run_len += len(group[k - 1]["text"]) + 1
        diff = abs(run_len - (total - run_len))
        if diff < best_diff:
            best, best_diff = k, diff
    return best


def _write_srt(groups: list[list[dict]], path: Path) -> None:
    def ts(t):
        ms = int(round(t * 1000))
        h, ms = divmod(ms, 3600000)
        m, ms = divmod(ms, 60000)
        s, ms = divmod(ms, 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    lines = []
    for i, g in enumerate(groups, 1):
        lines += [str(i), f"{ts(g[0]['start'])} --> {ts(g[-1]['end'])}", " ".join(w["text"] for w in g), ""]
    path.write_text("\n".join(lines), encoding="utf-8")
