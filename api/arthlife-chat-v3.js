// api/arthlife-chat-v3.js
//
// Arthlife — Smart Brand Chat API (v3, r13-lang+buttons)
// Features: brand-guard, Shopify product fetch + fuzzy, intents, language auto-reply (hi/en/hinglish), quick-reply buttons.

export default async function handler(req, res) {
  // ========== CORS ==========
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only", version: "arthlife-chat:r13-lang+buttons" });
  }

  // ========== ENV check (Shopify) ==========
  const SHOPIFY_DOMAIN   = process.env.SHOPIFY_DOMAIN;
  const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
  const API_VER          = process.env.SHOPIFY_API_VERSION || "2024-04";

  if (!SHOPIFY_DOMAIN || !STOREFRONT_TOKEN) {
    return res.status(500).json({
      error: "env_missing",
      note: "Set SHOPIFY_DOMAIN and SHOPIFY_STOREFRONT_TOKEN in Vercel, then redeploy.",
      version: "arthlife-chat:r13-lang+buttons",
    });
  }

  try {
    const body = req.body || {};
    const rawMessage = String(body.message || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];
    if (!rawMessage) {
      return res.json({ reply: "🙏 Message required.", version: "arthlife-chat:r13-lang+buttons" });
    }

    // ========== Language detection (hi / en / hi-Latn) ==========
    const lastLang = pickLastUserLang(history) || "en";
    const normLang = normalizeLang(body.lang || body.locale || null);
    const lang = detectLang(rawMessage, lastLang || normLang || "en"); // stable preference

    // ========== Intent detection ==========
    const text = rawMessage.toLowerCase();
    const intent = detectIntent(text);

    // ========== Off-topic guard (still polite) ==========
    if (intent === "offtopic") {
      return res.json({
        reply: t(lang, {
          en: "This chat is only for Arthlife products & orders. Please ask about our products, orders, or delivery.",
          hi: "Yeh chat sirf Arthlife ke products aur orders ke liye hai. Kripya products, orders ya delivery se judi baat puchhiye.",
          hiLatn: "Yeh chat sirf Arthlife ke products aur orders ke liye hai. Kripya products, orders ya delivery se judi baat puchhiye.",
        }),
        buttons: defaultButtons(lang),
        version: "arthlife-chat:r13-lang+buttons",
      });
    }

    // ========== Intent routing ==========
    // 1) Track order
    if (intent === "track") {
      return res.json({
        reply: t(lang, {
          en: "To track your order, open the “Track Order” section on Arthlife.in and enter your Order ID or email/phone.",
          hi: "Apne order ko track karne ke liye Arthlife.in par 'Track Order' section me jaakar Order ID ya email/phone dijiye.",
          hiLatn: "Order track karne ke liye Arthlife.in par 'Track Order' section me jaakar Order ID ya email/phone dijiye.",
        }),
        buttons: [
          t(lang, { en: "Where is my order?", hi: "Mera order kahan hai?", hiLatn: "Mera order kahan hai?" }),
          t(lang, { en: "Change shipping address", hi: "Shipping address badalna hai", hiLatn: "Shipping address badalna hai" }),
        ],
        version: "arthlife-chat:r13-lang+buttons",
      });
    }

    // 2) Replace / exchange
    if (intent === "replace") {
      return res.json({
        reply: t(lang, {
          en: "For replacement/exchange, please email your *Order ID*, product *photos/videos* and *issue details* to *info@arthlife.in*. We’ll create the request as per our policy.",
          hi: "Replacement/Exchange ke liye kripya apna *Order ID*, product ki *photos/videos* aur *issue details* *info@arthlife.in* par email karein. Hum policy ke hisaab se request create karenge.",
          hiLatn: "Replacement/Exchange ke liye kripya apna *Order ID*, product ki *photos/videos* aur *issue details* *info@arthlife.in* par email karein. Hum policy ke hisaab se request create karenge.",
        }),
        buttons: [
          t(lang, { en: "Return & refund policy", hi: "Return & refund policy", hiLatn: "Return & refund policy" }),
          t(lang, { en: "Track my order", hi: "Order track karna hai", hiLatn: "Order track karna hai" }),
        ],
        version: "arthlife-chat:r13-lang+buttons",
      });
    }

    // 3) Refund / return
    if (intent === "refund") {
      return res.json({
        reply: t(lang, {
          en: "For refunds/returns, please email your *Order ID* with the reason and any *photos/videos* to *info@arthlife.in*. We'll guide you per policy.",
          hi: "Refund/Return ke liye kripya apna *Order ID* reason ke saath, aur *photos/videos* *info@arthlife.in* par email karein. Hum policy ke hisaab se guide karenge.",
          hiLatn: "Refund/Return ke liye kripya apna *Order ID* reason ke saath, aur *photos/videos* *info@arthlife.in* par email karein. Hum policy ke hisaab se guide karenge.",
        }),
        buttons: [
          t(lang, { en: "Return & refund policy", hi: "Return & refund policy", hiLatn: "Return & refund policy" }),
          t(lang, { en: "Need exchange instead", hi: "Exchange karna hai", hiLatn: "Exchange karna hai" }),
        ],
        version: "arthlife-chat:r13-lang+buttons",
      });
    }

    // 4) Product / price / details (fuzzy + Shopify)
    if (["product", "price"].includes(intent)) {
      const q = stripHelperWords(text); // remove words like 'price of', 'kit details', etc.
      const product = await findClosestProduct(q, { SHOPIFY_DOMAIN, STOREFRONT_TOKEN, API_VER });

      if (product) {
        const reply = productReply(lang, product, intent);
        const buttons = [
          t(lang, { en: "Need to exchange the product", hi: "Product exchange karna hai", hiLatn: "Product exchange karna hai" }),
          t(lang, { en: "Need to change the shipping address", hi: "Shipping address badalna hai", hiLatn: "Shipping address badalna hai" }),
          t(lang, { en: "Track my order", hi: "Order track karna hai", hiLatn: "Order track karna hai" }),
        ];
        return res.json({
          reply,
          product,
          buttons,
          version: "arthlife-chat:r13-lang+buttons",
        });
      } else {
        return res.json({
          reply: t(lang, {
            en: "I didn’t find an exact product match yet. Could you share the product name (or stone)? e.g., Rose Quartz, Citrine, Daily Bath Kit.",
            hi: "Exact product match nahi mila. Kripya product/stone ka naam batayein, jaise — Rose Quartz, Citrine, Daily Bath Kit.",
            hiLatn: "Exact product match nahi mila. Kripya product/stone ka naam batayein, jaise — Rose Quartz, Citrine, Daily Bath Kit.",
          }),
          buttons: [
            "Rose Quartz", "Tiger Eye", "Nazuri Nazar Kit",
          ],
          version: "arthlife-chat:r13-lang+buttons",
        });
      }
    }

    // 5) Default fallback (brand-safe)
    return res.json({
      reply: t(lang, {
        en: "I’m Arthlife Assistant — please share your Order ID or the product name so I can help quickly.",
        hi: "Main Arthlife Assistant hoon — kripya apna Order ID ya product ka naam batayein, taaki main turant sahayata kar sakoon.",
        hiLatn: "Main Arthlife Assistant hoon — kripya apna Order ID ya product ka naam batayein, taaki main turant sahayata kar sakoon.",
      }),
      buttons: defaultButtons(lang),
      version: "arthlife-chat:r13-lang+buttons",
    });
  } catch (err) {
    return res.status(500).json({
      error: "Internal error",
      details: err?.message || String(err),
      version: "arthlife-chat:r13-lang+buttons",
    });
  }
}

