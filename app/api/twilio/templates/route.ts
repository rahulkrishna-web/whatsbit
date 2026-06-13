import { NextResponse } from "next/server";

export async function GET() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  const mockTemplates = [
    {
      sid: "HX68dfb84bba8143c63d42fb9d3a3a9af6",
      friendlyName: "RS Choyal Welcome",
      body: "Hello, Thank you for connecting with RS Choyal Group. Please let us know how we can assist you today?",
      language: "en",
      status: "approved"
    },
    {
      sid: "HX4fc87b16abefa2e835b5e0f881b76213",
      friendlyName: "webinar_invite_text",
      body: "Hi {{1}},\nYou're invited to an exclusive webinar by CHARGE, part of RS Choyal Group! 🎓\n\nTopic: {{2}}\n📅 Date: {{3}} ({{4}})\n🕒 Time: {{5}} IST\n🎙️ Speaker: {{6}} | {{7}}\n\nWhat you'll learn:\n✔️ {{8}}\n✔️ {{9}}\n✔️ {{10}}\nThis webinar is perfect for:\n✔️ {{11}}\n✔️ {{12}}\n✔️ {{13}}\n\nRegister now at {{14}}\n\nSpots are limited!",
      language: "en",
      status: "approved"
    },
    {
      sid: "HX80131b9c07affee0a1404f655f587448",
      friendlyName: "webmail_invite",
      body: "Hi {{1}},\nYou have pending messages in your inbox. Please check the dashboard at {{2}}.",
      language: "en",
      status: "pending"
    },
    {
      sid: "HX46c6463c02f78669aac9d83c160f0ab",
      friendlyName: "Lead Qualification Welcome",
      body: "Hi {{1}}.\n\nThank you for your interest in flour milling solutions! 👋\n\nRS Choyal Group is a turnkey milling solutions provider with 60+ years of experience and 275+ successful projects across the globe.\n\nWhat brings you here?",
      language: "en",
      status: "approved"
    },
    {
      sid: "HXcd74bac32850c134356bdfb56915be1c",
      friendlyName: "Turnkey Plant Response",
      body: "Perfect! Setting up a turnkey plant is our specialty. We design and deliver complete milling solutions from 2 TPD to 2000 TPD based on your capacity needs.\n\nTo give you an accurate proposal, we need a few quick details:\n✓ What capacity are you targeting? (TPD)\n✓ What flour type? (Wheat, Pulses, Others)\n✓ What's your budget?\n\nOur technical team will prepare a customized plan for you.",
      language: "en",
      status: "approved"
    },
    {
      sid: "HX2fd7981c6f7f4c0076b05cc4b5f66c67",
      friendlyName: "Plant Expansion Response",
      body: "Great! Expansion is something we handle regularly. Whether you're scaling up your current capacity or adding new product lines, we have the right solutions.\n\nA few quick questions:\n✓ Current capacity?\n✓ Target expanded capacity?\n✓ Timeline for the expansion?\n✓ Product that you mill?",
      language: "en",
      status: "approved"
    },
    {
      sid: "HXa5d6ceac6207c14c348c4d8c89b7adc0",
      friendlyName: "Spares & Stones Response",
      body: "Perfect! We supply high-quality grinding stones and spare parts for ongoing maintenance and optimization.\n\nQuick info needed:\n✓ Which equipment/machine? (make/model)\n✓ Grinding stones, bearings, or other spares?\n✓ How soon do you need them?",
      language: "en",
      status: "approved"
    },
    {
      sid: "HX0f7cdc84a9b825505fc6a3a608c2a3bc",
      friendlyName: "Send Plant Brochure",
      body: "Thank you for your interest in RS Choyal Group!\n\nHere's our company brochure with detailed specifications\n📄 {{1}}\n\nAlso check out these quick videos to see our work:\n\n🎥 Company Overview: https://www.youtube.com/watch?v=DlEcmcDS598\n\n🎥 How We Setup Plants: https://www.youtube.com/watch?v=OETierqPRFA\n\n🎥 Milling Plant Process (Hindi): https://www.youtube.com/watch?v=MjUnwkiwAvM",
      language: "en",
      status: "approved"
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

      let status = "approved";
      if (item.approval_requests) {
        status = item.approval_requests.status || "approved";
      } else if (item.status) {
        status = item.status;
      }

      return {
        sid: item.sid,
        friendlyName: item.friendly_name || item.sid,
        body: bodyText,
        language: item.language || "en",
        status: status.toLowerCase()
      };
    });

    // Merge missing mock templates
    for (const mockT of mockTemplates) {
      const exists = parsedTemplates.some((t: any) => t.sid === mockT.sid);
      if (!exists) {
        parsedTemplates.push(mockT);
      }
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
