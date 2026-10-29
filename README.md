# Öğrenciye Öğrence — GitHub Pages sürümü

Saf HTML / CSS / JavaScript ile yazılmış, sunucu gerektirmeyen öğrenci soru-cevap panosu.
Tasarım, orijinal projeyle birebir aynıdır. Siteye **yalnızca `students.js` içinde adı soyadı + okul numarası yazan öğrenciler** girebilir.

## 1) GitHub Pages'e yükleme

1. GitHub'da yeni bir depo (repository) oluştur.
2. Bu klasördeki **tüm dosyaları** (`index.html`, `app.js`, `style.css`, … ve `.nojekyll`) depoya yükle.
3. Depoda **Settings → Pages → Build and deployment** bölümünde:
   - Source: **Deploy from a branch**
   - Branch: **main** / klasör: **/(root)** → Save
4. 1–2 dakika sonra site `https://KULLANICI-ADIN.github.io/DEPO-ADI/` adresinde yayında olur.

> Dosyayı çift tıklayıp açarsan (`file://`) çalışmaz; tarayıcılar yerel dosyalarda ES modüllerini engeller. Yerelde denemek için klasörde `python3 -m http.server` çalıştırıp `http://localhost:8000` adresine git.

## 2) Öğrenci ekleme / çıkarma

`students.js` dosyasını düzenle:

```js
{ id: 5, displayName: "Yeni Öğrenci", schoolNumber: "123" },
```

- Ad soyad: her kelimenin ilk harfi büyük, devamı küçük.
- `id` benzersiz olmalı; verdiğin bir id'yi sonradan değiştirme.
- Listeden silinen öğrencinin açık oturumu da bir sonraki sayfa yenilemede düşer.

## 3) Öğrencilerin birbirini görmesi (Firebase — ücretsiz)

GitHub Pages sadece statik dosya sunar, veri saklayamaz. `config.js` içinde `FIREBASE_CONFIG = null` iken site **yerel modda** çalışır: gönderiler yalnızca o tarayıcıda durur. Herkesin aynı akışı görmesi için:

1. <https://console.firebase.google.com> → **Proje ekle** (Analytics gerekmez).
2. Proje içinde **Build → Firestore Database → Create database** (production mode, bir bölge seç).
3. **Proje ayarları → Genel → Uygulamalarınız → Web (`</>`)** ile bir web uygulaması ekle; çıkan `firebaseConfig` değerlerini `config.js` içine yapıştır:
   ```js
   export const FIREBASE_CONFIG = { apiKey: "...", authDomain: "...", projectId: "...", appId: "..." };
   ```
4. Firestore → **Rules** sekmesine aşağıdaki kuralları yapıştırıp **Publish** et:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /posts/{postId} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasOnly(['authorId','authorName','body','imageUrl','createdAt'])
        && request.resource.data.body is string
        && request.resource.data.body.size() >= 3 && request.resource.data.body.size() <= 2000
        && request.resource.data.authorName is string && request.resource.data.authorName.size() <= 191
        && (request.resource.data.imageUrl == null
            || (request.resource.data.imageUrl is string && request.resource.data.imageUrl.size() < 800000));
      allow update, delete: if false;

      match /comments/{commentId} {
        allow read: if true;
        allow create: if request.resource.data.keys().hasOnly(['authorId','authorName','body','createdAt'])
          && request.resource.data.body is string
          && request.resource.data.body.size() >= 1 && request.resource.data.body.size() <= 1200
          && request.resource.data.authorName is string && request.resource.data.authorName.size() <= 191;
        allow update, delete: if false;
      }
    }
  }
}
```

Gönderiler ve yorumlar bulutta saklanır. Hatalı/uygunsuz bir gönderiyi silmek için Firebase konsolundan Firestore'daki `posts` belgesini silmen yeterli.

## Güvenlik hakkında dürüst not

GitHub Pages'te sunucu olmadığı için giriş kontrolü **tarayıcıda** yapılır. Yani:

- `students.js` herkese açık bir dosyadır; depoyu/siteyi inceleyen biri ad + numara listesini görebilir. Depoyu **private** yapmak Pages'te (ücretsiz planda) çalışmaz; hassas bilgi için uygun değildir.
- Firebase ayarları da herkese açıktır; teknik bilgisi olan biri giriş ekranını atlayıp doğrudan veritabanına yazıp okuyabilir. Yukarıdaki kurallar yalnızca boyut/biçim sınırı koyar, kimlik doğrulaması yapmaz.
- Öğretmen/okul adı filtresi de tarayıcıda çalışır; aynı şekilde atlanabilir.
- 5 hatalı girişten sonra 5 dakikalık kilit yalnızca o tarayıcıda geçerlidir.

Gerçek erişim denetimi (ör. numaraların gizli kalması, sunucuda moderasyon) istenirse bir sunucu tarafı (Firebase Auth + Cloud Functions, Supabase vb.) gerekir.

## Dosyalar

| Dosya | Görev |
|---|---|
| `index.html`, `style.css` | Sayfa ve orijinal açık-bej tasarım |
| `app.js` | Arayüz: giriş, akış, yorum, kaydetme |
| `students.js` | **Kayıtlı öğrenci listesi** |
| `config.js` | Firebase ayarı (yerel/paylaşımlı mod) |
| `store.js` | Veri katmanı + fotoğraf sıkıştırma |
| `moderation.js` | Okul/öğretmen adı filtresi |

Notlar: fotoğraflar tarayıcıda sıkıştırılıp (en fazla ~1280 px, JPEG) gönderiye gömülür. "Kaydettiklerim" öğrencinin kendi cihazında tutulur.
