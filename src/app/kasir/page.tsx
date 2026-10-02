"use client";

import { useState, useEffect } from "react";
import {
  Search, LayoutDashboard, Package, History,
  Settings, Plus, Minus, Trash2, X, Printer,
  Banknote, QrCode, Split, Save, LogOut
} from "lucide-react";
import { db, auth } from "../../lib/firebase";
import { ref, onValue, push, set, remove, update } from "firebase/database";
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";

// ==============================================
// TYPE DEFINITIONS
// ==============================================
interface Product {
  id: string; name: string; price: number; imageUrl: string;
  category: string; stock: number; active: boolean; description?: string;
  variants?: string[]; maxVariant?: number; cookingOptions?: string[];
  channelPrices?: { shopeefood?: number; grabfood?: number; gofood?: number };
}
interface CartItem extends Product {
  cartItemId: string; qty: number;
  selectedVariants: string[]; cookingMethod: string; note: string;
}
interface OrderHistory {
  id: string; orderNumber: string; date: string; createdAt: number;
  items: CartItem[]; total: number; paymentMethod: string; source: string; status: string;
  orderType: string; sourceLabel?: string; customer?: { name?: string; phone?: string; address?: string };
}

type PaymentMethod = "tunai" | "qris" | "split";
type TabType = "kasir" | "produk" | "riwayat" | "settings";
const DEFAULT_CATEGORIES = ["Terang Bulan", "Roti Bakar", "Pisang Keju", "Minuman"];
const CASHIER_SOURCES = ["kasir", "shopeefood", "grabfood", "gofood"];
const SOURCE_LABELS: Record<string, string> = { kasir: "Kasir", shopeefood: "ShopeeFood", grabfood: "GrabFood", gofood: "GoFood" };

const formatRp = (n: number) => "Rp. " + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const ADMIN_EMAIL = "dianarifin.shopeedriver@gmail.com";

