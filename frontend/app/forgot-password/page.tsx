"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE } from "../../lib/auth";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      const data = await res.json();
      setMessage(data.message || "A reset link has been logged to the console.");
    } catch {
      setError("Could not connect to the server. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center relative overflow-hidden bg-gradient-to-tr from-indigo-950 via-slate-900 to-violet-950 text-white">
      {/* Background Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-500/15 rounded-full blur-3xl animate-pulse delay-1000 pointer-events-none" />

      <div className="relative z-10 w-full max-w-md px-4">
        {/* Logo / Brand */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-xl mb-4 text-2xl">
            🎹
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-violet-300 via-indigo-200 to-cyan-300 bg-clip-text text-transparent">
            Reset Password
          </h1>
          <p className="text-slate-400 text-sm mt-1 uppercase tracking-widest font-medium">
            Minim Music Academy
          </p>
        </div>

        {/* Card */}
        <div className="bg-white/8 backdrop-blur-2xl border border-white/15 rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] p-8">
          <h2 className="text-xl font-bold text-slate-100 mb-6 text-center">
            Recover your account
          </h2>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <p className="text-xs text-slate-400 leading-relaxed">
              Enter your email address and we will generate a password reset link. Since this is in test mode, the link will be printed directly to the backend server's terminal log.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
                Email Address
              </label>
              <input
                id="reset-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-500/60 transition-all text-sm"
              />
            </div>

            {error && (
              <div className="px-4 py-3 rounded-xl bg-rose-500/15 border border-rose-500/25 text-rose-300 text-sm">
                {error}
              </div>
            )}

            {message && (
              <div className="px-4 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-sm">
                {message}
              </div>
            )}

            <button
              id="reset-submit"
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-white text-sm tracking-wide shadow-lg shadow-indigo-500/25 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Generating...
                </span>
              ) : (
                "Send Reset Link →"
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-white/10">
            <p className="text-xs text-slate-500 text-center">
              Remember your password?{" "}
              <a
                href="/login"
                className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
              >
                Sign in
              </a>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          © 2026 Minim Music Academy. All rights reserved.
        </p>
      </div>
    </main>
  );
}
