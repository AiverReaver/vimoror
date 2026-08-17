/**
 * session.ts — the loop, head-less. Wave C's done-line lives here: a fixture
 * stage is winnable and losable through `session.feedKeys(...)`, with a locked
 * key rejected in character.
 *
 * The fixture sweep doubles as the honest half of M3's solution-replay gate:
 * every stage in `content/stages/` must WIN through its own shipped solution,
 * not merely feed it without rejection (Wave B's weaker check).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GameSession, parseStage, type SessionEvent, type Stage } from './index.ts';

const stagesDir = fileURLToPath(new URL('../../../content/stages', import.meta.url));

function loadStage(file: string): Stage {
  return parseStage(JSON.parse(readFileSync(join(stagesDir, file), 'utf8')));
}

const ofType = <T extends SessionEvent['type']>(events: SessionEvent[], type: T) =>
  events.filter((e): e is Extract<SessionEvent, { type: T }> => e.type === type);

describe('every shipped fixture wins by its own solution', () => {
  for (const file of readdirSync(stagesDir).filter((f) => f.endsWith('.json'))) {
    it(file, () => {
      const stage = loadStage(file);
      const session = new GameSession(stage);
      session.feedKeys(stage.solution);
      expect(session.outcome).toEqual({ status: 'won' });
      expect(session.keystrokes).toBeLessThanOrEqual(stage.par);
    });
  }
});

describe('the tick', () => {
  it('a whole insert session is ONE tick', () => {
    const session = new GameSession(loadStage('act1-two-worlds.json'));
    const events = session.feedKeys('ihello, <Esc>');
    const ticks = ofType(events, 'Tick');
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.command.keystrokes).toBe(9);
    // The SESSION total, not just core's per-command field — a budget that
    // counted commands instead of keystrokes would satisfy every other test.
    expect(ticks[0]!.keystrokes).toBe(9);
    expect(session.keystrokes).toBe(9);
    expect(session.outcome).toEqual({ status: 'won' });
  });

  it('<Esc> escapes insert mode even on a stage that does not list it', () => {
    // act2 allows `i` (for `di(`) and never lists `<Esc>` — the exact shape
    // that used to soft-lock: enter insert, and no key on earth gets you out.
    const session = new GameSession(loadStage('act2-grammar-awakens.json'));
    session.feed('i');
    expect(session.engine.mode).toBe('insert');
    const events = session.feed('<Esc>');
    expect(ofType(events, 'KeyRejected')).toHaveLength(0);
    expect(session.engine.mode).toBe('normal');
    expect(ofType(events, 'Tick')).toHaveLength(1); // the session resolved
  });

  it(':q and :w pass through as host events, not silence', () => {
    // Zero-I/O core delegates save/quit to the host, and they leave no trace
    // in engine state to read back — this stream is their only conduit.
    const session = new GameSession(loadStage('act1-two-worlds.json'));
    const events = session.feedKeys(':q<CR>');
    expect(events).toContainEqual({ type: 'QuitRequested', force: false });
    const saved = session.feedKeys(':w<CR>');
    expect(saved).toContainEqual({ type: 'BufferSaved', force: false });
  });

  it('a FAILED command still ticks — only the key policy makes a keypress free', () => {
    const session = new GameSession(loadStage('act1-four-directions.json'));
    // `h` at 0:0 fails (motion-failed), resolves, and counts.
    const events = session.feed('h');
    expect(ofType(events, 'CommandRefused')).toHaveLength(1);
    expect(ofType(events, 'Tick')).toHaveLength(1);
    expect(session.keystrokes).toBe(1);
  });

  it('exhausting the keystroke budget loses, and names the budget', () => {
    const stage = loadStage('act1-four-directions.json');
    const session = new GameSession(stage);
    const events = session.feedKeys('h'.repeat(21));
    expect(session.outcome).toEqual({ status: 'lost', by: { kind: 'keystrokes-over', max: 20 } });
    // The loss latched on the 21st tick, not before.
    expect(ofType(events, 'Tick')).toHaveLength(21);
  });
});

describe('key gating in character', () => {
  it('a locked key is rejected with the in-fiction line and changes nothing', () => {
    const session = new GameSession(loadStage('act1-four-directions.json'));
    const before = JSON.stringify(session.engine.snapshot());
    const events = session.feed('x');
    expect(events).toEqual([
      { type: 'KeyRejected', key: 'x', reason: 'key-locked', line: 'You have not been given that key yet.' },
    ]);
    expect(session.keystrokes).toBe(0);
    expect(JSON.stringify(session.engine.snapshot())).toBe(before);
  });

  it('PROPERTY: a locked key never ticks, whatever came before it', () => {
    const stage = loadStage('act1-four-directions.json');
    const allowed = fc.array(fc.constantFrom('h', 'j', 'k', 'l', 'g', 'G', '^', '$', '2', '5'), { maxLength: 8 });
    const locked = fc.constantFrom('x', 'i', 'd', 'w', 'v', 'u');
    fc.assert(
      fc.property(allowed, locked, (prefix, key) => {
        const session = new GameSession(stage);
        for (const k of prefix) session.feed(k);
        const keystrokes = session.keystrokes;
        const entities = session.entities;
        const outcome = session.outcome;
        const snap = JSON.stringify(session.engine.snapshot());
        const events = session.feed(key);
        expect(ofType(events, 'Tick')).toHaveLength(0);
        expect(session.keystrokes).toBe(keystrokes);
        expect(session.entities).toBe(entities);
        expect(session.outcome).toBe(outcome);
        expect(JSON.stringify(session.engine.snapshot())).toBe(snap);
      }),
    );
  });
});

describe('threats', () => {
  /** A hallway with a chaser: ......goal at 0:5, threat starting at 0:3. */
  const hallway = (): Stage =>
    parseStage({
      id: 'hallway',
      act: 1,
      title: 'Hallway',
      buffer: ['abcdef'],
      entities: [
        { id: 'exit', kind: 'goal', at: { line: 0, col: 5 }, glyph: 'X' },
        { id: 'stalker', kind: 'threat', at: { line: 0, col: 3 }, glyph: '?' },
      ],
      par: 2,
      solution: '5l',
      win: [{ kind: 'cursor-on', entity: 'exit' }],
      lose: [{ kind: 'threat-reaches-cursor' }],
    });

  it('threats move one step per tick, toward the cursor', () => {
    const session = new GameSession(hallway());
    const events = session.feed('l'); // cursor 0:1; threat 0:3 -> 0:2
    const moved = ofType(events, 'ThreatMoved');
    expect(moved).toHaveLength(1);
    expect(moved[0]!.entity.at).toEqual({ line: 0, col: 2 });
    expect(session.outcome).toEqual({ status: 'playing' });
  });

  it('a threat that moves onto the cursor loses the stage', () => {
    const session = new GameSession(hallway());
    session.feed('l'); // cursor 0:1, threat -> 0:2
    session.feed('h'); // cursor 0:0, threat -> 0:1
    session.feed('h'); // fails, still ticks: threat -> 0:0 == cursor
    expect(session.outcome).toEqual({ status: 'lost', by: { kind: 'threat-reaches-cursor' } });
  });

  it('standing in a threat is safe — the threat must do the reaching', () => {
    const session = new GameSession(hallway());
    session.feed('l'); // cursor 0:1, threat -> 0:2
    session.feed('l'); // cursor 0:2, ON the threat; zero gap, threat holds, no reach
    expect(session.outcome).toEqual({ status: 'playing' });
  });

  it('outrunning the chase to the goal wins', () => {
    const session = new GameSession(hallway());
    session.feedKeys('5l'); // cursor 0:5 == exit; threat only reaches 0:4
    expect(session.outcome).toEqual({ status: 'won' });
  });

  it('the stage entities never move — only the session copy does', () => {
    const stage = hallway();
    const session = new GameSession(stage);
    session.feed('l');
    expect(stage.entities[1]!.at).toEqual({ line: 0, col: 3 });
    expect(session.entities[1]!.at).toEqual({ line: 0, col: 2 });
  });

  it('conditions read the LIVE positions — cursor-on a threat that has MOVED', () => {
    // The one wiring only a session-level test can see: rules.test.ts proves
    // evalCondition honors whatever entities it is handed, but nothing else
    // proves the session hands it the post-step copy rather than the authored
    // one. Every fixture's cursor-on target is stationary, so authored and
    // live coincide everywhere but here.
    const stage = parseStage({
      id: 'hallway-touch',
      act: 1,
      title: 'Touch',
      buffer: ['abcdef'],
      entities: [
        { id: 'exit', kind: 'goal', at: { line: 0, col: 5 }, glyph: 'X' },
        { id: 'stalker', kind: 'threat', at: { line: 0, col: 3 }, glyph: '?' },
      ],
      par: 5,
      solution: '5l',
      win: [{ kind: 'cursor-on', entity: 'exit' }],
      lose: [{ kind: 'cursor-on', entity: 'stalker' }],
    });
    const session = new GameSession(stage);
    session.feed('l'); // cursor 0:1; threat chases 0:3 -> 0:2
    expect(session.outcome).toEqual({ status: 'playing' });
    session.feed('l'); // cursor 0:2, where the threat NOW stands (authored: 0:3)
    expect(session.outcome).toEqual({ status: 'lost', by: { kind: 'cursor-on', entity: 'stalker' } });
  });
});

