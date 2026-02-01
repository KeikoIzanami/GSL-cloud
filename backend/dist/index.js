"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const compression_1 = __importDefault(require("compression"));
const dotenv_1 = __importDefault(require("dotenv"));
const promise_1 = __importDefault(require("mysql2/promise"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = __importDefault(require("crypto"));
const http_1 = __importDefault(require("http"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const socket_io_1 = require("socket.io");
const nodemailer_1 = __importDefault(require("nodemailer"));
const node_cache_1 = __importDefault(require("node-cache"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const APP_VERSION = process.env.APP_VERSION || "0.1.0";
const APP_UPDATE_URL = process.env.APP_UPDATE_URL || "";
const APP_UPDATE_MANDATORY = process.env.APP_UPDATE_MANDATORY !== "false";
const APP_UPDATE_NOTES = process.env.APP_UPDATE_NOTES || "";
const APP_UPDATE_SHA256 = process.env.APP_UPDATE_SHA256 || "";
const CDN_BASE_URL = process.env.CDN_BASE_URL || "https://cdn.goslynk.online";
const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
// Retry helper for Steam API calls
async function fetchWithRetry(url, maxRetries = 3, baseDelay = 1000) {
    let lastError = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
            const response = await (0, node_fetch_1.default)(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                }
            });
            clearTimeout(timeout);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response;
        }
        catch (error) {
            lastError = error;
            console.warn(`Fetch attempt ${attempt + 1}/${maxRetries} failed for ${url}:`, error.message);
            // Don't retry on the last attempt
            if (attempt < maxRetries - 1) {
                // Exponential backoff with jitter
                const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw new Error(`Failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
}
app.use((0, compression_1.default)());
app.use((0, cors_1.default)({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use("/uploads", express_1.default.static(path_1.default.join(__dirname, "..", "uploads")));
app.get("/", (_req, res) => {
    res.json({
        success: true,
        message: "Goslynk Backend API",
        version: APP_VERSION,
        endpoints: {
            upload: "/upload-game",
            games: "/games",
            admin: "/admin"
        }
    });
});
app.get("/health", (_req, res) => {
    res.json({ success: true, status: "ok", timestamp: new Date().toISOString() });
});
const PORT = process.env.PORT || 3000;
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: true,
        credentials: true,
    },
});
const pool = promise_1.default.createPool({
    host: process.env.DB_HOST || "103.82.36.9",
    user: process.env.DB_USER || "eqcuplu_eirlysnguyen",
    password: process.env.DB_PASS || "zDH&na8R.0TV",
    database: process.env.DB_NAME || "eqcuplu_goslynk_unlock",
    connectionLimit: 20,
    waitForConnections: true,
    queueLimit: 0,
    maxIdle: 10000,
    idleTimeout: 60000
});
const logStream = fs_1.default.createWriteStream(path_1.default.join(__dirname, "log.txt"), {
    flags: "a",
});
const origError = console.error;
console.error = (...args) => {
    const line = `[${new Date().toISOString()}] ${args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ")}\n`;
    logStream.write(line);
    origError(...args);
};
const uploadDir = path_1.default.join(__dirname, "..", "uploads", "chat");
fs_1.default.mkdirSync(uploadDir, { recursive: true });
const dashboardCache = new node_cache_1.default({ stdTTL: 15, checkperiod: 30 });
const gameCheckCache = new node_cache_1.default({ stdTTL: 3600, checkperiod: 60 });
const parseManifestData = (data) => {
    if (!data)
        return null;
    if (typeof data === 'string') {
        try {
            return JSON.parse(data);
        }
        catch {
            return null;
        }
    }
    return data;
};
const extractAllDepotFiles = (manifestData) => {
    const depots = {};
    const files = [];
    if (!manifestData?.branch_manifests)
        return [depots, files];
    for (const branch in manifestData.branch_manifests) {
        const branchData = manifestData.branch_manifests[branch];
        if (branchData.files) {
            files.push(...branchData.files);
        }
        if (branchData.depots) {
            Object.assign(depots, branchData.depots);
        }
    }
    return [depots, files];
};
const compareManifestUpdates = (current, newData) => {
    const newTimestamp = newData.timestamp ? new Date(newData.timestamp) : null;
    if (!current?.updated_at)
        return true;
    const dbTime = new Date(current.updated_at);
    if (newTimestamp && newTimestamp.getTime() > dbTime.getTime())
        return true;
    const oldData = parseManifestData(current.manifest_data);
    if (!oldData?.timestamp)
        return true;
    const oldTimestamp = new Date(oldData.timestamp);
    if (newTimestamp && newTimestamp.getTime() > oldTimestamp.getTime())
        return true;
    const oldBranches = Object.keys(oldData.branch_manifests || {}).sort();
    const newBranches = Object.keys(newData.branch_manifests || {}).sort();
    if (JSON.stringify(oldBranches) !== JSON.stringify(newBranches))
        return true;
    for (const branch of newBranches) {
        const oldBranch = oldData.branch_manifests?.[branch] || {};
        const newBranch = newData.branch_manifests?.[branch] || {};
        if (JSON.stringify(oldBranch.depots || {}) !== JSON.stringify(newBranch.depots || {})) {
            return true;
        }
        if (JSON.stringify((oldBranch.files || []).sort()) !== JSON.stringify((newBranch.files || []).sort())) {
            return true;
        }
    }
    return false;
};
const compareDepotUpdates = (currentDepots, currentFiles, newData) => {
    const newBranchManifests = newData.branch_manifests || {};
    for (const branch in newBranchManifests) {
        const newBranch = newBranchManifests[branch] || {};
        const newDepots = newBranch.depots || {};
        const currentIds = Object.keys(currentDepots).sort();
        const newIds = Object.keys(newDepots).sort();
        if (JSON.stringify(currentIds) !== JSON.stringify(newIds))
            return true;
        for (const depotId in newDepots) {
            if (currentDepots[depotId] !== newDepots[depotId])
                return true;
        }
        const newFiles = (newBranch.files || []).sort();
        const currentFilesSorted = (currentFiles || []).sort();
        if (JSON.stringify(newFiles) !== JSON.stringify(currentFilesSorted))
            return true;
    }
    return false;
};
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname);
        const base = path_1.default.basename(file.originalname, ext);
        const safeBase = base.replace(/[^a-zA-Z0-9_-]/g, "_");
        const unique = `${Date.now()}-${crypto_1.default.randomBytes(6).toString("hex")}`;
        cb(null, `${safeBase}-${unique}${ext}`);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
});
app.get("/update/latest", (_req, res) => {
    res.json({
        success: true,
        version: APP_VERSION,
        url: APP_UPDATE_URL,
        mandatory: APP_UPDATE_MANDATORY,
        notes: APP_UPDATE_NOTES,
        sha256: APP_UPDATE_SHA256,
    });
});
app.get("/admin/games/list", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        const user = await getUserBySession(sessionId);
        if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const cached = gameCheckCache.get("admin_all_games_list");
        if (cached)
            return res.json(cached);
        const [rows] = await pool.query(`SELECT app_id, game_name, banner_url, tags, price, special_denuvo, nsfw
       FROM games
       ORDER BY created_at DESC`);
        const result = {
            success: true,
            data: rows,
            total: rows.length,
        };
        gameCheckCache.set("admin_all_games_list", result);
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to load games" });
    }
});
app.get("/games", async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 20));
        const offset = (page - 1) * limit;
        const filter = String(req.query.filter || "").toLowerCase();
        const tag = String(req.query.tag || "").trim();
        const cacheKey = `games_${filter}_${tag}_${page}_${limit}`;
        const cached = gameCheckCache.get(cacheKey);
        if (cached)
            return res.json(cached);
        const whereParts = [];
        const whereParams = [];
        if (filter === "news") {
            whereParts.push("(nsfw IS NULL OR nsfw = 0)");
        }
        else if (filter === "nsfw") {
            whereParts.push("nsfw = 1");
        }
        else if (filter === "denuvo") {
            whereParts.push("special_denuvo = 1");
        }
        if (tag) {
            whereParts.push("(tags LIKE ? OR tags LIKE ? OR tags LIKE ? OR tags LIKE ?)");
            whereParams.push(`%"${tag}"%`, `%${tag},%`, `%,${tag},%`, `%,${tag}"%`);
        }
        const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
        const [countResult] = (await pool.query(`SELECT COUNT(*) as total FROM games ${whereSql}`, whereParams));
        const total = Number(countResult[0]?.total || 0);
        const [rows] = await pool.query(`SELECT app_id, game_name, banner_url, tags, price, special_denuvo, nsfw
       FROM games
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`, [...whereParams, limit, offset]);
        const result = {
            data: rows,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.max(1, Math.ceil(total / limit)),
                hasNextPage: page * limit < total,
                hasPrevPage: page > 1,
            },
        };
        gameCheckCache.set(cacheKey, result);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ message: "Failed to load games" });
    }
});
app.get("/games/tags", async (req, res) => {
    try {
        const cacheKey = "all_game_tags";
        const cached = gameCheckCache.get(cacheKey);
        if (cached)
            return res.json(cached);
        const [rows] = await pool.query(`SELECT DISTINCT tags FROM games WHERE tags IS NOT NULL AND tags != ''`);
        const tagCounts = new Map();
        rows.forEach((row) => {
            if (row.tags) {
                try {
                    const parsed = JSON.parse(row.tags);
                    if (Array.isArray(parsed)) {
                        parsed.forEach((tag) => {
                            if (tag && typeof tag === "string") {
                                const trimmed = tag.trim();
                                tagCounts.set(trimmed, (tagCounts.get(trimmed) || 0) + 1);
                            }
                        });
                    }
                }
                catch {
                    const tags = String(row.tags).split(",");
                    tags.forEach((tag) => {
                        const trimmed = tag.trim();
                        if (trimmed) {
                            tagCounts.set(trimmed, (tagCounts.get(trimmed) || 0) + 1);
                        }
                    });
                }
            }
        });
        const popularTags = Array.from(tagCounts.entries())
            .filter(([_, count]) => count >= 20)
            .map(([tag, _]) => tag)
            .sort();
        const result = {
            success: true,
            tags: popularTags,
        };
        gameCheckCache.set(cacheKey, result, 3600);
        res.json(result);
    }
    catch (err) {
        console.error("Error fetching tags:", err);
        res.status(500).json({ success: false, message: "Failed to load tags" });
    }
});
app.post("/upload/chat-file", upload.single("file"), async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.body?.sessionId;
        const user = await getUserBySession(sessionId || "");
        if (!user) {
            return res.status(401).json({ message: "Chưa đăng nhập" });
        }
        if (!req.file) {
            return res.status(400).json({ message: "Không có file" });
        }
        const file = req.file;
        const publicPath = `/uploads/chat/${file.filename}`;
        // Use CDN URL if available, otherwise fallback to API URL
        const cdnUrl = CDN_BASE_URL ? `${CDN_BASE_URL}${publicPath}` : `${API_BASE_URL}${publicPath}`;
        res.json({
            success: true,
            file: {
                path: publicPath,
                cdnPath: cdnUrl,
                name: file.originalname,
                mime: file.mimetype,
                size: file.size,
            },
        });
    }
    catch (err) {
        res.status(500).json({ message: "Upload thất bại" });
    }
});
app.get("/games/:app_id", async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT app_id, game_name, banner_url, tags, price, special_denuvo, nsfw FROM games WHERE app_id = ? LIMIT 1", [req.params.app_id]);
        const result = rows[0];
        if (!result) {
            return res.status(404).json({ message: "Game not found" });
        }
        pool.query("UPDATE games SET view_count = COALESCE(view_count, 0) + 1, last_viewed_at = NOW() WHERE app_id = ?", [req.params.app_id]).catch(() => { });
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ message: "Failed to load game" });
    }
});
// PUT /games/:app_id - Update game info
app.put("/games/:app_id", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.query.sessionId;
        if (!sessionId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const [userRows] = await pool.query("SELECT id, role FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
            return res.status(403).json({ message: "Admin access required" });
        }
        const { game_name, banner_url } = req.body;
        const app_id = req.params.app_id;
        if (!game_name || !banner_url) {
            return res.status(400).json({ message: "game_name and banner_url required" });
        }
        // Check if game exists
        const [existRows] = await pool.query("SELECT app_id FROM games WHERE app_id = ? LIMIT 1", [app_id]);
        if (existRows.length === 0) {
            // Create new game if not exists
            await pool.query("INSERT INTO games (app_id, game_name, banner_url) VALUES (?, ?, ?)", [app_id, game_name, banner_url]);
        }
        else {
            // Update existing game
            await pool.query("UPDATE games SET game_name = ?, banner_url = ?, updated_at = NOW() WHERE app_id = ?", [game_name, banner_url, app_id]);
        }
        res.json({ success: true, message: "Game updated successfully" });
    }
    catch (err) {
        console.error("Error updating game:", err);
        res.status(500).json({ message: "Failed to update game" });
    }
});
// GET /games/:app_id/files - List all files for a game
app.get("/games/:app_id/files", async (req, res) => {
    try {
        const appId = req.params.app_id;
        const gameStoragePath = process.env.GAME_STORAGE_PATH || "C:\\Users\\Administrator\\Downloads\\game";
        const appIdDir = path_1.default.join(gameStoragePath, appId);
        // Check if directory exists
        if (!fs_1.default.existsSync(appIdDir)) {
            return res.json({ files: [] });
        }
        // Recursively scan all files in the directory
        const files = [];
        function scanDirectory(dir, baseDir, relativePath = "") {
            try {
                const entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path_1.default.join(dir, entry.name);
                    const relativeFilePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
                    if (entry.isDirectory()) {
                        // Recursively scan subdirectories
                        scanDirectory(fullPath, baseDir, relativeFilePath);
                    }
                    else if (entry.isFile()) {
                        try {
                            const stats = fs_1.default.statSync(fullPath);
                            files.push({
                                name: relativeFilePath.replace(/\\/g, "/"), // Normalize to forward slashes
                                size: stats.size,
                                modified: stats.mtimeMs, // Return as milliseconds timestamp
                            });
                        }
                        catch (statErr) {
                            console.error(`[GET /games/:app_id/files] Failed to stat file: ${fullPath}`, statErr);
                        }
                    }
                }
            }
            catch (readErr) {
                console.error(`[GET /games/:app_id/files] Failed to read directory: ${dir}`, readErr);
            }
        }
        scanDirectory(appIdDir, appIdDir);
        res.json({ files });
    }
    catch (err) {
        console.error("[GET /games/:app_id/files] Error:", err);
        res.status(500).json({ success: false, message: err.message || "Failed to list game files" });
    }
});
// GET /games/:app_id/file/* - Download a specific game file
// Parse file path from URL manually since Express doesn't support wildcards well
app.get("/games/:app_id/file/*", async (req, res) => {
    try {
        const appId = req.params.app_id;
        const urlMatch = req.url.match(/^\/games\/[^\/]+\/file\/(.+)$/);
        if (!urlMatch || !urlMatch[1]) {
            return res.status(400).json({ success: false, message: "File path is required" });
        }
        const filePath = decodeURIComponent(urlMatch[1]);
        const gameStoragePath = process.env.GAME_STORAGE_PATH || "C:\\Users\\Administrator\\Downloads\\game";
        const appIdDir = path_1.default.join(gameStoragePath, appId);
        const normalizedPath = filePath.replace(/\//g, path_1.default.sep);
        const fullFilePath = path_1.default.join(appIdDir, normalizedPath);
        const resolvedPath = path_1.default.resolve(fullFilePath);
        const resolvedAppIdDir = path_1.default.resolve(appIdDir);
        if (!resolvedPath.startsWith(resolvedAppIdDir)) {
            console.error(`[GET /games/:app_id/file/*] Directory traversal attempt: ${filePath}`);
            return res.status(403).json({ success: false, message: "Access denied" });
        }
        if (!fs_1.default.existsSync(resolvedPath)) {
            console.error(`[GET /games/:app_id/file/*] File not found: ${resolvedPath}`);
            return res.status(404).json({ success: false, message: "File not found" });
        }
        const stats = fs_1.default.statSync(resolvedPath);
        if (!stats.isFile()) {
            return res.status(400).json({ success: false, message: "Path is not a file" });
        }
        const ext = path_1.default.extname(resolvedPath).toLowerCase();
        const contentTypeMap = {
            ".lua": "text/plain",
            ".manifest": "application/octet-stream",
            ".zip": "application/zip",
            ".json": "application/json",
        };
        const contentType = contentTypeMap[ext] || "application/octet-stream";
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Length", stats.size);
        res.setHeader("Last-Modified", stats.mtime.toUTCString());
        res.setHeader("Cache-Control", "public, max-age=3600");
        // Stream the file
        const fileStream = fs_1.default.createReadStream(resolvedPath);
        fileStream.pipe(res);
        fileStream.on("error", (err) => {
            console.error(`[GET /games/:app_id/file/*] Error streaming file: ${resolvedPath}`, err);
            if (!res.headersSent) {
                res.status(500).json({ success: false, message: "Failed to read file" });
            }
        });
    }
    catch (err) {
        console.error("[GET /games/:app_id/file/*] Error:", err);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: err.message || "Failed to serve file" });
        }
    }
});
app.get("/games/featured", async (_req, res) => {
    try {
        const cached = gameCheckCache.get("featured_games");
        if (cached)
            return res.json(cached);
        const [rows] = await pool.query(`SELECT 
        g.app_id,
        g.game_name,
        g.banner_url,
        g.tags,
        g.price,
        g.special_denuvo,
        g.nsfw,
        (SELECT COUNT(*) FROM user_games WHERE game_id = g.app_id) +
        (SELECT COUNT(*) FROM user_games_log WHERE app_id = g.app_id AND source = 'purchase') AS purchases
      FROM games g
      WHERE g.special_denuvo = 0
      ORDER BY purchases DESC, g.created_at DESC
      LIMIT 5`);
        const result = rows.map((g) => ({
            app_id: g.app_id,
            game_name: g.game_name,
            banner_url: g.banner_url,
            tags: g.tags,
            price: g.price,
            special_denuvo: g.special_denuvo,
            nsfw: g.nsfw,
        }));
        gameCheckCache.set("featured_games", result);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ message: "Failed to load featured games" });
    }
});
app.put("/admin/games/:app_id", async (req, res) => {
    try {
        const appId = req.params.app_id;
        const { game_name, price, special_denuvo } = req.body || {};
        const fields = [];
        const params = [];
        if (typeof game_name === "string" && game_name.trim()) {
            fields.push("game_name = ?");
            params.push(game_name.trim());
        }
        if (typeof price === "number" && !Number.isNaN(price) && price >= 0) {
            fields.push("price = ?");
            params.push(price);
        }
        if (typeof special_denuvo === "number" && (special_denuvo === 0 || special_denuvo === 1)) {
            fields.push("special_denuvo = ?");
            params.push(special_denuvo);
        }
        if (!fields.length) {
            return res.status(400).json({ success: false, message: "No data to update" });
        }
        params.push(appId);
        await pool.query(`UPDATE games SET ${fields.join(", ")} WHERE app_id = ?`, params);
        gameCheckCache.del("admin_all_games_list");
        res.json({ success: true });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to update game" });
    }
});
app.post("/admin/games/:app_id/skiplog", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        const user = await getUserBySession(sessionId);
        if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const appId = req.params.app_id;
        const reason = req.body.reason || "Deleted from admin panel";
        await pool.query("INSERT INTO skiplog (app_id, reason) VALUES (?, ?) ON DUPLICATE KEY UPDATE reason = VALUES(reason)", [appId, reason]);
        res.json({ success: true });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to add to skiplog" });
    }
});
app.delete("/admin/games/:app_id", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        const user = await getUserBySession(sessionId);
        if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const appId = req.params.app_id;
        await pool.query("DELETE FROM games WHERE app_id = ? LIMIT 1", [appId]);
        gameCheckCache.del("admin_all_games_list");
        res.json({ success: true });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to delete game" });
    }
});
app.post("/admin/games", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        const user = await getUserBySession(sessionId);
        if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const { app_id, game_name, price, special_denuvo, banner_url } = req.body || {};
        if (!app_id || !game_name) {
            return res.status(400).json({ success: false, message: "app_id and game_name are required" });
        }
        const finalPrice = Number(price) || 0;
        const denuvoValue = Number(special_denuvo) || 0;
        const bannerUrl = banner_url || null;
        await pool.query("INSERT INTO games (app_id, game_name, banner_url, tags, price, special_denuvo) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE game_name = VALUES(game_name), banner_url = VALUES(banner_url), price = VALUES(price), special_denuvo = VALUES(special_denuvo)", [app_id, game_name, bannerUrl, null, finalPrice, denuvoValue]);
        gameCheckCache.del("admin_all_games_list");
        res.json({ success: true });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to add game" });
    }
});
function detectDenuvoFromJSON(gameData) {
    try {
        const drmNotice = gameData.drm_notice || "";
        const platforms = JSON.stringify(gameData.platforms || {});
        const requirements = JSON.stringify(gameData.pc_requirements || {});
        const fullText = (drmNotice + " " + platforms + " " + requirements).toLowerCase();
        return fullText.includes("denuvo");
    }
    catch (e) {
        return false;
    }
}
function detectDenuvoFromHTML(html) {
    if (!html || typeof html !== "string")
        return false;
    const htmlLower = html.toLowerCase();
    if (htmlLower.includes("denuvo anti-tamper") ||
        htmlLower.includes("incorporates 3rd-party drm: denuvo") ||
        htmlLower.includes("3rd-party drm: denuvo") ||
        htmlLower.includes("incorporates denuvo") ||
        htmlLower.includes("uses denuvo")) {
        return true;
    }
    const drmNoticeRegex = /<div[^>]*class="[^"]*DRM_notice[^"]*"[^>]*>([^<]*(?:<[^>]+>[^<]*)*?)<\/div>/gi;
    const matches = [...html.matchAll(drmNoticeRegex)];
    for (const match of matches) {
        const content = match[1] || "";
        const textContent = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
        if (textContent.includes("denuvo anti-tamper") ||
            textContent.includes("denuvo") ||
            textContent.includes("3rd-party drm: denuvo") ||
            textContent.includes("incorporates 3rd-party drm: denuvo")) {
            return true;
        }
    }
    const drmSectionRegex = /<div[^>]*class="[^"]*game_area_drm_section[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    const drmMatches = [...html.matchAll(drmSectionRegex)];
    for (const match of drmMatches) {
        const content = match[1] || "";
        const textContent = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
        if (textContent.includes("denuvo") ||
            textContent.includes("3rd-party drm: denuvo") ||
            textContent.includes("incorporates 3rd-party drm: denuvo")) {
            return true;
        }
    }
    return false;
}
function parseSteamPrice(html) {
    try {
        const priceMatch = html.match(/data-price-final="(\d+)"/i);
        if (priceMatch && priceMatch[1]) {
            const priceInCents = parseInt(priceMatch[1], 10);
            return priceInCents / 100;
        }
        const priceMatch2 = html.match(/class="[^"]*game_purchase_price[^"]*"[^>]*>([^<]+)</i);
        if (priceMatch2) {
            const priceText = priceMatch2[1].trim();
            const freeMatch = priceText.match(/free/i);
            if (freeMatch)
                return 0;
            const numberMatch = priceText.match(/[\d,]+/);
            if (numberMatch) {
                const price = parseFloat(numberMatch[0].replace(/,/g, ""));
                if (!isNaN(price))
                    return price;
            }
        }
        return null;
    }
    catch (err) {
        return null;
    }
}
function parseSteamTags(html) {
    try {
        const tags = [];
        const tagRegex = /<a[^>]*class="[^"]*app_tag[^"]*"[^>]*>([^<]+)<\/a>/gi;
        const matches = [...html.matchAll(tagRegex)];
        for (const match of matches) {
            const tag = match[1].trim();
            if (tag && !tags.includes(tag)) {
                tags.push(tag);
            }
            if (tags.length >= 5)
                break;
        }
        return tags.join(",");
    }
    catch (err) {
        return "";
    }
}
async function fetchAndUpdateGameInfo(appId) {
    try {
        const apiUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}`;
        const response = await (0, node_fetch_1.default)(apiUrl);
        if (!response.ok) {
            console.error(`Failed to fetch Steam API for ${appId}: ${response.status}`);
            return;
        }
        const data = await response.json();
        const appData = data[appId];
        if (!appData || !appData.success) {
            console.error(`Steam API returned error for ${appId}`);
            return;
        }
        const gameData = appData.data;
        const name = gameData.name || `Game ${appId}`;
        const bannerUrl = gameData.header_image || null;
        const tags = [];
        if (gameData.genres && Array.isArray(gameData.genres)) {
            for (const genre of gameData.genres) {
                if (genre.description && tags.length < 5) {
                    tags.push(genre.description);
                }
                if (tags.length >= 5)
                    break;
            }
        }
        const tagsString = tags.join(",");
        let originalPrice = null;
        if (gameData.price_overview) {
            originalPrice = gameData.price_overview.final / 100;
        }
        else if (gameData.is_free) {
            originalPrice = 0;
        }
        const hasDenuvo = detectDenuvoFromJSON(gameData);
        let finalPrice = 5000.00;
        if (originalPrice !== null && originalPrice > 0) {
            finalPrice = originalPrice * 0.2;
        }
        if (finalPrice < 10000) {
            finalPrice = 0;
        }
        await pool.query("INSERT INTO games (app_id, game_name, banner_url, tags, price, special_denuvo) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE game_name = VALUES(game_name), banner_url = VALUES(banner_url), tags = VALUES(tags), price = VALUES(price), special_denuvo = VALUES(special_denuvo)", [appId, name, bannerUrl, tagsString, finalPrice, hasDenuvo ? 1 : 0]);
    }
    catch (err) {
        console.error(`Failed to update game info for ${appId}:`, err);
    }
}
app.get("/steam/game-info/:app_id", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        const user = await getUserBySession(sessionId);
        if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const appId = req.params.app_id;
        const apiUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}`;
        const response = await fetchWithRetry(apiUrl);
        if (!response.ok) {
            return res.status(404).json({ success: false, message: "Game not found on Steam" });
        }
        const data = await response.json();
        const appData = data[appId];
        if (!appData || !appData.success) {
            return res.status(404).json({ success: false, message: "Game not found on Steam" });
        }
        const gameData = appData.data;
        const name = gameData.name || `Game ${appId}`;
        const bannerUrl = gameData.header_image || null;
        const tags = [];
        if (gameData.genres && Array.isArray(gameData.genres)) {
            for (const genre of gameData.genres) {
                if (genre.description && tags.length < 5) {
                    tags.push(genre.description);
                }
                if (tags.length >= 5)
                    break;
            }
        }
        const tagsString = tags.join(",");
        let originalPrice = null;
        if (gameData.price_overview) {
            originalPrice = gameData.price_overview.final / 100;
        }
        else if (gameData.is_free) {
            originalPrice = 0;
        }
        const hasDenuvo = detectDenuvoFromJSON(gameData);
        res.json({
            success: true,
            data: {
                name,
                hasDenuvo,
                bannerUrl,
                originalPrice,
                tags: tagsString,
            },
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to fetch game info" });
    }
});
const gameUploadDir = path_1.default.join(__dirname, "..", "uploads", "games");
fs_1.default.mkdirSync(gameUploadDir, { recursive: true });
const gameStorage = multer_1.default.memoryStorage();
const gameUpload = (0, multer_1.default)({
    storage: gameStorage,
    limits: { fileSize: 500 * 1024 * 1024 },
});
app.post("/admin/games/upload", gameUpload.array("files", 100), async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        const user = await getUserBySession(sessionId);
        if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ success: false, message: "No files uploaded" });
        }
        const appId = req.body.appId;
        if (!appId) {
            return res.status(400).json({ success: false, message: "appId is required" });
        }
        const buildFormData = () => {
            const FormData = require("form-data");
            const formData = new FormData();
            const relativePaths = [];
            const body = req.body;
            for (const key in body) {
                if (key.startsWith("relativePath_")) {
                    relativePaths.push(body[key]);
                }
            }
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const relativePath = relativePaths[i] || file.originalname;
                formData.append("files", Buffer.from(file.buffer), {
                    filename: relativePath,
                });
                formData.append(`relativePath_${file.originalname}`, relativePath);
            }
            formData.append("appId", appId);
            return formData;
        };
        const vpsBaseUrl = process.env.VPS_BASE_URL || "http://161.248.239.223:3000";
        const vpsUploadEndpoint = process.env.VPS_UPLOAD_ENDPOINT || "/upload-game";
        const vpsUrl = `${vpsBaseUrl}${vpsUploadEndpoint}`;
        const formData = buildFormData();
        console.log(`Uploading to VPS: ${vpsUrl}`);
        const uploadResponse = await (0, node_fetch_1.default)(vpsUrl, {
            method: "POST",
            body: formData,
            headers: formData.getHeaders(),
        });
        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            throw new Error(`Failed to upload to VPS: ${uploadResponse.status} ${errorText}`);
        }
        res.json({ success: true, message: "Files uploaded to VPS successfully" });
    }
    catch (err) {
        console.error("Upload error:", err);
        res.status(500).json({ success: false, message: "Failed to upload files" });
    }
});
// New endpoint for folder upload
app.post("/admin/games/upload-folder", gameUpload.array("files", 500), async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        const user = await getUserBySession(sessionId);
        if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ success: false, message: "No files uploaded" });
        }
        const appId = req.body.app_id;
        if (!appId) {
            return res.status(400).json({ success: false, message: "app_id is required" });
        }
        const FormData = require("form-data");
        const formData = new FormData();
        for (const file of files) {
            formData.append("files", file.buffer, {
                filename: file.originalname,
                contentType: file.mimetype,
            });
        }
        formData.append("appId", appId);
        const vpsBaseUrl = process.env.VPS_BASE_URL || "http://161.248.239.223:3000";
        const vpsUrl = `${vpsBaseUrl}/upload-game`;
        const uploadResponse = await (0, node_fetch_1.default)(vpsUrl, {
            method: "POST",
            body: formData,
            headers: formData.getHeaders(),
        });
        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            console.error("VPS upload failed:", errorText);
            throw new Error(`Failed to upload to VPS: ${uploadResponse.status}`);
        }
        res.json({ success: true, message: `Uploaded ${files.length} files to VPS successfully` });
    }
    catch (err) {
        console.error("Upload folder error:", err);
        res.status(500).json({ success: false, message: "Failed to upload folder" });
    }
});
// Fetch Steam game info endpoint
app.get("/admin/games/fetch-steam-info/:appId", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        const user = await getUserBySession(sessionId);
        if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const { appId } = req.params;
        if (!appId) {
            return res.status(400).json({ success: false, message: "appId is required" });
        }
        // Fetch from Steam API with retry
        const steamUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=english`;
        const response = await fetchWithRetry(steamUrl);
        if (!response.ok) {
            throw new Error("Failed to fetch from Steam");
        }
        const json = await response.json();
        const gameData = json[appId];
        if (!gameData || !gameData.success) {
            return res.status(404).json({ success: false, message: "Game not found on Steam" });
        }
        const data = gameData.data;
        // Detect Denuvo
        let hasDenuvo = false;
        try {
            const pageResponse = await fetchWithRetry(`https://store.steampowered.com/app/${appId}`, 2, 500);
            if (pageResponse.ok) {
                const html = await pageResponse.text();
                hasDenuvo = detectDenuvoFromHTML(html) || detectDenuvoFromJSON(data);
            }
        }
        catch (e) {
            hasDenuvo = detectDenuvoFromJSON(data);
        }
        // Extract price
        let priceFormatted = "0";
        if (data.price_overview) {
            priceFormatted = String(data.price_overview.final / 100);
        }
        else if (data.is_free) {
            priceFormatted = "0";
        }
        res.json({
            success: true,
            data: {
                name: data.name,
                header_image: data.header_image,
                price_overview: data.price_overview,
                has_denuvo: hasDenuvo,
                is_free: data.is_free || false,
                short_description: data.short_description,
            },
        });
    }
    catch (err) {
        console.error("Fetch Steam info error:", err);
        res.status(500).json({ success: false, message: "Failed to fetch Steam info" });
    }
});
app.post("/upload-game", gameUpload.array("files", 100), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ success: false, message: "No files uploaded" });
        }
        const appId = req.body.appId;
        if (!appId) {
            return res.status(400).json({ success: false, message: "appId is required" });
        }
        const relativePaths = [];
        const body = req.body;
        for (const key in body) {
            if (key.startsWith("relativePath_")) {
                relativePaths.push(body[key]);
            }
        }
        const gameStoragePath = process.env.GAME_STORAGE_PATH || "C:\\Users\\Administrator\\Downloads\\game";
        const appIdDir = path_1.default.join(gameStoragePath, appId);
        fs_1.default.mkdirSync(appIdDir, { recursive: true });
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            let relativePath = relativePaths[i] || file.originalname;
            const pathParts = relativePath.split(/[/\\]/);
            if (pathParts.length > 0 && pathParts[0] === appId) {
                relativePath = pathParts.slice(1).join(path_1.default.sep);
            }
            const filePath = path_1.default.join(appIdDir, relativePath);
            const fileDir = path_1.default.dirname(filePath);
            fs_1.default.mkdirSync(fileDir, { recursive: true });
            fs_1.default.writeFileSync(filePath, file.buffer);
        }
        res.json({ success: true, message: "Files uploaded successfully", appId });
    }
    catch (err) {
        console.error("Upload game error:", err);
        res.status(500).json({ success: false, message: err.message || "Failed to upload files" });
    }
});
app.post("/admin/games/upgame-ryu", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        const user = await getUserBySession(sessionId);
        if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const ryuGamesUrl = "https://generator.ryuu.lol/files/games.json";
        const ryuResponse = await (0, node_fetch_1.default)(ryuGamesUrl);
        if (!ryuResponse.ok) {
            return res.status(500).json({ success: false, message: "Failed to fetch games.json from ryu" });
        }
        const ryuGames = await ryuResponse.json();
        if (!Array.isArray(ryuGames)) {
            return res.status(500).json({ success: false, message: "Invalid games.json format" });
        }
        const [skipRows] = await pool.query("SELECT app_id FROM skiplog");
        const skipList = new Set(skipRows.map((row) => row.app_id));
        const [existingRows] = await pool.query("SELECT app_id FROM games");
        const existingGames = new Set(existingRows.map((row) => String(row.app_id)));
        console.log(`[Upgame Ryu] Starting upgame process. Total games in ryu: ${ryuGames.length}, Skipped: ${skipList.size}, Existing: ${existingGames.size}`);
        const results = {
            total: ryuGames.length,
            skipped: 0,
            success: 0,
            failed: 0,
            errors: [],
        };
        for (const ryuGame of ryuGames) {
            const appId = String(ryuGame.appid || "");
            if (!appId)
                continue;
            if (skipList.has(appId)) {
                results.skipped++;
                continue;
            }
            if (existingGames.has(appId)) {
                results.skipped++;
                continue;
            }
            const gameName = String(ryuGame.name || "").toLowerCase();
            if (gameName.endsWith("demo")) {
                try {
                    await pool.query("INSERT INTO skiplog (app_id, reason) VALUES (?, ?) ON DUPLICATE KEY UPDATE reason = VALUES(reason)", [appId, "Game name ends with 'demo'"]);
                }
                catch (skipErr) {
                    console.error(`[Upgame Ryu] Failed to add demo game to skiplog: ${appId}`, skipErr);
                }
                results.skipped++;
                continue;
            }
            try {
                const delayBefore = 3000 + Math.floor(Math.random() * 1000) + 1000;
                await new Promise(resolve => setTimeout(resolve, delayBefore));
                const steamApiUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}`;
                const steamResponse = await fetchWithRetry(steamApiUrl, 2, 1000);
                if (!steamResponse.ok) {
                    throw new Error(`Steam API returned ${steamResponse.status}`);
                }
                const steamData = await steamResponse.json();
                const delayAfter = 3000 + Math.floor(Math.random() * 1000) + 1000;
                await new Promise(resolve => setTimeout(resolve, delayAfter));
                const appData = steamData[appId];
                if (!appData || !appData.success) {
                    throw new Error("Steam API returned error");
                }
                const gameData = appData.data;
                if (!gameData) {
                    throw new Error("Game data is null or undefined");
                }
                let name = gameData.name || "";
                if (!name || name.trim() === "") {
                    name = ryuGame.name || "";
                }
                if (!name || name.trim() === "") {
                    throw new Error("Game name is empty");
                }
                name = name.trim();
                if (name.length > 255) {
                    name = name.substring(0, 255);
                }
                const bannerUrl = gameData.header_image || null;
                const tags = [];
                if (gameData.genres && Array.isArray(gameData.genres)) {
                    for (const genre of gameData.genres) {
                        if (genre && genre.description && tags.length < 5) {
                            tags.push(genre.description.trim());
                        }
                        if (tags.length >= 5)
                            break;
                    }
                }
                const tagsString = tags.join(",");
                let originalPriceVND = null;
                if (gameData.is_free === true) {
                    originalPriceVND = 0;
                }
                else if (gameData.price_overview) {
                    const priceOverview = gameData.price_overview;
                    const currency = (priceOverview.currency || "").toUpperCase();
                    const priceInitial = priceOverview.initial || priceOverview.final || 0;
                    if (priceInitial > 0) {
                        const priceInCurrency = priceInitial / 100;
                        if (currency === "VND") {
                            originalPriceVND = Math.round(priceInCurrency);
                        }
                        else if (currency === "USD") {
                            originalPriceVND = Math.round(priceInCurrency * 25000);
                        }
                        else {
                            const priceUSD = priceInCurrency;
                            originalPriceVND = Math.round(priceUSD * 25000);
                        }
                    }
                }
                let finalPrice = 0;
                if (originalPriceVND !== null && originalPriceVND > 0) {
                    finalPrice = Math.round(originalPriceVND * 0.2);
                    if (finalPrice < 10000) {
                        finalPrice = 0;
                    }
                }
                else if (originalPriceVND === 0) {
                    finalPrice = 0;
                }
                finalPrice = Math.max(0, Math.min(9999999999.99, finalPrice));
                const hasDenuvo = detectDenuvoFromJSON(gameData);
                const nsfw = ryuGame.nsfw === true ? 1 : 0;
                if (!appId || appId.trim() === "") {
                    throw new Error("App ID is empty");
                }
                const trimmedAppId = appId.trim().substring(0, 32);
                const trimmedName = name.substring(0, 255);
                const trimmedBannerUrl = bannerUrl ? bannerUrl.substring(0, 512) : null;
                try {
                    const [insertResult] = await pool.query("INSERT INTO games (app_id, game_name, banner_url, tags, price, special_denuvo, nsfw) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE game_name = VALUES(game_name), banner_url = VALUES(banner_url), tags = VALUES(tags), price = VALUES(price), special_denuvo = VALUES(special_denuvo), nsfw = VALUES(nsfw), updated_at = CURRENT_TIMESTAMP", [trimmedAppId, trimmedName, trimmedBannerUrl, tagsString || null, finalPrice, hasDenuvo ? 1 : 0, nsfw]);
                    console.log(`[Upgame Ryu] Success: ${appId} - ${name} | Original Price: ${originalPriceVND !== null ? originalPriceVND.toLocaleString() + " VND" : "N/A"} | Final Price: ${finalPrice > 0 ? finalPrice.toLocaleString() + " VND" : "FREE"} | Denuvo: ${hasDenuvo} | NSFW: ${nsfw} | Insert result:`, insertResult);
                }
                catch (insertErr) {
                    console.error(`[Upgame Ryu] Database insert error for ${appId}:`, insertErr);
                    throw new Error(`Failed to insert game into database: ${insertErr.message}`);
                }
                try {
                    const discordWebhookUrl = "https://discord.com/api/webhooks/1436331667437518950/j_LMnf9p_4AGXNNW1NrHUZDywolrneA1QYBjL1LH7K2MBP-qgDzv-cJhHsV7jzaVy7Gm";
                    await (0, node_fetch_1.default)(discordWebhookUrl, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            embeds: [{
                                    title: `🎮 Game Added Successfully: ${name}`,
                                    description: `🆔 **App ID:** ${appId}\n💰 **Price:** ${finalPrice > 0 ? finalPrice.toLocaleString() + " VND" : "FREE"} (Original: ${originalPriceVND ? Math.round(originalPriceVND).toLocaleString() + " VND" : "N/A"})\n🔞 **NSFW:** ${nsfw === 1 ? "✅ true" : "❌ false"}\n🛡️ **Denuvo:** ${hasDenuvo ? "✅ true" : "❌ false"}`,
                                    color: 0x00ff00,
                                    image: {
                                        url: bannerUrl || undefined,
                                    },
                                }],
                        }),
                    });
                }
                catch (discordErr) {
                    console.error(`[Upgame Ryu] Failed to send Discord notification for ${appId}:`, discordErr);
                }
                results.success++;
            }
            catch (err) {
                const errorMsg = err.message || "Unknown error";
                console.error(`[Upgame Ryu] Failed: ${appId} - ${errorMsg}`);
                try {
                    await pool.query("INSERT INTO skiplog (app_id, reason) VALUES (?, ?) ON DUPLICATE KEY UPDATE reason = VALUES(reason)", [appId, errorMsg]);
                }
                catch (skipErr) {
                    console.error(`[Upgame Ryu] Failed to add to skiplog: ${appId}`, skipErr);
                }
                results.failed++;
                results.errors.push(`${appId}: ${errorMsg}`);
            }
            if (results.success + results.failed < results.total) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        console.log(`[Upgame Ryu] Completed. Total: ${results.total}, Success: ${results.success}, Failed: ${results.failed}, Skipped: ${results.skipped}`);
        res.json({
            success: true,
            message: "Upgame ryu completed",
            results,
        });
    }
    catch (err) {
        console.error("[Upgame Ryu] Error:", err);
        res.status(500).json({ success: false, message: err.message || "Failed to upgame ryu" });
    }
});
app.post("/admin/games/fix-missing-data", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        const user = await getUserBySession(sessionId);
        if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const [games] = await pool.query("SELECT app_id, game_name, price FROM games");
        const gamesList = games;
        const results = {
            total: gamesList.length,
            fixed: 0,
            failed: 0,
            skipped: 0,
            errors: [],
        };
        for (const game of gamesList) {
            const appId = String(game.app_id || "");
            const currentName = String(game.game_name || "").trim();
            const currentPrice = Number(game.price || 0);
            const needsFix = !currentName || currentName === "" || currentName === `Game ${appId}` || currentPrice <= 0;
            if (!needsFix) {
                results.skipped++;
                continue;
            }
            try {
                await new Promise(resolve => setTimeout(resolve, 3000));
                const steamApiUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}`;
                const steamResponse = await fetchWithRetry(steamApiUrl, 2, 1000);
                if (!steamResponse.ok) {
                    throw new Error(`Steam API returned ${steamResponse.status}`);
                }
                const steamData = await steamResponse.json();
                const appData = steamData[appId];
                if (!appData || !appData.success) {
                    throw new Error("Steam API returned error");
                }
                const gameData = appData.data;
                if (!gameData) {
                    throw new Error("Game data is null");
                }
                let name = gameData.name || "";
                if (!name || name.trim() === "") {
                    name = currentName || `Game ${appId}`;
                }
                name = name.trim();
                if (name.length > 255) {
                    name = name.substring(0, 255);
                }
                let originalPriceVND = null;
                if (gameData.is_free === true) {
                    originalPriceVND = 0;
                }
                else if (gameData.price_overview) {
                    const priceOverview = gameData.price_overview;
                    const currency = (priceOverview.currency || "").toUpperCase();
                    const priceInitial = priceOverview.initial || priceOverview.final || 0;
                    if (priceInitial > 0) {
                        const priceInCurrency = priceInitial / 100;
                        if (currency === "VND") {
                            originalPriceVND = Math.round(priceInCurrency);
                        }
                        else if (currency === "USD") {
                            originalPriceVND = Math.round(priceInCurrency * 25000);
                        }
                        else {
                            const priceUSD = priceInCurrency;
                            originalPriceVND = Math.round(priceUSD * 25000);
                        }
                    }
                }
                let finalPrice = 0;
                if (originalPriceVND !== null && originalPriceVND > 0) {
                    finalPrice = Math.round(originalPriceVND * 0.2);
                    if (finalPrice < 10000) {
                        finalPrice = 0;
                    }
                }
                else if (originalPriceVND === 0) {
                    finalPrice = 0;
                }
                finalPrice = Math.max(0, Math.min(9999999999.99, finalPrice));
                const trimmedAppId = appId.trim().substring(0, 32);
                const trimmedName = name.substring(0, 255);
                await pool.query("UPDATE games SET game_name = ?, price = ?, updated_at = CURRENT_TIMESTAMP WHERE app_id = ?", [trimmedName, finalPrice, trimmedAppId]);
                console.log(`[Fix Missing Data] Fixed: ${appId} - ${name} | Price: ${finalPrice > 0 ? finalPrice.toLocaleString() + " VND" : "FREE"}`);
                results.fixed++;
            }
            catch (err) {
                const errorMsg = err.message || "Unknown error";
                console.error(`[Fix Missing Data] Failed: ${appId} - ${errorMsg}`);
                results.failed++;
                results.errors.push(`${appId}: ${errorMsg}`);
            }
            if (results.fixed + results.failed < results.total) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        console.log(`[Fix Missing Data] Completed. Total: ${results.total}, Fixed: ${results.fixed}, Failed: ${results.failed}, Skipped: ${results.skipped}`);
        res.json({
            success: true,
            message: "Fix missing data completed",
            results,
        });
    }
    catch (err) {
        console.error("[Fix Missing Data] Error:", err);
        res.status(500).json({ success: false, message: err.message || "Failed to fix missing data" });
    }
});
app.get("/admin/games/pending-ryu", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        const user = await getUserBySession(sessionId);
        if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const ryuGamesUrl = "https://generator.ryuu.lol/files/games.json";
        const ryuResponse = await (0, node_fetch_1.default)(ryuGamesUrl);
        if (!ryuResponse.ok) {
            return res.status(500).json({ success: false, message: "Failed to fetch games.json from ryu" });
        }
        const ryuGames = await ryuResponse.json();
        if (!Array.isArray(ryuGames)) {
            return res.status(500).json({ success: false, message: "Invalid games.json format" });
        }
        const [skipRows] = await pool.query("SELECT app_id FROM skiplog");
        const skipList = new Set(skipRows.map((row) => row.app_id));
        const [existingRows] = await pool.query("SELECT app_id FROM games");
        const existingGames = new Set(existingRows.map((row) => row.app_id));
        let pending = 0;
        for (const ryuGame of ryuGames) {
            const appId = String(ryuGame.appid || "");
            if (!appId)
                continue;
            if (!skipList.has(appId) && !existingGames.has(appId)) {
                pending++;
            }
        }
        res.json({
            success: true,
            pending,
            total: ryuGames.length,
            existing: existingGames.size,
            skipped: skipList.size,
        });
    }
    catch (err) {
        console.error("[Pending Ryu] Error:", err);
        res.status(500).json({ success: false, message: err.message || "Failed to get pending count" });
    }
});
app.get("/admin/settings/banner", async (_req, res) => {
    try {
        const cached = gameCheckCache.get("banner_settings");
        if (cached)
            return res.json(cached);
        const [rows] = await pool.query("SELECT v FROM app_settings WHERE k = 'storeBannerUrl' LIMIT 1");
        const result = { success: true, url: rows[0]?.v || "" };
        gameCheckCache.set("banner_settings", result);
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to load banner setting" });
    }
});
app.put("/admin/settings/banner", async (req, res) => {
    try {
        const { url } = req.body || {};
        if (typeof url !== "string" || !url.trim()) {
            return res.status(400).json({ success: false, message: "Invalid url" });
        }
        const safe = url.trim();
        await pool.query("INSERT INTO app_settings (k, v) VALUES ('storeBannerUrl', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", [safe]);
        gameCheckCache.del("banner_settings");
        res.json({ success: true });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to save banner setting" });
    }
});
app.get("/settings/discount", async (_req, res) => {
    try {
        const cached = gameCheckCache.get("discount_settings_public");
        if (cached)
            return res.json(cached);
        const [rows] = await pool.query("SELECT k, v FROM app_settings WHERE k IN ('discount_denuvo_enabled', 'discount_normal_enabled', 'discount_vipyear', 'discount_vip_plus_year')");
        const settings = {};
        rows.forEach((row) => {
            settings[row.k] = row.v;
        });
        const result = {
            success: true,
            discount_denuvo_enabled: settings.discount_denuvo_enabled === "1",
            discount_normal_enabled: settings.discount_normal_enabled === "1",
            discount_vipyear: Number(settings.discount_vipyear || "0"),
            discount_vip_plus_year: Number(settings.discount_vip_plus_year || "0"),
        };
        gameCheckCache.set("discount_settings_public", result);
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to load discount settings" });
    }
});
app.get("/admin/settings/discount", async (_req, res) => {
    try {
        const cached = gameCheckCache.get("discount_settings_admin");
        if (cached)
            return res.json(cached);
        const [rows] = await pool.query("SELECT k, v FROM app_settings WHERE k IN ('discount_denuvo_enabled', 'discount_normal_enabled', 'discount_vipyear', 'discount_vip_plus_year')");
        const settings = {};
        rows.forEach((row) => {
            settings[row.k] = row.v;
        });
        const result = {
            success: true,
            discount_denuvo_enabled: settings.discount_denuvo_enabled === "1",
            discount_normal_enabled: settings.discount_normal_enabled === "1",
            discount_vipyear: Number(settings.discount_vipyear || "0"),
            discount_vip_plus_year: Number(settings.discount_vip_plus_year || "0"),
        };
        gameCheckCache.set("discount_settings_admin", result);
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to load discount settings" });
    }
});
app.put("/admin/settings/discount", async (req, res) => {
    try {
        const { discount_denuvo_enabled, discount_normal_enabled, discount_vipyear, discount_vip_plus_year } = req.body || {};
        if (typeof discount_denuvo_enabled === "boolean") {
            await pool.query("INSERT INTO app_settings (k, v) VALUES ('discount_denuvo_enabled', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", [discount_denuvo_enabled ? "1" : "0"]);
        }
        if (typeof discount_normal_enabled === "boolean") {
            await pool.query("INSERT INTO app_settings (k, v) VALUES ('discount_normal_enabled', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", [discount_normal_enabled ? "1" : "0"]);
        }
        if (typeof discount_vipyear === "number" && !Number.isNaN(discount_vipyear) && discount_vipyear >= 0 && discount_vipyear <= 100) {
            await pool.query("INSERT INTO app_settings (k, v) VALUES ('discount_vipyear', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", [String(discount_vipyear)]);
        }
        if (typeof discount_vip_plus_year === "number" && !Number.isNaN(discount_vip_plus_year) && discount_vip_plus_year >= 0 && discount_vip_plus_year <= 100) {
            await pool.query("INSERT INTO app_settings (k, v) VALUES ('discount_vip_plus_year', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", [String(discount_vip_plus_year)]);
        }
        gameCheckCache.del("discount_settings_admin");
        gameCheckCache.del("discount_settings_public");
        res.json({ success: true });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to save discount settings" });
    }
});
app.get("/netfix/random-account", async (_req, res) => {
    try {
        const cached = gameCheckCache.get("netflix_active_account");
        if (cached)
            return res.json(cached);
        const [rows] = await pool.query("SELECT account, password FROM netfix_accounts WHERE status = 'active' LIMIT 1");
        const accounts = rows;
        if (accounts.length === 0) {
            return res.status(404).json({ success: false, message: "No active Netflix account found" });
        }
        const result = { success: true, account: accounts[0].account, password: accounts[0].password };
        gameCheckCache.set("netflix_active_account", result);
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to get Netflix account" });
    }
});
app.get("/admin/netfix/accounts", async (_req, res) => {
    try {
        const cached = gameCheckCache.get("netflix_all_accounts");
        if (cached)
            return res.json(cached);
        const [rows] = await pool.query("SELECT id, account, password, status, created_at, updated_at FROM netfix_accounts ORDER BY created_at DESC");
        const result = { success: true, data: rows };
        gameCheckCache.set("netflix_all_accounts", result);
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to fetch Netflix accounts" });
    }
});
app.post("/admin/netfix/accounts", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        const actor = await getUserBySession(sessionId);
        if (!actor) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        if (actor.role !== "admin" && actor.role !== "super_admin") {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }
        const { account, password, status } = req.body || {};
        if (!account || !password) {
            return res.status(400).json({ success: false, message: "Account and password are required" });
        }
        const validStatus = ["active", "inactive", "expired"];
        const accountStatus = validStatus.includes(status) ? status : "active";
        const id = crypto_1.default.randomUUID();
        await pool.query("INSERT INTO netfix_accounts (id, account, password, status) VALUES (?, ?, ?, ?)", [id, account.trim(), password, accountStatus]);
        gameCheckCache.del("netflix_all_accounts");
        gameCheckCache.del("netflix_active_account");
        res.json({ success: true, message: "Netflix account added successfully" });
    }
    catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            return res.status(400).json({ success: false, message: "Account already exists" });
        }
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to add Netflix account" });
    }
});
app.delete("/admin/netfix/accounts/:id", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        const actor = await getUserBySession(sessionId);
        if (!actor) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        if (actor.role !== "admin" && actor.role !== "super_admin") {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }
        const id = req.params.id;
        const [result] = await pool.query("DELETE FROM netfix_accounts WHERE id = ?", [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "Account not found" });
        }
        res.json({ success: true, message: "Netflix account deleted successfully" });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to delete Netflix account" });
    }
});
app.put("/admin/netfix/accounts/:id/status", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        const actor = await getUserBySession(sessionId);
        if (!actor) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        if (actor.role !== "admin" && actor.role !== "super_admin") {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }
        const id = req.params.id;
        const { status } = req.body || {};
        const validStatus = ["active", "inactive", "expired"];
        if (!validStatus.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status" });
        }
        const [result] = await pool.query("UPDATE netfix_accounts SET status = ? WHERE id = ?", [status, id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "Account not found" });
        }
        gameCheckCache.del("netflix_all_accounts");
        gameCheckCache.del("netflix_active_account");
        res.json({ success: true, message: "Status updated successfully" });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to update Netflix account status" });
    }
});
app.get("/admin/settings/vip-packages", async (_req, res) => {
    try {
        const cached = gameCheckCache.get("vip_packages");
        if (cached)
            return res.json(cached);
        const [rows] = await pool.query("SELECT id, name, code, type, duration, price, description, features, is_active FROM vip_packages ORDER BY created_at DESC");
        const result = { success: true, data: rows };
        gameCheckCache.set("vip_packages", result);
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to load vip packages" });
    }
});
app.put("/admin/settings/vip-packages/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const { name, code, type, duration, price, description, features, is_active } = req.body || {};
        const fields = [];
        const params = [];
        if (typeof name === "string" && name.trim()) {
            fields.push("name = ?");
            params.push(name.trim());
        }
        if (typeof code === "string" && code.trim()) {
            fields.push("code = ?");
            params.push(code.trim());
        }
        if (type === "vip" || type === "vip_plus") {
            fields.push("type = ?");
            params.push(type);
        }
        if (Number.isInteger(duration) && duration > 0) {
            fields.push("duration = ?");
            params.push(duration);
        }
        if (typeof price === "number" && !Number.isNaN(price) && price >= 0) {
            fields.push("price = ?");
            params.push(price);
        }
        if (typeof description === "string") {
            fields.push("description = ?");
            params.push(description);
        }
        if (typeof features === "string") {
            fields.push("features = ?");
            params.push(features);
        }
        if (is_active === 0 || is_active === 1) {
            fields.push("is_active = ?");
            params.push(is_active);
        }
        if (!fields.length) {
            return res.status(400).json({ success: false, message: "No data to update" });
        }
        params.push(id);
        await pool.query(`UPDATE vip_packages SET ${fields.join(", ")} WHERE id = ?`, params);
        res.json({ success: true });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to update vip package" });
    }
});
app.get("/admin/users", async (_req, res) => {
    try {
        const [rows] = await pool.query("SELECT id, username, email, role, p_balance, is_online, created_at, last_login FROM users ORDER BY created_at DESC");
        res.json({ success: true, data: rows });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to load users" });
    }
});
app.get("/admin/transactions", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const actor = await getUserBySession(sessionId);
        if (!actor || (actor.role !== "admin" && actor.role !== "super_admin")) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }
        const { type, status, limit = 100, offset = 0 } = req.query;
        let query = `
      SELECT 
        t.id,
        t.user_id,
        u.username,
        u.email,
        t.type,
        t.amount,
        t.currency,
        t.status,
        t.payment_method,
        t.description,
        t.reference_id,
        t.fiat_amount,
        t.bank_transaction_id,
        t.bank_description,
        t.created_at,
        t.updated_at
      FROM transactions t
      LEFT JOIN users u ON t.user_id = u.id
      WHERE 1=1
    `;
        const params = [];
        if (type) {
            query += ` AND t.type = ?`;
            params.push(type);
        }
        if (status) {
            query += ` AND t.status = ?`;
            params.push(status);
        }
        query += ` ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));
        const [rows] = await pool.query(query, params);
        let countQuery = `SELECT COUNT(*) as total FROM transactions t WHERE 1=1`;
        const countParams = [];
        if (type) {
            countQuery += ` AND t.type = ?`;
            countParams.push(type);
        }
        if (status) {
            countQuery += ` AND t.status = ?`;
            countParams.push(status);
        }
        const [countRows] = await pool.query(countQuery, countParams);
        const total = countRows[0]?.total || 0;
        res.json({ success: true, data: rows, total });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to load transactions" });
    }
});
app.put("/admin/users/:id/role", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const actor = await getUserBySession(sessionId);
        if (!actor) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const targetId = req.params.id;
        const { role } = req.body || {};
        const allowedRoles = ["user", "vip", "vip_plus", "admin", "ctv", "super_admin"];
        if (!allowedRoles.includes(role)) {
            return res.status(400).json({ success: false, message: "Invalid role" });
        }
        if (actor.id === targetId) {
            return res.status(403).json({ success: false, message: "Không được đổi role chính mình" });
        }
        if (actor.role === "admin" && role === "super_admin") {
            return res.status(403).json({ success: false, message: "Admin không được set Super Admin" });
        }
        if (actor.role !== "admin" && actor.role !== "super_admin") {
            return res.status(403).json({ success: false, message: "Không đủ quyền" });
        }
        await pool.query("UPDATE users SET role = ? WHERE id = ? LIMIT 1", [role, targetId]);
        res.json({ success: true });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to update role" });
    }
});
app.put("/admin/users/:id/balance", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const actor = await getUserBySession(sessionId);
        if (!actor) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        if (actor.role !== "admin" && actor.role !== "super_admin") {
            return res.status(403).json({ success: false, message: "Không đủ quyền" });
        }
        const targetId = req.params.id;
        const { p_balance } = req.body || {};
        const amount = Number(p_balance);
        if (Number.isNaN(amount) || amount < 0) {
            return res.status(400).json({ success: false, message: "Số dư không hợp lệ" });
        }
        await pool.query("UPDATE users SET p_balance = ? WHERE id = ? LIMIT 1", [amount, targetId]);
        res.json({ success: true });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to update balance" });
    }
});
app.put("/admin/user/:id/balance", async (req, res, next) => {
    req.url = `/admin/users/${req.params.id}/balance`;
    next();
});
app.put("/admin/users/:id/email", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const actor = await getUserBySession(sessionId);
        if (!actor) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        if (actor.role !== "admin" && actor.role !== "super_admin") {
            return res.status(403).json({ success: false, message: "Không đủ quyền" });
        }
        const targetId = req.params.id;
        const { email } = req.body || {};
        if (!email || typeof email !== "string" || !email.includes("@")) {
            return res.status(400).json({ success: false, message: "Email không hợp lệ" });
        }
        // Check if email already exists
        const [existing] = await pool.query("SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1", [email, targetId]);
        if (Array.isArray(existing) && existing.length > 0) {
            return res.status(400).json({ success: false, message: "Email đã tồn tại" });
        }
        await pool.query("UPDATE users SET email = ? WHERE id = ? LIMIT 1", [email, targetId]);
        res.json({ success: true });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to update email" });
    }
});
app.put("/admin/users/:id/password", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const actor = await getUserBySession(sessionId);
        if (!actor) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        if (actor.role !== "admin" && actor.role !== "super_admin") {
            return res.status(403).json({ success: false, message: "Không đủ quyền" });
        }
        const targetId = req.params.id;
        const { password } = req.body || {};
        if (!password || typeof password !== "string" || password.length < 6) {
            return res.status(400).json({ success: false, message: "Mật khẩu phải có ít nhất 6 ký tự" });
        }
        const hashedPassword = await bcrypt_1.default.hash(password, 10);
        await pool.query("UPDATE users SET password = ? WHERE id = ? LIMIT 1", [hashedPassword, targetId]);
        res.json({ success: true });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to update password" });
    }
});
app.get("/admin/users/:id/games", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const actor = await getUserBySession(sessionId);
        if (!actor) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        if (actor.role !== "admin" && actor.role !== "super_admin") {
            return res.status(403).json({ success: false, message: "Không đủ quyền" });
        }
        const userId = req.params.id;
        const [rows] = await pool.query(`SELECT 
        ug.id,
        ug.game_id,
        ug.purchased_at,
        ug.price_paid,
        g.game_name,
        g.banner_url
      FROM user_games ug
      LEFT JOIN games g ON ug.game_id = g.app_id
      WHERE ug.user_id = ?
      ORDER BY ug.purchased_at DESC`, [userId]);
        res.json({ success: true, data: rows });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to load user games" });
    }
});
app.delete("/admin/users/:id/games/:gameId", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const actor = await getUserBySession(sessionId);
        if (!actor) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        if (actor.role !== "admin" && actor.role !== "super_admin") {
            return res.status(403).json({ success: false, message: "Không đủ quyền" });
        }
        const userId = req.params.id;
        const gameId = req.params.gameId;
        const [gameRows] = await pool.query("SELECT price_paid FROM user_games WHERE user_id = ? AND game_id = ?", [userId, gameId]);
        const gamePricePaid = Array.isArray(gameRows) && gameRows.length > 0 ? gameRows[0].price_paid : 0;
        await pool.query("DELETE FROM user_games WHERE user_id = ? AND game_id = ?", [userId, gameId]);
        if (gamePricePaid > 0) {
            await pool.query("UPDATE users SET p_balance = p_balance + ? WHERE id = ?", [gamePricePaid, userId]);
        }
        // Get updated balance
        const [userRows] = await pool.query("SELECT p_balance FROM users WHERE id = ?", [userId]);
        const updatedBalance = Array.isArray(userRows) && userRows.length > 0 ? userRows[0].p_balance : 0;
        res.json({ success: true, refundAmount: gamePricePaid, newBalance: updatedBalance });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to delete user game" });
    }
});
app.get("/admin/games/search", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const actor = await getUserBySession(sessionId);
        if (!actor) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        if (actor.role !== "admin" && actor.role !== "super_admin") {
            return res.status(403).json({ success: false, message: "Không đủ quyền" });
        }
        const query = req.query.q?.trim();
        if (!query || query.length < 2) {
            return res.json({ success: true, data: [] });
        }
        const searchTerm = `%${query}%`;
        const [rows] = await pool.query(`SELECT g.app_id,
        g.game_name,
        g.banner_url,
        GROUP_CONCAT(DISTINCT ug.user_id) as user_ids,
        GROUP_CONCAT(DISTINCT u.username) as usernames,
        MAX(ug.purchased_at) as last_purchase_at
      FROM games g
      LEFT JOIN user_games ug ON g.app_id = ug.game_id
      LEFT JOIN users u ON ug.user_id = u.id
      WHERE g.app_id LIKE ? OR LOWER(g.game_name) LIKE LOWER(?)
      GROUP BY g.app_id, g.game_name, g.banner_url
      ORDER BY g.game_name, last_purchase_at DESC
      LIMIT 50`, [searchTerm, searchTerm]);
        res.json({ success: true, data: rows });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to search games" });
    }
});
app.get("/admin/keys", async (_req, res) => {
    try {
        const [rows] = await pool.query("SELECT key_code, key_type, value, game_app_id, is_used, use_count, max_uses, created_at, expires_at FROM `keys` ORDER BY created_at DESC LIMIT 500");
        res.json({ success: true, data: rows });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to load keys" });
    }
});
app.delete("/admin/keys/:code", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const actor = await getUserBySession(sessionId);
        if (!actor) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        if (actor.role !== "super_admin") {
            return res.status(403).json({ success: false, message: "Không đủ quyền" });
        }
        const code = req.params.code;
        await pool.query("DELETE FROM `keys` WHERE key_code = ? LIMIT 1", [code]);
        res.json({ success: true });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to delete key" });
    }
});
app.post("/admin/keys", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const actor = await getUserBySession(sessionId);
        if (!actor) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        if (actor.role !== "super_admin") {
            return res.status(403).json({ success: false, message: "Không đủ quyền" });
        }
        const { key_code, key_type, value, random_type, max_uses, expires_at, } = req.body || {};
        const allowedTypes = ["balance", "vip", "vip_plus", "game", "random"];
        if (!allowedTypes.includes(key_type)) {
            return res.status(400).json({ success: false, message: "Loại key không hợp lệ" });
        }
        const generateKey = () => {
            const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            const block = () => Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
            return `${block()}-${block()}-${block()}`;
        };
        const finalKey = key_code && typeof key_code === "string" && key_code.trim()
            ? key_code.trim()
            : generateKey();
        let finalType = key_type;
        let finalValue = null;
        let gameAppId = null;
        const pickOne = (arr) => (arr.length ? arr[Math.floor(Math.random() * arr.length)] : null);
        if (key_type === "random") {
            const rt = random_type || "balance";
            if (rt === "game") {
                const [grows] = await pool.query("SELECT app_id FROM games WHERE price >= 10000");
                const gamesList = grows.map((g) => g.app_id);
                const pick = pickOne(gamesList);
                if (!pick)
                    return res.status(400).json({ success: false, message: "Không có game để random" });
                finalType = "game";
                finalValue = pick;
                gameAppId = pick;
            }
            else if (rt === "vip" || rt === "vip_plus") {
                const [vrows] = await pool.query("SELECT id, type FROM vip_packages WHERE type = ?", [rt]);
                const vipList = vrows.map((v) => v.id);
                const pick = pickOne(vipList);
                if (!pick)
                    return res.status(400).json({ success: false, message: "Không có gói VIP để random" });
                finalType = rt;
                finalValue = pick;
            }
            else {
                if (typeof value !== "string" && typeof value !== "number") {
                    return res.status(400).json({ success: false, message: "Giá trị balance không hợp lệ" });
                }
                finalType = "balance";
                finalValue = String(value);
            }
        }
        else if (key_type === "game") {
            if (value) {
                finalValue = String(value);
                gameAppId = String(value);
            }
            else {
                const [grows] = await pool.query("SELECT app_id FROM games WHERE price >= 10000");
                const gamesList = grows.map((g) => g.app_id);
                const pick = pickOne(gamesList);
                if (!pick)
                    return res.status(400).json({ success: false, message: "Không có game để random" });
                finalValue = pick;
                gameAppId = pick;
            }
        }
        else if (key_type === "vip" || key_type === "vip_plus") {
            if (!value || typeof value !== "string") {
                return res.status(400).json({ success: false, message: "Chọn gói VIP" });
            }
            finalValue = value;
        }
        else if (key_type === "balance") {
            if (typeof value !== "string" && typeof value !== "number") {
                return res.status(400).json({ success: false, message: "Giá trị balance không hợp lệ" });
            }
            finalValue = String(value);
        }
        const maxUsesNum = max_uses !== undefined && max_uses !== null && String(max_uses).length
            ? Number(max_uses)
            : null;
        if (maxUsesNum !== null && (Number.isNaN(maxUsesNum) || maxUsesNum <= 0)) {
            return res.status(400).json({ success: false, message: "max_uses không hợp lệ" });
        }
        const expires = expires_at && String(expires_at).trim().length ? new Date(expires_at) : null;
        const expiresValue = expires && !Number.isNaN(expires.getTime()) ? expires : null;
        await pool.query("INSERT INTO `keys` (id, key_code, key_type, value, game_app_id, is_used, used_by, use_count, max_uses, created_by, created_at, expires_at) VALUES (UUID(), ?, ?, ?, ?, 0, NULL, 0, ?, ?, NOW(), ?)", [
            finalKey,
            finalType,
            finalValue,
            gameAppId,
            maxUsesNum,
            actor.id,
            expiresValue ? expiresValue : null,
        ]);
        res.json({ success: true, key_code: finalKey, key_type: finalType, value: finalValue });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to create key" });
    }
});
app.post("/activate-product", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || "";
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const user = await getUserBySession(sessionId);
        if (!user) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const { product_code } = req.body || {};
        if (!product_code || typeof product_code !== "string" || !product_code.trim()) {
            return res.status(400).json({ success: false, message: "Product code is required" });
        }
        const keyCode = product_code.trim();
        const [keyRows] = await pool.query("SELECT id, key_code, key_type, value, game_app_id, is_used, use_count, max_uses, expires_at, used_by FROM `keys` WHERE key_code = ? LIMIT 1", [keyCode]);
        const key = keyRows[0];
        if (!key) {
            return res.status(404).json({ success: false, message: "Invalid product code" });
        }
        const [existingTxRows] = await pool.query("SELECT id FROM transactions WHERE user_id = ? AND reference_id = ? AND type = 'key_redeem' LIMIT 1", [user.id, keyCode]);
        if (existingTxRows.length > 0) {
            return res.status(400).json({ success: false, message: "You have already used this product code" });
        }
        if (key.max_uses === null && key.is_used) {
            if (key.used_by === user.id) {
                return res.status(400).json({ success: false, message: "You have already used this product code" });
            }
            return res.status(400).json({ success: false, message: "This product code has already been used by another user" });
        }
        if (key.max_uses !== null && key.use_count >= key.max_uses) {
            return res.status(400).json({ success: false, message: "This product code has reached its usage limit" });
        }
        if (key.expires_at) {
            const expiresAt = new Date(key.expires_at);
            if (expiresAt < new Date()) {
                return res.status(400).json({ success: false, message: "This product code has expired" });
            }
        }
        const conn = await pool.getConnection();
        let vipPackageName = null;
        try {
            await conn.beginTransaction();
            if (key.key_type === "balance") {
                const balanceAmount = Number(key.value);
                if (isNaN(balanceAmount) || balanceAmount <= 0) {
                    await conn.rollback();
                    return res.status(400).json({ success: false, message: "Invalid balance value" });
                }
                await conn.query("UPDATE users SET p_balance = p_balance + ? WHERE id = ? LIMIT 1", [Math.round(balanceAmount), user.id]);
                const uuid = require("crypto").randomUUID;
                const txId = uuid();
                await conn.query("INSERT INTO transactions (id, user_id, type, amount, currency, status, payment_method, description, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    txId,
                    user.id,
                    "key_redeem",
                    Math.round(balanceAmount),
                    "G",
                    "completed",
                    "key",
                    `Redeemed balance key: ${keyCode}`,
                    keyCode,
                ]);
            }
            else if (key.key_type === "vip" || key.key_type === "vip_plus") {
                if (!key.value) {
                    await conn.rollback();
                    return res.status(400).json({ success: false, message: "Invalid VIP package ID" });
                }
                const [packageRows] = await conn.query("SELECT id, name, type, duration FROM vip_packages WHERE id = ? AND is_active = 1", [key.value]);
                if (packageRows.length === 0) {
                    await conn.rollback();
                    return res.status(404).json({ success: false, message: "VIP package not found" });
                }
                const vipPackage = packageRows[0];
                let vipPackageName = vipPackage.name;
                const [userRows] = await conn.query("SELECT vip_expires_at FROM users WHERE id = ? LIMIT 1", [user.id]);
                const currentUser = userRows[0];
                const currentExpiresAt = currentUser.vip_expires_at
                    ? new Date(currentUser.vip_expires_at)
                    : new Date();
                if (currentExpiresAt < new Date()) {
                    currentExpiresAt.setTime(Date.now());
                }
                const newExpiresAt = new Date(currentExpiresAt);
                newExpiresAt.setDate(newExpiresAt.getDate() + vipPackage.duration);
                const newRole = vipPackage.type === 'vip_plus' ? 'vip_plus' :
                    (vipPackage.type === 'vip' ? 'vip' : user.role);
                await conn.query("UPDATE users SET role = ?, vip_expires_at = ? WHERE id = ?", [newRole, newExpiresAt, user.id]);
                await conn.query("UPDATE user_games_log SET expires_at = ? WHERE user_id = ? AND source = 'vip'", [newExpiresAt, user.id]);
                await conn.query("UPDATE user_vip_subscriptions SET status = 'cancelled' WHERE user_id = ? AND status = 'active'", [user.id]);
                const subscriptionId = crypto_1.default.randomUUID();
                await conn.query("INSERT INTO user_vip_subscriptions (id, user_id, package_id, started_at, expires_at, status) VALUES (?, ?, ?, NOW(), ?, 'active')", [subscriptionId, user.id, vipPackage.id, newExpiresAt]);
                const uuid = require("crypto").randomUUID;
                const txId = uuid();
                await conn.query("INSERT INTO transactions (id, user_id, type, amount, currency, status, payment_method, description, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    txId,
                    user.id,
                    "key_redeem",
                    0,
                    "G",
                    "completed",
                    "key",
                    `Redeemed VIP key: ${vipPackage.name}`,
                    keyCode,
                ]);
            }
            else if (key.key_type === "game") {
                if (!key.value || !key.game_app_id) {
                    await conn.rollback();
                    return res.status(400).json({ success: false, message: "Invalid game key" });
                }
                const gameAppId = key.game_app_id;
                const [gameRows] = await conn.query("SELECT app_id, game_name, special_denuvo FROM games WHERE app_id = ? LIMIT 1", [gameAppId]);
                if (gameRows.length === 0) {
                    await conn.rollback();
                    return res.status(404).json({ success: false, message: "Game not found" });
                }
                const game = gameRows[0];
                const [existingRows] = await conn.query("SELECT id FROM user_games WHERE user_id = ? AND game_id = ? LIMIT 1", [user.id, gameAppId]);
                if (existingRows.length > 0) {
                    await conn.rollback();
                    return res.status(400).json({ success: false, message: "You already own this game" });
                }
                const uuid = require("crypto").randomUUID;
                const gameEntryId = uuid();
                await conn.query("INSERT INTO user_games (id, user_id, game_id, price_paid) VALUES (?, ?, ?, ?)", [gameEntryId, user.id, gameAppId, 0]);
                const logId = uuid();
                await conn.query("INSERT INTO user_games_log (id, user_id, app_id, source, expires_at, drm_active) VALUES (?, ?, ?, ?, ?, ?)", [
                    logId,
                    user.id,
                    gameAppId,
                    "purchase",
                    null,
                    game.special_denuvo === 1 ? 1 : 0
                ]);
                const txId = uuid();
                await conn.query("INSERT INTO transactions (id, user_id, type, amount, currency, status, payment_method, description, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    txId,
                    user.id,
                    "key_redeem",
                    0,
                    "G",
                    "completed",
                    "key",
                    `Redeemed game key: ${game.game_name}`,
                    keyCode,
                ]);
                vipPackageName = game.game_name;
            }
            else {
                await conn.rollback();
                return res.status(400).json({ success: false, message: "Unsupported key type" });
            }
            if (key.max_uses === null) {
                await conn.query("UPDATE `keys` SET is_used = 1, used_by = ?, used_at = NOW() WHERE id = ? LIMIT 1", [user.id, key.id]);
            }
            else {
                await conn.query("UPDATE `keys` SET use_count = use_count + 1 WHERE id = ? LIMIT 1", [key.id]);
            }
            await conn.commit();
            let successMessage = "Product code activated successfully";
            if (key.key_type === "balance") {
                successMessage = `Successfully activated! Added ${key.value} G to your account.`;
            }
            else if (key.key_type === "vip" || key.key_type === "vip_plus") {
                successMessage = `Successfully activated! VIP package "${vipPackageName}" has been added to your account.`;
            }
            else if (key.key_type === "game" && vipPackageName) {
                successMessage = `Successfully activated! Game "${vipPackageName}" has been added to your library.`;
            }
            res.json({
                success: true,
                message: successMessage
            });
        }
        catch (err) {
            await conn.rollback();
            throw err;
        }
        finally {
            conn.release();
        }
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to activate product code" });
    }
});
async function fetchAndUpdateBanner(appId) {
    try {
        const steamUrl = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&l=english&cc=us&filters=basic,price_overview,background,header_image`;
        const response = await fetchWithRetry(steamUrl, 2, 500);
        if (!response.ok) {
            return null;
        }
        const json = (await response.json());
        const entry = json?.[appId];
        const header = entry?.success && entry?.data?.header_image ? String(entry.data.header_image) : null;
        if (!header) {
            return null;
        }
        const bannerUrl = header.split('?')[0];
        const [existingRows] = await pool.query("SELECT app_id, banner_url FROM games WHERE app_id = ? LIMIT 1", [appId]);
        const existing = existingRows[0];
        if (existing) {
            if (existing.banner_url !== bannerUrl) {
                await pool.query("UPDATE games SET banner_url = ? WHERE app_id = ?", [bannerUrl, appId]);
            }
        }
        else {
            const [existingCheck] = await pool.query("SELECT app_id FROM games WHERE app_id = ? LIMIT 1", [appId]);
            if (existingCheck.length === 0) {
                return null;
            }
            await pool.query("UPDATE games SET banner_url = ? WHERE app_id = ?", [bannerUrl, appId]);
        }
        return bannerUrl;
    }
    catch (err) {
        return null;
    }
}
app.post("/games/:app_id/refresh-banner", async (req, res) => {
    try {
        const appId = req.params.app_id;
        if (!appId)
            return res.status(400).json({ success: false, message: "Missing app_id" });
        const bannerUrl = await fetchAndUpdateBanner(appId);
        if (!bannerUrl) {
            return res.status(404).json({ success: false, message: "No banner found" });
        }
        res.json({ success: true, banner_url: bannerUrl });
    }
    catch (err) {
        res.status(500).json({ success: false, message: "Refresh banner failed" });
    }
});
app.post("/games/:app_id/check-reseller", async (req, res) => {
    try {
        const appId = req.params.app_id;
        const currentManifests = req.body?.currentManifests || null;
        const cacheKey = `game_check_${appId}`;
        const [gameRows] = await pool.query("SELECT app_id, updated_at, manifest_data, last_check_date FROM games WHERE app_id = ? LIMIT 1", [appId]);
        const game = gameRows[0];
        if (!game) {
            return res.status(404).json({ success: false, message: "Game not found" });
        }
        const today = new Date().toISOString().split('T')[0];
        const lastCheckDate = game.last_check_date ? new Date(game.last_check_date).toISOString().split('T')[0] : null;
        if (lastCheckDate === today) {
            const oldManifestData = parseManifestData(game.manifest_data);
            const [depots, files] = extractAllDepotFiles(oldManifestData);
            return res.json({
                success: true,
                checked: true,
                hasUpdate: false,
                timestamp: oldManifestData?.timestamp || null,
                depots,
                files,
                branchManifests: oldManifestData?.branch_manifests || {},
                checkedAt: new Date().toISOString()
            });
        }
        const vpsBase = "http://161.248.239.223/game";
        const vpsLuaPatterns = [
            `${vpsBase}/${appId}/${appId}.lua`,
            `${vpsBase}/${appId}/app_${appId}.lua`,
            `${vpsBase}/${appId}/game_${appId}.lua`,
        ];
        let vpsExists = false;
        let vpsDate = null;
        for (const luaUrl of vpsLuaPatterns) {
            try {
                const vpsResponse = await (0, node_fetch_1.default)(luaUrl, { method: "HEAD", signal: AbortSignal.timeout(5000) });
                if (vpsResponse.ok) {
                    vpsExists = true;
                    const lastModified = vpsResponse.headers.get("last-modified");
                    if (lastModified) {
                        vpsDate = new Date(lastModified);
                    }
                    break;
                }
            }
            catch {
                continue;
            }
        }
        let gamesJsonData = null;
        let ryuDate = null;
        try {
            const gamesJsonUrl = "https://generator.ryuu.lol/files/games.json";
            const gamesJsonResponse = await (0, node_fetch_1.default)(gamesJsonUrl, { signal: AbortSignal.timeout(8000) });
            if (gamesJsonResponse.ok) {
                const gamesArray = await gamesJsonResponse.json();
                gamesJsonData = gamesArray.find((g) => g.appid === appId);
                if (gamesJsonData?.updated_date) {
                    ryuDate = new Date(gamesJsonData.updated_date);
                }
            }
        }
        catch {
        }
        const oldManifestData = parseManifestData(game.manifest_data);
        const [depots, files] = extractAllDepotFiles(oldManifestData);
        let useVps = false;
        let useRyu = false;
        const now = new Date();
        if (vpsExists && vpsDate && ryuDate) {
            const vpsDaysDiff = Math.abs(now.getTime() - vpsDate.getTime()) / (1000 * 60 * 60 * 24);
            const ryuDaysDiff = Math.abs(now.getTime() - ryuDate.getTime()) / (1000 * 60 * 60 * 24);
            useRyu = ryuDaysDiff < vpsDaysDiff;
            useVps = !useRyu;
        }
        else if (vpsExists) {
            useVps = true;
        }
        else if (gamesJsonData) {
            useRyu = true;
        }
        let shouldCheckManifest = true;
        if (gamesJsonData?.updated_date && !useVps) {
            const gamesJsonUpdatedDate = new Date(gamesJsonData.updated_date);
            const dbUpdatedAt = game.updated_at ? new Date(game.updated_at) : null;
            if (dbUpdatedAt && gamesJsonUpdatedDate.getTime() <= dbUpdatedAt.getTime()) {
                shouldCheckManifest = false;
            }
        }
        if (!shouldCheckManifest && !useVps) {
            try {
                await pool.query("UPDATE games SET last_check_date = CURDATE() WHERE app_id = ?", [appId]);
            }
            catch {
            }
            return res.json({
                success: true,
                checked: true,
                hasUpdate: false,
                timestamp: oldManifestData?.timestamp || null,
                depots,
                files,
                branchManifests: oldManifestData?.branch_manifests || {},
                checkedAt: new Date().toISOString()
            });
        }
        if (useVps && vpsDate) {
            const hasUpdate = !game.updated_at || vpsDate.getTime() > new Date(game.updated_at).getTime();
            try {
                await pool.query("UPDATE games SET last_check_date = CURDATE() WHERE app_id = ?", [appId]);
            }
            catch {
            }
            return res.json({
                success: true,
                checked: true,
                hasUpdate,
                timestamp: vpsDate.toISOString(),
                depots,
                files,
                branchManifests: oldManifestData?.branch_manifests || {},
                checkedAt: new Date().toISOString(),
                source: "vps"
            });
        }
        try {
            const manifestUrl = `https://generator.ryuu.lol/manifestinfo/${appId}`;
            const manifestResponse = await (0, node_fetch_1.default)(manifestUrl, { signal: AbortSignal.timeout(10000) });
            if (!manifestResponse.ok) {
                return res.status(manifestResponse.status).json({
                    success: false,
                    checked: false,
                    message: "Failed to fetch manifest info"
                });
            }
            const manifestData = await manifestResponse.json();
            if (!manifestData?.timestamp) {
                return res.status(500).json({
                    success: false,
                    checked: false,
                    message: "Invalid manifest data"
                });
            }
            let hasUpdate = false;
            if (currentManifests?.depots && Object.keys(currentManifests.depots).length > 0) {
                hasUpdate = compareDepotUpdates(currentManifests.depots, currentManifests.files || [], manifestData);
            }
            else {
                hasUpdate = compareManifestUpdates(game, manifestData);
            }
            try {
                await pool.query("UPDATE games SET updated_at = ?, manifest_data = ?, last_check_date = CURDATE() WHERE app_id = ?", [manifestData.timestamp, JSON.stringify(manifestData), appId]);
            }
            catch {
                try {
                    await pool.query("UPDATE games SET updated_at = ?, last_check_date = CURDATE() WHERE app_id = ?", [manifestData.timestamp, appId]);
                }
                catch {
                }
            }
            const [finalDepots, finalFiles] = extractAllDepotFiles(manifestData);
            return res.json({
                success: true,
                checked: true,
                hasUpdate,
                timestamp: manifestData.timestamp,
                depots: finalDepots,
                files: finalFiles,
                branchManifests: manifestData.branch_manifests || {},
                checkedAt: new Date().toISOString(),
                source: "ryu"
            });
        }
        catch (fetchErr) {
            return res.status(500).json({
                success: false,
                checked: false,
                message: "Failed to call manifest API"
            });
        }
    }
    catch (err) {
        res.status(500).json({ success: false, message: "Failed to check reseller" });
    }
});
app.get("/games/search/:query", async (req, res) => {
    try {
        const query = req.params.query.trim();
        if (!query || query.length < 1) {
            return res.json([]);
        }
        const cacheKey = `search_${query.toLowerCase()}`;
        const cached = gameCheckCache.get(cacheKey);
        if (cached)
            return res.json(cached);
        const searchTerm = `%${query}%`;
        const prefixTerm = `${query}%`;
        const exactName = query;
        const [rows] = await pool.query(`SELECT 
        g.app_id,
        g.game_name,
        g.banner_url,
        g.tags,
        g.price,
        g.special_denuvo,
        (SELECT COUNT(*) FROM user_games WHERE game_id = g.app_id) +
        (SELECT COUNT(*) FROM user_games_log WHERE app_id = g.app_id AND source = 'purchase') AS purchases,
        (SELECT COUNT(*) FROM game_views WHERE app_id = g.app_id) AS view_count,
        CASE 
          WHEN LOWER(g.game_name) = LOWER(?) THEN 1000
          WHEN LOWER(g.game_name) LIKE LOWER(?) THEN 500
          WHEN LOWER(g.game_name) LIKE LOWER(?) THEN 100
          ELSE 10
        END AS match_score,
        LENGTH(g.game_name) AS name_length
      FROM games g
      WHERE LOWER(g.game_name) LIKE LOWER(?) OR g.app_id LIKE ?
      ORDER BY 
        match_score DESC,
        view_count DESC,
        purchases DESC,
        name_length ASC,
        g.game_name
      LIMIT 50`, [exactName, prefixTerm, searchTerm, searchTerm, searchTerm]);
        gameCheckCache.set(cacheKey, rows, 600);
        res.json(rows);
    }
    catch (err) {
        res.status(500).json({ message: "Failed to search games" });
    }
});
app.get("/steam/:app_id", async (req, res) => {
    const { app_id } = req.params;
    const attempts = [
        { l: "vietnamese", cc: "us" },
        { l: "english", cc: "us" },
        { l: "english", cc: "jp" },
        { l: "english", cc: "kr" },
    ];
    for (const attempt of attempts) {
        try {
            const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(app_id)}&l=${attempt.l}&cc=${attempt.cc}&filters=basic,price_overview,genres,release_date,platforms,metacritic,background,screenshots,movies,developers,publishers`;
            const response = await fetchWithRetry(url, 2, 500);
            if (!response.ok) {
                continue;
            }
            const json = (await response.json());
            const entry = json[app_id];
            if (entry?.success && entry?.data) {
                return res.json(json);
            }
        }
        catch (err) {
            continue;
        }
    }
    res.status(404).json({ message: "Game data not found in Steam API" });
});
app.get("/steam/:app_id/news", async (req, res) => {
    const { app_id } = req.params;
    const count = req.query.count ? parseInt(req.query.count) : 10;
    const maxlength = req.query.maxlength ? parseInt(req.query.maxlength) : 500;
    try {
        const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${encodeURIComponent(app_id)}&count=${count}&maxlength=${maxlength}&format=json`;
        const response = await (0, node_fetch_1.default)(url);
        if (!response.ok) {
            return res.status(response.status).json({ message: "Failed to fetch Steam news" });
        }
        const data = (await response.json());
        if (data?.appnews?.newsitems && data.appnews.newsitems.length > 0) {
            const vietnameseNews = data.appnews.newsitems.find((item) => item.feedname?.toLowerCase().includes('vietnamese') ||
                item.feedlabel?.toLowerCase().includes('vietnamese') ||
                item.contents?.toLowerCase().includes('tiếng việt'));
            if (vietnameseNews) {
                const reorderedItems = [vietnameseNews, ...data.appnews.newsitems.filter((item) => item.gid !== vietnameseNews.gid)];
                return res.json({
                    ...data,
                    appnews: {
                        ...data.appnews,
                        newsitems: reorderedItems
                    }
                });
            }
            return res.json(data);
        }
        return res.json(data);
    }
    catch (err) {
        res.status(500).json({ message: "Failed to fetch Steam news" });
    }
});
app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ message: "Tên đăng nhập và mật khẩu là bắt buộc" });
        }
        const [rows] = await pool.query("SELECT id, username, email, password, role, avatar_url, p_balance, phone_number FROM users WHERE username = ? OR email = ? LIMIT 1", [username, username]);
        const user = rows[0];
        if (!user) {
            return res.status(401).json({ message: "Tên đăng nhập hoặc mật khẩu không đúng" });
        }
        const isValidPassword = await bcrypt_1.default.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ message: "Tên đăng nhập hoặc mật khẩu không đúng" });
        }
        const sessionId = crypto_1.default.randomBytes(32).toString("hex");
        const now = new Date();
        await pool.query("UPDATE users SET session_id = ?, session_updated_at = ?, last_login = ?, is_online = 1 WHERE id = ?", [sessionId, now, now, user.id]);
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                avatar_url: user.avatar_url,
                p_balance: user.p_balance,
                phone_number: user.phone_number
            },
            sessionId
        });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi đăng nhập" });
    }
});
app.get("/auth/me", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.query.sessionId;
        if (!sessionId) {
            return res.status(401).json({ message: "Chưa đăng nhập" });
        }
        const [rows] = await pool.query("SELECT id, username, email, role, avatar_url, p_balance, phone_number, vip_expires_at, session_updated_at, tutorial_completed FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = rows[0];
        if (!user) {
            return res.status(401).json({ message: "Session không hợp lệ" });
        }
        const sessionUpdatedAt = new Date(user.session_updated_at);
        const now = new Date();
        const daysSinceUpdate = (now.getTime() - sessionUpdatedAt.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceUpdate > 30) {
            return res.status(401).json({ message: "Session đã hết hạn" });
        }
        let tutorialCompleted = {};
        if (user.tutorial_completed) {
            try {
                tutorialCompleted = JSON.parse(user.tutorial_completed);
            }
            catch {
                tutorialCompleted = {};
            }
        }
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                avatar_url: user.avatar_url,
                p_balance: user.p_balance,
                phone_number: user.phone_number,
                vip_expires_at: user.vip_expires_at,
                tutorial_completed: tutorialCompleted,
            }
        });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi xác thực" });
    }
});
app.post("/auth/logout", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.body.sessionId;
        if (sessionId) {
            await pool.query("UPDATE users SET session_id = NULL, session_updated_at = NULL, is_online = 0 WHERE session_id = ?", [sessionId]);
        }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi đăng xuất" });
    }
});
app.post("/auth/heartbeat", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.body.sessionId;
        if (sessionId) {
            await pool.query("UPDATE users SET session_updated_at = NOW(), is_online = 1 WHERE session_id = ?", [sessionId]);
            res.json({ success: true });
        }
        else {
            res.status(400).json({ success: false });
        }
    }
    catch {
        res.status(500).json({ success: false });
    }
});
// cheking heartbeat
setInterval(async () => {
    try {
        await pool.query("UPDATE users SET is_online = 0, session_id = NULL, session_updated_at = NULL WHERE is_online = 1 AND session_updated_at < DATE_SUB(NOW(), INTERVAL 60 SECOND)");
    }
    catch (err) {
        console.error("Error cleaning up inactive sessions:", err);
    }
}, 60000);
const emailPort = parseInt(process.env.EMAIL_PORT || "465");
const emailSecure = process.env.EMAIL_SECURE
    ? process.env.EMAIL_SECURE === "true"
    : emailPort === 465;
