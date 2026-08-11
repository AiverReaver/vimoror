/**
 * Snapshot undo tree.
 *
 * A tree rather than a stack because Act III makes it a story mechanic: `g-`
 * and `g+` walk real branches, and Vim genuinely destroys the redo branch the
 * moment you edit after undoing — "dwelling forecloses return" is not a
 * metaphor we invented, it is the data structure.
 *
 * Snapshots are whole-buffer. That is fine at our scale (a stage is a few
 * kilobytes) and it makes `u` exactly restore a prior state, which is what the
 * property test asserts.
 */

import type { Lines } from './buffer.ts';
import type { Pos } from './types.ts';

export type UndoNode = {
  readonly id: number;
  readonly parent: number | null;
  readonly lines: Lines;
  /** The cursor after the change that created this state. */
  readonly cursor: Pos;
  /**
   * Where the change that created this state BEGAN — Vim's `uh_cursor`. Both
   * `u` and `<C-r>` put the cursor here: undoing a change returns you to where
   * it started, and redoing it does too.
   */
  readonly changeStart: Pos;
  /** Children in creation order; the last is the one redo follows. */
  readonly children: readonly number[];
};

export type UndoState = {
  readonly nodes: ReadonlyMap<number, UndoNode>;
  readonly current: number;
  readonly nextId: number;
};

export function initUndo(lines: Lines, cursor: Pos): UndoState {
  const root: UndoNode = { id: 0, parent: null, lines, cursor, changeStart: cursor, children: [] };
  return { nodes: new Map([[0, root]]), current: 0, nextId: 1 };
}

/** Record a new state as a child of the current one. */
export function pushUndo(state: UndoState, lines: Lines, cursor: Pos, changeStart: Pos): UndoState {
  const nodes = new Map(state.nodes);
  const parent = nodes.get(state.current);
  if (parent === undefined) return state;

  const id = state.nextId;
  nodes.set(id, { id, parent: state.current, lines, cursor, changeStart, children: [] });
  nodes.set(state.current, { ...parent, children: [...parent.children, id] });
  return { nodes, current: id, nextId: id + 1 };
}

export type UndoStep = {
  readonly undo: UndoState;
  readonly lines: Lines;
  readonly cursor: Pos;
};

export function undo(state: UndoState): UndoStep | null {
  const node = state.nodes.get(state.current);
  if (node === undefined || node.parent === null) return null;
  const parent = state.nodes.get(node.parent);
  if (parent === undefined) return null;
  // The cursor returns to where the undone change began (Vim's uh_cursor).
  return { undo: { ...state, current: parent.id }, lines: parent.lines, cursor: node.changeStart };
}

export function redo(state: UndoState): UndoStep | null {
  const node = state.nodes.get(state.current);
  if (node === undefined || node.children.length === 0) return null;
  const childId = node.children[node.children.length - 1]!;
  const child = state.nodes.get(childId);
  if (child === undefined) return null;
  // Redo also lands where the re-applied change began, not where it ended.
  return { undo: { ...state, current: child.id }, lines: child.lines, cursor: child.changeStart };
}

export function canUndo(state: UndoState): boolean {
  const node = state.nodes.get(state.current);
  return node !== undefined && node.parent !== null;
}

export function canRedo(state: UndoState): boolean {
  const node = state.nodes.get(state.current);
  return node !== undefined && node.children.length > 0;
}
