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
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );

  return base64url(new Uint8Array(signature));
}

async function createSession(env) {
  const payload = base64url(
    new TextEncoder().encode(JSON.stringify({
      admin: true,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000
    }))
  );

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
    let encoded = parts[0]
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    encoded += "=".repeat((4 - encoded.length % 4) % 4);

    const payload = JSON.parse(
      atob(encoded)
    );

    return payload.admin === true &&
      payload.exp > Date.now();
  } catch {
    return false;
  }
}

async function body(request) {
  return await request.json();
}

function makeSlug(name) {
  const slug = String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "restaurant";
}

export async function onRequest({ request, env }) {
  if (
    !env.DB ||
    !env.ADMIN_USERNAME ||
    !env.ADMIN_PASSWORD ||
    !env.SESSION_SECRET
  ) {
    return response({
      error: "Backend configuration missing."
    }, 500);
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "");
  const method = request.method;

  try {

    // ADMIN LOGIN
    if (path === "login" && method === "POST") {
      const data = await body(request);

      if (
        data.username !== env.ADMIN_USERNAME ||
        data.password !== env.ADMIN_PASSWORD
      ) {
        return response({
          error: "Incorrect username or password"
        }, 401);
      }

      const token = await createSession(env);

      return new Response(
        JSON.stringify({ success: true }),
        {
          headers: {
            ...CORS_HEADERS,
            "Set-Cookie":
              `kryntox_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`
          }
        }
      );
    }

    // ADMIN LOGOUT
    if (path === "logout" && method === "POST") {
      return new Response(
        JSON.stringify({ success: true }),
        {
          headers: {
            ...CORS_HEADERS,
            "Set-Cookie":
              "kryntox_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
          }
        }
      );
    }

    // CHECK LOGIN
    if (path === "me" && method === "GET") {
      return response({
        loggedIn: await isAdmin(request, env)
      });
    }

    // PUBLIC RESTAURANT MENU
    if (path.startsWith("menu/") && method === "GET") {
      const slug = decodeURIComponent(path.slice(5));

      const restaurant = await env.DB.prepare(
        "SELECT id,name,slug,whatsapp FROM restaurants WHERE slug=?"
      ).bind(slug).first();

      if (!restaurant) {
        return response({
          error: "Menu not found"
        }, 404);
      }

      const result = await env.DB.prepare(
        "SELECT id,category,name,price,photo FROM items WHERE restaurant_id=? AND active=1 ORDER BY sort_order,id"
      ).bind(restaurant.id).all();

      return response({
        restaurant,
        items: result.results
      });
    }

    // PRIVATE ADMIN ROUTES
    if (!(await isAdmin(request, env))) {
      return response({
        error: "Unauthorized"
      }, 401);
    }

    // LIST RESTAURANTS / MENUS
    if (path === "menus" && method === "GET") {
      const result = await env.DB.prepare(`
        SELECT
          r.*,
          COUNT(i.id) AS item_count
        FROM restaurants r
        LEFT JOIN items i
          ON i.restaurant_id = r.id
        GROUP BY r.id
        ORDER BY r.created_at DESC
      `).all();

      return response(result.results);
    }

    // ADD RESTAURANT
    if (path === "menus" && method === "POST") {
      const data = await body(request);

      if (!data.name || !data.whatsapp) {
        return response({
          error: "Restaurant name and WhatsApp required"
        }, 400);
      }

      const id = crypto.randomUUID();
      const base = makeSlug(data.name);

      let slug = base;
      let counter = 1;

      while (await env.DB.prepare(
        "SELECT id FROM restaurants WHERE slug=?"
      ).bind(slug).first()) {
        slug = `${base}-${counter++}`;
      }

      await env.DB.prepare(
        "INSERT INTO restaurants (id,name,slug,whatsapp) VALUES (?,?,?,?)"
      ).bind(
        id,
        data.name.trim(),
        slug,
        data.whatsapp.trim()
      ).run();

      return response({
        success: true,
        id,
        slug
      });
    }

    // EDIT / DELETE RESTAURANT
    let match = path.match(/^menus\/([^/]+)$/);

    if (match && method === "PUT") {
      const data = await body(request);

      if (!data.name || !data.whatsapp) {
        return response({
          error: "Restaurant name and WhatsApp required"
        }, 400);
      }

      await env.DB.prepare(
        "UPDATE restaurants SET name=?,whatsapp=? WHERE id=?"
      ).bind(
        data.name.trim(),
        data.whatsapp.trim(),
        match[1]
      ).run();

      return response({ success: true });
    }

    if (match && method === "DELETE") {
      await env.DB.prepare(
        "DELETE FROM restaurants WHERE id=?"
      ).bind(match[1]).run();

      return response({ success: true });
    }

    // LIST FOOD ITEMS
    match = path.match(/^menus\/([^/]+)\/items$/);

    if (match && method === "GET") {
      const result = await env.DB.prepare(
        "SELECT * FROM items WHERE restaurant_id=? ORDER BY sort_order,id"
      ).bind(match[1]).all();

      return response(result.results);
    }

    // ADD FOOD ITEM
    if (path === "items" && method === "POST") {
      const data = await body(request);

      if (
        !data.menu_id ||
        !data.name ||
        !data.category ||
        !Number.isFinite(Number(data.price)) ||
        Number(data.price) < 0
      ) {
        return response({
          error: "Invalid food item details"
        }, 400);
      }

      const restaurant = await env.DB.prepare(
        "SELECT id FROM restaurants WHERE id=?"
      ).bind(data.menu_id).first();

      if (!restaurant) {
        return response({
          error: "Restaurant not found"
        }, 404);
      }

      const id = crypto.randomUUID();

      await env.DB.prepare(
        `INSERT INTO items
        (id,restaurant_id,category,name,price,photo)
        VALUES (?,?,?,?,?,?)`
      ).bind(
        id,
        data.menu_id,
        data.category.trim(),
        data.name.trim(),
        Number(data.price),
        data.photo || null
      ).run();

      return response({
        success: true,
        id
      });
    }

    // EDIT / DELETE FOOD ITEM
    match = path.match(/^items\/([^/]+)$/);

    if (match && method === "PUT") {
      const data = await body(request);

      if (
        !data.name ||
        !data.category ||
        !Number.isFinite(Number(data.price)) ||
        Number(data.price) < 0
      ) {
        return response({
          error: "Invalid food item details"
        }, 400);
      }

      const existing = await env.DB.prepare(
        "SELECT photo FROM items WHERE id=?"
      ).bind(match[1]).first();

      if (!existing) {
        return response({
          error: "Food item not found"
        }, 404);
      }

      let photo = existing.photo;

      if (data.remove_photo === true) {
        photo = null;
      } else if (data.photo) {
        photo = data.photo;
      }

      await env.DB.prepare(
        `UPDATE items
         SET category=?,name=?,price=?,photo=?
         WHERE id=?`
      ).bind(
        data.category.trim(),
        data.name.trim(),
        Number(data.price),
        photo,
        match[1]
      ).run();

      return response({ success: true });
    }

    if (match && method === "DELETE") {
      await env.DB.prepare(
        "DELETE FROM items WHERE id=?"
      ).bind(match[1]).run();

      return response({ success: true });
    }

    return response({
      error: "API route not found"
    }, 404);

  } catch (error) {
    console.error("KRYNTOX API ERROR:", error);

    return response({
      error: "Server error"
    }, 500);
  }
}
