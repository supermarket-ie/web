import { agentSupabase } from './supabase';
import { computeStoreTotals, type AgentListItem } from './shop';
import { getIngredientIntelligence } from './ingredient-intelligence';
import { toEpicureName } from '../../src/lib/epicure-client';
import { findDietaryViolations } from '../../src/lib/list-validation';

export type DraftConfidence = 'include' | 'suggest' | 'suppress';
export type DraftSource = 'history' | 'replenishment' | 'meal_plan' | 'ingredient_intelligence' | 'preference' | 'catalogue';
export type DraftDecision = { canonical_name: string; action: 'included' | 'suggested' | 'not_added'; confidence: DraftConfidence; reason: string; signals: string[]; sources: DraftSource[]; days_since_last_bought?: number | null; typical_interval_days?: number | null; meal_count?: number; price?: number | null; store?: string | null; on_promotion?: boolean };
type HistoryRow = { canonical_name: string; category: string | null; store: string; price_paid: number; quantity: number; observed_at: string };
type PriceRow = { canonical_name: string; category: string | null; store: string; price: number; on_promotion: boolean | null };
type Household = { dietary?: string[] | null; dislikes?: string | null; preferred_stores?: string[] | null; memory?: Record<string, unknown> | null };
type Meal = { day?: string; name?: string; ingredients?: Array<{ name: string; quantity?: string | null }> };
type Meals = { dinners?: Meal[]; lunches?: Meal[] };
function daysBetween(a: Date, b: Date) { return Math.max(0, (a.getTime() - b.getTime()) / 86400000); }
function median(values: number[]): number | null { if (!values.length) return null; const s = [...values].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function normalise(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function disliked(name: string, raw?: string | null) { if (!raw) return false; const n=normalise(name); return raw.split(/[,;\n]/).map(normalise).filter(Boolean).some(v=>n.includes(v)||v.includes(n)); }
function currentWeekStart(): string { const now=new Date(); const day=now.getUTCDay(); const diff=day===0?-6:1-day; const monday=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())); monday.setUTCDate(monday.getUTCDate()+diff); return monday.toISOString().slice(0,10); }
function stoppedBuying(name: string, household: Household): boolean { const memory=household.memory??{}; const candidates=[memory.stoppedItems,memory.stopped_items,memory.droppedItems,memory.dropped_items].flatMap(v=>Array.isArray(v)?v:[]); return candidates.some(v=>normalise(String(v))===normalise(name)); }
function choosePrice(rows: PriceRow[], preferred?: string[] | null): PriceRow | null { const wanted=new Set((preferred??[]).map(normalise).filter(v=>v!=='all')); const preferredRows=wanted.size?rows.filter(r=>wanted.has(normalise(r.store))):[]; const pool=preferredRows.length?preferredRows:rows; return [...pool].sort((a,b)=>Number(a.price)-Number(b.price))[0]??null; }

