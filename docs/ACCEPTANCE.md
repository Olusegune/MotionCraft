# Acceptance

Automated tests run against the mock adapter in CI and against the real engine nightly. The golden-brief rubric runs
on every release. Both gate a release.

| AT | Test | Ticket |
| --- | --- | --- |
| 1 | Kinetic typography comp from a brief; all text native and editable | P2-08 |
| 2 | Title sequence from a script with a credits list | P2-08 |
| 3 | Music-synced sequence; every hit within ±1 frame of its marker | P3-03 |
| 4 | Lyric video from audio and lyrics, with word timing | P3-04 |
| 5 | Intent extraction: on 10 hand-labelled briefs, purpose, tone and primary emotion match on ≥ 8 | P1-08 |
| 6 | Raising energy 2 → 4 changes hold length and easing as the rule table specifies | P1-09 |
| 7 | A reference becomes a style profile with attribution and no instruction to copy a named designer | P2-06 |
| 8 | Changing the background leaves approved text layers unchanged (hash-verified) | P2-09 |
| 9 | A manual edit in EffectCraft is detected and logged, not overwritten | P4-06 |
| 10 | Agent command on a locked layer is refused | P2-09 |
| 11 | Missing-asset relinking | P4-02 / P5-03 |
| 12 | Missing-font detection | P4-02 |
| 13 | Interrupted render resumes from the last good frame | P5-02 |
| 14 | Transparent export (ProRes 4444) has correct alpha | P5-01 |
| 15 | Package reopens on a second machine | P5-03 |
| 16 | A project completes end to end with every stage on Manual and no AI provider configured | P1-05 … P5 |
| 17 | A project completes offline using only a local model and the Topaz CLI | P5-05 |
| 18 | When a sound provider fails, the router falls back or asks; no stage hangs | P3-05 |
| 19 | Topaz is never offered for text, vector or logo layers, or for the final render | P4-03 |

Fixtures: `engine/tests/fixtures/briefs/` (10 labelled briefs for AT-5), `make_test_song.py` (from Pulseframe) for
AT-3/4, a transparent-background comp for AT-14.

## Golden-brief rubric

10 fixed briefs across the v1 wedge in `golden/`, rendered each release. Two reviewers score each 1–5 on hierarchy,
timing, typography, intent fit and polish. **Release bar:** median ≥ 4 and no brief below 3. Store score sheets per
release in `golden/scores/<version>.csv`.
