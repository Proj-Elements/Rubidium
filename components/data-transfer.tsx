"use client";

import { Button, Card, Form, Separator } from "@heroui/react";
import { DropZone, type DropZoneAreaProps } from "@heroui-pro/react";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/ui";
import type { EncryptedExport } from "@/lib/data-transfer";
import { CardHeading, Confirm, Field, Notice } from "./primitives";

export function DataTransfer() {
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [importPassphrase, setImportPassphrase] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [confirmImport, setConfirmImport] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; kind: "error" | "success" } | null>(null);

  async function exportData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy("export"); setFeedback(null);
    try {
      const envelope = await api<EncryptedExport>("/api/data/export", { method: "POST", body: JSON.stringify({ passphrase: exportPassphrase }) });
      const blob = new Blob([JSON.stringify(envelope)], { type: "application/vnd.rubidium.encrypted+json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `rubidium-${new Date().toISOString().slice(0, 10)}.rubidium`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportPassphrase("");
      setFeedback({ message: "加密数据文件已导出。", kind: "success" });
    } catch (error) { setFeedback({ message: errorMessage(error), kind: "error" }); }
    finally { setBusy(null); }
  }

  function selectFile(files: FileList) {
    setFile(files[0] ?? null);
    setFeedback(null);
  }

  async function dropFile(event: Parameters<NonNullable<DropZoneAreaProps["onDrop"]>>[0]) {
    const item = event.items.find((candidate) => candidate.kind === "file");
    if (item?.getFile) {
      setFile(await item.getFile());
      setFeedback(null);
    }
  }

  async function importData() {
    if (!file || busy) return;
    setConfirmImport(false); setBusy("import"); setFeedback(null);
    try {
      const envelope: unknown = JSON.parse(await file.text());
      await api("/api/data/import", { method: "POST", body: JSON.stringify({ passphrase: importPassphrase, envelope }) });
      setImportPassphrase("");
      setFeedback({ message: "数据已导入，正在刷新工作空间。", kind: "success" });
      window.location.href = new URL("/", window.location.href).href;
    } catch (error) { setFeedback({ message: errorMessage(error), kind: "error" }); }
    finally { setBusy(null); }
  }

  return <Card className="gap-5 p-5 sm:p-6">
    <CardHeading title="数据导入与导出" />
    <div className="grid min-w-0 gap-5 @min-[44rem]:grid-cols-2">
      <Form className="grid min-w-0 content-start gap-4" onSubmit={exportData}>
        <h3 className="text-sm font-semibold">导出</h3>
        <Field label="加密密码" type="password" value={exportPassphrase} onChange={(event) => setExportPassphrase(event.target.value)} minLength={12} maxLength={200} autoComplete="new-password" required />
        <Button type="submit" className="min-h-11 justify-self-start" isPending={busy === "export"} isDisabled={busy !== null}>导出加密文件</Button>
      </Form>
      <Form className="grid min-w-0 content-start gap-4" onSubmit={(event) => { event.preventDefault(); if (file && importPassphrase && !busy) setConfirmImport(true); }}>
        <h3 className="text-sm font-semibold">导入</h3>
        <DropZone className="min-w-0">
          <DropZone.Area onDrop={dropFile}>
            <DropZone.Icon />
            <DropZone.Label>加密数据文件</DropZone.Label>
            <DropZone.Trigger className="min-h-11">选择文件</DropZone.Trigger>
          </DropZone.Area>
          <DropZone.Input aria-label="加密数据文件" accept=".rubidium,application/vnd.rubidium.encrypted+json,application/json" onSelect={selectFile} />
          {file && <DropZone.FileList>
            <DropZone.FileItem>
              <DropZone.FileFormatIcon format="RUB" color="blue" />
              <DropZone.FileInfo>
                <DropZone.FileName>{file.name}</DropZone.FileName>
                <DropZone.FileMeta>{formatFileSize(file.size)}</DropZone.FileMeta>
              </DropZone.FileInfo>
              <DropZone.FileRemoveTrigger aria-label="移除所选文件" className="min-h-11 min-w-11" onPress={() => setFile(null)} />
            </DropZone.FileItem>
          </DropZone.FileList>}
        </DropZone>
        <Field label="解密密码" type="password" value={importPassphrase} onChange={(event) => setImportPassphrase(event.target.value)} maxLength={200} autoComplete="off" required />
        <Button type="submit" variant="outline" className="min-h-11 justify-self-start" isDisabled={!file || !importPassphrase || busy !== null}>导入并替换数据</Button>
      </Form>
    </div>
    <Separator />
    {feedback && <Notice kind={feedback.kind}>{feedback.message}</Notice>}
    {confirmImport && <Confirm title="替换当前数据？" confirmLabel="导入并替换" cancelLabel="取消" onClose={() => setConfirmImport(false)} onConfirm={() => void importData()} busy={busy === "import"}>
      <p>提醒、投递记录、设备和通知配置将被替换。当前密码、活动会话与 API 凭据会保留。</p>
    </Confirm>}
  </Card>;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
