/**
 * TradeLoop — Express + MySQL API + static HTML/CSS/JS (SRS prototype).
 */
require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");
const app = express();
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");

if (!fs.existsSync(path.join(__dirname, "public", "uploads"))) {
  fs.mkdirSync(path.join(__dirname, "public", "uploads"), { recursive: true });
}
const upload = multer({ dest: path.join(__dirname, "public", "uploads") });

const PORT = process.env.PORT || 3000;

const CATEGORIES = ["Books", "Electronics", "Essentials", "Others"];

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false
  },
  connectTimeout: 10000,
  enableKeepAlive: true,
  family: 4
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-only-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  next();
}

// --- Auth ---

app.post("/api/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (username.length < 2) {
    return res.status(400).json({ error: "Username too short" });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: "Password too short" });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.execute(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      [username, hash]
    );
    req.session.userId = r.insertId;
    req.session.username = username;
    return res.json({ ok: true, user: { id: r.insertId, username } });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "Username taken" });
    }
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const [rows] = await pool.execute(
    "SELECT id, username, password_hash FROM users WHERE username = ?",
    [username]
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid login" });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  return res.json({ ok: true, user: { id: user.id, username: user.username } });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  res.json({ user: { id: req.session.userId, username: req.session.username } });
});

// --- Products (SRS: browse, sell, buy) ---

app.get("/api/products/by-category/:category", async (req, res) => {
  const category = req.params.category;
  const [products] = await pool.execute(
    `SELECT p.id, p.name, p.category, p.description, p.price, p.image_url, p.created_at, p.seller_id, u.username AS seller_username
     FROM products p
     JOIN users u ON p.seller_id = u.id
     WHERE p.is_available = 1 AND p.category = ?
     ORDER BY p.created_at DESC`,
    [category]
  );
  res.json({ products: products.map(normalizeProduct) });
});

app.get("/api/products/search", async (req, res) => {
  const q = req.query.q || "";
  const likeQ = `%${q}%`;
  const [products] = await pool.execute(
    `SELECT p.id, p.name, p.category, p.description, p.price, p.image_url, p.created_at, p.seller_id, u.username AS seller_username
     FROM products p
     JOIN users u ON p.seller_id = u.id
     WHERE p.is_available = 1 AND p.name LIKE ?
     ORDER BY p.created_at DESC`,
    [likeQ]
  );
  res.json({ products: products.map(normalizeProduct) });
});

app.get("/api/products/recent", requireAuth, async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT p.id, p.name, p.category, p.price, p.description, p.is_available,
            p.image_url, p.phone_number, p.address, p.lat, p.lng,
            u.username AS seller_username
     FROM products p
     JOIN users u ON u.id = p.seller_id
     WHERE p.is_available = 1
     ORDER BY p.created_at DESC
     LIMIT 20`
  );
  res.json({ products: rows.map(normalizeProduct) });
});

app.get("/api/products/by-category/:category", requireAuth, async (req, res) => {
  const category = req.params.category;
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: "Unknown category" });
  }
  const [rows] = await pool.execute(
    `SELECT p.id, p.name, p.category, p.price, p.description, p.is_available,
            p.image_url, p.phone_number, p.address, p.lat, p.lng,
            u.username AS seller_username
     FROM products p
     JOIN users u ON u.id = p.seller_id
     WHERE p.category = ? AND p.is_available = 1
     ORDER BY p.created_at DESC`,
    [category]
  );
  res.json({ category, products: rows.map(normalizeProduct) });
});

app.get("/api/products/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Bad id" });
  }
  const [rows] = await pool.execute(
    `SELECT p.id, p.name, p.category, p.price, p.description, p.seller_id, p.buyer_id,
            p.is_available, p.created_at, p.sold_at,
            p.image_url, p.phone_number, p.address, p.lat, p.lng,
            s.username AS seller_username,
            b.username AS buyer_username
     FROM products p
     JOIN users s ON s.id = p.seller_id
     LEFT JOIN users b ON b.id = p.buyer_id
     WHERE p.id = ?`,
    [id]
  );
  const row = rows[0];
  if (!row) {
    return res.status(404).json({ error: "Not found" });
  }
  res.json({ product: normalizeProductDetail(row) });
});

app.post("/api/products", requireAuth, upload.single("image"), async (req, res) => {
  const name = String(req.body.name || "").trim();
  const category = String(req.body.category || "");
  const description = String(req.body.description || "").trim();
  const price = Number(req.body.price);
  const phone = String(req.body.phone || "").trim() || null;
  const address = String(req.body.address || "").trim() || null;
  const lat = req.body.lat ? Number(req.body.lat) : null;
  const lng = req.body.lng ? Number(req.body.lng) : null;

  let image_url = null;
  if (req.file) {
    image_url = "/uploads/" + req.file.filename;
  }

  if (!name) {
    return res.status(400).json({ error: "Name required" });
  }
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: "Invalid category" });
  }
  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: "Invalid price" });
  }
  const [r] = await pool.execute(
    `INSERT INTO products (name, category, price, description, seller_id, is_available, image_url, phone_number, address, lat, lng)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    [name.slice(0, 200), category, price.toFixed(2), description, req.session.userId, image_url, phone, address, lat, lng]
  );
  res.json({ ok: true, id: r.insertId });
});

