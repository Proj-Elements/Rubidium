"use client";

import { ItemCard, ItemCardGroup } from "@heroui-pro/react";
import { Button, Card, Chip, Form, Modal, Separator } from "@heroui/react";
import { Fragment, useState, type FormEvent } from "react";
import type { Channel, ChannelType } from "@/lib/types";
import { api, errorMessage } from "@/lib/ui";
import { Confirm, Empty, Field, IconButton, Loading, Notice, Pick } from "./primitives";
import { Glyph } from "./icons";
import { useResource } from "./use-resource";
import { useUnsaved } from "./use-unsaved";
import { useWorkspace } from "./workspace-context";
import { useTranslations } from "./locale-provider";
import type { MessageKey } from "@/lib/i18n";

type ChannelDraft = {
  id?: string;
  revision?: number;
  name: string;
  type: ChannelType;
  endpoint: string;
  topic: string;
  credential: string;
  clearCredential: boolean;
};

const emptyDraft: ChannelDraft = {
  name: "", type: "bark", endpoint: "https://api.day.app", topic: "", credential: "", clearCredential: false,
};

function draftFromChannel(channel: Channel): ChannelDraft {
  return {
    id: channel.id, revision: channel.revision, name: channel.name, type: channel.type,
    endpoint: channel.endpoint, topic: channel.topic, credential: "", clearCredential: false,
  };
}

function channelStatus(channel: Channel): { label: MessageKey; color: "success" | "warning" | "default" } {
  if (channel.credentialConfigured) return { label: "channel.credentialsConfigured", color: "success" };
  return channel.type === "bark" ? { label: "channel.missingKey", color: "warning" } : { label: "channel.noToken", color: "default" };
}

