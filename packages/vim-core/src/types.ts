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
   * True for `%` (and later `( ) / ? n N { }`): a delete over this motion
   * always shifts into `"1`, even when it removes less than a line.
   */
  readonly forcesNumbered?: boolean;
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
  | 'empty-register';

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
  | { readonly type: 'InvalidCommand'; readonly keys: string; readonly reason: InvalidReason };

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
