import numpy as np

from linguabc_tts.prosody import compare, measure, pitch_track

SR = 16000


def tone(hz_start, hz_end, seconds=1.5, amp=0.3):
    t = np.arange(int(SR * seconds)) / SR
    f = np.linspace(hz_start, hz_end, t.size)
    return (amp * np.sin(2 * np.pi * np.cumsum(f) / SR)).astype(np.float32)


def test_pitch_of_a_steady_tone():
    f0 = pitch_track(tone(150, 150), SR)
    assert abs(np.median(f0[f0 > 0]) - 150) < 5


def test_rising_end_and_range():
    flat, rising = measure(tone(150, 150), SR), measure(tone(150, 220), SR)
    assert rising.f0_end_rise_st > 2 and abs(flat.f0_end_rise_st) < 0.5
    assert rising.f0_range_st > flat.f0_range_st


def test_compare_flags_the_expected_direction():
    neutral = measure(tone(150, 150), SR)
    assert compare("curious", neutral, measure(tone(150, 230), SR))["measurable_effect"]
    assert compare("excited", neutral, measure(tone(190, 190, amp=0.6), SR))["measurable_effect"]
    assert not compare("excited", neutral, measure(tone(150, 150), SR))["measurable_effect"]


def test_silence_measures_nothing():
    p = measure(np.zeros(SR, dtype=np.float32), SR)
    assert p.voiced_ratio == 0
