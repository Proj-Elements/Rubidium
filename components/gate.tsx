"use client";

import { Button, Card, FieldError, Form, Input, Label, TextField } from "@heroui/react";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/ui";
import { Brand } from "./brand";
import { Notice } from "./primitives";
import { ThemeToggle } from "./theme-toggle";
import { TimeZonePicker, useBrowserTimeZone } from "./time-zone-picker";
import { MIN_PASSWORD_LENGTH, passwordValidationMessage } from "@/lib/password-policy";

export function Gate({ onAuthed, setup, setupEnabled, setupTokenRequired }: { onAuthed: () => void; setup: boolean; setupEnabled: boolean; setupTokenRequired: boolean }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const browserTimeZone = useBrowserTimeZone();
  const [selectedTimeZone, setSelectedTimeZone] = useState<string | null>(null);
  const timeZone = selectedTimeZone ?? browserTimeZone;
  const passwordReason = setup && password ? passwordValidationMessage(password) : null;
  const mismatch = setup && password.length > 0 && password !== confirmation;

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (setup && (!setupEnabled || (setupTokenRequired && !setupToken))) return;
    if (setup && (passwordReason || password !== confirmation)) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/session", { method: "POST", body: JSON.stringify({ mode: setup ? "setup" : "login", password, ...(setup ? { timeZone, ...(setupTokenRequired ? { setupToken } : {}) } : {}) }) });
      setPassword("");
      setConfirmation("");
      setSetupToken("");
      onAuthed();
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return <main className="gate-layout grid min-h-dvh place-items-center px-4 py-8">
    <div className="gate-stack grid w-full max-w-[25rem] gap-4">
      <header className="flex items-center justify-between gap-4 px-1">
        <Brand />
        <ThemeToggle />
      </header>
      <Card className="gate-card gap-5 p-5 sm:p-6">
        <Card.Header>
          <Card.Title render={(props) => <h1 {...props} />} className="text-xl leading-tight font-bold">{setup ? "创建访问密码" : "登录工作空间"}</Card.Title>
        </Card.Header>
        <Card.Content>
          {setup && !setupEnabled ? <Notice>首次初始化未启用。请部署者配置 RUBIDIUM_SETUP_TOKEN，或显式设置 RUBIDIUM_ALLOW_SETUP=1。</Notice> : <Form onSubmit={signIn} className={`gate-form grid gap-4${setup && setupTokenRequired ? " gate-form-with-token" : ""}`}>
            {setup && setupTokenRequired && <TextField className="workspace-field setup-token-field" fullWidth name="setupToken" type="password" isRequired isDisabled={busy}>
              <Label>部署引导令牌</Label>
              <Input variant="secondary" fullWidth className="h-11" autoComplete="off" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} minLength={32} maxLength={300} />
            </TextField>}
            <TextField className={`workspace-field${setup && setupTokenRequired ? " setup-password-field" : ""}`} fullWidth name="password" type="password" isRequired isDisabled={busy} isInvalid={Boolean(passwordReason)}>
              <Label>{setup ? "设置访问密码" : "访问密码"}</Label>
              <Input variant="secondary" fullWidth className="h-11" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={setup ? MIN_PASSWORD_LENGTH : undefined} maxLength={300} />
              {passwordReason && <FieldError>{passwordReason}</FieldError>}
            </TextField>
            {setup && <TextField className={`workspace-field${setupTokenRequired ? " setup-confirmation-field" : ""}`} fullWidth name="confirmation" type="password" isRequired isDisabled={busy} isInvalid={mismatch}>
              <Label>确认访问密码</Label>
              <Input variant="secondary" fullWidth className="h-11" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} maxLength={300} />
              {mismatch && <FieldError>{confirmation ? "两次输入的密码不一致" : "请再次输入密码以确认"}</FieldError>}
            </TextField>}
            {setup && (setupTokenRequired ? <div className="setup-time-zone"><TimeZonePicker value={timeZone} onChange={setSelectedTimeZone} isDisabled={busy} /></div> : <TimeZonePicker value={timeZone} onChange={setSelectedTimeZone} isDisabled={busy} />)}
            {error && <Notice>{error}</Notice>}
            <Button fullWidth className="setup-submit h-11" type="submit" isPending={busy} isDisabled={Boolean(!password || (setup && (!setupEnabled || (setupTokenRequired && !setupToken) || !confirmation || passwordReason || mismatch)))}>{setup ? "完成初始化" : "进入工作空间"}</Button>
          </Form>}
        </Card.Content>
      </Card>
    </div>
  </main>;
}
