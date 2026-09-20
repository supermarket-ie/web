export const dynamic='force-dynamic';
function authorized(r:Request){const s=process.env.CRON_SECRET;return Boolean(s&&r.headers.get('authorization')===`Bearer ${s}`)}

export async function GET(request:Request){
 if(!authorized(request)) return Response.json({error:'Unauthorized'},{status:401});
 return Response.json({
   error:'This ambiguous legacy endpoint is retired. Use the single-product-per-session Tesco search refresh route.',
   replacement_routes:['/api/workers/pepesto-tesco-search-refresh'],
 },{status:410});
}
