const express = require('express');
const { google } = require('googleapis');
const admin = require('firebase-admin');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

// 🔹 Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

console.log("Firebase initialized successfully!");

// 🔹 Google OAuth2 setup
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_CLIENT_ID';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'YOUR_CLIENT_SECRET';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
let calendar; // Will hold authenticated calendar

// 🔹 Step 1: Redirect user to Google auth URL
app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ],
  });
  res.redirect(url);
});

// 🔹 Step 2: Handle OAuth2 callback
app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Initialize Calendar API with authenticated client
    calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    res.send('✅ Google Calendar authentication successful! You can now POST /create-meet');
  } catch (err) {
    console.error(err);
    res.status(500).send('❌ Authentication failed');
  }
});

// 🔹 Step 3: API to create Google Meet
app.post('/create-meet', async (req, res) => {
  try {
    if (!calendar) return res.status(400).send('Authenticate first via /auth');

    const { title, startTime, endTime } = req.body;

    const event = {
      summary: title || 'Scheduled Meeting',
      start: { dateTime: startTime, timeZone: 'Asia/Kolkata' },
      end: { dateTime: endTime, timeZone: 'Asia/Kolkata' },
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1,
    });

    const meetLink = response.data.conferenceData.entryPoints[0].uri;
    res.json({ meetLink });
  } catch (err) {
    console.error(err.response?.data || err);
    res.status(500).json({ error: 'Failed to create meeting' });
  }
});

// 🔹 Firebase Notification routes

// Send notification
app.post("/send", async (req, res) => {
  const { token, title, body } = req.body;
  if (!token || !title || !body) return res.status(400).send("Missing fields");

  try {
    await admin.messaging().send({ notification: { title, body }, token });
    res.send("✅ Notification sent successfully!");
  } catch (error) {
    console.error("❌ Error sending message:", error);
    res.status(500).send("Error sending message");
  }
});

// Schedule notification
app.post("/schedule", async (req, res) => {
  const { token, title, body, date, time } = req.body;
  if (!token || !title || !body || !date || !time) return res.status(400).send("Missing required fields");

  try {
    const scheduleDateTime = new Date(`${date}T${time}:00+05:30`);
    const delay = scheduleDateTime - new Date();

    if (delay <= 0) return res.status(400).send("Scheduled time must be in the future");

    setTimeout(async () => {
      try {
        await admin.messaging().send({ notification: { title, body }, token });
        console.log(`✅ Notification sent to ${token}`);
      } catch (error) {
        console.error("❌ Error sending scheduled notification:", error);
      }
    }, delay);

    res.send(`🕒 Notification scheduled for ${scheduleDateTime.toLocaleString()}`);
  } catch (error) {
    console.error("❌ Scheduling error:", error);
    res.status(500).send("Error scheduling notification");
  }
});

// Get all admin tokens
app.get("/adminTokens", async (req, res) => {
  try {
    const snapshot = await admin.firestore().collection("adminTokens").get();
    const tokens = snapshot.docs.map(doc => doc.id);
    res.status(200).json({ tokens });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error fetching admin tokens" });
  }
});

// Notify all admins immediately
app.post("/notify-admins", async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) return res.status(400).send("Missing title or body");

  try {
    const snapshot = await admin.firestore().collection('adminTokens').get();
    const tokens = snapshot.docs.map(doc => doc.id).filter(Boolean);
    if (!tokens.length) return res.status(200).send("No admin tokens available");

    await Promise.all(tokens.map(async (token) => {
      try {
        await admin.messaging().send({ notification: { title, body }, token });
      } catch (err) {
        if (err.code === 'messaging/registration-token-not-registered') {
          await admin.firestore().collection('adminTokens').doc(token).delete();
        }
      }
    }));

    res.send(`✅ Notifications sent to ${tokens.length} admins`);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error sending notifications");
  }
});

// Schedule notifications for all admins
app.post("/schedule-admins", async (req, res) => {
  const { title, body, date, time } = req.body;
  if (!title || !body || !date || !time) return res.status(400).send("Missing required fields");

  try {
    const snapshot = await admin.firestore().collection("adminTokens").get();
    const tokens = snapshot.docs.map(doc => doc.id).filter(Boolean);
    if (!tokens.length) return res.status(200).send("No admin tokens available");

    const scheduleDateTime = new Date(`${date}T${time}:00+05:30`);
    const delay = scheduleDateTime - new Date();
    if (delay <= 0) return res.status(400).send("Scheduled time must be in the future");

    setTimeout(async () => {
      await Promise.all(tokens.map(async (token) => {
        try {
          await admin.messaging().send({ notification: { title, body }, token });
        } catch (err) {
          if (err.code === 'messaging/registration-token-not-registered') {
            await admin.firestore().collection('adminTokens').doc(token).delete();
          }
        }
      }));
      console.log(`✅ Scheduled notifications sent at ${new Date().toLocaleString()}`);
    }, delay);

    res.send(`🕒 Notifications scheduled for ${scheduleDateTime.toLocaleString()} to ${tokens.length} admins`);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error scheduling notifications for admins");
  }
});

// 🔹 Start server
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('Open http://localhost:3000/auth to authenticate Google Calendar');
});
