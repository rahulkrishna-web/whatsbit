"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { db } from "../../lib/firebase";
import { 
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  increment,
  query,
  orderBy
} from "firebase/firestore";
import styles from "./CampaignsDashboard.module.css";

type Message = {
  id: string;
  text: string;
  isSent: boolean;
  time: string;
  status: "sent" | "delivered" | "read" | "failed";
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "document";
  senderName?: string;
  errorCode?: string;
  errorMessage?: string;
  timestamp?: any;
};

type Campaign = {
  id: string;
  name: string;
  templateSid: string;
  templateName: string;
  templateText: string;
  status: "draft" | "running" | "paused" | "completed";
  createdAt: any;
  totalCount: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  delaySeconds: number;
  stopOnSpam: boolean;
  failureThreshold: number; // e.g. 15%
  consecutiveFailureThreshold: number; // e.g. 3
  variableMappings?: Record<string, { type: "csv" | "default"; value: string; fallback?: string }>;
  isSimulated?: boolean;
};

type CampaignRecipient = {
  phone: string;
  variables: Record<string, string>;
  status: "pending" | "sending" | "sent" | "delivered" | "read" | "failed";
  twilioSid?: string;
  errorCode?: string;
  errorMessage?: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
};

const PREDEFINED_TEMPLATES = [
  {
    id: "welcome_choyal",
    name: "RS Choyal Welcome",
    text: "Hello, Thank you for connecting with RS Choyal Group. Please let us know how we can assist you today?",
    templateSid: "HX68dfb84bba8143c63d42fb9d3a3a9af6",
  }
];

function cleanPhone(phone: string): string {
  if (!phone) return "";
  let raw = phone.trim().replace(/^whatsapp:/, "");
  let cleaned = raw.replace(/[^\d+]/g, "");
  
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 5) return "";
  
  if (cleaned.startsWith("00")) {
    cleaned = "+" + cleaned.substring(2);
  }
  
  if (!cleaned.startsWith("+") && cleaned.startsWith("0") && cleaned.length === 11) {
    cleaned = cleaned.substring(1);
  }
  
  if (!cleaned.startsWith("+")) {
    if (/^\d{10}$/.test(cleaned)) {
      cleaned = "+91" + cleaned;
    } else if (/^91\d{10}$/.test(cleaned)) {
      cleaned = "+" + cleaned;
    } else {
      cleaned = "+91" + cleaned;
    }
  }
  return cleaned;
}