export async function buildShopDraft(subscriberId: string) {
  const weekStart=currentWeekStart();
  const [{data:householdData},{data:historyData},{data:planData},{data:currentList}]=await Promise.all([
    agentSupabase.from('households').select('dietary, dislikes, preferred_stores, memory').eq('subscriber_id',subscriberId).maybeSingle(),
    agentSupabase.from('list_items').select('canonical_name, category, store, price_paid, quantity, observed_at').eq('subscriber_id',subscriberId).order('observed_at',{ascending:false}).limit(500),
    agentSupabase.from('weekly_plans').select('meals').eq('subscriber_id',subscriberId).eq('week_start',weekStart).maybeSingle(),
    agentSupabase.from('saved_lists').select('id, family_size, items').eq('subscriber_id',subscriberId).order('created_at',{ascending:false}).limit(1).maybeSingle(),
  ]);
  const household=(householdData??{}) as Household; const history=(historyData??[]) as HistoryRow[];
  if(!history.length&&!((currentList?.items as AgentListItem[]|null)?.length)) return {ok:false as const,reason:'no_history'};
  const grouped=new Map<string,HistoryRow[]>(); for(const row of history){const rows=grouped.get(row.canonical_name)??[];rows.push(row);grouped.set(row.canonical_name,rows);}
  const candidateNames=[...new Set([...grouped.keys(),...(((currentList?.items??[]) as AgentListItem[]).map(i=>i.canonical_name))])];
  const {data:priceData}=candidateNames.length?await agentSupabase.from('latest_prices').select('canonical_name, category, store, price, on_promotion').in('canonical_name',candidateNames):{data:[]};
  const prices=(priceData??[]) as PriceRow[]; const now=new Date(); const decisions:DraftDecision[]=[]; const items:AgentListItem[]=[];
  for(const name of candidateNames){
    const rows=grouped.get(name)??[];
    if(stoppedBuying(name,household)||disliked(name,household.dislikes)||findDietaryViolations([{canonical_name:name}],household.dietary??[]).length){decisions.push({canonical_name:name,action:'not_added',confidence:'suppress',reason:'Not added because an explicit household preference outranks inferred shopping history.',signals:['explicit household preference'],sources:['preference']});continue;}
    const dates=rows.map(r=>new Date(r.observed_at)).sort((a,b)=>b.getTime()-a.getTime()); const intervals=dates.slice(0,-1).map((d,i)=>daysBetween(d,dates[i+1])).filter(v=>v>=1&&v<=90); const interval=median(intervals); const daysSince=dates[0]?daysBetween(now,dates[0]):null;
    const frequent=rows.length>=2; const due=interval!=null&&daysSince!=null&&daysSince>=Math.max(1,interval*.8); const veryRecent=interval!=null&&daysSince!=null&&daysSince<interval*.45; const latestListHas=((currentList?.items??[]) as AgentListItem[]).some(i=>i.canonical_name===name); const include=due||(frequent&&interval==null&&latestListHas); const best=choosePrice(prices.filter(p=>p.canonical_name===name),household.preferred_stores);
    if(include&&best){const quantity=rows[0]?.quantity??((currentList?.items??[]) as AgentListItem[]).find(i=>i.canonical_name===name)?.quantity??1;items.push({canonical_name:name,category:best.category??rows[0]?.category??undefined,store:best.store,price:Number(best.price),quantity,on_promotion:Boolean(best.on_promotion)});decisions.push({canonical_name:name,action:'included',confidence:'include',reason:interval&&daysSince!=null?`Usually bought about every ${Math.round(interval)} days; last bought ${Math.round(daysSince)} days ago.`:'Frequently bought household item and present in the recent shop pattern.',signals:['usual product',due?'replenishment due':'frequent purchase',best.on_promotion?'current promotion':'current price'],sources:['history','replenishment','catalogue'],days_since_last_bought:daysSince==null?null:Math.round(daysSince),typical_interval_days:interval==null?null:Math.round(interval),price:Number(best.price),store:best.store,on_promotion:Boolean(best.on_promotion)});}
    else if(veryRecent){decisions.push({canonical_name:name,action:'not_added',confidence:'suppress',reason:`Bought recently${daysSince!=null?` (${Math.round(daysSince)} days ago)`:''}; unlikely to be due yet.`,signals:['recent purchase','not replenishment due'],sources:['history','replenishment'],days_since_last_bought:daysSince==null?null:Math.round(daysSince),typical_interval_days:interval==null?null:Math.round(interval)});}
  }
  const meals=(planData?.meals??{}) as Meals; const plannedMeals=[...(meals.dinners??[]),...(meals.lunches??[])]; const itemKeys=new Set(items.map(i=>toEpicureName(i.canonical_name))); const completion=new Map<string,DraftDecision>();
  for(const meal of plannedMeals.slice(0,6)){const hero=[...new Set((meal.ingredients??[]).map(i=>toEpicureName(i.name)).filter(Boolean))].slice(0,5);if(!hero.length)continue;const intel=await getIngredientIntelligence(hero,{dietary:household.dietary,dislikes:household.dislikes,preferred_stores:household.preferred_stores},4,{allow_live_epicure:false});for(const suggestion of intel.suggestions){const product=suggestion.products[0];if(!product||itemKeys.has(toEpicureName(product.canonical_name)))continue;const existing=completion.get(product.canonical_name);const mealLabel=[meal.day,meal.name].filter(Boolean).join(' · ');if(existing){existing.meal_count=(existing.meal_count??1)+1;existing.signals.push(`useful for ${mealLabel}`);continue;}completion.set(product.canonical_name,{canonical_name:product.canonical_name,action:'suggested',confidence:'suggest',reason:`${suggestion.ingredient} complements this week's planned meals but needs approval before being added.`,signals:['meal completion',`useful for ${mealLabel}`,suggestion.signal_count>1?'ingredient reuse':'Epicure pairing'],sources:['meal_plan','ingredient_intelligence','catalogue'],meal_count:1,price:product.price,store:product.store,on_promotion:product.on_promotion});}}
  decisions.push(...[...completion.values()].sort((a,b)=>(b.meal_count??0)-(a.meal_count??0)).slice(0,6));
  return {ok:true as const,family_size:currentList?.family_size??'2',items,store_totals:computeStoreTotals(items),decisions,suggestions:decisions.filter(d=>d.action==='suggested'),suppressed:decisions.filter(d=>d.action==='not_added'),week_start:weekStart};
}