// ==============================================
// MAIN COMPONENT
// ==============================================
export default function KasirPage() {
  const router = useRouter();
  const [isClient, setIsClient] = useState(false);
  const [adminUser, setAdminUser] = useState<any>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>("kasir");

  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<OrderHistory[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [salesChannel, setSalesChannel] = useState("kasir");
  const [activeCategory, setActiveCategory] = useState("Semua");
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingChannelPriceProduct, setEditingChannelPriceProduct] = useState<Product | null>(null);
  const [channelPriceDraft, setChannelPriceDraft] = useState({ shopeefood: "", grabfood: "", gofood: "" });

  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("tunai");
  const [cashAmount, setCashAmount] = useState<string>("");
  const [qrisAmount, setQrisAmount] = useState<string>("");
  const [transactionId, setTransactionId] = useState("");
  const [transactionDate, setTransactionDate] = useState("");

  const [newProduct, setNewProduct] = useState({
    name: "", price: "", category: "Terang Bulan", stock: "", imageUrl: "", description: "",
    shopeefoodPrice: "", grabfoodPrice: "", gofoodPrice: "",
    variantsInput: "", maxVariant: 1, hasCookingOption: false, cookingOptionsInput: ""
  });
  const [settings, setSettings] = useState({
    storeName: "Toko Kasir", receiptHeader: "Toko Utama\nJl. Merdeka No.1", receiptFooter: "Terima Kasih!"
  });
  const [qrisImageUrl, setQrisImageUrl] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [takeawayMapUrl, setTakeawayMapUrl] = useState("");

  // ==============================================
  // FIREBASE LISTENERS & AUTH CHECK
  // ==============================================
  useEffect(() => {
    setIsClient(true);
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        if (user.email === ADMIN_EMAIL) {
          setAdminUser(user);
        } else {
          alert("Akses Ditolak! Email ini tidak memiliki akses ke Sistem Kasir.");
          await signOut(auth);
          router.push("/shop");
        }
      } else {
        setAdminUser(null);
      }
      setAuthChecking(false);
    });

    const unsubProducts = onValue(ref(db, "products"), (snap) => {
      if (snap.exists()) setProducts(Object.keys(snap.val()).map(k => ({ id: k, ...snap.val()[k] })));
      else setProducts([]);
    });

    const unsubCategories = onValue(ref(db, "kasirCategories"), (snap) => {
      if (snap.exists()) {
        const value = snap.val();
        const saved = (Array.isArray(value) ? value : Object.values(value))
          .filter((category): category is string => typeof category === "string" && category.trim().length > 0);
        setCategories(saved.length ? saved : DEFAULT_CATEGORIES);
      } else {
        setCategories(DEFAULT_CATEGORIES);
      }
    });

    const unsubOrders = onValue(ref(db, "orders"), (snap) => {
      if (snap.exists()) setOrders(Object.keys(snap.val()).map(k => ({ id: k, ...snap.val()[k] })).sort((a, b) => b.createdAt - a.createdAt));
      else setOrders([]);
    });

    const unsubSettings = onValue(ref(db, "settings"), (snap) => {
      if (snap.exists()) setSettings(snap.val());
    });
    const unsubQrisSettings = onValue(ref(db, "publicPaymentSettings/qrisImageUrl"), snap => {
      setQrisImageUrl(typeof snap.val() === "string" ? snap.val() : "");
    });
    const unsubPickupAddress = onValue(ref(db, "publicPaymentSettings/pickupAddress"), snap => {
      setPickupAddress(typeof snap.val() === "string" ? snap.val() : "");
    });
    const unsubTakeawayMap = onValue(ref(db, "publicPaymentSettings/takeawayMapUrl"), snap => {
      setTakeawayMapUrl(typeof snap.val() === "string" ? snap.val() : "");
    });

    return () => { unsubAuth(); unsubProducts(); unsubCategories(); unsubOrders(); unsubSettings(); unsubQrisSettings(); unsubPickupAddress(); unsubTakeawayMap(); };
  }, [router]);

  const handleLogin = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { console.error(e); }
  };
  const handleLogout = async () => {
    await signOut(auth);
  };

  // ==============================================
  // CRUD FUNCTIONS
  // ==============================================
  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return alert("Masukkan nama kategori.");
    if (categories.some(category => category.toLowerCase() === name.toLowerCase())) {
      return alert("Kategori tersebut sudah ada.");
    }
    const next = [...categories, name];
    try {
      await set(ref(db, "kasirCategories"), next);
      setNewCategoryName("");
    } catch (error) {
      console.error(error);
      alert("Gagal menyimpan kategori ke Firebase.");
    }
  };

  const handleDeleteCategory = async (name: string) => {
    if (categories.length <= 1) return alert("Sisakan minimal satu kategori.");
    const next = categories.filter(category => category !== name);
    const fallback = next[0];
    const affected = products.filter(product => product.category === name);
    const confirmed = confirm(
      `Hapus kategori “${name}”? ${affected.length ? `${affected.length} produk akan dipindah ke “${fallback}”.` : ""}`
    );
    if (!confirmed) return;

    const updates: Record<string, unknown> = { kasirCategories: next };
    affected.forEach(product => { updates[`products/${product.id}/category`] = fallback; });
    try {
      await update(ref(db), updates);
      if (activeCategory === name) setActiveCategory("Semua");
      if (newProduct.category === name) setNewProduct(current => ({ ...current, category: fallback }));
    } catch (error) {
      console.error(error);
      alert("Gagal menghapus kategori.");
    }
  };

  const handleAddProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProduct.name || !newProduct.price || !newProduct.stock) return alert("Isi data wajib!");

    const parsedVariants = newProduct.variantsInput.split(",").map(v => v.trim()).filter(Boolean);
    const parsedCooking = newProduct.hasCookingOption ? newProduct.cookingOptionsInput.split(",").map(v => v.trim()).filter(Boolean) : [];
    const productData = {
      name: newProduct.name, price: Number(newProduct.price), category: newProduct.category,
      stock: Number(newProduct.stock), description: newProduct.description,
      imageUrl: newProduct.imageUrl || "https://images.unsplash.com/photo-1551782450-a2132b4ba21d?w=400",
      active: true, variants: parsedVariants, maxVariant: Number(newProduct.maxVariant) || 1, cookingOptions: parsedCooking,
      channelPrices: Object.fromEntries([
        ["shopeefood", newProduct.shopeefoodPrice], ["grabfood", newProduct.grabfoodPrice], ["gofood", newProduct.gofoodPrice]
      ].filter(([, value]) => Number(value) > 0).map(([key, value]) => [key, Number(value)]))
    };

    set(push(ref(db, "products")), productData).then(() => {
      setNewProduct({ name: "", price: "", category: "Terang Bulan", stock: "", imageUrl: "", description: "", shopeefoodPrice: "", grabfoodPrice: "", gofoodPrice: "", variantsInput: "", maxVariant: 1, hasCookingOption: false, cookingOptionsInput: "" });
      alert("Produk ditambahkan!");
    });
  };

  const openChannelPriceEditor = (product: Product) => {
    setEditingChannelPriceProduct(product);
    setChannelPriceDraft({
      shopeefood: product.channelPrices?.shopeefood ? String(product.channelPrices.shopeefood) : "",
      grabfood: product.channelPrices?.grabfood ? String(product.channelPrices.grabfood) : "",
      gofood: product.channelPrices?.gofood ? String(product.channelPrices.gofood) : ""
    });
  };
  const saveChannelPrices = async () => {
    if (!editingChannelPriceProduct) return;
    const channelPrices = Object.fromEntries(Object.entries(channelPriceDraft).filter(([, value]) => Number(value) > 0).map(([key, value]) => [key, Number(value)]));
    try {
      await update(ref(db, `products/${editingChannelPriceProduct.id}`), { channelPrices });
      setEditingChannelPriceProduct(null);
      alert("Harga kanal online berhasil disimpan. Shop tetap memakai harga utama.");
    } catch (error) {
      console.error(error);
      alert("Gagal menyimpan harga kanal online.");
    }
  };

  const handleDeleteProduct = (id: string) => {
    if (confirm("Hapus produk ini?")) remove(ref(db, `products/${id}`));
  };
  const handleDeleteOrder = (id: string) => {
    if (confirm("Hapus data transaksi ini permanen?")) remove(ref(db, `orders/${id}`));
  };
  const handleClearAllHistory = async () => {
    const kasirHistory = orders.filter(o => CASHIER_SOURCES.includes(o.source));
    if (kasirHistory.length === 0) return alert("Belum ada riwayat transaksi Kasir/Marketplace.");
    if (!confirm(`Hapus ${kasirHistory.length} transaksi Kasir/Marketplace? Riwayat Shop tidak akan dihapus.`)) return;
    try {
      await Promise.all(kasirHistory.map(order => remove(ref(db, `orders/${order.id}`))));
    } catch (error) {
      console.error(error);
      alert("Gagal menghapus riwayat Kasir.");
    }
  };
  const handleSaveSettings = () => {
    set(ref(db, "settings"), settings).then(() => alert("Pengaturan tersimpan!"));
  };

  const handleSavePickupLocation = async () => {
    try {
      if (takeawayMapUrl.trim()) new URL(takeawayMapUrl.trim());
      await update(ref(db, "publicPaymentSettings"), { pickupAddress: pickupAddress.trim(), takeawayMapUrl: takeawayMapUrl.trim() });
      alert("Alamat dan tautan Google Maps untuk Take Away tersimpan.");
    } catch (error) {
      console.error(error);
      alert("Tautan Google Maps tidak valid atau gagal disimpan.");
    }
  };

  const handleSaveQrisUrl = async () => {
    const value = qrisImageUrl.trim();
    if (!value) return alert("Masukkan URL gambar QRIS terlebih dahulu.");
    try {
      new URL(value);
      await set(ref(db, "publicPaymentSettings/qrisImageUrl"), value);
      alert("QRIS berhasil disimpan dan tampil di Shop.");
    } catch (error) {
      console.error(error);
      alert("URL QRIS tidak valid atau gagal disimpan.");
    }
  };

  // ==============================================
  // CART & CHECKOUT
  // ==============================================
  const getPriceForChannel = (product: Product, channel: string) => {
    if (channel === "kasir") return Number(product.price) || 0;
    const override = Number(product.channelPrices?.[channel as "shopeefood" | "grabfood" | "gofood"]);
    return override > 0 ? override : (Number(product.price) || 0);
  };
  const changeSalesChannel = (channel: string) => {
    setSalesChannel(channel);
    setCashAmount(""); setQrisAmount("");
    setCart(current => current.map(item => {
      const product = products.find(product => product.id === item.id) || item;
      return { ...item, price: getPriceForChannel(product, channel) };
    }));
  };

  const handleProductClick = (product: Product) => {
    const hasVariants = product.variants && product.variants.length > 0;
    const hasCooking = product.cookingOptions && product.cookingOptions.length > 0;
    if (hasVariants || hasCooking) setCustomizingProduct(product);
    else addToCart(product, 1, [], "", "");
  };

  const addToCart = (product: Product, qty: number, selectedVariants: string[], cookingMethod: string, note: string) => {
    if (product.stock === 0) return alert("Stok habis!");
    const variantKey = selectedVariants.slice().sort().join("+");
    const cartItemId = `${product.id}-${variantKey}-${cookingMethod}-${note}`.replace(/\s+/g, "-");
    const itemPrice = getPriceForChannel(product, salesChannel);
    const existIndex = cart.findIndex(c => c.cartItemId === cartItemId);
    if (existIndex >= 0) {
      const newCart = [...cart];
      if (newCart[existIndex].qty + qty > product.stock) return alert("Stok maksimal!");
      newCart[existIndex].qty += qty;
      setCart(newCart);
    } else setCart([...cart, { ...product, price: itemPrice, cartItemId, qty, selectedVariants, cookingMethod, note }]);
  };

  const updateQty = (cartItemId: string, delta: number) => {
    setCart(cart.map(c => {
      if (c.cartItemId !== cartItemId) return c;
      const next = c.qty + delta;
      if (next <= 0) return null;
      const p = products.find(x => x.id === c.id);
      if (p && next > p.stock) return c;
      return { ...c, qty: next };
    }).filter(Boolean) as CartItem[]);
  };

  const openPayment = () => {
    if (cart.length === 0) return alert("Keranjang kosong!");
    setCashAmount(""); setQrisAmount(""); setPaymentMethod("tunai");
    let res = "TRX-"; const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    for (let i = 0; i < 6; i++) res += c.charAt(Math.floor(Math.random() * c.length));
    setTransactionId(res);
    setTransactionDate(new Date().toLocaleString("id-ID"));
    setIsPaymentOpen(true);
  };

  const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
  // Riwayat di POS Kasir hanya menampilkan transaksi dari Kasir, bukan pesanan Shop.
  const kasirOrders = orders.filter(order => CASHIER_SOURCES.includes(order.source));
  const payment = (() => {
    if (paymentMethod === "tunai") {
      const cash = Number(cashAmount) || 0;
      return { change: cash - total, isValid: cash >= total, qris: 0, cashPaid: cash };
    } else if (paymentMethod === "qris") {
      return { change: 0, isValid: true, qris: total, cashPaid: 0 };
    } else {
      const q = Number(qrisAmount) || 0; const rem = total - q; const c = Number(cashAmount) || 0;
      return { change: c - rem, isValid: q > 0 && q < total && c >= rem, qris: q, cashPaid: c };
    }
  })();

  // Pesanan baru dikirim ke dapur setelah pembayaran valid dikonfirmasi.
  // Status PROCESSING membuatnya tampil sebagai pesanan aktif, bukan langsung riwayat.
  const handleCompleteOrder = async () => {
    if (!payment.isValid || cart.length === 0) return;
    const orderRef = push(ref(db, "orders"));

    const channelPrefix: Record<string, string> = { shopeefood: "SF", grabfood: "GF", gofood: "GO" };
    const customerLabel = (customerName.trim() || "Pelanggan Kasir").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    const randomSuffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const finalTransactionId = salesChannel === "kasir" ? transactionId : `${channelPrefix[salesChannel]} - ${customerLabel} - ${randomSuffix}`;
    setTransactionId(finalTransactionId);
    try {
      await set(orderRef, {
        orderNumber: finalTransactionId, date: transactionDate, createdAt: Date.now(),
        items: cart, total, paymentMethod: paymentMethod.toUpperCase(),
        source: "kasir", channel: salesChannel, sourceLabel: SOURCE_LABELS[salesChannel], status: "PROCESSING", orderType: "takeaway",
        customer: { name: customerLabel }
      });

      const updates: Record<string, number> = {};
      products.forEach(p => {
        const qtyInCart = cart.filter(c => c.id === p.id).reduce((s, i) => s + i.qty, 0);
        if (qtyInCart > 0) updates[`products/${p.id}/stock`] = p.stock - qtyInCart;
      });
      if (Object.keys(updates).length > 0) await update(ref(db), updates);

      window.print();
      setTimeout(() => { setCart([]); setCustomerName(""); setSalesChannel("kasir"); setIsPaymentOpen(false); }, 500);
    } catch (error) {
      console.error("Gagal mengirim pesanan ke dapur:", error);
      alert("Pesanan gagal dikirim. Periksa koneksi Firebase, lalu coba lagi.");
    }
  };

  // ==============================================
  // RENDERING LOGIC
  // ==============================================
  if (!isClient || authChecking) {
    return <div className="flex h-screen items-center justify-center bg-slate-50">Memuat Sistem Kasir...</div>;
  }

  if (!adminUser) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900 text-white">
        <div className="bg-slate-800 p-8 rounded-3xl max-w-sm text-center shadow-2xl border border-slate-700">
          <div className="bg-blue-500 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"><LayoutDashboard size={32} /></div>
          <h1 className="text-2xl font-black mb-2">POS Kasir</h1>
          <p className="text-slate-400 text-sm mb-8">Login menggunakan akun Administrator untuk mengelola produk dan pesanan.</p>
          <button onClick={handleLogin} className="w-full bg-white text-slate-900 font-bold py-3 rounded-xl hover:bg-slate-100 transition-colors">Login dengan Google</button>
        </div>
      </div>
    );
  }

  const filteredProducts = products.filter(p => {
    const matchCat = activeCategory === "Semua" || p.category === activeCategory;
    return matchCat && p.name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const KasirCustomModal = () => {
    if (!customizingProduct) return null;
    const p = customizingProduct;
    const variantList = p.variants || []; const maxVar = p.maxVariant || 1; const cookingList = p.cookingOptions || [];
    const [selectedVariants, setSelectedVariants] = useState<string[]>([]);
    const [cookingMethod, setCookingMethod] = useState(cookingList[0] || "");
    const [note, setNote] = useState("");
    const [localQty, setLocalQty] = useState(1);

    const toggleVariant = (v: string) => {
      if (selectedVariants.includes(v)) setSelectedVariants(selectedVariants.filter(x => x !== v));
      else {
        if (selectedVariants.length >= maxVar) return alert(`Max ${maxVar} pilihan!`);
        setSelectedVariants([...selectedVariants, v]);
      }
    };
    const submit = () => {
      if (variantList.length > 0 && selectedVariants.length === 0) return alert("Pilih minimal 1 varian!");
      if (cookingList.length > 0 && !cookingMethod) return alert("Pilih metode!");
      addToCart(p, localQty, selectedVariants, cookingMethod, note);
      setCustomizingProduct(null);
    };

    return (
      <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4 print:hidden">
        <div className="bg-white w-full max-w-md rounded-2xl flex flex-col max-h-[90vh] overflow-hidden">
          <div className="p-4 border-b flex justify-between items-center bg-slate-50">
            <h2 className="font-bold text-lg text-slate-800 truncate">{p.name}</h2>
            <button onClick={() => setCustomizingProduct(null)} className="text-slate-400 hover:text-red-500"><X size={24}/></button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-50">
            {variantList.length > 0 && <div className="bg-white p-4 rounded-xl border border-slate-200"><h3 className="font-bold text-sm mb-1">Pilih Varian Rasa (Max {maxVar})</h3><div className="space-y-2 mt-3">{variantList.map(v => <label key={v} className="flex justify-between items-center cursor-pointer"><span className="text-sm">{v}</span><input type="checkbox" checked={selectedVariants.includes(v)} onChange={() => toggleVariant(v)} className="w-4 h-4 accent-blue-600"/></label>)}</div></div>}
            {cookingList.length > 0 && <div className="bg-white p-4 rounded-xl border border-slate-200"><h3 className="font-bold text-sm mb-3">Metode / Pilihan</h3><div className="space-y-2">{cookingList.map(opt => <label key={opt} className="flex justify-between items-center cursor-pointer"><span className="text-sm">{opt}</span><input type="radio" name="kasir_cooking" value={opt} checked={cookingMethod === opt} onChange={() => setCookingMethod(opt)} className="w-4 h-4 accent-blue-600"/></label>)}</div></div>}
            <div className="bg-white p-4 rounded-xl border border-slate-200"><h3 className="font-bold text-sm mb-2">Catatan</h3><input type="text" value={note} onChange={e => setNote(e.target.value)} className="w-full border rounded-lg p-2 text-sm outline-none focus:border-blue-400" placeholder="Opsional..."/></div>
          </div>
          <div className="p-4 bg-white border-t flex justify-between items-center gap-4">
            <div className="flex items-center gap-3"><button onClick={() => setLocalQty(Math.max(1, localQty - 1))} className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center"><Minus size={16}/></button><span className="font-bold">{localQty}</span><button onClick={() => setLocalQty(localQty + 1)} className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center"><Plus size={16}/></button></div>
            <button onClick={submit} className="flex-1 bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700">Tambah - {formatRp(getPriceForChannel(p, salesChannel) * localQty)}</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-800 overflow-hidden">
      <aside className="w-20 lg:w-60 bg-white border-r flex flex-col shadow-sm z-10 print:hidden">
        <div className="h-16 flex items-center justify-center lg:justify-start lg:px-5 border-b"><div className="bg-blue-600 text-white p-2 rounded-lg font-bold text-lg w-9 h-9 flex items-center justify-center">K</div><span className="hidden lg:block ml-3 font-bold text-sm text-slate-700 truncate">{settings.storeName}</span></div>
        <nav className="p-3 space-y-1 flex-1">
          <button onClick={() => setActiveTab("kasir")} className={`w-full flex items-center space-x-3 p-3 rounded-xl font-bold text-sm transition-colors ${activeTab === "kasir" ? "bg-blue-50 text-blue-600" : "text-slate-500 hover:bg-slate-50"}`}><LayoutDashboard size={18}/><span className="hidden lg:block">Kasir</span></button>
          <button onClick={() => setActiveTab("produk")} className={`w-full flex items-center space-x-3 p-3 rounded-xl font-bold text-sm transition-colors ${activeTab === "produk" ? "bg-blue-50 text-blue-600" : "text-slate-500 hover:bg-slate-50"}`}><Package size={18}/><span className="hidden lg:block">Produk</span></button>
          <button onClick={() => setActiveTab("riwayat")} className={`w-full flex items-center space-x-3 p-3 rounded-xl font-bold text-sm transition-colors ${activeTab === "riwayat" ? "bg-blue-50 text-blue-600" : "text-slate-500 hover:bg-slate-50"}`}><History size={18}/><span className="hidden lg:block">Riwayat</span></button>
          <button onClick={() => setActiveTab("settings")} className={`w-full flex items-center space-x-3 p-3 rounded-xl font-bold text-sm transition-colors ${activeTab === "settings" ? "bg-blue-50 text-blue-600" : "text-slate-500 hover:bg-slate-50"}`}><Settings size={18}/><span className="hidden lg:block">Pengaturan</span></button>
        </nav>
        <div className="p-4 border-t"><button onClick={handleLogout} className="w-full flex items-center justify-center lg:justify-start space-x-3 text-red-500 hover:bg-red-50 p-3 rounded-xl font-bold text-sm transition-colors"><LogOut size={18}/><span className="hidden lg:block">Logout Admin</span></button></div>
      </aside>

      {activeTab === "kasir" && <>
        <main className="flex-1 flex flex-col h-full overflow-hidden print:hidden">
          <div className="bg-white p-4 border-b"><div className="relative mb-3"><Search className="absolute left-3 top-2.5 text-slate-400" size={18}/><input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Cari produk..." className="w-full bg-slate-100 rounded-xl py-2 pl-10 pr-4 outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"/></div><div className="flex space-x-2 overflow-x-auto scrollbar-hide">{["Semua", ...categories].map(cat => <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-4 py-1.5 rounded-full whitespace-nowrap text-xs font-bold ${activeCategory === cat ? "bg-blue-600 text-white shadow" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{cat}</button>)}</div></div>
          <div className="flex-1 p-4 overflow-y-auto"><div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">{filteredProducts.map(p => <button key={p.id} onClick={() => handleProductClick(p)} disabled={p.stock === 0 || !p.active} className="bg-white rounded-2xl p-3 shadow-sm border border-slate-100 flex flex-col hover:border-blue-400 text-left disabled:opacity-50 transition-colors"><div className="h-24 bg-slate-100 rounded-xl mb-2 overflow-hidden w-full"><img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover"/></div><h3 className="font-bold text-slate-800 text-[13px] line-clamp-1">{p.name}</h3><p className="text-blue-600 font-black text-sm mt-1 mb-2">{formatRp(getPriceForChannel(p, salesChannel))}</p><div className="mt-auto flex justify-between items-center w-full"><span className="text-slate-400 font-medium text-[10px]">Stok: {p.stock}</span><div className="bg-blue-50 text-blue-600 p-1.5 rounded-lg"><Plus size={14} strokeWidth={3}/></div></div></button>)}</div></div>
        </main>
        <aside className="w-72 lg:w-80 bg-white border-l flex flex-col shadow-[-4px_0_15px_rgba(0,0,0,0.02)] print:hidden">
          <div className="p-4 border-b flex justify-between bg-slate-50"><h2 className="font-bold text-base flex items-center gap-2">Pesanan <span className="bg-blue-100 text-blue-600 text-xs px-2 py-0.5 rounded-full">{totalItems}</span></h2><button onClick={() => setCart([])} className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg"><Trash2 size={16}/></button></div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">{cart.length === 0 ? <div className="flex h-full items-center justify-center text-slate-400 text-sm font-medium">Keranjang Kosong</div> : cart.map(item => <div key={item.cartItemId} className="bg-white border border-slate-100 p-2.5 rounded-xl shadow-sm"><div className="flex justify-between items-start mb-1 gap-2"><h4 className="font-bold text-[13px] leading-tight text-slate-800">{item.name}</h4><button onClick={() => setCart(cart.filter(c => c.cartItemId !== item.cartItemId))} className="text-red-400 hover:text-red-600"><X size={14}/></button></div>{item.selectedVariants?.length > 0 && <p className="text-[10px] text-blue-600 font-bold">{item.selectedVariants.join(", ")}</p>}{item.cookingMethod && <p className="text-[10px] text-slate-500 font-medium">{item.cookingMethod}</p>}{item.note && <p className="text-[10px] text-slate-400 italic mt-0.5">Note: {item.note}</p>}<div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-50"><span className="text-blue-600 font-black text-[13px]">{formatRp(item.price * item.qty)}</span><div className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-1 py-0.5 border border-slate-200"><button onClick={() => updateQty(item.cartItemId, -1)} className="text-slate-500 hover:text-blue-600"><Minus size={12}/></button><span className="text-xs font-bold w-5 text-center">{item.qty}</span><button onClick={() => updateQty(item.cartItemId, 1)} className="text-slate-500 hover:text-blue-600"><Plus size={12}/></button></div></div></div>)}</div>
          <div className="p-5 border-t bg-slate-50"><div className="flex justify-between mb-4"><span className="font-bold text-slate-600">Total Tagihan</span><span className="font-black text-xl text-blue-600">{formatRp(total)}</span></div><button onClick={openPayment} disabled={cart.length === 0} className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-bold text-sm hover:bg-blue-700 disabled:bg-slate-300 shadow-lg shadow-blue-500/30 transition-all">Bayar Sekarang</button></div>
        </aside>
      </>}

      {activeTab === "produk" && <main className="flex-1 overflow-y-auto bg-slate-50 p-6 print:hidden"><h1 className="text-2xl font-black text-slate-800 mb-6">Manajemen Produk</h1><div className="grid lg:grid-cols-3 gap-6"><div className="lg:col-span-1 bg-white p-5 rounded-2xl shadow-sm border border-slate-100 h-fit"><h2 className="font-bold text-slate-700 mb-4 flex items-center gap-2"><Plus size={18}/> Tambah Produk & Setting</h2><section className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-3"><h3 className="mb-2 text-sm font-bold text-slate-700">Kelola Kategori</h3><div className="flex gap-2"><input value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleAddCategory(); } }} placeholder="Nama kategori baru" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-500"/><button type="button" onClick={() => void handleAddCategory()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">Tambah</button></div><div className="mt-2 flex flex-wrap gap-1.5">{categories.map(category => <span key={category} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600">{category}<button type="button" onClick={() => void handleDeleteCategory(category)} aria-label={`Hapus kategori ${category}`} className="ml-1 text-red-500 hover:text-red-700"><X size={12}/></button></span>)}</div></section><form onSubmit={handleAddProduct} className="space-y-4"><div><label className="text-xs font-bold text-slate-600">Nama Produk</label><input required type="text" value={newProduct.name} onChange={e => setNewProduct({...newProduct, name:e.target.value})} className="w-full mt-1 border rounded-lg p-2.5 text-sm font-medium outline-none focus:border-blue-500"/></div><div className="grid grid-cols-2 gap-3"><div><label className="text-xs font-bold text-slate-600">Harga Dasar Shop/Kasir (Rp)</label><input required type="number" value={newProduct.price} onChange={e => setNewProduct({...newProduct, price:e.target.value})} className="w-full mt-1 border rounded-lg p-2.5 text-sm font-medium outline-none focus:border-blue-500"/></div><div><label className="text-xs font-bold text-slate-600">Stok</label><input required type="number" value={newProduct.stock} onChange={e => setNewProduct({...newProduct, stock:e.target.value})} className="w-full mt-1 border rounded-lg p-2.5 text-sm font-medium outline-none focus:border-blue-500"/></div></div><div className="rounded-xl border border-orange-200 bg-orange-50 p-3"><h3 className="text-xs font-black text-orange-900">Harga khusus Marketplace (opsional)</h3><p className="mb-2 mt-1 text-[10px] text-orange-800">Harga utama tetap untuk Shop/Kasir biasa. Kosongkan harga platform agar memakai harga utama.</p><div className="grid grid-cols-1 gap-2"><label className="text-[10px] font-bold text-slate-600">ShopeeFood (Rp)<input type="number" min="0" value={newProduct.shopeefoodPrice} onChange={e => setNewProduct({...newProduct, shopeefoodPrice:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm" /></label><label className="text-[10px] font-bold text-slate-600">GrabFood (Rp)<input type="number" min="0" value={newProduct.grabfoodPrice} onChange={e => setNewProduct({...newProduct, grabfoodPrice:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm" /></label><label className="text-[10px] font-bold text-slate-600">GoFood (Rp)<input type="number" min="0" value={newProduct.gofoodPrice} onChange={e => setNewProduct({...newProduct, gofoodPrice:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm" /></label></div></div><div><label className="text-xs font-bold text-slate-600">Kategori</label><select value={newProduct.category} onChange={e => setNewProduct({...newProduct, category:e.target.value})} className="w-full mt-1 border rounded-lg p-2.5 text-sm font-medium outline-none focus:border-blue-500">{categories.map(category => <option key={category} value={category}>{category}</option>)}</select></div><div><label className="text-xs font-bold text-slate-600">Deskripsi (Tampil di Shop)</label><textarea rows={2} value={newProduct.description} onChange={e => setNewProduct({...newProduct, description:e.target.value})} className="w-full mt-1 border rounded-lg p-2.5 text-sm font-medium outline-none focus:border-blue-500 resize-none"/></div><div><label className="text-xs font-bold text-slate-600">URL Gambar</label><input type="text" value={newProduct.imageUrl} onChange={e => setNewProduct({...newProduct, imageUrl:e.target.value})} className="w-full mt-1 border rounded-lg p-2.5 text-sm font-medium outline-none focus:border-blue-500" placeholder="https://..."/></div><div className="p-4 bg-blue-50 border border-blue-100 rounded-xl mt-4"><h3 className="font-bold text-sm text-blue-800 mb-2">Setting Varian Rasa (Checkbox)</h3><label className="text-[10px] text-slate-500 block mb-1">Daftar Rasa (Pisahkan dgn koma)</label><input type="text" placeholder="Coklat, Keju, Kacang..." value={newProduct.variantsInput} onChange={e => setNewProduct({...newProduct, variantsInput:e.target.value})} className="w-full border rounded-lg p-2 text-sm font-medium outline-none focus:border-blue-500 mb-3"/><label className="text-[10px] text-slate-500 block mb-1">Maksimal Pilih Rasa (Misal: 2)</label><input type="number" min="1" value={newProduct.maxVariant} onChange={e => setNewProduct({...newProduct, maxVariant:parseInt(e.target.value)})} className="w-full border rounded-lg p-2 text-sm font-medium outline-none focus:border-blue-500"/></div><div className="p-4 bg-blue-50 border border-blue-100 rounded-xl"><label className="flex items-center gap-2 cursor-pointer font-bold text-sm text-blue-800 mb-2"><input type="checkbox" checked={newProduct.hasCookingOption} onChange={e => setNewProduct({...newProduct, hasCookingOption:e.target.checked})} className="w-4 h-4 accent-blue-600"/>Aktifkan Metode (Radio Button)</label>{newProduct.hasCookingOption && <><label className="text-[10px] text-slate-500 block mb-1">Pilihan (Pisahkan dgn koma)</label><input type="text" placeholder="Di Bakar, Di Kukus..." value={newProduct.cookingOptionsInput} onChange={e => setNewProduct({...newProduct, cookingOptionsInput:e.target.value})} className="w-full border rounded-lg p-2 text-sm font-medium outline-none focus:border-blue-500"/></>}</div><button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl mt-2 shadow-md">Simpan Produk ke Cloud</button></form></div><div className="lg:col-span-2 bg-white p-5 rounded-2xl shadow-sm border border-slate-100"><h2 className="font-bold text-slate-700 mb-4">Daftar Produk ({products.length})</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500 text-xs"><tr><th className="p-3 rounded-tl-lg">Produk & Varian</th><th className="p-3">Harga</th><th className="p-3">Stok</th><th className="p-3 rounded-tr-lg">Aksi</th></tr></thead><tbody className="divide-y divide-slate-100">{products.map(p => <tr key={p.id} className="hover:bg-slate-50"><td className="p-3 flex items-start gap-3"><img src={p.imageUrl} className="w-14 h-14 rounded-xl object-cover shrink-0"/><div><span className="font-bold text-slate-800 block">{p.name}</span>{p.variants && p.variants.length > 0 && <span className="text-[10px] font-semibold text-blue-600 block mt-1">Rasa: {p.variants.join(", ")} (Max: {p.maxVariant})</span>}{p.cookingOptions && p.cookingOptions.length > 0 && <span className="text-[10px] font-medium text-slate-500 block">Metode: {p.cookingOptions.join(", ")}</span>}</div></td><td className="p-3"><span className="font-black text-blue-600 block">Shop/Kasir: {formatRp(p.price)}</span><span className="mt-1 block text-[10px] leading-relaxed text-slate-500">SF {formatRp(p.channelPrices?.shopeefood || p.price)} · GF {formatRp(p.channelPrices?.grabfood || p.price)} · GO {formatRp(p.channelPrices?.gofood || p.price)}</span></td><td className="p-3 font-semibold text-slate-700">{p.stock}</td><td className="p-3"><button onClick={() => openChannelPriceEditor(p)} className="mb-2 rounded-lg bg-orange-50 px-2 py-1 text-[10px] font-bold text-orange-700 hover:bg-orange-100">Harga Online</button><button onClick={() => handleDeleteProduct(p.id)} className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors"><Trash2 size={18}/></button></td></tr>)}</tbody></table></div></div></div></main>}

      {activeTab === "riwayat" && <main className="flex-1 overflow-y-auto bg-slate-50 p-6 print:hidden"><div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-black text-slate-800">Riwayat Transaksi Kasir & Online (Cloud)</h1><button onClick={handleClearAllHistory} className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-bold text-sm shadow-md transition-colors flex items-center gap-2"><Trash2 size={16}/> Kosongkan Semua Riwayat</button></div><div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500 text-xs"><tr><th className="p-3 rounded-tl-lg">ID & Waktu</th><th className="p-3">Detail Pesanan</th><th className="p-3">Total & Metode</th><th className="p-3 rounded-tr-lg text-center">Hapus</th></tr></thead><tbody className="divide-y divide-slate-100">{kasirOrders.length === 0 && <tr><td colSpan={4} className="text-center p-8 text-slate-400 font-medium">Belum ada riwayat transaksi Kasir/Marketplace.</td></tr>}{kasirOrders.map(o => <tr key={o.id} className="hover:bg-slate-50"><td className="p-3"><span className="font-bold text-slate-800 block">#{o.orderNumber}</span><span className="text-[10px] text-slate-500">{o.date}</span></td><td className="p-3">{o.items?.map((it, i) => <div key={i} className="text-xs mb-1"><span className="font-semibold text-slate-700">{it.qty}x {it.name}</span>{it.selectedVariants?.length > 0 && <span className="text-[10px] text-blue-600 font-semibold block ml-4">- {it.selectedVariants.join(", ")}</span>}{it.cookingMethod && <span className="text-[10px] text-slate-500 block ml-4">- {it.cookingMethod}</span>}</div>)}</td><td className="p-3"><span className="font-black text-blue-600 block">{formatRp(o.total)}</span><span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded uppercase">{o.sourceLabel || SOURCE_LABELS[o.source] || o.source} • {o.paymentMethod}</span></td><td className="p-3 text-center"><button onClick={() => handleDeleteOrder(o.id)} className="text-red-400 hover:text-red-600 bg-red-50 hover:bg-red-100 p-2 rounded-lg transition-colors inline-block"><Trash2 size={16}/></button></td></tr>)}</tbody></table></div></main>}

      {activeTab === "settings" && <main className="flex-1 overflow-y-auto bg-slate-50 p-6 print:hidden"><h1 className="text-2xl font-black text-slate-800 mb-6">Pengaturan Kasir & Struk</h1><div className="mb-5 max-w-2xl rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-800">QRIS Shop</h2><p className="my-2 text-xs text-slate-500">Tempel URL publik untuk gambar QRIS resmi toko. Gambar ini akan dapat dilihat pelanggan Shop.</p><input type="url" value={qrisImageUrl} onChange={e => setQrisImageUrl(e.target.value)} placeholder="https://.../qris.png" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"/><div className="mt-3 flex items-center gap-3"><button onClick={handleSaveQrisUrl} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white">Simpan QRIS</button>{qrisImageUrl && <img src={qrisImageUrl} alt="Preview QRIS" className="h-16 w-16 rounded-lg border object-contain"/>}</div></div><div className="mb-5 max-w-2xl rounded-2xl border border-blue-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-800">Lokasi Take Away Shop</h2><p className="my-2 text-xs text-slate-500">Alamat dan tautan Maps ini tampil ketika pelanggan Shop memilih Take Away.</p><label className="mb-1 block text-xs font-bold text-slate-600">Alamat lokasi toko</label><textarea value={pickupAddress} onChange={e => setPickupAddress(e.target.value)} rows={2} placeholder="Alamat lengkap untuk pengambilan" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/><label className="mb-1 mt-3 block text-xs font-bold text-slate-600">Tautan Google Maps</label><input type="url" value={takeawayMapUrl} onChange={e => setTakeawayMapUrl(e.target.value)} placeholder="https://maps.app.goo.gl/..." className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/><button onClick={handleSavePickupLocation} className="mt-3 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white">Simpan Lokasi</button></div><div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 max-w-2xl space-y-5"><div><label className="block text-xs font-bold text-slate-700 mb-1.5">Nama Toko (Tampil di Kiri Atas Kasir)</label><input type="text" value={settings.storeName} onChange={e => setSettings({...settings, storeName:e.target.value})} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"/></div><div className="border-t border-slate-100 pt-5"><h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Printer size={18} className="text-blue-500"/> Format Struk (Printer 58mm)</h3><div className="space-y-4"><div><label className="block text-xs font-bold text-slate-700 mb-1.5">Teks Header Struk (Alamat / Telp)</label><textarea value={settings.receiptHeader} onChange={e => setSettings({...settings, receiptHeader:e.target.value})} rows={3} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"/></div><div><label className="block text-xs font-bold text-slate-700 mb-1.5">Teks Footer Struk (Ucapan Terima Kasih)</label><textarea value={settings.receiptFooter} onChange={e => setSettings({...settings, receiptFooter:e.target.value})} rows={2} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"/></div></div></div><button onClick={handleSaveSettings} className="w-full bg-slate-900 hover:bg-slate-800 text-white py-3.5 rounded-xl font-bold text-sm flex justify-center items-center gap-2 shadow-lg transition-colors mt-4"><Save size={16}/> Simpan Pengaturan</button></div></main>}

      {editingChannelPriceProduct && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 print:hidden"><div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-black text-slate-900">Harga Marketplace</h2><p className="text-xs text-slate-500">{editingChannelPriceProduct.name}</p></div><button onClick={() => setEditingChannelPriceProduct(null)} className="rounded-full bg-slate-100 p-2 text-slate-500"><X size={18}/></button></div><p className="mb-3 text-[11px] text-slate-600">Kosongkan untuk mengikuti harga Shop/Kasir biasa ({formatRp(editingChannelPriceProduct.price)}).</p><div className="space-y-3">{([["shopeefood", "ShopeeFood (SF)"], ["grabfood", "GrabFood (GF)"], ["gofood", "GoFood (GO)"]] as const).map(([key, label]) => <label key={key} className="block text-xs font-bold text-slate-700">{label}<input type="number" min="0" value={channelPriceDraft[key]} onChange={e => setChannelPriceDraft({...channelPriceDraft, [key]:e.target.value})} placeholder={String(editingChannelPriceProduct.price)} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm"/></label>)}</div><button onClick={saveChannelPrices} className="mt-5 w-full rounded-xl bg-orange-600 py-3 text-sm font-black text-white">Simpan Harga Online</button></div></div>}
      <KasirCustomModal />

      {isPaymentOpen && <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 print:hidden"><div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]"><div className="flex justify-between items-center mb-6"><h2 className="font-black text-xl text-slate-800">Pembayaran Kasir</h2><button onClick={() => setIsPaymentOpen(false)} className="text-slate-400 hover:text-red-500 bg-slate-100 p-2 rounded-full"><X size={20}/></button></div><div className="overflow-y-auto flex-1 mb-4"><div className="text-center bg-blue-50 py-5 rounded-2xl mb-5 border border-blue-100"><p className="text-xs font-bold text-slate-500 mb-1">TOTAL TAGIHAN</p><p className="text-4xl font-black text-blue-600">{formatRp(total)}</p></div><div className="mb-4"><label className="text-xs font-bold text-slate-600">Sumber transaksi</label><select value={salesChannel} onChange={e => changeSalesChannel(e.target.value)} className="mt-1 w-full p-3 border border-slate-200 rounded-xl text-sm outline-none focus:border-blue-400 bg-slate-50"><option value="kasir">Kasir biasa</option><option value="shopeefood">ShopeeFood (SF)</option><option value="grabfood">GrabFood (GF)</option><option value="gofood">GoFood (GO)</option></select><p className="mt-1 text-[10px] text-slate-500">Ini hanya kanal transaksi, bukan kategori produk Shop.</p></div><div className="mb-4"><label className="text-xs font-bold text-slate-600">Nama pelanggan</label><input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Masukkan nama pelanggan" className="mt-1 w-full p-3 border border-slate-200 rounded-xl text-sm outline-none focus:border-blue-400 bg-slate-50" /></div><div className="grid grid-cols-3 gap-2 mb-5"><button onClick={() => {setPaymentMethod("tunai");setCashAmount("");setQrisAmount("");}} className={`p-2.5 rounded-xl border-2 font-bold flex flex-col items-center gap-1 transition-all ${paymentMethod === "tunai" ? "border-blue-500 bg-blue-50 text-blue-600" : "border-slate-100 text-slate-400 hover:bg-slate-50"}`}><Banknote size={20}/><span className="text-xs">Tunai</span></button><button onClick={() => {setPaymentMethod("qris");setCashAmount("");setQrisAmount("");}} className={`p-2.5 rounded-xl border-2 font-bold flex flex-col items-center gap-1 transition-all ${paymentMethod === "qris" ? "border-blue-500 bg-blue-50 text-blue-600" : "border-slate-100 text-slate-400 hover:bg-slate-50"}`}><QrCode size={20}/><span className="text-xs">QRIS</span></button><button onClick={() => {setPaymentMethod("split");setCashAmount("");setQrisAmount("");}} className={`p-2.5 rounded-xl border-2 font-bold flex flex-col items-center gap-1 transition-all ${paymentMethod === "split" ? "border-blue-500 bg-blue-50 text-blue-600" : "border-slate-100 text-slate-400 hover:bg-slate-50"}`}><Split size={20}/><span className="text-xs">Split</span></button></div>
        {paymentMethod === "tunai" && <div className="space-y-1"><label className="text-xs font-bold text-slate-600 ml-1">Uang Tunai Diterima (Rp)</label><input type="number" value={cashAmount} onChange={e => setCashAmount(e.target.value)} placeholder="0" className="w-full p-4 border border-slate-200 rounded-xl font-black text-lg outline-none focus:border-blue-400 bg-slate-50"/></div>}
        {paymentMethod === "qris" && <div className="bg-slate-50 p-6 rounded-2xl text-center border border-slate-100"><QrCode size={48} className="mx-auto text-slate-300 mb-2"/><p className="font-bold text-slate-600 text-sm">Pastikan pelanggan sudah scan QRIS</p></div>}
        {paymentMethod === "split" && <div className="space-y-3"><div className="bg-purple-50 p-3 rounded-xl text-xs font-semibold text-purple-700 border border-purple-100">💡 Input jumlah QRIS dulu, sisanya Tunai.</div><div><label className="text-xs font-bold text-slate-600 ml-1">Bayar via QRIS (Rp)</label><input type="number" value={qrisAmount} onChange={e => setQrisAmount(e.target.value)} placeholder="0" className="w-full p-3 border border-slate-200 rounded-xl font-bold outline-none focus:border-purple-400 bg-slate-50"/></div>{Number(qrisAmount) > 0 && Number(qrisAmount) < total && <><div className="bg-orange-50 p-3 rounded-xl flex justify-between font-bold text-sm text-orange-800 border border-orange-100"><span>Sisa (Harus Tunai)</span><span>{formatRp(total - Number(qrisAmount))}</span></div><div><label className="text-xs font-bold text-slate-600 ml-1">Uang Tunai Diterima (Rp)</label><input type="number" value={cashAmount} onChange={e => setCashAmount(e.target.value)} placeholder="0" className="w-full p-3 border border-slate-200 rounded-xl font-bold outline-none focus:border-orange-400 bg-slate-50"/></div></>}</div>}
        {(paymentMethod === "tunai" || paymentMethod === "split") && <div className={`mt-5 p-4 rounded-xl border-2 flex justify-between items-center ${payment.isValid ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}><span className="font-bold text-slate-600 text-sm">Kembalian</span><span className={`text-xl font-black ${payment.isValid ? "text-green-600" : "text-red-500"}`}>{!payment.isValid ? "Uang Kurang!" : formatRp(payment.change)}</span></div>}
      </div><button onClick={handleCompleteOrder} disabled={!payment.isValid} className="w-full bg-green-500 hover:bg-green-600 text-white font-black py-4 rounded-2xl disabled:bg-slate-300 transition-all active:scale-95 shadow-lg shadow-green-500/30 flex items-center justify-center gap-2"><Printer size={18}/> Cetak Struk & Selesai</button></div></div>}

      <div id="print-area" className="hidden print:block bg-white text-black" style={{fontFamily:"monospace"}}><div style={{textAlign:"center",fontWeight:"bold",fontSize:"14px",borderBottom:"1px dashed black",paddingBottom:"4px",marginBottom:"8px"}}>{settings.storeName}</div><div style={{fontSize:"10px",marginBottom:"8px",whiteSpace:"pre-wrap",textAlign:"center"}}>{settings.receiptHeader}</div><div style={{fontSize:"10px",marginBottom:"8px"}}><div>Tgl: {transactionDate}</div><div>No: {transactionId}</div></div><div style={{borderTop:"1px dashed black",borderBottom:"1px dashed black",paddingTop:"4px",paddingBottom:"4px",marginBottom:"4px"}}>{cart.map((item, idx) => <div key={idx} style={{marginBottom:"6px"}}><div style={{fontSize:"11px",fontWeight:"bold"}}>{item.name}</div>{item.selectedVariants?.length > 0 && <div style={{fontSize:"9px"}}>- Varian: {item.selectedVariants.join(", ")}</div>}{item.cookingMethod && <div style={{fontSize:"9px"}}>- Metode: {item.cookingMethod}</div>}<div style={{display:"flex",justifyContent:"space-between",fontSize:"10px",marginTop:"2px"}}><span>{item.qty} x {item.price}</span><span>{item.price * item.qty}</span></div></div>)}</div><div style={{fontSize:"11px",fontWeight:"bold",marginBottom:"4px"}}><div style={{display:"flex",justifyContent:"space-between"}}><span>TOTAL</span><span>Rp{total}</span></div>{paymentMethod === "tunai" && <><div style={{display:"flex",justifyContent:"space-between",marginTop:"2px"}}><span>TUNAI</span><span>Rp{payment.cashPaid}</span></div><div style={{display:"flex",justifyContent:"space-between",marginTop:"2px"}}><span>KEMBALI</span><span>Rp{payment.change}</span></div></>}{paymentMethod === "split" && <><div style={{display:"flex",justifyContent:"space-between",marginTop:"2px"}}><span>QRIS</span><span>Rp{payment.qris}</span></div><div style={{display:"flex",justifyContent:"space-between",marginTop:"2px"}}><span>TUNAI</span><span>Rp{payment.cashPaid}</span></div><div style={{display:"flex",justifyContent:"space-between",marginTop:"2px"}}><span>KEMBALI</span><span>Rp{payment.change}</span></div></>}{paymentMethod === "qris" && <div style={{display:"flex",justifyContent:"space-between",marginTop:"2px"}}><span>QRIS</span><span>Rp{total}</span></div>}</div><div style={{fontSize:"10px",marginTop:"8px",whiteSpace:"pre-wrap",textAlign:"center"}}>{settings.receiptFooter}</div></div>
    </div>
  );
}
