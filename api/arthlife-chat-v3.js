// Arthlife — AI Brand Chat (v3, r8)
// Multilingual (Hindi / English / Hinglish) + Shopify product lookup + brand guard

export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only", version: "r8" });

  try {
    const {
      message = "",
      history = [] // optional chat memory from frontend
    } = (req.body || {});

    const raw = String(message || "").trim();
    if (!raw) return res.status(400).json({ error: "message required" });

    // ---------- Helpers ----------
    const BRAND = process.env.BRAND_NAME || "Arthlife";
    const STORE_DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN || "";
    const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
    const TRACK_BASE = process.env.SHIPMENT_TRACK_BASE || ""; // e.g. https://www.shiprocket.in/shipment-tracking/?tracking=

    const lower = raw.toLowerCase();

    // --- Language detection: hindi | hinglish | english ---
    const hasDevanagari = /[\u0900-\u097F]/.test(raw);
    const hinglishHints = /(kya|kaise|kis|kyu|kyun|mujhe|krna|krna|bta|bataye|aap|mera|meri|kese|hota|hai|hain)\b/i.test(raw);
    const lang = hasDevanagari ? "hi"
               : hinglishHints ? "hinglish"
               : "en";

    // Brand guard: only allow brand-related queries
    const GUARD = [
      "arthlife","bracelet","gemstone","crystal","kit","bath","cleanse","aura","energy","nazuri","nazar","shubh","arambh","pouch",
      "product","size","payment","order","deliver","delivery","replace","refund","return","exchange","status","track","tracking",
      "dispatch","customer","support","policy","cart","checkout"
    ];
    const related = GUARD.some(k => lower.includes(k));
    if (!related) {
      return res.json({
        reply: chooseLang(
          lang,
          `This chat is only for ${BRAND} products & orders. Please ask about our products, orders or delivery.`,
          `Yeh chat sirf ${BRAND} ke products aur orders ke liye hai. Kripya products, order ya delivery se judi baat puchhiye.`,
          `Yeh chat sirf ${BRAND} ke products & orders ke liye hai. Please products/order/delivery se related hi puchho.`)
      });
    }

    // --- Quick intents (regex) ---
    const askTrack = /(track|where.*order|order.*where|status|kab aayega|kaha.*order)/i.test(lower);
    const askReplace = /(replace|exchange|badal)/i.test(lower);
    const askRefund  = /(refund|return)/i.test(lower);
    const askPayment = /(payment|cod|cash on delivery|upi|card)/i.test(lower);
    const askSize    = /(size|wrist|guide|measure)/i.test(lower);
    const askCleanse = /(cleanse|charge|energ(y|ise)|sadhana|ritual)/i.test(lower);
    const askAuth    = /(authentic|original|genuine|lab|natural)/i.test(lower);
    const askProd    = /(product|detail|info|about|bracelet|crystal|kit|soap|sage|spray)/i.test(lower);

    // Extract possible IDs
    const orderId   = (raw.match(/\b([A-Z0-9]{6,14})\b/i) || [])[1];        // generic order ref
    const tracking  = (raw.match(/\b([A-Z0-9]{8,20})\b/i) || [])[1];        // generic tracking ref
    const pincode   = (raw.match(/\b([1-9][0-9]{5})\b/) || [])[1];

    // --- Shopify product lookup (Storefront API) ---
    async function searchProducts(q) {
      if (!STOREFRONT_TOKEN || !STORE_DOMAIN) return [];
      const endpoint = `https://${STORE_DOMAIN}/api/2024-07/graphql.json`;
      const query = `
        query ProductSearch($q: String!) {
          products(first: 3, query: $q) {
            edges {
              node {
                title
                handle
                description
                onlineStoreUrl
                variants(first:1){ edges{ node{ price { amount currencyCode } } } }
              }
            }
          }
        }`;
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": STOREFRONT_TOKEN
        },
        body: JSON.stringify({ query, variables: { q } })
      });
      const json = await resp.json().catch(() => ({}));
      const edges = (((json || {}).data || {}).products || {}).edges || [];
      return edges.map(e => e.node);
    }

    // --- Ready-made replies for common intents ---
    if (askTrack) {
      const trackLine = TRACK_BASE && tracking
        ? (lang === "hi" ? `Agar aapke paas tracking number hai to yahan check karein: ${TRACK_BASE}${tracking}`
           : lang === "hinglish" ? `Agar tracking no. hai to yahan check karo: ${TRACK_BASE}${tracking}`
           : `If you have a tracking number, check here: ${TRACK_BASE}${tracking}`)
        : "";

      return res.json({
        reply: chooseLang(
          lang,
          `To track your order, open the “Track Order” section on ${BRAND}.in and enter your Order ID or email/phone. ${pincode ? `Delivery to your pincode ${pincode} usually takes 2–5 days.` : ""} ${orderId ? `We detected an ID (${orderId}). If that's your Order ID, you can use it on the tracking page.` : ""} ${trackLine}`,
          `Order track karne ke liye ${BRAND}.in par “Track Order” section me jaakar Order ID ya email/phone daliye. ${pincode ? `Aapke pincode ${pincode} par aam taur par 2–5 din lagte hain.` : ""} ${orderId ? `Hume ek ID mili (${orderId}). Agar yeh aapka Order ID hai to tracking page par use kariye.` : ""} ${trackLine}`,
          `Order track karne ke liye ${BRAND}.in par “Track Order” me Order ID ya email/phone dalo. ${pincode ? `Aapke pincode ${pincode} par 2–5 din lagte hain.` : ""} ${orderId ? `Yeh ID mili (${orderId}). Agar yeh Order ID hai to tracking page par daal do.` : ""} ${trackLine}`
        ).trim()
      });
    }

    if (askReplace) {
      return res.json({
        reply: chooseLang(
          lang,
          `To start a replacement/exchange, please share your Order ID and the issue (photo if applicable). We'll guide you as per policy and create a request.`,
          `Replacement/exchange shuru karne ke liye Order ID aur issue (photo ho to behtar) share kijiye. Policy ke mutabik turant request bana denge.`,
          `Replacement/exchange ke liye Order ID + issue (photo ho to best) share karo. Policy ke hisaab se request bana denge.`
        )
      });
    }

    if (askRefund) {
      return res.json({
        reply: chooseLang(
          lang,
          `For refunds/returns, please share your Order ID. We'll check eligibility as per our policy (unused & within window) and send the next steps.`,
          `Refund/return ke liye apna Order ID share kijiye. Policy (unused & return window) ke hisaab se eligibility check karke next steps bhejenge.`,
          `Refund/return ke liye Order ID share karo. Policy (unused & window ke andar) ke hisaab se check karke next steps bhejenge.`
        )
      });
    }

    if (askPayment) {
      return res.json({
        reply: chooseLang(
          lang,
          `We support UPI, Cards and Netbanking. COD is available for most pincodes (limits may apply).`,
          `UPI, Cards aur Netbanking available hai. COD adhikansh pincodes par milta hai (kuchh simaayein ho sakti hain).`,
          `UPI, Cards & Netbanking available. COD zyada tar pincodes par milta hai (kuch limits ho sakti hain).`
        )
      });
    }

    if (askSize) {
      return res.json({
        reply: chooseLang(
          lang,
          `Wrap a string around your wrist and mark it, measure in cm. Snug: wrist size, Comfort: +0.5–1cm, Loose: +1–1.5cm.`,
          `Dhaaga wrist par lapet kar mark kijiye, cm me naap lijiye. Snug: wrist ke barabar, Comfort: +0.5–1cm, Loose: +1–1.5cm.`,
          `Dhaaga wrist pe lapet ke mark karo, cm me measure karo. Snug: wrist, Comfort: +0.5–1cm, Loose: +1–1.5cm.`
        )
      });
    }

    if (askCleanse) {
      return res.json({
        reply: chooseLang(
          lang,
          `Cleanse with salt/smoke/mist; set an intention; and recharge weekly in gentle sunlight for 2–3 minutes.`,
          `Salt/smoke/mist se cleanse kijiye; intention set kijiye; aur hafte me ek baar 2–3 minute komal dhoop me recharge kijiye.`,
          `Salt/smoke/mist se cleanse karo; intention set karo; aur weekly 2–3 min halki dhoop me recharge karo.`
        )
      });
    }

    if (askAuth) {
      return res.json({
        reply: chooseLang(
          lang,
          `Our stones are natural and lab-verified; minor colour/pattern variations are normal.`,
          `Hamare stones natural aur lab-verified hote hain; halka colour/pattern farq normal hai.`,
          `Hamare stones natural & lab-verified hote hain; thoda colour/pattern variation normal hota hai.`
        )
      });
    }

    // Product intent: try Shopify search + AI phrasing
    if (askProd) {
      const q = raw.replace(/(about|product|detail|info|bracelet|crystal|kit|soap|sage|spray)/ig, "").trim() || raw;
      let items = [];
      try { items = await searchProducts(q); } catch {}
      if (items.length) {
        const top = items[0];
        const priceEdge = (((top.variants||{}).edges||[])[0]||{}).node || {};
        const price = priceEdge.price ? `${priceEdge.price.amount} ${priceEdge.price.currencyCode}` : "";
        const url = top.onlineStoreUrl || (top.handle ? `https://${STORE_DOMAIN}/products/${top.handle}` : "");

        return res.json({
          reply: chooseLang(
            lang,
            `Here’s what I found: “${top.title}” ${price ? `(${price}) ` : ""}—you can check details here: ${url}`,
            `Yeh mila: “${top.title}” ${price ? `(${price}) ` : ""}—details yahan dekh sakte hain: ${url}`,
            `Yeh mila: “${top.title}” ${price ? `(${price}) ` : ""}—details yahan dekh lo: ${url}`
          )
        });
      }
      // fall through to AI
    }

    // ---------- AI fallback (brand-scoped, multilingual) ----------
    if (OPENAI_KEY) {
      try {
        const ai = await callOpenAI(OPENAI_KEY, makeSystemPrompt(BRAND, lang), history, raw);
        if (ai) return res.json({ reply: ai });
      } catch {}
    }

    // If no AI key or any failure -> safe default
    return res.json({
      reply: chooseLang(
        lang,
        `I’m your ${BRAND} Assistant. Please share your order ID or the exact product name, and I’ll help right away.`,
        `Main ${BRAND} Assistant hoon — kripya apna Order ID ya exact product naam likhiye, main turant madad karti/karata hoon.`,
        `${BRAND} Assistant here — order ID ya exact product name share karo, main turant help karta/karti hoon.`
      )
    });

  } catch (err) {
    return res.status(500).json({ error: "Internal error", details: err.message });
  }
}

