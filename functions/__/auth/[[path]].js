const FIREBASE_AUTH_ORIGIN = "https://realtime-database-11f5b.firebaseapp.com";

// Transparent same-origin proxy for Firebase's sign-in helper endpoints.
// Keep this as a proxy (not a 302 redirect) so browser storage remains first-party.
export async function onRequest({ request }) {
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(
    `${incomingUrl.pathname}${incomingUrl.search}`,
    FIREBASE_AUTH_ORIGIN
  );

  return fetch(new Request(targetUrl.toString(), request));
}
