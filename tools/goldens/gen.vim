" gen.vim — vimorror golden-test oracle driver.
"
" Drives REAL Vim over a batch of cases and dumps the resulting buffer,
" cursor and registers as JSON, so our own interpreter can be diffed
" against ground truth.
"
"   vim -u NONE -i NONE -N -es -S gen.vim
"
" Every one of those flags is load-bearing; see tools/goldens/README.md.
"
" I/O goes through environment variables, NOT stdin: under -es Vim reads
" stdin as Ex commands, so a piped-in spec would be executed rather than
" parsed.
"   VIMORROR_SPEC  path to input JSON  (array of cases)
"   VIMORROR_OUT   path to output JSON (array of results)

set nocompatible

" Test buffers are untrusted input — a fuzz-generated line that happens to
" look like a modeline must never be executed.
set nomodeline
set noswapfile nobackup nowritebackup
set encoding=utf-8
set viminfo=
set report=99999
set shortmess=aoOtTWAIcF

" --- Baseline options -------------------------------------------------------
" These are semantic, not cosmetic: they change what the keys DO, so the
" engine must implement exactly this baseline. Cases may override per-case
" via `options:`. `backspace` and `shiftwidth` deliberately track what a real
" user has via defaults.vim rather than the bare -u NONE values.
let s:BASELINE = [
      \ 'backspace=indent,eol,start',
      \ 'tabstop=8', 'softtabstop=0', 'shiftwidth=4', 'expandtab',
      \ 'noautoindent', 'nosmartindent', 'nocindent',
      \ 'startofline', 'selection=inclusive', 'virtualedit=', 'whichwrap=b,s',
      \ 'undolevels=1000',
      \ 'magic', 'wrapscan', 'noignorecase', 'nosmartcase', 'nogdefault',
      \ 'iskeyword=@,48-57,_,192-255',
      \ 'joinspaces&', 'nrformats=bin,hex',
      \ ]

function! s:ApplyOptions(opts) abort
  for l:o in a:opts
    execute 'silent! set ' . l:o
  endfor
endfunction

" Registers captured and cleared between cases. Order matters only for
" output stability.
let s:REGS = ['"', '-', '/'] + map(range(0, 9), 'string(v:val)')
      \ + map(range(char2nr('a'), char2nr('z')), 'nr2char(v:val)')

function! s:ResetRegisters() abort
  for l:r in s:REGS
    silent! call setreg(l:r, [])
  endfor
  let @/ = ''
endfunction

let s:tmpfile = tempname()

" Set up a case. The buffer is written to a temp file and :edit-ed rather
" than poked in with setline(), so undo history starts genuinely empty —
" `u` as the very first key must be a no-op, exactly as in a real session.
"
" The buffer is WIPED first, because re-:edit-ing the same file keeps the
" old buffer's undo history — an over-eager `u` would then restore the
" PREVIOUS case's text. This silently corrupted the first run of every
" "u with nothing to undo" golden.
function! s:Setup(case) abort
  silent! stopinsert
  call writefile(a:case.buffer, s:tmpfile)
  silent! bwipeout!
  silent! execute 'edit! ' . fnameescape(s:tmpfile)
  silent! delmarks!
  " `:edit` itself pushes the file's opening position onto the jumplist —
  " confirmed with a scratch probe (getjumplist() right after :edit! holds one
  " entry at line 1, before `cursor()` ever runs). Left alone, a case's very
  " first `<C-o>` pops that phantom entry instead of correctly finding an
  " empty jumplist, even though nothing the case's own keys did ever jumped.
  " `cursor()` itself does not add an entry, so clearing here is enough.
  silent! clearjumps
  " The last f/F/t/T target is global and survives :edit, so without this the
  " previous case's `f,` leaks into this case's bare `;`.
  silent! call setcharsearch({'char': '', 'forward': 1, 'until': 0})
  call s:ResetRegisters()
  call s:ApplyOptions(s:BASELINE)
  if has_key(a:case, 'options')
    call s:ApplyOptions(a:case.options)
  endif
  call cursor(a:case.cursor[0], a:case.cursor[1])
endfunction

