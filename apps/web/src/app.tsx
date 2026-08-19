/**
 * The shell: one screen union, one settings object, and no state that anything
 * else already owns.
 *
 * This replaces Wave B's stage list and difficulty radio, which were scaffolding
 * with a deadline and are now deleted rather than grown into.
 *
 * **Zustand was decided against, and this file is the argument.** Its
 * justification in the technology table was "works outside React for the game
 * loop" — measured against what the shell actually holds, that loop is a rAF
 * callback reading a ref inside `runner.tsx`, and everything React renders here
 * is a screen union and one settings object. A store would be a second source
 * of truth for state that already lives in `GameSession` and, from Wave D, in
 * `localStorage`. `useState` covers it with zero dependencies. If a real
 * consumer appears — M6's free-play rooms, a stats overlay — it can take the
 * dependency then.
 *
 * Three things this file is careful about, each of which the runner's contract
 * requires:
 *
 * - **The stage and the settings are held in state, so their identity is
 *   stable.** The runner restarts its session when either changes, which is
 *   correct for a difficulty change between stages and would be a silent loss
 *   of progress on every parent commit if these were rebuilt inline.
 * - **`onCommand` and `onExit` are memoised.** The title screen's document-level
 *   keydown listener re-arms whenever `onCommand` changes identity, and the
 *   runner's does the same on `onExit`; without `useCallback` that is a
 *   remove-and-add on every commit rather than a bug, but the runner also lists
 *   `onExit` in the dependency array of the effect that owns the keyboard, and
 *   a listener rebuilt mid-keystroke is not a thing worth finding out about
 *   later.
 * - **`:play` and `:stages` are the same door.** Two spellings of one action at
 *   Wave C, and deliberately so: the plan's walk is note → title → `:play` →
 *   select → stage, and a player who reaches for either word should arrive
 *   somewhere. Wave D gives `:play` its own meaning — resume the stage the save
 *   left in flight — at which point they diverge.
 *
 * "First launch only" for the content note is the union itself: `note` is the
 * initial screen and nothing routes back to it, so it shows once and never
 * again — within a session. A reload starts at `note` again until Wave D's save
 * makes the claim true across sessions. The resources link is permanent from
 * the first frame either way, which is the half that actually matters.
 */

import { useCallback, useState } from 'react';

import { stageAfter, stages } from './campaign.ts';
import { NoteScreen } from './note-screen.tsx';
import { Runner } from './runner.tsx';
import { SelectScreen } from './select-screen.tsx';
import { defaultSettings, SettingsScreen, type Settings } from './settings-screen.tsx';
import { TitleScreen } from './title-screen.tsx';
import type { ShellCommand } from './shell-commands.ts';

/** A union rather than a string plus a nullable id, so "running" cannot exist
 * without a stage and no other screen can carry one. */
type Screen =
  | { readonly kind: 'note' }
  | { readonly kind: 'title' }
  | { readonly kind: 'select' }
  | { readonly kind: 'settings' }
  | { readonly kind: 'run'; readonly stageId: string };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'note' });
  // Read once. `defaultSettings()` consults `prefers-reduced-motion` for the
  // effects default and must not keep consulting it — the value is the
  // player's the moment they touch the slider.
  const [settings, setSettings] = useState<Settings>(defaultSettings);

  const onCommand = useCallback((command: ShellCommand): void => {
    switch (command.kind) {
      case 'set-difficulty':
        setSettings((previous) => ({ ...previous, difficulty: command.difficulty }));
        return;
      case 'play':
      case 'stages':
        setScreen({ kind: 'select' });
        return;
      case 'settings':
        setScreen({ kind: 'settings' });
        return;
    }
  }, []);

  // `:q` versus `:q!` — the `force` flag is carried and still unconsumed. Wave D
  // is the first wave with a snapshot to keep or discard, which is the only
  // thing the distinction can mean.
  const onExit = useCallback((): void => setScreen({ kind: 'select' }), []);

  switch (screen.kind) {
    case 'note':
      return (
        <NoteScreen settings={settings} onChange={setSettings} onContinue={() => setScreen({ kind: 'title' })} />
      );

    case 'title':
      return <TitleScreen difficulty={settings.difficulty} onCommand={onCommand} />;

    case 'select':
      return (
        <SelectScreen
          onOpen={(stageId) => setScreen({ kind: 'run', stageId })}
          onBack={() => setScreen({ kind: 'title' })}
        />
      );

    case 'settings':
      return <SettingsScreen settings={settings} onChange={setSettings} onBack={() => setScreen({ kind: 'title' })} />;

    case 'run': {
      const stage = stages.find((s) => s.id === screen.stageId);
      // Unreachable through the UI — `stageId` only ever comes from this list —
      // but a manifest id with no file drops a stage silently (`campaign.ts`),
      // and a blank page is the worst possible answer to that.
      if (stage === undefined) {
        return (
          <div className="screen">
            <p className="bad">no stage with id &quot;{screen.stageId}&quot;.</p>
            <div className="run-actions">
              <button type="button" onClick={onExit}>
                back
              </button>
            </div>
          </div>
        );
      }
      const next = stageAfter(stage.id);
      return (
        <Runner
          stage={stage}
          difficulty={settings.difficulty}
          comfort={settings.comfort}
          effectsIntensity={settings.effectsIntensity}
          onExit={onExit}
          onNext={next === undefined ? undefined : () => setScreen({ kind: 'run', stageId: next.id })}
        />
      );
    }
  }
}
