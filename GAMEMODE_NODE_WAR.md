# Game Mode: Node War

**Status:** Design — not yet implemented

A team-based objective mode. Two Clan teams race to activate Nodes, seize a Key,
and hold the Mainframe. A 3rd faction of Guest players acts as a permanent wildcard —
they are always OP and steal the Key to stall or reset the game.

---

## Factions

| Faction | Who | Spawn | Respawn on death | Leaderboard | OP buff | Objective |
|---|---|---|---|---|---|---|
| **Clan 1** | Authenticated | Fixed | Normal | Yes | Only after Mainframe activation (while holding Key) | 3 nodes → Key → Mainframe → survive 5 min |
| **Clan 2** | Authenticated | Fixed | Normal | Yes | Only after Mainframe activation (while holding Key) | 3 nodes → Key → Mainframe → survive 5 min |
| **3rd Faction** | Guest only | Any active node | **None — kicked** | No | **Always** (full health, 50% damage reduction from spawn) | Steal the Key, deactivate nodes or Mainframe |

---

## Map Layout

| Object | Placeholder | Notes |
|---|---|---|
| Facility | Textured cube | Some have NPCs, some don't |
| Mainframe | Pyramid | Only one — target for Key activation |

- All **active Nodes are visible on every player's map** at all times.
- **NPCs relocate** to different facilities on every full reset.
- 3rd faction players **cannot join** until at least one Node is active.

---

## Core Mechanics

### 1. Node Activation (Clans only)

- Player walks up to a facility NPC → NPC asks: **"Do you want to activate this Node?"**
- On accept: progress bar fills 0→100%. Player is **not** movement-locked, but
  walking too far from the facility cancels the attempt. **Fully vulnerable**
  either way — teammates must protect them.
- Killed, walking out of range, or exiting the dialog before 100% → progress resets to 0%.
- On completion: Node is **Active for that team** — appears on all maps.
- **3rd faction players cannot activate Nodes.** NPCs will not accept their request.

### 2. Earning the Key

- First team to reach **3 Active Nodes** earns the Key from the completing NPC.
- **Only one Key can exist at a time.**
- When Team A earns the Key, **Team B's nodes immediately go neutral.**
  Team B's only objective from this point is to intercept the Key.

### 3. The Key — Carrying It

