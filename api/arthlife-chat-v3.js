// Arthlife — Smart Brand Chat API (v3, r13-lang)
// Features: brand-guard, Shopify product fetch + fuzzy, intents, language auto-reply (hi/en/hinglish)

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only", version: "arthlife-chat:r13-lang" });
  }

  // ENV check (Shopify)
  const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;
  const STOREFRONT = process.env.SHOPIFY_STOREFRONT_TOKEN;
  const API_VER = process.env.SHOPIFY_API_VERSION || "2024-04";
  if (!SHOPIFY_DOMAIN || !STOREFRONT) {
    return res.status(500).json({
      error: "env_missing",
      note: "Set SHOPIFY_DOMAIN and SHOPIFY_STOREFRONT_TOKEN in Vercel, then redeploy.",
      version: "arthlife-chat:r13-lang"
    });
  }

  try {
    const body = req.body || {};
    const raw = String(body.message || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];

    // ---- Language detection (hi / en / hi-Latn) ----
    const lastLang = pickLastUserLang(history);
    const hint = normLang(body.lang || body.locale || null);
    const lang = detectLang(raw, lastLang || hint || "en"); // stable preference

    // ---- Brand guard (only Arthlife topics) ----
    const lower = raw.toLowerCase();
    const brandKeys = [
      "arthlife","bracelet","gemstone","crystal","kit","nazuri","nazar","aura","cleanse","soap","bath",
      "order","delivery","replace","exchange","refund","return","payment","dispatch","tracking","track",
      "pincode","cod","awB","invoice","support","warranty","policy","size","fit","availability","stock",
      "product","price","charges","threshold"
    ];
    const related = brandKeys.some(k => lower.includes(k));
    if (!related && !looksProduct(lower)) {
      return res.json({ reply: T(lang, "scope_only"), intent: "scope", lang });
    }

    // ---- Intents (track/replace/refund/product-info/general) ----
    if (/track|where.*order|status|awb|tracking/i.test(raw)) {
      return res.json({ reply: T(lang, "track_order"), intent: "track", lang });
    }

    if (/replace|exchange/i.test(raw)) {
      return res.json({
        reply: T(lang, "replace"),
        intent: "replace",
        lang
      });
    }

    if (/refund|return/i.test(raw)) {
      return res.json({
        reply: T(lang, "refund"),
        intent: "refund",
        lang
      });
    }

    // ---- Product understanding (fuzzy on Shopify catalog) ----
    const q = extractProductQuery(raw);
    if (q) {
      const product = await findClosestProduct(q, { SHOPIFY_DOMAIN, STOREFRONT, API_VER });
      if (product) {
        const reply = formatProductReply(product, lang);
        return res.json({ reply, intent: "product", product, lang });
      }
      return res.json({ reply: T(lang, "ask_product_name"), intent: "ask_product", lang });
    }

    // ---- Fallback assistant line in same language ----
    return res.json({ reply: T(lang, "assistant_fallback"), intent: "fallback", lang });

  } catch (err) {
    return res.status(500).json({
      error: "Internal error",
      details: err.message,
      version: "arthlife-chat:r13-lang"
    });
  }
}

/* ----------------- Language utilities ------------------ */

function pickLastUserLang(history) {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h && h.role === "user" && h.meta && h.meta.lang) return normLang(h.meta.lang);
  }
  return null;
}
function normLang(x) {
  if (!x) return null;
  const s = String(x).toLowerCase();
  if (s.startsWith("hi")) return "hi";    // Hindi UI hint → Hindi
  if (s.includes("hinglish") || s.includes("hi-latn")) return "hi-Latn";
  return s.startsWith("en") ? "en" : null;
}

// Devanagari presence → Hindi; else translit tokens → Hinglish; else English
function detectLang(text, fallback = "en") {
  const t = String(text || "");
  const hasDeva = /[\u0900-\u097F]/.test(t);
  if (hasDeva) return "hi";

  // common Hinglish tokens
  const hintWords = [
    "kya","kaise","krna","karna","kripya","krpya","kripiya","please","aapka","mera","mujhe","kidhar",
    "kahan","kyun","kab","order id","replace","exchange","return","pincode","address","dispatch",
    "track","bhai","sir","madam","bhaiya","hota","hoti","hai","hain","hogya","hogaya","chahiye",
    "krdo","kar do","de do","batao","bataye","detail","sahayata","madad"
  ];
  const L = t.toLowerCase();
  let hits = 0; for (const w of hintWords) if (L.includes(w)) hits++;
  if (hits >= 2) return "hi-Latn";

  return fallback || "en";
}

/* ----------------- Replies (i18n) ------------------ */

