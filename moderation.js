// Öğretmen adları, kullanıcının yüklediği sınıf programındaki öğretmen sütunlarından çıkarılmıştır.
const FORBIDDEN_TEACHER_NAMES = [
  "ADEM GARİPOĞLU",
  "ADEM SAYKAL",
  "ALİ CANER",
  "AYLİN BİLİCİ",
  "AYSUN CELBİŞ",
  "AYŞE ESEN",
  "AZİM GÜMÜŞ",
  "BEKİR GEREDE",
  "BİLGE KAAN KARAKUŞ",
  "BİRCAN KILIÇER",
  "CANAN ÖZDEN",
  "DENİZ AYNALI",
  "ERCÜMENT BAYKAL",
  "ERGÜN KARAKAYA",
  "ERTAN ERBEK",
  "ESER ÇELİK",
  "ESİN ERDEN",
  "FATMA BOĞAZ",
  "FATOŞ YÜCEDAĞ CİVELEK",
  "GÜL AYDOĞDU",
  "GÜLPERİ ÇİMEN ÖZCAN",
  "HAKAN ÖNAY",
  "HATİCE SELEN",
  "HULUSİ KEÇECİ",
  "IŞIN DEMET GÖZNELI",
  "KADRİYE TOK",
  "KERİM UYSAL",
  "MEHMET ADIGÜZEL",
  "MEHMET ALİ GÜREL",
  "MEHMET EMİN KARA",
  "MELDA ALTUN",
  "MESUT COPKUR",
  "MURAT HOŞ",
  "MUSTAFA AY",
  "MUSTAFA AYDIN",
  "MUSTAFA SUNA",
  "NİLAY NALBANTOĞLU MOLA",
  "OLCAY GÜMÜŞ",
  "ORHAN ABAY",
  "PELİN KOÇKAR",
  "SERKAN KAYA",
  "SERKAN ÖZDEMİR",
  "SEVCAN PATAT",
  "SUNA KAYA",
  "YUNUS GÜNAY",
  "ÖZLEM KÜÇÜKHAZAR",
  "ŞÜKRÜ KILIÇ"
];

const FORBIDDEN_SCHOOL_PHRASES = ["Antalya Anadolu Lisesi", "Antalya Anadolu"];

export function normalizeModerationText(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const FORBIDDEN_PHRASES = [...FORBIDDEN_SCHOOL_PHRASES, ...FORBIDDEN_TEACHER_NAMES]
  .map(normalizeModerationText)
  .filter(Boolean);

export function hasForbiddenPostText(value) {
  const normalized = ` ${normalizeModerationText(value)} `;
  return FORBIDDEN_PHRASES.some(phrase => normalized.includes(` ${phrase} `));
}
