"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import styles from "./AutomationFlowBuilder.module.css";
import { db } from "../../lib/firebase";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";

interface FlowNode {
  id: string;
  type: "trigger" | "action" | "delay" | "condition";
  title: string;
  subType: string;
  config: {
    text?: string;
    mediaUrl?: string;
    mediaName?: string;
    delayDays?: number;
    buttons?: string[];
    branches?: {
      buttonLabel: string;
      nodeId: string;
    }[];
  };
  nextNodeId?: string;
}

interface Flow {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  nodes: FlowNode[];
  createdAt?: any;
  updatedAt?: any;
}

interface FlowRunStep {
  nodeId: string;
  nodeTitle: string;
  timestamp: string; // ISO string
  status: "success" | "failed" | "pending";
  description?: string;
}

interface FlowRun {
  id: string;
  flowId: string;
  recipientName: string;
  recipientPhone: string;
  status: "success" | "failed" | "running" | "paused";
  startedAt: string; // ISO string
  completedAt?: string;
  steps: FlowRunStep[];
}

// 1. WhatsApp Lead Qualification Flow Nodes
const LEAD_QUALIFICATION_NODES: FlowNode[] = [
  {
    id: "node-1",
    type: "trigger",
    title: "Bitrix Lead Created",
    subType: "lead_created",
    config: {},
    nextNodeId: "node-2",
  },
  {
    id: "node-2",
    type: "action",
    title: "Initial Lead Notification",
    subType: "send_whatsapp",
    config: {
      text: "Hi {{Client Name}},\n\nThank you for your interest in flour milling solutions! 👋\n\nRS Choyal Group is a turnkey milling solutions provider with 60+ years of experience and 275+ successful projects across the globe.\n\nWhat brings you here?",
      buttons: ["Looking to setup a new plant", "Need help with expansion", "Spares & Stones"],
      branches: [
        { buttonLabel: "Looking to setup a new plant", nodeId: "node-3a" },
        { buttonLabel: "Need help with expansion", nodeId: "node-3b" },
        { buttonLabel: "Spares & Stones", nodeId: "node-3c" },
      ],
    },
  },
  {
    id: "node-3a",
    type: "action",
    title: "Turnkey Plant Inquiry Response",
    subType: "send_whatsapp",
    config: {
      text: "Perfect! Setting up a turnkey plant is our specialty. We design and deliver complete milling solutions from 2 TPD to 2000 TPD based on your capacity needs.\n\nTo give you an accurate proposal, we need a few quick details:\n✓ What capacity are you targeting? (TPD)\n✓ What flour type? (Wheat, Pulses, Others)\n✓ What's your budget?\n\nOur technical team will prepare a customized plan for you.",
    },
    nextNodeId: "node-4a",
  },
  {
    id: "node-3b",
    type: "action",
    title: "Plant Expansion Inquiry Response",
    subType: "send_whatsapp",
    config: {
      text: "Great! Expansion is something we handle regularly. Whether you're scaling up your current capacity or adding new product lines, we have the right solutions.\n\nA few quick questions:\n✓ Current capacity?\n✓ Target expanded capacity?\n✓ Timeline for the expansion?\n✓ Product that you mill?",
    },
    nextNodeId: "node-4b",
  },
  {
    id: "node-3c",
    type: "action",
    title: "Spares & Stones Inquiry Response",
    subType: "send_whatsapp",
    config: {
      text: "Perfect! We supply high-quality grinding stones and spare parts for ongoing maintenance and optimization.\n\nQuick info needed:\n✓ Which equipment/machine? (make/model)\n✓ Grinding stones, bearings, or other spares?\n✓ How soon do you need them?",
    },
    nextNodeId: "node-4c",
  },
  {
    id: "node-4a",
    type: "action",
    title: "Send Plant Brochure",
    subType: "send_media",
    config: {
      text: "Here's our company brochure with detailed specifications.\n\nAlso check out these quick videos to see our work:\n🎥 Company Overview: https://www.youtube.com/watch?v=DlEcmcDS598\n🎥 How We Setup Plants: https://www.youtube.com/watch?v=OETierqPRFA\n🎥 Milling Plant Process (Hindi): https://www.youtube.com/watch?v=MjUnwkiwAvM",
      mediaUrl: "https://whatsbit.vercel.app/RS_Choyal_Company_Brochure.pdf",
      mediaName: "RS_Choyal_Company_Brochure.pdf",
    },
    nextNodeId: "node-5a",
  },
  {
    id: "node-4b",
    type: "action",
    title: "Send Expansion Details & Brochure",
    subType: "send_media",
    config: {
      text: "Here's our brochure and video overviews for expanding existing plants:\n🎥 Process Overview: https://www.youtube.com/watch?v=DlEcmcDS598\n🎥 Company Overview: https://www.youtube.com/watch?v=DlEcmcDS598",
      mediaUrl: "https://whatsbit.vercel.app/RS_Choyal_Company_Brochure.pdf",
      mediaName: "RS_Choyal_Company_Brochure.pdf",
    },
    nextNodeId: "node-5b",
  },
  {
    id: "node-4c",
    type: "action",
    title: "Send Spares Catalogue",
    subType: "send_media",
    config: {
      text: "Please find attached our stones & spares components specifications document for Choyal mills.",
      mediaUrl: "https://whatsbit.vercel.app/RS_Choyal_Stones_Catalogue.pdf",
      mediaName: "RS_Choyal_Stones_Catalogue.pdf",
    },
    nextNodeId: "node-5c",
  },
  {
    id: "node-5a",
    type: "delay",
    title: "Wait 4 Days",
    subType: "wait_time",
    config: {
      delayDays: 4,
    },
    nextNodeId: "node-6a",
  },
  {
    id: "node-5b",
    type: "delay",
    title: "Wait 4 Days",
    subType: "wait_time",
    config: {
      delayDays: 4,
    },
    nextNodeId: "node-6b",
  },
  {
    id: "node-5c",
    type: "delay",
    title: "Wait 4 Days",
    subType: "wait_time",
    config: {
      delayDays: 4,
    },
    nextNodeId: "node-6c",
  },
  {
    id: "node-6a",
    type: "action",
    title: "Day 4 Follow-up",
    subType: "send_whatsapp",
    config: {
      text: "Hi {{Client Name}},\n\nHope you've had a chance to review the materials we shared! 👋\n\nI'm here to help with any questions about:\n- Plant design & customization\n- Investment & timeline details\n- Technical specifications\n\nWhat would help you most right now?",
      buttons: ["Have Questions", "Call Me", "Chat Later", "Ready to Proceed"],
    },
  },
  {
    id: "node-6b",
    type: "action",
    title: "Day 4 Expansion Follow-up",
    subType: "send_whatsapp",
    config: {
      text: "Hi {{Client Name}},\n\nJust checking in if you had a look at the expansion solutions we sent. What would help you most right now?",
      buttons: ["Have Questions", "Call Me", "Chat Later"],
    },
  },
  {
    id: "node-6c",
    type: "action",
    title: "Day 4 Spares Follow-up",
    subType: "send_whatsapp",
    config: {
      text: "Hi {{Client Name}},\n\nJust checking in regarding the machine spares availability. Would you like a quotation?",
      buttons: ["Send Quotation", "Call Me", "Chat Later"],
    },
  },
];

