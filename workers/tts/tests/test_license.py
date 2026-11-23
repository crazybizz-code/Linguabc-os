import pytest

from linguabc_tts.license import LicenseError, check_weights_license


def card(tmp_path, front):
    (tmp_path / "README.md").write_text(f"---\n{front}\n---\n# Model\n", "utf-8")
    return tmp_path


def test_apache_weights_pass(tmp_path):
    assert check_weights_license(card(tmp_path, "license: apache-2.0\nlanguage: en")) == "apache-2.0"


def test_other_licence_refused(tmp_path):
    with pytest.raises(LicenseError, match="not allowed"):
        check_weights_license(card(tmp_path, "license: cc-by-nc-4.0"))


def test_missing_card_or_licence_refused(tmp_path):
    with pytest.raises(LicenseError, match="unverified"):
        check_weights_license(tmp_path)
    with pytest.raises(LicenseError, match="unverified"):
        check_weights_license(card(tmp_path, "language: en"))
