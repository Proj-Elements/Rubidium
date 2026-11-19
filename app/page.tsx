"use client";

import { Alert, Button, Card, Meter, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import Link from "next/link";
import { useState } from "react";
import { AgendaDetails } from "@/components/agenda-details";
import { Glyph } from "@/components/icons";
import { CardHeading, DeliveryBadge, Empty, Loading, Notice, PageHeading } from "@/components/primitives";
import { useTime } from "@/components/use-time";
import { useWorkspace } from "@/components/workspace-context";
import { localDateValue, PRESET_LABELS } from "@/lib/ui";

const weekday = new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", weekday: "short" });

export default function OverviewPage() {
  const { dashboard, error, openTask } = useWorkspace();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const { timeZone, formatTime, clockTime } = useTime();
  const days = dashboard?.upcomingDays ?? [];
  const day = days.find((item) => item.date === selectedDay);
  const date = day?.date ?? null;
  const tasks = new Map(dashboard?.tasks.map((task) => [task.id, task]));
  const next = dashboard?.tasks.filter((task) => task.status === "active" && task.nextRunAt)
    .sort((left, right) => left.nextRunAt!.localeCompare(right.nextRunAt!))[0];
  const upcoming = (dashboard?.upcoming ?? [])
    .filter((item) => !date || localDateValue(new Date(item.occurrenceAt), timeZone) === date)
    .flatMap((item) => {
      const task = tasks.get(item.taskId);
      return task ? [{ ...item, task }] : [];
    });
  const total = day?.total ?? days.reduce((sum, item) => sum + item.total, 0);
  const hidden = Math.max(0, total - Math.min(upcoming.length, 4));
  const activity = dashboard?.activity ?? [];
  const dailyMaximum = Math.max(1, ...activity.map((item) => item.sent));
  const metrics = [
    { label: "进行中的提醒", value: dashboard?.stats.active, icon: "calendar" },
    { label: "今日 Bark 已接收", value: dashboard?.stats.todaySent, icon: "circleCheck" },
    { label: "等待投递", value: dashboard?.deliveries.pending, icon: "send" },
    { label: "自动重试中", value: dashboard?.deliveries.retrying, icon: "refresh" },
  ] as const;

  return <div className="grid gap-6">
    <PageHeading title="日常有序，心里有数" description="查看近期排期与通知状态，把重要的事交给 Barker。" action={
      <Button onPress={() => openTask()}><Glyph name="plus" />新建提醒</Button>
    } />

    {dashboard && !dashboard.deviceKeyConfigured && <Alert status="accent" className="items-start rounded-2xl" role="status">
      <Alert.Indicator />
      <Alert.Content className="gap-2">
        <Alert.Title>连接 Bark 后即可接收提醒</Alert.Title>
        <Alert.Description>未连接默认设备时，对应消息仍会保留在队列中。</Alert.Description>
        <Link className="link workspace-link" href="/settings">配置设备<Glyph name="arrow" size={14} /></Link>
      </Alert.Content>
    </Alert>}

    <section aria-label="提醒指标" className="grid grid-cols-2 items-stretch gap-3 md:grid-cols-4 md:gap-4">
      {metrics.map(({ label, value, icon }) => <Card key={label} className="flex-row items-start justify-between gap-2 rounded-2xl p-4 sm:p-5">
        <div className="min-w-0 space-y-3">
          <p className="text-xs leading-snug text-muted sm:text-sm">{label}</p>
          <p className="text-3xl leading-none font-semibold tracking-tight tabular-nums">{value ?? "—"}</p>
        </div>
        <span className={`icon-well ${icon === "refresh" && value ? "text-warning-soft-foreground" : ""}`}><Glyph name={icon} size={17} /></span>
      </Card>)}
    </section>

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(15rem,0.75fr)_minmax(0,1.65fr)] lg:gap-6">
      <Card className="next-panel min-w-0 gap-4 rounded-2xl p-5 sm:p-6">
        <CardHeading title="下一条提醒" action={<span className="icon-well"><Glyph name="clock" /></span>} />
        {next?.nextRunAt ? <Card.Content className="gap-4">
          <div>
            <time dateTime={next.nextRunAt} className="block text-5xl leading-none font-semibold tracking-tight text-accent tabular-nums">{clockTime(next.nextRunAt)}</time>
            <p className="mt-2 text-sm text-muted tabular-nums">{formatTime(next.nextRunAt, { hour: undefined, minute: undefined })}</p>
          </div>
          <div className="next-task min-w-0 space-y-1">
            <h3 className="line-clamp-2 text-sm font-semibold break-words">{next.name}</h3>
            <p className="line-clamp-2 text-sm leading-relaxed break-words text-muted">{next.description || PRESET_LABELS[next.preset]}</p>
          </div>
          <Button variant="outline" className="self-start" onPress={() => openTask(next)}>查看提醒</Button>
        </Card.Content> : dashboard ? <Card.Content className="gap-1 text-sm text-muted"><p>暂无下一次排期</p><p>启用提醒后，开始时间会显示在这里。</p></Card.Content> : error ? null : <Loading>正在同步</Loading>}
      </Card>

      <Card className="min-w-0 gap-4 rounded-2xl p-5 sm:p-6">
        <CardHeading title="未来七天" description={`按 ${timeZone} 显示`} action={<Link href="/tasks" className="link workspace-link">全部提醒<Glyph name="arrow" size={14} /></Link>} />
        {dashboard ? <Card.Content className="gap-4">
          <div className="-mx-1 overflow-x-auto p-1">
            <ToggleButtonGroup className="week-strip w-max gap-1" aria-label="按日期筛选提醒" selectionMode="single" disallowEmptySelection isDetached selectedKeys={[date ?? "all"]} onSelectionChange={(keys) => {
              const selected = keys.values().next().value;
              setSelectedDay(typeof selected === "string" && selected !== "all" ? selected : null);
            }}>
              <ToggleButton id="all" variant="ghost" className="min-h-16 min-w-13 flex-col gap-1">全部</ToggleButton>
              {days.map((item, index) => <ToggleButton key={item.date} id={item.date} variant="ghost" className="min-h-16 min-w-13 flex-col gap-0.5 tabular-nums" aria-label={`${item.date}，${item.total} 条`}>
                <small className="text-xs opacity-75">{index === 0 ? "今天" : weekday.format(new Date(`${item.date}T12:00:00Z`))}</small>
                <span className="leading-none font-semibold">{Number(item.date.slice(8))}</span>
                <small className="text-xs opacity-75">{item.total} 条</small>
              </ToggleButton>)}
            </ToggleButtonGroup>
          </div>

          {upcoming.length ? <ul className="grid gap-1" aria-label="近期排期">
            {upcoming.slice(0, 4).map(({ task, occurrenceAt }) => <li key={`${task.id}:${occurrenceAt}`}>
              <Button variant="ghost" fullWidth className="upcoming-row h-auto min-h-12 justify-start gap-3 rounded-xl px-2 py-2 text-start" onPress={() => openTask(task)}>
                <span className="flex min-w-13 flex-col items-start gap-0.5 tabular-nums">
                  <time dateTime={occurrenceAt} className="font-semibold">{clockTime(occurrenceAt)}</time>
                  <small className="text-xs text-muted">{localDateValue(new Date(occurrenceAt), timeZone).slice(5).replace("-", "/")}</small>
                </span>
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{task.name}</span><small className="block truncate text-xs text-muted">{PRESET_LABELS[task.preset]}</small></span>
                <Glyph name="chevron" size={14} className="text-muted" />
              </Button>
            </li>)}
          </ul> : <Empty title="没有排期" description={date ? "这一天没有提醒，可以选择其他日期。" : "未来七天暂无已安排的提醒。"} icon="calendar" />}

          {dashboard.forecastTruncated && <Notice kind="info">排期较多，当前仅显示部分预测。</Notice>}
          {(hidden > 0 || dashboard.forecastTruncated) && <p className="forecast-overflow flex flex-wrap items-center justify-between gap-2 text-sm text-muted tabular-nums">
            {hidden > 0 && <span>{date ? "当天" : "七天内"}共 {total} 条，另有 {hidden} 条未展开。</span>}
            <Button variant="outline" onPress={() => setDetails(true)}>查看完整排期</Button>
          </p>}
        </Card.Content> : error ? null : <Loading>正在读取排期</Loading>}
      </Card>
    </div>

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(15rem,0.75fr)_minmax(0,1.65fr)] lg:gap-6">
      <Card className="gap-4 rounded-2xl p-5 sm:p-6">
        <CardHeading title="投递节奏" description="最近七天 Bark 接收数量" />
        {activity.length ? <Card.Content className="gap-2.5">
          {activity.map((item, index) => {
            const label = index === activity.length - 1 ? "今天" : item.date.slice(5).replace("-", "/");
            return <Meter key={item.date} aria-label={`${item.date} Bark 接收数量`} value={item.sent} maxValue={dailyMaximum} valueLabel={`${item.sent} 条`} className="activity-meter items-center gap-3 text-xs tabular-nums" size="sm">
              <span className="text-muted">{label}</span><Meter.Track><Meter.Fill /></Meter.Track><Meter.Output>{item.sent}</Meter.Output>
            </Meter>;
          })}
        </Card.Content> : error ? null : <Loading>正在读取统计</Loading>}
      </Card>

      <Card className="min-w-0 gap-4 rounded-2xl p-5 sm:p-6">
        <CardHeading title="最近投递" action={<Link href="/deliveries" className="link workspace-link">查看记录<Glyph name="arrow" size={14} /></Link>} />
        {dashboard?.recent.length ? <ul className="grid gap-1" aria-label="最近投递记录">
          {dashboard.recent.map((item) => <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5">
            <div className="min-w-0 space-y-1">
              <p className="truncate text-sm font-medium">{item.taskName}</p>
              <time dateTime={item.updatedAt} className="block text-xs text-muted tabular-nums">{formatTime(item.updatedAt)}</time>
            </div>
            <DeliveryBadge item={item} />
          </li>)}
        </ul> : dashboard ? <Empty title="暂无投递记录" description="提醒触发后，最近的投递状态会显示在这里。" /> : error ? null : <Loading>正在读取投递记录</Loading>}
      </Card>
    </div>
    {details && <AgendaDetails date={date} onClose={() => setDetails(false)} />}
  </div>;
}
