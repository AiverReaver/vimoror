/**
 * The shell: one screen union, one settings object, one save, and no state that
 * anything else already owns.
 *
 * **Zustand was decided against, and this file is still the argument.** Its
 * justification in the technology table was "works outside React for the game
 * loop" — measured against what the shell actually holds, that loop is a rAF
 * callback reading a ref inside `runner.tsx`, and everything React renders here
 * is a screen union, a settings object and a progress map. A store would be a
 * second source of truth for state that already lives in `GameSession` and in
 * `localStorage`. `useState` covers it with zero dependencies.
 *
 * Wave D adds four responsibilities, and one of them is the only genuinely
 * awkward decision in the file:
 *
 * - **The save is loaded once, at boot, and written on every change.** A single
 *   `persist()` keeps `saveRef` and `localStorage` in step, so there is one
 *   writer and one shape.
 * - **The in-flight snapshot is a REF, not state.** The runner emits one after
 *   every keystroke, and putting that in `useState` would re-render the whole
 *   shell once per key for a value only the select screen ever reads. The
 *   select screen therefore reads `saveRef.current.current` during render,
 *   which is normally a mistake and is safe here for a concrete reason: the
 *   only thing that writes it is the runner, and the runner is not mounted
 *   while the select screen is. Nothing can change it between the read and the
 *   paint. (The write itself is a `JSON.stringify` of a few kilobytes per
 *   keystroke. Measured against a keyboard, that is free; if a much larger
 *   buffer ever makes it not free, the fix is to debounce `storeSave`, not to
 *   snapshot less often.)
 * - **`:play` and `:stages` finally diverge.** `:play` resumes the stage the
 *   save left in flight and falls through to the list when there is none;
 *   `:stages` is always the list. That is Wave C's "two spellings of one door"
 *   closing exactly where the plan said it would.
 * - **Audio is unlocked from ONE listener.** `ensureAudio()` needs a real user
 *   gesture or the context is created suspended and nothing ever sounds; a
 *   document-level `pointerdown`/`keydown` pair is one place to get that right
 *   instead of a call in every handler that might happen to be first.
 *
 * "First launch only" for the content note is now literally true: the note is
 * the initial screen only when `loadSave()` came back empty, and the first
 * `persist()` means a second visit starts at the title. The resources link is
 * permanent from the first frame either way, which is the half that matters.
 *
 * Three things this file is careful about, each of which the runner's contract
 * requires: the stage and the settings are held in state so their identity is
 * stable (the runner restarts its session when either changes); every callback
 * the runner or the title screen holds is memoised, because both re-arm a
 * document-level keydown listener when one changes identity; and `onSnapshot`
 * in particular must never change identity, since it is in the dependency list
 * of the effect that creates the session.
 */

import type { Outcome, Score, SessionSnapshot } from '@vimorror/game';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ensureAudio, setAudioSettings, setDroneAct } from './audio.ts';
import { stageAfter, stages } from './campaign.ts';
import { NoteScreen } from './note-screen.tsx';
import { recordWin, unlockedIds } from './progression.ts';
import { Runner } from './runner.tsx';
import { loadSave, SCHEMA_VERSION, storeSave, type Save } from './save.ts';
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
  /** `resume` is a seed the runner reads once when it starts a session. */
  | { readonly kind: 'run'; readonly stageId: string; readonly resume: SessionSnapshot | undefined };

/** The drone follows the act; the screens outside a stage are act 1's, and the
 * content note is silence — a horror drone under the screen that asks whether
 * you want horror is the game answering its own question. */
const SHELL_ACT = 1;

