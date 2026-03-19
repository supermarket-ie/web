import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { supabaseAdmin } from './supabase';

const SECRET = process.env.VENDOR_MAGIC_LINK_SECRET ?? process.env.MAGIC_LINK_SECRET!;

export interface VendorTokenPayload {
  vendorId: string;
  email: string;
  name: string;
}

export function signVendorToken(payload: VendorTokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '7d' });
}

export function verifyVendorToken(token: string): VendorTokenPayload | null {
  try {
    return jwt.verify(token, SECRET) as VendorTokenPayload;
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
