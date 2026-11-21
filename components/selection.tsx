"use client";

import { Checkbox } from "@heroui/react";

export function Selection({ label, text, slot = null, selected, partial, disabled, onChange }: { label?: string; text?: string; slot?: "selection" | null; selected?: boolean; partial?: boolean; disabled?: boolean; onChange?: (value: boolean) => void }) {
  return <Checkbox className="group" variant="secondary" slot={slot} aria-label={label} isSelected={selected} isIndeterminate={partial} isDisabled={disabled} onChange={onChange}>
    <Checkbox.Content className={text ? "min-h-11 gap-2 text-sm text-muted" : "min-h-11 min-w-11 justify-center"}>
      <Checkbox.Control className="rounded-sm border border-muted/75 group-data-selected:border-transparent group-data-indeterminate:border-transparent"><Checkbox.Indicator /></Checkbox.Control>{text}
    </Checkbox.Content>
  </Checkbox>;
}
