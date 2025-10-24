// Arthlife — Smart Brand Chat API (v3)
// Version: arthlife-chat:r7

export default async function handler(req, res) {
  // ✅ Allow CORS (for Shopify frontend)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only", version: "r7" });
  }

  try {
    const { message = "" } = req.body || {};
    const input = message.toLowerCase().trim();

    // 🛡️ Limit to Arthlife-related topics
    const brandKeywords = [
      "arthlife", "bracelet", "gemstone", "kit", "bath", "nazuri", "nazar", "shubh",
      "arambh", "aura", "cleanse", "soap", "pouch", "energy", "crystal", "product",
      "delivery", "order", "payment", "replace", "refund", "tracking", "dispatch", "customer"
    ];
    const related = brandKeywords.some(k => input.includes(k));

    if (!related) {
      return res.json({
        reply: "🙏 Ye chat sirf Arthlife ke products aur orders se sambandhit prashnon ke liye hai. कृपया Arthlife.in par visit karein ya apna order ya product detail batayein."
      });
    }

    // 🔍 Smart understanding
    if (/track|where.*order|status/i.test(input)) {
      return res.json({
        reply: "🕊️ Aapka order track karne ke liye Arthlife.in par 'Track Order' section me jaayein aur apna order ID ya email daalein. Agar aapke paas order ID nahi hai, to hum help karenge usse nikalne me."
      });
    }

    if (/replace|exchange/i.test(input)) {
      return res.json({
        reply: "🔄 Replacement ke liye please apna Order ID share kijiye. Arthlife team aapke product replacement ko turant process karegi."
      });
    }

    if (/refund|return/i.test(input)) {
      return res.json({
        reply: "💰 Refund ke liye please apna order ID share kijiye. Hum refund policy ke hisaab se aapko full guidance denge."
      });
    }

    if (/product|detail|info|about/i.test(input)) {
      return res.json({
        reply: "🌸 Aap kaunsa Arthlife product ke baare me poochhna chahte hain? Jaise — Daily Bath Kit, Nazuri Nazar Utaro Kit, ya Bracelet Collection?"
      });
    }

    // 🧠 Default AI-style fallback
    return res.json({
      reply: "🌿 Main Arthlife Assistant hoon — kripya apna order ya product naam likhiye, taaki main turant sahayata kar sakoon."
    });

  } catch (err) {
    return res.status(500).json({ error: "Internal error", details: err.message });
  }
}
