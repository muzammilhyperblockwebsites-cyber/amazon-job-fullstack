"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import StatsBar from "./StatsBar";
import MonitorControl, { type MonitorControlHandle } from "./MonitorControl";
import type { JobFeedHandle } from "./JobFeed";
import dynamic from "next/dynamic";
import PreferencesPanel from "./PreferencesPanel";

// Lazy-load JobFeed without SSR
const JobFeed = dynamic(() => import("./JobFeed"), { ssr: false });

export default function Dashboard() {
  const feedRef = useRef<JobFeedHandle>(null);
  const monitorRef = useRef<MonitorControlHandle>(null);

  const [authChecking, setAuthChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState<string>("");

  // Login form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [openAmazonSso, setOpenAmazonSso] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/auth', { cache: 'no-store' })
      .then(async (res) => { if (!res.ok) throw new Error(); return res.json(); })
      .then((data) => { setAuthenticated(Boolean(data.authenticated)); setLoggedInUser(data.user || ''); })
      .catch(() => setAuthenticated(false))
      .finally(() => setAuthChecking(false));
  }, []);
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoginError(null); setLoginLoading(true);
    try {
      const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }) });
      const data = await response.json();
      if (!response.ok || !data.authenticated) throw new Error(data.error || 'Login failed');
      setAuthenticated(true); setLoggedInUser(data.user); setPassword('');
      if (openAmazonSso) window.open('https://www.jobsatamazon.co.uk/app#/login', '_blank', 'noopener,noreferrer');
    } catch (error) { setLoginError(error instanceof Error ? error.message : 'Login service unavailable. Please retry.'); }
    finally { setLoginLoading(false); }
  };
  const handleLogout = async () => {
    try {
      const response = await fetch('/api/auth', { method: 'DELETE' });
      if (!response.ok) throw new Error('Logout failed');
      setAuthenticated(false); setLoggedInUser('');
    } catch { window.alert('Logout failed. Please retry.'); }
  };
  // Called by MonitorControl the instant SSE reports new jobs
  const handleNewJobs = useCallback(() => {
    feedRef.current?.refresh();
  }, []);

  // Called when user clicks Save Filters in PreferencesPanel
  const handleFiltersSaved = useCallback((preOpenedTab?: Window | null) => {
    feedRef.current?.refresh();
    monitorRef.current?.pollAndAutoOpenBestMatch(preOpenedTab);
  }, []);

  if (authChecking) {
    return (
      <main className="min-h-screen bg-[#131921] flex items-center justify-center p-4">
        <div className="text-center text-white">
          <div className="text-4xl mb-3 animate-bounce">📦</div>
          <p className="text-sm text-gray-300 font-medium">
            Checking tool authentication…
          </p>
        </div>
      </main>
    );
  }

  // ── MANDATORY LOGIN PAGE GATE (Tool will NOT run until logged in) ──────────
  if (!authenticated) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-[#131921] via-[#1b2430] to-[#232F3E] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
          {/* Top Banner */}
          <div className="bg-gradient-to-r from-[#232F3E] to-[#131921] px-6 py-6 text-white text-center border-b-4 border-orange-500">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-orange-500/20 border border-orange-400/30 text-3xl mb-3">
              📦
            </div>
            <h1 className="text-xl font-bold tracking-tight">
              Amazon UK Job Monitor
            </h1>
            <p className="text-xs text-gray-300 mt-1">
              Login required to unlock live monitoring &amp; auto-apply
            </p>
          </div>

          {/* Login Form */}
          <form onSubmit={handleLoginSubmit} className="p-6 space-y-4">
            <div className="bg-orange-50 border border-orange-200 rounded-xl px-3.5 py-2.5 text-xs text-orange-900 flex items-start gap-2">
              <span className="text-base leading-none mt-0.5">🔒</span>
              <div>
                <strong>Tool Locked:</strong> Live job monitoring, filtering, and
                auto-apply are disabled until you sign in with valid tool
                credentials.
              </div>
            </div>

            {loginError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2">
                <span>⚠️</span>
                <span>{loginError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                Email or Username *
              </label>
              <input
                type="text"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@amazonmoniter.com"
                className="w-full border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                Password *
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your tool password"
                  className="w-full border border-gray-300 rounded-xl px-3.5 py-2.5 pr-16 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-500 hover:text-gray-800 px-2 py-1"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={openAmazonSso}
                onChange={(e) => setOpenAmazonSso(e.target.checked)}
                className="w-4 h-4 accent-orange-500 mt-0.5 rounded"
              />
              <span className="text-xs text-gray-600 leading-relaxed">
                Also open{" "}
                <strong className="text-gray-800">
                  Amazon UK Login (jobsatamazon.co.uk/app#/login)
                </strong>{" "}
                in a new tab. Sign in separately in the worker&apos;s Amazon browser
                when it opens your application.
              </span>
            </label>

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full py-3 rounded-xl font-bold text-sm text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 transition-all shadow-md hover:shadow-lg cursor-pointer"
            >
              {loginLoading ? "Signing in…" : "🔐 Sign In & Start Tool"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  // ── UNLOCKED DASHBOARD (Only renders & runs when authenticated) ────────────
  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-[#232F3E] to-[#131921] text-white px-6 py-4 shadow-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📦</span>
            <div>
              <h1 className="text-lg font-bold leading-none">
                Amazon Job Monitor
              </h1>
              <p className="text-xs text-gray-400 mt-0.5">
                United Kingdom • Live tracking &amp; Auto-Apply Redirect
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-xs bg-green-500/20 border border-green-400/30 text-green-300 px-3 py-1.5 rounded-full font-medium">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              {loggedInUser}
            </span>

            <a
              href="https://www.jobsatamazon.co.uk/app#/login"
              target="_blank"
              className="text-xs bg-white/10 hover:bg-white/20 text-orange-300 px-3 py-1.5 rounded-lg font-medium transition-colors"
              title="Open Amazon login. The PC worker keeps its own saved Amazon session."
            >
              🔑 Amazon UK Login ↗
            </a>

            <a
              href="https://www.jobsatamazon.co.uk/app#/jobSearch"
              target="_blank"
              className="text-xs text-gray-300 hover:text-white transition-colors"
            >
              JobsAtAmazon.co.uk ↗
            </a>

            <button
              type="button"
              onClick={handleLogout}
              className="text-xs bg-red-500/20 hover:bg-red-500/30 border border-red-400/30 text-red-200 px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer"
            >
              🚪 Logout
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats */}
        <StatsBar />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left — job feed (2/3 width) */}
          <div className="lg:col-span-2">
            {/* MonitorControl subscribes to SSE and calls onNewJobs when jobs arrive */}
            <MonitorControl ref={monitorRef} onNewJobs={handleNewJobs} />
            <JobFeed ref={feedRef} />
          </div>

          {/* Right — preferences (1/3 width) */}
          <div>
            <PreferencesPanel onSaved={handleFiltersSaved} />
          </div>
        </div>
      </div>
    </main>
  );
}
