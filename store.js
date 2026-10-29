// Veri katmanı: gönderiler/yorumlar için iki arka uç.
//  - Yerel mod (localStorage): tek tarayıcıda çalışır, kurulum gerektirmez.
//  - Firebase modu (Firestore): tüm öğrenciler aynı akışı görür.
// "Kaydedilenler" her iki modda da öğrencinin kendi tarayıcısında tutulur.

const POST_LIMIT = 60;
const COMMENT_LIMIT = 100;
const FIREBASE_VERSION = "10.12.2";

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("Tarayıcı depolama alanı doldu. Daha küçük bir fotoğraf deneyin veya eski gönderileri silin.");
  }
}

// ── Kaydedilenler (cihazda, öğrenci bazlı) ──────────────────
function savedKey(studentId) {
  return `oo:saved:${studentId}`;
}

function getSavedSet(studentId) {
  const list = readJSON(savedKey(studentId), []);
  return new Set(Array.isArray(list) ? list.map(String) : []);
}

export function toggleSaved(studentId, postId) {
  const saved = getSavedSet(studentId);
  const id = String(postId);
  let nowSaved;
  if (saved.has(id)) {
    saved.delete(id);
    nowSaved = false;
  } else {
    saved.add(id);
    nowSaved = true;
  }
  writeJSON(savedKey(studentId), [...saved]);
  return { saved: nowSaved };
}

// ── Yerel mod ───────────────────────────────────────────────
function createLocalBackend() {
  const POSTS = "oo:posts";
  const COMMENTS = "oo:comments";
  const COUNTER = "oo:counter";

  function nextId() {
    const next = Number(readJSON(COUNTER, 0)) + 1;
    writeJSON(COUNTER, next);
    return String(next);
  }

  return {
    mode: "local",
    async listPosts() {
      const posts = readJSON(POSTS, []);
      return posts.sort((a, b) => b.createdAt - a.createdAt).slice(0, POST_LIMIT);
    },
    async createPost(post) {
      const posts = readJSON(POSTS, []);
      const created = { ...post, id: nextId(), createdAt: Date.now() };
      posts.push(created);
      writeJSON(POSTS, posts);
      return { id: created.id };
    },
    async postExists(postId) {
      return readJSON(POSTS, []).some(post => String(post.id) === String(postId));
    },
    async listComments(postId) {
      return readJSON(COMMENTS, [])
        .filter(comment => String(comment.postId) === String(postId))
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, COMMENT_LIMIT);
    },
    async addComment(postId, comment) {
      const comments = readJSON(COMMENTS, []);
      comments.push({ ...comment, id: nextId(), postId: String(postId), createdAt: Date.now() });
      writeJSON(COMMENTS, comments);
    },
  };
}

// ── Firebase modu ───────────────────────────────────────────
async function createFirebaseBackend(config) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, fs] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const db = fs.getFirestore(initializeApp(config));

  return {
    mode: "firebase",
    async listPosts() {
      const snapshot = await fs.getDocs(fs.query(fs.collection(db, "posts"), fs.orderBy("createdAt", "desc"), fs.limit(POST_LIMIT)));
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },
    async createPost(post) {
      const ref = await fs.addDoc(fs.collection(db, "posts"), { ...post, createdAt: Date.now() });
      return { id: ref.id };
    },
    async postExists(postId) {
      const snap = await fs.getDoc(fs.doc(db, "posts", String(postId)));
      return snap.exists();
    },
    async listComments(postId) {
      const snapshot = await fs.getDocs(fs.query(fs.collection(db, "posts", String(postId), "comments"), fs.orderBy("createdAt", "asc"), fs.limit(COMMENT_LIMIT)));
      return snapshot.docs.map(doc => ({ id: doc.id, postId: String(postId), ...doc.data() }));
    },
    async addComment(postId, comment) {
      await fs.addDoc(fs.collection(db, "posts", String(postId), "comments"), { ...comment, createdAt: Date.now() });
    },
  };
}

export async function createStore(firebaseConfig) {
  if (!firebaseConfig) return createLocalBackend();
  try {
    return await createFirebaseBackend(firebaseConfig);
  } catch (error) {
    console.error("Firebase başlatılamadı, yerel moda geçildi:", error);
    const fallback = createLocalBackend();
    fallback.fallbackReason = "Paylaşımlı veritabanına bağlanılamadı; yerel modda çalışıyor.";
    return fallback;
  }
}

export function attachSavedState(posts, studentId) {
  const saved = getSavedSet(studentId);
  return posts.map(post => ({ ...post, savedByMe: saved.has(String(post.id)) }));
}

// ── Fotoğraf: boyut/tür denetimi ve sıkıştırma ──────────────
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_DATA_URL_LENGTH = 700_000; // Firestore belge sınırının (1 MiB) altında kalmak için

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Fotoğraf dosyası okunamadı."));
    };
    image.src = url;
  });
}

export async function compressImage(file) {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("JPEG, PNG veya WebP biçiminde bir fotoğraf seçin.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Fotoğraf en fazla 5 MB olabilir.");

  const image = await loadImage(file);
  let maxSide = 1280;
  let quality = 0.82;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= MAX_DATA_URL_LENGTH) return dataUrl;
    maxSide = Math.round(maxSide * 0.8);
    quality = Math.max(0.5, quality - 0.08);
  }
  throw new Error("Fotoğraf çok büyük; lütfen daha küçük bir fotoğraf seçin.");
}
