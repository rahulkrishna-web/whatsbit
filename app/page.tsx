"use client";

import { useState, useRef, useEffect } from "react";
import styles from "./page.module.css";
import { db } from "../lib/firebase";
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  doc, 
  setDoc, 
  addDoc, 
  updateDoc, 
  serverTimestamp 
} from "firebase/firestore";

type Message = {
  id: string;
  text: string;
  isSent: boolean;
  time: string;
  status: "sent" | "delivered" | "read";
  mediaUrl?: string;
};

type Contact = {
  id: string;
  name: string;
  avatar: string;
  time: string;
  preview: string;
  statusText: string;
  responsibleId?: string;
  unreadCount?: number;
  statusSelect?: string;
};

const INITIAL_CONTACTS: Contact[] = [
  {
    id: "918839780947",
    name: "918839780947",
    avatar: "👤",
    time: "03/13/2026",
    preview: "Please tell us how we did. Just send 1 if you are satisfied...",
    statusText: "WhatsApp • Online",
    responsibleId: "anirrudh_sharma",
  },
  {
    id: "anirrudh_sharma",
    name: "Anirrudh Sharma",
    avatar: "RS",
    time: "11:53 AM",
    preview: "Project offer 1...nt.pdf",
    statusText: "WhatsApp • Offline",
    responsibleId: "pooja_lodhi",
  },
];

const INITIAL_MESSAGES: Record<string, Message[]> = {
  "918839780947": [
    { id: "1", text: "Please tell us how we did. Just send 1 if you are satisfied...", isSent: false, time: "11:53 AM", status: "read" },
    { id: "2", text: "Scaling Your Flour Mill - Webinar Registration", isSent: false, time: "11:53 AM", status: "read" },
  ],
  "anirrudh_sharma": [
    { id: "a1", text: "Hello, regarding the project proposal", isSent: false, time: "10:30 AM", status: "read" },
    { id: "a2", text: "Project offer 1...nt.pdf", isSent: false, time: "11:53 AM", status: "read" },
  ],
};

const PREDEFINED_TEMPLATES = [
  {
    id: "welcome_choyal",
    name: "RS Choyal Welcome",
    text: "Hello, Thank you for connecting with RS Choyal Group. Please let us know how we can assist you today?",
    templateSid: "HX68dfb84bba8143c6d42fb9d2fb3a9af6",
  }
];

