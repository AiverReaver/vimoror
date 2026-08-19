/**
 * recorder.ts — the milestone's own claim, made checkable.
 *
 * "One recording yields par, the hint data and a regression test" is three
 * assertions in the keystone below: par comes back as the recorded token count,
 * `hintFor` derives the first command from the armed solution with no further
 * authoring, and the armed stage wins a FRESH session — which is what
 * `validate:stages` will replay in CI once the stage is exported.
 *
 * Every scenario here was measured against a real `GameSession` on the shipped
 * `act2-grammar-awakens` fixture before it became a test: `di(G` wins at 4/4,
 * `di(kG` wins with a refused `k` at 5/5, `x` is rejected by the stage's own
 * `allowedKeys`, and thirteen `l`s lose to the `keystrokes-over: 12` budget.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tokenize } from '@vimorror/core';
import { GameSession, parseStage } from '@vimorror/game';
import { keyTokenFor } from '@vimorror/stage-view';
import { describe, expect, it } from 'vitest';

import { parseDraft, readDraft, type StageDraft } from './draft.ts';
import { arm, record, replayAtPresets, startRecording, type Recording } from './recorder.ts';

const act2Draft = readDraft(
  readFileSync(fileURLToPath(new URL('../../../content/stages/act2-grammar-awakens.json', import.meta.url)), 'utf8'),
);
const act2 = parseStage(act2Draft);

/**
 * The play pane's whole loop, in three lines: feed a token, fold the events it
 * produced into the recording, repeat. The pane adds a session it owns, an event
 * log and React state around exactly this and nothing else.
 */
function play(session: GameSession, notation: string): Recording {
  let rec = startRecording();
  for (const token of tokenize(notation)) rec = record(rec, token, session.feed(token));
  return rec;
}

const armedDraft = (draft: StageDraft, solution: string, par: number): StageDraft => ({ ...draft, solution, par });

describe('the keystone: a recording becomes a solution that wins on its own', () => {
  it('arms act2 from real play, and the armed stage wins a fresh session at the same count', () => {
    const session = new GameSession(act2, { difficulty: 'nomagic' });
    const rec = play(session, 'di(G');

    expect(rec.outcome).toEqual({ status: 'won' });
    expect(rec.rejected).toEqual([]);
    // The equality the code deliberately does not assume: every fed token
    // belongs to a resolved command once nothing was rejected and the win landed
    // at rest — and a win can only land at rest, since it is evaluated in a tick.
    expect(rec.tokens.length).toBe(rec.keystrokes);

    const armed = arm(rec);
    if (!armed.ok) throw new Error(armed.reason);
    expect(armed.armed).toEqual({ solution: 'di(G', par: 4 });

    // Wave A's inverse property, asserted at the consumer that depends on it: the
    // solution has to tokenize back to the keys that were actually played.
    expect(tokenize(armed.armed.solution)).toEqual(rec.tokens);

    const draft = armedDraft(act2Draft, armed.armed.solution, armed.armed.par);
    const parse = parseDraft(draft);
    if (!parse.ok) throw new Error(parse.issues);

    const replay = new GameSession(parse.stage, { difficulty: 'nomagic' });
    replay.feedKeys(armed.armed.solution);
    expect(replay.outcome).toEqual({ status: 'won' });
    expect(replay.keystrokes).toBe(rec.keystrokes);

    // The hint data, with no second field authored: `hintFor` replays the armed
    // solution and offers its first command at the spawn.
    expect(new GameSession(parse.stage).hint()?.keys).toBe('di(');
  });

  it('the keys an author presses arrive as the tokens the solution is made of', () => {
    const typed = [...'di(G'].map((key) =>
      keyTokenFor({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false }),
    );
    expect(typed).toEqual(tokenize('di(G'));
  });
});