- The Key is always a **gold marker on all players' maps** — whether held or on the ground.
- **No OP buff** for simply carrying the Key. The buff is earned by activating the Mainframe.
- 3rd faction players carry the Key with **no OP buff on top of their existing faction buff**
  (they are already always OP — the Key buff doesn't stack).

### 4. Mainframe Activation

- Key holder reaches the Mainframe and triggers a **progress bar** (same mechanic as Nodes,
  including movement: not locked, but walking too far cancels it).
- **Fully vulnerable during activation.** Teammates must protect.
- On completion: **5-minute countdown begins.**
- Key holder receives **OP buff**: full health restored, 50% damage reduction.
  Buff lasts as long as they hold the Key.

### 5. The Countdown

- Activating team must survive 5 minutes.
- Enemies and 3rd faction must steal the Key and use it to deactivate the Mainframe.
- Countdown completes → **activating team wins.**

### 6. Key Transfer (Drop & Pickup)

| Event | Result |
|---|---|
| Key holder is killed | Key drops. **Gold ground marker on all maps.** |
| Own team picks up dropped Key | Inherits Key and OP buff (if Mainframe was active) |
| Enemy Clan picks up dropped Key | Inherits Key. **Cannot activate Mainframe with it.** No OP buff. |
| 3rd faction picks up dropped Key | Inherits Key. No extra buff (already always OP). |

### 7. Using the Key — Enemy Clan

The Key is **team-locked for Mainframe activation.** Enemy Clan cannot use a stolen Key to
activate the Mainframe for themselves. Their goal with the Key is to force a reset so they
can earn their own 3 nodes and their own Key.

- **Deactivate Nodes** — interact with each of the Key team's active Nodes via NPC dialog
  (progress bar). Deactivated Nodes stay deactivated even if Key changes hands mid-deactivation.
  All 3 deactivated → Key **destroyed** → **Full Reset**.
- **Deactivate Mainframe** — if counting down, interact with Mainframe (progress bar).
  Key **destroyed** → **Full Reset**.

### 8. Using the Key — 3rd Faction

Same deactivation actions as enemy Clan:

- **Deactivate Nodes** → Key destroyed → Full Reset.
- **Deactivate Mainframe** → Key destroyed → Full Reset.
- **Cannot activate the Mainframe** — 3rd faction has no winning condition.
- Picking up the Key makes the 3rd faction player the gold map marker — hunted by both teams.
- 3rd faction can hold the Key as long as they survive. No forced drop.
- **Triggering a Full Reset destroys their own spawn capacity** (all nodes go neutral, no new
  3rd faction can join). Existing 3rd faction players stay alive until killed. This is the
  consequence of choosing to be a Guest.

### 9. Own Team Recovering the Key

If the Key team picks their Key back up:

- Can **reactivate deactivated Nodes** via NPC dialog + progress bar.
- Once 3 Nodes are Active, can proceed to Mainframe.

### 10. Full Reset

Triggered when:
- All 3 of the Key team's Nodes are deactivated (Key destroyed), OR
- The Mainframe is deactivated (Key destroyed).

On reset:
- All Nodes → neutral for **both** teams.
- Key → destroyed.
- **NPCs relocate to new facilities.**
- 3rd faction players lose all spawn points. Alive players survive until killed, then are kicked.
  No new 3rd faction joins until a new Node activates.
- Both Clan teams restart the Node search from zero.

---

## Win Condition

**The Clan team whose Mainframe 5-minute countdown completes wins.**

---

## Flow

```
Both Clans race to activate 3 Nodes via NPC dialog
  3rd faction spawns at any active node — kills everyone
             ↓
First Clan earns the Key (one Key exists at a time)
Other Clan's nodes go neutral — their goal: intercept the Key
             ↓
Key holder travels to Mainframe (visible on map, no OP buff yet)
Teammates defend during Mainframe activation (progress bar, vulnerable)
             ↓
Mainframe activated — 5-minute countdown begins
Key holder: OP buff (full health, 50% damage reduction)
             ↓
  ┌───────────────────────────────────────────────────────┐
  │ Key stolen before countdown ends?                     │
  │   Key used to deactivate Mainframe → Full Reset       │
  │   Key used to deactivate all 3 nodes → Full Reset     │
  │   Key holder stays alive 5 minutes → TEAM WINS        │
  └───────────────────────────────────────────────────────┘
```

---

---

# Remaining Design Issue

---

## Summary — All Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Full reset on all-node deactivation | ✅ Yes — same reset as Mainframe deactivation |
| 2 | 3rd faction picks up Key to deactivate (stall faction) | ✅ Confirmed |
| 3 | OP buff on Key holder — after Mainframe activation only | ✅ Confirmed |
| 4 | 3rd faction cannot activate Nodes | ✅ Confirmed |
| 5 | No cap on 3rd faction — limited by permadeath + spawn availability | ✅ Confirmed |
| 6 | Other Clan's nodes go neutral when Key is earned | ✅ Confirmed |
| 7 | Dropped Key always visible as gold map marker | ✅ Confirmed |
| 8 | Key marker is gold/neutral — no team color | ✅ Confirmed |
| A | 3rd faction loses spawn on reset — intentional (guest consequence) | ✅ Confirmed |
| B | 3rd faction always OP from spawn (permanent faction trait) | ✅ Confirmed |
| C | 3rd faction can hold Key indefinitely — no forced drop | ✅ Confirmed |
| D | Tactical alliance between losing Clan + 3rd faction — let it play out | ✅ Confirmed |
| — | Can enemy Clan activate Mainframe with stolen Key? | ✅ **No — Key is team-locked for activation. Enemy can only use it to deactivate nodes or Mainframe, forcing a reset so they can try again.** |
