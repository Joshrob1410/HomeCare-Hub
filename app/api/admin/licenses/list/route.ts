import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// GET /api/admin/licenses/list
export async function GET() {
  // You can add auth checks here (e.g., verify the caller is an admin if you pass a token).
  const { data, error } = await supabaseAdmin
    .from('company_licenses')
    .select(`
      company_id,
      status,
      plan_code,
      seats,
      valid_until,
      grace_period_days,
      billing_customer_id,
      updated_at,
      companies!inner ( id, name )
    `)
    .order('name', { referencedTable: 'companies', ascending: true });

  if (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  const rows = (data ?? []).map((r) => ({
    company_id: r.company_id as string,
    company_name: (r as any).companies?.name as string | null,
    status: r.status as 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED',
    plan_code: r.plan_code as string,
    seats: r.seats as number,
    valid_until: r.valid_until as string | null,
    grace_period_days: r.grace_period_days as number,
    billing_customer_id: (r.billing_customer_id ?? null) as string | null,
    updated_at: r.updated_at as string,
  }));

  return NextResponse.json({ items: rows });
}
