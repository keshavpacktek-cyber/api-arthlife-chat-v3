// /api/arthlife-chat-v3.js
// Arthlife — Smart Brand Chat (v3 + GPT)
// Features: brand guard, Shopify product fetch + fuzzy, intents, language auto-reply (hi/en/hinglish), GPT summaries

// ---- Optional GPT (OpenAI) ----
let openai = null;
try {
  // Use the official OpenAI client if available in your environment
  const OpenAI = (await import("openai")).default;
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_1 });
} catch (e) {
  // no-op (will gracefully work without GPT)
}

const VERSION = "arthlife-chat:v3-gpt";

// ===== Utilities =====
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Very light language detector: hi (Devanagari), hinglish (roman Hindi cues), else en */
function detectLang(text, lastLang = "en") {
  const t = (text || "").trim();

  // If contains Devanagari (Hindi) codepoints
  if (/[ऀ-ॿ]/.test(t)) return "hi";

  // Hinglish cues
  const hinglishWords = [
    "kya", "kaise", "krna", "karna", "kaam", "hain", "hai", "kese", "kaha", "kidhar",
    "mujhe", "mere", "aap", "krdo", "kr dijiye", "krna hai", "hoga", "chahiye", "matlab",
    "aur", "kyunki", "kyu", "kyon", "batao", "please", "plz", "krke"
  ];
  const lower = t.toLowerCase();
  const hinglishHits = hinglishWords.some(w => lower.includes(w));
  if (hinglishHits) return "hi-Latn"; // Roman Hindi (Hinglish)

  // fallback to previously used language if the message is too short
  if (t.length <= 2) return lastLang || "en";
  return "en";
}

/** Neat currency formatter (INR focus) */
function formatPrice({ amount, currencyCode }) {
  if (!amount) return "";
  const n = Number(amount);
  if (Number.isNaN(n)) return `${amount} ${currencyCode || ""}`.trim();
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currencyCode || "INR",
      maximumFractionDigits: 0,
    }).format(n);
  } catch (e) {
    return `${amount} ${currencyCode || ""}`.trim();
  }
}

/** Build a simple, steady brand voice based on lang */
function brandVoice(lang) {
  if (lang === "hi") {
    return {
      hello: "नमस्ते 🌿",
      contact: "कृपया हमें info@arthlife.in पर Order ID, समस्या का विवरण और फोटो/वीडियो भेजें। हम पॉलिसी के अनुसार रिक्वेस्ट प्रोसेस करेंगे।",
      arOnly: "यह चैट केवल Arthlife के products व orders के लिए है। कृपया हमारे products, orders या delivery से जुड़े सवाल पूछें।",
      track: "🕊️ अपने order को ट्रैक करने के लिए Arthlife.in के 'Track Order' सेक्शन में जाकर Order ID या email/phone डालें। अगर Order ID नहीं है, तो हमें info@arthlife.in पर लिखें, हम मदद करेंगे।",
      replace: "🔄 Replacement/Exchange के लिए कृपया अपना Order ID और issue details (फोटो/वीडियो बेहतर) साझा करें—या **info@arthlife.in** पर mail करें (subject: Replacement/Exchange)। हम पॉलिसी अनुसार रिक्वेस्ट बनाएँगे।",
      refund: "💰 Refund के लिए कृपया अपना Order ID साझा करें। हम पॉलिसी के अनुसार पूरी गाइडेंस देंगे।",
      shipChange: "✉️ Shipping address या contact detail बदलने के लिए कृपया Order ID के साथ **info@arthlife.in** पर mail करें। अगर order dispatch नहीं हुआ है, तो हम अपडेट कर देंगे।",
      more: "क्या आप किसी ख़ास product/stone (जैसे Rose Quartz, Citrine) के बारे में पूछना चाहते हैं?",
    };
  }
  if (lang === "hi-Latn") {
    return {
      hello: "Namaste 🌿",
      contact: "Kripya hume **info@arthlife.in** par Order ID, issue details aur photo/video bhejiye. Hum policy ke hisaab se request process kar denge.",
      arOnly: "Ye chat sirf Arthlife ke products aur orders ke liye hai. Kripya products, orders ya delivery se jude prashn poochiye.",
      track: "🕊️ Apna order track karne ke liye Arthlife.in par 'Track Order' section me jaaiye aur Order ID ya email/phone daliye. Agar Order ID nahi hai, to **info@arthlife.in** par mail kar dijiye.",
      replace: "🔄 Replacement/Exchange ke liye Order ID + issue details (photo/video) share karein—ya **info@arthlife.in** par mail karein (subject: Replacement/Exchange). Hum policy ke hisaab se request bana denge.",
      refund: "💰 Refund ke liye Order ID share kariye. Hum policy ke mutabik aapko guide kar denge.",
      shipChange: "✉️ Address ya contact detail badalni ho to Order ID ke saath **info@arthlife.in** par mail karein. Agar order dispatch nahi hua hai to hum update kar denge.",
      more: "Kya aap kisi khaas product/stone (jaise Rose Quartz, Citrine) ke baare me poochna chahte hain?",
    };
  }
  return {
    hello: "Namaste 🌿",
    contact: "Please email **info@arthlife.in** with your Order ID, issue details and a photo/video. We’ll create the request as per policy.",
    arOnly: "This chat is only for Arthlife products & orders. Please ask about our products, orders or delivery.",
    track: "🕊️ To track your order, open the **Track Order** section on Arthlife.in and enter your Order ID or email/phone. If you don’t have the Order ID, please email **info@arthlife.in** and we’ll help.",
    replace: "🔄 For replacement/exchange, please share your Order ID + issue details (photo/video) — or email **info@arthlife.in** (subject: Replacement/Exchange). We’ll create the request as per policy.",
    refund: "💰 For refund, please share your Order ID. We’ll guide you as per our policy.",
    shipChange: "✉️ To change shipping address/contact, please email **info@arthlife.in** with your Order ID. If not yet dispatched, we’ll update it.",
    more: "Would you like details for a specific product/stone? (e.g., Rose Quartz, Citrine, Daily Bath Kit).",
  };
}

