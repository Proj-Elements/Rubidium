"use client";

import { Checkbox } from "@heroui/react";

export function Selection({ label, slot, selected, partial, disabled, onChange }: { label: string; slot?: "selection"; selected?: boolean; partial?: boolean; disabled?: boolean; onChange?: (value: boolean) => void }) {
  return <Checkbox slot={slot} aria-label={label} isSelected={selected} isIndeterminate={partial} isDisabled={disabled} onChange={onChange}>
    <Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content>
  </Checkbox>;
}
