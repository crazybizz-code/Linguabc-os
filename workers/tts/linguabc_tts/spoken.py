"""Written IELTS details -> the words a voice should say.

Real runs showed that the open models mishandle digits and symbols:
Qwen3-TTS Base cloning returned silence for "costs £185", "07946 328 150"
and "The number 36 bus" (the same lines in words worked), and Chatterbox
read "£185" as "185" and regrouped the phone number. Fish reads them
itself. So the worker rewrites them, the way an IELTS recording says them:

  £185           -> a hundred and eighty-five pounds
  £12.50         -> twelve pounds fifty
  07946 328 150  -> oh seven nine four six, three two eight, one five oh
  23rd           -> twenty-third
  7:45 / 4 pm    -> seven forty-five / four p.m.
  CB2 1TN        -> C B two, one T N
  1863           -> eighteen sixty-three (years 1100-2099 after "in", "since", "of", ...)
  42 / 38,000    -> forty-two / thirty-eight thousand

The transcript and the QA keep the written form: qa.normalize maps both to
the same words.
"""

from __future__ import annotations

import re

from .qa import number_words, ordinal_words

_DIGIT = ["oh", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
_CURRENCY = {"£": ("pound", "pounds", "pence"), "$": ("dollar", "dollars", "cents"), "€": ("euro", "euros", "cents")}


def _british(n: int) -> str:
    """'a hundred and eighty-five', as said aloud in British English."""
    words = number_words(n)
    words = re.sub(r"\b(hundred) (?!$)", r"\1 and ", words)
    words = re.sub(r"\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety) (one|two|three|four|five|six|seven|eight|nine)\b", r"\1-\2", words)
    return re.sub(r"^one (hundred|thousand)", r"a \1", words) if 100 <= n < 2000 else words


def _year(n: int) -> str:
    hi, lo = divmod(n, 100)
    if lo == 0:
        return f"{_british(hi)} hundred"
    return f"{_british(hi)} {'oh ' + number_words(lo) if lo < 10 else _british(lo)}"


def _digits(s: str) -> str:
    return " ".join(_DIGIT[int(c)] for c in s)


def to_spoken(text: str) -> str:
    t = text

    def money(m):
        one, many, small = _CURRENCY[m.group(1)]
        whole = int(m.group(2).replace(",", ""))
        out = f"{_british(whole)} {one if whole == 1 else many}"
        if m.group(3) and int(m.group(3)):
            out += f" {_british(int(m.group(3)))}"
        return out

    t = re.sub(r"([£$€])\s?(\d[\d,]*)(?:\.(\d{2}))?", money, t)
    # Phone numbers: a group starting with 0 followed by more groups.
    t = re.sub(r"\b0\d+(?:[ -]\d+)+\b", lambda m: ", ".join(_digits(g) for g in re.findall(r"\d+", m.group(0))), t)
    # UK postcodes: CB2 1TN, SW1A 1AA, BS3 2LR.
    t = re.sub(r"\b([A-Z]{1,2}\d[A-Z\d]?) (\d)([A-Z]{2})\b",
               lambda m: f"{_spell(m.group(1))}, {_DIGIT[int(m.group(2))] if m.group(2) != '0' else 'zero'} {' '.join(m.group(3))}", t)
    t = re.sub(r"\b(\d{1,2}):(\d{2})\b", lambda m: f"{_british(int(m.group(1)))} " + (
        "o'clock" if m.group(2) == "00" else (f"oh {number_words(int(m.group(2)))}" if m.group(2)[0] == "0" else _british(int(m.group(2))))), t)
    t = re.sub(r"\b(\d{1,2}) ?(am|pm|a\.m\.|p\.m\.)", lambda m: f"{_british(int(m.group(1)))} {'a.m.' if m.group(2)[0] == 'a' else 'p.m.'}", t)
    t = re.sub(r"\b(\d+)(st|nd|rd|th)\b", lambda m: ordinal_words(int(m.group(1))).replace("twenty ", "twenty-").replace("thirty ", "thirty-"), t)
    t = re.sub(r"\b(in|since|from|of|by|until|before|after|around|January|February|March|April|May|June|July|August|September|October|November|December),? (1[1-9]\d\d|20\d\d)\b",
               lambda m: f"{m.group(1)} {_year(int(m.group(2)))}", t)
    t = re.sub(r"\b\d{1,3}(?:,\d{3})+\b", lambda m: _british(int(m.group(0).replace(",", ""))), t)
    t = re.sub(r"\b(\d+)%", lambda m: f"{_british(int(m.group(1)))} percent", t)
    t = re.sub(r"\b\d+\b", lambda m: _digits(m.group(0)) if len(m.group(0)) > 6 else _british(int(m.group(0))), t)
    return t.replace("p.m..", "p.m.").replace("a.m..", "a.m.")


def _spell(code: str) -> str:
    return " ".join(_DIGIT[int(c)] if c.isdigit() and c != "0" else ("zero" if c == "0" else c) for c in code)
