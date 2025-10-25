// Arthlife — Smart Brand Chat API (v3, r13-lang+orderid)
// Features: brand-guard, Shopify product fetch + fuzzy, intents, language auto-reply (hi/en/hinglish)

export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only", version: "arthlife-chat:r13-lang+orderid" });
  }

  // --- ENV check (Shopify) ---
  const SHOPIFY_DOMAIN   = process.env.SHOPIFY_DOMAIN;
  const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
  const API_VER          = process.env.SHOPIFY_API_VERSION || "2024-04";

  if (!SHOPIFY_DOMAIN || !STOREFRONT_TOKEN) {
    return res.status(500).json({
      error: "env_missing",
      note: "Set SHOPIFY_DOMAIN and SHOPIFY_STOREFRONT_TOKEN in Vercel, then redeploy.",
      version: "arthlife-chat:r13-lang+orderid",
    });
  }

  try {
    const body = req.body || {};
    const text = String(body.message || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];

    // ----- Language detection (hi / en / hiLatn) -----
    const lastLang = detectLang((history[history.length - 1]?.content) || "");
    const lang = detectLang(text, lastLang);

    // ----- Brand guard: only Arthlife topics -----
    const brandKeys = [
      "arthlife","bracelet","stone","gem","crystal","kit","bath","nazuri","nazar","ring","energy",
      "product","order","delivery","replace","refund","return","tracking","track","policy","payment",
      "aura","cleanse","soap","pouch","pyrite","quartz","citrine","amethyst","tiger","tourmaline","jade","agate"
    ];
    const isRelated = brandKeys.some(k => text.toLowerCase().includes(k));
    if (!isRelated) {
      return res.json({
        reply: t(lang, {
          en: "This chat is only for Arthlife products & orders. Please ask about our products, orders or delivery.",
          hi: "Ye chat sirf Arthlife ke products aur orders ke liye hai. Kripya products, orders ya delivery se judā sawal puchhiye.",
          hiLatn: "Ye chat sirf Arthlife ke products aur orders ke liye hai. Kripya products, orders ya delivery se juda sawal puchhiye."
        }),
        intent: "scope",
        version: "arthlife-chat:r13-lang+orderid"
      });
    }

    // ----- Intent routing -----
    const intent = detectIntent(text);

    // 1) Track order
    if (intent === "track") {
      return res.json({
        reply: t(lang, {
          en: "To track your order, open the **“Track Order”** section on Arthlife.in and enter your Order ID or email/phone.",
          hi: "Order ko track karne ke liye Arthlife.in par **“Track Order”** section kholiye aur apna Order ID ya email/phone dijiye.",
          hiLatn: "Order track karne ke liye Arthlife.in par **“Track Order”** kholiye aur apna Order ID ya email/phone dijiye."
        }),
        buttons: [
          t(lang, { en: "Order ID:", hi: "Order ID:", hiLatn: "Order ID:" }),
          t(lang, { en: "Need to exchange the product", hi: "Product exchange karna hai", hiLatn: "Product exchange karna hai" }),
        ],
        intent,
        version: "arthlife-chat:r13-lang+orderid"
      });
    }

    // 2) Replacement / Exchange
    if (intent === "replace") {
      return res.json({
        reply: t(lang, {
          en: "For replacement/exchange, please share your **Order ID** and **issue details** (a photo helps). You can also email **info@arthlife.in** (subject: Replacement/Exchange). We’ll create the request as per policy.",
          hi: "Replacement/Exchange ke liye kripya apna **Order ID** aur **issue details** share karein (photo ho to behtar). Aap **info@arthlife.in** par email bhi kar sakte hain (subject: Replacement/Exchange). Policy ke hisaab se request ban jayegi.",
          hiLatn: "Replacement/Exchange ke liye kripya apna **Order ID** aur **issue details** share karein (photo ho to behtar). Aap **info@arthlife.in** par email bhi kar sakte hain (subject: Replacement/Exchange). Policy ke hisaab se request ban jayegi."
        }),
        buttons: [
          t(lang, { en: "Order ID:", hi: "Order ID:", hiLatn: "Order ID:" }),
          t(lang, { en: "Return & refund policy", hi: "Return & refund policy", hiLatn: "Return & refund policy" }),
        ],
        intent,
        version: "arthlife-chat:r13-lang+orderid"
      });
    }

    // 3) Refund / Return
    if (intent === "refund") {
      return res.json({
        reply: t(lang, {
          en: "For refund/return, please share your **Order ID**, product, and reason. You may also email **info@arthlife.in** (subject: Refund/Return). We’ll guide you as per policy.",
          hi: "Refund/Return ke liye kripya apna **Order ID**, product aur reason batayein. Aap **info@arthlife.in** par email bhi kar sakte hain (subject: Refund/Return). Hum policy ke mutabik guide karenge.",
          hiLatn: "Refund/Return ke liye kripya apna **Order ID**, product aur reason batayein. Aap **info@arthlife.in** par email bhi kar sakte hain (subject: Refund/Return). Hum policy ke mutabik guide karenge."
        }),
        buttons: [
          t(lang, { en: "Order ID:", hi: "Order ID:", hiLatn: "Order ID:" }),
          t(lang, { en: "Need to exchange the product", hi: "Product exchange karna hai", hiLatn: "Product exchange karna hai" }),
        ],
        intent,
        version: "arthlife-chat:r13-lang+orderid"
      });
    }

    // 3.5) Order ID — NEW
    if (intent === "orderId") {
      const id = extractOrderId(text);
      if (id) {
        return res.json({
          reply: t(lang, {
            en: `Got it — Order ID **${id}**.\n\nFor **exchange/refund**, please email your *Order ID*, *issue details* and *photos/videos* to **info@arthlife.in**.\nTo **track**, open “Track Order” on Arthlife.in and enter your Order ID + email/phone.`,
            hi: `Samajh gaya — Order ID **${id}**.\n\n**Exchange/Refund** ke liye apna *Order ID*, *issue details* aur *photos/videos* **info@arthlife.in** par email karein.\n**Tracking** ke liye Arthlife.in par “Track Order” kholkar Order ID + email/phone dijiye.`,
            hiLatn: `Samajh gaya — Order ID **${id}**.\n\n**Exchange/Refund** ke liye apna *Order ID*, *issue details* aur *photos/videos* **info@arthlife.in** par email karein.\n**Tracking** ke liye Arthlife.in par “Track Order” kholkar Order ID + email/phone dijiye.`,
          }),
          buttons: [
            t(lang, { en: "Track my order", hi: "Order track karna hai", hiLatn: "Order track karna hai" }),
            t(lang, { en: "Need to exchange the product", hi: "Product exchange karna hai", hiLatn: "Product exchange karna hai" }),
            t(lang, { en: "Return & refund policy", hi: "Return & refund policy", hiLatn: "Return & refund policy" }),
          ],
          intent,
          version: "arthlife-chat:r13-lang+orderid"
        });
      } else {
        return res.json({
          reply: t(lang, {
            en: "Please share your Order ID (e.g., 1004 or #12345).",
            hi: "Kripya apna Order ID batayein (jaise 1004 ya #12345).",
            hiLatn: "Kripya apna Order ID batayein (jaise 1004 ya #12345).",
          }),
          buttons: [
            t(lang, { en: "Track my order", hi: "Order track karna hai", hiLatn: "Order track karna hai" }),
            t(lang, { en: "Need to exchange the product", hi: "Product exchange karna hai", hiLatn: "Product exchange karna hai" }),
          ],
          intent,
          version: "arthlife-chat:r13-lang+orderid"
        });
      }
    }

    // 4) Product / price (Shopify)
    if (intent === "product" || intent === "price") {
      const query = cleanQuery(text);
      const prod = await searchProduct({ domain: SHOPIFY_DOMAIN, token: STOREFRONT_TOKEN, apiVersion: API_VER, q: query });

      if (prod) {
        const price = prod?.priceRange?.minVariantPrice?.amount ? `— from ${Number(prod.priceRange.minVariantPrice.amount).toFixed(0)}.0 INR.` : "";
        const url = `https://${SHOPIFY_DOMAIN.replace(".myshopify.com","")}.in/products/${prod.handle}`;
        const title = prod.title || "product";

        return res.json({
          reply: t(lang, {
            en: `**${title}** ${price}\n${summaryFor(title)}\nBuy/see details: ${url}`,
            hi: `**${title}** ${price && `— ${price.replace("from","se")}`}\n${summaryFor(title, "hi")}\nDetails: ${url}`,
            hiLatn: `**${title}** ${price}\n${summaryFor(title, "hiLatn")}\nDetails: ${url}`,
          }),
          buttons: [
            t(lang, { en: "Need to exchange the product", hi: "Product exchange karna hai", hiLatn: "Product exchange karna hai" }),
            t(lang, { en: "Order ID:", hi: "Order ID:", hiLatn: "Order ID:" }),
          ],
          product: { title, handle: prod.handle },
          intent,
          version: "arthlife-chat:r13-lang+orderid"
        });
      }

      // Not found → ask to specify stone or product
      return res.json({
        reply: t(lang, {
          en: "Didn’t find an exact product match yet. Could you share the product name (or stone)? e.g., Rose Quartz, Citrine, Daily Bath Kit.",
          hi: "Abhi exact product match nahi mila. Kripya product/stone ka naam batayein — jaise Rose Quartz, Citrine, Daily Bath Kit.",
          hiLatn: "Abhi exact product match nahi mila. Kripya product/stone ka naam batayein — jaise Rose Quartz, Citrine, Daily Bath Kit."
        }),
        intent,
        version: "arthlife-chat:r13-lang+orderid"
      });
    }

    // 5) Fallback
    return res.json({
      reply: t(lang, {
        en: "I’m Arthlife Assistant — please share your Order ID or the product name so I can help quickly.",
        hi: "Main Arthlife Assistant hoon — kripya apna Order ID ya product ka naam batayein, taaki main turant madad kar sakoon.",
        hiLatn: "Main Arthlife Assistant hoon — kripya apna Order ID ya product ka naam batayein, taaki main turant madad kar sakoon."
      }),
      version: "arthlife-chat:r13-lang+orderid"
    });

  } catch (err) {
    return res.status(500).json({ error: "Internal error", details: err?.message || String(err), version: "arthlife-chat:r13-lang+orderid" });
  }
}

