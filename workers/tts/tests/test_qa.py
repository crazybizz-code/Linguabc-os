import numpy as np

from linguabc_tts import audio as A
from linguabc_tts.qa import (critical_spans, repeated_phrases, missing_answers, missing_spans, normalize, ordinal_words,
                             speaker_consistency, wer)


def test_numbers_money_dates_times_normalise_alike():
    assert normalize("It costs £12.50.") == normalize("it costs twelve pounds fifty")
    assert normalize("on the 23rd of March") == normalize("on the twenty-third of March")
    assert normalize("at 7:45") == normalize("at seven forty-five")
    assert normalize("double three") == ["three", "three"]
    assert ordinal_words(1) == "first" and ordinal_words(12) == "twelfth" and ordinal_words(40) == "fortieth"


def test_spelling_in_any_form():
    target = normalize("That's S-M-Y-T-H-E.")
    assert normalize("That's S M Y T H E") == target
    assert normalize("that's smythe") == target


def test_wer():
    assert wer("The train leaves from platform four.", "the train leaves from platform 4") == 0
    assert wer("one two three four", "one two four") == 0.25
    assert wer("", "") == 0


def test_critical_spans_and_misses():
    line = "Call me on the 23rd of March at 7:45, it's £12.50, surname S-M-Y-T-H-E, room 204."
    kinds = [s.kind for s in critical_spans(line)]
    assert kinds == ["date", "time", "money", "spelling", "number"]
    heard = "call me on the twenty third of march at seven forty five it's twelve pounds fifty surname s m y t h room two hundred four"
    assert [s.kind for s in missing_spans(line, heard)] == ["spelling"]


def test_answer_bearing_words():
    transcript = "the train leaves from platform four and the ticket costs eight pounds"
    assert missing_answers([["four", "4"], ["£8"], ["Smythe"]], transcript) == [["Smythe"]]


def test_clipping_and_silence():
    sr = 24000
    tone = (0.5 * np.sin(np.linspace(0, 2000, sr))).astype(np.float32)
    assert A.clipping_ratio(tone) == 0
    assert A.clipping_ratio(np.clip(tone * 4, -1, 1)) > 0.1
    gap = np.concatenate([tone, A.silence(2.0, sr), tone])
    assert 1.9 <= A.longest_silence(gap, sr) <= 2.1
    padded = np.concatenate([A.silence(1.0, sr), tone, A.silence(1.0, sr)])
    assert abs(A.trim(padded, sr).size / sr - 1.0) < 0.15


def test_speaker_consistency():
    a = np.array([1.0, 0.0, 0.0])
    s = speaker_consistency({"Ryan": [a, a * 2, np.array([0.9, 0.1, 0.0])], "Aiden": [a]})
    assert s["Ryan"] > 0.95 and s["Aiden"] is None
    drift = speaker_consistency({"Ryan": [a, np.array([0.0, 1.0, 0.0])]})
    assert drift["Ryan"] < 0.8


def test_loudness_normalisation_and_mp3():
    sr = 24000
    quiet = (0.05 * np.sin(np.linspace(0, 6000, sr * 3))).astype(np.float32)
    out, before = A.normalize_loudness(quiet, sr)
    after = A.measure_loudness(out, sr)
    assert before["input_i"] < -25
    assert abs(after["input_i"] - A.TARGET_LUFS) <= 1.0
    mp3 = A.encode_mp3(out, sr)
    assert mp3[:3] != b"ID3" and (mp3[0] == 0xFF)
    assert abs(A.decode_mp3(mp3, sr).size / sr - 3.0) < 0.15


def test_respelled_words_match_what_asr_hears():
    assert wer("This is an eye-elts Listening test.", "This is an IELTS listening test.") == 0


def test_real_asr_spellings_from_the_pilot():
    # Seen with faster-whisper on real Qwen audio (2026-11-22).
    assert wer("Check-in is from 2 pm, and check-out is at 11 am.", "Check-in is from 2 p.m. and checkout is at 11 a.m.") == 0
    assert wer("Thank you, Ms Thompson. The room is £95 a night.", "Thank you, Miss Thompson. The room is 95 pounds a night.") == 0
    assert normalize("the twenty-third of March") == normalize("the 23rd of March")
    assert wer("what time is check-in?", "what time is checking?") > 0  # a real difference: listen


def test_looped_ending_is_caught():
    said = "The trains were pulled by steam engines, so the tunnels were often full of smoke."
    assert repeated_phrases(said, said + " of smoke.") == ["of smoke"]
    assert repeated_phrases(said, said) == []
    assert repeated_phrases("It was very, very cold.", "It was very very cold.") == []


def test_phone_numbers_and_spoken_hundreds():
    assert wer("It's oh-seven-seven-nine-three, four-six-one, two-five-eight.", "It's 07793 461 258.") == 0
    assert wer("or a hundred and ninety pounds for the year", "or £190 for the year") == 0
    assert wer("It's flat four, twenty-seven Mill Street.", "It's flat 4, 27 Mill Street.") == 0


def test_postcodes_and_codes():
    # Seen on the real section run: script "B-S-three, two-L-R", ASR "BS3-2LR".
    assert wer("It's B-S-three, two-L-R.", "It's BS3-2LR.") == 0
    assert wer("It's B-S-three, two-L-R.", "It's BS3 2LR.") == 0
    assert normalize("the 23rd of March") == normalize("the twenty-third of March")


def test_phone_number_is_one_span():
    # Real ASR output on Qwen audio (2026-11-22).
    assert missing_spans("You can reach me on 07946 328 150, any time after 4 pm.",
                         "You can reach me on 07-946-328-150 anytime after 4 p.m.") == []


def test_postcode_written_with_a_dot():
    # Real ASR output on Chatterbox Turbo audio (2026-11-22).
    assert wer("the postcode is CB2 1TN.", "the postcode is CB2.1TN.") == 0
    assert wer("It costs 2.5 pounds.", "It costs two point five pounds.") == 0


def test_date_answers_match_how_they_are_said():
    said = "Tom: it starts on the twenty-third of March and ends on April the fifth"
    for forms in (["23rd March"], ["23 March"], ["March 23"], ["the 23rd of March"], ["5 April"], ["April 5th"]):
        assert missing_answers([forms], said) == [], forms
    assert missing_answers([["24 March"]], said) == [["24 March"]]
    assert missing_answers([["23 May"]], said) == [["23 May"]]


def test_british_dotted_times_are_times_not_decimals():
    assert normalize("The library opens at 9.30 in the morning") == normalize("The library opens at nine thirty in the morning")
    assert normalize("10.15 am") == normalize("ten fifteen am")
    assert normalize("it measured 6.4 metres") == ["it", "measured", "six", "point", "four", "meters"]  # still a decimal (metres = meters)


def test_years_after_a_time_word_match_how_asr_writes_them():
    assert normalize("which was built in 1860") == normalize("which was built in eighteen sixty")
    assert normalize("since 1999") == normalize("since nineteen ninety-nine")
    assert normalize("1860 people came")[:3] != ["eighteen", "sixty", "people"]  # a count stays a number


def test_british_spelling_matches_what_asr_writes():
    assert wer("the old harbour, built in eighteen sixty", "the Old Harbor, built in 1860") == 0
    assert missing_answers([["colour"], ["city centre"], ["theatre programme"]], "the color of the city center theater program") == []
    assert missing_answers([["Smythe"]], "it is smith") == [["Smythe"]]  # names are not respelled
