"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const GROUPED_TIMEZONES = Object.entries(
  Intl.supportedValuesOf("timeZone").reduce<Record<string, string[]>>(
    (groups, tz) => {
      const slash = tz.indexOf("/");
      const region = slash === -1 ? "Other" : tz.slice(0, slash);
      if (!groups[region]) groups[region] = [];
      groups[region].push(tz);
      return groups;
    },
    {},
  ),
);

interface TimezoneComboboxProps {
  readonly name: string;
  readonly defaultValue?: string;
  readonly placeholder?: string;
}

export function TimezoneCombobox({
  name,
  defaultValue = "",
  placeholder = "Select timezone...",
}: TimezoneComboboxProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <input type="hidden" name={name} value={value} />
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {value || placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder="Search timezone..." />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            {GROUPED_TIMEZONES.map(([region, timezones]) => (
              <CommandGroup key={region} heading={region}>
                {timezones.map((tz) => (
                  <CommandItem
                    key={tz}
                    value={tz}
                    onSelect={(current) => {
                      setValue(current === value ? "" : current);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === tz ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {tz}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
