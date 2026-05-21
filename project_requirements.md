# Embedded WhatsApp Chat App Project Document

## 1. Project Overview
The objective is to build an embedded chat application interface that mimics a CRM-style communication module. The application will allow users to manage conversations with their contacts via the WhatsApp network. 

The development will be split into two primary phases:
- **Phase 1 (Prototype):** A fully functional UI simulating message sending and receiving without actual WhatsApp API connectivity.
- **Phase 2 (Production):** Integration with the live WhatsApp Business API to handle real-world messaging, read receipts, and notifications.

## 2. Technical Stack
- **Framework:** Next.js (App Router)
- **Styling:** Vanilla CSS / CSS Modules (as per project conventions)
- **State Management:** React Context / Hooks for chat states (mocked backend initially).
- **Backend (Phase 2):** Next.js API Routes for webhook handling and API requests to WhatsApp.

## 3. UI/UX Requirements
Based on the provided mockups, the application will feature a two-pane or three-pane layout:
1. **Global Sidebar (CRM Navigation):** Contains links to different modules (Workday, Settings, Funnels, Smart Filters).
2. **Chat List Pane:** 
   - Search bar for contacts/conversations.
   - Filter tabs (All, Unprocessed, My, Favorites).
   - List of active conversations with unread badges, timestamps, and last message previews.
3. **Active Chat Pane:** 
   - Header with contact details, phone number, and CRM-related actions (Activity, Comment, Booking, Task).
   - WhatsApp-styled chat background.
   - Message bubbles indicating incoming vs. outgoing, timestamps, and read receipts (ticks).
   - Chat input area with attachment support, emoji picker, and voice note UI.
   - Integration panels inside the chat (e.g., loaded audio calls or system messages).

## 4. Implementation Phases

### Phase 1: Prototype Development (Simulated Messages)
**Goal:** Build the UI and connect it to a mocked data store to simulate a real-time chat experience.

1. **Static UI Construction:**
   - Develop the global sidebar and chat list interface.
   - Build the active chat window, ensuring responsive height and scrollable message areas.
   - Implement the chat input component.

2. **Mock Data Layer:**
   - Create JSON fixtures representing contacts, past conversation histories, and message metadata (status, time).
   - Set up a simulated delay for "receiving" a response after sending a message.

3. **Interactivity:**
   - Clicking a contact in the chat list opens their conversation history.
   - Typing and sending a message appends it to the chat view instantly.
   - Auto-scroll to the bottom of the chat when new messages appear.
   - Simulate incoming messages using a mock timer.

### Phase 2: Live WhatsApp API Integration
**Goal:** Replace the mocked data layer with actual API calls to Meta's WhatsApp Business Platform.

1. **Infrastructure & Webhooks:**
   - Set up a Meta App and generate WhatsApp Business API access tokens.
   - Create an API route in Next.js (e.g., `/api/webhooks/whatsapp`) to receive incoming messages and status updates from Meta.
   - Implement webhook verification.

2. **Sending Messages:**
   - Update the chat input submission handler to trigger an API call to the backend.
   - The backend will format the payload and dispatch a POST request to the WhatsApp API (`/messages` endpoint).

3. **Receiving Messages:**
   - Parse incoming webhook payloads (text, images, audio, statuses).
   - Use Server-Sent Events (SSE) or WebSockets to push incoming messages from the Next.js backend to the frontend in real-time.

4. **Message Status Sync:**
   - Listen for `sent`, `delivered`, and `read` statuses from webhooks.
   - Update message UI components (single tick, double tick, blue ticks) accordingly.

## 5. Security & Deployment Requirements
- **Authentication:** Ensure the application is wrapped in proper auth (CRM user login) before allowing access to the chat interface.
- **Data Privacy:** Messages and customer phone numbers should be securely stored and encrypted where necessary.
- **Rate Limits:** Implement UI checks to handle WhatsApp's API rate limits and 24-hour customer service window rules.
