/**
 * `VimEngine`'s two facade-level contracts, both of which M2 rests on and
 * neither of which any golden can see (the comparator diffs a buffer, not a
 * round trip or an event stream).
 *
 * 1. **A snapshot survives a JSON round trip with its history intact.**
 *    `MergedPlan.md` states M2's own done-line as: a replay containing injected
 *    edits must reproduce byte-identically from its snapshot. The table below
 *    is the measured list of capabilities that used to diverge because
 *    `snapshot()` serialized only lines/cursor/mode/registers/search/options.
 *
 * 2. **A command resolves once per return to REST**, where rest means no
 *    pending key buffer, no insert session and no visual selection. The old
 *    rule ("the pending buffer emptied having held something") silently scored
 *    zero for every one-key command and for every insert session's typing.
 */

import { describe, expect, it } from 'vitest';
import { VimEngine, type EngineSnapshot } from './engine.ts';
import type { ResolvedCommand } from './types.ts';

const LINES = ['alpha beta', 'gamma delta', 'epsilon zeta'];

/** Save and load exactly as a host does it — through actual JSON. */
function roundTrip(e: VimEngine): VimEngine {
  return VimEngine.restore(JSON.parse(JSON.stringify(e.snapshot())) as EngineSnapshot);
}

/** Everything a player can observe. */
function observable(e: VimEngine) {
  return {
    lines: [...e.lines],
    cursor: e.cursor,
    mode: e.mode,
    registers: e.state.registers,
  };
}

