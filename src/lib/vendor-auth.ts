import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { supabaseAdmin } from './supabase';

// Vendor tokens MUST use their own secret — falling back to the user-session
// secret would let a misconfigured deployment mint tokens valid in both
// realms. Read lazily so only vendor-auth code paths require the env var.
function vendorSecret(): string {
  const s = process.env.VENDOR_MAGIC_LINK_SECRET;
  if (!s) throw new Error('VENDOR_MAGIC_LINK_SECRET not configured');
  return s;
}

export interface VendorTokenPayload {
  vendorId: string;
  email: string;
  name: string;
}

export function signVendorToken(payload: VendorTokenPayload): string {
  return jwt.sign(payload, vendorSecret(), { expiresIn: '7d' });
}

export function verifyVendorToken(token: string): VendorTokenPayload | null {
  try {
    return jwt.verify(token, vendorSecret()) as VendorTokenPayload;
  } catch {
    return null;
  }
}

export async function getVendorFromToken(token: string) {
  const payload = verifyVendorToken(token);
  if (!payload) return null;

  const { data } = await supabaseAdmin
    .from('vendors')
    .select('*')
    .eq('id', payload.vendorId)
    .single();

  return data ?? null;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
