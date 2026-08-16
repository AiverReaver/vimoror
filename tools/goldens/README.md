# The golden-test harness

Real Vim 9.1 is the oracle. Cases are authored as YAML, executed by real Vim
via `gen.vim`, and the results committed to `goldens/*.json`. Our interpreter is
diffed against those committed results, so **CI never needs Vim installed**.

```bash
pnpm goldens:generate            # regenerate everything (needs local vim)
pnpm goldens:generate -- word    # regenerate one family
pnpm goldens:verify              # prove batching leaks no state (slow)
pnpm test                        # diff engine vs committed goldens
```

## Why goldens and not hand-written expectations

`dw` on the last word of a line does not eat the newline, unlike `dw`
everywhere else. Nobody writes that from memory. The oracle reproduces Vim's
warts whether or not we know they exist — which is the entire argument.

## Fourteen details that are load-bearing

The first five were earned during the original prototype. The sixth and seventh
were found while rebuilding the harness, the eighth and ninth while authoring
Wave 2, the tenth while authoring Wave 3, the eleventh and twelfth while
authoring Wave 4c's macro goldens, the thirteenth while authoring Wave 4d's
ex-command goldens, the fourteenth while building Wave 4g's fuzz harness — and
all of them produce goldens that look entirely plausible while being wrong
(the thirteenth is the one exception: it produces no bad golden, because the
case that would prove it wrong is never written).

1. **`-i NONE`** — without it Vim reads viminfo and registers leak between
   cases. This silently corrupted the first prototype run.
2. **`-u NONE -N`** — no user config, but `nocompatible`.
3. **Control characters reach `feedkeys()` as real bytes**, never as `<Esc>`
   *text*. The trap is unescaping `\<Esc>` notation with `eval()`, which types
   the literal characters `<Esc>` into the buffer. Notation is resolved in
   [`keynotation.ts`](keynotation.ts) before the spec is written; JSON's own
   `\uXXXX` escaping is reversed by Vim's `json_decode`, so `feedkeys` gets a
   real byte. Routing through JSON escaping rather than writing raw bytes is
   also what stops a key like `<NL>` from splitting the spec file in two.
