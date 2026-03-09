/**
 * ai.ts — tRPC router for AI/LLM operations
 *
 * Routes all AI inference through the local Ollama proxy service.
 * Falls back to the built-in Forge LLM when Ollama is unavailable.
 *
 * Procedures:
 *   ai.chat            — General-purpose chat with model selection (Qwen3, DeepSeek-R1)
 *   ai.scoreRisk       — Risk score a declaration using local LLM
 *   ai.classifyHS      — Classify goods description to HS code using LLM
 *   ai.explainRisk     — Generate human-readable risk explanation
 *   ai.extractManifest — Extract structured data from free-text manifest
 *   ai.models          — List available Ollama models
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";

const OLLAMA_PROXY_URL = process.env.OLLAMA_PROXY_URL || "http://localhost:8090";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

// ─── Ollama client helpers ─────────────────────────────────────────────────

async function ollamaChat(
  model: string,
  messages: Array<{ role: string; content: string }>,
  options?: { temperature?: number; stream?: boolean }
): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.1,
        num_ctx: 8192,
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as { message?: { content?: string } };
  return data.message?.content ?? "";
}

async function ollamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function listOllamaModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { models?: Array<{ name: string }> };
    return (data.models ?? []).map(m => m.name);
  } catch {
    return [];
  }
}

// ─── Fallback to built-in Forge LLM ───────────────────────────────────────

async function llmWithFallback(
  ollamaModel: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options?: { temperature?: number }
): Promise<{ content: string; model: string; source: "ollama" | "forge" }> {
  const available = await ollamaAvailable();

  if (available) {
    try {
      const content = await ollamaChat(ollamaModel, messages, options);
      return { content, model: ollamaModel, source: "ollama" };
    } catch (e) {
      console.warn(`[AI] Ollama failed, falling back to Forge: ${e}`);
    }
  }

  // Forge fallback
  const response = await invokeLLM({ messages: messages.map(m => ({ role: m.role, content: m.content as string })) });
  const rawContent = response.choices?.[0]?.message?.content;
  const content = typeof rawContent === "string" ? rawContent : "";
  return { content, model: "forge-default", source: "forge" };
}

// ─── Router ───────────────────────────────────────────────────────────────

export const aiRouter = router({
  /**
   * List available Ollama models and their status.
   */
  models: publicProcedure.query(async () => {
    const available = await ollamaAvailable();
    const models = available ? await listOllamaModels() : [];

    const recommended = [
      { id: "qwen3:8b", description: "Qwen3 8B — fast, multilingual, excellent for trade documents" },
      { id: "qwen3:32b", description: "Qwen3 32B — high accuracy for complex risk analysis" },
      { id: "deepseek-r1:8b", description: "DeepSeek-R1 8B — strong reasoning for compliance checks" },
      { id: "deepseek-r1:32b", description: "DeepSeek-R1 32B — best-in-class reasoning" },
      { id: "qwen2-vl:7b", description: "Qwen2-VL 7B — vision-language for document/cargo analysis" },
      { id: "mistral:7b", description: "Mistral 7B — general purpose, fast" },
      { id: "llama3.2:3b", description: "Llama 3.2 3B — ultra-fast, lightweight" },
    ];

    return {
      ollamaAvailable: available,
      installedModels: models,
      recommendedModels: recommended,
      forgeAvailable: true,
    };
  }),

  /**
   * General-purpose chat with model selection.
   * Supports Qwen3, DeepSeek-R1, Mistral, Llama3.
   */
  chat: protectedProcedure
    .input(z.object({
      messages: z.array(z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1),
      })).min(1),
      model: z.string().default("qwen3:8b"),
      temperature: z.number().min(0).max(2).default(0.1),
      systemPrompt: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const messages = input.systemPrompt
        ? [{ role: "system" as const, content: input.systemPrompt }, ...input.messages]
        : input.messages;

      const result = await llmWithFallback(input.model, messages, {
        temperature: input.temperature,
      });

      return {
        content: result.content,
        model: result.model,
        source: result.source,
        timestamp: Date.now(),
      };
    }),

  /**
   * Score the risk of a customs declaration using LLM reasoning.
   * Returns a structured risk assessment with score, lane, and factors.
   */
  scoreRisk: protectedProcedure
    .input(z.object({
      declarationId: z.string(),
      hsCode: z.string(),
      goodsDescription: z.string(),
      countryOfOrigin: z.string(),
      consigneeCountry: z.string(),
      declaredValue: z.number(),
      weight: z.number(),
      traderProfile: z.object({
        isAEO: z.boolean(),
        complianceScore: z.number().min(0).max(100),
        previousViolations: z.number(),
      }).optional(),
      model: z.string().default("deepseek-r1:8b"),
    }))
    .mutation(async ({ input }) => {
      const systemPrompt = `You are a customs risk assessment AI for the TradeGateway NGSWTP platform.
You analyse trade declarations and assign risk scores based on WCO SAFE Framework criteria.
Always respond with valid JSON matching the exact schema requested.`;

      const userPrompt = `Assess the risk of this customs declaration and respond with JSON only:

Declaration: ${input.declarationId}
HS Code: ${input.hsCode}
Goods: ${input.goodsDescription}
Origin: ${input.countryOfOrigin}
Destination: ${input.consigneeCountry}
Declared Value: USD ${input.declaredValue.toLocaleString()}
Weight: ${input.weight} kg
${input.traderProfile ? `Trader AEO: ${input.traderProfile.isAEO}, Compliance: ${input.traderProfile.complianceScore}/100, Violations: ${input.traderProfile.previousViolations}` : ""}

Respond with this exact JSON structure:
{
  "riskScore": <0-100>,
  "riskLane": "GREEN" | "YELLOW" | "RED",
  "riskFactors": ["factor1", "factor2"],
  "recommendedAction": "AUTO_RELEASE" | "DOCUMENT_REVIEW" | "PHYSICAL_INSPECTION" | "HOLD",
  "reasoning": "<2-3 sentence explanation>",
  "hsCodeValid": true | false,
  "valuationFlag": true | false,
  "originRisk": "LOW" | "MEDIUM" | "HIGH"
}`;

      let llmResult: { content: string; model: string; source: string } | null = null;
      try {
        llmResult = await llmWithFallback(
          input.model,
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          { temperature: 0.05 }
        );
      } catch {
        // LLM completely unavailable — return safe structured fallback
        return {
          riskScore: 35,
          riskLane: "YELLOW" as const,
          riskFactors: ["LLM unavailable \u2014 manual review recommended"],
          recommendedAction: "DOCUMENT_REVIEW" as const,
          reasoning: "Risk engine temporarily unavailable. Declaration routed for manual document review.",
          hsCodeValid: true,
          valuationFlag: false,
          originRisk: "MEDIUM" as const,
          declarationId: input.declarationId,
          model: "fallback",
          source: "fallback",
          scoredAt: Date.now(),
        };
      }
      const result = llmResult;
      try {
        // Extract JSON from response (handle markdown code blocks)
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON in response");
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          ...parsed,
          declarationId: input.declarationId,
          model: result.model,
          source: result.source,
          scoredAt: Date.now(),
        };
      } catch {
        // Fallback structured response
        return {
          riskScore: 35,
          riskLane: "YELLOW" as const,
          riskFactors: ["LLM parsing failed \u2014 manual review recommended"],
          recommendedAction: "DOCUMENT_REVIEW" as const,
          reasoning: result.content.slice(0, 300),
          hsCodeValid: true,
          valuationFlag: false,
          originRisk: "MEDIUM" as const,
          declarationId: input.declarationId,
          model: result.model,
          source: result.source,
          scoredAt: Date.now(),
        };
      }
    }),

  /**
   * Classify a goods description to an HS code using LLM.
   * Returns top-3 candidate HS codes with confidence scores.
   */
  classifyHS: protectedProcedure
    .input(z.object({
      description: z.string().min(3),
      countryOfOrigin: z.string().optional(),
      additionalContext: z.string().optional(),
      model: z.string().default("qwen3:8b"),
    }))
    .mutation(async ({ input }) => {
      const userPrompt = `Classify this goods description to HS codes (Harmonized System 2022).

Description: "${input.description}"
${input.countryOfOrigin ? `Country of Origin: ${input.countryOfOrigin}` : ""}
${input.additionalContext ? `Additional Context: ${input.additionalContext}` : ""}

Respond with JSON only:
{
  "candidates": [
    {
      "hsCode": "8471.30",
      "description": "Portable automatic data processing machines",
      "chapter": "84",
      "confidence": 0.92,
      "reasoning": "Brief explanation"
    }
  ],
  "topCandidate": "8471.30",
  "dutiable": true | false,
  "restrictedGoods": false,
  "cites": false,
  "dualUse": false
}

Provide exactly 3 candidates ordered by confidence.`;

      const result = await llmWithFallback(
        input.model,
        [{ role: "user", content: userPrompt }],
        { temperature: 0.05 }
      );

      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON in response");
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          ...parsed,
          model: result.model,
          source: result.source,
          classifiedAt: Date.now(),
        };
      } catch {
        return {
          candidates: [
            {
              hsCode: "9999.99",
              description: "Classification pending manual review",
              chapter: "99",
              confidence: 0.0,
              reasoning: "LLM classification failed",
            },
          ],
          topCandidate: "9999.99",
          dutiable: true,
          restrictedGoods: false,
          cites: false,
          dualUse: false,
          model: result.model,
          source: result.source,
          classifiedAt: Date.now(),
        };
      }
    }),

  /**
   * Generate a human-readable risk explanation for a customs officer.
   * Translates numeric risk scores into actionable narratives.
   */
  explainRisk: protectedProcedure
    .input(z.object({
      declarationId: z.string(),
      riskScore: z.number().min(0).max(100),
      riskFactors: z.array(z.string()),
      hsCode: z.string(),
      goodsDescription: z.string(),
      model: z.string().default("qwen3:8b"),
    }))
    .mutation(async ({ input }) => {
      const userPrompt = `You are a customs officer assistant. Explain this risk assessment in plain English.

Declaration: ${input.declarationId}
Risk Score: ${input.riskScore}/100
HS Code: ${input.hsCode}
Goods: ${input.goodsDescription}
Risk Factors: ${input.riskFactors.join("; ")}

Write a 3-paragraph explanation:
1. Summary of why this declaration was flagged
2. Specific concerns the officer should investigate
3. Recommended examination steps

Keep it professional, concise, and actionable. No JSON needed.`;

      const result = await llmWithFallback(
        input.model,
        [{ role: "user", content: userPrompt }],
        { temperature: 0.2 }
      );

      return {
        explanation: result.content,
        model: result.model,
        source: result.source,
        generatedAt: Date.now(),
      };
    }),

  /**
   * Extract structured data from a free-text shipping manifest or invoice.
   * Uses LLM to parse unstructured documents into WCO data model fields.
   */
  extractManifest: protectedProcedure
    .input(z.object({
      rawText: z.string().min(10).max(10000),
      documentType: z.enum(["bill_of_lading", "commercial_invoice", "packing_list", "airway_bill", "other"]),
      model: z.string().default("qwen3:8b"),
    }))
    .mutation(async ({ input }) => {
      const userPrompt = `Extract structured data from this ${input.documentType.replace("_", " ")}.

Document text:
"""
${input.rawText}
"""

Respond with JSON only:
{
  "shipper": { "name": "", "address": "", "country": "" },
  "consignee": { "name": "", "address": "", "country": "" },
  "vessel": "",
  "voyageNumber": "",
  "portOfLoading": "",
  "portOfDischarge": "",
  "billOfLadingNumber": "",
  "containerNumbers": [],
  "goods": [
    {
      "description": "",
      "hsCode": "",
      "quantity": 0,
      "unit": "",
      "grossWeight": 0,
      "netWeight": 0,
      "value": 0,
      "currency": ""
    }
  ],
  "totalGrossWeight": 0,
  "totalValue": 0,
  "currency": "",
  "incoterms": "",
  "extractionConfidence": 0.0
}

Fill in what you can find. Use null for missing fields.`;

      const result = await llmWithFallback(
        input.model,
        [{ role: "user", content: userPrompt }],
        { temperature: 0.05 }
      );

      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON in response");
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          ...parsed,
          model: result.model,
          source: result.source,
          extractedAt: Date.now(),
        };
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to extract manifest data. Please try again or enter manually.",
        });
      }
    }),
});