// 2. Post-Call Proposal Flow Nodes
const POST_CALL_PROPOSAL_NODES: FlowNode[] = [
  {
    id: "node-1",
    type: "trigger",
    title: "Requirement Call Completed",
    subType: "call_completed",
    config: {},
    nextNodeId: "node-2",
  },
  {
    id: "node-2",
    type: "action",
    title: "Send Choyal Services",
    subType: "send_whatsapp",
    config: {
      text: "Hi {{Client Name}},\n\nGreat speaking with you today! Based on our discussion about your milling interest, here's what we can deliver:\n\n✅ Complete Flour Milling Plants (2 TPD to 2000 TPD)\n✅ Customized Design for capacity & space\n✅ Energy-Efficient Systems (up to 30% power savings)\n✅ PEB-based structures\n✅ Installation & long-term support\n\nDetails & Quotation document below 👇",
    },
    nextNodeId: "node-3",
  },
  {
    id: "node-3",
    type: "action",
    title: "Send Quotation Proposal",
    subType: "send_media",
    config: {
      text: "Hi {{Client Name}},\n\nBased on our requirement discussion, I've prepared a comprehensive quotation & technical proposal.\n\nNext steps:\n🏭 Technical call with our engineering team\n✍️ Final proposal & payment schedules",
      mediaUrl: "https://whatsbit.vercel.app/RS_Choyal_Plant_Quote_Sample.pdf",
      mediaName: "RS_Choyal_Plant_Quotation.pdf",
    },
  },
];

// 3. Missed Call Auto-responder Flow Nodes
const MISSED_CALL_NODES: FlowNode[] = [
  {
    id: "node-1",
    type: "trigger",
    title: "Failed Outbound Call Attempt",
    subType: "call_failed",
    config: {},
    nextNodeId: "node-2",
  },
  {
    id: "node-2",
    type: "action",
    title: "Send Callback Options Alert",
    subType: "send_whatsapp",
    config: {
      text: "Hi {{Client Name}},\n\nWe tried reaching you about your milling plant inquiry. 📞\n\nNo worries! Here are easier ways to connect:\n✓ Reply directly here on WhatsApp\n✓ Call us at +91 92402 89259\n\nWhat works best for you?",
      buttons: ["Chat Here", "Call Now"],
    },
  },
];

// 4. Webinar Invitation Flow Nodes
const WEBINAR_INVITATION_NODES: FlowNode[] = [
  {
    id: "node-1",
    type: "trigger",
    title: "Webinar Announcement Broadcast",
    subType: "broadcast_event",
    config: {},
    nextNodeId: "node-2",
  },
  {
    id: "node-2",
    type: "action",
    title: "Send Webinar Invite Card",
    subType: "send_whatsapp",
    config: {
      text: "Hi {{Client Name}},\n\nYou're invited to an exclusive webinar! 🎓\n\nTopic: Turnkey Milling Modernization & Power Savings\n📅 Date: Next Friday\n🕐 Time: 4:00 PM IST\n🎙️ Speaker: Mr. Choyal\n\nSpots are limited! Register now 👇",
      buttons: ["Register Now", "Remind Me", "Maybe Later"],
    },
  },
];

// Mock Runs Seed Data Helper
const createMockRunsForFlow = (flowId: string): FlowRun[] => {
  const now = new Date();
  const getPastISO = (minsAgo: number) => new Date(now.getTime() - minsAgo * 60 * 1000).toISOString();

  if (flowId === "whatsapp-lead-qualification") {
    return [
      {
        id: "run_lq_1",
        flowId,
        recipientName: "Rahul Sharma",
        recipientPhone: "+91 98397 80947",
        status: "success",
        startedAt: getPastISO(120),
        completedAt: getPastISO(115),
        steps: [
          {
            nodeId: "node-1",
            nodeTitle: "Bitrix Lead Created",
            timestamp: getPastISO(120),
            status: "success",
            description: "Triggered from Bitrix webhook for Lead #8329.",
          },
          {
            nodeId: "node-2",
            nodeTitle: "Initial Lead Notification",
            timestamp: getPastISO(120),
            status: "success",
            description: "WhatsApp buttons message dispatched.",
          },
          {
            nodeId: "node-3a",
            nodeTitle: "Turnkey Plant Inquiry Response",
            timestamp: getPastISO(118),
            status: "success",
            description: "User replied: 'Looking to setup a new plant'. Questions sent.",
          },
          {
            nodeId: "node-4a",
            nodeTitle: "Send Plant Brochure",
            timestamp: getPastISO(115),
            status: "success",
            description: "Brochure PDF attachment successfully delivered via Twilio.",
          },
        ],
      },
      {
        id: "run_lq_2",
        flowId,
        recipientName: "Vikram Patel",
        recipientPhone: "+91 94202 89259",
        status: "paused",
        startedAt: getPastISO(1440), // 1 day ago
        steps: [
          {
            nodeId: "node-1",
            nodeTitle: "Bitrix Lead Created",
            timestamp: getPastISO(1440),
            status: "success",
            description: "Triggered for Lead #8291.",
          },
          {
            nodeId: "node-2",
            nodeTitle: "Initial Lead Notification",
            timestamp: getPastISO(1440),
            status: "success",
            description: "WhatsApp interactive notification dispatched.",
          },
          {
            nodeId: "node-3b",
            nodeTitle: "Plant Expansion Inquiry Response",
            timestamp: getPastISO(1435),
            status: "success",
            description: "User clicked option: 'Need help with expansion'. Inquiry questions sent.",
          },
          {
            nodeId: "node-4b",
            nodeTitle: "Send Expansion Details & Brochure",
            timestamp: getPastISO(1434),
            status: "success",
            description: "Expansion brochure PDF sent successfully.",
          },
          {
            nodeId: "node-5b",
            nodeTitle: "Wait 4 Days",
            timestamp: getPastISO(1434),
            status: "pending",
            description: "State paused. Waiting for delay timer (day 4-5) follow-up trigger.",
          },
        ],
      },
      {
        id: "run_lq_3",
        flowId,
        recipientName: "Amit Singh",
        recipientPhone: "+91 91123 45678",
        status: "failed",
        startedAt: getPastISO(4320), // 3 days ago
        completedAt: getPastISO(4318),
        steps: [
          {
            nodeId: "node-1",
            nodeTitle: "Bitrix Lead Created",
            timestamp: getPastISO(4320),
            status: "success",
            description: "Triggered for Lead #8112.",
          },
          {
            nodeId: "node-2",
            nodeTitle: "Initial Lead Notification",
            timestamp: getPastISO(4320),
            status: "success",
            description: "WhatsApp message delivered.",
          },
          {
            nodeId: "node-3c",
            nodeTitle: "Spares & Stones Inquiry Response",
            timestamp: getPastISO(4319),
            status: "success",
            description: "User replied option: 'Spares & Stones'. Questions sent.",
          },
          {
            nodeId: "node-4c",
            nodeTitle: "Send Spares Catalogue",
            timestamp: getPastISO(4318),
            status: "failed",
            description: "Twilio webhook returned error 21629: Undelivered Media (MIME file type not supported).",
          },
        ],
      },
    ];
  }

  // Generic runs for other flows
  return [
    {
      id: "run_gen_1",
      flowId,
      recipientName: "Karan Johar",
      recipientPhone: "+91 98877 66554",
      status: "success",
      startedAt: getPastISO(300),
      completedAt: getPastISO(298),
      steps: [
        {
          nodeId: "node-1",
          nodeTitle: "Trigger Fired",
          timestamp: getPastISO(300),
          status: "success",
          description: "System event logged.",
        },
        {
          nodeId: "node-2",
          nodeTitle: "Action Executed",
          timestamp: getPastISO(299),
          status: "success",
          description: "WhatsApp response sent.",
        },
      ],
    },
  ];
};

