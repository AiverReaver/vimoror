/**
 * The sound: two detuned oscillators, a lowpass with a slow wobble on it, and a
 * gain the settings screen owns. Raw WebAudio, no library, one module.
 *
 * **The autoplay policy is the whole design constraint**, and it is a trap
 * rather than a rule: an `AudioContext` constructed before any user gesture is
 * not refused, it is created in the `suspended` state — so the code runs, the
 * nodes connect, `currentTime` advances, nothing throws, and the drone is
 * silent forever. That failure is invisible from inside the app, which is why
 * `ensureAudio()` exists and why nothing in this file constructs a context on
 * import. `app.tsx` calls it from a `pointerdown`/`keydown` listener — ONE
 * entry point rather than a call sprinkled through every handler that might
 * happen to be first — and `audioStatus()` is exported so the state can be
 * *measured* in the browser instead of assumed.
 *
 * Everything below tolerates having no `AudioContext` at all: vitest's `node`
 * environment has none, and a browser that has locked it down must cost the
 * player their sound and nothing else.
 *
 * The drone is retuned rather than restarted when the act changes — a stop and
 * a start would be an audible seam every time the player leaves a stage, and
 * `setTargetAtTime` on a live oscillator is both smoother and less code than
 * managing two overlapping voices.
 *
 * **What is deliberately not here:** per-beat stings and threat-proximity
 * scoring. Both are content-driven — they need a beat to hang on and a stage
 * that authors the tension — so they land with the acts that write them (M5/M6)
 * rather than as a table of guesses now.
 */

/** The lowest voice, per act. Exported for the test; `baseHzFor` is the reader. */
const ROOT_HZ = 55;

/**
 * A semitone down per act — A1 at act 1, descending. Written as the formula it
 * is rather than as six literals: the table would say exactly this and would
 * then have to be extended by hand for every act M6 adds.
 *
 * Clamped rather than defaulted, so an act outside the curriculum (a stage
 * authored ahead of its act, a hand-edited manifest) sounds like the nearest
 * real one instead of like a bug — an act 0 at double frequency would be an
 * octave up, which is the opposite of what "before the beginning" should feel
 * like.
 */
export function baseHzFor(act: number): number {
  const clamped = Math.min(Math.max(Math.round(act), 1), 6);
  return ROOT_HZ * 2 ** (-(clamped - 1) / 12);
}

/** A stinger is two tones and a duration. Pure, so the shape is checkable. */
export type Stinger = { readonly fromHz: number; readonly toHz: number; readonly seconds: number };

/**
 * Rising for a win, falling for a loss, and both short. The interval is a fifth
 * either way, which is the one interval that reads as "resolved" rather than as
 * "a tune" — this game does not do fanfares.
 */
export function stingerFor(kind: 'win' | 'lose'): Stinger {
  return kind === 'win'
    ? { fromHz: 220, toHz: 330, seconds: 0.9 }
    : { fromHz: 165, toHz: 110, seconds: 1.4 };
}

export type AudioSettings = { readonly muted: boolean; readonly volume: number };

/** Quiet by default. A drone that announces itself is a drone that gets muted. */
export const DEFAULT_AUDIO: AudioSettings = { muted: false, volume: 0.4 };

/** Under the stingers by design — the drone is the room, not the event. */
const DRONE_GAIN = 0.22;

type Drone = {
  readonly voices: readonly OscillatorNode[];
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
};

let ctx: AudioContext | undefined;
let master: GainNode | undefined;
let drone: Drone | undefined;
let settings: AudioSettings = DEFAULT_AUDIO;
/** Set before the first gesture as often as not, so it is remembered and
 * applied the moment a context exists. `undefined` means "no stage". */
let act: number | undefined;

/** The master gain the settings screen actually controls. Squared so the slider
 * moves the way an ear expects rather than the way a number does. */
function targetGain(): number {
  return settings.muted ? 0 : settings.volume ** 2;
}

/**
 * Create the context if this is the first gesture, and resume it if it went to
 * sleep. Safe to call on every gesture — after the first it is two comparisons.
 *
 * The `resume()` is not belt and braces: a page restored from the back/forward
 * cache, or one the browser suspended for being in a background tab, comes back
 * with a `suspended` context and no event to tell the app about it.
 */
