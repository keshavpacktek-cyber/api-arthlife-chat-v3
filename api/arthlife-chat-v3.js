// Arthlife — Smart Brand Chat API (v3, r10)
// Live Shopify product answers + language auto-detect + brand intents

const VERSION = "arthlife-chat:r10";

// ------------- Language detect -------------
function detectLanguage(text) {
  const hasDevanagari = /[\u0900-\u097F]/.test(text);
  if (hasDevanagari) return "hi";
  const t = text.toLowerCase();
  const hinglishHints = ["kya","kaise","kis","kiska","kitna","kitne","krna","krni","kese","kaha","me","ke liye","hota","order id","replace","refund"];
  if (hinglishHints.some(w => t.includes(w))) return "hi-en";
  return "en";
}

// ------------- i18n -------------
function T(lang, key, vars = {}) {
  const L = {
    // EN
    "en:brand-only": "This chat is for Arthlife products & orders. Please ask about our products, orders or delivery.",
    "en:fallback": "I’m Arthlife Assistant — please share your Order ID or the product name so I can help quickly.",
    "en:track": "To track your order, open the “Track Order” section on Arthlife.in and enter your Order ID or email/phone.",
    "en:replace": "For replacement/exchange, please share your Order ID and the issue (photo helps). Our team will process it per policy.",
    "en:refund": "For refunds, please share your Order ID. We’ll guide you as per Arthlife’s refund policy.",
    "en:prod-header": "Here’s what I found:",
    "en:prod-line": "{title} — ₹{price}{avail}",
    "en:prod-avail": " (in stock)",
    "en:prod-oos": " (out of stock)",
    "en:prod-summary": "About this product:\n{desc}\n\nYou can view full details on Arthlife.in by searching “{title}”.",
    "en:prod-nohit": "I didn’t find an exact product match yet. Could you share the product name (or stone)? e.g., Rose Quartz, Citrine, Daily Bath Kit.",
    "en:out-of-scope": "Sorry, that’s outside Arthlife’s scope. I can help with our products, orders, delivery or policies.",

    // Hinglish
    "hi-en:brand-only": "Yeh chat Arthlife ke products & orders ke liye hai. Kripya product/order se judi query poochiye.",
    "hi-en:fallback": "Main Arthlife Assistant hoon — Order ID ya product ka naam likhiye, taaki main turant madad kar sakoon.",
    "hi-en:track": "Order track karne ke liye Arthlife.in par 'Track Order' section kholiye aur Order ID ya email/phone daliye.",
    "hi-en:replace": "Replacement/exchange ke liye Order ID aur issue (photo ho to best) share kijiye. Team policy ke hisaab se process karegi.",
    "hi-en:refund": "Refund ke liye apna Order ID share kijiye. Hum policy ke mutabik aapko guide karenge.",
    "hi-en:prod-header": "Yeh mujhe mila:",
    "hi-en:prod-line": "{title} — ₹{price}{avail}",
    "hi-en:prod-avail": " (stock mein)",
    "hi-en:prod-oos": " (out of stock)",
    "hi-en:prod-summary": "Is product ke baare mein:\n{desc}\n\nPure details ke liye Arthlife.in par “{title}” search kar sakte hain.",
    "hi-en:prod-nohit": "Abhi exact product match nahi mila. Kripya product/stone ka naam likhiye — jaise Rose Quartz, Citrine, Daily Bath Kit.",
    "hi-en:out-of-scope": "Yeh query Arthlife scope se bahar hai. Main products, orders, delivery ya policies mein madad kar sakta/ti hoon.",

    // Hindi (Devanagari)
    "hi:brand-only": "यह चैट Arthlife के उत्पादों और ऑर्डर्स के लिए है। कृपया उत्पाद/ऑर्डर से जुड़ा प्रश्न पूछें।",
    "hi:fallback": "मैं Arthlife असिस्टेंट हूँ — कृपया Order ID या प्रोडक्ट का नाम लिखें, ताकि मैं तुरंत सहायता कर सकूँ।",
    "hi:track": "ऑर्डर ट्रैक करने के लिए Arthlife.in पर ‘Track Order’ सेक्शन खोलें और Order ID या ईमेल/फ़ोन दर्ज करें।",
    "hi:replace": "रिप्लेसमेंट/एक्सचेंज के लिए Order ID और समस्या (फोटो हो तो बेहतर) साझा करें। टीम पॉलिसी अनुसार प्रोसेस करेगी।",
    "hi:refund": "रिफंड के लिए अपना Order ID साझा करें। हम पॉलिसी के अनुसार गाइड करेंगे।",
    "hi:prod-header": "यह मुझे मिला:",
    "hi:prod-line": "{title} — ₹{price}{avail}",
    "hi:prod-avail": " (स्टॉक में)",
    "hi:prod-oos": " (स्टॉक ख़त्म)",
    "hi:prod-summary": "इस प्रोडक्ट के बारे में:\n{desc}\n\nपूरा विवरण देखने के लिए Arthlife.in पर “{title}” सर्च करें।",
    "hi:prod-nohit": "अभी सटीक प्रोडक्ट नहीं मिला। कृपया प्रोडक्ट/स्टोन का नाम लिखें — जैसे Rose Quartz, Citrine, Daily Bath Kit.",
    "hi:out-of-scope": "यह प्रश्न Arthlife के दायरे से बाहर है। मैं प्रोडक्ट, ऑर्डर, डिलीवरी या पॉलिसी में सहायता कर सकता/सकती हूँ।",
  };
  const k = `${lang}:${key}`;
  let s = L[k] || L[`en:${key}`] || "";
  Object.entries(vars).forEach(([kk,v]) => s = s.replaceAll(`{${kk}}`, v));
  return s;
}

