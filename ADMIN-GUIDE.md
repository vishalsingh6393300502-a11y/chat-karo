# Developer console

**Open it:** type your secret code in the Name box, tick the 18+ box, press Start Chatting. Normal users never see anything different.

**Set your own code (recommended):** add an `ADMIN_CODE` environment variable on Render/Railway. If it is missing, the built-in code is used, which is readable in `admin/index.js`, so do not rely on that if your repo is public. Use a long random code, not a phone number.

**Inside**
- 🔔 reports from users (view the chat, block, dismiss)
- ⋮ blocked users with the reason, and unblock
- Live: every current chat with photos, updating in real time; block either person
- Past: chats saved for 24 hours then deleted automatically; Download one or all (an HTML file with photos); switch to turn saving on or off
- Online: every online user with ID and gender; tap one to chat (they see you as "Admin"); Block button

**Good to know**
- Blocks use a device cookie plus network address, so a user on a new device and network can come back. Unblock anytime from ⋮.
- Saved chats, reports and blocks live in `data/`. Many free hosts wipe the disk on restart, so attach a persistent disk and set `DATA_DIR` to it.
- Because you can read chats and photos, say so in your terms/privacy notice.
- Env options are listed in `.env.example`.

