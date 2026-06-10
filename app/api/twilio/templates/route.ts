import { NextResponse } from "next/server";

export async function GET() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  const mockTemplates = [
    {
      sid: "HX68dfb84bba8143c63d42fb9d3a3a9af6",
      friendlyName: "RS Choyal Welcome",
      body: "Hello, Thank you for connecting with RS Choyal Group. Please let us know how we can assist you today?",
      language: "en"
    },
    {
      sid: "HX4fc87b16abefa2e835b5e0f881b76213",
      friendlyName: "webinar_invite_text",
      body: "Hi {{1}},\nYou're invited to an exclusive webinar by CHARGE, part of RS Choyal Group! 🎓\n\nTopic: {{2}}\n📅 Date: {{3}} ({{4}})\n🕒 Time: {{5}} IST\n🎙️ Speaker: {{6}} | {{7}}\n\nWhat you'll learn:\n✔️ {{8}}\n✔️ {{9}}\n✔️ {{10}}\nThis webinar is perfect for:\n✔️ {{11}}\n✔️ {{12}}\n✔️ {{13}}\n\nRegister now at {{14}}\n\nSpots are limited!",
      language: "en"
    }
  ];

  if (!accountSid || !authToken) {
    return NextResponse.json({
      success: true,
      templates: mockTemplates,
      isSimulated: true
    });
  }

  try {
    const authString = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const res = await fetch("https://content.twilio.com/v1/Content", {
      headers: {
        "Authorization": `Basic ${authString}`,
        "Content-Type": "application/json"
      },
      next: { revalidate: 60 } // Cache templates for 1 minute
    });

    if (!res.ok) {
      console.warn(`Twilio Content API returned status ${res.status}. Falling back to mocks.`);
      return NextResponse.json({
        success: true,
        templates: mockTemplates,
        isSimulated: true,
        warning: `Twilio API returned status ${res.status}`
      });
    }

    const data = await res.json();
    const contents = data.contents || [];

    const parsedTemplates = contents.map((item: any) => {
      let bodyText = "";
      if (item.types) {
        const typeKeys = Object.keys(item.types);
        for (const tk of typeKeys) {
          if (item.types[tk]?.body) {
            bodyText = item.types[tk].body;
            break;
          }
        }
      }

      return {
        sid: item.sid,
        friendlyName: item.friendly_name || item.sid,
        body: bodyText,
        language: item.language || "en"
      };
    });

    // Merge the custom webinar_invite_text into the fetched ones if it is not present in their Twilio account
    const hasWebinarInvite = parsedTemplates.some((t: any) => t.sid === "HX4fc87b16abefa2e835b5e0f881b76213");
    if (!hasWebinarInvite) {
      parsedTemplates.unshift(mockTemplates[1]);
    }

    return NextResponse.json({
      success: true,
      templates: parsedTemplates,
      isSimulated: false
    });
  } catch (err: any) {
    console.error("Error fetching templates from Twilio Content API:", err);
    return NextResponse.json({
      success: true,
      templates: mockTemplates,
      isSimulated: true,
      error: err.message
    });
  }
}