const emailTransporter = nodemailer_1.default.createTransport({
    host: process.env.EMAIL_HOST || "smtp.hostinger.com",
    port: emailPort,
    secure: emailSecure,
    auth: {
        user: process.env.EMAIL_USER || "supports@goslynk.com",
        pass: process.env.EMAIL_PASS || "0382248847Aa@Aa@",
    },
});
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
app.post("/auth/register/send-otp", async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ message: "Vui lòng điền đầy đủ thông tin" });
        }
        if (password.length < 6) {
            return res.status(400).json({ message: "Mật khẩu phải có ít nhất 6 ký tự" });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: "Email không hợp lệ" });
        }
        const [existingUsers] = await pool.query("SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1", [username, email]);
        if (existingUsers.length > 0) {
            const [checkUsername] = await pool.query("SELECT id FROM users WHERE username = ? LIMIT 1", [username]);
            if (checkUsername.length > 0) {
                return res.status(400).json({ message: "Tên đăng nhập đã tồn tại" });
            }
            return res.status(400).json({ message: "Email đã được sử dụng" });
        }
        const otp = generateOTP();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10);
        const [tempUsers] = await pool.query("SELECT id FROM users WHERE email = ? AND email_otp IS NOT NULL LIMIT 1", [email]);
        if (tempUsers.length > 0) {
            await pool.query("UPDATE users SET email_otp = ?, email_otp_expires_at = ? WHERE email = ?", [otp, expiresAt, email]);
        }
        else {
            const hashedPassword = await bcrypt_1.default.hash(password, 10);
            const userId = crypto_1.default.randomUUID();
            await pool.query("INSERT INTO users (id, username, email, password, email_otp, email_otp_expires_at, role) VALUES (?, ?, ?, ?, ?, ?, 'user')", [userId, username, email, hashedPassword, otp, expiresAt]);
        }
        const emailEnabled = process.env.EMAIL_ENABLED !== "false";
        if (emailEnabled) {
            try {
                const mailOptions = {
                    from: `"${process.env.EMAIL_FROM_NAME || "Goslynk"}" <${process.env.EMAIL_FROM || "supports@goslynk.com"}>`,
                    to: email,
                    subject: "Mã xác thực OTP - Goslynk",
                    html: `
            <!DOCTYPE html>
            <html lang="vi">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Mã xác thực OTP - Goslynk</title>
            </head>
            <body style="margin: 0; padding: 0; background-color: #36393f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #36393f;">
                <tr>
                  <td align="center" style="padding: 40px 20px;">
                    <table role="presentation" style="max-width: 520px; width: 100%; border-collapse: collapse; background-color: #2f3136; border-radius: 8px; overflow: hidden;">
                      <tr>
                        <td style="padding: 40px 32px;">
                          <h1 style="margin: 0 0 8px 0; color: #ffffff; font-size: 24px; font-weight: 600; letter-spacing: -0.3px;">
                            Mã xác thực OTP
                          </h1>
                          <p style="margin: 0 0 32px 0; color: #dcddde; font-size: 16px; line-height: 1.5;">
                            Xin chào,<br>
                            Chúng tôi đã nhận được yêu cầu đăng ký tài khoản của bạn. Vui lòng sử dụng mã OTP bên dưới để xác thực email của bạn.
                          </p>
                          
                          <div style="background-color: #202225; border-radius: 4px; padding: 24px; margin: 24px 0; text-align: center;">
                            <div style="color: #5865f2; font-size: 32px; font-weight: 600; letter-spacing: 8px; font-family: 'Courier New', monospace; margin: 0;">
                              ${otp}
                            </div>
                          </div>
                          
                          <div style="background-color: #202225; border-radius: 4px; padding: 16px; margin: 24px 0;">
                            <p style="margin: 0; color: #b9bbbe; font-size: 14px; line-height: 1.5;">
                              <span style="color: #ffffff; font-weight: 500;">Thời gian hiệu lực:</span> Mã này có hiệu lực trong <span style="color: #5865f2; font-weight: 500;">10 phút</span>.<br>
                              <span style="color: #ffffff; font-weight: 500;">Bảo mật:</span> Không chia sẻ mã này với bất kỳ ai.
                            </p>
                          </div>
                          
                          <p style="margin: 24px 0 0 0; color: #72767d; font-size: 14px; line-height: 1.5;">
                            Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email này. Tài khoản của bạn sẽ không bị ảnh hưởng.
                          </p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 0 32px 32px 32px; border-top: 1px solid #202225;">
                          <p style="margin: 16px 0 0 0; color: #72767d; font-size: 12px; line-height: 1.5;">
                            Trân trọng,<br>
                            <span style="color: #ffffff;">Đội ngũ Goslynk</span>
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </body>
            </html>
          `,
                };
                await emailTransporter.sendMail(mailOptions);
            }
            catch (emailError) {
                console.error("Email send error:", emailError);
            }
        }
        res.json({ success: true, message: "Đã gửi mã OTP đến email của bạn" });
    }
    catch (err) {
        console.error("Register send OTP error:", err);
        res.status(500).json({ message: "Lỗi gửi mã OTP" });
    }
});
app.post("/auth/register/verify", async (req, res) => {
    try {
        const { username, email, password, otp } = req.body;
        if (!username || !email || !password || !otp) {
            return res.status(400).json({ message: "Vui lòng điền đầy đủ thông tin" });
        }
        if (otp.length !== 6) {
            return res.status(400).json({ message: "Mã OTP không hợp lệ" });
        }
        const [rows] = await pool.query("SELECT id, email_otp, email_otp_expires_at FROM users WHERE email = ? AND username = ? LIMIT 1", [email, username]);
        const user = rows[0];
        if (!user) {
            return res.status(400).json({ message: "Không tìm thấy thông tin đăng ký" });
        }
        if (!user.email_otp) {
            return res.status(400).json({ message: "Mã OTP không hợp lệ" });
        }
        if (user.email_otp !== otp) {
            return res.status(400).json({ message: "Mã OTP không đúng" });
        }
        const expiresAt = new Date(user.email_otp_expires_at);
        const now = new Date();
        if (now > expiresAt) {
            return res.status(400).json({ message: "Mã OTP đã hết hạn" });
        }
        await pool.query("UPDATE users SET email_otp = NULL, email_otp_expires_at = NULL WHERE id = ?", [user.id]);
        res.json({ success: true, message: "Đăng ký thành công" });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi xác thực OTP" });
    }
});
app.post("/auth/forgot-password/send-otp", async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ message: "Vui lòng nhập email" });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: "Email không hợp lệ" });
        }
        const [rows] = await pool.query("SELECT id, email FROM users WHERE email = ? LIMIT 1", [email]);
        const user = rows[0];
        if (!user) {
            return res.status(400).json({ message: "Email không tồn tại trong hệ thống" });
        }
        const otp = generateOTP();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10);
        await pool.query("UPDATE users SET email_otp = ?, email_otp_expires_at = ? WHERE email = ?", [otp, expiresAt, email]);
        const emailEnabled = process.env.EMAIL_ENABLED !== "false";
        if (emailEnabled) {
            try {
                const mailOptions = {
                    from: `"${process.env.EMAIL_FROM_NAME || "Goslynk"}" <${process.env.EMAIL_FROM || "supports@goslynk.com"}>`,
                    to: email,
                    subject: "Mã xác thực OTP - Khôi phục mật khẩu - Goslynk",
                    html: `
            <!DOCTYPE html>
            <html lang="vi">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Khôi phục mật khẩu - Goslynk</title>
            </head>
            <body style="margin: 0; padding: 0; background-color: #36393f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #36393f;">
                <tr>
                  <td align="center" style="padding: 40px 20px;">
                    <table role="presentation" style="max-width: 520px; width: 100%; border-collapse: collapse; background-color: #2f3136; border-radius: 8px; overflow: hidden;">
                      <tr>
                        <td style="padding: 40px 32px;">
                          <h1 style="margin: 0 0 8px 0; color: #ffffff; font-size: 24px; font-weight: 600; letter-spacing: -0.3px;">
                            Khôi phục mật khẩu
                          </h1>
                          <p style="margin: 0 0 32px 0; color: #dcddde; font-size: 16px; line-height: 1.5;">
                            Xin chào,<br>
                            Chúng tôi đã nhận được yêu cầu khôi phục mật khẩu cho tài khoản của bạn. Vui lòng sử dụng mã OTP bên dưới để xác thực.
                          </p>
                          
                          <div style="background-color: #202225; border-radius: 4px; padding: 24px; margin: 24px 0; text-align: center;">
                            <div style="color: #5865f2; font-size: 32px; font-weight: 600; letter-spacing: 8px; font-family: 'Courier New', monospace; margin: 0;">
                              ${otp}
                            </div>
                          </div>
                          
                          <div style="background-color: #202225; border-radius: 4px; padding: 16px; margin: 24px 0;">
                            <p style="margin: 0; color: #b9bbbe; font-size: 14px; line-height: 1.5;">
                              <span style="color: #faa61a; font-weight: 500;">Cảnh báo:</span> Nếu bạn không yêu cầu khôi phục mật khẩu, vui lòng bỏ qua email này và đảm bảo tài khoản của bạn an toàn.<br>
                              <span style="color: #ffffff; font-weight: 500;">Thời gian hiệu lực:</span> Mã này có hiệu lực trong <span style="color: #5865f2; font-weight: 500;">10 phút</span>.
                            </p>
                          </div>
                          
                          <p style="margin: 24px 0 0 0; color: #72767d; font-size: 14px; line-height: 1.5;">
                            Nếu bạn không yêu cầu khôi phục mật khẩu, vui lòng bỏ qua email này.
                          </p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 0 32px 32px 32px; border-top: 1px solid #202225;">
                          <p style="margin: 16px 0 0 0; color: #72767d; font-size: 12px; line-height: 1.5;">
                            Trân trọng,<br>
                            <span style="color: #ffffff;">Đội ngũ Goslynk</span>
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </body>
            </html>
          `,
                };
                await emailTransporter.sendMail(mailOptions);
            }
            catch (emailError) {
                console.error("Email send error:", emailError);
            }
        }
        res.json({ success: true, message: "Đã gửi mã OTP đến email của bạn" });
    }
    catch (err) {
        console.error("Forgot password send OTP error:", err);
        res.status(500).json({ message: "Lỗi gửi mã OTP" });
    }
});
app.post("/auth/forgot-password/verify-otp", async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) {
            return res.status(400).json({ message: "Vui lòng điền đầy đủ thông tin" });
        }
        if (otp.length !== 6) {
            return res.status(400).json({ message: "Mã OTP không hợp lệ" });
        }
        const [rows] = await pool.query("SELECT id, email_otp, email_otp_expires_at FROM users WHERE email = ? LIMIT 1", [email]);
        const user = rows[0];
        if (!user) {
            return res.status(400).json({ message: "Email không tồn tại" });
        }
        if (!user.email_otp) {
            return res.status(400).json({ message: "Mã OTP không hợp lệ" });
        }
        if (user.email_otp !== otp) {
            return res.status(400).json({ message: "Mã OTP không đúng" });
        }
        const expiresAt = new Date(user.email_otp_expires_at);
        const now = new Date();
        if (now > expiresAt) {
            return res.status(400).json({ message: "Mã OTP đã hết hạn" });
        }
        res.json({ success: true, message: "Xác thực OTP thành công" });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi xác thực OTP" });
    }
});
app.post("/auth/forgot-password/reset", async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        if (!email || !otp || !newPassword) {
            return res.status(400).json({ message: "Vui lòng điền đầy đủ thông tin" });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ message: "Mật khẩu phải có ít nhất 6 ký tự" });
        }
        if (otp.length !== 6) {
            return res.status(400).json({ message: "Mã OTP không hợp lệ" });
        }
        const [rows] = await pool.query("SELECT id, email_otp, email_otp_expires_at FROM users WHERE email = ? LIMIT 1", [email]);
        const user = rows[0];
        if (!user) {
            return res.status(400).json({ message: "Email không tồn tại" });
        }
        if (!user.email_otp || user.email_otp !== otp) {
            return res.status(400).json({ message: "Mã OTP không hợp lệ" });
        }
        const expiresAt = new Date(user.email_otp_expires_at);
        const now = new Date();
        if (now > expiresAt) {
            return res.status(400).json({ message: "Mã OTP đã hết hạn" });
        }
        const hashedPassword = await bcrypt_1.default.hash(newPassword, 10);
        await pool.query("UPDATE users SET password = ?, email_otp = NULL, email_otp_expires_at = NULL WHERE id = ?", [hashedPassword, user.id]);
        res.json({ success: true, message: "Đặt lại mật khẩu thành công" });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi đặt lại mật khẩu" });
    }
});
app.put("/auth/update-profile", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.body.sessionId;
        const { email, phone_number } = req.body;
        if (!sessionId) {
            return res.status(401).json({ message: "Chưa đăng nhập" });
        }
        const [userRows] = await pool.query("SELECT id FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.status(401).json({ message: "Session không hợp lệ" });
        }
        const updates = [];
        const values = [];
        if (email !== undefined) {
            updates.push("email = ?");
            values.push(email);
        }
        if (phone_number !== undefined) {
            updates.push("phone_number = ?");
            values.push(phone_number);
        }
        if (updates.length === 0) {
            return res.status(400).json({ message: "Không có dữ liệu để cập nhật" });
        }
        values.push(user.id);
        await pool.query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, values);
        const [updatedRows] = await pool.query("SELECT id, username, email, role, avatar_url, p_balance, phone_number FROM users WHERE id = ? LIMIT 1", [user.id]);
        const updatedUser = updatedRows[0];
        res.json({
            success: true,
            user: {
                id: updatedUser.id,
                username: updatedUser.username,
                email: updatedUser.email,
                role: updatedUser.role,
                avatar_url: updatedUser.avatar_url,
                p_balance: updatedUser.p_balance,
                phone_number: updatedUser.phone_number
            }
        });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi cập nhật thông tin" });
    }
});
app.get("/wishlist/count", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.query.sessionId;
        if (!sessionId) {
            return res.status(401).json({ message: "Chưa đăng nhập" });
        }
        const [userRows] = await pool.query("SELECT id FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.status(401).json({ message: "Session không hợp lệ" });
        }
        const [countRows] = await pool.query("SELECT COUNT(*) as count FROM user_wishlist WHERE user_id = ?", [user.id]);
        const count = countRows[0]?.count || 0;
        res.json({ success: true, count });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi lấy wishlist count" });
    }
});
app.get("/wishlist", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.query.sessionId;
        if (!sessionId) {
            return res.status(401).json({ message: "Chưa đăng nhập" });
        }
        const [userRows] = await pool.query("SELECT id FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.status(401).json({ message: "Session không hợp lệ" });
        }
        const [wishlistRows] = await pool.query(`SELECT uw.id, uw.game_id, uw.added_at, g.game_name, g.banner_url, g.price 
       FROM user_wishlist uw 
       INNER JOIN games g ON uw.game_id = g.app_id 
       WHERE uw.user_id = ? 
       ORDER BY uw.added_at DESC`, [user.id]);
        const games = wishlistRows.map((row) => ({
            id: row.id,
            game_id: row.game_id,
            game_name: row.game_name,
            banner_url: row.banner_url,
            price: row.price,
            added_at: row.added_at,
        }));
        res.json({ success: true, games });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi lấy wishlist" });
    }
});
async function syncVipGameExpires(userId) {
    try {
        const [userRows] = await pool.query("SELECT vip_expires_at FROM users WHERE id = ? LIMIT 1", [userId]);
        const user = userRows[0];
        if (!user || !user.vip_expires_at)
            return;
        const vipExpiresAt = new Date(user.vip_expires_at);
        if (isNaN(vipExpiresAt.getTime()))
            return;
        await pool.query("UPDATE user_games_log SET expires_at = ? WHERE user_id = ? AND source = 'vip' AND (expires_at IS NULL OR expires_at != ?)", [vipExpiresAt, userId, vipExpiresAt]);
    }
    catch (err) {
    }
}
async function checkAndUpdateExpiredVip(userId) {
    try {
        const [userRows] = await pool.query("SELECT vip_expires_at, role FROM users WHERE id = ? LIMIT 1", [userId]);
        const user = userRows[0];
        if (!user)
            return false;
        const now = new Date();
        const vipExpired = !user.vip_expires_at || new Date(user.vip_expires_at) < now;
        const isVip = user.role === "vip" || user.role === "vip_plus";
        if (vipExpired && isVip) {
            await pool.query("UPDATE users SET role = 'user' WHERE id = ?", [userId]);
            await pool.query("UPDATE user_vip_subscriptions SET status = 'expired' WHERE user_id = ? AND status = 'active' AND expires_at <= NOW()", [userId]);
            return true;
        }
        return false;
    }
    catch (err) {
        return false;
    }
}
async function cleanupExpiredVipGames(userId) {
    const deletedGameIds = [];
    let vipExpired = false;
    try {
        await syncVipGameExpires(userId);
        vipExpired = await checkAndUpdateExpiredVip(userId);
        const [userRows] = await pool.query("SELECT vip_expires_at, role FROM users WHERE id = ? LIMIT 1", [userId]);
        const user = userRows[0];
        if (!user)
            return { deletedGameIds, vipExpired };
        const now = new Date();
        const isVipExpired = !user.vip_expires_at || new Date(user.vip_expires_at) < now;
        const isVip = user.role === "vip" || user.role === "vip_plus";
        const isAdminOrSuperAdmin = user.role === "admin" || user.role === "super_admin";
        if (isAdminOrSuperAdmin) {
            return { deletedGameIds, vipExpired };
        }
        if (isVipExpired || !isVip || vipExpired) {
            const [vipGames] = await pool.query(`SELECT ugl.app_id, ugl.id as log_id, ug.id as game_id
         FROM user_games_log ugl
         LEFT JOIN user_games ug ON ugl.user_id = ug.user_id AND ugl.app_id = ug.game_id
         WHERE ugl.user_id = ? AND ugl.source = 'vip'`, [userId]);
            const vipGamesList = vipGames;
            if (vipGamesList.length > 0) {
                const conn = await pool.getConnection();
                try {
                    await conn.beginTransaction();
                    for (const game of vipGamesList) {
                        if (game.game_id) {
                            await conn.query("DELETE FROM user_games WHERE id = ?", [game.game_id]);
                        }
                        deletedGameIds.push(game.app_id);
                        await conn.query("UPDATE user_games_log SET expires_at = NOW() WHERE id = ?", [game.log_id]);
                    }
                    await conn.commit();
                }
                catch (err) {
                    await conn.rollback();
                    throw err;
                }
                finally {
                    conn.release();
                }
            }
        }
    }
    catch (err) {
    }
    return { deletedGameIds, vipExpired };
}
app.get("/purchases/history", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") ||
            req.query.sessionId;
        if (!sessionId) {
            return res.status(401).json({ message: "Chưa đăng nhập" });
        }
        const [userRows] = await pool.query("SELECT id, vip_expires_at, role FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.status(401).json({ message: "Session không hợp lệ" });
        }
        const { deletedGameIds, vipExpired: vipWasExpired } = await cleanupExpiredVipGames(user.id);
        const now = new Date();
        const vipExpired = !user.vip_expires_at || new Date(user.vip_expires_at) < now;
        const isVip = user.role === "vip" || user.role === "vip_plus" || user.role === "admin" || user.role === "super_admin";
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;
        const [rows] = await pool.query(`SELECT 
         ug.id,
         ug.game_id,
         ug.purchased_at,
         ug.price_paid,
         COALESCE(g.game_name, CONCAT('Game ', ug.game_id)) as game_name,
         g.banner_url,
         COALESCE(ugl.source, 'purchase') as source,
         ugl.expires_at
       FROM user_games ug
       LEFT JOIN user_games_log ugl ON ug.user_id = ugl.user_id 
         AND ug.game_id = ugl.app_id
       LEFT JOIN games g ON ug.game_id = g.app_id
       WHERE ug.user_id = ?
       ORDER BY ug.purchased_at DESC
       LIMIT ? OFFSET ?`, [user.id, limit, offset]);
        const [countRows] = await pool.query(`SELECT COUNT(*) as total
         FROM user_games ug
       WHERE ug.user_id = ?`, [user.id]);
        const totalCount = countRows[0]?.total || 0;
        const purchases = rows.map((row) => {
            const isVipGame = row.source === 'vip';
            const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
            const isExpired = isVipGame && expiresAt && expiresAt < now;
            let bannerUrl = row.banner_url;
            if (bannerUrl && bannerUrl.includes('?t=')) {
                bannerUrl = bannerUrl.split('?')[0];
            }
            return {
                id: row.id,
                game_id: row.game_id,
                game_name: row.game_name || `Game ${row.game_id}`,
                banner_url: bannerUrl,
                purchased_at: row.purchased_at,
                price_paid: row.price_paid,
                is_vip: isVipGame,
                expires_at: row.expires_at,
            };
        });
        const missingBannerGames = purchases
            .filter((p) => !p.banner_url && p.game_id)
            .map((p) => p.game_id);
        if (missingBannerGames.length > 0) {
            Promise.all(missingBannerGames.map((gameId) => fetchAndUpdateBanner(gameId).catch((err) => {
                console.error(`[fetchAndUpdateBanner] Error fetching banner for ${gameId}:`, err);
            }))).catch(() => { });
        }
        const filteredPurchases = purchases.filter((p) => {
            if (!p.is_vip) {
                return true;
            }
            if (!isVip) {
                return false;
            }
            if (user.role === "admin" || user.role === "super_admin") {
                return true;
            }
            if (vipExpired) {
                return false;
            }
            if (p.expires_at) {
                const expDate = new Date(p.expires_at);
                if (isNaN(expDate.getTime())) {
                    return true;
                }
                return expDate >= now;
            }
            return true;
        });
        res.json({
            success: true,
            purchases: filteredPurchases,
            deleted_game_ids: deletedGameIds,
            vip_expired: vipWasExpired,
            total: totalCount,
            limit: limit,
            offset: offset,
            has_more: offset + filteredPurchases.length < totalCount
        });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi lấy lịch sử mua game" });
    }
});
app.delete("/library/:id", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") ||
            req.query.sessionId;
        const { id } = req.params;
        if (!sessionId) {
            return res.status(401).json({ message: "Chưa đăng nhập" });
        }
        const [userRows] = await pool.query("SELECT id FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.status(401).json({ message: "Session không hợp lệ" });
        }
        await pool.query("DELETE FROM user_games WHERE id = ? AND user_id = ?", [id, user.id]);
        res.json({ success: true, message: "Đã xóa game khỏi library" });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi xóa game" });
    }
});
app.get("/library/owned/:app_id", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") ||
            req.query.sessionId;
        const { app_id } = req.params;
        if (!sessionId || !app_id) {
            return res.json({ success: true, owned: false, vip_expired: false });
        }
        const [userRows] = await pool.query("SELECT id, role, vip_expires_at FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.json({ success: true, owned: false, vip_expired: false });
        }
        const [rows] = await pool.query(`SELECT ug.id, ugl.source, ugl.expires_at
       FROM user_games ug
       LEFT JOIN user_games_log ugl ON ug.user_id = ugl.user_id 
         AND ug.game_id = ugl.app_id 
         AND ugl.source = 'vip'
       WHERE ug.user_id = ? AND ug.game_id = ? LIMIT 1`, [user.id, app_id]);
        const game = rows[0];
        if (!game) {
            return res.json({ success: true, owned: false, vip_expired: false });
        }
        const isVipGame = game.source === 'vip';
        const now = new Date();
        let vipExpired = false;
        if (isVipGame) {
            const isVip = user.role === "vip" || user.role === "vip_plus" || user.role === "admin" || user.role === "super_admin";
            const userVipExpired = !user.vip_expires_at || new Date(user.vip_expires_at) < now;
            if (user.role === "admin" || user.role === "super_admin") {
                vipExpired = false;
            }
            else if (!isVip || userVipExpired) {
                vipExpired = true;
            }
            else if (game.expires_at) {
                const gameExpiresAt = new Date(game.expires_at);
                if (gameExpiresAt < now) {
                    vipExpired = true;
                }
            }
        }
        res.json({
            success: true,
            owned: true,
            is_vip: isVipGame,
            vip_expired: vipExpired,
            expires_at: game.expires_at,
            app_id: app_id
        });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi kiểm tra sở hữu game" });
    }
});
const vipSubCache = new node_cache_1.default({ stdTTL: 60, checkperiod: 120 });
app.get("/vip/subscription", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") ||
            req.query.sessionId;
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Chưa đăng nhập" });
        }
        const cachedData = vipSubCache.get(`vip_sub_${sessionId}`);
        if (cachedData) {
            return res.json({ success: true, subscription: cachedData });
        }
        const [userRows] = await pool.query("SELECT id, role, vip_expires_at FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.status(401).json({ success: false, message: "Session không hợp lệ" });
        }
        const isVip = user.role === "vip" || user.role === "vip_plus";
        if (!isVip) {
            vipSubCache.set(`vip_sub_${sessionId}`, null);
            return res.json({ success: true, subscription: null });
        }
        const [subscriptionRows] = await pool.query(`SELECT uvs.expires_at, uvs.status, uvs.package_id, vp.type, vp.duration 
       FROM user_vip_subscriptions uvs 
       JOIN vip_packages vp ON uvs.package_id = vp.id 
       WHERE uvs.user_id = ? AND uvs.status = 'active' 
       ORDER BY uvs.expires_at DESC LIMIT 1`, [user.id]);
        const subscription = subscriptionRows[0];
        if (subscription && user.vip_expires_at && subscription.expires_at !== user.vip_expires_at) {
            subscription.expires_at = user.vip_expires_at;
        }
        vipSubCache.set(`vip_sub_${sessionId}`, subscription || null);
        res.json({
            success: true,
            subscription: subscription || null
        });
    }
    catch (err) {
        res.status(500).json({ success: false, message: "Lỗi lấy thông tin subscription" });
    }
});
app.get("/vip/check-expiry", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") ||
            req.query.sessionId;
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Chưa đăng nhập" });
        }
        const [userRows] = await pool.query("SELECT id, role, vip_expires_at FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.status(401).json({ success: false, message: "Session không hợp lệ" });
        }
        const { deletedGameIds, vipExpired } = await cleanupExpiredVipGames(user.id);
        if (vipExpired) {
            const [updatedUserRows] = await pool.query("SELECT role FROM users WHERE id = ? LIMIT 1", [user.id]);
            const updatedUser = updatedUserRows[0];
            return res.json({
                success: true,
                vip_expired: true,
                deleted_game_ids: deletedGameIds,
                user_role: updatedUser?.role || 'user'
            });
        }
        const now = new Date();
        const isExpired = !user.vip_expires_at || new Date(user.vip_expires_at) < now;
        res.json({
            success: true,
            vip_expired: false,
            is_expired: isExpired,
            vip_expires_at: user.vip_expires_at,
            user_role: user.role,
            deleted_game_ids: deletedGameIds.length > 0 ? deletedGameIds : undefined
        });
    }
    catch (err) {
        res.status(500).json({ success: false, message: "Lỗi kiểm tra VIP" });
    }
});
app.post("/games/add-vip", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") ||
            req.body.sessionId;
        const { app_id } = req.body;
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Chưa đăng nhập" });
        }
        if (!app_id) {
            return res.status(400).json({ success: false, message: "Game ID là bắt buộc" });
        }
        const [userRows] = await pool.query("SELECT id, role FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.status(401).json({ success: false, message: "Session không hợp lệ" });
        }
        if (user.role !== "vip" &&
            user.role !== "vip_plus" &&
            user.role !== "admin" &&
            user.role !== "super_admin") {
            return res.status(403).json({
                success: false,
                message: "Chỉ tài khoản VIP/VIP+ mới có thể thêm game này"
            });
        }
        const [gameRows] = await pool.query("SELECT special_denuvo FROM games WHERE app_id = ? LIMIT 1", [app_id]);
        const game = gameRows[0];
        if (!game) {
            return res.status(404).json({ success: false, message: "Game không tồn tại" });
        }
        const isVipPlusLike = user.role === "vip_plus" ||
            user.role === "admin" ||
            user.role === "super_admin";
        if (game.special_denuvo === 1 && !isVipPlusLike) {
            return res.status(403).json({
                success: false,
                message: "Game này chỉ dành cho VIP+"
            });
        }
        const [existingRows] = await pool.query("SELECT id FROM user_games WHERE user_id = ? AND game_id = ? LIMIT 1", [user.id, app_id]);
        if (existingRows.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Bạn đã sở hữu game này"
            });
        }
        const [userVipRows] = await pool.query("SELECT vip_expires_at FROM users WHERE id = ? LIMIT 1", [user.id]);
        const userVip = userVipRows[0];
        const isAdminOrSuperAdmin = user.role === "admin" || user.role === "super_admin";
        const vipExpiresAt = isAdminOrSuperAdmin
            ? null
            : (userVip?.vip_expires_at ? new Date(userVip.vip_expires_at) : null);
        const conn = await pool.getConnection();
        await conn.beginTransaction();
        try {
            const uuid = require("crypto").randomUUID;
            const gameEntryId = uuid();
            await conn.query("INSERT INTO user_games (id, user_id, game_id, price_paid) VALUES (?, ?, ?, ?)", [gameEntryId, user.id, app_id, 0]);
            const logId = uuid();
            await conn.query("INSERT INTO user_games_log (id, user_id, app_id, source, expires_at, drm_active) VALUES (?, ?, ?, ?, ?, ?)", [
                logId,
                user.id,
                app_id,
                "vip",
                vipExpiresAt,
                game.special_denuvo === 1 ? 1 : 0
            ]);
            await conn.commit();
            conn.release();
            res.json({
                success: true,
                message: "Đã thêm game vào thư viện",
                game_id: app_id
            });
        }
        catch (err) {
            await conn.rollback();
            conn.release();
            throw err;
        }
    }
    catch (err) {
        res.status(500).json({ success: false, message: "Lỗi thêm game" });
    }
});
app.post("/games/track-view", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.body.sessionId;
        const { app_id } = req.body;
        if (!app_id) {
            return res.status(400).json({ success: false, message: "Game ID is required" });
        }
        let userId = null;
        if (sessionId) {
            const [userRows] = await pool.query("SELECT id FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
            if (userRows.length > 0) {
                userId = userRows[0].id;
            }
        }
        const ipAddress = req.ip || req.headers["x-forwarded-for"] || "unknown";
        const viewId = require("crypto").randomUUID();
        await pool.query("INSERT INTO game_views (id, app_id, user_id, ip_address, viewed_at) VALUES (?, ?, ?, ?, NOW())", [viewId, app_id, userId, ipAddress]);
        res.json({ success: true });
    }
    catch (err) {
        console.error("Error tracking game view:", err);
        res.status(500).json({ success: false, message: "Failed to track view" });
    }
});
app.post("/wishlist/add", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.body.sessionId;
        const { game_id } = req.body;
        if (!sessionId) {
            return res.status(401).json({ message: "Chưa đăng nhập" });
        }
        if (!game_id) {
            return res.status(400).json({ message: "Game ID là bắt buộc" });
        }
        const [userRows] = await pool.query("SELECT id FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.status(401).json({ message: "Session không hợp lệ" });
        }
        const [existingRows] = await pool.query("SELECT id FROM user_wishlist WHERE user_id = ? AND game_id = ? LIMIT 1", [user.id, game_id]);
        if (existingRows.length > 0) {
            return res.json({ success: true, message: "Đã có trong wishlist" });
        }
        const uuid = require("crypto").randomUUID();
        await pool.query("INSERT INTO user_wishlist (id, user_id, game_id) VALUES (?, ?, ?)", [uuid, user.id, game_id]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi thêm vào wishlist" });
    }
});
app.get("/wishlist/check/:game_id", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.query.sessionId;
        const { game_id } = req.params;
        if (!sessionId) {
            return res.json({ success: true, inWishlist: false });
        }
        const [userRows] = await pool.query("SELECT id FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.json({ success: true, inWishlist: false });
        }
        const [wishlistRows] = await pool.query("SELECT id FROM user_wishlist WHERE user_id = ? AND game_id = ? LIMIT 1", [user.id, game_id]);
        const inWishlist = wishlistRows.length > 0;
        res.json({ success: true, inWishlist });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi kiểm tra wishlist" });
    }
});
app.post("/wishlist/remove", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.body.sessionId;
        const { game_id } = req.body;
        if (!sessionId) {
            return res.status(401).json({ message: "Chưa đăng nhập" });
        }
        if (!game_id) {
            return res.status(400).json({ message: "Game ID là bắt buộc" });
        }
        const [userRows] = await pool.query("SELECT id FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.status(401).json({ message: "Session không hợp lệ" });
        }
        await pool.query("DELETE FROM user_wishlist WHERE user_id = ? AND game_id = ?", [user.id, game_id]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi xóa khỏi wishlist" });
    }
});
app.post("/cart/checkout", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.body.sessionId;
        const items = (req.body.items || []);
        if (!sessionId) {
            return res.status(401).json({ message: "Chưa đăng nhập" });
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: "Giỏ hàng trống" });
        }
        const [userRows] = await pool.query("SELECT id, p_balance, role FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.status(401).json({ message: "Session không hợp lệ" });
        }
        const isAdmin = user.role === "admin" || user.role === "super_admin";
        const allValidItems = items.filter((it) => it &&
            typeof it.game_id === "string" &&
            it.game_id &&
            typeof it.price === "number" &&
            it.price >= 0);
        if (allValidItems.length === 0) {
            return res.status(400).json({ message: "Dữ liệu giỏ hàng không hợp lệ" });
        }
        const paidItems = allValidItems.filter((it) => it.price > 0);
        const total = paidItems.reduce((sum, it) => sum + it.price, 0);
        if (total > 0 && user.p_balance < total) {
            return res
                .status(400)
                .json({ success: false, code: "INSUFFICIENT_FUNDS" });
        }
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            if (total > 0) {
                const [updateResult] = await conn.query("UPDATE users SET p_balance = p_balance - ? WHERE id = ? AND p_balance >= ?", [total, user.id, total]);
                if (!updateResult.affectedRows) {
                    await conn.rollback();
                    conn.release();
                    return res
                        .status(400)
                        .json({ success: false, code: "INSUFFICIENT_FUNDS" });
                }
            }
            const uuid = require("crypto").randomUUID;
            for (const item of allValidItems) {
                const gameEntryId = uuid();
                await conn.query("INSERT INTO user_games (id, user_id, game_id, price_paid) VALUES (?, ?, ?, ?)", [gameEntryId, user.id, item.game_id, Math.round(item.price)]);
            }
            let txId = null;
            if (!isAdmin) {
                txId = uuid();
                await conn.query("INSERT INTO transactions (id, user_id, type, amount, currency, status, payment_method, description, reference_id, fiat_amount, bank_transaction_id, bank_description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    txId,
                    user.id,
                    "cart_checkout",
                    Math.round(total),
                    "G",
                    "completed",
                    total > 0 ? "wallet" : "free",
                    "Cart checkout",
                    null,
                    null,
                    null,
                    null,
                ]);
            }
            await conn.commit();
            conn.release();
            res.json({ success: true, totalCharged: total, transactionId: txId });
        }
        catch (err) {
            await conn.rollback();
            conn.release();
            res.status(500).json({ message: "Lỗi thanh toán giỏ hàng" });
        }
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi thanh toán giỏ hàng" });
    }
});
const WEB2M_URL = process.env.WEB2M_URL ||
    "https://api.web2m.com/historyapimbv3/Goteamactivate2025/0777820278/FA8919E8-D344-2081-96E1-6E1BE9C0532A";
