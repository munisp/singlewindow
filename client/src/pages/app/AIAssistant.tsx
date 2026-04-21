/**
 * AI Trade Assistant — full-featured chat with conversation history, quick actions, export
 */
import { useState, useRef, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Brain, FileSearch, AlertTriangle, BookOpen, Send, Download, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";

const SYSTEM_PROMPT = `You are TradeGateway AI, an expert customs and trade compliance assistant for the NGSWTP (Next Generation Single Window Trade Platform). You help traders, customs officers, and OGA officials with:
1. **HS Code Classification** — Identify the correct Harmonized System code for goods
2. **Customs Regulations** — Explain import/export requirements, prohibited goods, trade agreements
3. **Risk Assessment** — Explain risk factors and how to reduce customs risk scores
4. **Document Requirements** — List required documents for specific goods/routes
5. **Trade Agreements** — ECOWAS, AfCFTA, COMESA, bilateral agreements
6. **Duty Calculations** — Explain duty rates, VAT, levies, and exemptions
Always be precise, cite relevant regulations when possible, and flag any compliance concerns.`;

const QUICK_ACTIONS = [
  { icon: <FileSearch className="h-4 w-4" />, label: "HS Code Lookup", prompt: "Help me find the correct HS code for: ", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { icon: <AlertTriangle className="h-4 w-4" />, label: "Risk Explanation", prompt: "Explain what factors could cause a high risk score for my declaration involving: ", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  { icon: <BookOpen className="h-4 w-4" />, label: "Regulation Query", prompt: "What are the customs regulations for importing: ", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  { icon: <Brain className="h-4 w-4" />, label: "Document Checklist", prompt: "What documents do I need to import: ", color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
];

const SUGGESTED_PROMPTS = [
  "What HS code should I use for laptop computers?",
  "What documents are required to import pharmaceuticals into Ghana?",
  "Explain the ECOWAS trade agreement benefits for West African traders",
  "Why might my declaration receive a RED risk lane assignment?",
  "What is the AEO certification process and its benefits?",
  "How do I calculate import duties for electronics from China?",
];

interface Message { role: "user" | "assistant" | "system"; content: string; }

export default function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([{ role: "system", content: SYSTEM_PROMPT }]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const chatMutation = trpc.ai.chat.useMutation({
    onSuccess: (response) => {
      setMessages(prev => [...prev, { role: "assistant", content: response.content }]);
    },
    onError: (err) => toast.error("AI response failed", { description: err.message }),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatMutation.isPending]);

  const sendMessage = (content: string) => {
    if (!content.trim()) return;
    const newMessages: Message[] = [...messages, { role: "user", content }];
    setMessages(newMessages);
    setInput("");
    chatMutation.mutate({ messages: newMessages.filter(m => m.role !== "system").concat([]) });
  };

  const handleSend = () => sendMessage(input);
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } };

  const clearConversation = () => {
    setMessages([{ role: "system", content: SYSTEM_PROMPT }]);
    toast.success("Conversation cleared");
  };

  const exportConversation = () => {
    const text = messages
      .filter(m => m.role !== "system")
      .map(m => `${m.role === "user" ? "You" : "TradeGateway AI"}: ${m.content}`)
      .join("\n\n---\n\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tradegateway-ai-chat-${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Conversation exported");
  };

  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content).then(() => toast.success("Copied to clipboard"));
  };

  const visibleMessages = messages.filter(m => m.role !== "system");

  return (
    <DashboardLayout title="AI Trade Assistant">
      <div className="space-y-5 max-w-4xl">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" />AI Trade Assistant
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Expert customs and trade compliance guidance powered by AI
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1 text-emerald-400 border-emerald-500/20">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />AI Online
            </Badge>
            <Button variant="outline" size="sm" onClick={exportConversation} disabled={visibleMessages.length === 0} className="gap-1.5">
              <Download className="h-4 w-4" />Export
            </Button>
            <Button variant="outline" size="sm" onClick={clearConversation} disabled={visibleMessages.length === 0} className="gap-1.5">
              <Trash2 className="h-4 w-4" />Clear
            </Button>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {QUICK_ACTIONS.map(action => (
            <button
              key={action.label}
              onClick={() => setInput(action.prompt)}
              className={`flex items-center gap-2 p-3 rounded-lg border text-left text-sm font-medium transition-colors hover:opacity-80 ${action.color}`}
            >
              {action.icon}{action.label}
            </button>
          ))}
        </div>

        {/* Chat Area */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="h-4 w-4" />Conversation
              {visibleMessages.length > 0 && <span className="text-muted-foreground font-normal text-sm">({visibleMessages.length} messages)</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-[420px] overflow-y-auto p-4 space-y-4">
              {visibleMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                  <Sparkles className="h-12 w-12 mb-3 opacity-30" />
                  <p className="font-medium">Ask me anything about trade and customs</p>
                  <p className="text-xs mt-1">Try one of the suggested prompts below</p>
                </div>
              ) : (
                visibleMessages.map((msg, i) => (
                  <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                    <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      {msg.role === "user" ? "U" : "AI"}
                    </div>
                    <div className={`max-w-[80%] group relative ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col`}>
                      <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${msg.role === "user" ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted rounded-tl-sm"}`}>
                        {msg.content}
                      </div>
                      <button
                        onClick={() => copyMessage(msg.content)}
                        className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground"
                      >
                        <Copy className="h-3 w-3" />Copy
                      </button>
                    </div>
                  </div>
                ))
              )}
              {chatMutation.isPending && (
                <div className="flex gap-3">
                  <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0 text-xs font-semibold">AI</div>
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2.5">
                    <div className="flex gap-1">
                      <div className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
                      <div className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Suggested prompts (only when empty) */}
            {visibleMessages.length === 0 && (
              <div className="px-4 pb-3 border-t pt-3">
                <p className="text-xs text-muted-foreground mb-2">Suggested questions:</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_PROMPTS.map(p => (
                    <button
                      key={p}
                      onClick={() => sendMessage(p)}
                      className="text-xs px-3 py-1.5 rounded-full border border-border hover:border-primary/50 hover:bg-muted/50 transition-colors text-left"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <div className="p-4 border-t flex gap-2">
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about HS codes, regulations, duties, documents…"
                className="flex-1"
                disabled={chatMutation.isPending}
              />
              <Button onClick={handleSend} disabled={chatMutation.isPending || !input.trim()} size="icon">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
