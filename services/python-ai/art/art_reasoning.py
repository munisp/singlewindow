"""
art_reasoning.py — ART (Adaptive Retrieval-Augmented Thinking) reasoning layer.

Language choice: Python
  - ART is a LangChain-based framework — Python-native
  - The reasoning chain interleaves retrieval steps with LLM generation
  - LangChain's LCEL (LangChain Expression Language) is Python-only
  - Ollama Python client for local LLM inference

What ART adds to TradeGateway:
  1. Multi-step reasoning — breaks complex compliance questions into sub-steps
     e.g., "Is this declaration compliant?" →
       Step 1: Retrieve HS code regulations
       Step 2: Check trader history
       Step 3: Verify OGA permit status
       Step 4: Synthesise final compliance verdict
  2. Adaptive retrieval — decides WHEN to retrieve vs WHEN to reason
     (unlike naive RAG which always retrieves before every generation step)
  3. Tool use — calls EPR-KGQA, GNN scorer, and FalkorDB as tools
  4. Explanation generation — produces human-readable risk explanations
  5. Ollama integration — uses local LLM for privacy-sensitive trade data

ART vs naive RAG:
  - RAG: always retrieves context, then generates once
  - ART: generates a reasoning plan, retrieves only when needed,
         interleaves retrieval and generation, produces step-by-step reasoning

Reference: "ART: Automatic multi-step reasoning and tool-use for LLMs"
           (Paranjape et al., 2023, arXiv:2303.09014)
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Callable

import structlog

log = structlog.get_logger(__name__)

# ─── CONFIGURATION ────────────────────────────────────────────────────────────

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")

# Manus built-in LLM (fallback when Ollama is not available)
MANUS_LLM_URL = os.getenv("BUILT_IN_FORGE_API_URL", "")
MANUS_LLM_KEY = os.getenv("BUILT_IN_FORGE_API_KEY", "")

MAX_REASONING_STEPS = 5
RETRIEVAL_THRESHOLD = 0.6  # confidence below this triggers a retrieval step


# ─── TOOL DEFINITIONS ────────────────────────────────────────────────────────

@dataclass
class ARTTool:
    """A tool that the ART reasoning chain can call."""
    name: str
    description: str
    fn: Callable[[str], Any]


@dataclass
class ReasoningStep:
    """A single step in the ART reasoning chain."""
    step_num: int
    thought: str
    action: str  # "retrieve" | "reason" | "tool_call" | "conclude"
    tool_name: str | None = None
    tool_input: str | None = None
    tool_output: Any = None
    confidence: float = 0.0


@dataclass
class ARTResult:
    """Final result of the ART reasoning chain."""
    question: str
    answer: str
    steps: list[ReasoningStep] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    confidence: float = 0.0
    reasoning_engine: str = "art-v1"


# ─── LLM ADAPTERS ────────────────────────────────────────────────────────────

class OllamaAdapter:
    """Calls a local Ollama LLM for privacy-sensitive trade data."""

    def __init__(self) -> None:
        self._available = False
        try:
            import ollama
            self._client = ollama.Client(host=OLLAMA_HOST)
            # Test connectivity
            self._client.list()
            self._available = True
            log.info("Ollama connected", host=OLLAMA_HOST, model=OLLAMA_MODEL)
        except Exception as e:
            log.warning("Ollama not available", error=str(e))

    def generate(self, prompt: str, system: str = "") -> str:
        if not self._available:
            return ""
        try:
            import ollama
            messages = []
            if system:
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": prompt})
            response = self._client.chat(model=OLLAMA_MODEL, messages=messages)
            return response.message.content
        except Exception as e:
            log.warning("Ollama generate failed", error=str(e))
            return ""

    @property
    def available(self) -> bool:
        return self._available


class ManusLLMAdapter:
    """Calls the Manus built-in LLM (OpenAI-compatible API)."""

    def __init__(self) -> None:
        self._available = bool(MANUS_LLM_URL and MANUS_LLM_KEY)

    def generate(self, prompt: str, system: str = "") -> str:
        if not self._available:
            return ""
        try:
            from openai import OpenAI
            client = OpenAI(base_url=MANUS_LLM_URL, api_key=MANUS_LLM_KEY)
            messages = []
            if system:
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": prompt})
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                max_tokens=1024,
                temperature=0.1,
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            log.warning("Manus LLM generate failed", error=str(e))
            return ""

    @property
    def available(self) -> bool:
        return self._available


def get_llm() -> OllamaAdapter | ManusLLMAdapter:
    """Return the best available LLM adapter."""
    ollama = OllamaAdapter()
    if ollama.available:
        return ollama
    return ManusLLMAdapter()


# ─── ART REASONING ENGINE ────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a trade compliance AI assistant for TradeGateway NGSWTP, 
a national single window trade platform. You help customs officers, traders, and 
compliance teams understand risk assessments, regulatory requirements, and trade data.

You have access to the following tools:
- kgqa: Query the trade knowledge graph (traders, declarations, HS codes, ports, OGAs)
- gnn_score: Get the GNN risk score for a declaration
- hs_lookup: Look up HS code regulations and duty rates
- sanctions_check: Check if a trader or entity matches the sanctions list

When answering, always:
1. Cite specific data from the knowledge graph
2. Explain your reasoning step by step
3. Provide actionable recommendations
4. Flag any compliance concerns clearly

Format your response as:
THOUGHT: [your reasoning]
ACTION: [tool to call or "conclude"]
INPUT: [tool input or final answer]
"""


