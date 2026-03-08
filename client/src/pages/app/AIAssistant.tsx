/**
 * AI Trade Assistant — TradeGateway NGSWTP
 * Full-featured chat interface powered by the built-in LLM (Forge API).
 * Supports: trade queries, HS code lookup, risk explanation, manifest extraction.
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Brain, FileSearch, AlertTriangle, BookOpen } from "lucide-react";

const SYSTEM_PROMPT = `You are TradeGateway AI, an expert customs and trade compliance assistant for the NGSWTP (Next Generation Single Window Trade Platform). You help traders, customs officers, and OGA officials with:

1. **HS Code Classification** — Identify the correct Harmonized System code for goods
2. **Customs Regulations** — Explain import/export requirements, prohibited goods, trade agreements
3. **Risk Assessment** — Explain risk factors and how to reduce customs risk scores
4. **Document Requirements** — List required documents for specific goods/routes
5. **Trade Agreements** — ECOWAS, AfCFTA, COMESA, bilateral agreements
6. **Duty Calculations** — Explain duty rates, VAT, levies, and exemptions

Always be precise, cite relevant regulations when possible, and flag any compliance concerns.`;

const SUGGESTED_PROMPTS = [
  "What HS code should I use for laptop computers?",
  "What documents are required to import pharmaceuticals into Ghana?",
  "Explain the ECOWAS trade agreement benefits for West African traders",
  "Why might my declaration receive a RED risk lane assignment?",
  "What is the AEO certification process and its benefits?",
  "How do I calculate import duties for electronics from China?",
];

const QUICK_ACTIONS = [
  {
    icon: <FileSearch className="h-4 w-4" />,
    label: "HS Code Lookup",
    prompt: "Help me find the correct HS code for: ",
    color: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  {
    icon: <AlertTriangle className="h-4 w-4" />,
    label: "Risk Explanation",
    prompt: "Explain what factors could cause a high risk score for my declaration involving: ",
    color: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
  {
    icon: <BookOpen className="h-4 w-4" />,
    label: "Regulation Query",
    prompt: "What are the customs regulations for importing: ",
    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
  {
    icon: <Brain className="h-4 w-4" />,
    label: "Document Checklist",
    prompt: "What documents do I need to import: ",
    color: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  },
];

export default function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "system", content: SYSTEM_PROMPT },
  ]);

  const chatMutation = trpc.ai.chat.useMutation({
    onSuccess: (response) => {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: response.content,
      }]);
    },
    onError: (err) => {
      toast.error("AI response failed", { description: err.message });
    },
  });

  const handleSendMessage = (content: string) => {
    const newMessages: Message[] = [...messages, { role: "user", content }];
    setMessages(newMessages);
    chatMutation.mutate({
      messages: newMessages.filter(m => m.role !== "system"),
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.3,
    });
  };

  const handleQuickAction = (prompt: string) => {
    handleSendMessage(prompt);
  };

  const visibleMessages = messages.filter(m => m.role !== "system");

  return (
    <DashboardLayout title="AI Trade Assistant">
      <div className="space-y-4 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" />
              AI Trade Assistant
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Expert guidance on customs regulations, HS codes, and trade compliance
            </p>
          </div>
          <Badge variant="outline" className="gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Forge AI Active
          </Badge>
        </div>

        {/* Quick Actions */}
        {visibleMessages.length === 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {QUICK_ACTIONS.map((action) => (
              <Card
                key={action.label}
                className={`cursor-pointer hover:shadow-md transition-all border ${action.color}`}
                onClick={() => handleQuickAction(action.prompt)}
              >
                <CardContent className="p-4 flex flex-col gap-2">
                  {action.icon}
                  <span className="text-sm font-medium">{action.label}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Chat Box */}
        <AIChatBox
          messages={visibleMessages}
          onSendMessage={handleSendMessage}
          isLoading={chatMutation.isPending}
          placeholder="Ask about HS codes, customs regulations, trade agreements..."
          height={500}
          emptyStateMessage="Ask me anything about customs, trade compliance, or HS code classification."
          suggestedPrompts={SUGGESTED_PROMPTS}
        />

        {/* Model info */}
        <p className="text-xs text-muted-foreground text-center">
          Powered by TradeGateway Forge AI · Responses are informational only — always verify with official customs authorities.
        </p>
      </div>
    </DashboardLayout>
  );
}
