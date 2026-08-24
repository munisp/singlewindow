import { z } from "zod";

export const WAF_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const WAF_ATTACK_TYPES = [
  "SQL_INJECTION",
  "XSS",
  "PATH_TRAVERSAL",
  "COMMAND_INJECTION",
  "CSRF",
  "BROKEN_AUTH",
  "SENSITIVE_DATA_EXPOSURE",
  "RATE_LIMIT_EXCEEDED",
  "BOT_DETECTED",
  "MALFORMED_REQUEST",
] as const;

export const wafEventSchema = z.object({
  event_id: z.string().min(1).optional(),
  eventId: z.string().min(1).optional(),
  severity: z.enum(WAF_SEVERITIES),
  attack_type: z.enum(WAF_ATTACK_TYPES).optional(),
  attackType: z.enum(WAF_ATTACK_TYPES).optional(),
  source_ip: z.string().optional(),
  target_path: z.string().optional(),
  http_method: z.string().optional(),
  request_headers: z.record(z.string(), z.unknown()).optional(),
  request_body: z.string().optional(),
  action: z.string().optional(),
  confidence: z.number().finite().optional(),
  waap_version: z.string().optional(),
}).passthrough().refine(
  (event) => Boolean(event.event_id ?? event.eventId) && Boolean(event.attack_type ?? event.attackType),
  "event_id and attack_type are required"
);

export type WafEvent = z.infer<typeof wafEventSchema>;
