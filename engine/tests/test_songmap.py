"""Song structure (P3-01): the built-in estimate against ground truth and against Pulseframe's own analysis of its test song, and the
Pulseframe SongMap import. Fixtures: tests/fixtures/pulseframe_*.songmap.json (Pulseframe a0ee7ec, see docs/PORT_LEDGER.md)."""
from __future__ import annotations

import json
import math
import struct
import wave
from pathlib import Path

import pytest

from motioncraft_engine import audio, songmap
from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.adapter.errors import AdapterError
from motioncraft_engine.sidecar import Service

from .songs import PULSEFRAME_SECTIONS, write_song

FIX = Path(__file__).parent / "fixtures"
SECTIONS_2 = [  # a different song: pre-choruses and a bridge, other levels
    ("INTRO", 4, [220, 277, 330], 0.08, False, False), ("VERSE", 8, [196, 247, 294], 0.14, True, False),
    ("PRE-CHORUS", 4, [233, 294, 349], 0.22, True, False), ("CHORUS", 8, [262, 330, 392, 523], 0.32, True, True),
    ("VERSE", 8, [196, 247, 294], 0.14, True, False), ("PRE-CHORUS", 4, [233, 294, 349], 0.22, True, False),
    ("CHORUS", 8, [262, 330, 392, 523], 0.32, True, True), ("BRIDGE", 4, [175, 220, 262], 0.10, False, False),
    ("CHORUS", 8, [262, 330, 392, 523], 0.32, True, True), ("OUTRO", 4, [220, 277, 330], 0.07, False, False),
]


@pytest.fixture(scope="module")
def pf_estimate(tmp_path_factory):
    f = tmp_path_factory.mktemp("pf") / "song.wav"
    truth = write_song(f)
    return truth, audio.analyze(f)


def same_partition(a: list[str], b: list[str]) -> bool:
    """Two group lists describe the same grouping when equal letters in one are equal letters in the other (the letters themselves may differ)."""
    return all((a[i] == a[j]) == (b[i] == b[j]) for i in range(len(a)) for j in range(len(a)))


# ------------------------------------------------------------------------------------------------ P3-01 acceptance
def test_the_estimate_matches_pulseframes_analysis_of_its_own_test_song(pf_estimate):
    truth, est = pf_estimate
    pf = json.loads((FIX / "pulseframe_synthetic.songmap.json").read_text())
    ours, theirs = est["sections"], pf["sections"]
    assert len(ours) == len(theirs) == len(truth) == 6
    assert [s["label"] for s in ours] == [s["label"] for s in theirs] == [t[0] for t in truth] == ["INTRO", "VERSE", "CHORUS", "VERSE", "CHORUS", "OUTRO"]
    assert same_partition([s["group"] for s in ours], [s["group"] for s in theirs]), "the same material is recognised as repeated"
    for o, t, (_, a, b) in zip(ours, theirs, truth):
        assert abs(o["start"] - t["start"]) < 0.5 and abs(o["end"] - t["end"]) < 0.5, f"{o} vs Pulseframe {t}"
        assert abs(o["start"] - a) < 0.5 and abs(o["end"] - b) < 0.5, f"{o} vs truth {(a, b)}"
        assert abs(o["energy"] - t["energy"]) <= 2, f"energy {o['energy']} vs Pulseframe {t['energy']}"
    assert abs(est["bpm"] - pf["bpm"]) < 0.6 and abs(est["bpm"] - 120) < 0.6
    assert est["estimate"] is True and est["energyCurve"] and est["transients"]


def test_a_different_song_at_two_tempos_finds_every_boundary(tmp_path):
    for bpm in (100.0, 128.0):
        f = tmp_path / f"s{int(bpm)}.wav"
        truth = write_song(f, SECTIONS_2, bpm)
        est = audio.analyze(f)
        assert abs(est["bpm"] - bpm) < 1.0
        # ground-truth cuts: a verse followed by its pre-chorus is the same sort of music at this level, so the estimate may treat them as one;
        # every cut it makes must be a true one, and every big change (into a chorus, bridge, outro) must be found
        true_cuts = [t[1] for t in truth[1:]]
        cuts = [s["start"] for s in est["sections"][1:]]
        bar = 4 * 60.0 / bpm
        assert all(min(abs(c - t) for t in true_cuts) < 0.5 * bar for c in cuts), (bpm, cuts, true_cuts)
        for name_i in (3, 6, 7, 8, 9):                                  # CHORUS, CHORUS, BRIDGE, CHORUS, OUTRO
            assert min(abs(c - truth[name_i][1]) for c in cuts) < 0.5 * bar, (bpm, truth[name_i], cuts)
        labels = [s["label"] for s in est["sections"]]
        assert labels[0] == "INTRO" and labels[-1] == "OUTRO" and labels.count("CHORUS") == 3
        groups = {s["group"] for s in est["sections"] if s["label"] == "CHORUS"}
        assert len(groups) == 1, "the three choruses are the same material"