describe('a recording that cannot become a solution refuses to arm', () => {
  it('a key the stage locks, named in the reason', () => {
    const rec = play(new GameSession(act2, { difficulty: 'nomagic' }), 'x');
    expect(rec.rejected).toEqual([{ key: 'x', line: 'You have not been given that key yet.' }]);
    // Rejected keys never tick, so the tally and the token list disagree — which
    // is exactly why par cannot be taken from `session.keystrokes`.
    expect(rec.keystrokes).toBe(0);
    expect(rec.tokens).toEqual(['x']);

    const armed = arm(rec);
    expect(armed.ok).toBe(false);
    if (armed.ok) return;
    expect(armed.reason).toContain('"x"');
    expect(armed.reason).toContain('allowedKeys');
  });

  it('a stage that has not been won', () => {
    const rec = play(new GameSession(act2, { difficulty: 'nomagic' }), 'll');
    expect(rec.outcome).toEqual({ status: 'playing' });
    const armed = arm(rec);
    expect(armed).toEqual({ ok: false, reason: 'the stage has not been won yet — a solution is a route that wins it.' });
  });

  it('a loss, with the condition that ended it', () => {
    const rec = play(new GameSession(act2, { difficulty: 'nomagic' }), 'lllllllllllll');
    expect(rec.outcome.status).toBe('lost');
    const armed = arm(rec);
    expect(armed.ok).toBe(false);
    if (armed.ok) return;
    expect(armed.reason).toContain('keystrokes-over');
  });

  it('nothing recorded at all', () => {
    expect(arm(startRecording()).ok).toBe(false);
  });
});

describe('a recording that contains a FAILED command still arms', () => {
  it("keeps the failed motion's keys, because a human route may contain one", () => {
    // `k` on line 0 cannot move, reports `motion-failed`, and STILL resolves —
    // so it ticks and costs a keystroke, exactly as `validate-stages.ts` says a
    // recorded human route is allowed to.
    const session = new GameSession(act2, { difficulty: 'nomagic' });
    const rec = play(session, 'di(kG');
    expect(rec.outcome).toEqual({ status: 'won' });
    expect(rec.rejected).toEqual([]);
    expect(rec.tokens.length).toBe(rec.keystrokes);

    const armed = arm(rec);
    if (!armed.ok) throw new Error(armed.reason);
    expect(armed.armed).toEqual({ solution: 'di(kG', par: 5 });

    // Par rose with the route, so the armed stage is still valid — the schema
    // rejects a solution LONGER than par, which is why par is the token count.
    const parse = parseDraft(armedDraft(act2Draft, armed.armed.solution, armed.armed.par));
    if (!parse.ok) throw new Error(parse.issues);
  });
});

/**
 * The mutation sweep's own finding: `render(tokens)` and `tokens.join('')` are
 * indistinguishable on every route that contains no literal `<`, which is every
 * other test in this file. This is the case that separates them, and it is the
 * exact failure M3 Wave A existed to fix — measured here rather than argued:
 * `join` gives `i<cr><Esc>`, which tokenizes to THREE tokens and inserts a
 * newline, leaving the stage playing with a buffer of `["", "x"]`.
 */
describe('a recorded literal < survives the round trip', () => {
  it('arms the escaped notation, which replays as the keys that were played', () => {
    const stage = parseStage({
      id: 'literal-angle',
      act: 1,
      title: 'Literal Angle',
      buffer: ['x'],
      entities: [{ id: 'exit', kind: 'goal', at: { line: 0, col: 0 }, glyph: 'X' }],
      par: 6,
      solution: 'i<lt>cr><Esc>',
      win: [{ kind: 'buffer-equals', lines: ['<cr>x'] }],
    });

    const rec = play(new GameSession(stage, { difficulty: 'nomagic' }), 'i<lt>cr><Esc>');
    expect(rec.tokens).toEqual(['i', '<', 'c', 'r', '>', '<Esc>']);
    expect(rec.outcome).toEqual({ status: 'won' });

    const armed = arm(rec);
    if (!armed.ok) throw new Error(armed.reason);
    // The `<` is escaped because the rendered SUFFIX holds a `>` for it to reach.
    expect(armed.armed).toEqual({ solution: 'i<lt>cr><Esc>', par: 6 });
    expect(tokenize(armed.armed.solution)).toEqual(rec.tokens);

    const replay = new GameSession(stage, { difficulty: 'nomagic' });
    replay.feedKeys(armed.armed.solution);
    expect(replay.outcome).toEqual({ status: 'won' });
    expect(replay.engine.lines).toEqual(['<cr>x']);
  });
});

