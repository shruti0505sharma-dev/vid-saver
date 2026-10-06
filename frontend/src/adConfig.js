// ───────────────────────────────────────────────────────────────
//  AD SETTINGS - yahin se saare ads control hote hain.
//
//  Ad network (Adsterra / Monetag / PropellerAds etc.) se jo "banner code"
//  (HTML/<script> snippet) mile, use neeche `code: \`...\`` ke andar paste karo.
//  `code` khali ho to "Ad space" ka dashed dabba dikhta hai (jagah reserve).
//  Code paste karte hi us dabbe ki jagah asli ad aa jata hai.
//
//  Har slot ke liye `mobile` bhi de sakte ho (chhoti screen ke liye alag size/code).
// ───────────────────────────────────────────────────────────────
export const ADS = {
  enabled: true,

  // true  = jin slots mein code nahi hai wahan bhi "Ad space" ka dabba dikhao
  // false = khali slots poori tarah chhupa do (site live karte waqt ad code
  //         na ho to isse false kar dena)
  showPlaceholders: true,

  // Download dabane par popup ad kitne second dikhe
  preDownloadSeconds: 5,
  // HD quality chunne par (ya "Best" par) popup ad kitne second dikhe
  hdSeconds: 10,
  // Is height (p) ya usse upar ko HD mana jayega. "Best" bhi HD gina jata hai.
  hdMinHeight: 720,

  // 1080p se UPAR ki quality (1440p, 2160p/4K) ke liye alag, lamba "unlock" ad.
  // Is height se upar wali quality premium gini jati hai.
  premiumMinHeight: 1080,
  premiumSeconds: 15,

  // "Download thumbnail" dabane par ek ad, itne second ka
  thumbnailSeconds: 8,

  slots: {
    // Hero ke neeche banner
    top: {
      width: 728, height: 90, code: '',
      mobile: { width: 320, height: 50, code: '' },
    },
    // Steps ke upar banner
    middle: {
      width: 728, height: 90, code: '',
      mobile: { width: 300, height: 250, code: '' },
    },
    // FAQ ke neeche banner
    bottom: {
      width: 728, height: 90, code: '',
      mobile: { width: 320, height: 50, code: '' },
    },
    // Download shuru hone se pehle wale popup ke andar
    interstitial: { width: 300, height: 250, code: '' },
    // Download chalte waqt progress bar ke neeche
    progress: { width: 300, height: 250, code: '' },
  },
}
