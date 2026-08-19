/**
 * Wave B's shell around the runner: a stage list, a difficulty picker, and the
 * two in-memory settings the runner needs as props.
 *
 * **This file is scaffolding with a deadline.** Wave C replaces it with the real
 * screen union (`note | title | select | settings | run`) over a live `VimEngine`,
 * and Wave D gives the settings a home in `localStorage`. What it exists for is
 * Wave B's own done-line — *all four shipped stages completable in the app with
 * real keystrokes*, and `act1-word-power` losing over budget on `nomagic` while
 * the identical route wins on `verymagic`. That needs a way to pick a stage and a
 * way to pick a difficulty, and nothing else, so nothing else is here.
 *
 * Two things it does that are NOT temporary, because the runner's contract needs
 * them:
 *
 * - **The stage and the settings are held in state, so their identity is
 *   stable.** The runner restarts its session when either changes, which is
 *   correct for a difficulty change between stages and would be a silent loss of
 *   progress on every parent commit if these were rebuilt inline.
 * - **The runner stays mounted across retry and next-stage.** Retry is internal
 *   to it and next-stage swaps a prop, so one WebGL2 context serves a whole run
 *   of play. Remounting per attempt would leak contexts — `dispose()` releases
 *   the textures and the program, not the context itself, and Chrome drops the
 *   oldest once about sixteen are live.
 *
 * `effectsIntensity` stays at 0 here. It is a required, never-defaulted argument
 * on every `draw()` call precisely so that deciding its value is a decision
 * someone makes on purpose, and that decision — the `prefers-reduced-motion`
 * default of 0, the 0.6 for everyone else, picked by eye on the real CRT pass —
 * is Wave C's, on the screen where the player is looking at the slider.
 */

import { DEFAULT_COMFORT, DEFAULT_DIFFICULTY, DIFFICULTIES, type Difficulty } from '@vimorror/game';
import { useState } from 'react';

import { stageAfter, stages } from './campaign.ts';
import { Runner } from './runner.tsx';

/** Wave C owns the real value and the reduced-motion policy. */
const EFFECTS_INTENSITY = 0;

const DIFFICULTY_NOTE: Readonly<Record<Difficulty, string>> = {
  verymagic: 'threats at half pace, no keystroke budget, the route always on screen',
  magic: 'exact Vim, the budget scored but not enforced, hints on request',
  nomagic: 'the budget is a hard fail and there are no hints',
};

export function App() {
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  const [stageId, setStageId] = useState<string | undefined>(undefined);

  const stage = stages.find((s) => s.id === stageId);

  if (stage !== undefined) {
    const next = stageAfter(stage.id);
    return (
      <Runner
        stage={stage}
        difficulty={difficulty}
        comfort={DEFAULT_COMFORT}
        effectsIntensity={EFFECTS_INTENSITY}
        onExit={() => setStageId(undefined)}
        onNext={next === undefined ? undefined : () => setStageId(next.id)}
      />
    );
  }

  return (
    <div className="select">
      <h1>vimorror</h1>

      <fieldset className="difficulty">
        <legend>difficulty</legend>
        {(Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => (
          <label key={d}>
            <input
              type="radio"
              name="difficulty"
              value={d}
              checked={difficulty === d}
              onChange={() => setDifficulty(d)}
            />
            <code>:set {d}</code> <span className="dim">{DIFFICULTY_NOTE[d]}</span>
          </label>
        ))}
      </fieldset>

      <ul className="stages">
        {stages.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => setStageId(s.id)}>
              act {s.act} · {s.title}
            </button>{' '}
            <span className="dim">
              par {s.par} · {s.buffer.length} {s.buffer.length === 1 ? 'line' : 'lines'}
              {s.entities.length === 0 ? '' : ` · ${s.entities.length} entities`}
            </span>
          </li>
        ))}
      </ul>

      <p className="note">
        Every stage is unlocked. Progression, saves and the title screen's own command line arrive in the waves
        after this one.
      </p>
    </div>
  );
}
