"use client";

import { useEffect, useState } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export default function Home() {
  const [status, setStatus] = useState<string>("Loading...");

  useEffect(() => {
    fetch(`${BACKEND_URL}/health`)
      .then((res) => res.json())
      .then((data) => setStatus(data.status || "error"))
      .catch(() => setStatus("backend offline"));
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-gradient-to-tr from-indigo-950 via-slate-900 to-violet-950 text-white relative overflow-hidden">
      {/* Dynamic Background Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse delay-700"></div>

      <div className="z-10 max-w-xl w-full flex flex-col items-center gap-8 text-center">
        {/* Title */}
        <div>
          <h1 className="text-5xl font-extrabold tracking-tight bg-gradient-to-r from-violet-300 via-indigo-200 to-cyan-300 bg-clip-text text-transparent drop-shadow-md">
            Minim Music Academy
          </h1>
          <p className="text-slate-400 mt-2 text-sm uppercase tracking-widest font-semibold">
            Premium Subscription Learning
          </p>
        </div>

        {/* Glassmorphic Card */}
        <div className="w-full p-8 rounded-3xl bg-white/10 backdrop-blur-xl border border-white/20 shadow-[0_8px_32px_0_rgba(31,38,135,0.37)] transition-all duration-300 hover:border-white/30">
          <h2 className="text-xl font-bold mb-4 text-slate-200">System Status</h2>
          
          <div className="flex flex-col items-center gap-4">
            <p className="text-slate-300 text-sm">
              Connecting client app to backend API gateway...
            </p>
            
            <div className="flex items-center gap-2">
              <span className="relative flex h-3.5 w-3.5">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  status === "ok" ? "bg-emerald-400" : "bg-rose-400"
                }`}></span>
                <span className={`relative inline-flex rounded-full h-3.5 w-3.5 ${
                  status === "ok" ? "bg-emerald-500" : "bg-rose-500"
                }`}></span>
              </span>
              <span className="font-semibold text-slate-300">Backend API:</span>
              <span className={`px-3 py-1 rounded-full font-bold text-xs uppercase tracking-wider ${
                status === "ok" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
              }`}>
                {status}
              </span>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <p className="text-xs text-slate-500">
          Minim Music Academy &copy; 2026. All rights reserved.
        </p>
      </div>
    </main>
  );
}