/* ========================= Helpers ========================= */

// Last user language from history if available
function pickLastUserLang(history) {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h && h.role === "user" && h.lang) return normalizeLang(h.lang);
  }
  return null;
}

// Normalize lang token
function normalizeLang(val) {
  if (!val) return null;
  const s = String(val).toLowerCase();
  if (s.startsWith("hi-") && s.includes("latn")) return "hiLatn";
  if (s.startsWith("hi")) return "hi";
  return s.includes("en") ? "en" : null;
}

// Basic language detection (Devanagari / Latin + Hinglish guess)
function detectLang(text, fallback = "en") {
  const hasDevanagari = /[\u0900-\u097F]/.test(text);
  if (hasDevanagari) return "hi";
  const onlyLatin = /^[\u0000-\u00ff]*$/.test(text);
  if (onlyLatin) {
    // If looks Hindi-ish but in Latin → Hinglish
    if (/(kya|hai|ka|ki|ke|mera|order|kahan|price|kitna|exchange|replace|refund|nazar|pathar|patthar)/i.test(text)) {
      return "hiLatn";
    }
    return "en";
  }
  return fallback || "en";
}

// Small translator helper
function t(lang, map) {
  if (lang === "hi") return map.hi || map.en;
  if (lang === "hiLatn") return map.hiLatn || map.hi || map.en;
  return map.en;
}

