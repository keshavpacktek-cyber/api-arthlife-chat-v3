// Arthlife — Smart Brand Chat API (v3 • GPT + fuzzy Shopify)
// Drop this file at /api/arthlife-chat-v3.js in your Vercel project.

import fetch from "node-fetch";

/* ------------------------- Config & Helpers ------------------------- */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // required
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN; // e.g. arthlife-in.myshopify.com
const SHOPIFY_STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-04";

// CORS (Shopify theme & anywhere else)
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// Tiny language detector (fast)
function quickLang(raw) {
  const s = (raw || "").trim();
  if (!s) return "en";
  const hasDevanagari = /[\u0900-\u097F]/.test(s);
  if (hasDevanagari) return "hi";
  // Hinglish heuristics: lots of "ka, ki, hai, kya, kaisa" + ASCII
  const lower = s.toLowerCase();
  const hindiWords = ["hai", "kya", "ka", "ki", "kab", "kaise", "kr", "karo", "krna", "krna hai", "order id"];
  const hits = hindiWords.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0);
  if (!hasDevanagari && hits >= 2) return "hi-Latn";
  return "en";
}

// Gentle off-topic check
function isClearlyOffTopic(text) {
  const t = (text || "").toLowerCase();
  return /(cricket|ipl|movie|actor|politics|weather|bank|pan card|aadhaar|flight|train|stock)/.test(t);
}

// stone/product synonyms → widen matches
const STONE_ALIASES = {
  "rose quartz": ["rose quartz", "pink stone", "love stone", "pink crystal"],
  "black tourmaline": ["black tourmaline", "evil eye protection", "negative energy", "nazar", "nazar utaro"],
  "tiger eye": ["tiger eye", "tiger's eye", "confidence stone", "focus stone"],
  "citrine": ["citrine", "abundance stone", "money stone", "cash stone"],
  "amethyst": ["amethyst", "purple quartz", "calm stone"],
};

// fast similarity (Jaccard on tokens; good enough)
function similarity(a, b) {
  const A = new Set((a || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const B = new Set((b || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

async function openaiJSON({ model = "gpt-4o-mini", messages, response_format }) {
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model, messages, temperature: 0.2, response_format })
  });
  const j = await r.json();
  if (!r.ok) {
    console.error("OpenAI error:", j);
    throw new Error("openai_failed");
  }
  return j.choices?.[0]?.message;
}

/* ------------------------- Shopify search ------------------------- */

const S_GRAPH = `https://${SHOPIFY_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`;

async function shopifyQuery(query, variables = {}) {
  if (!SHOPIFY_DOMAIN || !SHOPIFY_STOREFRONT_TOKEN) throw new Error("shopify_env_missing");
  const r = await fetch(S_GRAPH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });
  const j = await r.json();
  if (!r.ok || j.errors) {
    console.error("Shopify error:", j.errors || j);
    throw new Error("shopify_failed");
  }
  return j.data;
}

const PRODUCT_FIELDS = `
  title handle
  description(truncateAt: 280)
  tags
  onlineStoreUrl
  featuredImage { url altText }
  priceRange { minVariantPrice { amount currencyCode } }
`;

async function findProducts(cues, limit = 10) {
  // Build a combined Shopify search query with OR terms
  const terms = [];
  const add = (s) => { if (s && s.length > 1) terms.push(s); };

  (Array.isArray(cues) ? cues : [cues]).forEach((q) => add((q || "").trim()));

  // Expand with aliases if we detect a known stone
  const lower = cues.join(" ").toLowerCase();
  for (const [stone, aliases] of Object.entries(STONE_ALIASES)) {
    if (aliases.some(a => lower.includes(a))) {
      aliases.forEach(add);
      add(stone);
    }
  }

  const unique = [...new Set(terms)];
  if (!unique.length) return [];

  const searchExpr = unique.map(t => `"${t.replace(/"/g, '\\"')}"`).join(" OR ");

  const query = `
    query Products($q:String!) {
      products(first: 20, query: $q) {
        edges {
          node {
            ${PRODUCT_FIELDS}
          }
        }
      }
    }
  `;

  const data = await shopifyQuery(query, { q: searchExpr });
  const items = (data.products?.edges || []).map(e => e.node);

  // sort by similarity with the original joined text
  const base = lower;
  items.sort((a, b) => {
    const sa = Math.max(similarity(base, a.title), similarity(base, a.description || ""), similarity(base, (a.tags || []).join(" ")));
    const sb = Math.max(similarity(base, b.title), similarity(base, b.description || ""), similarity(base, (b.tags || []).join(" ")));
    return sb - sa;
  });
  return items.slice(0, limit);
}

