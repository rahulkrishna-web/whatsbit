"use client";

import { useState, useRef, useEffect } from "react";
import styles from "./page.module.css";

type Message = {
  id: string;
  text: string;
  isSent: boolean;
  time: string;
  status: "sent" | "delivered" | "read";
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

export default function ChatApp() {
  const [contacts, setContacts] = useState<Contact[]>(INITIAL_CONTACTS);
  const [activeChatId, setActiveChatId] = useState<string>("918839780947");
  const [allMessages, setAllMessages] = useState<Record<string, Message[]>>(INITIAL_MESSAGES);
  const [inputText, setInputText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);

  // Users for assignment
  const [users, setUsers] = useState<any[]>([
    { id: "anirrudh_sharma", name: "Anirrudh Sharma", avatar: "AS", color: "#10b981" },
    { id: "pooja_lodhi", name: "Pooja Lodhi", avatar: "PL", color: "#3b82f6" }
  ]);
  const [showAssignPopup, setShowAssignPopup] = useState(false);

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

  // Load state from localStorage on mount
  useEffect(() => {
    const savedContacts = localStorage.getItem("whatsbit_contacts");
    const savedMessages = localStorage.getItem("whatsbit_messages");
    const savedActiveChat = localStorage.getItem("whatsbit_active_chat");
    if (savedContacts) {
      try {
        setContacts(JSON.parse(savedContacts));
      } catch (e) {
        console.error("Failed to parse contacts from localStorage", e);
      }
    }
    if (savedMessages) {
      try {
        setAllMessages(JSON.parse(savedMessages));
      } catch (e) {
        console.error("Failed to parse messages from localStorage", e);
      }
    }
    if (savedActiveChat) {
      setActiveChatId(savedActiveChat);
    }
    setIsLoaded(true);
  }, []);

  // Save to localStorage on changes after load
  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem("whatsbit_contacts", JSON.stringify(contacts));
  }, [contacts, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem("whatsbit_messages", JSON.stringify(allMessages));
  }, [allMessages, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem("whatsbit_active_chat", activeChatId);
  }, [activeChatId, isLoaded]);
  // Fetch live contacts and users from Bitrix24 if available
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

                setContacts(fetchedContacts);
                // Auto-switch to the first contact if the active ID is still the initial mock ID
                if (fetchedContacts.length > 0 && activeChatId === "918839780947") {
                  setActiveChatId(fetchedContacts[0].id);
                }
              }
            }
          );

          // Fetch active users/managers list
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

  const handleReassign = (newUserId: string) => {
    const assignedUser = users.find(u => u.id === newUserId);
    const userName = assignedUser ? assignedUser.name : "Not chosen";
    
    // Update contact's responsible ID
    setContacts(prev => prev.map(c => 
      c.id === activeChatId ? { ...c, responsibleId: newUserId } : c
    ));

    // Add system notification to messages list
    const systemMessage: Message = {
      id: `system-${Date.now()}`,
      text: `Set responsible: 👤 ${userName}`,
      isSent: false,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: "read",
    };

    setAllMessages(prev => {
      const chatMsgs = prev[activeChatId] || [];
      return {
        ...prev,
        [activeChatId]: [...chatMsgs, systemMessage]
      };
    });

    setShowAssignPopup(false);
  };

  const handleSend = () => {
    if (!inputText.trim()) return;

    const messageText = inputText;
    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newMessage: Message = {
      id: Date.now().toString(),
      text: messageText,
      isSent: true,
      time: timeString,
      status: "sent",
    };

    setAllMessages((prev) => {
      const chatMsgs = prev[activeChatId] || [];
      return {
        ...prev,
        [activeChatId]: [...chatMsgs, newMessage],
      };
    });

    setContacts((prevContacts) =>
      prevContacts.map((c) =>
        c.id === activeChatId
          ? { ...c, preview: messageText, time: timeString }
          : c
      )
    );

    setInputText("");

    // Simulate reply after 2 seconds
    const targetChatId = activeChatId;
    setTimeout(() => {
      const replyTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const replyMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: "Thank you for reaching out! We've received your message and will get back to you shortly.",
        isSent: false,
        time: replyTime,
        status: "read",
      };

      setAllMessages((prev) => {
        const chatMsgs = prev[targetChatId] || [];
        return {
          ...prev,
          [targetChatId]: [...chatMsgs, replyMessage],
        };
      });

      setContacts((prevContacts) =>
        prevContacts.map((c) =>
          c.id === targetChatId
            ? { ...c, preview: replyMessage.text, time: replyTime }
            : c
        )
      );
    }, 2000);
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
            <select className={styles.statusSelect} defaultValue="unsorted">
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
                  {msg.text}
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