def test_a_bridge_can_be_called_a_pre_chorus_which_is_pulseframes_own_rule(tmp_path):
    """Documented limit, not a bug to hide: a short quiet section just before a chorus is labelled PRE-CHORUS by the ported rule."""
    f = tmp_path / "s.wav"
    write_song(f, SECTIONS_2, 100.0)
    labels = [s["label"] for s in audio.analyze(f)["sections"]]
    assert labels[-3] in ("BRIDGE", "PRE-CHORUS")


def test_labelling_rules_are_the_ported_ones():
    assert songmap.label_sections(list("ABCBCA"), [2, 7, 10, 7, 10, 1], [16, 16, 16, 16, 16, 8]) == ["INTRO", "VERSE", "CHORUS", "VERSE", "CHORUS", "OUTRO"]
    assert songmap.label_sections(list("AB"), [3, 9], [10, 10]) == ["INTRO", "CHORUS"]
    assert songmap.mood(2) == "Dreamlike" and songmap.mood(10) == "Celebratory"


# ------------------------------------------------------------------------------------------------ edge cases
def test_no_steady_beat_or_a_short_clip_gives_no_sections_and_does_not_fail(tmp_path):
    audio.make_click_track(tmp_path / "c.wav", bpm=120, seconds=12)
    r = audio.analyze(tmp_path / "c.wav")
    assert r["sections"] == [], "12 s is too short to have sections"
    noise = tmp_path / "n.wav"
    import random
    rng = random.Random(1)
    with wave.open(str(noise), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050)
        w.writeframes(struct.pack("<" + "h" * (22050 * 30), *[int(rng.gauss(0, 3000)) for _ in range(22050 * 30)]))
    r = audio.analyze(noise)
    assert isinstance(r["sections"], list) and isinstance(r["transients"], list)


def test_transients_are_the_sharp_attacks(tmp_path):
    audio.make_click_track(tmp_path / "c.wav", bpm=120, seconds=12)
    r = audio.analyze(tmp_path / "c.wav")
    times = [t["t"] for t in r["transients"]]
    assert 20 <= len(times) <= 26, "a click every 0.5 s for 12 s"
    assert all(min(abs(t - k * 0.5) for k in range(25)) < 0.04 for t in times)
    assert all(0 < t["strength"] <= 1 for t in r["transients"])


def test_no_clear_accent_means_the_first_beat_is_the_first():
    beats = [i * 0.5 for i in range(32)]
    flat = [1.0] * 2000
    assert songmap.downbeat_phase(beats, flat, 100) == 0
    accented = [0.0] * 2000
    for i, b in enumerate(beats):
        accented[int(b * 100)] = 5.0 if i % 4 == 2 else 1.0
    assert songmap.downbeat_phase(beats, accented, 100) == 2


# ------------------------------------------------------------------------------------------------ importing a Pulseframe SongMap
def test_a_real_pulseframe_songmap_with_lyrics_is_read_in_full():
    d = json.loads((FIX / "pulseframe_exit_plan.songmap.json").read_text())
    m = songmap.from_pulseframe(d)
    assert m["source"] == "pulseframe" and m["duration"] == 191.44 and abs(m["bpm"] - 120.18) < 0.01
    assert len(m["sections"]) == 10 and m["sections"][0]["label"] == "INTRO" and m["sections"][1]["group"] == "Verse 1"
    assert len(m["lyrics"]) == 64 and m["lyrics"][0] == {"text": "My mind dey pack bag", "start": 18.93, "end": 21.15, "section": "Verse 1"}
    assert m["lyricMatch"] == 0.827 and "whisper" in m["analyzer"] and m["warnings"] == []
    assert len(m["beats"]) == 384 and m["beats"] == sorted(m["beats"])
    assert all(a["end"] <= b["start"] + 1e-6 for a, b in zip(m["sections"], m["sections"][1:])), "sections do not overlap"


