"use client";

import { AlertDialog, Button } from "@heroui/react";
import { useEffect, useState } from "react";
import { subscribeUnsavedNavigation, type UnsavedNavigationRequest } from "./use-unsaved";

export function UnsavedNavigationDialog() {
  const [request, setRequest] = useState<UnsavedNavigationRequest | null>(null);

  useEffect(() => subscribeUnsavedNavigation(setRequest), []);

  function dismiss() {
    const current = request;
    setRequest(null);
    current?.cancel();
  }

  function leave() {
    const current = request;
    setRequest(null);
    current?.proceed();
  }

  return <AlertDialog.Backdrop isOpen={Boolean(request)} onOpenChange={(open) => { if (!open) dismiss(); }} isDismissable>
    <AlertDialog.Container size="sm" placement="center"><AlertDialog.Dialog>
      <AlertDialog.Header>
        <AlertDialog.Icon status="warning" />
        <AlertDialog.Heading>放弃尚未保存的修改？</AlertDialog.Heading>
      </AlertDialog.Header>
      <AlertDialog.Body className="text-sm leading-relaxed text-muted">离开后，本次表单修改将不会保留。</AlertDialog.Body>
      <AlertDialog.Footer>
        <Button variant="tertiary" autoFocus onPress={dismiss}>继续编辑</Button>
        <Button variant="danger-soft" onPress={leave}>离开页面</Button>
      </AlertDialog.Footer>
    </AlertDialog.Dialog></AlertDialog.Container>
  </AlertDialog.Backdrop>;
}