export default function ChatApp() {
  const [contacts, setContacts] = useState<Contact[]>(INITIAL_CONTACTS);
  const [activeChatId, setActiveChatId] = useState<string>("918839780947");
  const [allMessages, setAllMessages] = useState<Record<string, Message[]>>(INITIAL_MESSAGES);
  const [inputText, setInputText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Users for assignment
  const [users, setUsers] = useState<any[]>([
    { id: "anirrudh_sharma", name: "Anirrudh Sharma", avatar: "AS", color: "#10b981" },
    { id: "pooja_lodhi", name: "Pooja Lodhi", avatar: "PL", color: "#3b82f6" }
  ]);
  const [showAssignPopup, setShowAssignPopup] = useState(false);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Initialize Bitrix24 SDK dynamically if inside iframe
  useEffect(() => {
    if (typeof window !== "undefined" && window.self !== window.top) {
      const script = document.createElement("script");
      script.src = "https://api.bitrix24.com/api/v1/";
      script.async = true;
      script.onload = () => {
        const w = window as any;
        if (w.BX24) {
          try {
            w.BX24.init(() => {
              w.BX24.fitWindow();
            });
          } catch (e) {
            console.error("Failed to initialize Bitrix24 client SDK", e);
          }
        }
      };
      document.head.appendChild(script);
    }
  }, []);

  // 1. Real-time Firestore listener for contacts list
  useEffect(() => {
    const q = query(collection(db, "contacts"), orderBy("lastUpdated", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: Contact[] = [];
      snapshot.forEach((doc) => {
        fetched.push({ id: doc.id, ...doc.data() } as Contact);
      });
      
      if (fetched.length > 0) {
        setContacts(fetched);
      } else {
        // Seed initial mock contacts if Firestore is completely empty
        INITIAL_CONTACTS.forEach(async (c) => {
          await setDoc(doc(db, "contacts", c.id), {
            ...c,
            lastUpdated: serverTimestamp(),
          });
        });
      }
    });

    return () => unsubscribe();
  }, []);

  // 2. Real-time Firestore listener for active chat messages
  useEffect(() => {
    if (!activeChatId) return;

    const messagesRef = collection(db, "contacts", activeChatId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs: Message[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        msgs.push({
          id: doc.id,
          text: data.text || "",
          isSent: !!data.isSent,
          time: data.time || "",
          status: data.status || "sent",
          mediaUrl: data.mediaUrl || "",
        });
      });

      // If no messages exist in Firestore for this contact, seed initial messages
      if (msgs.length === 0) {
        const initialMsgs = INITIAL_MESSAGES[activeChatId] || [
          {
            text: "Hello! How can we assist you today?",
            isSent: false,
            time: "12:00 PM",
            status: "read"
          }
        ];
        initialMsgs.forEach(async (m, index) => {
          await addDoc(collection(db, "contacts", activeChatId, "messages"), {
            text: m.text,
            isSent: m.isSent,
            time: m.time,
            status: m.status,
            twilioSid: `mock-seed-${index}-${Date.now()}`,
            timestamp: serverTimestamp(),
          });
        });
      } else {
        setAllMessages((prev) => ({
          ...prev,
          [activeChatId]: msgs,
        }));
      }
    });

    return () => unsubscribe();
  }, [activeChatId]);

  // Load last active chat from localStorage on mount
  useEffect(() => {
    const savedActiveChat = localStorage.getItem("whatsbit_active_chat");
    if (savedActiveChat) {
      setActiveChatId(savedActiveChat);
    }
  }, []);

  // Save active chat to localStorage
  useEffect(() => {
    localStorage.setItem("whatsbit_active_chat", activeChatId);
  }, [activeChatId]);

  // Fetch live contacts and users from Bitrix24 and sync to Firestore
  useEffect(() => {
    const fetchBitrixContacts = () => {
      const w = window as any;
      if (w.BX24) {
        w.BX24.init(() => {
          // Fetch CRM contacts
          w.BX24.callMethod(
            "crm.contact.list",
            {
              order: { "DATE_CREATE": "DESC" },
              select: ["ID", "NAME", "LAST_NAME", "PHONE"]
            },
            (result: any) => {
              if (result.error()) {
                console.error("Error fetching Bitrix24 contacts:", result.error());
                return;
              }

              const data = result.data();
              if (Array.isArray(data) && data.length > 0) {
                const fetchedContacts: Contact[] = data.map((item: any) => {
                  const firstName = item.NAME || "";
                  const lastName = item.LAST_NAME || "";
                  const fullName = `${firstName} ${lastName}`.trim() || `Contact #${item.ID}`;
                  
                  // Extract first phone number
                  let phone = "";
                  if (Array.isArray(item.PHONE) && item.PHONE.length > 0) {
                    phone = item.PHONE[0].VALUE || "";
                  }
                  
                  // Initials for avatar
                  const initials = fullName
                    .split(" ")
                    .map((n: string) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2) || "👤";

                  return {
                    id: phone || item.ID, // Fallback to ID if no phone
                    name: fullName,
                    avatar: initials.match(/[a-zA-Z]/) ? initials : "👤",
                    time: "Today",
                    preview: phone ? `Phone: ${phone}` : "No phone number available",
                    statusText: "WhatsApp • Offline",
                    responsibleId: "anirrudh_sharma", // default
                  };
                });

                // Sync fetched Bitrix24 contacts to Firestore
                fetchedContacts.forEach(async (c) => {
                  const contactRef = doc(db, "contacts", c.id);
                  await setDoc(contactRef, {
                    id: c.id,
                    name: c.name,
                    avatar: c.avatar,
                    preview: c.preview,
                    statusText: c.statusText,
                    responsibleId: c.responsibleId || "anirrudh_sharma",
                    lastUpdated: serverTimestamp(),
                  }, { merge: true });
                });

                // Auto-switch to first contact on initial view
                if (fetchedContacts.length > 0 && activeChatId === "918839780947") {
                  setActiveChatId(fetchedContacts[0].id);
                }
              }
            }
          );

          // Fetch active users/managers list from Bitrix24
          w.BX24.callMethod(
            "user.get",
            { ACTIVE: "Y" },
            (userResult: any) => {
              if (!userResult.error()) {
                const userData = userResult.data();
                if (Array.isArray(userData) && userData.length > 0) {
                  const colors = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];
                  const fetchedUsers = userData.map((u: any, index: number) => {
                    const initials = `${u.NAME || ""}${u.LAST_NAME || ""}`
                      .split("")
                      .filter((char, idx, arr) => idx === 0 || arr[idx - 1] === " ")
                      .join("")
                      .toUpperCase()
                      .slice(0, 2) || "U";
                    return {
                      id: u.ID,
                      name: `${u.NAME || ""} ${u.LAST_NAME || ""}`.trim(),
                      avatar: initials,
                      color: colors[index % colors.length]
                    };
                  });
                  setUsers(fetchedUsers);
                }
              }
            }
          );
        });
      }
    };

    const timer = setInterval(() => {
      const w = window as any;
      if (w.BX24) {
        clearInterval(timer);
        fetchBitrixContacts();
      }
    }, 500);

    return () => clearInterval(timer);
  }, [activeChatId]);

  const activeContact = contacts.find((c) => c.id === activeChatId) || contacts[0] || INITIAL_CONTACTS[0];
  const messages = allMessages[activeChatId] || (activeContact ? [
    {
      id: "welcome-msg",
      text: `Hello ${activeContact.name}! How can we help you today?`,
      isSent: false,
      time: activeContact.time || "12:00 PM",
      status: "read"
    }
  ] : []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleStatusChange = async (newStatus: string) => {
    if (!activeChatId) return;
    const contactRef = doc(db, "contacts", activeChatId);
    let statusTextVal = "WhatsApp • Unsorted";
    if (newStatus === "in_progress") {
      statusTextVal = "WhatsApp • In Progress";
    } else if (newStatus === "completed") {
      statusTextVal = "WhatsApp • Completed";
    }

    await updateDoc(contactRef, {
      statusText: statusTextVal,
      statusSelect: newStatus,
    });
  };

  const handleReassign = async (newUserId: string) => {
    const assignedUser = users.find(u => u.id === newUserId);
    const userName = assignedUser ? assignedUser.name : "Not chosen";
    
    // Update contact's responsible ID in Firestore
    const contactRef = doc(db, "contacts", activeChatId);
    await updateDoc(contactRef, { responsibleId: newUserId });

    // Add system notification to messages list in Firestore
    const messagesRef = collection(db, "contacts", activeChatId, "messages");
    await addDoc(messagesRef, {
      text: `Set responsible: 👤 ${userName}`,
      isSent: false,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      status: "read",
      timestamp: serverTimestamp(),
      twilioSid: `system-${Date.now()}`
    });

    setShowAssignPopup(false);
  };

  const handleSendTemplate = async (template: { name: string; text: string; templateSid: string }) => {
    try {
      const response = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: activeChatId,
          text: template.text,
          useTemplate: true,
          templateSid: template.templateSid,
        }),
      });
      const result = await response.json();
      if (!result.success) {
        console.error("Failed to send template via Twilio API:", result.error);
      }
    } catch (err) {
      console.error("Error calling send template API:", err);
    }
    setShowTemplateDropdown(false);
  };

  const handleSend = async () => {
    if (!inputText.trim()) return;

    const messageText = inputText;
    setInputText(""); // Clear input early for responsive feel

    // Check if we are sending the welcome template (keyword trigger or matching text pattern)
    const isWelcomeTemplate = messageText.toLowerCase().includes("welcome") || messageText.toLowerCase().includes("choyal");

    try {
      const response = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: activeChatId,
          text: messageText,
          useTemplate: isWelcomeTemplate,
        }),
      });
      const result = await response.json();
      if (!result.success) {
        console.error("Failed to send message via Twilio API:", result.error);
      }
    } catch (err) {
      console.error("Error calling send message API:", err);
    }
  };

  const filteredContacts = contacts.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.preview.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={styles.appContainer}>
      {/* 1. CRM Sidebar */}
      <div className={styles.crmSidebar}>
        <div className={styles.crmHeader}>
          <div className={styles.crmAvatar}>N</div>
          <span>New company</span>
        </div>
        <ul className={styles.crmMenu}>
          <li className={styles.crmMenuItem}>Workday</li>
          <li className={styles.crmMenuItem}>Lunch</li>
          <li className={styles.crmMenuItem}>Settings</li>
        </ul>
        <ul className={styles.crmMenu} style={{ marginTop: '24px' }}>
          <li className={`${styles.crmMenuItem} ${styles.active}`}>
            All <span className={styles.badge}>1031</span>
          </li>
          <li className={styles.crmMenuItem}>
            Unprocessed <span className={styles.badge}>1031</span>
          </li>
          <li className={styles.crmMenuItem}>
            My <span className={styles.badge}>24</span>
          </li>
        </ul>
      </div>

      {/* 2. Chat List Pane */}
      <div className={styles.chatListPane}>
        <div className={styles.chatSearch}>
          <input
            type="text"
            placeholder="Search from URL or contacts..."
            className={styles.chatSearchInput}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className={styles.contactList}>
          {filteredContacts.map((contact) => {
            const isActive = contact.id === activeChatId;
            return (
              <div
                key={contact.id}
                className={`${styles.contactItem} ${isActive ? styles.active : ""}`}
                onClick={() => setActiveChatId(contact.id)}
              >
                <div className={styles.contactAvatar}>{contact.avatar}</div>
                <div className={styles.contactInfo}>
                  <div className={styles.contactHeader}>
                    <span className={styles.contactName}>{contact.name}</span>
                    <span className={styles.contactTime}>{contact.time}</span>
                  </div>
                  <span className={styles.contactPreview}>{contact.preview}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Active Chat Pane */}
      <div className={styles.activeChatPane}>
        <div className={styles.chatHeader}>
          <div className={styles.chatHeaderLeft}>
            <div className={styles.contactAvatar} style={{ width: 40, height: 40, backgroundColor: '#cbd5e1' }}>
              {activeContact.avatar}
            </div>
            <div className={styles.chatHeaderInfo}>
              <span className={styles.chatHeaderName}>{activeContact.name}</span>
              <span className={styles.chatHeaderStatus}>{activeContact.statusText}</span>
            </div>
          </div>

          <div className={styles.chatHeaderRight}>
            {/* Status Dropdown */}
            <select 
              className={styles.statusSelect} 
              value={activeContact.statusSelect || "unsorted"}
              onChange={(e) => handleStatusChange(e.target.value)}
            >
              <option value="unsorted">Unsorted</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>

            {/* Responsible Person Selector */}
            <div style={{ position: "relative" }}>
              <button 
                onClick={() => setShowAssignPopup(!showAssignPopup)}
                className={styles.responsibleBadgeButton}
              >
                <div 
                  className={styles.responsibleAvatar} 
                  style={{ backgroundColor: users.find(u => u.id === activeContact.responsibleId)?.color || "#10b981" }}
                >
                  {users.find(u => u.id === activeContact.responsibleId)?.avatar || "AS"}
                </div>
                <span className={styles.caret}>▼</span>
              </button>

              {showAssignPopup && (
                <div className={styles.assignPopup}>
                  <div className={styles.popupField}>
                    <label>Level</label>
                    <select className={styles.popupSelect}>
                      <option>Not chosen</option>
                      <option>High Priority</option>
                      <option>Medium Priority</option>
                      <option>Low Priority</option>
                    </select>
                  </div>
                  
                  <div className={styles.popupField}>
                    <label>Responsible</label>
                    <select 
                      value={activeContact.responsibleId || ""} 
                      onChange={(e) => handleReassign(e.target.value)}
                      className={styles.popupSelect}
                    >
                      <option value="">Not chosen</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.popupField}>
                    <label>Producer</label>
                    <select className={styles.popupSelect}>
                      <option>Not chosen</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.popupField}>
                    <label>Accomplices</label>
                    <select className={styles.popupSelect}>
                      <option>Not chosen</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.popupField}>
                    <label>Auditor</label>
                    <select className={styles.popupSelect}>
                      <option>Not chosen</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            <button style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px', color: '#64748b' }}>⋮</button>
          </div>
        </div>

        <div className={styles.messagesContainer}>
          <div style={{ textAlign: 'center', margin: '16px 0' }}>
            <span style={{ backgroundColor: '#fff', padding: '6px 12px', borderRadius: '16px', fontSize: '12px', color: '#64748b', boxShadow: '0 1px 1px rgba(0,0,0,0.05)' }}>
              Monday
            </span>
          </div>

          {messages.map((msg) => {
            const isSystem = msg.text.startsWith("Set responsible:") || msg.id.startsWith("system-");
            if (isSystem) {
              return (
                <div key={msg.id} style={{ textAlign: 'center', margin: '12px 0' }}>
                  <span style={{ backgroundColor: '#fff', padding: '6px 12px', borderRadius: '16px', fontSize: '12px', color: '#64748b', boxShadow: '0 1px 1px rgba(0,0,0,0.05)' }}>
                    {msg.text} <span style={{ fontSize: '10px', marginLeft: '6px', opacity: 0.8 }}>{msg.time}</span>
                  </span>
                </div>
              );
            }
            return (
              <div key={msg.id} className={`${styles.messageWrapper} ${msg.isSent ? styles.sent : styles.received}`}>
                <div className={styles.messageBubble}>
                  {msg.mediaUrl && (
                    <img 
                      src={msg.mediaUrl} 
                      alt="Attachment" 
                      style={{ maxWidth: "100%", maxHeight: "200px", borderRadius: "6px", display: "block", marginBottom: "8px", objectFit: "cover" }} 
                    />
                  )}
                  {msg.text && <div>{msg.text}</div>}
                  <div className={styles.messageFooter}>
                    <span className={styles.messageTime}>{msg.time}</span>
                    {msg.isSent && (
                      <span className={styles.messageStatus}>
                        {msg.status === "read" ? "✓✓" : "✓"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <div className={styles.chatInputArea}>
          <button style={{ border: 'none', background: 'none', fontSize: '20px', cursor: 'pointer' }}>📎</button>
          
          {/* Templates Trigger Button */}
          <div style={{ position: "relative" }}>
            <button 
              onClick={() => setShowTemplateDropdown(!showTemplateDropdown)} 
              style={{ 
                border: 'none', 
                background: '#cbd5e1', 
                color: '#334155',
                padding: '6px 12px',
                borderRadius: '16px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                outline: 'none'
              }}
            >
              📋 Templates <span style={{ fontSize: '8px' }}>▼</span>
            </button>

            {showTemplateDropdown && (
              <div style={{
                position: 'absolute',
                bottom: 'calc(100% + 8px)',
                left: 0,
                width: '280px',
                backgroundColor: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                boxShadow: '0 -10px 15px -3px rgba(0, 0, 0, 0.1), 0 -4px 6px -2px rgba(0, 0, 0, 0.05)',
                padding: '8px',
                zIndex: 100,
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', padding: '4px 8px', textTransform: 'uppercase', textAlign: 'left' }}>
                  Select WhatsApp Template
                </div>
                {PREDEFINED_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => handleSendTemplate(tmpl)}
                    style={{
                      border: 'none',
                      background: 'none',
                      textAlign: 'left',
                      padding: '8px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      color: '#1e293b',
                      transition: 'background-color 0.2s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    title={tmpl.text}
                  >
                    <div style={{ fontWeight: '600', marginBottom: '2px' }}>{tmpl.name}</div>
                    <div style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {tmpl.text}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <input
            type="text"
            placeholder="Type a message..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            className={styles.chatInputField}
          />
          <button onClick={handleSend} disabled={!inputText.trim()} className={styles.sendButton}>
            <svg className={styles.sendIcon} viewBox="0 0 24 24">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
