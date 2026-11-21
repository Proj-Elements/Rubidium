"use client";

import { Button, Card, Form, Input, Label, Separator, TextField } from "@heroui/react";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/ui";
import { Brand } from "./brand";
import { Glyph } from "./icons";
import { Notice } from "./primitives";
import { ThemeToggle } from "./theme-toggle";

export function Gate({ onAuthed }: { onAuthed: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/session", { method: "POST", body: JSON.stringify({ password }) });
      setPassword("");
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
          <Card.Title render={(props) => <h1 {...props} />} className="text-xl leading-tight font-bold">登录工作空间</Card.Title>
        </Card.Header>
        <Card.Content>
          <Form onSubmit={signIn} className="grid gap-4">
            <TextField className="workspace-field" fullWidth name="password" type="password" isRequired isDisabled={busy}>
              <Label>访问密码</Label>
              <Input variant="secondary" fullWidth className="h-11" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={300} />
            </TextField>
            {error && <Notice>{error}</Notice>}
            <Button fullWidth className="h-11" type="submit" isPending={busy} isDisabled={!password}>进入工作空间</Button>
          </Form>
        </Card.Content>
        <Separator />
        <Card.Footer className="items-start gap-2 text-xs leading-relaxed text-muted">
          <Glyph name="lock" size={15} className="mt-0.5 shrink-0" />
          <p>密码见服务启动日志，也可通过 <code className="text-foreground">BARKER_PASSWORD</code> 设置。</p>
        </Card.Footer>
      </Card>
    </div>
  </main>;
}
