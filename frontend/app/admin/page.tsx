"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  getToken,
  getStoredUser,
  clearToken,
  getAuthHeaders,
  getAuthHeadersForFormData,
  API_BASE,
  type AuthUser,
} from "../../lib/auth";

interface Video {
  id: number;
  title: string;
  bunny_video_id: string | null;
  sequence_order: number;
  created_at: string;
}

interface Material {
  id: number;
  title: string;
  file_key: string;
  url: string;
  created_at: string;
}

interface Course {
  id: number;
  title: string;
  description: string | null;
  created_at: string;
  videos: Video[];
  materials: Material[];
}

export default function AdminPage() {
  const router = useRouter();
  const [user] = useState<AuthUser | null>(() => getStoredUser());
  const [loading, setLoading] = useState(true);

  // Courses state
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseTitle, setCourseTitle] = useState("");
  const [courseDesc, setCourseDesc] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);

  // Video upload state
  const [videoTitle, setVideoTitle] = useState("");
  const [videoOrder, setVideoOrder] = useState(0);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Material upload state
  const [pdfTitle, setPdfTitle] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // UI feedback
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [uploading, setUploading] = useState(false);

  const showMsg = useCallback((text: string, type: "success" | "error" | "info" = "info") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 5000);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    router.replace("/login");
  }, [router]);

  // ─── Data Fetching ───────────────────────────────────────────────────────────
  const loadCourses = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/courses`, {
        headers: getAuthHeaders(),
      });
      if (res.status === 401) {
        logout();
        return;
      }
      if (res.ok) {
        const data: Course[] = await res.json();
        setCourses(data);
      }
    } catch {
      showMsg("Failed to load courses.", "error");
    }
  }, [logout, showMsg]);

  // ─── Auth Guard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const token = getToken();
    const stored = getStoredUser();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (stored?.role !== "admin") {
      router.replace("/");
      return;
    }
    loadCourses();
    setLoading(false);
  }, [loadCourses, router]);

  // ─── Course Actions ──────────────────────────────────────────────────────────
  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseTitle.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/admin/courses`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ title: courseTitle, description: courseDesc }),
      });
      if (res.ok) {
        const data: Course = await res.json();
        setCourses((prev) => [data, ...prev]);
        setSelectedCourseId(data.id);
        setCourseTitle("");
        setCourseDesc("");
        showMsg(`Course "${data.title}" created!`, "success");
      } else {
        const err = await res.json().catch(() => ({}));
        showMsg(err.detail || "Failed to create course.", "error");
      }
    } catch {
      showMsg("Network error. Is the backend running?", "error");
    }
  };

  const handleDeleteCourse = async (courseId: number) => {
    if (!confirm("Delete this course and all its videos/materials?")) return;
    try {
      const res = await fetch(`${API_BASE}/admin/courses/${courseId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (res.ok || res.status === 204) {
        setCourses((prev) => prev.filter((c) => c.id !== courseId));
        if (selectedCourseId === courseId) setSelectedCourseId(null);
        showMsg("Course deleted.", "success");
      }
    } catch {
      showMsg("Failed to delete course.", "error");
    }
  };

  // ─── Video Actions ───────────────────────────────────────────────────────────
  const handleUploadVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourseId || !videoFile || !videoTitle.trim()) {
      showMsg("Select a course, enter a title, and choose a video file.", "error");
      return;
    }
    setUploading(true);
    showMsg("Uploading video to Bunny Stream…", "info");

    const form = new FormData();
    form.append("title", videoTitle);
    form.append("sequence_order", String(videoOrder));
    form.append("file", videoFile);

    try {
      const res = await fetch(`${API_BASE}/admin/courses/${selectedCourseId}/videos`, {
        method: "POST",
        headers: getAuthHeadersForFormData(),
        body: form,
      });
      if (res.ok) {
        const vid: Video = await res.json();
        setCourses((prev) =>
          prev.map((c) =>
            c.id === selectedCourseId
              ? { ...c, videos: [...c.videos, vid] }
              : c
          )
        );
        setVideoTitle("");
        setVideoOrder(0);
        setVideoFile(null);
        if (videoInputRef.current) videoInputRef.current.value = "";
        showMsg(`Video "${vid.title}" uploaded! Bunny ID: ${vid.bunny_video_id}`, "success");
      } else {
        const err = await res.json().catch(() => ({}));
        showMsg(err.detail || "Video upload failed.", "error");
      }
    } catch {
      showMsg("Network error during upload.", "error");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteVideo = async (courseId: number, videoId: number) => {
    try {
      const res = await fetch(`${API_BASE}/admin/courses/${courseId}/videos/${videoId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (res.ok || res.status === 204) {
        setCourses((prev) =>
          prev.map((c) =>
            c.id === courseId
              ? { ...c, videos: c.videos.filter((v) => v.id !== videoId) }
              : c
          )
        );
        showMsg("Video deleted.", "success");
      }
    } catch {
      showMsg("Failed to delete video.", "error");
    }
  };

  const handleGetPlayUrl = async (courseId: number, videoId: number) => {
    try {
      const res = await fetch(`${API_BASE}/admin/courses/${courseId}/videos/${videoId}/play-url`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        window.open(data.play_url, "_blank");
      }
    } catch {
      showMsg("Failed to get play URL.", "error");
    }
  };

  // ─── Material Actions ────────────────────────────────────────────────────────
  const handleUploadPdf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourseId || !pdfFile || !pdfTitle.trim()) {
      showMsg("Select a course, enter a title, and choose a PDF file.", "error");
      return;
    }
    setUploading(true);
    showMsg("Uploading PDF to Cloudflare R2…", "info");

    const form = new FormData();
    form.append("title", pdfTitle);
    form.append("file", pdfFile);

    try {
      const res = await fetch(`${API_BASE}/admin/courses/${selectedCourseId}/materials`, {
        method: "POST",
        headers: getAuthHeadersForFormData(),
        body: form,
      });
      if (res.ok) {
        const mat: Material = await res.json();
        setCourses((prev) =>
          prev.map((c) =>
            c.id === selectedCourseId
              ? { ...c, materials: [...c.materials, mat] }
              : c
          )
        );
        setPdfTitle("");
        setPdfFile(null);
        if (pdfInputRef.current) pdfInputRef.current.value = "";
        showMsg(`PDF "${mat.title}" uploaded to R2!`, "success");
      } else {
        const err = await res.json().catch(() => ({}));
        showMsg(err.detail || "PDF upload failed.", "error");
      }
    } catch {
      showMsg("Network error during PDF upload.", "error");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteMaterial = async (courseId: number, matId: number) => {
    try {
      const res = await fetch(`${API_BASE}/admin/courses/${courseId}/materials/${matId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (res.ok || res.status === 204) {
        setCourses((prev) =>
          prev.map((c) =>
            c.id === courseId
              ? { ...c, materials: c.materials.filter((m) => m.id !== matId) }
              : c
          )
        );
        showMsg("Material deleted.", "success");
      }
    } catch {
      showMsg("Failed to delete material.", "error");
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const selectedCourse = courses.find((c) => c.id === selectedCourseId);

  return (
    <main className="min-h-screen bg-gradient-to-tr from-indigo-950 via-slate-900 to-violet-950 text-white">
      {/* Nav */}
      <nav className="border-b border-white/10 bg-black/20 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎹</span>
          <span className="font-extrabold text-lg bg-gradient-to-r from-violet-300 to-cyan-300 bg-clip-text text-transparent">
            Minim Admin
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-400 text-sm hidden sm:block">{user?.name} · Admin</span>
          <button
            id="admin-logout"
            onClick={logout}
            className="text-xs text-slate-400 hover:text-rose-400 border border-white/10 hover:border-rose-500/30 px-3 py-1.5 rounded-lg transition-all"
          >
            Sign out
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Title */}
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-violet-300 via-indigo-200 to-cyan-300 bg-clip-text text-transparent">
            Academy Console
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            Manage courses, upload videos to Bunny Stream, and share PDFs via Cloudflare R2
          </p>
        </div>

        {/* Toast Message */}
        {message && (
          <div
            className={`px-5 py-3.5 rounded-xl border text-sm font-medium flex items-center gap-2 transition-all ${
              message.type === "success"
                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                : message.type === "error"
                ? "bg-rose-500/15 border-rose-500/30 text-rose-300"
                : "bg-indigo-500/15 border-indigo-500/30 text-indigo-300"
            }`}
          >
            <span>
              {message.type === "success" ? "✓" : message.type === "error" ? "✕" : "ℹ"}
            </span>
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ─── Left Column: Create Course + Course List ─── */}
          <div className="space-y-6">
            {/* Create Course */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <h2 className="text-base font-bold text-slate-200 mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-indigo-500/30 text-indigo-300 text-xs flex items-center justify-center font-bold">1</span>
                Create a Course
              </h2>
              <form onSubmit={handleCreateCourse} className="space-y-3">
                <input
                  id="course-title"
                  type="text"
                  placeholder="Course title"
                  value={courseTitle}
                  onChange={(e) => setCourseTitle(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                />
                <textarea
                  id="course-desc"
                  placeholder="Description (optional)"
                  rows={2}
                  value={courseDesc}
                  onChange={(e) => setCourseDesc(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all resize-none"
                />
                <button
                  id="course-submit"
                  type="submit"
                  className="w-full py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 font-bold text-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  + Create Course
                </button>
              </form>
            </div>

            {/* Course List */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <h2 className="text-base font-bold text-slate-200 mb-4">Your Courses</h2>
              {courses.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-4">No courses yet</p>
              ) : (
                <div className="space-y-2">
                  {courses.map((course) => (
                    <div
                      key={course.id}
                      onClick={() => setSelectedCourseId(course.id)}
                      className={`group flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-all border ${
                        selectedCourseId === course.id
                          ? "bg-indigo-500/20 border-indigo-500/40 text-white"
                          : "bg-white/3 border-white/5 text-slate-300 hover:bg-white/8 hover:border-white/15"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{course.title}</p>
                        <p className="text-xs text-slate-500">
                          {course.videos.length} videos · {course.materials.length} PDFs
                        </p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteCourse(course.id); }}
                        className="opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-300 text-xs ml-2 transition-all"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ─── Right Column: Upload Panels ─── */}
          <div className="lg:col-span-2 space-y-6">
            {!selectedCourse ? (
              <div className="bg-white/3 border border-white/8 rounded-2xl p-10 text-center">
                <p className="text-slate-500 text-lg">← Select or create a course to manage uploads</p>
              </div>
            ) : (
              <>
                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-5 py-3">
                  <p className="text-indigo-300 text-sm font-medium">
                    Editing: <span className="text-white font-bold">{selectedCourse.title}</span>
                  </p>
                </div>

                {/* Video Upload */}
                <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
                  <h2 className="text-base font-bold text-slate-200 mb-4 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-violet-500/30 text-violet-300 text-xs flex items-center justify-center font-bold">2</span>
                    Upload Video to Bunny Stream
                  </h2>
                  <form onSubmit={handleUploadVideo} className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <input
                          id="video-title"
                          type="text"
                          placeholder="Video title"
                          value={videoTitle}
                          onChange={(e) => setVideoTitle(e.target.value)}
                          required
                          className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition-all"
                        />
                      </div>
                      <input
                        id="video-order"
                        type="number"
                        min={0}
                        placeholder="Order"
                        value={videoOrder}
                        onChange={(e) => setVideoOrder(Number(e.target.value))}
                        className="px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition-all"
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex-1 flex items-center gap-3 px-4 py-3 rounded-lg bg-white/5 border border-white/10 border-dashed cursor-pointer hover:bg-white/8 transition-all">
                        <span className="text-slate-400 text-sm">
                          {videoFile ? `✓ ${videoFile.name}` : "📹 Choose video file…"}
                        </span>
                        <input
                          id="video-file"
                          type="file"
                          accept="video/*"
                          ref={videoInputRef}
                          onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                          className="hidden"
                        />
                      </label>
                    </div>
                    <button
                      id="video-submit"
                      type="submit"
                      disabled={uploading}
                      className="w-full py-2.5 rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-sm transition-all hover:scale-[1.02]"
                    >
                      {uploading ? "Uploading…" : "Upload to Bunny Stream"}
                    </button>
                  </form>

                  {/* Video List */}
                  {selectedCourse.videos.length > 0 && (
                    <div className="mt-5 space-y-2">
                      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Uploaded Videos</h3>
                      {selectedCourse.videos.map((v) => (
                        <div key={v.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/3 border border-white/8">
                          <div>
                            <p className="text-sm font-medium text-slate-200">{v.title}</p>
                            <p className="text-xs text-slate-500 font-mono">{v.bunny_video_id}</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleGetPlayUrl(selectedCourse.id, v.id)}
                              className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 hover:border-indigo-400/50 px-2 py-1 rounded transition-all"
                            >
                              ▶ Play
                            </button>
                            <button
                              onClick={() => handleDeleteVideo(selectedCourse.id, v.id)}
                              className="text-xs text-rose-400 hover:text-rose-300 border border-rose-500/30 px-2 py-1 rounded transition-all"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* PDF Upload */}
                <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
                  <h2 className="text-base font-bold text-slate-200 mb-4 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/30 text-cyan-300 text-xs flex items-center justify-center font-bold">3</span>
                    Upload PDF to Cloudflare R2
                  </h2>
                  <form onSubmit={handleUploadPdf} className="space-y-3">
                    <input
                      id="pdf-title"
                      type="text"
                      placeholder="Material title"
                      value={pdfTitle}
                      onChange={(e) => setPdfTitle(e.target.value)}
                      required
                      className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 transition-all"
                    />
                    <label className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white/5 border border-white/10 border-dashed cursor-pointer hover:bg-white/8 transition-all">
                      <span className="text-slate-400 text-sm">
                        {pdfFile ? `✓ ${pdfFile.name}` : "📄 Choose PDF file…"}
                      </span>
                      <input
                        id="pdf-file"
                        type="file"
                        accept="application/pdf"
                        ref={pdfInputRef}
                        onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                        className="hidden"
                      />
                    </label>
                    <button
                      id="pdf-submit"
                      type="submit"
                      disabled={uploading}
                      className="w-full py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-600 hover:from-cyan-600 hover:to-teal-700 disabled:opacity-50 font-bold text-sm transition-all hover:scale-[1.02]"
                    >
                      {uploading ? "Uploading…" : "Upload to R2"}
                    </button>
                  </form>

                  {/* Materials List */}
                  {selectedCourse.materials.length > 0 && (
                    <div className="mt-5 space-y-2">
                      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Uploaded Materials</h3>
                      {selectedCourse.materials.map((m) => (
                        <div key={m.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/3 border border-white/8">
                          <div>
                            <p className="text-sm font-medium text-slate-200">{m.title}</p>
                            <p className="text-xs text-slate-500 truncate max-w-[260px]">{m.file_key}</p>
                          </div>
                          <button
                            onClick={() => handleDeleteMaterial(selectedCourse.id, m.id)}
                            className="text-xs text-rose-400 hover:text-rose-300 border border-rose-500/30 px-2 py-1 rounded transition-all"
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
