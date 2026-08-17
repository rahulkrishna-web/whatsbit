import * as admin from "firebase-admin";
import * as dotenv from "dotenv";
import * as fs from "fs";

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

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(serviceAccountStr)),
  databaseURL: `https://nxtngo.firebaseio.com`
});
const newDb = admin.firestore();

async function updateTwilioSettings() {
  console.log("Updating rscg workspace settings...");

  const twilioConfig = {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    fromNumber: "whatsapp:+918890211444",
    loginEnabled: false,
    apiKey: "clyrix_wa_x8f9j2l1p_whatsbit", // Pre-generated API key
  };

  // Find organization by slug "rscg" or ID "rscg"
  let orgId = "rscg";
  const orgDoc = await newDb.collection("organizations").doc(orgId).get();
  
  if (!orgDoc.exists) {
    // If not found by ID, query by slug
    const snapshot = await newDb.collection("organizations").where("slug", "==", "rscg").limit(1).get();
    if (!snapshot.empty) {
      orgId = snapshot.docs[0].id;
    } else {
      console.log("Creating new organizations/rscg document just in case it doesn't exist.");
    }
  }

  await newDb.collection("organizations").doc(orgId).set({
    twilioConfig
  }, { merge: true });

  console.log(`Updated organization ${orgId} with Twilio Config and API Key: clyrix_wa_x8f9j2l1p_whatsbit`);
}

updateTwilioSettings().catch(console.error);
