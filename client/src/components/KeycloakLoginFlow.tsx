/**
 * TradeGateway NGSWTP — Keycloak PKCE Login Flow Simulator
 * Design: Sovereign Blueprint — deep navy + gold, Playfair Display headings
 *
 * Simulates the full Keycloak PKCE authentication flow:
 * 1. Authorization Request (PKCE code_challenge)
 * 2. Trader Login (username + password)
 * 3. MFA Challenge (TOTP)
 * 4. Authorization Code Exchange
 * 5. JWT Token Issuance
 * 6. Role-Based Access Control (RBAC) demo
 * 7. Refresh Token flow
 */

import { useState, useEffect } from "react";
import { Shield, Key, Smartphone, CheckCircle, Lock, User, RefreshCw, Eye, EyeOff, ChevronRight, AlertTriangle, Zap } from "lucide-react";

type FlowStep = "idle" | "pkce-init" | "login-form" | "mfa-challenge" | "token-exchange" | "jwt-issued" | "rbac-demo" | "refresh-demo";

interface Role {
  name: string;
  description: string;
  permissions: string[];
  color: string;
}

const ROLES: Role[] = [
  {
    name: "TRADER",
    description: "Registered importer/exporter",
    permissions: ["declaration:submit", "declaration:read:own", "payment:initiate", "permit:read:own", "document:upload"],
    color: "text-blue-400",
  },
  {
    name: "CUSTOMS_OFFICER",
    description: "Customs Authority examiner",
    permissions: ["declaration:read:all", "declaration:approve", "declaration:flag", "inspection:create", "audit:read"],
    color: "text-emerald-400",
  },
  {
    name: "REVENUE_OFFICER",
    description: "Revenue Authority assessor",
    permissions: ["tariff:read", "tariff:override", "payment:reconcile", "exemption:approve", "pca:initiate"],
    color: "text-amber-400",
  },
  {
    name: "OGA_OFFICER",
    description: "Other Government Agency officer",
    permissions: ["declaration:read:oga-scope", "permit:issue:oga", "certificate:issue", "inspection:schedule"],
    color: "text-purple-400",
  },
  {
    name: "AEO_MANAGER",
    description: "Authorized Economic Operator manager",
    permissions: ["aeo:apply", "aeo:read:own", "declaration:fasttrack", "audit:submit:self", "benefit:claim"],
    color: "text-cyan-400",
  },
  {
    name: "SYSTEM_ADMIN",
    description: "Platform administrator",
    permissions: ["*:*", "user:manage", "role:assign", "config:update", "audit:read:all"],
    color: "text-red-400",
  },
];

const DEMO_USERS = [
  { username: "kwame.asante@accra-imports.gh", role: "TRADER", name: "Kwame Asante", org: "Accra Imports Ltd" },
  { username: "officer.mensah@customs.gov.gh", role: "CUSTOMS_OFFICER", name: "Ama Mensah", org: "Ghana Customs Authority" },
  { username: "auditor.boateng@gra.gov.gh", role: "REVENUE_OFFICER", name: "Kofi Boateng", org: "Ghana Revenue Authority" },
];

