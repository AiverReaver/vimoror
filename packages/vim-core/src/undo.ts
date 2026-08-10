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
  /** Where the cursor goes when you land on this state. */
  readonly cursor: Pos;
  /** Children in creation order; the last is the one redo follows. */
  readonly children: readonly number[];
};

export type UndoState = {
  readonly nodes: ReadonlyMap<number, UndoNode>;
  readonly current: number;
  readonly nextId: number;
};

export function initUndo(lines: Lines, cursor: Pos): UndoState {
  const root: UndoNode = { id: 0, parent: null, lines, cursor, children: [] };
  return { nodes: new Map([[0, root]]), current: 0, nextId: 1 };
}

/** Record a new state as a child of the current one. */
export function pushUndo(state: UndoState, lines: Lines, cursor: Pos): UndoState {
  const nodes = new Map(state.nodes);
  const parent = nodes.get(state.current);
  if (parent === undefined) return state;

  const id = state.nextId;
  nodes.set(id, { id, parent: state.current, lines, cursor, children: [] });
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
  // Vim puts the cursor on the first line changed by the undone edit; using
  // the snapshot's own cursor is close enough until goldens say otherwise.
  return { undo: { ...state, current: parent.id }, lines: parent.lines, cursor: node.cursor };
}

export function redo(state: UndoState): UndoStep | null {
  const node = state.nodes.get(state.current);
  if (node === undefined || node.children.length === 0) return null;
  const childId = node.children[node.children.length - 1]!;
  const child = state.nodes.get(childId);
  if (child === undefined) return null;
  return { undo: { ...state, current: child.id }, lines: child.lines, cursor: child.cursor };
}

export function canUndo(state: UndoState): boolean {
  const node = state.nodes.get(state.current);
  return node !== undefined && node.parent !== null;
}

export function canRedo(state: UndoState): boolean {
  const node = state.nodes.get(state.current);
  return node !== undefined && node.children.length > 0;
}
