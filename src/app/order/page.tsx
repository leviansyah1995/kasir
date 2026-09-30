"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { 
  Bell, Volume2, VolumeX, Upload, Download, Trash2, Printer, 
  Clock, CheckCircle2, XCircle, Settings, Store, ShoppingBag, 
  DollarSign, Users, UserX, LogOut, ChevronRight, Search, 
  Flame, Check, Play, ShieldAlert, FileSpreadsheet, MessageCircle
} from "lucide-react";
import { auth, db } from "../../lib/firebase";
import * as XLSX from "xlsx";
import { ref, onValue, remove, update } from "firebase/database";
import { onAuthStateChanged, signOut, signInWithPopup, GoogleAuthProvider } from "firebase/auth";

const ALLOWED_ADMIN_EMAIL = "dianarifin.shopeedriver@gmail.com";

interface CartItem {
  id: string;
  name: string;
  price: number;
  qty: number;
  selectedVariants?: string[];
  cookingMethod?: string;
  note?: string;
}

interface OrderCustomer {
  uid?: string;
  name?: string;
  phone?: string;
  address?: string;
}

interface Order {
  id: string;
  orderNumber: string;
  date: string;
  createdAt: number;
  items: CartItem[];
  total: number;
  paymentMethod?: string;
  paymentStatus?: string;
  source: string; // "kasir" | "shop"
  status: string; // "PROCESSING" | "READY" | "COMPLETED" | "CANCELED"
  orderType?: string;
  customer?: OrderCustomer;
}

interface ShopUser {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  createdAt?: number;
}

const formatRp = (n: number) => "Rp " + (n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// Semua aplikasi menulis satu schema status; terima juga format lama agar data yang
// sudah ada tidak salah diklasifikasikan sebagai pesanan aktif.
const normalizedStatus = (status: string) => (status || "").trim().toUpperCase().replace(/\s+/g, " ");
const statusKind = (status: string) => {
  const s = normalizedStatus(status);
  if (["COMPLETED", "PESANAN SUDAH DIAMBIL", "SUDAH DIAMBIL", "SELESAI"].includes(s)) return "completed";
  if (["CANCELED", "CANCELLED", "PESANAN DIBATALKAN", "DIBATALKAN"].includes(s)) return "canceled";
  if (["READY", "PESANAN SIAP"].includes(s)) return "ready";
  if (["PENDING_PAYMENT", "MENUNGGU PEMBAYARAN QRIS"].includes(s)) return "pendingPayment";
  return "processing";
};
const isFinishedStatus = (status: string) => ["completed", "canceled"].includes(statusKind(status));
const toWhatsAppNumber = (phone: string) => {
  let digits = (phone || "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  return digits;
};
const statusMessageText = (status: string) => ({
  pendingPayment: "pesanan Anda menunggu verifikasi pembayaran QRIS",
  processing: "pesanan Anda sedang diproses",
  ready: "pesanan Anda siap diambil",
  completed: "pesanan Anda sudah diambil",
  canceled: "pesanan Anda dibatalkan"
}[statusKind(status)] || "ada pembaruan untuk pesanan Anda");

const playDefaultBeep = () => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.45);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, now + 0.12);
    gain2.gain.setValueAtTime(0.35, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.7);
  } catch (e) {
    console.error("Audio error:", e);
  }
};

