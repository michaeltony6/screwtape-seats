# Screwtape Letters seat picker

A small website where everyone on the sign-up list picks their own seat for **The Screwtape Letters** (NBPAC, Thursday, November 5, 2026, 7:30 PM). Only the 100 seats on our order can be picked; every other seat on the map is grayed out.

- `index.html`: the website (plain HTML/CSS/JS, no build step)
- `seatmap.js`: the theater layout, generated from the lobby seating chart by `tools/make_seatmap.py`
- `apps-script/Code.gs`: the backend, which runs inside a Google Sheet

## How it works

The site reads and writes a Google Sheet through a small Google Apps Script web app. The Sheet has two tabs:

- **Roster:** the sign-up list. Only people on it can pick, and they confirm who they are with their **last name plus any one of their NetID, email or phone number**. Guests from other schools without a NetID use their phone number. Someone listed twice counts once. The list stays in your Sheet; the website never receives it.
- **Seats:** one row per seat. When someone picks, their name, ID (NetID, else email, else phone) and the time fill that row.

How it behaves:

- **No double-booking.** The script handles one reservation at a time, so two people can't get the same seat.
- **One seat each.** People can move to another open seat or cancel any time. If they use a different phone, the site asks before moving their existing seat. "Find my seat" lets them look it up from any device.
- **On the map**, taken seats show first name and last initial ("Mina S."), or "Reserved" for a hold with no name. NetIDs, emails and phone numbers stay in the Sheet.
- **Picking stays closed until the Roster has names in it.**

## Running it from the Sheet

A **Seats** menu appears in the Google Sheet:

- **Sync Roster "Seat" column**: fills in which seat each person has, so you can see who hasn't picked. It also updates by itself on every pick.
- **Seat everyone who hasn't picked**: after your deadline, gives each remaining person an open seat.
- **Close seat picking / Reopen seat picking**: freezes the map, for example the night before the show.

To free a seat by hand, clear the Name and ID cells in its row on the Seats tab. To hold one for someone, type their name and any of their NetID, email or phone there. The site picks up changes within about 10 seconds.

## One-time setup (about 5 minutes)

Use your **personal Google account**. Rutgers accounts often block the "Anyone" sharing option this needs.

1. Go to **sheets.new** to create a blank Google Sheet. Name it *Screwtape Seats*.
2. In the Sheet, open **Extensions → Apps Script**.
3. Delete the starter code, paste in everything from `apps-script/Code.gs`, and press **⌘S** to save.
4. Click **Deploy → New deployment**. Click the gear next to "Select type" and choose **Web app**.
   - Description: `Seats`
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy**, then **Authorize access** and choose your account. Google will say it "hasn't verified this app", because it's your own script. Click **Advanced → Go to (project name) (unsafe) → Allow**.
6. Copy the **Web app URL**, which ends in `/exec`. Paste it into `API_URL` near the bottom of `index.html` (or send it to Claude). If you only have the **Deployment ID**, the URL is `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`.
7. Reload the Sheet. Use the new **Seats** menu → **Set up tabs**. This creates the Roster and Seats tabs.
8. Paste the sign-up list into the **Roster** tab: one person per row, under headers. Use **Name** (or **First Name** / **Last Name**) plus any of **NetID**, **Email** and **Phone**, in any order; other columns are ignored. Keep a column titled **Seat** to see who has picked. Picking opens as soon as the Roster has names. To add late sign-ups, add rows at the bottom.

### If you change the script later

Use **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**, which keeps the same URL. "New deployment" would create a new URL that the site doesn't know about.

## Hosting

The site is served from GitHub Pages. Any static host works: upload `index.html` and `seatmap.js` together.

## Testing locally

```bash
cd ~/Documents/screwtape-seats && python3 -m http.server 8000
```

Then open `http://localhost:8000/?api=YOUR_EXEC_URL`. The `?api=` part points the page at any backend without editing the file.
