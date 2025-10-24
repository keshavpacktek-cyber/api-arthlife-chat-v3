// Minimal diagnostics for env + Shopify reachability
export default async function handler(req, res) {
  try {
    const domain = process.env.SHOPIFY_DOMAIN || null;
    const token  = process.env.SHOPIFY_STOREFRONT_TOKEN || null;

    // Mask token in response
    const masked = token ? token.slice(0, 6) + "…" + token.slice(-4) : null;

    // If env missing -> tell us right away
    if (!domain || !token) {
      return res.status(200).json({
        ok: false,
        reason: "env_missing",
        domain,
        token_present: !!token,
        note: "Set SHOPIFY_DOMAIN and SHOPIFY_STOREFRONT_TOKEN in Vercel → Settings → Environment Variables, then Redeploy."
      });
    }

    // Try a tiny Shopify GraphQL query
    const r = await fetch(`https://${domain}/api/2024-04/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": token,
      },
      body: JSON.stringify({
        query: `{
          products(first:1){ edges{ node{ title handle } } }
        }`
      })
    });

    const out = await r.json().catch(() => ({}));

    return res.status(200).json({
      ok: r.ok,
      http: r.status,
      domain,
      token_masked: masked,
      shopify_response_keys: Object.keys(out || {}),
      shopify_errors: out.errors || null,
      sample_item:
        out?.data?.products?.edges?.[0]?.node || null
    });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      reason: "exception",
      message: e?.message
    });
  }
}