export default function OrderPage() {
  const router = useRouter();

  const [authUser, setAuthUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Bottom Navigation: "pesanan" | "riwayat" | "laporan" | "pengaturan"
  const [activeTab, setActiveTab] = useState<"pesanan" | "riwayat" | "laporan" | "pengaturan">("pesanan");

  // Orders State (Firebase)
  const [orders, setOrders] = useState<Order[]>([]);
  const [prevActiveOrderCount, setPrevActiveOrderCount] = useState<number | null>(null);

  // Users State (Firebase)
  const [shopUsers, setShopUsers] = useState<ShopUser[]>([]);

  // Sound Notification
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [customAudioData, setCustomAudioData] = useState<string | null>(null);
  const [customAudioName, setCustomAudioName] = useState<string>("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Filters
  const [searchHistory, setSearchHistory] = useState("");
  const [filterSource, setFilterSource] = useState<"ALL" | "kasir" | "shop">("ALL");

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // 1. Auth Observer (Tanpa Redirect Otomatis ke Shop saat Logout)
  useEffect(() => {
    const savedAudio = localStorage.getItem("order_sound_data");
    const savedAudioName = localStorage.getItem("order_sound_name");
    if (savedAudio) {
      setCustomAudioData(savedAudio);
      setCustomAudioName(savedAudioName || "custom-audio.mp3");
    }

    const unsubAuth = onAuthStateChanged(auth, (fu) => {
      setAuthLoading(false);
      if (fu) {
        if (fu.email?.toLowerCase() === ALLOWED_ADMIN_EMAIL.toLowerCase()) {
          setAuthUser(fu);
          setLoginError(null);
        } else {
          setAuthUser(null);
          setLoginError(`Email ${fu.email} tidak memiliki izin akses.`);
          signOut(auth);
        }
      } else {
        setAuthUser(null);
      }
    });

    return () => unsubAuth();
  }, []);

  // 2. Realtime Firebase Orders & Users
  useEffect(() => {
    if (!authUser) return;

    let initialLoaded = false;
    const unsubOrders = onValue(ref(db, "orders"), (snap) => {
      if (snap.exists()) {
        const val = snap.val();
        const loaded: Order[] = Object.keys(val).map((k) => ({
          id: k,
          orderNumber: val[k].orderNumber || "ORD-" + k.slice(-6).toUpperCase(),
          date: val[k].date || "",
          createdAt: val[k].createdAt || Date.now(),
          items: val[k].items || [],
          total: val[k].total || 0,
          source: val[k].source || "shop",
          status: val[k].status || "PROCESSING",
          orderType: val[k].orderType || "takeaway",
          customer: val[k].customer || {}
        }));

        loaded.sort((a, b) => b.createdAt - a.createdAt);
        setOrders(loaded);

        const activeCount = loaded.filter(o => ["processing", "ready"].includes(statusKind(o.status))).length;
        if (initialLoaded && prevActiveOrderCount !== null && activeCount > prevActiveOrderCount) {
          triggerNotificationSound();
          showToast("Pesanan baru masuk!");
        }
        setPrevActiveOrderCount(activeCount);
        initialLoaded = true;
      } else {
        setOrders([]);
        setPrevActiveOrderCount(0);
        initialLoaded = true;
      }
    });

    const unsubUsers = onValue(ref(db, "users"), (snap) => {
      if (snap.exists()) {
        const val = snap.val();
        const list: ShopUser[] = Object.keys(val).map((k) => ({
          uid: k,
          name: val[k].name || "Customer",
          email: val[k].email || "-",
          phone: val[k].phone || "-",
          address: val[k].address || "-",
          createdAt: val[k].createdAt || Date.now()
        }));
        setShopUsers(list);
      } else {
        setShopUsers([]);
      }
    });

    return () => {
      unsubOrders();
      unsubUsers();
    };
  }, [authUser, prevActiveOrderCount]);

  const triggerNotificationSound = () => {
    if (!soundEnabled) return;
    if (customAudioData && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => playDefaultBeep());
    } else {
      playDefaultBeep();
    }
  };

  const handleLoginGoogle = async () => {
    setLoginError(null);
    try {
      const res = await signInWithPopup(auth, new GoogleAuthProvider());
      if (res.user.email?.toLowerCase() !== ALLOWED_ADMIN_EMAIL.toLowerCase()) {
        setLoginError(`Akses ditolak: ${res.user.email} bukan akun admin.`);
        await signOut(auth);
      }
    } catch (e: any) {
      setLoginError(e.message || "Gagal masuk dengan Google");
    }
  };

  const handleLogout = async () => {
    const confirmLogout = window.confirm("Apakah Anda ingin keluar dari sistem order?");
    if (!confirmLogout) return;
    await signOut(auth);
    setAuthUser(null);
  };

  // Update Status di Firebase
  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      await update(ref(db, `orders/${orderId}`), { status: newStatus });
      if (newStatus === "COMPLETED") {
        showToast("Pesanan selesai & masuk riwayat");
      } else if (newStatus === "CANCELED") {
        showToast("Pesanan dibatalkan & masuk riwayat");
      } else if (newStatus === "READY") {
        showToast("Pesanan siap diambil");
      } else {
        showToast("Pesanan sedang diproses");
      }
    } catch (e: any) {
      alert("Gagal memperbarui status: " + e.message);
    }
  };

  const confirmQrisPayment = async (order: Order) => {
    const confirmed = window.confirm(`Pastikan dana QRIS untuk ${order.orderNumber} sudah terlihat masuk di rekening/merchant sebelum konfirmasi. Lanjutkan?`);
    if (!confirmed) return;
    try {
      await update(ref(db, `orders/${order.id}`), {
        status: "PROCESSING",
        paymentStatus: "VERIFIED_MANUALLY",
        paymentVerifiedAt: Date.now()
      });
      showToast("Pembayaran QRIS dikonfirmasi; pesanan masuk ke dapur.");
    } catch (error: any) {
      alert("Gagal mengonfirmasi pembayaran: " + error.message);
    }
  };

  // Upload MP3
  const handleUploadSound = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.includes("audio") && !file.name.endsWith(".mp3")) {
      alert("Format harus berupa file audio/MP3!");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert("Ukuran audio maksimal 5MB!");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setCustomAudioData(base64);
      setCustomAudioName(file.name);
      localStorage.setItem("order_sound_data", base64);
      localStorage.setItem("order_sound_name", file.name);
      showToast("Suara notifikasi berhasil diganti");
    };
    reader.readAsDataURL(file);
  };

  const handleResetSound = () => {
    setCustomAudioData(null);
    setCustomAudioName("");
    localStorage.removeItem("order_sound_data");
    localStorage.removeItem("order_sound_name");
    showToast("Suara dikembalikan ke nada bawaan");
  };

  // Delete Riwayat
  const handleDeleteHistory = async () => {
    const historyList = orders.filter(o => isFinishedStatus(o.status));
    if (historyList.length === 0) {
      alert("Tidak ada riwayat pesanan yang dapat dihapus.");
      return;
    }

    const ok = window.confirm(`Hapus permanen ${historyList.length} data riwayat pesanan dari database?`);
    if (!ok) return;

    try {
      for (const ord of historyList) {
        await remove(ref(db, `orders/${ord.id}`));
      }
      showToast("Semua riwayat pesanan berhasil dibersihkan");
    } catch (e: any) {
      alert("Gagal menghapus riwayat: " + e.message);
    }
  };

  // Delete User Shop
  const handleDeleteUser = async (uid: string, name: string) => {
    const ok = window.confirm(`Hapus akun user "${name}" dari database shop?`);
    if (!ok) return;

    try {
      await remove(ref(db, `users/${uid}`));
      showToast(`User ${name} berhasil dihapus`);
    } catch (e: any) {
      alert("Gagal menghapus user: " + e.message);
    }
  };

  // Export file Excel .xlsx asli dengan kolom yang sudah ditata.
  const handleExportExcel = () => {
    const finishedList = orders.filter(o => statusKind(o.status) === "completed");
    if (finishedList.length === 0) {
      alert("Belum ada data pesanan selesai untuk diunduh!");
      return;
    }

    const headers = [
      "No", "No Transaksi", "Tanggal", "Sumber", "Pelanggan", "No Telepon",
      "Alamat", "Rincian Pesanan", "Metode Bayar", "Total (Rp)", "Status"
    ];
    const orderRows = finishedList.map((order, index) => {
      const details = (order.items || []).map(item => {
        const lines = [`${item.qty}x ${item.name}`];
        if (item.selectedVariants?.length) lines.push(`Varian: ${item.selectedVariants.join(" + ")}`);
        if (item.cookingMethod) lines.push(`Pilihan: ${item.cookingMethod}`);
        if (item.note?.trim()) lines.push(`Catatan: ${item.note.trim()}`);
        return lines.join("\n");
      }).join("\n\n");
      return [
        index + 1, order.orderNumber, order.date, (order.source || "").toUpperCase(),
        order.customer?.name || "-", order.customer?.phone || "-", order.customer?.address || "-",
        details, order.paymentMethod || "-", Number(order.total || 0), "Pesanan sudah diambil"
      ];
    });
    const sheetData: (string | number)[][] = [
      headers,
      ...orderRows,
      Array(11).fill(""),
      ["TOTAL OMSET", "", "", "", "", "", "", "", "", Number(totalEarnings), ""]
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
    worksheet["!cols"] = [
      { wch: 6 }, { wch: 20 }, { wch: 22 }, { wch: 12 }, { wch: 24 }, { wch: 18 },
      { wch: 32 }, { wch: 48 }, { wch: 16 }, { wch: 18 }, { wch: 24 }
    ];
    worksheet["!autofilter"] = { ref: `A1:K${finishedList.length + 1}` };
    worksheet["!rows"] = [{ hpt: 24 }, ...finishedList.map(() => ({ hpt: 48 })), {}, { hpt: 24 }];

    // Format angka total sebagai rupiah di Excel.
    for (let row = 1; row <= finishedList.length; row++) {
      const address = XLSX.utils.encode_cell({ r: row, c: 9 });
      if (worksheet[address]) worksheet[address].z = '"Rp" #,##0';
    }
    const totalAddress = XLSX.utils.encode_cell({ r: finishedList.length + 2, c: 9 });
    if (worksheet[totalAddress]) worksheet[totalAddress].z = '"Rp" #,##0';

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Laporan Pesanan");
    XLSX.writeFile(workbook, `Laporan-Pesanan-${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast("Laporan Excel berhasil diunduh");
  };

  // Cetak laporan pada jendela khusus agar tidak ikut aturan layout aplikasi.
  const handlePrint = () => {
    const printWindow = window.open("", "_blank", "width=1000,height=750");
    if (!printWindow) {
      alert("Izinkan pop-up di browser untuk mencetak laporan.");
      return;
    }
    const esc = (value: unknown) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    }[char] || char));
    const rows = completedOrders.map((order, index) => {
      const details = (order.items || []).map(item => {
        const extras = [
          item.selectedVariants?.length ? `Varian: ${item.selectedVariants.join(" + ")}` : "",
          item.cookingMethod ? `Pilihan: ${item.cookingMethod}` : "",
          item.note?.trim() ? `Catatan: ${item.note.trim()}` : ""
        ].filter(Boolean).map(line => `<small>${esc(line)}</small>`).join("");
        return `<div class="item"><b>${esc(item.qty)}x ${esc(item.name)}</b>${extras}</div>`;
      }).join("");
      return `<tr><td>${index + 1}</td><td>${esc(order.orderNumber)}</td><td>${esc(order.date)}</td><td>${esc((order.source || "").toUpperCase())}</td><td>${esc(order.customer?.name || "-")}</td><td>${details}</td><td class="money">${esc(formatRp(order.total))}</td></tr>`;
    }).join("");

    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Laporan Pesanan</title><style>
      *{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#1e293b;margin:24px}h1{font-size:20px;margin:0 0 4px}.date{color:#64748b;margin-bottom:18px}
      .summary{padding:12px 16px;margin-bottom:18px;border:1px solid #cbd5e1;background:#f8fafc;border-radius:8px}.summary strong{font-size:18px;color:#047857}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:8px;text-align:left;vertical-align:top}th{background:#f1f5f9;font-weight:700}.money{text-align:right;white-space:nowrap}.item{margin-bottom:5px}small{display:block;color:#475569;margin-left:12px;line-height:1.4}
      @page{size:A4 landscape;margin:12mm}@media print{body{margin:0}.summary{break-inside:avoid}tr{break-inside:avoid}}
    </style></head><body><h1>Laporan Pesanan Selesai</h1><div class="date">Dicetak: ${esc(new Date().toLocaleString("id-ID"))}</div>
    <div class="summary">Jumlah transaksi: <b>${completedOrders.length}</b><br>Total uang masuk: <strong>${esc(formatRp(totalEarnings))}</strong><br>Kasir: ${esc(formatRp(kasirEarnings))} &nbsp; | &nbsp; Shop: ${esc(formatRp(shopEarnings))}</div>
    <table><thead><tr><th>No</th><th>No Transaksi</th><th>Tanggal</th><th>Sumber</th><th>Pelanggan</th><th>Rincian Pesanan</th><th>Total</th></tr></thead><tbody>${rows || `<tr><td colspan="7">Belum ada transaksi selesai.</td></tr>`}</tbody></table>
    <script>window.onload=()=>{window.focus();window.print()}</script></body></html>`);
    printWindow.document.close();
  };

  const handlePrintOrder = (order: Order) => {
    const printWindow = window.open("", "_blank", "width=420,height=720");
    if (!printWindow) {
      alert("Izinkan pop-up di browser untuk mencetak nota.");
      return;
    }
    const esc = (value: unknown) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    }[char] || char));
    const rows = (order.items || []).map((item) => `
      <div class="item">
        <div><strong>${esc(item.qty)}x ${esc(item.name)}</strong><span>${formatRp(item.price * item.qty)}</span></div>
        ${item.selectedVariants?.length ? `<small>Varian: ${esc(item.selectedVariants.join(" + "))}</small>` : ""}
        ${item.cookingMethod ? `<small>Pilihan: ${esc(item.cookingMethod)}</small>` : ""}
        ${item.note?.trim() ? `<small>Catatan: ${esc(item.note)}</small>` : ""}
      </div>`).join("");
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Nota ${esc(order.orderNumber)}</title><style>
      body{font:14px Arial,sans-serif;color:#111;max-width:360px;margin:20px auto;padding:0 12px}
      h1{font-size:18px;text-align:center;margin:0 0 4px}.meta{font-size:12px;line-height:1.6;border-bottom:1px dashed #888;padding:8px 0}
      .item{padding:9px 0;border-bottom:1px dashed #bbb}.item div{display:flex;justify-content:space-between;gap:8px}.item small{display:block;padding-left:18px;margin-top:3px;color:#444}
      .total{display:flex;justify-content:space-between;font-weight:bold;font-size:16px;padding:12px 0;border-bottom:1px dashed #888}
      .foot{text-align:center;font-size:11px;margin-top:14px}@media print{body{margin:0 auto}}
    </style></head><body><h1>Nota Pesanan</h1><div class="meta">No: ${esc(order.orderNumber)}<br>Tanggal: ${esc(order.date)}<br>Sumber: ${esc(order.source)}<br>Pelanggan: ${esc(order.customer?.name || "Pelanggan")}</div>${rows}<div class="total"><span>Total</span><span>${formatRp(order.total)}</span></div><div class="foot">Terima kasih</div><script>window.onload=()=>{window.focus();window.print()}</script></body></html>`);
    printWindow.document.close();
  };

  // Filter Data
  // Aktif: PROCESSING / READY (atau status baru)
  const activeOrders = orders.filter(o => !isFinishedStatus(o.status));
  // Riwayat: pesanan sudah diambil atau dibatalkan
  const historyOrders = orders.filter(o => isFinishedStatus(o.status));

  // Kalkulasi pendapatan hanya dari pesanan yang benar-benar sudah diambil
  const completedOrders = orders.filter(o => statusKind(o.status) === "completed");
  const totalEarnings = completedOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const kasirEarnings = completedOrders.filter(o => o.source === "kasir").reduce((sum, o) => sum + (o.total || 0), 0);
  const shopEarnings = completedOrders.filter(o => o.source === "shop").reduce((sum, o) => sum + (o.total || 0), 0);

  // Status helper
  const renderStatusTag = (status: string) => {
    switch (statusKind(status)) {
      case "processing":
        return <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">Pesanan di Proses</span>;
      case "ready":
        return <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Pesanan siap</span>;
      case "pendingPayment":
        return <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">Menunggu verifikasi QRIS</span>;
      case "completed":
        return <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">Pesanan sudah diambil</span>;
      case "canceled":
        return <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">Pesanan dibatalkan</span>;
    }
  };

  // Loading Screen
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-8 h-8 border-3 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // TAMPILAN AWAL: LOGIN BY GOOGLE (Tanpa redirect otomatis ke shop saat belum login atau logout)
  if (!authUser) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-slate-200 text-center space-y-5">
          <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center mx-auto text-orange-600">
            <Flame size={32} />
          </div>

          <div>
            <h1 className="text-xl font-bold text-slate-900">Kelola Pesanan</h1>
            <p className="text-xs text-slate-500 mt-1">Masuk dengan akun Google yang berwenang</p>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-left">
            <span className="text-[10px] font-bold text-slate-400 block uppercase">Email Terdaftar:</span>
            <span className="text-xs font-semibold text-slate-700 font-mono break-all">{ALLOWED_ADMIN_EMAIL}</span>
          </div>

          {loginError && (
            <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl border border-red-200 font-medium">
              {loginError}
            </div>
          )}

          <button
            onClick={handleLoginGoogle}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3.5 px-4 rounded-2xl text-xs flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>Masuk dengan Google</span>
          </button>

          <div className="pt-2">
            <button
              onClick={() => router.push("/shop")}
              className="text-xs text-slate-400 hover:text-slate-600 font-medium"
            >
              Kembali ke Menu Shop
            </button>
          </div>
        </div>
      </div>
    );
  }

  // TAMPILAN UTAMA (LAYOUT SMARTPHONE & TABLET - MAX WIDTH 600px - 768px)
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-between font-sans antialiased text-slate-800">
      
      {/* Hidden Audio */}
      {customAudioData && <audio ref={audioRef} src={customAudioData} preload="auto" />}

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 inset-x-4 max-w-sm mx-auto z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center gap-3 text-xs font-semibold animate-in fade-in slide-in-from-top-2">
          <Bell size={16} className="text-orange-400 shrink-0" />
          <span className="flex-1">{toastMessage}</span>
        </div>
      )}

      {/* CONTAINER KHUSUS SMARTPHONE & TABLET */}
      <div className="w-full max-w-md md:max-w-xl mx-auto bg-slate-50 min-h-screen flex flex-col shadow-sm border-x border-slate-200">
        
        {/* TOP COMPACT HEADER */}
        <header className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-20 flex items-center justify-between">
          <div>
            <h1 className="text-base font-extrabold text-slate-900">Pesanan</h1>
            <p className="text-[10px] text-slate-400 font-medium">{authUser.email}</p>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setSoundEnabled(!soundEnabled);
                showToast(soundEnabled ? "Suara dinonaktifkan" : "Suara aktif");
              }}
              className={`p-2 rounded-xl border text-xs ${
                soundEnabled 
                  ? "bg-emerald-50 text-emerald-600 border-emerald-200" 
                  : "bg-slate-100 text-slate-400 border-slate-200"
              }`}
              title="Status Notifikasi Suara"
            >
              {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          </div>
        </header>

        {/* CONTENT AREA (PADDING BOTTOM AGAR TIDAK TERTUTUP MENU BAWAH) */}
        <main className="flex-1 p-3.5 pb-24 overflow-y-auto">

          {/* ======================================================== */}
          {/* TAB 1: PESANAN (PRIORITAS MASUK) */}
          {/* ======================================================== */}
          {activeTab === "pesanan" && (
            <div className="space-y-3">
              
              {/* Filter Sumber Order */}
              <div className="flex items-center justify-between bg-white p-1 rounded-2xl border border-slate-200">
                <button
                  onClick={() => setFilterSource("ALL")}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all ${
                    filterSource === "ALL" ? "bg-orange-500 text-white shadow-sm" : "text-slate-500"
                  }`}
                >
                  Semua ({activeOrders.length})
                </button>
                <button
                  onClick={() => setFilterSource("kasir")}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all ${
                    filterSource === "kasir" ? "bg-orange-500 text-white shadow-sm" : "text-slate-500"
                  }`}
                >
                  Kasir ({activeOrders.filter(o => o.source === "kasir").length})
                </button>
                <button
                  onClick={() => setFilterSource("shop")}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all ${
                    filterSource === "shop" ? "bg-orange-500 text-white shadow-sm" : "text-slate-500"
                  }`}
                >
                  Shop ({activeOrders.filter(o => o.source === "shop").length})
                </button>
              </div>

              {/* LIST PESANAN */}
              {activeOrders.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center my-6 space-y-2">
                  <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 size={24} />
                  </div>
                  <p className="text-sm font-bold text-slate-700">Tidak ada pesanan masuk</p>
                  <p className="text-xs text-slate-400">Pesanan baru akan tampil otomatis dan bersuara.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeOrders
                    .filter(o => filterSource === "ALL" || o.source === filterSource)
                    .map((order) => (
                      <div 
                        key={order.id} 
                        className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3"
                      >
                        {/* Baris 1: No Transaksi & Sumber */}
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-slate-900 text-xs">{order.orderNumber}</span>
                              <button
                                type="button"
                                onClick={() => handlePrintOrder(order)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-50"
                                aria-label={`Cetak nota ${order.orderNumber}`}
                              ><Printer size={12} /> Nota</button>
                            </div>
                            <span className="text-[10px] text-slate-400">{order.date}</span>
                          </div>

                          {/* Sumber Kasir / Shop */}
                          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase ${
                            order.source === "kasir" 
                              ? "bg-blue-50 text-blue-700 border border-blue-200" 
                              : "bg-orange-50 text-orange-700 border border-orange-200"
                          }`}>
                            {order.source === "kasir" ? "Kasir" : "Shop"}
                          </span>
                        </div>

                        {/* Baris 2: Info Pelanggan jika ada */}
                        {(order.customer?.name || order.customer?.phone || order.customer?.address) && (
                          <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-xl space-y-1.5">
                            <p className="font-semibold text-slate-800">{order.customer?.name || "Pelanggan"}</p>
                            {order.customer?.phone && (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-slate-600">WhatsApp: {order.customer.phone}</span>
                                <a
                                  href={`https://wa.me/${toWhatsAppNumber(order.customer.phone)}?text=${encodeURIComponent(`Halo ${order.customer?.name || "Pelanggan"}, update pesanan ${order.orderNumber}: ${statusMessageText(order.status)}.`)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-green-700"
                                ><MessageCircle size={12}/> WhatsApp</a>
                              </div>
                            )}
                            {order.customer?.address && <p className="whitespace-pre-wrap text-[10px] text-slate-600">Alamat: {order.customer.address}</p>}
                          </div>
                        )}

                        {/* Baris 3: Makanan yang di pesan */}
                        <div className="space-y-1.5 text-xs">
                          {order.items?.map((item, idx) => (
                            <div key={idx} className="flex justify-between items-start gap-3">
                              <div className="min-w-0 font-medium text-slate-800">
                                <div><span className="font-bold text-orange-600 mr-1">{item.qty}x</span>{item.name}</div>
                                {item.selectedVariants && item.selectedVariants.length > 0 && <p className="ml-5 mt-0.5 text-[11px] text-orange-700">Varian: {item.selectedVariants.join(" + ")}</p>}
                                {item.cookingMethod && <p className="ml-5 text-[11px] text-slate-600">Pilihan: {item.cookingMethod}</p>}
                                {item.note?.trim() && <p className="ml-5 text-[11px] text-slate-600">Catatan: {item.note}</p>}
                              </div>
                              <span className="text-slate-500 font-semibold shrink-0">{formatRp(item.price * item.qty)}</span>
                            </div>
                          ))}
                        </div>

                        {/* Baris 4: Total & Status Tag */}
                        <div className="flex items-center justify-between border-t border-slate-100 pt-2.5">
                          <div>
                            <span className="text-[10px] text-slate-400 block">Total Pembayaran:</span>
                            <span className="text-sm font-extrabold text-slate-900">{formatRp(order.total)}</span>
                          </div>
                          <div>
                            {renderStatusTag(order.status)}
                          </div>
                        </div>

                        {/* Baris 5: Tombol Aksi Status */}
                        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                          {statusKind(order.status) === "pendingPayment" ? (
                            <div className="col-span-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                              <p className="text-xs leading-relaxed text-amber-900">Pelanggan mengaku sudah membayar QRIS. Cocokkan nominal dan transaksi di aplikasi merchant terlebih dahulu.</p>
                              <button onClick={() => confirmQrisPayment(order)} className="w-full rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-black text-white hover:bg-emerald-700">Pembayaran Terverifikasi — Kirim ke Dapur</button>
                            </div>
                          ) : (
                            <>
                          {/* Tombol: Pesanan di Proses */}
                          {statusKind(order.status) !== "processing" && (
                            <button
                              onClick={() => updateOrderStatus(order.id, "PROCESSING")}
                              className="py-2 px-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold transition-all active:scale-95"
                            >
                              Pesanan di Proses
                            </button>
                          )}

                          {/* Tombol: Pesanan Siap */}
                          {statusKind(order.status) !== "ready" && (
                            <button
                              onClick={() => updateOrderStatus(order.id, "READY")}
                              className="py-2 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold transition-all active:scale-95"
                            >
                              Pesanan siap
                            </button>
                          )}

                          {/* Tombol Utama: Pesanan sudah diambil (Hilang ke Riwayat) */}
                          <button
                            onClick={() => updateOrderStatus(order.id, "COMPLETED")}
                            className="col-span-2 py-2.5 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all"
                          >
                            <CheckCircle2 size={14} className="text-emerald-400" />
                            <span>Pesanan sudah diambil</span>
                          </button>

                            </>
                          )}

                          {/* Tombol: Pesanan Dibatalkan (Masuk Riwayat) */}
                          <button
                            onClick={() => {
                              const ok = window.confirm(`Batalkan pesanan ${order.orderNumber}?`);
                              if (ok) updateOrderStatus(order.id, "CANCELED");
                            }}
                            className="col-span-2 py-1.5 text-center text-xs text-red-500 hover:text-red-700 font-semibold"
                          >
                            Batalkan Pesanan Ini
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}

            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 2: RIWAYAT PESANAN (SUDAH DIAMBIL & DIBATALKAN) */}
          {/* ======================================================== */}
          {activeTab === "riwayat" && (
            <div className="space-y-3">
              {/* Search */}
              <div className="relative">
                <Search size={14} className="absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Cari no transaksi / nama..."
                  value={searchHistory}
                  onChange={(e) => setSearchHistory(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-2xl pl-9 pr-3 py-2 text-xs outline-none focus:border-slate-400"
                />
              </div>

              {historyOrders.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center my-6">
                  <p className="text-xs text-slate-400">Belum ada riwayat pesanan.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {historyOrders
                    .filter(o => 
                      o.orderNumber.toLowerCase().includes(searchHistory.toLowerCase()) ||
                      (o.customer?.name && o.customer.name.toLowerCase().includes(searchHistory.toLowerCase()))
                    )
                    .map((order) => (
                      <div key={order.id} className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono font-bold text-xs text-slate-800">{order.orderNumber}</span>
                            <button type="button" onClick={() => handlePrintOrder(order)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-50" aria-label={`Cetak nota ${order.orderNumber}`}><Printer size={12} /> Nota</button>
                          </div>
                          {renderStatusTag(order.status)}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {order.date} • Sumber: <span className="uppercase font-semibold">{order.source}</span>
                        </div>
                        <div className="space-y-1 text-xs text-slate-700 font-medium">
                          {order.items?.map((item, index) => (
                            <div key={index}>
                              <div>{item.qty}x {item.name}</div>
                              {item.selectedVariants && item.selectedVariants.length > 0 && <div className="ml-4 text-[11px] text-orange-700">Varian: {item.selectedVariants.join(" + ")}</div>}
                              {item.cookingMethod && <div className="ml-4 text-[11px] text-slate-500">Pilihan: {item.cookingMethod}</div>}
                              {item.note?.trim() && <div className="ml-4 text-[11px] text-slate-500">Catatan: {item.note}</div>}
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-between items-center border-t border-slate-100 pt-2 text-xs">
                          <span className="text-slate-400">Total:</span>
                          <span className="font-bold text-slate-900">{formatRp(order.total)}</span>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 3: LAPORAN (PRINT, EXCEL, JUMLAH PESANAN & OMSET) */}
          {/* ======================================================== */}
          {activeTab === "laporan" && (
            <div className="space-y-3.5">
              
              {/* KARTU JUMLAH PESANAN & UANG DIDAPAT */}
              <div className="bg-slate-900 text-white rounded-2xl p-4.5 space-y-1 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Total Uang Didapat (Selesai):
                </span>
                <p className="text-2xl font-black text-emerald-400">{formatRp(totalEarnings)}</p>
                <div className="flex justify-between text-[11px] text-slate-300 pt-2 border-t border-slate-800">
                  <span>Dari {completedOrders.length} Pesanan Selesai</span>
                  <span>Kasir: {formatRp(kasirEarnings)} | Shop: {formatRp(shopEarnings)}</span>
                </div>
              </div>

              {/* ACTION BUTTONS (EXCEL & PRINT) */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleExportExcel}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                >
                  <FileSpreadsheet size={15} />
                  <span>Save Excel</span>
                </button>

                <button
                  onClick={handlePrint}
                  className="bg-white border border-slate-200 text-slate-800 text-xs font-bold py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-xs"
                >
                  <Printer size={15} />
                  <span>Print Laporan</span>
                </button>
              </div>

              {/* RINCIAN LAPORAN LIST */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-700">Rincian Transaksi Selesai</span>
                  <span className="text-slate-400">{completedOrders.length} Nota</span>
                </div>

                <div className="divide-y divide-slate-100 text-xs">
                  {completedOrders.length === 0 ? (
                    <p className="p-6 text-center text-slate-400 text-xs">Belum ada transaksi selesai.</p>
                  ) : (
                    completedOrders.map((ord, idx) => (
                      <div key={ord.id} className="p-3 space-y-1">
                        <div className="flex justify-between font-medium">
                          <span className="font-mono font-bold text-slate-800">{ord.orderNumber}</span>
                          <span className="font-bold text-slate-900">{formatRp(ord.total)}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 flex justify-between">
                          <span>{ord.date}</span>
                          <span className="uppercase">{ord.source}</span>
                        </div>
                        <div className="text-[11px] text-slate-600">
                          {ord.items?.map(i => `${i.name} (x${i.qty})`).join(", ")}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 4: PENGATURAN (AUDIO MP3, DELETE RIWAYAT, USER SHOP) */}
          {/* ======================================================== */}
          {activeTab === "pengaturan" && (
            <div className="space-y-4">
              
              {/* 1. UBAH NOTIFIKASI SUARA (UNGGAH MP3 LEWAT HP/PC) */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-3 shadow-xs">
                <div>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Suara Notifikasi Pesanan</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">Unggah MP3 dari HP untuk nada order masuk.</p>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500">Nada Saat Ini:</span>
                    <span className="font-semibold text-slate-800 truncate max-w-[160px]">
                      {customAudioName || "Nada Bawaan"}
                    </span>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={triggerNotificationSound}
                      className="flex-1 bg-slate-900 text-white text-xs font-semibold py-2 rounded-xl flex items-center justify-center gap-1 active:scale-95"
                    >
                      <Play size={12} />
                      <span>Tes Suara</span>
                    </button>
                    {customAudioData && (
                      <button
                        onClick={handleResetSound}
                        className="px-3 bg-white border border-slate-200 text-slate-600 text-xs font-semibold py-2 rounded-xl"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                <label className="border border-dashed border-slate-300 hover:border-orange-400 rounded-xl p-3 flex flex-col items-center justify-center text-center cursor-pointer bg-slate-50/50">
                  <input
                    type="file"
                    accept="audio/mp3,audio/*"
                    onChange={handleUploadSound}
                    className="hidden"
                  />
                  <Upload size={18} className="text-orange-500 mb-1" />
                  <span className="text-xs font-semibold text-slate-700">Pilih File MP3 dari HP/PC</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">Format .mp3 (Maks. 5 MB)</span>
                </label>
              </div>

              {/* 2. DELETE RIWAYAT PESANAN */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-3 shadow-xs">
                <div>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Hapus Riwayat Pesanan</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">Bersihkan data pesanan yang sudah selesai/batal.</p>
                </div>

                <button
                  onClick={handleDeleteHistory}
                  disabled={historyOrders.length === 0}
                  className="w-full bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-600 border border-red-200 text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all active:scale-95"
                >
                  <Trash2 size={14} />
                  <span>Hapus Semua Riwayat ({historyOrders.length})</span>
                </button>
              </div>

              {/* 3. LIST USER TERDAFTAR DI SHOP (HAPUS USER TIDAK AKTIF) */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-3 shadow-xs">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">User Terdaftar di Shop</h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">Hapus user tidak aktif agar database ringan.</p>
                  </div>
                  <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg">
                    {shopUsers.length} User
                  </span>
                </div>

                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden text-xs max-h-60 overflow-y-auto">
                  {shopUsers.length === 0 ? (
                    <p className="p-4 text-center text-slate-400 text-xs">Belum ada user terdaftar.</p>
                  ) : (
                    shopUsers.map((u) => (
                      <div key={u.uid} className="p-2.5 flex items-center justify-between">
                        <div className="min-w-0 flex-1 pr-2">
                          <p className="font-semibold text-slate-800 truncate">{u.name}</p>
                          <p className="text-[10px] text-slate-400 truncate">{u.email}</p>
                        </div>
                        <button
                          onClick={() => handleDeleteUser(u.uid, u.name)}
                          className="p-1.5 bg-red-50 text-red-600 border border-red-100 rounded-lg hover:bg-red-100 text-[11px] font-semibold shrink-0"
                          title="Hapus User"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          )}

        </main>

        {/* ======================================================== */}
        {/* BOTTOM NAVIGATION BAR: PESANAN - RIWAYAT - LAPORAN - PENGATURAN - LOGOUT */}
        {/* ======================================================== */}
        <nav className="fixed bottom-0 inset-x-0 z-30 max-w-md md:max-w-xl mx-auto bg-white border-t border-slate-200 px-2 py-1.5 flex justify-around items-center shadow-lg">
          
          {/* 1. Pesanan */}
          <button
            onClick={() => setActiveTab("pesanan")}
            className={`flex flex-col items-center justify-center flex-1 py-1 rounded-xl transition-all ${
              activeTab === "pesanan" ? "text-orange-600 font-bold" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <div className="relative">
              <Clock size={18} />
              {activeOrders.length > 0 && (
                <span className="absolute -top-1 -right-2 w-3.5 h-3.5 bg-orange-600 text-white rounded-full text-[9px] flex items-center justify-center font-bold">
                  {activeOrders.length}
                </span>
              )}
            </div>
            <span className="text-[10px] mt-0.5">Pesanan</span>
          </button>

          {/* 2. Riwayat */}
          <button
            onClick={() => setActiveTab("riwayat")}
            className={`flex flex-col items-center justify-center flex-1 py-1 rounded-xl transition-all ${
              activeTab === "riwayat" ? "text-orange-600 font-bold" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <CheckCircle2 size={18} />
            <span className="text-[10px] mt-0.5">Riwayat</span>
          </button>

          {/* 3. Laporan */}
          <button
            onClick={() => setActiveTab("laporan")}
            className={`flex flex-col items-center justify-center flex-1 py-1 rounded-xl transition-all ${
              activeTab === "laporan" ? "text-orange-600 font-bold" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <Printer size={18} />
            <span className="text-[10px] mt-0.5">Laporan</span>
          </button>

          {/* 4. Pengaturan */}
          <button
            onClick={() => setActiveTab("pengaturan")}
            className={`flex flex-col items-center justify-center flex-1 py-1 rounded-xl transition-all ${
              activeTab === "pengaturan" ? "text-orange-600 font-bold" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <Settings size={18} />
            <span className="text-[10px] mt-0.5">Pengaturan</span>
          </button>

          {/* 5. Logout */}
          <button
            onClick={handleLogout}
            className="flex flex-col items-center justify-center flex-1 py-1 rounded-xl text-slate-400 hover:text-red-600 transition-all"
            title="Keluar"
          >
            <LogOut size={18} />
            <span className="text-[10px] mt-0.5">Logout</span>
          </button>

        </nav>

      </div>
    </div>
  );
}
