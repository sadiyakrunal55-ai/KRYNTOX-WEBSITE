const CORS_HEADERS = {
  "Content-Type": "application/json; charset=utf-8"
};

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS
  });
}

function base64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(value)
  );

  return base64url(new Uint8Array(signature));
}

async function createSession(env) {
  const payload = base64url(new TextEncoder().encode(
    JSON.stringify({
      admin: true,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000
    })
  ));

  return payload + "." + await sign(payload, env.SESSION_SECRET);
}

async function isAdmin(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/kryntox_session=([^;]+)/);

  if (!match || !env.SESSION_SECRET) return false;

  const parts = match[1].split(".");
  if (parts.length !== 2) return false;

  const expected = await sign(parts[0], env.SESSION_SECRET);
  if (expected !== parts[1]) return false;

  try {
    const payload = JSON.parse(
      atob(parts[0].replace(/-/g, "+").replace(/_/g, "/"))
    );

    return payload.admin === true && payload.exp > Date.now();
  } catch {
    return false;
  }
}

async function body(request) {
  return await request.json();
}

export async function onRequest({ request, env }) {
  if (!env.DB || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return response({ error: "Backend configuration missing." }, 500);
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "");
  const method = request.method;

  try {
    // ADMIN LOGIN
    if (path === "login" && method === "POST") {
      const data = await body(request);

      if (data.password !== env.ADMIN_PASSWORD) {
        return response({ error: "Incorrect password" }, 401);
      }

      const token = await createSession(env);

      return new Response(JSON.stringify({ success: true }), {
        headers: {
          ...CORS_HEADERS,
          "Set-Cookie":
            `kryntox_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`
        }
      });
    }

    // ADMIN LOGOUT
    if (path === "logout" && method === "POST") {
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          ...CORS_HEADERS,
          "Set-Cookie":
            "kryntox_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
        }
      });
    }

    // CHECK LOGIN
    if (path === "me" && method === "GET") {
      const loggedIn = await isAdmin(request, env);
      return response({ loggedIn });
    }

    // PUBLIC RESTAURANT MENU
    if (path.startsWith("menu/") && method === "GET") {
      const slug = decodeURIComponent(path.slice(5));

      const restaurant = await env.DB.prepare(
        "SELECT id,name,slug FROM restaurants WHERE slug=?"
      ).bind(slug).first();

      if (!restaurant) {
        return response({ error: "Menu not found" }, 404);
      }

      const items = await env.DB.prepare(
        "SELECT id,category,name,price FROM items WHERE restaurant_id=? AND active=1 ORDER BY sort_order,id"
      ).bind(restaurant.id).all();

      return response({
        restaurant,
        items: items.results
      });
    }

    // PRIVATE ADMIN ROUTES
    if (!(await isAdmin(request, env))) {
      return response({ error: "Unauthorized" }, 401);
    }

    // RESTAURANT LIST
    if (path === "restaurants" && method === "GET") {
      const result = await env.DB.prepare(
        "SELECT * FROM restaurants ORDER BY created_at DESC"
      ).all();

      return response(result.results);
    }

    // ADD RESTAURANT
    if (path === "restaurants" && method === "POST") {
      const data = await body(request);

      if (!data.name || !data.slug || !data.whatsapp) {
        return response({ error: "Name, slug and WhatsApp required" }, 400);
      }

      const id = crypto.randomUUID();

      await env.DB.prepare(
        "INSERT INTO restaurants (id,name,slug,whatsapp) VALUES (?,?,?,?)"
      ).bind(id, data.name, data.slug, data.whatsapp).run();

      return response({ success: true, id });
    }

    // EDIT OR DELETE RESTAURANT
    let match = path.match(/^restaurants\/([^/]+)$/);

    if (match && method === "PUT") {
      const data = await body(request);

      await env.DB.prepare(
        "UPDATE restaurants SET name=?,slug=?,whatsapp=? WHERE id=?"
      ).bind(data.name, data.slug, data.whatsapp, match[1]).run();

      return response({ success: true });
    }

    if (match && method === "DELETE") {
      await env.DB.prepare(
        "DELETE FROM restaurants WHERE id=?"
      ).bind(match[1]).run();

      return response({ success: true });
    }

    // LIST FOOD ITEMS
    if (path === "items" && method === "GET") {
      const restaurantId = url.searchParams.get("restaurant_id");

      if (!restaurantId) {
        return response({ error: "Restaurant ID required" }, 400);
      }

      const result = await env.DB.prepare(
        "SELECT * FROM items WHERE restaurant_id=? ORDER BY sort_order,id"
      ).bind(restaurantId).all();

      return response(result.results);
    }

    // ADD FOOD ITEM
    if (path === "items" && method === "POST") {
      const data = await body(request);

      if (!data.restaurant_id || !data.name ||
          !data.category || !Number.isFinite(Number(data.price)) ||
          Number(data.price) < 0) {
        return response({ error: "Invalid food item details" }, 400);
      }

      const id = crypto.randomUUID();

      await env.DB.prepare(
        "INSERT INTO items (id,restaurant_id,category,name,price) VALUES (?,?,?,?,?)"
      ).bind(
        id, data.restaurant_id, data.category,
        data.name, Number(data.price)
      ).run();

      return response({ success: true, id });
    }

    // EDIT OR DELETE FOOD ITEM
    match = path.match(/^items\/([^/]+)$/);

    if (match && method === "PUT") {
      const data = await body(request);

      await env.DB.prepare(
        "UPDATE items SET category=?,name=?,price=?,active=? WHERE id=?"
      ).bind(
        data.category, data.name, Number(data.price),
        data.active === false ? 0 : 1, match[1]
      ).run();

      return response({ success: true });
    }

    if (match && method === "DELETE") {
      await env.DB.prepare(
        "DELETE FROM items WHERE id=?"
      ).bind(match[1]).run();

      return response({ success: true });
    }

    return response({ error: "API route not found" }, 404);

  } catch (error) {
    return response({ error: "Server error" }, 500);
  }
}
