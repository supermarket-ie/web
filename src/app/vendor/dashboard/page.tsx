import { redirect } from 'next/navigation';
import { verifyVendorToken, getVendorFromToken } from '@/lib/vendor-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { VendorDashboard } from './VendorDashboard';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) redirect('/vendor/signin');

  const payload = verifyVendorToken(token);
  if (!payload) redirect('/vendor/signin');

  const vendor = await getVendorFromToken(token);
  if (!vendor) redirect('/vendor/signin');

  // Fetch vendor products
  const { data: vendorProducts } = await supabaseAdmin
    .from('vendor_products')
    .select('*, products(id, canonical_name, category)')
    .eq('vendor_id', vendor.id)
    .order('created_at', { ascending: false });

  // Fetch all canonical products for the catalogue picker
  const { data: allProducts } = await supabaseAdmin
    .from('products')
    .select('id, canonical_name, category')
    .order('canonical_name');

  return (
    <VendorDashboard
      vendor={vendor}
      token={token}
      vendorProducts={vendorProducts ?? []}
      allProducts={allProducts ?? []}
    />
  );
}
