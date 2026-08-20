/**
 * The campaign list — every stage in curriculum order, grouped by act.
 *
 * Grouped rather than flat because `act` is the one piece of curriculum
 * structure the schema carries, and `campaign.json` already guarantees the
 * order; grouping is therefore a fold over an ordered list and never a sort. A
 * stage that moved act without moving position in the manifest would show up
 * here as a heading in the wrong place, which is exactly the right failure —
 * the ordering is content, and content mistakes belong on screen rather than
 * in a silent regroup.
 *
 * **Wave D fills in the four things Wave C left out** — lock state, best score,
 * the clean flag and the resume banner — all four being projections of the
 * `progress` map and the stored `current` snapshot that `save.ts` now writes.
 * Every one arrives as a prop: this screen computes no policy, and in
 * particular does not decide what is unlocked (`progression.ts` does) or what a
 * clean run is (`scoring.ts` does).
 *
 * **Never colour alone**, on every one of them: a locked row is a disabled
 * button with the word `locked` and the name of the stage that opens it, a
 * completed row carries `[x]`, a clean one `[*]`, and the resume banner names
 * the stage and the keystroke count in words. Nothing here is signalled by a
 * tint.
 *
 * `teachesKeys` is shown because it is the one field that says what a stage is
 * FOR, and because a player choosing a room deserves to know it is about `w`
 * and `b` before they are inside it.
 */

import type { SessionSnapshot, Stage } from '@vimorror/game';

import { stages } from './campaign.ts';
import type { Progress } from './save.ts';

export type SelectScreenProps = {
  readonly progress: Progress;
  readonly unlocked: ReadonlySet<string>;
  /** The play in flight, if there is one. Its stage need not be the next one. */
  readonly resume: SessionSnapshot | undefined;
  readonly onOpen: (stageId: string) => void;
  readonly onResume: (stageId: string, snapshot: SessionSnapshot) => void;
  readonly onBack: () => void;
};

/**
 * Consecutive runs of the same act, in manifest order. **Never a sort**, and
 * exported so that claim is checkable: a manifest that lists act 1, then act 2,
 * then act 1 again produces THREE groups and two headings reading "act 1", not
 * two groups with the strays gathered up. That is the right failure — the
 * ordering is curriculum and a curriculum that doubles back is a content
 * mistake somebody should see — and it is unreachable by hand today, because
 * `campaign.json` happens to be sorted. Same structural argument as `frame.ts`'s
 * straddle case: only a test reaches it.
 */
export function byAct(all: readonly Stage[]): { readonly act: number; readonly stages: readonly Stage[] }[] {
  const out: { act: number; stages: Stage[] }[] = [];
  for (const stage of all) {
    const last = out.at(-1);
    if (last?.act === stage.act) last.stages.push(stage);
    else out.push({ act: stage.act, stages: [stage] });
  }
  return out;
}

export function SelectScreen({ progress, unlocked, resume, onOpen, onResume, onBack }: SelectScreenProps) {
  const resumeStage = resume === undefined ? undefined : stages.find((s) => s.id === resume.stageId);

  return (
    <div className="screen">
      <h1>stages</h1>

      {resumeStage === undefined || resume === undefined ? null : (
        <p className="note">
          <strong>{resumeStage.title}</strong> is where you left it — {resume.keystrokes}{' '}
          {resume.keystrokes === 1 ? 'key' : 'keys'} in, at <code>:set {resume.difficulty}</code>.{' '}
          <button type="button" onClick={(event) => { event.currentTarget.blur(); onResume(resumeStage.id, resume); }}>
            resume
          </button>{' '}
          <span className="dim">
            — or open it below to start it again. Leaving a stage with <code>:q!</code> throws the saved run away.
          </span>
        </p>
      )}

      {byAct(stages).map((group, i) => (
        <section key={`${group.act}-${i}`} className="act">
          <h2>act {group.act}</h2>
          <ul className="stages">
            {group.stages.map((stage) => {
              const open = unlocked.has(stage.id);
              const done = progress[stage.id];
              return (
                <li key={stage.id}>
                  <button
                    type="button"
                    disabled={!open}
                    onClick={(event) => { event.currentTarget.blur(); onOpen(stage.id); }}
                  >
                    {/* The marker is the signal, not the disabled tint: `[x]`
                        completed, `[*]` completed clean, `[ ]` open and unplayed,
                        `[-]` locked. */}
                    <code>{!open ? '[-]' : done === undefined ? '[ ]' : done.cleanRun ? '[*]' : '[x]'}</code>{' '}
                    {stage.title}
                  </button>
                  <span className="dim">
                    {open ? '' : 'locked · '}
                    par {stage.par}
                    {done === undefined ? '' : ` · best ${done.bestKeystrokes}${done.cleanRun ? ' clean' : ''}`}
                    {stage.teachesKeys.length === 0 ? '' : ` · teaches ${stage.teachesKeys.join(' ')}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <p className="note">
        A stage opens when the one before it has been completed, at any difficulty —{' '}
        <code>:set nomagic</code> is not a prerequisite for anything. <code>[x]</code> is completed,{' '}
        <code>[*]</code> completed without a hint or an undo, <code>[-]</code> still locked.
      </p>

      <div className="run-actions">
        <button type="button" onClick={onBack}>
          back to title
        </button>
      </div>
    </div>
  );
}
