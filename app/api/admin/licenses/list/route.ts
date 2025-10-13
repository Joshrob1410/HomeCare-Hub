// app/api/admin/licenses/list/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

type LicenseStatus = 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';

type CompaniesJoin = {
  id: string;
  name: string | null;
} | null;

type LicenseRowDb = {
  company_id: string;
  status: LicenseStatus;
  plan_code: string;
  seats: number;
  valid_until: string | null;
  grace_period_days: number;
  billing_customer_id: string | null;
  updated_at: string;
  // FK alias join
  companies: CompaniesJoin;
};

type LicenseRowOut = {
  company_id: string;
  company_name: string | null;
  status: LicenseStatus;
  plan_code: string;
  seats: number;
  valid_until: string | null;
  grace_period_days: number;
  billing_customer_id: string | null;
  updated_at: string;
};

// GET /api/admin/licenses/list
export async function GET() {
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
      companies:company_licenses_company_id_fkey ( id, name )
    `)
    .order('name', { foreignTable: 'companies', ascending: true });

  if (error) {
    // eslint-disable-next-line no-console
    console.error('licenses/list error:', error);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  const rows: LicenseRowOut[] = (data as unknown as LicenseRowDb[] | null)?.map((r) => ({
    company_id: r.company_id,
    company_name: r.companies?.name ?? null,
    status: r.status,
    plan_code: r.plan_code,
    seats: r.seats,
    valid_until: r.valid_until,
    grace_period_days: r.grace_period_days,
    billing_customer_id: r.billing_customer_id,
    updated_at: r.updated_at,
  })) ?? [];

  return NextResponse.json({ items: rows });
}
