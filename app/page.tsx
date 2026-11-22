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
import { localDateValue } from "@/lib/ui";
import { presetMessageKeys, localeTags } from "@/lib/i18n";
import { useLocale, useTranslations } from "@/components/locale-provider";

export default function OverviewPage() {
  const { t } = useTranslations();
  const locale = useLocale();
  const weekday = new Intl.DateTimeFormat(localeTags[locale], { timeZone: "UTC", weekday: "short" });
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
  const nextDay = nextDate === days[0]?.date ? t("overview.today") : nextDate === days[1]?.date ? t("overview.tomorrow") : null;
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
    { label: "overview.activeReminders", value: dashboard?.stats.active },
    { label: "overview.deliveredToday", value: dashboard?.stats.todaySent },
    { label: "overview.pendingDeliveries", value: dashboard?.deliveries.pending },
    { label: "overview.retrying", value: dashboard?.deliveries.retrying },
  ] as const;

  return <div className="overview-page grid gap-6 sm:gap-8">
    <PageHeading title={t("page.overview")} context={<span className="page-context">{t("overview.timeZone", { zone: timeZone })}</span>} />

    <Card className="overview-next min-w-0 gap-4 p-5 sm:p-6">
      <CardHeading title={t("overview.nextReminder")} />
      {next?.nextRunAt ? <Card.Content className="overview-next-content grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-6">
        <time dateTime={next.nextRunAt} className="flex min-w-0 flex-col gap-1.5 tabular-nums">
          <span className="text-3xl leading-none font-semibold text-accent">{clockTime(next.nextRunAt)}</span>
          <span className="text-xs text-muted">{nextDay ?? formatTime(next.nextRunAt, { year: nextDate?.slice(0, 4) === days[0]?.date.slice(0, 4) ? undefined : "numeric", hour: undefined, minute: undefined })}</span>
        </time>
        <div className="min-w-0 space-y-1">
          <h3 className="line-clamp-2 font-semibold [overflow-wrap:anywhere]">{next.name}</h3>
          <p className="line-clamp-2 text-sm leading-relaxed text-muted [overflow-wrap:anywhere]">{next.description || t(presetMessageKeys[next.preset])}</p>
        </div>
        <Button variant="outline" className="col-start-2 w-fit max-sm:min-h-11 sm:col-start-auto" onPress={() => openTask(next)}>{t("overview.editReminder")}</Button>
      </Card.Content> : dashboard ? <Card.Content className="text-sm text-muted">{t("overview.noNextReminder")}</Card.Content> : error ? null : <Loading>{t("common.syncing")}</Loading>}
    </Card>

    <section className="overview-metrics" aria-label={t("overview.metricLabel")}>
      <KPIGroup className="grid grid-cols-2 gap-px bg-separator shadow-none md:grid-cols-4">
        {metrics.map(({ label, value }) => <KPI key={label} className="sm:p-5">
          <KPI.Header><KPI.Title className="text-xs sm:text-sm">{t(label)}</KPI.Title></KPI.Header>
          <KPI.Content>{value === undefined ? <span className="text-2xl text-muted">—</span> : <KPI.Value value={value} maximumFractionDigits={0} className="tabular-nums" />}</KPI.Content>
        </KPI>)}
      </KPIGroup>
    </section>

    {dashboard?.defaultChannel.type === "bark" && !dashboard.defaultChannel.credentialConfigured && <Alert status="warning" className="overview-device-warning items-start" role="status">
      <Alert.Indicator />
      <Alert.Content className="gap-2">
        <Alert.Title>{t("overview.defaultBarkMissing")}</Alert.Title>
        <WorkspaceLink className="workspace-link" href="/settings">{t("overview.openChannels")}<Glyph name="arrow" size={14} /></WorkspaceLink>
      </Alert.Content>
    </Alert>}

    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.9fr)]">
      <Card role="region" aria-labelledby="upcoming-heading" className="grid min-w-0 gap-4 p-5 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id="upcoming-heading" className="font-semibold">{t("overview.nextSevenDays")}</h2>
          <WorkspaceLink href="/tasks" className="workspace-link">{t("overview.allReminders")}<Glyph name="arrow" size={14} /></WorkspaceLink>
        </header>
        {dashboard ? <div className="@container grid gap-4">
          <ToggleButtonGroup className="grid w-full grid-cols-4 gap-1 @min-[24rem]:grid-cols-8" aria-label={t("overview.filterByDate")} selectionMode="single" disallowEmptySelection isDetached selectedKeys={[date ?? "all"]} onSelectionChange={(keys) => {
            const selected = keys.values().next().value;
            setSelectedDay(typeof selected === "string" && selected !== "all" ? selected : null);
          }}>
            <ToggleButton id="all" variant="ghost" className="min-h-14 w-full min-w-0 px-1">{t("overview.allDays")}</ToggleButton>
            {days.map((item, index) => <ToggleButton key={item.date} id={item.date} variant="ghost" className="min-h-14 w-full min-w-0 flex-col gap-0.5 px-1 tabular-nums" aria-label={t("overview.dateSummary", { date: item.date, count: item.total })}>
              <small className="text-xs text-muted">{index === 0 ? t("overview.today") : weekday.format(new Date(`${item.date}T12:00:00Z`))}</small>
              <span className="leading-none font-semibold">{Number(item.date.slice(8))}</span>
              <small className="text-xs text-muted">{t("overview.totalForDay", { count: item.total })}</small>
            </ToggleButton>)}
          </ToggleButtonGroup>

          {upcoming.length ? <ListView aria-label={t("reminder.upcoming")} variant="secondary">
            {upcoming.slice(0, 4).map(({ task, occurrenceAt }) => <ListView.Item id={`${task.id}:${occurrenceAt}`} key={`${task.id}:${occurrenceAt}`} textValue={task.name} onAction={() => openTask(task)} className="upcoming-row min-h-16">
              <ListView.ItemContent className="flex-1 gap-4">
                <span className="flex min-w-13 flex-col items-start gap-0.5 tabular-nums">
                  <time dateTime={occurrenceAt} className="font-semibold">{clockTime(occurrenceAt)}</time>
                  <small className="text-xs text-muted">{localDateValue(new Date(occurrenceAt), timeZone).slice(5).replace("-", "/")}</small>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5"><ListView.Title>{task.name}</ListView.Title><ListView.Description>{t(presetMessageKeys[task.preset])}</ListView.Description></span>
                <Glyph name="chevron" size={14} className="text-muted" />
              </ListView.ItemContent>
            </ListView.Item>)}
          </ListView> : <Empty title={t("overview.noSchedule")} icon="calendar" />}

          {dashboard.forecastTruncated && <p className="text-xs leading-relaxed text-warning-soft-foreground">{t("overview.forecastTruncated")}</p>}
          {(hidden > 0 || dashboard.forecastTruncated) && <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted tabular-nums">
            {hidden > 0 && <p>{date ? t("overview.dayTotal", { count: total, hidden }) : t("overview.sevenDayTotal", { count: total, hidden })}</p>}
            <Button variant="outline" className="max-sm:min-h-11" onPress={() => setDetails(true)}>{t("overview.viewFullSchedule")}</Button>
          </div>}
        </div> : error ? null : <Loading>{t("common.loadingSchedule")}</Loading>}
      </Card>

      <div className="grid min-w-0 gap-6">
        <Card role="region" aria-labelledby="recent-heading" className="grid min-w-0 gap-4 p-5 sm:p-6">
          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 id="recent-heading" className="font-semibold">{t("overview.recentDeliveries")}</h2>
            <WorkspaceLink href="/deliveries" className="workspace-link">{t("overview.viewHistory")}<Glyph name="arrow" size={14} /></WorkspaceLink>
          </header>
          {!dashboard ? error ? null : <Loading>{t("common.loadingDeliveries")}</Loading> : dashboard.recent.length === 0 ? <Empty title={t("overview.noRecentDeliveries")} /> : (
            <div className="grid" role="list" aria-label={t("overview.recentList")}>
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
            <h2 id="activity-heading" className="font-semibold">{t("overview.deliveryActivity")}</h2>
          </header>
          {dashboard && !activity.some((item) => item.sent > 0) ? <Empty title={t("overview.noRecentActivity")} icon="send" /> : activity.length ? <div className="grid gap-3">
            {activity.map((item, index) => {
              const label = index === activity.length - 1 ? t("overview.today") : item.date.slice(5).replace("-", "/");
              return <Meter key={item.date} aria-label={t("overview.deliveriesOnDate", { date: item.date })} value={item.sent} maxValue={dailyMaximum} valueLabel={t("overview.totalForDay", { count: item.sent })} className="activity-meter items-center gap-3 text-xs tabular-nums" size="sm">
                <span className="text-muted">{label}</span><Meter.Track><Meter.Fill /></Meter.Track><Meter.Output>{item.sent}</Meter.Output>
              </Meter>;
            })}
          </div> : error ? null : <Loading>{t("common.loadingStats")}</Loading>}
        </Card>
      </div>
    </div>
    {details && <AgendaDetails date={date} onClose={() => setDetails(false)} />}
  </div>;
}
