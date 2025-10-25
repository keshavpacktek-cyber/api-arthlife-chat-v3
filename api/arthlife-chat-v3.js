// Arthlife — Smart Brand Chat API (v3, final)
// Features: CORS fixed, Node runtime, Shopify fuzzy product search,
// language auto-reply (hi / hi-Latn / en), order intents, optional GPT polish.

export const config = {
  // ✅ Force Node.js runtime so our headers & fetch behave consistently
  runtime: "nodejs",
};

const VERSION = "arthlife-chat:v3-final";

// --- Env
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;                // e.g. arthlife-in.myshopify.com
const SHOPIFY_STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-04";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.GPT_API_KEY; // optional

// --- Helpers
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function detectLang(text="") {
  // Hindi (Devanagari)
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  // Hinglish heuristics (common Hindi words but Latin)
  const s = text.toLowerCase();
  if (/\b(kya|kaise|order|id|replace|badal|address|refund|track|mera|price|kitna|bracelet|nazar|stone)\b/.test(s)) {
    return "hi-Latn";
  }
  return "en";
}

function norm(s="") { return String(s).toLowerCase().trim(); }

function take(str="", n=240) {
  if (!str) return "";
  let t = str.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n-1) + "…" : t;
}

function siteBase(req) {
  // Try to build shop URL for deep links
  const hdr = (req.headers?.host || "").toLowerCase();
  if (hdr && !hdr.includes("vercel.app")) return `https://${hdr}`;
  return "https://arthlife.in"; // fallback
}

// --- Shopify GraphQL fetch
async function shopifyGraphQL(query, variables) {
  if (!SHOPIFY_DOMAIN || !SHOPIFY_STOREFRONT_TOKEN) {
    throw new Error("Missing Shopify env");
  }

  const url = `https://${SHOPIFY_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!r.ok) {
    const t = await r.text().catch(()=> "");
    throw new Error(`Shopify ${r.status} ${r.statusText} ${t}`);
  }
  const j = await r.json();
  if (j.errors) throw new Error(`Shopify errors: ${JSON.stringify(j.errors)}`);
  return j.data;
}

// --- Product search (fuzzy-ish)
async function findProductLike(q) {
  const query1 = `
    query Products($q:String, $n:Int!){
      products(first:$n, query:$q){
        edges{
          node{
            title
            handle
            description
            tags
            priceRange{ minVariantPrice{ amount currencyCode } }
          }
        }
      }
    }
  `;

  // Normalize & generate a few attempts
  const raw = norm(q);
  const attempts = [
    raw,
    raw.replace(/bracelet|band|kada|stone|patthar|energy|power|kit/gi,"").trim(),
    raw.replace(/\b(pink)\b/g,"rose").replace(/\b(evil eye)\b/g,"nazar"),
    raw.split(/\s+/).filter(Boolean).join(" AND "),
  ].filter(Boolean);

  // Track best
  let best = null;

  for (const attempt of attempts) {
    const data = await shopifyGraphQL(query1, { q: attempt, n: 12 }).catch(()=>null);
    const edges = data?.products?.edges || [];
    const cand = edges.map(e => e.node);

    // Score by title/desc/token overlap
    const tokens = raw.split(/\s+/).filter(Boolean);
    for (const p of cand) {
      const title = norm(p.title);
      const desc  = norm(p.description || "");
      let score = 0;
      tokens.forEach(t => {
        if (title.includes(t)) score += 3;
        if (desc.includes(t))  score += 1;
      });
      // Little boosts for common stones/products
      if (/rose quartz|tiger|black tourmaline|citrine|amethyst|nazuri|nazar|evil eye/i.test(p.title)) score += 2;
      const item = { ...p, _score: score };
      if (!best || item._score > best._score) best = item;
    }

    // Small pause to be gentle (esp. on Hobby tier)
    await sleep(50);
  }

  return best; // may be null
}

// --- Optional GPT polish (short / 2 lines)
async function gptPolish({ lang, title, desc, price, url }) {
  if (!OPENAI_API_KEY) return null;

  const sys = `You are Arthlife's helpful assistant. Output must be in ${lang === "hi" ? "Hindi (Devanagari)" : lang === "hi-Latn" ? "Hinglish (Latin Hindi)" : "English"}.
Keep it helpful, 2 lines max, brand-safe. Include price and when useful, a link.`;

  const user = `Summarize this product for a customer:
Title: ${title}
Price: ${price}
URL: ${url}
Description: ${desc || ""}`;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user }
        ]
      })
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}`);
    const j = await r.json();
    return j.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null; // fail silently
  }
}

// --- Intent detection
function detectIntent(input) {
  const s = norm(input);

  // Replace / exchange
  if (/(replace|exchange|badal|badli|tabdil|return karna|exchange karna)/i.test(s)) {
    return "replace";
  }
  // Refund
  if (/(refund|paise wapas|money back)/i.test(s)) {
    return "refund";
  }
  // Track / status
  if (/(track|status|kahan|kidhar|where.*order|meri order)/i.test(s)) {
    return "track";
  }
  // Address change
  if (/(address|shipping).*change|galat address|address sahi|naya address|pin code/i.test(s)) {
    return "address";
  }
  // Product ask (price, details)
  if (/(price|details|kya|kitna|kis energy|kisliye|purpose|use|stone|bracelet|nazar|nazuri|kit)/i.test(s)) {
    return "ask_product";
  }

  return "other";
}

