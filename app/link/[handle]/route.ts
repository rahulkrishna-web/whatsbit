import { NextResponse } from "next/server";
import { db } from "../../../lib/firebase";
import { doc, getDoc, updateDoc, addDoc, collection } from "firebase/firestore";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> }
) {
  try {
    const { handle } = await params;
    if (!handle) {
      return new NextResponse("Invalid request: missing link handle", { status: 400 });
    }

    const docRef = doc(db, "short_links", handle);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return new NextResponse("Link not found or expired", { status: 404 });
    }

    const linkData = docSnap.data();
    const originalUrl = linkData.originalUrl;
    if (!originalUrl) {
      return new NextResponse("Link points to an empty location", { status: 404 });
    }

    const { contactId, messageId } = linkData;

    // 1. Save full click event detail for analytics
    try {
      const clicksRef = collection(db, "short_links", handle, "clicks");
      await addDoc(clicksRef, {
        timestamp: new Date(),
        userAgent: request.headers.get("user-agent") || null,
        referer: request.headers.get("referer") || null,
        ip: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null,
      });
    } catch (clickErr) {
      console.error("Failed to log short link click:", clickErr);
    }

    // 2. Update message linkOpenedAt to sync real-time UI
    if (contactId && messageId) {
      try {
        const msgRef = doc(db, "contacts", contactId, "messages", messageId);
        await updateDoc(msgRef, {
          linkOpenedAt: new Date()
        });
      } catch (msgErr) {
        console.error("Failed to update message linkOpenedAt timestamp:", msgErr);
      }
    }

    // Perform HTTP 302 Temporary Redirect
    return NextResponse.redirect(originalUrl, 302);
  } catch (error: any) {
    console.error("Error redirecting short link:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
