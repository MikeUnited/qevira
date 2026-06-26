"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ETHIOPIAN_BANKS } from "@/lib/constants/banks";
import { cn } from "@/lib/utils";

type BankSelectProps = {
  id?: string;
  value: string;
  onChange: (bankName: string) => void;
  disabled?: boolean;
  error?: string;
  placeholder?: string;
};

export function BankSelect({
  id,
  value,
  onChange,
  disabled,
  error,
  placeholder = "Search or select bank…",
}: BankSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...ETHIOPIAN_BANKS];
    return ETHIOPIAN_BANKS.filter((name) =>
      name.toLowerCase().includes(q)
    );
  }, [query]);

  return (
    <div className="grid gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "h-10 w-full justify-between font-normal",
              !value && "text-muted-foreground"
            )}
          >
            <span className="truncate">{value || placeholder}</span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
        >
          <div className="border-b p-2">
            <Input
              placeholder="Search banks…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9"
              autoComplete="off"
            />
          </div>
          <div
            className="max-h-[min(280px,50vh)] overflow-y-auto p-1"
            role="listbox"
          >
            {filtered.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                No bank matches.
              </p>
            ) : (
              filtered.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="option"
                  aria-selected={value === name}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                    value === name && "bg-accent"
                  )}
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Check
                    className={cn(
                      "size-4 shrink-0",
                      value === name ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="leading-snug">{name}</span>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
