/**
 * The codec, and the two properties that are not obvious from reading it.
 *
 * **A real snapshot round-trips.** `snapshotSchema` is shallow by design — it
 * checks what the shell renders and leaves `engine` to core — and the risk that
 * buys is silent LOSS: a field added to `SessionSnapshot` that the schema does
 * not know about would be stripped by a Zod object's default behaviour, and the
 * save would still parse, still load, and quietly have forgotten something.
 * `.passthrough()` is the fix and this suite is the guard, because the only way
 * to see it is to put a snapshot from a live `GameSession` through the whole
 * write-and-read path and compare the JSON.
 *
 * **An unreadable payload is never destroyed.** Three of the cases below assert
 * on what is still in storage afterwards rather than on the return value, which
 * is the half a "returns undefined" test would miss entirely.
 *
 * The store is a parameter, so none of this needs jsdom, a mock or a global.
 */

import { GameSession } from '@vimorror/game';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { stages } from './campaign.ts';
import { loadSave, SAVE_KEY, SCHEMA_VERSION, storeSave, type Save } from './save.ts';
import { defaultSettings } from './settings-screen.tsx';

/** The `Storage` surface, backed by a `Map`. `length`/`key` are here because the
 * interface has them, not because anything under test calls them. */
function fakeStore(seed: Record<string, string> = {}): Storage & { readonly map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage & { readonly map: Map<string, string> };
}

const settings = defaultSettings();

function saveOf(patch: Partial<Save> = {}): Save {
  return { schemaVersion: SCHEMA_VERSION, settings, progress: {}, current: undefined, ...patch };
}

afterEach(() => vi.restoreAllMocks());

describe('loadSave / storeSave', () => {
  it('round-trips an empty profile', () => {
    const store = fakeStore();
    storeSave(saveOf(), store);
    expect(loadSave(store)).toEqual(saveOf());
  });

  it('round-trips settings and progress', () => {
    const store = fakeStore();
    const save = saveOf({
      settings: { ...settings, difficulty: 'nomagic', effectsIntensity: 0, audio: { muted: true, volume: 0.1 } },
      progress: { 'act1-two-worlds': { completed: true, bestKeystrokes: 9, cleanRun: true } },
    });
    storeSave(save, store);
    expect(loadSave(store)).toEqual(save);
  });

  it('carries a LIVE session snapshot through unchanged — the shallow schema must not strip', () => {
    const stage = stages[0];
    expect(stage).toBeDefined();
    const session = new GameSession(stage!, { difficulty: 'verymagic' });
    session.feedKeys('ihello<Esc>');
    const snapshot = session.snapshot();

    const store = fakeStore();
    storeSave(saveOf({ current: { snapshot } }), store);

    // Through JSON on both sides: that is the only equality the save can
    // promise, and it is exactly the one `GameSession.restore` needs.
    expect(loadSave(store)?.current?.snapshot).toEqual(JSON.parse(JSON.stringify(snapshot)));
  });

  it('carries a field the schema has never heard of — the guard for the NEXT snapshot field', () => {
    const stage = stages[0];
    const session = new GameSession(stage!, { difficulty: 'magic' });
    const snapshot = { ...session.snapshot(), somethingSessionGrowsLater: [1, 2, 3] };

    const store = fakeStore();
    storeSave(saveOf({ current: { snapshot: snapshot as never } }), store);

    // Zod's DEFAULT for an object is to strip what it does not list, which here
    // would mean a save that parses, loads, and has quietly forgotten state.
    // `.passthrough()` is the fix and this is the only assertion that sees it —
    // comparing a snapshot as it stands TODAY cannot, because today the schema
    // and the type agree.
    expect(loadSave(store)?.current?.snapshot).toEqual(JSON.parse(JSON.stringify(snapshot)));
  });

  it('restores a session that re-snapshots to the same bytes', () => {
    const stage = stages[0];
    const session = new GameSession(stage!, { difficulty: 'nomagic' });
    session.feedKeys('ihello<Esc>');

    const store = fakeStore();
    storeSave(saveOf({ current: { snapshot: session.snapshot() } }), store);
    const back = loadSave(store)?.current?.snapshot;
    expect(back).toBeDefined();

    const restored = GameSession.restore(stage!, back!);
    expect(JSON.stringify(restored.snapshot())).toBe(JSON.stringify(session.snapshot()));
  });

  it('answers undefined when there is no storage at all', () => {
    expect(loadSave(undefined)).toBeUndefined();
    expect(() => storeSave(saveOf(), undefined)).not.toThrow();
  });

  it('answers undefined for an empty store', () => {
    expect(loadSave(fakeStore())).toBeUndefined();
  });
});

describe('a payload it cannot read', () => {
  it('sets a version mismatch aside under the version it claimed, and does not delete it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw = JSON.stringify({ schemaVersion: 99, settings, progress: {} });
    const store = fakeStore({ [SAVE_KEY]: raw });

    expect(loadSave(store)).toBeUndefined();
    expect(store.map.get(`${SAVE_KEY}.orphan.v99`)).toBe(raw);
    expect(store.map.has(SAVE_KEY)).toBe(false);
  });

  it('sets a shape mismatch aside too — a bad settings object is not a version problem', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw = JSON.stringify({ schemaVersion: SCHEMA_VERSION, settings: { difficulty: 'wizard' }, progress: {} });
    const store = fakeStore({ [SAVE_KEY]: raw });

    expect(loadSave(store)).toBeUndefined();
    expect(store.map.get(`${SAVE_KEY}.orphan.v${SCHEMA_VERSION}`)).toBe(raw);
  });

  it('rejects an out-of-range effectsIntensity rather than handing 47 to the shader', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = fakeStore({
      [SAVE_KEY]: JSON.stringify(saveOf({ settings: { ...settings, effectsIntensity: 47 } })),
    });
    expect(loadSave(store)).toBeUndefined();
  });

  it('leaves unparseable text exactly where it is — no orphan, nothing destroyed', () => {
    const store = fakeStore({ [SAVE_KEY]: 'not json {' });
    expect(loadSave(store)).toBeUndefined();
    expect(store.map.get(SAVE_KEY)).toBe('not json {');
    expect([...store.map.keys()]).toEqual([SAVE_KEY]);
  });

  it('keeps the original when the orphan itself cannot be written', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw = JSON.stringify({ schemaVersion: 99 });
    const store = fakeStore({ [SAVE_KEY]: raw });
    store.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };

    expect(loadSave(store)).toBeUndefined();
    // Failing to preserve it is not a reason to destroy it.
    expect(store.map.get(SAVE_KEY)).toBe(raw);
  });
});

describe('storeSave', () => {
  it('warns rather than throwing when the disk is full — a keystroke must not fail on it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = fakeStore();
    store.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };

    expect(() => storeSave(saveOf(), store)).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('survives a store whose getItem throws, the Safari-private-mode shape', () => {
    const store = fakeStore();
    store.getItem = () => {
      throw new DOMException('SecurityError');
    };
    expect(loadSave(store)).toBeUndefined();
  });
});
