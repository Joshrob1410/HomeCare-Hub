import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const BodySchema = z.object({
  company_id: z.string().uuid(),
  status: z.enum(['ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED']).optional(),
  plan_code: z.string().min(1).max(128).optional(),
  seats: z.number().int().min(1).max(100000).optional(),
  valid_until: z.string().date().nullable().optional(), // ISO date 'YYYY-MM-DD' or null
  grace_period_days: z.number().int().min(0).max(3650).optional(),
  billing_customer_id: z.string().min(1).max(255).nullable().optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    const json = await req.json();
    body = BodySchema.parse(json);
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ('status' in body && body.status) update.status = body.status;
  if ('plan_code' in body && body.plan_code) update.plan_code = body.plan_code;
  if ('seats' in body && typeof body.seats === 'number') update.seats = body.seats;
  if ('valid_until' in body) update.valid_until = body.valid_until; // can be null
  if ('grace_period_days' in body && typeof body.grace_period_days === 'number') update.grace_period_days = body.grace_period_days;
  if ('billing_customer_id' in body) update.billing_customer_id = body.billing_customer_id; // can be null

  const { data, error } = await supabaseAdmin
    .from('company_licenses')
    .update(update)
    .eq('company_id', body.company_id)
    .select('company_id, status, plan_code, seats, valid_until, grace_period_days, billing_customer_id, updated_at')
    .maybeSingle();

  if (error || !data) {
    // eslint-disable-next-line no-console
    console.error(error);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, license: data });
}