/** Simple intent detection */
function detectIntent(text) {
  const t = text.toLowerCase();
  if (/(track|status|where.*order)/.test(t)) return "track";
  if (/(replace|exchange)/.test(t)) return "replace";
  if (/(refund|return)/.test(t)) return "refund";
  if (/(address|shipping).*change/.test(t)) return "shipChange";
  if (/(price|cost)/.test(t)) return "price";
  if (/(detail|meaning|benefit|use|kis energy|kis ke liye)/.test(t)) return "ask_product";
  if (/(order\s*id)/.test(t)) return "order-id";
  return "product_lookup";
}

/** Filters out clearly non-brand queries */
function isBrandRelated(text) {
  const t = text.toLowerCase();
  const brandKeywords = [
    "arthlife","bracelet","gemstone","crystal","nazuri","nazar","kit","soap","bath","aura","cleanse",
    "order","replace","exchange","refund","track","delivery","dispatch","payment","cod","policy","stock"
  ];
  return brandKeywords.some(k => t.includes(k));
}

/** Shopify — fetch helper */
async function shopifyGraphQL(query, variables = {}) {
  const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;
  const SHOPIFY_STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
  const API_VER = process.env.SHOPIFY_API_VERSION || "2024-04";

  if (!SHOPIFY_DOMAIN || !SHOPIFY_STOREFRONT_TOKEN) {
    return { ok: false, error: "env_missing" };
  }

  const url = `https://${SHOPIFY_DOMAIN}/api/${API_VER}/graphql.json`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!r.ok) {
    return { ok: false, status: r.status, error: "http_error" };
  }
  const j = await r.json();
  if (j.errors) {
    return { ok: false, errors: j.errors, error: "shopify_errors" };
  }
  return { ok: true, data: j.data };
}

/** Shopify — try to find best matching product for a free-text message */
async function shopifyFindBestProduct(message) {
  const baseQuery = `
    query ProdSearch($q:String!) {
      products(first: 10, query: $q) {
        edges {
          node {
            id
            title
            handle
            description
            productType
            tags
            priceRange { minVariantPrice { amount currencyCode } }
            featuredImage { url altText }
          }
        }
      }
    }`;

  // Try a few progressively broader queries
  const qCandidates = [];

  const msg = message.trim();
  qCandidates.push(`title:'${msg}'`);
  qCandidates.push(msg); // raw
  // Pull “likely stone” words:
  const words = msg
    .toLowerCase()
    .replace(/[^a-zA-Z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const top = words.slice(0, 3).join(" ");
  if (top) qCandidates.push(`title:${top}`);

  // Unique-ify
  const uniq = [...new Set(qCandidates)];

  for (const q of uniq) {
    const r = await shopifyGraphQL(baseQuery, { q });
    if (!r.ok || !r.data) continue;
    const edges = r.data?.products?.edges || [];
    if (edges.length > 0) {
      // quick heuristic = prefer bracelets
      const byScore = edges
        .map(e => e.node)
        .map(n => {
          let score = 0;
          const L = (n.title || "").toLowerCase();
          if (L.includes("bracelet")) score += 3;
          // text overlap
          for (const w of words) if (L.includes(w)) score += 1;
          return { score, node: n };
        })
        .sort((a, b) => b.score - a.score);
      return byScore[0]?.node || edges[0].node;
    }
  }
  return null;
}

/** GPT helper (optional). Returns null if GPT not configured/available */
async function gptRewrite(product, userMessage, lang) {
  if (!openai) return null;

  const link = `https://${process.env.SHOPIFY_DOMAIN?.replace(/\/$/, "")}/products/${product.handle}`;
  const sys =
`You are Arthlife's chat assistant. Keep replies short, friendly and brand-safe.
Language rule:
- If lang = "hi", reply in Hindi (Devanagari).
- If lang = "hi-Latn", reply in Hinglish (Roman Hindi).
- Else reply in English.
Include: short 2-3 line intro, who can use it, and a "Buy/see" link.
Do not invent prices; use the provided price string.
Never discuss topics beyond Arthlife's products/orders.`

  const price = formatPrice(product.priceRange?.minVariantPrice || {});
  const priceText = price ? `— from ${price}` : "";
  const base = {
    title: product.title,
    priceText,
    description: (product.description || "").slice(0, 800),
    link
  };

  const messages = [
    { role: "system", content: sys },
    {
      role: "user",
      content:
        `User message: "${userMessage}"\n` +
        `lang: ${lang}\n\n` +
        `Product info:\n` +
        `Title: ${base.title}\n` +
        `Price: ${base.priceText}\n` +
        `Description: ${base.description}\n` +
        `Link: ${base.link}\n\n` +
        `Write a concise, warm reply in the requested language.`
    },
  ];

  try {
    const c = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      messages
    });
    return c.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    return null;
  }
}

