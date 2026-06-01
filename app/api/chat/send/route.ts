import { NextResponse } from "next/server";
import twilio from "twilio";
import { db } from "../../../../lib/firebase";
import { doc, setDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";

function cleanPhone(phone: string): string {
  let raw = phone.replace(/^whatsapp:/, "");
  let cleaned = raw.replace(/[^\d+]/g, "");
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
    const { contactId, text, useTemplate, templateSid: customTemplateSid } = await request.json();
    
    if (!contactId || !text) {
      return NextResponse.json({ success: false, error: "Missing contactId or text" }, { status: 400 });
    }

    const timeString = new Date().toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
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
        } else {
          payload.body = text;
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

    // Use the passed text directly as final stored message content
    const finalMsgText = text;

    // Write message to subcollection contacts/{contactId}/messages
    const messagesRef = collection(db, "contacts", contactId, "messages");
    await addDoc(messagesRef, {
      text: finalMsgText,
      isSent: true,
      time: timeString,
      status: errorMsg ? "failed" : "sent",
      twilioSid: twilioMessageSid,
      timestamp: serverTimestamp(),
    });

    // Update contacts list metadata to surface latest message preview
    const contactRef = doc(db, "contacts", contactId);
    await setDoc(contactRef, {
      preview: finalMsgText.length > 50 ? finalMsgText.substring(0, 47) + "..." : finalMsgText,
      time: timeString,
      lastUpdated: serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({ 
      success: !errorMsg, 
      sid: twilioMessageSid, 
      error: errorMsg 
    });
  } catch (error: any) {
    console.error("Failed to send message:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
