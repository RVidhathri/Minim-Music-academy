"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE } from "../../lib/auth";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Signup failed. Please try again.");
        setLoading(false);
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        router.push("/login");
      }, 2000);
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

      <div className="relative z-10 w-full max-w-md px-4 py-8">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-xl mb-4 text-2xl">
            🎹
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-violet-300 via-indigo-200 to-cyan-300 bg-clip-text text-transparent">
            Join the Academy
          </h1>
          <p className="text-slate-400 text-sm mt-1 uppercase tracking-widest font-medium">
            Minim Music Academy
          </p>
        </div>

        {/* Signup Card */}
        <div className="bg-white/8 backdrop-blur-2xl border border-white/15 rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] p-8">
          {success ? (
            <div className="text-center py-8 space-y-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xl font-bold">
                ✓
              </div>
              <h2 className="text-xl font-bold text-slate-100">Account Created!</h2>
              <p className="text-slate-400 text-sm">
                Redirecting you to the login screen...
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold text-slate-100 mb-6 text-center">
                Create a new account
              </h2>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                    Full Name
                  </label>
                  <input
                    id="signup-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-500/60 transition-all text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                    Email Address
                  </label>
                  <input
                    id="signup-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-500/60 transition-all text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                    Password
                  </label>
                  <input
                    id="signup-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-500/60 transition-all text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                    Join As
                  </label>
                  <select
                    id="signup-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-500/60 transition-all text-sm"
                  >
                    <option value="member">Student (Member)</option>
                    <option value="admin">Administrator (Admin)</option>
                  </select>
                </div>

                {error && (
                  <div className="px-4 py-3 rounded-xl bg-rose-500/15 border border-rose-500/25 text-rose-300 text-sm">
                    {error}
                  </div>
                )}

                <button
                  id="signup-submit"
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 mt-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-white text-sm tracking-wide shadow-lg shadow-indigo-500/25 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Creating account...
                    </span>
                  ) : (
                    "Register →"
                  )}
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-white/10">
                <p className="text-xs text-slate-500 text-center">
                  Already have an account?{" "}
                  <a
                    href="/login"
                    className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
                  >
                    Sign in
                  </a>
                </p>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          © 2026 Minim Music Academy. All rights reserved.
        </p>
      </div>
    </main>
  );
}