def test_the_synthetic_fixture_round_trips():
    m = songmap.from_pulseframe(json.loads((FIX / "pulseframe_synthetic.songmap.json").read_text()))
    assert [s["label"] for s in m["sections"]] == ["INTRO", "VERSE", "CHORUS", "VERSE", "CHORUS", "OUTRO"] and m["lyrics"] == [] and m["lyricMatch"] is None


def test_a_bad_songmap_is_refused_and_a_messy_one_is_cleaned_up():
    for bad in (None, [], "x", {}, {"schema_version": 2, "duration": 5}, {"schema_version": 1}, {"schema_version": 1, "duration": float("nan")},
                {"schema_version": 1, "duration": -3}, {"schema_version": 1, "duration": True}):
        with pytest.raises(songmap.SongMapError):
            songmap.from_pulseframe(bad)
    messy = {"schema_version": 1, "duration": 60, "bpm": 9999, "beats": [3, 1, 2, 2, "x", None, -5, 1e9, float("nan")] + [4.0] * 5,
             "sections": [{"start": 10, "end": 30, "label": "  verse  ", "group": "g" * 99, "energy": 42, "mood": "m" * 99},
                          {"start": 20, "end": 25, "label": "inside"},                      # swallowed by the one before
                          {"start": 28, "end": 55, "label": "chorus", "energy": -3},       # overlaps the first: clipped to start at 30
                          {"start": 5, "end": 1, "label": "backwards"}, {"start": "a", "end": 9}, "junk", {}],
             "lyrics": [{"text": "  hello   world ", "start": 1, "end": 2, "section": "Verse"}, {"text": "", "start": 1, "end": 2}, {"text": "back", "start": 5, "end": 4},
                        {"text": "late", "start": 61, "end": 70}, {"text": "x" * 500, "start": 3, "end": 4}],
             "energy_curve": [[1, 0.5], [2], [3, 9], "z", [4, 0.1]], "analyzer": "a" * 200}
    m = songmap.from_pulseframe(messy)
    assert m["bpm"] is None and m["beats"] == [1.0, 2.0, 3.0, 4.0]
    assert [(s["label"], s["start"], s["end"]) for s in m["sections"]] == [("VERSE", 10.0, 30.0), ("CHORUS", 30.0, 55.0)]
    assert len(m["sections"][0]["group"]) == 24 and m["sections"][0]["energy"] == 10 and m["sections"][1]["energy"] == 1 and len(m["sections"][0]["mood"]) == 24
    assert [l["text"][:11] for l in m["lyrics"]] == ["hello world", "x" * 11] and len(m["lyrics"][1]["text"]) == 200
    assert m["energyCurve"] == [[1.0, 0.5], [4.0, 0.1]] and len(m["analyzer"]) == 80 and len(m["warnings"]) >= 3


def test_huge_lists_are_capped():
    d = {"schema_version": 1, "duration": 36000, "beats": [i * 0.01 for i in range(50000)], "sections": [{"start": i, "end": i + 0.5, "label": "x"} for i in range(500)],
         "lyrics": [{"text": "t", "start": i, "end": i + 1} for i in range(5000)]}
    m = songmap.from_pulseframe(d)
    assert len(m["beats"]) == songmap.MAX_BEATS and len(m["sections"]) == songmap.MAX_SECTIONS and len(m["lyrics"]) == songmap.MAX_LYRICS
    assert any("Only the first" in w for w in m["warnings"])


# ------------------------------------------------------------------------------------------------ markers
def test_markers_carry_our_prefixes_and_only_ours_are_accepted():
    secs = [{"start": 16.0, "end": 32.0, "label": "VERSE", "group": "B"}, {"start": 32.0, "end": 48.0, "label": "CHORUS", "group": "Verse 1 long name"}]
    items = songmap.markers_for(beats=[0.5, 1.0], sections=secs, lyrics=[{"text": "Hello there", "start": 17.5, "end": 19}])
    assert [m["comment"] for m in items] == ["motioncraft:beat", "motioncraft:beat", "motioncraft:section:VERSE B", "motioncraft:lyric:Hello there", "motioncraft:section:CHORUS"]
    assert songmap.check_marker_items(items) == [{"time": m["time"], "comment": m["comment"]} for m in items]
    for bad in (None, [], [{"time": 1, "comment": "rm -rf"}], [{"time": -1, "comment": "motioncraft:beat"}], [{"time": 1e9, "comment": "motioncraft:beat"}], ["x"],
                [{"time": 1}], [{"time": 1, "comment": "motioncraft:other"}]):
        with pytest.raises(songmap.SongMapError):
            songmap.check_marker_items(bad)
    assert len(songmap.check_marker_items([{"time": 1, "comment": "motioncraft:lyric:" + "y" * 300}])[0]["comment"]) == 80


