# 💬 Chatly

> Réseau social de messagerie avec messages éphémères — tout disparaît après 24h.

---

## 🚀 Démarrage rapide (local)

```bash
# 1. Installer les dépendances
npm install

# 2. Copier le fichier d'environnement
cp .env.example .env

# 3. Lancer le serveur
npm run dev

# → http://localhost:3000
```

**Compte de démo :** `alice` / `demo1234`

---

## 🌐 Déploiement sur Vercel (gratuit)

### Option A — Via GitHub (recommandé)

1. **Push le projet sur GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial Chatly"
   git branch -M main
   git remote add origin https://github.com/TON_USERNAME/chatly.git
   git push -u origin main
   ```

2. **Sur [vercel.com](https://vercel.com)**
   - Clique sur **"New Project"**
   - Importe ton repo GitHub
   - Dans **"Environment Variables"**, ajoute :
     - `JWT_SECRET` = une longue chaîne aléatoire (ex: `openssl rand -hex 32`)
   - Clique **Deploy**

3. **C'est en ligne !** URL : `https://chatly-xxx.vercel.app`

### Option B — Via Vercel CLI

```bash
npm i -g vercel
vercel
# Suivre les instructions, ajouter JWT_SECRET dans les env vars
```

---

## ⚠️ Important : Persistance des données

Vercel est **serverless** — la mémoire se réinitialise entre les invocations.

Pour une vraie persistance :
- **[Upstash Redis](https://upstash.com)** — gratuit, parfait avec Vercel
- **[PlanetScale](https://planetscale.com)** — MySQL serverless gratuit
- **[Supabase](https://supabase.com)** — PostgreSQL + Realtime gratuit

Pour les WebSockets en production : utilise **[Ably](https://ably.com)** ou **[Pusher](https://pusher.com)** (gratuit jusqu'à 100 conn).

---

## 🏗️ Architecture

```
chatly/
├── api/
│   ├── server.js          # Express + Socket.io
│   ├── db.js              # Base de données en mémoire
│   ├── socket.js          # Handlers temps réel
│   ├── middleware/
│   │   └── auth.js        # JWT middleware
│   └── routes/
│       ├── auth.js        # Register, login, /me
│       ├── users.js       # Profil, recherche, amis
│       ├── messages.js    # Conversations, messages
│       └── calls.js       # Signaling appels
├── public/
│   ├── index.html         # SPA shell
│   ├── css/
│   │   └── main.css       # Tous les styles
│   └── js/
│       └── app.js         # Toute la logique frontend
├── .env.example
├── package.json
└── vercel.json
```

---

## ✨ Fonctionnalités

| Feature | Détail |
|---|---|
| 🔐 Auth | Register/Login JWT, sessions 30 jours |
| 📸 Photo de profil | Upload avatar, stocké en base64 |
| 💬 Messages texte | Temps réel via Socket.io |
| 🎙️ Messages vocaux | Maintenir le bouton mic pour enregistrer |
| 📹 Appels vidéo | WebRTC + signaling via Socket.io |
| 📞 Appels vocaux | UI immersive avec timer en direct |
| 🔍 Recherche | Trouve des utilisateurs par nom/pseudo |
| 👥 Système d'amis | Demandes, acceptation, liste d'amis |
| ⏱️ Timer 24h | Chaque message expire automatiquement |
| 😊 Réactions | Emoji réactions sur les messages |
| 🖼️ Partage d'images | Envoie des photos dans la conversation |
| ✓✓ Lu/non lu | Accusés de réception en temps réel |
| ⌨️ Indicateur de frappe | "Alex écrit..." en temps réel |
| 🌐 Présence | Indicateur en ligne/hors ligne |
| 🔔 Notifications | Toast notifications pour les nouveaux msgs |
| 📱 Responsive | Adapté mobile et desktop |

---

## 🎨 Design

- **Typographie** : Syne (display) + DM Sans (corps)
- **Thème** : Dark mode, palette violet/bleu
- **Animations** : CSS transitions, keyframes natifs
- **Noise overlay** : Texture subtile pour la profondeur

---

## 🔧 Variables d'environnement

| Variable | Description | Défaut |
|---|---|---|
| `JWT_SECRET` | Clé secrète JWT | `chatly_super_secret...` |
| `PORT` | Port du serveur | `3000` |
| `NODE_ENV` | Environnement | `development` |

---

*Chatly — Vis l'instant. Parle vrai.*
"# chatly" 
"# chatly" 
"# chatly.com" 
