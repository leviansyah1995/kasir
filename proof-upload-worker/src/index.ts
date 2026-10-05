interface Env {
  GITHUB_TOKEN: string;
  GITHUB_PROOF_REPO: string;
  GITHUB_PROOF_BRANCH?: string;
  FIREBASE_API_KEY: string;
  ALLOWED_ORIGIN: string;
}

type FirebaseUser = { localId?: string; disabled?: boolean; email?: string; emailVerified?: boolean };
const ADMIN_EMAIL = "dianarifin.shopeedriver@gmail.com";
const originAllowed = (origin: string, allowed: string) => allowed.split(",").map(value => value.trim()).filter(Boolean).includes(origin);
const cors = (origin: string, allowed: string): Record<string, string> => originAllowed(origin, allowed) ? {
  "access-control-allow-origin": origin,
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type",
  "access-control-max-age": "86400",
  "vary": "Origin",
} : {};
const json = (body: unknown, status = 200, origin = "", allowedOrigin = "") => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors(origin, allowedOrigin) },
});

function base64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}

async function firebaseUserForToken(idToken: string, env: Env): Promise<FirebaseUser | null> {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }),
  });
  if (!response.ok) return null;
  const result = await response.json() as { users?: FirebaseUser[] };
  const user = result.users?.[0];
  return user?.localId && !user.disabled ? user : null;
}

function repoDetails(env: Env) {
  const repo = env.GITHUB_PROOF_REPO.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) return null;
  const [owner, name] = repo.split("/");
  return { owner, name, branch: env.GITHUB_PROOF_BRANCH || "main" };
}

function isAllowedNotificationMp3(value: string) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const isAllowedHost = ["rawcdn.githack.com", "raw.githack.com", "gistcdn.githack.com", "cdn.jsdelivr.net"].includes(host);
    const isJsDelivrGhAsset = host !== "cdn.jsdelivr.net" || parsed.pathname.startsWith("/gh/");
    return parsed.protocol === "https:" && isAllowedHost && isJsDelivrGhAsset && parsed.pathname.toLowerCase().endsWith(".mp3");
  } catch { return false; }
}

