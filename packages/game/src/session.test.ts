/**
 * session.ts — the loop, head-less. Wave C's done-line lives here: a fixture
 * stage is winnable and losable through `session.feedKeys(...)`, with a locked
 * key rejected in character.
 *
 * The fixture sweep doubles as the honest half of M3's solution-replay gate:
 * every stage in `content/stages/` must WIN through its own shipped solution,
 * not merely feed it without rejection (Wave B's weaker check).
 *
 * "The dials" at the bottom is Wave D's done-line, both halves: the identical
 * solution scoring differently across the three presets, and the clean-run flag
 * surviving until a hint request breaks it.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GameSession,
  allowsBeat,
  parseStage,
  stageKeyPolicy,
  type Difficulty,
  type SessionEvent,
  type SessionSnapshot,
  type Stage,
} from './index.ts';

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
    // On `nomagic` ALONE: Wave D made the budget a hard fail on Hard only,
    // scored-but-not-enforced everywhere else (`difficulty.ts`). This test read
    // `new GameSession(stage)` until then, which is now a run that survives.
    const stage = loadStage('act1-four-directions.json');
    const session = new GameSession(stage, { difficulty: 'nomagic' });
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

/** A hallway with a chaser: goal at 0:5, threat starting at 0:3. */
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

/** `lhh` walks the cursor back into the chaser's path: caught on the third act. */
function runHallway(stage: Stage, difficulty: Difficulty): GameSession {
  const session = new GameSession(stage, { difficulty });
  session.feedKeys('lhh');
  return session;
}

