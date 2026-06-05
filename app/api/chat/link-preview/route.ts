import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get("url");

    if (!targetUrl) {
      return NextResponse.json({ success: false, error: "Missing url parameter" }, { status: 400 });
    }

    // Basic URL validation
    try {
      new URL(targetUrl);
    } catch {
      return NextResponse.json({ success: false, error: "Invalid URL" }, { status: 400 });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return NextResponse.json({ success: false, error: "Failed to fetch URL" }, { status: response.status });
    }

    const html = await response.text();

    // Helper regex extractors
    const extractMeta = (propertyOrName: string) => {
      const regex = new RegExp(
        `<meta[^>]*(?:property|name)=["']${propertyOrName}["'][^>]*content=["']([^"']*)["']`,
        "i"
      );
      const match = html.match(regex);
      if (match) return match[1];

      // Reverse order: <meta content="value" property="propertyOrName">
      const regexReverse = new RegExp(
        `<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${propertyOrName}["']`,
        "i"
      );
      const matchRev = html.match(regexReverse);
      return matchRev ? matchRev[1] : null;
    };

    const extractTitle = () => {
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      return titleMatch ? titleMatch[1].trim() : null;
    };

    const title = extractMeta("og:title") || extractMeta("twitter:title") || extractTitle() || "";
    const description = extractMeta("og:description") || extractMeta("twitter:description") || extractMeta("description") || "";
    let image = extractMeta("og:image") || extractMeta("twitter:image") || "";

    // Resolve relative image URLs
    if (image && !image.startsWith("http")) {
      const urlObj = new URL(targetUrl);
      if (image.startsWith("/")) {
        image = `${urlObj.origin}${image}`;
      } else {
        image = `${urlObj.origin}/${image}`;
      }
    }

    return NextResponse.json({
      success: true,
      title: title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'),
      description: description.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'),
      image,
      url: targetUrl
    });
  } catch (err: any) {
    console.error("Link preview error:", err);
    return NextResponse.json({ success: false, error: err.message || "Failed to parse metadata" }, { status: 500 });
  }
}
