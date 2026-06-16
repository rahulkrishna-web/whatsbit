import { NextResponse } from "next/server";
import { db } from "../../../lib/firebase";
import { doc, getDoc } from "firebase/firestore";

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

    const originalUrl = docSnap.data().originalUrl;
    if (!originalUrl) {
      return new NextResponse("Link points to an empty location", { status: 404 });
    }

    // Perform HTTP 302 Temporary Redirect
    return NextResponse.redirect(originalUrl, 302);
  } catch (error: any) {
    console.error("Error redirecting short link:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