describe('threats', () => {
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

describe('the dials', () => {
  /** 19 wasted `h`s and then the real route: wins, but 21 keystrokes against a budget of 20. */
  const WASTEFUL = 'h'.repeat(19) + 'G$';

  it('the IDENTICAL run scores differently at every preset', () => {
    const stage = loadStage('act1-four-directions.json');
    const runs = (['verymagic', 'magic', 'nomagic'] as const).map((difficulty) => {
      const session = new GameSession(stage, { difficulty });
      session.feedKeys(WASTEFUL);
      return { outcome: session.outcome, score: session.score };
    });
    const [easy, normal, hard] = runs;

    // Same keys, same keystrokes, same distance from par at all three.
    expect(runs.map((r) => r.score.keystrokes)).toEqual([21, 21, 21]);
    expect(runs.map((r) => r.score.delta)).toEqual([18, 18, 18]);

    // Easy: won, but never a clean run — the hint was on screen throughout.
    expect(easy!.outcome).toEqual({ status: 'won' });
    expect(easy!.score.clean).toBe(false);
    // Normal: won and clean. The budget is scored (delta 18), not enforced.
    expect(normal!.outcome).toEqual({ status: 'won' });
    expect(normal!.score.clean).toBe(true);
    // Hard: the budget is a hard fail, and it fires on the very tick the cursor
    // lands on the exit — lose is evaluated before win.
    expect(hard!.outcome).toEqual({ status: 'lost', by: { kind: 'keystrokes-over', max: 20 } });
  });

  it('the clean-run flag survives everything until a hint request breaks it', () => {
    const session = new GameSession(loadStage('act1-four-directions.json'));
    expect(session.score.clean).toBe(true);
    session.feedKeys('jjh'); // wandering, and a failed motion, are not recoveries
    expect(session.score.clean).toBe(true);
    expect(session.hint()?.keys).toBe('G');
    expect(session.score.clean).toBe(false);
    expect(session.score.hintsShown).toBe(1);
  });

  it('an undo breaks it too, and is counted by command shape', () => {
    const stage = parseStage({
      id: 'undoable',
      act: 1,
      title: 'Undoable',
      buffer: ['abcdef'],
      par: 4,
      solution: 'xxx',
      win: [{ kind: 'buffer-equals', lines: ['def'] }],
    });
    const session = new GameSession(stage);
    session.feedKeys('xx');
    expect(session.score.clean).toBe(true);
    session.feedKeys('2u'); // counted undo: shape `{count}u`
    expect(session.score.undos).toBe(1);
    expect(session.score.clean).toBe(false);
  });

  it('verymagic swallows the failure LINE and nothing else about the failure', () => {
    const stage = loadStage('act1-four-directions.json');
    const easy = new GameSession(stage, { difficulty: 'verymagic' });
    const events = easy.feed('h'); // `h` at 0:0 — motion-failed
    expect(ofType(events, 'CommandRefused')).toHaveLength(0);
    // Still resolved, still cost a keystroke, still ticked the world: only the
    // key policy makes a keypress free, at every difficulty.
    expect(ofType(events, 'Tick')).toHaveLength(1);
    expect(easy.keystrokes).toBe(1);
    expect(easy.engine.cursor).toEqual({ line: 0, col: 0 });

    const normal = new GameSession(stage);
    expect(ofType(normal.feed('h'), 'CommandRefused')).toHaveLength(1);
  });

  it('verymagic never swallows a rejection or any other refusal', () => {
    // The silence is scoped to `motion-failed`. A locked key still teaches, and
    // a `u` with nothing behind it still says so.
    const session = new GameSession(loadStage('act1-four-directions.json'), { difficulty: 'verymagic' });
    expect(ofType(session.feed('x'), 'KeyRejected')).toHaveLength(1);
    const ungated = new GameSession(
      parseStage({ id: 'u', act: 1, title: 'U', buffer: ['ab'], par: 1, solution: 'x', win: [{ kind: 'buffer-equals', lines: ['b'] }] }),
      { difficulty: 'verymagic' },
    );
    const refused = ofType(ungated.feed('u'), 'CommandRefused');
    expect(refused.map((e) => e.reason)).toEqual(['nothing-to-undo']);
  });

  it('half speed: the chase that catches you on magic misses on verymagic', () => {
    const stage = hallway();
    expect(runHallway(stage, 'magic').outcome).toEqual({ status: 'lost', by: { kind: 'threat-reaches-cursor' } });
    // Same three acts, but the threat only stepped on the second of them.
    const easy = runHallway(stage, 'verymagic');
    expect(easy.outcome).toEqual({ status: 'playing' });
    expect(easy.entities[1]!.at).toEqual({ line: 0, col: 2 });
  });

  it('PROPERTY: comfort settings change which beats fire and nothing else', () => {
    const stage = loadStage('act2-grammar-awakens.json');
    const keys = fc.array(fc.constantFrom('d', 'i', '(', 'G', 'j', 'k', 'l', 'h', 'y', 'p', 'b', 'e', 'w'), { maxLength: 10 });
    const comforts = fc.constantFrom(
      { gentle: false, jumpScares: true },
      { gentle: true, jumpScares: true },
      { gentle: false, jumpScares: false },
      { gentle: true, jumpScares: false },
    );
    fc.assert(
      fc.property(keys, comforts, (typed, comfort) => {
        const authored = new GameSession(stage);
        const comfortable = new GameSession(stage, { comfort });
        const a = typed.flatMap((k) => authored.feed(k));
        const b = typed.flatMap((k) => comfortable.feed(k));

        // Same world, key for key: buffer, cursor, entities, score, outcome.
        expect(comfortable.engine.lines).toEqual(authored.engine.lines);
        expect(comfortable.engine.cursor).toEqual(authored.engine.cursor);
        expect(comfortable.entities).toEqual(authored.entities);
        expect(comfortable.score).toEqual(authored.score);
        expect(comfortable.outcome).toEqual(authored.outcome);
        // Same event stream too, once the beats are set aside.
        expect(b.filter((e) => e.type !== 'BeatFired')).toEqual(a.filter((e) => e.type !== 'BeatFired'));

        // And the beats that did fire are exactly the permitted ones.
        const expected = ofType(a, 'BeatFired').filter((e) => allowsBeat(e.beat, comfort));
        expect(ofType(b, 'BeatFired')).toEqual(expected);
      }),
    );
  });

  it('a suppressed beat is spent, not deferred — it never fires later', () => {
    const stage = loadStage('act2-grammar-awakens.json');
    const session = new GameSession(stage, { comfort: { gentle: true, jumpScares: true } });
    const events = session.feedKeys(stage.solution);
    // `aside-removed` is the startling one, and its condition still holds after.
    expect(ofType(events, 'BeatFired').map((e) => e.beat.id)).toEqual(['aside-noticed']);
    expect(session.outcome).toEqual({ status: 'won' });
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
    const session = new GameSession(loadStage('act1-four-directions.json'), { difficulty: 'nomagic' });
    const events = session.feedKeys('h'.repeat(30));
    expect(ofType(events, 'Tick')).toHaveLength(21); // 21 lost it; 9 ignored
  });
});

// ---------------------------------------------------------------------------
// Wave E — the director-determinism test, one layer up
// ---------------------------------------------------------------------------

/**
 * The milestone keystone. `MergedPlan.md` states M2's done-line as: *a replay
 * containing injected edits must reproduce byte-identically from its snapshot.
 * If horror breaks replay, the director API is wrong.* Wave A proved that for
 * the ENGINE (`engine.test.ts`); this is the same claim for the session wrapped
 * around it, which until this wave had no `snapshot`/`restore` at all — nine
 * pieces of state vanished on every reload, none of them loudly.
 *
 * Two assertions here because Wave A's suite needed both, and neither is
 * optional: **re-snapshot the restored session and compare JSON strings** (the
 * only thing that sees a `Set` reaching JSON as `{}`) and **exercise a
 * `$`-in-visual selection** (the only shape that sees a cursor clamped on
 * restore — and, as it turned out, the only shape that sees a mid-command
 * keystroke count silently refunded).
 */

/** Save and load exactly as M4's `localStorage` will: through actual JSON. */
function roundTrip(stage: Stage, session: GameSession): GameSession {
  return GameSession.restore(stage, JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot);
}

/** Everything a player can observe of a session. `hint()` is excluded: it CHARGES. */
function observable(s: GameSession) {
  return {
    lines: [...s.engine.lines],
    cursor: s.engine.cursor,
    mode: s.engine.mode,
    registers: s.engine.state.registers,
    entities: s.entities,
    keystrokes: s.keystrokes,
    outcome: s.outcome,
    score: s.score,
  };
}

/** Ungated (so a rich tail runs), with a chaser, a beat, and a goal off the script's route. */
const haunted = (): Stage =>
  parseStage({
    id: 'haunted',
    act: 3,
    title: 'Haunted',
    buffer: ['alpha beta', 'gamma delta', 'epsilon zeta'],
    entities: [
      { id: 'exit', kind: 'goal', at: { line: 2, col: 11 }, glyph: 'X' },
      { id: 'follower', kind: 'threat', at: { line: 2, col: 0 }, glyph: '?' },
    ],
    par: 40,
    solution: 'G$',
    win: [{ kind: 'cursor-on', entity: 'exit' }],
    beats: [
      { id: 'breath', text: 'It is closer than it was.', startling: false, on: { kind: 'cursor-on', entity: 'follower' } },
    ],
  });

/** Player keys interleaved with every director mutation, building history of each kind. */
function script(s: GameSession): void {
  s.feedKeys('dw');
  s.engine.director.injectEdit({ start: { line: 1, col: 0 }, end: { line: 1, col: 5 }, text: 'WATCH' });
  s.feedKeys('majjyy');
  s.engine.director.rewriteRegister('z', 'not yours', 'charwise');
  s.feedKeys('qcxq');
}

describe('the director-determinism test, one layer up', () => {
  it('a replay mixing player keys with injected edits reproduces byte-identically', () => {
    const stage = haunted();
    const live = new GameSession(stage);
    script(live);

    const restored = roundTrip(stage, live);
    expect(observable(restored)).toEqual(observable(live));

    // Consume every kind of history the script built, in one go: undo tree,
    // redo, dot record, macro, mark, and a director-rewritten register.
    const tail = 'u<C-r>.@cd`a"zp';
    const liveEvents = live.feedKeys(tail);
    // The event streams are the strong half — ticks, threat moves and beats all
    // travel in them, so equality here pins the tick count, the live entity
    // positions and the fired-beat set at once.
    expect(restored.feedKeys(tail)).toEqual(liveEvents);
    expect(observable(restored)).toEqual(observable(live));
  });

  it('is idempotent: a restored session re-snapshots to the identical JSON', () => {
    // The canary for a `Set` that reached JSON as `{}` — `#firedBeats` is the
    // one here, and the script fires `breath`, so the set is genuinely non-empty.
    const stage = haunted();
    const live = new GameSession(stage);
    script(live);
    expect(live.snapshot().firedBeats).toEqual(['breath']);

    const once = JSON.stringify(live.snapshot());
    expect(JSON.stringify(roundTrip(stage, live).snapshot())).toEqual(once);
  });

  it('a mid-visual `$` selection survives, keystrokes included', () => {
    // `$` parks the cursor ON the end-of-line NUL and an inclusive selection
    // ending there takes the LINE BREAK, which is why `v$d` joins the next line
    // up. A restore that clamps gives `['', 'cd']`; one that forgets the keys
    // already spent scores the delete at 1 keystroke instead of 3.
    const stage = parseStage({
      id: 'visual-save',
      act: 5,
      title: 'Visual Save',
      buffer: ['ab', 'cd'],
      par: 3,
      solution: 'v$d',
      win: [{ kind: 'buffer-equals', lines: ['cd'] }],
    });
    const live = new GameSession(stage);
    live.feedKeys('v$');

    const restored = roundTrip(stage, live);
    expect(restored.engine.mode).toBe('visual');
    expect(restored.engine.cursor).toEqual({ line: 0, col: 2 });

    const liveEvents = live.feedKeys('d');
    expect(restored.feedKeys('d')).toEqual(liveEvents);
    expect(restored.engine.lines).toEqual(['cd']);
    expect(restored.keystrokes).toBe(3);
    expect(observable(restored)).toEqual(observable(live));
  });

  it('a director injection is not a player act — it never ticks', () => {
    // The horror layer edits the buffer without advancing the world: no
    // keystroke, no tick, no chase step. Otherwise the director could kill you.
    const stage = hallway();
    const live = new GameSession(stage);
    live.engine.director.injectEdit({ start: { line: 0, col: 0 }, end: { line: 0, col: 1 }, text: 'Z' });
    expect(live.keystrokes).toBe(0);
    expect(live.entities).toEqual(stage.entities);

    const restored = roundTrip(stage, live);
    expect(observable(restored)).toEqual(observable(live));
    expect(restored.engine.lines).toEqual(['Zbcdef']);
  });
});

describe('the nine pieces of session state a reload used to drop', () => {
  it('LIVE threat positions, not the authored ones', () => {
    // A restore that handed back `stage.entities` would teleport every threat to
    // where the author drew it — and then the chase would have to start over.
    const stage = hallway();
    const live = new GameSession(stage);
    live.feedKeys('l'); // cursor 0:1; threat 0:3 -> 0:2

    const restored = roundTrip(stage, live);
    expect(restored.entities[1]!.at).toEqual({ line: 0, col: 2 });
    expect(stage.entities[1]!.at).toEqual({ line: 0, col: 3 });

    // The chase resumes mid-stride, so the catch lands on the same act it would
    // have live — two more steps, not four.
    live.feedKeys('hh');
    restored.feedKeys('hh');
    expect(restored.outcome).toEqual({ status: 'lost', by: { kind: 'threat-reaches-cursor' } });
    expect(observable(restored)).toEqual(observable(live));
  });

  it('the tick count, so a verymagic chase keeps its cadence parity', () => {
    // Half speed is every OTHER tick, so the count's parity — not just its
    // presence — decides which act a threat moves on. A restore at 0 would
    // chase on the wrong turns forever after.
    const stage = hallway();
    const live = new GameSession(stage, { difficulty: 'verymagic' });
    live.feedKeys('l'); // tick 1: odd, no chase
    expect(live.entities[1]!.at).toEqual({ line: 0, col: 3 });

    const restored = roundTrip(stage, live);
    const liveEvents = live.feedKeys('l'); // tick 2: even, chases
    expect(ofType(liveEvents, 'ThreatMoved')).toHaveLength(1);
    expect(restored.feedKeys('l')).toEqual(liveEvents);
  });

  it('the tallies — keystrokes, undos and hints all reach the score', () => {
    const stage = haunted();
    const live = new GameSession(stage);
    live.feedKeys('xu'); // 2 keystrokes, one undo, and the buffer back at spawn
    expect(live.hint()?.keys).toBe('G'); // so the hint is on-path, and charges
    expect(live.score).toMatchObject({ keystrokes: 2, undos: 1, hintsShown: 1, clean: false });

    const restored = roundTrip(stage, live);
    expect(restored.score).toEqual(live.score);
  });

  it('the outcome: a decided session comes back decided, and stays frozen', () => {
    const stage = loadStage('act1-four-directions.json');
    const live = new GameSession(stage);
    live.feedKeys(stage.solution);
    expect(live.outcome).toEqual({ status: 'won' });

    const restored = roundTrip(stage, live);
    expect(restored.outcome).toEqual({ status: 'won' });
    expect(restored.feed('h')).toEqual([]);
    expect(restored.keystrokes).toBe(live.keystrokes);
    expect(restored.hint()).toBeUndefined(); // frozen for hints too
  });

  it('a LOST outcome carries the condition that fired it through JSON', () => {
    const stage = loadStage('act1-four-directions.json');
    const live = new GameSession(stage, { difficulty: 'nomagic' });
    live.feedKeys('h'.repeat(21));
    expect(live.outcome).toEqual({ status: 'lost', by: { kind: 'keystrokes-over', max: 20 } });
    expect(roundTrip(stage, live).outcome).toEqual(live.outcome);
  });

  it('the fired-beat set: a reload does not re-arm a beat that already fired', () => {
    const stage = loadStage('act2-grammar-awakens.json');
    const live = new GameSession(stage);
    expect(ofType(live.feedKeys('di('), 'BeatFired').map((e) => e.beat.id)).toEqual(['aside-noticed']);

    const restored = roundTrip(stage, live);
    // `aside-noticed`'s condition STILL holds — the cursor is still inside
    // the-aside — so an empty restored set would fire it a second time here.
    expect(ofType(restored.feed('l'), 'BeatFired')).toHaveLength(0);
    // And the beat still ahead of the player fires normally.
    expect(ofType(restored.feedKeys('G'), 'BeatFired').map((e) => e.beat.id)).toEqual(['aside-removed']);
    expect(restored.outcome).toEqual({ status: 'won' });
  });

  it('the difficulty setting, and the dial it drives', () => {
    const stage = loadStage('act1-four-directions.json');
    const live = new GameSession(stage, { difficulty: 'nomagic' });
    live.feedKeys('h'.repeat(19));

    const restored = roundTrip(stage, live);
    expect(restored.difficulty).toBe('nomagic');
    expect(restored.modifiers).toEqual(live.modifiers);
    // The budget is enforced on `nomagic` alone, and this run is 19 keystrokes
    // into a budget of 20. Restored as the default `magic`, it would survive.
    restored.feedKeys('hh');
    expect(restored.outcome).toEqual({ status: 'lost', by: { kind: 'keystrokes-over', max: 20 } });
    expect(restored.hint()).toBeUndefined(); // `nomagic` refuses hints outright
  });

  it('the comfort setting, and the beat it suppresses', () => {
    const stage = loadStage('act2-grammar-awakens.json');
    const comfort = { gentle: true, jumpScares: false };
    const live = new GameSession(stage, { comfort });
    live.feedKeys('di(');

    const restored = roundTrip(stage, live);
    expect(restored.comfort).toEqual(comfort);
    // `aside-removed` is the startling one. Restored to the authored default it
    // would fire on the winning tick.
    expect(ofType(restored.feedKeys('G'), 'BeatFired')).toHaveLength(0);
    expect(restored.outcome).toEqual({ status: 'won' });
  });

  it('the key policy is re-derived from the stage, so a locked key stays locked', () => {
    // Not a horror concern — a gameplay-correctness bug any player who reloads
    // can reach. Key gating IS the pedagogy; it must not evaporate on load.
    const stage = loadStage('act1-four-directions.json');
    const live = new GameSession(stage);
    live.feedKeys('jj');

    const restored = roundTrip(stage, live);
    expect(restored.engine.state.keyPolicy).toEqual(stageKeyPolicy(stage));
    expect(restored.feed('x')).toEqual([
      { type: 'KeyRejected', key: 'x', reason: 'key-locked', line: 'You have not been given that key yet.' },
    ]);
    expect(restored.keystrokes).toBe(live.keystrokes);
  });

  it('gating follows the STAGE, so a corrected stage re-gates an old save', () => {
    // The one case that distinguishes re-deriving the policy from taking the
    // engine save's copy, and the reason the split exists: `allowedKeys` is
    // AUTHORED state. A stage fixed in M3's editor — a key it forgot to grant,
    // a key it should never have granted — must take effect on the next load
    // instead of a stale policy persisting inside every save of that stage.
    const authored = {
      id: 'corrected',
      act: 1,
      title: 'Corrected',
      buffer: ['abcdef'],
      par: 3,
      solution: 'lll',
      win: [{ kind: 'cursor-on', entity: 'exit' }],
      entities: [{ id: 'exit', kind: 'goal', at: { line: 0, col: 3 }, glyph: 'X' }],
      allowedKeys: ['l'],
    };
    const live = new GameSession(parseStage(authored));
    live.feedKeys('l');
    expect(ofType(live.feed('h'), 'KeyRejected')).toHaveLength(1);

    const corrected = parseStage({ ...authored, allowedKeys: ['hl'] });
    const restored = GameSession.restore(corrected, JSON.parse(JSON.stringify(live.snapshot())) as SessionSnapshot);
    expect(ofType(restored.feed('h'), 'KeyRejected')).toHaveLength(0);
    expect(restored.engine.cursor).toEqual({ line: 0, col: 0 });
  });

  it('refuses a snapshot that belongs to another stage', () => {
    // The one loud failure on a surface where everything else fails quietly: a
    // play restored onto the wrong stage runs perfectly and evaluates the wrong
    // conditions.
    const live = new GameSession(loadStage('act1-four-directions.json'));
    const snap = JSON.parse(JSON.stringify(live.snapshot())) as SessionSnapshot;
    expect(() => GameSession.restore(loadStage('act1-two-worlds.json'), snap)).toThrow(
      /belongs to stage "act1-four-directions", not "act1-two-worlds"/,
    );
  });
});
