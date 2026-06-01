import { NextResponse } from "next/server";
import { db } from "../../../../lib/firebase";
import { 
  doc, 
  setDoc, 
  addDoc, 
  collection, 
  query, 
  where, 
  getDocs, 
  updateDoc, 
  serverTimestamp 
} from "firebase/firestore";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const data = Object.fromEntries(formData.entries());

    console.log("Twilio Webhook Received:", data);

    const messageSid = (data.MessageSid || data.SmsSid) as string;
    const messageStatus = data.MessageStatus as string; // sent, delivered, read, failed

    // Helper to strip "whatsapp:" prefix
    const cleanPhone = (phoneStr: string) => phoneStr ? phoneStr.replace("whatsapp:", "").trim() : "";

    // 1. Handle Message Status Callback
    if (messageStatus && messageSid) {
      const contactPhone = cleanPhone(data.To as string);
      if (contactPhone) {
        const messagesRef = collection(db, "contacts", contactPhone, "messages");
        const q = query(messagesRef, where("twilioSid", "==", messageSid));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
          const docRef = querySnapshot.docs[0].ref;
          let statusVal: "sent" | "delivered" | "read" | "failed" = "sent";
          if (messageStatus === "read") {
            statusVal = "read";
          } else if (messageStatus === "delivered") {
            statusVal = "delivered";
          } else if (messageStatus === "failed" || messageStatus === "undelivered") {
            statusVal = "failed";
          }
          
          const updatePayload: any = {
            status: statusVal
          };
          if (data.ErrorCode) {
            updatePayload.errorCode = String(data.ErrorCode);
          }
          if (data.ErrorMessage) {
            updatePayload.errorMessage = String(data.ErrorMessage);
          }
          
          await updateDoc(docRef, updatePayload);
        }
      }
      return new NextResponse("<Response></Response>", {
        headers: { "Content-Type": "text/xml" }
      });
    }

    // 2. Handle Incoming Message
    const fromPhone = cleanPhone(data.From as string);
    const body = (data.Body || "") as string;

    // Check for incoming media (images) from Twilio payload
    const numMedia = parseInt((data.NumMedia || "0") as string, 10);
    let mediaUrl = "";
    if (numMedia > 0) {
      mediaUrl = data.MediaUrl0 as string;
    }

    if (fromPhone && (body || mediaUrl)) {
      const timeString = new Date().toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      });

      // Add message to subcollection contacts/{fromPhone}/messages
      const messagesRef = collection(db, "contacts", fromPhone, "messages");
      await addDoc(messagesRef, {
        text: body,
        mediaUrl: mediaUrl,
        isSent: false,
        time: timeString,
        status: "read", // Incoming messages default to read status
        twilioSid: messageSid,
        timestamp: serverTimestamp(),
      });

      // Create or update the contact document
      const contactRef = doc(db, "contacts", fromPhone);
      await setDoc(contactRef, {
        id: fromPhone,
        name: fromPhone, // Fallback to phone number as name initially
        preview: mediaUrl ? "📷 Image" : (body.length > 50 ? body.substring(0, 47) + "..." : body),
        time: timeString,
        lastUpdated: serverTimestamp(),
        statusText: "WhatsApp • Online",
      }, { merge: true });
    }

    // Return TwiML response to Twilio
    return new NextResponse("<Response></Response>", {
      headers: { "Content-Type": "text/xml" }
    });
  } catch (error: any) {
    console.error("Webhook processing error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
