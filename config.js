// ─────────────────────────────────────────────────────────────
//  VERİ DEPOLAMA AYARI
//
//  GitHub Pages yalnızca statik dosya sunar; öğrencilerin birbirinin gönderilerini
//  görebilmesi için ücretsiz bir bulut veritabanı (Firebase Firestore) gerekir.
//
//  • FIREBASE_CONFIG = null  →  "Yerel mod": gönderiler sadece o tarayıcıda saklanır
//                               (deneme/tanıtım için; öğrenciler birbirini GÖRMEZ).
//  • FIREBASE_CONFIG = {...} →  "Paylaşımlı mod": herkes aynı akışı görür.
//
//  Kurulum adımları README.md içinde anlatılıyor.
// ─────────────────────────────────────────────────────────────
export const FIREBASE_CONFIG = null;

/* Örnek (Firebase konsolundan kopyaladığın değerlerle değiştir):
export const FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "proje-adin.firebaseapp.com",
  projectId: "proje-adin",
  appId: "1:123456:web:abcdef",
};
*/
