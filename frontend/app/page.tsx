"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  getToken,
  getStoredUser,
  clearToken,
  getAuthHeaders,
  API_BASE,
  type AuthUser,
} from "../lib/auth";

interface SubscriptionInfo {
  status: string; // active, inactive, expired
  payment_status: string; // paid, pending, failed
  videos_released: number;
  next_release_date?: string;
  cycle_start_date?: string;
}

interface StudentVideo {
  id: number;
  title: string;
  sequence_order: number;
  is_unlocked: boolean;
  unlock_date: string | null;
}

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<string>("Loading...");
  const [subInfo, setSubInfo] = useState<SubscriptionInfo | null>(null);
  const [videos, setVideos] = useState<StudentVideo[]>([]);
  const [activeVideo, setActiveVideo] = useState<{id: number, url: string} | null>(null);
  const [loadingSub, setLoadingSub] = useState(false);
  const [showMockModal, setShowMockModal] = useState(false);
  const [mockOrderId, setMockOrderId] = useState("");
  const [mockAmount, setMockAmount] = useState(0);
  const [paying, setPaying] = useState(false);

  // Check health and user
  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((res) => res.json())
      .then((data) => setStatus(data.status || "error"))
      .catch(() => setStatus("backend offline"));

    const storedUser = getStoredUser();
    if (storedUser && getToken()) {
      setUser(storedUser);
    }
  }, []);

  const loadSubscription = useCallback(async () => {
    if (!getToken()) return false;
    try {
      const res = await fetch(`${API_BASE}/payments/subscription`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setSubInfo(data);
        return data.status; // return status string
      }
    } catch {
      console.error("Failed to load subscription info");
    }
    return false;
  }, []);

  const loadProgress = useCallback(async () => {
    if (!getToken()) return;
    try {
      const res = await fetch(`${API_BASE}/student/course-progress`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        setVideos(await res.json());
      }
    } catch (e) {
      console.error("Failed to load course progress", e);
    }
  }, []);

  const loadDashboardData = useCallback(async () => {
    setLoadingSub(true);
    const subStatus = await loadSubscription();
    if (subStatus === "active" || subStatus === "expired") {
      await loadProgress();
    }
    setLoadingSub(false);
  }, [loadSubscription, loadProgress]);

  // Fetch subscription if logged in
  useEffect(() => {
    if (user && user.role === "member") {
      loadDashboardData();
    }
  }, [user, loadDashboardData]);

  const logout = () => {
    clearToken();
    setUser(null);
    setSubInfo(null);
    setVideos([]);
    router.refresh();
  };

  const handleSubscribe = async () => {
    if (!user) {
      router.push("/login");
      return;
    }

    setPaying(true);
    try {
      // 1. Create Order
      const res = await fetch(`${API_BASE}/payments/create-order`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ plan_id: 1 }), // Default Premium Plan
      });

      if (!res.ok) {
        alert("Failed to initialize plan payment.");
        setPaying(false);
        return;
      }

      const orderData = await res.json();

      if (orderData.key_id === "dummy") {
        // Simulation Mode
        setMockOrderId(orderData.order_id);
        setMockAmount(orderData.amount);
        setShowMockModal(true);
        setPaying(false);
      } else {
        // Real Razorpay SDK Integration
        if (!(window as any).Razorpay) {
          const script = document.createElement("script");
          script.src = "https://checkout.razorpay.com/v1/checkout.js";
          script.async = true;
          script.onload = () => initiateRealRazorpay(orderData);
          document.body.appendChild(script);
        } else {
          initiateRealRazorpay(orderData);
        }
      }
    } catch {
      alert("Error contacting the payments gateway.");
      setPaying(false);
    }
  };

  const initiateRealRazorpay = (orderData: any) => {
    const options = {
      key: orderData.key_id,
      amount: orderData.amount,
      currency: orderData.currency,
      name: "Minim Music Academy",
      description: orderData.plan_name,
      order_id: orderData.order_id,
      prefill: {
        name: orderData.user_name,
        email: orderData.user_email,
      },
      handler: async function (response: any) {
        setPaying(true);
        setTimeout(async () => {
          await loadDashboardData();
          setPaying(false);
        }, 3000);
      },
      modal: {
        ondismiss: function () {
          setPaying(false);
        },
      },
      theme: {
        color: "#6366f1",
      },
    };

    const rzp = new (window as any).Razorpay(options);
    rzp.open();
  };

  const simulatePaymentSuccess = async () => {
    setPaying(true);
    setShowMockModal(false);

    try {
      const webhookPayload = {
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: `pay_sim_${Math.random().toString(36).substring(2, 9)}`,
              order_id: mockOrderId,
              amount: mockAmount,
              email: user?.email,
              notes: {
                plan_id: "1",
                user_email: user?.email,
              },
            },
          },
        },
      };

      const res = await fetch(`${API_BASE}/payments/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(webhookPayload),
      });

      if (res.ok) {
        alert("Simulated payment processed successfully!");
        await loadDashboardData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Simulation failed: ${err.detail || "Unknown error"}`);
      }
    } catch (e) {
      alert("Network error processing simulated webhook.");
    } finally {
      setPaying(false);
    }
  };

  const playVideo = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE}/student/videos/${id}/play-url`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveVideo({ id: data.video_id, url: data.play_url });
      } else {
        const err = await res.json();
        alert(`Cannot play video: ${err.detail}`);
      }
    } catch (e) {
      console.error(e);
      alert("Error fetching play URL");
    }
  };

  return (
    <main className="min-h-screen flex flex-col bg-gradient-to-tr from-indigo-950 via-slate-900 to-violet-950 text-white relative overflow-hidden">
      {/* Background Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/15 rounded-full blur-3xl animate-pulse delay-1000 pointer-events-none" />

      {/* Nav */}
      <nav className="border-b border-white/10 bg-black/20 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎹</span>
          <span className="font-extrabold text-lg bg-gradient-to-r from-violet-300 to-cyan-300 bg-clip-text text-transparent">
            Minim Music Academy
          </span>
        </div>
        <div className="flex items-center gap-4">
          {user ? (
            <>
              <span className="text-slate-400 text-sm hidden sm:block">
                Hello, {user.name} ({user.role})
              </span>
              {user.role === "admin" && (
                <a
                  href="/admin"
                  className="text-xs bg-indigo-500 hover:bg-indigo-600 px-3 py-1.5 rounded-lg font-bold transition-all"
                >
                  Admin Console
                </a>
              )}
              <button
                onClick={logout}
                className="text-xs text-slate-400 hover:text-rose-400 border border-white/10 hover:border-rose-500/30 px-3 py-1.5 rounded-lg transition-all"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <a
                href="/login"
                className="text-sm font-medium text-slate-300 hover:text-white transition-colors"
              >
                Sign In
              </a>
              <a
                href="/signup"
                className="text-xs bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 px-3 py-1.5 rounded-lg font-bold transition-all shadow-lg shadow-indigo-500/20"
              >
                Get Started
              </a>
            </>
          )}
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="flex-1 flex items-center justify-center p-6 z-10 w-full">
        <div className="max-w-3xl w-full text-center space-y-8 py-8">
          {/* Header */}
          <div>
            <h1 className="text-5xl font-extrabold tracking-tight bg-gradient-to-r from-violet-300 via-indigo-200 to-cyan-300 bg-clip-text text-transparent drop-shadow-md">
              Piano &amp; Keyboard Academy
            </h1>
            <p className="text-slate-400 mt-2 text-sm uppercase tracking-widest font-semibold">
              Monthly Drip-release Video Course
            </p>
          </div>

          {/* Member Card */}
          {user ? (
            user.role === "admin" ? (
              <div className="max-w-xl mx-auto p-8 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
                <h2 className="text-xl font-bold mb-3 text-slate-200">Admin Account Detected</h2>
                <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                  You are logged in as an Administrator. Please head to the Admin Console to upload and manage courses, videos, and worksheets.
                </p>
                <a
                  href="/admin"
                  className="inline-block py-3 px-6 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 font-bold text-white text-sm tracking-wide transition-all shadow-lg hover:scale-[1.02]"
                >
                  Go to Admin Console →
                </a>
              </div>
            ) : (
              <div className="w-full p-8 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)] text-left space-y-6">
                <div className="border-b border-white/10 pb-4">
                  <h2 className="text-xl font-bold text-slate-200">Student Dashboard</h2>
                  <p className="text-slate-400 text-xs mt-1">Logged in as {user.email}</p>
                </div>

                {loadingSub ? (
                  <div className="flex justify-center py-6">
                    <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : subInfo && (subInfo.status === "active" || subInfo.status === "expired") ? (
                  <div className="space-y-8">
                    {/* Subscription Status Bar */}
                    {subInfo.status === "active" && (
                      <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                        <span className="text-2xl">🎉</span>
                        <div>
                          <p className="font-bold text-sm">Premium Subscription Active</p>
                          <p className="text-xs text-slate-400">Payment Status: {subInfo.payment_status}</p>
                        </div>
                      </div>
                    )}

                    {subInfo.status === "expired" && (
                      <div className="flex flex-col gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">⚠️</span>
                          <div>
                            <p className="font-bold text-sm">Subscription Expired</p>
                            <p className="text-xs text-slate-400">You have completed your 4 videos for this cycle.</p>
                          </div>
                        </div>
                        <button
                          onClick={handleSubscribe}
                          disabled={paying}
                          className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 font-bold text-white text-sm tracking-wide transition-all shadow-lg"
                        >
                          {paying ? "Initializing Checkout..." : "Renew Your Subscription →"}
                        </button>
                      </div>
                    )}

                    <div className="p-4 rounded-2xl bg-white/3 border border-white/5 space-y-3">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Learning Progress</p>
                      <div className="flex justify-between text-sm">
                        <span>Released Lessons:</span>
                        <span className="font-bold text-indigo-300">{subInfo.videos_released} / 4 videos</span>
                      </div>
                      {subInfo.next_release_date && (
                        <div className="flex justify-between text-xs text-slate-400">
                          <span>Next Lesson Release:</span>
                          <span>{new Date(subInfo.next_release_date).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>

                    {/* Course Materials List */}
                    <div className="mt-8">
                      <h3 className="font-bold text-lg text-slate-200 mb-4 text-left border-b border-white/10 pb-2">Course Materials</h3>
                      <div className="space-y-3">
                        {videos.length === 0 ? (
                          <p className="text-sm text-slate-400">No videos available yet.</p>
                        ) : (
                          videos.map(v => (
                            <div key={v.id} className="p-4 rounded-2xl bg-white/5 border border-white/10 flex justify-between items-center text-left">
                              <div>
                                <h4 className={`font-bold text-sm ${v.is_unlocked ? 'text-indigo-300' : 'text-slate-500'}`}>
                                  {v.sequence_order}. {v.title}
                                </h4>
                                {!v.is_unlocked && v.unlock_date && (
                                  <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                                    <span className="text-sm">🔒</span> Unlocks on {new Date(v.unlock_date).toLocaleDateString()}
                                  </p>
                                )}
                              </div>
                              {v.is_unlocked ? (
                                <button
                                  onClick={() => playVideo(v.id)}
                                  className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 rounded-lg text-xs font-bold text-white transition-colors"
                                >
                                  ▶ Play
                                </button>
                              ) : (
                                <span className="px-4 py-2 bg-white/5 text-slate-500 rounded-lg text-xs font-bold flex items-center gap-2 cursor-not-allowed">
                                  <span>🔒</span> Locked
                                </span>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    
                  </div>
                ) : (
                  <div className="max-w-xl mx-auto space-y-4">
                    <div className="flex items-center gap-3 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
                      <span className="text-2xl">🔒</span>
                      <div>
                        <p className="font-bold text-sm">No Active Subscription</p>
                        <p className="text-xs text-slate-400">Subscribe below to access piano video lessons.</p>
                      </div>
                    </div>

                    <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 border border-indigo-500/20 space-y-3">
                      <h3 className="font-bold text-md text-indigo-200">Premium Piano Membership</h3>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Instant access to 1 video/week, curated sheet music PDFs, and a custom practice sequence. Cancel anytime.
                      </p>
                      <div className="flex items-baseline gap-1 pt-1">
                        <span className="text-2xl font-extrabold text-white">₹499</span>
                        <span className="text-xs text-slate-500">/ month</span>
                      </div>
                    </div>

                    <button
                      id="checkout-btn"
                      onClick={handleSubscribe}
                      disabled={paying}
                      className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 font-bold text-white text-sm tracking-wide shadow-lg shadow-indigo-500/20 transition-all hover:scale-[1.02]"
                    >
                      {paying ? "Initializing Checkout..." : "Subscribe & Start Learning →"}
                    </button>
                  </div>
                )}
              </div>
            )
          ) : (
            /* Public/Guest Landing View */
            <div className="space-y-6 max-w-xl mx-auto">
              <div className="p-8 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)] space-y-6">
                <p className="text-slate-300 text-sm leading-relaxed">
                  Welcome to Minim Music Academy. Learn piano step-by-step with structured, weekly drip-released video lessons and printable worksheets.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-2xl bg-white/3 border border-white/5 text-left">
                    <span className="text-xl">📅</span>
                    <h3 className="font-bold text-sm text-slate-200 mt-2">Drip Schedule</h3>
                    <p className="text-xs text-slate-400 mt-1">Get 1 premium video lesson per week, preventing info overload.</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-white/3 border border-white/5 text-left">
                    <span className="text-xl">📄</span>
                    <h3 className="font-bold text-sm text-slate-200 mt-2">PDF Material</h3>
                    <p className="text-xs text-slate-400 mt-1">Every lesson includes printable worksheets uploaded to Cloudflare R2.</p>
                  </div>
                </div>

                <div className="pt-4 flex flex-col sm:flex-row gap-4 justify-center">
                  <a
                    href="/signup"
                    className="py-3 px-6 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 font-bold text-white text-sm tracking-wide transition-all shadow-lg hover:scale-[1.02]"
                  >
                    Create a Student Account
                  </a>
                  <a
                    href="/login"
                    className="py-3 px-6 rounded-xl border border-white/10 hover:bg-white/5 font-bold text-slate-300 hover:text-white text-sm transition-all"
                  >
                    Sign In
                  </a>
                </div>
              </div>

              {/* System status footer */}
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/3 border border-white/5 text-xs text-slate-400">
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    status === "ok" ? "bg-emerald-400" : "bg-rose-400"
                  }`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${
                    status === "ok" ? "bg-emerald-500" : "bg-rose-500"
                  }`}></span>
                </span>
                <span>System Gateway: {status}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Video Player Modal */}
      {activeVideo && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-white/15 rounded-3xl p-4 w-full max-w-4xl shadow-2xl space-y-4">
            <div className="flex justify-between items-center px-2">
              <h3 className="font-bold text-lg text-white">Video Player</h3>
              <button onClick={() => setActiveVideo(null)} className="text-slate-400 hover:text-white text-sm font-bold">✕ Close</button>
            </div>
            <div className="aspect-video w-full bg-black rounded-xl overflow-hidden border border-white/10 relative">
              <iframe 
                src={activeVideo.url} 
                className="w-full h-full absolute inset-0"
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;" 
                allowFullScreen
              ></iframe>
            </div>
          </div>
        </div>
      )}

      {/* Mock Payment Modal for Simulation Mode */}
      {showMockModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-white/15 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-6">
            <div className="text-center">
              <span className="text-4xl">💳</span>
              <h2 className="text-xl font-bold mt-3 text-slate-200">Simulated Payment Gateway</h2>
              <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider font-mono">
                Order ID: {mockOrderId}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2 text-sm">
              <div className="flex justify-between text-slate-400">
                <span>Account Name:</span>
                <span className="text-white font-medium">{user?.name}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Amount Due:</span>
                <span className="text-white font-bold">₹{mockAmount / 100}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Gateway Type:</span>
                <span className="text-indigo-400 font-bold uppercase tracking-widest text-xs">Razorpay Test (Simulated)</span>
              </div>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Clicking below will simulate a successful Razorpay payment capture. It sends the payload directly to the FastAPI webhook endpoint `/payments/webhook`, bypasses signature check, and activates your student subscription.
            </p>

            <div className="flex gap-3">
              <button
                id="simulate-success-btn"
                onClick={simulatePaymentSuccess}
                className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white rounded-xl font-bold text-sm tracking-wide transition-all"
              >
                Complete Payment (Simulate)
              </button>
              <button
                onClick={() => {
                  setShowMockModal(false);
                  setPaying(false);
                }}
                className="py-3 px-4 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white rounded-xl text-sm font-semibold transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-white/10 bg-black/10 px-6 py-4 text-center text-xs text-slate-600 mt-auto z-10">
        © 2026 Minim Music Academy. All rights reserved.
      </footer>
    </main>
  );
}
