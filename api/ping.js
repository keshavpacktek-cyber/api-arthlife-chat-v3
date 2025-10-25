// /api/ping.js
export default async function handler(req,res){
  const domain=process.env.SHOPIFY_DOMAIN||null;
  const token=process.env.SHOPIFY_STOREFRONT_TOKEN||null;
  const apiVer=process.env.SHOPIFY_API_VERSION||"2024-04";
  const gpt=!!process.env.OPENAI_API_KEY;
  let item=null; let http=null;
  if(domain&&token){
    try{
      const q=`query{products(first:1){edges{node{title handle}}}}`;
      const r=await fetch(`https://${domain}/api/${apiVer}/graphql.json`,{
        method:"POST",
        headers:{"Content-Type":"application/json","X-Shopify-Storefront-Access-Token":token},
        body:JSON.stringify({query:q})
      });
      http=r.status;
      const j=await r.json();
      item=j.data?.products?.edges?.[0]?.node||null;
    }catch(e){http="fail";}
  }
  res.json({
    ok:!!(domain&&token),
    http,
    domain,
    token_masked:token?token.slice(0,6)+"…"+token.slice(-4):null,
    gpt_present:gpt,
    sample_item:item,
    project_url:"https://api-arthlife-chat-v3.vercel.app"
  });
}
