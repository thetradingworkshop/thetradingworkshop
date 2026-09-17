import React, { useRef, useState } from 'react';
import { Film, Loader2, Trash2, Video } from 'lucide-react';
import { cn } from '@/src/utils';
import { deleteMediaFile, MAX_VIDEO_BYTES, uploadMediaFile } from '@/src/lib/mediaUpload';
import { MediaAttachment } from '@/src/types';

interface UploadingItem {
  tempId: string;
  fileName: string;
  progress: number;
}

interface MediaAttachmentsProps {
  media: MediaAttachment[];
  onChange: (media: MediaAttachment[]) => void;
  userId: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function MediaAttachments({ media, onChange, userId }: MediaAttachmentsProps) {
  const [uploading, setUploading] = useState<UploadingItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFile = (file: File | undefined | null) => {
    if (!file) return;
    setError(null);
    const tempId = `${Date.now()}-${file.name}`;
    setUploading((prev) => [...prev, { tempId, fileName: file.name, progress: 0 }]);
    uploadMediaFile(file, userId, (progress) => {
      setUploading((prev) => prev.map((u) => (u.tempId === tempId ? { ...u, progress } : u)));
    })
      .then((attachment) => {
        onChange([...media, attachment]);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setUploading((prev) => prev.filter((u) => u.tempId !== tempId)));
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    addFile(e.dataTransfer.files?.[0]);
  };

  const removeAt = async (index: number) => {
    const attachment = media[index];
    onChange(media.filter((_, i) => i !== index));
    try {
      await deleteMediaFile(attachment);
    } catch (err) {
      console.error('Failed to delete media file from storage (already removed from the note):', err);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold flex items-center space-x-2">
          <Video className="w-4 h-4 text-indigo-500" />
          <span>Recordings</span>
        </h3>
        {media.length > 0 && <span className="text-[10px] text-muted-foreground">{media.length} attached</span>}
      </div>

      <div
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        className={cn(
          "flex flex-col items-center justify-center gap-2 p-8 rounded-2xl border-2 border-dashed cursor-pointer transition-colors text-center",
          isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 bg-accent/10"
        )}
      >
        <Film className="w-6 h-6 text-muted-foreground" />
        <p className="text-xs font-medium">Click to browse, or drop a screen recording / clip</p>
        <p className="text-[10px] text-muted-foreground">Up to {Math.floor(MAX_VIDEO_BYTES / (1024 * 1024 * 1024))}GB — keep this open until it finishes uploading</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => { addFile(e.target.files?.[0]); e.target.value = ''; }}
        />
      </div>
      {error && <p className="text-xs text-rose-500">{error}</p>}

      {uploading.length > 0 && (
        <div className="space-y-2">
          {uploading.map((u) => (
            <div key={u.tempId} className="flex items-center gap-3 p-3 rounded-xl border border-border/50 bg-accent/10">
              <Loader2 className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{u.fileName}</p>
                <div className="h-1 mt-1 rounded-full bg-border overflow-hidden">
                  <div className="h-full bg-indigo-500 transition-all" style={{ width: `${u.progress}%` }} />
                </div>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">{u.progress}%</span>
            </div>
          ))}
        </div>
      )}

      {media.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {media.map((m, i) => (
            <div key={m.id} className="relative group rounded-xl overflow-hidden border border-border/50 bg-black/40">
              <video src={m.url} controls className="w-full aspect-video bg-black" />
              <div className="flex items-center justify-between px-2 py-1.5 text-[10px] text-muted-foreground">
                <span className="truncate">{m.fileName} · {formatBytes(m.size)}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeAt(i); }}
                  className="p-1 rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-600 hover:text-white shrink-0"
                  title="Remove recording"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