export default function AutomationFlowBuilder() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Tabs navigation
  const [activeSubTab, setActiveSubTab] = useState<"designer" | "history">("designer");

  // Flow Runs Database state
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Simulation State
  const [simulationActive, setSimulationActive] = useState(false);
  const [simulationLogs, setSimulationLogs] = useState<string[]>([]);
  const [simulationCurrentNodeId, setSimulationCurrentNodeId] = useState<string | null>(null);
  const [simulationRunId, setSimulationRunId] = useState<string | null>(null);

  const activeFlow = useMemo(() => {
    return flows.find((f) => f.id === activeFlowId) || null;
  }, [flows, activeFlowId]);

  const selectedNode = useMemo(() => {
    if (!activeFlow || !selectedNodeId) return null;
    return activeFlow.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [activeFlow, selectedNodeId]);

  const selectedRun = useMemo(() => {
    return runs.find((r) => r.id === selectedRunId) || null;
  }, [runs, selectedRunId]);

  // Firestore listeners for Flows and Flow Runs
  useEffect(() => {
    const unsubFlows = onSnapshot(collection(db, "flows"), (snapshot) => {
      const items: Flow[] = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() } as Flow);
      });
      setFlows(items);

      // Seed all default flows if database is empty
      if (items.length === 0) {
        seedAllDefaultFlows();
      } else if (!activeFlowId && items.length > 0) {
        setActiveFlowId(items[0].id);
      }
    });

    return () => {
      unsubFlows();
    };
  }, [activeFlowId]);

  // Read execution runs on flow selection change
  useEffect(() => {
    if (!activeFlowId) return;

    const unsubRuns = onSnapshot(collection(db, "flow_runs"), (snapshot) => {
      const items: FlowRun[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.flowId === activeFlowId) {
          items.push({ id: doc.id, ...data } as FlowRun);
        }
      });

      // Sort run history by startedAt (newest first)
      items.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      setRuns(items);

      // Seed mock runs if none exist in the database for this specific flow
      if (items.length === 0) {
        seedMockRuns(activeFlowId);
      }
    });

    return () => unsubRuns();
  }, [activeFlowId]);

  const seedAllDefaultFlows = async () => {
    const defaultFlows: Flow[] = [
      {
        id: "whatsapp-lead-qualification",
        name: "WhatsApp Lead Qualification",
        description: "Automated qualification workflow for incoming RS Choyal milling inquiry leads.",
        isActive: true,
        nodes: LEAD_QUALIFICATION_NODES,
      },
      {
        id: "post-call-proposal",
        name: "Post-Call Turnkey Proposal",
        description: "Sends overview and quotation documents immediately following requirement call.",
        isActive: true,
        nodes: POST_CALL_PROPOSAL_NODES,
      },
      {
        id: "missed-call-responder",
        name: "Missed Call Auto-responder",
        description: "Sends interactive callback options immediately after failed outbound attempts.",
        isActive: true,
        nodes: MISSED_CALL_NODES,
      },
      {
        id: "webinar-invitation",
        name: "Webinar Invitation Campaign",
        description: "Sends broadcasts announcing upcoming webinars with registration options.",
        isActive: false,
        nodes: WEBINAR_INVITATION_NODES,
      },
    ];

    try {
      for (const flow of defaultFlows) {
        await setDoc(doc(db, "flows", flow.id), {
          name: flow.name,
          description: flow.description,
          isActive: flow.isActive,
          nodes: flow.nodes,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      setActiveFlowId(defaultFlows[0].id);
    } catch (e) {
      console.error("Failed to seed default flows:", e);
    }
  };

  const seedMockRuns = async (flowId: string) => {
    const mocks = createMockRunsForFlow(flowId);
    try {
      for (const run of mocks) {
        await setDoc(doc(db, "flow_runs", run.id), run);
      }
    } catch (e) {
      console.error("Failed to seed mock run data:", e);
    }
  };

  const handleCreateNewFlow = async () => {
    const name = prompt("Enter workflow name:", "New WhatsApp Flow");
    if (!name) return;
    const id = "flow_" + Date.now();
    const newFlow: Flow = {
      id,
      name,
      description: "Custom auto-responder and branching campaign.",
      isActive: false,
      nodes: [
        {
          id: "node-1",
          type: "trigger",
          title: "Trigger Event",
          subType: "lead_created",
          config: {},
        },
      ],
    };

    try {
      await setDoc(doc(db, "flows", id), {
        ...newFlow,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setActiveFlowId(id);
      setSelectedNodeId("node-1");
      setActiveSubTab("designer");
    } catch (e) {
      alert("Failed to create new flow: " + e);
    }
  };

  const handleSaveFlow = async () => {
    if (!activeFlow) return;
    try {
      await setDoc(doc(db, "flows", activeFlow.id), {
        ...activeFlow,
        updatedAt: new Date(),
      });
      alert("Flow saved successfully to database!");
    } catch (e) {
      alert("Failed to save flow: " + e);
    }
  };

  const handleDeleteFlow = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete workflow: "${name}"?`)) return;
    try {
      await deleteDoc(doc(db, "flows", id));
      if (activeFlowId === id) {
        setActiveFlowId(null);
        setSelectedNodeId(null);
      }
    } catch (e) {
      alert("Failed to delete flow: " + e);
    }
  };

  const handleUpdateNode = (updatedNode: FlowNode) => {
    if (!activeFlow) return;
    const updatedNodes = activeFlow.nodes.map((n) =>
      n.id === updatedNode.id ? updatedNode : n
    );
    setFlows((prev) =>
      prev.map((f) => (f.id === activeFlow.id ? { ...f, nodes: updatedNodes } : f))
    );
  };

  const handleAddNode = (parentNodeId: string, branchLabel?: string) => {
    if (!activeFlow) return;
    const parentNode = activeFlow.nodes.find((n) => n.id === parentNodeId);
    if (!parentNode) return;

    const newId = "node_" + Math.random().toString(36).substr(2, 9);
    const newNode: FlowNode = {
      id: newId,
      type: "action",
      title: "New WhatsApp Message",
      subType: "send_whatsapp",
      config: {
        text: "Hi {{Client Name}},\n\n",
      },
    };

    let updatedNodes = [...activeFlow.nodes, newNode];

    if (branchLabel) {
      const currentBranches = parentNode.config.branches || [];
      const updatedBranches = currentBranches.map((br) =>
        br.buttonLabel === branchLabel ? { ...br, nodeId: newId } : br
      );
      const updatedParentNode = {
        ...parentNode,
        config: { ...parentNode.config, branches: updatedBranches },
      };
      updatedNodes = updatedNodes.map((n) =>
        n.id === parentNodeId ? updatedParentNode : n
      );
    } else {
      const oldNextId = parentNode.nextNodeId;
      const updatedParentNode = { ...parentNode, nextNodeId: newId };
      newNode.nextNodeId = oldNextId;

      updatedNodes = updatedNodes.map((n) =>
        n.id === parentNodeId ? updatedParentNode : n
      );
    }

    setFlows((prev) =>
      prev.map((f) => (f.id === activeFlow.id ? { ...f, nodes: updatedNodes } : f))
    );
    setSelectedNodeId(newId);
  };

  const handleDeleteNode = (nodeId: string) => {
    if (!activeFlow || nodeId === "node-1") return;

    const nodeToDelete = activeFlow.nodes.find((n) => n.id === nodeId);
    if (!nodeToDelete) return;

    let updatedNodes = activeFlow.nodes.filter((n) => n.id !== nodeId);

    updatedNodes = updatedNodes.map((n) => {
      if (n.nextNodeId === nodeId) {
        return { ...n, nextNodeId: nodeToDelete.nextNodeId || undefined };
      }
      if (n.config.branches) {
        const branches = n.config.branches.map((br) =>
          br.nodeId === nodeId ? { ...br, nodeId: "" } : br
        );
        return { ...n, config: { ...n.config, branches } };
      }
      return n;
    });

    setFlows((prev) =>
      prev.map((f) => (f.id === activeFlow.id ? { ...f, nodes: updatedNodes } : f))
    );

    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
  };

  // Node Render Tree Helper
  const renderFlowTree = (nodeId: string): React.ReactNode => {
    if (!activeFlow) return null;
    const node = activeFlow.nodes.find((n) => n.id === nodeId);
    if (!node) return null;

    const isSelected = selectedNodeId === node.id;
    const isSimActiveNode = simulationActive && simulationCurrentNodeId === node.id;

    let nodeTypeLabel = "Action";
    if (node.type === "trigger") nodeTypeLabel = "Trigger";
    if (node.type === "delay") nodeTypeLabel = "Delay Timer";
    if (node.type === "condition") nodeTypeLabel = "Condition";

    return (
      <div className={styles.flowBranchCol} key={node.id}>
        {/* Node Card */}
        <div
          className={`${styles.nodeCard} ${isSelected ? styles.nodeCardSelected : ""} ${
            node.type === "trigger"
              ? styles.nodeTrigger
              : node.type === "action"
              ? styles.nodeAction
              : node.type === "delay"
              ? styles.nodeDelay
              : styles.nodeCondition
          }`}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedNodeId(node.id);
          }}
          style={isSimActiveNode ? { border: "3px solid #00a884", transform: "scale(1.03)" } : {}}
        >
          <div className={styles.nodeHeader}>
            <span>{nodeTypeLabel}</span>
            {node.id !== "node-1" && (
              <button
                className={`${styles.nodeButton} ${styles.nodeButtonDelete}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteNode(node.id);
                }}
                title="Delete Step"
              >
                🗑️
              </button>
            )}
          </div>
          <div className={styles.nodeBody}>
            <div className={styles.nodeTitle}>{node.title}</div>
            {node.config.text && (
              <div className={styles.nodeSnippet}>{node.config.text}</div>
            )}
            {node.config.delayDays && (
              <div style={{ fontWeight: 600, color: "#f59e0b" }}>
                ⏳ {node.config.delayDays} Days
              </div>
            )}
            {node.config.mediaName && (
              <div style={{ fontSize: "11px", color: "#10b981" }}>
                📄 {node.config.mediaName}
              </div>
            )}
            {node.config.buttons && node.config.buttons.length > 0 && (
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "4px" }}>
                {node.config.buttons.map((btn, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: "9px",
                      padding: "2px 6px",
                      backgroundColor: "#334155",
                      borderRadius: "10px",
                      color: "#94a3b8",
                    }}
                  >
                    🔘 {btn}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Next Connections */}
        {node.config.branches && node.config.branches.length > 0 ? (
          <div className={styles.flowBranchRow}>
            {node.config.branches.map((branch, idx) => {
              return (
                <div className={styles.flowBranchCol} key={idx}>
                  <div className={styles.addNodeBtnContainer}>
                    <div className={styles.addNodeLine}></div>
                    <div className={styles.branchLabel}>
                      Choice: "{branch.buttonLabel}"
                    </div>
                  </div>
                  {branch.nodeId ? (
                    renderFlowTree(branch.nodeId)
                  ) : (
                    <div className={styles.addNodeBtnContainer}>
                      <button
                        className={styles.addNodeCircle}
                        onClick={() => handleAddNode(node.id, branch.buttonLabel)}
                        title="Add action for this choice"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : node.nextNodeId ? (
          <>
            <div className={styles.addNodeBtnContainer}>
              <div className={styles.addNodeLine} style={{ height: "30px" }}></div>
            </div>
            {renderFlowTree(node.nextNodeId)}
          </>
        ) : (
          <div className={styles.addNodeBtnContainer}>
            <div className={styles.addNodeLine}></div>
            <button
              className={styles.addNodeCircle}
              onClick={() => handleAddNode(node.id)}
              title="Add next step"
            >
              +
            </button>
          </div>
        )}
      </div>
    );
  };

  // Interactive Flow Simulator & Run Logging
  const startSimulation = async () => {
    if (!activeFlow) return;

    const rId = "sim_" + Date.now();
    setSimulationRunId(rId);
    setSimulationActive(true);
    setSimulationLogs(["[SYSTEM]: Simulation started.", "[TRIGGER]: Trigger Event Fired."]);
    setSimulationCurrentNodeId("node-1");

    // Initialize simulation run log in Firestore
    const initialRun: FlowRun = {
      id: rId,
      flowId: activeFlow.id,
      recipientName: "Simulation Lead",
      recipientPhone: "+91 00000 00000 (Test)",
      status: "running",
      startedAt: new Date().toISOString(),
      steps: [
        {
          nodeId: "node-1",
          nodeTitle: "Trigger: " + activeFlow.nodes[0].title,
          timestamp: new Date().toISOString(),
          status: "success",
          description: "Simulation trigger fired on workspace canvas.",
        },
      ],
    };

    try {
      await setDoc(doc(db, "flow_runs", rId), initialRun);
    } catch (e) {
      console.error("Failed to write initial simulation run log:", e);
    }

    // Move to next step
    setTimeout(() => {
      executeSimulationStep("node-2", [initialRun.steps[0]]);
    }, 1200);
  };

  const executeSimulationStep = async (nodeId: string, currentSteps: FlowRunStep[]) => {
    if (!activeFlow || !simulationRunId) return;
    const node = activeFlow.nodes.find((n) => n.id === nodeId);

    if (!node) {
      setSimulationLogs((prev) => [...prev, `[SYSTEM]: Done. Flow reached end of branch.`]);
      setSimulationActive(false);

      // Mark run as success in Firestore
      try {
        await setDoc(
          doc(db, "flow_runs", simulationRunId),
          {
            status: "success",
            completedAt: new Date().toISOString(),
            steps: currentSteps,
          },
          { merge: true }
        );
      } catch (e) {
        console.error("Failed to finish simulation run log:", e);
      }
      return;
    }

    setSimulationCurrentNodeId(nodeId);

    // Create a new step log item
    let statusMsg = "";
    let stepStatus: "success" | "failed" | "pending" = "success";

    if (node.type === "trigger") {
      setSimulationLogs((prev) => [...prev, `[TRIGGER]: ${node.title}`]);
      statusMsg = `Trigger event processed.`;
    } else if (node.type === "delay") {
      setSimulationLogs((prev) => [
        ...prev,
        `[DELAY]: Wait for ${node.config.delayDays || 1} days... (Simulating instant skip)`,
      ]);
      statusMsg = `Delay timer for ${node.config.delayDays} days scheduled and bypassed.`;
    } else if (node.type === "action") {
      if (node.subType === "send_whatsapp") {
        setSimulationLogs((prev) => [
          ...prev,
          `[WHATSAPP MESSAGE]: "${node.title}" Sent.`,
          `💬 text: "${node.config.text}"`,
        ]);
        statusMsg = `WhatsApp notification sent. Content: "${node.config.text?.substring(0, 50)}..."`;
        if (node.config.buttons && node.config.buttons.length > 0) {
          setSimulationLogs((prev) => [
            ...prev,
            `[WAITING USER REPLY]: Awaiting choice selection...`,
          ]);
          stepStatus = "pending";
          statusMsg = `Awaiting user click on buttons: [${node.config.buttons.join(", ")}]`;
        }
      } else if (node.subType === "send_media") {
        setSimulationLogs((prev) => [
          ...prev,
          `[MEDIA SENT]: Sent ${node.config.mediaName || "file"}`,
          `📂 Url: ${node.config.mediaUrl}`,
        ]);
        statusMsg = `Brochure media delivered: ${node.config.mediaName}`;
      }
    }

    const newStep: FlowRunStep = {
      nodeId: node.id,
      nodeTitle: node.title,
      timestamp: new Date().toISOString(),
      status: stepStatus,
      description: statusMsg,
    };

    const updatedSteps = [...currentSteps, newStep];

    // Update Firestore execution run details
    try {
      await setDoc(
        doc(db, "flow_runs", simulationRunId),
        {
          status: stepStatus === "pending" ? "paused" : "running",
          steps: updatedSteps,
        },
        { merge: true }
      );
    } catch (e) {
      console.error("Failed to update simulation run log steps:", e);
    }

    // Auto-advance if not waiting for button replies
    if (stepStatus !== "pending" && node.nextNodeId) {
      setTimeout(() => executeSimulationStep(node.nextNodeId!, updatedSteps), 1500);
    } else if (stepStatus !== "pending" && !node.nextNodeId && (!node.config.branches || node.config.branches.length === 0)) {
      // End of flow reached
      setTimeout(() => {
        setSimulationLogs((prev) => [...prev, `[SYSTEM]: Done. Flow reached end.`]);
        setSimulationActive(false);
        setDoc(
          doc(db, "flow_runs", simulationRunId),
          {
            status: "success",
            completedAt: new Date().toISOString(),
            steps: updatedSteps,
          },
          { merge: true }
        );
      }, 1000);
    }
  };

  const selectSimulationBranch = async (buttonText: string, targetNodeId: string) => {
    if (!simulationRunId) return;

    setSimulationLogs((prev) => [...prev, `[USER REPLY]: Clicked "${buttonText}"`]);

    // Read current steps from runs state
    const currentRun = runs.find((r) => r.id === simulationRunId);
    const oldSteps = currentRun ? currentRun.steps : [];

    // Mark previous pending step as resolved
    const resolvedSteps = oldSteps.map((s) =>
      s.status === "pending" ? { ...s, status: "success" as const, description: s.description + ` (Selected "${buttonText}")` } : s
    );

    executeSimulationStep(targetNodeId, resolvedSteps);
  };

  return (
    <div className={styles.container}>
      {/* 1. Sidebar - Flow List */}
      <div className={styles.flowListSidebar}>
        <div className={styles.sidebarHeader}>
          <h2>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="9" />
              <rect x="14" y="3" width="7" height="5" />
              <rect x="14" y="12" width="7" height="9" />
              <rect x="3" y="16" width="7" height="5" />
            </svg>
            Automations
          </h2>
          <button className={styles.createButton} onClick={handleCreateNewFlow}>
            <span>+ Create Flow</span>
          </button>
        </div>

        <div className={styles.flowList}>
          {flows.map((flow) => {
            const isActive = activeFlowId === flow.id;
            return (
              <div
                key={flow.id}
                className={`${styles.flowItem} ${isActive ? styles.flowItemActive : ""}`}
                onClick={() => {
                  setActiveFlowId(flow.id);
                  setSelectedNodeId(null);
                  setSelectedRunId(null);
                  setSimulationActive(false);
                }}
              >
                <div className={styles.flowItemName}>{flow.name}</div>
                <div className={styles.flowItemDesc}>{flow.description}</div>
                <div className={styles.flowItemMeta}>
                  <span
                    className={`${styles.statusIndicator} ${
                      flow.isActive
                        ? styles.statusIndicatorActive
                        : styles.statusIndicatorInactive
                    }`}
                  >
                    <span
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        backgroundColor: flow.isActive ? "#10b981" : "#94a3b8",
                      }}
                    ></span>
                    {flow.isActive ? "Active" : "Draft"}
                  </span>
                  <button
                    style={{
                      background: "none",
                      border: "none",
                      color: "#ef4444",
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFlow(flow.id, flow.name);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Central Workspace panel */}
      <div className={styles.workspace}>
        {activeFlow ? (
          <>
            {/* Flow Top Header Bar */}
            <div className={styles.topBar}>
              <div className={styles.flowDetails}>
                <input
                  type="text"
                  value={activeFlow.name}
                  onChange={(e) => {
                    setFlows((prev) =>
                      prev.map((f) =>
                        f.id === activeFlow.id ? { ...f, name: e.target.value } : f
                      )
                    );
                  }}
                  className={styles.flowTitleInput}
                />
                <span style={{ fontSize: "11px", color: "#64748b", paddingLeft: "4px" }}>
                  ID: {activeFlow.id}
                </span>
              </div>

              <div className={styles.topBarActions}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                  <span>Status:</span>
                  <select
                    value={activeFlow.isActive ? "active" : "draft"}
                    onChange={(e) => {
                      setFlows((prev) =>
                        prev.map((f) =>
                          f.id === activeFlow.id
                            ? { ...f, isActive: e.target.value === "active" }
                            : f
                        )
                      );
                    }}
                    style={{
                      backgroundColor: "#0f172a",
                      border: "1px solid #334155",
                      color: "white",
                      padding: "4px 8px",
                      borderRadius: "6px",
                      outline: "none",
                      fontSize: "13px",
                    }}
                  >
                    <option value="draft">Draft (Inactive)</option>
                    <option value="active">Active (Live)</option>
                  </select>
                </label>

                {activeSubTab === "designer" && (
                  <button
                    className={styles.secondaryBtn}
                    onClick={() => {
                      if (simulationActive) {
                        setSimulationActive(false);
                      } else {
                        startSimulation();
                      }
                    }}
                    style={{
                      backgroundColor: simulationActive ? "#ef444420" : "transparent",
                      borderColor: simulationActive ? "#ef4444" : "#334155",
                      color: simulationActive ? "#ef4444" : "#f8fafc",
                    }}
                  >
                    {simulationActive ? "🛑 Stop Test" : "⚡ Test Flow"}
                  </button>
                )}

                <button
                  onClick={handleSaveFlow}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#00a884",
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    fontWeight: "600",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  Save Flow
                </button>
              </div>
            </div>

            {/* Designer Sub navigation Tabs */}
            <div className={styles.tabBar}>
              <button
                className={`${styles.tabButton} ${activeSubTab === "designer" ? styles.tabButtonActive : ""}`}
                onClick={() => {
                  setActiveSubTab("designer");
                  setSelectedRunId(null);
                }}
              >
                ⚙️ Flow Canvas
              </button>
              <button
                className={`${styles.tabButton} ${activeSubTab === "history" ? styles.tabButtonActive : ""}`}
                onClick={() => {
                  setActiveSubTab("history");
                  setSelectedNodeId(null);
                }}
              >
                📊 Run Execution History
              </button>
            </div>

            {/* Workspace Switcher */}
            {activeSubTab === "designer" ? (
              /* Canvas Designer */
              <div className={styles.canvasContainer}>
                <div className={styles.canvasContent}>
                  {renderFlowTree("node-1")}
                </div>
              </div>
            ) : (
              /* Execution Runs History Dashboard */
              <div className={styles.historyContainer}>
                <div className={styles.historyHeader}>
                  <h3>Run Logs for {activeFlow.name}</h3>
                  <span style={{ fontSize: "12px", color: "#64748b" }}>
                    Total Runs tracked: {runs.length}
                  </span>
                </div>

                <div className={styles.historyTableWrapper}>
                  <table className={styles.historyTable}>
                    <thead>
                      <tr>
                        <th>Recipient</th>
                        <th>Started At</th>
                        <th>Status</th>
                        <th>Steps Run</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((run) => {
                        const dateStr = new Date(run.startedAt).toLocaleString("en-IN", {
                          hour12: true,
                          hour: "2-digit",
                          minute: "2-digit",
                          day: "numeric",
                          month: "short",
                        });

                        const stepsCompleted = run.steps.filter((s) => s.status === "success").length;

                        let badgeStyle = styles.badgeRunning;
                        if (run.status === "success") badgeStyle = styles.badgeSuccess;
                        if (run.status === "failed") badgeStyle = styles.badgeFailed;
                        if (run.status === "paused") badgeStyle = styles.badgePaused;

                        return (
                          <tr key={run.id}>
                            <td>
                              <div style={{ fontWeight: "600" }}>{run.recipientName}</div>
                              <div style={{ fontSize: "11px", color: "#64748b" }}>{run.recipientPhone}</div>
                            </td>
                            <td>{dateStr}</td>
                            <td>
                              <span className={`${styles.badge} ${badgeStyle}`}>
                                {run.status}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontWeight: "600" }}>{stepsCompleted}</span>
                              <span style={{ color: "#64748b" }}> / {run.steps.length}</span>
                            </td>
                            <td>
                              <button
                                onClick={() => setSelectedRunId(run.id)}
                                style={{
                                  padding: "4px 8px",
                                  backgroundColor: "#334155",
                                  color: "#cbd5e1",
                                  border: "none",
                                  borderRadius: "4px",
                                  fontSize: "12px",
                                  cursor: "pointer",
                                }}
                              >
                                Inspect
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Interactive Simulation Dashboard (Collapsible) */}
            {simulationActive && activeSubTab === "designer" && (
              <div className={styles.simulatorTab}>
                <div className={styles.simHeader}>
                  <div className={styles.simTitle}>
                    <span className={styles.spinner} style={{ borderColor: "#10b981", borderTopColor: "transparent" }}></span>
                    WhatsApp Automation Simulator
                  </div>
                  <button
                    onClick={() => setSimulationActive(false)}
                    style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "14px" }}
                  >
                    ✕
                  </button>
                </div>
                <div className={styles.simBody}>
                  <div className={styles.simLog}>
                    {simulationLogs.map((log, i) => (
                      <div key={i} style={{ margin: "2px 0" }}>{log}</div>
                    ))}
                  </div>

                  {(() => {
                    const currentNode = activeFlow.nodes.find(
                      (n) => n.id === simulationCurrentNodeId
                    );
                    if (currentNode?.config?.buttons && currentNode.config.buttons.length > 0) {
                      return (
                        <div style={{ display: "flex", gap: "8px", flexDirection: "column" }}>
                          <span style={{ fontSize: "11px", fontWeight: "600", color: "#94a3b8" }}>
                            SELECT USER OPTION:
                          </span>
                          <div style={{ display: "flex", gap: "6px" }}>
                            {currentNode.config.buttons.map((btn, i) => {
                              const branch = currentNode.config.branches?.find(
                                (br) => br.buttonLabel === btn
                              );
                              return (
                                <button
                                  key={i}
                                  onClick={() =>
                                    branch &&
                                    selectSimulationBranch(btn, branch.nodeId)
                                  }
                                  disabled={!branch?.nodeId}
                                  style={{
                                    padding: "6px 12px",
                                    backgroundColor: "#059669",
                                    color: "white",
                                    border: "none",
                                    borderRadius: "4px",
                                    fontSize: "12px",
                                    fontWeight: "600",
                                    cursor: "pointer",
                                    opacity: branch?.nodeId ? 1 : 0.5,
                                  }}
                                >
                                  {btn}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className={styles.emptyState}>
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
            <h3>No Active Flow Selected</h3>
            <p>Choose an automation flow from the list or create a new one to begin designing.</p>
          </div>
        )}
      </div>

      {/* 3. Designer Right Panel - Properties Editing Sidebar */}
      {activeFlow && selectedNode && activeSubTab === "designer" && (
        <div className={styles.propertiesPanel}>
          <div className={styles.panelHeader}>
            <h3>Edit Node Properties</h3>
            <button
              onClick={() => setSelectedNodeId(null)}
              style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "14px" }}
            >
              ✕
            </button>
          </div>

          <div className={styles.panelBody}>
            <div className={styles.inputGroup}>
              <label>Node Title</label>
              <input
                type="text"
                value={selectedNode.title}
                onChange={(e) =>
                  handleUpdateNode({ ...selectedNode, title: e.target.value })
                }
              />
            </div>

            <div className={styles.inputGroup}>
              <label>Type / Action</label>
              <select
                value={selectedNode.type + ":" + selectedNode.subType}
                onChange={(e) => {
                  const [type, subType] = e.target.value.split(":");
                  const updatedNode: FlowNode = {
                    ...selectedNode,
                    type: type as any,
                    subType,
                  };
                  if (type === "delay") {
                    updatedNode.config = { delayDays: 1 };
                  } else if (subType === "send_media") {
                    updatedNode.config = {
                      text: selectedNode.config.text || "",
                      mediaUrl: "https://whatsbit.vercel.app/RS_Choyal_Company_Brochure.pdf",
                      mediaName: "RS_Choyal_Company_Brochure.pdf",
                    };
                  } else if (subType === "send_whatsapp") {
                    updatedNode.config = {
                      text: selectedNode.config.text || "",
                      buttons: selectedNode.config.buttons || [],
                      branches: selectedNode.config.branches || [],
                    };
                  } else {
                    updatedNode.config = {};
                  }
                  handleUpdateNode(updatedNode);
                }}
                disabled={selectedNode.id === "node-1"}
              >
                <option value="trigger:lead_created">Trigger: Bitrix Lead Created</option>
                <option value="trigger:call_completed">Trigger: Requirement Call Completed</option>
                <option value="trigger:call_failed">Trigger: Failed Call Attempt</option>
                <option value="trigger:broadcast_event">Trigger: Broadcast Announcement</option>
                <option value="action:send_whatsapp">Action: Send WhatsApp Text</option>
                <option value="action:send_media">Action: Send WhatsApp Document/PDF</option>
                <option value="delay:wait_time">Delay: Wait Timer</option>
              </select>
            </div>

            {selectedNode.type === "delay" && (
              <div className={styles.inputGroup}>
                <label>Wait Duration (Days)</label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={selectedNode.config.delayDays || 1}
                  onChange={(e) =>
                    handleUpdateNode({
                      ...selectedNode,
                      config: {
                        ...selectedNode.config,
                        delayDays: parseInt(e.target.value) || 1,
                      },
                    })
                  }
                />
              </div>
            )}

            {selectedNode.type === "action" && (
              <>
                <div className={styles.inputGroup}>
                  <label>Message Content</label>
                  <textarea
                    value={selectedNode.config.text || ""}
                    onChange={(e) =>
                      handleUpdateNode({
                        ...selectedNode,
                        config: { ...selectedNode.config, text: e.target.value },
                      })
                    }
                    placeholder="Enter message text here..."
                  />
                  <div className={styles.variablesHelper}>
                    Use:
                    <span
                      className={styles.variableTag}
                      onClick={() => {
                        const txt = (selectedNode.config.text || "") + " {{Client Name}}";
                        handleUpdateNode({
                          ...selectedNode,
                          config: { ...selectedNode.config, text: txt },
                        });
                      }}
                    >
                      Client Name
                    </span>
                    <span
                      className={styles.variableTag}
                      onClick={() => {
                        const txt = (selectedNode.config.text || "") + " {{Plant Name}}";
                        handleUpdateNode({
                          ...selectedNode,
                          config: { ...selectedNode.config, text: txt },
                        });
                      }}
                    >
                      Plant Name
                    </span>
                  </div>
                </div>

                {selectedNode.subType === "send_media" && (
                  <>
                    <div className={styles.inputGroup}>
                      <label>Media / PDF Name</label>
                      <input
                        type="text"
                        value={selectedNode.config.mediaName || ""}
                        onChange={(e) =>
                          handleUpdateNode({
                            ...selectedNode,
                            config: {
                              ...selectedNode.config,
                              mediaName: e.target.value,
                            },
                          })
                        }
                        placeholder="RS_Choyal_Company_Brochure.pdf"
                      />
                    </div>
                    <div className={styles.inputGroup}>
                      <label>Media Download URL</label>
                      <input
                        type="text"
                        value={selectedNode.config.mediaUrl || ""}
                        onChange={(e) =>
                          handleUpdateNode({
                            ...selectedNode,
                            config: { ...selectedNode.config, mediaUrl: e.target.value },
                          })
                        }
                        placeholder="https://domain.com/brochure.pdf"
                      />
                    </div>
                  </>
                )}

                {selectedNode.subType === "send_whatsapp" && (
                  <div className={styles.inputGroup}>
                    <label>Interactive Buttons (Max 3)</label>
                    <div className={styles.buttonList}>
                      {(selectedNode.config.buttons || []).map((btn, idx) => (
                        <div className={styles.buttonInputRow} key={idx}>
                          <input
                            type="text"
                            value={btn}
                            onChange={(e) => {
                              const newButtons = [...(selectedNode.config.buttons || [])];
                              newButtons[idx] = e.target.value;

                              const newBranches = (selectedNode.config.branches || []).map(
                                (br, bIdx) =>
                                  bIdx === idx ? { ...br, buttonLabel: e.target.value } : br
                              );

                              handleUpdateNode({
                                ...selectedNode,
                                config: {
                                  ...selectedNode.config,
                                  buttons: newButtons,
                                  branches: newBranches,
                                },
                              });
                            }}
                          />
                          <button
                            type="button"
                            style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "16px" }}
                            onClick={() => {
                              const newButtons = (selectedNode.config.buttons || []).filter(
                                (_, bIdx) => bIdx !== idx
                              );
                              const labelToRemove = selectedNode.config.buttons?.[idx];
                              const newBranches = (selectedNode.config.branches || []).filter(
                                (br) => br.buttonLabel !== labelToRemove
                              );

                              handleUpdateNode({
                                ...selectedNode,
                                config: {
                                  ...selectedNode.config,
                                  buttons: newButtons,
                                  branches: newBranches,
                                },
                              });
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}

                      {(selectedNode.config.buttons || []).length < 3 && (
                        <button
                          type="button"
                          className={styles.secondaryBtn}
                          onClick={() => {
                            const newButtons = [...(selectedNode.config.buttons || []), "Option " + ((selectedNode.config.buttons || []).length + 1)];
                            const newBranches = [
                              ...(selectedNode.config.branches || []),
                              { buttonLabel: "Option " + newButtons.length, nodeId: "" },
                            ];
                            handleUpdateNode({
                              ...selectedNode,
                              config: {
                                ...selectedNode.config,
                                buttons: newButtons,
                                branches: newBranches,
                              },
                            });
                          }}
                        >
                          + Add Button Choice
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* 4. History Inspection Drawer overlay */}
      {activeFlow && selectedRun && activeSubTab === "history" && (
        <div className={styles.inspectorOverlay}>
          <div className={styles.inspectorHeader}>
            <div>
              <h3 style={{ fontSize: "14px", fontWeight: "600" }}>Inspect Execution Run</h3>
              <span style={{ fontSize: "10px", color: "#94a3b8" }}>ID: {selectedRun.id}</span>
            </div>
            <button
              onClick={() => setSelectedRunId(null)}
              style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "14px" }}
            >
              ✕
            </button>
          </div>

          <div className={styles.inspectorBody}>
            {/* Run Metadata Grid */}
            <div className={styles.metaGrid}>
              <div className={styles.metaItem}>
                <label>Recipient Contact</label>
                <span>{selectedRun.recipientName} ({selectedRun.recipientPhone})</span>
              </div>
              <div className={styles.metaItem}>
                <label>Execution Status</label>
                <span style={{ textTransform: "capitalize", fontWeight: "600", color: selectedRun.status === "success" ? "#34d399" : selectedRun.status === "failed" ? "#f87171" : "#fbbf24" }}>
                  ● {selectedRun.status}
                </span>
              </div>
              <div className={styles.metaItem}>
                <label>Started At</label>
                <span>{new Date(selectedRun.startedAt).toLocaleString("en-IN")}</span>
              </div>
              {selectedRun.completedAt && (
                <div className={styles.metaItem}>
                  <label>Completed At</label>
                  <span>{new Date(selectedRun.completedAt).toLocaleString("en-IN")}</span>
                </div>
              )}
            </div>

            {/* Run Step Timeline */}
            <div>
              <h4 style={{ fontSize: "12px", textTransform: "uppercase", color: "#94a3b8", marginBottom: "12px", letterSpacing: "0.05em" }}>
                Step Execution Timeline
              </h4>
              <div className={styles.timeline}>
                {selectedRun.steps.map((step, idx) => {
                  let dotClass = styles.timelineDotPending;
                  if (step.status === "success") dotClass = styles.timelineDotSuccess;
                  if (step.status === "failed") dotClass = styles.timelineDotFailed;

                  return (
                    <div className={styles.timelineItem} key={idx}>
                      <span className={`${styles.timelineDot} ${dotClass}`}></span>
                      <div className={styles.timelineContent}>
                        <span className={styles.timelineTitle}>{step.nodeTitle}</span>
                        <span className={styles.timelineTime}>
                          {new Date(step.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}
                        </span>
                        {step.description && (
                          <div className={styles.timelineDesc}>{step.description}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