describe('a decided recording is frozen', () => {
  it('ignores tokens the session itself would ignore', () => {
    const session = new GameSession(act2, { difficulty: 'nomagic' });
    const won = play(session, 'di(G');
    // `GameSession.feed` returns [] once the outcome latches, so a token pressed
    // after the win never reaches the engine. Recording it anyway would grow the
    // solution by a key that does nothing — and push it past par.
    const after = record(won, 'l', session.feed('l'));
    expect(after).toBe(won);
  });

  it('never mutates the recording it is given', () => {
    const session = new GameSession(act2, { difficulty: 'nomagic' });
    const before = startRecording();
    const after = record(before, 'l', session.feed('l'));
    expect(before).toEqual({ tokens: [], keystrokes: 0, rejected: [], outcome: { status: 'playing' } });
    expect(after.tokens).toEqual(['l']);
  });
});

describe('the all-three-presets replay, run at record time', () => {
  it("reports act2's own solution winning at every preset", () => {
    expect(replayAtPresets(act2, 'di(G')).toEqual([
      { difficulty: 'verymagic', won: true, detail: 'won in 4 keystrokes' },
      { difficulty: 'magic', won: true, detail: 'won in 4 keystrokes' },
      { difficulty: 'nomagic', won: true, detail: 'won in 4 keystrokes' },
    ]);
  });

  it('SPLITS the presets where the threat cadence does', () => {
    // The measured case the validator's own loop exists for: a goal three cells
    // out with a threat six cells off. `verymagic` halves the chase, so the
    // threat takes one step in the three ticks the route costs instead of three,
    // and arrives on the cursor at full cadence only. A single-preset check in
    // the editor would arm this stage and CI would fail it.
    const split = parseStage({
      id: 'preset-split',
      act: 1,
      title: 'Preset Split',
      buffer: ['abcdefgh'],
      entities: [
        { id: 'exit', kind: 'goal', at: { line: 0, col: 3 }, glyph: 'X' },
        { id: 'it', kind: 'threat', at: { line: 0, col: 6 }, glyph: '?' },
      ],
      par: 3,
      solution: 'lll',
      win: [{ kind: 'cursor-on', entity: 'exit' }],
      lose: [{ kind: 'threat-reaches-cursor' }],
    });

    expect(replayAtPresets(split, 'lll')).toEqual([
      { difficulty: 'verymagic', won: true, detail: 'won in 3 keystrokes' },
      { difficulty: 'magic', won: false, detail: 'lost to threat-reaches-cursor' },
      { difficulty: 'nomagic', won: false, detail: 'lost to threat-reaches-cursor' },
    ]);
  });

  it('says so when a solution simply never wins', () => {
    const replays = replayAtPresets(act2, 'll');
    expect(replays.every((r) => !r.won)).toBe(true);
    expect(replays[0]?.detail).toBe('never won — still playing when the solution ran out');
  });

  it('names keys the stage rejects, which the schema alone cannot see', () => {
    // Not reachable by arming — `arm` refuses first — but reachable by a
    // hand-typed solution, and it is the hole `validate:stages` checks for.
    const replays = replayAtPresets(act2, 'x');
    expect(replays.every((r) => !r.won)).toBe(true);
    expect(replays[0]?.detail).toContain('keys rejected: x');
  });

  it('refuses a WON replay that rejected a key, which is the case the outcome hides', () => {
    // The mutation sweep's second finding: without the rejection term in `won`,
    // this reports three clean presets on a route `validate:stages` fails. A
    // rejected key does not stop the rest of the solution from winning —
    // measured: `x` is locked, `lll` still lands on the goal.
    const gated = parseStage({
      id: 'gated',
      act: 1,
      title: 'Gated',
      buffer: ['abcd'],
      entities: [{ id: 'exit', kind: 'goal', at: { line: 0, col: 3 }, glyph: 'X' }],
      allowedKeys: ['l'],
      par: 3,
      solution: 'lll',
      win: [{ kind: 'cursor-on', entity: 'exit' }],
    });
    const replays = replayAtPresets(gated, 'xlll');
    expect(replays.every((r) => !r.won)).toBe(true);
    expect(replays[0]?.detail).toBe('won in 3 keystrokes; keys rejected: x');
  });
});
