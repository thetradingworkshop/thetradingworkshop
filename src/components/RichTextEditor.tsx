import React, { useEffect, useRef, useState } from 'react';
import { Bold, Italic, Underline, List, ListOrdered, ListChecks, Minus, Image as ImageIcon, Loader2 } from 'lucide-react';
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

  // Shared by insertChecklistItem/insertDivider below: finds the just-
  // inserted element carrying `marker` as a transient class, strips the
  // marker back off, and collapses the caret into it. Needed because
  // execCommand('insertHTML') itself leaves the caret right after
  // whatever HTML string it was given — fine for a single inline node,
  // but our inserts are multi-node (checkbox + label, or hr + a fresh
  // line to type into), so without this the caret ends up in the wrong
  // place and the *next* thing typed lands before the divider/checkbox
  // instead of after it.
  const placeCaretIn = (marker: string, atStart: boolean) => {
    const el = editorRef.current?.querySelector(`.${marker}`);
    if (!el) return;
    el.classList.remove(marker);
    if (!el.className) el.removeAttribute('class');
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(atStart);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  // A checkable line, not a real <ul>/<li> — insertUnorderedList's own
  // Enter/Tab/nesting behavior isn't worth fighting for a "one checkable
  // item at a time" feature. The caret lands inside the new row's text
  // span so typing starts there immediately, matching how
  // insertOrderedList etc. leave the caret ready to type.
  const checklistItemHtml = (marker?: string) =>
    `<div class="checklist-item"><input type="checkbox" contenteditable="false"><span${marker ? ` class="${marker}"` : ''}>&#8203;</span></div>`;

  // The ancestor checklist row containing the current selection, if any —
  // shared by insertChecklistItem and the Enter handler below, both of
  // which need to know whether they're adding a *sibling* row or a fresh
  // one.
  const currentChecklistItem = (): Element | null => {
    const anchor = window.getSelection()?.anchorNode;
    if (!anchor) return null;
    const anchorEl = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as HTMLElement);
    const item = anchorEl?.closest('.checklist-item') ?? null;
    return item && editorRef.current?.contains(item) ? item : null;
  };

  // execCommand('insertHTML') always splices at the caret's exact DOM
  // position — fine when the caret sits in plain text, but when it's
  // already inside a checklist row's inline content (input + span), that
  // splices the new row's HTML *into* that span rather than adding a
  // sibling after it, nesting one row inside another (confirmed by hand:
  // clicking the toolbar button twice in a row does exactly this). So
  // whenever the caret starts inside an existing row, this builds the new
  // row as a real DOM sibling instead of trusting insertHTML to place it.
  const insertChecklistItem = () => {
    editorRef.current?.focus();
    const marker = `_checklist_caret_${Date.now()}`;
    const currentItem = currentChecklistItem();
    if (currentItem) {
      const template = document.createElement('div');
      template.innerHTML = checklistItemHtml(marker);
      currentItem.after(template.firstElementChild!);
    } else {
      document.execCommand('insertHTML', false, checklistItemHtml(marker));
    }
    placeCaretIn(marker, false);
    emitChange();
  };

  // Plain execCommand('insertHorizontalRule') leaves the caret wherever it
  // happened to land relative to the new <hr> — often still *before* it —
  // so whatever gets typed next can end up above the divider instead of
  // below. Following the <hr> with a fresh empty line and moving the
  // caret into that is what actually makes it act as a divider.
  const insertDivider = () => {
    editorRef.current?.focus();
    const marker = `_divider_caret_${Date.now()}`;
    document.execCommand('insertHTML', false, `<hr><div class="${marker}"><br></div>`);
    placeCaretIn(marker, true);
    emitChange();
  };

  // A checkbox's `checked` HTML attribute only reflects its *initial*
  // state — clicking it updates the live DOM property but not the
  // attribute, so serializing innerHTML right after a click would still
  // show the box unchecked. Syncing the attribute here is what makes a
  // toggle actually survive save/reload.
  const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      if (target.checked) target.setAttribute('checked', '');
      else target.removeAttribute('checked');
      emitChange();
    }
  };

  // Same reasoning as insertChecklistItem above, for the other way a new
  // row gets started: pressing Enter while inside one. Default Enter
  // behavior in contentEditable splits the nearest block ancestor — here
  // that's the checklist row itself, which wraps inline content rather
  // than being a paragraph, so the split doesn't reliably happen. Handling
  // Enter explicitly both avoids that and makes it continue the checklist,
  // same as most task-list UIs.
  const handleContentKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const currentItem = currentChecklistItem();
    if (!currentItem) return;
    e.preventDefault();
    const marker = `_checklist_caret_${Date.now()}`;
    const template = document.createElement('div');
    template.innerHTML = checklistItemHtml(marker);
    currentItem.after(template.firstElementChild!);
    placeCaretIn(marker, false);
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
        <ToolbarButton icon={ListChecks} label="Checklist item" onClick={insertChecklistItem} />
        <div className="w-px h-4 bg-border mx-1" />
        <ToolbarButton icon={Minus} label="Divider" onClick={insertDivider} />
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
          onClick={handleContentClick}
          onKeyDown={handleContentKeyDown}
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