/* ------------------------- Intent & Language ------------------------- */

const INTENT_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "intent_schema",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        lang: { type: "string", enum: ["hi", "en", "hi-Latn"] },
        intent: { type: "string", enum: [
          "ask_product", "price", "uses", "care", "availability",
          "track_order", "replace", "refund", "address_change",
          "greeting", "offtopic"
        ]},
        keywords: { type: "array", items: { type: "string" } }
      },
      required: ["lang", "intent", "keywords"]
    }
  }
};

async function detectIntentAndLang(userMsg, fastLang) {
  // Ask GPT to classify + extract
  const system = `You are an intent classifier for Arthlife (gemstones & bracelets brand).
Return language ("hi" Devanagari, "hi-Latn" Hinglish, or "en"), an "intent", and array "keywords".
Keep it strictly to the schema.`;

  const user = `Message: ${userMsg}
Hint-language: ${fastLang}`;

  const msg = await openaiJSON({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    response_format: INTENT_SCHEMA
  });

  // Parse JSON in content
  try {
    return JSON.parse(msg.content);
  } catch {
    // fallback
    return { lang: fastLang, intent: "ask_product", keywords: [] };
  }
}

/* ------------------------- Reply Templates ------------------------- */

function t(lang, blocks) {
  // simple helper to pick language variant
  return blocks[lang] || blocks["en"];
}

function productCard(p) {
  const price = p?.priceRange?.minVariantPrice;
  const priceLine = price ? `— from ${Number(price.amount).toFixed(0)} ${price.currencyCode}` : "";
  const url = p.onlineStoreUrl || `https://${SHOPIFY_DOMAIN.replace(".myshopify.com","")}.in/products/${p.handle}`;
  return `**${p.title}** ${priceLine}.
${(p.description || "").trim()}
Buy/see details: ${url}`;
}

function orderReply(kind, lang) {
  // email + policy info as requested
  const emailLine = `You can also email **info@arthlife.in** (subject: ${kind === "replace" ? "Replacement/Exchange" : kind === "refund" ? "Refund" : "Address change"}) with your Order ID and details.`;
  const emailLineHi = `Aap **info@arthlife.in** par (subject: ${kind === "replace" ? "Replacement/Exchange" : kind === "refund" ? "Refund" : "Address change"}) apna Order ID aur details bhej sakte hain.`;

  if (kind === "track_order") {
    return t(lang, {
      "en": `To track your order, open the “Track Order” section on Arthlife.in and enter your Order ID or email/phone.`,
      "hi": `Apne order ko track karne ke liye Arthlife.in par “Track Order” section par jaakar apna Order ID ya email/phone dāliye.`,
      "hi-Latn": `Order track karne ke liye Arthlife.in par “Track Order” section me jaaiye aur Order ID ya email/phone dijiye.`
    });
  }

  if (kind === "replace") {
    return t(lang, {
      "en": `For replacement/exchange, please share your **Order ID** and **issue details** (a photo helps). ${emailLine}\nWe'll create the request as per policy.`,
      "hi": `Replacement/exchange ke liye kripya apna **Order ID** aur **issue details** (photo ho to best) share kijiye. ${emailLineHi}\nHum policy ke hisaab se request bana denge.`,
      "hi-Latn": `Replacement/exchange ke liye apna **Order ID** aur **issue details** (photo ho to best) share kijiye. ${emailLineHi}\nPolicy ke hisaab se request create kar denge.`
    });
  }

  if (kind === "refund") {
    return t(lang, {
      "en": `For refund, please share **Order ID** and reason. ${emailLine}\nWe’ll guide you as per refund policy.`,
      "hi": `Refund ke liye **Order ID** aur reason share kijiye. ${emailLineHi}\nHum refund policy ke mutabik guide karenge.`,
      "hi-Latn": `Refund ke liye **Order ID** aur reason share kijiye. ${emailLineHi}\nRefund policy ke mutabik guide karenge.`
    });
  }

  if (kind === "address_change") {
    return t(lang, {
      "en": `To change the shipping address, please share your **Order ID** and the **new address** (with pin code), or email **info@arthlife.in**.`,
      "hi": `Shipping address badalne ke liye apna **Order ID** aur **naya address** (pin code ke saath) share kijiye, ya **info@arthlife.in** par email bhej dijiye.`,
      "hi-Latn": `Shipping address change karne ke liye **Order ID** aur **naya address** (pin code ke saath) share kijiye, ya **info@arthlife.in** par email kijiye.`
    });
  }

  return "";
}