describe('snapshot round trip preserves history', () => {
  /**
   * `[capability, keys that BUILD the history, keys that CONSUME it]`. Every
   * row diverged before Wave A: the consuming key found an engine with no
   * history to work on and quietly did nothing (or something else).
   */
  const REPLAY: readonly (readonly [string, string, string])[] = [
    ['undo tree', 'dw', 'u'],
    ['redo', 'dwu', '<C-r>'],
    ['dot record', 'dw', '.'],
    ['dot record with an insert half', 'ciwZZ<Esc>w', '.'],
    ['marks', 'majj', 'd`a'],
    ['previous-context mark', 'Gjj', "d''"],
    ['macros', 'qaxq', '@a'],
    ['last macro register', 'qaxq@a', '@@'],
    ['jumplist', 'G', '<C-o>'],
    ['lastFind', 'fa', ';'],
    ['last visual selection', 'vll<Esc>w', 'gvd'],
    // These two already worked; they are here so a refactor cannot lose them.
    ['search state', '/gamma<CR>', 'n'],
    ['registers', 'yw', '"0p'],
  ];

  for (const [name, build, consume] of REPLAY) {
    it(`${name}: \`${build}\` then \`${consume}\``, () => {
      const live = new VimEngine(LINES);
      live.feedKeys(build);

      const restored = roundTrip(live);
      expect(observable(restored)).toEqual(observable(live));

      live.feedKeys(consume);
      restored.feedKeys(consume);
      expect(observable(restored)).toEqual(observable(live));
    });
  }

  it('an injected undo entry is undoable after a round trip', () => {
    const live = new VimEngine(LINES);
    live.director.injectUndoEntry(['the edits you did not make']);
    const restored = roundTrip(live);

    live.feedKeys('u');
    restored.feedKeys('u');
    expect(observable(restored)).toEqual(observable(live));
  });

  it('a replay mixing player keys with injected edits reproduces byte-identically', () => {
    // M2's keystone: the director is only replayable if the snapshot carries
    // everything a later key can consume.
    const script = (e: VimEngine) => {
      e.feedKeys('dw');
      e.director.injectEdit({ start: { line: 1, col: 0 }, end: { line: 1, col: 5 }, text: 'WATCH' });
      e.feedKeys('majjyy');
      e.director.rewriteRegister('z', 'not yours', 'charwise');
      e.feedKeys('qcxq');
    };

    const live = new VimEngine(LINES);
    script(live);

    const restored = roundTrip(live);
    // Consume every kind of history the script built, in one go.
    const tail = 'u<C-r>.@cd`a"zp';
    live.feedKeys(tail);
    restored.feedKeys(tail);
    expect(observable(restored)).toEqual(observable(live));
  });

  it('a key policy survives, so a locked key stays locked across a reload', () => {
    // Not a horror concern — a gameplay-correctness bug any player who reloads
    // can reach. Key gating IS the pedagogy; it must not evaporate on load.
    const live = new VimEngine(LINES);
    live.setKeyPolicy({ allowed: new Set(['j', 'k']), denied: new Set(['k']) });
    const restored = roundTrip(live);

    for (const key of ['x', 'j', 'k']) {
      const liveEvents = live.feedKeys(key);
      const restoredEvents = restored.feedKeys(key);
      expect(restoredEvents).toEqual(liveEvents);
    }
    expect(observable(restored)).toEqual(observable(live));
    // `x` and `k` rejected, only `j` ran.
    expect(restored.cursor).toEqual({ line: 1, col: 0 });
  });

  it('is idempotent: a restored engine re-snapshots to the identical JSON', () => {
    // The canary for a `Map` or `Set` that reached JSON as `{}` — the undo
    // tree and `keyPolicy` are the two that would silently empty themselves.
    const live = new VimEngine(LINES);
    live.setKeyPolicy({ denied: new Set(['X']) });
    live.feedKeys('madwGyyfaqbxq/gamma<CR>');

    const once = JSON.stringify(live.snapshot());
    expect(JSON.stringify(roundTrip(live).snapshot())).toEqual(once);
  });

  it('a mid-insert snapshot still restores to a usable normal-mode engine', () => {
    const live = new VimEngine(LINES);
    live.feedKeys('iabc');
    const restored = roundTrip(live);

    expect(restored.mode).toBe('normal');
    expect(restored.lines[0]).toBe('abcalpha beta');
    // Not a zombie: it accepts keys.
    restored.feedKeys('x');
    expect(restored.lines[0]).toBe('abclpha beta');
  });

  it('a mid-visual snapshot restores the selection rather than a broken mode', () => {
    const live = new VimEngine(LINES);
    live.feedKeys('vjl');
    const restored = roundTrip(live);

    expect(restored.mode).toBe('visual');
    live.feedKeys('d');
    restored.feedKeys('d');
    expect(observable(restored)).toEqual(observable(live));
  });

  describe('a visual `$` keeps its end-of-line cursor across a round trip', () => {
    // `$` is the only motion that parks the cursor ON the end-of-line NUL, and
    // an inclusive selection ending there takes the LINE BREAK — which is why
    // `v$d` joins the next line up while `vlld` over the same characters leaves
    // an empty line behind. `restore()` builds the engine through the ordinary
    // constructor, whose clamp forbids that column, so without re-clamping with
    // `allowEndOfLine: true` the restored selection is silently one character
    // short: `v$d` gives `['', 'cd']` instead of `['cd']`. `vjl` cannot catch
    // this — it never reaches the NUL.
    for (const [build, consume] of [
      ['v$', 'd'],
      ['v$', 'y'],
      ['v$', 'c!<Esc>'],
      ['<C-v>j$', 'AX<Esc>'],
      ['<C-v>j$', 'd'],
    ] as const) {
      it(`\`${build}\` then \`${consume}\``, () => {
        const live = new VimEngine(['ab', 'cd', 'ef']);
        live.feedKeys(build);
        const restored = roundTrip(live);
        expect(restored.cursor).toEqual(live.cursor);

        live.feedKeys(consume);
        restored.feedKeys(consume);
        expect(observable(restored)).toEqual(observable(live));
      });
    }

    it('re-snapshots to the identical JSON from mid-visual-`$`', () => {
      const live = new VimEngine(['ab', 'cd']);
      live.feedKeys('v$');
      expect(JSON.stringify(roundTrip(live).snapshot())).toEqual(JSON.stringify(live.snapshot()));
    });

    it('normal mode still clamps off the end-of-line column', () => {
      // The other half of the rule: only visual mode may sit there. A snapshot
      // taken mid-insert with the cursor past the last character restores to
      // normal mode with it pulled back, exactly as `<Esc>` does.
      const live = new VimEngine(['ab', 'cd']);
      live.feedKeys('A');
      expect(live.cursor).toEqual({ line: 0, col: 2 });
      expect(roundTrip(live).cursor).toEqual({ line: 0, col: 1 });
    });
  });

  it('an old snapshot missing every new field still restores', () => {
    // Saves written before Wave A must keep loading.
    const live = new VimEngine(LINES);
    live.feedKeys('dw');
    const { lines, cursor, desiredCol, mode, registers, searchPattern, searchDirection, options } =
      live.snapshot();
    const old = { lines, cursor, desiredCol, mode, registers, searchPattern, searchDirection, options };

    const restored = VimEngine.restore(JSON.parse(JSON.stringify(old)) as EngineSnapshot);
    expect(observable(restored)).toEqual(observable(live));
    restored.feedKeys('x');
    expect(restored.lines[0]).toBe('eta');
  });
});

