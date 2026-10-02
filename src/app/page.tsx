"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onValue, ref } from "firebase/database";
import { db } from "../lib/firebase";
import {
  ArrowDownRight, ArrowRight, BadgeCheck, ChevronRight, Clock3, Heart,
  Menu, Sparkles, Star, Utensils, X, Zap
} from "lucide-react";

type PromoProduct = {
  id: string;
  name: string;
  price: number;
  imageUrl: string;
  category: string;
  description?: string;
  active?: boolean;
};

type LandingDesign = { brandName: string; title: string; description: string; ctaLabel: string; heroImage: string };
const DEFAULT_LANDING_DESIGN: LandingDesign = {
  brandName: "Toko Manis",
  title: "Ada hari yang butuh manis lebih.",
  description: "Terang bulan hangat, topping berlimpah, dan camilan yang bikin momen sederhana terasa istimewa.",
  ctaLabel: "Pilih menu & pesan",
  heroImage: "/images/terang-bulan-hero.jpg",
};
const HERO_IMAGE = "/images/terang-bulan-hero.jpg";
const stringValue = (...values: unknown[]) => values.find((value): value is string => typeof value === "string" && value.length > 0) || "";
const formatRp = (value: number) => `Rp ${Math.round(Number(value) || 0).toLocaleString("id-ID")}`;

const steps = [
  { number: "01", title: "Pilih yang kamu suka", description: "Jelajahi terang bulan, roti bakar, dan camilan manis lainnya." },
  { number: "02", title: "Atur sesukamu", description: "Pilih rasa, cara penyajian, dan tulis catatan khusus untuk pesananmu." },
  { number: "03", title: "Tentukan cara menikmati", description: "Pilih delivery atau take away, lalu lanjutkan pesanan dengan mudah." },
];

