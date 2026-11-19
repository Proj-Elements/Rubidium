"use client";

import { Calendar, DateField, DatePicker, Label, Tooltip } from "@heroui/react";
import { parseDate, parseDateTime, type DateValue } from "@internationalized/date";
import { localInputValue } from "@/lib/ui";

export function CalendarField({ label, value, onChange, timeZone, dateOnly = false }: { label: string; value: string; onChange: (value: string) => void; timeZone: string; dateOnly?: boolean }) {
  let dateValue: DateValue | null = null;
  try { dateValue = value ? (dateOnly ? parseDate(value) : parseDateTime(value)) : null; }
  catch { dateValue = null; }
  const now = localInputValue(new Date(), timeZone);
  const placeholder = dateOnly ? parseDate(now.slice(0, 10)) : parseDateTime(now);
  return <DatePicker className="min-w-0" value={dateValue} placeholderValue={placeholder} onChange={(date) => onChange(date ? date.toString().slice(0, dateOnly ? 10 : 16) : "")} granularity={dateOnly ? "day" : "minute"} hourCycle={24} isRequired>
    <Label>{label}</Label>
    <DateField.Group fullWidth variant="secondary" className="tabular-nums">
      <DateField.Input>{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
      <DateField.Suffix>
        <Tooltip delay={350}>
          <DatePicker.Trigger aria-label={`选择${label}`}><DatePicker.TriggerIndicator /></DatePicker.Trigger>
          <Tooltip.Content>打开日历</Tooltip.Content>
        </Tooltip>
      </DateField.Suffix>
    </DateField.Group>
    <DatePicker.Popover><Calendar aria-label={label}>
      <Calendar.Header>
        <Calendar.YearPickerTrigger><Calendar.YearPickerTriggerHeading /><Calendar.YearPickerTriggerIndicator /></Calendar.YearPickerTrigger>
        <Tooltip delay={350}><Calendar.NavButton slot="previous" aria-label="上个月" /><Tooltip.Content>上个月</Tooltip.Content></Tooltip>
        <Tooltip delay={350}><Calendar.NavButton slot="next" aria-label="下个月" /><Tooltip.Content>下个月</Tooltip.Content></Tooltip>
      </Calendar.Header>
      <Calendar.Grid>
        <Calendar.GridHeader>{(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
        <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
      </Calendar.Grid>
      <Calendar.YearPickerGrid><Calendar.YearPickerGridBody>{({ year }) => <Calendar.YearPickerCell year={year} />}</Calendar.YearPickerGridBody></Calendar.YearPickerGrid>
    </Calendar></DatePicker.Popover>
  </DatePicker>;
}
