/**
 * `VimEngine` — a thin stateful facade over the pure reducer.
 *
 * The reducer is ground truth (replay, ghosts, determinism); this class exists
 * because the game layer wants a stateful object with a director API. Every
 * director mutation is itself a pure state transition, which is what keeps
 * injected horror replayable and testable: a replay containing injected edits
 * must reproduce byte-identically from its snapshot.
 *
 * Five capabilities exist here from M0 because retrofitting any of them means
 * rewriting the core.
 */

import { applyEdit, clamp, type Lines } from './buffer.ts';
import { render, tokenize } from './keys.ts';
import { adjustJumps, adjustMarks, adjustPos, lineShift, type JumpList, type Marks } from './marks.ts';
import { DEFAULT_OPTIONS, type EditorOptions } from './operators.ts';
import { pushUndo, type UndoNode, type UndoState } from './undo.ts';
import { EMPTY_PENDING, initState, isVisual, step, type EditorState, type Pending } from './state.ts';
import type { DotRecord } from './dot.ts';
import type { MacroStore } from './macros.ts';
import type { Edit, EngineEvent, KeyPolicy, KeyToken, Mode, Pos, RegisterType, ResolvedCommand } from './types.ts';

/**
 * The undo tree, flattened for JSON. `UndoState.nodes` is a `Map`, which
 * `JSON.stringify` renders as `{}` — silently emptying the tree rather than
 * failing, which is exactly why `engine.test.ts` re-snapshots a restored engine
 * and compares the JSON.
 */
export type UndoSnapshot = {
  /** In creation order, so `children` indices stay meaningful on rebuild. */
  readonly nodes: readonly UndoNode[];
  readonly current: number;
  readonly nextId: number;
};

/** `KeyPolicy`'s `Set`s, likewise flattened — a `Set` also JSONs to `{}`. */
export type KeyPolicySnapshot = {
  readonly allowed: readonly KeyToken[] | undefined;
  readonly denied: readonly KeyToken[] | undefined;
};

/**
 * Everything a save, a replay or a ghost run has to reproduce.
 *
 * Every field below `options` was added at M2 Wave A. Before that a restored
 * engine dropped them on the floor, which made `u`, `<C-r>`, `.`, marks, `@a`,
 * `<C-o>`, `;`, `gv` and — worst, because it is a gameplay bug rather than a
 * horror one — the stage's own key policy all diverge from the live engine they
 * were snapshotted from. They are typed `T | undefined` rather than optional so
 * that a pre-Wave-A JSON save still restores: it just restores without history.
 *
 * The insert session is still deliberately NOT carried: a snapshot taken
 * mid-insert restores to normal mode, like a real Vim session after a reload.
 * An open `q` recording is dropped for the same reason.
 */
export type EngineSnapshot = {
  readonly lines: readonly string[];
  readonly cursor: Pos;
  readonly desiredCol: number;
  readonly mode: Mode;
  readonly registers: Readonly<Record<string, { text: string; type: RegisterType }>>;
  readonly searchPattern: string;
  readonly searchDirection: 'forward' | 'backward' | undefined;
  readonly options: EditorOptions;
  readonly undo: UndoSnapshot | undefined;
  readonly dot: DotRecord | undefined;
  readonly marks: Marks | undefined;
  readonly jumps: JumpList | undefined;
  /** Vim's `w_pcmark` — where `` `` `` and `''` return to. */
  readonly pcmark: Pos | undefined;
  readonly lastFind: { readonly cmd: 'f' | 'F' | 't' | 'T'; readonly ch: string } | undefined;
  readonly macros: MacroStore | undefined;
  readonly lastMacroReg: string | undefined;
  readonly keyPolicy: KeyPolicySnapshot | undefined;
  /** The live selection, so a mid-visual save is not a broken mode. */
  readonly visualStart: Pos | undefined;
  /** What `gv` reselects. */
  readonly lastVisual: { readonly mode: Mode; readonly start: Pos; readonly end: Pos } | undefined;
  /**
   * Keys spent on the command currently in flight — recorded ONLY for a
   * mid-visual save, the one in-flight command a restore actually resumes. See
   * `#pendingKeys`; recording it in any other state would carry a value
   * `restore()` then discards, which is a round-trip that is not idempotent.
   */
  readonly pendingKeys: readonly KeyToken[] | undefined;
};