describe('CommandResolved fires once per return to rest', () => {
  function commands(keys: string): { keys: string; keystrokes: number }[] {
    const e = new VimEngine(LINES);
    const fired: ResolvedCommand[] = [];
    e.onCommandResolved((c) => fired.push(c));
    e.feedKeys(keys);
    return fired.map((c) => ({ keys: c.keys, keystrokes: c.keystrokes }));
  }

  /**
   * `[keys fed, commands expected]`. The first four rows are the ones that used
   * to fire NOTHING: a stage solved with `xxx` scored zero keystrokes, and Act
   * I's pure-`hjkl` stages produced no events for a tick to hang off at all.
   */
  const TABLE: readonly (readonly [string, readonly { keys: string; keystrokes: number }[]])[] = [
    ['x', [{ keys: 'x', keystrokes: 1 }]],
    ['j', [{ keys: 'j', keystrokes: 1 }]],
    ['dwu', [{ keys: 'dw', keystrokes: 2 }, { keys: 'u', keystrokes: 1 }]],
    ['dw.', [{ keys: 'dw', keystrokes: 2 }, { keys: '.', keystrokes: 1 }]],
    ['hjkl', [
      { keys: 'h', keystrokes: 1 },
      { keys: 'j', keystrokes: 1 },
      { keys: 'k', keystrokes: 1 },
      { keys: 'l', keystrokes: 1 },
    ]],
    // Already worked, and must keep working.
    ['dw', [{ keys: 'dw', keystrokes: 2 }]],
    ['d2w', [{ keys: 'd2w', keystrokes: 3 }]],
    ['3x', [{ keys: '3x', keystrokes: 2 }]],
    ['dd', [{ keys: 'dd', keystrokes: 2 }]],
    ['ma', [{ keys: 'ma', keystrokes: 2 }]],
    ['fa;', [{ keys: 'fa', keystrokes: 2 }, { keys: ';', keystrokes: 1 }]],
    [':d<CR>', [{ keys: ':d<CR>', keystrokes: 3 }]],
    ['/gamma<CR>', [{ keys: '/gamma<CR>', keystrokes: 7 }]],
    // An insert session is ONE command that resolves on `<Esc>`, carrying every
    // keystroke it cost. Scoring against par is meaningless otherwise.
    ['iab<Esc>', [{ keys: 'iab<Esc>', keystrokes: 4 }]],
    ['ciwnew<Esc>', [{ keys: 'ciwnew<Esc>', keystrokes: 7 }]],
    ['ohi<Esc>', [{ keys: 'ohi<Esc>', keystrokes: 4 }]],
    // A command that FAILS still cost its keys — `LINES` has no bracket, so
    // this object is not found and the operator aborts without opening insert
    // mode. Failure is not rejection: only a locked key resolves nothing.
    ['ci(', [{ keys: 'ci(', keystrokes: 3 }]],
    // Same for a visual selection: the operator is what resolves it.
    ['vjd', [{ keys: 'vjd', keystrokes: 3 }]],
    ['v<Esc>', [{ keys: 'v<Esc>', keystrokes: 2 }]],
    ['Vd', [{ keys: 'Vd', keystrokes: 2 }]],
    // Recording is not one command — `qa` arms it, then ordinary commands run.
    ['qaxq', [
      { keys: 'qa', keystrokes: 2 },
      { keys: 'x', keystrokes: 1 },
      { keys: 'q', keystrokes: 1 },
    ]],
    // An abandoned operator still cost its keys.
    ['d<Esc>', [{ keys: 'd<Esc>', keystrokes: 2 }]],
  ];

  for (const [keys, expected] of TABLE) {
    it(`\`${keys}\``, () => {
      expect(commands(keys)).toEqual(expected);
    });
  }

  it('a rejected key resolves nothing — exploring a locked key is not a move', () => {
    const e = new VimEngine(LINES);
    const fired: ResolvedCommand[] = [];
    e.onCommandResolved((c) => fired.push(c));
    e.setKeyPolicy({ denied: new Set(['x', 'w']) });

    e.feedKeys('x');
    expect(fired).toEqual([]);

    // Rejected MID-command: `reject()` discards the half-typed `d` along with
    // the locked `w`, so nothing resolves...
    e.feedKeys('dw');
    expect(fired).toEqual([]);
    expect(e.pending.operator).toBeUndefined();

    // ...and, the part worth pinning, the forfeited `d` must not leak into the
    // next command's keystroke count.
    e.feedKeys('j');
    expect(fired).toEqual([{ keys: 'j', keystrokes: 1, shape: 'j' }]);
  });

  it('every keystroke is accounted for once the engine is back at rest', () => {
    // The invariant scoring actually depends on: no key is counted twice and
    // none is dropped.
    for (const keys of ['xdwiab<Esc>vjd3xdd.', 'ci(new<Esc>u<C-r>', 'qaxq@a.']) {
      const e = new VimEngine(LINES);
      const fired: ResolvedCommand[] = [];
      e.onCommandResolved((c) => fired.push(c));
      const events = e.feedKeys(keys);

      expect(events.some((v) => v.type === 'KeyRejected')).toBe(false);
      expect(e.pending.keyBuffer).toEqual([]);
      expect(fired.reduce((n, c) => n + c.keystrokes, 0)).toBe(countKeys(keys));
      expect(fired.map((c) => c.keys).join('')).toBe(keys);
    }
  });

  it('a `:s ... c` confirm session is ONE command, closing on its last response', () => {
    // The `awaiting` half of `atRest`: a confirm session empties the pending
    // key buffer while still very much mid-command, so testing the buffer alone
    // would resolve `:%s/a/b/gc<CR>` and then score every `y`/`n` separately.
    const e = new VimEngine(['aaa', 'aaa']);
    const fired: ResolvedCommand[] = [];
    e.onCommandResolved((c) => fired.push(c));

    e.feedKeys(':%s/a/b/gc<CR>');
    expect(fired).toEqual([]);

    e.feedKeys('yynyyn');
    expect(fired.map((c) => c.keys)).toEqual([':%s/a/b/gc<CR>yynyyn']);
    expect(fired[0]?.keystrokes).toBe(17);

    e.feedKeys('x');
    expect(fired.map((c) => c.keys)).toEqual([':%s/a/b/gc<CR>yynyyn', 'x']);
  });

  it('an abandoned confirm session resolves too, rather than wedging the counter', () => {
    for (const stop of ['<Esc>', 'q']) {
      const e = new VimEngine(['aaa', 'aaa']);
      const fired: ResolvedCommand[] = [];
      e.onCommandResolved((c) => fired.push(c));

      e.feedKeys(`:%s/a/b/gc<CR>${stop}`);
      expect(fired.map((c) => c.keys)).toEqual([`:%s/a/b/gc<CR>${stop}`]);

      e.feedKeys('j');
      expect(fired.map((c) => c.keys)).toEqual([`:%s/a/b/gc<CR>${stop}`, 'j']);
    }
  });

  it('counts are abstracted out of `shape` but not out of `keys`', () => {
    const e = new VimEngine(LINES);
    const fired: ResolvedCommand[] = [];
    e.onCommandResolved((c) => fired.push(c));
    e.feedKeys('d2w');
    expect(fired[0]).toEqual({ keys: 'd2w', keystrokes: 3, shape: 'd{count}w' });
  });
});

function countKeys(notation: string): number {
  // `<Esc>`/`<C-r>` are one key each; everything else is one character.
  return notation.replace(/<[^<>]+>/g, 'K').length;
}
