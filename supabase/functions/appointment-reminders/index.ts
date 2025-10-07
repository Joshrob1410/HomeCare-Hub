// supabase/functions/appointment-reminders/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (_req) => {
  // `SUPABASE_URL` is provided by the platform automatically in Edge Functions
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  // Use a custom secret name (not starting with SUPABASE_)
  const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY")!;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const now = new Date();
  const londonNow = new Date(now.toLocaleString("en-GB", { timeZone: "Europe/London" }));
  const isoDate = londonNow.toISOString().slice(0, 10);

  const { data, error } = await supabase.rpc("send_appointment_reminders", { p_run_date: isoDate });
  if (error) {
    console.error("RPC failed", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }
  console.log("Reminders sent:", data);
  return new Response(JSON.stringify({ ok: true, sent: data }), { status: 200 });
});
