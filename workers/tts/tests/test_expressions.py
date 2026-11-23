import re
from pathlib import Path

from linguabc_tts.expressions import EXPERIMENTAL, INSTRUCTIONS, split_expressions, strip_tags

SCRIPT_TS = Path(__file__).resolve().parents[3] / "src/lib/ai/script.ts"


def ts_expressions():
    src = SCRIPT_TS.read_text("utf-8")
    block = re.search(r"export const EXPRESSIONS = \[(.*?)\] as const", src, re.S).group(1)
    return re.findall(r'"([^"]+)"', block)


def test_every_app_tag_has_an_instruction():
    tags = ts_expressions()
    assert len(tags) == 31
    assert set(tags) == set(INSTRUCTIONS), set(tags) ^ set(INSTRUCTIONS)


def test_examples_from_the_brief():
    assert INSTRUCTIONS["excited"][0] == "Speak with excitement and high energy."
    assert INSTRUCTIONS["curious"][0] == "Speak with genuine curiosity."
    assert INSTRUCTIONS["serious"][0] == "Speak in a calm and serious tone."
    assert INSTRUCTIONS["whispering"][0] == "Speak in a soft whisper."


def test_non_verbal_tags_are_marked_experimental():
    for tag in ("laughing", "whispering", "shouting", "sighing"):
        assert INSTRUCTIONS[tag][1] == EXPERIMENTAL


def test_turn_is_cut_at_each_tag():
    pieces, notes = split_expressions("Oh. [surprised] Really? [laughing] I had no idea!")
    assert [(p.text, p.tag) for p in pieces] == [("Oh.", None), ("Really?", "surprised"), ("I had no idea!", "laughing")]
    assert pieces[1].instruct == "Speak with genuine surprise."
    assert notes.experimental == ["laughing"]


def test_unknown_tag_is_dropped_and_reported():
    pieces, notes = split_expressions("[robotic] Beep boop.")
    assert [(p.text, p.tag, p.instruct) for p in pieces] == [("Beep boop.", None, None)]
    assert notes.unsupported == ["robotic"]


def test_voice_without_instruct_drops_tags():
    pieces, notes = split_expressions("[excited] Hi! [sad] Bye.", voice_takes_instruct=False)
    assert [(p.text, p.instruct) for p in pieces] == [("Hi! Bye.", None)]
    assert notes.dropped_no_instruct == ["excited", "sad"]


def test_tags_never_reach_the_words():
    pieces, _ = split_expressions("[excited] Welcome to LinguABC!")
    assert pieces[0].text == "Welcome to LinguABC!"
    assert strip_tags("[curious] Have you ever wondered why?") == "Have you ever wondered why?"
