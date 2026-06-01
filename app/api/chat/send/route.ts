import { NextResponse } from "next/server";
import twilio from "twilio";
import { db } from "../../../../lib/firebase";
import { doc, setDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";

export async function POST(request: Request) {
  try {
    const { contactId, text, useTemplate } = await request.json();
    
    if (!contactId || !text) {
      return NextResponse.json({ success: false, error: "Missing contactId or text" }, { status: 400 });
    }

    const timeString = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const recipient = contactId.startsWith("whatsapp:") ? contactId : `whatsapp:${contactId}`;

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const senderNumber = process.env.TWILIO_SENDER_NUMBER || "whatsapp:+918890211444";
    const templateSid = process.env.TWILIO_WELCOME_TEMPLATE_SID || "HX68dfb84bba8143c6d42fb9d2fb3a9af6";

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
          payload.contentSid = templateSid;
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

    // Fallback template body if Twilio is bypassed or template is selected
    const finalMsgText = useTemplate 
      ? "Hello, Thank you for connecting with RS Choyal Group. Please let us know how we can assist you today?"
      : text;

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
