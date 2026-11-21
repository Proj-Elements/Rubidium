"use client";

import { Alert, Button, Card, Meter, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { ItemCard, KPIGroup, ListView } from "@heroui-pro/react";
import { KPI } from "@heroui-pro/react/kpi";
import { useState } from "react";
import { AgendaDetails } from "@/components/agenda-details";
import { Glyph } from "@/components/icons";
import { CardHeading, DeliveryBadge, Empty, Loading, PageHeading, WorkspaceLink } from "@/components/primitives";
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
  const nextDate = next?.nextRunAt ? localDateValue(new Date(next.nextRunAt), timeZone) : null;
  const nextDay = nextDate === days[0]?.date ? "今天" : nextDate === days[1]?.date ? "明天" : null;
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
    { label: "进行中的提醒", value: dashboard?.stats.active },
    { label: "今日已接收", value: dashboard?.stats.todaySent },
    { label: "等待投递", value: dashboard?.deliveries.pending },
    { label: "自动重试中", value: dashboard?.deliveries.retrying },
  ] as const;

  return <div className="overview-page grid gap-6 sm:gap-8">
    <PageHeading title="提醒概览" context={<span className="page-context">显示时区 · {timeZone}</span>} />

    <Card className="overview-next min-w-0 gap-4 p-5 sm:p-6">
      <CardHeading title="下一条提醒" />
      {next?.nextRunAt ? <Card.Content className="overview-next-content grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-6">
        <time dateTime={next.nextRunAt} className="flex min-w-0 flex-col gap-1.5 tabular-nums">
          <span className="text-3xl leading-none font-semibold text-accent">{clockTime(next.nextRunAt)}</span>
          <span className="text-xs text-muted">{nextDay ?? formatTime(next.nextRunAt, { year: nextDate?.slice(0, 4) === days[0]?.date.slice(0, 4) ? undefined : "numeric", hour: undefined, minute: undefined })}</span>
        </time>
        <div className="min-w-0 space-y-1">
          <h3 className="line-clamp-2 font-semibold [overflow-wrap:anywhere]">{next.name}</h3>
          <p className="line-clamp-2 text-sm leading-relaxed text-muted [overflow-wrap:anywhere]">{next.description || PRESET_LABELS[next.preset]}</p>
        </div>
        <Button variant="outline" className="col-start-2 w-fit max-sm:min-h-11 sm:col-start-auto" onPress={() => openTask(next)}>编辑提醒</Button>
      </Card.Content> : dashboard ? <Card.Content className="text-sm text-muted">暂无下一次排期</Card.Content> : error ? null : <Loading>正在同步</Loading>}
    </Card>

    <section className="overview-metrics" aria-label="提醒指标">
      <KPIGroup className="grid grid-cols-2 gap-px bg-separator shadow-none md:grid-cols-4">
        {metrics.map(({ label, value }) => <KPI key={label} className="sm:p-5">
          <KPI.Header><KPI.Title className="text-xs sm:text-sm">{label}</KPI.Title></KPI.Header>
          <KPI.Content>{value === undefined ? <span className="text-2xl text-muted">—</span> : <KPI.Value value={value} maximumFractionDigits={0} className="tabular-nums" />}</KPI.Content>
        </KPI>)}
      </KPIGroup>
    </section>

    {dashboard && !dashboard.deviceKeyConfigured && <Alert status="warning" className="overview-device-warning items-start" role="status">
      <Alert.Indicator />
      <Alert.Content className="gap-2">
        <Alert.Title>默认设备尚未连接</Alert.Title>
        <WorkspaceLink className="workspace-link" href="/settings">连接设备<Glyph name="arrow" size={14} /></WorkspaceLink>
      </Alert.Content>
    </Alert>}

    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.9fr)]">
      <Card role="region" aria-labelledby="upcoming-heading" className="grid min-w-0 gap-4 p-5 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id="upcoming-heading" className="font-semibold">未来七天</h2>
          <WorkspaceLink href="/tasks" className="workspace-link">全部提醒<Glyph name="arrow" size={14} /></WorkspaceLink>
        </header>
        {dashboard ? <div className="@container grid gap-4">
          <ToggleButtonGroup className="grid w-full grid-cols-4 gap-1 @min-[24rem]:grid-cols-8" aria-label="按日期筛选提醒" selectionMode="single" disallowEmptySelection isDetached selectedKeys={[date ?? "all"]} onSelectionChange={(keys) => {
            const selected = keys.values().next().value;
            setSelectedDay(typeof selected === "string" && selected !== "all" ? selected : null);
          }}>
            <ToggleButton id="all" variant="ghost" className="min-h-14 w-full min-w-0 px-1">全部</ToggleButton>
            {days.map((item, index) => <ToggleButton key={item.date} id={item.date} variant="ghost" className="min-h-14 w-full min-w-0 flex-col gap-0.5 px-1 tabular-nums" aria-label={`${item.date}，${item.total} 条`}>
              <small className="text-xs text-muted">{index === 0 ? "今天" : weekday.format(new Date(`${item.date}T12:00:00Z`))}</small>
              <span className="leading-none font-semibold">{Number(item.date.slice(8))}</span>
              <small className="text-xs text-muted">{item.total} 条</small>
            </ToggleButton>)}
          </ToggleButtonGroup>

          {upcoming.length ? <ListView aria-label="近期排期" variant="secondary">
            {upcoming.slice(0, 4).map(({ task, occurrenceAt }) => <ListView.Item id={`${task.id}:${occurrenceAt}`} key={`${task.id}:${occurrenceAt}`} textValue={task.name} onAction={() => openTask(task)} className="upcoming-row min-h-16">
              <ListView.ItemContent className="flex-1 gap-4">
                <span className="flex min-w-13 flex-col items-start gap-0.5 tabular-nums">
                  <time dateTime={occurrenceAt} className="font-semibold">{clockTime(occurrenceAt)}</time>
                  <small className="text-xs text-muted">{localDateValue(new Date(occurrenceAt), timeZone).slice(5).replace("-", "/")}</small>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5"><ListView.Title>{task.name}</ListView.Title><ListView.Description>{PRESET_LABELS[task.preset]}</ListView.Description></span>
                <Glyph name="chevron" size={14} className="text-muted" />
              </ListView.ItemContent>
            </ListView.Item>)}
          </ListView> : <Empty title="没有排期" icon="calendar" />}

          {dashboard.forecastTruncated && <p className="text-xs leading-relaxed text-warning-soft-foreground">排期较多，当前仅显示部分预测。</p>}
          {(hidden > 0 || dashboard.forecastTruncated) && <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted tabular-nums">
            {hidden > 0 && <p>{date ? "当天" : "七天内"}共 {total} 条，另有 {hidden} 条未展开。</p>}
            <Button variant="outline" className="max-sm:min-h-11" onPress={() => setDetails(true)}>查看完整排期</Button>
          </div>}
        </div> : error ? null : <Loading>正在读取排期</Loading>}
      </Card>

      <div className="grid min-w-0 gap-6">
        <Card role="region" aria-labelledby="recent-heading" className="grid min-w-0 gap-4 p-5 sm:p-6">
          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 id="recent-heading" className="font-semibold">最近投递</h2>
            <WorkspaceLink href="/deliveries" className="workspace-link">查看记录<Glyph name="arrow" size={14} /></WorkspaceLink>
          </header>
          {!dashboard ? error ? null : <Loading>正在读取投递记录</Loading> : dashboard.recent.length === 0 ? <Empty title="暂无投递记录" /> : (
            <div className="grid" role="list" aria-label="最近投递记录">
              {dashboard.recent.map((item) => <ItemCard key={item.id} role="listitem" variant="transparent" className="flex-wrap px-0">
                <ItemCard.Content className="min-w-32">
                  <ItemCard.Title>{item.taskName}</ItemCard.Title>
                  <ItemCard.Description><time dateTime={item.updatedAt} className="tabular-nums">{formatTime(item.updatedAt)}</time></ItemCard.Description>
                </ItemCard.Content>
                <ItemCard.Action><DeliveryBadge item={item} /></ItemCard.Action>
              </ItemCard>)}
            </div>
          )}
        </Card>

        <Card role="region" aria-labelledby="activity-heading" className="grid min-w-0 gap-4 p-5 sm:p-6">
          <header className="space-y-1">
            <h2 id="activity-heading" className="font-semibold">投递节奏</h2>
          </header>
          {dashboard && !activity.some((item) => item.sent > 0) ? <Empty title="最近七天暂无投递" icon="send" /> : activity.length ? <div className="grid gap-3">
            {activity.map((item, index) => {
              const label = index === activity.length - 1 ? "今天" : item.date.slice(5).replace("-", "/");
              return <Meter key={item.date} aria-label={`${item.date} Bark 接收数量`} value={item.sent} maxValue={dailyMaximum} valueLabel={`${item.sent} 条`} className="activity-meter items-center gap-3 text-xs tabular-nums" size="sm">
                <span className="text-muted">{label}</span><Meter.Track><Meter.Fill /></Meter.Track><Meter.Output>{item.sent}</Meter.Output>
              </Meter>;
            })}
          </div> : error ? null : <Loading>正在读取统计</Loading>}
        </Card>
      </div>
    </div>
    {details && <AgendaDetails date={date} onClose={() => setDetails(false)} />}
  </div>;
}
