import React, { useEffect, useRef, useState } from 'react';
import { Bold, Italic, Underline, List, ListOrdered, Image as ImageIcon, Loader2 } from 'lucide-react';
import { cn } from '@/src/utils';

// Firestore documents cap out at ~1MiB. A pasted screenshot is downscaled and
// re-encoded as JPEG before being embedded as a data URI, and rejected outright
// if it's still too big — there's no Firebase Storage bucket wired up for this
// app, so inline data URIs are the only option without adding that
// infrastructure just for journal images.
const MAX_IMAGE_DIMENSION = 1200;
const JPEG_QUALITY = 0.82;
const MAX_DATA_URL_BYTES = 700_000;

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

  const processImageFile = (file: File) => {
    setError(null);
    if (!file.type.startsWith('image/')) return;
    setIsProcessingImage(true);

    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
          const scale = MAX_IMAGE_DIMENSION / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setError('Could not process that image.');
          setIsProcessingImage(false);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        if (dataUrl.length > MAX_DATA_URL_BYTES) {
          setError('Image is too large even after compression — try a smaller screenshot.');
          setIsProcessingImage(false);
          return;
        }
        insertImageDataUrl(dataUrl);
        setIsProcessingImage(false);
      };
      img.onerror = () => {
        setError('Could not read that image.');
        setIsProcessingImage(false);
      };
      img.src = reader.result as string;
    };
    reader.onerror = () => {
      setError('Could not read that file.');
      setIsProcessingImage(false);
    };
    reader.readAsDataURL(file);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          e.preventDefault();
          const file = items[i].getAsFile();
          if (file) processImageFile(file);
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
      processImageFile(file);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImageFile(file);
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
