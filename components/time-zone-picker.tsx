"use client";

import { Label, ListBox, SearchField, Select } from "@heroui/react";
import { useMemo, useState, useSyncExternalStore } from "react";

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const subscribe = () => () => undefined;

export function useBrowserTimeZone() {
  return useSyncExternalStore(subscribe, browserTimeZone, () => "UTC");
}

export function TimeZonePicker({ label = "时区", value, onChange, isDisabled = false }: { label?: string; value: string; onChange: (value: string) => void; isDisabled?: boolean }) {
  const [query, setQuery] = useState("");
  const zones = useMemo(() => [...new Set(["UTC", value, ...Intl.supportedValuesOf("timeZone")])].sort(), [value]);
  const filteredZones = zones.filter((zone) => zone.toLowerCase().includes(query.trim().toLowerCase()));
  return <Select className="workspace-field" fullWidth variant="secondary" value={value} isDisabled={isDisabled} onChange={(key) => { if (key !== null) onChange(String(key)); }}>
    <Label>{label}</Label>
    <Select.Trigger className="min-h-11"><Select.Value className="truncate" /><Select.Indicator /></Select.Trigger>
    <Select.Popover className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-2rem)]">
      <div className="grid gap-1">
        <SearchField aria-label="搜索时区" value={query} onChange={setQuery} className="px-2 pt-2">
          <SearchField.Group><SearchField.SearchIcon /><SearchField.Input placeholder="搜索 IANA 时区" /></SearchField.Group>
        </SearchField>
        <ListBox className="max-h-52 overscroll-contain overflow-y-auto" renderEmptyState={() => <p className="p-3 text-sm text-muted">未找到时区</p>}>
          {filteredZones.map((zone) => <ListBox.Item key={zone} id={zone} textValue={zone} className="min-h-[44px]">{zone}<ListBox.ItemIndicator /></ListBox.Item>)}
        </ListBox>
      </div>
    </Select.Popover>
  </Select>;
}
