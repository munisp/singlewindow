/**
 * Tenant White-Label Branding — /app/admin/tenant-branding
 *
 * Allows administrators to customise the platform's visual identity
 * per tenant: logo, favicon, colour palette, support contacts, footer
 * text, login banner, and custom CSS overrides.
 *
 * Wired to:
 *   trpc.tenant.listTenants        — populate tenant selector
 *   trpc.tenant.getTenantBranding  — load current branding config
 *   trpc.tenant.upsertTenantBranding — save changes
 *   trpc.tenant.resetTenantBranding  — restore platform defaults
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import {
  Palette,
  Save,
  RotateCcw,
  Eye,
  Building2,
  Image,
  Mail,
  Phone,
  FileText,
  Code2,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Globe,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BrandingForm {
  platformName: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  accentColor: string;
  supportEmail: string;
  supportPhone: string;
  footerText: string;
  customCss: string;
  loginBannerUrl: string;
}

const DEFAULT_FORM: BrandingForm = {
  platformName: "",
  logoUrl: "",
  faviconUrl: "",
  primaryColor: "#0A1628",
  accentColor: "#D4A017",
  supportEmail: "",
  supportPhone: "",
  footerText: "",
  customCss: "",
  loginBannerUrl: "",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidHex(v: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(v);
}

function isValidUrl(v: string): boolean {
  if (!v) return true; // optional
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TenantBranding() {
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [form, setForm] = useState<BrandingForm>(DEFAULT_FORM);
  const [isDirty, setIsDirty] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Tenant list
  const tenantsQuery = trpc.tenant.listTenants.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  // Current branding for selected tenant
  const brandingQuery = trpc.tenant.getTenantBranding.useQuery(
    { tenantId: selectedTenantId },
    { enabled: !!selectedTenantId, refetchOnWindowFocus: false }
  );

  // Upsert mutation
  const upsertMutation = trpc.tenant.upsertTenantBranding.useMutation({
    onSuccess: () => {
      toast.success("Branding saved", {
        description: "Changes will take effect on next page load for tenant users.",
      });
      setIsDirty(false);
      brandingQuery.refetch();
    },
    onError: (err: { message: string }) =>
      toast.error("Failed to save branding", { description: err.message }),
  });

  // Reset mutation
  const resetMutation = trpc.tenant.resetTenantBranding.useMutation({
    onSuccess: () => {
      toast.success("Branding reset to platform defaults");
      setForm(DEFAULT_FORM);
      setIsDirty(false);
      brandingQuery.refetch();
    },
    onError: (err: { message: string }) =>
      toast.error("Failed to reset branding", { description: err.message }),
  });

  // Populate form when branding data loads
  useEffect(() => {
    if (brandingQuery.data) {
      const b = brandingQuery.data;
      setForm({
        platformName: b.platformName ?? "",
        logoUrl: b.logoUrl ?? "",
        faviconUrl: b.faviconUrl ?? "",
        primaryColor: b.primaryColor ?? "#0A1628",
        accentColor: b.accentColor ?? "#D4A017",
        supportEmail: b.supportEmail ?? "",
        supportPhone: b.supportPhone ?? "",
        footerText: b.footerText ?? "",
        customCss: b.customCss ?? "",
        loginBannerUrl: b.loginBannerUrl ?? "",
      });
      setIsDirty(false);
    } else if (brandingQuery.isFetched && !brandingQuery.data) {
      // No branding yet — reset to defaults
      setForm(DEFAULT_FORM);
      setIsDirty(false);
    }
  }, [brandingQuery.data, brandingQuery.isFetched]);

  function update(field: keyof BrandingForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
  }

  function handleSave() {
    if (!selectedTenantId) {
      toast.error("Please select a tenant first");
      return;
    }
    if (form.primaryColor && !isValidHex(form.primaryColor)) {
      toast.error("Primary colour must be a valid hex code (e.g. #0A1628)");
      return;
    }
    if (form.accentColor && !isValidHex(form.accentColor)) {
      toast.error("Accent colour must be a valid hex code (e.g. #D4A017)");
      return;
    }
    if (form.logoUrl && !isValidUrl(form.logoUrl)) {
      toast.error("Logo URL is not a valid URL");
      return;
    }
    if (form.faviconUrl && !isValidUrl(form.faviconUrl)) {
      toast.error("Favicon URL is not a valid URL");
      return;
    }
    if (form.loginBannerUrl && !isValidUrl(form.loginBannerUrl)) {
      toast.error("Login banner URL is not a valid URL");
      return;
    }
    upsertMutation.mutate({
      tenantId: selectedTenantId,
      platformName: form.platformName || undefined,
      logoUrl: form.logoUrl || null,
      faviconUrl: form.faviconUrl || null,
      primaryColor: form.primaryColor || undefined,
      accentColor: form.accentColor || undefined,
      supportEmail: form.supportEmail || null,
      supportPhone: form.supportPhone || null,
      footerText: form.footerText || null,
      customCss: form.customCss || null,
      loginBannerUrl: form.loginBannerUrl || null,
    });
  }

  const selectedTenant = tenantsQuery.data?.find((t) => t.id === selectedTenantId);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Palette size={24} className="text-primary" />
              White-Label Branding
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Customise the platform's visual identity, support contacts, and CSS overrides per tenant.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isDirty && (
              <Badge variant="outline" className="gap-1 text-amber-500 border-amber-500/50">
                <AlertTriangle size={12} />
                Unsaved changes
              </Badge>
            )}
            {!isDirty && brandingQuery.data && (
              <Badge variant="outline" className="gap-1 text-emerald-500 border-emerald-500/50">
                <CheckCircle size={12} />
                Saved
              </Badge>
            )}
          </div>
        </div>

        {/* Tenant selector */}
        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 size={16} className="text-primary" />
              Select Tenant
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {tenantsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw size={14} className="animate-spin" /> Loading tenants…
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <Select
                  value={selectedTenantId}
                  onValueChange={(v) => {
                    setSelectedTenantId(v);
                    setIsDirty(false);
                  }}
                >
                  <SelectTrigger className="w-72">
                    <SelectValue placeholder="Choose a tenant to configure…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(tenantsQuery.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        <span className="flex items-center gap-2">
                          {t.name}
                          <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">
                            {t.plan}
                          </Badge>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedTenant && (
                  <div className="text-xs text-muted-foreground">
                    {selectedTenant.country} · Status:{" "}
                    <span
                      className={
                        selectedTenant.status === "active"
                          ? "text-emerald-500"
                          : selectedTenant.status === "suspended"
                          ? "text-red-500"
                          : "text-amber-500"
                      }
                    >
                      {selectedTenant.status}
                    </span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {selectedTenantId && (
          <>
            {brandingQuery.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <RefreshCw size={14} className="animate-spin" /> Loading branding config…
              </div>
            )}

            {!brandingQuery.isLoading && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* ── Left column: form ── */}
                <div className="lg:col-span-2 space-y-6">

                  {/* Identity */}
                  <Card>
                    <CardHeader className="pb-3 pt-4 px-4">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Globe size={15} className="text-primary" />
                        Platform Identity
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-4">
                      <div className="space-y-1">
                        <Label className="text-xs">Platform Name</Label>
                        <Input
                          placeholder="e.g. Ghana TradeGateway"
                          value={form.platformName}
                          onChange={(e) => update("platformName", e.target.value)}
                          maxLength={128}
                          className="h-9 text-sm"
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Displayed in the browser tab, login page, and email notifications.
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Colours */}
                  <Card>
                    <CardHeader className="pb-3 pt-4 px-4">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Palette size={15} className="text-primary" />
                        Colour Palette
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <div className="grid grid-cols-2 gap-4">
                        {(
                          [
                            { field: "primaryColor" as const, label: "Primary Colour", hint: "Main background / nav colour" },
                            { field: "accentColor" as const, label: "Accent Colour", hint: "Buttons, highlights, links" },
                          ] as const
                        ).map(({ field, label, hint }) => (
                          <div key={field} className="space-y-2">
                            <Label className="text-xs">{label}</Label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={form[field]}
                                onChange={(e) => update(field, e.target.value)}
                                className="w-10 h-9 rounded border border-input cursor-pointer bg-transparent p-0.5"
                              />
                              <Input
                                value={form[field]}
                                onChange={(e) => update(field, e.target.value)}
                                placeholder="#000000"
                                maxLength={7}
                                className={`h-9 text-sm font-mono flex-1 ${
                                  form[field] && !isValidHex(form[field])
                                    ? "border-destructive"
                                    : ""
                                }`}
                              />
                            </div>
                            <p className="text-[11px] text-muted-foreground">{hint}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Assets */}
                  <Card>
                    <CardHeader className="pb-3 pt-4 px-4">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Image size={15} className="text-primary" />
                        Visual Assets
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-4">
                      {(
                        [
                          { field: "logoUrl" as const, label: "Logo URL", placeholder: "https://cdn.example.com/logo.png", hint: "Recommended: SVG or PNG, transparent background, min 200×60 px" },
                          { field: "faviconUrl" as const, label: "Favicon URL", placeholder: "https://cdn.example.com/favicon.ico", hint: "ICO or 32×32 PNG" },
                          { field: "loginBannerUrl" as const, label: "Login Banner URL", placeholder: "https://cdn.example.com/banner.jpg", hint: "Full-width banner shown on the login page (1920×400 px recommended)" },
                        ] as const
                      ).map(({ field, label, placeholder, hint }) => (
                        <div key={field} className="space-y-1">
                          <Label className="text-xs">{label}</Label>
                          <Input
                            placeholder={placeholder}
                            value={form[field]}
                            onChange={(e) => update(field, e.target.value)}
                            className={`h-9 text-sm ${
                              form[field] && !isValidUrl(form[field])
                                ? "border-destructive"
                                : ""
                            }`}
                          />
                          <p className="text-[11px] text-muted-foreground">{hint}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  {/* Support */}
                  <Card>
                    <CardHeader className="pb-3 pt-4 px-4">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Mail size={15} className="text-primary" />
                        Support Contacts
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Label className="text-xs flex items-center gap-1">
                            <Mail size={11} /> Support Email
                          </Label>
                          <Input
                            type="email"
                            placeholder="support@customs.gov"
                            value={form.supportEmail}
                            onChange={(e) => update("supportEmail", e.target.value)}
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs flex items-center gap-1">
                            <Phone size={11} /> Support Phone
                          </Label>
                          <Input
                            type="tel"
                            placeholder="+233 30 000 0000"
                            value={form.supportPhone}
                            onChange={(e) => update("supportPhone", e.target.value)}
                            className="h-9 text-sm"
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Footer */}
                  <Card>
                    <CardHeader className="pb-3 pt-4 px-4">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <FileText size={15} className="text-primary" />
                        Footer Text
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-2">
                      <Textarea
                        placeholder="© 2025 Ghana Revenue Authority. All rights reserved."
                        value={form.footerText}
                        onChange={(e) => update("footerText", e.target.value)}
                        maxLength={500}
                        rows={3}
                        className="text-sm resize-none"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        {form.footerText.length}/500 characters
                      </p>
                    </CardContent>
                  </Card>

                  {/* Custom CSS */}
                  <Card>
                    <CardHeader className="pb-3 pt-4 px-4">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Code2 size={15} className="text-primary" />
                        Custom CSS
                        <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">Advanced</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-2">
                      <Textarea
                        placeholder={`:root {\n  --custom-header-height: 64px;\n}\n.login-page {\n  background: linear-gradient(135deg, #0A1628, #1E3A5F);\n}`}
                        value={form.customCss}
                        onChange={(e) => update("customCss", e.target.value)}
                        maxLength={10000}
                        rows={8}
                        className="text-xs font-mono resize-y"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Injected into the <code>&lt;head&gt;</code> of all pages for this tenant. Use with caution — invalid CSS may break the UI.
                        {form.customCss.length > 0 && ` (${form.customCss.length}/10,000 chars)`}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* ── Right column: live preview ── */}
                <div className="space-y-4">
                  <Card className="sticky top-4">
                    <CardHeader className="pb-3 pt-4 px-4">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Eye size={15} className="text-primary" />
                        Live Preview
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-4">
                      {/* Colour swatches */}
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground font-medium">Colours</div>
                        <div className="flex gap-3">
                          <div className="space-y-1 flex-1">
                            <div
                              className="h-10 rounded-md border border-border"
                              style={{ backgroundColor: isValidHex(form.primaryColor) ? form.primaryColor : "#0A1628" }}
                            />
                            <div className="text-[10px] text-center text-muted-foreground">Primary</div>
                          </div>
                          <div className="space-y-1 flex-1">
                            <div
                              className="h-10 rounded-md border border-border"
                              style={{ backgroundColor: isValidHex(form.accentColor) ? form.accentColor : "#D4A017" }}
                            />
                            <div className="text-[10px] text-center text-muted-foreground">Accent</div>
                          </div>
                        </div>
                      </div>

                      <Separator />

                      {/* Mock nav bar */}
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground font-medium">Navigation Bar</div>
                        <div
                          className="rounded-md p-3 flex items-center gap-3"
                          style={{ backgroundColor: isValidHex(form.primaryColor) ? form.primaryColor : "#0A1628" }}
                        >
                          {form.logoUrl && isValidUrl(form.logoUrl) ? (
                            <img
                              src={form.logoUrl}
                              alt="Logo preview"
                              className="h-7 w-auto object-contain max-w-[80px]"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <div
                              className="h-7 w-20 rounded text-xs font-bold flex items-center justify-center"
                              style={{
                                backgroundColor: isValidHex(form.accentColor) ? form.accentColor : "#D4A017",
                                color: "#fff",
                              }}
                            >
                              {form.platformName || "Platform"}
                            </div>
                          )}
                          <div className="flex-1 flex gap-2">
                            {["Dashboard", "Declarations", "Reports"].map((item) => (
                              <div
                                key={item}
                                className="text-[10px] px-2 py-1 rounded"
                                style={{
                                  backgroundColor: isValidHex(form.accentColor) ? `${form.accentColor}30` : "#D4A01730",
                                  color: isValidHex(form.accentColor) ? form.accentColor : "#D4A017",
                                }}
                              >
                                {item}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <Separator />

                      {/* Mock button */}
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground font-medium">Primary Button</div>
                        <button
                          className="w-full py-2 rounded-md text-sm font-medium text-white"
                          style={{ backgroundColor: isValidHex(form.accentColor) ? form.accentColor : "#D4A017" }}
                        >
                          Submit Declaration
                        </button>
                      </div>

                      {/* Login banner preview */}
                      {form.loginBannerUrl && isValidUrl(form.loginBannerUrl) && (
                        <>
                          <Separator />
                          <div className="space-y-2">
                            <div className="text-xs text-muted-foreground font-medium">Login Banner</div>
                            <img
                              src={form.loginBannerUrl}
                              alt="Login banner preview"
                              className="w-full h-16 object-cover rounded-md border border-border"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          </div>
                        </>
                      )}

                      {/* Footer preview */}
                      {form.footerText && (
                        <>
                          <Separator />
                          <div className="space-y-2">
                            <div className="text-xs text-muted-foreground font-medium">Footer</div>
                            <div
                              className="rounded-md p-2 text-[10px] text-center"
                              style={{ backgroundColor: isValidHex(form.primaryColor) ? form.primaryColor : "#0A1628", color: "#94a3b8" }}
                            >
                              {form.footerText}
                            </div>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>

                  {/* Action buttons */}
                  <div className="space-y-2">
                    <Button
                      className="w-full gap-2"
                      onClick={handleSave}
                      disabled={upsertMutation.isPending || !isDirty}
                    >
                      {upsertMutation.isPending ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : (
                        <Save size={14} />
                      )}
                      {upsertMutation.isPending ? "Saving…" : "Save Branding"}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full gap-2 text-muted-foreground"
                      onClick={() => setResetDialogOpen(true)}
                      disabled={resetMutation.isPending}
                    >
                      <RotateCcw size={14} />
                      Reset to Defaults
                    </Button>
                  </div>

                  {/* Last updated info */}
                  {brandingQuery.data?.updatedAt && (
                    <p className="text-[11px] text-muted-foreground text-center">
                      Last saved: {new Date(brandingQuery.data.updatedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {!selectedTenantId && !tenantsQuery.isLoading && (
          <Card className="border-dashed">
            <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
              <Palette size={40} className="text-muted-foreground/40" />
              <div className="text-muted-foreground text-sm">
                Select a tenant above to configure its white-label branding.
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Reset confirmation dialog */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Branding to Defaults?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete all custom branding for{" "}
              <strong>{selectedTenant?.name ?? "this tenant"}</strong> and restore the platform's
              default appearance. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setResetDialogOpen(false);
                resetMutation.mutate({ tenantId: selectedTenantId });
              }}
            >
              Reset Branding
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Full-screen preview modal */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
          onClick={() => setPreviewOpen(false)}
        >
          <div className="bg-background rounded-lg p-6 max-w-2xl w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Full Preview</h2>
              <Button variant="ghost" size="sm" onClick={() => setPreviewOpen(false)}>
                ✕
              </Button>
            </div>
            <div className="text-sm text-muted-foreground">
              Full-screen preview is available after saving — tenant users will see the updated branding on next login.
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
