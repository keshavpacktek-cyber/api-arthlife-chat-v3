// Arthlife — Smart Brand Chat API (v3, r13-soft)
// Features: soft brand-guard, Shopify product fetch + fuzzy, intents, language auto-reply (hi/en/hinglish),
//           replacement flow includes support email, optional GPT polish.

export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only", version: "arthlife-chat:v3-r13-soft" });

  // --- ENV: Shopify ---
  const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;
  const STOREFRONT = process.env.SHOPIFY_STOREFRONT_TOKEN;
  const API_VER = process.env.SHOPIFY_API_VERSION || "2024-04";

  if (!SHOPIFY_DOMAIN || !STOREFRONT) {
    return res.status(500).json({
      ok: false,
      reason: "env_missing",
      note: "Set SHOPIFY_DOMAIN and SHOPIFY_STOREFRONT_TOKEN in Vercel → Settings → Environment Variables, then Redeploy.",
      version: "arthlife-chat:v3-r13-soft"
    });
  }

  try {
    const { message = "", history = [] } = req.body || {};
    const raw = String(message || "").trim();
    if (!raw) return res.json({ reply: pickLang("Please type your question.", "Kripya apna prashn likhiye.", raw) });

    // --- Language detection (very light-weight) ---
    const lang = detectLang(raw, lastLangFrom(history));

    // --- Intent templates (always allowed) ---
    if (intentReplace(raw)) {
      return res.json({
        reply: pickLang(
          "For replacement/exchange, please share your Order ID and the issue (a photo helps). You can also email us at **info@arthlife.in** (subject: Replacement/Exchange). We’ll create the request as per policy.",
          "Replacement/Exchange ke liye kripya apna Order ID aur issue batayein (photo ho to aur achha). Aap **info@arthlife.in** par email bhi kar sakte hain (subject: Replacement/Exchange). Policy ke hisaab se hum request bana denge.",
          lang
        ),
        intent: "replace"
      });
    }

    if (intentTrack(raw)) {
      return res.json({
        reply: pickLang(
          "To track your order, open the **Track Order** section on Arthlife.in and enter your Order ID or email/phone.",
          "Apna order track karne ke liye Arthlife.in par **Track Order** section me jaakar Order ID ya email/phone daaliye.",
          lang
        ),
        intent: "track"
      });
    }

    if (intentAddress(raw)) {
      return res.json({
        reply: pickLang(
          "To change the shipping address, please share your Order ID and the new address (with pin code), or email **info@arthlife.in**.",
          "Shipping address badalne ke liye Order ID aur naya address (pin code ke saath) batayein, ya **info@arthlife.in** par email kar dein.",
          lang
        ),
        intent: "address"
      });
    }

    // --- Try product match FIRST (soft brand guard) ---
    const queryTerms = extractTerms(raw);
    const match = await findBestProduct(SHOPIFY_DOMAIN, STOREFRONT, API_VER, queryTerms);

    if (match) {
      // format product response
      const { title, handle, minPrice } = match;
      const url = `https://arthlife.in/products/${handle}`;
      const oneLiner = productOneLiner(title);

      const baseReplyEn =
        `**${title}** — from ₹${minPrice}.\n${oneLiner}\n` +
        `Buy/see details: ${url}`;
      const baseReplyHi =
        `**${title}** — ₹${minPrice} se.\n${oneLinerHi(title)}\n` +
        `Khareedne/jaankari ke liye: ${url}`;

      // Optional GPT polish (kept short, brand-safe)
      const reply = await polishWithGPT(
        pickLang(baseReplyEn, baseReplyHi, lang),
        lang,
        process.env.OPENAI_API_KEY
      );

      return res.json({
        reply,
        product: { title, handle, price: minPrice, url },
        intent: "product",
        lang
      });
    }

    // --- Soft brand guard: only now say scope message ---
    return res.json({
      reply: pickLang(
        "This chat is only for Arthlife products & orders. Please ask about our products, orders, or delivery.",
        "Yeh chat Arthlife ke products aur orders ke liye hai. Kripya products, orders ya delivery se jude prashn puchiye.",
        lang
      ),
      intent: "scope",
      lang
    });

  } catch (err) {
    return res.status(500).json({ error: "Internal error", details: err.message, version: "arthlife-chat:v3-r13-soft" });
  }
}

