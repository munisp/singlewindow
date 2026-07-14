/**
 * AEO Renewal Comments Thread (Item 21)
 * Per-application comment thread for trader ↔ admin communication.
 * Also includes document preview modal (Item 1) and document version history (Item 14).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  MessageSquare, Send, Trash2, FileText, Eye, Clock,
  ChevronDown, ChevronUp, History
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Document Preview Modal (Item 1) ─────────────────────────────────────────
interface DocPreviewModalProps {
  fileUrl: string | null;
  label: string;
  open: boolean;
  onClose: () => void;
}

export function DocPreviewModal({ fileUrl, label, open, onClose }: DocPreviewModalProps) {
  const isImage = fileUrl ? /\.(png|jpe?g|gif|webp|svg)$/i.test(fileUrl) : false;
  const isPdf = fileUrl ? /\.pdf$/i.test(fileUrl) : false;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-amber-500" />
            {label}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-hidden rounded-md border border-border bg-muted/30 min-h-[400px] flex items-center justify-center">
          {!fileUrl ? (
            <p className="text-muted-foreground text-sm">No file uploaded</p>
          ) : isImage ? (
            <img
              src={fileUrl}
              alt={label}
              className="max-w-full max-h-[60vh] object-contain"
            />
          ) : isPdf ? (
            <iframe
              src={fileUrl}
              title={label}
              className="w-full h-[60vh] border-0"
            />
          ) : (
            <div className="text-center space-y-3 p-6">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">Preview not available for this file type</p>
              <Button size="sm" variant="outline" asChild>
                <a href={fileUrl} target="_blank" rel="noopener noreferrer">
                  <Eye className="w-3 h-3 mr-1" /> Open in new tab
                </a>
              </Button>
            </div>
          )}
        </div>
        {fileUrl && (
          <div className="flex justify-end pt-2">
            <Button size="sm" variant="outline" asChild>
              <a href={fileUrl} target="_blank" rel="noopener noreferrer" download>
                Download
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Document Version History (Item 14) ──────────────────────────────────────
interface DocVersionHistoryProps {
  renewalDocId: number;
  docLabel: string;
}

export function DocVersionHistory({ renewalDocId, docLabel }: DocVersionHistoryProps) {
  const [expanded, setExpanded] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { data: versions = [] } = trpc.docVersions.list.useQuery(
    { renewalDocId },
    { enabled: expanded }
  );

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <History className="w-3 h-3" />
        Version history
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="mt-2 space-y-1 pl-4 border-l border-border">
          {versions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No previous versions</p>
          ) : (
            versions.map((v) => (
              <div key={v.id} className="flex items-center gap-2 text-xs">
                <Clock className="w-3 h-3 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {new Date(v.uploadedAt).toLocaleString()}
                </span>
                {v.notes && <span className="text-muted-foreground italic">— {v.notes}</span>}
                <button
                  onClick={() => setPreviewUrl(v.fileUrl)}
                  className="text-amber-500 hover:text-amber-400 underline"
                >
                  Preview
                </button>
              </div>
            ))
          )}
        </div>
      )}
      <DocPreviewModal
        fileUrl={previewUrl}
        label={`${docLabel} — previous version`}
        open={!!previewUrl}
        onClose={() => setPreviewUrl(null)}
      />
    </div>
  );
}

// ─── Comments Thread (Item 21) ────────────────────────────────────────────────
interface CommentsThreadProps {
  renewalId: number;
  renewalRef: string;
}

export function CommentsThread({ renewalId, renewalRef }: CommentsThreadProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const utils = trpc.useUtils();

  const { data: comments = [], isLoading } = trpc.aeoComments.list.useQuery({ renewalId });

  const postMutation = trpc.aeoComments.post.useMutation({
    onSuccess: () => {
      setMessage("");
      utils.aeoComments.list.invalidate({ renewalId });
      toast({ title: "Comment posted" });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = trpc.aeoComments.delete.useMutation({
    onSuccess: () => {
      utils.aeoComments.list.invalidate({ renewalId });
      toast({ title: "Comment deleted" });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handlePost = () => {
    if (!message.trim()) return;
    postMutation.mutate({ renewalId, message: message.trim() });
  };

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-amber-500" />
          Comments — {renewalRef}
          <Badge variant="secondary" className="text-xs">{comments.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ScrollArea className="h-64 pr-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading comments…</p>
          ) : comments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No comments yet. Start the conversation.
            </p>
          ) : (
            <div className="space-y-3">
              {comments.map((c) => (
                <div key={c.id} className="group">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant={c.authorRole === "admin" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {c.authorRole === "admin" ? "Admin" : "Trader"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(c.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap break-words">{c.message}</p>
                    </div>
                    {(c.authorId === user?.id || user?.role === "admin") && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={() => deleteMutation.mutate({ commentId: c.id })}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </Button>
                    )}
                  </div>
                  <Separator className="mt-3" />
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="flex gap-2">
          <Textarea
            placeholder="Write a comment…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="min-h-[60px] resize-none text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handlePost();
            }}
          />
          <Button
            size="icon"
            onClick={handlePost}
            disabled={!message.trim() || postMutation.isPending}
            className="self-end bg-amber-600 hover:bg-amber-700 shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Ctrl+Enter to submit</p>
      </CardContent>
    </Card>
  );
}

// Default page export for lazy-loading via App.tsx route
import { useRoute } from "wouter";
export default function AEORenewalCommentsPage() {
  const [, params] = useRoute("/app/aeo-comments/:renewalId");
  const renewalId = params?.renewalId ? Number(params.renewalId) : 0;
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <CommentsThread renewalId={renewalId} renewalRef={`AEO-${renewalId}`} />
    </div>
  );
}
