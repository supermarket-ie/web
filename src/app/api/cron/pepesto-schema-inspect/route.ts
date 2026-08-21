import { supabaseAdmin } from '@/lib/supabase';
import { retrievePepestoSearch } from '@/lib/pepesto-tesco';

export const dynamic = 'force-dynamic';

function summarize(value:any, depth=0):any {
  if (depth > 3) return typeof value;
  if (Array.isArray(value)) return { type:'array', length:value.length, sample:value.length ? summarize(value[0], depth+1) : null };
  if (value && typeof value === 'object') {
    const out:Record<string,any> = {};
    for (const k of Object.keys(value).slice(0,30)) out[k] = summarize(value[k], depth+1);
    return out;
  }
  return typeof value;
}

export async function GET(request:Request){
  const secret=process.env.CRON_SECRET;
  if(!secret || request.headers.get('authorization')!==`Bearer ${secret}`) return Response.json({error:'Unauthorized'},{status:401});
  const {data:sessions,error}=await supabaseAdmin.from('pepesto_tesco_sessions').select('id,search_session_id,result_summary').eq('status','done').order('submitted_at',{ascending:false}).limit(2);
  if(error) return Response.json({error:error.message},{status:500});
  for(const s of sessions??[]){
    const payload=await retrievePepestoSearch(s.search_session_id);
    await supabaseAdmin.from('pepesto_tesco_sessions').update({result_summary:{...(s.result_summary||{}),schema:summarize(payload)}}).eq('id',s.id);
  }
  return Response.json({ok:true,inspected:(sessions??[]).length});
}
