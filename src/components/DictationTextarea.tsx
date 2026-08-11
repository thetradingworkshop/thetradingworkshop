import React, { useRef } from 'react';
import { cn } from '@/src/utils';
import { DictationButton } from './DictationButton';

// A drop-in replacement for a plain controlled <textarea> — same props,
// same value/onChange contract — that adds a mic button in the corner.
// Dictated text is written through the textarea's native value setter and
// a real 'input' event rather than calling `onChange` directly: the caller
// only ever gave us a standard React.ChangeEventHandler, and synthesizing
// a fake ChangeEvent by hand is exactly the kind of thing that quietly
// breaks the moment React's internals change; dispatching a real DOM event
// lets React build its own SyntheticEvent from it, so this works with
// *any* onChange handler unmodified.
type DictationTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function DictationTextarea({ className, ...props }: DictationTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleTranscript = (text: string) => {
    const el = ref.current;
    if (!el) return;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (!nativeSetter) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    // Trailing space so back-to-back dictated phrases don't run together —
    // same convention most dictation UIs (Docs, iOS) use.
    const insertion = `${text} `;
    const next = el.value.slice(0, start) + insertion + el.value.slice(end);
    nativeSetter.call(el, next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const caret = start + insertion.length;
    // The value write above re-renders the controlled textarea on the next
    // tick, which resets selection — restore the caret after that settles
    // rather than immediately, or the browser snaps it back to the end.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="relative">
      <textarea ref={ref} className={cn(className, 'pr-9')} {...props} />
      <DictationButton onTranscript={handleTranscript} className="absolute top-2 right-2" />
    </div>
  );
}
