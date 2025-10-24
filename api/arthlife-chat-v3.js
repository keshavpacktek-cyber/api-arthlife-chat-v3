// Arthlife — Smart Brand + Product Chat (r12)
// Works with Shopify Storefront API + Language-aware replies

// ---- Helpers ---------------------------------------------------------------
const VERSION = "arthlife-chat:r12";

// Basic CORS so the Shopify theme can call this endpoint
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("X-Arth-Version", VERSION);
}

const HINDI_RX = /[\u0900-\u097F]/; // Devanagari range

function detectLang(text) {
  if (HINDI_RX.test(text)) return "hi"; // Hindi (Devanagari)
  // very light roman-hindi heuristic
  const t = text.toLowerCase();
  const romanHindiHits = ["hai", "krna", "karna", "krdo", "kese", "kaise", "kya", "kyu", "hoga", "bhi", "aur"].filter(w => t.includes(w)).length;
  if (romanHindiHits >= 2) return "hi-latn"; // Hinglish (Roman)
  return "en";
}

const BRAND_KEYWORDS = [
  "arthlife","bracelet","gemstone","crystal","kit","bath","nazuri","nazar",
  "shubh","arambh","aura","cleanse","soap","pouch","energy","product",
  "delivery","order","payment","replace","refund","tracking","dispatch","customer"
];