export default function HomePage() {
  const [products, setProducts] = useState<PromoProduct[]>([]);
  const [landingDesign, setLandingDesign] = useState<LandingDesign>(DEFAULT_LANDING_DESIGN);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = onValue(ref(db, "publicPaymentSettings/landingPage"), snapshot => {
      const saved = (snapshot.val() || {}) as Record<string, unknown>;
      setLandingDesign({
        brandName: stringValue(saved.brandName) || DEFAULT_LANDING_DESIGN.brandName,
        title: stringValue(saved.title) || DEFAULT_LANDING_DESIGN.title,
        description: stringValue(saved.description) || DEFAULT_LANDING_DESIGN.description,
        ctaLabel: stringValue(saved.ctaLabel) || DEFAULT_LANDING_DESIGN.ctaLabel,
        heroImage: stringValue(saved.heroImage) || DEFAULT_LANDING_DESIGN.heroImage,
      });
    }, error => console.warn("Pengaturan tampilan landing belum dapat dimuat:", error));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onValue(ref(db, "products"), snapshot => {
      if (!snapshot.exists()) { setProducts([]); return; }
      const raw = snapshot.val() || {};
      const list: PromoProduct[] = Object.entries(raw).map(([id, value]) => {
        const product = (value || {}) as Record<string, unknown>;
        return {
          id,
          name: stringValue(product.name) || "Menu favorit",
          price: Number(product.price || 0),
          imageUrl: stringValue(product.imageUrl, product.imageURL, product.image, product.photoUrl),
          category: stringValue(product.category) || "Menu Toko Manis",
          description: stringValue(product.description),
          active: product.active !== false,
        };
      }).filter(product => product.active).slice(0, 3);
      setProducts(list);
    }, error => console.warn("Menu promo belum dapat dimuat:", error));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    document.title = `${landingDesign.brandName} — ${landingDesign.title}`;
    const descriptionTag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (descriptionTag) descriptionTag.content = landingDesign.description;
  }, [landingDesign.brandName, landingDesign.title, landingDesign.description]);

  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!("IntersectionObserver" in window)) {
      elements.forEach(element => element.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    elements.forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [products]);

  return (
    <main className="promo-site min-h-screen overflow-hidden">
      <header className="promo-nav-wrap">
        <nav className="promo-nav mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label={`${landingDesign.brandName}, beranda`}>
            <span className="promo-mark">{landingDesign.brandName.trim().charAt(0).toUpperCase() || "M"}<span>.</span></span>
            <span className="leading-tight"><b className="block text-[15px] font-black tracking-tight">{landingDesign.brandName.toUpperCase()}</b><small className="text-[9px] font-semibold tracking-[.22em] text-[#9b8372]">KUDAPAN HANGAT</small></span>
          </Link>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#menu" className="promo-nav-link">Menu favorit</a>
            <a href="#cerita" className="promo-nav-link">Cerita rasa</a>
            <a href="#cara-pesan" className="promo-nav-link">Cara pesan</a>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/shop" className="promo-nav-cta hidden sm:inline-flex">{landingDesign.ctaLabel} <ArrowRight size={15}/></Link>
            <button className="promo-menu-button md:hidden" aria-label={menuOpen ? "Tutup menu" : "Buka menu"} onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={20}/> : <Menu size={20}/>}</button>
          </div>
        </nav>
        {menuOpen && <div className="promo-mobile-menu md:hidden">
          <a href="#menu" onClick={() => setMenuOpen(false)}>Menu favorit</a>
          <a href="#cerita" onClick={() => setMenuOpen(false)}>Cerita rasa</a>
          <a href="#cara-pesan" onClick={() => setMenuOpen(false)}>Cara pesan</a>
          <Link href="/shop" onClick={() => setMenuOpen(false)}>{landingDesign.ctaLabel} <ArrowRight size={15}/></Link>
        </div>}
      </header>

      <section className="promo-hero relative isolate">
        <div className="promo-grain" aria-hidden="true" />
        <div className="promo-orb promo-orb-one" aria-hidden="true" />
        <div className="promo-orb promo-orb-two" aria-hidden="true" />
        <div className="relative mx-auto grid min-h-[690px] max-w-7xl items-center gap-4 px-5 pb-16 pt-12 sm:px-8 lg:min-h-[720px] lg:grid-cols-[.92fr_1.08fr] lg:gap-8 lg:pb-20 lg:pt-10">
          <div className="promo-hero-copy relative z-10 max-w-2xl">
            <div className="promo-eyebrow"><span className="promo-eyebrow-dot"/> MANISNYA SELALU PUNYA CERITA</div>
            <h1 className="promo-title mt-6">{landingDesign.title}</h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-[#d8c8b9] sm:text-lg sm:leading-8">{landingDesign.description}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/shop" className="promo-primary-button">{landingDesign.ctaLabel} <ArrowRight size={17}/></Link>
              <a href="#menu" className="promo-secondary-button">Jelajahi menu <ArrowDownRight size={17}/></a>
            </div>
            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3 text-[11px] font-semibold text-[#c9b8a8] sm:text-xs">
              <span className="inline-flex items-center gap-2"><Clock3 size={15} className="text-[#f5a561]"/> Dibuat saat dipesan</span>
              <span className="inline-flex items-center gap-2"><Heart size={15} className="text-[#f5a561]"/> Bisa pilih favoritmu</span>
            </div>
          </div>

          <div className="promo-hero-art relative mx-auto mt-7 w-full max-w-[590px] lg:mt-0">
            <div className="promo-image-frame">
              <img src={landingDesign.heroImage} alt={`${landingDesign.brandName} — foto produk unggulan`} className="promo-hero-image" />
              <div className="promo-image-shade" />
              <div className="promo-image-caption"><span>HANGAT DARI DAPUR</span><b>Potongan kecil, bahagia besar.</b></div>
            </div>
            <div className="promo-sticker"><Sparkles size={15}/><span>Teman terbaik<br/>saat santai</span></div>
            <div className="promo-floating-note"><span className="promo-note-star"><Star size={13} fill="currentColor"/></span><span><b>Rasa pilihanmu.</b><small>Dibuat untuk dinikmati.</small></span></div>
            <span className="promo-art-ring" aria-hidden="true" />
          </div>
        </div>
        <a href="#menu" className="promo-scroll-cue" aria-label="Gulir untuk melihat menu"><span/> GULIR UNTUK YANG MANIS</a>
      </section>

      <div className="promo-marquee" aria-label="Menu Toko Manis">
        <div className="promo-marquee-track">
          {Array.from({ length: 2 }).map((_, row) => <div className="promo-marquee-group" key={row}>
            {(["TERANG BULAN", "ROTI BAKAR", "PISANG KEJU", "MOOD BAIK DIMULAI DARI SINI"] as const).map((item, index) => <span key={`${row}-${item}`} className="promo-marquee-item">{item}<i>{index % 2 === 0 ? "✳" : "✦"}</i></span>)}
          </div>)}
        </div>
      </div>

      <section id="menu" className="promo-section promo-menu-section px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end" data-reveal>
            <div>
              <p className="promo-kicker">DARI DAPUR, DENGAN RASA</p>
              <h2 className="promo-section-title mt-3">Yang sering bikin <em>kangen.</em></h2>
            </div>
            <Link href="/shop" className="promo-text-link">Lihat semua menu <ArrowRight size={16}/></Link>
          </div>
          {products.length > 0 ? (
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-reveal>
              {products.map((product, index) => <Link href={`/shop?product=${encodeURIComponent(product.id)}`} className="promo-product-card group" key={product.id}>
                <div className="promo-product-image-wrap">
                  <img src={product.imageUrl || HERO_IMAGE} alt={product.name} className="promo-product-image" />
                  <span className="promo-product-index">0{index + 1}</span>
                  <span className="promo-product-arrow"><ArrowDownRight size={18}/></span>
                </div>
                <div className="p-5 sm:p-6">
                  <p className="promo-kicker">{product.category}</p>
                  <h3 className="mt-2 text-xl font-black tracking-tight text-[#302017]">{product.name}</h3>
                  {product.description && <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#887468]">{product.description}</p>}
                  <div className="mt-5 flex items-center justify-between border-t border-[#efe4d8] pt-4"><b className="text-sm text-[#6f3b22]">{formatRp(product.price)}</b><span className="text-[10px] font-bold uppercase tracking-[.15em] text-[#ad7954]">Pilih rasa</span></div>
                </div>
              </Link>)}
            </div>
          ) : (
            <div className="mt-10 grid gap-4 sm:grid-cols-3" data-reveal>
              {[
                { title: "Terang Bulan", note: "Lembut, hangat, dan siap dipadukan dengan rasa favorit." },
                { title: "Roti Bakar", note: "Teman santai dengan isian yang bisa kamu pilih." },
                { title: "Pisang Keju", note: "Camilan manis gurih untuk menemani cerita." },
              ].map((item, index) => <Link href="/shop" key={item.title} className="promo-category-card">
                <span className="promo-category-number">0{index + 1}</span><span className="promo-category-icon"><Utensils size={19}/></span>
                <h3>{item.title}</h3><p>{item.note}</p><span className="promo-category-link">Jelajahi <ArrowRight size={15}/></span>
              </Link>)}
            </div>
          )}
        </div>
      </section>

      <section id="cerita" className="promo-story-section px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <div className="promo-story-art" data-reveal>
            <img src={landingDesign.heroImage} alt={`${landingDesign.brandName} — suasana menikmati menu`} />
            <div className="promo-story-badge"><span>MANIS</span><b>di setiap<br/>potongan</b><Sparkles size={18}/></div>
            <span className="promo-story-decoration" aria-hidden="true">✳</span>
          </div>
          <div data-reveal>
            <p className="promo-kicker">KARENA YANG SEDERHANA JUGA BERARTI</p>
            <h2 className="promo-section-title mt-3">Bukan cuma camilan.<br/><em>Ini jeda kecilmu.</em></h2>
            <p className="mt-6 max-w-xl text-sm leading-7 text-[#78675a] sm:text-base sm:leading-8">Ada rasa yang pas untuk menemani obrolan, merayakan hal kecil, atau sekadar memberi hadiah manis untuk diri sendiri. Pilih yang kamu suka—sisanya biar kami siapkan.</p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="promo-feature"><span><BadgeCheck size={17}/></span><div><b>Pilih sesuai selera</b><small>Rasa dan pilihan tersedia di katalog.</small></div></div>
              <div className="promo-feature"><span><Zap size={17}/></span><div><b>Pesan dengan mudah</b><small>Atur pesanan langsung dari Shop.</small></div></div>
            </div>
            <Link href="/shop" className="promo-dark-button mt-9">Temukan favoritmu <ArrowRight size={16}/></Link>
          </div>
        </div>
      </section>

      <section id="cara-pesan" className="promo-section px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="text-center" data-reveal><p className="promo-kicker">TIGA LANGKAH MENUJU BAHAGIA</p><h2 className="promo-section-title mt-3">Gampang. <em>Sesimpel itu.</em></h2></div>
          <div className="mt-12 grid gap-4 md:grid-cols-3" data-reveal>
            {steps.map((step, index) => <article className="promo-step-card" key={step.number}>
              <div className="flex items-start justify-between"><span className="promo-step-number">{step.number}</span><span className="promo-step-line">{index < 2 && <span/>}</span></div>
              <h3>{step.title}</h3><p>{step.description}</p>
            </article>)}
          </div>
        </div>
      </section>

      <section className="promo-final-cta px-5 py-20 sm:px-8 sm:py-28">
        <div className="promo-final-card mx-auto max-w-7xl" data-reveal>
          <div className="promo-final-glow" aria-hidden="true" />
          <div className="relative z-10 max-w-2xl">
            <p className="promo-kicker text-[#ffc58f]">SESUATU YANG MANIS MENUNGGU</p>
            <h2 className="promo-final-title mt-4">Yuk, bikin harimu sedikit lebih <em>manis.</em></h2>
            <p className="mt-4 max-w-lg text-sm leading-7 text-[#ddc9b8]">Pilih menu favoritmu, sesuaikan rasanya, lalu pesan dalam beberapa langkah.</p>
            <Link href="/shop" className="promo-primary-button mt-7">Buka Shop sekarang <ArrowRight size={17}/></Link>
          </div>
          <div className="promo-final-stamp"><span>MADE</span><b>with<br/>love</b><Heart size={18} fill="currentColor"/></div>
        </div>
      </section>

      <footer className="promo-footer px-5 py-7 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
          <Link href="/" className="flex items-center gap-2"><span className="promo-mark promo-mark-small">{landingDesign.brandName.trim().charAt(0).toUpperCase() || "M"}<span>.</span></span><b className="text-xs font-black tracking-widest">{landingDesign.brandName.toUpperCase()}</b></Link>
          <p className="text-[10px] text-[#b9a99a]">Satu gigitan, satu alasan untuk tersenyum.</p>
          <Link href="/shop" className="text-[10px] font-bold uppercase tracking-[.15em] text-[#f4a15a]">Pesan melalui Shop <ChevronRight size={13} className="inline"/></Link>
        </div>
      </footer>
    </main>
  );
}
