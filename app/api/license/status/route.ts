// app/api/license/status/route.ts
import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/supabase/server';

type LicenseStatus = 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';

export async function GET(req: Request) {
  const supabase = await getServerSupabase();

  // 0) Auth (via cookies/session)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ status: 'SUSPENDED' as LicenseStatus }, { status: 401 });
  }

  // 1) Admin bypass
  const { data: levelData } = await supabase.rpc('get_effective_level');
  if (typeof levelData === 'string' && levelData === '1_ADMIN') {
    return NextResponse.json({ status: 'ACTIVE' as LicenseStatus, reason: 'admin_bypass' });
  }

  // 2) Optional explicit companyId (useful if you add a selector later)
  const url = new URL(req.url);
  const explicitCompanyId = url.searchParams.get('companyId') ?? undefined;

  // 3) Gather company ids this user can access
  let companyIds: string[] = [];

  if (explicitCompanyId) {
    // trust but verify the user has membership
    const { data: cm } = await supabase
      .from('company_memberships')
      .select('company_id, has_company_access')
      .eq('user_id', user.id)
      .eq('company_id', explicitCompanyId)
      .maybeSingle();
    if (cm && (cm.has_company_access ?? true)) {
      companyIds = [explicitCompanyId];
    }
  }

  if (companyIds.length === 0) {
    // fallback: first-party memberships with access=true
    const { data: cms, error: cmErr } = await supabase
      .from('company_memberships')
      .select('company_id, has_company_access')
      .eq('user_id', user.id);

    if (!cmErr && Array.isArray(cms) && cms.length > 0) {
      companyIds = cms
        .filter((r) => (r.has_company_access ?? true))
        .map((r) => String(r.company_id));
    }
  }

  // Migration-friendly: if we still don’t know a company, allow login
  if (companyIds.length === 0) {
    return NextResponse.json({ status: 'ACTIVE' as LicenseStatus, reason: 'no_company_resolved' });
  }

  // 4) Pull license rows for all candidate companies in one go
  const { data: licenses, error: licErr } = await supabase
    .from('company_licenses')
    .select('company_id, status, valid_until, grace_period_days')
    .in('company_id', companyIds);

  if (licErr) {
    // fail open (don’t lock people out because of a transient read error)
    return NextResponse.json({ status: 'ACTIVE' as LicenseStatus, reason: 'license_query_error' });
  }

  // Build a quick map
  const licMap = new Map<string, {
    status: LicenseStatus | null;
    valid_until: string | null;
    grace_period_days: number | null;
  }>();

  (licenses ?? []).forEach((r) => {
    licMap.set(String(r.company_id), {
      status: (r.status as LicenseStatus) ?? null,
      valid_until: (r as any).valid_until ?? null,
      grace_period_days: (r as any).grace_period_days ?? null,
    });
  });

  // 5) Evaluate: any ACTIVE/PAST_DUE (or missing row) => allow
  const now = new Date();
  for (const cid of companyIds) {
    const lic = licMap.get(cid);
    if (!lic) {
      // No row yet => allow (migration-safe)
      return NextResponse.json({ status: 'ACTIVE' as LicenseStatus, companyId: cid, reason: 'no_row' });
    }

    // If status says ACTIVE/PAST_DUE, allow
    if (lic.status === 'ACTIVE' || lic.status === 'PAST_DUE') {
      // Optional: if you want to double-check expiry even when status is ACTIVE:
      if (lic.valid_until && lic.grace_period_days != null) {
        const expiry = new Date(lic.valid_until);
        expiry.setUTCDate(expiry.getUTCDate() + Number(lic.grace_period_days));
        if (now <= expiry) {
          return NextResponse.json({ status: 'ACTIVE' as LicenseStatus, companyId: cid, reason: 'in_grace_or_active' });
        }
        // If past expiry, we’ll continue to check other companies
      } else {
        return NextResponse.json({ status: 'ACTIVE' as LicenseStatus, companyId: cid, reason: 'status_allows' });
      }
    }
  }

  // If we got here, none of the companies were eligible
  return NextResponse.json({ status: 'SUSPENDED' as LicenseStatus, reason: 'all_companies_blocked' });
}
