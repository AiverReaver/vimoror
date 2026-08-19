/**
 * Settings, and the comfort controls the content note borrows.
 *
 * This file owns three things beyond its own screen, and each is here rather
 * than in `app.tsx` for a reason:
 *
 * - **`Settings` and `defaultSettings()`** — the shell's whole in-memory state
 *   besides which screen is showing. Wave D moves this shape into `save.ts`'s
 *   envelope and adds `audio`; nothing else about it should have to change,
 *   which is why the screens take the object and a setter rather than five
 *   props.
 * - **`ComfortControls`** — rendered by the content note AND by this screen, so
 *   that "surfaced before first play" and "editable any time" are the same
 *   controls with the same copy and not two drifting copies of it. The note
 *   screen imports it from here rather than the reverse, because this is where
 *   the state shape lives.
 * - **The reduced-motion policy.** `prefers-reduced-motion: reduce` picks a
 *   DEFAULT of 0 and everyone else 0.6 — read once at startup, never watched.
 *   A `matchMedia` listener here would be a bug rather than a feature: the
 *   value is the player's after they touch the slider, and an OS-level change
 *   must not silently overwrite a choice they made on this screen.
 *
 * **`effectsIntensity` is the number `draw()` refuses to default.** It is a
 * required 0..1 on every call precisely so that someone decides it on purpose;
 * 0.6 is that decision, taken by eye against the real CRT pass rather than
 * derived. The label never says "epilepsy safe" — the control describes what it
 * changes and lets the player judge, which is the only honest way to offer it.
 *
 * **Never colour alone**, on every control here: the two comfort switches are
 * real checkboxes with real labels, the slider carries its numeric value beside
 * it, and the current difficulty is marked with a leading `>` and the word
 * "current" rather than by being the highlighted one.
 */

import { DEFAULT_COMFORT, DEFAULT_DIFFICULTY, DIFFICULTIES, type Comfort, type Difficulty } from '@vimorror/game';

import { commandText } from './shell-commands.ts';

/**
 * The one place the resources destination is written down — changing it is this
 * line and nothing else. Not exported: `ResourcesLink` below is the whole
 * public surface, and nothing outside this file has ever needed the string.
 *
 * International, non-diagnostic, and not a directory this project curates:
 * anything we chose to list ourselves would go stale silently and would be a
 * clinical judgment nobody here is qualified to make. It lives in the SETTINGS
 * module rather than beside the content note's copy because all three screens
 * that show it — the note, this one, the title footer — would otherwise have to
 * import from the note screen while it imports `ComfortControls` from here, and
 * a two-file import cycle is a worse thing to own than an odd address.
 */
const RESOURCES_URL = 'https://findahelpline.com';

/** Reachable from the content note, from settings, and from the title footer —
 * permanently, which is the point: the note is skippable and shows once. */
export function ResourcesLink() {
  return (
    <p className="note">
      If any of this lands too close to home, free confidential helplines are listed by country at{' '}
      <a href={RESOURCES_URL} target="_blank" rel="noreferrer noopener">
        {RESOURCES_URL.replace('https://', '')}
      </a>
      . This link stays on the settings screen and at the foot of the title screen.
    </p>
  );
}

export type Settings = {
  readonly difficulty: Difficulty;
  readonly comfort: Comfort;
  /** 0..1, straight to the shader uniform on every `draw()`. */
  readonly effectsIntensity: number;
};

/** For a profile that has not asked for reduced motion. Picked by eye on the
 * real CRT pass — full strength reads as damage rather than as dread. */
const EFFECTS_DEFAULT = 0.6;

/**
 * Read once, at startup. `matchMedia` is guarded because the shell is also
 * loaded by vitest's `node` environment through the module graph, and a missing
 * `window` must not be the reason the game fails to boot.
 */
export function defaultSettings(): Settings {
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  return {
    difficulty: DEFAULT_DIFFICULTY,
    comfort: DEFAULT_COMFORT,
    effectsIntensity: reduced ? 0 : EFFECTS_DEFAULT,
  };
}

/** What each difficulty actually changes, in the player's terms rather than in
 * `Modifiers`' — the four dials are real, and this is the honest summary of
 * them, not a mood. */
