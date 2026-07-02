"""Extract melody from the Phase 1.1 vocal stem and dump validation artifacts.

Writes:
  output/melody.mid          - the extracted note contour (open in any DAW/player)
  output/pitch_check.json    - {"notes": [{pitch, start, end, velocity}, ...]}
  output/pitch_preview.html  - no-DAW validation page: plays the vocal stem with
                               a WebAudio oscillator synthesizing the extracted
                               notes in sync (toggleable), over a piano-roll -
                               the "play the MIDI alongside the vocal" check the
                               phase's done-when requires.

Run against the Demucs vocal stem, never the full mix - the full mix would
extract whatever is most prominent, not the vocal line.
"""
import json
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from stages.extract_pitch import extract_pitch, save_midi  # noqa: E402

VOCALS = REPO_ROOT / "output" / "stems" / "htdemucs" / "input_song" / "vocals.wav"


def midi_to_freq(midi_note: float) -> float:
    return 440.0 * 2 ** ((midi_note - 69) / 12)


def build_preview_html(notes: list) -> str:
    notes_json = json.dumps(notes)
    return """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>LyraLearn pitch preview - Phase 1.4 validation</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; background: #111; color: #ddd; }
  h1 { font-size: 1rem; color: #aaa; }
  .controls { position: sticky; top: 0; background: #111; padding: .75rem 0; border-bottom: 1px solid #333; }
  audio { width: 100%; }
  label { margin-right: 1.5rem; }
  canvas { width: 100%; height: 320px; background: #181818; border: 1px solid #333; margin-top: 1rem; }
  .hint { color: #888; font-size: .85rem; margin-top: .5rem; }
</style>
</head>
<body>
<h1>LyraLearn pitch preview - the synth plays the EXTRACTED notes over the real vocal. Listen for octave errors, missed notes, spurious notes, boundary drift.</h1>
<div class="controls">
  <audio id="player" controls src="stems/htdemucs/input_song/vocals.wav"></audio>
  <div style="margin-top:.5rem">
    <label>Synth volume <input type="range" id="synthVol" min="0" max="100" value="45"></label>
    <label>Vocal volume <input type="range" id="vocalVol" min="0" max="100" value="80"></label>
    <label><input type="checkbox" id="synthOn" checked> Synth on</label>
  </div>
  <div class="hint">Piano-roll below scrolls with playback; the moving line is now. A correct extraction sounds like a robotic double of the singer.</div>
</div>
<canvas id="roll" width="1760" height="640"></canvas>
<script>
const NOTES = __NOTES__;
const player = document.getElementById("player");
const synthVol = document.getElementById("synthVol");
const vocalVol = document.getElementById("vocalVol");
const synthOn = document.getElementById("synthOn");
const canvas = document.getElementById("roll");
const ctx2d = canvas.getContext("2d");

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const src = audioCtx.createMediaElementSource(player);
const vocalGain = audioCtx.createGain();
src.connect(vocalGain).connect(audioCtx.destination);
const synthGain = audioCtx.createGain();
synthGain.connect(audioCtx.destination);
vocalVol.oninput = () => vocalGain.gain.value = vocalVol.value / 100;
synthVol.oninput = () => synthGain.gain.value = synthVol.value / 100;
vocalGain.gain.value = 0.8; synthGain.gain.value = 0.45;

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// Schedule oscillators relative to the audio element's clock each time play starts.
let scheduled = [];
function clearScheduled() { scheduled.forEach(o => { try { o.stop(); } catch (e) {} }); scheduled = []; }
function scheduleFrom(songTime) {
  clearScheduled();
  if (!synthOn.checked) return;
  const base = audioCtx.currentTime;
  for (const n of NOTES) {
    if (n.end <= songTime) continue;
    const osc = audioCtx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = midiToFreq(n.pitch);
    const g = audioCtx.createGain();
    g.gain.value = Math.min(1, n.velocity);
    osc.connect(g).connect(synthGain);
    osc.start(base + Math.max(0, n.start - songTime));
    osc.stop(base + Math.max(0, n.end - songTime));
    scheduled.push(osc);
  }
}
player.onplay = () => { audioCtx.resume(); scheduleFrom(player.currentTime); };
player.onpause = clearScheduled;
player.onseeked = () => { if (!player.paused) scheduleFrom(player.currentTime); };
synthOn.onchange = () => { if (!player.paused) scheduleFrom(player.currentTime); };

// Piano-roll: 20s window centred on now.
const WINDOW = 20;
const PITCH_MIN = 40, PITCH_MAX = 90;
function draw() {
  const t = player.currentTime;
  const w = canvas.width, h = canvas.height;
  ctx2d.clearRect(0, 0, w, h);
  const t0 = t - WINDOW / 2;
  for (const n of NOTES) {
    if (n.end < t0 || n.start > t0 + WINDOW) continue;
    const x = ((n.start - t0) / WINDOW) * w;
    const nw = Math.max(2, ((n.end - n.start) / WINDOW) * w);
    const y = h - ((n.pitch - PITCH_MIN) / (PITCH_MAX - PITCH_MIN)) * h;
    ctx2d.fillStyle = (n.start <= t && t <= n.end) ? "#e8b939" : "#4a7a4a";
    ctx2d.fillRect(x, y - 4, nw, 8);
  }
  ctx2d.strokeStyle = "#888";
  ctx2d.beginPath(); ctx2d.moveTo(w / 2, 0); ctx2d.lineTo(w / 2, h); ctx2d.stroke();
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
</script>
</body>
</html>
""".replace("__NOTES__", notes_json)


def main() -> None:
    if not VOCALS.exists():
        print(f"FAIL - vocal stem not found: {VOCALS}")
        print("Run the Phase 1.1 Demucs separation first (see CLAUDE.md).")
        sys.exit(1)

    print("Extracting melody with Basic Pitch (bundled model, TensorFlow backend) ...")
    started = time.monotonic()
    pitch_data = extract_pitch(str(VOCALS))
    elapsed = time.monotonic() - started

    out_mid = REPO_ROOT / "output" / "melody.mid"
    save_midi(pitch_data["midi"], str(out_mid))

    out_json = REPO_ROOT / "output" / "pitch_check.json"
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump({"notes": pitch_data["notes"]}, f, indent=2)

    out_html = REPO_ROOT / "output" / "pitch_preview.html"
    out_html.write_text(build_preview_html(pitch_data["notes"]), encoding="utf-8")

    notes = pitch_data["notes"]
    pitches = [n["pitch"] for n in notes]
    print(f"Done in {elapsed:.1f}s - {len(notes)} notes, pitch range {min(pitches)}-{max(pitches)}" if notes else f"Done in {elapsed:.1f}s - 0 notes (investigate!)")
    print(f"  {out_mid}")
    print(f"  {out_json}")
    print(f"  {out_html}")


if __name__ == "__main__":
    main()