async function privateRepoCheck(owner: string, name: string, env: Env): Promise<boolean> {
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
    headers: { "accept": "application/vnd.github+json", "authorization": `Bearer ${env.GITHUB_TOKEN}`, "x-github-api-version": "2022-11-28", "user-agent": "POS-private-proof-proxy" },
  });
  if (!response.ok) return false;
  const repo = await response.json() as { private?: boolean };
  return repo.private === true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin") || "";
    if (request.method === "OPTIONS") return new Response(null, {
      status: 204,
      headers: { "access-control-allow-origin": originAllowed(origin, env.ALLOWED_ORIGIN) ? origin : "null", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "Authorization, Content-Type", "access-control-max-age": "86400", vary: "Origin" },
    });
    if (request.method !== "GET" && request.method !== "POST") return json({ error: "Metode tidak diizinkan." }, 405, origin, env.ALLOWED_ORIGIN);
    if (!origin || !originAllowed(origin, env.ALLOWED_ORIGIN)) return json({ error: "Origin tidak diizinkan." }, 403);
    if (!env.GITHUB_TOKEN || !env.GITHUB_PROOF_REPO || !env.FIREBASE_API_KEY) return json({ error: "Pengaturan server bukti privat belum lengkap." }, 503, origin, env.ALLOWED_ORIGIN);

    const authorization = request.headers.get("authorization") || "";
    const idToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!idToken) return json({ error: "Login diperlukan." }, 401, origin, env.ALLOWED_ORIGIN);
    const firebaseUser = await firebaseUserForToken(idToken, env);
    if (!firebaseUser) return json({ error: "Sesi Firebase tidak valid. Silakan login ulang." }, 401, origin, env.ALLOWED_ORIGIN);

    // Upload foto produk ke repo publik terpisah. Foto produk memang ditampilkan ke pelanggan;
    // repo payment-proofs tetap private dan tidak dilewatkan ke jalur publik ini.
    let parsedForm: FormData | null = null;
    if (request.method === "POST") {
      try { parsedForm = await request.formData(); }
      catch { return json({ error: "Form upload tidak valid." }, 400, origin, env.ALLOWED_ORIGIN); }
      const productFile = parsedForm.get("productImage");
      if (productFile instanceof File) {
        if (firebaseUser.email?.toLowerCase() !== ADMIN_EMAIL || firebaseUser.emailVerified !== true) return json({ error: "Hanya admin terverifikasi yang boleh mengunggah foto produk." }, 403, origin, env.ALLOWED_ORIGIN);
        if (productFile.size < 1) return json({ error: "File foto produk kosong." }, 400, origin, env.ALLOWED_ORIGIN);
        const productBytes = new Uint8Array(await productFile.arrayBuffer());
        const isPng = productBytes.length > 8 && productBytes[0] === 0x89 && productBytes[1] === 0x50 && productBytes[2] === 0x4e && productBytes[3] === 0x47;
        const isJpeg = productBytes.length > 3 && productBytes[0] === 0xff && productBytes[1] === 0xd8 && productBytes[2] === 0xff;
        const isWebp = productBytes.length > 12 && String.fromCharCode(...productBytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...productBytes.slice(8, 12)) === "WEBP";
        if (!isPng && !isJpeg && !isWebp) return json({ error: "Foto produk harus berupa JPG, PNG, atau WebP." }, 415, origin, env.ALLOWED_ORIGIN);

        const extension = isPng ? "png" : isWebp ? "webp" : "jpg";
        const imagePath = `products/${Date.now()}-${crypto.randomUUID()}.${extension}`;
        const imageApiUrl = `https://api.github.com/repos/leviansyah1995/asset/contents/${imagePath.split("/").map(encodeURIComponent).join("/")}`;
        const imageResponse = await fetch(imageApiUrl, {
          method: "PUT",
          headers: { "accept": "application/vnd.github+json", "authorization": `Bearer ${env.GITHUB_TOKEN}`, "x-github-api-version": "2022-11-28", "content-type": "application/json", "user-agent": "Leviankitchen-Product-Image-Uploader" },
          body: JSON.stringify({ message: `Upload foto produk ${imagePath.split("/").pop()}`, content: base64(productBytes), branch: "main" }),
        });
        if (!imageResponse.ok) {
          const detail = await imageResponse.text();
          console.error("Public product-image upload failed", imageResponse.status, detail.slice(0, 500));
          return json({ error: "Upload foto produk ke GitHub gagal. Pastikan GITHUB_TOKEN memiliki izin Contents: Read and write pada repo leviansyah1995/asset." }, 502, origin, env.ALLOWED_ORIGIN);
        }
        const imageUrl = `https://raw.githubusercontent.com/leviansyah1995/asset/main/${imagePath}`;
        return json({ imageUrl, path: imagePath }, 200, origin, env.ALLOWED_ORIGIN);
      }
    }

    // Proxy MP3 publik GitHack server-side supaya Web Audio dapat mendekode MP3 tanpa bergantung pada CORS CDN.
    if (request.method === "GET") {
      const requestedAudioUrl = new URL(request.url).searchParams.get("audioUrl");
      if (requestedAudioUrl) {
        if (firebaseUser.email?.toLowerCase() !== ADMIN_EMAIL || firebaseUser.emailVerified !== true) return json({ error: "Hanya admin terverifikasi yang boleh mengambil MP3 notifikasi." }, 403, origin, env.ALLOWED_ORIGIN);
        if (!isAllowedNotificationMp3(requestedAudioUrl)) return json({ error: "URL harus HTTPS langsung ke file .mp3 pada GitHack atau jalur /gh/ di jsDelivr." }, 400, origin, env.ALLOWED_ORIGIN);
        const upstream = await fetch(requestedAudioUrl, { headers: { "accept": "audio/mpeg, application/octet-stream;q=0.9, */*;q=0.8" } });
        if (!upstream.ok) return json({ error: `CDN MP3 mengembalikan status ${upstream.status}.` }, 502, origin, env.ALLOWED_ORIGIN);
        const upstreamType = (upstream.headers.get("content-type") || "").toLowerCase();
        if (upstreamType.includes("text/html")) return json({ error: "Link tersebut membuka halaman HTML, bukan file MP3 langsung." }, 415, origin, env.ALLOWED_ORIGIN);
        const declaredLength = Number(upstream.headers.get("content-length") || 0);
        if (declaredLength > 12 * 1024 * 1024) return json({ error: "MP3 terlalu besar (maksimal 12 MB)." }, 413, origin, env.ALLOWED_ORIGIN);
        const audioBytes = await upstream.arrayBuffer();
        if (audioBytes.byteLength < 100 || audioBytes.byteLength > 12 * 1024 * 1024) return json({ error: "MP3 kosong atau terlalu besar (maksimal 12 MB)." }, 413, origin, env.ALLOWED_ORIGIN);
        return new Response(audioBytes, { status: 200, headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=300", ...cors(origin, env.ALLOWED_ORIGIN) } });
      }
    }

    const repo = repoDetails(env);
    if (!repo) return json({ error: "Nama repo GitHub tidak valid." }, 500, origin, env.ALLOWED_ORIGIN);
    const isPrivate = await privateRepoCheck(repo.owner, repo.name, env);
    if (!isPrivate) return json({ error: "Upload bukti dihentikan: repo tujuan harus Private agar foto pelanggan tidak publik." }, 409, origin, env.ALLOWED_ORIGIN);

    if (request.method === "GET") {
      if (firebaseUser.email?.toLowerCase() !== ADMIN_EMAIL || firebaseUser.emailVerified !== true) return json({ error: "Hanya admin terverifikasi yang boleh melihat bukti pembayaran." }, 403, origin, env.ALLOWED_ORIGIN);
      const path = new URL(request.url).searchParams.get("path") || "";
      if (!/^payment-proofs\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(path)) return json({ error: "Path bukti tidak valid." }, 400, origin, env.ALLOWED_ORIGIN);
      const fileUrl = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(repo.branch)}`;
      const fileResponse = await fetch(fileUrl, {
        headers: { "accept": "application/vnd.github.raw", "authorization": `Bearer ${env.GITHUB_TOKEN}`, "x-github-api-version": "2022-11-28", "user-agent": "POS-private-proof-proxy" },
      });
      if (!fileResponse.ok) return json({ error: "Bukti privat tidak ditemukan atau GitHub menolak akses." }, 404, origin, env.ALLOWED_ORIGIN);
      const contentType = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
      return new Response(fileResponse.body, { status: 200, headers: { "content-type": contentType, "cache-control": "private, no-store", ...cors(origin, env.ALLOWED_ORIGIN) } });
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 6 * 1024 * 1024) return json({ error: "Ukuran upload terlalu besar (maksimal foto 5 MB)." }, 413, origin, env.ALLOWED_ORIGIN);
    const form = parsedForm;
    if (!form) return json({ error: "Form upload tidak valid." }, 400, origin, env.ALLOWED_ORIGIN);
    const file = form.get("proof");
    const orderId = String(form.get("orderId") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
    if (!(file instanceof File) || !orderId) return json({ error: "Foto atau nomor pesanan tidak valid." }, 400, origin, env.ALLOWED_ORIGIN);

    if (!file.type.startsWith("image/") || file.size < 1 || file.size > 5 * 1024 * 1024) return json({ error: "Foto harus berupa gambar maksimal 5 MB." }, 413, origin, env.ALLOWED_ORIGIN);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isWebp = bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    if (!isPng && !isJpeg && !isWebp) return json({ error: "Format foto tidak dikenali. Gunakan JPG, PNG, atau WebP." }, 415, origin, env.ALLOWED_ORIGIN);

    const extension = isPng ? "png" : isWebp ? "webp" : "jpg";
    const date = new Date().toISOString().slice(0, 10);
    const path = `payment-proofs/${date}/${orderId}-${crypto.randomUUID()}.${extension}`;
    const fileUrl = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
    const uploadResponse = await fetch(fileUrl, {
      method: "PUT",
      headers: { "accept": "application/vnd.github+json", "authorization": `Bearer ${env.GITHUB_TOKEN}`, "x-github-api-version": "2022-11-28", "content-type": "application/json", "user-agent": "POS-private-proof-uploader" },
      body: JSON.stringify({ message: `Upload bukti QRIS untuk ${orderId}`, content: base64(bytes), branch: repo.branch }),
    });
    if (!uploadResponse.ok) {
      const detail = await uploadResponse.text();
      console.error("Private GitHub upload failed", uploadResponse.status, detail.slice(0, 600));
      return json({ error: "Upload ke repo GitHub Private gagal. Periksa token, izin Contents: Read and write, repo, dan branch." }, 502, origin, env.ALLOWED_ORIGIN);
    }
    return json({ path }, 200, origin, env.ALLOWED_ORIGIN);
  },
};
