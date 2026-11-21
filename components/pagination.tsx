"use client";

import { Button, Form, Pagination as HeroPagination } from "@heroui/react";
import type { FormEvent } from "react";
import { NumericField } from "./primitives";

export function Pagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (page: number) => void }) {
  if (!total) return null;
  const pages = Math.ceil(total / pageSize);

  function jump(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = Number(new FormData(event.currentTarget).get("page"));
    if (Number.isSafeInteger(target) && target >= 1 && target <= pages) onChange(target);
  }

  return <HeroPagination aria-label="列表分页" className="flex-row flex-wrap items-center justify-between gap-3 tabular-nums">
    <HeroPagination.Summary>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} / {total} 条</HeroPagination.Summary>
    {pages > 1 && <>
      <HeroPagination.Content className="items-center">
        <HeroPagination.Item><HeroPagination.Previous isDisabled={page <= 1} onPress={() => onChange(page - 1)}>上一页</HeroPagination.Previous></HeroPagination.Item>
        <HeroPagination.Item><span className="px-1 text-sm text-muted" aria-current="page">{page} / {pages}</span></HeroPagination.Item>
        <HeroPagination.Item><HeroPagination.Next isDisabled={page >= pages} onPress={() => onChange(page + 1)}>下一页</HeroPagination.Next></HeroPagination.Item>
      </HeroPagination.Content>
      {pages > 7 && <Form onSubmit={jump} className="flex items-center gap-2" aria-label="跳转到指定页">
        <NumericField key={page} name="page" label="跳转页码" hideLabel minValue={1} maxValue={pages} defaultValue={page} inputClassName="w-20 tabular-nums" isRequired />
        <Button type="submit" variant="outline">跳转</Button>
      </Form>}
    </>}
  </HeroPagination>;
}
