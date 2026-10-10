import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return NextResponse.json({
      success: false,
      error: "Twilio credentials not configured in environment",
      templates: []
    }, { status: 500 });
  }

  try {
    const authString = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    let url: string | null = "https://content.twilio.com/v1/ContentAndApprovals?PageSize=100";
    const allContents: any[] = [];

    while (url) {
      const res: Response = await fetch(url, {
        headers: {
          "Authorization": `Basic ${authString}`,
          "Content-Type": "application/json"
        },
        cache: "no-store"
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`Twilio ContentAndApprovals API returned status ${res.status}:`, errorText);
        return NextResponse.json({
          success: false,
          error: `Twilio API returned status ${res.status}`,
          details: errorText
        }, { status: res.status });
      }

      const data = await res.json();
      if (Array.isArray(data.contents)) {
        allContents.push(...data.contents);
      }

      if (data.meta?.next_token) {
        url = `https://content.twilio.com/v1/ContentAndApprovals?PageSize=100&PageToken=${encodeURIComponent(data.meta.next_token)}`;
      } else {
        url = null;
      }
    }

    const parsedTemplates = allContents.map((item: any) => {
      let bodyText = "";
      let buttons: string[] = [];
      let mediaUrls: string[] = [];

      if (item.types && typeof item.types === "object") {
        for (const typeKey of Object.keys(item.types)) {
          const typeObj = item.types[typeKey];
          if (!typeObj) continue;

          if (typeObj.body && !bodyText) {
            bodyText = typeObj.body;
          }
          if (Array.isArray(typeObj.actions) && buttons.length === 0) {
            buttons = typeObj.actions.map((a: any) => a.title || a.id || "").filter(Boolean);
          }
          if (Array.isArray(typeObj.media) && mediaUrls.length === 0) {
            mediaUrls = typeObj.media;
          }
        }
      }

      const approvalStatus = (
        item.approval_requests?.status ||
        item.status ||
        "approved"
      ).toLowerCase();

      const category = item.approval_requests?.category || "MARKETING";

      return {
        sid: item.sid,
        friendlyName: item.friendly_name || item.sid,
        body: bodyText,
        language: item.language || "en",
        status: approvalStatus,
        category: category,
        rejectionReason: item.approval_requests?.rejection_reason || null,
        buttons: buttons,
        media: mediaUrls,
        dateCreated: item.date_created,
        dateUpdated: item.date_updated,
        types: item.types || {},
        variables: item.variables || {}
      };
    });

    return NextResponse.json({
      success: true,
      templates: parsedTemplates,
      total: parsedTemplates.length
    });
  } catch (err: any) {
    console.error("Error fetching Twilio templates:", err);
    return NextResponse.json({
      success: false,
      error: err.message || "Failed to fetch Twilio templates"
    }, { status: 500 });
  }
}
