"use client";

import { AlertDialog, Button } from "@heroui/react";
import { useEffect, useState } from "react";
import { subscribeUnsavedNavigation, type UnsavedNavigationRequest } from "./use-unsaved";
import { useTranslations } from "./locale-provider";

export function UnsavedNavigationDialog() {
  const { t } = useTranslations();
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
        <AlertDialog.Heading>{t("common.discardPrompt")}</AlertDialog.Heading>
      </AlertDialog.Header>
      <AlertDialog.Body className="text-sm leading-relaxed text-muted">{t("common.leaveWarning")}</AlertDialog.Body>
      <AlertDialog.Footer>
        <Button variant="tertiary" autoFocus onPress={dismiss}>{t("common.continueEditing")}</Button>
        <Button variant="danger-soft" onPress={leave}>{t("common.leavePage")}</Button>
      </AlertDialog.Footer>
    </AlertDialog.Dialog></AlertDialog.Container>
  </AlertDialog.Backdrop>;
}