export function App() {
  // Read once, before the first render. A `useState` initializer rather than an
  // effect: the note screen must not flash for a player who already has a save.
  const [loaded] = useState(loadSave);

  const [settings, setSettings] = useState<Settings>(() => loaded?.settings ?? defaultSettings());
  const [progress, setProgress] = useState<Save['progress']>(() => loaded?.progress ?? {});
  const [screen, setScreen] = useState<Screen>(() => ({ kind: loaded === undefined ? 'note' : 'title' }));

  /** The envelope as last written, and the only writer of it. */
  const saveRef = useRef<Save>({ schemaVersion: SCHEMA_VERSION, settings, progress, current: loaded?.current });

  const persist = useCallback((patch: Partial<Save>): void => {
    saveRef.current = { ...saveRef.current, ...patch };
    storeSave(saveRef.current);
  }, []);

  /**
   * Settings and progress change rarely, so an effect is the right shape. It
   * also writes the very FIRST save, which is what makes the content note stop
   * appearing — and that is why it is gated on having LEFT the note.
   *
   * Measured, not reasoned: without the gate, mounting on the note screen wrote
   * a save immediately, so a player who opened the game, read the note and
   * closed the tab came back to no note at all. `note` is only ever the initial
   * screen and nothing routes back to it, so this flips false→true exactly once
   * and needs no second piece of state to say so.
   */
  const pastNote = screen.kind !== 'note';
  useEffect(() => {
    if (pastNote) persist({ settings, progress });
  }, [pastNote, persist, settings, progress]);

  // Safe before the graph exists: `audio.ts` remembers and applies on creation.
  useEffect(() => setAudioSettings(settings.audio), [settings.audio]);

  /**
   * The one place the autoplay policy is answered. Both events, because this
   * game is played with a keyboard and navigated with a mouse and either can be
   * first. `capture`, so the runner's own handler — which calls
   * `preventDefault` on every accepted key — cannot get in front of it.
   */
  useEffect(() => {
    const unlock = (): void => ensureAudio();
    const options = { capture: true, passive: true } as const;
    document.addEventListener('pointerdown', unlock, options);
    document.addEventListener('keydown', unlock, options);
    return () => {
      document.removeEventListener('pointerdown', unlock, options);
      document.removeEventListener('keydown', unlock, options);
    };
  }, []);

  const runStage = screen.kind === 'run' ? stages.find((s) => s.id === screen.stageId) : undefined;
  const act = runStage?.act ?? SHELL_ACT;
  useEffect(() => {
    setDroneAct(screen.kind === 'note' ? undefined : act);
  }, [screen.kind, act]);

  /** Stable for the life of the app — it is in the dependency list of the effect
   * that creates the session, so a new identity would restart the stage. */
  const onSnapshot = useCallback(
    (snapshot: SessionSnapshot): void => persist({ current: { snapshot } }),
    [persist],
  );

  const onOutcome = useCallback(
    (stageId: string, outcome: Outcome, score: Score): void => {
      // Cleared either way: a decided stage is not a play in flight, and
      // offering a finished run as "resume" is the one thing `current` must
      // never mean. `Score` carries no stage, so the id comes from the runner
      // rather than being read back out of the snapshot this just removed.
      persist({ current: undefined });
      // The effect above writes the new progress — a `persist` inside the
      // updater would be a side effect in a function React is free to call
      // twice.
      if (outcome.status === 'won') setProgress((previous) => recordWin(previous, stageId, score));
    },
    [persist],
  );

  const onCommand = useCallback((command: ShellCommand): void => {
    switch (command.kind) {
      case 'set-difficulty':
        setSettings((previous) => ({ ...previous, difficulty: command.difficulty }));
        return;
      case 'play': {
        // `:play` resumes what the save left in flight, and falls through to
        // the list when there is nothing — or when the stage it names is gone,
        // which is the same content failure `campaign.ts` reports as `missing`.
        const resume = saveRef.current.current?.snapshot;
        const found = resume === undefined ? undefined : stages.find((s) => s.id === resume.stageId);
        setScreen(found === undefined ? { kind: 'select' } : { kind: 'run', stageId: found.id, resume });
        return;
      }
      case 'stages':
        setScreen({ kind: 'select' });
        return;
      case 'settings':
        setScreen({ kind: 'settings' });
        return;
    }
  }, []);

  /** `:q` keeps the resume snapshot; `:q!` discards it. Vim's own distinction
   * landing as UI for nothing, which is what the `force` flag was carried for. */
  const onExit = useCallback(
    (force: boolean): void => {
      if (force) persist({ current: undefined });
      setScreen({ kind: 'select' });
    },
    [persist],
  );

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
          progress={progress}
          unlocked={unlockedIds(stages, progress)}
          // Read during render, and safe: the runner is the only writer and is
          // not mounted while this screen is. See the file comment.
          resume={saveRef.current.current?.snapshot}
          onOpen={(stageId) => setScreen({ kind: 'run', stageId, resume: undefined })}
          onResume={(stageId, snapshot) => setScreen({ kind: 'run', stageId, resume: snapshot })}
          onBack={() => setScreen({ kind: 'title' })}
        />
      );

    case 'settings':
      return <SettingsScreen settings={settings} onChange={setSettings} onBack={() => setScreen({ kind: 'title' })} />;

    case 'run': {
      // Unreachable through the UI — `stageId` only ever comes from this list —
      // but a manifest id with no file drops a stage silently (`campaign.ts`),
      // and a blank page is the worst possible answer to that.
      if (runStage === undefined) {
        return (
          <div className="screen">
            <p className="bad">no stage with id &quot;{screen.stageId}&quot;.</p>
            <div className="run-actions">
              <button type="button" onClick={() => onExit(false)}>
                back
              </button>
            </div>
          </div>
        );
      }
      const next = stageAfter(runStage.id);
      return (
        <Runner
          stage={runStage}
          difficulty={settings.difficulty}
          comfort={settings.comfort}
          effectsIntensity={settings.effectsIntensity}
          initialSnapshot={screen.resume}
          onSnapshot={onSnapshot}
          onOutcome={onOutcome}
          onExit={onExit}
          onNext={
            next === undefined ? undefined : () => setScreen({ kind: 'run', stageId: next.id, resume: undefined })
          }
        />
      );
    }
  }
}
