import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { db } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp, doc, updateDoc } from "firebase/firestore";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { contactId, text, useTemplate, templateSid, contentVariables, senderName, mediaUrl, mediaType } = body;

    if (!contactId) {
      return NextResponse.json({ success: false, error: "Missing contactId" }, { status: 400 });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const senderNumber = process.env.TWILIO_SENDER_NUMBER || "whatsapp:+918890211444";

    if (!accountSid || !authToken) {
      return NextResponse.json({ success: false, error: "Twilio credentials not configured in environment" }, { status: 500 });
    }

    const client = twilio(accountSid, authToken);

    const payload: any = {
      from: senderNumber,
      to: `whatsapp:${contactId}`,
    };

    if (useTemplate && templateSid) {
      payload.contentSid = templateSid;
      if (contentVariables) {
        payload.contentVariables = JSON.stringify(contentVariables);
      }
    } else {
      payload.body = text || "";
    }

    if (mediaUrl) {
      payload.mediaUrl = [mediaUrl];
    }

    const message = await client.messages.create(payload);
    
    // Save to Firestore natively using the app's database
    const msgData: any = {
      text: text || "",
      isSent: true,
      time: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }),
      status: "sent",
      timestamp: serverTimestamp(),
      senderName: senderName || "Staff",
      twilioSid: message.sid
    };
    
    if (mediaUrl) msgData.mediaUrl = mediaUrl;
    if (mediaType) msgData.mediaType = mediaType;
    if (templateSid) msgData.templateSid = templateSid;

    await addDoc(collection(db, "contacts", contactId, "messages"), msgData);

    await updateDoc(doc(db, "contacts", contactId), {
      preview: mediaUrl ? "Media file" : (text ? text.substring(0, 47) + (text.length > 47 ? "..." : "") : "Template message"),
      time: msgData.time,
      lastUpdated: serverTimestamp()
    });

    return NextResponse.json({ success: true, messageSid: message.sid });

  } catch (error: any) {
    console.error("Error sending WhatsApp message:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
