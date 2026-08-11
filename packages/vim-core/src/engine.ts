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
import { DEFAULT_OPTIONS, type EditorOptions } from './operators.ts';
import { pushUndo } from './undo.ts';
import { EMPTY_PENDING, initState, step, type EditorState, type Pending } from './state.ts';
import type { Edit, EngineEvent, KeyPolicy, KeyToken, Mode, Pos, RegisterType, ResolvedCommand } from './types.ts';

export type EngineSnapshot = {
  readonly lines: readonly string[];
  readonly cursor: Pos;
  readonly desiredCol: number;
  readonly mode: Mode;
  readonly registers: Readonly<Record<string, { text: string; type: RegisterType }>>;
  readonly searchPattern: string;
  readonly options: EditorOptions;
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

    // A command "resolves" when the pending buffer empties having held
    // something — that is the unit keystroke scoring counts.
    if (before.pending.keyBuffer.length > 0 && state.pending.keyBuffer.length === 0) {
      const keys = render([...before.pending.keyBuffer, key]);
      const command: ResolvedCommand = {
        keys,
        keystrokes: before.pending.keyBuffer.length + 1,
        shape: shapeOf(keys),
      };
      for (const cb of this.#commandListeners) cb(command);
      return [...events, { type: 'CommandResolved', command }];
    }

    return [...events];
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
      const lines = applyEdit(this.#state.lines, edit);
      const cursor = clamp(lines, this.#state.cursor, false);
      this.#state = {
        ...this.#state,
        lines,
        cursor,
        undoState: pushUndo(this.#state.undoState, lines, cursor, edit.start),
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
    return {
      lines: [...this.#state.lines],
      cursor: this.#state.cursor,
      desiredCol: this.#state.desiredCol,
      mode: this.#state.mode,
      registers: { ...this.#state.registers },
      searchPattern: this.#state.searchPattern,
      options: this.#state.options,
    };
  }

  static restore(s: EngineSnapshot): VimEngine {
    const engine = new VimEngine(s.lines, s.cursor, s.options ?? DEFAULT_OPTIONS);
    // A snapshot taken mid-insert restores to NORMAL mode, like a real Vim
    // session after a reload. Restoring `mode: 'insert'` without its session
    // would leave an engine that rejects every key, <Esc> included.
    // The undo tree is not serialized yet — a restored engine starts with the
    // snapshot as its undo root.
    const mode: Mode = s.mode === 'insert' || s.mode === 'replace' ? 'normal' : s.mode;
    engine.#state = {
      ...engine.#state,
      desiredCol: s.desiredCol,
      mode,
      registers: { ...s.registers },
      searchPattern: s.searchPattern,
    };
    return engine;
  }
}

/** `d2w` → `d{count}w`, so scoring compares command shapes not literal keys. */
function shapeOf(keys: string): string {
  return keys.replace(/[1-9][0-9]*/g, '{count}');
}