function generateCodeVerifier(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  return Array.from({ length: 43 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function generateBase64url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateJWT(user: typeof DEMO_USERS[0]): string {
  const header = generateBase64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "tradegateway-2026-03" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = generateBase64url(JSON.stringify({
    iss: "https://auth.tradegateway.gov/realms/tradegateway",
    sub: `user-${Math.random().toString(36).slice(2, 10)}`,
    aud: ["tradegateway-api", "declaration-svc", "payment-svc"],
    exp: now + 300,
    iat: now,
    auth_time: now,
    jti: Math.random().toString(36).slice(2, 18),
    typ: "Bearer",
    azp: "tradegateway-web",
    session_state: Math.random().toString(36).slice(2, 18),
    acr: "2",
    realm_access: { roles: [user.role, "offline_access", "uma_authorization"] },
    resource_access: {
      "tradegateway-api": { roles: [user.role] },
      "declaration-svc": { roles: [user.role] },
    },
    scope: "openid profile email",
    email_verified: true,
    name: user.name,
    preferred_username: user.username,
    given_name: user.name.split(" ")[0],
    family_name: user.name.split(" ")[1],
    email: user.username,
    organization: user.org,
    mfa_verified: true,
  }));
  const sig = generateBase64url(`sig-${Math.random().toString(36).slice(2, 30)}`);
  return `${header}.${payload}.${sig}`;
}

export default function KeycloakLoginFlow() {
  const [step, setStep] = useState<FlowStep>("idle");
  const [selectedUser, setSelectedUser] = useState(DEMO_USERS[0]);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [totpError, setTotpError] = useState(false);
  const [codeVerifier] = useState(generateCodeVerifier);
  const [codeChallenge, setCodeChallenge] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [jwt, setJwt] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [selectedRole, setSelectedRole] = useState<Role>(ROLES[0]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    // Generate PKCE code_challenge (SHA-256 of verifier, base64url encoded)
    // In a real implementation this uses SubtleCrypto; here we simulate it
    setCodeChallenge(generateBase64url(codeVerifier.slice(0, 32)));
  }, [codeVerifier]);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const startFlow = () => {
    setStep("pkce-init");
    setIsAnimating(true);
    setTimeout(() => {
      setIsAnimating(false);
      setStep("login-form");
    }, 1800);
  };

  const submitLogin = () => {
    if (!password) return;
    setStep("mfa-challenge");
    setCountdown(30);
  };

  const submitMFA = () => {
    // Accept any 6-digit code for demo
    if (totpCode.length !== 6) {
      setTotpError(true);
      return;
    }
    setTotpError(false);
    setStep("token-exchange");
    const code = `auth-code-${Math.random().toString(36).slice(2, 18)}`;
    setAuthCode(code);
    setTimeout(() => {
      const token = generateJWT(selectedUser);
      const refresh = `refresh-${Math.random().toString(36).slice(2, 40)}`;
      setJwt(token);
      setRefreshToken(refresh);
      setStep("jwt-issued");
      // Set selected role to match user
      const userRole = ROLES.find((r) => r.name === selectedUser.role) || ROLES[0];
      setSelectedRole(userRole);
    }, 1200);
  };

  const reset = () => {
    setStep("idle");
    setPassword("");
    setTotpCode("");
    setTotpError(false);
    setAuthCode("");
    setJwt("");
    setRefreshToken("");
    setCountdown(0);
  };

  const jwtParts = jwt.split(".");

  return (
    <section id="keycloak-flow" className="py-20 bg-[#0A1628]">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-10 bg-[#D4A017] rounded-full" />
            <span className="text-[#D4A017] text-sm font-semibold tracking-widest uppercase">
              Identity & Access Management
            </span>
          </div>
          <h2 className="font-['Playfair_Display'] text-4xl font-bold text-white mb-4">
            Keycloak PKCE Authentication Flow
          </h2>
          <p className="text-slate-400 text-lg max-w-3xl">
            Interactive simulation of the full OAuth 2.0 + PKCE authentication flow backed by Keycloak.
            Experience trader login, TOTP MFA challenge, JWT issuance, and role-based access control
            as implemented in the TradeGateway production environment.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left: Flow Steps */}
          <div className="space-y-4">
            {/* User Selection */}
            <div className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl p-5">
              <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-3">Select Demo User</div>
              <div className="space-y-2">
                {DEMO_USERS.map((user) => (
                  <button
                    key={user.username}
                    onClick={() => { setSelectedUser(user); reset(); }}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                      selectedUser.username === user.username
                        ? "border-[#D4A017]/60 bg-[#D4A017]/5"
                        : "border-slate-700/30 hover:border-slate-600/50"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-slate-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{user.name}</div>
                      <div className="text-xs text-slate-500 truncate">{user.username}</div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded border ${
                      ROLES.find((r) => r.name === user.role)?.color || "text-slate-400"
                    } bg-slate-800/50 border-slate-700/30`}>
                      {user.role}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Flow Steps Indicator */}
            <div className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl p-5">
              <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-4">Authentication Flow</div>
              {[
                { id: "pkce-init", icon: Key, label: "1. PKCE Initialization", desc: "Generate code_verifier + code_challenge (S256)" },
                { id: "login-form", icon: User, label: "2. Credential Submission", desc: "Username + password to Keycloak /auth endpoint" },
                { id: "mfa-challenge", icon: Smartphone, label: "3. TOTP MFA Challenge", desc: "Time-based OTP via authenticator app" },
                { id: "token-exchange", icon: RefreshCw, label: "4. Authorization Code Exchange", desc: "POST /token with code + code_verifier" },
                { id: "jwt-issued", icon: Shield, label: "5. JWT Token Issuance", desc: "RS256-signed access + refresh tokens" },
                { id: "rbac-demo", icon: Lock, label: "6. RBAC Enforcement", desc: "Role-based permission checking per service" },
              ].map((s, i) => {
                const steps: FlowStep[] = ["pkce-init", "login-form", "mfa-challenge", "token-exchange", "jwt-issued", "rbac-demo"];
                const currentIdx = steps.indexOf(step);
                const thisIdx = steps.indexOf(s.id as FlowStep);
                const isDone = currentIdx > thisIdx;
                const isActive = step === s.id;
                return (
                  <div key={s.id} className={`flex items-start gap-3 mb-3 last:mb-0 ${isDone ? "opacity-100" : isActive ? "opacity-100" : "opacity-40"}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      isDone ? "bg-emerald-600" : isActive ? "bg-[#D4A017] animate-pulse" : "bg-slate-700"
                    }`}>
                      {isDone ? <CheckCircle className="w-4 h-4 text-white" /> : <s.icon className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <div>
                      <div className={`text-sm font-semibold ${isActive ? "text-[#D4A017]" : isDone ? "text-emerald-400" : "text-slate-400"}`}>
                        {s.label}
                      </div>
                      <div className="text-xs text-slate-500">{s.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Interactive Panel */}
          <div>
            {/* IDLE */}
            {step === "idle" && (
              <div className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl p-8 flex flex-col items-center justify-center min-h-[400px] text-center">
                <div className="w-16 h-16 rounded-2xl bg-[#D4A017]/10 border border-[#D4A017]/20 flex items-center justify-center mb-6">
                  <Shield className="w-8 h-8 text-[#D4A017]" />
                </div>
                <h3 className="font-['Playfair_Display'] text-2xl font-bold text-white mb-3">
                  Keycloak Authentication
                </h3>
                <p className="text-slate-400 text-sm mb-8 max-w-xs">
                  Simulate the full PKCE OAuth 2.0 flow as experienced by a trader logging into the TradeGateway portal.
                </p>
                <button
                  onClick={startFlow}
                  className="flex items-center gap-2 bg-[#D4A017] hover:bg-[#B8860B] text-[#0A1628] font-bold px-8 py-3 rounded-xl transition-colors"
                >
                  <Key className="w-4 h-4" />
                  Start Authentication Flow
                </button>
                <div className="mt-6 text-xs text-slate-600">
                  Realm: tradegateway · Client: tradegateway-web · Flow: browser + PKCE
                </div>
              </div>
            )}

            {/* PKCE INIT */}
            {step === "pkce-init" && (
              <div className="bg-[#0D1E35] border border-[#D4A017]/30 rounded-2xl p-6 min-h-[400px]">
                <div className="flex items-center gap-2 mb-4">
                  <Key className="w-5 h-5 text-[#D4A017] animate-pulse" />
                  <span className="text-[#D4A017] font-semibold">Generating PKCE Parameters...</span>
                </div>
                <div className="space-y-3">
                  <div className="bg-slate-900/60 rounded-xl p-4">
                    <div className="text-xs text-slate-500 mb-1">code_verifier (43-char random string)</div>
                    <div className="text-xs font-mono text-emerald-400 break-all">{codeVerifier}</div>
                  </div>
                  <div className="bg-slate-900/60 rounded-xl p-4">
                    <div className="text-xs text-slate-500 mb-1">code_challenge = BASE64URL(SHA256(verifier))</div>
                    <div className="text-xs font-mono text-cyan-400 break-all">{codeChallenge}</div>
                  </div>
                  <div className="bg-slate-900/60 rounded-xl p-4">
                    <div className="text-xs text-slate-500 mb-1">Authorization Request URL</div>
                    <div className="text-xs font-mono text-slate-300 break-all leading-relaxed">
                      {`https://auth.tradegateway.gov/realms/tradegateway/protocol/openid-connect/auth?client_id=tradegateway-web&response_type=code&scope=openid+profile+email&redirect_uri=https://portal.tradegateway.gov/callback&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${generateBase64url("state-" + Date.now())}`}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Redirecting to Keycloak login page...
                </div>
              </div>
            )}

            {/* LOGIN FORM */}
            {step === "login-form" && (
              <div className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl p-6 min-h-[400px]">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-8 h-8 rounded-lg bg-[#D4A017]/10 flex items-center justify-center">
                    <Shield className="w-4 h-4 text-[#D4A017]" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">TradeGateway™ NGSWTP</div>
                    <div className="text-xs text-slate-500">Powered by Keycloak 24.0</div>
                  </div>
                </div>
                <div className="text-xs text-slate-500 bg-slate-800/50 rounded-lg px-3 py-2 mb-5 font-mono break-all">
                  realm: tradegateway · flow: browser · PKCE: S256
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Username / Email</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        value={selectedUser.username}
                        readOnly
                        className="w-full bg-slate-800/50 border border-slate-600/50 rounded-xl pl-10 pr-4 py-3 text-white text-sm focus:outline-none focus:border-[#D4A017]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Password</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && password && submitLogin()}
                        placeholder="Enter any password to continue"
                        className="w-full bg-slate-800/50 border border-slate-600/50 rounded-xl pl-10 pr-10 py-3 text-white text-sm focus:outline-none focus:border-[#D4A017] placeholder-slate-600"
                      />
                      <button
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={submitLogin}
                    disabled={!password}
                    className="w-full bg-[#D4A017] hover:bg-[#B8860B] disabled:opacity-40 text-[#0A1628] font-bold py-3 rounded-xl transition-colors"
                  >
                    Sign In
                  </button>
                </div>
                <div className="mt-4 text-xs text-slate-600 text-center">
                  SAML 2.0 federation available for national ID providers
                </div>
              </div>
            )}

            {/* MFA CHALLENGE */}
            {step === "mfa-challenge" && (
              <div className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl p-6 min-h-[400px]">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-blue-900/30 border border-blue-700/30 flex items-center justify-center">
                    <Smartphone className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">Two-Factor Authentication</div>
                    <div className="text-xs text-slate-500">TOTP via Google Authenticator / Authy</div>
                  </div>
                </div>
                <p className="text-sm text-slate-400 mb-6">
                  Open your authenticator app and enter the 6-digit code for <span className="text-white font-semibold">TradeGateway™ NGSWTP</span>.
                </p>
                {/* Simulated TOTP display */}
                <div className="bg-slate-900/60 rounded-xl p-4 mb-5 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Current TOTP (demo)</div>
                    <div className="text-2xl font-mono font-bold text-[#D4A017] tracking-widest">
                      {Math.floor(100000 + Math.random() * 900000).toString().replace(/(\d{3})(\d{3})/, "$1 $2")}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500 mb-1">Expires in</div>
                    <div className={`text-lg font-mono font-bold ${countdown <= 10 ? "text-red-400" : "text-emerald-400"}`}>
                      {countdown}s
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={totpCode}
                    onChange={(e) => { setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setTotpError(false); }}
                    onKeyDown={(e) => e.key === "Enter" && submitMFA()}
                    placeholder="Enter 6-digit code"
                    maxLength={6}
                    className={`w-full bg-slate-800/50 border rounded-xl px-4 py-3 text-white text-center text-2xl font-mono tracking-[0.5em] focus:outline-none transition-colors ${
                      totpError ? "border-red-500" : "border-slate-600/50 focus:border-[#D4A017]"
                    }`}
                  />
                  {totpError && (
                    <div className="flex items-center gap-2 text-red-400 text-xs">
                      <AlertTriangle className="w-3 h-3" />
                      Please enter a 6-digit code (any 6 digits work in this demo)
                    </div>
                  )}
                  <button
                    onClick={submitMFA}
                    className="w-full bg-[#D4A017] hover:bg-[#B8860B] text-[#0A1628] font-bold py-3 rounded-xl transition-colors"
                  >
                    Verify Code
                  </button>
                </div>
                <div className="mt-4 text-xs text-slate-600 text-center">
                  MFA required for all roles · WebAuthn (FIDO2) also supported
                </div>
              </div>
            )}

            {/* TOKEN EXCHANGE */}
            {step === "token-exchange" && (
              <div className="bg-[#0D1E35] border border-[#D4A017]/30 rounded-2xl p-6 min-h-[400px]">
                <div className="flex items-center gap-2 mb-4">
                  <RefreshCw className="w-5 h-5 text-[#D4A017] animate-spin" />
                  <span className="text-[#D4A017] font-semibold">Exchanging Authorization Code...</span>
                </div>
                <div className="space-y-3">
                  <div className="bg-slate-900/60 rounded-xl p-4">
                    <div className="text-xs text-slate-500 mb-1">Authorization Code (one-time use)</div>
                    <div className="text-xs font-mono text-amber-400 break-all">{authCode}</div>
                  </div>
                  <div className="bg-slate-900/60 rounded-xl p-4">
                    <div className="text-xs text-slate-500 mb-2">POST /token Request</div>
                    <pre className="text-xs font-mono text-slate-300 leading-relaxed">{`grant_type=authorization_code
code=${authCode.slice(0, 20)}...
redirect_uri=https://portal.tradegateway.gov/callback
client_id=tradegateway-web
code_verifier=${codeVerifier.slice(0, 20)}...`}</pre>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Keycloak verifying code_verifier against stored code_challenge...
                </div>
              </div>
            )}

            {/* JWT ISSUED */}
            {(step === "jwt-issued" || step === "rbac-demo" || step === "refresh-demo") && (
              <div className="bg-[#0D1E35] border border-emerald-700/30 rounded-2xl p-6 min-h-[400px]">
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                  <span className="text-emerald-400 font-semibold">Authentication Successful</span>
                </div>

                {/* JWT Token Display */}
                <div className="bg-slate-900/60 rounded-xl p-4 mb-4">
                  <div className="text-xs text-slate-500 mb-2">RS256-Signed JWT Access Token</div>
                  <div className="text-xs font-mono break-all leading-relaxed">
                    <span className="text-red-400">{jwtParts[0]}</span>
                    <span className="text-slate-500">.</span>
                    <span className="text-amber-400">{jwtParts[1]}</span>
                    <span className="text-slate-500">.</span>
                    <span className="text-blue-400">{jwtParts[2]}</span>
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-slate-600">
                    <span className="text-red-400">■ Header</span>
                    <span className="text-amber-400">■ Payload</span>
                    <span className="text-blue-400">■ Signature</span>
                  </div>
                </div>

                {/* Token Claims */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {[
                    { label: "Subject", value: selectedUser.name },
                    { label: "Role", value: selectedUser.role },
                    { label: "Issuer", value: "auth.tradegateway.gov" },
                    { label: "Algorithm", value: "RS256" },
                    { label: "Expires", value: "5 minutes" },
                    { label: "MFA", value: "TOTP verified" },
                  ].map((claim) => (
                    <div key={claim.label} className="bg-slate-800/50 rounded-lg p-2">
                      <div className="text-xs text-slate-500">{claim.label}</div>
                      <div className="text-xs text-white font-semibold truncate">{claim.value}</div>
                    </div>
                  ))}
                </div>

                {/* RBAC Demo */}
                <div className="border-t border-slate-700/30 pt-4">
                  <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-3">
                    Role Permissions — {selectedUser.role}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(ROLES.find((r) => r.name === selectedUser.role)?.permissions || []).map((perm) => (
                      <span key={perm} className="text-xs bg-emerald-900/30 text-emerald-400 border border-emerald-700/30 px-2 py-0.5 rounded font-mono">
                        {perm}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 mt-4">
                  <button
                    onClick={reset}
                    className="flex-1 flex items-center justify-center gap-2 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 py-2.5 rounded-xl text-sm transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Try Another User
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RBAC Matrix */}
        <div className="mt-8 bg-[#0D1E35] border border-slate-700/50 rounded-2xl p-6">
          <div className="text-sm font-semibold text-white mb-4">Role-Based Access Control Matrix</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700/30">
                  <th className="text-left text-slate-500 pb-2 pr-4">Role</th>
                  <th className="text-left text-slate-500 pb-2 pr-4">Description</th>
                  <th className="text-left text-slate-500 pb-2">Key Permissions</th>
                </tr>
              </thead>
              <tbody>
                {ROLES.map((role) => (
                  <tr key={role.name} className="border-b border-slate-800/50">
                    <td className={`py-2.5 pr-4 font-mono font-bold ${role.color}`}>{role.name}</td>
                    <td className="py-2.5 pr-4 text-slate-400">{role.description}</td>
                    <td className="py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {role.permissions.slice(0, 3).map((p) => (
                          <span key={p} className="bg-slate-800/50 text-slate-400 border border-slate-700/30 px-1.5 py-0.5 rounded font-mono">
                            {p}
                          </span>
                        ))}
                        {role.permissions.length > 3 && (
                          <span className="text-slate-600">+{role.permissions.length - 3} more</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function RotateCcw({ className }: { className?: string }) {
  return <RefreshCw className={className} />;
}
