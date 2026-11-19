"use client";

import { SearchField, Tabs, Toolbar, Tooltip } from "@heroui/react";
import { useEffect, useState, type ReactNode } from "react";
import { IconButton } from "./primitives";

export function useRecordQuery(pageSize: number) {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => { setSearch(query); setPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), q: search });
  if (filter !== "all") params.set("status", filter);
  return {
    filter, query, search, params, setPage, setQuery,
    setFilter: (value: string) => { setFilter(value); setPage(1); },
  };
}

export function RecordList({ label, searchLabel, filters, filter, query, onFilter, onSearch, children }: {
  label: string;
  searchLabel: string;
  filters: Array<{ id: string; label: string }>;
  filter: string;
  query: string;
  onFilter: (filter: string) => void;
  onSearch: (query: string) => void;
  children: ReactNode;
}) {
  return <Tabs className="min-w-0 gap-5" selectedKey={filter} onSelectionChange={(key) => onFilter(String(key))}>
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <Tabs.ListContainer className="max-w-full min-w-0 overflow-x-auto p-1">
        <Tabs.List aria-label={label} className="w-max flex-nowrap">
          {filters.map((item) => <Tabs.Tab key={item.id} id={item.id} className="whitespace-nowrap">{item.label}<Tabs.Indicator /></Tabs.Tab>)}
        </Tabs.List>
      </Tabs.ListContainer>
      <SearchField aria-label={searchLabel} value={query} onChange={onSearch} className="w-full min-w-44 sm:w-54">
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder={searchLabel} maxLength={200} />
          <Tooltip delay={350}><SearchField.ClearButton aria-label="清空搜索" /><Tooltip.Content>清空搜索</Tooltip.Content></Tooltip>
        </SearchField.Group>
      </SearchField>
    </div>
    <Tabs.Panel id={filter} className="grid min-w-0 gap-4">{children}</Tabs.Panel>
  </Tabs>;
}

export function BulkActions({ count, disabled, onClear, children }: { count: number; disabled?: boolean; onClear: () => void; children: ReactNode }) {
  if (!count) return null;
  return <div className="bulk-position">
    <Toolbar aria-label="批量操作" className="pointer-events-auto max-w-full flex-wrap justify-center gap-1 rounded-3xl bg-overlay p-2 text-overlay-foreground shadow-overlay sm:gap-2 sm:px-3">
      <span role="status" className="mx-2 text-sm font-medium tabular-nums">已选 {count} 项</span>
      {children}
      <IconButton icon="close" label="取消选择" isDisabled={disabled} onPress={onClear} />
    </Toolbar>
  </div>;
}
