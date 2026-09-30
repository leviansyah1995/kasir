"use client";

import { useState, useEffect } from "react";
import { 
  Search, Plus, Minus, ShoppingBasket, User, 
  ChevronRight, Home, Clock, ClipboardList, Settings, MapPin, CheckCircle,
  Heart, Share2, X, ArrowLeft, LogOut, QrCode
} from "lucide-react";
import { db, auth } from "../../lib/firebase";
import { ref, onValue, set, push, update, query, orderByChild, equalTo } from "firebase/database";
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
  const [user, setUser] = useState<UserProfile | null>(null);
  const [activeTab, setActiveTab] = useState<"home"|"active"|"history"|"settings"|"cart"|"wishlist">("home");

  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Semua");
  const [orderType, setOrderType] = useState<"delivery"|"takeaway">("delivery");
  const [editProfile, setEditProfile] = useState({ phone: "", address: "" });
  const [qrisImageUrl, setQrisImageUrl] = useState("");
  const [isQrisOpen, setIsQrisOpen] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);

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

    const unsubPaymentSettings = onValue(ref(db, "publicPaymentSettings/qrisImageUrl"), (snap) => {
      setQrisImageUrl(typeof snap.val() === "string" ? snap.val() : "");
    }, (error) => console.error("Gagal memuat QRIS:", error));

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
      setActiveTab("settings");
      return;
    }
    if (!qrisImageUrl) {
      alert("QRIS belum diatur oleh admin. Silakan hubungi toko.");
      return;
    }

    try {
      await update(ref(db, `users/${user.uid}`), {
        name: user.name, email: user.email, photoURL: user.photoURL,
        phone, address, favorites
      });
      setUser({ ...user, phone, address });
      setIsQrisOpen(true);
    } catch (error) {
      console.error("Gagal menyimpan data pelanggan:", error);
      alert("Data WhatsApp/alamat gagal disimpan. Periksa koneksi lalu coba lagi.");
    }
  };

  const submitQrisOrderForVerification = async () => {
    if (!user || !qrisImageUrl || cart.length === 0 || isSubmittingOrder) return;
    setIsSubmittingOrder(true);
    const orderRef = push(ref(db, "orders"));
    try {
      await set(orderRef, {
        orderNumber: "ORD-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
        date: new Date().toLocaleString("id-ID"),
        createdAt: Date.now(),
        items: cart,
        total: cartTotal,
        source: "shop",
        status: "PENDING_PAYMENT",
        paymentStatus: "CUSTOMER_CLAIMS_PAID",
        paymentMethod: "QRIS",
        orderType,
        customer: { uid: user.uid, name: user.name, phone: editProfile.phone.trim() || user.phone || "", address: editProfile.address.trim() || user.address || "" }
      });
      setCart([]);
      setIsQrisOpen(false);
      setActiveTab("active");
      alert("Pesanan tercatat dan menunggu admin memverifikasi pembayaran QRIS. Pesanan baru dikirim ke dapur setelah pembayaran dikonfirmasi.");
    } catch (error) {
      console.error("Gagal mengirim pesanan QRIS:", error);
      alert("Pesanan gagal dikirim. Periksa koneksi lalu coba lagi.");
    } finally {
      setIsSubmittingOrder(false);
    }
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

  // ---- Product Card ----
  const ProductCardGrid = ({ product }: { product: Product }) => {
    const qty = getTotalProductQty(product.id);
    return (
      <div
        className="relative bg-[#Fdf4e3] rounded-[24px] p-3 pt-14 flex flex-col border border-orange-200/50 shadow-sm cursor-pointer hover:bg-orange-100 transition-colors"
        onClick={() => setSelectedProduct(product)}
      >
        <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-[100px] h-[100px] rounded-full border-[4px] border-[#fbfbfb] shadow-md overflow-hidden bg-white shrink-0">
          <img src={product.imageUrl || FALLBACK_PRODUCT_IMAGE} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_PRODUCT_IMAGE; }} alt={product.name} className="w-full h-full object-cover" />
        </div>
        <h3 className="font-black text-slate-800 text-[14px] leading-tight mt-1 line-clamp-2 text-left min-h-[36px]">{product.name}</h3>
        
        <div className="mt-auto pt-2 w-full flex items-center justify-between gap-1">
          <span className="font-black text-slate-900 text-[13px] whitespace-nowrap">{formatRp(product.price)}</span>
          <div onClick={(e) => e.stopPropagation()}>
            {qty > 0 ? (
              <button onClick={() => setCustomizingProduct(product)} className="flex items-center justify-center bg-orange-500 text-white rounded-full px-2 py-1 text-[10px] font-bold shadow-sm whitespace-nowrap">
                {qty} (Ubah)
              </button>
            ) : (
              <button onClick={() => setCustomizingProduct(product)} disabled={product.stock === 0} className="p-1.5 bg-white hover:bg-orange-50 text-slate-800 rounded-full transition-all disabled:opacity-40 border border-orange-200 shadow-sm">
                <Plus size={14} strokeWidth={3} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const ProductCardList = ({ product }: { product: Product }) => {
    return (
      <div 
        onClick={() => setSelectedProduct(product)}
        className="relative ml-8 bg-[#Fdf4e3] rounded-[24px] p-4 pl-[76px] min-h-[110px] flex flex-col justify-center border border-orange-200/50 shadow-sm cursor-pointer hover:bg-orange-100 transition-colors mb-8"
      >
        <button onClick={(e) => { e.stopPropagation(); toggleFavorite(product.id); }} className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-white/50 hover:bg-white transition-colors">
          <Heart size={16} fill="#f97316" color="#f97316" />
        </button>
        <div className="absolute -left-8 top-1/2 -translate-y-1/2 w-[96px] h-[96px] rounded-full border-[4px] border-[#fbfbfb] shadow-md overflow-hidden bg-white shrink-0">
          <img src={product.imageUrl || FALLBACK_PRODUCT_IMAGE} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_PRODUCT_IMAGE; }} alt={product.name} className="w-full h-full object-cover" />
        </div>
        <div className="pr-6">
          <h3 className="font-black text-slate-800 text-[15px] leading-tight line-clamp-1 mb-1">{product.name}</h3>
          <p className="text-slate-500 text-[10px] line-clamp-2 leading-relaxed mb-2">{product.description || `Nikmati kelezatan ${product.name.toLowerCase()} pilihan.`}</p>
          <p className="font-black text-slate-900 text-[13px]">{formatRp(product.price)}</p>
        </div>
      </div>
    );
  };

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
        <aside className="w-[72px] bg-white border-r border-slate-100 flex flex-col items-center py-7 rounded-r-[28px] shadow-[4px_0_24px_rgba(0,0,0,0.04)] z-20 shrink-0">
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
            
            {/* LOGOUT BUTTON */}
            {user && (
              <button onClick={handleLogout} className="mt-auto p-2.5 rounded-2xl transition-all text-red-400 hover:text-red-500 hover:bg-red-50" title="Keluar">
                <LogOut size={22} />
              </button>
            )}
          </nav>
          
          <button onClick={() => setActiveTab("cart")} className={`relative p-3 mt-4 rounded-2xl transition-all shadow-md ${activeTab==="cart" ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-600"}`}>
            <ShoppingBasket size={22} />
            {cartCount > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white">{cartCount}</span>}
          </button>
        </aside>

        {/* KONTEN UTAMA */}
        <main className="flex-1 overflow-y-auto pb-10 relative min-w-0 scroll-smooth bg-[#fbfbfb]">
          
          {/* TAB: BERANDA */}
          {activeTab === "home" && (
            <div className="px-5 pt-8">
              <div className="flex items-start justify-between mb-4 gap-2">
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl font-black text-slate-800 truncate">Hai {user ? user.name.split(" ")[0] : "Guest"},</h1>
                  <p className="text-slate-500 text-xs mt-0.5 truncate">{user ? user.email : "@tokomanis.official"}</p>
                </div>
                <button onClick={() => setActiveTab("wishlist")} className="relative p-2.5 bg-white border border-slate-200 rounded-full shadow-sm hover:bg-orange-50 transition-colors shrink-0">
                  <Heart size={20} className="text-orange-500" fill={favorites.length > 0 ? "#f97316" : "none"} />
                  {favorites.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border border-white">{favorites.length}</span>}
                </button>
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

              <div className="space-y-16 mt-6">
                {groups.length === 0 ? (
                  <p className="text-center text-slate-400 text-sm mt-10">Pencarian tidak ditemukan.</p>
                ) : groups.map(group => (
                  <div key={group.category}>
                    <div className="flex justify-between items-center mb-16">
                      <h2 className="text-lg font-black text-slate-800">{group.category}</h2>
                      <button className="flex items-center text-[11px] font-bold text-slate-500 bg-white px-3 py-1.5 rounded-full border border-slate-200 shadow-sm">All <ChevronRight size={14}/></button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-16">
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

                    <div className="flex justify-between font-black text-base mb-5">
                      <span>Total Bayar</span>
                      <span className="text-orange-600">{formatRp(cartTotal)}</span>
                    </div>
                    {!user ? (
                      <button onClick={handleLogin} className="w-full py-3.5 bg-slate-800 text-white rounded-2xl font-bold text-sm hover:bg-slate-900 transition-colors">Login untuk Pesan</button>
                    ) : (
                      <button onClick={handleCheckout} className="w-full py-3.5 bg-orange-500 text-white rounded-2xl font-bold text-sm shadow-lg shadow-orange-500/30 hover:bg-orange-600 transition-all active:scale-95">Lanjut Pembayaran QRIS</button>
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

        {/* POPUP 1: DETAIL PRODUK */}
        {selectedProduct && !customizingProduct && (
          <div className="absolute inset-0 z-50 flex flex-col justify-end overflow-hidden">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedProduct(null)} />
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
                <button onClick={() => alert("Link disalin!")} className="flex-1 flex items-center justify-center gap-2 border-2 border-slate-200 rounded-full py-3 font-bold text-sm text-slate-700 hover:bg-slate-50">
                  <Share2 size={16} /> Bagikan
                </button>
              </div>
              <button
                onClick={() => { setCustomizingProduct(selectedProduct); setSelectedProduct(null); }}
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
                <button onClick={() => setIsQrisOpen(false)} className="rounded-full bg-slate-100 p-2 text-slate-500" aria-label="Tutup QRIS"><X size={18}/></button>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Total yang harus dibayar</p>
                <p className="mt-1 text-2xl font-black text-orange-600">{formatRp(cartTotal)}</p>
                <img src={qrisImageUrl} alt="QRIS toko" referrerPolicy="no-referrer" className="mx-auto mt-4 aspect-square w-56 rounded-xl bg-white object-contain p-2" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
              </div>
              <div className="mt-4 space-y-2 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                <p className="font-bold">Setelah membayar, tekan tombol konfirmasi di bawah.</p>
                <p>Dengan QRIS statis, sistem tidak dapat mendeteksi pembayaran otomatis. Admin akan memeriksa transaksi di aplikasi merchant; pesanan baru dikirim ke dapur setelah admin mengonfirmasi.</p>
              </div>
              <button onClick={submitQrisOrderForVerification} disabled={isSubmittingOrder} className="mt-4 w-full rounded-xl bg-emerald-600 py-3.5 text-sm font-black text-white disabled:opacity-50">
                {isSubmittingOrder ? "Mengirim…" : "Saya Sudah Bayar — Kirim untuk Verifikasi"}
              </button>
            </section>
          </div>
        )}

      </div>
    </div>
  );
}