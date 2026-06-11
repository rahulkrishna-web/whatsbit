import fs from "fs";
import path from "path";

try {
  const envPath = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    envContent.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const firstEquals = trimmed.indexOf("=");
        if (firstEquals !== -1) {
          const key = trimmed.substring(0, firstEquals).trim();
          const val = trimmed.substring(firstEquals + 1).trim().replace(/^["']|["']$/g, "");
          process.env[key] = val;
        }
      }
    });
    console.log("[EnvLoader] Environment variables loaded from .env.local");
  } else {
    console.warn("[EnvLoader] .env.local not found. Using system environment variables.");
  }
} catch (err) {
  console.error("[EnvLoader] Failed to load .env.local:", err);
}
