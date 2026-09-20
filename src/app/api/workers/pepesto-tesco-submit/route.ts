export const dynamic='force-dynamic';
function authorized(r:Request){const s=process.env.CRON_SECRET;return Boolean(s&&r.headers.get('authorization')===`Bearer ${s}`)}

export async function GET(request:Request){
 if(!authorized(request)) return Response.json({error:'Unauthorized'},{status:401});
 return Response.json({
   error:'Multi-product Pepesto search is retired because the current singular product request returns one independently attributable result. Use the preferred-products refresh for trusted mappings or the single-product candidate-discovery route.',
   replacement_routes:['/api/workers/pepesto-tesco-products-canary','/api/workers/pepesto-tesco-candidate-discovery'],
 },{status:410});
}