export function ChannelManager({ active, onChanged }: { active: boolean; onChanged: () => Promise<void> }) {
  const { t, locale } = useTranslations();
  const { data, error, refresh } = useResource<{ channels: Channel[] }>("/api/channels", 15_000, active);
  const { notify } = useWorkspace();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [baseline, setBaseline] = useState(emptyDraft);
  const [busy, setBusy] = useState<"save" | "delete" | "test" | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Channel | null>(null);
  const [discardConfirmation, setDiscardConfirmation] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; kind: "error" | "success" } | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const conflict = Boolean(editing && data?.channels.find((channel) => channel.id === editing.id)?.revision !== editing.revision);
  useUnsaved(dialogOpen && dirty);

  function openCreate() {
    setEditing(null);
    setDraft(emptyDraft);
    setBaseline(emptyDraft);
    setFeedback(null);
    setDialogOpen(true);
  }

  function openEdit(channel: Channel) {
    const next = draftFromChannel(channel);
    setEditing(channel);
    setDraft(next);
    setBaseline(next);
    setFeedback(null);
    setDialogOpen(true);
  }

  function finishDialog() {
    setDialogOpen(false);
    setEditing(null);
    setDraft(emptyDraft);
    setBaseline(emptyDraft);
    setFeedback(null);
    setDiscardConfirmation(false);
  }

  function requestClose() {
    if (busy === "save") return;
    if (dirty) setDiscardConfirmation(true);
    else finishDialog();
  }

  function update(field: "name" | "endpoint" | "topic" | "credential", value: string) {
    setDraft((current) => ({ ...current, [field]: value, ...(field === "credential" ? { clearCredential: false } : {}) }));
    setFeedback(null);
  }

  function updateType(value: string) {
    if (value !== "bark" && value !== "ntfy") return;
    setDraft((current) => ({
      ...current, type: value, topic: value === "ntfy" ? current.topic : "",
      credential: current.type === value ? current.credential : "", clearCredential: false,
    }));
    setFeedback(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || conflict || !dirty) return;
    setBusy("save");
    setFeedback(null);
    try {
      await api<{ channel: Channel }>("/api/channels", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(draft),
      });
      finishDialog();
      notify(editing ? t("channel.updated") : t("channel.added"));
      await Promise.all([refresh(), onChanged()]);
    } catch (error) {
      setFeedback({ message: errorMessage(error, locale), kind: "error" });
      void refresh();
    } finally {
      setBusy(null);
    }
  }

  async function testChannel(channel: Channel) {
    setBusy("test");
    setTestingId(channel.id);
    try {
      await api(`/api/channels/${encodeURIComponent(channel.id)}/test`, { method: "POST", body: "{}" });
      notify(t("channel.testSent", { name: channel.name }));
    } catch (error) { notify(errorMessage(error, locale), "error"); }
    finally { setBusy(null); setTestingId(null); }
  }

  async function deleteChannel(channel: Channel) {
    setBusy("delete");
    try {
      await api(`/api/channels?id=${encodeURIComponent(channel.id)}`, {
        method: "DELETE", headers: { "if-match": String(channel.revision) },
      });
      setConfirmation(null);
      notify(t("channel.deleted"));
      await Promise.all([refresh(), onChanged()]);
    } catch (error) { notify(errorMessage(error, locale), "error"); void refresh(); }
    finally { setBusy(null); }
  }

  const keyRequired = draft.type === "bark" && (
    !editing || editing.type !== "bark" || (!editing.isDefault && !editing.credentialConfigured) || draft.endpoint !== editing.endpoint
  );

  return <Card className="grid min-w-0 gap-4 p-4 sm:p-5" aria-labelledby="channel-manager-heading">
    <Card.Header className="flex-row flex-wrap items-center justify-between gap-3">
      <Card.Title render={(props) => <h2 {...props} id="channel-manager-heading" />} className="text-base font-semibold">{t("settings.channels")}</Card.Title>
      <Button className="min-h-11" onPress={openCreate} isDisabled={busy !== null || (data?.channels.length ?? 0) >= 101}>
        <Glyph name="plus" />{t("channel.add")}
      </Button>
    </Card.Header>
    <Card.Content className="grid min-w-0 gap-4">
    {error && <Notice action={<Button variant="ghost" onPress={() => void refresh()}>{t("common.retry")}</Button>}>{error}</Notice>}
    {data ? data.channels.length ? <ItemCardGroup variant="transparent" className="overflow-hidden" role="list" aria-label={t("channel.list")}>
      {data.channels.map((channel, index) => {
        const status = channelStatus(channel);
        return <Fragment key={channel.id}>
          {index > 0 && <Separator />}
          <ItemCard role="listitem" variant="transparent" className="min-w-0 flex-wrap items-center gap-3 px-1 py-2 sm:flex-nowrap">
            <ItemCard.Icon className="size-10 shrink-0 rounded-lg bg-surface-secondary text-muted"><Glyph name="bell" /></ItemCard.Icon>
            <ItemCard.Content className="min-w-0 flex-1">
              <ItemCard.Title className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="[overflow-wrap:anywhere]">{channel.name}</span>
                <Chip size="sm" variant="soft" color="accent"><Chip.Label>{channel.type === "bark" ? "Bark" : "Ntfy"}</Chip.Label></Chip>
                {channel.isDefault && <Chip size="sm" variant="soft" color="accent"><Chip.Label>{t("channel.default")}</Chip.Label></Chip>}
                <Chip size="sm" variant="soft" color={status.color}><Chip.Label>{t(status.label)}</Chip.Label></Chip>
              </ItemCard.Title>
              <ItemCard.Description className="block min-w-0 [overflow-wrap:anywhere]">
                {channel.endpoint}{channel.type === "ntfy" && ` · ${channel.topic}`}
              </ItemCard.Description>
            </ItemCard.Content>
            <ItemCard.Action className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1 sm:w-auto">
              <Button type="button" variant="outline" className="min-h-11" isPending={busy === "test" && testingId === channel.id}
                isDisabled={busy !== null || (channel.type === "bark" && !channel.credentialConfigured)} onPress={() => void testChannel(channel)}>
                <Glyph name="send" />{t("channel.test")}
              </Button>
              <IconButton icon="edit" label={t("taskStatus.editNamed", { name: channel.name })} variant="outline" className="min-h-11 min-w-11" isDisabled={busy !== null} onPress={() => openEdit(channel)} />
              {!channel.isDefault && <IconButton icon="trash" label={t("channel.deleteNamed", { name: channel.name })} variant="danger-soft" className="min-h-11 min-w-11" isDisabled={busy !== null} onPress={() => setConfirmation(channel)} />}
            </ItemCard.Action>
          </ItemCard>
        </Fragment>;
      })}
    </ItemCardGroup> : <Empty title={t("channel.empty")} action={<Button onPress={openCreate}>{t("channel.add")}</Button>} /> : !error && <Loading>{t("channel.loading")}</Loading>}

    <Modal.Backdrop isOpen={dialogOpen} onOpenChange={(open) => { if (!open) requestClose(); }} isDismissable={busy !== "save"} isKeyboardDismissDisabled={busy === "save"}>
      <Modal.Container size="md" placement="auto" scroll="inside">
        <Modal.Dialog className="p-0">
          <Form className="flex min-h-0 flex-col" onSubmit={save}>
            <Modal.Header className="shrink-0 flex-row items-start justify-between gap-3 px-5 pt-5 sm:px-6">
              <Modal.Heading>{editing ? t("channel.edit") : t("channel.add")}</Modal.Heading>
              <Modal.CloseTrigger aria-label={t("channel.closeEditor")} className="static size-11 shrink-0" isDisabled={busy === "save"} />
            </Modal.Header>
            <Modal.Body className="grid min-h-0 content-start gap-4 px-5 py-4 sm:px-6">
              <Field label={t("channel.name")} value={draft.name} onChange={(event) => update("name", event.target.value)} maxLength={80} required disabled={busy === "save"} />
              <Pick label={t("channel.type")} value={draft.type} onChange={updateType} isDisabled={busy === "save"} options={[
                { value: "bark", label: "Bark" }, { value: "ntfy", label: "Ntfy" },
              ]} />
              <Field label={t("channel.endpoint")} value={draft.endpoint} onChange={(event) => update("endpoint", event.target.value)} placeholder={draft.type === "bark" ? "https://api.day.app" : "https://ntfy.sh"} type="url" maxLength={300} required disabled={busy === "save"} />
              {draft.type === "ntfy" && <Field label={t("channel.topic")} value={draft.topic} onChange={(event) => update("topic", event.target.value)} maxLength={64} required disabled={busy === "save"} />}
              <Field label={draft.type === "bark" ? "Device Key" : t("channel.credential")} value={draft.credential} onChange={(event) => update("credential", event.target.value)}
                placeholder={editing?.credentialConfigured ? t("channel.keepCredential") : draft.type === "ntfy" ? t("channel.optional") : undefined}
                type="password" autoComplete="new-password" maxLength={draft.type === "bark" ? 300 : 512} required={keyRequired} disabled={busy === "save"} />
              {editing?.credentialConfigured && <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-muted">{t("channel.savedCredential")}</span>
                <Button type="button" variant="ghost" className="min-h-11" isDisabled={busy === "save" || Boolean(draft.credential.trim())}
                  onPress={() => setDraft((current) => ({ ...current, clearCredential: !current.clearCredential }))}>
                  {draft.clearCredential ? t("channel.undoClear") : t("channel.clearCredential")}
                </Button>
              </div>}
              {draft.clearCredential && <Notice kind="warning">{t("channel.clearWarning")}</Notice>}
              {draft.endpoint.trim().toLowerCase().startsWith("http:") && <Notice kind="warning">{t("channel.httpWarning")}</Notice>}
              {conflict && <Notice kind="warning">{t("channel.conflict")}</Notice>}
              {feedback && <Notice kind={feedback.kind}>{feedback.message}</Notice>}
            </Modal.Body>
            <Modal.Footer className="shrink-0 flex-wrap justify-end gap-2 px-5 pb-5 sm:px-6">
              <Button type="button" variant="ghost" className="min-h-11" isDisabled={busy === "save"} onPress={requestClose}>{t("common.cancel")}</Button>
              <Button type="submit" className="min-h-11" isPending={busy === "save"} isDisabled={!dirty || conflict || busy === "test" || busy === "delete"}>
                {t("channel.save")}
              </Button>
            </Modal.Footer>
          </Form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>

    {confirmation && <Confirm title={t("channel.deleteTitle", { name: confirmation.name })} confirmLabel={t("channel.delete")} onClose={() => setConfirmation(null)} onConfirm={() => void deleteChannel(confirmation)} busy={busy === "delete"}>
      <p>{t("channel.deleteDescription")}</p>
    </Confirm>}
    {discardConfirmation && <Confirm title={t("channel.discardTitle")} confirmLabel={t("common.abandonChanges")} cancelLabel={t("common.continueEditing")} onClose={() => setDiscardConfirmation(false)} onConfirm={finishDialog}>
      <p>{t("channel.discardDescription")}</p>
    </Confirm>}
    </Card.Content>
  </Card>;
}
