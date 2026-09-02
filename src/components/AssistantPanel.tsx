import { Bot, BrainCircuit, Check, CircleStop, GripVertical, LoaderCircle, Plus, Send, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtItem, ChainOfThoughtStep, ChainOfThoughtTrigger } from "@/components/ui/chain-of-thought";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { AgentMessage, AgentPendingAction, AgentStatus, BoardChatSession } from "../agent/types";
import type { NoteSection } from "../types";

type AssistantPanelProps = {
  status: AgentStatus;
  messages: AgentMessage[];
  pendingAction?: AgentPendingAction;
  connection: "idle" | "testing" | "connected" | "error";
  model: string;
  sections: NoteSection[];
  sessions: BoardChatSession[];
  activeSession: BoardChatSession;
  onSessionSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
};

const SUGGESTIONS = ["Summarize this page", "Create a flowchart from these notes", "Add a study checklist"];
const CHAT_PANEL_WIDTH_KEY = "bosketchobs-chat-panel-width-v1";
const CHAT_PANEL_MIN_WIDTH = 320;
const CHAT_PANEL_MAX_WIDTH = 720;

function clampPanelWidth(width: number) {
  const viewportLimit = typeof window === "undefined" ? CHAT_PANEL_MAX_WIDTH : window.innerWidth - 260;
  return Math.round(Math.min(CHAT_PANEL_MAX_WIDTH, Math.max(Math.min(CHAT_PANEL_MIN_WIDTH, viewportLimit), width)));
}

function loadPanelWidth() {
  try {
    const stored = Number(localStorage.getItem(CHAT_PANEL_WIDTH_KEY));
    return Number.isFinite(stored) ? clampPanelWidth(stored) : 420;
  } catch {
    return 420;
  }
}

function messageLabel(message: AgentMessage) { return message.role === "user" ? "You" : message.toolName ? message.toolName.replaceAll("_", " ") : "Assistant"; }
function isReasoningMessage(message: AgentMessage) { return message.role === "tool" || Boolean(message.thinking?.trim()); }
function reasoningLabel(message: AgentMessage) { return message.toolName ? message.toolName.replaceAll("_", " ") : message.thinking?.trim() ? "Planning next step" : "Assistant activity"; }
function reasoningContent(message: AgentMessage) { const content = message.thinking?.trim() || message.content; return content.length > 420 ? `${content.slice(0, 420)}…` : content; }

function inlineMessageContent(content: string) {
  return content.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith("**") && part.endsWith("**") ? <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong> : <span key={`${part}-${index}`}>{part}</span>);
}

function MessageContent({ content }: { content: string }) {
  return <div className="assistant-message-copy text-sm leading-relaxed text-foreground">{content.split("\n").map((line, index) => {
    if (!line.trim()) return <div key={`space-${index}`} className="h-2" />;
    if (line.startsWith("- ")) return <div key={`item-${index}`} className="assistant-list-item"><span aria-hidden="true">•</span><span>{inlineMessageContent(line.slice(2))}</span></div>;
    return <p key={`line-${index}`}>{inlineMessageContent(line)}</p>;
  })}</div>;
}

function ReasoningTrace({ messages, status }: { messages: AgentMessage[]; status: AgentStatus }) {
  const steps = messages.filter(isReasoningMessage);
  if (!steps.length) return null;
  return <Card size="sm" className="assistant-reasoning border-primary/20 bg-primary/5 shadow-none"><CardHeader className="gap-1 px-3 py-3"><CardTitle className="flex items-center gap-2 text-sm"><BrainCircuit data-icon="inline-start" /> Agent activity</CardTitle><CardDescription>Live reasoning and board-tool progress.</CardDescription></CardHeader><CardContent className="px-3 pb-3 pt-0"><ChainOfThought>{steps.map((message, index) => { const active = message.status === "running" || (status === "running" && index === steps.length - 1); return <ChainOfThoughtStep key={`${message.role}-${message.toolName ?? "thinking"}-${index}`} defaultOpen={active}><ChainOfThoughtTrigger leftIcon={active ? <LoaderCircle className="animate-spin" /> : <Check />} swapIconOnHover={!active}>{reasoningLabel(message)}</ChainOfThoughtTrigger><ChainOfThoughtContent><ChainOfThoughtItem className="whitespace-pre-wrap">{reasoningContent(message)}</ChainOfThoughtItem></ChainOfThoughtContent></ChainOfThoughtStep>; })}</ChainOfThought></CardContent></Card>;
}

function MessageCard({ message }: { message: AgentMessage }) {
  return <Card size="sm" className={`assistant-message-card ${message.role === "user" ? "assistant-user-card ml-6" : ""}`}><CardHeader className="gap-2 px-3 pb-1 pt-3"><div className="flex items-center gap-2"><span className={`assistant-message-avatar ${message.role}`} aria-hidden="true">{message.role === "user" ? "Y" : <Bot />}</span><CardDescription className="font-medium uppercase tracking-[0.08em]">{messageLabel(message)}</CardDescription>{message.error ? <Badge variant="destructive" className="ml-auto">Error</Badge> : null}</div></CardHeader><CardContent className="px-3 pb-3 pt-1"><MessageContent content={message.content} />{message.error ? <div className="assistant-error-detail" role="alert"><strong>Connection detail</strong><span>{message.error}</span></div> : null}</CardContent></Card>;
}

