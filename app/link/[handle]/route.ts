import { NextResponse } from "next/server";
import { db } from "../../../lib/firebase";
import { doc, getDoc, updateDoc, addDoc, collection } from "firebase/firestore";

// Helper to determine if a request is from a bot or preview crawler
function checkIsBot(request: Request): boolean {
  const userAgent = request.headers.get("user-agent") || "";
  const uaLower = userAgent.toLowerCase();
  
  const isBotAgent = 
    uaLower.includes("bot") ||
    uaLower.includes("crawl") ||
    uaLower.includes("spider") ||
    uaLower.includes("whatsapp") ||
    uaLower.includes("facebook") ||
    uaLower.includes("facebot") ||
    uaLower.includes("slack") ||
    uaLower.includes("twitter") ||
    uaLower.includes("telegram") ||
    uaLower.includes("linkedin") ||
    uaLower.includes("discord") ||
    uaLower.includes("embedly") ||
    uaLower.includes("preview") ||
    uaLower.includes("skype") ||
    uaLower.includes("applebot") ||
    uaLower.includes("google") ||
    uaLower.includes("yahoo") ||
    uaLower.includes("bing") ||
    uaLower.includes("lighthouse") ||
    uaLower.includes("curl") ||
    uaLower.includes("wget") ||
    uaLower.includes("go-http-client");

  const purpose = request.headers.get("purpose") || "";
  const secPurpose = request.headers.get("sec-purpose") || "";
  const xPurpose = request.headers.get("x-purpose") || "";
  const xMoz = request.headers.get("x-moz") || "";
  
  const isPrefetch = 
    purpose.toLowerCase() === "prefetch" || 
    secPurpose.toLowerCase() === "prefetch" || 
    xPurpose.toLowerCase() === "prefetch" || 
    xMoz.toLowerCase() === "prefetch";

  return isBotAgent || isPrefetch;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> }
) {
  try {
    const { handle } = await params;
    if (!handle) {
      return new NextResponse("Invalid request: missing link handle", { status: 400 });
    }

    const docRef = doc(db, "short_links", handle);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return new NextResponse("Link not found or expired", { status: 404 });
    }

    const linkData = docSnap.data();
    const originalUrl = linkData.originalUrl;
    if (!originalUrl) {
      return new NextResponse("Link points to an empty location", { status: 404 });
    }

    // If it's a known bot/crawler or browser prefetch request, perform server-side redirect immediately.
    // This allows the bot/crawler to follow the redirect and generate correct meta preview,
    // but avoids logging the click event or marking the link as opened in the UI.
    if (checkIsBot(request)) {
      return NextResponse.redirect(originalUrl, 302);
    }

    // For real browser requests, serve a JS-redirect landing page.
    // This prevents bots that don't run JS from registering false-positive clicks.
    let fileName = "Document";
    try {
      const urlObj = new URL(originalUrl);
      const pathname = urlObj.pathname;
      const parts = pathname.split("/");
      const lastPart = parts[parts.length - 1];
      if (lastPart) {
        fileName = decodeURIComponent(lastPart);
      }
    } catch (e) {
      // Keep fallback name
    }

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>Opening Link...</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  
  <!-- OpenGraph previews -->
  <meta property="og:title" content="${fileName}" />
  <meta property="og:description" content="Click to view the shared document." />
  <meta property="og:type" content="website" />
  
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background-color: #f8fafc;
      color: #334155;
    }
    .container {
      text-align: center;
      padding: 24px;
      max-width: 400px;
    }
    .spinner {
      border: 3.5px solid #cbd5e1;
      border-top: 3.5px solid #00a884;
      border-radius: 50%;
      width: 28px;
      height: 28px;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 18px auto;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <div style="font-size: 16px; font-weight: 600; color: #1e293b;">Opening document...</div>
    <div style="font-size: 13px; color: #64748b; margin-top: 8px; line-height: 1.4;">
      Please wait while we redirect you. If you are not redirected automatically, 
      <a href="${originalUrl}" style="color: #00a884; text-decoration: underline; font-weight: 500;">click here</a>.
    </div>
  </div>
  <script>
    (async function() {
      try {
        // Send a POST request to this endpoint to record click event
        await fetch(window.location.href, { method: "POST" });
      } catch (e) {
        console.error("Tracking failed:", e);
      } finally {
        window.location.replace(${JSON.stringify(originalUrl)});
      }
    })();
  </script>
</body>
</html>`;

    return new NextResponse(htmlContent, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });

  } catch (error: any) {
    console.error("Error redirecting short link:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ handle: string }> }
) {
  try {
    const { handle } = await params;
    if (!handle) {
      return new NextResponse("Invalid request", { status: 400 });
    }

    // Safe protection check: Ignore tracking requests from bots/pre-fetches
    if (checkIsBot(request)) {
      return NextResponse.json({ success: false, reason: "ignored_bot" });
    }

    const docRef = doc(db, "short_links", handle);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return new NextResponse("Link not found", { status: 404 });
    }

    const linkData = docSnap.data();
    const { contactId, messageId } = linkData;

    // 1. Save click event detail for analytics
    try {
      const clicksRef = collection(db, "short_links", handle, "clicks");
      await addDoc(clicksRef, {
        timestamp: new Date(),
        userAgent: request.headers.get("user-agent") || null,
        referer: request.headers.get("referer") || null,
        ip: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null,
      });
    } catch (clickErr) {
      console.error("Failed to log short link click:", clickErr);
    }

    // 2. Update message linkOpenedAt to sync real-time UI
    if (contactId && messageId) {
      try {
        const msgRef = doc(db, "contacts", contactId, "messages", messageId);
        await updateDoc(msgRef, {
          linkOpenedAt: new Date()
        });
      } catch (msgErr) {
        console.error("Failed to update message linkOpenedAt timestamp:", msgErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error logging click:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
