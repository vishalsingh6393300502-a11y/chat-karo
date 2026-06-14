# 🔵 Chat Karo — Deployment Guide

## Files Structure
```
chat-karo/
├── server.js        ← Node.js backend (Socket.io)
├── package.json     ← Dependencies
├── .gitignore
└── public/
    └── index.html   ← Complete frontend
```

---

## 🚀 RENDER.COM PE DEPLOY KARO (FREE) — Recommended

### Step 1 — GitHub pe daalo
1. GitHub.com pe jaao → "New Repository" banao → naam "chat-karo"
2. Apne PC pe folder kholo → Terminal/Command Prompt kholo
3. Ye commands chalaao:
```bash
cd chat-karo
git init
git add .
git commit -m "Chat Karo launch"
git remote add origin https://github.com/YOUR_USERNAME/chat-karo.git
git push -u origin main
```

### Step 2 — Render.com pe deploy
1. **render.com** pe jaao → Free account banao
2. "New +" click karo → "Web Service" select karo
3. GitHub connect karo → "chat-karo" repository choose karo
4. Settings:
   - **Name:** chat-karo
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free
5. "Create Web Service" click karo
6. 2-3 minutes mein aapki site LIVE ho jaayegi!
7. URL milega: `https://chat-karo-XXXX.onrender.com` ✅

---

## 🚀 RAILWAY.APP PE DEPLOY KARO (Alternative)

1. **railway.app** pe jaao → GitHub se login karo
2. "New Project" → "Deploy from GitHub repo"
3. "chat-karo" select karo
4. Auto-detect kar lega sab kuch
5. 1-2 minute mein live!

---

## 💻 LOCAL ME CHALAO (Testing ke liye)

```bash
cd chat-karo
npm install
node server.js
```
Browser mein jaao: `http://localhost:3000`

---

## ✨ Features
- ✅ Gender-based matching (80% opposite / 20% same)
- ✅ Real-time chat with Socket.io
- ✅ Typing indicators
- ✅ Photo request feature
- ✅ Report system
- ✅ Online user count
- ✅ Age verification (18+)
- ✅ Dark UI similar to ChatBlink
- ✅ Mobile-friendly
