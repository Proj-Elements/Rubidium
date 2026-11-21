"use client";

import { Button, Calendar, DateField, DatePicker, Label, TimeField, Tooltip } from "@heroui/react";
import { parseDate, parseDateTime, Time, type DateValue } from "@internationalized/date";
import { localInputValue } from "@/lib/ui";

export function CalendarField({ label, value, onChange, timeZone, dateOnly = false }: { label: string; value: string; onChange: (value: string) => void; timeZone: string; dateOnly?: boolean }) {
  let dateValue: DateValue | null = null;
  try { dateValue = value ? (dateOnly ? parseDate(value) : parseDateTime(value)) : null; }
  catch { dateValue = null; }
  const now = localInputValue(new Date(), timeZone);
  const placeholder = dateOnly ? parseDate(now.slice(0, 10)) : parseDateTime(now);
  return <DatePicker className="workspace-field min-w-0" value={dateValue} placeholderValue={placeholder} onChange={(date) => onChange(date ? date.toString().slice(0, dateOnly ? 10 : 16) : "")} granularity={dateOnly ? "day" : "minute"} hourCycle={24} shouldForceLeadingZeros shouldCloseOnSelect={dateOnly} isRequired>
    {({ state }) => <>
      <Label>{label}</Label>
      <DateField.Group fullWidth variant="secondary" className="schedule-field">
        <DateField.Input className="schedule-segments">{(segment) => <DateField.Segment segment={segment} className={segment.type === "literal" && /[/:]/.test(segment.text) ? "schedule-punctuation" : undefined} />}</DateField.Input>
        <DateField.Suffix>
          <Tooltip delay={350}>
            <DatePicker.Trigger aria-label={`选择${label}`}><DatePicker.TriggerIndicator /></DatePicker.Trigger>
            <Tooltip.Content>{dateOnly ? "选择日期" : "选择日期和时间"}</Tooltip.Content>
          </Tooltip>
        </DateField.Suffix>
      </DateField.Group>
      <DatePicker.Popover className="grid max-w-[calc(100vw-1.5rem)] gap-3">
        <Calendar aria-label={label}>
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
        </Calendar>
        {!dateOnly && <div className="flex items-end justify-between gap-3 px-1">
          <TimeField className="workspace-field" value={state.timeValue} placeholderValue={new Time()} onChange={(time) => { if (time) state.setTimeValue(time); }} hourCycle={24} shouldForceLeadingZeros granularity="minute">
            <Label>时分</Label>
            <TimeField.Group variant="secondary">
              <TimeField.Input className="schedule-segments">{(segment) => <TimeField.Segment segment={segment} className={segment.type === "literal" && /[/:]/.test(segment.text) ? "schedule-punctuation" : undefined} />}</TimeField.Input>
            </TimeField.Group>
          </TimeField>
          <Button type="button" variant="outline" className="max-sm:min-h-11" onPress={() => state.setOpen(false)}>完成</Button>
        </div>}
      </DatePicker.Popover>
    </>}
  </DatePicker>;
}