export function ensureAudio(): void {
  if (typeof AudioContext === 'undefined') return;
  if (ctx === undefined) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = targetGain();
    master.connect(ctx.destination);
    if (act !== undefined) startDrone(act);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

export function setAudioSettings(next: AudioSettings): void {
  settings = next;
  // A ramp rather than an assignment: stepping a gain discontinuously is an
  // audible click, and a mute that clicks is worse than one that takes 60ms.
  if (ctx !== undefined && master !== undefined) {
    master.gain.setTargetAtTime(targetGain(), ctx.currentTime, 0.02);
  }
}

/**
 * Which act is sounding, or `undefined` for silence.
 *
 * The shell screens ask for act 1 rather than for silence — a title that goes
 * quiet and a stage that hums would make the menus feel like a different
 * program — and the content note asks for `undefined`, which is the one place
 * the answer is not a matter of taste: a horror drone underneath the screen
 * that asks whether you want horror is the game answering its own question.
 *
 * Fading rather than stopping, because a stopped `OscillatorNode` cannot be
 * restarted and managing a second voice would be more code than a gain ramp.
 */
export function setDroneAct(next: number | undefined): void {
  act = next;
  if (ctx === undefined) return;
  if (next === undefined) {
    drone?.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    return;
  }
  if (drone === undefined) {
    startDrone(next);
    return;
  }
  tune(drone, next);
  drone.gain.gain.setTargetAtTime(DRONE_GAIN, ctx.currentTime, 1.4);
}

function startDrone(forAct: number): void {
  if (ctx === undefined || master === undefined) return;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(master);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 6;
  filter.connect(gain);

  // The wobble: an LFO on the filter cutoff rather than on the gain, so the
  // drone breathes in TIMBRE and never in volume. A tremolo would read as a
  // fault in the playback, which is a different kind of unsettling than the one
  // this game wants.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 90;
  lfo.connect(lfoDepth).connect(filter.frequency);
  lfo.start();

  // Two voices a few cents apart. The beat frequency between them is the whole
  // effect — one oscillator is a test tone, two that disagree slightly is a room.
  const voices = [ctx.createOscillator(), ctx.createOscillator()];
  for (const [i, voice] of voices.entries()) {
    voice.type = 'sawtooth';
    voice.detune.value = i === 0 ? -7 : 7;
    voice.connect(filter);
    voice.start();
  }

  drone = { voices, filter, gain };
  tune(drone, forAct);
  // Seconds, not milliseconds. The drone should be there before the player
  // notices it arriving, which is the opposite of how a stinger works.
  gain.gain.setTargetAtTime(DRONE_GAIN, ctx.currentTime, 1.4);
}

function tune(d: Drone, forAct: number): void {
  if (ctx === undefined) return;
  const hz = baseHzFor(forAct);
  const now = ctx.currentTime;
  for (const voice of d.voices) voice.frequency.setTargetAtTime(hz, now, 0.9);
  // Tracking the root keeps the timbre constant as the pitch drops, instead of
  // making the deeper acts progressively duller by accident.
  d.filter.frequency.setTargetAtTime(hz * 8, now, 0.9);
}

/** Short, and gone. Nothing here is stored: the nodes are collected once they
 * have stopped, which is what `stop()` schedules. */
export function playStinger(kind: 'win' | 'lose'): void {
  if (ctx === undefined || master === undefined) return;
  const { fromHz, toHz, seconds } = stingerFor(kind);
  const now = ctx.currentTime;

  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(master);
  gain.gain.linearRampToValueAtTime(0.3, now + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);

  const voice = ctx.createOscillator();
  voice.type = 'triangle';
  voice.frequency.value = fromHz;
  voice.frequency.exponentialRampToValueAtTime(toHz, now + seconds * 0.7);
  voice.connect(gain);
  voice.start(now);
  voice.stop(now + seconds);
}

/**
 * What the audio graph actually is, right now. Exported for one reason: the
 * suspended-context trap is invisible from the app's own behaviour, so the
 * browser check for "sound only after a gesture" has to be able to READ the
 * state rather than infer it from having heard something.
 */
export function audioStatus(): { readonly state: string; readonly act: number | undefined; readonly gain: number } {
  return { state: ctx?.state ?? 'none', act, gain: master?.gain.value ?? 0 };
}
