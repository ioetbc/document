import { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { isValidSource } from "./source";

function completedSource(view: EditorView, enter: boolean): string | undefined {
  const { empty, $from } = view.state.selection;
  if (!empty || !$from.parent.isTextblock || view.composing) return;
  const before = $from.parent.textBetween(0, $from.parentOffset, "\n", "\n");
  // Enter in the middle of a token must not submit its truncated prefix.
  const after = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, "\n", "\n");
  if (enter && after && !/^\s/.test(after)) return;
  const match = (enter
    ? /(?:^|\s)source:[ \t]*(\S+)[ \t]*$/i
    : /(?:^|\s)source:[ \t]*(\S+)\s+$/i).exec(before);
  if (!match) return;
  return isValidSource(match[1]) ? match[1] : undefined;
}

/** Bind the editor's completion detection to the application's source API. */
export function createSourcePlugin(
  submitSource: (source: string) => void | Promise<unknown>,
  onError: (error: unknown) => void = error => console.error("Could not submit source", error),
) {
  const submittedByView = new WeakMap<EditorView, Set<string>>();

  function submit(view: EditorView, enter = false) {
    const source = completedSource(view, enter);
    const submitted = submittedByView.get(view);
    if (!source || !submitted || submitted.has(source)) return;
    // Reserve before invoking the API so rapid edits cannot duplicate a request.
    // Failed attempts remain reserved to avoid retrying on every later space.
    submitted.add(source);
    try {
      void Promise.resolve(submitSource(source)).catch(onError);
    } catch (error) {
      onError(error);
    }
  }

  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key === "Enter" && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey) submit(view, true);
        // Preserve the existing paragraph and list-item Enter commands.
        return false;
      },
    },
    view(view) {
      submittedByView.set(view, new Set());
      return {
        update(view, previousState) {
          if (!view.state.doc.eq(previousState.doc)) submit(view);
        },
        destroy() {
          submittedByView.delete(view);
        },
      };
    },
  });
}