app.post("/api/products/:id/buy", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Bad id" });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      "SELECT id, seller_id, is_available FROM products WHERE id = ? FOR UPDATE",
      [id]
    );
    const p = rows[0];
    if (!p) {
      await conn.rollback();
      return res.status(404).json({ error: "Not found" });
    }
    if (!p.is_available) {
      await conn.rollback();
      return res.status(400).json({ error: "Already pending or sold" });
    }
    if (p.seller_id === req.session.userId) {
      await conn.rollback();
      return res.status(400).json({ error: "Cannot buy your own item" });
    }
    // Set is_available = 0 and buyer_id, but leave sold_at NULL to signify "Pending" 
    await conn.execute(
      `UPDATE products SET is_available = 0, buyer_id = ? WHERE id = ?`,
      [req.session.userId, id]
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: "Server error" });
  } finally {
    conn.release();
  }
});

app.post("/api/products/:id/complete", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Bad id" });
  }
  const [rows] = await pool.execute(
    "SELECT seller_id, is_available, sold_at FROM products WHERE id = ?",
    [id]
  );
  if (!rows[0] || rows[0].seller_id !== req.session.userId) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  if (rows[0].sold_at !== null) {
    return res.status(400).json({ error: "Already completed" });
  }
  await pool.execute(
    "UPDATE products SET sold_at = UTC_TIMESTAMP() WHERE id = ?",
    [id]
  );
  res.json({ ok: true });
});


// --- Profile (SRS: listed + purchased) ---

app.get("/api/profile", requireAuth, async (req, res) => {
  const uid = req.session.userId;
  const [listed] = await pool.execute(
    `SELECT p.id, p.name, p.category, p.price, p.is_available
     FROM products p WHERE p.seller_id = ? AND p.is_available = 1
     ORDER BY p.created_at DESC`,
    [uid]
  );
  const [pending] = await pool.execute(
    `SELECT p.id, p.name, p.category, p.price, u.username AS buyer_username
     FROM products p
     LEFT JOIN users u ON u.id = p.buyer_id
     WHERE p.seller_id = ? AND p.is_available = 0 AND p.sold_at IS NULL
     ORDER BY p.created_at DESC`,
    [uid]
  );
  const [bought] = await pool.execute(
    `SELECT p.id, p.name, p.category, p.price, u.username AS seller_username, p.sold_at
     FROM products p
     JOIN users u ON u.id = p.seller_id
     WHERE p.buyer_id = ? AND p.is_available = 0 
     ORDER BY p.id DESC`,
    [uid]
  );
  res.json({
    user: { id: uid, username: req.session.username },
    listed: listed.map(normalizeProduct),
    pending: pending.map(row => ({ ...normalizeProduct(row), buyer_username: row.buyer_username })),
    bought: bought.map(row => ({ ...normalizeProduct(row), sold_at: row.sold_at })),
  });
});


app.get("/api/categories", (req, res) => {
  res.json({ categories: CATEGORIES });
});

function normalizeProduct(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    description: row.description,
    is_available: Boolean(row.is_available),
    seller_username: row.seller_username,
    image_url: row.image_url,
    phone_number: row.phone_number,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
  };
}
console.log(process.env.DB_HOST, process.env.DB_PORT);

function normalizeProductDetail(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    description: row.description,
    seller_id: row.seller_id,
    buyer_id: row.buyer_id,
    is_available: Boolean(row.is_available),
    seller_username: row.seller_username,
    buyer_username: row.buyer_username || null,
    image_url: row.image_url,
    phone_number: row.phone_number,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
  };
}

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on", PORT);
});