const DEPOSIT_WATCHER_ENABLED = (process.env.DEPOSIT_WATCHER_ENABLED || "true").toLowerCase() === "true";
const DEPOSIT_WATCHER_INTERVAL_MS = Number(process.env.DEPOSIT_WATCHER_INTERVAL_MS || 2000);
const DEPOSIT_RECONCILE_ENABLED = (process.env.DEPOSIT_RECONCILE_ENABLED || "true").toLowerCase() === "true";
const DEPOSIT_RECONCILE_INTERVAL_MS = Number(process.env.DEPOSIT_RECONCILE_INTERVAL_MS || 300000);
const RECON_KEY = process.env.RECON_KEY || "";
function normalizeMatchString(input) {
    return String(input || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
}
function parseBankDate(dateStr) {
    const parts = String(dateStr || "").trim().split("/");
    if (parts.length !== 3)
        return null;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year))
        return null;
    return new Date(year, month, day);
}
function isBankDateCloseTo(txCreated, bankDateStr) {
    if (!txCreated)
        return true;
    const bankDate = parseBankDate(bankDateStr);
    if (!bankDate)
        return true;
    const diffDays = Math.abs(Math.floor((bankDate.getTime() - txCreated.getTime()) / (1000 * 60 * 60 * 24)));
    return diffDays <= 1;
}
function matchDepositTx(tx, tr, usedIds) {
    const bankTxId = String(tr.transactionID || tr.transactionId || "").trim();
    if (bankTxId && usedIds.has(bankTxId))
        return false;
    const trType = String(tr.type || "").toUpperCase();
    if (trType !== "IN")
        return false;
    const amt = Math.round(Number(tr.amount) || 0);
    if (Number.isNaN(amt) || amt !== Math.round(Number(tx.amount) || 0))
        return false;
    const descNorm = normalizeMatchString(tr.description || "");
    const codeNorm = normalizeMatchString(tx.description || "");
    if (!codeNorm)
        return false;
    const txCreated = tx.created_at ? new Date(tx.created_at) : null;
    if (!isBankDateCloseTo(txCreated, String(tr.transactionDate || "")))
        return false;
    if (descNorm.includes(codeNorm))
        return true;
    const userPart = codeNorm.startsWith("NAP") ? codeNorm.slice(3) : codeNorm;
    const shortPart = codeNorm.slice(-6);
    const userPartOnly = userPart.slice(0, Math.max(0, userPart.length - 6));
    if (userPart && shortPart && descNorm.includes(userPart) && descNorm.includes(shortPart)) {
        return true;
    }
    if (userPartOnly && shortPart && descNorm.includes(userPartOnly) && descNorm.includes(shortPart)) {
        return true;
    }
    return false;
}
app.post("/wallet/deposit", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.body.sessionId;
        const amount = Number(req.body.amount);
        if (!sessionId) {
            return res.status(401).json({ message: "Chưa đăng nhập" });
        }
        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({ message: "Số tiền nạp không hợp lệ" });
        }
        const [userRows] = await pool.query("SELECT id, username FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.status(401).json({ message: "Session không hợp lệ" });
        }
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const uuid = require("crypto").randomUUID;
            const txId = uuid();
            const short = crypto_1.default.randomBytes(3).toString("hex").toUpperCase(); // 6 chars
            const code = `NAP ${String(user.username || user.id).toUpperCase()} ${short}`;
            await conn.query("INSERT INTO transactions (id, user_id, type, amount, currency, status, payment_method, description, reference_id, fiat_amount, bank_transaction_id, bank_description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                txId,
                user.id,
                "deposit",
                Math.round(amount),
                "G",
                "pending",
                "mbbank",
                code,
                null,
                null,
                null,
                null,
            ]);
            await conn.commit();
            conn.release();
            res.json({
                success: true,
                transactionId: txId,
                amount: Math.round(amount),
                code,
            });
        }
        catch (err) {
            await conn.rollback();
            conn.release();
            res.status(500).json({ message: "Lỗi nạp tiền" });
        }
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi nạp tiền" });
    }
});
app.post("/wallet/deposit/refresh", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.body.sessionId;
        const transactionId = req.body.transactionId;
        if (!sessionId) {
            return res.status(401).json({ message: "Chưa đăng nhập" });
        }
        if (!transactionId) {
            return res.status(400).json({ message: "Thiếu mã giao dịch" });
        }
        const [userRows] = await pool.query("SELECT id FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.status(401).json({ message: "Session không hợp lệ" });
        }
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const [txRows] = await conn.query("SELECT *, created_at FROM transactions WHERE id = ? AND user_id = ? AND type = 'deposit' LIMIT 1 FOR UPDATE", [transactionId, user.id]);
            const tx = txRows[0];
            if (!tx) {
                await conn.rollback();
                conn.release();
                return res.status(404).json({ message: "Không tìm thấy giao dịch" });
            }
            if (tx.status === "completed") {
                await conn.commit();
                conn.release();
                return res.json({
                    success: true,
                    status: "completed",
                    amount: tx.amount,
                    transactionId,
                });
            }
            let apiJson = null;
            try {
                const apiRes = await (0, node_fetch_1.default)(WEB2M_URL);
                apiJson = await apiRes.json();
            }
            catch (err) {
            }
            if (!apiJson?.status || !Array.isArray(apiJson.transactions)) {
                await conn.commit();
                conn.release();
                return res.json({ success: false, status: "pending" });
            }
            const [usedBankTxIds] = await conn.query("SELECT bank_transaction_id FROM transactions WHERE bank_transaction_id IS NOT NULL AND bank_transaction_id != ''");
            const usedIds = new Set(usedBankTxIds.map((row) => String(row.bank_transaction_id || "").trim()).filter(Boolean));
            const code = (tx.description || "").toUpperCase().trim();
            if (!code || code.length < 6) {
                await conn.commit();
                conn.release();
                return res.json({ success: false, status: "pending" });
            }
            const txCreated = tx.created_at ? new Date(tx.created_at) : null;
            const txCreatedKey = txCreated &&
                `${String(txCreated.getDate()).padStart(2, "0")}/${String(txCreated.getMonth() + 1).padStart(2, "0")}/${txCreated.getFullYear()}`;
            const match = apiJson.transactions.find((tr) => matchDepositTx({ description: code, amount: tx.amount, created_at: tx.created_at }, tr, usedIds));
            if (!match) {
                await conn.commit();
                conn.release();
                return res.json({ success: false, status: "pending" });
            }
            await conn.query("UPDATE users SET p_balance = p_balance + ? WHERE id = ?", [tx.amount, user.id]);
            await conn.query("UPDATE transactions SET status = 'completed', bank_transaction_id = ?, bank_description = ?, fiat_amount = ?, payment_method = 'mbbank', updated_at = NOW() WHERE id = ?", [
                match.transactionID || match.transactionId || null,
                match.description || null,
                Math.round(Number(match.amount) || 0),
                transactionId,
            ]);
            await conn.commit();
            conn.release();
            return res.json({
                success: true,
                status: "completed",
                amount: tx.amount,
                transactionId,
            });
        }
        catch (err) {
            await conn.rollback();
            conn.release();
            return res.status(500).json({ message: "Lỗi cập nhật giao dịch" });
        }
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi cập nhật giao dịch" });
    }
});
let depositWatcherRunning = false;
async function runDepositWatcherCycle() {
    if (depositWatcherRunning)
        return;
    depositWatcherRunning = true;
    try {
        let apiJson = null;
        try {
            const apiRes = await (0, node_fetch_1.default)(WEB2M_URL);
            apiJson = await apiRes.json();
        }
        catch (err) {
        }
        if (!apiJson?.status || !Array.isArray(apiJson.transactions)) {
            depositWatcherRunning = false;
            return;
        }
        const [usedBankTxIds] = await pool.query("SELECT bank_transaction_id FROM transactions WHERE bank_transaction_id IS NOT NULL AND bank_transaction_id != ''");
        const usedIds = new Set(usedBankTxIds.map((row) => String(row.bank_transaction_id || "").trim()).filter(Boolean));
        const [pendingRows] = await pool.query("SELECT id, user_id, amount, description, created_at FROM transactions WHERE type = 'deposit' AND status = 'pending' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) LIMIT 100");
        const txs = pendingRows;
        for (const tx of txs) {
            const conn = await pool.getConnection();
            try {
                await conn.beginTransaction();
                const [txRows] = await conn.query("SELECT *, created_at FROM transactions WHERE id = ? AND type = 'deposit' AND status = 'pending' LIMIT 1 FOR UPDATE", [tx.id]);
                const locked = txRows[0];
                if (!locked) {
                    await conn.rollback();
                    conn.release();
                    continue;
                }
                const code = (locked.description || "").toUpperCase().trim();
                if (!code || code.length < 6) {
                    await conn.commit();
                    conn.release();
                    continue;
                }
                const match = apiJson.transactions.find((tr) => matchDepositTx({ description: code, amount: locked.amount, created_at: locked.created_at }, tr, usedIds));
                if (!match) {
                    await conn.commit();
                    conn.release();
                    continue;
                }
                await conn.query("UPDATE users SET p_balance = p_balance + ? WHERE id = ?", [locked.amount, locked.user_id]);
                await conn.query("UPDATE transactions SET status = 'completed', bank_transaction_id = ?, bank_description = ?, fiat_amount = ?, payment_method = 'mbbank', updated_at = NOW() WHERE id = ?", [
                    match.transactionID || match.transactionId || null,
                    match.description || null,
                    Math.round(Number(match.amount) || 0),
                    locked.id,
                ]);
                await conn.commit();
                conn.release();
            }
            catch (err) {
                await conn.rollback();
                conn.release();
            }
        }
    }
    catch (err) {
    }
    finally {
        depositWatcherRunning = false;
    }
}
if (DEPOSIT_WATCHER_ENABLED) {
    setInterval(runDepositWatcherCycle, DEPOSIT_WATCHER_INTERVAL_MS);
    setTimeout(() => {
        runDepositWatcherCycle();
    }, 1000);
}
let depositReconcileRunning = false;
async function runDepositReconcileCycle() {
    if (depositReconcileRunning)
        return;
    depositReconcileRunning = true;
    try {
        let apiJson = null;
        try {
            const apiRes = await (0, node_fetch_1.default)(WEB2M_URL);
            apiJson = await apiRes.json();
        }
        catch (err) {
            depositReconcileRunning = false;
            return;
        }
        if (!apiJson?.status || !Array.isArray(apiJson.transactions)) {
            depositReconcileRunning = false;
            return;
        }
        const [usedBankTxIds] = await pool.query("SELECT bank_transaction_id FROM transactions WHERE bank_transaction_id IS NOT NULL AND bank_transaction_id != ''");
        const usedIds = new Set(usedBankTxIds.map((row) => String(row.bank_transaction_id || "").trim()).filter(Boolean));
        const [pendingRows] = await pool.query("SELECT id, user_id, amount, description, created_at FROM transactions WHERE type = 'deposit' AND status = 'pending' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) ORDER BY created_at ASC");
        const pendingTxs = pendingRows;
        const apiTransactions = apiJson.transactions
            .filter((tr) => String(tr.type || "").toUpperCase() === "IN")
            .sort((a, b) => {
            const dateA = parseBankDate(a.transactionDate)?.getTime() || 0;
            const dateB = parseBankDate(b.transactionDate)?.getTime() || 0;
            return dateA - dateB;
        });
        let matched = 0;
        let checked = 0;
        for (const apiTr of apiTransactions) {
            const bankTxId = String(apiTr.transactionID || apiTr.transactionId || "").trim();
            if (bankTxId && usedIds.has(bankTxId)) {
                continue;
            }
            checked++;
            const apiAmount = Math.round(Number(apiTr.amount) || 0);
            const apiDesc = String(apiTr.description || "").toUpperCase().trim();
            const apiDate = String(apiTr.transactionDate || "").trim();
            if (apiAmount <= 0 || !apiDesc) {
                continue;
            }
            let matchedTx = null;
            for (const pendingTx of pendingTxs) {
                const code = (pendingTx.description || "").toUpperCase().trim();
                if (!code || code.length < 6)
                    continue;
                const amountMatches = Math.round(pendingTx.amount) === apiAmount;
                const dateMatches = isBankDateCloseTo(pendingTx.created_at ? new Date(pendingTx.created_at) : null, apiDate);
                const descMatches = matchDepositTx({ description: code, amount: pendingTx.amount, created_at: pendingTx.created_at }, {
                    transactionID: apiTr.transactionID,
                    transactionId: apiTr.transactionId,
                    amount: apiAmount,
                    description: apiDesc,
                    type: apiTr.type,
                    transactionDate: apiDate,
                }, usedIds);
                if (amountMatches && descMatches && dateMatches) {
                    matchedTx = pendingTx;
                    break;
                }
            }
            if (matchedTx) {
                const conn = await pool.getConnection();
                try {
                    await conn.beginTransaction();
                    const [txRows] = await conn.query("SELECT *, created_at FROM transactions WHERE id = ? AND type = 'deposit' AND status = 'pending' LIMIT 1 FOR UPDATE", [matchedTx.id]);
                    const locked = txRows[0];
                    if (!locked) {
                        await conn.rollback();
                        conn.release();
                        continue;
                    }
                    await conn.query("UPDATE users SET p_balance = p_balance + ? WHERE id = ?", [locked.amount, locked.user_id]);
                    await conn.query("UPDATE transactions SET status = 'completed', bank_transaction_id = ?, bank_description = ?, fiat_amount = ?, payment_method = 'mbbank', updated_at = NOW() WHERE id = ?", [
                        bankTxId || null,
                        apiDesc || null,
                        apiAmount,
                        locked.id,
                    ]);
                    await conn.commit();
                    conn.release();
                    matched++;
                    usedIds.add(bankTxId);
                    console.log(`[Deposit Reconcile] Matched: ${bankTxId} | Amount: ${apiAmount} | Transaction ID: ${locked.id}`);
                }
                catch (err) {
                    await conn.rollback();
                    conn.release();
                    console.error(`[Deposit Reconcile] Error processing ${bankTxId}:`, err);
                }
            }
        }
        if (checked > 0) {
            console.log(`[Deposit Reconcile] Completed. Checked: ${checked}, Matched: ${matched}`);
        }
    }
    catch (err) {
        console.error("[Deposit Reconcile] Error:", err);
    }
    finally {
        depositReconcileRunning = false;
    }
}
if (DEPOSIT_RECONCILE_ENABLED) {
    setInterval(runDepositReconcileCycle, DEPOSIT_RECONCILE_INTERVAL_MS);
    setTimeout(() => {
        runDepositReconcileCycle();
    }, 10000);
}
app.post("/wallet/deposit/reconcile", async (req, res) => {
    try {
        const key = req.headers["x-recon-key"] || req.query.key;
        if (RECON_KEY && key !== RECON_KEY) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const days = Number(req.body.days || req.query.days || 3);
        const limit = Number(req.body.limit || req.query.limit || 200);
        let apiJson = null;
        try {
            const apiRes = await (0, node_fetch_1.default)(WEB2M_URL);
            apiJson = await apiRes.json();
        }
        catch (err) {
            return res.status(500).json({ message: "Bank API error" });
        }
        if (!apiJson?.status || !Array.isArray(apiJson.transactions)) {
            return res.json({ success: false, checked: 0, matched: 0 });
        }
        const [usedBankTxIds] = await pool.query("SELECT bank_transaction_id FROM transactions WHERE bank_transaction_id IS NOT NULL AND bank_transaction_id != ''");
        const usedIds = new Set(usedBankTxIds.map((row) => String(row.bank_transaction_id || "").trim()).filter(Boolean));
        const [pendingRows] = await pool.query("SELECT id, user_id, amount, description, created_at FROM transactions WHERE type = 'deposit' AND status = 'pending' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT ?", [Math.max(days, 1), Math.max(limit, 1)]);
        const txs = pendingRows;
        let matched = 0;
        for (const tx of txs) {
            const conn = await pool.getConnection();
            try {
                await conn.beginTransaction();
                const [txRows] = await conn.query("SELECT *, created_at FROM transactions WHERE id = ? AND type = 'deposit' AND status = 'pending' LIMIT 1 FOR UPDATE", [tx.id]);
                const locked = txRows[0];
                if (!locked) {
                    await conn.rollback();
                    conn.release();
                    continue;
                }
                const code = (locked.description || "").toUpperCase().trim();
                if (!code || code.length < 6) {
                    await conn.commit();
                    conn.release();
                    continue;
                }
                const txCreated = locked.created_at ? new Date(locked.created_at) : null;
                const txCreatedKey = txCreated &&
                    `${String(txCreated.getDate()).padStart(2, "0")}/${String(txCreated.getMonth() + 1).padStart(2, "0")}/${txCreated.getFullYear()}`;
                const match = apiJson.transactions.find((tr) => matchDepositTx({ description: code, amount: tx.amount, created_at: tx.created_at }, tr, usedIds));
                if (!match) {
                    await conn.commit();
                    conn.release();
                    continue;
                }
                await conn.query("UPDATE users SET p_balance = p_balance + ? WHERE id = ?", [locked.amount, locked.user_id]);
                await conn.query("UPDATE transactions SET status = 'completed', bank_transaction_id = ?, bank_description = ?, fiat_amount = ?, payment_method = 'mbbank', updated_at = NOW() WHERE id = ?", [
                    match.transactionID || match.transactionId || null,
                    match.description || null,
                    Math.round(Number(match.amount) || 0),
                    locked.id,
                ]);
                await conn.commit();
                conn.release();
                matched += 1;
            }
            catch (err) {
                await conn.rollback();
                conn.release();
            }
        }
        return res.json({ success: true, checked: txs.length, matched });
    }
    catch (err) {
        res.status(500).json({ message: "Reconcile failed" });
    }
});
async function findAdminUserIds() {
    try {
        const [rows] = await pool.query("SELECT id FROM users WHERE role IN ('admin','super_admin') ORDER BY role DESC, created_at ASC");
        return rows.map((r) => String(r.id)).filter(Boolean);
    }
    catch {
        return [];
    }
}
app.get("/chat/messages", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.query.sessionId;
        const withId = req.query.userId || null;
        if (!sessionId)
            return res.status(401).json({ message: "Chưa đăng nhập" });
        const [userRows] = await pool.query("SELECT id, role FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const me = userRows[0];
        if (!me)
            return res.status(401).json({ message: "Session không hợp lệ" });
        let otherId = null;
        if (me.role === "admin" || me.role === "super_admin") {
            if (!withId)
                return res.status(400).json({ message: "Thiếu userId" });
            otherId = withId;
        }
        else {
            const adminIds = await findAdminUserIds();
            otherId = adminIds[0] || null;
        }
        if (!otherId)
            return res.status(404).json({ message: "Không tìm thấy admin" });
        const [rows] = await pool.query(`
      SELECT cm.id, cm.sender_id, cm.receiver_id, cm.content, cm.message_type, cm.is_admin_message, cm.created_at,
             su.username as sender_name, ru.username as receiver_name,
             su.avatar_url as sender_avatar_url, ru.avatar_url as receiver_avatar_url,
             su.role as sender_role, ru.role as receiver_role
      FROM chat_messages cm
      JOIN users su ON su.id = cm.sender_id
      JOIN users ru ON ru.id = cm.receiver_id
      WHERE (cm.sender_id = ? AND cm.receiver_id = ?) OR (cm.sender_id = ? AND cm.receiver_id = ?)
      ORDER BY cm.created_at ASC
      LIMIT 200
    `, [me.id, otherId, otherId, me.id]);
        res.json({ success: true, messages: rows });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi tải tin nhắn" });
    }
});
app.post("/chat/messages", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.body.sessionId;
        const receiverId = req.body.receiverId;
        const content = (req.body.content || "").trim();
        const messageType = (req.body.messageType || "text");
        if (!sessionId)
            return res.status(401).json({ message: "Chưa đăng nhập" });
        if (!content)
            return res.status(400).json({ message: "Nội dung trống" });
        if (!["text", "image", "file"].includes(messageType)) {
            return res.status(400).json({ message: "Loại tin nhắn không hợp lệ" });
        }
        const [userRows] = await pool.query("SELECT id, role FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const me = userRows[0];
        if (!me)
            return res.status(401).json({ message: "Session không hợp lệ" });
        let toId = null;
        if (me.role === "admin" || me.role === "super_admin") {
            if (!receiverId)
                return res.status(400).json({ message: "Thiếu receiverId" });
            toId = receiverId;
        }
        else {
            const adminIds = await findAdminUserIds();
            toId = adminIds[0] || null;
        }
        if (!toId)
            return res.status(404).json({ message: "Không tìm thấy admin" });
        const uuid = require("crypto").randomUUID;
        const msgId = uuid();
        await pool.query(`
      INSERT INTO chat_messages (id, sender_id, receiver_id, content, message_type, is_admin_message)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
            msgId,
            me.id,
            toId,
            content,
            messageType,
            me.role === "admin" || me.role === "super_admin" ? 1 : 0,
        ]);
        res.json({
            success: true,
            message: {
                id: msgId,
                sender_id: me.id,
                receiver_id: toId,
                content,
                message_type: messageType,
                is_admin_message: me.role === "admin" || me.role === "super_admin" ? 1 : 0,
                created_at: new Date().toISOString(),
            },
        });
    }
    catch (err) {
        res.status(500).json({ message: "Gửi tin nhắn thất bại" });
    }
});
async function getUserBySession(sessionId) {
    const [userRows] = await pool.query("SELECT id, username, role, avatar_url FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
    return userRows[0] || null;
}
const engagedByPeer = new Map();
io.on("connection", (socket) => {
    socket.data.authed = false;
    socket.data.engagedPeers = new Set();
    socket.on("auth", async (payload, cb) => {
        try {
            const sessionId = payload?.sessionId;
            if (!sessionId) {
                cb?.({ success: false, message: "Missing sessionId" });
                return;
            }
            const user = await getUserBySession(sessionId);
            if (!user) {
                cb?.({ success: false, message: "Invalid session" });
                return;
            }
            socket.data.authed = true;
            socket.data.user = user;
            socket.join(`user:${user.id}`);
            if (user.role === "admin" || user.role === "super_admin") {
                socket.join("admins");
            }
            cb?.({ success: true, user });
        }
        catch (err) {
            cb?.({ success: false, message: "Auth failed" });
        }
    });
    socket.on("peers:list", async (payload, cb) => {
        try {
            if (!socket.data.authed || !socket.data.user) {
                cb?.({ success: false, message: "Not authenticated" });
                return;
            }
            const me = socket.data.user;
            if (me.role !== "admin" && me.role !== "super_admin") {
                cb?.({ success: false, message: "Only admin can list peers" });
                return;
            }
            const [rows] = await pool.query(`
        SELECT DISTINCT u.id as peer_id, u.username, u.avatar_url, u.role
        FROM users u
        WHERE u.id IN (
          SELECT DISTINCT sender_id FROM chat_messages
          UNION
          SELECT DISTINCT receiver_id FROM chat_messages
        )
        AND u.role NOT IN ('admin', 'super_admin')
        AND u.id != ?
        ORDER BY u.username ASC
        LIMIT 200
      `, [me.id]);
            cb?.({ success: true, peers: rows });
        }
        catch (err) {
            cb?.({ success: false, message: "Load peers failed" });
        }
    });
    socket.on("admin:engaged:list", (payload, cb) => {
        try {
            if (!socket.data.authed || !socket.data.user) {
                cb?.({ success: false, message: "Not authenticated" });
                return;
            }
            const me = socket.data.user;
            if (me.role !== "admin" && me.role !== "super_admin") {
                cb?.({ success: false, message: "Only admin can list engagements" });
                return;
            }
            const engagements = Array.from(engagedByPeer.entries()).map(([peerId, v]) => ({
                peerId,
                adminId: v.adminId,
                adminName: v.adminName,
                timestamp: v.timestamp,
            }));
            cb?.({ success: true, engagements });
        }
        catch (err) {
            cb?.({ success: false, message: "Load engagements failed" });
        }
    });
    socket.on("admin:engage", (payload, cb) => {
        try {
            if (!socket.data.authed || !socket.data.user) {
                cb?.({ success: false, message: "Not authenticated" });
                return;
            }
            const me = socket.data.user;
            if (me.role !== "admin" && me.role !== "super_admin") {
                cb?.({ success: false, message: "Only admin can engage" });
                return;
            }
            const peerId = (payload?.peerId || "").trim();
            const override = !!payload?.override;
            if (!peerId) {
                cb?.({ success: false, message: "Missing peerId" });
                return;
            }
            const current = engagedByPeer.get(peerId);
            if (current && current.adminId !== me.id && !override) {
                cb?.({
                    success: false,
                    engagedBy: current,
                    message: "Already handled by another admin",
                });
                return;
            }
            const record = {
                adminId: me.id,
                adminName: me.username || "Admin",
                timestamp: Date.now(),
            };
            engagedByPeer.set(peerId, record);
            socket.data.engagedPeers.add(peerId);
            io.to("admins").emit("admin:engaged:update", {
                peerId,
                adminId: record.adminId,
                adminName: record.adminName,
                timestamp: record.timestamp,
            });
            cb?.({ success: true, engagement: { peerId, ...record } });
        }
        catch (err) {
            cb?.({ success: false, message: "Engage failed" });
        }
    });
    socket.on("admin:disengage", (payload, cb) => {
        try {
            if (!socket.data.authed || !socket.data.user) {
                cb?.({ success: false, message: "Not authenticated" });
                return;
            }
            const me = socket.data.user;
            if (me.role !== "admin" && me.role !== "super_admin") {
                cb?.({ success: false, message: "Only admin can disengage" });
                return;
            }
            const peerId = (payload?.peerId || "").trim();
            if (!peerId) {
                cb?.({ success: false, message: "Missing peerId" });
                return;
            }
            const current = engagedByPeer.get(peerId);
            if (current && current.adminId === me.id) {
                engagedByPeer.delete(peerId);
                socket.data.engagedPeers.delete(peerId);
                io.to("admins").emit("admin:engaged:update", {
                    peerId,
                    adminId: null,
                    adminName: null,
                    timestamp: Date.now(),
                });
            }
            cb?.({ success: true });
        }
        catch (err) {
            cb?.({ success: false, message: "Disengage failed" });
        }
    });
    socket.on("message:history", async (payload, cb) => {
        try {
            if (!socket.data.authed || !socket.data.user) {
                cb?.({ success: false, message: "Not authenticated" });
                return;
            }
            const me = socket.data.user;
            const withId = payload?.userId;
            let otherId = null;
            if (me.role === "admin" || me.role === "super_admin") {
                if (!withId) {
                    cb?.({ success: false, message: "Missing userId" });
                    return;
                }
                otherId = withId;
            }
            else {
                otherId = null; // Not needed for user mode anymore
            }
            let query;
            let params;
            if (me.role === "admin" || me.role === "super_admin") {
                if (!otherId) {
                    cb?.({ success: false, message: "Missing userId" });
                    return;
                }
                query = `
          SELECT cm.id, cm.sender_id, cm.receiver_id, cm.content,
                 cm.message_type, cm.is_admin_message, cm.created_at,
                 su.username AS sender_name, su.avatar_url AS sender_avatar_url, su.role AS sender_role,
                 ru.username AS receiver_name, ru.avatar_url AS receiver_avatar_url, ru.role AS receiver_role
          FROM chat_messages cm
          JOIN users su ON su.id = cm.sender_id
          JOIN users ru ON ru.id = cm.receiver_id
          WHERE (cm.sender_id = ? AND ru.role IN ('admin', 'super_admin'))
             OR (cm.receiver_id = ? AND su.role IN ('admin', 'super_admin'))
          ORDER BY cm.created_at DESC
          LIMIT 100
        `;
                params = [otherId, otherId];
            }
            else {
                // User mode: get all messages between user and ANY admin/super_admin
                query = `
        SELECT cm.id, cm.sender_id, cm.receiver_id, cm.content,
               cm.message_type, cm.is_admin_message, cm.created_at,
               su.username AS sender_name, su.avatar_url AS sender_avatar_url, su.role AS sender_role,
               ru.username AS receiver_name, ru.avatar_url AS receiver_avatar_url, ru.role AS receiver_role
        FROM chat_messages cm
        JOIN users su ON su.id = cm.sender_id
        JOIN users ru ON ru.id = cm.receiver_id
        WHERE (cm.sender_id = ? AND ru.role IN ('admin', 'super_admin'))
           OR (cm.receiver_id = ? AND su.role IN ('admin', 'super_admin'))
        ORDER BY cm.created_at DESC
        LIMIT 100
        `;
                params = [me.id, me.id];
            }
            const [rows] = await pool.query(query, params);
            const messages = Array.isArray(rows) ? rows.reverse() : [];
            cb?.({ success: true, messages });
        }
        catch (err) {
            cb?.({ success: false, message: "Load history failed" });
        }
    });
    socket.on("message:send", async (payload, cb) => {
        try {
            if (!socket.data.authed || !socket.data.user) {
                cb?.({ success: false, message: "Not authenticated" });
                return;
            }
            const me = socket.data.user;
            const content = (payload?.content || "").trim();
            const messageType = (payload?.messageType || "text");
            const receiverId = payload?.receiverId;
            const fileInfo = payload?.fileInfo;
            if (!content) {
                cb?.({ success: false, message: "Empty content" });
                return;
            }
            if (!["text", "image", "file"].includes(messageType)) {
                cb?.({ success: false, message: "Invalid message type" });
                return;
            }
            let toId = null;
            if (me.role === "admin" || me.role === "super_admin") {
                if (!receiverId) {
                    cb?.({ success: false, message: "Missing receiverId" });
                    return;
                }
                toId = receiverId;
            }
            else {
                const adminIds = await findAdminUserIds();
                toId = adminIds[0] || null;
            }
            if (!toId) {
                cb?.({ success: false, message: "Admin not found" });
                return;
            }
            const uuid = require("crypto").randomUUID;
            const msgId = uuid();
            const isAdminMessage = me.role === "admin" || me.role === "super_admin" ? 1 : 0;
            const [existing] = await pool.query(`
        SELECT id FROM chat_messages 
        WHERE sender_id = ? AND receiver_id = ? AND content = ? AND created_at > DATE_SUB(NOW(), INTERVAL 5 SECOND)
        LIMIT 1
      `, [me.id, toId, content]);
            if (Array.isArray(existing) && existing.length > 0) {
                const existingMsg = existing[0];
                const [msgRows] = await pool.query(`
          SELECT cm.id, cm.sender_id, cm.receiver_id, cm.content, cm.message_type, cm.is_admin_message, cm.created_at,
                 su.username AS sender_name, ru.username AS receiver_name,
                 su.avatar_url AS sender_avatar_url, ru.avatar_url AS receiver_avatar_url,
                 su.role AS sender_role, ru.role AS receiver_role
          FROM chat_messages cm
          JOIN users su ON su.id = cm.sender_id
          JOIN users ru ON ru.id = cm.receiver_id
          WHERE cm.id = ?
        `, [existingMsg.id]);
                const msgData = msgRows[0];
                if (msgData) {
                    const payloadMsg = {
                        id: msgData.id,
                        sender_id: msgData.sender_id,
                        receiver_id: msgData.receiver_id,
                        content: msgData.content,
                        message_type: msgData.message_type,
                        is_admin_message: msgData.is_admin_message,
                        created_at: msgData.created_at,
                        sender_name: msgData.sender_name,
                        receiver_name: msgData.receiver_name,
                        sender_avatar_url: msgData.sender_avatar_url,
                        receiver_avatar_url: msgData.receiver_avatar_url,
                        sender_role: msgData.sender_role,
                        receiver_role: msgData.receiver_role,
                    };
                    io.to(`user:${me.id}`).emit("message:new", payloadMsg);
                    io.to(`user:${toId}`).emit("message:new", payloadMsg);
                    cb?.({ success: true, message: payloadMsg });
                    return;
                }
            }
            await pool.query(`
        INSERT INTO chat_messages (id, sender_id, receiver_id, content, message_type, is_admin_message)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [msgId, me.id, toId, content, messageType, isAdminMessage]);
            if (fileInfo?.path) {
                const fileId = uuid();
                await pool.query(`
          INSERT INTO chat_files (id, message_id, original_name, file_path, file_size, mime_type)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
                    fileId,
                    msgId,
                    fileInfo.name || "file",
                    fileInfo.path,
                    fileInfo.size || 0,
                    fileInfo.mime || "application/octet-stream",
                ]);
            }
            const [senderRows] = await pool.query("SELECT username, avatar_url, role FROM users WHERE id = ? LIMIT 1", [me.id]);
            const [receiverRows] = await pool.query("SELECT username, avatar_url, role FROM users WHERE id = ? LIMIT 1", [toId]);
            const senderName = senderRows[0]?.username || "";
            const senderAvatar = senderRows[0]?.avatar_url || null;
            const senderRole = senderRows[0]?.role || "user";
            const receiverName = receiverRows[0]?.username || "";
            const receiverAvatar = receiverRows[0]?.avatar_url || null;
            const receiverRole = receiverRows[0]?.role || "user";
            const payloadMsg = {
                id: msgId,
                sender_id: me.id,
                receiver_id: toId,
                content,
                message_type: messageType,
                is_admin_message: isAdminMessage,
                created_at: new Date().toISOString(),
                sender_name: senderName,
                receiver_name: receiverName,
                sender_avatar_url: senderAvatar,
                receiver_avatar_url: receiverAvatar,
                sender_role: senderRole,
                receiver_role: receiverRole,
            };
            io.to(`user:${me.id}`).emit("message:new", payloadMsg);
            io.to(`user:${toId}`).emit("message:new", payloadMsg);
            io.to("admins").emit("message:new", payloadMsg);
            cb?.({ success: true, message: payloadMsg });
        }
        catch (err) {
            cb?.({ success: false, message: "Send failed" });
        }
    });
    socket.on("disconnect", () => {
        try {
            const me = socket.data.user;
            if (!me) {
                return;
            }
            if (!socket.data.engagedPeers)
                return;
            const peers = Array.from(socket.data.engagedPeers);
            if (peers.length > 0) {
            }
            peers.forEach((peerId) => {
                const current = engagedByPeer.get(peerId);
                if (current && current.adminId === me.id) {
                    engagedByPeer.delete(peerId);
                    io.to("admins").emit("admin:engaged:update", {
                        peerId,
                        adminId: null,
                        adminName: null,
                        timestamp: Date.now(),
                    });
                }
            });
        }
        catch (err) {
        }
    });
});
app.route("/user/settings")
    .get(async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") ||
            req.query.sessionId;
        if (!sessionId) {
            return res.status(401).json({ message: "Chưa đăng nhập" });
        }
        const [userRows] = await pool.query("SELECT id FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.status(401).json({ message: "Session không hợp lệ" });
        }
        const settingsKey = `user:${user.id}:settings`;
        const [rows] = await pool.query("SELECT v FROM app_settings WHERE k = ? LIMIT 1", [settingsKey]);
        let settings = { storeLanguage: "vi" };
        const row = rows[0];
        if (row?.v) {
            try {
                const parsed = JSON.parse(row.v);
                settings = { ...settings, ...parsed };
            }
            catch {
            }
        }
        res.json({ success: true, settings });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi lấy user settings" });
    }
})
    .put(async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") ||
            req.body.sessionId;
        if (!sessionId) {
            return res.status(401).json({ message: "Chưa đăng nhập" });
        }
        const [userRows] = await pool.query("SELECT id FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.status(401).json({ message: "Session không hợp lệ" });
        }
        const incoming = (req.body?.settings || {});
        const storeLanguage = incoming.storeLanguage === "vi" || incoming.storeLanguage === "en"
            ? incoming.storeLanguage
            : "vi";
        const settings = { storeLanguage };
        const settingsKey = `user:${user.id}:settings`;
        await pool.query("INSERT INTO app_settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", [settingsKey, JSON.stringify(settings)]);
        res.json({ success: true, settings });
    }
    catch (err) {
        res.status(500).json({ message: "Lỗi cập nhật user settings" });
    }
});
app.get("/announcement", async (_req, res) => {
    try {
        const [rows] = await pool.query("SELECT v FROM app_settings WHERE k = 'global_announcement' LIMIT 1");
        const row = rows[0];
        let announcement = null;
        if (row?.v) {
            try {
                announcement = JSON.parse(row.v);
            }
            catch {
                announcement = null;
            }
        }
        res.json({ success: true, announcement });
    }
    catch {
        res.status(500).json({ message: "Lỗi lấy thông báo" });
    }
});
app.post("/admin/announcement", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.body?.sessionId;
        const actor = await getUserBySession(sessionId || "");
        if (!actor || (actor.role !== "admin" && actor.role !== "super_admin")) {
            return res.status(403).json({ message: "Không có quyền" });
        }
        const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
        const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
        const level = typeof req.body?.level === "string" ? req.body.level.trim() : "info";
        if (!title || !message) {
            return res.status(400).json({ message: "Thiếu nội dung" });
        }
        const announcement = {
            title: title.slice(0, 200),
            message: message.slice(0, 2000),
            level: ["info", "warning", "danger"].includes(level) ? level : "info",
            updatedAt: new Date().toISOString(),
            updatedBy: actor.id,
        };
        await pool.query("INSERT INTO app_settings (k, v) VALUES ('global_announcement', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", [JSON.stringify(announcement)]);
        res.json({ success: true, announcement });
    }
    catch {
        res.status(500).json({ message: "Lưu thông báo thất bại" });
    }
});
app.post("/tutorial/complete", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.body.sessionId;
        const { tutorialKey } = req.body;
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        if (!tutorialKey) {
            return res.status(400).json({ success: false, message: "Tutorial key is required" });
        }
        const [userRows] = await pool.query("SELECT id, tutorial_completed FROM users WHERE session_id = ? AND is_online = 1 LIMIT 1", [sessionId]);
        const user = userRows[0];
        if (!user) {
            return res.status(401).json({ success: false, message: "Invalid session" });
        }
        let tutorialCompleted = {};
        if (user.tutorial_completed) {
            try {
                tutorialCompleted = JSON.parse(user.tutorial_completed);
            }
            catch {
                tutorialCompleted = {};
            }
        }
        tutorialCompleted[tutorialKey] = true;
        await pool.query("UPDATE users SET tutorial_completed = ? WHERE id = ? LIMIT 1", [JSON.stringify(tutorialCompleted), user.id]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, message: "Failed to update tutorial status" });
    }
});
app.get("/vip/packages", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.query.sessionId;
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const [userRows] = await pool.query("SELECT id FROM users WHERE session_id = ? AND session_updated_at > DATE_SUB(NOW(), INTERVAL 7 DAY)", [sessionId]);
        if (userRows.length === 0) {
            return res.status(401).json({ success: false, message: "Invalid session" });
        }
        const [packages] = await pool.query("SELECT id, name, code, type, duration, price, description, features, is_active FROM vip_packages WHERE is_active = 1 ORDER BY type, duration");
        const packagesWithParsedFeatures = packages.map((pkg) => {
            let features = [];
            if (pkg.features) {
                try {
                    features = typeof pkg.features === 'string' ? JSON.parse(pkg.features) : pkg.features;
                }
                catch {
                    features = [];
                }
            }
            return {
                ...pkg,
                features,
                price: Number(pkg.price)
            };
        });
        res.json({ success: true, packages: packagesWithParsedFeatures });
    }
    catch (err) {
        res.status(500).json({ success: false, message: "Failed to load VIP packages" });
    }
});
app.post("/vip/purchase", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.body.sessionId;
        const { package_id, upgrade_price, is_upgrade } = req.body;
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        if (!package_id) {
            return res.status(400).json({ success: false, message: "Package ID is required" });
        }
        const [userRows] = await pool.query("SELECT id, p_balance, role, vip_expires_at FROM users WHERE session_id = ? AND session_updated_at > DATE_SUB(NOW(), INTERVAL 7 DAY)", [sessionId]);
        if (userRows.length === 0) {
            return res.status(401).json({ success: false, message: "Invalid session" });
        }
        const user = userRows[0];
        const [packageRows] = await pool.query("SELECT id, name, code, type, duration, price, is_active FROM vip_packages WHERE id = ? AND is_active = 1", [package_id]);
        if (packageRows.length === 0) {
            return res.status(404).json({ success: false, message: "VIP package not found" });
        }
        const vipPackage = packageRows[0];
        const originalPrice = Math.round(Number(vipPackage.price));
        const packagePrice = is_upgrade && upgrade_price ? Math.round(Number(upgrade_price)) : originalPrice;
        if (user.p_balance < packagePrice) {
            return res.status(400).json({
                success: false,
                message: "Insufficient balance",
                code: "INSUFFICIENT_FUNDS"
            });
        }
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const newBalance = user.p_balance - packagePrice;
            await conn.query("UPDATE users SET p_balance = ? WHERE id = ?", [newBalance, user.id]);
            const currentExpiresAt = user.vip_expires_at
                ? new Date(user.vip_expires_at)
                : new Date();
            if (currentExpiresAt < new Date()) {
                currentExpiresAt.setTime(Date.now());
            }
            const newExpiresAt = new Date(currentExpiresAt);
            newExpiresAt.setDate(newExpiresAt.getDate() + vipPackage.duration);
            const newRole = vipPackage.type === 'vip_plus'
                ? 'vip_plus'
                : vipPackage.type === 'vip'
                    ? 'vip'
                    : vipPackage.type === 'netflix'
                        ? 'netflix'
                        : user.role;
            await conn.query("UPDATE users SET role = ?, vip_expires_at = ? WHERE id = ?", [newRole, newExpiresAt, user.id]);
            await conn.query("UPDATE user_games_log SET expires_at = ? WHERE user_id = ? AND source = 'vip'", [newExpiresAt, user.id]);
            await conn.query("UPDATE user_vip_subscriptions SET status = 'cancelled' WHERE user_id = ? AND status = 'active'", [user.id]);
            const subscriptionId = crypto_1.default.randomUUID();
            await conn.query("INSERT INTO user_vip_subscriptions (id, user_id, package_id, started_at, expires_at, status) VALUES (?, ?, ?, NOW(), ?, 'active')", [subscriptionId, user.id, vipPackage.id, newExpiresAt]);
            const transactionId = crypto_1.default.randomUUID();
            await conn.query("INSERT INTO transactions (id, user_id, type, amount, currency, status, payment_method, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
                transactionId,
                user.id,
                'vip_purchase',
                packagePrice,
                'G',
                'completed',
                'wallet',
                `VIP Purchase: ${vipPackage.name}`
            ]);
            await conn.commit();
            conn.release();
            res.json({
                success: true,
                message: "VIP purchased successfully",
                transactionId,
                newBalance,
                expiresAt: newExpiresAt
            });
        }
        catch (err) {
            await conn.rollback();
            conn.release();
            throw err;
        }
    }
    catch (err) {
        res.status(500).json({ success: false, message: "Failed to purchase VIP" });
    }
});
app.get("/admin/chat/users", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.query.sessionId;
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const me = await getUserBySession(sessionId);
        if (!me || (me.role !== "admin" && me.role !== "super_admin")) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }
        const [rows] = await pool.query(`
      SELECT DISTINCT u.id, u.username, u.avatar_url, u.role
      FROM users u
      WHERE u.id IN (
        SELECT DISTINCT sender_id FROM chat_messages
        UNION
        SELECT DISTINCT receiver_id FROM chat_messages
      )
      AND u.role NOT IN ('admin', 'super_admin')
      AND u.id != ?
      ORDER BY u.username ASC
      LIMIT 200
    `, [me.id]);
        res.json({ success: true, users: rows });
    }
    catch (err) {
        res.status(500).json({ success: false, message: "Failed to load chat users" });
    }
});
app.get("/admin/chat/threads", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.query.sessionId;
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const me = await getUserBySession(sessionId);
        if (!me || (me.role !== "admin" && me.role !== "super_admin")) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }
        const [rows] = await pool.query(`
      SELECT 
        u.id,
        u.username,
        u.avatar_url,
        u.role,
        t.last_message_time
      FROM (
        SELECT 
          CASE 
            WHEN sender_id IN (SELECT id FROM users WHERE role IN ('admin','super_admin')) THEN receiver_id
            ELSE sender_id
          END AS user_id,
          MAX(created_at) AS last_message_time
        FROM chat_messages
        GROUP BY user_id
      ) t
      JOIN users u ON u.id = t.user_id
      WHERE u.role NOT IN ('admin','super_admin')
      ORDER BY t.last_message_time DESC
      LIMIT 500
      `);
        res.json({ success: true, threads: rows });
    }
    catch (err) {
        res.status(500).json({ success: false, message: "Failed to load chat threads" });
    }
});
app.get("/chat/unread-count", async (req, res) => {
    const startTime = Date.now();
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.query.sessionId;
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const me = await getUserBySession(sessionId);
        if (!me) {
            return res.status(401).json({ success: false, message: "Invalid session" });
        }
        if (me.role === "admin" || me.role === "super_admin") {
            const [rows] = await pool.query(`
        SELECT 
          u.id, 
          u.username, 
          u.avatar_url,
          COALESCE(
          (
            SELECT COUNT(*)
            FROM chat_messages cm
            WHERE cm.sender_id = u.id 
            AND cm.receiver_id = ?
              AND cm.created_at > COALESCE(
                (
                  SELECT MAX(cm2.created_at)
                  FROM chat_messages cm2
              WHERE cm2.sender_id = ? 
              AND cm2.receiver_id = u.id 
                ),
                DATE_SUB(NOW(), INTERVAL 30 DAY)
            )
            ),
            0
          ) as unread_count,
          (
            SELECT MAX(cm.created_at)
            FROM chat_messages cm
            WHERE (cm.sender_id = u.id AND cm.receiver_id = ?) 
            OR (cm.sender_id = ? AND cm.receiver_id = u.id)
          ) as last_message_time
        FROM users u
        WHERE u.role NOT IN ('admin', 'super_admin')
        AND EXISTS (
          SELECT 1 FROM chat_messages cm
          WHERE cm.sender_id = u.id AND cm.receiver_id = ?
          LIMIT 1
        )
        ORDER BY last_message_time DESC
        LIMIT 50
      `, [me.id, me.id, me.id, me.id, me.id]);
            const users = rows;
            const totalCount = users.reduce((sum, u) => sum + Number(u.unread_count || 0), 0);
            const queryTime = Date.now() - startTime;
            if (queryTime > 100 || totalCount > 0) {
            }
            return res.json({
                success: true,
                count: totalCount,
                users: users.map(u => ({
                    id: u.id,
                    username: u.username,
                    avatar_url: u.avatar_url,
                    unread_count: Number(u.unread_count || 0)
                }))
            });
        }
        else {
            const adminIds = await findAdminUserIds();
            const adminId = adminIds[0] || null;
            if (!adminId) {
                return res.json({ success: true, count: 0, users: [] });
            }
            const [rows] = await pool.query(`
        SELECT COUNT(*) as count
        FROM chat_messages cm
        WHERE cm.receiver_id = ? 
        AND cm.sender_id = ?
        AND cm.created_at > COALESCE(
          (
            SELECT MAX(cm2.created_at)
            FROM chat_messages cm2
            WHERE cm2.sender_id = ? AND cm2.receiver_id = ?
          ),
          DATE_SUB(NOW(), INTERVAL 24 HOUR)
        )
      `, [me.id, adminId, me.id, adminId]);
            const count = rows[0]?.count || 0;
            const queryTime = Date.now() - startTime;
            if (queryTime > 100 || count > 0) {
            }
            return res.json({ success: true, count: Math.min(Number(count), 99), users: [] });
        }
    }
    catch (err) {
        const queryTime = Date.now() - startTime;
        if (queryTime > 500 || err?.message) {
        }
        return res.json({ success: true, count: 0, users: [] });
    }
});
app.get("/admin/dashboard", async (req, res) => {
    try {
        const sessionId = req.headers.authorization?.replace("Bearer ", "") || req.query.sessionId;
        if (!sessionId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const me = await getUserBySession(sessionId);
        if (!me || (me.role !== "admin" && me.role !== "super_admin")) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }
        const cacheKey = `admin:dashboard`;
        const cached = dashboardCache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }
        const [userResult, vipResult, depositCompletedResult, keyRedeemResult, purchaseResult, gamesResult, monthlyResult, dailyResult,] = await Promise.all([
            pool.query("SELECT COUNT(*) as total FROM users"),
            pool.query("SELECT COUNT(*) as vip_all, SUM(CASE WHEN role = 'vip' THEN 1 ELSE 0 END) as vip_count, SUM(CASE WHEN role = 'vip_plus' THEN 1 ELSE 0 END) as vip_plus_count FROM users WHERE role IN ('vip', 'vip_plus')"),
            pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'deposit' AND status = 'completed'"),
            pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'key_redeem' AND status = 'completed'"),
            pool.query("SELECT COUNT(*) as total FROM user_games WHERE COALESCE(price_paid, 0) > 0"),
            pool.query("SELECT COUNT(*) as total_games, SUM(CASE WHEN price = 0 THEN 1 ELSE 0 END) as free_games, SUM(CASE WHEN price > 0 THEN 1 ELSE 0 END) as paid_games FROM games"),
            pool.query(`SELECT YEAR(created_at) as y, MONTH(created_at) as m,
        SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END) as deposit_total,
        SUM(CASE WHEN type IN ('cart_checkout', 'vip_purchase') AND status = 'completed' THEN amount ELSE 0 END) as spending_total
      FROM transactions
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY y, m
      ORDER BY y, m`),
            pool.query(`SELECT YEAR(created_at) as y, MONTH(created_at) as m, DAY(created_at) as d,
        SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END) as deposit_total,
        SUM(CASE WHEN type IN ('cart_checkout', 'vip_purchase') AND status = 'completed' THEN amount ELSE 0 END) as spending_total
      FROM transactions
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY y, m, d
      ORDER BY y, m, d`),
        ]);
        const [[userRow]] = userResult;
        const [[vipRow]] = vipResult;
        const [[depositCompletedRow]] = depositCompletedResult;
        const [[keyRedeemRow]] = keyRedeemResult;
        const [[purchaseRow]] = purchaseResult;
        const [[gamesRow]] = gamesResult;
        const [monthlyRows] = monthlyResult;
        const [dailyRows] = dailyResult;
        const revenueMap = {};
        for (const row of monthlyRows) {
            const key = `${row.y}-${row.m}`;
            const depositTotal = Number(row.deposit_total || 0);
            const spendingTotal = Number(row.spending_total || 0);
            revenueMap[key] = {
                month: Number(row.m),
                year: Number(row.y),
                total: depositTotal - spendingTotal,
                daily: [],
            };
        }
        for (const row of dailyRows) {
            const key = `${row.y}-${row.m}`;
            if (!revenueMap[key]) {
                revenueMap[key] = {
                    month: Number(row.m),
                    year: Number(row.y),
                    total: Number(row.deposit_total || 0) - Number(row.spending_total || 0),
                    daily: [],
                };
            }
            revenueMap[key].daily.push({
                day: Number(row.d),
                deposit: Number(row.deposit_total || 0),
                spending: Number(row.spending_total || 0),
            });
        }
        const revenue = Object.values(revenueMap).sort((a, b) => {
            if (a.year === b.year)
                return a.month - b.month;
            return a.year - b.year;
        });
        const payload = {
            success: true,
            users: Number(userRow?.total || 0),
            totalDeposit: Number(depositCompletedRow?.total || 0),
            keyRedeem: Number(keyRedeemRow?.total || 0),
            paidGames: Number(gamesRow?.paid_games || 0),
            freeGames: Number(gamesRow?.free_games || 0),
            purchaseCount: Number(purchaseRow?.total || 0),
            vip_all: Number(vipRow?.vip_all || 0),
            vip: Number(vipRow?.vip_count || 0),
            vip_plus: Number(vipRow?.vip_plus_count || 0),
            revenue,
        };
        dashboardCache.set(cacheKey, payload);
        return res.json(payload);
    }
    catch {
        return res.status(500).json({ success: false, message: "Failed to load dashboard" });
    }
});
server.listen(PORT, () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});