const DIFFICULTY_NOTE: Readonly<Record<Difficulty, string>> = {
  verymagic: 'threats move at half pace, no keystroke budget, the next key always on screen',
  magic: 'exact Vim, the budget scored but never fatal, a hint when you ask for one',
  nomagic: 'the budget is a hard fail, and there are no hints',
};

export type SettingsProps = {
  readonly settings: Settings;
  readonly onChange: (settings: Settings) => void;
};

/**
 * Comfort and effects — the half of settings that has to exist before the first
 * stage, and therefore the half the content note shows.
 *
 * The jump-scare switch is disabled while Gentle Mode is on, and says why. That
 * is not the two axes gating each other — difficulty and comfort never do —
 * it is `allowsBeat`'s own rule made visible: a startling beat needs
 * `jumpScares && !gentle`, so with Gentle Mode on the other switch has no
 * effect. Disabling it keeps the STORED value intact, so turning Gentle Mode
 * back off restores whatever the player had chosen.
 */
export function ComfortControls({ settings, onChange }: SettingsProps) {
  const { comfort, effectsIntensity } = settings;

  return (
    <fieldset className="controls">
      <legend>comfort</legend>

      <label className="row">
        <input
          type="checkbox"
          checked={comfort.gentle}
          onChange={(e) => onChange({ ...settings, comfort: { ...comfort, gentle: e.target.checked } })}
        />
        <span>
          <strong>Gentle Mode</strong>
          <span className="dim">
            {' '}
            — every mechanic and the whole story, without startle beats or look-away tricks. It is not an easier
            setting and nothing is scored differently.
          </span>
        </span>
      </label>

      <label className="row">
        <input
          type="checkbox"
          checked={comfort.jumpScares}
          disabled={comfort.gentle}
          onChange={(e) => onChange({ ...settings, comfort: { ...comfort, jumpScares: e.target.checked } })}
        />
        <span>
          <strong>Jump scares</strong>
          <span className="dim">
            {' '}
            — turn this off for dread without the sudden ones. {comfort.gentle ? 'Gentle Mode already has them off.' : ''}
          </span>
        </span>
      </label>

      <label className="row">
        <span>
          <strong>Effects intensity</strong> <code>{effectsIntensity.toFixed(2)}</code>
          <span className="dim"> — screen curvature, phosphor trails, glitch bands. 0.00 turns all of them off.</span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={effectsIntensity}
          onChange={(e) => onChange({ ...settings, effectsIntensity: Number(e.target.value) })}
        />
      </label>
    </fieldset>
  );
}

/** The difficulty picker, in `:set` terms because that is how it is spelt
 * everywhere else in the game. The buttons and the title screen's command line
 * reach the same state; neither is the real one. */
function DifficultyControls({ settings, onChange }: SettingsProps) {
  return (
    <fieldset className="controls">
      <legend>difficulty</legend>
      {(Object.keys(DIFFICULTIES) as Difficulty[]).map((difficulty) => {
        const current = settings.difficulty === difficulty;
        return (
          <label key={difficulty} className="row">
            <input
              type="radio"
              name="difficulty"
              checked={current}
              onChange={() => onChange({ ...settings, difficulty })}
            />
            <span>
              {/* Never colour alone: the marker and the word both say which one
                  is live, so nothing depends on noticing a tint. */}
              <code>{current ? '> ' : '  '}{commandText({ kind: 'set-difficulty', difficulty })}</code>
              {current ? <strong> current</strong> : null}
              <span className="dim"> — {DIFFICULTY_NOTE[difficulty]}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function SettingsScreen({ settings, onChange, onBack }: SettingsProps & { readonly onBack: () => void }) {
  return (
    <div className="screen">
      <h1>settings</h1>
      <DifficultyControls settings={settings} onChange={onChange} />
      <ComfortControls settings={settings} onChange={onChange} />
      <p className="note">
        Difficulty can also be set from the game&apos;s own command line at the title screen: type{' '}
        <code>:set nomagic</code> and press Enter. Inside a stage the command still runs and still costs its
        keystrokes — this is Vim, not a menu — but it will tell you that difficulty is chosen between stages.
      </p>
      <div className="run-actions">
        <button type="button" onClick={onBack}>
          back
        </button>
      </div>
      <ResourcesLink />
    </div>
  );
}