/* ------------------------ Utilities ------------------------ */

function chooseLang(lang, en, hi, hing) {
  if (lang === "hi") return hi;
  if (lang === "hinglish") return hing;
  return en;
}

function makeSystemPrompt(BRAND, lang) {
  const base = `
You are a helpful, concise chat assistant for the brand "${BRAND}".
Answer ONLY brand-related questions (products, size, cleansing, delivery, payments, returns/exchange/refund, tracking help).
If user asks unrelated things, politely refuse and bring focus back to ${BRAND}.
TONE: warm, kind, spiritual guidance; short & clear sentences; no pricing promises.
`;

  const langRule =
    lang === "hi"
      ? "Reply in natural Hindi (Devanagari)."
      : lang === "hinglish"
      ? "Reply in Hinglish (Roman Hindi) — e.g., 'Aap apna order ID share kijiye, main help karunga.'"
      : "Reply in natural English.";

  return base + "\n" + langRule;
}

async function callOpenAI(apiKey, systemPrompt, history, userMessage) {
  // Minimal OpenAI Chat Completions (compatible with gpt-4o/gpt-4o-mini)
  const body = {
    model: "gpt-4o-mini",
    temperature: 0.4,
    messages: [
      { role: "system", content: systemPrompt },
      ...(Array.isArray(history) ? history : []).slice(-8),
      { role: "user", content: userMessage }
    ]
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  const text = (((j || {}).choices || [])[0] || {}).message || {};
  return text.content || "";
}
