import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");

    if (!url) {
      return new Response("Missing url parameter", { status: 400 });
    }

    // Only allow proxying Twilio URLs to prevent arbitrary SSRF
    if (!url.startsWith("https://api.twilio.com/")) {
      return new Response("Unauthorized proxy target", { status: 403 });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      return new Response("Twilio credentials not configured", { status: 500 });
    }

    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    });

    if (!response.ok) {
      return new Response(`Failed to fetch media from source: ${response.statusText}`, {
        status: response.status,
      });
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const blob = await response.blob();

    return new Response(blob, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400", // cache for 24 hours
      },
    });
  } catch (error: any) {
    console.error("Media proxy error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