# ------------------------------------------------------------------------------------------------ the helper's methods
@pytest.fixture
def svc(tmp_path):
    s = Service(lambda pkg: MockAdapter(), data_dir=tmp_path / "data")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "assets" / "audio").mkdir(parents=True)
    s.handle("open", {"package": str(pkg), "settings": {"width": 640, "height": 360, "frame_rate": 30, "duration": 190}})
    s.pkg_path = pkg  # type: ignore[attr-defined]
    return s


def test_songmap_import_reads_only_songmaps_inside_the_project(svc):
    (svc.pkg_path / "assets" / "audio" / "imp-1-x.songmap.json").write_bytes((FIX / "pulseframe_exit_plan.songmap.json").read_bytes())
    m = svc.handle("songmap_import", {"rel": "assets/audio/imp-1-x.songmap.json"})
    assert len(m["sections"]) == 10 and len(m["lyrics"]) == 64
    (svc.pkg_path / "assets" / "audio" / "notes.json").write_text("{}")
    (svc.pkg_path / "assets" / "audio" / "bad.songmap.json").write_text("{ not json")
    (svc.pkg_path / "assets" / "audio" / "wrong.songmap.json").write_text(json.dumps({"schema_version": 9, "duration": 5}))
    (svc.pkg_path / "assets" / "audio" / "big.songmap.json").write_bytes(b" " * (5 * 1024 * 1024 + 1))
    for rel in ("assets/audio/notes.json", "../x.songmap.json", "/etc/a.songmap.json", "assets/images/a.songmap.json", "assets/audio/missing.songmap.json",
                "assets/audio/bad.songmap.json", "assets/audio/wrong.songmap.json", "assets/audio/big.songmap.json", "x.songmap.json"):
        with pytest.raises(AdapterError):
            svc.handle("songmap_import", {"rel": rel})


def test_section_and_lyric_markers_are_written_in_one_go_and_replace_the_old_ones(svc):
    secs = [{"start": 18.49, "end": 38.46, "label": "VERSE", "group": "A"}, {"start": 38.46, "end": 60.0, "label": "CHORUS", "group": "B"}]
    items = songmap.markers_for(beats=[1.0, 1.5], sections=secs, lyrics=[{"text": "My mind dey pack bag", "start": 18.93, "end": 21.15}])
    r = svc.handle("sync_labelled_markers", {"items": items, "replace": True})
    assert r == {"markers": 5, "replaced": True, "kinds": {"beat": 2, "section": 2, "lyric": 1}}
    comp = svc.a.inspect().comp(None)
    assert sorted((m.time, m.comment) for m in comp.markers) == sorted((m["time"], m["comment"]) for m in items)
    svc.handle("sync_labelled_markers", {"items": [{"time": 2.0, "comment": "motioncraft:beat"}], "replace": True})
    assert [m.time for m in svc.a.inspect().comp(None).markers] == [2.0]
    for bad in ([], [{"time": 1, "comment": "evil"}], "x", None):
        with pytest.raises(AdapterError):
            svc.handle("sync_labelled_markers", {"items": bad})
    assert [m.time for m in svc.a.inspect().comp(None).markers] == [2.0], "a refused write changes nothing"


def test_the_estimate_reaches_the_page_through_audio_analyze(tmp_path, svc):
    write_song(svc.pkg_path / "assets" / "audio" / "song.wav")
    r = svc.handle("audio_analyze", {"rel": "assets/audio/song.wav"})
    assert [s["label"] for s in r["sections"]] == ["INTRO", "VERSE", "CHORUS", "VERSE", "CHORUS", "OUTRO"]
    json.dumps(r)                                                   # everything in the answer is plain JSON
    assert math.isclose(r["duration"], 88.0, abs_tol=0.1) and r["downbeats"] and r["energyCurve"][0][0] == 0.0
