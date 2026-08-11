import React from 'react';
import { Mic, MicOff } from 'lucide-react';
import { cn } from '@/src/utils';
import { useSpeechToText } from '../hooks/useSpeechToText';

interface DictationButtonProps {
  onTranscript: (text: string) => void;
  className?: string;
}

// Dropped into RichTextEditor's own toolbar and, via DictationTextarea,
// next to every plain <textarea> notes field — one press starts continuous
// dictation, a second press (or navigating away) stops it. Each finalized
// phrase is handed to `onTranscript` as it's recognized, not batched until
// the mic is turned off, so partial dictation isn't lost if the user
// forgets to stop it before doing something else.
export function DictationButton({ onTranscript, className }: DictationButtonProps) {
  const { isListening, isSupported, error, toggle } = useSpeechToText(onTranscript);

  if (!isSupported) {
    return (
      <span
        title="Voice dictation isn't supported in this browser — try Chrome, Edge, or Safari."
        className={cn('inline-flex p-1.5 rounded-md text-muted-foreground/30 cursor-not-allowed', className)}
      >
        <MicOff className="w-3.5 h-3.5" />
      </span>
    );
  }

  return (
    <button
      type="button"
      title={error ?? (isListening ? 'Stop dictation' : 'Dictate')}
      aria-label={isListening ? 'Stop dictation' : 'Dictate'}
      aria-pressed={isListening}
      // Keep focus on whatever field is being dictated into — without this
      // the mousedown itself would steal focus away from the textarea/
      // contentEditable right before we need it for cursor-position inserts.
      onMouseDown={(e) => e.preventDefault()}
      onClick={toggle}
      className={cn(
        'p-1.5 rounded-md transition-colors',
        error ? 'text-rose-500' : isListening ? 'bg-rose-500/10 text-rose-500 animate-pulse' : 'hover:bg-accent text-muted-foreground hover:text-foreground',
        className
      )}
    >
      <Mic className="w-3.5 h-3.5" />
    </button>
  );
}