export function AssistantPanel({ status, messages, pendingAction, connection, model, sections, sessions, activeSession, onSessionSelect, onNewSession, onSubmit, onCancel, onApprove, onReject, onClose }: AssistantPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [panelWidth, setPanelWidth] = useState(loadPanelWidth);
  const [resizing, setResizing] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const running = status === "running" || status === "waiting";
  const visibleMessages = messages.filter((message) => !isReasoningMessage(message));

  const submit = () => { const value = prompt.trim(); if (!value || running) return; setPrompt(""); onSubmit(value); };
  useEffect(() => { messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" }); }, [messages, status, pendingAction]);
  useEffect(() => {
    try { localStorage.setItem(CHAT_PANEL_WIDTH_KEY, String(panelWidth)); } catch { /* Storage can be unavailable in private webviews. */ }
  }, [panelWidth]);

  const resizePanel = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    setResizing(true);
    const onMove = (moveEvent: MouseEvent) => setPanelWidth(clampPanelWidth(startWidth + startX - moveEvent.clientX));
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 80 : 24;
    if (event.key === "ArrowLeft") { event.preventDefault(); setPanelWidth((width) => clampPanelWidth(width + step)); }
    if (event.key === "ArrowRight") { event.preventDefault(); setPanelWidth((width) => clampPanelWidth(width - step)); }
    if (event.key === "Home") { event.preventDefault(); setPanelWidth(CHAT_PANEL_MIN_WIDTH); }
    if (event.key === "End") { event.preventDefault(); setPanelWidth(CHAT_PANEL_MAX_WIDTH); }
  };

  return <aside className={`assistant-panel ${resizing ? "is-resizing" : ""}`} style={{ width: `${panelWidth}px` }} aria-label="Board assistant">
    <div className="assistant-resize-handle" role="separator" aria-label="Resize board assistant" aria-orientation="vertical" aria-valuemin={CHAT_PANEL_MIN_WIDTH} aria-valuemax={CHAT_PANEL_MAX_WIDTH} aria-valuenow={panelWidth} tabIndex={0} onPointerDown={resizePanel} onKeyDown={handleResizeKeyDown}><GripVertical /></div>
    <div className="assistant-sheet-header"><div className="assistant-header-row"><span className="assistant-icon"><Bot /></span><div className="min-w-0"><h2 className="assistant-title">Bot</h2><p className="assistant-description">Context-aware conversations for every page.</p></div><Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close board assistant"><X /></Button></div>
      <div className="assistant-session-row"><select aria-label="Chat session" value={activeSession.id} onChange={(event) => onSessionSelect(event.target.value)} disabled={running}>{sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}</select><Button variant="outline" size="sm" onClick={onNewSession} disabled={running}><Plus data-icon="inline-start" /> New chat</Button></div>
      <div className="assistant-meta-row"><Badge variant={status === "failed" ? "destructive" : status === "completed" ? "secondary" : "outline"}>{status === "running" ? <><LoaderCircle className="animate-spin" data-icon="inline-start" /> Working</> : status === "waiting" ? "Needs approval" : status === "completed" ? "Completed" : status === "failed" ? "Needs attention" : status === "cancelled" ? "Stopped" : "Ready"}</Badge><span className="assistant-connection"><span className={`assistant-provider-dot ${connection}`} /><span>OpenClaw</span><strong>{connection === "connected" ? "Connected" : connection === "testing" ? "Connecting…" : connection === "error" ? "Offline" : "Not tested"}</strong></span></div>{model ? <div className="assistant-model"><span>Session</span><code>{model}</code></div> : null}
    </div>

    <div ref={messagesRef} className="assistant-messages">{!messages.length ? <Card size="sm" className="assistant-welcome border-primary/20 bg-primary/5 shadow-none"><CardContent className="flex flex-col gap-4 p-4"><div className="assistant-welcome-icon"><Sparkles /></div><div className="flex flex-col gap-1"><CardTitle className="text-base">What are we making?</CardTitle><CardDescription>Ask the board agent to understand your notes or make a precise change to the canvas.</CardDescription></div><div className="assistant-suggestions">{SUGGESTIONS.map((suggestion) => <Button key={suggestion} variant="outline" size="sm" className="justify-start" onClick={() => setPrompt(suggestion)}>{suggestion}</Button>)}</div></CardContent></Card> : null}<ReasoningTrace messages={messages} status={status} />{visibleMessages.map((message, index) => <MessageCard key={`${message.role}-${index}`} message={message} />)}{status === "running" ? <Card size="sm" className="assistant-message-card"><CardContent className="flex items-center gap-3 px-3 py-3"><Skeleton className="size-7 rounded-full" /><div className="flex min-w-0 flex-1 flex-col gap-2"><Skeleton className="h-2.5 w-3/4" /><Skeleton className="h-2.5 w-1/2" /></div><span className="text-xs text-muted-foreground">Generating…</span></CardContent></Card> : null}{pendingAction ? <Card size="sm" className="assistant-approval border-amber-400/40 bg-amber-500/10"><CardHeader className="gap-1 px-3 py-3"><CardTitle className="text-sm">Approval needed</CardTitle><CardDescription>{pendingAction.description}</CardDescription></CardHeader><CardContent className="flex gap-2 px-3 pb-3 pt-0"><Button size="sm" onClick={onApprove}><Check data-icon="inline-start" /> Allow</Button><Button size="sm" variant="outline" onClick={onReject}>Reject</Button></CardContent></Card> : null}</div>

    <div className="assistant-composer"><div className="assistant-composer-inner"><div className="assistant-textarea-wrap"><Textarea ref={textareaRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask anything…" disabled={running} className="min-h-12 resize-none text-sm" /></div></div></div>
  </aside>;
}