" Run the keys AND capture the result, deliberately in a single function.
"
" Two separate hazards make this one function rather than two:
"
" 1. feedkeys(..., 'xt') — never `execute 'normal'` — because `normal` cannot
"    replay macros: the recording lands but `@a` does not fire. Routing
"    EVERYTHING through feedkeys keeps one code path, so macro and non-macro
"    cases cannot drift apart.
"
"    The 't' flag (Wave 4, found with a scratch probe instrumenting
"    reg_recording()/getreg() between keys) is itself load-bearing and easy
"    to lose back to a plain 'x': with 'x' alone, `q{reg}` correctly flips
"    `reg_recording()` on and back off, but the register itself comes back
"    EMPTY — the keystrokes are never actually captured, only the recording
"    STATE is. 't' ("handle keys as if typed") is what real macro recording
"    needs, per `:help feedkeys()`. Verified to change NOTHING for every
"    already-committed golden (`git diff` on a full regenerate is empty) —
"    it only fixes the one thing that was silently broken.
"
" 2. `:help function-search-undo` — Vim restores the last search pattern (@/)
"    and the redo command (.) when a FUNCTION RETURNS. Running the keys in one
"    function and reading the registers from another silently reports the
"    pre-run @/, so every `/ ? n N * #` golden would record an empty search
"    register while still looking plausible. Observation must happen in the
"    same frame as the action.
"
" `groups` is a LIST of key strings. Each group is fed whole — multi-key
" commands must stay in one feedkeys call or they are silently discarded —
" and the undo block is broken between groups.
"
" This exists because feedkeys(..., 'x') collapses everything it is given into
" a SINGLE undo block: `xxx` fed as one string needs only one `u` to restore
" all three deletions, which is not what interactive Vim does. Feeding one key
" at a time fixes undo but destroys `d2w`, `ci(`, macros and dot-repeat, since
" an incomplete command is dropped when the typeahead empties. Neither extreme
" is right, and the harness cannot infer command boundaries without
" reimplementing the parser it is supposed to be testing — so the case author
" states them.
" Each group gets its OWN try/catch, and the errors are accumulated rather than
" thrown. Some failures — E353 "Nothing in register" among them — surface out of
" feedkeys() as a real exception, not merely as a beep. One try around the whole
" loop therefore abandoned every remaining group, which silently defeated the
" one remedy README detail 9 prescribes: a case that deliberately fails a
" command and then presses more keys puts the follow-up keys in a separate
" group. That remedy only works if a group's failure is contained to that group,
" which is also what interactive Vim does.
function! s:RunAndCapture(groups) abort
  let l:errors = []
  for l:g in a:groups
    try
      call feedkeys(l:g, 'xt')
      call feedkeys('', 'xt')
    catch
      call add(l:errors, v:exception)
    endtry
    " The documented idiom for starting a new undo block (:help undo-blocks).
    let &undolevels = &undolevels
  endfor
  let l:err = join(l:errors, ' | ')

  let l:pos = getcurpos()
  let l:regs = {}
  for l:r in s:REGS
    let l:v = getreg(l:r)
    if l:v !=# ''
      let l:regs[l:r] = {'text': l:v, 'type': getregtype(l:r)}
    endif
  endfor

  return {
        \ 'buffer': getline(1, '$'),
        \ 'cursor': [l:pos[1], l:pos[2]],
        \ 'curswant': l:pos[4],
        \ 'registers': l:regs,
        \ 'error': l:err,
        \ }
endfunction

let s:results = []
let s:fatal = ''

try
  let s:spec = json_decode(join(readfile($VIMORROR_SPEC), "\n"))
  for s:case in s:spec
    let s:out = {'id': s:case.id}
    try
      call s:Setup(s:case)
      call extend(s:out, s:RunAndCapture(s:case.groups))
    catch
      let s:out.error = v:exception
      let s:out.fatal = 1
    endtry
    call add(s:results, s:out)
    silent! stopinsert
  endfor
catch
  let s:fatal = v:exception
endtry

call writefile([json_encode({'results': s:results, 'fatal': s:fatal})], $VIMORROR_OUT)
qall!
