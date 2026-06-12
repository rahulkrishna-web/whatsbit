import { NextResponse } from "next/server";
import twilio from "twilio";
import { db } from "../../../../lib/firebase";
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";

function cleanPhone(phone: string): string {
  if (!phone) return "";
  let raw = phone.replace(/^whatsapp:/, "");
  let cleaned = raw.replace(/[^\d+]/g, "");
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 5) return "";

  if (/^\d{10}$/.test(cleaned)) {
    cleaned = "+91" + cleaned;
  }
  if (/^91\d{10}$/.test(cleaned)) {
    cleaned = "+" + cleaned;
  }
  if (/^[1-9]\d{10,14}$/.test(cleaned) && !cleaned.startsWith("+")) {
    cleaned = "+" + cleaned;
  }
  return cleaned;
}

export async function POST(request: Request) {
  try {
    const { contactId, text, useTemplate, templateSid: customTemplateSid, senderName, mediaUrl, mediaType, contentVariables, campaignId } = await request.json();
    
    if (!contactId || (!text && !mediaUrl)) {
      return NextResponse.json(
        { success: false, error: "Missing contactId or message content" },
        { 
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          }
        }
      );
    }

    let tz = "Asia/Kolkata";
    try {
      const profileSnap = await getDoc(doc(db, "settings", "company_profile"));
      if (profileSnap.exists()) {
        tz = profileSnap.data().timeZone || "Asia/Kolkata";
      }
    } catch (e) {
      console.warn("Failed to load company timezone, using Asia/Kolkata", e);
    }

    const timeString = new Date().toLocaleTimeString("en-IN", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });

    const finalMsgText = text || (mediaType ? `Sent an attachment: ${mediaType}` : "Sent an attachment");

    if (contactId.startsWith("group-")) {
      const messagesRef = collection(db, "contacts", contactId, "messages");
      const mockSid = `group-msg-${Date.now()}`;
      await addDoc(messagesRef, {
        text: finalMsgText,
        isSent: true,
        time: timeString,
        status: "read",
        twilioSid: mockSid,
        timestamp: serverTimestamp(),
        senderName: senderName || null,
        mediaUrl: mediaUrl || null,
        mediaType: mediaType || null,
      });

      const contactRef = doc(db, "contacts", contactId);
      await setDoc(contactRef, {
        preview: finalMsgText.length > 50 ? finalMsgText.substring(0, 47) + "..." : finalMsgText,
        time: timeString,
        lastUpdated: serverTimestamp(),
        unreadCount: 0,
      }, { merge: true });

      return NextResponse.json(
        { 
          success: true, 
          sid: mockSid, 
          error: null 
        },
        {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          }
        }
      );
    }

    const cleanContactId = cleanPhone(contactId);
    const recipient = `whatsapp:${cleanContactId}`;

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const senderNumber = process.env.TWILIO_SENDER_NUMBER || "whatsapp:+918890211444";
    const defaultTemplateSid = process.env.TWILIO_WELCOME_TEMPLATE_SID || "HX68dfb84bba8143c63d42fb9d3a3a9af6";
    const selectedTemplateSid = customTemplateSid || defaultTemplateSid;

    let twilioMessageSid = null;
    let errorMsg = null;

    if (accountSid && authToken) {
      try {
        const client = twilio(accountSid, authToken);
        let payload: any = {
          from: senderNumber,
          to: recipient,
        };

        if (useTemplate) {
          payload.contentSid = selectedTemplateSid;
          if (contentVariables) {
            payload.contentVariables = JSON.stringify(contentVariables);
          }
        } else {
          if (text) {
            payload.body = text;
          }
          if (mediaUrl) {
            payload.mediaUrl = [mediaUrl];
          }
        }

        const message = await client.messages.create(payload);
        twilioMessageSid = message.sid;
      } catch (err: any) {
        console.error("Twilio API error:", err);
        errorMsg = err.message;
      }
    } else {
      console.warn("Twilio credentials not configured. Simulating message write to Firestore.");
      twilioMessageSid = `mock-${Date.now()}`;
    }

    // Write message to subcollection contacts/{contactId}/messages
    const messagesRef = collection(db, "contacts", contactId, "messages");
    await addDoc(messagesRef, {
      text: finalMsgText,
      isSent: true,
      time: timeString,
      status: errorMsg ? "failed" : "sent",
      twilioSid: twilioMessageSid,
      timestamp: serverTimestamp(),
      senderName: senderName || null,
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || null,
    });

    if (campaignId && !errorMsg && twilioMessageSid) {
      try {
        await setDoc(doc(db, "campaign_messages", twilioMessageSid), {
          campaignId,
          phone: contactId,
          timestamp: serverTimestamp()
        });
      } catch (e) {
        console.error("Failed to write campaign message mapping:", e);
      }
    }

    // Update contacts list metadata to surface latest message preview
    const contactRef = doc(db, "contacts", contactId);
    const contactPayload: any = {
      id: contactId,
      name: contactId,
      preview: finalMsgText.length > 50 ? finalMsgText.substring(0, 47) + "..." : finalMsgText,
      time: timeString,
      lastUpdated: serverTimestamp(),
      statusText: "WhatsApp • Online",
      unreadCount: 0,
    };
    if (campaignId) {
      contactPayload.isMarketing = true;
    }
    await setDoc(contactRef, contactPayload, { merge: true });

    return NextResponse.json(
      { 
        success: !errorMsg, 
        sid: twilioMessageSid, 
        error: errorMsg 
      },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        }
      }
    );
  } catch (error: any) {
    console.error("Failed to send message:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { 
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        }
      }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
