import React, { useEffect, useRef, useState } from 'react';
import { Bold, Italic, Underline, List, ListOrdered, Image as ImageIcon, Loader2 } from 'lucide-react';
import { cn } from '@/src/utils';
import { processImageFile } from '@/src/lib/imageProcessing';
import { DictationButton } from './DictationButton';

function isContentEmpty(html?: string): boolean {
  if (!html) return true;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return !tmp.textContent?.trim() && !tmp.querySelector('img');
}

function stripHtml(html?: string): string {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

interface RichTextEditorProps {
  initialValue: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeightClass?: string;
}

export function RichTextEditor({ initialValue, onChange, placeholder, minHeightClass }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(isContentEmpty(initialValue));
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Uncontrolled by design: contentEditable + a controlled `value` prop fight
  // over the cursor position on every keystroke. The parent remounts this
  // component (via `key`) when switching to a different journal entry, so
  // syncing once on mount is enough.
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = initialValue || '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emitChange = () => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    onChange(html);
    setIsEmpty(isContentEmpty(html));
  };

  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    emitChange();
  };

  const insertImageDataUrl = (dataUrl: string) => {
    editorRef.current?.focus();
    document.execCommand('insertImage', false, dataUrl);
    emitChange();
  };

  // Trailing space so back-to-back dictated phrases don't run together —
  // same convention DictationTextarea uses for plain textareas.
  const insertDictatedText = (text: string) => {
    editorRef.current?.focus();
    document.execCommand('insertText', false, `${text} `);
    emitChange();
  };

  const handleImageFile = (file: File) => {
    setError(null);
    setIsProcessingImage(true);
    processImageFile(file)
      .then(insertImageDataUrl)
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsProcessingImage(false));
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          e.preventDefault();
          const file = items[i].getAsFile();
          if (file) handleImageFile(file);
          return;
        }
      }
    }
    // Paste as plain text so formatting/scripts from external sources
    // (e.g. copying from a webpage) don't leak into the journal entry.
    const text = e.clipboardData?.getData('text/plain');
    if (text) {
      e.preventDefault();
      document.execCommand('insertText', false, text);
      emitChange();
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      e.preventDefault();
      handleImageFile(file);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImageFile(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 flex-wrap p-1 bg-accent/30 border border-border rounded-lg w-fit">
        <ToolbarButton icon={Bold} label="Bold" onClick={() => exec('bold')} />
        <ToolbarButton icon={Italic} label="Italic" onClick={() => exec('italic')} />
        <ToolbarButton icon={Underline} label="Underline" onClick={() => exec('underline')} />
        <div className="w-px h-4 bg-border mx-1" />
        <ToolbarButton icon={List} label="Bullet list" onClick={() => exec('insertUnorderedList')} />
        <ToolbarButton icon={ListOrdered} label="Numbered list" onClick={() => exec('insertOrderedList')} />
        <div className="w-px h-4 bg-border mx-1" />
        <label
          className="cursor-pointer p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="Insert image"
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <input type="file" accept="image/*" className="hidden" onChange={handleFileInput} />
        </label>
        <div className="w-px h-4 bg-border mx-1" />
        <DictationButton onTranscript={insertDictatedText} />
        {isProcessingImage && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground ml-1" />}
      </div>

      <div className="relative">
        {isEmpty && placeholder && (
          <div className="absolute top-4 left-4 text-sm text-muted-foreground pointer-events-none select-none">
            {placeholder}
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className={cn(
            'rich-content w-full p-4 bg-accent/30 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 overflow-y-auto',
            minHeightClass || 'min-h-[128px]'
          )}
          onInput={emitChange}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        />
      </div>

      <p className="text-[10px] text-muted-foreground">Paste or drop a screenshot to attach it.</p>
      {error && <p className="text-xs text-rose-500">{error}</p>}
    </div>
  );
}

function ToolbarButton({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

export { isContentEmpty, stripHtml };