// --- Replies (lang aware)
function replyForIntent({ lang, intent, product, site }) {
  const linkTrack = `${site}/pages/track-order`;

  const t = {
    replace: {
      "en": "For replacement/exchange, please share your **Order ID** and **issue details** (a photo helps). You can also email **info@arthlife.in** (subject: Replacement/Exchange). We’ll create the request as per policy.",
      "hi-Latn": "Replacement/Exchange ke liye apna **Order ID** aur **issue details** (photo ho to best) share karein. Aap **info@arthlife.in** par email bhi kar sakte hain (subject: Replacement/Exchange). Policy ke hisaab se request process hogi.",
      "hi": "प्रतिस्थापन/एक्सचेंज के लिए अपना **ऑर्डर आईडी** और **समस्या का विवरण** (फोटो हो तो बेहतर) साझा करें। आप **info@arthlife.in** पर (विषय: Replacement/Exchange) ईमेल भी कर सकते हैं। हम नीति के अनुसार अनुरोध बनाएंगे।"
    },
    refund: {
      "en": "For a refund, please share your **Order ID** and reason. You can also email **info@arthlife.in**. We’ll guide you as per policy.",
      "hi-Latn": "Refund ke liye apna **Order ID** aur reason share karein. **info@arthlife.in** par email bhi kar sakte hain. Policy ke hisaab se guide karenge.",
      "hi": "रिफंड के लिए कृपया अपना **ऑर्डर आईडी** और कारण साझा करें। आप **info@arthlife.in** पर ईमेल भी कर सकते हैं। हम नीति के अनुसार मार्गदर्शन करेंगे।"
    },
    track: {
      "en": `To track your order, open the **“Track Order”** section on Arthlife.in and enter your **Order ID** or email/phone. ${linkTrack}`,
      "hi-Latn": `Order track karne ke liye Arthlife.in par **“Track Order”** section kholein, aur **Order ID** ya email/phone dijiye. ${linkTrack}`,
      "hi": `ऑर्डर ट्रैक करने के लिए Arthlife.in पर **“Track Order”** सेक्शन खोलें और अपना **ऑर्डर आईडी** या ईमेल/फोन दर्ज करें। ${linkTrack}`
    },
    address: {
      "en": "To change the shipping address, please share your **Order ID** and the **new address** (with pin code), or email **info@arthlife.in**.",
      "hi-Latn": "Shipping address change karne ke liye **Order ID** aur **naya address** (pin code ke saath) share karein, ya **info@arthlife.in** par email karein.",
      "hi": "शिपिंग पता बदलने के लिए अपना **ऑर्डर आईडी** और **नया पता** (पिन कोड सहित) साझा करें या **info@arthlife.in** पर ईमेल करें।"
    },
    ask_fallback: {
      "en": "Could you share the product/stone name (e.g., Rose Quartz, Citrine, Daily Bath Kit)?",
      "hi-Latn": "Product/stone ka naam share karenge? (jaise Rose Quartz, Citrine, Daily Bath Kit)",
      "hi": "कृपया उत्पाद/पथ्थर का नाम साझा करें (जैसे Rose Quartz, Citrine, Daily Bath Kit)।"
    },
    scope: {
      "en": "I can help with Arthlife products & orders. Please ask about our products, orders, or delivery.",
      "hi-Latn": "Yeh chat Arthlife ke products aur orders ke liye hai. Kripya products, orders ya delivery se judi prashn puchiye.",
      "hi": "यह चैट Arthlife के उत्पादों और ऑर्डर्स के लिए है। कृपया उत्पाद, ऑर्डर या डिलीवरी से जुड़े प्रश्न पूछिए।"
    }
  };

  const L = (obj) => obj[lang] || obj["en"];

  if (intent === "replace") return L(t.replace);
  if (intent === "refund")  return L(t.refund);
  if (intent === "track")   return L(t.track);
  if (intent === "address") return L(t.address);

  if (intent === "ask_product" && product) {
    const price = product?.priceRange?.minVariantPrice;
    const priceStr = price ? `${price.amount} ${price.currencyCode}` : "";
    const url = `${site}/products/${product.handle}`;
    const base = `**${product.title}** — from ${priceStr}. ${take(product.description, 220)}
Buy/see details: ${url}`;

    return base; // (may be polished by GPT below)
  }

  if (intent === "ask_product" && !product) return L(t.ask_fallback);
  return L(t.scope);
}

// --- Main handler
export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only", version: VERSION }); return; }

  const site = siteBase(req);

  try {
    const { message = "", history = [] } = req.body || {};
    const input = String(message || "").trim();
    if (!input) return res.json({ reply: "Please type your question.", version: VERSION });

    const lang = detectLang(input);
    const intent = detectIntent(input);

    let product = null;
    if (intent === "ask_product") {
      product = await findProductLike(input).catch(()=>null);
    }

    let reply = replyForIntent({ lang, intent, product, site });

    // If we found a product and you have GPT, ask it to polish the 2-line message
    if (product && OPENAI_API_KEY) {
      const price = product?.priceRange?.minVariantPrice;
      const priceStr = price ? `${price.amount} ${price.currencyCode}` : "";
      const url = `${site}/products/${product.handle}`;
      const polished = await gptPolish({
        lang, title: product.title, desc: product.description, price: priceStr, url
      });
      if (polished) reply = polished;
    }

    res.json({
      reply,
      intent,
      lang,
      product: product ? {
        title: product.title,
        handle: product.handle,
        price: product?.priceRange?.minVariantPrice || null
      } : null,
      version: VERSION
    });

  } catch (err) {
    res.status(500).json({
      error: "Internal error",
      details: (err && err.message) || String(err),
      version: VERSION
    });
  }
}
