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

    // A failed send is still saved (status "failed" + the Twilio error) so the reply doesn't vanish on refresh
    // and staff can see why it wasn't delivered.
    let messageSid = "";
    let sendError: { code: string; message: string } | null = null;
    try {
      const message = await client.messages.create(payload);
      messageSid = message.sid;
    } catch (err: any) {
      console.error("Twilio send failed:", err);
      sendError = { code: err?.code ? String(err.code) : "", message: err?.message || "Twilio send failed" };
    }

    // Save to Firestore natively using the app's database
    const msgData: any = {
      text: text || "",
      isSent: true,
      time: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }),
      status: sendError ? "failed" : "sent",
      timestamp: serverTimestamp(),
      senderName: senderName || "Staff",
      twilioSid: messageSid
    };
    
    if (mediaUrl) msgData.mediaUrl = mediaUrl;
    if (mediaType) msgData.mediaType = mediaType;
    if (templateSid) msgData.templateSid = templateSid;
    if (sendError) {
      msgData.errorCode = sendError.code;
      msgData.errorMessage = sendError.message;
    }

    await addDoc(collection(db, "contacts", contactId, "messages"), msgData);

    if (sendError) {
      return NextResponse.json({ success: false, error: sendError.message, errorCode: sendError.code, saved: true }, { status: 502 });
    }

    await updateDoc(doc(db, "contacts", contactId), {
      preview: mediaUrl ? "Media file" : (text ? text.substring(0, 47) + (text.length > 47 ? "..." : "") : "Template message"),
      time: msgData.time,
      lastUpdated: serverTimestamp()
    });

    return NextResponse.json({ success: true, messageSid });

  } catch (error: any) {
    console.error("Error sending WhatsApp message:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
