"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing, CheckCircle2, Clock3, LogIn, LogOut, Monitor, Volume2, VolumeX } from "lucide-react";
import { onValue, ref } from "firebase/database";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { auth, db } from "../../lib/firebase";

type MonitorOrderItem = {
  name?: string;
  qty?: number;
  selectedVariants?: string[];
  cookingMethod?: string;
  note?: string;
};

type MonitorOrder = {
  id: string;
  orderNumber: string;
  createdAt: number;
  date: string;
  source: string;
  sourceLabel?: string;
  channel?: string;
  status: string;
  orderType?: string;
  total: number;
  items: MonitorOrderItem[];
  customer?: { name?: string };
};

const statusKind = (status: string) => {
  const value = (status || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (["READY", "PESANAN SIAP"].includes(value)) return "ready";
  if (["COMPLETED", "PESANAN SUDAH DIAMBIL", "SUDAH DIAMBIL", "SELESAI"].includes(value)) return "completed";
  if (["CANCELED", "CANCELLED", "PESANAN DIBATALKAN", "DIBATALKAN"].includes(value)) return "canceled";
  if (["PENDING_PAYMENT", "MENUNGGU PEMBAYARAN QRIS"].includes(value)) return "pendingPayment";
  return "processing";
};

const ADMIN_EMAIL = "dianarifin.shopeedriver@gmail.com";
const formatClock = (date: Date) => date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function MonitorPage() {
  const [orders, setOrders] = useState<MonitorOrder[]>([]);
  const [adminUser, setAdminUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [clock, setClock] = useState(new Date());
  const soundEnabledRef = useRef(false);
  const previousStatusRef = useRef<Record<string, string>>({});
  const firstSnapshotRef = useRef(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthLoading(false);
      if (user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase() && user.emailVerified) {
        setAdminUser(user);
        setAuthError("");
        return;
      }
      setAdminUser(null);
      if (user) {
        setAuthError("Akses monitor hanya untuk akun admin yang terdaftar.");
        await signOut(auth);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!adminUser) {
      setOrders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    previousStatusRef.current = {};
    firstSnapshotRef.current = true;

    const unsubscribe = onValue(ref(db, "orders"), (snapshot) => {
      const value = snapshot.val() || {};
      const next: MonitorOrder[] = Object.entries(value).map(([id, raw]) => {
        const order = (raw || {}) as Record<string, any>;
        return {
          id,
          orderNumber: order.orderNumber || `ORD-${id.slice(-6).toUpperCase()}`,
          createdAt: Number(order.createdAt || 0),
          date: order.date || "",
          source: order.source || "shop",
          sourceLabel: order.sourceLabel || "",
          channel: order.channel || "",
          status: order.status || "PROCESSING",
          orderType: order.orderType || "",
          total: Number(order.total || 0),
          items: Array.isArray(order.items) ? order.items : Object.values(order.items || {}),
          customer: order.customer || {}
        };
      }).sort((a, b) => a.createdAt - b.createdAt);

      if (!firstSnapshotRef.current) {
        for (const order of next) {
          const current = statusKind(order.status);
          const previous = previousStatusRef.current[order.id];
          if (current === "ready" && previous !== "ready") {
            announceReady(order);
          }
        }
      }

      previousStatusRef.current = Object.fromEntries(next.map(order => [order.id, statusKind(order.status)]));
      firstSnapshotRef.current = false;
      setOrders(next);
      setLoading(false);
    }, (error) => {
      console.error("Gagal memuat pesanan untuk monitor:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [adminUser]);

  const announceReady = (order: MonitorOrder) => {
    if (!soundEnabledRef.current || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const customerName = order.customer?.name?.trim() || `Pelanggan ${order.orderNumber}`;
    const utterance = new SpeechSynthesisUtterance(`${customerName}, pesanan siap diambil.`);
    utterance.lang = "id-ID";
    utterance.rate = 0.92;
    utterance.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const indonesianVoice = voices.find(voice => voice.lang.toLowerCase().startsWith("id"));
    if (indonesianVoice) utterance.voice = indonesianVoice;
    window.speechSynthesis.speak(utterance);
  };

  const enableSound = () => {
    if (!("speechSynthesis" in window)) {
      alert("Browser ini tidak mendukung pengumuman suara.");
      return;
    }
    soundEnabledRef.current = true;
    setSoundEnabled(true);
    window.speechSynthesis.cancel();
    const test = new SpeechSynthesisUtterance("Suara monitor aktif.");
    test.lang = "id-ID";
    test.rate = 0.95;
    const voice = window.speechSynthesis.getVoices().find(item => item.lang.toLowerCase().startsWith("id"));
    if (voice) test.voice = voice;
    window.speechSynthesis.speak(test);
  };

  const disableSound = () => {
    soundEnabledRef.current = false;
    setSoundEnabled(false);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  };

  const handleAdminLogin = async () => {
    setAuthError("");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error: any) {
      setAuthError(error?.message || "Gagal masuk dengan Google.");
    }
  };

  const processingOrders = orders.filter(order => statusKind(order.status) === "processing");
  const readyOrders = orders.filter(order => statusKind(order.status) === "ready");
  const pickedUpOrders = orders.filter(order => statusKind(order.status) === "completed").slice(-12).reverse();

  const orderCard = (order: MonitorOrder, type: "processing" | "ready" | "completed") => {
    const styles = {
      processing: { border: "border-sky-300", bg: "bg-sky-50", tag: "bg-sky-100 text-sky-800", label: "SEDANG DIPROSES" },
      ready: { border: "border-emerald-400", bg: "bg-emerald-50", tag: "bg-emerald-100 text-emerald-800", label: "SIAP DIAMBIL" },
      completed: { border: "border-slate-200", bg: "bg-white", tag: "bg-slate-100 text-slate-600", label: "SUDAH DIAMBIL" }
    }[type];
    return (
      <article key={order.id} className={`rounded-2xl border-2 ${styles.border} ${styles.bg} p-5 shadow-sm ${type === "ready" ? "ring-2 ring-emerald-200" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Nomor pesanan</p>
            <h3 className="mt-1 truncate font-mono text-2xl font-black text-slate-900">{order.orderNumber}</h3>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black tracking-wide ${styles.tag}`}>{styles.label}</span>
        </div>
        <div className="mt-4 border-t border-black/10 pt-3">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Nama</p>
          <p className="mt-1 truncate text-xl font-extrabold text-slate-900">{order.customer?.name?.trim() || "Pelanggan"}</p>
        </div>
        {type !== "completed" && order.items.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-black/10 pt-3">
            {order.items.map((item, index) => (
              <div key={`${order.id}-${index}`} className="text-sm text-slate-700">
                <span className="font-bold">{item.qty || 1}× {item.name || "Menu"}</span>
                {item.selectedVariants?.length ? <span className="ml-2 text-xs text-slate-600">({item.selectedVariants.join(" + ")})</span> : null}
                {item.cookingMethod ? <span className="ml-2 text-xs text-slate-600">• {item.cookingMethod}</span> : null}
                {item.note?.trim() ? <p className="ml-5 text-xs text-slate-500">Catatan: {item.note}</p> : null}
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-center justify-between border-t border-black/10 pt-3 text-xs font-semibold text-slate-500">
          <span>{order.sourceLabel || order.channel?.toUpperCase() || order.source.toUpperCase()} {order.orderType ? `• ${order.orderType}` : ""}</span>
          <span>{order.date}</span>
        </div>
      </article>
    );
  };

  if (authLoading) {
    return <main className="flex min-h-screen items-center justify-center bg-[#0b1220] text-white">Memeriksa akses monitor…</main>;
  }

  if (!adminUser) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0b1220] p-6 text-white">
        <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[#111b2d] p-8 text-center shadow-2xl">
          <Monitor className="mx-auto mb-4 text-blue-300" size={38} />
          <h1 className="text-2xl font-black">Monitor Antrean</h1>
          <p className="mt-2 text-sm text-slate-400">Masuk dengan akun admin untuk membuka monitor pesanan.</p>
          {authError && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{authError}</p>}
          <button onClick={handleAdminLogin} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 font-bold text-slate-900 hover:bg-slate-100"><LogIn size={18}/> Masuk dengan Google</button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0b1220] text-white">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-[#111b2d] px-8 py-5">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300"><Monitor size={26}/></div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">Informasi Pesanan</h1>
            <p className="mt-0.5 text-sm text-slate-400">Mohon tunggu, pesanan Anda akan segera dipanggil</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Waktu</p>
            <p className="font-mono text-2xl font-bold tabular-nums">{formatClock(clock)}</p>
          </div>
          {soundEnabled ? (
            <button onClick={disableSound} className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-bold text-emerald-200" title="Matikan suara pengumuman"><Volume2 size={18}/> Suara aktif</button>
          ) : (
            <button onClick={enableSound} className="flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-3 text-sm font-black text-slate-950 hover:bg-amber-300" title="Aktifkan suara pengumuman"><VolumeX size={18}/> Aktifkan suara</button>
          )}
          <button onClick={() => signOut(auth)} className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-3 text-xs font-bold text-slate-300 hover:bg-white/5" title="Keluar dari monitor"><LogOut size={16}/><span className="hidden 2xl:inline">Keluar</span></button>
        </div>
      </header>

      {!soundEnabled && <div className="flex items-center justify-center gap-2 bg-amber-400/10 px-4 py-2 text-center text-sm font-semibold text-amber-200"><BellRing size={16}/> Tekan “Aktifkan suara” satu kali agar nama pelanggan dapat diumumkan saat pesanan siap.</div>}

      <section className="grid min-h-[calc(100vh-112px)] grid-cols-1 gap-5 p-6 xl:grid-cols-3">
        <div className="rounded-3xl border border-sky-400/20 bg-[#111b2d] p-5">
          <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-3"><div className="rounded-xl bg-sky-400/15 p-2.5 text-sky-300"><Clock3 size={22}/></div><div><h2 className="text-xl font-black">Sedang Diproses</h2><p className="text-xs text-slate-400">Pesanan masuk ke dapur</p></div></div>
            <span className="rounded-full bg-sky-400 px-3 py-1 text-sm font-black text-slate-950">{processingOrders.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
            {loading ? <p className="py-8 text-center text-slate-400">Memuat pesanan…</p> : processingOrders.length ? processingOrders.map(order => orderCard(order, "processing")) : <p className="rounded-2xl border border-dashed border-white/15 px-4 py-10 text-center text-slate-500">Tidak ada pesanan yang sedang diproses</p>}
          </div>
        </div>

        <div className="rounded-3xl border border-emerald-400/25 bg-[#111b2d] p-5">
          <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-400/15 p-2.5 text-emerald-300"><CheckCircle2 size={22}/></div><div><h2 className="text-xl font-black">Siap Diambil</h2><p className="text-xs text-slate-400">Silakan menuju kasir</p></div></div>
            <span className="rounded-full bg-emerald-400 px-3 py-1 text-sm font-black text-slate-950">{readyOrders.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
            {loading ? <p className="py-8 text-center text-slate-400">Memuat pesanan…</p> : readyOrders.length ? readyOrders.map(order => orderCard(order, "ready")) : <p className="rounded-2xl border border-dashed border-white/15 px-4 py-10 text-center text-slate-500">Belum ada pesanan siap diambil</p>}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#111b2d] p-5">
          <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-3"><div className="rounded-xl bg-slate-400/15 p-2.5 text-slate-300"><CheckCircle2 size={22}/></div><div><h2 className="text-xl font-black">Sudah Diambil</h2><p className="text-xs text-slate-400">Pesanan terbaru yang selesai</p></div></div>
            <span className="rounded-full bg-slate-600 px-3 py-1 text-sm font-black text-white">{pickedUpOrders.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
            {loading ? <p className="py-8 text-center text-slate-400">Memuat pesanan…</p> : pickedUpOrders.length ? pickedUpOrders.map(order => orderCard(order, "completed")) : <p className="rounded-2xl border border-dashed border-white/15 px-4 py-10 text-center text-slate-500">Belum ada pesanan yang diambil</p>}
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-8 py-3 text-center text-xs text-slate-500">Informasi pesanan diperbarui otomatis</footer>
    </main>
  );
}