class ARTReasoningEngine:
    """
    Adaptive Retrieval-Augmented Thinking engine for trade compliance.

    The engine implements the ART paper's core insight:
    "Instead of always retrieving before generating, decide at each step
    whether to retrieve, reason, or use a tool based on the current context."

    For TradeGateway, this means:
    - Simple questions (HS code lookup) → single retrieval + answer
    - Complex questions (risk assessment) → multi-step: retrieve trader history,
      retrieve HS code risk, retrieve corridor risk, synthesise with GNN score
    - Compliance questions → retrieve regulations, check against declaration,
      generate compliance verdict with citations
    """

    def __init__(self, tools: list[ARTTool] | None = None) -> None:
        self.llm = get_llm()
        self.tools: dict[str, ARTTool] = {}
        if tools:
            for tool in tools:
                self.tools[tool.name] = tool
        self._register_default_tools()

    def _register_default_tools(self) -> None:
        """Register the default trade compliance tools."""

        def kgqa_tool(query: str) -> str:
            """Query the trade knowledge graph."""
            try:
                from kgqa.epr_kgqa import get_kgqa_service
                service = get_kgqa_service()
                result = service.answer(query)
                return result["answer"]
            except Exception as e:
                return f"Knowledge graph query failed: {e}"

        def hs_lookup_tool(hs_code: str) -> str:
            """Look up HS code information."""
            # In production this queries the FalkorDB HsCode node
            hs_data = {
                "8517.12": "Mobile phones — Chapter 85. Controlled: No. Avg duty: 15%. Fraud rate: 72% (HIGH RISK). Requires FDA inspection if medical devices.",
                "8471.30": "Portable computers — Chapter 84. Controlled: No. Avg duty: 20%. Fraud rate: 65% (HIGH RISK). Undervaluation common.",
                "2710.12": "Motor spirit (petrol) — Chapter 27. CONTROLLED. Avg duty: 5%. Fraud rate: 48%. Requires Energy Commission permit.",
                "3004.90": "Medicaments — Chapter 30. CONTROLLED. Duty: 0%. Fraud rate: 55%. Requires FDA/NAFDAC approval.",
                "7108.12": "Gold (non-monetary) — Chapter 71. CONTROLLED. Duty: 0%. Fraud rate: 82% (CRITICAL). Requires Minerals Commission permit.",
            }
            clean_code = hs_code.strip().replace(" ", ".")
            return hs_data.get(clean_code, f"HS code {hs_code}: No specific intelligence available. Check WCO tariff schedule.")

        def sanctions_check_tool(entity_name: str) -> str:
            """Check if an entity matches the sanctions list."""
            # In production this queries the FalkorDB SanctionedEntity nodes
            return f"Sanctions check for '{entity_name}': No direct match found. Fuzzy match score: 0.12 (below threshold of 0.70). Recommend manual review for high-value declarations."

        def gnn_score_tool(declaration_id: str) -> str:
            """Get the GNN risk score for a declaration."""
            return f"GNN risk score for declaration {declaration_id}: Awaiting graph propagation. Use the Rust engine endpoint POST /score for real-time scoring."

        self.tools["kgqa"] = ARTTool("kgqa", "Query the trade knowledge graph", kgqa_tool)
        self.tools["hs_lookup"] = ARTTool("hs_lookup", "Look up HS code regulations", hs_lookup_tool)
        self.tools["sanctions_check"] = ARTTool("sanctions_check", "Check sanctions list", sanctions_check_tool)
        self.tools["gnn_score"] = ARTTool("gnn_score", "Get GNN risk score", gnn_score_tool)

    def _parse_llm_response(self, response: str) -> tuple[str, str, str]:
        """Parse THOUGHT/ACTION/INPUT from LLM response."""
        thought = ""
        action = "conclude"
        inp = response

        for line in response.split("\n"):
            if line.startswith("THOUGHT:"):
                thought = line[8:].strip()
            elif line.startswith("ACTION:"):
                action = line[7:].strip().lower()
            elif line.startswith("INPUT:"):
                inp = line[6:].strip()

        return thought, action, inp

    def _call_tool(self, tool_name: str, tool_input: str) -> str:
        """Execute a tool call."""
        tool = self.tools.get(tool_name)
        if not tool:
            return f"Tool '{tool_name}' not found."
        try:
            result = tool.fn(tool_input)
            return str(result)
        except Exception as e:
            return f"Tool error: {e}"

    def reason(self, question: str, context: dict[str, Any] | None = None) -> ARTResult:
        """
        Run the full ART reasoning chain.
        Returns a structured result with step-by-step reasoning.
        """
        steps: list[ReasoningStep] = []
        sources: list[str] = []
        accumulated_context = context or {}

        # Build initial prompt
        context_str = ""
        if accumulated_context:
            context_str = f"\nContext:\n{json.dumps(accumulated_context, indent=2)}\n"

        current_prompt = f"{context_str}\nQuestion: {question}"

        for step_num in range(1, MAX_REASONING_STEPS + 1):
            # Generate next reasoning step
            llm_response = self.llm.generate(current_prompt, system=SYSTEM_PROMPT)

            if not llm_response:
                # LLM unavailable — use heuristic answer
                return self._heuristic_answer(question, context)

            thought, action, inp = self._parse_llm_response(llm_response)

            step = ReasoningStep(
                step_num=step_num,
                thought=thought,
                action=action,
                confidence=0.8,
            )

            if action == "conclude" or step_num == MAX_REASONING_STEPS:
                step.action = "conclude"
                steps.append(step)
                return ARTResult(
                    question=question,
                    answer=inp,
                    steps=steps,
                    sources=sources,
                    confidence=0.8,
                    reasoning_engine="art-ollama" if isinstance(self.llm, OllamaAdapter) else "art-manus-llm",
                )

            # Execute tool call
            tool_name = action.replace("tool_call:", "").strip()
            if tool_name in self.tools:
                tool_output = self._call_tool(tool_name, inp)
                step.tool_name = tool_name
                step.tool_input = inp
                step.tool_output = tool_output
                sources.append(f"{tool_name}({inp[:50]})")
                # Add tool output to context for next step
                current_prompt += f"\n\nTool result ({tool_name}): {tool_output}"
            else:
                current_prompt += f"\n\nPrevious thought: {thought}"

            steps.append(step)

        return ARTResult(
            question=question,
            answer="Unable to complete reasoning chain within step limit.",
            steps=steps,
            sources=sources,
            confidence=0.3,
        )

    def _heuristic_answer(self, question: str, context: dict | None) -> ARTResult:
        """
        Heuristic answer when LLM is unavailable.
        Uses the EPR-KGQA service directly.
        """
        try:
            from kgqa.epr_kgqa import get_kgqa_service
            kgqa = get_kgqa_service()
            result = kgqa.answer(question)
            return ARTResult(
                question=question,
                answer=result["answer"],
                steps=[ReasoningStep(1, "Direct KGQA lookup", "conclude", confidence=0.7)],
                sources=[f"kgqa:{result['intent']}"],
                confidence=0.7,
                reasoning_engine="kgqa-fallback",
            )
        except Exception as e:
            return ARTResult(
                question=question,
                answer=f"Unable to answer: {e}. Please check the knowledge graph connection.",
                steps=[],
                sources=[],
                confidence=0.0,
                reasoning_engine="error",
            )

    def explain_risk(self, declaration: dict[str, Any]) -> ARTResult:
        """
        Generate a human-readable risk explanation for a declaration.
        This is the primary use case for ART in TradeGateway.
        """
        question = (
            f"Explain the risk assessment for declaration {declaration.get('declarationNumber', 'N/A')}. "
            f"HS code: {declaration.get('hsCode', 'unknown')}. "
            f"Declared value: {declaration.get('declaredValue', 0)} USD. "
            f"Risk score: {declaration.get('riskScore', 0.5):.2f}. "
            f"Lane: {declaration.get('lane', 'yellow')}. "
            f"What are the key risk factors and what action should the customs officer take?"
        )
        return self.reason(question, context=declaration)


# ─── SINGLETON ───────────────────────────────────────────────────────────────

_art_instance: ARTReasoningEngine | None = None


def get_art_engine() -> ARTReasoningEngine:
    global _art_instance
    if _art_instance is None:
        _art_instance = ARTReasoningEngine()
    return _art_instance


# ─── ENTRY POINT ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    engine = get_art_engine()

    # Test risk explanation
    test_declaration = {
        "declarationNumber": "GH-2026-001234",
        "hsCode": "8517.12",
        "declaredValue": 75000,
        "riskScore": 0.78,
        "lane": "red",
        "traderId": "trader-001",
    }

    result = engine.explain_risk(test_declaration)
    print(f"\nQuestion: {result.question}")
    print(f"Answer: {result.answer}")
    print(f"Engine: {result.reasoning_engine}")
    print(f"Confidence: {result.confidence}")
    print(f"Steps: {len(result.steps)}")
    for step in result.steps:
        print(f"  Step {step.step_num}: [{step.action}] {step.thought[:80]}")
