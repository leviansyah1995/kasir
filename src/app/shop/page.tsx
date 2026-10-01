"use client";

import { useState, useEffect } from "react";
import { 
  Search, Plus, Minus, ShoppingBasket, User, 
  ChevronRight, Home, Clock, ClipboardList, Settings, MapPin, CheckCircle,
  Heart, Share2, X, ArrowLeft, LogOut, QrCode, WifiOff, RefreshCw, Send, Copy, Sparkles, MessageCircle
} from "lucide-react";
import { db, auth } from "../../lib/firebase";
import { ref, onValue, set, push, update, remove, runTransaction, query, orderByChild, equalTo } from "firebase/database";
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "firebase/auth";

// ==============================================
// TYPES
// ==============================================
interface Product {
  id: string; name: string; price: number; imageUrl: string;
  category: string; stock: number; active: boolean; description?: string;
  variants?: string[]; maxVariant?: number; cookingOptions?: string[];
}
interface CartItem extends Product { 
  cartItemId: string; qty: number; selectedVariants: string[]; cookingMethod: string; note: string; 
}
interface UserProfile {
  uid: string; name: string; email: string; photoURL: string;
  phone?: string; address?: string;
}
interface Order {
  id: string; orderNumber: string; date: string; createdAt: number;
  items: CartItem[]; total: number; source: string; status: string;
  orderType: string; customer: any;
}

const FALLBACK_PRODUCT_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 180'%3E%3Crect width='240' height='180' fill='%23fff7ed'/%3E%3Ccircle cx='120' cy='90' r='48' fill='white' stroke='%23fed7aa' stroke-width='8'/%3E%3Cpath d='M88 96c12-30 52-34 66-2-9 18-21 26-34 26-15 0-25-9-32-24z' fill='%23fb923c'/%3E%3C/svg%3E";
const FALLBACK_PROFILE_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='50' fill='%23ffedd5'/%3E%3Ccircle cx='50' cy='37' r='18' fill='%23fb923c'/%3E%3Cpath d='M17 91c2-21 15-33 33-33s31 12 33 33' fill='%23fb923c'/%3E%3C/svg%3E";
const normalizeGooglePhotoUrl = (value?: string | null) => {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.hostname.endsWith("googleusercontent.com")) {
      url.pathname = url.pathname.replace(/=s\d+(-c)?$/, "=s256-c");
      if (!/=s\d+(-c)?$/.test(url.pathname)) url.pathname += "=s256-c";
    }
    return url.toString();
  } catch {
    return value;
  }
};
const formatRp = (n: number) => "Rp. " + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const formatNumber = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const prepareProofImage = async (file: File): Promise<File> => {
  // Draw through canvas to strip EXIF/GPS metadata before the photo is uploaded privately.
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Tidak dapat memproses foto.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Gagal memproses foto.")), "image/jpeg", 0.88));
    return new File([blob], "bukti-qris.jpg", { type: "image/jpeg" });
  } finally { URL.revokeObjectURL(objectUrl); }
};

