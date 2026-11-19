"use client";

import { Button, Card, Form, Input, TextField } from "@heroui/react";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/ui";
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

  return <main className="mx-auto grid min-h-dvh w-full max-w-7xl grid-rows-[auto_1fr] gap-6 px-4 py-6 sm:px-8 lg:py-8">
    <header className="flex items-center justify-between gap-4">
      <div className="brand"><span className="brand-mark"><Glyph name="bell" size={22} /></span><span>barker<span className="brand-period">.</span></span></div>
      <ThemeToggle />
    </header>
    <div className="grid items-center gap-8 pb-12 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
      <aside className="hidden min-h-96 flex-col justify-between gap-8 rounded-3xl bg-surface-secondary p-10 lg:flex xl:p-12">
        <p className="text-sm font-semibold text-accent">私人提醒工作空间</p>
        <div className="space-y-4">
          <p className="text-5xl leading-[1.2] font-bold tracking-tight text-foreground">重要的事，<br />如约而至。</p>
          <p className="text-sm leading-relaxed text-muted">安排你的提醒，追踪每一次 Bark 投递。</p>
        </div>
        <p className="flex items-center gap-2 text-sm text-muted"><Glyph name="shield" size={17} className="text-accent" />私有部署 · 持久队列</p>
      </aside>
      <Card className="mx-auto w-full max-w-md gap-5 rounded-2xl p-5 sm:p-8">
        <Card.Header className="gap-2">
          <Card.Title render={(props) => <h1 {...props} />} className="text-2xl font-bold tracking-tight">欢迎回来</Card.Title>
          <Card.Description className="leading-relaxed">输入 Barker 的访问密码，继续你的安排。</Card.Description>
        </Card.Header>
        <Form onSubmit={signIn} className="grid gap-4">
          <TextField fullWidth name="password" type="password" aria-label="访问密码" isRequired isDisabled={busy}>
            <Input variant="secondary" fullWidth autoComplete="current-password" placeholder="输入访问密码" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={300} />
          </TextField>
          {error && <Notice>{error}</Notice>}
          <Button fullWidth type="submit" isPending={busy} isDisabled={!password}>进入工作空间</Button>
        </Form>
        <Card.Footer><p className="text-xs leading-relaxed text-muted">在服务启动日志中查看密码，或通过 <code className="text-foreground">BARKER_PASSWORD</code> 设置。</p></Card.Footer>
      </Card>
    </div>
  </main>;
}
