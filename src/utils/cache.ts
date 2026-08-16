import fs from "fs";
import path from "path";
import type { ResearchOutput } from "../types/schemas.js";
import { logInfo, logSuccess, logWarn } from "./logger.js";

const CACHE_FOLDER = path.join(process.cwd(), "cache");

const CACHE_EXPIRES_AFTER_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

function ensureCacheFolder() {
  if (!fs.existsSync(CACHE_FOLDER)) {
    fs.mkdirSync(CACHE_FOLDER);
  }
}

// Create a simple filename from the topic
function getCacheFilePath(topic: string): string {
  const safeName = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_") 
    .slice(0, 60); // limit length
  return path.join(CACHE_FOLDER, `${safeName}.json`);
}

// Save research to cache
export function saveToCache(topic: string, research: ResearchOutput) {
  ensureCacheFolder();

  const filePath = getCacheFilePath(topic);

  const cacheData = {
    topic,
    savedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + CACHE_EXPIRES_AFTER_MS).toISOString(),
    research,
  };

  fs.writeFileSync(filePath, JSON.stringify(cacheData, null, 2));
  logInfo(`Research cached to ${filePath}`);
}

// Load research from cache (returns null if not found or expired)
export function loadFromCache(topic: string): ResearchOutput | null {
  ensureCacheFolder();

  const filePath = getCacheFilePath(topic);

  // File doesn't exist — no cache
  if (!fs.existsSync(filePath)) {
    logInfo(`No cache found for: "${topic}"`);
    return null;
  }

  // Read the cached file
  const raw = fs.readFileSync(filePath, "utf-8");
  const cacheData = JSON.parse(raw) as {
    topic: string;
    savedAt: string;
    expiresAt: string;
    research: ResearchOutput;
  };

  // Check if the cache has expired
  const isExpired = new Date() > new Date(cacheData.expiresAt);

  if (isExpired) {
    logWarn(`Cache expired for "${topic}" — will re-run research`);
    fs.unlinkSync(filePath); // delete old cache file
    return null;
  }

  // Cache is valid — return it
  const savedMinutesAgo = Math.round(
    (Date.now() - new Date(cacheData.savedAt).getTime()) / 60_000
  );
  logSuccess(`Using cached research for "${topic}" (saved ${savedMinutesAgo} min ago — saving tokens! 💾)`);

  return cacheData.research;
}

// Delete all cache files
export function clearAllCache() {
  if (!fs.existsSync(CACHE_FOLDER)) return;

  const files = fs.readdirSync(CACHE_FOLDER);
  for (const file of files) {
    fs.unlinkSync(path.join(CACHE_FOLDER, file));
  }
  logInfo(`Cleared ${files.length} cache files`);
}
