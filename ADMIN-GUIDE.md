# Chat Karo: developer console and premium

## Developer login
1. Start the server and read the log (Render or Railway "Logs" tab, or your terminal). It prints your first username and a temporary password.
2. On the site type them in Name and Password, tick 18+, press Start Chatting. The console opens and asks you to set your own username and password. You can change them any time from the three dots, Developer login.
3. Your first username is 6393300502. That number is also inside your UPI ID, so users can see it. Change the username too.
4. Want a fixed first password? Set ADMIN_PASSWORD. Locked out? Set RESET_ADMIN=1, restart once, then remove it.

## Users
Everyone signs in with a name and a password. A new name creates the account, an existing name needs the same password. The name is the user id people write in the payment note. Forgot password: open the user in the console and press Reset password.

## Plans (each feature lasts 120 hours = 5 days)
- 10 rupees, Blue Tick: blue tick next to the name.
- 25 rupees, Plus: blue tick, emoji tray, pick a person to chat with (the other person must accept).
- 50 rupees, Ultra: everything in Plus, 10 chat backgrounds, gift buttons (coffee and more), password-protected groups.
All checks happen on the server. Emojis typed from the phone keyboard still work for everyone; the emoji tray with big emojis is the premium part.

## Taking payments
Users see a small banner after login (they can close it). Buy membership shows the plans, your QR, a big note with their user id, a Pay with UPI app button (amount and user id filled in) and I have paid.
Their request shows in your 🔔 under Payments. Check PhonePe for that user id in the note, then press Approve. Their plan starts and they get a message and a countdown in their own 🔔.

## Online tab
Online and Past 24h users. Each row has a Chat button (live chat, or a message they read in their 🔔 when offline) and a star switch (all features on or off). Tap a name for: Block switch, Plan 1/2/3, a switch with timer for every feature, Reset password.
The Premium tab lists everyone who has premium, and your running groups (you can close one).

## Good to know
- Accounts, premium time, saved chats, reports and blocks live in the data folder. Many free hosts wipe it on restart, so attach a persistent disk and set DATA_DIR, or paid users lose their premium.
- Because you can read chats, photos and groups, say so in your terms and privacy notice.
- Options are listed in .env.example.