export type PendingView = {
  readonly mode: Mode;
  readonly count?: number;
  readonly register?: string;
  readonly operator?: string;
  readonly keyBuffer: readonly KeyToken[];
};

export class VimEngine {
  #state: EditorState;
  #commandListeners: ((c: ResolvedCommand) => void)[] = [];
  /**
   * Keys fed since the last resolved command — an insert session's whole body
   * included, since that session IS the command.
   *
   * Snapshotted, but restored ONLY when the in-flight command survives the
   * restore, which is exactly the visual case: `restore()` deliberately keeps
   * visual mode and its anchor, so a mid-visual save comes back mid-command and
   * has to come back mid-COUNT too. Found by M2 Wave E's session-level replay
   * test — this field used to be dropped outright on the premise that "a
   * restore lands at rest", which Wave A's own visual-mode preservation had
   * already made false: a restored `v$` then `d` resolved a ONE-keystroke `d`
   * where the live engine resolved a three-keystroke `v$d`, so the buffer
   * reproduced byte-identically and the SCORE did not.
   *
   * Every other mid-command state (insert, replace, an `awaiting` accumulator,
   * a half-typed operator) restores to rest with its half-command discarded, so
   * its keys are forfeited with it — the same rule `feed()` applies to the keys
   * of a command aborted by a rejected key.
   *
   * That rule is reused rather than restated for the ONE overlap: `restore()`
   * rebuilds `pending` empty even in visual mode, so a selection carrying a
   * half-typed motion or count (`vf` waiting on a character, `v2`) loses that
   * half. Exactly `pending.keyBuffer` is dropped from what gets recorded —
   * count digits and register prefix included, which is what that buffer holds
   * — leaving the keys spent OUTSIDE the pending, which is precisely what the
   * rejection path forfeits too. So `vf` records `v`, and nothing anywhere
   * counts a key whose command did not survive.
   */
  #pendingKeys: readonly KeyToken[] = [];

  constructor(lines: Lines, cursor: Pos = { line: 0, col: 0 }, options: EditorOptions = DEFAULT_OPTIONS) {
    this.#state = initState(lines, cursor, options);
  }

  get state(): EditorState {
    return this.#state;
  }

  get lines(): readonly string[] {
    return this.#state.lines;
  }

  get cursor(): Pos {
    return this.#state.cursor;
  }

  get mode(): Mode {
    return this.#state.mode;
  }

  /**
   * Live mid-command state — this is what drives the "you typed: d2w" ghost
   * HUD. Operator-pending must be a *visible* game state; its invisibility is
   * real Vim's single biggest UX problem, and showing it is the pedagogy.
   */
  get pending(): PendingView {
    const p: Pending = this.#state.pending;
    const count = p.count === '' ? undefined : Number.parseInt(p.count, 10);
    return {
      mode: this.#state.mode,
      ...(count === undefined ? {} : { count }),
      ...(p.register === undefined ? {} : { register: p.register }),
      ...(p.operator === undefined ? {} : { operator: p.operator }),
      keyBuffer: p.keyBuffer,
    };
  }

