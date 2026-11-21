"use client";

import { Button, Card, Form, Modal } from "@heroui/react";
import { DropZone, type DropZoneAreaProps } from "@heroui-pro/react";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/ui";
import type { EncryptedExport } from "@/lib/data-transfer";
import { CardHeading, Field, Notice } from "./primitives";

export function DataTransfer() {
  const [dialog, setDialog] = useState<"export" | "import" | null>(null);
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [importPassphrase, setImportPassphrase] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [confirmImport, setConfirmImport] = useState(false);
  const [filePickerKey, setFilePickerKey] = useState(0);
  const [feedback, setFeedback] = useState<{ message: string; kind: "error" | "success" } | null>(null);

  function openDialog(next: "export" | "import") {
    setFeedback(null);
    setDialog(next);
  }

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setExportPassphrase("");
    setImportPassphrase("");
    setFile(null);
    setConfirmImport(false);
    setFeedback(null);
    setFilePickerKey((key) => key + 1);
  }

  async function exportData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || dialog !== "export") return;
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
    if (!file || busy || dialog !== "import") return;
    if (!confirmImport) {
      setConfirmImport(true);
      setFeedback(null);
      return;
    }
    setBusy("import"); setFeedback(null);
    try {
      const envelope: unknown = JSON.parse(await file.text());
      await api("/api/data/import", { method: "POST", body: JSON.stringify({ passphrase: importPassphrase, envelope }) });
      setImportPassphrase(""); setFile(null); setDialog(null);
      window.location.href = new URL("/", window.location.href).href;
    } catch (error) { setConfirmImport(false); setFeedback({ message: errorMessage(error), kind: "error" }); }
    finally { setBusy(null); }
  }

  return <>
    <Card className="gap-5 p-5 sm:p-6">
      <CardHeading title="数据导入与导出" action={<div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-11" onPress={() => openDialog("export")}>导出数据</Button>
        <Button type="button" className="min-h-11" onPress={() => openDialog("import")}>导入数据</Button>
      </div>} />
    </Card>

    <Modal.Backdrop isOpen={dialog !== null} onOpenChange={(open) => { if (!open) closeDialog(); }} isDismissable={!busy} isKeyboardDismissDisabled={Boolean(busy)}>
      <Modal.Container size="sm" placement="center" scroll="inside">
        <Modal.Dialog className="data-transfer-dialog">
          <Form className="flex min-h-0 flex-col" onSubmit={dialog === "export" ? exportData : (event) => { event.preventDefault(); void importData(); }}>
            <Modal.Header className="flex-row items-start justify-between gap-3">
              <Modal.Heading>{dialog === "export" ? "导出加密数据" : confirmImport ? "确认替换数据" : "导入加密数据"}</Modal.Heading>
              {!busy && <Modal.CloseTrigger aria-label={dialog === "export" ? "关闭数据导出" : "关闭数据导入"} className="static shrink-0 max-sm:size-11" />}
            </Modal.Header>
            <Modal.Body className="data-transfer-body grid min-h-0 content-start gap-4">
              {feedback && <Notice kind={feedback.kind}>{feedback.message}</Notice>}
              {dialog === "export" && <Field label="加密密码" type="password" value={exportPassphrase} onChange={(event) => setExportPassphrase(event.target.value)} minLength={12} maxLength={200} autoComplete="new-password" required />}
              {dialog === "import" && (confirmImport ? <Notice kind="warning">提醒、投递记录、设备和通知配置将被替换。当前密码、活动会话与 API 凭据会保留。</Notice> : <>
                <DropZone key={filePickerKey} className="min-w-0">
                  {!file && <DropZone.Area className="min-h-14 flex-row justify-between gap-3 px-3 py-1 text-start" onDrop={dropFile}>
                    <DropZone.Label className="flex-1 text-start">加密数据文件</DropZone.Label>
                    <DropZone.Trigger className="min-h-11">选择文件</DropZone.Trigger>
                  </DropZone.Area>}
                  <DropZone.Input aria-label="加密数据文件" accept=".rubidium,application/vnd.rubidium.encrypted+json,application/json" onSelect={selectFile} />
                  {file && <DropZone.FileList>
                    <DropZone.FileItem className="items-center py-1">
                      <DropZone.FileFormatIcon format="RUB" color="blue" />
                      <DropZone.FileInfo>
                        <DropZone.FileName>{file.name}</DropZone.FileName>
                        <DropZone.FileMeta>{formatFileSize(file.size)}</DropZone.FileMeta>
                      </DropZone.FileInfo>
                      <DropZone.Trigger className="min-h-11">更换</DropZone.Trigger>
                      <DropZone.FileRemoveTrigger aria-label="移除所选文件" className="min-h-11 min-w-11" onPress={() => setFile(null)} />
                    </DropZone.FileItem>
                  </DropZone.FileList>}
                </DropZone>
                <Field label="解密密码" type="password" value={importPassphrase} onChange={(event) => setImportPassphrase(event.target.value)} maxLength={200} autoComplete="off" required />
              </>)}
            </Modal.Body>
            <Modal.Footer className="flex-wrap">
              {dialog === "import" && confirmImport
                ? <>
                  <Button type="button" variant="ghost" className="min-h-11" isDisabled={Boolean(busy)} onPress={() => { setConfirmImport(false); setFeedback(null); }}>返回</Button>
                  <Button type="submit" variant="danger-soft" className="min-h-11" isPending={busy === "import"} isDisabled={Boolean(busy)}>导入并替换数据</Button>
                </>
                : <>
                  <Button type="button" variant="ghost" className="min-h-11" isDisabled={Boolean(busy)} onPress={closeDialog}>取消</Button>
                  {dialog === "export"
                    ? <Button type="submit" className="min-h-11" isPending={busy === "export"} isDisabled={Boolean(busy)}>导出加密文件</Button>
                    : <Button type="submit" variant="outline" className="min-h-11" isDisabled={!file || !importPassphrase || Boolean(busy)}>继续导入</Button>}
                </>}
            </Modal.Footer>
          </Form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </>;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
