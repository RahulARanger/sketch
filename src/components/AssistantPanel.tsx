import { Bot, Check, CircleStop, LoaderCircle, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { AgentMessage, AgentPendingAction, AgentStatus } from "../agent/types";

type AssistantPanelProps = {
  status: AgentStatus;
  messages: AgentMessage[];
  pendingAction?: AgentPendingAction;
  connection: "idle" | "testing" | "connected" | "error";
  model: string;
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
};

function messageLabel(message: AgentMessage) {
  return message.role === "user" ? "You" : message.toolName ? message.toolName.replaceAll("_", " ") : "Agent";
}

export function AssistantPanel({ status, messages, pendingAction, connection, model, onSubmit, onCancel, onApprove, onReject, onClose }: AssistantPanelProps) {
  const [prompt, setPrompt] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const running = status === "running" || status === "waiting";
  const submit = () => { const value = prompt.trim(); if (!value || running) return; setPrompt(""); onSubmit(value); };

  useEffect(() => { messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" }); }, [messages, status, pendingAction]);

  return <Sheet open modal={false} onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent side="right" showCloseButton={false} className="assistant-sheet flex w-[min(420px,calc(100vw-1.5rem))] max-w-none flex-col gap-0 border-border p-0">
      <SheetHeader className="assistant-sheet-header gap-0 border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="assistant-icon"><Bot /></span>
          <div className="min-w-0">
            <SheetTitle className="text-foreground">Board agent</SheetTitle>
            <SheetDescription>Local Ollama assistant for this notebook</SheetDescription>
          </div>
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label="Close board assistant"><CircleStop /></Button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Badge variant={status === "failed" ? "destructive" : status === "completed" ? "secondary" : "outline"}>
            {status === "running" ? <><LoaderCircle className="animate-spin" data-icon="inline-start" /> Working</> : status === "waiting" ? "Needs approval" : status === "completed" ? "Completed" : status === "failed" ? "Needs attention" : status === "cancelled" ? "Stopped" : "Ready"}
          </Badge>
          {status === "running" ? <span className="text-xs text-muted-foreground">Thinking and checking the board…</span> : null}
        </div>
        <div className="assistant-provider"><span className={`assistant-provider-dot ${connection}`} /><span>Ollama</span><strong>{connection === "connected" ? "Connected" : connection === "testing" ? "Connecting…" : connection === "error" ? "Offline" : "Not tested"}</strong>{model ? <code>{model}</code> : null}</div>
      </SheetHeader>

      <div ref={messagesRef} className="assistant-messages flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {!messages.length && status === "idle" ? <Card size="sm" className="my-auto border-dashed bg-transparent shadow-none"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Bot /> Ask about this notebook</CardTitle><CardDescription>Try “summarize this page” or “create a flowchart from these notes”.</CardDescription></CardHeader></Card> : null}
        {messages.map((message, index) => <Card size="sm" key={`${message.role}-${index}`} className={message.role === "user" ? "assistant-user-card ml-5 border-primary/30 bg-primary/10" : message.role === "tool" ? "border-border bg-muted/40" : "border-border bg-card"}>
          <CardHeader className="gap-1 px-3 py-2"><CardDescription className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide"><span>{messageLabel(message)}</span>{message.status && message.status !== "running" ? <Badge variant={message.status === "failed" ? "destructive" : message.status === "rejected" ? "outline" : "secondary"}>{message.status}</Badge> : null}</CardDescription></CardHeader>
          <CardContent className="px-3 pb-3 pt-0"><p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{message.content}</p></CardContent>
        </Card>)}
        {status === "running" ? <Card size="sm" className="border-border bg-card"><CardContent className="flex items-center gap-3 px-3 py-3"><Skeleton className="size-7 rounded-full" /><div className="flex min-w-0 flex-1 flex-col gap-2"><Skeleton className="h-2.5 w-3/4" /><Skeleton className="h-2.5 w-1/2" /></div><span className="text-xs text-muted-foreground">Generating…</span></CardContent></Card> : null}
        {pendingAction ? <Card size="sm" className="border-amber-400/40 bg-amber-500/10"><CardHeader className="gap-1 px-3 py-2"><CardTitle className="text-sm">Approval needed</CardTitle><CardDescription>{pendingAction.description}</CardDescription></CardHeader><CardContent className="flex gap-2 px-3 pb-3 pt-0"><Button size="sm" onClick={onApprove}><Check data-icon="inline-start" /> Allow</Button><Button size="sm" variant="outline" onClick={onReject}>Reject</Button></CardContent></Card> : null}
      </div>

      <Separator />
      <SheetFooter className="assistant-composer flex-row items-end gap-2 p-3">
        <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder="Ask the board agent…" aria-label="Ask the board agent" disabled={running} className="min-h-10 resize-none text-sm" />
        <Button size="icon" onClick={running ? onCancel : submit} aria-label={running ? "Stop agent" : "Send prompt"}>{running ? <CircleStop data-icon="inline-start" /> : <Send data-icon="inline-start" />}</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>;
}
