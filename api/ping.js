// /api/ping.js
export default async function handler(req, res) {
  const domain = process.env.SHOPIFY_DOMAIN || null;
  const token = process.env.SHOPIFY_STOREFRONT_TOKEN || null;
  const apiVer = process.env.SHOPIFY_API_VERSION || "2024-04";
  const gpt = !!process.env.OPENAI_API_KEY || !!process.env.OPENAI_API_KEY_1;

  let sample_item = null;
  let http = null;
  let shopify_errors = null;

  if (domain && token) {
    try {
      const q = `
        query { products(first: 1) {
          edges { node { title handle priceRange { minVariantPrice { amount currencyCode } } } }
        }}`;
      const r = await fetch(`https://${domain}/api/${apiVer}/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": token,
        },
        body: JSON.stringify({ query: q }),
      });
      http = r.status;
      const j = await r.json();
      if (j.errors) shopify_errors = j.errors;
      const node = j?.data?.products?.edges?.[0]?.node || null;
      if (node) sample_item = { title: node.title, handle: node.handle };
    } catch (e) {
      http = "fetch_failed";
      shopify_errors = e?.message || String(e);
    }
  }

  return res.json({
    ok: !!(domain && token),
    http,
    domain,
    token_masked: token ? token.slice(0, 6) + "…"+ token.slice(-4) : null,
    gpt_present: gpt,
    shopify_response_keys: sample_item ? ["data"] : (shopify_errors ? ["errors"] : []),
    shopify_errors,
    sample_item,
  });
}
