import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const contactId = formData.get("contactId") as string;
    
    if (!file || !contactId) {
      return NextResponse.json({ success: false, error: "Missing file or contactId" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Path: public/uploads/[contactId]/[timestamp]_[filename]
    const relativeDir = join("uploads", contactId);
    const uploadDir = join(process.cwd(), "public", relativeDir);
    
    // Ensure target directory exists
    await mkdir(uploadDir, { recursive: true });

    const filename = `${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
    const filePath = join(uploadDir, filename);

    await writeFile(filePath, buffer);

    // Get origin to construct absolute URL (required for Twilio to fetch)
    const host = request.headers.get("host") || "";
    const protocol = request.headers.get("x-forwarded-proto") || "http";
    const publicUrl = `${protocol}://${host}/${relativeDir}/${filename}`;

    return NextResponse.json({ success: true, url: publicUrl });
  } catch (error: any) {
    console.error("Local upload error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
