#!/usr/bin/env python3
import ctypes
import ctypes.util
import json
import math
import sys
from dataclasses import dataclass

import numpy as np
import soundfile as sf
from scipy.fftpack import dct
from scipy.signal import resample_poly

SAMPLE_RATE = 16000
ESPEAK_CHARS_UTF8 = 1
ESPEAK_EVENT_PHONEME = 7


class EventId(ctypes.Union):
    _fields_ = [("number", ctypes.c_int), ("name", ctypes.c_char * 8), ("string", ctypes.c_char * 8)]


class EspeakEvent(ctypes.Structure):
    _fields_ = [
        ("type", ctypes.c_int),
        ("unique_identifier", ctypes.c_uint),
        ("text_position", ctypes.c_int),
        ("length", ctypes.c_int),
        ("audio_position", ctypes.c_int),
        ("sample", ctypes.c_int),
        ("user_data", ctypes.c_void_p),
        ("id", EventId),
    ]


CALLBACK = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.POINTER(EspeakEvent))


@dataclass
class Phoneme:
    label: str
    text_position: int
    start_sample: int


class Espeak:
    def __init__(self):
        library = ctypes.util.find_library("espeak-ng") or ctypes.util.find_library("espeak")
        if not library:
            raise RuntimeError("eSpeak NG is unavailable")
        self.library = ctypes.CDLL(library)
        self.library.espeak_Initialize.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
        self.library.espeak_Initialize.restype = ctypes.c_int
        self.library.espeak_SetVoiceByName.argtypes = [ctypes.c_char_p]
        self.library.espeak_SetVoiceByName.restype = ctypes.c_int
        self.library.espeak_SetSynthCallback.argtypes = [CALLBACK]
        self.library.espeak_SetSynthCallback.restype = None
        self.library.espeak_Synth.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint, ctypes.c_int,
                                              ctypes.c_uint, ctypes.c_uint, ctypes.POINTER(ctypes.c_uint), ctypes.c_void_p]
        self.library.espeak_Synth.restype = ctypes.c_int
        self.library.espeak_Synchronize.argtypes = []
        self.library.espeak_Synchronize.restype = ctypes.c_int
        self.sample_rate = self.library.espeak_Initialize(1, 0, None, 1)
        if self.sample_rate <= 0 or self.library.espeak_SetVoiceByName(b"te") != 0:
            raise RuntimeError("Could not initialize eSpeak NG Telugu")
        self.samples = []
        self.phonemes = []

        @CALLBACK
        def callback(wav, count, events):
            if count > 0 and wav:
                self.samples.append(np.ctypeslib.as_array(wav, shape=(count,)).copy())
            index = 0
            while events and events[index].type != 0:
                event = events[index]
                if event.type == ESPEAK_EVENT_PHONEME:
                    label = bytes(event.id.name).split(b"\0", 1)[0].decode("ascii", "replace")
                    if label and label != "_":
                        self.phonemes.append(Phoneme(label, max(0, event.text_position - 1), max(0, event.sample)))
                index += 1
            return 0

        self.callback = callback
        self.library.espeak_SetSynthCallback(self.callback)

    def synthesize(self, text):
        self.samples = []
        self.phonemes = []
        encoded = text.encode("utf-8") + b"\0"
        identifier = ctypes.c_uint(0)
        buffer = ctypes.create_string_buffer(encoded)
        status = self.library.espeak_Synth(buffer, len(encoded), 0, 1, 0, ESPEAK_CHARS_UTF8,
                                           ctypes.byref(identifier), None)
        if status != 0 or self.library.espeak_Synchronize() != 0:
            raise RuntimeError("eSpeak NG synthesis failed")
        samples = np.concatenate(self.samples).astype(np.float32) / 32768.0 if self.samples else np.zeros(1, dtype=np.float32)
        if self.sample_rate != SAMPLE_RATE:
            divisor = math.gcd(self.sample_rate, SAMPLE_RATE)
            samples = resample_poly(samples, SAMPLE_RATE // divisor, self.sample_rate // divisor).astype(np.float32)
            scale = SAMPLE_RATE / self.sample_rate
            phonemes = [Phoneme(value.label, value.text_position, round(value.start_sample * scale)) for value in self.phonemes]
        else:
            phonemes = list(self.phonemes)
        return samples, phonemes


def load_audio(path, start_seconds=None, end_seconds=None):
    samples, rate = sf.read(path, dtype="float32", always_2d=True)
    samples = samples.mean(axis=1)
    if rate != SAMPLE_RATE:
        divisor = math.gcd(rate, SAMPLE_RATE)
        samples = resample_poly(samples, SAMPLE_RATE // divisor, rate // divisor).astype(np.float32)
    start = 0 if start_seconds is None else max(0, round(start_seconds * SAMPLE_RATE))
    end = len(samples) if end_seconds is None else min(len(samples), round(end_seconds * SAMPLE_RATE))
    if end <= start:
        raise ValueError("Audio interval is empty")
    return samples[start:end]


def trim(samples):
    peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
    if peak <= 1e-6:
        return samples, 0
    active = np.flatnonzero(np.abs(samples) >= max(peak * 0.015, 1e-4))
    if not len(active):
        return samples, 0
    padding = round(0.012 * SAMPLE_RATE)
    start = max(0, int(active[0]) - padding)
    end = min(len(samples), int(active[-1]) + padding + 1)
    return samples[start:end], start


def hz_to_mel(value):
    return 2595.0 * np.log10(1.0 + value / 700.0)


def mel_to_hz(value):
    return 700.0 * (10.0 ** (value / 2595.0) - 1.0)


def mfcc(samples, hop_ms):
    frame_length = round(SAMPLE_RATE * 0.025)
    frame_step = round(SAMPLE_RATE * hop_ms / 1000)
    if len(samples) < frame_length:
        samples = np.pad(samples, (0, frame_length - len(samples)))
    frame_count = 1 + math.ceil((len(samples) - frame_length) / frame_step)
    padded_length = (frame_count - 1) * frame_step + frame_length
    padded = np.pad(samples, (0, max(0, padded_length - len(samples))))
    indices = np.arange(frame_length)[None, :] + np.arange(frame_count)[:, None] * frame_step
    frames = padded[indices] * np.hamming(frame_length)
    spectrum = np.abs(np.fft.rfft(frames, 512)) ** 2 / 512
    mel_points = np.linspace(hz_to_mel(0), hz_to_mel(SAMPLE_RATE / 2), 28)
    bins = np.floor((513 * mel_to_hz(mel_points)) / SAMPLE_RATE).astype(int)
    filters = np.zeros((26, 257), dtype=np.float32)
    for index in range(1, 27):
        left, center, right = bins[index - 1:index + 2]
        if center > left:
            filters[index - 1, left:center] = (np.arange(left, center) - left) / (center - left)
        if right > center:
            filters[index - 1, center:right] = (right - np.arange(center, right)) / (right - center)
    energies = np.maximum(spectrum @ filters.T, np.finfo(float).eps)
    features = dct(np.log(energies), type=2, axis=1, norm="ortho")[:, 1:13]
    deviation = features.std(axis=0)
    return ((features - features.mean(axis=0)) / np.where(deviation < 1e-6, 1, deviation)).astype(np.float32)


def cosine(left, right):
    denominator = np.linalg.norm(left) * np.linalg.norm(right)
    return 1.0 if denominator <= 1e-12 else 1.0 - float(np.dot(left, right) / denominator)


def dtw_mapping(reference, recording):
    rows, columns = len(reference), len(recording)
    if not rows or not columns:
        raise ValueError("Audio produced no acoustic frames")
    width = max(abs(columns - rows) + 8, math.ceil(max(rows, columns) * 0.18))
    starts = []
    predecessors = []
    previous = np.full(columns, np.inf, dtype=np.float64)
    for row in range(rows):
        center = 0 if rows == 1 else round(row * (columns - 1) / (rows - 1))
        start = max(0, center - width)
        end = min(columns, center + width + 1)
        current = np.full(columns, np.inf, dtype=np.float64)
        choices = np.full(end - start, -1, dtype=np.int8)
        for column in range(start, end):
            distance = cosine(reference[row], recording[column])
            if row == 0 and column == 0:
                current[column] = distance
                choices[column - start] = 0
                continue
            candidates = (
                previous[column - 1] + distance * 2 if row and column else np.inf,
                previous[column] + distance if row else np.inf,
                current[column - 1] + distance if column > start else np.inf,
            )
            direction = int(np.argmin(candidates))
            current[column] = candidates[direction]
            choices[column - start] = direction
        starts.append(start)
        predecessors.append(choices)
        previous = current
    if not np.isfinite(previous[columns - 1]):
        raise ValueError("Could not find an alignment path")
    pairs = []
    row, column = rows - 1, columns - 1
    while True:
        pairs.append((row, column))
        if row == 0 and column == 0:
            break
        direction = predecessors[row][column - starts[row]]
        if direction == 0:
            row -= 1
            column -= 1
        elif direction == 1:
            row -= 1
        elif direction == 2:
            column -= 1
        else:
            raise ValueError("Alignment path is incomplete")
    pairs.reverse()
    mapping = np.zeros(rows, dtype=np.float64)
    grouped = [[] for _ in range(rows)]
    for ref, real in pairs:
        grouped[ref].append(real)
    known_x, known_y = [], []
    for index, values in enumerate(grouped):
        if values:
            known_x.append(index)
            known_y.append(float(np.median(values)))
    mapping[:] = np.interp(np.arange(rows), known_x, known_y)
    return mapping


def project_boundary(mapping, seconds, hop_ms, recording_duration):
    frame = seconds / (hop_ms / 1000.0) - 0.5
    projected = np.interp(frame, np.arange(len(mapping)), mapping)
    value = (projected + 0.5) * hop_ms / 1000.0
    return round(max(0.0, min(recording_duration, value)), 6)


def ordered_intervals(items, duration):
    previous = 0.0
    output = []
    for index, item in enumerate(items):
        start = max(previous, float(item["startSeconds"]))
        end = max(start + 0.001, float(item["endSeconds"]))
        end = min(duration, end)
        if end <= start:
            start = max(0.0, min(duration - 0.001, start))
            end = min(duration, start + 0.001)
        status = item.get("status", "estimated")
        if end - start < 0.025:
            status = "needs_review"
        output.append({**item, "index": index, "startSeconds": round(start, 6), "endSeconds": round(end, 6), "status": status})
        previous = end
    return output


def align_sentence(request, speaker):
    real = load_audio(request["audioPath"])
    pieces = []
    boundaries = []
    cursor = 0
    for word in request["words"]:
        audio, _ = speaker.synthesize(word["text"])
        audio, _ = trim(audio)
        if len(audio) < round(0.02 * SAMPLE_RATE):
            raise ValueError("Synthetic word is empty")
        start = cursor / SAMPLE_RATE
        pieces.append(audio)
        cursor += len(audio)
        boundaries.append((start, cursor / SAMPLE_RATE))
    reference = np.concatenate(pieces)
    hop_ms = 10
    mapping = dtw_mapping(mfcc(reference, hop_ms), mfcc(real, hop_ms))
    duration = len(real) / SAMPLE_RATE
    words = []
    for word, (start, end) in zip(request["words"], boundaries):
        words.append({
            "index": word["index"], "text": word["text"],
            "startSeconds": project_boundary(mapping, start, hop_ms, duration),
            "endSeconds": project_boundary(mapping, end, hop_ms, duration),
            "status": "estimated",
        })
    return {"words": ordered_intervals(words, duration)}


def phoneme_unit_index(position, units):
    cursor = 0
    for unit in units:
        end = cursor + len(unit["text"])
        if cursor <= position < end:
            return unit["index"]
        cursor = end
    return len(units) - 1


def align_word(request, speaker):
    real = load_audio(request["audioPath"], request["startSeconds"], request["endSeconds"])
    synthetic, phonemes = speaker.synthesize(request["word"])
    synthetic, trim_start = trim(synthetic)
    adjusted = [Phoneme(value.label, value.text_position, max(0, value.start_sample - trim_start))
                for value in phonemes if value.start_sample < trim_start + len(synthetic)]
    hop_ms = 5
    mapping = dtw_mapping(mfcc(synthetic, hop_ms), mfcc(real, hop_ms))
    duration = len(real) / SAMPLE_RATE
    phoneme_rows = []
    for index, phoneme in enumerate(adjusted):
        end_sample = adjusted[index + 1].start_sample if index + 1 < len(adjusted) else len(synthetic)
        if end_sample <= phoneme.start_sample:
            continue
        phoneme_rows.append({
            "referenceLabel": phoneme.label,
            "textPosition": phoneme.text_position,
            "startSeconds": project_boundary(mapping, phoneme.start_sample / SAMPLE_RATE, hop_ms, duration),
            "endSeconds": project_boundary(mapping, end_sample / SAMPLE_RATE, hop_ms, duration),
        })
    units = request["writtenUnits"]
    grouped = [[] for _ in units]
    for phoneme in phoneme_rows:
        grouped[phoneme_unit_index(phoneme["textPosition"], units)].append(phoneme)
    needs_review = False
    written = []
    fallback_edges = np.linspace(0, duration, len(units) + 1)
    for index, unit in enumerate(units):
        values = grouped[index]
        if values:
            start = min(value["startSeconds"] for value in values)
            end = max(value["endSeconds"] for value in values)
        else:
            needs_review = True
            start, end = fallback_edges[index:index + 2]
        written.append({"index": index, "text": unit["text"], "startSeconds": start, "endSeconds": end,
                        "status": "needs_review" if not values else "estimated"})
    written = ordered_intervals(written, duration)
    return {
        "status": "needs_review" if needs_review or any(row["status"] == "needs_review" for row in written) else "estimated",
        "writtenUnits": written,
        "phonemes": [{key: value for key, value in row.items() if key != "textPosition"} for row in phoneme_rows],
    }


def main():
    request = json.load(sys.stdin)
    speaker = Espeak()
    if request.get("operation") == "sentence":
        result = align_sentence(request, speaker)
    elif request.get("operation") == "word":
        result = align_word(request, speaker)
    else:
        raise ValueError("Unknown alignment operation")
    json.dump(result, sys.stdout, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