/* ---------------- Helpers ---------------- */

function lastLangFrom(history = []) {
  for (let i = history.length - 1; i >= 0; i--) {
    const t = (history[i]?.content || "");
    const l = detectLang(t);
    if (l) return l;
  }
  return "en";
}

function detectLang(text, fallback = "en") {
  const t = (text || "").toLowerCase();
  const dev = /[\u0900-\u097F]/.test(text); // Devanagari
  if (dev) return "hi";
  // naive Hinglish: roman + common hindi words
  const hinglishHints = ["kese", "kaise", "hai", "kya", "kr", "krna", "krna hai", "mein", "mera", "order id", "bhai", "pls", "plz"];
  if (hinglishHints.some(w => t.includes(w))) return "hi-Latn";
  return fallback || "en";
}

function pickLang(en, hi, lang) {
  if (lang === "hi") return hi;
  if (lang === "hi-Latn") {
    // translit-lite: keep English structure but allow Hindi words romanized
    return hi; // using the Hindi string is usually OK; Shopify fonts render fine.
  }
  return en;
}

function intentReplace(t) { return /\b(replace|exchange|badal|badli|badalna|replacement)\b/i.test(t); }
function intentTrack(t)   { return /\b(track|status|where.*order|meri order|mera order|kaha|kab aayega)\b/i.test(t); }
function intentAddress(t) { return /(address|shipping).*change|address badal|galat address/i.test(t); }

/** Expand synonyms and normalize user query into candidate terms */
function extractTerms(raw) {
  const s = raw.toLowerCase().trim();

  // hand synonyms → productish terms
  const synonyms = [
    ["nazuri", "nazar", "evil eye", "protection", "evil-eye"],
    ["rose quartz", "love stone", "pink stone"],
    ["black tourmaline", "evil eye protection", "negativity", "tourmaline"],
    ["tiger eye", "tiger's eye", "confidence", "focus"],
    ["bath kit", "daily bath kit", "cleanse", "cleaning kit"],
    ["salt lamp", "himalayan salt lamp", "salt"],
    ["bracelet", "crystal bracelet", "gemstone bracelet"],
    ["nazar kit", "nazuri kit", "nazar utaro kit"],
    ["pyrite", "money stone"],
  ];

  let terms = [s];

  // push normalized combinations
  synonyms.forEach(group => {
    if (group.some(g => s.includes(g))) terms.push(group[0]);
  });

  // remove very common words
  terms = Array.from(new Set(
    terms.map(t => t.replace(/[^a-z0-9\s\-]/g, " ").replace(/\s+/g, " ").trim())
  )).filter(Boolean);

  return terms.slice(0, 5); // cap
}

async function findBestProduct(domain, token, apiVer, terms = []) {
  const results = [];
  for (const term of terms) {
    const r = await shopifySearch(domain, token, apiVer, term);
    if (r && r.length) results.push(...r);
  }
  if (!results.length) return null;

  // simple score: prefer exact/starts-with, then include
  const scored = results.map(p => {
    const title = (p?.node?.title || "").toLowerCase();
    const handle = (p?.node?.handle || "").toLowerCase();
    let score = 0;

    for (const t of terms) {
      if (title === t || handle === t) score += 6;
      else if (title.startsWith(t) || handle.startsWith(t)) score += 4;
      else if (title.includes(t) || handle.includes(t)) score += 2;
    }
    // small preference for bracelets/kit
    if (/bracelet|kit|lamp|stone|eye/i.test(title)) score += 1;

    const minPrice = Number(p?.node?.priceRange?.minVariantPrice?.amount || "0");
    return { score, title: p.node.title, handle: p.node.handle, minPrice: Math.round(minPrice) };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

async function shopifySearch(domain, token, apiVer, q) {
  const url = `https://${domain}/api/${apiVer}/graphql.json`;
  const body = JSON.stringify({
    query: `
      query($q: String!) {
        products(first: 20, query: $q) {
          edges {
            node {
              title
              handle
              priceRange { minVariantPrice { amount currencyCode } }
            }
          }
        }
      }
    `,
    variables: { q }
  });

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token
    },
    body
  });

  const j = await r.json().catch(() => ({}));
  return j?.data?.products?.edges || [];
}

