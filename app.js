import { FIREBASE_CONFIG } from "./config.js";
import { hasForbiddenPostText } from "./moderation.js";
import { createStore, attachSavedState, toggleSaved, compressImage, MAX_IMAGE_BYTES, IMAGE_TYPES } from "./store.js";

const root = document.querySelector("#app");

if (!root) {
  throw new Error("Uygulama kökü bulunamadı.");
}

const MODERATION_MESSAGE = "Öğretmen adları ve okul adı gönderi ya da yorumlarda kullanılamaz. Lütfen metni düzenleyip yeniden deneyin.";
const POST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const icons = {
  message: '<path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19l.9-4A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16M8 7h8M8 11h7"/>',
  shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  bookmark: '<path d="M6 4.8A1.8 1.8 0 0 1 7.8 3h8.4A1.8 1.8 0 0 1 18 4.8V21l-6-3.8L6 21z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.8 8.2-2.5 5.1-5.1 2.5 2.5-5.1z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  paperclip: '<path d="m21.4 11.1-8.9 8.9a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  close: '<path d="m18 6-12 12M6 6l12 12"/>',
  sparkle: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/><path d="m19 14 1 2.5 2.5 1-2.5 1L19 21l-1-2.5-2.5-1 2.5-1z"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>',
};

let currentStudent = null;
let sessionChecked = false;
let renderSequence = 0;
let selectedImage = null;
let imagePreviewUrl = "";

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ""}</svg>`;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function brandMark() {
  return `<span class="brand-mark" aria-hidden="true">${icon("message", 19)}<span></span></span>`;
}

function isNameFormatValid(value) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  return words.every(word => {
    const letters = [...word].filter(character => /\p{L}/u.test(character));
    if (letters.length === 0) return false;
    if (letters[0] !== letters[0].toLocaleUpperCase("tr-TR")) return false;
    return letters.slice(1).every(character => character === character.toLocaleLowerCase("tr-TR"));
  });
}

const SESSION_KEY = "oo:session";
const ATTEMPT_KEY = "oo:attempts";
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;

let store = null;
let REGISTERED_STUDENTS = [];

function readStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* depolama kapalıysa oturum yalnızca sayfa açıkken geçerli olur */
  }
}

function normalizeStudentName(name) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr-TR");
}

function publicStudent(student) {
  return { id: student.id, displayName: student.displayName };
}

function loadSession() {
  // Eski sürümden kalan kalıcı oturumlar (localStorage) artık geçerli değil; temizle.
  try { localStorage.removeItem(SESSION_KEY); } catch { /* yoksay */ }
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { /* yoksay */ }
  if (!session || !(session.expiresAt > Date.now())) return null;
  const student = REGISTERED_STUDENTS.find(account =>
    account.id === session.studentId
    && account.schoolNumber === session.schoolNumber
    && normalizeStudentName(account.displayName) === session.nameKey,
  );
  if (!student) {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* yoksay */ }
    return null;
  }
  return publicStudent(student);
}

function loginStudent(name, schoolNumber) {
  const now = Date.now();
  const attempts = readStorage(ATTEMPT_KEY);
  if (attempts && attempts.lockedUntil > now) {
    const minutes = Math.ceil((attempts.lockedUntil - now) / 60000);
    throw new Error(`Çok fazla hatalı deneme yapıldı. ${minutes} dakika sonra yeniden deneyin.`);
  }

  const student = REGISTERED_STUDENTS.find(account =>
    normalizeStudentName(account.displayName) === normalizeStudentName(name) && account.schoolNumber === schoolNumber,
  );

  if (!student) {
    const failed = (attempts && attempts.resetAt > now ? attempts.count : 0) + 1;
    writeStorage(ATTEMPT_KEY, failed >= MAX_FAILED_ATTEMPTS
      ? { count: 0, resetAt: 0, lockedUntil: now + LOCK_MS }
      : { count: failed, resetAt: now + LOCK_MS, lockedUntil: 0 });
    throw new Error("Bu bilgilerle kayıtlı öğrenci hesabı bulunamadı.");
  }

  writeStorage(ATTEMPT_KEY, null);
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      studentId: student.id,
      schoolNumber: student.schoolNumber,
      nameKey: normalizeStudentName(student.displayName),
      expiresAt: now + SESSION_LIFETIME_MS,
    }));
  } catch { /* depolama kapalıysa oturum yalnızca sayfa açıkken geçerli olur */ }
  return publicStudent(student);
}

function logoutStudent() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* yoksay */ }
  try { localStorage.removeItem(SESSION_KEY); } catch { /* yoksay */ }
}

function getRoute() {
  return window.location.hash === "#/saved" ? "saved" : "feed";
}

function modeNote() {
  if (!store) return "";
  if (store.fallbackReason) return `<p class="mode-note"><strong>Bağlantı sorunu:</strong> ${escapeHTML(store.fallbackReason)}</p>`;
  if (store.mode === "local") return '<p class="mode-note"><strong>Yerel mod:</strong> Gönderiler yalnızca bu tarayıcıda saklanır; diğer öğrenciler görmez.</p>';
  return "";
}

function setMessage(element, message) {
  if (!element) return;
  element.textContent = message || "";
  element.hidden = !message;
}

function renderLoading(message = "Öğrenci alanı açılıyor…") {
  root.innerHTML = `<div class="loading-screen"><span class="loading-dot" aria-hidden="true"></span>${escapeHTML(message)}</div>`;
}

function renderLogin(message = "") {
  root.innerHTML = `
    <main class="login-stage">
      <section class="login-intro">
        <div class="brand-lockup">
          ${brandMark()}
          <div><span class="brand-name">Öğrenciye Öğrence</span><span class="brand-school">Antalya Anadolu Lisesi</span></div>
        </div>
        <div class="login-headline">
          <span class="eyebrow"><span class="eyebrow-dot"></span>Birlikte daha kolay</span>
          <h1>Takıldığın yeri sor.<br><em>Birlikte çözelim.</em></h1>
          <p>Merak ettiğin konuları paylaş, arkadaşlarının sorularına omuz ver. Burası birbirine destek olan öğrencilerin alanı.</p>
        </div>
        <div class="login-note">${icon("book", 18)}<span>Yalnızca önceden sisteme kaydedilmiş öğrenci hesapları giriş yapabilir.</span></div>
      </section>
      <section class="login-card" aria-labelledby="login-title">
        <div class="login-card-icon">${icon("shield", 20)}</div>
        <p class="eyebrow">Öğrenci girişi</p>
        <h2 id="login-title">Seni tanıyalım</h2>
        <p class="login-card-copy">Kayıtlı adın ve okul numaranla devam et.</p>
        <form class="login-form" id="login-form">
          <label for="student-name">Ad soyad</label>
          <input id="student-name" name="name" autocomplete="name" placeholder="Örn. Ad Soyad" maxlength="191" required>
          <p class="field-hint" id="name-hint">Adlar büyük harfle başlamalı, küçük harflerle devam etmelidir.</p>
          <label for="school-number">Okul numarası</label>
          <input id="school-number" name="schoolNumber" inputmode="numeric" autocomplete="off" placeholder="Okul numaran" maxlength="8" required>
          <p class="form-message" id="login-error" role="alert" hidden></p>
          <button class="button-primary login-submit" id="login-button" type="submit" disabled>Giriş yap${icon("arrow", 17)}</button>
        </form>
        <p class="privacy-note">Hesap bulunamadıysa yalnızca kayıtlı öğrenciler giriş yapabilir.</p>
      </section>
    </main>`;

  if (message) setMessage(root.querySelector("#login-error"), message);
}

function navLink(href, label, iconName, active, mobile = false) {
  const activeClass = active ? "is-active" : "";
  const className = mobile ? "mobile-nav-link" : "nav-link";
  const current = active ? 'aria-current="page"' : "";
  return `<a href="${href}" data-route class="${className} ${activeClass}" ${current}>${icon(iconName, mobile ? 16 : 18)}${label}</a>`;
}

function renderShell(active, content) {
  const displayName = currentStudent?.displayName || "Öğrenci";
  const firstName = displayName.trim().split(/\s+/)[0] || "Ö";
  const topTitle = active === "feed" ? "Soru akışı" : "Kaydettiklerim";

  root.innerHTML = `
    <div class="site-frame">
      <aside class="left-rail">
        <a href="#/" data-route class="brand-lockup brand-link">${brandMark()}<div><span class="brand-name">Öğrenciye Öğrence</span><span class="brand-school">Antalya Anadolu Lisesi</span></div></a>
        <nav class="main-nav" aria-label="Ana gezinme">
          <span class="nav-section-label">DAYANIŞMA ALANI</span>
          ${navLink("#/", "Soru akışı", "message", active === "feed")}
          ${navLink("#/saved", "Kaydettiklerim", "bookmark", active === "saved")}
        </nav>
        <div class="rail-note"><span class="rail-note-mark">“</span><p>Bir soruyu sormak, çözümün ilk adımı.</p><span class="rail-note-caption">ÖĞRENCİDEN ÖĞRENCİYE</span></div>
        <button class="logout-button" type="button" data-action="logout">${icon("logout", 16)}Çıkış yap</button>
      </aside>
      <div class="main-column">
        <header class="topbar">
          <div class="mobile-brand">${brandMark()}<span>Öğrenciye Öğrence</span></div>
          <div class="topbar-title">${topTitle}</div>
          <div class="student-chip"><span class="student-avatar">${escapeHTML(firstName.slice(0, 1).toLocaleUpperCase("tr-TR"))}</span><span class="student-chip-name">${escapeHTML(displayName)}</span></div>
          <button class="mobile-logout" type="button" data-action="logout" aria-label="Çıkış yap">${icon("logout", 16)}<span>Çıkış</span></button>
        </header>
        <nav class="mobile-nav" aria-label="Mobil gezinme">
          ${navLink("#/", "Soru akışı", "message", active === "feed", true)}
          ${navLink("#/saved", "Kaydettiklerim", "bookmark", active === "saved", true)}
        </nav>
        <main class="feed-main" id="page-content">${content}</main>
      </div>
      <aside class="right-rail">
        <div class="guideline-card">
          <div class="guideline-icon">${icon("shield", 18)}</div>
          <p class="guideline-kicker">Küçük bir hatırlatma</p>
          <h2>Burada birbirimize alan açıyoruz.</h2>
          <p>Sorunu anlat, bildiğini paylaş. Gönderi ve yorumlarda okul ya da öğretmen adı kullanılamaz.</p>
          <div class="guideline-rule"><span></span>Saygı · Merak · Dayanışma</div>
        </div>
        ${modeNote()}<p class="right-rail-footer">Öğrenciden öğrenciye,<br>birlikte öğrenmeye.</p>
      </aside>
    </div>`;
}

function renderComposer() {
  return `
    <section class="composer-card" aria-labelledby="composer-title">
      <div class="composer-heading"><span class="composer-avatar">${escapeHTML((currentStudent?.displayName || "?").slice(0, 1))}</span><div><h2 id="composer-title">Aklında ne var?</h2><p>Bir soru sor, birlikte düşünelim.</p></div></div>
      <form id="question-form">
        <label class="sr-only" for="question-text">Sorunu yaz</label>
        <textarea id="question-text" maxlength="2000" placeholder="Takıldığın yeri kendi cümlelerinle anlat…" rows="4" required></textarea>
        <div class="image-preview" id="image-preview" hidden><img id="image-preview-img" alt="Gönderi fotoğrafı önizlemesi"><button type="button" data-action="remove-image" aria-label="Fotoğrafı kaldır">${icon("close", 16)}</button></div>
        <p class="form-message" id="question-error" role="alert" hidden></p>
        <div class="composer-footer">
          <div class="composer-tools">
            <label class="attach-button">${icon("image", 17)}<span>Fotoğraf ekle</span><input id="question-image" type="file" accept="image/jpeg,image/png,image/webp"></label>
            <span class="photo-limit">${icon("paperclip", 13)}En fazla 5 MB</span>
          </div>
          <div class="composer-submit-group"><span class="character-count" id="question-count">0/2000</span><button class="button-primary" id="question-submit" type="submit" disabled>Soruyu paylaş${icon("send", 15)}</button></div>
        </div>
      </form>
    </section>`;
}

function emptyState(title, description, iconName = "message") {
  return `<div class="empty-state"><span class="empty-icon">${icon(iconName, 22)}</span><h3>${escapeHTML(title)}</h3><p>${escapeHTML(description)}</p></div>`;
}

function renderFeedFrame() {
  renderShell("feed", `
    <div class="page-intro"><div><span class="eyebrow">${icon("compass", 14)}ÖĞRENCİDEN ÖĞRENCİYE</span><h1>Bugün neyi<br class="mobile-break"> birlikte çözelim?</h1><p>Bir soru bazen herkese yeni bir şey öğretir.</p></div><span class="page-intro-icon">${icon("message", 24)}</span></div>
    ${renderComposer()}
    <section class="feed-section" aria-labelledby="feed-heading">
      <div class="feed-section-heading"><div><span class="section-overline">DAYANIŞMA PANOSU</span><h2 id="feed-heading">Son sorular</h2></div><span class="live-label"><span></span>Güncel akış</span></div>
      <div class="post-list" id="post-list"><div class="empty-state"><span class="loading-dot"></span><h3>Sorular yükleniyor…</h3></div></div>
    </section>`);
}

function renderSavedFrame() {
  renderShell("saved", `
    <div class="page-intro saved-intro"><div><span class="eyebrow">${icon("bookmark", 14)}SANA AYRILAN KÖŞE</span><h1>Sonra dönmek<br class="mobile-break"> istediklerin.</h1><p>Kaydettiğin sorular burada bir arada.</p></div><span class="page-intro-icon">${icon("sparkle", 23)}</span></div>
    <section class="feed-section" aria-labelledby="saved-heading">
      <div class="feed-section-heading"><div><span class="section-overline">KİŞİSEL LİSTEN</span><h2 id="saved-heading">Kaydedilen sorular</h2></div></div>
      <div class="post-list" id="post-list"><div class="empty-state"><span class="loading-dot"></span><h3>Kaydedilenler yükleniyor…</h3></div></div>
    </section>`);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function initials(name) {
  return String(name || "Öğrenci").trim().split(/\s+/).slice(0, 2).map(part => part.slice(0, 1).toLocaleUpperCase("tr-TR")).join("");
}

function renderPost(post) {
  const postId = String(post.id ?? "");
  if (!POST_ID_PATTERN.test(postId)) return "";
  const author = escapeHTML(post.authorName || "Öğrenci");
  const body = escapeHTML(post.body || "");
  const date = escapeHTML(formatDate(post.createdAt));
  const imageUrl = typeof post.imageUrl === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(post.imageUrl) ? escapeHTML(post.imageUrl) : "";
  const saved = Boolean(post.savedByMe);

  return `
    <article class="post-card" data-post-id="${postId}">
      <header class="post-header"><span class="post-avatar">${escapeHTML(initials(post.authorName).slice(0, 1))}</span><div class="post-author"><strong>${author}</strong><time>${date}</time></div><span class="post-tag">Soru</span></header>
      <p class="post-body">${body}</p>
      ${imageUrl ? `<img class="post-image" src="${imageUrl}" alt="Öğrencinin sorusuna eklediği fotoğraf" loading="lazy">` : ""}
      <footer class="post-actions">
        <button class="post-action" type="button" data-action="toggle-comments" aria-expanded="false" aria-controls="comments-${postId}">${icon("message", 17)}Yorum yaz</button>
        <button class="post-action save-action ${saved ? "action-selected" : ""}" type="button" data-action="toggle-save" aria-pressed="${saved}">${icon("bookmark", 17)}${saved ? "Kaydedildi" : "Kaydet"}</button>
      </footer>
      <section class="comments-panel" id="comments-${postId}" data-comments-panel hidden aria-label="Yorumlar">
        <div class="comments-heading">Birlikte düşünelim <span data-comment-count>0</span></div>
        <div class="comment-list" data-comment-list></div>
        <form class="comment-form" data-comment-form data-post-id="${postId}"><label class="sr-only" for="comment-${postId}">Yorum yaz</label><input id="comment-${postId}" name="body" maxlength="1200" placeholder="Yardımcı bir yorum yaz…" required><button type="submit" aria-label="Yorumu gönder" disabled>${icon("send", 16)}</button></form>
        <p class="form-message" data-comment-error role="alert" hidden></p>
      </section>
    </article>`;
}

async function fillPostList(sequence, savedOnly) {
  try {
    let posts = attachSavedState(await store.listPosts(), currentStudent.id);
    if (savedOnly) posts = posts.filter(post => post.savedByMe);
    if (sequence !== renderSequence) return;
    const list = root.querySelector("#post-list");
    if (!list) return;

    if (!Array.isArray(posts) || posts.length === 0) {
      if (savedOnly) {
        list.innerHTML = emptyState("Henüz kaydettiğin soru yok", "Akışta sana yararlı gelen bir soruda ‘Kaydet’e dokun; buradan tekrar bulabilirsin.", "bookmark");
      } else {
        list.innerHTML = emptyState("Panoda henüz soru yok", "İlk soruyu sen paylaş; birlikte öğrenmeye başlayalım.", "message");
      }
    } else {
      list.innerHTML = posts.map(renderPost).join("");
    }
  } catch (error) {
    if (sequence !== renderSequence) return;
    const list = root.querySelector("#post-list");
    if (list) list.innerHTML = `<div class="empty-state"><h3>Akışa şu an ulaşılamadı</h3><p>${escapeHTML(error.message || "Bir hata oluştu.")}</p></div>`;
  }
}

async function renderCurrentPage() {
  const sequence = ++renderSequence;
  if (!sessionChecked) {
    currentStudent = loadSession();
    sessionChecked = true;
  }

  if (!currentStudent) {
    clearSelectedImage();
    renderLogin();
  } else if (getRoute() === "saved") {
    clearSelectedImage();
    renderSavedFrame();
    await fillPostList(sequence, true);
  } else {
    renderFeedFrame();
    await fillPostList(sequence, false);
  }
}

function notify(message, isError = false) {
  root.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = `toast${isError ? " toast-error" : ""}`;
  toast.setAttribute("role", isError ? "alert" : "status");
  toast.textContent = message;
  root.append(toast);
  window.setTimeout(() => toast.remove(), 3500);
}

function updateQuestionControls() {
  const textarea = root.querySelector("#question-text");
  const counter = root.querySelector("#question-count");
  const button = root.querySelector("#question-submit");
  if (!textarea || !counter || !button) return;
  counter.textContent = `${textarea.value.length}/2000`;
  button.disabled = textarea.value.trim().length < 3;
}

function clearSelectedImage() {
  selectedImage = null;
  if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  imagePreviewUrl = "";
  const preview = root.querySelector("#image-preview");
  const input = root.querySelector("#question-image");
  if (preview) preview.hidden = true;
  if (input) input.value = "";
}

function showQuestionError(message) {
  setMessage(root.querySelector("#question-error"), message);
}

function renderComment(comment) {
  const author = escapeHTML(comment.authorName || "Öğrenci");
  return `<div class="comment-row"><span class="comment-avatar">${escapeHTML(initials(comment.authorName).slice(0, 1))}</span><div><strong>${author}</strong><p>${escapeHTML(comment.body || "")}</p><time>${escapeHTML(formatDate(comment.createdAt))}</time></div></div>`;
}

async function loadComments(article) {
  const panel = article.querySelector("[data-comments-panel]");
  const list = article.querySelector("[data-comment-list]");
  const count = article.querySelector("[data-comment-count]");
  const postId = String(article.dataset.postId || "");
  if (!panel || !list || !POST_ID_PATTERN.test(postId)) return;

  list.innerHTML = '<p class="comments-muted">Yorumlar yükleniyor…</p>';
  try {
    const comments = await store.listComments(postId);
    if (!article.isConnected) return;
    const rows = Array.isArray(comments) ? comments : [];
    if (count) count.textContent = String(rows.length);
    if (rows.length === 0) {
      list.innerHTML = '<p class="comments-muted">İlk yanıtı sen yaz.</p>';
    } else {
      list.innerHTML = rows.map(renderComment).join("");
    }
  } catch (error) {
    if (!article.isConnected) return;
    list.innerHTML = "";
    setMessage(article.querySelector("[data-comment-error]"), error.message || "Yorumlar yüklenemedi.");
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const nameInput = root.querySelector("#student-name");
  const numberInput = root.querySelector("#school-number");
  const error = root.querySelector("#login-error");
  const button = root.querySelector("#login-button");
  const name = nameInput?.value.trim() || "";
  const schoolNumber = numberInput?.value.trim() || "";

  if (!isNameFormatValid(name)) {
    setMessage(error, "Adınızı her kelimenin ilk harfi büyük, devamı küçük olacak şekilde yazın.");
    nameInput?.focus();
    return;
  } else if (!/^\d{1,8}$/.test(schoolNumber)) {
    setMessage(error, "Okul numarası yalnızca rakamlardan oluşmalı.");
    numberInput?.focus();
    return;
  }

  setMessage(error, "");
  if (button) {
    button.disabled = true;
    button.innerHTML = `Kontrol ediliyor…${icon("arrow", 17)}`;
  }

  try {
    currentStudent = loginStudent(name, schoolNumber);
    sessionChecked = true;
    await renderCurrentPage();
    notify("Giriş başarılı. Birlikte öğrenmeye devam edebilirsin.");
  } catch (loginError) {
    setMessage(root.querySelector("#login-error"), loginError.message || "Giriş yapılamadı.");
    if (button?.isConnected) {
      button.disabled = false;
      button.innerHTML = `Giriş yap${icon("arrow", 17)}`;
    }
  }
}

async function handleQuestionSubmit(event) {
  event.preventDefault();
  const textarea = root.querySelector("#question-text");
  const button = root.querySelector("#question-submit");
  const body = textarea?.value.trim() || "";

  if (body.length < 3) {
    showQuestionError("Sorunuzu birkaç kelimeyle anlatın.");
    return;
  } else if (body.length > 2000) {
    showQuestionError("Soru en fazla 2000 karakter olabilir.");
    return;
  }

  showQuestionError("");
  if (button) {
    button.disabled = true;
    button.textContent = "Paylaşılıyor…";
  }

  try {
    if (hasForbiddenPostText(body)) throw new Error(MODERATION_MESSAGE);
    const imageUrl = selectedImage ? await compressImage(selectedImage) : null;
    await store.createPost({ authorId: currentStudent.id, authorName: currentStudent.displayName, body, imageUrl });
    clearSelectedImage();
    await renderCurrentPage();
    notify("Sorun akışta. Birlikte çözebilirsiniz.");
  } catch (error) {
    showQuestionError(error.message || "Gönderi oluşturulamadı.");
    if (button?.isConnected) {
      button.disabled = body.length < 3;
      button.innerHTML = `Soruyu paylaş${icon("send", 15)}`;
    }
  }
}

async function handleCommentSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const article = form.closest(".post-card");
  const input = form.querySelector("input[name='body']");
  const button = form.querySelector("button[type='submit']");
  const message = article?.querySelector("[data-comment-error]");
  const body = input?.value.trim() || "";
  const postId = String(form.dataset.postId || "");

  if (!body) {
    setMessage(message, "Yorumunuzu yazın.");
    return;
  } else if (!POST_ID_PATTERN.test(postId)) {
    setMessage(message, "Bu gönderi artık bulunamıyor.");
    return;
  }

  setMessage(message, "");
  if (button) button.disabled = true;
  try {
    if (hasForbiddenPostText(body)) throw new Error(MODERATION_MESSAGE);
    if (!(await store.postExists(postId))) throw new Error("Bu gönderi artık bulunamıyor.");
    await store.addComment(postId, { authorId: currentStudent.id, authorName: currentStudent.displayName, body });
    if (input) input.value = "";
    await loadComments(article);
  } catch (error) {
    setMessage(message, error.message || "Yorum gönderilemedi.");
  } finally {
    if (button?.isConnected) button.disabled = !input?.value.trim();
  }
}

async function handleLogout(button) {
  button.disabled = true;
  try {
    logoutStudent();
    currentStudent = null;
    sessionChecked = true;
    if (window.location.hash) window.history.replaceState({}, "", window.location.pathname + window.location.search);
    renderLogin();
    notify("Oturum kapatıldı.");
  } catch (error) {
    button.disabled = false;
    notify(error.message || "Çıkış yapılamadı.", true);
  }
}

async function handleSave(button) {
  const article = button.closest(".post-card");
  const postId = String(article?.dataset.postId || "");
  if (!article || !POST_ID_PATTERN.test(postId)) return;

  button.disabled = true;
  try {
    const result = toggleSaved(currentStudent.id, postId);
    if (result?.saved) {
      button.classList.add("action-selected");
      button.setAttribute("aria-pressed", "true");
      button.innerHTML = `${icon("bookmark", 17)}Kaydedildi`;
      notify("Soru kaydedildi.");
    } else {
      if (getRoute() === "saved") {
        article.remove();
        const list = root.querySelector("#post-list");
        if (list && !list.querySelector(".post-card")) {
          list.innerHTML = emptyState("Henüz kaydettiğin soru yok", "Akışta sana yararlı gelen bir soruda ‘Kaydet’e dokun; buradan tekrar bulabilirsin.", "bookmark");
        }
      } else {
        button.classList.remove("action-selected");
        button.setAttribute("aria-pressed", "false");
        button.innerHTML = `${icon("bookmark", 17)}Kaydet`;
      }
      notify("Soru kaydedilenlerden çıkarıldı.");
    }
  } catch (error) {
    notify(error.message || "Kaydetme işlemi yapılamadı.", true);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

root.addEventListener("input", event => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

  if (target.id === "student-name") {
    const hint = root.querySelector("#name-hint");
    if (target.value.trim() && !isNameFormatValid(target.value)) {
      hint?.classList.add("field-hint-warning");
    } else {
      hint?.classList.remove("field-hint-warning");
    }
    const button = root.querySelector("#login-button");
    const number = root.querySelector("#school-number");
    if (button) button.disabled = !target.value.trim() || !number?.value.trim();
  } else if (target.id === "school-number") {
    const digits = target.value.replace(/\D/g, "").slice(0, 8);
    if (target.value !== digits) target.value = digits;
    const name = root.querySelector("#student-name");
    const button = root.querySelector("#login-button");
    if (button) button.disabled = !name?.value.trim() || !digits;
  } else if (target.id === "question-text") {
    updateQuestionControls();
    showQuestionError("");
  } else if (target.matches(".comment-form input")) {
    const button = target.closest(".comment-form")?.querySelector("button[type='submit']");
    if (button) button.disabled = !target.value.trim();
  }
});

root.addEventListener("change", event => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.id !== "question-image") return;

  const file = target.files?.[0];
  if (!file) return;
  if (!IMAGE_TYPES.includes(file.type)) {
    clearSelectedImage();
    showQuestionError("JPEG, PNG veya WebP biçiminde bir fotoğraf seçin.");
    return;
  } else if (file.size > MAX_IMAGE_BYTES) {
    clearSelectedImage();
    showQuestionError("Fotoğraf en fazla 5 MB olabilir.");
    return;
  }

  showQuestionError("");
  selectedImage = file;
  if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  imagePreviewUrl = URL.createObjectURL(file);
  const preview = root.querySelector("#image-preview");
  const image = root.querySelector("#image-preview-img");
  if (image) image.src = imagePreviewUrl;
  if (preview) preview.hidden = false;
});

root.addEventListener("submit", event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === "login-form") {
    void handleLogin(event);
  } else if (form.id === "question-form") {
    void handleQuestionSubmit(event);
  } else if (form.matches("[data-comment-form]")) {
    void handleCommentSubmit(event);
  }
});

root.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const button = target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;

  if (action === "logout") {
    void handleLogout(button);
  } else if (action === "remove-image") {
    clearSelectedImage();
    showQuestionError("");
  } else if (action === "toggle-save") {
    void handleSave(button);
  } else if (action === "toggle-comments") {
    const article = button.closest(".post-card");
    const panel = article?.querySelector("[data-comments-panel]");
    if (!panel) return;
    if (panel.hidden) {
      panel.hidden = false;
      button.setAttribute("aria-expanded", "true");
      button.classList.add("action-selected");
      button.innerHTML = `${icon("message", 17)}Yorumları kapat`;
      void loadComments(article);
    } else {
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
      button.classList.remove("action-selected");
      button.innerHTML = `${icon("message", 17)}Yorum yaz`;
    }
  }
});

window.addEventListener("hashchange", () => {
  void renderCurrentPage();
});

(async () => {
  renderLoading();
  try {
    ({ REGISTERED_STUDENTS } = await import(`./students.js?v=${Date.now()}`));
  } catch {
    renderLogin("Öğrenci listesi yüklenemedi. Sayfayı yenileyip yeniden deneyin.");
    return;
  }
  store = await createStore(FIREBASE_CONFIG);
  await renderCurrentPage();
})();
