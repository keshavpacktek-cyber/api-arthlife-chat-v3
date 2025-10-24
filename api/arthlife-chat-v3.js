// Arthlife — Smart Brand Chat API (r11)
// File: api/arthlife-chat-v3.js
// Env needed: SHOPIFY_DOMAIN, SHOPIFY_STOREFRONT_TOKEN

const VERSION = "arthlife-chat:r11";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-Arth-Version");
  res.setHeader("X-Arth-Version", VERSION);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only", version: VERSION });

  try {
    const { message = "", history = [] } = req.body || {};
    const raw = String(message || "").trim();
    if (!raw) return res.status(400).json({ error: "message required", version: VERSION });

    const lang = detectLang(raw); // "hi" | "en" | "hi-latn"
    const t = (en, hi, hiLatn = hi) => (lang === "en" ? en : lang === "hi" ? hi : hiLatn);
    const lower = raw.toLowerCase();

    // fast intents
    if (/track|where.*order|status|kab aayega|order kaha/i.test(lower)) {
      return res.json({ reply: t(
        "To track your order, open the “Track Order” section on Arthlife.in and enter your Order ID or email/phone.",
        "Apne order ko track karne ke liye Arthlife.in par ‘Track Order’ section me jaaiye aur Order ID ya email/phone dijiye.",
        "Apna order track karne ke liye Arthlife.in par ‘Track Order’ section me jaaiye aur Order ID ya email/phone dijiye."
      )});
    }
    if (/replace|exchange|badal/i.test(lower)) {
      return res.json({ reply: t(
        "For replacement/exchange, please share your Order ID and the issue (a photo helps). Our team will process it as per policy.",
        "Replacement/exchange ke liye kripya apna Order ID aur issue (photo ho to best) share kijiye. Team policy ke hisaab se process karegi.",
        "Replacement/exchange ke liye please Order ID aur issue (photo ho to best) share kijiye. Team policy ke hisaab se process karegi."
      )});
    }
    if (/refund|return|money back|paise wapas/i.test(lower)) {
      return res.json({ reply: t(
        "For refund/return, please share your Order ID; we’ll guide you as per policy.",
        "Refund/return ke liye kripya apna Order ID dijiye; hum policy ke hisaab se guide karenge.",
        "Refund/return ke liye please Order ID dijiye; hum policy ke hisaab se guide karenge."
      )});
    }

    // product assistant (fuzzy)
    const productAnswer = await answerProductQuestion(raw, lang);
    if (productAnswer) return res.json({ reply: productAnswer });

    // brand safety fallback
    const BRAND_TERMS = ["arthlife","bracelet","gemstone","stone","crystal","kit","bath","soap","cleanse","aura","energy",
      "nazar","nazuri","arambh","shubh","pouch","product","delivery","order","dispatch","tracking",
      "payment","replace","exchange","refund","customer","return","policy"];
    const mentionsBrand = BRAND_TERMS.some(k => lower.includes(k)) || /bracelet|stone|crystal|kit/i.test(raw);

    if (!mentionsBrand) {
      return res.json({ reply: t(
        "This chat is for Arthlife products & orders only. Please visit Arthlife.in or ask a product/order related question.",
        "Yeh chat sirf Arthlife products aur orders ke liye hai. Kripya Arthlife.in par jaiye ya product/order se judi query poochhiye.",
        "Yeh chat sirf Arthlife products aur orders ke liye hai. Please Arthlife.in par jaiye ya product/order related query poochhiye."
      )});
    }

    return res.json({ reply: t(
      "I’m Arthlife Assistant — please share the exact product name (or stone) or your Order ID so I can help quickly.",
      "Main Arthlife Assistant hoon — kripya product ka exact naam (ya stone) ya apna Order ID batayiye, main turant madad karunga/karungi.",
      "Main Arthlife Assistant hoon — please product ka exact naam (ya stone) ya Order ID batayiye, main turant madad karunga/karungi."
    )});

  } catch (err) {
    return res.status(500).json({ error: "Internal error", details: err.message, version: VERSION });
  }
}

function detectLang(text){
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  if (/(kya|kaise|kripya|kyon|kaha|kab|hai|hota|madad|paise|wapas|order)/i.test(text)) return "hi-latn";
  return "en";
}

const S_DOMAIN = process.env.SHOPIFY_DOMAIN;            // e.g. arthlife-in.myshopify.com
const S_TOKEN  = process.env.SHOPIFY_STOREFRONT_TOKEN;  // Storefront access token
const API_VER  = "2024-04";

