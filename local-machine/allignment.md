Implement this as two operations sharing the same TTS + DTW alignment engine. Both run locally.

align_sentence(audio, transcript) -> word_alignments
align_word(word_audio, word_text, sentence_offset=0) -> sound_and_letter_alignments

The second operation can take one word returned by the first.

1. Sentence audio + transcript → aligned words

Input:

{
  "audio_path": "sentence.wav",
  "transcript": "ఈ దంపతులు తమ బిడ్డ కోసం దత్తత తీసుకునే ప్రక్రియను ఎంచుకోవచ్చు"
}

Processing:

1. Load the recording. Convert it to mono, 16 kHz audio.
2. Split the transcript into words. Preserve each word’s original text and position. Handle punctuation separately from the spoken text.
3. Generate reference audio. Use eSpeak NG’s Telugu voice to synthesize each word separately.
4. Trim excessive silence around each synthetic word. Concatenate the resulting word recordings.
5. Record the synthetic word boundaries. These are known exactly from the lengths of the concatenated pieces.
6. Extract acoustic features from both the synthetic reference and the real recording.
7. Run DTW to find a time mapping between those feature sequences.
8. Transfer the known synthetic word boundaries through that mapping to obtain estimated boundaries in the real recording.
9. Return timestamps, optionally saving the corresponding real-audio clips.

For example, the synthetic reference might place a word at 1.20–1.65 s. DTW might map that interval to 1.43–1.81 s in the real recording.

Output structure:

{
  "audio_path": "sentence.wav",
  "time_basis": "original_recording_seconds",
  "words": [
    {
      "index": 0,
      "text": "ఈ",
      "start_seconds": 0.340,
      "end_seconds": 1.137,
      "status": "estimated"
    }
  ]
}

Those sample timestamps come from our earlier experiment. They are estimates, not verified ground truth.

2. Aligned word → aligned sounds and written units

This operation needs the word’s audio and its text. A timestamp pair alone is insufficient unless the original recording is also available.

Input:

{
  "audio_path": "word.wav",
  "text": "కోసం",
  "sentence_offset_seconds": 2.4310625
}

First define what “letters” means:

Requested unit	Example within కోసం
Written units, or aksharas	కో, సం
Individual speech sounds, or phonemes	/k/, /oː/, /s/, vowel, nasal

A written Telugu unit can combine a consonant and vowel. Consequently, individual Unicode characters should not automatically be treated as separate audio segments. Unicode’s script description⁠￼

Processing:

1. Synthesize the entire word in one call. This preserves the synthetic sounds’ within-word context.
2. Capture eSpeak’s phoneme events. They provide phoneme labels and their start times in the generated audio. Each sound ends where the following sound begins.
3. Extract features from the synthetic word and the real word.
4. Run DTW between those two feature sequences.
5. Project the synthetic phoneme boundaries onto the real word.
6. Associate phonemes with Telugu written units. Combine their intervals when returning akshara-level results.
7. Return timestamps relative to the word, and optionally relative to the original sentence.

For example:

{
  "text": "కోసం",
  "status": "estimated",
  "written_units": [
    {
      "text": "కో",
      "word_start_seconds": 0.0,
      "word_end_seconds": 0.144018
    },
    {
      "text": "సం",
      "word_start_seconds": 0.144018,
      "word_end_seconds": 0.421438
    }
  ],
  "phonemes": [
    {
      "reference_label": "k",
      "word_start_seconds": 0.0,
      "word_end_seconds": 0.0175
    }
  ]
}

Convert a word-relative timestamp to a sentence-relative timestamp with:

sentence_time = sentence_offset_seconds + word_time

The phoneme-to-letter mapping requires explicit implementation. In our example, I supplied the Telugu labels and groupings manually; DTW calculated the timestamps automatically.

For arbitrary words, implement a Telugu pronunciation-mapping component that:

* Splits the written word into aksharas.
* Determines their expected phoneme sequences using Telugu pronunciation rules.
* Matches those sequences against the phonemes actually emitted by eSpeak.
* Handles vowel signs, conjuncts, doubled consonants, and context-dependent nasal sounds.
* Returns needs_review when the correspondence is ambiguous.

Until that component exists, the system can automatically return phoneme-labelled timestamps, while arbitrary Telugu letter-labelled timestamps remain incomplete. Keep the reference’s actual pronunciation visible: our eSpeak reference emitted a final /n/ for కోసం.

Shared audio-alignment implementation

The prototype used these components:

Component	Implementation
Speech generation	eSpeak NG, loaded using espeakng-loader and called through Python ctypes
Audio loading and writing	soundfile
Resampling	scipy.signal.resample_poly
Acoustic features	python-speech-features MFCCs
Feature comparison	SciPy cosine distance
Time alignment	dtw-python
Array processing	numpy

Use the following settings to reproduce our approach:

Setting	Sentence → words	Word → sounds
Audio sample rate	16 kHz	16 kHz
Feature window	25 ms	25 ms
Feature hop	10 ms	5 ms
MFCCs	Compute 13, discard coefficient 0	Same
Normalization	Per-recording mean and variance	Same
DTW step pattern	symmetric2	Same
DTW constraint	Slanted band	Same

DTW returns corresponding reference-frame and real-frame indices. For each reference frame, take the median corresponding real-frame index. Interpolate that mapping at each reference boundary, accounting for the feature windows’ center positions.

Preserve any offsets introduced by trimming. Store sample indices alongside timestamps to make subsequent cuts reproducible.

Finally, validate that boundaries are ordered, remain inside the input recording, and have positive duration. Flag collapsed or suspiciously short segments. A 5 ms feature hop does not establish 5 ms accuracy, and errors in the first operation’s word crop carry into the second operation.