from linguabc_tts.qa import wer
from linguabc_tts.spoken import to_spoken

CASES = {
    "It costs £185 in total.": "It costs a hundred and eighty-five pounds in total.",
    "It's £12.50.": "It's twelve pounds fifty.",
    "Call 07946 328 150, after 4 pm.": "Call oh seven nine four six, three two eight, one five oh, after four p.m.",
    "The postcode is CB2 1TN.": "The postcode is C B two, one T N.",
    "on the 23rd of March": "on the twenty-third of March",
    "at 7:45 from platform 9": "at seven forty-five from platform nine",
    "on the 10th of January 1863": "on the tenth of January eighteen sixty-three",
    "38,000 passengers": "thirty-eight thousand passengers",
    "The number 36 bus": "The number thirty-six bus",
}


def test_ielts_details_become_words():
    for written, said in CASES.items():
        assert to_spoken(written) == said, written


def test_qa_treats_written_and_spoken_alike():
    for written, said in CASES.items():
        if "1863" not in written:
            assert wer(written, said) == 0, written


def test_spoken_mode_changes_what_the_engine_hears(tmp_path):
    from linguabc_tts.cache import SegmentCache
    from linguabc_tts.engines import FakeEngine
    from linguabc_tts.pipeline import render
    from linguabc_tts.plan import parse_request
    from linguabc_tts.qa import FakeTranscriber

    engine = FakeEngine()
    req = parse_request({"version": 1, "scope": "platform", "plan": [{"kind": "speech", "voice": "Ryan", "text": "It costs £185 in total."}]})
    res = render(req, engine, FakeTranscriber(engine), SegmentCache(tmp_path), spoken=True)
    assert engine.calls[0][0] == "It costs a hundred and eighty-five pounds in total."
    assert res.ok  # QA compared the spoken words with the written script


def test_long_spellings_are_said_in_groups_of_three():
    assert to_spoken("Sure. It's P-R-I-T-C-H-A-R-D.") == "Sure. It's P-R-I. T-C-H. A-R-D."
    assert to_spoken("It's W-H-I-T-F-I-E-L-D, with one L.") == "It's W-H-I. T-F-I. E-L-D, with one L."
    assert to_spoken("S-M-I-T-H") == "S-M-I-T-H"  # short ones stay as they are
