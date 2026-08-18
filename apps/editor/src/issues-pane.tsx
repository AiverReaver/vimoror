/**
 * The schema's own report, verbatim.
 *
 * This component adds no rule and rewords no message. `formatIssues` already
 * emits one `path: message` line per problem, and every one of those messages was
 * written in `schema.ts` for a human to read — "spawn 3:0 is outside the buffer —
 * the engine would silently clamp it" is not a string an editor should try to
 * improve on. Rendering it in a `<pre>` keeps the path prefix aligned, which is
 * what makes a `beats.1.on.entity` issue findable at all.
 */

export type IssuesPaneProps = {
  /** `undefined` means the draft parses. */
  readonly issues: string | undefined;
};

export function IssuesPane({ issues }: IssuesPaneProps) {
  return (
    <div className="pane issues">
      <h2>
        schema {issues === undefined ? <span className="ok">valid</span> : <span className="bad">invalid</span>}
      </h2>
      {issues === undefined ? (
        <p className="note">This stage parses. `validate:stages` would accept the shape.</p>
      ) : (
        <pre>{issues}</pre>
      )}
    </div>
  );
}
