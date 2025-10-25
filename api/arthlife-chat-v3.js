// /api/arthlife-chat-v3.js
// Arthlife — Smart Brand Chat (v3 + GPT, CORS-safe lazy import)

const VERSION = "arthlife-chat:v3-gpt-fix";
const PROJECT_URL = "https://api-arthlife-chat-v3.vercel.app";

// --------- tiny helpers ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function detectLang(text, lastLang = "en") {
  const t = (text || "").trim();
  if (/[ऀ-ॿ]/.test(t)) return "hi"; // Devanagari
  const hinglishWords = ["kya","kaise","krna","karna","hain","hai","mujhe","aap","chahiye","krdo","plz","matlab"];
  const lower = t.toLowerCase();
  if (hinglishWords.some((w) => lower.includes(w))) return "hi-Latn";
  return "en";
}

function formatPrice({ amount, currencyCode }) {
  if (!amount) return "";
  const n = Number(amount);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currencyCode || "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function brandVoice(lang) {
  if (lang === "hi")
    return {
      replace:
        "🔄 Replacement/Exchange के लिए कृपया अपना Order ID और issue details (फोटो/वीडियो) साझा करें—या **info@arthlife.in** पर mail करें। हम पॉलिसी अनुसार रिक्वेस्ट बनाएँगे।",
      arOnly:
        "यह चैट केवल Arthlife के products व orders के लिए है। कृपया हमारे products, orders या delivery से जुड़े सवाल पूछें।",
    };
  if (lang === "hi-Latn")
    return {
      replace:
        "🔄 Replacement/Exchange ke liye Order ID + issue details (photo/video) share karein—ya **info@arthlife.in** par mail karein. Hum policy ke hisaab se request bana denge.",
      arOnly:
        "Ye chat sirf Arthlife ke products aur orders ke liye hai. Kripya products, orders ya delivery se jude prashn poochiye.",
    };
  return {
    replace:
      "🔄 For replacement/exchange, please share your Order ID + issue details (photo/video) — or email **info@arthlife.in**. We’ll create the request as per policy.",
    arOnly:
      "This chat is only for Arthlife products & orders. Please ask about our products, orders, or delivery.",
  };
}

function detectIntent(text) {
  const t = text.toLowerCase();
  if (/(replace|exchange)/.test(t)) return "replace";
  if (/(refund|return)/.test(t)) return "refund";
  if (/(track|status|where.*order)/.test(t)) return "track";
  if (/(price|cost)/.test(t)) return "price";
  return "product";
}

function isBrandRelated(text) {
  return /(arthlife|bracelet|stone|kit|soap|aura|cleanse|order|exchange|refund|track)/i.test(
    text
  );
}

// ---- Shopify helpers ----
async function shopifyGraphQL(query, variables = {}) {
  const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;
  const TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
  const API_VER = process.env.SHOPIFY_API_VERSION || "2024-04";
  const url = `https://${SHOPIFY_DOMAIN}/api/${API_VER}/graphql.json`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  const j = await r.json();
  return j.data;
}

async function findProduct(q) {
  const query = `
  query($q:String!){
    products(first:5, query:$q){
      edges{
        node{
          title
          handle
          description
          priceRange{ minVariantPrice{ amount currencyCode } }
        }
      }
    }
  }`;
  const data = await shopifyGraphQL(query, { q });
  return data?.products?.edges?.[0]?.node || null;
}

async function getOpenAI() {
  // Lazy-load + cache on first use (no top-level await)
  if (!process.env.OPENAI_API_KEY) return null;
  if (!globalThis.__arth_openai) {
    try {
      const mod = await import("openai");
      const OpenAI = mod.default || mod;
      globalThis.__arth_openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    } catch {
      globalThis.__arth_openai = null;
    }
  }
  return globalThis.__arth_openai;
}

async function gptReply(product, msg, lang) {
  const openai = await getOpenAI();
  if (!openai) return null;

  const link = `https://${process.env.SHOPIFY_DOMAIN}/products/${product.handle}`;
  const price = formatPrice(product.priceRange?.minVariantPrice || {});
  const sys = `You are Arthlife's chat assistant. Reply in ${
    lang === "hi" ? "Hindi" : lang === "hi-Latn" ? "Hinglish" : "English"
  } in 3–4 lines. Keep it warm, brand-safe, helpful.`;
  const user = `
User query: ${msg}
Product: ${product.title} ${price}
Desc: ${product.description.slice(0, 500)}
Link: ${link}
Generate a short, friendly reply including meaning/benefit and Buy link.`;

  try {
    const c = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    });
    return c.choices?.[0]?.message?.content?.trim();
  } catch {
    return null;
  }
}

function plainReply(product, lang) {
  const link = `https://${process.env.SHOPIFY_DOMAIN}/products/${product.handle}`;
  const price = formatPrice(product.priceRange?.minVariantPrice || {});
  const d = product.description.replace(/\n+/g, " ").slice(0, 350);
  return `**${product.title}** — from ${price}
${d}
Buy/see: ${link}`;
}

// ---- Main API (with CORS FIRST) ----
export default async function handler(req, res) {
  // CORS headers set immediately to avoid browser blocks even on errors
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { message = "" } = req.body || {};
    const text = String(message || "").trim();
    if (!text) return res.json({ reply: "Please type your question." });

    const lang = detectLang(text);
    const v = brandVoice(lang);
    const intent = detectIntent(text);

    if (!isBrandRelated(text)) {
      return res.json({ reply: v.arOnly, intent: "scope", lang, version: VERSION });
    }

    if (intent === "replace") {
      return res.json({ reply: v.replace, intent: "replace", lang, version: VERSION });
    }

    const product = await findProduct(text);

    if (product) {
      let reply = await gptReply(product, text, lang);
      if (!reply) reply = plainReply(product, lang);
      return res.json({
        reply,
        product: { title: product.title, handle: product.handle },
        intent: "product",
        lang,
        version: VERSION,
      });
    }

    return res.json({
      reply:
        "Exact product match not found. Please share the stone/product name (e.g., Rose Quartz, Citrine, Tiger Eye).",
      intent: "ask_product",
      lang,
      version: VERSION,
    });
  } catch (e) {
    // Still CORS-safe (headers already set)
    return res.status(500).json({ error: "Internal Error", details: e.message, version: VERSION });
  }
}
