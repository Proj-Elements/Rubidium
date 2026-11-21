"use client";

import { Button, Card, FieldError, Form, Input, Label, TextField } from "@heroui/react";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/ui";
import { Brand } from "./brand";
import { Notice } from "./primitives";
import { ThemeToggle } from "./theme-toggle";
import { TimeZonePicker, useBrowserTimeZone } from "./time-zone-picker";

export function Gate({ onAuthed, setup }: { onAuthed: () => void; setup: boolean }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const browserTimeZone = useBrowserTimeZone();
  const [selectedTimeZone, setSelectedTimeZone] = useState<string | null>(null);
  const timeZone = selectedTimeZone ?? browserTimeZone;
  const mismatch = setup && confirmation.length > 0 && password !== confirmation;

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (setup && password !== confirmation) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/session", { method: "POST", body: JSON.stringify({ mode: setup ? "setup" : "login", password, ...(setup ? { timeZone } : {}) }) });
      setPassword("");
      setConfirmation("");
      onAuthed();
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return <main className="grid min-h-dvh place-items-center px-4 py-8">
    <div className="grid w-full max-w-[25rem] gap-4">
      <header className="flex items-center justify-between gap-4 px-1">
        <Brand />
        <ThemeToggle />
      </header>
      <Card className="gap-5 p-5 sm:p-6">
        <Card.Header>
          <Card.Title render={(props) => <h1 {...props} />} className="text-xl leading-tight font-bold">{setup ? "创建访问密码" : "登录工作空间"}</Card.Title>
        </Card.Header>
        <Card.Content>
          <Form onSubmit={signIn} className="grid gap-4">
            <TextField className="workspace-field" fullWidth name="password" type="password" isRequired isDisabled={busy}>
              <Label>{setup ? "设置访问密码" : "访问密码"}</Label>
              <Input variant="secondary" fullWidth className="h-11" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={setup ? 16 : undefined} maxLength={300} />
            </TextField>
            {setup && <TextField className="workspace-field" fullWidth name="confirmation" type="password" isRequired isDisabled={busy} isInvalid={mismatch}>
              <Label>确认访问密码</Label>
              <Input variant="secondary" fullWidth className="h-11" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} maxLength={300} />
              {mismatch && <FieldError>两次输入的密码不一致</FieldError>}
            </TextField>}
            {setup && <TimeZonePicker value={timeZone} onChange={setSelectedTimeZone} isDisabled={busy} />}
            {error && <Notice>{error}</Notice>}
            <Button fullWidth className="h-11" type="submit" isPending={busy} isDisabled={!password || (setup && (!confirmation || mismatch))}>{setup ? "完成初始化" : "进入工作空间"}</Button>
          </Form>
        </Card.Content>
      </Card>
    </div>
  </main>;
}
