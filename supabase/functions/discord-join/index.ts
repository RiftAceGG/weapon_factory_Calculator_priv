// Weapon Factory — edge function: discord-join  (chatty version)
//
// Same as before, but prints a JOIN: line at every step so the Logs tab
// shows exactly where it stops. File must be named index.ts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
const GUILD_ID = Deno.env.get("DISCORD_GUILD_ID") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => {
  console.log("JOIN: replying", status, JSON.stringify(body));
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    console.log("JOIN: browser pre-check, ignoring");
    return new Response("ok", { headers: CORS });
  }

  console.log("JOIN: --- real call starting ---");
  console.log("JOIN: bot token present?", BOT_TOKEN ? "yes" : "NO");
  console.log("JOIN: guild id present?", GUILD_ID ? GUILD_ID : "NO");

  if (!BOT_TOKEN || !GUILD_ID) {
    return json({ error: "missing_secrets", bot: !!BOT_TOKEN, guild: !!GUILD_ID }, 500);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userData, error: userErr } = await supabase.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (userErr || !userData?.user) {
    console.log("JOIN: no signed-in user", userErr?.message);
    return json({ error: "not signed in" }, 401);
  }
  const user = userData.user;
  console.log("JOIN: user is", user.id);

  let providerToken: string | undefined;
  try {
    providerToken = (await req.json())?.provider_token;
  } catch {
    // no body
  }
  console.log("JOIN: discord token from site?", providerToken ? "yes" : "NO");
  if (!providerToken) return json({ error: "missing provider_token" }, 400);

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("discord_id")
    .eq("id", user.id)
    .single();

  if (profErr) console.log("JOIN: profile lookup error:", profErr.message);
  const discordId = profile?.discord_id;
  console.log("JOIN: discord id is", discordId ?? "MISSING");
  if (!discordId) return json({ error: "no discord_id on profile" }, 400);

  const res = await fetch(
    `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${discordId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ access_token: providerToken }),
    },
  );

  const detail = await res.text();
  console.log("JOIN: discord answered", res.status, detail || "(empty body)");

  if (res.status !== 201 && res.status !== 204) {
    return json({ error: "discord_rejected", status: res.status, detail }, 502);
  }

  const { error: upErr } = await supabase
    .from("profiles")
    .update({ guild_joined_at: new Date().toISOString() })
    .eq("id", user.id);
  if (upErr) console.log("JOIN: could not save timestamp:", upErr.message);

  return json({
    status: res.status === 201 ? "joined" : "already_member",
    note: res.status === 204 ? "they were already in the server" : "added them",
  });
});