/* ------------------------- Main handler ------------------------- */

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  // Env check (clear message so debugging is easy)
  if (!OPENAI_API_KEY || !SHOPIFY_DOMAIN || !SHOPIFY_STOREFRONT_TOKEN) {
    return res.status(500).json({
      error: "env_missing",
      note: "Set OPENAI_API_KEY, SHOPIFY_DOMAIN, SHOPIFY_STOREFRONT_TOKEN",
    });
  }

  try {
    const { message = "", history = [] } = req.body || {};
    const raw = String(message || "").trim();
    if (!raw) return res.json({ reply: "Please type your message." });

    const fast = quickLang(raw);
    const { lang, intent, keywords } = await detectIntentAndLang(raw, fast);

    // Politely handle true off-topic only
    if (isClearlyOffTopic(raw)) {
      const polite = t(lang, {
        "en": "I can help with Arthlife products, gemstones, bracelets, or orders. Could you share your product name or Order ID?",
        "hi": "Main Arthlife ke products, gemstones, bracelets ya orders mein madad kar sakta/ti hoon. Kripya product ka naam ya Order ID batayein.",
        "hi-Latn": "Main Arthlife ke products, gemstones, bracelets ya orders me madad kar sakta/ti hoon. Kripya product ka naam ya Order ID batayein."
      });
      return res.json({ reply: polite, intent, version: "arthlife-chat:v3-gpt-final" });
    }

    // Order flows (direct answer—no GPT needed)
    if (["track_order", "replace", "refund", "address_change"].includes(intent)) {
      return res.json({
        reply: orderReply(intent, lang),
        intent,
        version: "arthlife-chat:v3-gpt-final"
      });
    }

    // Product queries → search Shopify
    if (["ask_product", "price", "uses", "care", "availability"].includes(intent)) {
      const cues = [...keywords, raw];
      const products = await findProducts(cues, 6);

      if (!products.length) {
        // ask for exact stone/product (but gently)
        const gentle = t(lang, {
          "en": "I didn’t find an exact product match yet. Could you share the product name (or stone)? e.g., Rose Quartz, Citrine, Daily Bath Kit.",
          "hi": "Abhi exact product match nahī mila. Kripya product/stone ka naam batayenge? Jaise: Rose Quartz, Citrine, Daily Bath Kit.",
          "hi-Latn": "Abhi exact product match nahi mila. Kripya product/stone ka naam batayenge? Jaise: Rose Quartz, Citrine, Daily Bath Kit."
        });
        return res.json({ reply: gentle, intent, version: "arthlife-chat:v3-gpt-final" });
      }

      // Pick top
      const top = products[0];

      // facts for GPT to write a nice answer in the *customer's language*
      const facts = {
        title: top.title,
        priceMin: top?.priceRange?.minVariantPrice?.amount || null,
        currency: top?.priceRange?.minVariantPrice?.currencyCode || null,
        url: top.onlineStoreUrl || `https://${SHOPIFY_DOMAIN.replace(".myshopify.com","")}.in/products/${top.handle}`,
        description: top.description || "",
      };

      const system = `You are Arthlife's helpful assistant. Always reply in the customer's language: "${lang}".
Keep answers short, friendly, and on-brand. Use the product facts provided. 
If user asked for price, include starting price. If asked for uses/care, give bullet-like lines.
If they want availability, include a buy/see link.`;

      const user = `User message: ${raw}
Intent: ${intent}
Product facts (JSON):
${JSON.stringify(facts, null, 2)}`;

      const completion = await openaiJSON({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        response_format: { type: "text" }
      });

      const reply = completion?.content?.trim() || productCard(top);
      return res.json({
        reply,
        product: { title: top.title, handle: top.handle },
        intent,
        version: "arthlife-chat:v3-gpt-final"
      });
    }

    // Greetings/default
    const greeting = t(lang, {
      "en": "Namaste 🌿 I’m the Arthlife Assistant—how can I help with products or your order today?",
      "hi": "नमस्ते 🌿 मैं Arthlife Assistant हूँ—products या order में कैसे मदद कर सकता/सकती हूँ?",
      "hi-Latn": "Namaste 🌿 Main Arthlife Assistant hoon—products ya order me kaise madad kar sakta/ti hoon?"
    });
    return res.json({ reply: greeting, intent: "greeting", version: "arthlife-chat:v3-gpt-final" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "internal_error",
      details: String(err.message || err),
      version: "arthlife-chat:v3-gpt-final"
    });
  }
}

/* ------------------------- Optional: quick health check -------------------------
   Add a second file /api/ping.js if you want this endpoint separately.
   Or keep it in your project as-is (you already created one earlier).
--------------------------------------------------------------------------- */
