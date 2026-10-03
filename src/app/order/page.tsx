"use client";

import { useEffect, useState, useRef, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { 
  Bell, Volume2, VolumeX, Upload, Download, Trash2, Printer, 
  Clock, CheckCircle2, XCircle, Settings, Store, ShoppingBag, 
  DollarSign, Users, UserX, LogOut, ChevronRight, Search, 
  Flame, Check, Play, ShieldAlert, FileSpreadsheet, MessageCircle, Sparkles
} from "lucide-react";
import { auth, db } from "../../lib/firebase";
import * as XLSX from "xlsx";
import { ref, onValue, remove, set, update } from "firebase/database";
import { onAuthStateChanged, signOut, signInWithRedirect, getRedirectResult, GoogleAuthProvider } from "firebase/auth";

const ALLOWED_ADMIN_EMAIL = "dianarifin.shopeedriver@gmail.com";
const DEFAULT_ORDER_AUDIO_URL = "https://cdn.jsdelivr.net/gh/leviansyah1995/asset@main/orderan.mp3";

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
  paymentProofPath?: string;
  uniqueCode?: number;
  subtotal?: number;
  sourceLabel?: string;
  channel?: string;
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

interface LandingDesignSettings {
  brandName: string;
  title: string;
  description: string;
  ctaLabel: string;
  heroImage: string;
}

const DEFAULT_LANDING_DESIGN: LandingDesignSettings = {
  brandName: "Toko Manis",
  title: "Ada hari yang butuh manis lebih.",
  description: "Terang bulan hangat, topping berlimpah, dan camilan yang bikin momen sederhana terasa istimewa.",
  ctaLabel: "Pilih menu & pesan",
  heroImage: "/images/terang-bulan-hero.jpg",
};

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

let orderAudioContext: AudioContext | null = null;
let orderAudioKeepAlive: OscillatorNode | null = null;
const getOrderAudioContext = () => {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) throw new Error("Browser tidak mendukung Web Audio.");
  // Context dibuat sekali, lalu dipakai untuk decoding MP3 dan semua alert di perangkat ini.
  if (!orderAudioContext || orderAudioContext.state === "closed") {
    orderAudioContext = new AudioContextClass();
    const silentGain = orderAudioContext.createGain();
    silentGain.gain.value = 0;
    orderAudioKeepAlive = orderAudioContext.createOscillator();
    orderAudioKeepAlive.frequency.value = 24;
    orderAudioKeepAlive.connect(silentGain);
    silentGain.connect(orderAudioContext.destination);
    orderAudioKeepAlive.start();
  }
  return orderAudioContext;
};
const playDefaultBeep = () => {
  try {
    // Oscillator senyap menjaga context tetap aktif sesudah izin audio diberikan.
    const ctx = getOrderAudioContext();
    const play = () => {
      if (ctx.state !== "running") return;
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
    };
    if (ctx.state === "suspended") void ctx.resume().then(play).catch(error => console.error("Audio resume error:", error));
    else play();
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
  const orderStatusCache = useRef<Map<string, string>>(new Map());
  const notifiedOrderIds = useRef<Set<string>>(new Set());
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  const [proofImageUrls, setProofImageUrls] = useState<Record<string, string>>({});
  const loadedProofPaths = useRef<Set<string>>(new Set());
  const proofObjectUrls = useRef<Map<string, string>>(new Map());

  // Users State (Firebase)
  const [shopUsers, setShopUsers] = useState<ShopUser[]>([]);

  // Sound notification: URL MP3 shared through Firebase, one serial queue per admin device.
  const [soundEnabled, setSoundEnabled] = useState(true);
  const soundEnabledRef = useRef(true);
  const [customAudioData, setCustomAudioData] = useState<string | null>(null);
  const customAudioDataRef = useRef<string | null>(null);
  const [customAudioName, setCustomAudioName] = useState<string>("");
  const [sharedAudioUrl, setSharedAudioUrl] = useState(DEFAULT_ORDER_AUDIO_URL);
  const sharedAudioUrlRef = useRef(DEFAULT_ORDER_AUDIO_URL);
  const [audioUrlDraft, setAudioUrlDraft] = useState(DEFAULT_ORDER_AUDIO_URL);
  const [audioUrlSaving, setAudioUrlSaving] = useState(false);
  const [audioUrlError, setAudioUrlError] = useState("");
  const [audioUrlLoaded, setAudioUrlLoaded] = useState(false);
  const [audioBufferLoading, setAudioBufferLoading] = useState(false);
  const [audioNeedsGesture, setAudioNeedsGesture] = useState(true);
  const [queuedSoundCount, setQueuedSoundCount] = useState(0);
  const [audioSetupError, setAudioSetupError] = useState("");
  const [restaurantOpen, setRestaurantOpen] = useState(true);
  const [restaurantStatusLoaded, setRestaurantStatusLoaded] = useState(false);
  const [restaurantStatusSaving, setRestaurantStatusSaving] = useState(false);
  const [landingDesignDraft, setLandingDesignDraft] = useState<LandingDesignSettings>(DEFAULT_LANDING_DESIGN);
  const [landingDesignLoaded, setLandingDesignLoaded] = useState(false);
  const [landingDesignSaving, setLandingDesignSaving] = useState(false);
  const [landingImageProcessing, setLandingImageProcessing] = useState(false);
  const audioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const audioBufferPromisesRef = useRef<Map<string, Promise<AudioBuffer>>>(new Map());
  const audioBufferLoadingRef = useRef<Set<string>>(new Set());
  const audioUnlockedRef = useRef(false);
  const audioNeedsGestureRef = useRef(true);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioQueueRef = useRef<Array<{ id: number; src: string | null; label: string }>>([]);
  const audioQueueSequenceRef = useRef(0);
  const activeAudioItemRef = useRef<number | null>(null);
  const audioQueuePlayingRef = useRef(false);

  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Filters
  const [searchHistory, setSearchHistory] = useState("");
  const [filterSource, setFilterSource] = useState<"ALL" | "kasir" | "shop" | "online">("ALL");

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);

  const syncQueueCount = () => setQueuedSoundCount(audioQueueRef.current.length);
  const setGestureRequired = (required: boolean) => {
    audioNeedsGestureRef.current = required;
    setAudioNeedsGesture(required);
  };

  const loadAudioBuffer = (src: string): Promise<AudioBuffer> => {
    const cached = audioBufferCacheRef.current.get(src);
    if (cached) return Promise.resolve(cached);
    const inflight = audioBufferPromisesRef.current.get(src);
    if (inflight) return inflight;
    const task = (async () => {
      audioBufferLoadingRef.current.add(src);
      setAudioBufferLoading(true);
      try {
        let bytes: ArrayBuffer;
        if (src.startsWith("data:")) {
          const response = await fetch(src);
          if (!response.ok) throw new Error("File audio lokal tidak dapat dibaca.");
          bytes = await response.arrayBuffer();
        } else {
          const endpoint = process.env.NEXT_PUBLIC_PROOF_UPLOAD_URL;
          const currentUser = auth.currentUser;
          if (!endpoint || !currentUser) throw new Error("Worker audio atau sesi admin belum tersedia.");
          const token = await currentUser.getIdToken();
          const proxyUrl = new URL(endpoint);
          proxyUrl.searchParams.set("audioUrl", src);
          const response = await fetch(proxyUrl.toString(), { headers: { Authorization: `Bearer ${token}` } });
          if (!response.ok) throw new Error(await response.text() || "Gagal mengambil MP3 dari CDN.");
          bytes = await response.arrayBuffer();
        }
        if (bytes.byteLength < 100 || bytes.byteLength > 12 * 1024 * 1024) throw new Error("MP3 kosong atau terlalu besar (maksimal 12 MB).");
        const context = getOrderAudioContext();
        const decoded = await context.decodeAudioData(bytes.slice(0));
        audioBufferCacheRef.current.set(src, decoded);
        if (src === sharedAudioUrlRef.current) setAudioUrlError("");
        return decoded;
      } catch (error: any) {
        if (src === sharedAudioUrlRef.current) setAudioUrlError(error?.message || "MP3 gagal dimuat.");
        throw error;
      } finally {
        audioBufferLoadingRef.current.delete(src);
        setAudioBufferLoading(audioBufferLoadingRef.current.size > 0);
        audioBufferPromisesRef.current.delete(src);
      }
    })();
    audioBufferPromisesRef.current.set(src, task);
    return task;
  };
  const finishCurrentAudio = (expectedId = activeAudioItemRef.current) => {
    if (expectedId === null || audioQueueRef.current[0]?.id !== expectedId) return;
    audioQueueRef.current.shift();
    activeAudioItemRef.current = null;
    audioQueuePlayingRef.current = false;
    audioSourceRef.current = null;
    syncQueueCount();
    if (audioQueueRef.current.length === 0) setGestureRequired(false);
    if (audioQueueRef.current.length > 0 && soundEnabledRef.current) {
      window.setTimeout(() => playNextQueuedAudio(), 100);
    }
  };
  const finishFallbackBeep = (expectedId: number) => {
    audioQueuePlayingRef.current = true;
    playDefaultBeep();
    window.setTimeout(() => finishCurrentAudio(expectedId), 750);
  };
  const playNextQueuedAudio = (fromUserGesture = false) => {
    if (audioQueuePlayingRef.current || audioQueueRef.current.length === 0) return;
    if (!soundEnabledRef.current && !fromUserGesture) return;
    const next = audioQueueRef.current[0];
    activeAudioItemRef.current = next.id;
    let context: AudioContext;
    try { context = getOrderAudioContext(); }
    catch (error) { console.error("Web Audio tidak tersedia:", error); return; }
    if (!audioUnlockedRef.current || context.state !== "running") {
      if (!fromUserGesture) {
        setGestureRequired(true);
        return;
      }
      void context.resume().then(() => {
        if (context.state === "running") {
          audioUnlockedRef.current = true;
          setGestureRequired(false);
          playNextQueuedAudio(true);
        } else setGestureRequired(true);
      }).catch(() => setGestureRequired(true));
      return;
    }
    if (!next.src) {
      finishFallbackBeep(next.id);
      return;
    }
    const buffer = audioBufferCacheRef.current.get(next.src);
    if (!buffer) {
      void loadAudioBuffer(next.src).then(() => {
        if (audioQueueRef.current[0]?.id === next.id) playNextQueuedAudio();
      }).catch(error => {
        console.error("MP3 order gagal dimuat, memakai beep bawaan:", error);
        if (audioQueueRef.current[0]?.id === next.id) finishFallbackBeep(next.id);
      });
      return;
    }
    try {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => finishCurrentAudio(next.id);
      audioSourceRef.current = source;
      audioQueuePlayingRef.current = true;
      source.start(0);
    } catch (error) {
      console.error("MP3 order gagal dimainkan:", error);
      finishFallbackBeep(next.id);
    }
  };
  const handleSoundActivationOrTest = () => {
    setAudioSetupError("");
    soundEnabledRef.current = true;
    setSoundEnabled(true);
    if (audioQueueRef.current.length === 0) {
      const src = sharedAudioUrlRef.current || customAudioDataRef.current;
      audioQueueRef.current.push({ id: ++audioQueueSequenceRef.current, src, label: "Tes suara" });
      syncQueueCount();
    }
    let context: AudioContext;
    try { context = getOrderAudioContext(); }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Browser tidak mendukung audio.";
      setAudioSetupError(message);
      return;
    }
    // Browser perlu klik ulang setelah refresh; aktivasi ini tidak disimpan antar-muat halaman.
    void context.resume().then(() => {
      if (context.state === "running") {
        audioUnlockedRef.current = true;
        setGestureRequired(false);
        playNextQueuedAudio(true);
      } else {
        setAudioSetupError("Browser belum mengizinkan suara. Coba aktifkan lagi atau periksa mode senyap perangkat.");
        setGestureRequired(true);
      }
    }).catch(error => {
      console.warn("Audio perlu aktivasi:", error);
      setAudioSetupError("Suara belum dapat diputar. Pastikan volume perangkat aktif lalu coba lagi.");
      setGestureRequired(true);
    });
  };
  const enqueueOrderAudio = (orderNumber: string) => {
    if (!soundEnabledRef.current) return;
    const src = sharedAudioUrlRef.current || customAudioDataRef.current;
    audioQueueRef.current.push({ id: ++audioQueueSequenceRef.current, src, label: orderNumber });
    syncQueueCount();
    playNextQueuedAudio();
  };
  const validNotificationMp3 = (value: string) => {
    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase();
      const isAllowedHost = ["rawcdn.githack.com", "raw.githack.com", "gistcdn.githack.com", "cdn.jsdelivr.net"].includes(host);
      const isJsDelivrGhAsset = host !== "cdn.jsdelivr.net" || parsed.pathname.startsWith("/gh/");
      return parsed.protocol === "https:" && isAllowedHost && isJsDelivrGhAsset && parsed.pathname.toLowerCase().endsWith(".mp3");
    } catch { return false; }
  };
  const saveSharedAudioUrl = async () => {
    const value = audioUrlDraft.trim();
    if (value && !validNotificationMp3(value)) {
      setAudioUrlError("Masukkan URL HTTPS langsung berakhiran .mp3 dari GitHack atau jsDelivr.");
      return;
    }
    setAudioUrlSaving(true);
    setAudioUrlError("");
    try {
      const settingRef = ref(db, "settings/orderNotificationAudioUrl");
      if (value) await set(settingRef, value); else await remove(settingRef);
      const appliedValue = value || DEFAULT_ORDER_AUDIO_URL;
      sharedAudioUrlRef.current = appliedValue;
      setSharedAudioUrl(appliedValue);
      setAudioUrlDraft(appliedValue);
      showToast(value ? "URL MP3 disimpan dan disinkronkan ke semua perangkat admin." : "URL default dipulihkan untuk semua perangkat admin.");
    } catch (error: any) {
      console.error("Gagal menyimpan URL suara:", error);
      setAudioUrlError(error?.message || "Gagal menyimpan. Periksa akses Admin pada Firebase Rules.");
    } finally { setAudioUrlSaving(false); }
  };

  // 1. Auth Observer (Tanpa Redirect Otomatis ke Shop saat Logout)
  useEffect(() => {
    void getRedirectResult(auth).catch(error => {
      console.error("Login redirect Google gagal:", error);
      setLoginError(error?.message || "Login Google tidak dapat diselesaikan. Coba buka melalui Chrome atau TWA.");
    });
    const unsubAuth = onAuthStateChanged(auth, (fu) => {
      setAuthLoading(false);
      if (fu) {
        if (fu.email?.toLowerCase() === ALLOWED_ADMIN_EMAIL.toLowerCase()) {
          const savedAudio = localStorage.getItem("order_sound_data");
          const savedAudioName = localStorage.getItem("order_sound_name");
          if (savedAudio) {
            customAudioDataRef.current = savedAudio;
            setCustomAudioData(savedAudio);
            setCustomAudioName(savedAudioName || "custom-audio.mp3");
          }
          setRestaurantStatusLoaded(false);
          setLandingDesignLoaded(false);
          audioUnlockedRef.current = false;
          setGestureRequired(true);
          setAuthUser(fu);
          setLoginError(null);
        } else {
          setAuthUser(null);
          setRestaurantStatusLoaded(false);
          setLandingDesignLoaded(false);
          setLoginError(`Email ${fu.email} tidak memiliki izin akses.`);
          signOut(auth);
        }
      } else {
        setAuthUser(null);
        setRestaurantStatusLoaded(false);
        setLandingDesignLoaded(false);
        audioUnlockedRef.current = false;
        setGestureRequired(true);
      }
    });

    return () => unsubAuth();
  }, []);

  // URL notifikasi disimpan di Firebase agar seluruh perangkat admin memakai sumber MP3 yang sama.
  useEffect(() => {
    if (!authUser) { setAudioUrlLoaded(false); return; }
    setAudioUrlLoaded(false);
    const unsubscribe = onValue(ref(db, "settings/orderNotificationAudioUrl"), snapshot => {
      const rawValue = snapshot.val();
      const value = typeof rawValue === "string" && rawValue.trim() ? rawValue.trim() : DEFAULT_ORDER_AUDIO_URL;
      sharedAudioUrlRef.current = value;
      setSharedAudioUrl(value);
      setAudioUrlDraft(value);
      setAudioUrlLoaded(true);
      setAudioUrlError("");
    }, error => {
      console.error("Gagal membaca URL MP3 bersama:", error);
      setAudioUrlError("Tidak dapat membaca pengaturan bersama. Pastikan Firebase Rules memberi akses Admin ke settings.");
      setAudioUrlLoaded(true);
    });
    return () => unsubscribe();
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    const unsubscribe = onValue(ref(db, "publicPaymentSettings/restaurantOpen"), snapshot => {
      setRestaurantOpen(snapshot.val() !== false);
      setRestaurantStatusLoaded(true);
    }, error => {
      console.error("Gagal membaca status resto:", error);
      setRestaurantStatusLoaded(true);
    });
    return () => unsubscribe();
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    const unsubscribe = onValue(ref(db, "publicPaymentSettings/landingPage"), snapshot => {
      const saved = (snapshot.val() || {}) as Partial<LandingDesignSettings>;
      setLandingDesignDraft({
        brandName: saved.brandName || DEFAULT_LANDING_DESIGN.brandName,
        title: saved.title || DEFAULT_LANDING_DESIGN.title,
        description: saved.description || DEFAULT_LANDING_DESIGN.description,
        ctaLabel: saved.ctaLabel || DEFAULT_LANDING_DESIGN.ctaLabel,
        heroImage: saved.heroImage || DEFAULT_LANDING_DESIGN.heroImage,
      });
      setLandingDesignLoaded(true);
    }, error => {
      console.error("Gagal memuat pengaturan landing page:", error);
      setLandingDesignLoaded(true);
    });
    return () => unsubscribe();
  }, [authUser]);

  useEffect(() => {
    if (!authUser || !sharedAudioUrl) return;
    void loadAudioBuffer(sharedAudioUrl).catch(error => console.error("Shared MP3 preloading failed:", error));
  }, [authUser, sharedAudioUrl]);

  useEffect(() => {
    if (!customAudioData) return;
    void loadAudioBuffer(customAudioData).catch(error => console.warn("Local fallback MP3 failed to load:", error));
  }, [customAudioData]);

  // 2. Realtime Firebase Orders & Users
  useEffect(() => {
    if (!authUser) return;

    orderStatusCache.current = new Map();
    try {
      notifiedOrderIds.current = new Set(JSON.parse(sessionStorage.getItem("order_notified_ids") || "[]"));
    } catch { notifiedOrderIds.current = new Set(); }
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
          customer: val[k].customer || {},
          paymentProofPath: val[k].paymentProofPath || "",
          uniqueCode: Number(val[k].uniqueCode || 0),
          subtotal: Number(val[k].subtotal ?? val[k].total ?? 0),
          sourceLabel: val[k].sourceLabel || "",
          channel: val[k].channel || ""
        }));

        loaded.sort((a, b) => b.createdAt - a.createdAt);
        setOrders(loaded);
        const previous = orderStatusCache.current;
        // Snapshot pertama setelah login/refresh hanyalah daftar pesanan yang sudah ada:
        // tandai sebagai telah dilihat tanpa memutar ulang notifikasi lama.
        if (!initialLoaded) {
          loaded.forEach(order => notifiedOrderIds.current.add(order.id));
          orderStatusCache.current = new Map(loaded.map(order => [order.id, order.status]));
          try { sessionStorage.setItem("order_notified_ids", JSON.stringify([...notifiedOrderIds.current])); } catch {}
          initialLoaded = true;
          return;
        }
        const newlyArrived = loaded.filter(order => {
          if (notifiedOrderIds.current.has(order.id)) return false;
          const currentKind = statusKind(order.status);
          const previousStatus = previous.get(order.id);
          const previousKind = previousStatus ? statusKind(previousStatus) : "";
          const isNewProcessingOrder = currentKind === "processing" && !previous.has(order.id);
          const newlyPendingPayment = currentKind === "pendingPayment" && previousKind !== "pendingPayment";
          return isNewProcessingOrder || newlyPendingPayment;
        });
        if (newlyArrived.length > 0) {
          newlyArrived.forEach(order => enqueueOrderAudio(order.orderNumber));
          showToast(newlyArrived.some(order => statusKind(order.status) === "pendingPayment")
            ? `Ada ${newlyArrived.length} order menunggu verifikasi pembayaran!`
            : "Pesanan baru masuk!");
          newlyArrived.forEach(order => notifiedOrderIds.current.add(order.id));
          try { sessionStorage.setItem("order_notified_ids", JSON.stringify([...notifiedOrderIds.current])); } catch {}
        }
        orderStatusCache.current = new Map(loaded.map(order => [order.id, order.status]));
      } else {
        setOrders([]);
        orderStatusCache.current = new Map();
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
  }, [authUser]);

  useEffect(() => {
    if (!authUser || !orders.length) return;
    const endpoint = process.env.NEXT_PUBLIC_PROOF_UPLOAD_URL;
    const requests = orders.filter(order => statusKind(order.status) === "pendingPayment" && order.paymentProofPath && !loadedProofPaths.current.has(order.paymentProofPath));
    if (!endpoint || !requests.length) return;
    let active = true;
    const loadPrivateProofs = async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      const token = await currentUser.getIdToken();
      for (const order of requests) {
        const path = order.paymentProofPath;
        if (!path) continue;
        try {
          const response = await fetch(`${endpoint}?path=${encodeURIComponent(path)}`, { headers: { Authorization: `Bearer ${token}` } });
          if (!response.ok) {
            console.error("Private proof preview failed", response.status, await response.text());
            continue;
          }
          const objectUrl = URL.createObjectURL(await response.blob());
          if (active) {
            loadedProofPaths.current.add(path);
            proofObjectUrls.current.set(path, objectUrl);
            setProofImageUrls(current => ({ ...current, [order.id]: objectUrl }));
          } else URL.revokeObjectURL(objectUrl);
        } catch (error) { console.error("Private proof preview failed", error); }
      }
    };
    void loadPrivateProofs();
    return () => { active = false; };
  }, [authUser, orders]);

  useEffect(() => () => {
    proofObjectUrls.current.forEach(url => URL.revokeObjectURL(url));
    proofObjectUrls.current.clear();
  }, []);

  const handleLandingImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { showToast("Pilih file gambar terlebih dahulu."); return; }
    setLandingImageProcessing(true);
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Gambar tidak dapat diproses di browser ini.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error("Gagal mengoptimalkan gambar.")), "image/jpeg", 0.78));
      if (blob.size > 850_000) throw new Error("Gambar masih terlalu besar setelah optimasi. Pilih gambar lain yang lebih ringan.");
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Gambar tidak dapat dibaca."));
        reader.onerror = () => reject(reader.error || new Error("Gambar tidak dapat dibaca."));
        reader.readAsDataURL(blob);
      });
      setLandingDesignDraft(current => ({ ...current, heroImage: dataUrl }));
      showToast("Gambar landing siap. Tekan Simpan untuk menayangkannya.");
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : "Gagal memproses gambar.");
    } finally {
      URL.revokeObjectURL(objectUrl);
      setLandingImageProcessing(false);
    }
  };

  const saveLandingDesign = async () => {
    if (!landingDesignLoaded || landingDesignSaving) return;
    if (!landingDesignDraft.brandName.trim() || !landingDesignDraft.title.trim() || !landingDesignDraft.description.trim() || !landingDesignDraft.ctaLabel.trim()) {
      showToast("Nama brand, judul, deskripsi, dan teks tombol harus diisi.");
      return;
    }
    setLandingDesignSaving(true);
    try {
      await update(ref(db, "publicPaymentSettings/landingPage"), {
        brandName: landingDesignDraft.brandName.trim(),
        title: landingDesignDraft.title.trim(),
        description: landingDesignDraft.description.trim(),
        ctaLabel: landingDesignDraft.ctaLabel.trim(),
        heroImage: landingDesignDraft.heroImage,
        updatedAt: Date.now(),
      });
      showToast("Desain landing page tersimpan dan akan diperbarui di leviankitchen.pages.dev.");
    } catch (error: unknown) {
      console.error("Gagal menyimpan desain landing page:", error);
      showToast(error instanceof Error ? error.message : "Desain landing gagal disimpan.");
    } finally { setLandingDesignSaving(false); }
  };

  const toggleRestaurantOpen = async () => {
    if (!restaurantStatusLoaded || restaurantStatusSaving) return;
    const nextState = !restaurantOpen;
    setRestaurantStatusSaving(true);
    try {
      await set(ref(db, "publicPaymentSettings/restaurantOpen"), nextState);
      showToast(nextState ? "Resto dibuka. Status Shop sudah diperbarui." : "Resto ditutup. Shop pelanggan sekarang menampilkan halaman tutup.");
    } catch (error: unknown) {
      console.error("Gagal mengubah status resto:", error);
      showToast(error instanceof Error ? error.message : "Status resto gagal disimpan. Periksa koneksi dan izin Firebase.");
    } finally { setRestaurantStatusSaving(false); }
  };

  const handleLoginGoogle = async () => {
    setLoginError(null);
    try {
      await signInWithRedirect(auth, new GoogleAuthProvider());
    } catch (error: unknown) {
      setLoginError(error instanceof Error ? error.message : "Gagal memulai login Google. Coba buka lewat Chrome/TWA.");
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
      customAudioDataRef.current = base64;
      setCustomAudioData(base64);
      setCustomAudioName(file.name);
      localStorage.setItem("order_sound_data", base64);
      localStorage.setItem("order_sound_name", file.name);
      showToast("Suara notifikasi berhasil diganti");
    };
    reader.readAsDataURL(file);
  };

  const handleResetSound = () => {
    customAudioDataRef.current = null;
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
      "Alamat", "Rincian Pesanan", "Metode Bayar", "Total Diterima (Rp)", "Kode Unik (Rp)", "Omzet Produk (Rp)", "Status"
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
        index + 1, order.orderNumber, order.date, order.sourceLabel || (order.channel || order.source || "").toUpperCase(),
        order.customer?.name || "-", order.customer?.phone || "-", order.customer?.address || "-",
        details, order.paymentMethod || "-", Number(order.total || 0), Number(order.uniqueCode || 0),
        Number(order.subtotal ?? ((order.total || 0) - (order.uniqueCode || 0))), "Pesanan sudah diambil"
      ];
    });
    const sheetData: (string | number)[][] = [
      headers,
      ...orderRows,
      Array(13).fill(""),
      ["TOTAL DITERIMA", "", "", "", "", "", "", "", "", Number(totalEarnings), Number(uniqueCodeEarnings), Number(totalEarnings - uniqueCodeEarnings), ""]
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
    worksheet["!cols"] = [
      { wch: 6 }, { wch: 20 }, { wch: 22 }, { wch: 12 }, { wch: 24 }, { wch: 18 },
      { wch: 32 }, { wch: 48 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 20 }, { wch: 24 }
    ];
    worksheet["!autofilter"] = { ref: `A1:M${finishedList.length + 1}` };
    worksheet["!rows"] = [{ hpt: 24 }, ...finishedList.map(() => ({ hpt: 48 })), {}, { hpt: 24 }];

    // Format angka total sebagai rupiah di Excel.
    for (let row = 1; row <= finishedList.length + 2; row++) {
      for (const column of [9, 10, 11]) {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        if (worksheet[address]) worksheet[address].z = '"Rp" #,##0';
      }
    }

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
      return `<tr><td>${index + 1}</td><td>${esc(order.orderNumber)}</td><td>${esc(order.date)}</td><td>${esc(order.sourceLabel || order.channel || (order.source || "").toUpperCase())}</td><td>${esc(order.customer?.name || "-")}</td><td>${details}</td><td class="money">${esc(formatRp(order.total))}</td></tr>`;
    }).join("");

    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Laporan Pesanan</title><style>
      *{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#1e293b;margin:24px}h1{font-size:20px;margin:0 0 4px}.date{color:#64748b;margin-bottom:18px}
      .summary{padding:12px 16px;margin-bottom:18px;border:1px solid #cbd5e1;background:#f8fafc;border-radius:8px}.summary strong{font-size:18px;color:#047857}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:8px;text-align:left;vertical-align:top}th{background:#f1f5f9;font-weight:700}.money{text-align:right;white-space:nowrap}.item{margin-bottom:5px}small{display:block;color:#475569;margin-left:12px;line-height:1.4}
      @page{size:A4 landscape;margin:12mm}@media print{body{margin:0}.summary{break-inside:avoid}tr{break-inside:avoid}}
    </style></head><body><h1>Laporan Pesanan Selesai</h1><div class="date">Dicetak: ${esc(new Date().toLocaleString("id-ID"))}</div>
    <div class="summary">Jumlah transaksi: <b>${completedOrders.length}</b><br>Total uang masuk: <strong>${esc(formatRp(totalEarnings))}</strong><br>Kasir: ${esc(formatRp(kasirEarnings))} &nbsp; | &nbsp; Marketplace: ${esc(formatRp(marketplaceEarnings))} &nbsp; | &nbsp; Shop: ${esc(formatRp(shopEarnings))}<br>Kode unik Shop: ${esc(formatRp(uniqueCodeEarnings))} &nbsp; | &nbsp; Omzet produk Shop: ${esc(formatRp(shopProductEarnings))}</div>
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
    </style></head><body><h1>Nota Pesanan</h1><div class="meta">No: ${esc(order.orderNumber)}<br>Tanggal: ${esc(order.date)}<br>Sumber: ${esc(order.sourceLabel || order.channel || order.source)}<br>Pelanggan: ${esc(order.customer?.name || "Pelanggan")}</div>${rows}${order.uniqueCode ? `<div class="item">Belanja: ${formatRp(order.subtotal || order.total - order.uniqueCode)}<br>Kode unik: ${formatRp(order.uniqueCode)}</div>` : ""}<div class="total"><span>Total</span><span>${formatRp(order.total)}</span></div><div class="foot">Terima kasih</div><script>window.onload=()=>{window.focus();window.print()}</script></body></html>`);
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
  const onlineChannels = ["shopeefood", "grabfood", "gofood"];
  const kasirEarnings = completedOrders.filter(o => o.source === "kasir" && !onlineChannels.includes(o.channel || "")).reduce((sum, o) => sum + (o.total || 0), 0);
  const shopEarnings = completedOrders.filter(o => o.source === "shop").reduce((sum, o) => sum + (o.total || 0), 0);
  const uniqueCodeEarnings = completedOrders.filter(o => o.source === "shop").reduce((sum, o) => sum + (o.uniqueCode || 0), 0);
  const shopProductEarnings = Math.max(0, shopEarnings - uniqueCodeEarnings);
  const marketplaceEarnings = completedOrders.filter(o => onlineChannels.includes(o.channel || o.source)).reduce((sum, o) => sum + (o.total || 0), 0);

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
      
      {proofPreviewUrl && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4" onClick={() => setProofPreviewUrl(null)}><button aria-label="Tutup foto" className="absolute right-4 top-4 rounded-full bg-white/90 px-4 py-2 text-sm font-bold text-slate-900">Tutup</button><img src={proofPreviewUrl} alt="Bukti pembayaran ukuran besar" onClick={e => e.stopPropagation()} className="max-h-[88vh] max-w-[94vw] rounded-xl bg-white object-contain shadow-2xl" /></div>}

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 inset-x-4 max-w-sm mx-auto z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center gap-3 text-xs font-semibold animate-in fade-in slide-in-from-top-2">
          <Bell size={16} className="text-orange-400 shrink-0" />
          <span className="flex-1">{toastMessage}</span>
        </div>
      )}
      {audioNeedsGesture && (
        <div role="status" className="fixed bottom-24 inset-x-3 z-[70] mx-auto max-w-md rounded-[24px] border border-amber-300 bg-amber-50 p-3.5 shadow-[0_15px_40px_rgba(58,36,13,.18)]">
          <div className="flex items-start gap-2.5">
            <Volume2 size={19} className="mt-0.5 shrink-0 text-orange-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-amber-950">{queuedSoundCount > 0 ? `${queuedSoundCount} bunyi order menunggu diputar` : "Aktifkan suara notifikasi"}</p>
              <p className="mt-1 text-[11px] leading-5 text-amber-800">{queuedSoundCount > 0 ? "Klik untuk mengaktifkan suara dan memutar antrean pesanan." : "Klik sekali untuk tes suara. Setelah refresh, browser mungkin meminta aktivasi lagi."}</p>
            </div>
          </div>
          <button onClick={handleSoundActivationOrTest} className="mt-3 w-full rounded-2xl bg-orange-600 px-4 py-3 text-sm font-black text-white transition hover:bg-orange-700 active:scale-[.99]">{queuedSoundCount > 0 ? "Aktifkan suara & putar antrean" : "Aktifkan suara"}</button>
          {audioSetupError && <p role="alert" className="mt-2 text-[11px] font-semibold text-red-700">{audioSetupError}</p>}
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
            <button onClick={handleSoundActivationOrTest} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600" title="Tes suara notifikasi" aria-label="Tes suara notifikasi">
              <Play size={16} />
            </button>
            <button
              onClick={() => {
                if (!soundEnabledRef.current) {
                  handleSoundActivationOrTest();
                } else {
                  soundEnabledRef.current = false;
                  setSoundEnabled(false);
                  if (audioSourceRef.current) {
                    audioSourceRef.current.onended = null;
                    try { audioSourceRef.current.stop(); } catch {}
                    audioSourceRef.current = null;
                  }
                  audioQueuePlayingRef.current = false;
                  showToast("Suara dinonaktifkan");
                }
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
                  Kasir ({activeOrders.filter(o => o.source === "kasir" && !onlineChannels.includes(o.channel || "")).length})
                </button>
                <button
                  onClick={() => setFilterSource("shop")}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all ${filterSource === "shop" ? "bg-orange-500 text-white shadow-sm" : "text-slate-500"}`}
                >Shop ({activeOrders.filter(o => o.source === "shop").length})</button>
                <button
                  onClick={() => setFilterSource("online")}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all ${filterSource === "online" ? "bg-orange-500 text-white shadow-sm" : "text-slate-500"}`}
                >Online ({activeOrders.filter(o => onlineChannels.includes(o.channel || o.source)).length})</button>
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
                    .filter(o => filterSource === "ALL" || (filterSource === "online" ? onlineChannels.includes(o.channel || o.source) : (filterSource === "kasir" ? o.source === "kasir" && !onlineChannels.includes(o.channel || "") : o.source === filterSource)))
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
                            {order.sourceLabel || ({ kasir: "Kasir", shop: "Shop", shopeefood: "ShopeeFood (SF)", grabfood: "GrabFood (GF)", gofood: "GoFood (GO)" } as Record<string, string>)[order.channel || order.source] || order.source}
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
                            {(order.uniqueCode || 0) > 0 && <span className="block text-[10px] font-semibold text-slate-500">Belanja {formatRp(order.subtotal || order.total - (order.uniqueCode || 0))} + kode unik {formatRp(order.uniqueCode || 0)}</span>}
                          </div>
                          <div>
                            {renderStatusTag(order.status)}
                          </div>
                        </div>

                        {/* Baris 5: Tombol Aksi Status */}
                        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                          {statusKind(order.status) === "pendingPayment" ? (
                            <div className="col-span-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                              <p className="text-xs leading-relaxed text-amber-900">Pelanggan mengaku sudah membayar QRIS. Cocokkan nominal total + kode unik di aplikasi merchant terlebih dahulu.</p>
                              {order.paymentProofPath && (proofImageUrls[order.id] ? <button type="button" onClick={() => setProofPreviewUrl(proofImageUrls[order.id])} className="flex items-center gap-2 rounded-lg border border-amber-300 bg-white p-2 text-left"><img src={proofImageUrls[order.id]} alt="Bukti pembayaran privat" className="h-14 w-14 rounded-md object-cover"/><span className="text-[11px] font-bold text-amber-900">Lihat foto bukti<br/>Total: {formatRp(order.total)} {order.uniqueCode ? `• Kode ${formatRp(order.uniqueCode)}` : ""}</span></button> : <span className="text-[10px] text-amber-800">Memuat bukti pembayaran privat…</span>)}
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
                  <span>Kasir: {formatRp(kasirEarnings)} | Marketplace: {formatRp(marketplaceEarnings)} | Shop: {formatRp(shopEarnings)}</span>
                </div>
                <p className="mt-2 text-[10px] text-slate-400">Shop: omzet produk {formatRp(shopProductEarnings)} + akumulasi kode unik {formatRp(uniqueCodeEarnings)} = total diterima {formatRp(shopEarnings)}.</p>
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

              {/* STATUS BUKA/TUTUP RESTO DIBAGIKAN KE SHOP */}
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
                <div className={`h-1.5 ${restaurantOpen ? "bg-emerald-400" : "bg-slate-400"}`} />
                <div className="flex items-center gap-3 p-4">
                  <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${restaurantOpen ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}><Store size={20}/></div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">Status Operasional Resto</h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{restaurantOpen ? "Resto buka — pelanggan dapat melihat menu dan memesan di Shop." : "Resto tutup — Shop menampilkan layar tutup dan checkout dinonaktifkan."}</p>
                    {!restaurantStatusLoaded && <p className="mt-1 text-[10px] text-orange-600">Memuat status…</p>}
                  </div>
                  <button type="button" onClick={toggleRestaurantOpen} disabled={!restaurantStatusLoaded || restaurantStatusSaving} aria-pressed={restaurantOpen} className={`relative h-8 w-[58px] shrink-0 rounded-full p-1 transition-colors disabled:cursor-wait disabled:opacity-50 ${restaurantOpen ? "bg-emerald-500" : "bg-slate-400"}`} aria-label={restaurantOpen ? "Tutup resto" : "Buka resto"}>
                    <span className={`block h-6 w-6 rounded-full bg-white shadow transition-transform ${restaurantOpen ? "translate-x-[26px]" : "translate-x-0"}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-[10px]">
                  <span className="font-bold text-slate-500">Status saat ini</span>
                  <span className={`inline-flex items-center gap-1.5 font-black ${restaurantOpen ? "text-emerald-700" : "text-slate-500"}`}><span className={`h-1.5 w-1.5 rounded-full ${restaurantOpen ? "bg-emerald-500" : "bg-slate-400"}`} />{restaurantStatusSaving ? "Menyimpan…" : restaurantOpen ? "BUKA" : "TUTUP"}</span>
                </div>
              </section>

              {/* PENGATURAN KONTEN LANDING PAGE */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="mb-3 flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600"><Sparkles size={19}/></div>
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">Desain Landing Page</h3>
                    <p className="mt-1 text-[10px] leading-4 text-slate-500">Atur teks dan foto yang tampil di leviankitchen.pages.dev. Perubahan tersimpan untuk semua pengunjung.</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="block space-y-1"><span className="text-[10px] font-bold text-slate-600">Nama brand</span><input value={landingDesignDraft.brandName} onChange={e => setLandingDesignDraft(current => ({ ...current, brandName: e.target.value }))} maxLength={48} disabled={!landingDesignLoaded} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-violet-400 disabled:opacity-50" placeholder="Leviankitchen" /></label>
                  <label className="block space-y-1"><span className="text-[10px] font-bold text-slate-600">Judul utama</span><textarea value={landingDesignDraft.title} onChange={e => setLandingDesignDraft(current => ({ ...current, title: e.target.value }))} rows={2} maxLength={110} disabled={!landingDesignLoaded} className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-violet-400 disabled:opacity-50" placeholder="Judul promosi" /></label>
                  <label className="block space-y-1"><span className="text-[10px] font-bold text-slate-600">Deskripsi</span><textarea value={landingDesignDraft.description} onChange={e => setLandingDesignDraft(current => ({ ...current, description: e.target.value }))} rows={3} maxLength={260} disabled={!landingDesignLoaded} className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-800 outline-none focus:border-violet-400 disabled:opacity-50" placeholder="Tulis deskripsi singkat resto atau produk" /></label>
                  <label className="block space-y-1"><span className="text-[10px] font-bold text-slate-600">Teks tombol pesan</span><input value={landingDesignDraft.ctaLabel} onChange={e => setLandingDesignDraft(current => ({ ...current, ctaLabel: e.target.value }))} maxLength={36} disabled={!landingDesignLoaded} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-violet-400 disabled:opacity-50" placeholder="Contoh: Pesan sekarang" /></label>
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-slate-600">Foto utama landing</span>{landingDesignDraft.heroImage && <button type="button" onClick={() => setLandingDesignDraft(current => ({ ...current, heroImage: "" }))} className="text-[10px] font-bold text-rose-600">Pakai foto default</button>}</div>
                    <img src={landingDesignDraft.heroImage || "/images/terang-bulan-hero.jpg"} alt="Pratinjau foto landing page" className="h-36 w-full rounded-xl bg-white object-cover" />
                    <label className={`mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[10px] font-bold text-slate-700 ${landingImageProcessing || !landingDesignLoaded ? "pointer-events-none opacity-50" : "hover:bg-slate-100"}`}>
                      <input type="file" accept="image/*" onChange={handleLandingImageUpload} disabled={landingImageProcessing || !landingDesignLoaded} className="hidden" />
                      <Upload size={14} className="text-violet-600" />{landingImageProcessing ? "Mengoptimalkan foto…" : "Pilih / ganti foto"}
                    </label>
                    <p className="mt-2 text-[9px] leading-4 text-slate-400">Foto akan diperkecil otomatis (maks. 1.400 px) sebelum disimpan ke Firebase.</p>
                  </div>
                  <button type="button" onClick={saveLandingDesign} disabled={!landingDesignLoaded || landingDesignSaving || landingImageProcessing} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-xs font-black text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-wait disabled:opacity-50">{landingDesignSaving ? "Menyimpan…" : "Simpan & perbarui landing page"}<Check size={15}/></button>
                  {!landingDesignLoaded && <p className="text-center text-[10px] text-slate-400">Memuat pengaturan desain…</p>}
                </div>
              </section>
              
              {/* 1. LINK MP3 BERSAMA UNTUK SEMUA PERANGKAT ADMIN */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-3 shadow-xs">
                <div>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Suara Notifikasi Pesanan</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">MP3 bawaan sudah terpasang. Anda dapat menggantinya dengan URL langsung dari GitHack atau jsDelivr; perubahan disinkronkan ke semua perangkat admin.</p>
                </div>

                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <label htmlFor="shared-order-audio-url" className="text-[11px] font-bold text-slate-700">URL MP3 bersama</label>
                  <input id="shared-order-audio-url" type="url" value={audioUrlDraft} onChange={e => setAudioUrlDraft(e.target.value)} placeholder={DEFAULT_ORDER_AUDIO_URL} disabled={!audioUrlLoaded} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-orange-400 disabled:opacity-60" />
                  <div className="flex gap-2">
                    <button onClick={saveSharedAudioUrl} disabled={audioUrlSaving || !audioUrlLoaded} className="flex-1 rounded-lg bg-orange-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{audioUrlSaving ? "Menyimpan…" : "Simpan untuk semua admin"}</button>
                    <button onClick={handleSoundActivationOrTest} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white"><Play size={13} className="inline mr-1"/>Tes suara</button>
                  </div>
                  <p className="text-[10px] leading-relaxed text-slate-500">URL harus HTTPS langsung ke file .mp3, bukan halaman GitHub. Mengosongkan lalu menyimpan akan memulihkan URL default.</p>
                  <p className="text-[10px] text-slate-600">Status: {!audioUrlLoaded ? "Memuat pengaturan…" : sharedAudioUrl === DEFAULT_ORDER_AUDIO_URL ? "MP3 default aktif" : "MP3 kustom bersama aktif"}{audioBufferLoading ? " • Memuat MP3…" : ""}</p>
                  {audioUrlError && <p role="alert" className="text-[10px] font-semibold text-red-600">{audioUrlError}</p>}
                </div>

                <details className="rounded-xl border border-slate-200 p-3">
                  <summary className="cursor-pointer text-[11px] font-bold text-slate-700">Cadangan lokal perangkat ini</summary>
                  <p className="mb-2 mt-2 text-[10px] text-slate-500">Dipakai hanya jika URL bersama belum diisi; tidak tersinkron ke perangkat lain.</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] text-slate-600">{customAudioName || "Tidak ada MP3 lokal"}</span>
                    {customAudioData && <button onClick={handleResetSound} className="rounded border border-slate-200 px-2 py-1 text-[10px] font-semibold">Hapus</button>}
                  </div>
                  <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 p-2 text-[10px] font-semibold text-slate-700">
                    <input type="file" accept="audio/mp3,audio/*" onChange={handleUploadSound} className="hidden" />
                    <Upload size={14} className="text-orange-500"/>Pilih MP3 lokal (maks. 5 MB)
                  </label>
                </details>
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