/* ----------------- Helpers ------------------ */

// Language detection: Hindi (Devanagari) / Hinglish (hiLatn) / English
function detectLang(text, prefer) {
  if (!text) return prefer || "en";
  const hasDevanagari = /[\u0900-\u097F]/.test(text);
  if (hasDevanagari) return "hi";
  const romanHindiHints = /(hai|ka|ki|ko|kya|kripya|kripya|karna|karna hai|order|id|refund|replace|badal|nazar|kitna|price|track|status|kab)/i;
  if (romanHindiHints.test(text)) return "hiLatn";
  return prefer || "en";
}

function t(lang, dict) {
  return dict[lang] ?? dict.hiLatn ?? dict.hi ?? dict.en;
}

// Detect intent (with Order ID support)
function detectIntent(text) {
  if (/cricket|score|ipl|news|weather|share market|stock/i.test(text)) return "offtopic";
  if (/(order\s*id|order\s*number|id)/i.test(text) || extractOrderId(text)) return "orderId";
  if (/(track|status|where.*order)/i.test(text)) return "track";
  if (/(replace|exchange|badal(na)?|replacement)/i.test(text)) return "replace";
  if (/(refund|return)/i.test(text)) return "refund";
  if (/(price|kitna|cost)/i.test(text)) return "price";
  if (/(bracelet|stone|crystal|gem|kit|bath|nazar|nazuri|ring|bead|energy|healing|pyrite|quartz|citrine|amethyst|tiger|tourmaline|jade|agate)/i.test(text)) return "product";
  return "product";
}

