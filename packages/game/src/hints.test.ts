/**
 * hints.ts — the live state diffed against the solution's own replay.
 *
 * Two things here are the whole design, and each has a case that fails loudly
 * if it regresses: a hint is a COMMAND (`di(`, not `d`), and a hint is chosen by
 * matching STATE rather than typed keys, so a player who reached the same place
 * by another route is still on the path.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GameSession, hintFor, parseStage, solutionPath, type Stage } from './index.ts';

const stagesDir = fileURLToPath(new URL('../../../content/stages', import.meta.url));
const loadStage = (file: string): Stage => parseStage(JSON.parse(readFileSync(join(stagesDir, file), 'utf8')));

const nav = () => loadStage('act1-four-directions.json'); // solution: G$
const grammar = () => loadStage('act2-grammar-awakens.json'); // solution: di(G
const insert = () => loadStage('act1-two-worlds.json'); // solution: ihello, <Esc>

describe('solutionPath', () => {
  it('groups by resolved command, not by keystroke', () => {
    // Four keys, two steps — the reason hints say `di(` instead of `d`.
    const steps = solutionPath(grammar());
    expect(steps.map((s) => s.keys)).toEqual(['di(', 'G']);
    expect(steps[0]!.lines[0]).toBe('delete the () doubt');
    expect(steps[1]!.cursor).toEqual({ line: 2, col: 0 });
  });

  it('a whole insert session is ONE step, exactly as it is one tick', () => {
    expect(solutionPath(insert()).map((s) => s.keys)).toEqual(['ihello, <Esc>']);
  });
});

describe('hintFor', () => {
  it('hints the first command at spawn', () => {
    expect(hintFor(nav(), { lines: nav().buffer, cursor: nav().cursor })).toEqual({
      keys: 'G',
      index: 0,
      total: 2,
      onPath: true,
    });
  });

  it('advances as the player walks the path', () => {
    const stage = nav();
    const session = new GameSession(stage);
    session.feed('G');
    expect(session.hint()).toEqual({ keys: '$', index: 1, total: 2, onPath: true });
  });

  it('runs dry once the solution is complete — a solved stage has nothing to hint', () => {
    const stage = grammar();
    const session = new GameSession(stage);
    session.feedKeys('di(G');
    expect(session.hint()).toBeUndefined();
  });

  it('a route the solution never takes still gets the state it lands in', () => {
    // `jjj$` reaches the goal without ever typing `G`. A key-prefix hint would
    // have declared the player off-path at the first keystroke; matching state
    // sees the win.
    const stage = nav();
    const session = new GameSession(stage);
    session.feedKeys('jjj$');
    expect(session.engine.cursor).toEqual({ line: 3, col: 14 });
    expect(session.hint()).toBeUndefined();
  });

  it('off the path, hints the earliest command that fits the buffer', () => {
    const stage = nav();
    const session = new GameSession(stage);
    session.feed('j'); // 1:0 — a position the solution never passes through
    expect(session.hint()).toEqual({ keys: 'G', index: 0, total: 2, onPath: false });
  });

  it('gives nothing when the buffer itself is off the route', () => {
    // The honest answer to "I have edited this into something the solution
    // never produces" is `u`, not a keystroke from a path the player is not on.
    expect(hintFor(grammar(), { lines: ['nothing like the stage'], cursor: { line: 0, col: 0 } })).toBeUndefined();
  });

  it('gives nothing mid-insert — a half-typed session is no state the path holds', () => {
    const session = new GameSession(insert());
    session.feedKeys('ihel');
    expect(session.engine.lines).toEqual(['helworld']);
    expect(session.hint()).toBeUndefined();
  });
});

describe('the hint policy', () => {
  it('nomagic refuses, and charges nothing for asking', () => {
    const session = new GameSession(nav(), { difficulty: 'nomagic' });
    expect(session.hint()).toBeUndefined();
    expect(session.score.hintsShown).toBe(0);
    expect(session.score.clean).toBe(true);
  });

  it('magic answers on request, and every request counts', () => {
    const session = new GameSession(nav(), { difficulty: 'magic' });
    expect(session.hint()?.keys).toBe('G');
    expect(session.hint()?.keys).toBe('G');
    expect(session.score.hintsShown).toBe(2);
  });

  it('a decided session is frozen for hints too — a score cannot change after the run', () => {
    const session = new GameSession(nav(), { difficulty: 'magic' });
    session.feedKeys('G$');
    expect(session.outcome).toEqual({ status: 'won' });
    expect(session.hint()).toBeUndefined();
    expect(session.score.hintsShown).toBe(0);
    expect(session.score.clean).toBe(true);
  });

  it('a LOST session likewise, though the route is still readable directly', () => {
    const stage = nav();
    const session = new GameSession(stage, { difficulty: 'nomagic' });
    session.feedKeys('h'.repeat(21)); // over the budget, and nomagic enforces it
    expect(session.outcome.status).toBe('lost');
    expect(session.hint()).toBeUndefined();
    expect(session.score.hintsShown).toBe(0);
    // `hintFor` is pure and exported, so a loss screen can still show the route.
    expect(hintFor(stage, { lines: session.engine.lines, cursor: session.engine.cursor })?.keys).toBe('G');
  });

  it('verymagic answers without counting — the run was never clean anyway', () => {
    const session = new GameSession(nav(), { difficulty: 'verymagic' });
    expect(session.hint()?.keys).toBe('G');
    expect(session.score.hintsShown).toBe(0);
    expect(session.score.clean).toBe(false);
  });
});
