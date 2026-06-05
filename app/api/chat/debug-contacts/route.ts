import { NextResponse } from "next/server";
import { db } from "../../../../lib/firebase";
import { collection, getDocs } from "firebase/firestore";

export async function GET() {
  try {
    const querySnapshot = await getDocs(collection(db, "contacts"));
    const results: any[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      results.push({
        id: doc.id,
        name: data.name,
        preview: data.preview,
        time: data.time,
        unreadCount: data.unreadCount,
        lastUpdated: data.lastUpdated ? (data.lastUpdated.toDate ? data.lastUpdated.toDate().toISOString() : data.lastUpdated) : null
      });
    });
    
    // Sort by lastUpdated desc
    results.sort((a, b) => {
      if (!a.lastUpdated) return 1;
      if (!b.lastUpdated) return -1;
      return b.lastUpdated.localeCompare(a.lastUpdated);
    });

    return NextResponse.json({ success: true, contacts: results });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message });
  }
}
