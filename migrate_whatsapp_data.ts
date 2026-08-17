import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import * as admin from "firebase-admin";
import * as dotenv from "dotenv";
import * as fs from "fs";

// Load whatsbit config
dotenv.config({ path: ".env.local" });

// Load autobiz config to get service account
const autobizEnvPath = "../autobiz/.env.local";
let serviceAccountStr = "";
if (fs.existsSync(autobizEnvPath)) {
  const envConfig = dotenv.parse(fs.readFileSync(autobizEnvPath));
  serviceAccountStr = envConfig.FIREBASE_SERVICE_ACCOUNT_KEY;
}

if (!serviceAccountStr) {
  console.error("Failed to load FIREBASE_SERVICE_ACCOUNT_KEY from autobiz/.env.local");
  process.exit(1);
}

// 1. Initialize Old Whatsbit Firebase (Client SDK)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const oldDb = getFirestore(app);

// 2. Initialize New Clyrix Firebase (Admin SDK)
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(serviceAccountStr)),
  databaseURL: `https://nxtngo.firebaseio.com`
});
const newDb = admin.firestore();

const WORKSPACE_ID = "rscg";
const workspaceRef = newDb.collection("workspaces").doc(WORKSPACE_ID);

function sanitizeData(data: any): any {
  if (data === null || data === undefined) return data;
  if (typeof data.toDate === 'function') {
    return data.toDate(); // Convert Client Timestamp to native Date
  }
  if (Array.isArray(data)) {
    return data.map(sanitizeData);
  }
  if (typeof data === 'object') {
    const result: any = {};
    for (const key of Object.keys(data)) {
      result[key] = sanitizeData(data[key]);
    }
    return result;
  }
  return data;
}

async function migrateData() {
  console.log(`Starting migration to workspace: ${WORKSPACE_ID}...`);

  // Migrate Contacts
  console.log("Migrating contacts...");
  const contactsSnap = await getDocs(collection(oldDb, "contacts"));
  for (const doc of contactsSnap.docs) {
    const data = sanitizeData(doc.data());
    await workspaceRef.collection("contacts").doc(doc.id).set(data);
    
    // Migrate Messages for this contact
    const messagesSnap = await getDocs(collection(oldDb, `contacts/${doc.id}/messages`));
    for (const msgDoc of messagesSnap.docs) {
      await workspaceRef.collection("contacts").doc(doc.id).collection("messages").doc(msgDoc.id).set(sanitizeData(msgDoc.data()));
    }
  }
  console.log(`Migrated ${contactsSnap.size} contacts and their messages.`);

  // Migrate Campaigns
  console.log("Migrating campaigns...");
  const campaignsSnap = await getDocs(collection(oldDb, "campaigns"));
  for (const doc of campaignsSnap.docs) {
    const data = sanitizeData(doc.data());
    await workspaceRef.collection("campaigns").doc(doc.id).set(data);
    
    // Migrate Recipients for this campaign
    const recipientsSnap = await getDocs(collection(oldDb, `campaigns/${doc.id}/recipients`));
    for (const recDoc of recipientsSnap.docs) {
      await workspaceRef.collection("campaigns").doc(doc.id).collection("recipients").doc(recDoc.id).set(sanitizeData(recDoc.data()));
    }
  }
  console.log(`Migrated ${campaignsSnap.size} campaigns.`);

  // Migrate Campaign Messages (Global Twilio SID map)
  console.log("Migrating campaign_messages...");
  const campaignMessagesSnap = await getDocs(collection(oldDb, "campaign_messages"));
  for (const doc of campaignMessagesSnap.docs) {
    await workspaceRef.collection("campaign_messages").doc(doc.id).set(sanitizeData(doc.data()));
  }
  console.log(`Migrated ${campaignMessagesSnap.size} campaign_messages.`);

  console.log("Migration completed successfully!");
}

migrateData().catch(console.error);
