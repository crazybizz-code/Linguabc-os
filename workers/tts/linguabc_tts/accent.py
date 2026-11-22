"""Automatic accent signal: CommonAccent ECAPA (speechbrain), MIT licence.

Jzuluaga/accent-id-commonaccent_ecapa classifies English speech into 16
accents (england, us, canada, australia, indian, scotland, ireland, ...),
trained on Common Voice. It is a screening aid, not a verdict: it was
trained on real people, not synthetic voices, and people still decide
whether a voice "sounds British" (see the blind review).

We report, per clip: the top accent, its probability, and the three
groups IELTS cares about: british (england+scotland+wales+ireland),
american (us+canada), australian (australia+newzealand).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

GROUPS = {
    "british": ("england", "scotland", "wales", "ireland"),
    "american": ("us", "canada"),
    "australian": ("australia", "newzealand"),
}


class AccentClassifier:
    def __init__(self, model_dir: str | Path, savedir: str | Path | None = None):
        from speechbrain.inference.classifiers import EncoderClassifier

        model_dir = str(model_dir)
        self.model = EncoderClassifier.from_hparams(
            source=model_dir, savedir=str(savedir or Path(model_dir) / "_sb"),
            overrides={"pretrained_path": model_dir}, run_opts={"device": "cpu"})
        self.labels = [self.model.hparams.label_encoder.decode_ndim(i) for i in range(len(self.model.hparams.label_encoder))]

    def scores(self, audio: np.ndarray, sr: int) -> dict:
        import torch

        from .audio import resample

        if audio.size < sr * 0.5:
            return {"top": None, "top_p": 0.0, "groups": {g: 0.0 for g in GROUPS}, "group": None}
        wav = torch.from_numpy(resample(audio, sr, 16000)).unsqueeze(0)
        scores, _, _, _ = self.model.classify_batch(wav)
        # The ECAPA classifier returns cosine scores (AM-softmax head, scale 30).
        probs = torch.softmax(30 * scores[0], dim=-1).detach().numpy()
        by = {self.labels[i]: float(probs[i]) for i in range(len(self.labels))}
        top = max(by, key=by.get)
        groups = {g: round(sum(by.get(a, 0.0) for a in members), 3) for g, members in GROUPS.items()}
        return {"top": top, "top_p": round(by[top], 3), "groups": groups,
                "group": max(groups, key=groups.get)}
