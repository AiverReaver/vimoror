/**
 * The manifest↔directory bijection, both directions, plus the ordering.
 *
 * This is the repo's third instance of the same guard shape — the editor's
 * `EDITS`/`FIELD_ORDER` exhaustiveness and the golden comparator's register
 * list are the other two — and it is here because BOTH halves of the drift are
 * silent. A manifest id with no file drops a stage out of the campaign with no
 * error anywhere; a stage file nobody listed is content that was authored,
 * validated by `pnpm validate:stages`, and then never reachable in the game.
 * The second is the one a person would not think to check, and it is the one
 * M5/M6 will actually hit, since authoring a stage and listing it are two
 * separate acts.
 *
 * It also pins `parseStage` running over the real corpus at import time: a
 * committed stage that stopped parsing would fail here the same way it fails
 * `validate:stages`, one layer earlier than the browser.
 */

import { describe, expect, it } from 'vitest';

import { CAMPAIGN_IDS, missing, stageAfter, stages, unlisted } from './campaign.ts';

describe('the campaign manifest and content/stages agree', () => {
  it('lists a file for every id', () => {
    expect(missing).toEqual([]);
  });

  it('lists every file it has', () => {
    expect(unlisted).toEqual([]);
  });

  it('resolves every id, in the manifest order', () => {
    expect(stages.map((stage) => stage.id)).toEqual(CAMPAIGN_IDS);
  });

  it('holds parsed stages, not raw text', () => {
    // `par` and `win` are schema output, not JSON the file has to carry: `win`
    // is required and `par` positive, so a stage that reached here un-parsed
    // would fail this rather than only failing later in a session.
    for (const stage of stages) {
      expect(stage.par).toBeGreaterThan(0);
      expect(stage.win.length).toBeGreaterThan(0);
      expect(stage.options.tabstop).toBeGreaterThan(0);
    }
  });

  it('is non-empty and acts never go backwards', () => {
    expect(stages.length).toBeGreaterThan(0);
    const acts = stages.map((stage) => stage.act);
    expect([...acts].sort((a, b) => a - b)).toEqual(acts);
  });
});

describe('stageAfter walks the campaign', () => {
  it('returns the next stage, and nothing past the last', () => {
    for (let i = 0; i < stages.length; i += 1) {
      expect(stageAfter(stages[i]!.id)?.id).toBe(stages[i + 1]?.id);
    }
  });

  it('returns undefined for a stage that is not in the campaign', () => {
    expect(stageAfter('no-such-stage')).toBeUndefined();
  });
});