function isBrandRelated(text) {
  const lower = text.toLowerCase();
  return BRAND_KEYWORDS.some(k => lower.includes(k));
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreMatch(query, product) {
  // soft fuzzy score over title, vendor, tags and description
  const q = norm(query);
  const fields = [
    norm(product.title),
    norm(product.vendor || ""),
    norm((product.tags || []).join(" ")),
    norm(product.description || "")
  ];

  let score = 0;
  fields.forEach(f => {
    if (!f) return;
    if (f === q) score += 5;
    if (f.includes(q)) score += 3;
    // token overlap
    const qT = new Set(q.split(" "));
    let hits = 0;
    for (const w of qT) if (w.length > 2 && f.includes(w)) hits++;
    score += Math.min(hits, 4); // cap overlap
  });

  return score;
}

function pickBest(query, list) {
  let best = null, bestScore = -1;
  for (const p of list) {
    const s = scoreMatch(query, p.node || p);
    if (s > bestScore) { best = p.node || p; bestScore = s; }
  }
  return best;
}

function formatPrice(range) {
  const m = range?.minVariantPrice;
  if (!m) return "";
  return `${m.amount} ${m.currencyCode}`;
}

// ---- Shopify Storefront fetch ----------------------------------------------
async function shopifyQuery(query, variables={}) {
  const endpoint = `https://${process.env.SHOPIFY_DOMAIN}/api/2024-04/graphql.json`;
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": process.env.SHOPIFY_STOREFRONT_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });

  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

async function searchProducts(q) {
  // Use Storefront query argument for server-side searching
  const data = await shopifyQuery(`
    query($q: String!) {
      products(first: 30, query: $q) {
        edges {
          node {
            id
            title
            handle
            vendor
            tags
            description
            priceRange {
              minVariantPrice { amount currencyCode }
            }
            images(first:1){ edges{ node{ url } } }
            onlineStoreUrl
          }
        }
      }
    }
  `, { q });

  return data?.products?.edges || [];
}

// ---- Intent handlers --------------------------------------------------------
function replyByLang(lang, variants) {
  // variants: {en,hi,hiLatn}
  if (lang === "hi") return variants.hi || variants.hiLatn || variants.en;
  if (lang === "hi-latn") return variants.hiLatn || variants.hi || variants.en;
  return variants.en;
}

// ---- Main handler -----------------------------------------------------------
export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only", version: VERSION });

  try {
    const { message = "" } = req.body || {};
    const raw = String(message || "");
    const lang = detectLang(raw);
    const lower = raw.toLowerCase().trim();

    // Quick intents (track/replace/refund) – brand guard is implicit
    if (/track|where.*order|status/i.test(lower)) {
      return res.json({
        reply: replyByLang(lang, {
          en: "To track your order, open the “Track Order” section on Arthlife.in and enter your Order ID or email/phone.",
          hiLatn: "Order track karne ke liye Arthlife.in par ‘Track Order’ mein jaaiye aur apna Order ID ya email/phone dijiye.",
          hi: "अपना ऑर्डर ट्रैक करने के लिए Arthlife.in पर ‘Track Order’ सेक्शन में जाएँ और अपना Order ID या ईमेल/फ़ोन दर्ज करें।"
        }),
        version: VERSION
      });
    }

    if (/replace|exchange/i.test(lower)) {
      return res.json({
        reply: replyByLang(lang, {
          en: "For replacement/exchange, please share your Order ID + issue (a photo helps). We’ll create the request as per policy.",
          hiLatn: "Replacement/exchange ke liye Order ID + issue (photo ho to best) share karein. Policy ke hisaab se request bana denge.",
          hi: "रिप्लेसमेंट/एक्सचेंज के लिए कृपया Order ID और समस्या का विवरण (संभव हो तो फोटो) साझा करें। हम पॉलिसी के अनुसार अनुरोध बनाएँगे।"
        }),
        version: VERSION
      });
    }

    if (/refund|return/i.test(lower)) {
      return res.json({
        reply: replyByLang(lang, {
          en: "For refunds/returns, please share your Order ID. We’ll guide you as per Arthlife’s refund policy.",
          hiLatn: "Refund/return ke liye Order ID share kijiye. Hum policy ke hisaab se guide karenge.",
          hi: "रिफंड/रिटर्न के लिए कृपया Order ID साझा करें। हम पॉलिसी के अनुसार आपका मार्गदर्शन करेंगे।"
        }),
        version: VERSION
      });
    }

    // If the user talks about non-brand topics, nudge back politely
    const looksBrand = isBrandRelated(lower);
    // Try product search anyway; if nothing found and not brand, guard will respond.

    // --- Product search & fuzzy match
    const edges = await searchProducts(lower);
    let best = edges.length ? pickBest(lower, edges) : null;

    // If still no product, try extracting broad “stone”/color style queries
    if (!best) {
      const hints = lower
        .replace(/bracelet|stone|energy|healing|crystal|ring|pendant|chain|kit|set|price|cost|details|info/gi, "")
        .trim();
      if (hints && hints.length > 1) {
        const edges2 = await searchProducts(hints);
        best = edges2.length ? pickBest(lower, edges2) : null;
      }
    }

    if (best) {
      const price = formatPrice(best.priceRange);
      const img = best.images?.edges?.[0]?.node?.url || null;
      const url = best.onlineStoreUrl || `https://arthlife.in/products/${best.handle}`;

      const reply = replyByLang(lang, {
        en: `**${best.title}** — ${price ? `from ${price}. ` : ""}${best.description ? (best.description.slice(0,180) + (best.description.length>180?"…":""))+" " : ""}Buy/see details: ${url}`,
        hiLatn: `**${best.title}** — ${price ? `starting ${price}. ` : ""}${best.description ? (best.description.slice(0,180) + (best.description.length>180?"…":""))+" " : ""}Details/khareedne ke liye: ${url}`,
        hi: `**${best.title}** — ${price ? `की कीमत ${price} से शुरू। ` : ""}${best.description ? (best.description.slice(0,180) + (best.description.length>180?"…":""))+" " : ""}पूरी जानकारी/खरीदें: ${url}`
      });

      return res.json({
        reply,
        product: {
          title: best.title,
          price,
          url,
          image: img
        },
        version: VERSION
      });
    }

    // No product match
    if (!looksBrand) {
      return res.json({
        reply: replyByLang(lang, {
          en: "This chat is only for Arthlife products & orders. Please ask about our products, orders, or delivery.",
          hiLatn: "Yeh chat sirf Arthlife ke products aur orders ke liye hai. Kripya products, orders ya delivery se jude sawaal poochhen.",
          hi: "यह चैट केवल Arthlife के प्रोडक्ट्स और ऑर्डर्स के लिए है। कृपया प्रोडक्ट्स, ऑर्डर या डिलीवरी से जुड़े प्रश्न पूछें।"
        }),
        version: VERSION
      });
    }

    // Product-ish but not found → ask for name
    return res.json({
      reply: replyByLang(lang, {
        en: "I couldn’t find the exact product yet. Could you share the product name (or stone)? e.g., Rose Quartz, Citrine, Daily Bath Kit.",
        hiLatn: "Exact product nahi mila. Kya aap product ka naam (ya stone) share karenge? jaise Rose Quartz, Citrine, Daily Bath Kit.",
        hi: "अभी सटीक प्रोडक्ट नहीं मिला। कृपया प्रोडक्ट का नाम (या पत्थर) बताएं—जैसे Rose Quartz, Citrine, Daily Bath Kit।"
      }),
      version: VERSION
    });

  } catch (err) {
    return res.status(500).json({ error: "Internal error", details: err.message, version: VERSION });
  }
}