describe('act2-grammar-awakens end to end', () => {
  it('wins by its own solution, surviving a tick spent inside the threat', () => {
    const stage = loadStage('act2-grammar-awakens.json');
    const session = new GameSession(stage);
    const events = session.feedKeys(stage.solution); // di(G
    // After di( the cursor sits at 0:12, INSIDE the-aside's static rectangle.
    // Zero chase gap: the threat holds, nothing reaches, the stage survives
    // the first command of its own solution — the decision Wave B left open.
    expect(session.outcome).toEqual({ status: 'won' });
    // Entity coordinates are static: di( shortened line 0 by 13 characters and
    // the rectangle did not re-anchor (it moved later only by its own chase).
    const beats = ofType(events, 'BeatFired').map((e) => e.beat.id);
    expect(beats).toEqual(['aside-noticed', 'aside-removed']);
  });

  it('a beat fires once, not once per tick its condition holds', () => {
    const session = new GameSession(loadStage('act2-grammar-awakens.json'));
    const first = session.feedKeys('di('); // cursor 0:12, inside the-aside
    expect(ofType(first, 'BeatFired').map((e) => e.beat.id)).toEqual(['aside-noticed']);
    const second = session.feed('l'); // 0:13, still inside
    expect(ofType(second, 'BeatFired')).toHaveLength(0);
  });
});

describe('a decided session is frozen', () => {
  it('ignores keys after a win', () => {
    const stage = loadStage('act1-four-directions.json');
    const session = new GameSession(stage);
    session.feedKeys(stage.solution);
    expect(session.outcome).toEqual({ status: 'won' });
    const keystrokes = session.keystrokes;
    expect(session.feed('h')).toEqual([]);
    expect(session.keystrokes).toBe(keystrokes);
  });

  it('a mid-string loss freezes the rest of the string', () => {
    const session = new GameSession(loadStage('act1-four-directions.json'));
    const events = session.feedKeys('h'.repeat(30));
    expect(ofType(events, 'Tick')).toHaveLength(21); // 21 lost it; 9 ignored
  });
});
