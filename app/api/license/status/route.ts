// app/api/license/status/route.ts
import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/supabase/server';

type LicenseStatus = 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';

type CompanyMembershipRow = {
  company_id: string;
  has_company_access: boolean | null;
};

type LicenseRow = {
  company_id: string;
  status: LicenseStatus | null;
  valid_until: string | null;       // DATE in DB, comes as 'YYYY-MM-DD'
  grace_period_days: number | null;
};

function parseDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  // 'YYYY-MM-DD' → Date at midnight UTC
  const [y, m, d] = dateStr.split('-').map((n) => Number(n));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

export async function GET(req: Request) {
  const supabase = await getServerSupabase();

  // 0) Auth (cookie-based)
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ status: 'SUSPENDED' as LicenseStatus }, { status: 401 });
  }

  // 1) Admin bypass
  const { data: levelData } = await supabase.rpc('get_effective_level');
  if (typeof levelData === 'string' && levelData === '1_ADMIN') {
    return NextResponse.json({ status: 'ACTIVE' as LicenseStatus, reason: 'admin_bypass' });
  }

  // 2) Optional explicit companyId (if you add a selector later)
  const url = new URL(req.url);
  const explicitCompanyId = url.searchParams.get('companyId') ?? undefined;

  // 3) Resolve the companies this user can access
  let companyIds: string[] = [];

  if (explicitCompanyId) {
    const { data: one } = await supabase
      .from('company_memberships')
      .select('company_id, has_company_access')
      .eq('user_id', user.id)
      .eq('company_id', explicitCompanyId)
      .maybeSingle();

    if (one && (one.has_company_access ?? true)) {
      companyIds = [one.company_id];
    }
  }

  if (companyIds.length === 0) {
    const { data: cms, error: cmErr } = await supabase
      .from('company_memberships')
      .select('company_id, has_company_access')
      .eq('user_id', user.id);

    if (!cmErr && Array.isArray(cms)) {
      companyIds = (cms as CompanyMembershipRow[])
        .filter((r) => (r.has_company_access ?? true))
        .map((r) => r.company_id);
    }
  }

  if (companyIds.length === 0) {
    // Migration-safe default
    return NextResponse.json({ status: 'ACTIVE' as LicenseStatus, reason: 'no_company_resolved' });
  }

  // 4) Pull licenses for all candidate companies
  const { data: licRows, error: licErr } = await supabase
    .from('company_licenses')
    .select('company_id, status, valid_until, grace_period_days')
    .in('company_id', companyIds);

  if (licErr) {
    return NextResponse.json({ status: 'ACTIVE' as LicenseStatus, reason: 'license_query_error' });
  }

  const licenses: LicenseRow[] = Array.isArray(licRows)
    ? (licRows as LicenseRow[])
    : [];

  // Build quick lookup
  const licMap = new Map<string, LicenseRow>();
  for (const r of licenses) licMap.set(r.company_id, r);

  // 5) Evaluate: any ACTIVE/PAST_DUE (or missing row) => allow
  const now = new Date();

  for (const cid of companyIds) {
    const lic = licMap.get(cid);

    if (!lic) {
      // No row yet => allow (migration-safe)
      return NextResponse.json({ status: 'ACTIVE' as LicenseStatus, companyId: cid, reason: 'no_row' });
    }

    const status = lic.status ?? 'ACTIVE';
    if (status === 'ACTIVE' || status === 'PAST_DUE') {
      const until = parseDate(lic.valid_until);
      const grace = lic.grace_period_days ?? 0;

      if (!until) {
        // No expiry configured → allow
        return NextResponse.json({ status: 'ACTIVE' as LicenseStatus, companyId: cid, reason: 'status_allows_no_expiry' });
      }

      // valid_until + grace >= now → allow
      const expiry = new Date(until.getTime());
      expiry.setUTCDate(expiry.getUTCDate() + grace);
      if (now <= expiry) {
        return NextResponse.json({ status: 'ACTIVE' as LicenseStatus, companyId: cid, reason: 'in_grace_or_active' });
      }

      // If past expiry, continue loop to see if another company is valid
    }
  }

  // None of the companies qualified
  return NextResponse.json({ status: 'SUSPENDED' as LicenseStatus, reason: 'all_companies_blocked' });
}
