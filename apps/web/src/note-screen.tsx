/**
 * The content note, and the comfort controls that make it worth reading.
 *
 * The checklist bullet asks for two separate things — a skippable note listing
 * the themes, and comfort settings "surfaced before first play" — and this
 * screen is the argument that they are one thing. Comfort controls that merely
 * *exist* before first play are findable, not surfaced: a player who needs them
 * is exactly the player who will not go hunting through a menu to see whether
 * this game is going to do something to them. So the switches sit under the
 * list of themes they answer, and the single continue button is what makes the
 * whole screen skippable for everyone else.
 *
 * The copy obeys three project invariants rather than taste:
 *
 * - **100% original in-game text.** Everything here is written for this game.
 * - **No self-harm imagery, ever** — and the note says so explicitly, because a
 *   content note that lists what IS present without bounding what is absent
 *   leaves the reader to assume the worst.
 * - **No doubt is ever killed for XP.** The themes are named as themes, not as
 *   enemies, which is what the game actually does with them.
 *
 * The note shows on first launch only, and from Wave D that is literally true
 * rather than per-session: `app.tsx` starts here when `loadSave()` came back
 * empty and at the title when it did not, and continuing past this screen is
 * what writes the first save. Nothing routes back. The resources link is
 * permanent from the first frame either way, which is the half that matters —
 * a note you have to be able to find again is a note that failed.
 */

import { ComfortControls, ResourcesLink, type SettingsProps } from './settings-screen.tsx';

/** Named plainly and without euphemism. A note that hedges is not a note. */
const THEMES: readonly string[] = [
  'self-doubt, written as a voice that knows you',
  'intrusive thoughts, arriving as text you did not type',
  'compulsion — the pull to repeat something until it comes out right',
  'dread, isolation, and being watched by a room',
];

export function NoteScreen({ settings, onChange, onContinue }: SettingsProps & { readonly onContinue: () => void }) {
  return (
    <div className="screen">
      <h1>before you start</h1>

      <p className="note">
        This is a horror game about learning a text editor. It goes to some real places, and it is better to know
        which ones now than to find out at two in the morning.
      </p>

      <p className="note">It deals with:</p>
      <ul className="themes">
        {THEMES.map((theme) => (
          <li key={theme}>{theme}</li>
        ))}
      </ul>

      <p className="note">
        It contains <strong>no depictions of self-harm or suicide</strong>, and nothing you meet here is killed for
        points. Every doubt in this game resolves by being understood or by being chosen against. Loss is shown as
        deletion, silence, and an empty buffer — never as injury.
      </p>

      <ComfortControls settings={settings} onChange={onChange} />

      <p className="note">
        All of this stays editable from the settings screen, which is one command or one button from the title.
      </p>

      <div className="run-actions">
        <button type="button" onClick={onContinue}>
          continue
        </button>
      </div>

      <ResourcesLink />
    </div>
  );
}
