"use client";

import { Chip, ListBox, SearchField, Tooltip } from "@heroui/react";
import { ActionBar, InlineSelect } from "@heroui-pro/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./primitives";

type RecordFilter = { value: string; label: string };

export function useRecordQuery(pageSize: number, filters: RecordFilter[]) {
  const status = useSearchParams().get("status");
  const filter = filters.find(({ value }) => value === status)?.value ?? "all";
  const [previousFilter, setPreviousFilter] = useState(filter);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  if (previousFilter !== filter) {
    setPreviousFilter(filter);
    setPage(1);
    setSelected([]);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  function changeFilter(value: string) {
    if (value === filter) return;
    const url = new URL(window.location.href);
    if (value === "all") url.searchParams.delete("status");
    else url.searchParams.set("status", value);
    window.history.pushState(null, "", url);
  }

  function changeSearch(value: string, immediate = false) {
    clearTimeout(timer.current);
    setQuery(value);
    setSelected([]);
    const trimmed = value.trim();
    if (trimmed === search) return;
    const applySearch = () => { setSearch(trimmed); setPage(1); setSelected([]); };
    if (!trimmed || immediate) applySearch();
    else timer.current = setTimeout(applySearch, 250);
  }

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), q: search });
  if (filter !== "all") params.set("status", filter);
  return {
    filter, query, search, params, selected, setSelected,
    setPage: (value: number) => { setPage(value); setSelected([]); },
    setQuery: changeSearch,
    setFilter: changeFilter,
    clearFilters: () => { changeSearch("", true); changeFilter("all"); },
  };
}

export function RecordList({ label, searchLabel, filters, filter, query, onFilter, onSearch, children }: {
  label: string;
  searchLabel: string;
  filters: RecordFilter[];
  filter: string;
  query: string;
  onFilter: (filter: string) => void;
  onSearch: (query: string, immediate?: boolean) => void;
  children: ReactNode;
}) {
  const activeFilter = filters.find((item) => item.value === filter && item.value !== "all");
  return <div className="@container/records grid min-w-0 gap-5">
    <div className="record-toolbar workspace-field">
      <SearchField aria-label={searchLabel} variant="secondary" value={query} onChange={onSearch} onSubmit={(value) => onSearch(value, true)} className="min-w-0">
        <SearchField.Group className="h-11">
          <SearchField.SearchIcon />
          <SearchField.Input className="min-w-0 placeholder:text-field-placeholder" placeholder={searchLabel} maxLength={200} autoComplete="off" enterKeyHint="search" />
          <Tooltip delay={350}><SearchField.ClearButton className="me-0 size-11" aria-label="清空搜索" /><Tooltip.Content>清空搜索</Tooltip.Content></Tooltip>
        </SearchField.Group>
      </SearchField>
      <InlineSelect aria-label={label} value={filter} onChange={(key) => { if (key !== null) onFilter(String(key)); }} className="min-w-0">
        <InlineSelect.Trigger className="min-h-11 w-full justify-between"><InlineSelect.Value /><InlineSelect.Indicator /></InlineSelect.Trigger>
        <InlineSelect.Popover className="min-w-40">
          <ListBox>{filters.map(({ value, label: text }) => <ListBox.Item key={value} id={value} textValue={text}>{text}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox>
        </InlineSelect.Popover>
      </InlineSelect>
    </div>
    {activeFilter && <div className="flex min-h-7 items-center gap-2" role="status" aria-label="已应用的筛选">
      <span className="text-xs text-muted">筛选中</span>
      <Chip variant="soft" color="accent"><Chip.Label>{activeFilter.label}</Chip.Label></Chip>
    </div>}
    <div className="grid min-w-0 gap-4">{children}</div>
  </div>;
}

export function BulkActions({ count, disabled, onClear, children }: { count: number; disabled?: boolean; onClear: () => void; children: ReactNode }) {
  return <ActionBar isOpen={count > 0} aria-label="批量操作" className="workspace-actions">
    <ActionBar.Prefix><span role="status" className="whitespace-nowrap text-sm font-medium tabular-nums">已选 {count} 项</span></ActionBar.Prefix>
    <ActionBar.Content>{children}</ActionBar.Content>
    <ActionBar.Suffix><IconButton icon="close" label="取消选择" isDisabled={disabled} onPress={onClear} /></ActionBar.Suffix>
  </ActionBar>;
}