export default function CampaignsDashboard({ currentUser }: { currentUser: any }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([]);
  const [activeTab, setActiveTab] = useState<"logs" | "details">("logs");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [isCreating, setIsCreating] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [simulationMode, setSimulationMode] = useState(true);

  // Form states
  const [newCampaignName, setNewCampaignName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("HX68dfb84bba8143c63d42fb9d3a3a9af6");
  const [isCustomTemplate, setIsCustomTemplate] = useState(false);
  const [customTemplateSid, setCustomTemplateSid] = useState("");
  const [customTemplateText, setCustomTemplateText] = useState("");

  // Twilio Templates states
  const [twilioTemplates, setTwilioTemplates] = useState<any[]>([
    {
      sid: "HX68dfb84bba8143c63d42fb9d3a3a9af6",
      friendlyName: "RS Choyal Welcome",
      body: "Hello, Thank you for connecting with RS Choyal Group. Please let us know how we can assist you today?",
      language: "en"
    },
    {
      sid: "HX4fc87b16abefa2e835b5e0f881b76213",
      friendlyName: "webinar_invite_text",
      body: "Hi {{1}},\nYou're invited to an exclusive webinar by CHARGE, part of RS Choyal Group! 🎓\n\nTopic: {{2}}\n📅 Date: {{3}} ({{4}})\n🕒 Time: {{5}} IST\n🎙️ Speaker: {{6}} | {{7}}\n\nWhat you'll learn:\n✔️ {{8}}\n✔️ {{9}}\n✔️ {{10}}\nThis webinar is perfect for:\n✔️ {{11}}\n✔️ {{12}}\n✔️ {{13}}\n\nRegister now at {{14}}\n\nSpots are limited!",
      language: "en"
    }
  ]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [showTemplateGridModal, setShowTemplateGridModal] = useState(false);
  const [templatesSearchQuery, setTemplatesSearchQuery] = useState("");
  const [activeTemplateTab, setActiveTemplateTab] = useState<"approved" | "pending">("approved");
  const [recipientSource, setRecipientSource] = useState<"manual" | "csv">("manual");
  const [manualNumbers, setManualNumbers] = useState("");
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [stopOnSpam, setStopOnSpam] = useState(true);
  const [failureThreshold, setFailureThreshold] = useState(15);
  const [consecutiveFailureThreshold, setConsecutiveFailureThreshold] = useState(3);
  
  // CSV details
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [selectedPhoneColumn, setSelectedPhoneColumn] = useState("");
  const [variableMappings, setVariableMappings] = useState<Record<string, { type: "csv" | "default"; value: string; fallback?: string }>>({});
  
  // Test Message popup state
  const [showTestModal, setShowTestModal] = useState(false);
  const [testNumber, setTestNumber] = useState("");
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testLog, setTestLog] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load campaigns list
  useEffect(() => {
    const campaignsRef = collection(db, "campaigns");
    const q = query(campaignsRef, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snapshot) => {
      const list: Campaign[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as Campaign);
      });
      setCampaigns(list);
      
      // Select first campaign if none selected and lists exist
      if (list.length > 0 && !activeCampaignId && !isCreating) {
        setActiveCampaignId(list[0].id);
      }
    });
    return () => unsub();
  }, [activeCampaignId, isCreating]);

  const fetchTwilioTemplates = async () => {
    setIsLoadingTemplates(true);
    try {
      const res = await fetch("/api/twilio/templates");
      const result = await res.json();
      if (result.success) {
        setTwilioTemplates(result.templates || []);
      }
    } catch (e) {
      console.error("Error fetching Twilio templates:", e);
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  // Load templates on component mount
  useEffect(() => {
    fetchTwilioTemplates();
  }, []);

  // Load active campaign's recipients
  useEffect(() => {
    if (!activeCampaignId) {
      setRecipients([]);
      return;
    }
    const recRef = collection(db, "campaigns", activeCampaignId, "recipients");
    const unsub = onSnapshot(recRef, (snapshot) => {
      const list: CampaignRecipient[] = [];
      snapshot.forEach((doc) => {
        list.push({ phone: doc.id, ...doc.data() } as CampaignRecipient);
      });
      setRecipients(list);
    });
    return () => unsub();
  }, [activeCampaignId]);

  // Compute stats of active campaign
  const activeCampaign = useMemo(() => {
    return campaigns.find(c => c.id === activeCampaignId) || null;
  }, [campaigns, activeCampaignId]);

  // Extract variables of the selected template
  const templateText = useMemo(() => {
    if (isCustomTemplate) return customTemplateText;
    const found = twilioTemplates.find(t => t.sid === selectedTemplateId);
    return found ? found.body : "";
  }, [isCustomTemplate, selectedTemplateId, customTemplateText, twilioTemplates]);

  const templateSid = useMemo(() => {
    if (isCustomTemplate) return customTemplateSid;
    return selectedTemplateId;
  }, [isCustomTemplate, customTemplateSid, selectedTemplateId]);

  const templateVariables = useMemo(() => {
    const regex = /\{\{\s*([a-zA-Z0-9_\-\s]+)\s*\}\}/g;
    const matches: string[] = [];
    let match;
    while ((match = regex.exec(templateText)) !== null) {
      const varName = match[1].trim();
      if (!matches.includes(varName)) {
        matches.push(varName);
      }
    }
    return matches.sort((a, b) => {
      const numA = parseInt(a);
      const numB = parseInt(b);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.localeCompare(b);
    });
  }, [templateText]);

  const previewText = useMemo(() => {
    if (!templateText) return "";
    let text = templateText;
    templateVariables.forEach(v => {
      const mapping = variableMappings[v];
      let replacement = `{{${v}}}`;
      if (mapping) {
        if (mapping.type === "default") {
          replacement = mapping.value || `{{${v}}}`;
        } else if (mapping.type === "csv") {
          if (csvRows.length > 0 && mapping.value && csvRows[0][mapping.value]) {
            replacement = csvRows[0][mapping.value];
          } else {
            replacement = mapping.fallback ? mapping.fallback : `[CSV: ${mapping.value || `Var${v}`}]`;
          }
        }
      }
      text = text.split(`{{${v}}}`).join(replacement);
    });
    return text;
  }, [templateText, templateVariables, variableMappings, csvRows]);

  const filteredTemplates = useMemo(() => {
    return twilioTemplates.filter(t => {
      const statusMatch = activeTemplateTab === "approved"
        ? (t.status || "approved") === "approved"
        : (t.status || "approved") !== "approved";

      if (!statusMatch) return false;

      return (
        (t.friendlyName || "").toLowerCase().includes(templatesSearchQuery.toLowerCase()) ||
        (t.sid || "").toLowerCase().includes(templatesSearchQuery.toLowerCase()) ||
        (t.body || "").toLowerCase().includes(templatesSearchQuery.toLowerCase())
      );
    });
  }, [twilioTemplates, templatesSearchQuery, activeTemplateTab]);

  // Initialize variable mapping options when selected template changes
  useEffect(() => {
    const initial: Record<string, { type: "csv" | "default"; value: string; fallback?: string }> = {};
    templateVariables.forEach(v => {
      if (v === "1") {
        initial[v] = { type: "csv", value: "name", fallback: "Miller" };
      } else {
        initial[v] = { type: "default", value: "" };
      }
    });
    setVariableMappings(initial);
  }, [templateVariables]);

  // Handle CSV upload and parsing
  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split(/\r?\n/);
      if (lines.length === 0) return;

      const headers = lines[0].split(",").map(h => h.trim().replace(/^["']|["']$/g, ""));
      const rows: Record<string, string>[] = [];

      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = lines[i].split(",").map(v => v.trim().replace(/^["']|["']$/g, ""));
        const row: Record<string, string> = {};
        headers.forEach((header, index) => {
          row[header] = values[index] || "";
        });
        rows.push(row);
      }

      // Check for first and last name columns to combine
      const fNamePatterns = ["first name", "first me", "first", "given name", "fname", "first_name", "first-name"];
      const lNamePatterns = ["last name", "last me", "last", "family name", "surname", "lname", "last_name", "last-name"];
      
      const fNameHeader = headers.find(h => fNamePatterns.includes(h.toLowerCase()));
      const lNameHeader = headers.find(h => lNamePatterns.includes(h.toLowerCase()));

      if (fNameHeader && lNameHeader) {
        const combinedHeader = "Full Name (First + Last)";
        if (!headers.includes(combinedHeader)) {
          headers.push(combinedHeader);
        }
        rows.forEach(row => {
          const first = (row[fNameHeader] || "").trim();
          const last = (row[lNameHeader] || "").trim();
          row[combinedHeader] = `${first} ${last}`.trim();
        });
      }

      setCsvHeaders(headers);
      setCsvRows(rows);

      // Guess phone number column
      const phoneCol = headers.find(h => 
        h.toLowerCase().includes("phone") || 
        h.toLowerCase().includes("mobile") || 
        h.toLowerCase().includes("num")
      ) || headers[0] || "";
      setSelectedPhoneColumn(phoneCol);

      // Guess matches for variable placeholders
      const updatedMap = { ...variableMappings };
      templateVariables.forEach(v => {
        let matchingHeader = headers.find(h => h.toLowerCase() === `var${v}` || h.toLowerCase().includes(`variable${v}`));
        if (v === "1" && !matchingHeader) {
          matchingHeader = headers.find(h => 
            h === "Full Name (First + Last)" || 
            h.toLowerCase() === "name" || 
            h.toLowerCase() === "full name" ||
            fNamePatterns.includes(h.toLowerCase())
          );
        }
        if (matchingHeader) {
          updatedMap[v] = { type: "csv", value: matchingHeader };
        } else {
          updatedMap[v] = { type: "default", value: "" };
        }
      });
      setVariableMappings(updatedMap);
    };
    reader.readAsText(file);
  };

  const handleCreateCampaign = async () => {
    if (!newCampaignName.trim()) {
      alert("Please enter a campaign name.");
      return;
    }
    if (!templateSid.trim() || !templateText.trim()) {
      alert("Please provide template SID and template text.");
      return;
    }

    let rawRecipients: { phone: string; variables: Record<string, string> }[] = [];

    if (recipientSource === "manual") {
      const lines = manualNumbers.split(/\n/);
      lines.forEach(line => {
        const cleaned = cleanPhone(line.trim());
        if (cleaned) {
          const vars: Record<string, string> = {};
          templateVariables.forEach(v => {
            const mapRule = variableMappings[v];
            if (mapRule?.type === "csv") {
              vars[v] = mapRule.fallback || "";
            } else {
              vars[v] = mapRule?.value || "";
            }
          });
          rawRecipients.push({ phone: cleaned, variables: vars });
        }
      });
    } else {
      if (csvRows.length === 0 || !selectedPhoneColumn) {
        alert("Please upload a CSV file and select the phone number column.");
        return;
      }
      csvRows.forEach(row => {
        const cleaned = cleanPhone(row[selectedPhoneColumn] || "");
        if (cleaned) {
          const vars: Record<string, string> = {};
          templateVariables.forEach(v => {
            const mapRule = variableMappings[v];
            if (mapRule?.type === "csv") {
              const val = (row[mapRule.value] || "").trim();
              vars[v] = val !== "" ? val : (mapRule.fallback || "");
            } else {
              vars[v] = mapRule?.value || "";
            }
          });
          rawRecipients.push({ phone: cleaned, variables: vars });
        }
      });
    }

    // Deduplicate phone numbers
    const uniqMap = new Map<string, Record<string, string>>();
    rawRecipients.forEach(r => uniqMap.set(r.phone, r.variables));
    
    if (uniqMap.size === 0) {
      alert("No valid recipient phone numbers found.");
      return;
    }

    try {
      const templateName = isCustomTemplate 
        ? "Custom Template" 
        : twilioTemplates.find(t => t.sid === selectedTemplateId)?.friendlyName || "Template";

      let campId = "";
      if (editingCampaignId) {
        campId = editingCampaignId;
        const campRef = doc(db, "campaigns", campId);
        
        // Update campaign metadata
        await updateDoc(campRef, {
          name: newCampaignName.trim(),
          templateSid,
          templateName,
          templateText,
          totalCount: uniqMap.size,
          delaySeconds,
          stopOnSpam,
          failureThreshold,
          consecutiveFailureThreshold,
          variableMappings,
          isSimulated: simulationMode
        });
        
        // Delete all old recipients from subcollection
        const oldRecsSnap = await getDocs(collection(db, "campaigns", campId, "recipients"));
        const deleteBatch = writeBatch(db);
        oldRecsSnap.forEach((doc) => {
          deleteBatch.delete(doc.ref);
        });
        await deleteBatch.commit();
      } else {
        // Write new campaign metadata
        const campRef = doc(collection(db, "campaigns"));
        campId = campRef.id;
        const campData: Campaign = {
          id: campId,
          name: newCampaignName.trim(),
          templateSid,
          templateName,
          templateText,
          status: "draft",
          createdAt: serverTimestamp(),
          totalCount: uniqMap.size,
          sentCount: 0,
          deliveredCount: 0,
          readCount: 0,
          failedCount: 0,
          delaySeconds,
          stopOnSpam,
          failureThreshold,
          consecutiveFailureThreshold,
          variableMappings,
          isSimulated: simulationMode
        };
        await setDoc(campRef, campData);
      }

      // Write recipients in batches of 500
      const batchList = Array.from(uniqMap.entries());
      const batchSize = 400; // Keep slightly below firestore 500 limit to be safe
      for (let i = 0; i < batchList.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = batchList.slice(i, i + batchSize);
        chunk.forEach(([phone, variables]) => {
          const recDocRef = doc(db, "campaigns", campId, "recipients", phone);
          batch.set(recDocRef, {
            status: "pending",
            variables
          });
        });
        await batch.commit();
      }

      setIsCreating(false);
      setEditingCampaignId(null);
      setActiveCampaignId(campId);
      // Reset form fields
      setNewCampaignName("");
      setManualNumbers("");
      setCsvHeaders([]);
      setCsvRows([]);
      setSelectedPhoneColumn("");
    } catch (err: any) {
      alert("Error saving campaign: " + err.message);
    }
  };

  const handleEditCampaign = () => {
    if (!activeCampaign) return;
    setEditingCampaignId(activeCampaign.id);
    setNewCampaignName(activeCampaign.name);
    
    // Check template type
    const isCustom = activeCampaign.templateName === "Custom Template";
    setIsCustomTemplate(isCustom);
    if (isCustom) {
      setCustomTemplateSid(activeCampaign.templateSid || "");
      setCustomTemplateText(activeCampaign.templateText || "");
    } else {
      setSelectedTemplateId(activeCampaign.templateSid || "");
    }
    
    setDelaySeconds(activeCampaign.delaySeconds || 2);
    setStopOnSpam(activeCampaign.stopOnSpam !== false);
    setFailureThreshold(activeCampaign.failureThreshold || 15);
    setConsecutiveFailureThreshold(activeCampaign.consecutiveFailureThreshold || 3);
    
    // Load recipients
    const recipientPhones = recipients.map(r => r.phone).join("\n");
    setManualNumbers(recipientPhones);
    setRecipientSource("manual");
    
    // Load mappings
    if (activeCampaign.variableMappings) {
      setVariableMappings(activeCampaign.variableMappings);
    } else if (recipients.length > 0) {
      const firstRecVars = recipients[0].variables || {};
      const newMappings: Record<string, { type: "csv" | "default"; value: string; fallback?: string }> = {};
      Object.entries(firstRecVars).forEach(([v, val]) => {
        newMappings[v] = { type: "default", value: val as string };
      });
      setVariableMappings(newMappings);
    } else {
      setVariableMappings({});
    }
    
    setIsCreating(true);
  };

  const handleStartCampaign = async () => {
    if (!activeCampaignId) return;
    await updateDoc(doc(db, "campaigns", activeCampaignId), {
      status: "running"
    });
  };

  const handlePauseCampaign = async () => {
    if (!activeCampaignId) return;
    await updateDoc(doc(db, "campaigns", activeCampaignId), {
      status: "paused"
    });
  };

  const handleDeleteCampaign = async () => {
    if (!activeCampaignId) return;
    if (!confirm("Are you sure you want to delete this campaign? All recipient logs will be purged.")) return;

    try {
      const campId = activeCampaignId;
      setActiveCampaignId(null);

      // Delete recipients
      const recsSnap = await getDocs(collection(db, "campaigns", campId, "recipients"));
      const batchSize = 400;
      const docsArray = recsSnap.docs;
      for (let i = 0; i < docsArray.length; i += batchSize) {
        const batch = writeBatch(db);
        docsArray.slice(i, i + batchSize).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }

      // Delete campaign document itself
      await deleteDoc(doc(db, "campaigns", campId));
    } catch (e: any) {
      alert("Error deleting campaign: " + e.message);
    }
  };

  // Sync simulationMode state when activeCampaign changes
  useEffect(() => {
    if (activeCampaign) {
      setSimulationMode(activeCampaign.isSimulated !== false);
    }
  }, [activeCampaignId, activeCampaign]);

  // Listen to background worker status heartbeat
  const [workerActive, setWorkerActive] = useState<boolean>(false);
  const [workerLastActiveTs, setWorkerLastActiveTs] = useState<number | null>(null);

  useEffect(() => {
    const workerRef = doc(db, "settings", "worker_status");
    const unsub = onSnapshot(workerRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const lastActive = data.lastActive;
        if (lastActive) {
          const ts = lastActive.toDate ? lastActive.toDate().getTime() : (lastActive.seconds ? lastActive.seconds * 1000 : Date.now());
          setWorkerLastActiveTs(ts);
        }
      }
    }, (err) => {
      console.error("Error listening to worker status:", err);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const checkHeartbeat = () => {
      if (workerLastActiveTs) {
        const diffSeconds = (Date.now() - workerLastActiveTs) / 1000;
        setWorkerActive(diffSeconds < 15);
      } else {
        setWorkerActive(false);
      }
    };
    checkHeartbeat();
    const intervalId = setInterval(checkHeartbeat, 5000);
    return () => clearInterval(intervalId);
  }, [workerLastActiveTs]);

  // Handle Send Test Message
  const handleOpenTestModal = () => {
    setTestLog("");
    setTestNumber("");
    setShowTestModal(true);
  };

  const handleSendTestMessage = async () => {
    if (!testNumber.trim()) {
      alert("Please enter a test number.");
      return;
    }
    setIsSendingTest(true);
    
    // Auto-compile variables
    const compiledVars: Record<string, string> = {};
    if (isCreating) {
      templateVariables.forEach(v => {
        const mapping = variableMappings[v];
        if (mapping) {
          if (mapping.type === "default") {
            compiledVars[v] = mapping.value || "";
          } else if (mapping.type === "csv") {
            if (csvRows.length > 0 && mapping.value && csvRows[0][mapping.value]) {
              compiledVars[v] = csvRows[0][mapping.value];
            } else {
              compiledVars[v] = mapping.fallback || "";
            }
          }
        } else {
          compiledVars[v] = "";
        }
      });
    } else {
      const firstRecVars = recipients[0]?.variables || {};
      templateVariables.forEach(v => {
        compiledVars[v] = firstRecVars[v] || "";
      });
    }

    setTestLog(`Compiling variables & sending test message...\nVariables to send:\n${JSON.stringify(compiledVars, null, 2)}`);
    
    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: cleanPhone(testNumber),
          text: templateText,
          useTemplate: true,
          templateSid: templateSid,
          senderName: currentUser ? currentUser.name : "Tester",
          contentVariables: compiledVars
        })
      });
      const result = await res.json();
      if (result.success) {
        setTestLog(prev => `${prev}\n\nSuccess! Message sent.\nTwilio Message SID: ${result.sid}`);
      } else {
        setTestLog(prev => `${prev}\n\nFailed to send test message:\nError: ${result.error}`);
      }
    } catch (e: any) {
      setTestLog(prev => `${prev}\n\nRequest Error: ${e.message}`);
    } finally {
      setIsSendingTest(false);
    }
  };

  // Filtered recipients
  const filteredRecipients = useMemo(() => {
    if (filterStatus === "all") return recipients;
    return recipients.filter(r => r.status === filterStatus);
  }, [recipients, filterStatus]);

  // Compute percentages
  const progressPercent = useMemo(() => {
    if (!activeCampaign || activeCampaign.totalCount === 0) return 0;
    const sentTotal = activeCampaign.sentCount + activeCampaign.deliveredCount + activeCampaign.readCount + activeCampaign.failedCount;
    return Math.min(100, Math.round((sentTotal / activeCampaign.totalCount) * 100));
  }, [activeCampaign]);

  return (
    <div className={styles.container}>
      {/* 1. Campaigns Sidebar */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h2>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
            </svg>
            Campaigns
          </h2>
          <button 
            className={styles.createButton}
            onClick={() => {
              setIsCreating(true);
              setEditingCampaignId(null);
              setNewCampaignName("");
              setManualNumbers("");
              setCsvHeaders([]);
              setCsvRows([]);
              setSelectedPhoneColumn("");
              setVariableMappings({});
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Create Campaign
          </button>
        </div>

        <div className={styles.campaignList}>
          {campaigns.map((camp) => (
            <div 
              key={camp.id} 
              className={`${styles.campaignItem} ${activeCampaignId === camp.id && !isCreating ? styles.campaignItemActive : ""}`}
              onClick={() => {
                setIsCreating(false);
                setEditingCampaignId(null);
                setActiveCampaignId(camp.id);
              }}
            >
              <div className={styles.campaignItemName}>{camp.name}</div>
              <div className={styles.campaignSubtitle} style={{ marginTop: '2px' }}>{camp.templateName}</div>
              
              <div className={styles.campaignItemMeta}>
                <span className={`${styles.statusIndicator} ${
                  camp.status === "running" ? styles.statusRunning :
                  camp.status === "paused" ? styles.statusPaused :
                  camp.status === "completed" ? styles.statusCompleted :
                  styles.statusDraft
                }`}>
                  <span className={styles.simulationStatusDot} style={{ 
                    display: camp.status === "running" ? "inline-block" : "none",
                    marginRight: "4px"
                  }} />
                  {camp.status}
                </span>
                <span className={styles.campaignSubtitle}>
                  {camp.deliveredCount + camp.readCount + camp.sentCount + camp.failedCount} / {camp.totalCount}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Main Workspace */}
      <div className={styles.workspace}>
        {isCreating ? (
          /* A. CAMPAIGN CREATION FORM */
          <div className={styles.contentArea}>
            <div className={styles.formHeader}>{editingCampaignId ? "Edit Campaign" : "Create Marketing Campaign"}</div>
            
            <div className={styles.formGrid}>
              <div className={styles.formMain}>
                <div className={styles.inputGroup}>
                  <label>Campaign Name</label>
                  <input 
                    type="text" 
                    placeholder="E.g., June Discount Offer"
                    value={newCampaignName}
                    onChange={(e) => setNewCampaignName(e.target.value)}
                  />
                </div>

                <div className={styles.inputGroup}>
                  <label>WhatsApp Template (from Twilio)</label>
                  {selectedTemplateId && !isCustomTemplate ? (
                    <div className={styles.selectedTemplateBadge}>
                      <div className={styles.selectedTemplateInfo}>
                        <div className={styles.selectedTemplateTitle}>
                          {twilioTemplates.find(t => t.sid === selectedTemplateId)?.friendlyName || "Template " + selectedTemplateId}
                        </div>
                        <div className={styles.selectedTemplateSidText}>
                          SID: {selectedTemplateId}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button 
                          type="button" 
                          className={styles.btnSecondary}
                          onClick={() => {
                            fetchTwilioTemplates();
                            setShowTemplateGridModal(true);
                          }}
                        >
                          Change Template
                        </button>
                        <button
                          type="button"
                          className={styles.btnSecondary}
                          onClick={() => {
                            setIsCustomTemplate(true);
                            setSelectedTemplateId("");
                          }}
                        >
                          Use Custom Template
                        </button>
                      </div>
                    </div>
                  ) : isCustomTemplate ? (
                    <div className={styles.selectedTemplateBadge}>
                      <div className={styles.selectedTemplateInfo}>
                        <div className={styles.selectedTemplateTitle}>
                          Custom Manual Template
                        </div>
                        <div className={styles.selectedTemplateSidText}>
                          Using direct SID and text override
                        </div>
                      </div>
                      <button 
                        type="button" 
                        className={styles.btnSecondary}
                        onClick={() => {
                          setIsCustomTemplate(false);
                          fetchTwilioTemplates();
                          setShowTemplateGridModal(true);
                        }}
                      >
                        Select from Twilio
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button 
                        type="button" 
                        className={styles.templateSelectBtn}
                        style={{ flex: 1 }}
                        onClick={() => {
                          fetchTwilioTemplates();
                          setShowTemplateGridModal(true);
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                          <line x1="9" y1="3" x2="9" y2="21"/>
                        </svg>
                        Select Template from Twilio
                      </button>
                      <button 
                        type="button" 
                        className={styles.templateSelectBtn}
                        onClick={() => {
                          setIsCustomTemplate(true);
                        }}
                      >
                        Manual Custom Template
                      </button>
                    </div>
                  )}
                </div>

                {isCustomTemplate && (
                  <>
                    <div className={styles.inputGroup}>
                      <label>Custom Template SID</label>
                      <input 
                        type="text" 
                        placeholder="E.g., HX..." 
                        value={customTemplateSid}
                        onChange={(e) => setCustomTemplateSid(e.target.value)}
                      />
                    </div>
                    <div className={styles.inputGroup}>
                      <label>Custom Template Text</label>
                      <textarea 
                        placeholder="Hello {{1}}, your order {{2}} is on its way." 
                        value={customTemplateText}
                        onChange={(e) => setCustomTemplateText(e.target.value)}
                      />
                      <div className={styles.variablesHelper}>
                        Use <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code> as variables. The UI will automatically detect them.
                      </div>
                    </div>
                  </>
                )}

                {/* Variable Mapping fields */}
                {templateVariables.length > 0 && (
                  <div className={styles.variableMappingCard}>
                    <h4>Template Variables Mapping</h4>
                    {templateVariables.map((v) => {
                      const mapping = variableMappings[v] || { type: "default", value: "", fallback: "" };
                      return (
                        <div key={v} className={styles.variableMappingRow}>
                          <span className={styles.variableLabel}>{"{{" + v + "}}"}</span>
                          <div className={styles.variableMappingControls}>
                            <select
                              className={styles.variableMapSelect}
                              value={mapping.type}
                              onChange={(e) => {
                                const type = e.target.value as "csv" | "default";
                                setVariableMappings(prev => ({
                                  ...prev,
                                  [v]: { 
                                    ...prev[v],
                                    type, 
                                    value: type === "csv" ? (prev[v]?.value || "name") : "" 
                                  }
                                }));
                              }}
                            >
                              <option value="default">Static Text Value</option>
                              <option value="csv">CSV Column Mapping</option>
                            </select>

                            {mapping.type === "default" ? (
                              <input 
                                type="text"
                                className={styles.variableMapInput}
                                placeholder={`Static value for {{${v}}}`}
                                value={mapping.value || ""}
                                onChange={(e) => {
                                  const textVal = e.target.value;
                                  setVariableMappings(prev => ({
                                    ...prev,
                                    [v]: { ...prev[v], type: "default", value: textVal }
                                  }));
                                }}
                              />
                            ) : (
                              <div className={styles.csvMappingFields}>
                                {csvHeaders.length > 0 ? (
                                  <select
                                    className={styles.variableMapSelect}
                                    style={{ flex: 1, width: 'auto' }}
                                    value={mapping.value}
                                    onChange={(e) => {
                                      const colVal = e.target.value;
                                      setVariableMappings(prev => ({
                                        ...prev,
                                        [v]: { ...prev[v], type: "csv", value: colVal }
                                      }));
                                    }}
                                  >
                                    <option value="">-- Select Column --</option>
                                    {csvHeaders.map(h => (
                                      <option key={h} value={h}>{h}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <input 
                                    type="text"
                                    className={styles.variableMapInput}
                                    placeholder="CSV Column Name (e.g. name)"
                                    value={mapping.value || ""}
                                    onChange={(e) => {
                                      const colName = e.target.value;
                                      setVariableMappings(prev => ({
                                        ...prev,
                                        [v]: { ...prev[v], type: "csv", value: colName }
                                      }));
                                    }}
                                  />
                                )}
                                <input 
                                  type="text"
                                  className={styles.variableMapInput}
                                  placeholder="Fallback value if blank (e.g. Miller)"
                                  value={mapping.fallback || ""}
                                  onChange={(e) => {
                                    const fallbackVal = e.target.value;
                                    setVariableMappings(prev => ({
                                      ...prev,
                                      [v]: { ...prev[v], fallback: fallbackVal }
                                    }));
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className={styles.inputGroup}>
                  <label>Recipient Numbers Source</label>
                  <div style={{ display: "flex", gap: "12px", marginTop: '4px' }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", color: '#f8fafc', fontSize: '13px' }}>
                      <input 
                        type="radio" 
                        name="rec_src" 
                        checked={recipientSource === "manual"} 
                        onChange={() => setRecipientSource("manual")} 
                      />
                      Enter Numbers Manually
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", color: '#f8fafc', fontSize: '13px' }}>
                      <input 
                        type="radio" 
                        name="rec_src" 
                        checked={recipientSource === "csv"} 
                        onChange={() => setRecipientSource("csv")} 
                      />
                      Upload CSV File
                    </label>
                  </div>
                </div>

                {recipientSource === "manual" ? (
                  <div className={styles.inputGroup}>
                    <label>Mobile Numbers</label>
                    <textarea 
                      placeholder="Enter mobile numbers (one number per line)&#10;E.g., +919876543210&#10;+918888888888" 
                      value={manualNumbers}
                      onChange={(e) => setManualNumbers(e.target.value)}
                    />
                  </div>
                ) : (
                  <div className={styles.inputGroup}>
                    <label>CSV File Uploader</label>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <input 
                        type="file" 
                        accept=".csv" 
                        ref={fileInputRef} 
                        onChange={handleCsvUpload} 
                        style={{ display: "none" }}
                      />
                      <button 
                        className={styles.btnSecondary} 
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Choose CSV File
                      </button>
                      <span className={styles.campaignSubtitle}>
                        {csvRows.length > 0 ? `Loaded ${csvRows.length} rows` : "No file chosen"}
                      </span>
                    </div>

                    <div className={styles.csvFormatBox}>
                      <div className={styles.csvFormatHeader}>
                        <span>Sample CSV Format</span>
                        <button 
                          type="button" 
                          className={styles.copyFormatBtn}
                          onClick={() => {
                            navigator.clipboard.writeText("mobile,name\n+919876543210,John Doe\n+918888888888,Jane Smith");
                            alert("Sample CSV format copied to clipboard!");
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                          </svg>
                          Copy Format
                        </button>
                      </div>
                      <pre className={styles.csvFormatPre}>
{`mobile,name
+919876543210,John Doe
+918888888888,Jane Smith`}
                      </pre>
                    </div>

                    {csvHeaders.length > 0 && (
                      <div className={styles.variableMappingCard} style={{ marginTop: '12px' }}>
                        <h4>CSV Column Mappings</h4>
                        <div className={styles.inputGroup}>
                          <label>Phone Number Column</label>
                          <select 
                            value={selectedPhoneColumn} 
                            onChange={(e) => setSelectedPhoneColumn(e.target.value)}
                          >
                            {csvHeaders.map(h => (
                              <option key={h} value={h}>{h}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Form Sidebar Configuration */}
              <div className={styles.formSidebar}>
                {/* Live Template Preview */}
                {templateText && (
                  <div className={styles.previewCard}>
                    <h4>Message Preview</h4>
                    <div className={styles.chatContainer}>
                      <div className={styles.chatBubble}>
                        {previewText}
                        <span className={styles.bubbleTime}>
                          {new Date().toLocaleTimeString("en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: true,
                          })}
                          <span className={styles.doubleTick}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 5L9.5 12.5L6 9" />
                              <path d="M22 5L14.5 12.5" />
                            </svg>
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div className={styles.inputGroup}>
                  <label>Sending Throttling Delay</label>
                  <select 
                    value={delaySeconds} 
                    onChange={(e) => setDelaySeconds(parseInt(e.target.value))}
                  >
                    <option value="1">1 Second Delay</option>
                    <option value="2">2 Seconds Delay</option>
                    <option value="3">3 Seconds Delay</option>
                    <option value="5">5 Seconds Delay</option>
                    <option value="10">10 Seconds Delay</option>
                  </select>
                  <div className={styles.variablesHelper}>
                    Add a delay between messages to mitigate spam detection.
                  </div>
                </div>

                <div className={styles.variableMappingCard}>
                  <h4>Spam Protection Limits</h4>
                  <div className={styles.inputGroup}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#cbd5e1' }}>
                      <input 
                        type="checkbox" 
                        checked={stopOnSpam} 
                        onChange={(e) => setStopOnSpam(e.target.checked)}
                      />
                      Auto-Pause Campaign
                    </label>
                  </div>
                  {stopOnSpam && (
                    <>
                      <div className={styles.inputGroup}>
                        <label>Max Failure Rate (%)</label>
                        <input 
                          type="number" 
                          value={failureThreshold} 
                          onChange={(e) => setFailureThreshold(parseInt(e.target.value))}
                          min="1" 
                          max="100" 
                        />
                      </div>
                      <div className={styles.inputGroup}>
                        <label>Consecutive Failures Limit</label>
                        <input 
                          type="number" 
                          value={consecutiveFailureThreshold} 
                          onChange={(e) => setConsecutiveFailureThreshold(parseInt(e.target.value))}
                          min="1" 
                        />
                      </div>
                    </>
                  )}
                </div>

                <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button 
                    className={styles.btnPrimary}
                    onClick={handleCreateCampaign}
                  >
                    {editingCampaignId ? "Save Campaign" : "Save & Create Campaign"}
                  </button>
                  <button 
                    className={styles.btnSecondary}
                    onClick={() => handleOpenTestModal()}
                  >
                    Send Test Message...
                  </button>
                  <button 
                    className={styles.btnSecondary}
                    style={{ borderColor: '#ef4444', color: '#f87171' }}
                    onClick={() => setIsCreating(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : activeCampaign ? (
          /* B. CAMPAIGN DETAILS & LOGS VIEW */
          <>
            <div className={styles.topBar}>
              <div className={styles.campaignDetails}>
                <h3 className={styles.campaignTitle}>{activeCampaign.name}</h3>
                <span className={styles.campaignSubtitle}>
                  Template: <strong>{activeCampaign.templateName}</strong> (SID: <code>{activeCampaign.templateSid}</code>)
                </span>
              </div>
              
              <div className={styles.topBarActions}>
                {/* Background Worker Heartbeat Status */}
                <div 
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: 600,
                    backgroundColor: workerActive ? '#10b98115' : '#ef444415',
                    color: workerActive ? '#10b981' : '#ef4444',
                    border: `1px solid ${workerActive ? '#10b98130' : '#ef444430'}`
                  }}
                  title={workerActive ? "Background processing service is online and active." : "Background processing service is offline. Run 'npm run campaign-worker' to start it."}
                >
                  <span style={{ 
                    width: '8px', 
                    height: '8px', 
                    borderRadius: '50%', 
                    backgroundColor: workerActive ? '#10b981' : '#ef4444',
                    display: 'inline-block'
                  }} />
                  {workerActive ? "Worker Active" : "Worker Offline"}
                </div>

                {/* Simulation Mode Selector */}
                <div 
                  className={styles.simulationToggle}
                  onClick={async () => {
                    const newMode = !simulationMode;
                    setSimulationMode(newMode);
                    if (activeCampaign) {
                      await updateDoc(doc(db, "campaigns", activeCampaign.id), {
                        isSimulated: newMode
                      });
                    }
                  }}
                  title="When active, runs high-fidelity message processing and webhook statuses simulation."
                  style={{ cursor: 'pointer' }}
                >
                  <span className={simulationMode ? styles.simulationStatusDot : ""} style={{ backgroundColor: simulationMode ? '#34d399' : '#94a3b8' }} />
                  {simulationMode ? "Simulation Mode" : "Real Twilio mode"}
                </div>

                {activeCampaign.status === "draft" || activeCampaign.status === "paused" ? (
                  <button 
                    className={styles.btnPrimary}
                    onClick={handleStartCampaign}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '6px', verticalAlign: 'middle' }}>
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                    Resume/Run
                  </button>
                ) : activeCampaign.status === "running" ? (
                  <button 
                    className={styles.btnSecondary}
                    style={{ backgroundColor: '#fbbf2420', borderColor: '#f59e0b', color: '#fbbf24' }}
                    onClick={handlePauseCampaign}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '6px', verticalAlign: 'middle' }}>
                      <rect x="6" y="4" width="4" height="16"></rect>
                      <rect x="14" y="4" width="4" height="16"></rect>
                    </svg>
                    Pause Campaign
                  </button>
                ) : null}

                <button 
                  className={styles.btnSecondary}
                  onClick={() => handleOpenTestModal()}
                >
                  Send Test...
                </button>

                {activeCampaign.status !== "running" && (
                  <button 
                    className={styles.btnSecondary}
                    onClick={handleEditCampaign}
                  >
                    Edit
                  </button>
                )}

                <button 
                  className={styles.btnDanger}
                  onClick={handleDeleteCampaign}
                >
                  Delete
                </button>
              </div>
            </div>

            <div className={styles.contentArea}>
              {/* Progress bar */}
              <div className={styles.progressCard}>
                <div className={styles.progressInfo}>
                  <span className={styles.progressText}>Campaign Progress: {activeCampaign.sentCount + activeCampaign.deliveredCount + activeCampaign.readCount + activeCampaign.failedCount} / {activeCampaign.totalCount} messages</span>
                  <span className={styles.percentText}>{progressPercent}%</span>
                </div>
                <div className={styles.progressBarBg}>
                  <div className={styles.progressBarFill} style={{ width: `${progressPercent}%` }} />
                </div>
              </div>

              {/* Spam Threshold Warnings */}
              {activeCampaign.status === "paused" && (
                <div className={styles.warningCard}>
                  <svg className={styles.warningIcon} xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                  <div>
                    <strong>Campaign Paused</strong>: Review your numbers, template approval, or test variables. Throttling and consecutive failure protections are active to safeguard your WhatsApp phone number reputation from spam algorithms.
                  </div>
                </div>
              )}

              {/* Analytics Cards Grid */}
              <div className={styles.analyticsGrid}>
                <div className={styles.analyticsCard}>
                  <div className={`${styles.analyticsIcon} ${styles.bgTotal}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                      <circle cx="9" cy="7" r="4"></circle>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                  </div>
                  <div className={styles.analyticsMeta}>
                    <span className={styles.analyticsLabel}>Total Recipients</span>
                    <span className={styles.analyticsValue}>{activeCampaign.totalCount}</span>
                  </div>
                </div>

                <div className={styles.analyticsCard}>
                  <div className={`${styles.analyticsIcon} ${styles.bgDelivered}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                  <div className={styles.analyticsMeta}>
                    <span className={styles.analyticsLabel}>Delivered</span>
                    <span className={styles.analyticsValue}>{activeCampaign.deliveredCount}</span>
                  </div>
                </div>

                <div className={styles.analyticsCard}>
                  <div className={`${styles.analyticsIcon} ${styles.bgRead}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  </div>
                  <div className={styles.analyticsMeta}>
                    <span className={styles.analyticsLabel}>Read Messages</span>
                    <span className={styles.analyticsValue}>{activeCampaign.readCount}</span>
                  </div>
                </div>

                <div className={styles.analyticsCard}>
                  <div className={`${styles.analyticsIcon} ${styles.bgFailed}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="15" y1="9" x2="9" y2="15"></line>
                      <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                  </div>
                  <div className={styles.analyticsMeta}>
                    <span className={styles.analyticsLabel}>Failed</span>
                    <span className={styles.analyticsValue}>{activeCampaign.failedCount}</span>
                  </div>
                </div>
              </div>

              {/* Logs Section Table */}
              <div className={styles.logsSection}>
                <div className={styles.logsHeader}>
                  <h4 className={styles.logsTitle}>Recipient Outbox History</h4>
                  
                  <div className={styles.filterTabs}>
                    {[
                      { id: "all", label: `All (${recipients.length})` },
                      { id: "pending", label: `Pending (${recipients.filter(r => r.status === 'pending' || r.status === 'sending').length})` },
                      { id: "sent", label: `Sent (${recipients.filter(r => r.status === 'sent').length})` },
                      { id: "delivered", label: `Delivered (${recipients.filter(r => r.status === 'delivered').length})` },
                      { id: "read", label: `Read (${recipients.filter(r => r.status === 'read').length})` },
                      { id: "failed", label: `Failed (${recipients.filter(r => r.status === 'failed').length})` }
                    ].map(tab => (
                      <button 
                        key={tab.id}
                        className={`${styles.filterTabButton} ${filterStatus === tab.id ? styles.filterTabButtonActive : ""}`}
                        onClick={() => setFilterStatus(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.tableWrapper}>
                  <table className={styles.recipientTable}>
                    <thead>
                      <tr>
                        <th>Phone Number</th>
                        <th>Variables Mapped</th>
                        <th>Status</th>
                        <th>Sent Time</th>
                        <th>Delivery Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRecipients.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>
                            No recipient logs match the selected status filter.
                          </td>
                        </tr>
                      ) : (
                        filteredRecipients.map((rec) => (
                          <tr key={rec.phone}>
                            <td style={{ fontWeight: '600' }}>{rec.phone}</td>
                            <td>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {Object.entries(rec.variables || {}).map(([key, val]) => (
                                  <span key={key} style={{ fontSize: '11px', backgroundColor: '#33415550', padding: '2px 6px', borderRadius: '4px', border: '1px solid #334155' }}>
                                    <strong style={{ color: '#00a884' }}>{"{{" + key + "}}"}:</strong> {val}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td>
                              <span className={`${styles.statusIndicator} ${
                                rec.status === "read" ? styles.statusCompleted :
                                rec.status === "delivered" ? styles.statusCompleted :
                                rec.status === "failed" ? styles.statusDraft : // Red text mapping
                                rec.status === "sending" ? styles.statusRunning :
                                rec.status === "sent" ? styles.statusPaused : // Light blue text mapping
                                styles.statusDraft
                              }`} style={{
                                backgroundColor: 
                                  rec.status === "failed" ? 'rgba(239, 68, 68, 0.15)' : 
                                  rec.status === "sent" ? 'rgba(59, 130, 246, 0.15)' : undefined,
                                color: 
                                  rec.status === "failed" ? '#ef4444' : 
                                  rec.status === "sent" ? '#3b82f6' : undefined
                              }}>
                                {rec.status}
                              </span>
                            </td>
                            <td>{rec.sentAt || "—"}</td>
                            <td>
                              {rec.status === "failed" ? (
                                <span style={{ color: '#ef4444', fontSize: '12px' }}>
                                  Failed {rec.errorCode ? `(${rec.errorCode})` : ""}: {rec.errorMessage || "Unknown error"}
                                </span>
                              ) : rec.status === "read" ? (
                                <span style={{ color: '#a78bfa', fontSize: '12px' }}>
                                  Read at {rec.readAt || rec.deliveredAt}
                                </span>
                              ) : rec.status === "delivered" ? (
                                <span style={{ color: '#34d399', fontSize: '12px' }}>
                                  Delivered at {rec.deliveredAt}
                                </span>
                              ) : rec.twilioSid ? (
                                <span style={{ color: '#94a3b8', fontSize: '11px', fontFamily: 'monospace' }}>
                                  SID: {rec.twilioSid.slice(0, 10)}...
                                </span>
                              ) : "—"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* C. EMPTY STATE */
          <div className={styles.emptyWorkspace}>
            <svg className={styles.emptyWorkspaceIcon} xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
            <h2>Campaign Manager</h2>
            <p>Select an existing WhatsApp campaign from the sidebar or click "Create Campaign" to compile list variables and send marketing messages to your CRM clients.</p>
          </div>
        )}
      </div>

      {/* 3. TEST MESSAGE DIALOG POPUP */}
      {showTestModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h3>Send Test Message</h3>
              <button className={styles.closeButton} onClick={() => setShowTestModal(false)}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            
            <div className={styles.modalBody}>
              <div className={styles.inputGroup}>
                <label>Test Recipient Phone</label>
                <input 
                  type="text" 
                  placeholder="E.g., +919876543210"
                  value={testNumber}
                  onChange={(e) => setTestNumber(e.target.value)}
                />
              </div>

              {testLog && (
                <div className={styles.inputGroup}>
                  <label>Test Execution Log</label>
                  <pre className={styles.testResultLog}>{testLog}</pre>
                </div>
              )}
            </div>

            <div className={styles.modalFooter}>
              <button className={styles.btnSecondary} onClick={() => setShowTestModal(false)}>Close</button>
              <button 
                className={styles.btnPrimary} 
                onClick={handleSendTestMessage}
                disabled={isSendingTest}
              >
                {isSendingTest ? "Sending..." : "Send Test Message"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. TWILIO TEMPLATE SELECTOR GRID MODAL */}
      {showTemplateGridModal && (
        <div className={styles.modalOverlay}>
          <div className={`${styles.modal} ${styles.templateGridModal}`}>
            <div className={styles.modalHeader}>
              <h3>Select Twilio WhatsApp Template</h3>
              <button className={styles.closeButton} onClick={() => setShowTemplateGridModal(false)}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            
            <div className={styles.modalBody}>
              <input 
                type="text"
                placeholder="Search templates by SID, name or content..."
                className={styles.templatesSearch}
                value={templatesSearchQuery}
                onChange={(e) => setTemplatesSearchQuery(e.target.value)}
              />

              <div className={styles.templateFilterTabs}>
                <button
                  type="button"
                  className={`${styles.templateFilterTab} ${activeTemplateTab === "approved" ? styles.templateFilterTabActive : ""}`}
                  onClick={() => setActiveTemplateTab("approved")}
                >
                  Approved ({twilioTemplates.filter(t => (t.status || "approved") === "approved").length})
                </button>
                <button
                  type="button"
                  className={`${styles.templateFilterTab} ${activeTemplateTab === "pending" ? styles.templateFilterTabActive : ""}`}
                  onClick={() => setActiveTemplateTab("pending")}
                >
                  Under Review ({twilioTemplates.filter(t => (t.status || "approved") !== "approved").length})
                </button>
              </div>

              {isLoadingTemplates ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px', gap: '8px', alignItems: 'center' }}>
                  <div className={styles.spinner}></div>
                  <span>Loading templates from Twilio...</span>
                </div>
              ) : (
                <div className={styles.templatesGrid}>
                  {filteredTemplates.map((t) => {
                    const regex = /\{\{\s*([a-zA-Z0-9_\-\s]+)\s*\}\}/g;
                    const matches: string[] = [];
                    let match;
                    while ((match = regex.exec(t.body || "")) !== null) {
                      const varName = match[1].trim();
                      if (!matches.includes(varName)) {
                        matches.push(varName);
                      }
                    }
                    const varCount = matches.length;

                    return (
                      <button 
                        key={t.sid}
                        type="button"
                        className={`${styles.templateGridItem} ${selectedTemplateId === t.sid ? styles.templateGridItemActive : ""}`}
                        onClick={() => {
                          setSelectedTemplateId(t.sid);
                          setIsCustomTemplate(false);
                          setShowTemplateGridModal(false);
                        }}
                      >
                        <div className={styles.templateGridItemHeader}>
                          <span className={styles.templateGridItemName}>{t.friendlyName}</span>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <span className={`${styles.templateStatusBadge} ${t.status === "pending" ? styles.templateStatusPending : styles.templateStatusApproved}`}>
                              {t.status === "pending" ? "Under Review" : "Approved"}
                            </span>
                            <span className={styles.statusIndicator} style={{ backgroundColor: '#1e293b', color: '#cbd5e1' }}>
                              {t.language}
                            </span>
                          </div>
                        </div>
                        <div className={styles.templateGridItemSid}>{t.sid}</div>
                        <div className={styles.templateGridItemBody}>{t.body}</div>
                        <div className={styles.templateGridItemVarsCount}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <line x1="9" y1="3" x2="9" y2="21"/>
                          </svg>
                          <span>{varCount} variable{varCount !== 1 ? 's' : ''}</span>
                        </div>
                      </button>
                    );
                  })}
                  {filteredTemplates.length === 0 && (
                    <div style={{ gridColumn: 'span 2', textAlign: 'center', padding: '40px', color: '#64748b' }}>
                      No templates found matching your search.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={styles.modalFooter}>
              <button 
                type="button"
                className={styles.btnSecondary} 
                onClick={() => {
                  fetchTwilioTemplates();
                }}
                disabled={isLoadingTemplates}
              >
                Refresh
              </button>
              <button className={styles.btnSecondary} onClick={() => setShowTemplateGridModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