// ------------- Brand guard keywords -------------
const BRAND_WORDS = [
  "arthlife","bracelet","bangle","stone","gem","gemstone","crystal",
  "kit","bath","nazuri","nazar","utaro","aura","cleanse","soap",
  "pouch","energy","product","delivery","order","payment","replace",
  "refund","tracking","dispatch","exchange","return","customer",
  // common stones/collections
  "rose quartz","amethyst","citrine","pyrite","tiger eye","black tourmaline",
  "clear quartz","green aventurine","lapis","malachite","moonstone","agate",
  "rudraksha","nazuri kit","bath kit","bracelet collection"
];
function isBrandRelated(text) {
  const t = text.toLowerCase();
  return BRAND_WORDS.some(k => t.includes(k));
}

// ------------- Shopify Storefront -------------
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || "";
const SHOP_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN || "";

async function shopifyGraphQL(query, variables) {
  if (!SHOPIFY_DOMAIN || !SHOP_TOKEN) return null;
  const url = `https://${SHOPIFY_DOMAIN}/api/2024-04/graphql.json`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": SHOP_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });
  if (!resp.ok) return null;
  return resp.json();
}

// Search products (title/handle/description)
async function searchProducts(q) {
  const gql = `
    query($q: String!) {
      products(first: 6, query: $q) {
        edges {
          node {
            title
            handle
            availableForSale
            description
            variants(first: 3) {
              edges { node { availableForSale price { amount } } }
            }
          }
        }
      }
    }
  `;
  const json = await shopifyGraphQL(gql, { q });
  const edges = json?.data?.products?.edges || [];
  return edges.map(e => {
    const n = e.node;
    const v = n.variants?.edges?.[0]?.node;
    const price = v?.price?.amount ? Math.round(Number(v.price.amount)) : null;
    const avail = v?.availableForSale ?? n.availableForSale ?? null;
    return {
      title: n.title,
      handle: n.handle,
      description: n.description || "",
      price,
      available: !!avail
    };
  });
}

// pick best by simple keyword score
function pickBestProduct(items, userText) {
  const t = userText.toLowerCase();
  let best = null, bestScore = -1;
  for (const p of items) {
    const score =
      (p.title.toLowerCase().split(/\s+/).filter(w => t.includes(w)).length * 3) +
      (p.description.toLowerCase().split(/\s+/).filter(w => t.includes(w)).length);
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best || items[0] || null;
}

function formatProductAnswer(lang, product, alsoShowList = []) {
  const avail = product.available ? T(lang, "prod-avail") : T(lang, "prod-oos");
  const header = T(lang, "prod-header");
  let list = `• ${T(lang,"prod-line", {
    title: product.title,
    price: product.price ?? "—",
    avail
  })}`;

  // add 1–2 alternatives
  for (const p of alsoShowList.slice(0,2)) {
    const av = p.available ? T(lang,"prod-avail") : T(lang,"prod-oos");
    list += `\n• ${T(lang,"prod-line", { title: p.title, price: p.price ?? "—", avail: av })}`;
  }

  const desc = (product.description || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400); // concise snippet

  const summary = T(lang, "prod-summary", { desc, title: product.title });

  return `${header}\n${list}\n\n${summary}`;
}

// ------------- Intent detection -------------
function detectIntent(text) {
  const t = text.toLowerCase();
  if (/(track|status|where.*order)/i.test(t)) return "track";
  if (/(replace|exchange)/i.test(t)) return "replace";
  if (/(refund|return)/i.test(t)) return "refund";
  if (/(price|cost|kitna|kitne|how much|rs|₹)/i.test(t)) return "price";
  // product / use / energy / details
  if (/(product|detail|info|about|use|energy|benefit|kis|kiske|kya|stone|gem|bracelet)/i.test(t)) return "product";
  return "other";
}

// ------------- HTTP handler -------------
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Arth-Version");
  res.setHeader("X-Arth-Version", VERSION);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only", version: VERSION });

  try {
    const { message = "" } = req.body || {};
    const raw = String(message || "").trim();
    const lang = detectLanguage(raw);
    const text = raw.toLowerCase();

    // Guard totally unrelated chat (e.g., cricket) — keep brand focus
    if (!isBrandRelated(text)) {
      return res.json({ reply: T(lang, "brand-only") });
    }

    const intent = detectIntent(text);

    if (intent === "track") return res.json({ reply: T(lang, "track") });
    if (intent === "replace") return res.json({ reply: T(lang, "replace") });
    if (intent === "refund") return res.json({ reply: T(lang, "refund") });

    // Product & Price intents → live Shopify search
    if (intent === "product" || intent === "price") {
      // Build a decent query (remove noisy words)
      const q = raw.replace(/\b(price|cost|kitna|kitne|how much|rs|₹|what|kya|kis|ke|liye)\b/gi, " ").trim() || "bracelet";
      const results = await searchProducts(q);

      if (Array.isArray(results) && results.length) {
        const best = pickBestProduct(results, raw);
        const others = results.filter(p => p !== best);
        const reply = formatProductAnswer(lang, best, others);
        return res.json({ reply });
      }
      // No hit yet: politely ask for the exact name/stone
      return res.json({ reply: T(lang, "prod-nohit") });
    }

    // Other but still within brand keywords
    return res.json({ reply: T(lang, "fallback") });

  } catch (err) {
    return res.status(500).json({ error: "Internal error", details: err?.message, version: VERSION });
  }
}
