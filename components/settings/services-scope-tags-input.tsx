"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import {
  normalizeServiceTag,
} from "@/lib/leads/services-scope-tags";
import { cn } from "@/lib/utils";

type ServicesScopeTagsInputProps = {
  id?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
};

function tagExists(tags: string[], candidate: string): boolean {
  const normalized = candidate.toLowerCase();
  return tags.some((tag) => tag.toLowerCase() === normalized);
}

export function ServicesScopeTagsInput({
  id,
  tags,
  onChange,
  disabled = false,
  placeholder = "Type a service and press comma",
}: ServicesScopeTagsInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");

  function commitDraft(raw?: string) {
    const value = normalizeServiceTag(raw ?? draft);
    if (!value || tagExists(tags, value)) {
      setDraft("");
      return;
    }
    onChange([...tags, value]);
    setDraft("");
  }

  function commitFromDraftWithDelimiter(text: string) {
    const parts = text.split(",");
    const trailing = parts.pop() ?? "";
    const nextTags = [...tags];

    for (const part of parts) {
      const value = normalizeServiceTag(part);
      if (value && !tagExists(nextTags, value)) {
        nextTags.push(value);
      }
    }

    if (nextTags.length !== tags.length) {
      onChange(nextTags);
    }

    setDraft(trailing);
  }

  function removeTag(index: number) {
    onChange(tags.filter((_, i) => i !== index));
    inputRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "," || event.key === "Enter") {
      event.preventDefault();
      commitDraft();
      return;
    }

    if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      event.preventDefault();
      onChange(tags.slice(0, -1));
    }
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    if (value.includes(",")) {
      commitFromDraftWithDelimiter(value);
      return;
    }
    setDraft(value);
  }

  function handleBlur() {
    if (draft.trim()) {
      commitDraft();
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-[42px] w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-2 text-sm",
        "focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        disabled && "cursor-not-allowed opacity-60"
      )}
      onClick={() => !disabled && inputRef.current?.focus()}
    >
      {tags.map((tag, index) => (
        <span
          key={`${tag}-${index}`}
          className="group inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-sm text-foreground"
        >
          <span className="truncate">{tag}</span>
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={(event) => {
                event.stopPropagation();
                removeTag(index);
              }}
              className="inline-flex shrink-0 rounded-full p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-primary/20 hover:text-foreground group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}

      {!disabled && (
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={tags.length === 0 ? placeholder : ""}
          className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-0.5 outline-none placeholder:text-muted-foreground"
        />
      )}

      {disabled && tags.length === 0 && (
        <span className="px-1 text-muted-foreground">No services configured.</span>
      )}
    </div>
  );
}