async function shopifyQL(query, variables){
  const url = `https://${S_DOMAIN}/api/${API_VER}/graphql.json`;
  const r = await fetch(url, {
    method:"POST",
    headers:{ "Content-Type":"application/json", "X-Shopify-Storefront-Access-Token": S_TOKEN },
    body: JSON.stringify({ query, variables })
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

async function answerProductQuestion(userText, lang){
  const normalized = normalizeQuery(userText);
  const tokens = tokenize(normalized);

  const variants = [
    normalized,
    tokens.slice(0,4).join(" "),
    tokens.filter(t=>t.length>3).join(" ")
  ].filter(Boolean);

  let products = [];
  for (const q of variants){
    const data = await shopifyQL(
`query SmartSearch($q:String!){
  products(first:10, query:$q){
    edges{ node{
      title handle productType vendor description
      priceRange{ minVariantPrice{amount currencyCode} maxVariantPrice{amount currencyCode} }
    } }
  }
}`, { q: buildStorefrontQuery(q) });
    products = products.concat((data?.products?.edges||[]).map(e=>e.node));
  }

  if (products.length){
    const ranked = rankProducts(products, tokens);
    if (ranked[0] && ranked[0]._score >= 0.4) return buildProductAnswer(ranked[0], userText, lang);
  }

  const dataAll = await shopifyQL(
`query AllProd{
  products(first:50, sortKey:TITLE){
    edges{ node{
      title handle productType vendor description
      priceRange{ minVariantPrice{amount currencyCode} maxVariantPrice{amount currencyCode} }
    } }
  }
}`);
  const all = (dataAll?.products?.edges||[]).map(e=>e.node);
  if (all.length){
    const ranked = rankProducts(all, tokens);
    if (ranked[0] && ranked[0]._score >= 0.35) return buildProductAnswer(ranked[0], userText, lang);
  }
  return null;
}

function normalizeQuery(q){
  const lower = q.toLowerCase();
  const replace = lower
    .replace(/\bpink stone\b/g,"rose quartz")
    .replace(/\benergy stone\b/g,"crystal")
    .replace(/\bbracelet ka\b/g,"bracelet")
    .replace(/\bpathar\b/g,"stone");
  return replace
    .replace(/[^\p{L}\p{N}\s]/gu," ")
    .replace(/\b(energy|use|used|purpose|kis|ke|liye|kya|kise|hota|hai|about|details|info|product|please|plz|bataye|batao|mujhe|want|need|buy|best|stone|crystal|bracelet)\b/gi," ")
    .replace(/\s+/g," ").trim();
}
function tokenize(q){ return q.toLowerCase().split(/\s+/).filter(w=>w && w.length>1); }
function buildStorefrontQuery(q){
  // break into words, make each a wildcard match across title/tags/type
  const terms = q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(t => `title:*${t}* OR tag:*${t}* OR product_type:*${t}* OR vendor:*${t}*`);
  return terms.join(" OR ");
}
function rankProducts(products, qTokens){
  const qset = new Set(qTokens);
  return products.map(p=>{
    const text = `${p.title} ${p.productType||""} ${p.vendor||""} ${(p.description||"").slice(0,300)}`.toLowerCase();
    const pTokens = new Set(tokenize(text));
    const inter = [...qset].filter(t=>pTokens.has(t)).length;
    const jaccard = inter / (qset.size + pTokens.size - inter || 1);
    let bonus = 0;
    const qJoined = qTokens.join(" ");
    if (qJoined && text.includes(qJoined)) bonus += 0.25;
    if (qTokens.some(t=>p.title.toLowerCase().includes(t))) bonus += 0.15;
    const first = qTokens[0];
    if (first && p.title.toLowerCase().startsWith(first)) bonus += 0.1;
    const score = Math.min(jaccard + bonus, 1);
    return { ...p, _score: score };
  }).sort((a,b)=>b._score - a._score);
}
function moneyStr(p){ if(!p) return ""; const {amount, currencyCode:c="INR"} = p; try{
  return new Intl.NumberFormat("en-IN",{style:"currency",currency:c}).format(Number(amount));
}catch{return `${amount} ${c}`}}
function buildProductAnswer(p, userText, lang){
  const minP=p?.priceRange?.minVariantPrice, maxP=p?.priceRange?.maxVariantPrice;
  const price = (minP && maxP)
    ? (minP.amount===maxP.amount? moneyStr(minP) : `${moneyStr(minP)} – ${moneyStr(maxP)}`)
    : "";
  const url = `https://${S_DOMAIN.replace(".myshopify.com","")}.myshopify.com/products/${p.handle}`;
  const short = (p.description||"").replace(/\s+/g," ").trim().slice(0,180);
  const line = price ? ` • ${price}` : "";
  const en = `Here’s what I found: ${p.title}${line}\n${short? "— "+short:""}\n\nBuy / details: ${url}`;
  const hi = `Maine yeh product dhunda: ${p.title}${line}\n${short? "— "+short:""}\n\nKhareedne / details ke liye: ${url}`;
  const hiLatn = `Maine yeh product dhunda: ${p.title}${line}\n${short? "— "+short:""}\n\nBuy / details: ${url}`;
  return (lang==="en"?en:lang==="hi"?hi:hiLatn);
}
