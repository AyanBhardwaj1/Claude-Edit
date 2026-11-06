# Example: the Walk-Free hackathon demo as one `editor produce` spec

The 2:56 video from 2026-11-05, rebuilt from `projects/walkfree/produce.json` (30 pieces, 11 voices, 2 music
tracks, 22 SFX, 3 beds, 70 overlay elements). Excerpts; times are references wherever possible.

## Pieces (excerpt)
```json
{"name": "s1", "type": "video", "src": "raw/scene1.mov", "in": 0.4, "out": 13.4, "grade": "hot", "crop_y": 0.55, "push": [12.55, 0.45, 2.4, 0.6, 0.45]},
{"name": "d1", "type": "sequence", "srcs": ["demos/st/d1_h7.png", "demos/st/d5_route.png", "demos/st/d4d_night.png"], "dur": 4.8},
{"name": "d2", "type": "framed", "src": "demos/landing.png", "dur": 3.5, "z1": 1.05, "fx": 0.3, "fy": 0.4},
{"name": "s3ans", "type": "video", "src": "raw/scene3a.mov", "in": 22.1, "out": 28.6, "grade": "neutral", "z1": 1.1, "fx": 0.5, "fy": 0.55},
{"name": "d3map", "type": "framed", "src": "demos/fr_D3/010.png", "dur": 5.5, "z1": 1.04, "fx": 0.6, "fy": 0.45, "punch": [1.6, 1.55, 0.62, 0.42]},
{"name": "d4a", "type": "framed", "src": "demos/st/d4a_pcl.png", "dur": 4.4, "fx": 0.15, "fy": 0.2, "punch": [0.6, 1.7, 0.08, 0.12]},
{"name": "d6a", "type": "framed", "src": "demos/photos/photo1.jpg", "dur": 3.0, "z1": 1.08, "flash": 0.35},
{"name": "s9", "type": "video", "src": "raw/scene9.mov", "in": 0, "out": 21.0, "grade": "cool", "crop_y": 0.55, "fade_in": [0.25, "white"]},
{"name": "end", "type": "freeze", "from": "s9", "dur": 7.5, "blur": 12, "darken": 0.3, "fade_out": 0.5},
```

## Audio (excerpt)
```json
{"voices": [{"name": "v1", "src": "raw/scene1.mov", "in": 0.4, "out": 13.4, "at": "s1", "gain": 5}, {"name": "v2", "src": "raw/scene2.mov", "in": 0.2, "out": 10.9, "at": "s2cam"}, {"name": "v3q", "src": "raw/scene3a.mov", "in": 0.6, "out": 7.6, "at": "s3q", "gain": 2}], "music": [{"src": "audio/music/lofi_seg1.wav", "at": 0, "in": 0, "out": 13.0, "gain": -16, "fade_out": 0.5, "automation": [[10.29, 0], [10.3, -60], [11.65, -60], [11.66, 0]]}, {"src": {"compose": {"mood": "warm", "bpm": 100, "key": "D", "seed": 7, "end_chord_at": 154.8, "length": 163}}, "at": 13.0, "dur": 163, "gain": -3, "fade_in": 0.4, "automation": [[147, 0], [148, -11], [167.8, -11], [168.6, 0]]}], "sfx": [{"src": "whoosh", "at": "s1+12.55", "gain": -3}, {"src": "thud", "at": 16.95, "gain": -2}, {"src": "ding", "at": 23.45, "gain": -8}, {"src": "whoosh", "at": 23.3, "gain": -8}, {"src": "pop", "at": "@v9:6.36", "gain": -20}, {"src": "pop", "at": "@v9:7.69", "gain": -20}], "beds": [{"src": "raw/scene3a.mov", "in": 22.1, "out": 28.6, "at": "s3ans", "gain": -22, "clean": true}, {"src": {"ambience": "cicadas"}, "at": 0, "dur": 13, "gain": -13, "fade_out": 0.6}, {"src": {"ambience": "birdsong"}, "at": "s9", "dur": 21.5, "gain": -19, "fade_in": 0.6, "fade_out": 1}]}
```

Notes:
- The lo-fi `automation` is a hard stop on the joke ("What?") and back; the bed's dips 11 dB for the closing skit
  so the dialogue is clearly heard (the user's note), and comes back for the end card's final chord.
- `compose` makes the bed at the needed length with the final chord landing on the end card.
- Pills pop on `@v9:<word time>`: the moment each model name is spoken.

## Overlay (a few elements)
```json
{"type": "chip", "text": "100°F · 3:12 PM", "t_in": 0.3, "t_out": 12.5, "x": 1840, "y": 56, "color": "heat", "anchor": "tr"},
{"type": "big_stat", "from": 0, "to": 2300, "suffix": "+", "count_dur": 0.8, "label": "US heat deaths in 2023", "source": "Source: AP analysis of CDC data", "t_in": 16.9, "t_out": 18.85},
{"type": "logo_sting", "t_in": 23.4, "dur": 1.25, "text": "walk-free", "mark": "sun_tree"},
{"type": "meta_tag", "text": "Muse Voice Transcribe", "t_in": 34.2, "x": 60, "y": 110},
{"type": "meta_tag", "text": "Muse Spark", "t_in": 37.3, "x": 60, "y": 110},
{"type": "chips_compete", "items": ["inShade", "ShadePath", "BrightMaps", "Cool Walks", "Shadowmap"], "times": [53.260000000000005, 53.86, 54.550000000000004, 55.24, 55.93000000000001], "t_column": 59.230000000000004, "label": "Shade routing", "t_out": 63.85},
{"type": "checklist", "heading": "Walk-Free, built for students", "items": ["Knows campus names (PCL, GDC)", "Cuts through air-conditioned buildings", "Coolest time to leave for class", "Lit paths after dark", "Feels-like in sun vs shade"], "times": [64.1, 68.5, 71.4, 74.4, 77.7], "t_in": 63.9, "t_out": 80.65},
{"type": "meta_tag", "text": "DINOv3 · Meta × WRI canopy map", "t_in": 83.5, "x": 105, "y": 71},
{"type": "meta_tag", "text": "SAM 3.1", "t_in": 105.3, "x": 105, "y": 71},
```
