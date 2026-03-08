/**
 * TradeGateway NGSWTP — PDF Export Button
 * Design: Sovereign Blueprint — deep navy + gold
 *
 * Provides a "Download Specification" button that triggers
 * a print-optimized CSS layout for PDF export via browser print dialog.
 */

import { useState } from "react";
import { Download, FileText, Printer, CheckCircle } from "lucide-react";

export default function PDFExport() {
  const [isExporting, setIsExporting] = useState(false);
  const [exported, setExported] = useState(false);

  const handleExport = () => {
    setIsExporting(true);

    // Add print class to body for print-optimized layout
    document.body.classList.add("print-mode");

    setTimeout(() => {
      window.print();
      document.body.classList.remove("print-mode");
      setIsExporting(false);
      setExported(true);
      setTimeout(() => setExported(false), 3000);
    }, 500);
  };

  return (
    <>
      {/* Print styles injected inline */}
      <style>{`
        @media print {
          body { background: white !important; color: black !important; }
          nav, .no-print, button, [data-no-print] { display: none !important; }
          section { page-break-inside: avoid; }
          h1, h2, h3 { color: #0A1628 !important; }
          .bg-\\[\\#0A1628\\], .bg-\\[\\#081422\\], .bg-\\[\\#0D1E35\\] {
            background: #f8fafc !important;
            border: 1px solid #e2e8f0 !important;
          }
          .text-white { color: #0A1628 !important; }
          .text-slate-300, .text-slate-400 { color: #475569 !important; }
          .text-\\[\\#D4A017\\] { color: #92400e !important; }
        }
      `}</style>

      <div className="fixed bottom-8 right-8 z-50 flex flex-col items-end gap-3 no-print">
        {exported && (
          <div className="bg-emerald-900/90 border border-emerald-700 text-emerald-300 px-4 py-2.5 rounded-xl text-sm flex items-center gap-2 shadow-xl">
            <CheckCircle className="w-4 h-4" />
            Print dialog opened
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="bg-[#0D1E35] border border-slate-600 hover:border-[#D4A017] text-slate-300 hover:text-white p-3 rounded-xl transition-all shadow-xl"
            title="Back to top"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </button>

          <button
            onClick={handleExport}
            disabled={isExporting}
            className="bg-[#D4A017] hover:bg-[#B8860B] disabled:opacity-70 text-[#0A1628] font-bold px-5 py-3 rounded-xl transition-all shadow-xl flex items-center gap-2.5"
          >
            {isExporting ? (
              <>
                <div className="w-4 h-4 border-2 border-[#0A1628] border-t-transparent rounded-full animate-spin" />
                Preparing...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Export PDF
              </>
            )}
          </button>
        </div>

        {/* Tooltip */}
        <div className="text-slate-500 text-xs text-right">
          <div className="flex items-center gap-1 justify-end">
            <Printer className="w-3 h-3" />
            Print-optimized layout
          </div>
          <div className="flex items-center gap-1 justify-end">
            <FileText className="w-3 h-3" />
            Full specification included
          </div>
        </div>
      </div>
    </>
  );
}
