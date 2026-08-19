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
 * **What is deliberately not here yet:** lock state, best score and the clean
 * flag, and the resume banner. All four are projections of a `progress` map and
 * a stored `current` snapshot, and neither exists until Wave D writes
 * `save.ts` and `progression.ts`. Rendering an "unlocked" badge over data that
 * is always the same value would be UI that cannot be wrong, which is worse
 * than no UI: it would look verified. Wave D adds the props; the rows are
 * already the place they go.
 *
 * `teachesKeys` is shown because it is the one field that says what a stage is
 * FOR, and because a player choosing a room deserves to know it is about `w`
 * and `b` before they are inside it.
 */

import type { Stage } from '@vimorror/game';

import { stages } from './campaign.ts';

export type SelectScreenProps = {
  readonly onOpen: (stageId: string) => void;
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

export function SelectScreen({ onOpen, onBack }: SelectScreenProps) {
  return (
    <div className="screen">
      <h1>stages</h1>

      {byAct(stages).map((group, i) => (
        <section key={`${group.act}-${i}`} className="act">
          <h2>act {group.act}</h2>
          <ul className="stages">
            {group.stages.map((stage) => (
              <li key={stage.id}>
                <button type="button" onClick={(event) => { event.currentTarget.blur(); onOpen(stage.id); }}>
                  {stage.title}
                </button>
                <span className="dim">
                  par {stage.par}
                  {stage.teachesKeys.length === 0 ? '' : ` · teaches ${stage.teachesKeys.join(' ')}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="note">
        Every stage is open. Progress, best scores and resuming a stage you left arrive with the save, one wave from
        now — until then a reload starts everything fresh.
      </p>

      <div className="run-actions">
        <button type="button" onClick={onBack}>
          back to title
        </button>
      </div>
    </div>
  );
}
