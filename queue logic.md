This logic document outlines the architecture for a high-efficiency queue management system designed for a Next.js/Supabase stack. It prioritizes load balancing and "pipeline" flow to ensure that counters are never idle while clients are waiting.

Part 1: The Appointment Portal (Pre-Arrival)
The goal of the booking site is Data Gathering and Resource Forecasting.
1. Recommended Booking Flow
Service First $\rightarrow$ Date $\rightarrow$ Time.
Why Service First? You cannot determine availability without knowing the "Weight" of the request. A client needing both QA and QB takes more resources than a client needing only QC.
Inquiry Phase: Include a "Required Documents Checklist" during the service selection. The user must tick a box saying "I have all required documents" before they can see available dates. This reduces the Deferred (Incomplete) rate.
2. Slot Management Logic
Operating Window: 30-minute blocks.
Capacity Weighting: * Single Service: Consumes 1 "Slot Unit."
Multi-Service (QA + QB): Consumes 1.5 "Slot Units."
Buffer Strategy: If a counter group (e.g., QA) has 3 counters, you have 6 "Slot Units" available per 30 minutes (assuming 15 mins per transaction). Set your booking limit to 4 or 5 Units to leave a 20% buffer for walk-ins and "overruns."
3. Tech Stack Recommendation: Supabase vs. Local DB
The "Hybrid-Sync" Approach: I recommend keeping Supabase as the Single Source of Truth.
Why? If you "transfer" data to a local DB upon arrival, you lose real-time sync with the online portal (e.g., if a client cancels their appt while others are checking in).
Reliability: Use Supabase's Realtime feature. If the Singapore office internet goes down, the local Next.js app can cache the "Checked-in" list in local storage until connectivity returns.

Part 2: Arrival & Queue Management Logic
1. Check-in & Dynamic Routing
When a client scans their QR code at the entrance, the system executes the Load Balancer.
Scenario (Multi-Service QA + QB): * Check Count(WAITING) for QA and QB.
If QA_Wait > QB_Wait, the system flips the journey. The ticket is issued for QB first.
Result: The client is served immediately at the empty QB counter rather than sitting in a 30-minute line at QA.
2. Priority Tiering (The "Weighted Fair" Algorithm)
To ensure efficiency, the "Next" button on a counter dashboard pulls from the database using this specific order:
Priority
Tier Name
Description
Tier 1
On-Time Appt
Checked in within +/- 15 mins of their slot.
Tier 1.5
Transfers
Finished Service A, now waiting for Service B.
Tier 2
Returnees
DEFERRED (incomplete docs) or MISSED (reactivated).
Tier 3
Walk-ins
Urgent cases without a booking.
Tier 4
Late Appt
Arrived > 15 mins after their scheduled slot.

3. The State Machine & Counter Transfers
A ticket is never "deleted"; it moves through states:
CHECKED_IN: Ticket enters active_queue[0].
CALLED: Counter operator triggers "Next."
SERVING: Transaction in progress.
COMPLETING/TRANSFERRING: * If the services array has a next index $\rightarrow$ Ticket state resets to WAITING, active_queue updates to next service.
If not $\rightarrow$ COMPLETED.
DEFERRED: If requirements are missing, the operator hits "Defer." The ticket is paused. When the client returns later that day, they re-check in and join at Tier 2.
4. Edge Case: Handling "Missed" Tickets
The 3-Call Logic: The dashboard allows 3 "Calls." If no response after 3 minutes, the ticket is marked MISSED.
Self-Service Reactivation: A missed client can scan their ticket at the kiosk again. The system prompts: "You missed your call. Would you like to re-enter the queue?" * Penalty: Upon reactivation, they are demoted to Tier 2. This prevents them from cutting in front of Tier 1 appointments who arrived on time.

Part 3: Solving Bottlenecks (Optimization)
1. The "Swing Counter" (The QA-QB Balance)
If QA counters (5-7) are idle because the QB counters (8-10) are struggling with a backlog:
Dashboard Alert: Counter 5 sees a "High Load in QB" notification.
The Switch: The operator clicks "Assist QB." The system now routes QB tickets to Counter 5.
Visuals: The TV display updates: B-102 -> Counter 5.
2. Dashboard UI Considerations (Next.js)
Realtime Subscriptions: Use supabase.channel() to listen for INSERT or UPDATE on the tickets table. Every counter dashboard must update instantly when a new client checks in.
Estimated Wait Time (EWT): Calculate this dynamically:
$$(Waiting\_Clients \times 15\text{ mins}) / Active\_Counters = EWT$$
The "Handoff" Note: When transferring from QA to QB, allow the QA operator to type a 1-sentence note (e.g., "Payments verified, needs signature"). This note pops up on the QB operator's screen, saving time.

Summary of Recommended Tech Logic
Next.js: For the UI (Kiosk, Operator Dashboard, Public Display).
Supabase Auth: For staff login.
Supabase Realtime: For the "Calling" system.
PostgreSQL Functions: To handle the complex ORDER BY logic for the Tiers (ensuring the "Next" button always picks the right person).