  feed(key: KeyToken): EngineEvent[] {
    const before = this.#state;
    const { state, events } = step(before, key);
    this.#state = state;

    // A REJECTED key is not part of any command: it neither counts against the
    // player's score nor advances the world. Locking a key must never punish
    // the player for pressing it.
    //
    // Only the FED key's own rejection counts. A replay (`@a`, `.`, `:normal`)
    // surfaces its INNER keys' rejections through this same event stream, and
    // a halted replay is a FAILED command — it may already have edited the
    // buffer — so it must still resolve and tick rather than vanish as a free
    // edit. (`e.key === key` misfires only when a replayed macro's body
    // contains the very key that triggered it — unreachable under a fixed
    // stage policy, since recording would have rejected that key too.)
    if (events.some((e) => e.type === 'KeyRejected' && e.key === key)) {
      // `reject()` threw away whatever half-typed command was pending, so the
      // keys already spent building it — exactly `pending.keyBuffer`, which
      // holds every key of the half-typed command, count digits and register
      // prefix included — are forfeited with it. Dropped rather than
      // resolved, so no tick can ever be blamed on a locked key: without this
      // `d`, locked-`w`, `j` would resolve as a three-keystroke `dj`. An
      // insert session or visual selection keeps everything OUTSIDE the
      // pending: its keys keep counting.
      const forfeited = before.pending.keyBuffer.length;
      this.#pendingKeys = this.#pendingKeys.slice(0, this.#pendingKeys.length - forfeited);
      return [...events];
    }

    this.#pendingKeys = [...this.#pendingKeys, key];

    // A command "resolves" when the engine returns to REST. The old rule — the
    // pending buffer emptied having held something — scored ZERO for every
    // one-key command (`x`, `j`, `u`, `.`), which meant a stage solved with
    // `xxx` cost nothing and Act I's pure-`hjkl` stages emitted no events at
    // all for a turn-based threat to tick off.
    if (!atRest(state)) return [...events];

    const keys = render(this.#pendingKeys);
    const command: ResolvedCommand = {
      keys,
      keystrokes: this.#pendingKeys.length,
      shape: shapeOf(keys),
    };
    this.#pendingKeys = [];
    for (const cb of this.#commandListeners) cb(command);
    return [...events, { type: 'CommandResolved', command }];
  }

  /** Feed authoring notation, e.g. `feedKeys('d2w')`. */
  feedKeys(notation: string): EngineEvent[] {
    return tokenize(notation).flatMap((k) => this.feed(k));
  }

  /**
   * Key gating — the pedagogy. Rejected keys emit `KeyRejected` with a reason,
   * never a silent no-op; the game layer renders that reason in character.
   */
  setKeyPolicy(policy: KeyPolicy | undefined): void {
    this.#state = { ...this.#state, keyPolicy: policy };
  }

  /** Instrumentation for VimGolf scoring. */
  onCommandResolved(cb: (c: ResolvedCommand) => void): () => void {
    this.#commandListeners.push(cb);
    return () => {
      this.#commandListeners = this.#commandListeners.filter((x) => x !== cb);
    };
  }

  /**
   * The horror. Synthetic mutations and synthetic undo entries indistinguishable
   * from the player's own, namespaced so they can never be reached by accident.
   * Nothing in the horror layer is allowed to touch core by another path.
   */
  readonly director = {
    injectEdit: (edit: Edit): void => {
      const s = this.#state;
      const lines = applyEdit(s.lines, edit);
      // Visual mode may legitimately hold the end-of-line NUL (`v$`) — the
      // same clamp `restore()` applies, or an injected edit on ANOTHER line
      // silently pulls a live `v$` selection one character short.
      const cursor = clamp(lines, s.cursor, isVisual(s.mode));
      // An injected edit shifts marks exactly as a typed one does — otherwise
      // the horror layer could silently desynchronise the player's own marks
      // from the buffer, and replay would stop being reproducible. `gv` reads
      // `lastVisual`, not the `'<`/`'>` marks this call just moved, and a live
      // visual anchor shifts with its text too — both took the same silent
      // desync without their own adjustment.
      const shift = lineShift(s.lines, lines);
      this.#state = {
        ...s,
        ...(shift === null
          ? {}
          : {
              marks: adjustMarks(s.marks, shift),
              jumps: adjustJumps(s.jumps, shift),
              pcmark: s.pcmark === undefined ? undefined : adjustPos(s.pcmark, shift),
              lastVisual:
                s.lastVisual === undefined
                  ? undefined
                  : {
                      ...s.lastVisual,
                      start: adjustPos(s.lastVisual.start, shift),
                      end: adjustPos(s.lastVisual.end, shift),
                    },
              visualStart: s.visualStart === undefined ? undefined : adjustPos(s.visualStart, shift),
            }),
        lines,
        cursor,
        undoState: pushUndo(s.undoState, lines, cursor, edit.start),
        pending: EMPTY_PENDING,
      };
    },

    /** An undo entry the player never made — Act IV's "edits you didn't make". */
    injectUndoEntry: (lines: readonly string[], cursor?: Pos): void => {
      const at = clamp(lines, cursor ?? this.#state.cursor, false);
      this.#state = { ...this.#state, undoState: pushUndo(this.#state.undoState, lines, at, at) };
    },

    rewriteRegister: (name: string, value: string, type: RegisterType = 'charwise'): void => {
      this.#state = {
        ...this.#state,
        registers: { ...this.#state.registers, [name]: { text: value, type } },
      };
    },
  };

  /** Saves, replays, ghost runs and test fixtures all share this one path. */
  snapshot(): EngineSnapshot {
    const s = this.#state;
    const policy = s.keyPolicy;
    // A snapshot taken MID-UNDO-BLOCK (an open insert session, a `:s ... c`
    // confirm session with accepted matches) carries lines that no undo node
    // holds yet — the block's own `pushUndo` runs at the END of the block.
    // Serialize the tree WITH the missing node (exactly what `finishInsert`
    // would mint), or a restored `u` steps to the WRONG buffer — or reports
    // nothing-to-undo with unsaved text on screen — and the saved lines are
    // permanently unreachable by redo. Deliberately keyed on being mid-block,
    // NOT on the lines/node mismatch alone: `injectUndoEntry` creates exactly
    // that mismatch at rest, on purpose, and it must round-trip as-is.
    const midBlock = s.insert !== undefined || s.pending.awaiting === 'confirm-subst';
    const current = s.undoState.nodes.get(s.undoState.current);
    const at = clamp(s.lines, s.cursor, false);
    const undoState =
      midBlock && current !== undefined && !sameLines(current.lines, s.lines)
        ? pushUndo(s.undoState, s.lines, at, at)
        : s.undoState;
    return {
      lines: [...s.lines],
      cursor: s.cursor,
      desiredCol: s.desiredCol,
      mode: s.mode,
      registers: { ...s.registers },
      searchPattern: s.searchPattern,
      searchDirection: s.searchDirection,
      options: s.options,
      // ponytail: the undo tree stores whole buffers per node (snapshot undo,
      // see undo.ts), so a long session's save grows with edits × buffer size.
      // Fine for stage-sized buffers; cap or diff the nodes if a save ever gets
      // big enough to notice.
      undo: { nodes: [...undoState.nodes.values()], current: undoState.current, nextId: undoState.nextId },
      dot: s.dot,
      marks: { ...s.marks },
      jumps: { list: [...s.jumps.list], idx: s.jumps.idx },
      pcmark: s.pcmark,
      lastFind: s.lastFind,
      macros: { ...s.macros },
      lastMacroReg: s.lastMacroReg,
      keyPolicy:
        policy === undefined
          ? undefined
          : {
              allowed: policy.allowed === undefined ? undefined : [...policy.allowed],
              denied: policy.denied === undefined ? undefined : [...policy.denied],
            },
      visualStart: s.visualStart,
      lastVisual: s.lastVisual,
      // Recorded only where `restore()` resumes the command these keys belong
      // to. Anywhere else the half-command is discarded on restore and its keys
      // go with it, so recording them would make a mid-command save
      // re-snapshot differently after a round trip — caught by `session.test`'s
      // locked-key property, which reads the whole snapshot as its canary.
      // Minus `pending.keyBuffer`, since `restore()` rebuilds the pending empty
      // even in visual mode: a half-typed motion or count inside the selection
      // does not survive either, so its keys go the way a rejected key's do.
      pendingKeys: isVisual(s.mode)
        ? this.#pendingKeys.slice(0, this.#pendingKeys.length - s.pending.keyBuffer.length)
        : undefined,
    };
  }

  static restore(s: EngineSnapshot): VimEngine {
    const engine = new VimEngine(s.lines, s.cursor, s.options ?? DEFAULT_OPTIONS);
    // A snapshot taken mid-insert restores to NORMAL mode, like a real Vim
    // session after a reload. Restoring `mode: 'insert'` without its session
    // would leave an engine that rejects every key, <Esc> included. A visual
    // mode whose anchor did not survive is the same trap, so it gets the same
    // treatment rather than restoring a selection with no fixed end.
    const anchor = isVisual(s.mode) ? s.visualStart : undefined;
    const insertish = s.mode === 'insert' || s.mode === 'replace';
    const mode: Mode = insertish || (isVisual(s.mode) && anchor === undefined) ? 'normal' : s.mode;
    engine.#state = {
      ...engine.#state,
      desiredCol: s.desiredCol,
      mode,
      // `new VimEngine(...)` above already clamped the cursor with
      // `allowEndOfLine: false`. That is right for normal mode and WRONG for
      // visual, where `$` legitimately parks the cursor ON the end-of-line NUL
      // — and an inclusive selection ending past the line then takes the LINE
      // BREAK, which is why `v$d` joins the next line up while `vlld` over the
      // same characters leaves an empty line behind. Clamped, a restored `v$`
      // selection is silently one character short and `v$d` stops joining.
      // `gv`'s own restore path clamps a stored selection's BOTH ends with
      // `allowEndOfLine: true`; restoring a saved selection is the same job.
      ...(isVisual(mode) ? { cursor: clamp(s.lines, s.cursor, true) } : {}),
      registers: { ...s.registers },
      searchPattern: s.searchPattern,
      searchDirection: s.searchDirection,
      ...(s.undo === undefined ? {} : { undoState: rebuildUndo(s.undo, engine.#state.undoState) }),
      dot: s.dot,
      ...(s.marks === undefined ? {} : { marks: { ...s.marks } }),
      ...(s.jumps === undefined ? {} : { jumps: { list: [...s.jumps.list], idx: s.jumps.idx } }),
      pcmark: s.pcmark,
      lastFind: s.lastFind,
      ...(s.macros === undefined ? {} : { macros: { ...s.macros } }),
      lastMacroReg: s.lastMacroReg,
      keyPolicy: rebuildKeyPolicy(s.keyPolicy),
      visualStart: anchor === undefined || !isVisual(mode) ? undefined : clamp(s.lines, anchor, true),
      lastVisual: s.lastVisual,
    };
    // Only the visual case restores mid-command (see `#pendingKeys`); every
    // other in-flight command was just discarded above, and its keys go with it.
    if (isVisual(mode) && s.pendingKeys !== undefined) engine.#pendingKeys = [...s.pendingKeys];
    return engine;
  }
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

/**
 * At rest = no half-typed command anywhere. The pending buffer covers `d` and
 * `f`; `awaiting` covers the accumulators that empty it while still waiting
 * (`:`, `/`, a `:s ... c` confirm session); and the insert session and visual
 * anchor cover the two states where a command spans arbitrarily many keys.
 *
 * An open `q` recording is deliberately NOT a barrier — it spans whole
 * commands, so `qaxq` really is three of them.
 */
function atRest(s: EditorState): boolean {
  return (
    s.pending.keyBuffer.length === 0 &&
    s.pending.awaiting === undefined &&
    s.insert === undefined &&
    s.visualStart === undefined
  );
}

function rebuildUndo(snap: UndoSnapshot, fallback: UndoState): UndoState {
  if (snap.nodes.length === 0) return fallback;
  const nodes = new Map<number, UndoNode>();
  for (const n of snap.nodes) nodes.set(n.id, n);
  // A `current` naming a node the save does not contain would leave every `u`
  // a silent no-op; fall back to the fresh root rather than to a broken tree.
  return nodes.has(snap.current) ? { nodes, current: snap.current, nextId: snap.nextId } : fallback;
}

function rebuildKeyPolicy(snap: KeyPolicySnapshot | undefined): KeyPolicy | undefined {
  if (snap === undefined) return undefined;
  return {
    ...(snap.allowed === undefined ? {} : { allowed: new Set(snap.allowed) }),
    ...(snap.denied === undefined ? {} : { denied: new Set(snap.denied) }),
  };
}

/** `d2w` → `d{count}w`, so scoring compares command shapes not literal keys. */
function shapeOf(keys: string): string {
  return keys.replace(/[1-9][0-9]*/g, '{count}');
}