// Tiny benefit line (EN)
function productOneLiner(title) {
  const t = title.toLowerCase();
  if (t.includes("rose quartz")) return "Rose Quartz supports love, harmony and emotional healing.";
  if (t.includes("black tourmaline")) return "Black Tourmaline helps absorb negativity and enhance protection.";
  if (t.includes("tiger eye")) return "Tiger Eye strengthens willpower, confidence and focus.";
  if (t.includes("salt lamp")) return "Himalayan Salt Lamp adds calming ambience and cozy glow.";
  if (t.includes("nazar") || t.includes("evil eye")) return "Designed for protection from nazar and negative vibes.";
  return "Crafted with care to support your intentions and daily wellness.";
}

// Tiny benefit line (HI)
function oneLinerHiFallback(title) {
  const t = title.toLowerCase();
  if (t.includes("rose quartz")) return "Rose Quartz prem, samvedna aur emotional healing ko support karta hai.";
  if (t.includes("black tourmaline")) return "Black Tourmaline negativity ko absorb karke protection badhata hai.";
  if (t.includes("tiger eye")) return "Tiger Eye willpower, confidence aur focus ko majboot karta hai.";
  if (t.includes("salt lamp")) return "Himalayan Salt Lamp ghar me shaant aur sukoon bhara glow lata hai.";
  if (t.includes("nazar") || t.includes("evil eye")) return "Nazar aur negative vibes se suraksha ke liye design kiya gaya hai.";
  return "Rozmarra ki well-being aur intentions ko support karne ke liye bana hai.";
}

function oneLinerHi(title){ return oneLinerHiFallback(title); }

// Optional GPT polish (kept short & safe)
async function polishWithGPT(text, lang, key) {
  if (!key) return text;
  try {
    const prompt = lang === "hi"
      ? `Is uttar ko 2-3 line ki saral, vinamra Hindi me sudhar kar dijiye. Brand-safe rakhein:\n\n${text}`
      : `Polish this answer to 2-3 concise, friendly lines (brand-safe, no claims):\n\n${text}`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "You are a helpful assistant for Arthlife (wellness brand). Keep answers short, safe and non-medical." },
                   { role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 180
      })
    });
    const j = await r.json();
    const out = j?.choices?.[0]?.message?.content?.trim();
    return out || text;
  } catch {
    return text;
  }
}

/* ---------- /api/ping (optional) ----------
   If you keep this in the same file, Vercel will call the default export; so
   make a second file /api/ping.js with this content:
-------------------------------------------*/

// export default async function ping(req, res) {
//   const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;
//   const STOREFRONT = process.env.SHOPIFY_STOREFRONT_TOKEN;
//   const API_VER = process.env.SHOPIFY_API_VERSION || "2024-04";
//   let sample = null;
//   try {
//     const r = await shopifySearch(SHOPIFY_DOMAIN, STOREFRONT, API_VER, "bracelet");
//     const n = r?.[0]?.node;
//     if (n) sample = { title: n.title, handle: n.handle };
//   } catch(e){}
//   res.json({
//     ok: !!(SHOPIFY_DOMAIN && STOREFRONT),
//     http: 200,
//     domain: SHOPIFY_DOMAIN || null,
//     token_masked: (STOREFRONT||"").slice(0,6)+"…"+(STOREFRONT||"").slice(-4),
//     sample_item: sample
//   });
// }