// NEW: Extract possible Order ID
function extractOrderId(text) {
  const m =
    text.match(/(?:order\s*id|order\s*number|id|#)\s*[:\-]?\s*([a-z0-9\-]{3,})/i) ||
    text.match(/\b([a-z]{2,5}-?\d{3,})\b/i) ||
    text.match(/\b(\d{4,})\b/);
  return m ? m[1] : null;
}

// Normalize/product query
function cleanQuery(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Tiny summaries for some common stones (optional flavor)
function summaryFor(title, lang = "en") {
  const t = title.toLowerCase();
  if (/rose.*quartz/.test(t)) {
    return lang === "hi"
      ? "Rose Quartz pyaar, daya aur bhavnaon ko samvedansheel banata hai; hriday chakra ko santhulit karta hai."
      : lang === "hiLatn"
      ? "Rose Quartz pyaar, daya aur emotions ko balance karta hai; heart chakra ko santhulit karta hai."
      : "Rose Quartz brings love, compassion and harmony; nurtures emotional balance.";
  }
  if (/black.*tourmaline/.test(t)) {
    return lang === "hi"
      ? "Black Tourmaline negativity absorb karta hai aur suraksha deta hai."
      : lang === "hiLatn"
      ? "Black Tourmaline negativity absorb karta hai aur protection deta hai."
      : "Black Tourmaline absorbs negativity and provides protection.";
  }
  if (/tiger.*eye/.test(t)) {
    return lang === "hi"
      ? "Tiger Eye himmat, focus aur willpower badhata hai."
      : lang === "hiLatn"
      ? "Tiger Eye himmat, focus aur willpower badhata hai."
      : "Tiger Eye boosts courage, focus and willpower.";
  }
  return lang === "hi"
    ? "Arthlife ka pramanit crystal. Zyada jaankari link par milegi."
    : lang === "hiLatn"
    ? "Arthlife ka certified crystal. Details link par milengi."
    : "Arthlife certified crystal. See the link for full details.";
}

// Shopify Storefront search (best-effort greedy pick)
async function searchProduct({ domain, token, apiVersion, q }) {
  // Build a tolerant query from user text
  const words = q.split(/\s+/).filter(Boolean);
  const qs = words.length ? words.slice(0, 5).join(" ") : "bracelet";
  const gql = `
    query Search($q:String!) {
      products(first: 12, query: $q) {
        edges {
          node {
            title
            handle
            productType
            tags
            priceRange { minVariantPrice { amount } }
          }
        }
      }
    }
  `;

  const resp = await fetch(`https://${domain}/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token
    },
    body: JSON.stringify({ query: gql, variables: { q: qs } })
  });

  const json = await resp.json();
  const edges = json?.data?.products?.edges || [];
  if (!edges.length) return null;

  // Greedy rank: prefer items whose title/tag includes any keyword
  let best = null, scoreBest = -1;
  for (const e of edges) {
    const n = e.node;
    const hay = `${n.title} ${(n.tags || []).join(" ")} ${(n.productType || "")}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (hay.includes(w)) score += 2;
      if (hay.startsWith(w)) score += 1;
    }
    if (score > scoreBest) { scoreBest = score; best = n; }
  }
  // Fallback: first
  return best || edges[0]?.node || null;
}
