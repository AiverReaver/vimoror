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
    // Mid-WALK, not just mid-list: after `<C-o>` the idx sits inside the list,
    // and a snapshot that re-parked it at the end would send `<C-i>` nowhere
    // while re-arming `<C-o>` — both directions diverging after a reload.
    ['jumplist position mid-walk', 'G<C-o>', '<C-i>'],
    ['lastFind', 'fa', ';'],
    ['last visual selection', 'vll<Esc>w', 'gvd'],
    // `o` swaps the selection's ends, so the ANCHOR sits on the end-of-line
    // NUL — the one shape the cursor-side `$` tests below cannot reach, and
    // the anchor is clamped by a separate call in `restore()`.
    ['a visual anchor on the end-of-line NUL', 'v$o', 'd'],
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

  it('an injected edit shifts `gv`, not just the marks', () => {
    // `gv` reads `lastVisual`, not the `'<`/`'>` marks `injectEdit` already
    // moved — left unshifted, the player's `gv` deletes text they never
    // selected, the exact silent desync the director API forbids.
    const live = new VimEngine(['aaa', 'bbb', 'ccc']);
    live.feedKeys('vjy'); // select aaa..b, lastVisual lines 0-1
    live.director.injectEdit({ start: { line: 0, col: 0 }, end: { line: 0, col: 0 }, text: 'XXX\n' });

    live.feedKeys('gvd');
    expect(live.lines).toEqual(['XXX', 'bb', 'ccc']);
  });

  it('an injected edit keeps a live visual-`$` cursor on the end-of-line NUL', () => {
    // The same clamp rule `restore()` follows: an injection touching ANOTHER
    // line must not pull the selection one character short.
    const live = new VimEngine(['ab', 'cd']);
    live.feedKeys('v$');
    live.director.injectEdit({ start: { line: 1, col: 0 }, end: { line: 1, col: 1 }, text: 'X' });
    expect(live.cursor).toEqual({ line: 0, col: 2 });

    live.feedKeys('d'); // still takes the line break, so it still joins
    expect(live.lines).toEqual(['Xd']);
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

  it('a mid-replace snapshot restores to a usable normal-mode engine too', () => {
    // The insert guard's twin: `R` is the OTHER mode whose session is not
    // carried, and restoring `mode: 'replace'` without one gives an engine
    // whose every key — `<Esc>` included — bounces off `not-in-mode`.
    const live = new VimEngine(LINES);
    live.feedKeys('Rab');
    const restored = roundTrip(live);

    expect(restored.mode).toBe('normal');
    expect(restored.lines[0]).toBe('abpha beta');
    restored.feedKeys('x');
    expect(restored.lines[0]).toBe('abha beta');
  });

  it('a mid-insert snapshot keeps the typed text reachable by undo and redo', () => {
    // Inside an insert session the buffer mutates ahead of the block's
    // `pushUndo`, so the saved lines belong to NO undo node. Without minting
    // one at restore, `u` steps to the wrong buffer — or reports
    // nothing-to-undo with unsaved text on screen — and the saved lines are
    // permanently unreachable by `<C-r>`.
    const live = new VimEngine(['ab']);
    live.feedKeys('x'); // ['b'], one real node
    live.feedKeys('iZ'); // ['Zb'], session still open
    const restored = roundTrip(live);

    expect(restored.lines).toEqual(['Zb']);
    restored.feedKeys('u');
    expect(restored.lines).toEqual(['b']);
    restored.feedKeys('u');
    expect(restored.lines).toEqual(['ab']);
    restored.feedKeys('<C-r><C-r>');
    expect(restored.lines).toEqual(['Zb']);
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

  it('an insert session survives a mid-session rejection with its keys intact', () => {
    // The other side of the forfeit rule: only the half-typed PENDING is
    // forfeited, and mid-insert the pending is empty. An unconditional clear
    // here would score `iabq<Esc>` as a one-keystroke `<Esc>`.
    const e = new VimEngine(LINES);
    e.setKeyPolicy({ denied: new Set(['q']) });
    const fired: ResolvedCommand[] = [];
    e.onCommandResolved((c) => fired.push(c));

    e.feedKeys('iabq<Esc>');
    expect(fired).toEqual([{ keys: 'iab<Esc>', keystrokes: 4, shape: 'iab<Esc>' }]);
  });

  it('a rejection mid-visual forfeits the half-typed command, not the selection', () => {
    // `v`, `f` (awaiting its target char), locked `x`, `d`: the `f` is
    // discarded by `reject()` and its key must go with it — but the `v` is
    // part of the still-open selection and must stay. Clearing everything
    // scores `d` alone; clearing nothing resolves a `vfd` that never ran.
    const e = new VimEngine(LINES);
    e.setKeyPolicy({ denied: new Set(['x']) });
    const fired: ResolvedCommand[] = [];
    e.onCommandResolved((c) => fired.push(c));

    e.feedKeys('vfxd');
    expect(fired).toEqual([{ keys: 'vd', keystrokes: 2, shape: 'vd' }]);
  });

  it('a replay halted by a locked INNER key still resolves — the buffer already changed', () => {
    // `@a` where the macro body hits a locked key is a FAILED command, not a
    // rejected one: the keys the PLAYER pressed were all allowed, and the
    // replay may already have edited the buffer. Swallowing the resolution
    // here would hand out a free edit — no keystroke cost, no tick.
    const e = new VimEngine(LINES);
    e.feedKeys('qaxwq');
    e.setKeyPolicy({ denied: new Set(['w']) });
    const fired: ResolvedCommand[] = [];
    e.onCommandResolved((c) => fired.push(c));

    const before = e.lines[0];
    e.feedKeys('@a');
    expect(e.lines[0]).not.toBe(before); // the macro's `x` ran
    expect(fired).toEqual([{ keys: '@a', keystrokes: 2, shape: '@a' }]);
  });

  it('a dot repeat halted by a locked key resolves as the one `.` keystroke', () => {
    const e = new VimEngine(LINES);
    e.feedKeys('x');
    e.setKeyPolicy({ denied: new Set(['x']) });
    const fired: ResolvedCommand[] = [];
    e.onCommandResolved((c) => fired.push(c));

    e.feedKeys('.');
    expect(fired).toEqual([{ keys: '.', keystrokes: 1, shape: '.' }]);
  });

  it('a self-referencing macro halts with recursive-macro instead of crashing', () => {
    // `qa@aq` then `@a` used to nest one synchronous step() per iteration and
    // throw an uncaught RangeError out of feed(). It must halt like any other
    // macro error — and still resolve, since the player's keys were allowed.
    const e = new VimEngine(LINES);
    e.feedKeys('qa@aq');
    const fired: ResolvedCommand[] = [];
    e.onCommandResolved((c) => fired.push(c));

    const events = e.feedKeys('@a');
    expect(events.some((v) => v.type === 'InvalidCommand' && v.reason === 'recursive-macro')).toBe(true);
    expect(fired).toEqual([{ keys: '@a', keystrokes: 2, shape: '@a' }]);
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
