/**
 * Core types.
 *
 * Positions are 0-based line and 0-based CHARACTER column throughout the
 * engine. Vim reports 1-based BYTE columns; that conversion happens only in
 * the golden comparator, never in here.
 */

export type Mode =
  | 'normal'
  | 'insert'
  | 'replace'
  | 'visual'
  | 'visual-line'
  | 'visual-block'
  | 'operator-pending'
  | 'command-line';

export type Pos = {
  readonly line: number;
  readonly col: number;
};

/** A canonical key token: a single character, or a named key like `<Esc>`. */
export type KeyToken = string;

export type MotionKind = 'charwise' | 'linewise';

export type MotionResult = {
  readonly target: Pos;
  readonly kind: MotionKind;
  /** Whether the character under `target` is included by an operator. */
  readonly inclusive: boolean;
  /** Motions like `j`/`k` preserve the remembered column across short lines. */
  readonly keepDesiredCol?: boolean;
  /**
   * True for `% ( ) { }` and `` ` `` (and later `/ ? n N`): a delete over this
   * motion always shifts into `"1`, even when it removes less than a line —
   * and it sets `"-` as well, rather than instead.
   */
  readonly forcesNumbered?: boolean;
  /**
   * True for a JUMP: the position before the motion is pushed onto the
   * jumplist and becomes the previous-context mark. Vim's `setpcmark()`. Note
   * `w`, `j` and `$` are NOT jumps — only the motions that can carry you
   * somewhere you would want `<C-o>` to undo.
   */
  readonly isJump?: boolean;
};

export type RegisterType = 'charwise' | 'linewise' | 'blockwise';

export type RegisterValue = {
  readonly text: string;
  readonly type: RegisterType;
};

export type Registers = Readonly<Record<string, RegisterValue>>;

/** Why a command was rejected. Load-bearing: it drives hints and in-fiction rejection. */
export type InvalidReason =
  | 'unknown-key'
  | 'no-such-motion'
  | 'motion-failed'
  | 'not-in-mode'
  | 'key-locked'
  | 'nothing-to-undo'
  | 'nothing-to-redo'
  | 'empty-register'
  /** `` `z `` with nothing recorded at `z`, or a mark whose line was deleted. */
  | 'mark-not-set'
  /** `<C-o>`/`<C-i>` with nowhere left to go in the jumplist. */
  | 'no-jump'
  /** `.` with no change recorded yet. */
  | 'nothing-to-repeat'
  /** A range that fails to parse, is backwards past repair, or falls outside the buffer. */
  | 'invalid-range'
  /** An ex command name that matches nothing implemented. */
  | 'unknown-command';

export type ResolvedCommand = {
  /** The literal keys as typed, e.g. "d2w". */
  readonly keys: string;
  readonly keystrokes: number;
  /** The command's shape with counts abstracted, e.g. "d{count}w". */
  readonly shape: string;
};

export type EngineEvent =
  | { readonly type: 'ModeChanged'; readonly from: Mode; readonly to: Mode }
  | { readonly type: 'BufferChanged'; readonly firstLine: number; readonly lastLine: number }
  | { readonly type: 'CursorMoved'; readonly to: Pos }
  | { readonly type: 'CommandResolved'; readonly command: ResolvedCommand }
  | { readonly type: 'RegisterChanged'; readonly name: string }
  | { readonly type: 'KeyRejected'; readonly key: KeyToken; readonly reason: InvalidReason }
  | { readonly type: 'InvalidCommand'; readonly keys: string; readonly reason: InvalidReason }
  /** `:w` — core stays zero-I/O, so the host does the actual writing. */
  | { readonly type: 'BufferSaved'; readonly force: boolean }
  /** `:q` — the host decides what "quit" means (close a stage, exit the app, ...). */
  | { readonly type: 'QuitRequested'; readonly force: boolean };

/** Locked keys are rejected in fiction, never silently no-op'd. */
export type KeyPolicy = {
  /** When set, only these keys are permitted. */
  readonly allowed?: ReadonlySet<KeyToken>;
  /** Always rejected, even if listed in `allowed`. */
  readonly denied?: ReadonlySet<KeyToken>;
};

export type Edit = {
  readonly start: Pos;
  /** Exclusive end of the replaced span. */
  readonly end: Pos;
  readonly text: string;
};