/** Build a plain, deterministic product reply without GPT */
function plainProductReply(product, lang) {
  const voice = brandVoice(lang);
  const link = `https://${process.env.SHOPIFY_DOMAIN?.replace(/\/$/, "")}/products/${product.handle}`;
  const price = formatPrice(product.priceRange?.minVariantPrice || {});
  const priceText = price ? ` — from ${price}.` : ".";

  // Shorten description a bit
  const d = (product.description || "")
    .replace(/\n+/g, " ")
    .slice(0, 400);

  if (lang === "hi") {
    return `**${product.title}**${priceText}
${d}
खरीदें/देखें: ${link}`;
  }
  if (lang === "hi-Latn") {
    return `**${product.title}**${priceText}
${d}
Buy/see: ${link}`;
  }
  return `**${product.title}**${priceText}
${d}
Buy/see: ${link}`;
}

// ===== Main handler =====
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("X-Arth-Version", VERSION);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only", version: VERSION });
  }

  try {
    const { message = "", history = [], locale } = req.body || {};
    const raw = String(message || "").trim();
    if (!raw) return res.json({ reply: "Please type your question.", version: VERSION });

    // Language preference (sticky)
    const lastLang =
      history?.slice().reverse().find(h => h.lang)?.lang || (locale || "").toLowerCase();
    const lang = detectLang(raw, lastLang);

    const v = brandVoice(lang);
    const intent = detectIntent(raw);

    // Brand guard first
    if (!isBrandRelated(raw) && !/(price|bracelet|stone)/i.test(raw)) {
      return res.json({ reply: v.arOnly, intent: "scope", lang, version: VERSION });
    }

    // Intent flows (support)
    if (intent === "track") {
      return res.json({ reply: v.track, intent, lang, version: VERSION });
    }
    if (intent === "replace") {
      return res.json({ reply: v.replace, intent, lang, version: VERSION });
    }
    if (intent === "refund") {
      return res.json({ reply: v.refund, intent, lang, version: VERSION });
    }
    if (intent === "shipChange") {
      return res.json({ reply: v.shipChange, intent, lang, version: VERSION });
    }
    if (intent === "order-id") {
      return res.json({
        reply:
          lang === "hi"
            ? "कृपया अपना Order ID लिखें (जैसे #1234)। हम आपके order में मदद करेंगे।"
            : lang === "hi-Latn"
            ? "Kripya apna Order ID likhiye (jaise #1234). Hum aapki madad karenge."
            : "Please share your Order ID (e.g., #1234). I’ll help with your order.",
        intent,
        lang,
        version: VERSION
      });
    }

    // Product lookup (Shopify)
    let product = null;
    try {
      product = await shopifyFindBestProduct(raw);
    } catch (e) {
      // swallow; product stays null
    }

    if (product) {
      // If GPT available, use it; else use plain
      let reply = await gptRewrite(product, raw, lang);
      if (!reply) reply = plainProductReply(product, lang);
      return res.json({
        reply,
        product: {
          title: product.title,
          handle: product.handle,
          price: formatPrice(product.priceRange?.minVariantPrice || {}),
        },
        intent: intent === "price" ? "price" : "product",
        lang,
        version: VERSION
      });
    }

    // Nothing found
    const fallback =
      lang === "hi"
        ? "Exact product match नहीं मिला। किस product/stone का नाम बताएँ (e.g., Rose Quartz, Citrine, Daily Bath Kit)।"
        : lang === "hi-Latn"
        ? "Exact product match nahi mila. Product/stone ka naam batayein (e.g., Rose Quartz, Citrine, Daily Bath Kit)."
        : "I didn’t find an exact product match yet. Could you share the product name (or stone)? e.g., Rose Quartz, Citrine, Daily Bath Kit.";
    return res.json({ reply: fallback, intent: "ask_product", lang, version: VERSION });
  } catch (err) {
    return res.status(500).json({
      error: "Internal error",
      details: err?.message || String(err),
      version: VERSION,
    });
  }
}
