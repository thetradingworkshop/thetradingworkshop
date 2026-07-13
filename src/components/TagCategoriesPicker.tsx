import React, { useState } from 'react';
import { cn } from '@/src/utils';
import { Input } from './Shared';
import { Plus, Trash2, ChevronDown } from 'lucide-react';
import { doc, setDoc, deleteDoc, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { TagCategory } from '../types';

const DOT_COLORS = [
  'bg-sky-400', 'bg-emerald-400', 'bg-rose-400', 'bg-amber-400',
  'bg-violet-400', 'bg-cyan-400', 'bg-lime-400', 'bg-fuchsia-400',
];

function dotColorFor(index: number) {
  return DOT_COLORS[index % DOT_COLORS.length];
}

function CategoryRow({
  category, index, selected, onToggleTag, onAddTag, onDeleteCategory,
}: {
  category: TagCategory;
  index: number;
  selected: string[];
  onToggleTag: (tag: string) => void;
  onAddTag: (tag: string) => void;
  onDeleteCategory: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [newTag, setNewTag] = useState('');

  const submitNewTag = () => {
    if (newTag.trim()) {
      onAddTag(newTag.trim());
      setNewTag('');
    }
  };

  const selectedInCategory = category.tags.filter(t => selected.includes(t));

  return (
    <div className="border-b border-border/60 py-3 last:border-b-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold text-foreground">
          <span className={cn('h-2 w-2 rounded-full', dotColorFor(index))} />
          {category.name}
        </div>
        <button onClick={onDeleteCategory} className="text-muted-foreground hover:text-rose-500 transition-colors" title="Delete category">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="relative mt-2">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex w-full items-center justify-between rounded-xl border border-border bg-accent/20 px-3 py-2 text-left text-xs text-muted-foreground hover:border-primary/40 transition-colors"
        >
          <span className="truncate">{selectedInCategory.length > 0 ? selectedInCategory.join(', ') : 'Select tag'}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0" />
        </button>
        {open && (
          <div className="absolute z-10 mt-1 w-full rounded-xl border border-border bg-card p-2 shadow-xl">
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {category.tags.length === 0 && (
                <div className="px-2 py-1 text-[10px] text-muted-foreground italic">No tags yet — add one below</div>
              )}
              {category.tags.map(tag => (
                <label key={tag} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium hover:bg-accent/40">
                  <input
                    type="checkbox"
                    checked={selected.includes(tag)}
                    onChange={() => onToggleTag(tag)}
                    className="h-3.5 w-3.5 rounded border-border"
                  />
                  {tag}
                </label>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1 border-t border-border/60 pt-2">
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitNewTag(); }}
                placeholder="Add tag..."
                className="min-w-0 flex-1 rounded-lg border border-border bg-accent/20 px-2 py-1 text-[11px] outline-none placeholder:text-muted-foreground/60"
              />
              <button onClick={submitNewTag} className="rounded-lg bg-accent p-1.5 hover:bg-accent/70">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function TagCategoriesPicker({
  categories, selectedTags, onChange, userId,
}: {
  categories: TagCategory[];
  selectedTags: string[];
  onChange: (tags: string[]) => void;
  userId: string;
}) {
  const [newCategory, setNewCategory] = useState('');

  const toggleTag = (tag: string) => {
    onChange(selectedTags.includes(tag) ? selectedTags.filter(t => t !== tag) : [...selectedTags, tag]);
  };

  const addTagToCategory = async (categoryId: string, tag: string) => {
    await updateDoc(doc(db, 'tagCategories', categoryId), { tags: arrayUnion(tag) });
  };

  const deleteCategory = async (categoryId: string) => {
    await deleteDoc(doc(db, 'tagCategories', categoryId));
  };

  const submitNewCategory = async () => {
    if (!newCategory.trim()) return;
    const id = crypto.randomUUID();
    await setDoc(doc(db, 'tagCategories', id), {
      userId,
      name: newCategory.trim(),
      tags: [],
      order: categories.length,
      createdAt: serverTimestamp(),
    });
    setNewCategory('');
  };

  return (
    <div className="rounded-2xl border border-border bg-accent/10 p-4">
      {categories.length === 0 && (
        <div className="py-3 text-center text-xs text-muted-foreground italic">No tag categories yet. Add one below.</div>
      )}
      {categories.map((cat, i) => (
        <CategoryRow
          key={cat.id}
          category={cat}
          index={i}
          selected={selectedTags}
          onToggleTag={(tag) => toggleTag(tag)}
          onAddTag={(tag) => addTagToCategory(cat.id, tag)}
          onDeleteCategory={() => deleteCategory(cat.id)}
        />
      ))}
      <div className="mt-3 flex items-center gap-2">
        <Input
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitNewCategory(); }}
          placeholder="Add new category"
          className="h-9 text-xs"
        />
        <button onClick={submitNewCategory} className="rounded-xl bg-accent px-3 py-2 hover:bg-accent/70 transition-colors">
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