const orderStatusKind = (status: string) => {
  const s = (status || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (["COMPLETED", "PESANAN SUDAH DIAMBIL", "SUDAH DIAMBIL", "SELESAI"].includes(s)) return "completed";
  if (["CANCELED", "CANCELLED", "PESANAN DIBATALKAN", "DIBATALKAN"].includes(s)) return "canceled";
  if (["READY", "PESANAN SIAP"].includes(s)) return "ready";
  if (["PENDING_PAYMENT", "MENUNGGU PEMBAYARAN QRIS"].includes(s)) return "pendingPayment";
  return "processing";
};

// Helper penerjemah status ke Bahasa Indonesia
const getStatusText = (status: string) => {
  const kind = orderStatusKind(status);
  if (kind === "completed") return "Pesanan sudah diambil";
  if (kind === "canceled") return "Pesanan dibatalkan";
  if (kind === "ready") return "Pesanan siap";
  if (kind === "pendingPayment") return "Menunggu verifikasi pembayaran QRIS";
  return "Pesanan di Proses";
};

// ==============================================
// MAIN
// ==============================================
export default function ShopPage() {
  const [isClient, setIsClient] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [isCheckingNetwork, setIsCheckingNetwork] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [activeTab, setActiveTab] = useState<"home"|"active"|"history"|"settings"|"cart"|"wishlist">("home");

  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [sharedProductHandled, setSharedProductHandled] = useState(false);
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Semua");
  const [orderType, setOrderType] = useState<"delivery"|"takeaway">("delivery");
  const [editProfile, setEditProfile] = useState({ phone: "", address: "" });
  const [qrisImageUrl, setQrisImageUrl] = useState("");
  const [takeawayMapUrl, setTakeawayMapUrl] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [qrisUniqueCode, setQrisUniqueCode] = useState(0);
  const [qrisOrderId, setQrisOrderId] = useState("");
  const [reservationDateKey, setReservationDateKey] = useState("");
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [paymentProofPreview, setPaymentProofPreview] = useState("");
  const [isQrisOpen, setIsQrisOpen] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);

  const checkInternetConnection = async () => {
    if (typeof navigator === "undefined") return;
    if (!navigator.onLine) { setIsOnline(false); return; }
    setIsCheckingNetwork(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`/connection-check.txt?__connectivity_check=${Date.now()}`, { cache: "no-store", signal: controller.signal });
      if (response.ok) {
        setIsOnline(true);
        void response.body?.cancel();
        return;
      }
      // Fallback agar tidak salah menampilkan halaman offline bila file probe belum ikut terdeploy.
      const pageResponse = await fetch(`/shop?__connectivity_check=${Date.now()}`, { method: "HEAD", cache: "no-store", signal: controller.signal });
      setIsOnline(pageResponse.ok);
    } catch {
      try {
        const pageResponse = await fetch(`/shop?__connectivity_check=${Date.now()}`, { method: "HEAD", cache: "no-store" });
        setIsOnline(pageResponse.ok);
      } catch { setIsOnline(false); }
    } finally { window.clearTimeout(timeout); setIsCheckingNetwork(false); }
  };

  useEffect(() => {
    const onOffline = () => setIsOnline(false);
    const onOnline = () => { void checkInternetConnection(); };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    void checkInternetConnection();
    const retry = window.setInterval(() => { void checkInternetConnection(); }, 20000);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.clearInterval(retry);
    };
  }, []);

  useEffect(() => {
    setIsClient(true);
    const savedFav = localStorage.getItem("shop_favorites");
    if (savedFav) setFavorites(JSON.parse(savedFav));

    let unsubUserProfile: (() => void) | undefined;
    const unsubAuth = onAuthStateChanged(auth, (fu) => {
      unsubUserProfile?.();
      if (fu) {
        // Set user immediately so Firebase data listeners restart with the Google session.
        const googlePhotoURL = normalizeGooglePhotoUrl(fu.photoURL || fu.providerData?.[0]?.photoURL || "");
        const googleName = fu.displayName || "Customer";
        const googleEmail = fu.email || "";
        setUser({
          uid: fu.uid, name: googleName, email: googleEmail,
          photoURL: googlePhotoURL, phone: "", address: ""
        });
        const userRef = ref(db, `users/${fu.uid}`);
        // Simpan identitas Google ke node yang dibaca dashboard Order, tanpa menimpa profil lain.
        update(userRef, { name: googleName, email: googleEmail, photoURL: googlePhotoURL, lastLoginAt: Date.now() })
          .catch(error => console.error("Gagal menyimpan profil Google ke Firebase:", error));
        unsubUserProfile = onValue(userRef, (snap) => {
          const data = snap.exists() ? snap.val() : {};
          setUser({
            uid: fu.uid, name: fu.displayName || "Customer", email: fu.email || "",
            photoURL: googlePhotoURL || normalizeGooglePhotoUrl(data.photoURL || ""), phone: data.phone || "", address: data.address || ""
          });
          setEditProfile({ phone: data.phone || "", address: data.address || "" });
          if (data.favorites) setFavorites(data.favorites);
        }, (error) => console.error("Gagal memuat profil:", error));
      } else {
        setUser(null);
      }
    });

    return () => { unsubAuth(); unsubUserProfile?.(); };
  }, []);

  // Baca ulang data selepas auth berubah. Jika rule Firebase menolak pembacaan
  // sebelum login, listener akan dipasang semula dengan sesi Google yang aktif.
  useEffect(() => {
    const unsubProducts = onValue(ref(db, "products"), (snap) => {
      if (!snap.exists()) {
        setProducts([]);
        return;
      }
      const data = snap.val();
      const list = Object.keys(data).map((key) => {
        const product = data[key] || {};
        return {
          id: key,
          ...product,
          imageUrl: product.imageUrl || product.imageURL || product.image || product.photoUrl || ""
        };
      }).filter((product) => product.active !== false);
      setProducts(list);
    }, (error) => console.error("Gagal memuat produk Shop:", error));

    const unsubPaymentSettings = onValue(ref(db, "publicPaymentSettings"), (snap) => {
      const settings = snap.val() || {};
      setQrisImageUrl(typeof settings.qrisImageUrl === "string" ? settings.qrisImageUrl : "");
      setTakeawayMapUrl(typeof settings.takeawayMapUrl === "string" ? settings.takeawayMapUrl : "");
      setPickupAddress(typeof settings.pickupAddress === "string" ? settings.pickupAddress : "");
    }, (error) => console.error("Gagal memuat QRIS/lokasi toko:", error));

    let unsubOrders: (() => void) | undefined;
    if (user?.uid) {
      // Hanya ambil pesanan milik user yang login; jangan unduh seluruh node orders.
      const ownOrdersQuery = query(ref(db, "orders"), orderByChild("customer/uid"), equalTo(user.uid));
      unsubOrders = onValue(ownOrdersQuery, (snap) => {
        if (snap.exists()) {
          const data = snap.val();
          setOrders(Object.keys(data).map(key => ({ id: key, ...data[key] })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
        } else {
          setOrders([]);
        }
      }, (error) => console.error("Gagal memuat pesanan Shop:", error));
    } else {
      setOrders([]);
    }

    return () => { unsubProducts(); unsubPaymentSettings(); unsubOrders?.(); };
  }, [user?.uid]);

  useEffect(() => {
    if (!isClient) return;
    localStorage.setItem("shop_favorites", JSON.stringify(favorites));
    if (user) set(ref(db, `users/${user.uid}/favorites`), favorites);
  }, [favorites]);

  useEffect(() => {
    if (!isClient || sharedProductHandled || products.length === 0) return;
    const productId = new URLSearchParams(window.location.search).get("product");
    if (productId) {
      const product = products.find(item => item.id === productId);
      if (product) setSelectedProduct(product);
    }
    setSharedProductHandled(true);
  }, [isClient, sharedProductHandled, products]);

  const handleLogin = async () => {
    if (user) return setActiveTab("settings");
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { console.error(e); }
  };

  const handleLogout = async () => {
    if (confirm("Yakin ingin keluar dari akun?")) {
      await signOut(auth);
      setActiveTab("home");
    }
  };

  const handleShareProduct = async (platform: "whatsapp" | "facebook" | "telegram" | "x" | "native" | "copy", product: Product) => {
    const url = `${window.location.origin}/shop?product=${encodeURIComponent(product.id)}`;
    const message = `Yuk coba ${product.name} (${formatRp(product.price)}) di Toko Manis! ${url}`;
    const encodedUrl = encodeURIComponent(url);
    const encodedText = encodeURIComponent(`Yuk coba ${product.name} (${formatRp(product.price)}) di Toko Manis!`);
    setShareSheetOpen(false);
    if (platform === "whatsapp") {
      // Click-to-chat: membuka draft WhatsApp saja, tidak mengirim otomatis.
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
    } else if (platform === "facebook") {
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`, "_blank", "noopener,noreferrer,width=640,height=600");
    } else if (platform === "telegram") {
      window.open(`https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`, "_blank", "noopener,noreferrer");
    } else if (platform === "x") {
      window.open(`https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`, "_blank", "noopener,noreferrer,width=640,height=500");
    } else if (platform === "native" && navigator.share) {
      try { await navigator.share({ title: product.name, text: `Yuk coba ${product.name} di Toko Manis!`, url }); }
      catch (error: any) { if (error?.name !== "AbortError") console.warn("Bagikan gagal:", error); }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        alert("Link produk berhasil disalin.");
      } catch { alert(`Salin link ini: ${url}`); }
    }
  };

  const handleSaveProfile = () => {
    if (!user) return;
    if (!editProfile.phone.trim() || !editProfile.address.trim()) {
      alert("Nomor WhatsApp dan alamat wajib diisi untuk membuat pesanan.");
      return;
    }
    update(ref(db, `users/${user.uid}`), {
      name: user.name,
      email: user.email,
      photoURL: user.photoURL,
      phone: editProfile.phone.trim(),
      address: editProfile.address.trim(),
      favorites
    }).then(() => {
      setUser({ ...user, phone: editProfile.phone.trim(), address: editProfile.address.trim() });
      alert("Profil berhasil disimpan!");
    });
  };

  // ==============================================
  // CART
  // ==============================================
  const addToCart = (product: Product, qty: number, selectedVariants: string[], cookingMethod: string, note: string) => {
    if (product.stock === 0) return alert("Stok habis!");
    const variantKey = selectedVariants.slice().sort().join("+");
    const cartItemId = `${product.id}-${variantKey}-${cookingMethod}-${note}`.replace(/\s+/g, "-");
    const existIndex = cart.findIndex(c => c.cartItemId === cartItemId);

    if (existIndex >= 0) {
      const newCart = [...cart];
      if (newCart[existIndex].qty + qty > product.stock) return alert("Stok maksimal!");
      newCart[existIndex].qty += qty;
      setCart(newCart);
    } else {
      setCart([...cart, { ...product, cartItemId, qty, selectedVariants, cookingMethod, note }]);
    }
  };

  const updateCartQty = (cartItemId: string, delta: number) => {
    setCart(cart.map((c) => {
      if (c.cartItemId !== cartItemId) return c;
      const next = c.qty + delta;
      if (next <= 0) return null;
      const p = products.find((x) => x.id === c.id);
      if (p && next > p.stock) return c;
      return { ...c, qty: next };
    }).filter(Boolean) as CartItem[]);
  };

  const getTotalProductQty = (productId: string) => cart.filter(c => c.id === productId).reduce((s, i) => s + i.qty, 0);
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);

  const handleCheckout = async () => {
    if (!user) return alert("Login dulu untuk pesan!");
    if (cart.length === 0) return alert("Keranjang masih kosong.");
    const phone = editProfile.phone.trim() || user.phone?.trim() || "";
    const address = editProfile.address.trim() || user.address?.trim() || "";
    if (!phone || !address) {
      alert("Nomor WhatsApp dan alamat wajib diisi sebelum membuat pesanan.");
      setActiveTab("settings"); return;
    }
    if (!qrisImageUrl) return alert("QRIS belum diatur oleh admin. Silakan hubungi toko.");
    try {
      await update(ref(db, `users/${user.uid}`), { name: user.name, email: user.email, photoURL: user.photoURL, phone, address, favorites });
      const orderRef = push(ref(db, "orders"));
      const now = new Date();
      const dateKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
      let reservedCode = 0;
      for (let attempt = 0; attempt < 100 && !reservedCode; attempt++) {
        const candidate = Math.floor(Math.random() * 499) + 1;
        const reservationRef = ref(db, `qrisPaymentReservations/${dateKey}/${candidate}`);
        try {
          const result = await runTransaction(reservationRef, current => {
            if (!current || (current.expiresAt || 0) < Date.now()) {
              return { uid: user.uid, orderId: orderRef.key, createdAt: Date.now(), expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
            }
            return;
          }, { applyLocally: false });
          if (result.committed) reservedCode = candidate;
        } catch (reservationError: any) {
          // A rule intentionally hides other customers' reservation details; skip that code.
          if (!String(reservationError?.code || reservationError?.message || "").includes("PERMISSION_DENIED")) throw reservationError;
        }
      }
      if (!reservedCode) throw new Error("Kode unik hari ini sedang penuh. Coba lagi beberapa menit lagi.");
      setUser({ ...user, phone, address });
      setQrisOrderId(orderRef.key || ""); setReservationDateKey(dateKey); setQrisUniqueCode(reservedCode);
      setPaymentProofFile(null); setPaymentProofPreview(""); setIsQrisOpen(true);
    } catch (error: any) {
      console.error("Gagal menyiapkan checkout:", error);
      alert(error?.message?.includes("permission") ? "Gagal menyiapkan kode unik. Admin perlu menerbitkan Firebase Realtime Database Rules terbaru." : error?.message || "Data pelanggan/kode unik gagal disimpan.");
    }
  };

  const closeQrisModal = async () => {
    if (user?.uid && reservationDateKey && qrisUniqueCode && qrisOrderId) {
      try { await remove(ref(db, `qrisPaymentReservations/${reservationDateKey}/${qrisUniqueCode}`)); } catch (error) { console.warn("Reservasi kode unik akan kedaluwarsa otomatis:", error); }
    }
    setIsQrisOpen(false); setPaymentProofFile(null); setPaymentProofPreview("");
  };

  const submitQrisOrderForVerification = async () => {
    if (!user || !qrisImageUrl || cart.length === 0 || !paymentProofFile || !qrisOrderId || !qrisUniqueCode || isSubmittingOrder) {
      if (!paymentProofFile) alert("Pilih foto bukti pembayaran terlebih dahulu.");
      return;
    }
    if (!paymentProofFile.type.startsWith("image/") || paymentProofFile.size > 5 * 1024 * 1024) return alert("Pilih gambar maksimal 5 MB.");
    setIsSubmittingOrder(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Sesi login berakhir. Silakan login ulang.");
      const safePhoto = await prepareProofImage(paymentProofFile);
      if (safePhoto.size > 5 * 1024 * 1024) throw new Error("Foto setelah diproses masih lebih dari 5 MB. Pilih foto yang lebih kecil.");
      const form = new FormData(); form.set("proof", safePhoto); form.set("orderId", qrisOrderId); form.set("dateKey", reservationDateKey); form.set("uniqueCode", String(qrisUniqueCode));
      const uploadEndpoint = process.env.NEXT_PUBLIC_PROOF_UPLOAD_URL;
      if (!uploadEndpoint) throw new Error("URL Worker upload belum diatur. Admin perlu menambahkan NEXT_PUBLIC_PROOF_UPLOAD_URL di Cloudflare Pages.");
      const uploadResponse = await fetch(uploadEndpoint, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const uploadResult = await uploadResponse.json();
      if (!uploadResponse.ok || !uploadResult.path) throw new Error(uploadResult.error || "Unggah foto bukti privat gagal.");
      const payableTotal = cartTotal + qrisUniqueCode;
      await set(ref(db, `orders/${qrisOrderId}`), {
        orderNumber: "ORD-" + Math.random().toString(36).slice(2, 8).toUpperCase(), date: new Date().toLocaleString("id-ID"), createdAt: Date.now(),
        items: cart, subtotal: cartTotal, uniqueCode: qrisUniqueCode, total: payableTotal,
        paymentProofPath: uploadResult.path,
        source: "shop", status: "PENDING_PAYMENT", paymentStatus: "CUSTOMER_CLAIMS_PAID", paymentMethod: "QRIS", orderType,
        customer: { uid: user.uid, name: user.name, phone: editProfile.phone.trim() || user.phone || "", address: editProfile.address.trim() || user.address || "" }
      });
      setCart([]); setIsQrisOpen(false); setPaymentProofFile(null); setPaymentProofPreview(""); setActiveTab("active");
      alert("Bukti pembayaran terkirim. Admin akan mencocokkan total belanja dan kode unik di aplikasi merchant.");
    } catch (error: any) {
      console.error("Gagal mengirim bukti/order QRIS:", error);
      alert(error?.message || "Pesanan atau bukti gagal dikirim. Periksa koneksi lalu coba lagi.");
    } finally { setIsSubmittingOrder(false); }
  };

  const toggleFavorite = (id: string) => {
    setFavorites(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  };

  const filtered = products.filter((p) => {
    const cat = selectedCategory === "Semua" || p.category === selectedCategory;
    return cat && p.name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const categories = ["Semua", "Terang Bulan", "Roti Bakar", "Pisang Keju"];
  const groups = categories.filter(c => c !== "Semua").map(cat => ({
    category: cat, items: filtered.filter(p => p.category === cat),
  })).filter(g => g.items.length > 0);

  const wishlistProducts = products.filter(p => favorites.includes(p.id));
  const myOrders = orders.filter(o => o.customer?.uid === user?.uid);
  
  // Semua pesanan kasir/shop memakai siklus status yang sama.
  const activeOrders = myOrders.filter(o => !["completed", "canceled"].includes(orderStatusKind(o.status)));
  const historyOrders = myOrders.filter(o => ["completed", "canceled"].includes(orderStatusKind(o.status)));

  if (!isClient) return null;
  if (!isOnline) return (
    <main className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden bg-gradient-to-br from-orange-50 via-rose-50 to-sky-50 px-6 text-center">
      <div className="pointer-events-none absolute -left-16 top-16 h-48 w-48 rounded-full bg-orange-200/40 blur-3xl animate-pulse" />
      <div className="pointer-events-none absolute -right-12 bottom-10 h-56 w-56 rounded-full bg-sky-200/50 blur-3xl animate-pulse" />
      <section className="relative z-10 mx-auto w-full max-w-sm rounded-[32px] border border-white/80 bg-white/80 p-7 shadow-xl backdrop-blur-md">
        <div className="relative mx-auto mb-5 flex h-28 w-28 items-center justify-center rounded-full bg-orange-100 text-orange-500 shadow-inner">
          <div className="absolute inset-0 rounded-full border-2 border-orange-200 animate-ping opacity-40" />
          <WifiOff size={48} strokeWidth={1.8} className="animate-bounce" />
          <Sparkles size={19} className="absolute -right-1 top-1 text-amber-500 animate-pulse" />
        </div>
        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-orange-500">Sinyal sedang petak umpet</p>
        <h1 className="text-2xl font-black leading-tight text-slate-900">Yah, internetnya kabur! 😵‍💫</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">Kuota atau sinyalnya mungkin sedang istirahat. Tenang, selama halaman ini tetap terbuka, isi keranjangmu masih menunggu di sini.</p>
        <div className="mt-5 rounded-2xl bg-orange-50 px-4 py-3 text-xs font-semibold text-orange-800">Kami cek koneksi lagi otomatis sebentar lagi. Coba dekati Wi-Fi atau bangunkan kuotanya dulu, ya.</div>
        <button onClick={() => { void checkInternetConnection(); }} disabled={isCheckingNetwork} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-3.5 text-sm font-black text-white shadow-lg shadow-orange-500/25 transition active:scale-[0.98] disabled:opacity-70">
          <RefreshCw size={16} className={isCheckingNetwork ? "animate-spin" : ""} />
          {isCheckingNetwork ? "Mencari sinyal…" : "Coba sambungkan lagi"}
        </button>
        <p className="mt-4 text-[10px] text-slate-400">Janji, rotinya tidak ikut offline 🍞</p>
      </section>
    </main>
  );

  // ---- Product Card ----
  const ProductCardGrid = ({ product }: { product: Product }) => {
    const qty = getTotalProductQty(product.id);
    return (
      <article
        className="group flex h-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-[22px] border border-orange-100 bg-white shadow-[0_5px_18px_rgba(124,45,18,0.08)] transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
        onClick={() => setSelectedProduct(product)}
      >
        <div className="relative aspect-[1.12/1] w-full overflow-hidden bg-orange-50">
          <img src={product.imageUrl || FALLBACK_PRODUCT_IMAGE} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_PRODUCT_IMAGE; }} alt={product.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
          {product.stock === 0 && <span className="absolute left-2 top-2 rounded-full bg-slate-900/80 px-2 py-1 text-[9px] font-bold text-white">Stok habis</span>}
        </div>
        <div className="flex min-h-[100px] flex-1 flex-col p-2.5 sm:p-3">
          <h3 className="line-clamp-2 min-h-[34px] text-[12px] font-extrabold leading-snug text-slate-800 sm:text-sm">{product.name}</h3>
          <p className="mt-1 line-clamp-1 text-[9px] text-slate-400 sm:text-[10px]">{product.description || `Pilihan favorit ${product.category.toLowerCase()}`}</p>
          <div className="mt-auto flex items-center justify-between gap-1 pt-2">
            <span className="min-w-0 truncate text-[11px] font-black text-slate-900 sm:text-[13px]">{formatRp(product.price)}</span>
            <div onClick={(e) => e.stopPropagation()} className="shrink-0">
              {qty > 0 ? (
                <button onClick={() => setCustomizingProduct(product)} className="rounded-full bg-orange-500 px-2 py-1.5 text-[9px] font-bold text-white shadow-sm sm:text-[10px]">{qty} · Ubah</button>
              ) : (
                <button onClick={() => setCustomizingProduct(product)} disabled={product.stock === 0} aria-label={`Tambah ${product.name}`} className="rounded-full border border-orange-200 bg-orange-50 p-1.5 text-orange-700 transition hover:bg-orange-100 disabled:opacity-40"><Plus size={14} strokeWidth={3} /></button>
              )}
            </div>
          </div>
        </div>
      </article>
    );
  };

  const ProductCardList = ({ product }: { product: Product }) => (
    <article onClick={() => setSelectedProduct(product)} className="relative flex cursor-pointer items-center gap-3 rounded-2xl border border-orange-100 bg-white p-3 shadow-sm transition hover:shadow-md">
      <div className="h-[76px] w-[76px] shrink-0 overflow-hidden rounded-2xl bg-orange-50">
        <img src={product.imageUrl || FALLBACK_PRODUCT_IMAGE} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_PRODUCT_IMAGE; }} alt={product.name} className="h-full w-full object-cover" />
      </div>
      <div className="min-w-0 flex-1 pr-8">
        <h3 className="line-clamp-1 text-sm font-black text-slate-800">{product.name}</h3>
        <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-500">{product.description || `Nikmati kelezatan ${product.name.toLowerCase()} pilihan.`}</p>
        <p className="mt-2 text-xs font-black text-slate-900">{formatRp(product.price)}</p>
      </div>
      <button onClick={(e) => { e.stopPropagation(); toggleFavorite(product.id); }} aria-label="Hapus dari wishlist" className="absolute right-2 top-2 z-10 rounded-full bg-orange-50 p-2 text-orange-500 hover:bg-orange-100">
        <Heart size={16} fill="#f97316" />
      </button>
    </article>
  );

  // ==============================================
  // CUSTOM PURCHASE MODAL
  // ==============================================
  const CustomPurchaseModal = () => {
    if (!customizingProduct) return null;
    const p = customizingProduct;
    const variantList = p.variants || []; const cookingList = p.cookingOptions || []; const maxVar = p.maxVariant || 1;
    const [selectedVariants, setSelectedVariants] = useState<string[]>([]);
    const [cookingMethod, setCookingMethod] = useState(cookingList[0] || "");
    const [note, setNote] = useState("");
    const [localQty, setLocalQty] = useState(1);
    const totalPrice = p.price * localQty;

    const toggleVariant = (v: string) => {
      if (selectedVariants.includes(v)) setSelectedVariants(selectedVariants.filter(x => x !== v));
      else {
        if (selectedVariants.length >= maxVar) return alert(`Maksimal pilih ${maxVar} rasa!`);
        setSelectedVariants([...selectedVariants, v]);
      }
    };

    const handleAddToCart = () => {
      if (variantList.length > 0 && selectedVariants.length === 0) return alert("Pilih minimal 1 varian rasa!");
      if (cookingList.length > 0 && !cookingMethod) return alert("Pilih metode!");
      addToCart(p, localQty, selectedVariants, cookingMethod, note);
      setCustomizingProduct(null);
    };

    return (
      <div className="absolute inset-0 z-[60] bg-white flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center gap-3 p-4 border-b border-slate-100 bg-white shadow-sm shrink-0">
          <button onClick={() => setCustomizingProduct(null)} className="p-2 hover:bg-slate-100 rounded-full"><ArrowLeft size={22} className="text-slate-800" /></button>
          <h2 className="font-bold text-lg text-slate-800">Custom pembelian</h2>
        </div>
        <div className="flex-1 overflow-y-auto bg-slate-50 pb-6">
          <div className="bg-white p-5 flex justify-between items-start gap-4 mb-2 shadow-sm">
            <h1 className="font-extrabold text-lg text-slate-800 leading-tight">{p.name}</h1>
            <span className="font-bold text-lg text-slate-800 shrink-0">{formatNumber(p.price)}</span>
          </div>
          {variantList.length > 0 && (
            <div className="bg-white p-5 mb-2 shadow-sm">
              <h3 className="font-bold text-base text-slate-800 mb-0.5">Varian Rasa</h3>
              <p className="text-xs font-semibold text-orange-600 mb-4">Harus dipilih <span className="text-slate-400 font-normal">• Pilih max {maxVar}</span></p>
              <div className="space-y-1">
                {variantList.map((v) => {
                  const isSelected = selectedVariants.includes(v);
                  const isDisabled = !isSelected && selectedVariants.length >= maxVar;
                  return (
                    <label key={v} className={`flex justify-between items-center cursor-pointer py-3 border-b border-dashed border-slate-100 last:border-0 ${isDisabled ? "opacity-40 cursor-not-allowed" : ""}`}>
                      <span className={`text-sm font-semibold ${isSelected ? "text-orange-700" : "text-slate-700"}`}>{v}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400">Gratis</span>
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${isSelected ? "border-orange-500 bg-orange-500" : "border-slate-300 bg-white"}`}>
                          {isSelected && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                      </div>
                      <input type="checkbox" checked={isSelected} disabled={isDisabled} onChange={() => toggleVariant(v)} className="hidden" />
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {cookingList.length > 0 && (
            <div className="bg-white p-5 mb-2 shadow-sm">
              <h3 className="font-bold text-base text-slate-800 mb-0.5">Metode / Kustomisasi</h3>
              <p className="text-xs font-semibold text-orange-600 mb-4">Harus dipilih <span className="text-slate-400 font-normal">• Pilih 1</span></p>
              <div className="space-y-1">
                {cookingList.map((opt) => (
                  <label key={opt} className="flex justify-between items-center cursor-pointer py-3 border-b border-dashed border-slate-100 last:border-0">
                    <span className={`text-sm font-semibold ${cookingMethod === opt ? "text-orange-700" : "text-slate-700"}`}>{opt}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400">Gratis</span>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${cookingMethod === opt ? "border-orange-500" : "border-slate-300"}`}>
                        {cookingMethod === opt && <div className="w-2.5 h-2.5 bg-orange-500 rounded-full" />}
                      </div>
                    </div>
                    <input type="radio" name="cooking" value={opt} checked={cookingMethod === opt} onChange={() => setCookingMethod(opt)} className="hidden" />
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="bg-white p-5 shadow-sm">
            <h3 className="font-bold text-base text-slate-800 mb-1">Catatan</h3>
            <p className="text-xs text-slate-400 mb-3">Opsional</p>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Tulis permintaan khusus di sini, ya" className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 resize-none h-24" />
          </div>
        </div>
        <div className="bg-white p-5 border-t border-slate-200 shrink-0">
          <div className="flex justify-between items-center mb-4">
            <span className="font-extrabold text-base text-slate-800">Jumlah pembelian</span>
            <div className="flex items-center gap-4">
              <button onClick={() => setLocalQty(Math.max(1, localQty - 1))} className="w-8 h-8 rounded-full border-2 border-orange-500 text-orange-500 flex items-center justify-center hover:bg-orange-50"><Minus size={16} strokeWidth={3} /></button>
              <span className="font-black text-lg text-slate-800 w-6 text-center">{localQty}</span>
              <button onClick={() => setLocalQty(localQty + 1)} className="w-8 h-8 rounded-full border-2 border-orange-500 text-orange-500 flex items-center justify-center hover:bg-orange-50"><Plus size={16} strokeWidth={3} /></button>
            </div>
          </div>
          <button onClick={handleAddToCart} className="w-full bg-orange-500 hover:bg-orange-600 text-white rounded-full py-4 font-bold text-[15px] transition-all active:scale-95 shadow-lg shadow-orange-500/30">
            Tambah pembelian - {formatNumber(totalPrice)}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-slate-200 flex justify-center items-center sm:py-6 z-0">
      <div className="w-full h-full sm:max-w-[410px] sm:h-[860px] sm:max-h-full sm:rounded-[40px] sm:border-[8px] sm:border-slate-800 bg-[#fbfbfb] shadow-2xl flex overflow-hidden relative">
        
        {/* SIDEBAR KIRI */}
        <aside className="w-[60px] bg-white border-r border-slate-100 flex flex-col items-center py-5 rounded-r-[24px] shadow-[4px_0_24px_rgba(0,0,0,0.04)] z-20 shrink-0">
          <button onClick={handleLogin} className="w-11 h-11 rounded-full bg-slate-100 border-2 border-orange-200 overflow-hidden flex items-center justify-center mb-6 shadow-sm">
            {user ? <img src={user.photoURL || FALLBACK_PROFILE_IMAGE} alt="Foto profil Google" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_PROFILE_IMAGE; }} className="w-full h-full object-cover" /> : <User className="text-slate-400" size={20} />}
          </button>
          
          <nav className="flex-1 flex flex-col gap-5 w-full items-center">
            <button onClick={() => setActiveTab("home")} className={`p-2.5 rounded-2xl transition-all ${activeTab==="home" ? "bg-orange-100 text-orange-600 shadow-sm" : "text-slate-400 hover:text-orange-500"}`}><Home size={22}/></button>
            <button onClick={() => setActiveTab("active")} className={`p-2.5 rounded-2xl transition-all relative ${activeTab==="active" ? "bg-orange-100 text-orange-600 shadow-sm" : "text-slate-400 hover:text-orange-500"}`}>
              <Clock size={22}/>
              {activeOrders.length > 0 && <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>}
            </button>
            <button onClick={() => setActiveTab("history")} className={`p-2.5 rounded-2xl transition-all ${activeTab==="history" ? "bg-orange-100 text-orange-600 shadow-sm" : "text-slate-400 hover:text-orange-500"}`}><ClipboardList size={22}/></button>
            <button onClick={() => setActiveTab("settings")} className={`p-2.5 rounded-2xl transition-all ${activeTab==="settings" ? "bg-orange-100 text-orange-600 shadow-sm" : "text-slate-400 hover:text-orange-500"}`}><Settings size={22}/></button>
            
            {/* WISHLIST occupies the former sidebar logout slot. */}
            <button onClick={() => setActiveTab("wishlist")} title="Wishlist" aria-label="Wishlist" className={`relative mt-auto p-2.5 rounded-2xl transition-all ${activeTab === "wishlist" ? "bg-orange-100 text-orange-600" : "text-slate-400 hover:text-orange-500 hover:bg-orange-50"}`}>
              <Heart size={22} fill={favorites.length > 0 ? "#f97316" : "none"} />
              {favorites.length > 0 && <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-white bg-red-500 text-[8px] font-bold text-white">{favorites.length}</span>}
            </button>
          </nav>
          
          <button onClick={() => setActiveTab("cart")} aria-label={cartCount > 0 ? "Pesan Sekarang" : "Keranjang"} className={`relative mt-4 flex w-full flex-col items-center gap-1 rounded-2xl px-0.5 py-2 transition-all shadow-md ${activeTab==="cart" ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-600"}`}>
            <ShoppingBasket size={22} />
            <span className="w-[56px] text-center text-[8px] font-black leading-tight">{cartCount > 0 ? "Pesan Sekarang" : "Keranjang"}</span>
            {cartCount > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white">{cartCount}</span>}
          </button>
        </aside>

        {/* KONTEN UTAMA */}
        <main className="flex-1 overflow-y-auto pb-24 relative min-w-0 scroll-smooth bg-[#fbfbfb]">
          
          {/* TAB: BERANDA */}
          {activeTab === "home" && (
            <div className="px-5 pt-8">
              <div className="flex items-start justify-between mb-4 gap-2">
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl font-black text-slate-800 truncate">Hai {user ? user.name.split(" ")[0] : "Guest"},</h1>
                  <p className="text-slate-500 text-xs mt-0.5 truncate">{user ? user.email : "@tokomanis.official"}</p>
                </div>
                {user && <button onClick={handleLogout} aria-label="Keluar dari akun" title="Keluar" className="shrink-0 rounded-full border border-rose-100 bg-white p-2.5 text-rose-500 shadow-sm transition hover:bg-rose-50">
                  <LogOut size={20} />
                </button>}
              </div>

              <div className="relative mb-6">
                <Search className="absolute left-3.5 top-3.5 text-slate-400" size={18} />
                <input type="text" placeholder="Cari makanan favoritmu..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-white border border-slate-200 rounded-2xl py-3 pl-10 pr-4 text-sm outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 shadow-sm" />
              </div>

              <div className="mb-2">
                <h2 className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider">Kategori</h2>
                <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
                  {categories.map((cat) => (
                    <button key={cat} onClick={() => setSelectedCategory(cat)} className={`px-4 py-2 rounded-full whitespace-nowrap text-[13px] font-bold transition-all ${selectedCategory === cat ? "bg-orange-500 text-white shadow-md shadow-orange-500/30" : "bg-white text-slate-500 border border-slate-200"}`}>{cat}</button>
                  ))}
                </div>
              </div>

              <div className="space-y-8 mt-5">
                {groups.length === 0 ? (
                  <p className="text-center text-slate-400 text-sm mt-10">Pencarian tidak ditemukan.</p>
                ) : groups.map(group => (
                  <div key={group.category}>
                    <div className="flex justify-between items-center mb-3">
                      <h2 className="text-lg font-black text-slate-800">{group.category}</h2>
                      <button className="flex items-center text-[11px] font-bold text-slate-500 bg-white px-3 py-1.5 rounded-full border border-slate-200 shadow-sm">All <ChevronRight size={14}/></button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:gap-4">
                      {group.items.map((product) => <ProductCardGrid key={product.id} product={product} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB: WISHLIST */}
          {activeTab === "wishlist" && (
            <div className="px-5 pt-8">
              <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl font-black flex items-center gap-2"><Heart size={22} className="text-orange-500" fill="#f97316" /> Wishlist</h1>
                <button onClick={() => setActiveTab("home")} className="p-2 hover:bg-slate-100 rounded-full"><X size={20} className="text-slate-500" /></button>
              </div>
              
              {wishlistProducts.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <Heart size={48} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">Wishlist masih kosong</p>
                </div>
              ) : (
                <div className="mt-2 space-y-6">
                  {wishlistProducts.map((product) => <ProductCardList key={product.id} product={product} />)}
                </div>
              )}
            </div>
          )}

          {/* TAB: CART */}
          {activeTab === "cart" && (
            <div className="px-5 pt-8 flex flex-col h-full">
              <h1 className="text-2xl font-black mb-6">Keranjang</h1>
              {cart.length === 0 ? (
                <div className="text-center text-slate-400 py-10 flex-1"><ShoppingBasket size={48} className="mx-auto mb-3 opacity-30"/>Belum ada pesanan.</div>
              ) : (
                <div className="flex-1 flex flex-col">
                  <div className="space-y-3 flex-1">
                    {cart.map((item) => (
                      <div key={item.cartItemId} className="bg-white p-3 rounded-2xl shadow-sm flex items-start gap-3 border border-slate-100">
                        <img src={item.imageUrl || FALLBACK_PRODUCT_IMAGE} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_PRODUCT_IMAGE; }} alt={item.name} className="w-16 h-16 rounded-xl object-cover shrink-0" />
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-sm truncate">{item.name}</h3>
                          {item.selectedVariants?.length > 0 && (
                            <p className="text-[10px] text-orange-600 font-semibold truncate">
                              {item.selectedVariants.join(" + ")}
                            </p>
                          )}
                          {item.cookingMethod && (
                            <p className="text-[10px] text-slate-500 truncate">{item.cookingMethod}</p>
                          )}
                          {item.note && <p className="text-[9px] text-slate-400 italic truncate">📝 {item.note}</p>}
                          <p className="text-orange-600 font-bold text-xs mt-0.5">{formatRp(item.price)}</p>
                        </div>
                        <div className="flex items-center gap-1.5 bg-slate-50 px-1.5 py-1 rounded-full shrink-0 border border-slate-100 self-center">
                          <button onClick={() => updateCartQty(item.cartItemId, -1)} className="p-1 text-slate-600"><Minus size={12} /></button>
                          <span className="font-bold text-xs w-4 text-center">{item.qty}</span>
                          <button onClick={() => updateCartQty(item.cartItemId, 1)} className="p-1 text-slate-600"><Plus size={12} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <div className="mt-4 bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
                    <h3 className="font-bold text-sm mb-3 text-slate-700">Tipe Pesanan</h3>
                    <div className="flex gap-2 mb-5 bg-slate-50 p-1.5 rounded-2xl">
                      <button onClick={()=>setOrderType("delivery")} className={`flex-1 py-2 text-xs font-bold rounded-xl ${orderType==="delivery" ? "bg-orange-500 text-white shadow-md" : "text-slate-500 hover:bg-slate-200"}`}>Delivery (Antar)</button>
                      <button onClick={()=>setOrderType("takeaway")} className={`flex-1 py-2 text-xs font-bold rounded-xl ${orderType==="takeaway" ? "bg-orange-500 text-white shadow-md" : "text-slate-500 hover:bg-slate-200"}`}>Take Away (Ambil)</button>
                    </div>
                    {orderType === "takeaway" ? (
                      <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                        <p className="font-bold">Alamat pengambilan</p>
                        <p className="mt-1">{pickupAddress || "Lokasi toko belum diatur admin."}</p>
                        {takeawayMapUrl && <a href={takeawayMapUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded-lg bg-emerald-700 px-3 py-2 font-bold text-white">Buka Google Maps</a>}
                      </div>
                    ) : (
                      <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                        <p className="font-bold">Catatan biaya pengantaran</p>
                        <p>Ongkos kirim driver merupakan biaya tambahan, tidak termasuk total QRIS makanan, dan dibayar terpisah kepada driver. Nominal mengikuti jarak/lokasi.</p>
                      </div>
                    )}

                    <div className="flex justify-between font-black text-base mb-5">
                      <span>Total Bayar</span>
                      <span className="text-orange-600">{formatRp(cartTotal)}</span>
                    </div>
                    {!user ? (
                      <button onClick={handleLogin} className="w-full py-3.5 bg-slate-800 text-white rounded-2xl font-bold text-sm hover:bg-slate-900 transition-colors">Login untuk Pesan</button>
                    ) : (
                      <button onClick={handleCheckout} className="w-full py-3.5 bg-orange-500 text-white rounded-2xl font-bold text-sm shadow-lg shadow-orange-500/30 hover:bg-orange-600 transition-all active:scale-95">Pesan Sekarang — Lanjut Pembayaran QRIS</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: ACTIVE ORDERS */}
          {activeTab === "active" && (
            <div className="px-5 pt-8">
              <h1 className="text-2xl font-black mb-6 flex items-center gap-2"><Clock size={24}/> Order Aktif</h1>
              {!user ? <p className="text-sm text-slate-500">Silakan login.</p> : activeOrders.length === 0 ? <p className="text-sm text-slate-500">Belum ada order aktif.</p> : (
                <div className="space-y-4">
                  {activeOrders.map(order => (
                    <div key={order.id} className="bg-white p-4 rounded-3xl border border-orange-100 shadow-sm">
                      <div className="flex justify-between items-center mb-3 border-b border-slate-100 pb-3">
                        <span className="font-black text-sm">#{order.orderNumber}</span>
                        {/* Keterangan Status Disesuaikan */}
                        <span className="text-[10px] bg-orange-100 text-orange-700 px-2.5 py-1 rounded-full font-bold animate-pulse">
                          {getStatusText(order.status)}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mb-3 font-medium">Tipe: <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">{order.orderType?.toUpperCase()}</span></div>
                      {order.items?.map((item: any, i: number) => (
                        <div key={i} className="mb-2">
                          <div className="text-xs font-semibold text-slate-700">{item.qty}x {item.name}</div>
                          {item.selectedVariants?.length > 0 && <div className="text-[10px] text-orange-600 ml-4">- {item.selectedVariants.join(" + ")}</div>}
                          {item.cookingMethod && <div className="text-[10px] text-slate-500 ml-4">- {item.cookingMethod}</div>}
                        </div>
                      ))}
                      <div className="pt-3 border-t border-dashed border-slate-200 flex justify-between font-black text-sm mt-2">
                        <span>Total</span>
                        <span className="text-orange-600">{formatRp(order.total)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB: HISTORY */}
          {activeTab === "history" && (
            <div className="px-5 pt-8">
              <h1 className="text-2xl font-black mb-6 flex items-center gap-2"><ClipboardList size={24}/> Riwayat</h1>
              {!user ? <p className="text-sm text-slate-500">Silakan login.</p> : historyOrders.length === 0 ? <p className="text-sm text-slate-500">Belum ada riwayat.</p> : (
                <div className="space-y-4">
                  {historyOrders.map(order => (
                    <div key={order.id} className="bg-slate-50 p-4 rounded-3xl border border-slate-200">
                      <div className="flex justify-between items-center mb-2 border-b pb-2 border-slate-200">
                        <span className="font-bold text-sm">#{order.orderNumber}</span>
                        <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${order.status === "COMPLETED" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                          {getStatusText(order.status)}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mb-2 font-medium">{order.date}</div>
                      <div className="flex justify-between font-black text-sm mt-3">
                        <span>Total Bayar</span>
                        <span>{formatRp(order.total)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB: SETTINGS */}
          {activeTab === "settings" && (
            <div className="px-5 pt-8">
              <h1 className="text-2xl font-black mb-6 flex items-center gap-2"><Settings size={24}/> Pengaturan</h1>
              {!user ? (
                <button onClick={handleLogin} className="w-full py-3.5 bg-slate-800 text-white rounded-2xl font-bold text-sm">Login Google</button>
              ) : (
                <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm space-y-5">
                  <div className="flex items-center gap-4 border-b border-slate-100 pb-5">
                    {/* Menggunakan foto profil bawaan Google murni */}
                    <img src={user.photoURL || FALLBACK_PROFILE_IMAGE} alt="Foto profil Google" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_PROFILE_IMAGE; }} className="w-14 h-14 rounded-full border-2 border-orange-100 object-cover" />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-black text-base text-slate-800 truncate">{user.name}</h3>
                      <p className="text-xs text-slate-500 truncate">{user.email}</p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">No. WhatsApp</label>
                    <input required type="tel" value={editProfile.phone} onChange={e=>setEditProfile({...editProfile, phone: e.target.value})} placeholder="Contoh: 08123456789" className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition-all"/>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1"><MapPin size={14}/> Alamat Pengiriman</label>
                    <textarea required value={editProfile.address} onChange={e=>setEditProfile({...editProfile, address: e.target.value})} rows={3} placeholder="Alamat lengkap (Jalan, RT/RW, Patokan)..." className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition-all"/>
                  </div>
                  <button onClick={handleSaveProfile} className="w-full bg-slate-900 hover:bg-slate-800 text-white py-3.5 rounded-2xl font-bold text-sm flex justify-center items-center gap-2 shadow-lg transition-colors">
                    <CheckCircle size={16}/> Simpan Perubahan
                  </button>
                </div>
              )}
            </div>
          )}

        </main>
        {activeTab === "home" && cartCount > 0 && (
          <div className="pointer-events-none absolute bottom-4 left-[60px] right-0 z-30 px-3">
            <button onClick={() => setActiveTab("cart")} aria-label={`Pesan Sekarang, ${cartCount} produk di keranjang`} className="pointer-events-auto flex w-full items-center justify-between gap-3 rounded-2xl bg-orange-500 px-4 py-3 text-left text-white shadow-xl shadow-orange-500/30 transition active:scale-[0.98]">
              <span className="flex min-w-0 items-center gap-2"><ShoppingBasket size={20} className="shrink-0"/><span className="truncate text-sm font-black">Pesan Sekarang</span></span>
              <span className="shrink-0 rounded-xl bg-white/20 px-2.5 py-1.5 text-[10px] font-bold">{cartCount} item · {formatRp(cartTotal)}</span>
            </button>
          </div>
        )}

        {/* POPUP 1: DETAIL PRODUK */}
        {selectedProduct && !customizingProduct && (
          <div className="absolute inset-0 z-50 flex flex-col justify-end overflow-hidden">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setSelectedProduct(null); setShareSheetOpen(false); }} />
            <div className="bg-white w-full max-h-[92%] rounded-t-[32px] p-5 pt-3 relative z-10 flex flex-col overflow-y-auto">
              <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-4" />
              <img src={selectedProduct.imageUrl || FALLBACK_PRODUCT_IMAGE} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_PRODUCT_IMAGE; }} alt={selectedProduct.name} className="w-full h-52 object-cover rounded-[24px] mb-4" />
              <h2 className="text-xl font-black text-slate-800 leading-tight">{selectedProduct.name}</h2>
              <p className="text-slate-500 text-sm mt-2 leading-relaxed">
                {selectedProduct.description || `Nikmati kelezatan ${selectedProduct.name} dengan bahan premium pilihan.`}
              </p>
              <p className="text-2xl font-black text-slate-900 mt-3">{formatNumber(selectedProduct.price)}</p>
              <div className="flex items-center gap-3 mt-5">
                <button onClick={() => toggleFavorite(selectedProduct.id)} className={`flex-1 flex items-center justify-center gap-2 border-2 rounded-full py-3 font-bold text-sm transition-colors ${favorites.includes(selectedProduct.id) ? "border-orange-400 bg-orange-50 text-orange-600" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                  <Heart size={16} fill={favorites.includes(selectedProduct.id) ? "#f97316" : "none"} color={favorites.includes(selectedProduct.id) ? "#f97316" : "#475569"} />
                  {favorites.includes(selectedProduct.id) ? "Tersimpan" : "Simpan"}
                </button>
                <button onClick={() => setShareSheetOpen(value => !value)} aria-expanded={shareSheetOpen} className="flex-1 flex items-center justify-center gap-2 border-2 border-slate-200 rounded-full py-3 font-bold text-sm text-slate-700 hover:bg-slate-50">
                  <Share2 size={16} /> Bagikan
                </button>
              </div>
              {shareSheetOpen && (
                <div className="mt-3 grid grid-cols-3 gap-2 rounded-2xl border border-slate-100 bg-slate-50 p-3">
                  <button onClick={() => void handleShareProduct("whatsapp", selectedProduct)} className="flex flex-col items-center gap-1.5 rounded-xl bg-white p-2.5 text-[10px] font-bold text-slate-700 shadow-sm"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><MessageCircle size={19}/></span>WhatsApp</button>
                  <button onClick={() => void handleShareProduct("facebook", selectedProduct)} className="flex flex-col items-center gap-1.5 rounded-xl bg-white p-2.5 text-[10px] font-bold text-slate-700 shadow-sm"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-lg font-black text-blue-700">f</span>Facebook</button>
                  <button onClick={() => void handleShareProduct("telegram", selectedProduct)} className="flex flex-col items-center gap-1.5 rounded-xl bg-white p-2.5 text-[10px] font-bold text-slate-700 shadow-sm"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-700"><Send size={18}/></span>Telegram</button>
                  <button onClick={() => void handleShareProduct("x", selectedProduct)} className="flex flex-col items-center gap-1.5 rounded-xl bg-white p-2.5 text-[10px] font-bold text-slate-700 shadow-sm"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-base font-black text-white">𝕏</span>X</button>
                  <button onClick={() => void handleShareProduct("native", selectedProduct)} className="flex flex-col items-center gap-1.5 rounded-xl bg-white p-2.5 text-[10px] font-bold text-slate-700 shadow-sm"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-100 text-orange-700"><Share2 size={18}/></span>Aplikasi lain</button>
                  <button onClick={() => void handleShareProduct("copy", selectedProduct)} className="flex flex-col items-center gap-1.5 rounded-xl bg-white p-2.5 text-[10px] font-bold text-slate-700 shadow-sm"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-violet-700"><Copy size={18}/></span>Salin link</button>
                </div>
              )}
              <button
                onClick={() => { setCustomizingProduct(selectedProduct); setSelectedProduct(null); setShareSheetOpen(false); }}
                disabled={selectedProduct.stock === 0}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white rounded-full py-4 mt-5 font-bold text-base shadow-lg shadow-orange-500/30 transition-all active:scale-95 disabled:bg-slate-400"
              >
                Tambah pembelian
              </button>
            </div>
          </div>
        )}

        {/* POPUP 2: CUSTOM PEMBELIAN */}
        <CustomPurchaseModal />

        {/* QRIS statis: pesanan menunggu verifikasi admin sebelum masuk dapur. */}
        {isQrisOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
            <section className="w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <div><h2 className="text-lg font-black text-slate-900">Pembayaran QRIS</h2><p className="text-xs text-slate-500">Scan lalu bayar sesuai total pesanan</p></div>
                <button onClick={closeQrisModal} className="rounded-full bg-slate-100 p-2 text-slate-500" aria-label="Tutup QRIS"><X size={18}/></button>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Total yang harus dibayar</p>
                <p className="mt-1 text-2xl font-black text-orange-600">{formatRp(cartTotal + qrisUniqueCode)}</p>
                <p className="mt-1 text-xs text-slate-600">Belanja {formatRp(cartTotal)} + kode unik {formatRp(qrisUniqueCode)}</p>
                <img src={qrisImageUrl} alt="QRIS toko" referrerPolicy="no-referrer" className="mx-auto mt-4 aspect-square w-56 rounded-xl bg-white object-contain p-2" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
              </div>
              <div className="mt-4 space-y-2 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                <p className="font-bold">Setelah membayar, tekan tombol konfirmasi di bawah.</p>
                <p>Dengan QRIS statis, sistem tidak dapat mendeteksi pembayaran otomatis. Admin akan memeriksa transaksi di aplikasi merchant; pesanan baru dikirim ke dapur setelah admin mengonfirmasi.</p>
              </div>
              <div className="mt-4 rounded-xl border border-slate-200 p-3">
                <label className="block text-xs font-bold text-slate-700">Unggah foto bukti pembayaran (wajib)</label>
                <input type="file" accept="image/*" onChange={e => {
                  const file = e.target.files?.[0] || null;
                  setPaymentProofFile(file);
                  setPaymentProofPreview(file ? URL.createObjectURL(file) : "");
                }} className="mt-2 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-orange-100 file:px-3 file:py-2 file:font-bold file:text-orange-700" />
                {paymentProofPreview && <img src={paymentProofPreview} alt="Pratinjau bukti pembayaran" className="mt-3 max-h-40 rounded-xl border object-contain" />}
                <div className="mt-2 space-y-1 text-[10px] leading-relaxed text-slate-500">
                  <p>JPG/PNG/WebP maksimal 5 MB. Unggah foto bukti pembayaran saja; jangan unggah kata sandi, OTP, atau data rahasia.</p>
                  <span>Saya memahami foto bukti akan disimpan. Jangan unggah foto yang menampilkan PIN, saldo, nomor rekening, atau data pribadi.</span>
                  <p>Bukti disimpan privat dan hanya dapat dilihat admin terotorisasi.</p>
                </div>
              </div>
              <button onClick={submitQrisOrderForVerification} disabled={isSubmittingOrder || !paymentProofFile} className="mt-4 w-full rounded-xl bg-emerald-600 py-3.5 text-sm font-black text-white disabled:opacity-50">
                {isSubmittingOrder ? "Mengunggah bukti…" : "Saya Sudah Bayar — Kirim Bukti untuk Verifikasi"}
              </button>
            </section>
          </div>
        )}

      </div>
    </div>
  );
}