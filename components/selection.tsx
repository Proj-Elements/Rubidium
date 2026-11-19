"use client";

import { Checkbox } from "@heroui/react";

export function Selection({ label, slot, selected, partial, disabled, onChange }: { label?: string; slot?: "selection"; selected?: boolean; partial?: boolean; disabled?: boolean; onChange?: (value: boolean) => void }) {
  return <Checkbox className="group" variant="secondary" slot={slot} aria-label={label} isSelected={selected} isIndeterminate={partial} isDisabled={disabled} onChange={onChange}>
    <Checkbox.Content className="min-h-6 min-w-6 justify-center">
      <Checkbox.Control className="rounded-sm border border-muted/75 group-data-selected:border-transparent group-data-indeterminate:border-transparent"><Checkbox.Indicator /></Checkbox.Control>
    </Checkbox.Content>
  </Checkbox>;
}
