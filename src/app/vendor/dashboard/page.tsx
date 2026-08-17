import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { verifyVendorToken, getVendorFromToken } from '@/lib/vendor-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { VendorDashboard } from './VendorDashboard';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('vendor_session')?.value ?? '';
  if (!token) redirect('/vendor/signin');

  const payload = verifyVendorToken(token);
  if (!payload) redirect('/vendor/signin?error=expired');

  const vendor = await getVendorFromToken(token);
  if (!vendor) redirect('/vendor/signin');

  const { data: vendorProducts } = await supabaseAdmin
    .from('vendor_products')
    .select('*, products(id, canonical_name, category)')
    .eq('vendor_id', vendor.id)
    .order('created_at', { ascending: false });

  const { data: allProducts } = await supabaseAdmin
    .from('products')
    .select('id, canonical_name, category')
    .order('canonical_name');

  return (
    <VendorDashboard
      vendor={vendor}
      token=""
      vendorProducts={vendorProducts ?? []}
      allProducts={allProducts ?? []}
    />
  );
}
