import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// IMPORTANT: set these in .env.local
// NEXT_PUBLIC_SUPABASE_URL=...
// SUPABASE_SERVICE_ROLE_KEY=...

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// If using Stripe, verify signatures here (omitted for brevity). Keep the shape generic so you can
// swap processors; we only care about a "type" and a "customer/billing id" from the event.
export async function POST(req: Request) {
  // TODO: verify signature from your provider before parsing
  const event = await req.json().catch(() => null);
  if (!event) return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });

  const type = event.type as string | undefined;
  const obj = event.data?.object ?? {};
  const billingCustomerId: string | undefined = obj.customer ?? obj.client_reference_id ?? obj.account;

  if (!type || !billingCustomerId) return NextResponse.json({ ok: true }); // Nothing actionable

  // Map billing events to your license status
  type LicenseStatus = 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';
  let newStatus: LicenseStatus | null = null;

  // Example mappings (Stripe-like):
  if (type === 'invoice.payment_failed') newStatus = 'PAST_DUE';
  if (type === 'customer.subscription.deleted') newStatus = 'CANCELLED';
  if (type === 'customer.subscription.updated' && obj.status === 'active') newStatus = 'ACTIVE';
  if (type === 'charge.dispute.funds_withdrawn') newStatus = 'SUSPENDED';

  if (newStatus) {
    await supabaseAdmin
      .from('company_licenses')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('billing_customer_id', billingCustomerId);
  }

  return NextResponse.json({ ok: true });
}
