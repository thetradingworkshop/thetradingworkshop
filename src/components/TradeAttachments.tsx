import React, { useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2, X } from 'lucide-react';
import { cn } from '@/src/utils';
import { processImageFile } from '@/src/lib/imageProcessing';
import { Modal } from './Shared';

interface TradeAttachmentsProps {
  attachments: string[];
  onChange: (attachments: string[]) => void;
}

export function TradeAttachments({ attachments, onChange }: TradeAttachmentsProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFile = (file: File | undefined | null) => {
    if (!file) return;
    setError(null);
    setIsProcessing(true);
    processImageFile(file)
      .then(dataUrl => onChange([...attachments, dataUrl]))
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsProcessing(false));
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    addFile(e.dataTransfer.files?.[0]);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        addFile(items[i].getAsFile());
        return;
      }
    }
  };

  const removeAt = (index: number) => {
    onChange(attachments.filter((_, i) => i !== index));
    setPreviewIndex(null);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold flex items-center space-x-2">
          <ImagePlus className="w-4 h-4 text-indigo-500" />
          <span>Attachments</span>
        </h3>
        {attachments.length > 0 && <span className="text-[10px] text-muted-foreground">{attachments.length} attached</span>}
      </div>

      <div
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onPaste={handlePaste}
        className={cn(
          "flex flex-col items-center justify-center gap-2 p-8 rounded-2xl border-2 border-dashed cursor-pointer transition-colors text-center",
          isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 bg-accent/10"
        )}
      >
        {isProcessing ? (
          <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
        ) : (
          <ImagePlus className="w-6 h-6 text-muted-foreground" />
        )}
        <p className="text-xs font-medium">Click to browse, or paste / drop a screenshot</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { addFile(e.target.files?.[0]); e.target.value = ''; }}
        />
      </div>
      {error && <p className="text-xs text-rose-500">{error}</p>}

      {attachments.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {attachments.map((src, i) => (
            <div key={i} className="relative group rounded-xl overflow-hidden border border-border/50 aspect-square">
              <img
                src={src}
                alt={`Attachment ${i + 1}`}
                className="w-full h-full object-cover cursor-pointer"
                onClick={() => setPreviewIndex(i)}
              />
              <button
                onClick={(e) => { e.stopPropagation(); removeAt(i); }}
                className="absolute top-1.5 right-1.5 p-1 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-600"
                title="Remove attachment"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={previewIndex !== null} onClose={() => setPreviewIndex(null)} title="Attachment" maxWidth="lg">
        {previewIndex !== null && (
          <div className="space-y-4">
            <img src={attachments[previewIndex]} alt="Attachment preview" className="w-full rounded-xl" />
            <button
              onClick={() => removeAt(previewIndex)}
              className="flex items-center gap-2 text-xs font-bold text-rose-500 hover:underline"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove this attachment
            </button>
          </div>
        )}
      </Modal>
    </section>
  );
}
