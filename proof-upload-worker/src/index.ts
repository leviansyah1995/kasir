interface Env {
  GITHUB_TOKEN: string;
  GITHUB_PROOF_REPO: string;
  GITHUB_PROOF_BRANCH?: string;
  FIREBASE_API_KEY: string;
  FIREBASE_DATABASE_URL: string;
  ALLOWED_ORIGIN: string;
}

const originAllowed = (origin: string, allowed: string) => allowed.split(",").map(value => value.trim()).filter(Boolean).includes(origin);
const json = (body: unknown, status = 200, origin = "", allowedOrigin = "") => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(origin && originAllowed(origin, allowedOrigin) ? {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "Authorization, Content-Type",
      "access-control-max-age": "86400",
      "vary": "Origin",
    } : {}),
  },
});

function base64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
      "access-control-allow-origin": originAllowed(origin, env.ALLOWED_ORIGIN) ? origin : "null",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "Authorization, Content-Type",
      "access-control-max-age": "86400",
      "vary": "Origin",
    }});
    if (request.method !== "POST") return json({ error: "Metode tidak diizinkan." }, 405, origin, env.ALLOWED_ORIGIN);
    if (!origin || !originAllowed(origin, env.ALLOWED_ORIGIN)) return json({ error: "Origin tidak diizinkan." }, 403);
    if (!env.GITHUB_TOKEN || !env.GITHUB_PROOF_REPO || !env.FIREBASE_API_KEY || !env.FIREBASE_DATABASE_URL) {
      return json({ error: "Pengaturan server upload bukti belum lengkap." }, 503, origin, env.ALLOWED_ORIGIN);
    }

    const authorization = request.headers.get("authorization") || "";
    const idToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!idToken) return json({ error: "Login diperlukan untuk mengunggah bukti." }, 401, origin, env.ALLOWED_ORIGIN);

    // Validate Firebase ID token server-side; the GitHub credential never reaches the browser.
    const identityResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }),
    });
    if (!identityResponse.ok) return json({ error: "Sesi login tidak valid. Silakan login ulang." }, 401, origin, env.ALLOWED_ORIGIN);
    const identity = await identityResponse.json() as { users?: Array<{ localId?: string; disabled?: boolean }> };
    const firebaseUser = identity.users?.[0];
    if (!firebaseUser?.localId || firebaseUser.disabled) return json({ error: "Akun tidak valid." }, 401, origin, env.ALLOWED_ORIGIN);

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 6 * 1024 * 1024) return json({ error: "Ukuran upload terlalu besar (maksimal foto 5 MB)." }, 413, origin, env.ALLOWED_ORIGIN);
    let form: FormData;
    try { form = await request.formData(); }
    catch { return json({ error: "Form upload tidak valid." }, 400, origin, env.ALLOWED_ORIGIN); }
    const file = form.get("proof");
    const orderId = String(form.get("orderId") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
    const consent = form.get("publicConsent") === "true";
    const dateKey = String(form.get("dateKey") || "").replace(/[^0-9]/g, "");
    const uniqueCode = Number(form.get("uniqueCode") || 0);
    if (!(file instanceof File) || !orderId || !/^\d{8}$/.test(dateKey) || !Number.isInteger(uniqueCode) || uniqueCode < 1 || uniqueCode > 499) {
      return json({ error: "Foto, order, atau kode unik tidak valid." }, 400, origin, env.ALLOWED_ORIGIN);
    }
    if (!consent) return json({ error: "Persetujuan publikasi foto bukti diperlukan." }, 400, origin, env.ALLOWED_ORIGIN);

    // Ensure this signed-in user owns the still-active code reservation used by the checkout.
    const dbRoot = env.FIREBASE_DATABASE_URL.replace(/\/$/, "");
    const reservationResponse = await fetch(`${dbRoot}/qrisPaymentReservations/${dateKey}/${uniqueCode}.json?auth=${encodeURIComponent(idToken)}`);
    if (!reservationResponse.ok) return json({ error: "Tidak bisa memverifikasi reservasi kode unik." }, 403, origin, env.ALLOWED_ORIGIN);
    const reservation = await reservationResponse.json() as { uid?: string; orderId?: string; expiresAt?: number } | null;
    if (!reservation || reservation.uid !== firebaseUser.localId || reservation.orderId !== orderId || Number(reservation.expiresAt || 0) < Date.now()) {
      return json({ error: "Kode unik tidak cocok dengan akun/order atau reservasinya kedaluwarsa." }, 403, origin, env.ALLOWED_ORIGIN);
    }

    if (!file.type.startsWith("image/") || file.size < 1 || file.size > 5 * 1024 * 1024) return json({ error: "Foto harus berupa gambar maksimal 5 MB." }, 413, origin, env.ALLOWED_ORIGIN);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isWebp = bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    if (!isPng && !isJpeg && !isWebp) return json({ error: "Format foto tidak dikenali. Gunakan JPG, PNG, atau WebP." }, 415, origin, env.ALLOWED_ORIGIN);

    const extension = isPng ? "png" : isWebp ? "webp" : "jpg";
    const repo = env.GITHUB_PROOF_REPO.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) return json({ error: "Nama repo GitHub tidak valid." }, 500, origin, env.ALLOWED_ORIGIN);
    const branch = env.GITHUB_PROOF_BRANCH || "main";
    const date = new Date().toISOString().slice(0, 10);
    const path = `payment-proofs/${date}/${orderId}-${crypto.randomUUID()}.${extension}`;
    const [owner, name] = repo.split("/");
    const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
    const githubResponse = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        "accept": "application/vnd.github+json",
        "authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
        "user-agent": "POS-payment-proof-uploader",
      },
      body: JSON.stringify({ message: `Upload bukti QRIS untuk ${orderId}`, content: base64(bytes), branch }),
    });
    if (!githubResponse.ok) {
      const detail = await githubResponse.text();
      console.error("GitHub upload failed", githubResponse.status, detail.slice(0, 600));
      return json({ error: "Upload GitHub gagal. Periksa token, izin Contents: Read and write, repo, dan branch." }, 502, origin, env.ALLOWED_ORIGIN);
    }

    const url = `https://raw.githubusercontent.com/${owner}/${name}/${encodeURIComponent(branch)}/${path.split("/").map(encodeURIComponent).join("/")}`;
    return json({ url, path }, 200, origin, env.ALLOWED_ORIGIN);
  },
};
