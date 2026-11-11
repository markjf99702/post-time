# What Python Piper makes of the lines the caller's downloaded voice is checked on, as test/joe.fixture.json:
#   node tools/joe-lines.mjs > lines.json
#   python tools/joe-reference.py <folder with en_US-joe-medium.onnx and its .json> lines.json test/joe.fixture.json
# Needs piper-tts (pip install piper-tts; this was made with 1.8.0, which made the clips the voice was chosen
# from). For each line: the numbers Piper feeds the voice's model, a sentence at a time (each sentence's
# as base64, one byte a number). For the line the menu's Hear it says: how long Piper's own sound of it
# runs at the speed Hear it uses, each sentence cut to its speech and the sentences set 200 ms apart, the
# way the clips were made (the model draws at random, so it's the middle of several goes, with the range).
import base64, json, statistics, sys
from importlib.metadata import version
from pathlib import Path
import numpy as np
from piper import PiperVoice, SynthesisConfig
from piper.phonemize_espeak import EspeakPhonemizer
from piper.phoneme_ids import phonemes_to_ids

folder, lines_path, out_path = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
SPEED, GOES = 1.3, 15  # JOE.opens in js/joe.js
src = json.load(open(lines_path, encoding='utf-8'))
voice = PiperVoice.load(folder / 'en_US-joe-medium.onnx')
cfg = voice.config
phonemizer = EspeakPhonemizer()
lines = []
for text in src['lines']:
    sentences = phonemizer.phonemize(cfg.espeak_voice, text, vowel_clusters=cfg.vowel_clusters)
    ids = [phonemes_to_ids(s, cfg.phoneme_id_map) for s in sentences if s]
    assert all(0 <= i < 256 for s in ids for i in s)
    lines.append([text] + [base64.b64encode(bytes(s)).decode() for s in ids])

def seconds(text, speed):
    rate, before, after, between = cfg.sample_rate, 0.040, 0.080, 0.200
    total, last_trail = 0.0, None
    for chunk in voice.synthesize(text, SynthesisConfig(length_scale=cfg.length_scale / speed)):
        a = np.abs(chunk.audio_int16_array.astype(np.int32))
        loud = np.nonzero(a > max(a.max() * 0.01, 40))[0]
        first, last = int(loud[0]), int(loud[-1])
        start, end = max(0, first - int(before * rate)), min(len(a), last + 1 + int(after * rate))
        lead, trail = (first - start) / rate, (end - 1 - last) / rate
        if last_trail is not None: total += max(0.0, between - last_trail - lead)
        total += (end - start) / rate
        last_trail = trail
    return total

goes = sorted(seconds(src['sample'], SPEED) for _ in range(GOES))
json.dump({
    'made': f'tools/joe-reference.py, piper-tts {version("piper-tts")}', 'voice': 'en_US-joe-medium', 'races': src['races'],
    'sample': {'text': src['sample'], 'speed': SPEED, 'seconds': round(statistics.median(goes), 3), 'least': round(goes[0], 3), 'most': round(goes[-1], 3), 'goes': GOES},
    'lines': lines,
}, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(lines), 'lines,', sum(len(l) - 1 for l in lines), 'sentences; the sample runs', goes[0], 'to', goes[-1], 'seconds')
