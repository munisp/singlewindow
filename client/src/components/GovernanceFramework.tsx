/**
 * Governance & Legal Framework — Interactive checklist and MoU structure
 * Design: Sovereign Blueprint — Deep Navy + Gold
 * Based on: Rwanda ReSW legal prerequisites, Singapore NTP governance model,
 *           Ghana ICUMS stakeholder management lessons
 */

import { useState } from "react";
import { CheckCircle, Circle, ChevronDown, AlertTriangle, Shield, Users, FileText, Scale } from "lucide-react";

// ─── DATA ────────────────────────────────────────────────────────────────────

interface CheckItem {
  id: string;
  title: string;
  description: string;
  source: string;
  critical: boolean;
}

interface ChecklistSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  color: string;
  items: CheckItem[];
}

const checklistSections: ChecklistSection[] = [
  {
    id: "legal",
    title: "Legal & Regulatory Prerequisites",
    icon: <Scale size={18} />,
    color: "#1E3A5F",
    items: [
      {
        id: "esig",
        title: "Electronic Signatures Act",
        description: "Legislation recognizing electronic signatures as legally equivalent to handwritten signatures for trade documents. Rwanda's experience shows this must be enacted before launch.",
        source: "Rwanda ReSW Lesson",
        critical: true,
      },
      {
        id: "etrans",
        title: "Electronic Transactions Act",
        description: "Legal framework establishing the validity of electronic contracts, electronic records, and electronic communications in commercial and regulatory contexts.",
        source: "Rwanda ReSW Lesson",
        critical: true,
      },
      {
        id: "emessage",
        title: "Electronic Messages / EDI Legal Framework",
        description: "Legislation recognizing EDI messages and electronic data interchange as legally valid substitutes for paper documents in customs and trade procedures.",
        source: "Rwanda ReSW Lesson",
        critical: true,
      },
      {
        id: "customs_law",
        title: "Customs Act Amendment",
        description: "Amendment to the national Customs Act to authorize electronic declarations, electronic payment of duties, and electronic clearance certificates.",
        source: "WCO Best Practice",
        critical: true,
      },
      {
        id: "data_protection",
        title: "Data Protection & Privacy Law",
        description: "Legislation governing the collection, processing, storage, and sharing of trader and cargo data, including cross-border data transfer provisions.",
        source: "WTO TFA Art. 10",
        critical: true,
      },
      {
        id: "cybercrime",
        title: "Cybercrime / Computer Misuse Act",
        description: "Criminal legislation covering unauthorized access to government systems, data tampering, and electronic fraud — essential for prosecuting customs fraud via the platform.",
        source: "Security Requirement",
        critical: false,
      },
      {
        id: "sw_decree",
        title: "Single Window Enabling Decree / Regulation",
        description: "Executive or legislative instrument formally establishing the Single Window as the mandatory submission channel for all trade regulatory requirements.",
        source: "WCO / UNCTAD",
        critical: true,
      },
      {
        id: "fee_schedule",
        title: "Published Fee Schedule & Revenue Regulations",
        description: "Legally published schedule of all platform fees, approved by the relevant regulatory body. Transparency prevents the stakeholder dissatisfaction seen in Ghana's dual-vendor era.",
        source: "Ghana ICUMS Lesson",
        critical: false,
      },
    ],
  },
  {
    id: "governance",
    title: "Governance Structure",
    icon: <Users size={18} />,
    color: "#0E6655",
    items: [
      {
        id: "steering",
        title: "Multi-Stakeholder Steering Committee Established",
        description: "Steering Committee with representation from all participating agencies, private sector (freight forwarders, traders, banks), and international observers (WCO, WTO, UNCTAD). Rwanda's model of including all stakeholders is critical for buy-in.",
        source: "Rwanda ReSW Governance",
        critical: true,
      },
      {
        id: "tech_board",
        title: "Technical Advisory Board Constituted",
        description: "Technical Advisory Board with expertise in customs administration, trade finance, cybersecurity, and data analytics to guide technology decisions.",
        source: "Best Practice",
        critical: false,
      },
      {
        id: "operator",
        title: "Platform Operator Entity Designated",
        description: "Dedicated government agency or statutory body designated as the platform operator, with clear mandate, funding, and accountability framework. Fully public ownership (not PPP) recommended based on Rwanda experience.",
        source: "Rwanda ReSW Lesson",
        critical: true,
      },
      {
        id: "dpo",
        title: "Data Protection Officer Appointed",
        description: "Designated Data Protection Officer responsible for overseeing compliance with data protection legislation and managing data breach incidents.",
        source: "Data Protection Requirement",
        critical: false,
      },
      {
        id: "ciso",
        title: "Chief Information Security Officer Appointed",
        description: "CISO responsible for the platform's security posture, incident response, and coordination with national cybersecurity authorities.",
        source: "Security Governance",
        critical: true,
      },
      {
        id: "audit",
        title: "Independent Audit Mechanism Established",
        description: "Independent technical and financial audit mechanism, with annual audits by a qualified third party and results published to the Steering Committee.",
        source: "Transparency Requirement",
        critical: false,
      },
    ],
  },
  {
    id: "mou",
    title: "Agency MoU / Integration Agreements",
    icon: <FileText size={18} />,
    color: "#6B21A8",
    items: [
      {
        id: "mou_customs",
        title: "MoU with Customs Authority",
        description: "Data sharing agreement, SLA for system availability, officer access management, and escalation procedures for system failures.",
        source: "Rwanda ReSW Model",
        critical: true,
      },
      {
        id: "mou_revenue",
        title: "MoU with Revenue Authority",
        description: "Agreement on duty assessment data exchange, payment confirmation protocols, TigerBeetle ledger access rights, and revenue reconciliation procedures.",
        source: "Ghana ICUMS Model",
        critical: true,
      },
      {
        id: "mou_central_bank",
        title: "MoU with Central Bank",
        description: "Mojaloop integration agreement, foreign exchange approval protocols, payment settlement SLAs, and anti-money laundering data sharing.",
        source: "Mojaloop Governance",
        critical: true,
      },
      {
        id: "mou_ogas",
        title: "MoUs with All Other Government Agencies",
        description: "Individual MoUs with each of the 37+ OGAs covering: data elements to be exchanged, response time SLAs, escalation procedures, and staff training obligations.",
        source: "Rwanda ReSW Lesson",
        critical: true,
      },
      {
        id: "mou_banks",
        title: "Participation Agreements with Commercial Banks",
        description: "Mojaloop participation agreements with all licensed commercial banks, covering payment processing SLAs, dispute resolution, and anti-fraud obligations.",
        source: "Mojaloop Foundation",
        critical: true,
      },
      {
        id: "mou_mobile",
        title: "Participation Agreements with Mobile Money Operators",
        description: "Mojaloop participation agreements with mobile money operators for USSD and mobile payment processing.",
        source: "Mojaloop Foundation",
        critical: false,
      },
      {
        id: "mou_asean",
        title: "ASEAN Single Window Participation Agreement",
        description: "Formal accession to the ASEAN Single Window framework, covering ACDD data standards, certificate of origin exchange, and transit document protocols.",
        source: "ASEAN SW Framework",
        critical: false,
      },
      {
        id: "mou_wco",
        title: "WCO CEN Network Participation",
        description: "Agreement to participate in the WCO Customs Enforcement Network for intelligence sharing on smuggling patterns and high-risk traders.",
        source: "WCO CEN",
        critical: false,
      },
    ],
  },
  {
    id: "change_mgmt",
    title: "Change Management & Readiness",
    icon: <Shield size={18} />,
    color: "#B45309",
    items: [
      {
        id: "training_customs",
        title: "Customs Officer Training Programme",
        description: "All customs officers trained on the new system before go-live. Ghana's experience shows that inadequate training is a primary cause of post-launch operational failures.",
        source: "Ghana ICUMS Lesson",
        critical: true,
      },
      {
        id: "training_agents",
        title: "Clearing Agent Certification Programme",
        description: "All licensed clearing agents certified on the new declaration submission process. Certification should be mandatory for continued licensing.",
        source: "Ghana ICUMS Lesson",
        critical: true,
      },
      {
        id: "training_ogas",
        title: "OGA Staff Training",
        description: "Staff at all participating agencies trained on their agency portal interface and the joint inspection workflow.",
        source: "Rwanda ReSW Lesson",
        critical: true,
      },
      {
        id: "helpdesk",
        title: "24/7 Help Desk Operational",
        description: "Dedicated help desk operational from day one of go-live, with tiered support (L1 phone/chat, L2 technical, L3 developer). Rwanda's experience shows this is non-negotiable.",
        source: "Rwanda ReSW Lesson",
        critical: true,
      },
      {
        id: "pilot",
        title: "Phased Rollout Plan (Pilot → Major Ports → Nationwide)",
        description: "Pilot at one port or border post before nationwide rollout. This reduces risk and allows operational issues to be resolved before full deployment.",
        source: "Ghana ICUMS Lesson",
        critical: true,
      },
      {
        id: "hybrid_access",
        title: "Hybrid Access Model Implemented",
        description: "Web portal, mobile app, API, WhatsApp, and USSD channels all operational before go-live to ensure no trader is excluded. Rwanda's hybrid model is a key equity lesson.",
        source: "Rwanda ReSW Lesson",
        critical: false,
      },
      {
        id: "stakeholder_forum",
        title: "Regular Stakeholder Forums Scheduled",
        description: "Quarterly stakeholder forums with traders, clearing agents, and OGA representatives to surface operational issues and maintain buy-in.",
        source: "Best Practice",
        critical: false,
      },
      {
        id: "sme_support",
        title: "SME Trader Support Programme",
        description: "Dedicated support programme for small and medium traders who may lack the technical capacity to use the platform independently.",
        source: "Singapore NTP Lesson",
        critical: false,
      },
    ],
  },
];

