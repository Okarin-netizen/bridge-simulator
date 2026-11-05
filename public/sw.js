// かけはしラボを、ネットにつながっていない教室でも開けるようにする。
// ネットにつながるときは毎回新しいものを取りに行き（更新がすぐ届く）、
// つながらないときだけ、前に保存しておいたものを使う。

const CACHE_NAME = 'kakehashi-lab';

// はじめて開いたときに、画面に必要なファイルをまとめて保存しておく
self.addEventListener('install', (event) => {
  event.waitUntil(saveAppFiles().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetchAndSave(event.request));
});

async function saveAppFiles() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch('./', { cache: 'no-store' });
  await cache.put('./', response.clone());

  // index.html から、ビルドで名前の変わる JS・CSS や、フォントの場所を読み取る
  const html = await response.text();
  const links = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  const files = links.filter((link) => !link.startsWith('https://fonts.gstatic.com'));
  await Promise.all(files.map((file) => saveOne(cache, file)));
}

async function saveOne(cache, url) {
  try {
    const response = await fetch(url, { mode: url.startsWith('http') ? 'no-cors' : 'same-origin' });
    await cache.put(url, response);
  } catch {
    // 保存できなかったファイルは、次に開いたときに保存される
  }
}

async function fetchAndSave(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // JS は「どこから読まれたか」でサーバーの返事が変わることがあるので、その違いは気にしない
    const saved = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
    if (saved) return saved;
    // ページそのものを開こうとしたときは、保存しておいたトップページを返す
    if (request.mode === 'navigate') {
      const top = await cache.match('./');
      if (top) return top;
    }
    throw error;
  }
}