// Intent detection
function detectIntent(text) {
  // Off-topic quick block (sports etc.)
  if (/cricket|score|ipl|news|weather|share market|stock/i.test(text)) return "offtopic";

  if (/(track|status|where.*order)/i.test(text)) return "track";
  if (/(replace|exchange|badal(na)?|replacement)/i.test(text)) return "replace";
  if (/(refund|return)/i.test(text)) return "refund";
  if (/(price|kitna|cost)/i.test(text)) return "price";

  // If it mentions product-y words, treat as product
  if (/(bracelet|stone|crystal|gem|kit|bath|nazar|nazuri|ring|bead|energy|healing|pyrite|quartz|citrine|amethyst|tiger|black tourmaline|rose quartz|jade|agate)/i.test(text)) {
    return "product";
  }
  // default
  return "product"; // prefer trying to find a product instead of rejecting
}

// Suggestion buttons (chips)
function defaultButtons(lang) {
  return [
    t(lang, { en: "Track my order", hi: "Order track karna hai", hiLatn: "Order track karna hai" }),
    t(lang, { en: "Need to exchange the product", hi: "Product exchange karna hai", hiLatn: "Product exchange karna hai" }),
    t(lang, { en: "Return & refund policy", hi: "Return & refund policy", hiLatn: "Return & refund policy" }),
  ];
}

// Remove helper words before fuzzy
function stripHelperWords(s) {
  return s
    .replace(/\b(price|cost|details|detail|about|kit details|ke baare me|kya|hai|ka|ki|ke|mera|mujhe|batao|please)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Shopify GraphQL fetch
async function shopifyFetch({ SHOPIFY_DOMAIN, STOREFRONT_TOKEN, API_VER }, query, variables = {}) {
  const url = `https://${SHOPIFY_DOMAIN}/api/${API_VER}/graphql.json`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

// Fuzzy matching (simple score)
function fuzzyScore(a, b) {
  a = String(a).toLowerCase();
  b = String(b).toLowerCase();
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.92;
  // token overlap
  const as = a.split(/[^a-z0-9]+/).filter(Boolean);
  const bs = b.split(/[^a-z0-9]+/).filter(Boolean);
  const setA = new Set(as);
  const common = bs.filter(x => setA.has(x)).length;
  return common / Math.max(1, Math.max(as.length, bs.length));
}

// Pull some products and pick closest
async function findClosestProduct(userQuery, env) {
  const data = await shopifyFetch(
    env,
    `
    {
      products(first: 100) {
        edges {
          node {
            id
            title
            handle
            description
            priceRange { minVariantPrice { amount currencyCode } }
            featuredImage { url }
          }
        }
      }
    }
  `
  );

  const items = (data?.products?.edges || []).map(e => e.node);
  if (!items.length) return null;

  let best = null;
  let bestScore = 0;

  for (const p of items) {
    const candidates = [
      p.title,
      p.handle.replace(/-/g, " "),
      (p.description || "").slice(0, 200),
    ].filter(Boolean);

    const score = Math.max(...candidates.map(c => fuzzyScore(c, userQuery)));
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  // Keep a decent threshold (still permissive)
  return bestScore >= 0.35 ? best : null;
}

// Build product reply text
function productReply(lang, product, intent) {
  const price = product?.priceRange?.minVariantPrice;
  const priceLine = price ? `${price.amount} ${price.currencyCode}` : "-";

  const link = `https://arthlife.in/products/${product.handle}`;
  const titleBold = `**${product.title}** — from ${priceLine}.`;

  const shortBenefits = {
    en: "Buy/see details:",
    hi: "Buy/see details:",
    hiLatn: "Buy/see details:",
  };

  return t(lang, {
    en:
      `${titleBold}\n\n` +
      `Buy/see details: ${link}`,
    hi:
      `${titleBold}\n\n` +
      `${shortBenefits.hi} ${link}`,
    hiLatn:
      `${titleBold}\n\n` +
      `${shortBenefits.hiLatn} ${link}`,
  });
}