const mouTemplate = {
  parties: ["Platform Operator (Government Agency)", "Participating Agency / Institution"],
  sections: [
    {
      title: "1. Purpose and Scope",
      content: "This Memorandum of Understanding establishes the terms and conditions under which [Agency Name] will participate in the TradeGateway™ NGSWTP Single Window platform, including the data elements to be exchanged, the services to be provided, and the obligations of each party.",
    },
    {
      title: "2. Data Exchange Obligations",
      content: "Each party agrees to provide the data elements specified in Schedule A in the format and frequency specified. The Platform Operator agrees to maintain the confidentiality of all data received and to use it only for the purposes specified in this MoU.",
    },
    {
      title: "3. Service Level Agreements",
      content: "The Platform Operator commits to: (a) 99.99% platform availability; (b) sub-10-second response time for standard queries; (c) 4-hour incident response for critical failures. The Participating Agency commits to: (a) responding to electronic notifications within the timeframes specified in Schedule B; (b) maintaining system access for authorized officers.",
    },
    {
      title: "4. Security and Access Management",
      content: "Both parties agree to implement and maintain appropriate technical and organizational security measures. The Participating Agency is responsible for managing access credentials for its officers and for immediately notifying the Platform Operator of any suspected unauthorized access.",
    },
    {
      title: "5. Dispute Resolution",
      content: "Disputes arising from this MoU shall be escalated to the Multi-Stakeholder Steering Committee within 5 business days. The Steering Committee shall endeavor to resolve disputes within 30 days. Unresolved disputes shall be referred to the designated arbitration mechanism.",
    },
    {
      title: "6. Duration and Review",
      content: "This MoU shall remain in force for 3 years from the date of signing, subject to annual review. Either party may propose amendments with 90 days' written notice. The MoU shall be reviewed and renewed at the end of each 3-year period.",
    },
  ],
};

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function GovernanceFramework() {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [openSection, setOpenSection] = useState<string | null>("legal");
  const [showMoU, setShowMoU] = useState(false);

  const toggleCheck = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalItems = checklistSections.reduce((sum, s) => sum + s.items.length, 0);
  const criticalItems = checklistSections.reduce((sum, s) => sum + s.items.filter((i) => i.critical).length, 0);
  const checkedCritical = checklistSections.reduce(
    (sum, s) => sum + s.items.filter((i) => i.critical && checked.has(i.id)).length,
    0
  );
  const completionPct = Math.round((checked.size / totalItems) * 100);
  const criticalPct = Math.round((checkedCritical / criticalItems) * 100);

  return (
    <div className="space-y-6">
      {/* Progress Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Overall Readiness", value: completionPct, color: "#D4A017", sub: `${checked.size}/${totalItems} items` },
          { label: "Critical Prerequisites", value: criticalPct, color: "#DC2626", sub: `${checkedCritical}/${criticalItems} critical` },
          { label: "Launch Readiness", value: criticalPct >= 100 ? 100 : Math.min(criticalPct, completionPct), color: "#0E6655", sub: criticalPct >= 100 ? "Ready to launch" : "Not yet ready" },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-white/10 p-4 bg-white/3">
            <div className="text-xs text-slate-400 mb-2">{card.label}</div>
            <div className="text-2xl font-bold font-display mb-1" style={{ color: card.color }}>
              {card.value}%
            </div>
            <div className="w-full bg-white/10 rounded-full h-1.5 mb-1">
              <div
                className="h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${card.value}%`, backgroundColor: card.color }}
              />
            </div>
            <div className="text-xs text-slate-500">{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Checklists */}
      <div className="space-y-3">
        {checklistSections.map((section) => {
          const sectionChecked = section.items.filter((i) => checked.has(i.id)).length;
          const isOpen = openSection === section.id;

          return (
            <div key={section.id} className="rounded-xl border border-white/10 overflow-hidden">
              <button
                onClick={() => setOpenSection(isOpen ? null : section.id)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-white/5 transition-colors"
                style={{ backgroundColor: section.color + "20" }}
              >
                <div className="flex items-center gap-3">
                  <span style={{ color: section.color }}>{section.icon}</span>
                  <div>
                    <div className="text-sm font-bold text-white">{section.title}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {sectionChecked}/{section.items.length} completed ·{" "}
                      {section.items.filter((i) => i.critical).length} critical items
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-16 bg-white/10 rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full transition-all"
                      style={{
                        width: `${(sectionChecked / section.items.length) * 100}%`,
                        backgroundColor: section.color,
                      }}
                    />
                  </div>
                  <ChevronDown
                    size={16}
                    className={`text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                  />
                </div>
              </button>

              {isOpen && (
                <div className="divide-y divide-white/5">
                  {section.items.map((item) => {
                    const isChecked = checked.has(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`flex gap-3 p-4 cursor-pointer transition-colors ${
                          isChecked ? "bg-white/5" : "hover:bg-white/3"
                        }`}
                        onClick={() => toggleCheck(item.id)}
                      >
                        <div className="mt-0.5 shrink-0">
                          {isChecked ? (
                            <CheckCircle size={18} className="text-emerald-400" />
                          ) : (
                            <Circle size={18} className="text-slate-600" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start gap-2 flex-wrap">
                            <span className={`text-sm font-medium ${isChecked ? "text-slate-400 line-through" : "text-white"}`}>
                              {item.title}
                            </span>
                            {item.critical && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-red-900/40 text-red-400 border border-red-800/30 shrink-0">
                                <AlertTriangle size={10} /> Critical
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-1 leading-relaxed">{item.description}</p>
                          <div className="text-xs text-gold/60 mt-1">Source: {item.source}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* MoU Template */}
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <button
          onClick={() => setShowMoU(!showMoU)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-white/5 transition-colors bg-navy-800/40"
        >
          <div className="flex items-center gap-3">
            <FileText size={18} className="text-gold" />
            <div>
              <div className="text-sm font-bold text-white">Agency MoU Template Structure</div>
              <div className="text-xs text-slate-400">Standard MoU framework for all 37+ agency integration agreements</div>
            </div>
          </div>
          <ChevronDown
            size={16}
            className={`text-slate-400 transition-transform duration-200 ${showMoU ? "rotate-180" : ""}`}
          />
        </button>

        {showMoU && (
          <div className="p-5 space-y-4">
            <div className="flex gap-4 text-sm text-slate-400 mb-4">
              <div>
                <span className="text-slate-500">Parties: </span>
                {mouTemplate.parties.join(" ↔ ")}
              </div>
            </div>
            {mouTemplate.sections.map((section) => (
              <div key={section.title} className="rounded-lg border border-white/10 p-4 bg-white/3">
                <div className="text-sm font-bold text-gold mb-2">{section.title}</div>
                <p className="text-sm text-slate-400 leading-relaxed">{section.content}</p>
              </div>
            ))}
            <div className="text-xs text-slate-500 mt-2">
              * This template is based on Rwanda ReSW MoU structure and WCO Single Window governance best practices.
              Schedules A (data elements) and B (response time SLAs) are agency-specific and must be negotiated individually.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
