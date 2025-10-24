// Arthlife — Smart Brand Chat API (v3, AI+Multilingual upgrade)
// Version: arthlife-chat:r8 (v3 endpoint, no new repo)
// Uses OpenAI via fetch (no SDK) + Shopify Storefront context

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;            // e.g. arthlife.in
const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;    // Storefront access token
const BRAND = process.env.BRAND_NAME || "Arthlife";

// --- Helpers -----------------------------------------------------

// very fast language detector: Hindi chars => 'hi', else Hinglish if common words, else 'en'
function detectLang(text) {
  const t = String(text || "").trim();
  if (!t) return "en";
  if (/[\u0900-\u097F]/.test(t)) return "hi"; // devanagari => Hindi
  if (/(^|[\s,])(kya|kyu|kyun|kaise|krna|karna|meri|mera|apna|aap|hai|hua|hoga|kaha|kidhar|id|order|return|replace|refund)([\s,.!?]|$)/i.test(t))
    return "hing";
  return "en";
}

function replyByLang(lang, { hi, hing, en }) {
  if (lang === "hi") return hi;
  if (lang === "hing") return hing;
  return en;
}

function isBrandRelated(text) {
  const low = text.toLowerCase();
  const keys = [
    "arthlife","bracelet","gemstone","kit","bath","nazuri","nazar","arambh",
    "cleanse","soap","pouch","energy","crystal","order","delivery","refund",
    "return","replace","payment","dispatch","customer","tracking","track","awb"
  ];
  return keys.some(k => low.includes(k));
}

async function fetchShopifyProductContext(query) {
  try {
    if (!STORE_DOMAIN || !STOREFRONT_TOKEN) return "";
    const gql = `
      {
        products(first: 3, query: "${query.replace(/"/g, '\\"')}") {
          edges {
            node {
              title
              handle
              description
            }
          }
        }
      }
    `;
    const r = await fetch(`https://${STORE_DOMAIN}/api/2024-07/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": STOREFRONT_TOKEN
      },
      body: JSON.stringify({ query: gql })
    });
    const data = await r.json();
    const items = data?.data?.products?.edges || [];
    if (!items.length) return "";
    return items
      .map(e => {
        const n = e.node;
        return `• ${n.title} — ${n.description?.slice(0, 160) || ""}`.trim();
      })
      .join("\n")
      .slice(0, 800);
  } catch {
    return "";
  }
}

async function openaiRespond(prompt) {
  if (!OPENAI_API_KEY) return "";
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input: prompt
    })
  });
  const j = await r.json();
  return (j?.output_text || "").trim();
}

// --- Handler -----------------------------------------------------

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only", version: "r8" });
  }

  try {
    const { message = "" } = req.body || {};
    const input = String(message || "").trim();
    if (!input) return res.status(400).json({ error: "message required" });

    const lang = detectLang(input);

    // 1) Non-brand queries → polite redirect (same language)
    if (!isBrandRelated(input)) {
      return res.json({
        reply: replyByLang(lang, {
          hi: `🙏 यह चैट केवल ${BRAND} के उत्पादों और ऑर्डर्स के लिए है। कृपया ${BRAND}.in पर जाएं या अपने ऑर्डर/प्रोडक्ट से जुड़ा प्रश्न पूछें।`,
          hing: `🙏 Ye chat sirf ${BRAND} ke products aur orders ke liye hai. Kripya ${BRAND}.in visit karein ya order/product se related sawaal poochhein.`,
          en: `🙏 This chat is for ${BRAND} products & orders only. Please visit ${BRAND}.in or ask order/product related questions.`
        })
      });
    }

    const lower = input.toLowerCase();

    // 2) Fast intent replies (language-aware)
    if (/track|status|where.*order|tracking|awb/i.test(lower)) {
      return res.json({
        reply: replyByLang(lang, {
          hi: "📦 ऑर्डर ट्रैक करने के लिए कृपया Arthlife.in पर ‘Track Order’ सेक्शन खोलकर अपना Order ID या Email/Phone दर्ज करें। अगर Order ID नहीं मिल रही है तो हम मदद करेंगे उसे ढूँढने में।",
          hing: "📦 Order track karne ke liye Arthlife.in par ‘Track Order’ section me apna Order ID ya Email/Phone daliye. Agar Order ID nahi mil rahi to hum madad karenge nikalne me.",
          en: "📦 To track your order, open the ‘Track Order’ section on Arthlife.in and enter your Order ID or Email/Phone. If you can’t find your Order ID, we’ll help retrieve it."
        })
      });
    }

    if (/replace|exchange|replacement/i.test(lower)) {
      return res.json({
        reply: replyByLang(lang, {
          hi: "🔄 Replacement/Exchange के लिए कृपया अपना Order ID + issue (photo होने पर बेहतर) शेयर करें। हमारी टीम पॉलिसी के अनुसार request प्रोसेस कर देगी।",
          hing: "🔄 Replacement/Exchange ke liye kripya Order ID + issue (photo ho to best) share karein. Team policy ke hisaab se request process kar degi.",
          en: "🔄 For replacement/exchange, please share your Order ID + the issue (a photo helps). Our team will process it as per policy."
        })
      });
    }

    if (/refund|return/i.test(lower)) {
      return res.json({
        reply: replyByLang(lang, {
          hi: "💰 Refund/Return के लिए कृपया अपना Order ID साझा करें. हम policy के अनुसार आपको पूरी guidance देंगे।",
          hing: "💰 Refund/Return ke liye apna Order ID share karein. Hum policy ke hisaab se aapko full guidance denge.",
          en: "💰 For refunds/returns, please share your Order ID. We’ll guide you fully as per policy."
        })
      });
    }

    // 3) Product/info type → AI + Shopify context (same language)
    const shopCtx = await fetchShopifyProductContext(input);
    const prompt = `
You are ${BRAND}'s assistant. Tone: warm, spiritual, caring, premium yet concise.
User language: ${lang === "hi" ? "Hindi" : lang === "hing" ? "Hinglish" : "English"}.
Reply strictly in user's language. 2–4 short lines max.
If order/return/replace is asked, give helpful steps. If irrelevant to ${BRAND}, say chat is only for ${BRAND} products/orders (politely).
If product query, use the context if helpful.

Context (optional):
${shopCtx || "(no specific product context found)"}

User: ${input}
Answer:
    `.trim();

    const ai = await openaiRespond(prompt);
    const final = ai || replyByLang(lang, {
      hi: `🌿 मैं ${BRAND} असिस्टेंट हूँ — कृपया अपना ऑर्डर या प्रोडक्ट नाम लिखें, ताकि मैं तुरंत मदद कर सकूँ।`,
      hing: `🌿 Main ${BRAND} Assistant hoon — kripya apna order ya product naam likhiye, taaki main turant madad kar sakoon.`,
      en: `🌿 I’m your ${BRAND} assistant — please share your order or product name so I can help right away.`
    });

    return res.json({ reply: final, lang });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error", details: err.message });
  }
}