4. **Everything goes through `feedkeys(keys, 'xt')`, never `execute 'normal'`** —
   `:normal` cannot replay macros: the recording lands but `@a` never fires.
   Rather than special-casing `q`, `@` and `:g`, *all* cases take the feedkeys
   path, so macro and non-macro goldens cannot drift apart. **The `t` flag is
   itself load-bearing** (found in Wave 4 with a scratch probe instrumenting
   `reg_recording()`/`getreg()` between individual keys): with plain `'x'`,
   `q{reg}` correctly toggles `reg_recording()` on and off, but the register
   comes back **empty** — only the recording *state* is tracked, the
   keystrokes are never actually captured without `'t'` ("handle keys as if
   typed"). A full regenerate with `'xt'` changed zero bytes of every
   already-committed golden, so this was purely a silent gap, not a tradeoff.
5. **Vim reports 1-based byte columns; the engine uses 0-based character
   indices.** Convert only in the comparator. `mode()` is meaningless under
   `-es`, so mode is captured from our engine alone — if mode goldens ever
   prove necessary, they need an interactive Vim driven through a pty.
6. **Act and observe in the same function frame.** Per `:help
   function-search-undo`, Vim restores the last search pattern (`@/`) *and* the
   redo command (`.`) when a **function returns**. Running the keys in one
   function and reading registers from another reports the *pre-run* `@/`, so
   every `/ ? n N * #` golden would record an empty search register while
   looking entirely plausible. `s:RunAndCapture()` is one function for exactly
   this reason — do not split it.
7. **`feedkeys` collapses everything it is given into ONE undo block.** Fed as
   the single string `xxx`, one `u` restores all three deletions — interactive
   Vim needs three. Feeding one key at a time fixes undo and destroys
   everything else: `d2w`, `ci(`, macro recording and dot-repeat all become
   silent no-ops, because an incomplete command is dropped when the typeahead
   empties. A pty does not help — this is `feedkeys`, not `-es`. Since the
   harness cannot find command boundaries without reimplementing the parser it
   is meant to be testing, the case author states them: write `keys` as a YAML
   list and the oracle feeds each group whole, breaking the undo block between
   groups. Any case making more than one discrete change must use groups.

8. **`:edit!` keeps the previous buffer's undo history.** Re-editing the same
   temp file reuses the buffer, and the reload itself is undoable — so a `u`
   with "nothing" to undo restored the *previous case's* text. Every
   "u is a no-op here" golden was silently corrupted this way. `s:Setup()`
   therefore `bwipeout!`s the buffer before each case; only a wiped buffer
   truly starts with empty undo history.
9. **A failed command aborts the rest of a `feedkeys` batch** — macro
   semantics — while interactive Vim just beeps and carries on with the next
   key. A case that deliberately fails a command (`9S` on a two-line buffer)
   and then presses more keys must put the follow-up keys in a **separate
   group**, or the golden bakes in the abort and no interactive-semantics
   engine can ever match it.
10. **Some failures raise a catchable exception out of `feedkeys`, not just a
    beep.** E353 "Nothing in register" is one. `s:RunAndCapture` therefore wraps
    **each group in its own `try`** and accumulates the messages: one `try`
    around the whole loop abandoned every remaining group, which silently
    defeated detail 9's only remedy — the follow-up keys were in a separate
    group and still never ran. Since a beep and an exception are
    indistinguishable from the case author's side, "did Vim error" is not a
    reliable signal on its own, so a case that means to fail says so with
    `expectError: true`. An **undeclared** error is then reported as a problem,
    and so is a **declared** one that did not actually happen — a case written
    to pin a failure that quietly started succeeding is exactly as wrong as the
    reverse.
11. **Detail 10's `try`/`catch` DEFEATS a real Vim macro's own abort-on-error —
    for a genuine exception, not for a beep.** A macro (`@a`) that hits a
    plain motion-failure beep (`l` at end-of-line) still halts everything left
    in it, exactly as `:help @` implies. But a macro that hits a genuine Vim
    ERROR — E353 "Nothing in register", E20 "Mark not set" — does NOT halt
    when the `feedkeys()` call is wrapped in `:try`/`:catch`, though the
    identical call left to fail on its own *does* halt. Confirmed as a clean
    A/B with a scratch probe: catching the exception is what defeats whatever
    internal check Vim's macro loop uses to stop early. Since detail 10 makes
    that wrapping unavoidable for every group in this harness, "does not halt
    on a genuine error" is the correct, measured ground truth for these
    goldens — not raw interactive Vim, which is the harness's own general
    rule, just newly visible here. `packages/vim-core/src/state.ts`'s
    `MACRO_HALT_EXEMPT` encodes exactly the two reasons this matters for.
12. **`reg_recording()` and `@@`'s "last register" memory are Vim globals, not
    reset between cases.** `s:Setup()` wipes the buffer, registers and marks,
    but has no way to force-stop a leftover recording or forget which
    register `@@` last repeated — there is no ex command for either. A case
    whose own keys leave a recording still open (a bare `q` that lands as a
    failed motion instead of a stop, per detail 9's swallow-on-operator-
    pending rule) corrupts every case after it in the same file: `q` at the
    START of the next case's keys stops the WRONG recording instead of
    starting a fresh one. And a case that means to test "no macro has ever
    run" (`@@` with nothing to repeat, E748) only measures true if it runs
    BEFORE any other case's `@` in the same file gives that memory something
    to remember — `pnpm goldens:verify` catches exactly this (its isolated,
    one-process-per-case run disagrees with the batched one). `wave4-macros`
    keeps that one case first in the file for this reason.
13. **`:q` and `ZZ`/`ZQ` must never appear in a case's `keys` — not even inside
    a `:normal` argument.** Every other detail here is about a golden that
    LOOKS plausible while being wrong; this one is about a case that can take
    the whole batch down with it. Running these for real against the batched
    harness process does not beep or error — it actually tries to quit Vim
    mid-run, which either aborts everything after it in the same file or hangs
    the generator waiting on a process that already exited. `:w` is safe (it
    just rewrites the scratch temp file harmlessly) but pointless to golden:
    neither event shows up in what the comparator diffs — buffer, cursor,
    registers — so a golden could not tell "emitted `BufferSaved`" from "did
    nothing" regardless. Both are covered in
    `packages/vim-core/src/semantics.test.ts` instead, straight against the
    engine, the same way empty-register register semantics are — this is
    "the oracle structurally cannot express it," not "the oracle would refuse
    to run it," but the fix is identical either way. `docs/CHECKLIST.md`'s 4g
    already flags this same hazard for the fuzz alphabet; `:g`/`:v` in 4f will
    need the same care, since a fuzzed or careless global command is exactly
    the shape that could embed one of these by accident.
14. **`:edit!` also pushes a phantom jumplist entry onto the very first case
    that ever touches the jumplist.** The same setup-leak shape as detail 8's
    undo history, for a different piece of state: `getjumplist()` right after
    `:edit!` already holds one entry, at the file's opening line, before
    `cursor()` in `s:Setup()` ever runs. A case whose very first key is
    `<C-o>` — with nothing of its OWN having jumped — popped that phantom
    entry instead of correctly finding an empty jumplist. Found by Wave 4g's
    fuzz harness, which is far more likely than a hand-authored case to
    start cold with a bare jump command. Fixed with `silent! clearjumps`
    right next to `delmarks!` in `s:Setup()`; a full regenerate changed zero
    bytes of every already-committed golden, confirming this was a pure gap
    exactly like detail 12's `'xt'` fix, not a tradeoff.

Detail 5's other half still stands: `mode()` reports `n` even inside insert
mode under `feedkeys`, so mode goldens remain out of reach for this oracle.

## Setup semantics

Each case gets a genuinely fresh start:

- The buffer is `bwipeout!`-ed, then the case text is written to a temp file
  and `:edit`-ed rather than poked in with `setline()`, so **undo history
  starts empty** — `u` as the very first key is a no-op, exactly as in a real
  session. The wipe is not optional (detail 8).
- All registers are cleared, `delmarks!` runs, and the baseline options are
  reapplied.
- `set nomodeline` is mandatory: case buffers are untrusted input, and a
  fuzz-generated line that looks like a modeline must never execute.

Cases run batched in one Vim process (~100× faster than one process per case).
That is only sound if the reset is total, so `pnpm goldens:verify` re-runs every
case in its own process and diffs. Run it after touching `gen.vim`.

## Baseline options

These change what the keys *do*, so the engine must implement exactly this
baseline. `backspace` and `shiftwidth` deliberately track what a real user has
via `defaults.vim` rather than the bare `-u NONE` values.

| Option | Value |
|---|---|
| `backspace` | `indent,eol,start` |
| `tabstop` / `softtabstop` / `shiftwidth` | `8` / `0` / `4` |
| `expandtab` | on |
| `autoindent` / `smartindent` / `cindent` | off |
| `startofline` | on |
| `selection` | `inclusive` |
| `virtualedit` | empty |
| `whichwrap` | `b,s` |
| `magic` / `wrapscan` | on |
| `ignorecase` / `smartcase` / `gdefault` | off |
| `iskeyword` | `@,48-57,_,192-255` |

Override per case with `options: ['shiftwidth=2', 'noexpandtab']`.

## Case format

```yaml
cases:
  - id: word/dw-eol            # unique, family-prefixed
    note: why this case exists # optional
    buffer: 'foo bar'          # string, or a list of lines
    cursor: [1, 5]             # 1-based [line, byte col], Vim's own convention
    keys: 'dw'                 # supports <Esc> <CR> <Tab> <BS> <C-r> …
    options: ['shiftwidth=2']  # optional
    expectError: true          # optional; this case MEANS to fail (detail 10)
```

When a case makes more than one discrete change, write `keys` as a list of
command groups so each gets its own undo block (detail 7):

```yaml
  - id: wave1/u-multiple-changes
    buffer: 'abcdef'
    cursor: [1, 1]
    keys: ['x', 'x', 'x', 'u', 'u']   # NOT 'xxxuu'
```

Keep multi-key commands inside a single group — `['d2w']`, never `['d','2','w']`.

**A case's `note` is a hypothesis, not an assertion.** Authoring a case whose
note says what Vim "must" do proves nothing until `goldens:generate` has run:
three Wave 2 cases were written asserting that a no-op `>>` mints no undo block,
and real Vim refuted all three on first generation. When a freshly generated
golden contradicts its own note, the golden is right — fix the note and the
engine, not the golden. The only exception is a case that trips detail 7 or 9
(undo groups, abort-on-error), where the fix is to restructure `keys:` into
groups and regenerate.

Unknown `<...>` notation throws rather than passing through as text — silently
typing `<Foo>` into a test buffer is the failure mode detail 3 exists to prevent.

`keynotation.ts` is a deliberate second implementation of the notation parsing
in `packages/vim-core/src/keys.ts`. They must not be shared: one buggy parser
feeding both oracle and engine would produce a golden that agrees with the bug.
