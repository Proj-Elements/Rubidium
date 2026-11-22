"use client";

import { Button, Form, Pagination as HeroPagination } from "@heroui/react";
import type { FormEvent } from "react";
import { NumericField } from "./primitives";
import { useTranslations } from "./locale-provider";

export function Pagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (page: number) => void }) {
  const { t } = useTranslations();
  if (!total) return null;
  const pages = Math.ceil(total / pageSize);

  function jump(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = Number(new FormData(event.currentTarget).get("page"));
    if (Number.isSafeInteger(target) && target >= 1 && target <= pages) onChange(target);
  }

  return <HeroPagination aria-label={t("records.listPagination")} className="flex-row flex-wrap items-center justify-between gap-3 tabular-nums">
    <HeroPagination.Summary>{t("records.summary", { start: (page - 1) * pageSize + 1, end: Math.min(page * pageSize, total), total })}</HeroPagination.Summary>
    {pages > 1 && <>
      <HeroPagination.Content className="items-center">
        <HeroPagination.Item><HeroPagination.Previous isDisabled={page <= 1} onPress={() => onChange(page - 1)}>{t("records.previous")}</HeroPagination.Previous></HeroPagination.Item>
        <HeroPagination.Item><span className="px-1 text-sm text-muted" aria-current="page">{page} / {pages}</span></HeroPagination.Item>
        <HeroPagination.Item><HeroPagination.Next isDisabled={page >= pages} onPress={() => onChange(page + 1)}>{t("records.next")}</HeroPagination.Next></HeroPagination.Item>
      </HeroPagination.Content>
      {pages > 7 && <Form onSubmit={jump} className="flex items-center gap-2" aria-label={t("records.goToPage")}>
        <NumericField key={page} name="page" label={t("records.pageNumber")} hideLabel minValue={1} maxValue={pages} defaultValue={page} inputClassName="w-20 tabular-nums" isRequired />
        <Button type="submit" variant="outline">{t("records.go")}</Button>
      </Form>}
    </>}
  </HeroPagination>;
}