const LEX = {
  en: {
    scope_only:
      "This chat is only for Arthlife products & orders. Please ask about our products, orders, or delivery.",
    track_order:
      "To track your order, open the **Track Order** section on Arthlife.in and enter your **Order ID** or **email/phone**.",
    replace:
      "For replacement/exchange, please share your **Order ID** + **issue details** (a photo helps). You can also email us at **info@arthlife.in** (subject: Replacement/Exchange). We’ll create the request as per policy.",
    refund:
      "For refunds/returns, share your **Order ID**. We’ll guide you as per our refund policy and create the request if eligible.",
    ask_product_name:
      "I didn’t find an exact product match yet. Could you share the product name (or stone)? e.g., Rose Quartz, Citrine, Daily Bath Kit.",
    assistant_fallback:
      "I’m Arthlife Assistant — please share your Order ID or the product name so I can help quickly."
  },
  hi: {
    scope_only:
      "Ye chat sirf Arthlife ke products aur orders ke liye hai. Kripya products, orders, ya delivery se judi baat puchhiye.",
    track_order:
      "Apna order track karne ke liye Arthlife.in par **Track Order** section kholiye aur **Order ID** ya **email/phone** daliye.",
    replace:
      "Replacement/Exchange ke liye kripya apna **Order ID** + **issue detail** share kijiye (photo ho to best). Aap hume **info@arthlife.in** par email bhi bhej sakte hain (subject: Replacement/Exchange). Hum policy ke hisaab se request bana denge.",
    refund:
      "Refund/Return ke liye apna **Order ID** share kijiye. Hum policy ke anusar guide karenge aur eligible hone par request bana denge.",
    ask_product_name:
      "Exact product match nahi mila. Kripya product/stone ka naam batayein — jaise Rose Quartz, Citrine, Daily Bath Kit.",
    assistant_fallback:
      "Main Arthlife Assistant hoon — kripya apna Order ID ya product ka naam likhiye, taaki main turant madad kar sakoon."
  },
  "hi-Latn": {
    scope_only:
      "Ye chat sirf Arthlife ke products & orders ke liye hai. Pls products, orders ya delivery se related hi poochiye.",
    track_order:
      "Order track karne ke liye Arthlife.in par **Track Order** section kholiye aur **Order ID** ya **email/phone** daliye.",
    replace:
      "Replacement/Exchange ke liye apna **Order ID** + **issue details** share karein (photo helpful). Aap **info@arthlife.in** par email bhi bhej sakte hain (subject: Replacement/Exchange). Team policy ke hisaab se request create karegi.",
    refund:
      "Refund/Return ke liye **Order ID** bhejiye. Policy ke according guide kar denge aur eligible hua to request create kar denge.",
    ask_product_name:
      "Exact product match nahi mila. Product/stone ka naam bataye (e.g., Rose Quartz, Citrine, Daily Bath Kit).",
    assistant_fallback:
      "Main Arthlife Assistant hoon — pls apna Order ID ya product ka naam likhiye, taaki main jaldi help kar sakoon."
  }
};
function T(lang, key) {
  const L = LEX[lang] || LEX.en;
  return L[key] || LEX.en[key] || "";
}

/* ----------------- Shopify product search ------------------ */

function looksProduct(s) {
  // user typed a stone/product-ish phrase?
  return /\b(rose|quartz|citrine|amethyst|agate|tiger|tourmaline|stone|bracelet|kit|bath|nazar|nazuri|crystal)\b/i.test(s);
}
function extractProductQuery(text) {
  // basic cleanup; keep top 5 words that look product-ish
  const words = String(text || "").toLowerCase().replace(/[^a-z0-9\u0900-\u097F\s-]/g, " ").split(/\s+/).filter(Boolean);
  const keep = [];
  for (const w of words) {
    if (w.length < 2) continue;
    if (/kya|kaise|replace|exchange|refund|return|price|kitne|kitna|order|track|status|pincode|address/.test(w)) continue;
    keep.push(w);
    if (keep.length >= 5) break;
  }
  return keep.length ? keep.join(" ") : null;
}

async function findClosestProduct(query, { SHOPIFY_DOMAIN, STOREFRONT, API_VER }) {
  const url = `https://${SHOPIFY_DOMAIN}/api/${API_VER}/graphql.json`;
  const q = `
    query($q:String!) {
      products(first: 10, query: $q) {
        edges {
          node {
            id handle title
            description
            priceRange { minVariantPrice { amount currencyCode } }
            featuredImage { url altText }
            onlineStoreUrl
          }
        }
      }
    }
  `;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": STOREFRONT
    },
    body: JSON.stringify({ query: q, variables: { q: query } })
  });
  const j = await r.json();
  const items = (j?.data?.products?.edges || []).map(e => e.node);
  if (!items.length) return null;

  // simple fuzzy scoring
  const score = (title) => {
    const a = title.toLowerCase();
    let s = 0;
    for (const token of query.toLowerCase().split(/\s+/)) {
      if (a.includes(token)) s += 2;
      else if (levenshtein(a, token) <= 2) s += 1;
    }
    return s;
  };
  items.sort((A, B) => score(B.title) - score(A.title));
  return items[0];
}

// tiny Levenshtein
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,      // del
        dp[i][j-1] + 1,      // ins
        dp[i-1][j-1] + cost  // sub
      );
    }
  }
  return dp[m][n];
}

function formatProductReply(p, lang) {
  const price = p?.priceRange?.minVariantPrice;
  const rupee = price?.currencyCode ? `${price.amount} ${price.currencyCode}` : `${price?.amount || ""}`;
  const url = p?.onlineStoreUrl || `https://arthlife.in/products/${p.handle}`;
  if (lang === "hi") {
    return `**${p.title}** — from ${rupee}. ${sliceDesc(p.description, 380, "hi")}
Buy/see details: ${url}`;
  }
  if (lang === "hi-Latn") {
    return `**${p.title}** — from ${rupee}. ${sliceDesc(p.description, 380, "hi-Latn")}
Buy/see details: ${url}`;
  }
  // English
  return `**${p.title}** — from ${rupee}. ${sliceDesc(p.description, 380, "en")}
Buy/see details: ${url}`;
}

function sliceDesc(d, limit, lang) {
  const text = (d || "").replace(/\s+/g, " ").trim();
  const s = text.length > limit ? text.slice(0, limit - 1) + "…" : text;
  if (lang === "hi") return s || "Is bracelet/stone ke baare me poochh sakte hain.";
  if (lang === "hi-Latn") return s || "Is bracelet/stone ke baare me poochh sakte hain.";
  return s || "You can ask anything about this bracelet/stone.";
}
